/**
 * Fills in lease_commencement_year for leasehold condos by looking up real data
 * from property portals (EdgeProp, 99.co) via a Claude web agent.
 *
 * Targets NULL lease years by default. Use --all to re-verify existing years.
 *
 * Run:
 *   npm run seed:lease-years            # fill NULLs only
 *   npm run seed:lease-years -- --all   # re-verify all leasehold condos
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

const FORCE_ALL   = process.argv.includes("--all");
const BATCH       = 8;   // smaller batches — each condo may need 1–2 web fetches
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
      signal: AbortSignal.timeout(15_000),
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
      .slice(0, 5000);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Tool definition ───────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "fetch_page",
    description:
      "Fetch a Singapore property portal page. Use EdgeProp as primary source — " +
      "it shows 'Tenure: 99-year leasehold from XXXX' on every condo overview page. " +
      "URL patterns to try in order:\n" +
      "  1. https://www.edgeprop.sg/condo-apartment/<slug>\n" +
      "  2. https://www.edgeprop.sg/condo/<slug>\n" +
      "  3. https://www.99.co/singapore/condos-apartments/<slug>\n" +
      "where <slug> is the project name lowercased with spaces replaced by hyphens.",
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

// ── Web agent: look up lease years for one batch ──────────────────────────────

async function getLeaseYearsFromWeb(
  items: { name: string; tenure: string }[],
): Promise<Record<string, number>> {
  const itemList = items
    .map((it, i) => `${i + 1}. "${it.name}" [${it.tenure}] → slug: "${toSlug(it.name)}"`)
    .join("\n");

  const system =
    `You are looking up lease commencement years for Singapore condos from property portals.\n` +
    `EdgeProp pages show "Tenure: 99-year leasehold from YYYY" — that YYYY is what you need.\n` +
    `For 999-year leaseholds: use colonial-era land grant year (1841, 1866, 1886, or 1900).\n` +
    `  West Coast/Clementi/Pasir Panjang: usually 1841.\n` +
    `  Bishan/AMK/Toa Payoh: usually 1866 or 1886.\n` +
    `Fetch the EdgeProp overview page for each condo. If it fails, try the alternate URL.\n` +
    `You MUST provide a year for every condo — never omit one.\n` +
    `Return ONLY a JSON object: { "Project Name": year }  No prose, no markdown.`;

  const userMsg =
    `Find the lease commencement year for each of these condos:\n\n` +
    itemList + `\n\n` +
    `For each, fetch https://www.edgeprop.sg/condo-apartment/<slug> and look for the year ` +
    `after "leasehold from" in the tenure section. If the page errors, try ` +
    `https://www.edgeprop.sg/condo/<slug>. Return JSON: { "Name": year, ... }`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

  for (let round = 0; round < 20; round++) {
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
      if (!m) return {};
      try {
        const raw = JSON.parse(m[0]) as Record<string, unknown>;
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw)) {
          const yr = Number(v);
          if (yr >= 1800 && yr <= currentYear) out[k] = yr;
        }
        return out;
      } catch { return {}; }
    }

    if (resp.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        const inp = block.input as { url: string; reason: string };
        process.stdout.write(`\n      ↳ ${inp.url}`);
        const content = await fetchPage(inp.url);
        process.stdout.write(` (${content.length}c)`);
        results.push({ type: "tool_result", tool_use_id: block.id, content });
      }
      messages.push({ role: "user", content: results });
    }
  }

  return {};
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const v of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const) {
    if (!process.env[v]) { console.error(`✗ ${v} must be set`); process.exit(1); }
  }

  const whereClause = FORCE_ALL
    ? `WHERE tenure IN ('99-year leasehold', '999-year leasehold')`
    : `WHERE tenure IN ('99-year leasehold', '999-year leasehold') AND lease_commencement_year IS NULL`;

  const res = await db.execute(
    `SELECT id, project_name, tenure FROM private_property_master ${whereClause} ORDER BY project_name`
  );
  const todo = res.rows.map((r) => ({ id: Number(r.id), name: String(r.project_name), tenure: String(r.tenure) }));

  const mode = FORCE_ALL ? "re-verifying all" : "filling NULLs for";
  console.log(`\n${mode} ${todo.length} leasehold condos (batch=${BATCH})\n`);

  let done = 0;
  const totalBatches = Math.ceil(todo.length / BATCH);

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch    = todo.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;

    process.stdout.write(`  Batch ${String(batchNum).padStart(3)}/${totalBatches}: ${batch.map(b => b.name).join(", ")} …`);

    try {
      const result = await getLeaseYearsFromWeb(batch);

      const updates = batch.flatMap(({ id, name }) => {
        const yr =
          result[name] ??
          Object.entries(result).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
        if (!yr) return [];
        return [{ id, yr }];
      });

      if (updates.length) {
        await db.batch(
          updates.map(({ id, yr }) => ({
            sql:  "UPDATE private_property_master SET lease_commencement_year = ? WHERE id = ?",
            args: [yr, id],
          })) as Parameters<typeof db.batch>[0],
          "write",
        );
      }

      done += updates.length;
      const missed = batch.length - updates.length;
      process.stdout.write(`\n  → ${updates.length} set${missed ? `, ${missed} missed` : ""}\n`);
    } catch (e) {
      process.stdout.write(`\n  → error: ${e instanceof Error ? e.message : e}\n`);
    }

    await sleep(500);
  }

  // Final report
  const distRes = await db.execute(
    `SELECT tenure, COUNT(*) as total,
       SUM(CASE WHEN lease_commencement_year IS NOT NULL THEN 1 ELSE 0 END) as has_year
     FROM private_property_master GROUP BY tenure ORDER BY total DESC`
  );
  const sampleRes = await db.execute(`
    SELECT project_name, tenure, lease_commencement_year,
      CASE
        WHEN tenure = '999-year leasehold' AND lease_commencement_year IS NOT NULL
          THEN lease_commencement_year + 999 - ${currentYear}
        WHEN tenure = '99-year leasehold' AND lease_commencement_year IS NOT NULL
          THEN lease_commencement_year + 99 - ${currentYear}
      END AS remaining_lease
    FROM private_property_master
    WHERE UPPER(project_name) IN (
      'PARC RIVIERA','TWIN VEW','NEWEST','HUNDRED TREES','BOTANNIA',
      'THE TRILINQ','SEAHILL','FLORAVALE','THE INTERLACE','D LEEDON'
    )
    LIMIT 10
  `);

  console.log(`\n══ Lease Year Seed Report ══════════════════════════════════`);
  console.log(`  Set this run   : ${done}`);
  console.log(`\n  Coverage by tenure:`);
  distRes.rows.forEach((r) =>
    console.log(`    ${String(r.tenure).padEnd(24)} ${r.has_year}/${r.total} have lease year`)
  );
  console.log(`\n  Sample remaining leases:`);
  sampleRes.rows.forEach((r) =>
    console.log(`    ${String(r.project_name).padEnd(28)} ${r.lease_commencement_year ?? "—"} → ${r.remaining_lease ?? "n/a"} yrs`)
  );
  console.log("\n✓ Done");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
