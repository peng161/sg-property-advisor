/**
 * Fills in missing lease_commencement_year for all leasehold condos.
 * Targets rows where tenure is 99yr or 999yr but lease_commencement_year is NULL.
 *
 * Run:  npm run seed:lease-years
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

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

const BATCH = 30;
const currentYear = new Date().getFullYear();

async function getLeaseYears(
  items: { name: string; tenure: string }[]
): Promise<Record<string, number>> {
  const prompt =
    `You are a Singapore property expert. For each condominium or EC listed below,\n` +
    `provide the YEAR the land lease COMMENCED (started).\n\n` +
    `Rules:\n` +
    `- 99-year leasehold: lease starts 1–3 years before the project's TOP year.\n` +
    `  E.g. a condo that TOPped in 2015 → lease_commencement_year = 2013 or 2014.\n` +
    `  Era guide: topped ~2023 → ~2021, ~2018 → ~2016, ~2012 → ~2010, ~2005 → ~2003,\n` +
    `             ~2000 → ~1998, ~1995 → ~1993, ~1990 → ~1988, ~1985 → ~1983.\n` +
    `- 999-year leasehold: lease was granted in the colonial era, usually 1841, 1866,\n` +
    `  1886, or 1900. West Coast / Clementi / Pasir Panjang land is commonly 1841.\n` +
    `  Ang Mo Kio / Bishan / Toa Payoh 999yr land is often 1866 or 1886.\n\n` +
    `CRITICAL: You MUST return a year for every single project.\n` +
    `NEVER return null — even if unsure, give your best estimate.\n` +
    `If you have no information, use the era guide above to estimate.\n\n` +
    `Return ONLY a JSON object: { "ProjectName": year, ... }  (year is an integer)\n` +
    `No extra text, no markdown.\n\n` +
    `Projects (format: "Name [tenure]"):\n` +
    items.map((it, i) => `${i + 1}. ${it.name} [${it.tenure}]`).join("\n");

  const resp = await anthropic.messages.create({
    model:      "claude-opus-4-7",
    max_tokens: 2048,
    messages:   [{ role: "user", content: prompt }],
  });

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
  } catch {
    return {};
  }
}

async function main() {
  for (const v of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const) {
    if (!process.env[v]) { console.error(`✗ ${v} must be set`); process.exit(1); }
  }

  const res = await db.execute(
    `SELECT id, project_name, tenure FROM private_property_master
     WHERE tenure IN ('99-year leasehold', '999-year leasehold')
       AND lease_commencement_year IS NULL
     ORDER BY project_name`
  );
  const todo = res.rows.map((r) => ({
    id:     Number(r.id),
    name:   String(r.project_name),
    tenure: String(r.tenure),
  }));
  console.log(`${todo.length} leasehold condos missing lease_commencement_year\n`);

  let done = 0;
  const totalBatches = Math.ceil(todo.length / BATCH);

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch    = todo.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;

    process.stdout.write(`  Batch ${String(batchNum).padStart(3)}/${totalBatches}: ${batch[0].name} … `);

    try {
      const result = await getLeaseYears(batch);

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
      process.stdout.write(`${updates.length} set${missed ? `, ${missed} missed` : ""}\n`);
    } catch (e) {
      process.stdout.write(`error: ${e instanceof Error ? e.message : e}\n`);
    }

    await sleep(600);
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
  console.log(`  Lease years set this run: ${done}`);
  console.log(`\n  Coverage by tenure type:`);
  distRes.rows.forEach((r) =>
    console.log(`    ${String(r.tenure).padEnd(24)} ${r.has_year}/${r.total} have lease year`)
  );
  console.log(`\n  Sample remaining leases:`);
  sampleRes.rows.forEach((r) =>
    console.log(`    ${String(r.project_name).padEnd(28)} ${String(r.tenure ?? "").padEnd(24)} ${r.lease_commencement_year ?? "—"} → ${r.remaining_lease ?? "n/a"} yrs`)
  );
  console.log("\n✓ Done");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
