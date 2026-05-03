/**
 * Bulk transaction cache seeder — scrapes EdgeProp condo overview pages for
 * PSF stats (no login required) and stores them in private_project_tx_cache.
 *
 * EdgeProp shows "Average S$ X psf / Range S$ X - Y psf (last 12 months)"
 * on every condo-apartment page without authentication.
 *
 * By default skips condos checked within the last 30 days.
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
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return { status: res.status, text };
  } catch {
    return { status: 0, text: "" };
  }
}

// ── Parse PSF from EdgeProp overview page ─────────────────────────────────────

interface ParsedStats {
  avgPsf:    number;
  minPsf:    number;
  maxPsf:    number;
  hasData:   boolean;
  is12m:     boolean;
}

function parsePsfFromPage(text: string): ParsedStats {
  // EdgeProp text pattern (sale section only — stop before "Rental"):
  // "Sale Price * Average S$ 1,724 psf Range S$ 1,205 - 1,868 psf Rental Price"
  const saleSection = text.match(/Sale Price.*?(?=Rental Price|$)/i)?.[0] ?? "";

  const avgMatch = saleSection.match(/Average\s+S\$\s*([\d,]+)\s*psf/i);
  const rangeMatch = saleSection.match(/Range\s+S\$\s*([\d,]+)\s*[-–]\s*([\d,]+)\s*psf/i);

  const avgPsf = avgMatch  ? parseInt(avgMatch[1].replace(/,/g, ""), 10) : 0;
  const minPsf = rangeMatch ? parseInt(rangeMatch[1].replace(/,/g, ""), 10) : 0;
  const maxPsf = rangeMatch ? parseInt(rangeMatch[2].replace(/,/g, ""), 10) : 0;

  const is12m = /last 12 months|12 month|URA sales data/i.test(text);

  return { avgPsf, minPsf, maxPsf, hasData: avgPsf > 0, is12m };
}

// ── Derive trend and liquidity labels ─────────────────────────────────────────

function deriveTrend(text: string): string {
  // EdgeProp sometimes shows a trend indicator or we can infer nothing reliable
  if (/rising|increas|upward|climb/i.test(text))      return "Rising";
  if (/declin|decreas|downward|soften|weaken/i.test(text)) return "Declining";
  return "Stable";
}

function deriveLiquidity(text: string): string {
  if (/high transaction volume/i.test(text)) return "High";
  if (/very low.*transaction|no transaction/i.test(text)) return "Very Low";
  return "Unknown";
}

// ── Research one condo ────────────────────────────────────────────────────────

interface CacheRow {
  latestPsf:       number;
  medianPsf12m:    number;
  txCount12m:      number;
  trendLabel:      string;
  liquidityLabel:  string;
  confidence:      string;
  status:          string;
  note:            string;
}

async function researchCondo(name: string): Promise<CacheRow> {
  const slug = toSlug(name);

  // Try primary URL first, then fallback
  const urls = [
    `https://www.edgeprop.sg/condo-apartment/${slug}`,
    `https://www.edgeprop.sg/condo/${slug}`,
  ];

  for (const url of urls) {
    const { status, text } = await fetchText(url);
    if (status !== 200 || !text) continue;

    const stats = parsePsfFromPage(text);
    if (!stats.hasData) continue;

    const median = stats.minPsf && stats.maxPsf
      ? Math.round((stats.minPsf + stats.maxPsf) / 2)
      : stats.avgPsf;

    return {
      latestPsf:      stats.avgPsf,
      medianPsf12m:   median,
      txCount12m:     0,   // not shown without login
      trendLabel:     deriveTrend(text),
      liquidityLabel: deriveLiquidity(text),
      confidence:     "medium",
      status:         "found",
      note:           url,
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
    note:           "",
  };
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertCache(name: string, row: CacheRow): Promise<void> {
  await db.execute({
    sql: `INSERT INTO private_project_tx_cache
            (project_name, property_category, latest_psf, median_psf_12m,
             last_12m_tx_count, price_trend_label, liquidity_label,
             confidence, transaction_status, checked_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(project_name) DO UPDATE SET
            latest_psf        = excluded.latest_psf,
            median_psf_12m    = excluded.median_psf_12m,
            last_12m_tx_count = excluded.last_12m_tx_count,
            price_trend_label = excluded.price_trend_label,
            liquidity_label   = excluded.liquidity_label,
            confidence        = excluded.confidence,
            transaction_status= excluded.transaction_status,
            checked_at        = excluded.checked_at`,
    args: [
      name,
      "private",
      row.latestPsf    || null,
      row.medianPsf12m || null,
      row.txCount12m,
      row.trendLabel,
      row.liquidityLabel,
      row.confidence,
      row.status,
      new Date().toISOString(),
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
    : `(c.project_name IS NULL OR c.checked_at < '${staleThreshold}' OR c.transaction_status = 'no_data')`;

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

  let done = 0, found = 0, noData = 0, errors = 0;

  for (const { id, name } of todo) {
    const pad = String(done + 1).padStart(4);
    process.stdout.write(`  ${pad}/${todo.length}  id=${String(id).padStart(5)}  ${name.padEnd(38)}`);

    try {
      const row = await researchCondo(name);
      await upsertCache(name, row);

      if (row.status === "found") {
        process.stdout.write(`  ✓  PSF avg S$${row.latestPsf}  median S$${row.medianPsf12m}\n`);
        found++;
      } else {
        process.stdout.write(`  —  no data\n`);
        noData++;
      }
    } catch (e) {
      process.stdout.write(`  ✗  ${e instanceof Error ? e.message.slice(0, 60) : e}\n`);
      errors++;
    }

    done++;
    await sleep(300); // polite rate limit
  }

  // Final report
  const s = (await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN transaction_status='found'   THEN 1 ELSE 0 END) as found,
      SUM(CASE WHEN transaction_status='no_data' THEN 1 ELSE 0 END) as no_data,
      SUM(CASE WHEN median_psf_12m > 0 THEN 1 ELSE 0 END) as has_psf,
      ROUND(AVG(CASE WHEN median_psf_12m > 0 THEN median_psf_12m END)) as avg_psf
    FROM private_project_tx_cache
  `)).rows[0];

  const unchecked = (await db.execute(`
    SELECT COUNT(*) as n FROM private_property_master m
    LEFT JOIN private_project_tx_cache c ON UPPER(m.project_name)=UPPER(c.project_name)
    WHERE c.project_name IS NULL
  `)).rows[0].n;

  console.log(`\n══ TX Cache Seed Report ═══════════════════════════════════`);
  console.log(`  This run       : ${done} processed  (✓ ${found}  — ${noData} no data  ✗ ${errors} errors)`);
  console.log(`  Cache total    : ${s.total} rows  (${s.found} with PSF, ${s.no_data} no data)`);
  console.log(`  Avg median PSF : S$${s.avg_psf ?? "—"}`);
  console.log(`  Still unchecked: ${unchecked}`);
  console.log("\n✓ Done");
  db.close();
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
