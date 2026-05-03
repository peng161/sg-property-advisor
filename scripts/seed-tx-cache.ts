/**
 * Bulk transaction cache seeder — runs the web-agent researcher against every
 * condo in private_property_master and stores aggregated metrics into
 * private_project_tx_cache.
 *
 * By default skips condos already checked within the last 30 days.
 *
 * Usage:
 *   npm run seed:tx-cache                       # fill missing entries
 *   npm run seed:tx-cache -- --all              # re-check everything
 *   npm run seed:tx-cache -- --limit 50         # process at most 50 condos
 *   npm run seed:tx-cache -- --from 200         # start from master row id >= 200
 *   npm run seed:tx-cache -- --limit 20 --from 100
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import Anthropic from "@anthropic-ai/sdk";

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
const anthropic = new Anthropic();

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv      = process.argv.slice(2);
const FORCE_ALL = argv.includes("--all");

const limitIdx  = argv.indexOf("--limit");
const LIMIT     = limitIdx !== -1 ? parseInt(argv[limitIdx + 1] ?? "9999", 10) : 9999;

const fromIdx   = argv.indexOf("--from");
const FROM_ID   = fromIdx !== -1 ? parseInt(argv[fromIdx + 1] ?? "0", 10) : 0;

const currentYear = new Date().getFullYear();

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Web fetch ─────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-SG,en;q=0.9",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return `HTTP ${res.status}`;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Tool ─────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "fetch_page",
    description:
      "Fetch a Singapore property portal page. Try EdgeProp first, then 99.co, then SRX.",
    input_schema: {
      type: "object" as const,
      properties: {
        url:    { type: "string" },
        reason: { type: "string" },
      },
      required: ["url", "reason"],
    },
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface TxRecord {
  date:      string;
  price_sgd: number;
  area_sqft: number;
  psf:       number;
  room_type: string;
}

interface AgentResult {
  total_records: number;
  latest_psf:    number;
  median_psf_12m: number;
  last_12m_tx_count: number;
  price_trend_label: string;
  liquidity_label:   string;
  confidence:        string;
  transaction_status: string;
  transactions: TxRecord[];
}

// ── Derive cache metrics from raw transactions ─────────────────────────────────

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function deriveCacheMetrics(result: {
  total_records: number;
  psf_stats?: { min: number; max: number; mean: number; median: number };
  transactions: TxRecord[];
  trend_summary?: string;
}): AgentResult {
  const txs = result.transactions ?? [];
  const now  = new Date();
  const cutoff12m = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const recentTxs = txs.filter((t) => t.date >= cutoff12m);
  const recentPsfs = recentTxs.map((t) => t.psf).filter((p) => p > 0);
  const allPsfs    = txs.map((t) => t.psf).filter((p) => p > 0);

  // latest_psf: PSF from the most recent transaction
  const sortedByDate = [...txs].sort((a, b) => b.date.localeCompare(a.date));
  const latestPsf = sortedByDate.find((t) => t.psf > 0)?.psf ?? result.psf_stats?.median ?? 0;

  // trend label from trend_summary or derived
  const trend = (result.trend_summary ?? "").toLowerCase();
  let trendLabel = "Stable";
  if (/rising|increas|upward|climb|surged/i.test(trend))    trendLabel = "Rising";
  else if (/declin|decreas|downward|soften|weaken/i.test(trend)) trendLabel = "Declining";

  // liquidity from 12m volume
  const txCount12m = recentTxs.length;
  let liquidity = "Very Low";
  if (txCount12m >= 40)      liquidity = "High";
  else if (txCount12m >= 15) liquidity = "Medium";
  else if (txCount12m >= 5)  liquidity = "Low";

  // confidence based on total records
  let confidence = "low";
  if (result.total_records >= 20)  confidence = "high";
  else if (result.total_records >= 5) confidence = "medium";

  return {
    total_records:     result.total_records,
    latest_psf:        latestPsf,
    median_psf_12m:    median(recentPsfs.length ? recentPsfs : allPsfs),
    last_12m_tx_count: txCount12m,
    price_trend_label: trendLabel,
    liquidity_label:   liquidity,
    confidence,
    transaction_status: result.total_records > 0 ? "found" : "no_data",
    transactions: txs,
  };
}

// ── Web agent for a single condo ──────────────────────────────────────────────

async function researchCondo(name: string): Promise<AgentResult> {
  const slug = toSlug(name);
  const fetchedAt = new Date().toISOString();

  const system =
    `You are a Singapore real estate analyst finding transaction history for a condo.\n` +
    `Try EdgeProp first (most complete), then 99.co, then SRX.\n` +
    `Extract every transaction row: date (YYYY-MM), price SGD, area sqft, PSF, room_type.\n` +
    `Return ONLY valid JSON — no prose, no markdown.`;

  const userMsg =
    `Find past transaction records for: "${name}"\n\n` +
    `Try these URLs in order:\n` +
    `1. https://www.edgeprop.sg/condo/${slug}/transactions\n` +
    `2. https://www.99.co/singapore/condos-apartments/${slug}/past-transactions\n` +
    `3. https://www.srx.com.sg/condominium/${slug}/past-transaction\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  "total_records": <int>,\n` +
    `  "psf_stats": { "min": <int>, "max": <int>, "mean": <int>, "median": <int> },\n` +
    `  "transactions": [\n` +
    `    { "date": "YYYY-MM", "price_sgd": <int>, "area_sqft": <int>, "psf": <int>, "room_type": "<e.g. 3 Bedroom>" }\n` +
    `  ],\n` +
    `  "trend_summary": "<2 sentences on PSF trend>",\n` +
    `  "fetched_at": "${fetchedAt}"\n` +
    `}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

  for (let round = 0; round < 10; round++) {
    const resp = await anthropic.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 4096,
      system,
      tools:      TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "end_turn") {
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const parsed = JSON.parse(m[0]);
          return deriveCacheMetrics(parsed);
        } catch { /* fall through */ }
      }
      return deriveCacheMetrics({ total_records: 0, transactions: [] });
    }

    if (resp.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        const inp = block.input as { url: string };
        process.stdout.write(` [${inp.url.replace(/https?:\/\//, "").slice(0, 40)}]`);
        const content = await fetchPage(inp.url);
        results.push({ type: "tool_result", tool_use_id: block.id, content });
      }
      messages.push({ role: "user", content: results });
    }
  }

  return deriveCacheMetrics({ total_records: 0, transactions: [] });
}

// ── Upsert into tx cache ──────────────────────────────────────────────────────

async function upsertCache(name: string, result: AgentResult): Promise<void> {
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
      result.latest_psf    || null,
      result.median_psf_12m || null,
      result.last_12m_tx_count,
      result.price_trend_label,
      result.liquidity_label,
      result.confidence,
      result.transaction_status,
      new Date().toISOString(),
    ],
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const v of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const) {
    if (!process.env[v]) { console.error(`✗ ${v} must be set`); process.exit(1); }
  }

  // Find which condos need checking
  const staleThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const skipClause = FORCE_ALL
    ? "1=1"
    : `(c.project_name IS NULL OR c.checked_at < '${staleThreshold}')`;

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
    process.stdout.write(`  ${pad}/${todo.length}  id=${String(id).padStart(5)}  ${name.padEnd(35)}`);

    try {
      const result = await researchCondo(name);
      await upsertCache(name, result);

      const label = result.transaction_status === "found"
        ? `✓ ${result.total_records}tx  PSF S$${result.latest_psf}  12m:${result.last_12m_tx_count}`
        : "— no data";
      process.stdout.write(`  ${label}\n`);

      if (result.transaction_status === "found") found++;
      else noData++;
    } catch (e) {
      process.stdout.write(`  ✗ ${e instanceof Error ? e.message.slice(0, 60) : e}\n`);
      errors++;
    }

    done++;
    await sleep(800); // rate limit between condos
  }

  // Final report
  const cacheStats = await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN transaction_status = 'found'   THEN 1 ELSE 0 END) as found,
      SUM(CASE WHEN transaction_status = 'no_data' THEN 1 ELSE 0 END) as no_data,
      SUM(CASE WHEN median_psf_12m > 0 THEN 1 ELSE 0 END) as has_psf,
      ROUND(AVG(CASE WHEN median_psf_12m > 0 THEN median_psf_12m END)) as avg_psf
    FROM private_project_tx_cache
  `);
  const s = cacheStats.rows[0];

  console.log(`\n══ TX Cache Seed Report ═══════════════════════════════════`);
  console.log(`  This run      : ${done} processed  (✓ ${found} found  — ${noData} no data  ✗ ${errors} errors)`);
  console.log(`  Cache total   : ${s.total} rows  (${s.found} with tx data, ${s.no_data} no data)`);
  console.log(`  Has PSF       : ${s.has_psf}  |  avg median PSF: S$${s.avg_psf ?? "—"}`);
  const unchecked = await db.execute(`
    SELECT COUNT(*) as n FROM private_property_master m
    LEFT JOIN private_project_tx_cache c ON UPPER(m.project_name)=UPPER(c.project_name)
    WHERE c.project_name IS NULL
  `);
  console.log(`  Still unchecked: ${unchecked.rows[0].n}`);
  console.log("\n✓ Done");
  db.close();
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
