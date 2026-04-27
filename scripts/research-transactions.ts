/**
 * Transaction research agent — fetches full past transaction history for a
 * Singapore private condo from data.gov.sg (URA REALIS) and produces a
 * structured report via Claude.
 *
 * Usage:
 *   npm run research:tx                        # defaults to "Parc Riviera"
 *   npm run research:tx -- "Normanton Park"
 *   npm run research:tx -- "Parc Riviera" --save   # also writes data/<slug>.json
 *
 * Env vars (optional):
 *   ANTHROPIC_API_KEY   — defaults to key already in env / .env.local
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const doSave  = args.includes("--save");
const nameArg = args.filter((a) => !a.startsWith("--")).join(" ").trim();
const PROJECT = nameArg || "Parc Riviera";

// ── CKAN (data.gov.sg URA REALIS private residential transactions) ─────────────

const CKAN_BASE   = "https://data.gov.sg/api/action/datastore_search";
const RESOURCE_ID = "42ff9c2b-3a03-4c8c-9e4c-9e7f5c1b0cbb";
const PSM_TO_PSF  = 1 / 10.7639;

interface CkanRecord {
  project_name?:      string;
  street_name?:       string;
  transaction_date?:  string;
  transaction_price?: string | number;
  area_sqm?:          string | number;
  type_of_sale?:      string;
  type_of_area?:      string;
  property_type?:     string;
  district?:          string;
  tenure?:            string;
  type_of_room?:      string;
  floor_range?:       string;
  level_or_unit?:     string;
  [k: string]: unknown;
}

interface FetchResult {
  records:    CkanRecord[];
  total:      number;
  name_used:  string;
  error?:     string;
}

async function fetchCkanTransactions(
  projectName: string,
  offset = 0,
  limit  = 500,
): Promise<FetchResult> {
  const nameVariants = [
    projectName,
    projectName.toUpperCase(),
    projectName.toUpperCase().replace(/\s+/g, " ").trim(),
  ];

  for (const name of nameVariants) {
    const filters = encodeURIComponent(JSON.stringify({ project_name: name }));
    const url =
      `${CKAN_BASE}?resource_id=${RESOURCE_ID}` +
      `&filters=${filters}&limit=${limit}&offset=${offset}` +
      `&sort=transaction_date%20desc`;

    try {
      const res  = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "sg-property-advisor/1.0" },
        signal:  AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return { records: [], total: 0, name_used: name, error: `HTTP ${res.status}` };
      }

      const json = (await res.json()) as {
        result?: { records?: CkanRecord[]; total?: number };
        success?: boolean;
      };

      const records = json.result?.records ?? [];
      const total   = json.result?.total   ?? records.length;

      if (records.length > 0) return { records, total, name_used: name };
    } catch (e) {
      return { records: [], total: 0, name_used: name, error: String(e) };
    }
  }

  return { records: [], total: 0, name_used: projectName };
}

// ── Web page fetch (supplemental) ─────────────────────────────────────────────

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept:       "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-SG,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return `HTTP ${res.status} for ${url}`;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
  } catch (e) {
    return `Fetch error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Claude tool definitions ───────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "fetch_ckan_transactions",
    description:
      "Fetch past private property transaction records from data.gov.sg (URA REALIS dataset). " +
      "Returns raw transaction rows with date, price, area_sqm, type_of_sale, floor_range etc. " +
      "Tries exact name then uppercase variant automatically. " +
      "Call with offset=500 to get more pages if total > 500.",
    input_schema: {
      type:       "object" as const,
      properties: {
        project_name: { type: "string", description: "Condo project name to look up" },
        offset:       { type: "number", description: "Pagination offset (default 0)" },
        limit:        { type: "number", description: "Max records per call (default 500, max 500)" },
      },
      required: ["project_name"],
    },
  },
  {
    name: "fetch_page",
    description:
      "Fetch a public property portal page for supplemental transaction or pricing data. " +
      "Only use if CKAN returned no results or you need recent listings context.",
    input_schema: {
      type:       "object" as const,
      properties: {
        url:    { type: "string", description: "Full URL to fetch" },
        reason: { type: "string", description: "What you expect to find" },
      },
      required: ["url", "reason"],
    },
  },
];

// ── Report types ──────────────────────────────────────────────────────────────

export interface TxRecord {
  date:         string;  // "YYYY-MM"
  price_sgd:    number;
  area_sqft:    number;
  psf:          number;
  type_of_sale: string;
  floor_range:  string;
  room_type:    string;
}

export interface TransactionReport {
  project_name:    string;
  name_used_in_db: string;
  total_records:   number;
  date_range:      { earliest: string; latest: string };
  psf_stats: {
    min:    number;
    max:    number;
    mean:   number;
    median: number;
  };
  transactions:     TxRecord[];
  trend_summary:    string;
  insights:         string[];
  data_source:      string;
  fetched_at:       string;
}

// ── Main agent ────────────────────────────────────────────────────────────────

async function runAgent(): Promise<TransactionReport> {
  const client = new Anthropic();

  const slug = PROJECT.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const systemPrompt = `You are a Singapore real estate data analyst. Your task is to fetch and analyze the full past transaction history for a private condo project using the tools provided.

Process:
1. Call fetch_ckan_transactions for the project name. If total > 500, call again with offset=500, etc.
2. If CKAN returns 0 records, try alternative spellings (e.g. drop "The", try short form).
3. Optionally call fetch_page (once) for recent context if CKAN data is sparse.
4. After collecting data, return ONLY a JSON object — no other text.

PSF calculation: psf = (transaction_price_sgd / area_sqm) / 10.7639 (sqm→sqft)
Round PSF to nearest integer.`;

  const userMsg = `Fetch and analyze ALL past transaction history for: "${PROJECT}"

Suggested fallback portal page if needed: https://www.edgeprop.sg/condo/${slug}/transactions

After fetching all available data, return EXACTLY this JSON (no other text):
{
  "project_name": "${PROJECT}",
  "name_used_in_db": "<exact name string that returned results>",
  "total_records": <integer>,
  "date_range": { "earliest": "YYYY-MM", "latest": "YYYY-MM" },
  "psf_stats": { "min": <int>, "max": <int>, "mean": <int>, "median": <int> },
  "transactions": [
    {
      "date": "YYYY-MM",
      "price_sgd": <integer>,
      "area_sqft": <integer>,
      "psf": <integer>,
      "type_of_sale": "<New Sale|Sub Sale|Resale>",
      "floor_range": "<e.g. 01-05 or unknown>",
      "room_type": "<e.g. 3-Room or unknown>"
    }
    // include ALL records, sorted by date desc
  ],
  "trend_summary": "<2-3 sentences describing the PSF trend over time>",
  "insights": [
    "<insight about new sale vs resale split>",
    "<insight about high/low floor PSF premium if data shows it>",
    "<insight about volume trend or notable price movements>"
  ],
  "data_source": "data.gov.sg URA REALIS",
  "fetched_at": "<ISO timestamp>"
}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

  let allRecords: CkanRecord[] = [];
  let nameUsed   = PROJECT;

  for (let round = 0; round < 10; round++) {
    const resp = await client.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 8192,
      thinking:   { type: "adaptive" },
      system:     systemPrompt,
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
          return JSON.parse(m[0]) as TransactionReport;
        } catch {
          // fall through to default
        }
      }
      break;
    }

    if (resp.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;

        let content = "";

        if (block.name === "fetch_ckan_transactions") {
          const inp    = block.input as { project_name: string; offset?: number; limit?: number };
          const result = await fetchCkanTransactions(
            inp.project_name,
            inp.offset  ?? 0,
            Math.min(inp.limit ?? 500, 500),
          );
          if (result.name_used !== PROJECT && result.records.length > 0) nameUsed = result.name_used;
          allRecords.push(...result.records);
          content = JSON.stringify({
            name_used:      result.name_used,
            total_in_db:    result.total,
            records_in_page: result.records.length,
            error:          result.error,
            records:        result.records,
          });
          process.stdout.write(
            `  [CKAN] "${result.name_used}" — ${result.records.length} records ` +
            `(total: ${result.total})\n`,
          );
        }

        if (block.name === "fetch_page") {
          const inp = block.input as { url: string; reason: string };
          process.stdout.write(`  [WEB] ${inp.url}\n`);
          content = await fetchPage(inp.url);
        }

        results.push({ type: "tool_result", tool_use_id: block.id, content });
      }

      messages.push({ role: "user", content: results });
    }
  }

  // Fallback: build report directly from accumulated raw records if Claude didn't return JSON
  const psfList = allRecords
    .filter((r) => Number(r.transaction_price) > 0 && Number(r.area_sqm) > 0)
    .map((r) => ({
      date:         String(r.transaction_date ?? "").slice(0, 7),
      price_sgd:    Number(r.transaction_price),
      area_sqft:    Math.round(Number(r.area_sqm) * 10.7639),
      psf:          Math.round((Number(r.transaction_price) / Number(r.area_sqm)) * PSM_TO_PSF),
      type_of_sale: String(r.type_of_sale ?? ""),
      floor_range:  String(r.floor_range ?? r.level_or_unit ?? "unknown"),
      room_type:    String(r.type_of_room ?? "unknown"),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const psfValues = psfList.map((r) => r.psf).filter(Boolean).sort((a, b) => a - b);
  const mid = Math.floor(psfValues.length / 2);
  const median = psfValues.length
    ? psfValues.length % 2 === 1
      ? psfValues[mid]
      : Math.round((psfValues[mid - 1] + psfValues[mid]) / 2)
    : 0;

  return {
    project_name:    PROJECT,
    name_used_in_db: nameUsed,
    total_records:   psfList.length,
    date_range: {
      earliest: psfList[psfList.length - 1]?.date ?? "—",
      latest:   psfList[0]?.date ?? "—",
    },
    psf_stats: {
      min:    psfValues[0] ?? 0,
      max:    psfValues[psfValues.length - 1] ?? 0,
      mean:   psfValues.length ? Math.round(psfValues.reduce((s, v) => s + v, 0) / psfValues.length) : 0,
      median,
    },
    transactions:  psfList,
    trend_summary: "See raw transactions above.",
    insights:      [],
    data_source:   "data.gov.sg URA REALIS (fallback — Claude did not return JSON)",
    fetched_at:    new Date().toISOString(),
  };
}

// ── Console report printer ────────────────────────────────────────────────────

function printReport(r: TransactionReport) {
  const hr = "─".repeat(70);
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Transaction History: ${r.project_name}`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  DB name used : ${r.name_used_in_db}`);
  console.log(`  Records      : ${r.total_records}`);
  console.log(`  Date range   : ${r.date_range.earliest} → ${r.date_range.latest}`);
  console.log(`  PSF range    : S$${r.psf_stats.min} – S$${r.psf_stats.max}`);
  console.log(`  PSF median   : S$${r.psf_stats.median}  |  mean: S$${r.psf_stats.mean}`);
  console.log(hr);

  if (r.transactions.length) {
    console.log(
      "  Date      Price (S$)  Area(sqft)  PSF    Sale Type     Floor       Rooms"
    );
    console.log(hr);
    const show = r.transactions.slice(0, 50);
    for (const t of show) {
      console.log(
        `  ${t.date}  ` +
        `${String(t.price_sgd.toLocaleString()).padStart(10)}  ` +
        `${String(t.area_sqft).padStart(10)}  ` +
        `${String(t.psf).padStart(5)}  ` +
        `${t.type_of_sale.padEnd(12)}  ` +
        `${t.floor_range.padEnd(10)}  ` +
        `${t.room_type}`
      );
    }
    if (r.transactions.length > 50) {
      console.log(`  … and ${r.transactions.length - 50} more (see saved JSON)`);
    }
  } else {
    console.log("  No transaction records found.");
  }

  console.log(hr);
  console.log(`\n  Trend: ${r.trend_summary}`);

  if (r.insights.length) {
    console.log("\n  Insights:");
    for (const ins of r.insights) console.log(`    • ${ins}`);
  }

  console.log(`\n  Source   : ${r.data_source}`);
  console.log(`  Fetched  : ${r.fetched_at}`);
  console.log("═".repeat(70) + "\n");
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("✗ ANTHROPIC_API_KEY must be set (in .env.local or environment)");
    process.exit(1);
  }

  console.log(`\nResearching transaction history for: "${PROJECT}"\n`);

  const report = await runAgent();
  printReport(report);

  if (doSave) {
    const outDir = join(process.cwd(), "data");
    mkdirSync(outDir, { recursive: true });
    const slug = PROJECT.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const outPath = join(outDir, `${slug}-transactions.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`Saved → ${outPath}\n`);
  }
}

main().catch((e) => { console.error("Agent failed:", e); process.exit(1); });
