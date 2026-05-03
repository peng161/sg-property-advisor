/**
 * Bulk transaction cache seeder — scrapes EdgeProp condo overview pages for
 * overall PSF stats AND per-bedroom unit sizes + asking PSF.
 *
 * Per-bedroom data comes from the listing section of the EdgeProp page:
 *   "$price … N bed(s) … S$ PSF psf"
 * Size is inferred as price / psf (sqft) → sqm. Penthouses are filtered out.
 *
 * By default skips condos checked within the last 30 days (but always
 * retries entries that previously returned no_data).
 *
 * Usage:
 *   npm run seed:tx-cache                       # fill missing/stale entries
 *   npm run seed:tx-cache -- --all              # re-check everything
 *   npm run seed:tx-cache -- --limit 50         # process at most 50 condos
 *   npm run seed:tx-cache -- --from 200         # start from master id >= 200
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv      = process.argv.slice(2);
const FORCE_ALL = argv.includes("--all");

const limitIdx  = argv.indexOf("--limit");
const LIMIT     = limitIdx !== -1 ? parseInt(argv[limitIdx + 1] ?? "9999", 10) : 9999;

const fromIdx   = argv.indexOf("--from");
const FROM_ID   = fromIdx !== -1 ? parseInt(argv[fromIdx + 1] ?? "0", 10) : 0;

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Fetch & strip HTML ────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-SG,en;q=0.9",
      },
      signal: AbortSignal.timeout(18_000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi,  " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { status: res.status, text };
  } catch {
    return { status: 0, text: "" };
  }
}

// ── Parse overall PSF from EdgeProp overview ──────────────────────────────────

function parseOverallPsf(text: string): { avgPsf: number; minPsf: number; maxPsf: number } {
  const saleSection = text.match(/Sale Price.*?(?=Rental Price|$)/i)?.[0] ?? "";
  const avgMatch   = saleSection.match(/Average\s+S\$\s*([\d,]+)\s*psf/i);
  const rangeMatch = saleSection.match(/Range\s+S\$\s*([\d,]+)\s*[-–]\s*([\d,]+)\s*psf/i);
  return {
    avgPsf: avgMatch   ? parseInt(avgMatch[1].replace(/,/g, ""), 10) : 0,
    minPsf: rangeMatch ? parseInt(rangeMatch[1].replace(/,/g, ""), 10) : 0,
    maxPsf: rangeMatch ? parseInt(rangeMatch[2].replace(/,/g, ""), 10) : 0,
  };
}

// ── Parse per-bedroom unit sizes + asking PSF from listing section ────────────

export interface UnitTypeData {
  sqm_low:  number;
  sqm_high: number;
  avg_psf:  number;
  count:    number;
}

// Max sqm-per-bedroom ratio to filter out penthouses / strata commercial units
const MAX_SQM_PER_BED = 62;

function parseUnitTypes(text: string): Record<string, UnitTypeData> {
  // Pattern: $price [% Rental Volume] N bed(s) [• N bath] ... S$ PSF psf
  const pat = /\$\s*([\d,]+)\s+(?:[\d.]+\s*%[^$]{0,60})?\s*(\d+)\s*beds?[^$]{0,120}S\$\s*([\d,]+)\s*psf/gi;

  const groups: Record<number, { sqm: number; psf: number }[]> = {};
  let m: RegExpExecArray | null;

  while ((m = pat.exec(text)) !== null) {
    const price = parseInt(m[1].replace(/,/g, ""), 10);
    const beds  = parseInt(m[2], 10);
    const psf   = parseInt(m[3].replace(/,/g, ""), 10);

    if (price < 200_000 || psf < 500 || psf > 8_000 || beds < 1 || beds > 5) continue;

    const sqft = price / psf;
    const sqm  = Math.round(sqft / 10.764);

    // Filter implausible sizes (too small or likely penthouse)
    if (sqm < 25 || sqm > beds * MAX_SQM_PER_BED) continue;

    (groups[beds] ??= []).push({ sqm, psf });
  }

  const labels: Record<number, string> = { 1: "1BR", 2: "2BR", 3: "3BR", 4: "4BR", 5: "5BR" };
  const out: Record<string, UnitTypeData> = {};

  for (const [bedsStr, data] of Object.entries(groups)) {
    const label = labels[Number(bedsStr)];
    if (!label || data.length < 1) continue;

    const avgPsf = Math.round(data.reduce((s, d) => s + d.psf, 0) / data.length);
    const sqms   = data.map((d) => d.sqm);
    out[label] = {
      sqm_low:  Math.min(...sqms),
      sqm_high: Math.max(...sqms),
      avg_psf:  avgPsf,
      count:    data.length,
    };
  }

  return out;
}

// ── Derive trend / liquidity labels ──────────────────────────────────────────

function deriveTrend(text: string): string {
  if (/rising|increas|upward|climb/i.test(text))          return "Rising";
  if (/declin|decreas|downward|soften|weaken/i.test(text)) return "Declining";
  return "Stable";
}

function deriveLiquidity(text: string): string {
  if (/high transaction volume/i.test(text))              return "High";
  if (/very low.*transaction|no transaction/i.test(text)) return "Very Low";
  return "Unknown";
}

// ── Research one condo ────────────────────────────────────────────────────────

interface CacheRow {
  latestPsf:      number;
  medianPsf12m:   number;
  txCount12m:     number;
  trendLabel:     string;
  liquidityLabel: string;
  confidence:     string;
  status:         string;
  unitsJson:      string | null;
}

async function researchCondo(name: string): Promise<CacheRow> {
  const slug = toSlug(name);

  const urls = [
    `https://www.edgeprop.sg/condo-apartment/${slug}`,
    `https://www.edgeprop.sg/condo/${slug}`,
  ];

  for (const url of urls) {
    const { status, text } = await fetchText(url);
    if (status !== 200 || !text) continue;

    const overall = parseOverallPsf(text);
    if (!overall.avgPsf) continue;

    const median = overall.minPsf && overall.maxPsf
      ? Math.round((overall.minPsf + overall.maxPsf) / 2)
      : overall.avgPsf;

    const units = parseUnitTypes(text);
    const unitsJson = Object.keys(units).length > 0 ? JSON.stringify(units) : null;

    return {
      latestPsf:      overall.avgPsf,
      medianPsf12m:   median,
      txCount12m:     0,
      trendLabel:     deriveTrend(text),
      liquidityLabel: deriveLiquidity(text),
      confidence:     unitsJson ? "high" : "medium",
      status:         "found",
      unitsJson,
    };
  }

  return {
    latestPsf:      0,
    medianPsf12m:   0,
    txCount12m:     0,
    trendLabel:     "Unknown",
    liquidityLabel: "Unknown",
    confidence:     "low",
    status:         "no_data",
    unitsJson:      null,
  };
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertCache(name: string, row: CacheRow): Promise<void> {
  await db.execute({
    sql: `INSERT INTO private_project_tx_cache
            (project_name, property_category, latest_psf, median_psf_12m,
             last_12m_tx_count, price_trend_label, liquidity_label,
             confidence, transaction_status, checked_at, units_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(project_name) DO UPDATE SET
            latest_psf        = excluded.latest_psf,
            median_psf_12m    = excluded.median_psf_12m,
            last_12m_tx_count = excluded.last_12m_tx_count,
            price_trend_label = excluded.price_trend_label,
            liquidity_label   = excluded.liquidity_label,
            confidence        = excluded.confidence,
            transaction_status= excluded.transaction_status,
            checked_at        = excluded.checked_at,
            units_json        = excluded.units_json`,
    args: [
      name, "private",
      row.latestPsf    || null,
      row.medianPsf12m || null,
      row.txCount12m,
      row.trendLabel,
      row.liquidityLabel,
      row.confidence,
      row.status,
      new Date().toISOString(),
      row.unitsJson,
    ],
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const v of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"] as const) {
    if (!process.env[v]) { console.error(`✗ ${v} must be set`); process.exit(1); }
  }

  const staleThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const skipClause = FORCE_ALL
    ? "1=1"
    : `(c.project_name IS NULL OR c.checked_at < '${staleThreshold}' OR c.transaction_status = 'no_data' OR c.units_json IS NULL)`;

  const res = await db.execute(`
    SELECT m.id, m.project_name
    FROM private_property_master m
    LEFT JOIN private_project_tx_cache c ON UPPER(m.project_name) = UPPER(c.project_name)
    WHERE m.id >= ${FROM_ID}
      AND ${skipClause}
    ORDER BY m.id
    LIMIT ${LIMIT}
  `);

  const todo = res.rows.map((r) => ({ id: Number(r.id), name: String(r.project_name) }));
  const mode = FORCE_ALL ? "re-checking" : "filling missing for";
  console.log(`\n${mode} ${todo.length} condos (limit=${LIMIT}, from_id=${FROM_ID})\n`);
  if (!todo.length) { console.log("Nothing to do."); db.close(); return; }

  let done = 0, found = 0, withUnits = 0, noData = 0, errors = 0;

  for (const { id, name } of todo) {
    const pad = String(done + 1).padStart(4);
    process.stdout.write(`  ${pad}/${todo.length}  id=${String(id).padStart(5)}  ${name.padEnd(36)}`);

    try {
      const row = await researchCondo(name);
      await upsertCache(name, row);

      if (row.status === "found") {
        const units = row.unitsJson ? (JSON.parse(row.unitsJson) as Record<string, UnitTypeData>) : {};
        const unitSummary = Object.entries(units)
          .map(([k, v]) => `${k}:${v.sqm_low}-${v.sqm_high}sqm@$${v.avg_psf}`)
          .join("  ");
        process.stdout.write(`  ✓  avg $${row.latestPsf}psf${unitSummary ? "  " + unitSummary : ""}\n`);
        found++;
        if (row.unitsJson) withUnits++;
      } else {
        process.stdout.write(`  —  no data\n`);
        noData++;
      }
    } catch (e) {
      process.stdout.write(`  ✗  ${e instanceof Error ? e.message.slice(0, 60) : e}\n`);
      errors++;
    }

    done++;
    await sleep(300);
  }

  // Final report
  const s = (await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN transaction_status='found'   THEN 1 ELSE 0 END) as found,
      SUM(CASE WHEN transaction_status='no_data' THEN 1 ELSE 0 END) as no_data,
      SUM(CASE WHEN units_json IS NOT NULL        THEN 1 ELSE 0 END) as with_units,
      ROUND(AVG(CASE WHEN median_psf_12m > 0 THEN median_psf_12m END)) as avg_psf
    FROM private_project_tx_cache
  `)).rows[0];

  const unchecked = (await db.execute(`
    SELECT COUNT(*) as n FROM private_property_master m
    LEFT JOIN private_project_tx_cache c ON UPPER(m.project_name)=UPPER(c.project_name)
    WHERE c.project_name IS NULL
  `)).rows[0].n;

  console.log(`\n══ TX Cache Seed Report ═══════════════════════════════════`);
  console.log(`  This run      : ${done} (✓ ${found} found  ${withUnits} with unit data  — ${noData} no data  ✗ ${errors} errors)`);
  console.log(`  Cache total   : ${s.total} rows  (${s.found} found  ${s.with_units} with units  ${s.no_data} no data)`);
  console.log(`  Avg median PSF: S$${s.avg_psf ?? "—"}`);
  console.log(`  Still unchecked: ${unchecked}`);
  console.log("\n✓ Done");
  db.close();
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
