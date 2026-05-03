/**
 * Web-agent transaction researcher — uses Claude to scrape Singapore property
 * portals (EdgeProp, 99.co, SRX) instead of the CKAN API.
 *
 * Use this when CKAN returns 0 results (newer projects, name mismatches).
 *
 * Usage:
 *   npm run research:tx-web                        # defaults to "TWIN VEW"
 *   npm run research:tx-web -- "Parc Riviera"
 *   npm run research:tx-web -- "TWIN VEW" --save   # writes data/<slug>.json
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const args    = process.argv.slice(2);
const doSave  = args.includes("--save");
const nameArg = args.filter((a) => !a.startsWith("--")).join(" ").trim();
const PROJECT = nameArg || "TWIN VEW";

const slug = PROJECT.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── Web fetch helper ──────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-SG,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control":   "no-cache",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return `HTTP ${res.status} for ${url}`;
    const html = await res.text();
    // Strip scripts, styles, tags — keep visible text
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch (e) {
    return `Fetch error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "fetch_page",
    description:
      "Fetch a Singapore property portal page and return its visible text content. " +
      "Use this to get transaction history from EdgeProp, 99.co, SRX, or PropertyGuru. " +
      "Each page returns up to 6000 characters of text. Call multiple times with " +
      "different URLs if the first page is sparse or behind a login wall.",
    input_schema: {
      type: "object" as const,
      properties: {
        url:    { type: "string", description: "Full URL to fetch" },
        reason: { type: "string", description: "What transaction data you expect to find here" },
      },
      required: ["url", "reason"],
    },
  },
];

// ── Report types ──────────────────────────────────────────────────────────────

export interface TxRecord {
  date:         string;
  price_sgd:    number;
  area_sqft:    number;
  psf:          number;
  type_of_sale: string;
  floor_range:  string;
  room_type:    string;
}

export interface TransactionReport {
  project_name:  string;
  total_records: number;
  date_range:    { earliest: string; latest: string };
  psf_stats:     { min: number; max: number; mean: number; median: number };
  transactions:  TxRecord[];
  trend_summary: string;
  insights:      string[];
  data_source:   string;
  fetched_at:    string;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

async function runAgent(): Promise<TransactionReport> {
  const client = new Anthropic();

  const system = `You are a Singapore real estate data analyst. Your job is to find past transaction records for a private condo by browsing property portals.

Strategy:
1. Try EdgeProp first — it has the most complete URA-sourced transaction history.
   URL pattern: https://www.edgeprop.sg/condo/<slug>/transactions
2. If EdgeProp is behind a login or returns nothing useful, try 99.co:
   URL pattern: https://www.99.co/singapore/condos-apartments/<slug>/past-transactions
3. Also try SRX: https://www.srx.com.sg/condominium/<slug>/past-transaction
4. Try up to 5 different URLs total to gather data.

Extract every transaction row you can find: date, price, area (sqft), PSF, floor, room type, sale type.
Compute PSF yourself if the page shows price + area but not PSF.

Return ONLY valid JSON — no prose, no markdown fences.`;

  const userMsg = `Find all available past transaction records for: "${PROJECT}"

Slug for URLs: "${slug}"

Start with: https://www.edgeprop.sg/condo/${slug}/transactions

After fetching pages, return EXACTLY this JSON (no other text):
{
  "project_name": "${PROJECT}",
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
      "floor_range": "<e.g. 06-10 or unknown>",
      "room_type": "<e.g. 3 Bedroom or unknown>"
    }
  ],
  "trend_summary": "<2-3 sentences on PSF trend over time>",
  "insights": [
    "<insight 1>",
    "<insight 2>",
    "<insight 3>"
  ],
  "data_source": "<which portal(s) had data>",
  "fetched_at": "${new Date().toISOString()}"
}

If no transaction records are found at all, still return the JSON with total_records: 0 and empty transactions array, but fill trend_summary and insights with whatever context you could gather (launch price, current asking price, development info).`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

  for (let round = 0; round < 12; round++) {
    const resp = await client.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 8192,
      thinking:   { type: "adaptive" },
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
        try { return JSON.parse(m[0]) as TransactionReport; } catch { /* fall through */ }
      }
      // Return whatever text Claude produced as the summary
      return {
        project_name:  PROJECT,
        total_records: 0,
        date_range:    { earliest: "—", latest: "—" },
        psf_stats:     { min: 0, max: 0, mean: 0, median: 0 },
        transactions:  [],
        trend_summary: text.trim().slice(0, 500),
        insights:      [],
        data_source:   "web (no structured data extracted)",
        fetched_at:    new Date().toISOString(),
      };
    }

    if (resp.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        const inp = block.input as { url: string; reason: string };
        process.stdout.write(`  [WEB] ${inp.url}\n`);
        const content = await fetchPage(inp.url);
        process.stdout.write(`        → ${content.length} chars\n`);
        results.push({ type: "tool_result", tool_use_id: block.id, content });
      }
      messages.push({ role: "user", content: results });
    }
  }

  return {
    project_name:  PROJECT,
    total_records: 0,
    date_range:    { earliest: "—", latest: "—" },
    psf_stats:     { min: 0, max: 0, mean: 0, median: 0 },
    transactions:  [],
    trend_summary: "Agent did not return a structured result.",
    insights:      [],
    data_source:   "—",
    fetched_at:    new Date().toISOString(),
  };
}

// ── Printer ───────────────────────────────────────────────────────────────────

function printReport(r: TransactionReport) {
  const hr = "─".repeat(70);
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${r.project_name} — Transaction History (web-scraped)`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  Records      : ${r.total_records}`);
  console.log(`  Date range   : ${r.date_range.earliest} → ${r.date_range.latest}`);
  if (r.psf_stats.median > 0) {
    console.log(`  PSF range    : S$${r.psf_stats.min} – S$${r.psf_stats.max}`);
    console.log(`  PSF median   : S$${r.psf_stats.median}  |  mean: S$${r.psf_stats.mean}`);
  }
  console.log(hr);

  if (r.transactions.length) {
    console.log("  Date      Price (S$)  Area(sqft)  PSF    Sale Type     Floor       Rooms");
    console.log(hr);
    r.transactions.slice(0, 50).forEach((t) => {
      console.log(
        `  ${t.date}  ` +
        `${String(t.price_sgd.toLocaleString()).padStart(10)}  ` +
        `${String(t.area_sqft).padStart(10)}  ` +
        `${String(t.psf).padStart(5)}  ` +
        `${t.type_of_sale.padEnd(12)}  ` +
        `${t.floor_range.padEnd(10)}  ${t.room_type}`
      );
    });
    if (r.transactions.length > 50) {
      console.log(`  … and ${r.transactions.length - 50} more (see saved JSON)`);
    }
  } else {
    console.log("  No individual transaction rows extracted.");
  }

  console.log(hr);
  console.log(`\n  Trend: ${r.trend_summary}`);
  if (r.insights.length) {
    console.log("\n  Insights:");
    r.insights.forEach((i) => console.log(`    • ${i}`));
  }
  console.log(`\n  Source  : ${r.data_source}`);
  console.log(`  Fetched : ${r.fetched_at}`);
  console.log("═".repeat(70) + "\n");
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("✗ ANTHROPIC_API_KEY must be set"); process.exit(1);
  }
  console.log(`\nResearching (web agent): "${PROJECT}"\n`);

  const report = await runAgent();
  printReport(report);

  if (doSave) {
    const outDir = join(process.cwd(), "data");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${slug}-transactions.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`Saved → ${outPath}\n`);
  }
}

main().catch((e) => { console.error("Agent failed:", e); process.exit(1); });
