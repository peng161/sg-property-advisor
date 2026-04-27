/**
 * Populates `tenure` and `lease_commencement_year` in private_property_master
 * using Claude's knowledge. Processes condos in batches of 30, skips any already set.
 *
 * Tenure values: "Freehold" | "999-year leasehold" | "99-year leasehold"
 * lease_commencement_year: the year the lease started (e.g. 2015 for Parc Riviera)
 *   → NULL for Freehold; for 999-year leasehold use the year the land was granted.
 *
 * Remaining lease is derived at query time:
 *   Freehold   → null
 *   999yr      → lease_commencement_year + 999 − currentYear
 *   99yr       → lease_commencement_year + 99  − currentYear
 *
 * Run:  npm run seed:tenure
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

interface CondoTenure {
  tenure: "Freehold" | "999-year leasehold" | "99-year leasehold";
  lease_commencement_year: number | null;
}

async function classifyBatch(names: string[]): Promise<Record<string, CondoTenure>> {
  const currentYear = new Date().getFullYear();
  const prompt =
    `For each Singapore private condominium or EC listed below, provide:\n` +
    `1. "tenure": exactly one of "Freehold", "999-year leasehold", "99-year leasehold"\n` +
    `2. "lease_commencement_year": the year the land/building lease started\n` +
    `   - Freehold → null\n` +
    `   - 999-year leasehold → year the 999-year lease was granted (often pre-1900s or early 1900s)\n` +
    `   - 99-year leasehold → year the lease commenced (typically close to TOP year)\n` +
    `   - If unsure of exact year, estimate as best you can.\n\n` +
    `Current year is ${currentYear}.\n` +
    `Return ONLY a JSON object mapping each project name to {tenure, lease_commencement_year}.\n` +
    `No extra text.\n\n` +
    `Projects:\n${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\n` +
    `Example:\n` +
    `{"Parc Riviera":{"tenure":"99-year leasehold","lease_commencement_year":2015},` +
    `"NEWest":{"tenure":"999-year leasehold","lease_commencement_year":1841},` +
    `"Meyer House":{"tenure":"Freehold","lease_commencement_year":null}}`;

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
    return JSON.parse(m[0]) as Record<string, CondoTenure>;
  } catch {
    return {};
  }
}

const VALID_TENURE = new Set<string>([
  "Freehold", "999-year leasehold", "99-year leasehold",
]);

async function main() {
  for (const v of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const) {
    if (!process.env[v]) { console.error(`✗ ${v} must be set`); process.exit(1); }
  }

  const res = await db.execute(
    "SELECT id, project_name FROM private_property_master WHERE tenure IS NULL ORDER BY project_name"
  );
  const todo = res.rows.map((r) => ({ id: Number(r.id), name: String(r.project_name) }));
  console.log(`${todo.length} condos need tenure + lease year\n`);

  let done = 0;
  const currentYear = new Date().getFullYear();

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch      = todo.slice(i, i + BATCH);
    const names      = batch.map((b) => b.name);
    const batchNum   = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(todo.length / BATCH);

    process.stdout.write(`  Batch ${String(batchNum).padStart(3)}/${totalBatches}: ${names[0]} … `);

    try {
      const result = await classifyBatch(names);

      const updates = batch.flatMap(({ id, name }) => {
        const entry =
          result[name] ??
          Object.entries(result).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

        if (!entry || !VALID_TENURE.has(entry.tenure)) return [];

        const leaseYear = entry.lease_commencement_year ?? null;
        return [{ id, tenure: entry.tenure, leaseYear }];
      });

      if (updates.length) {
        await db.batch(
          updates.map(({ id, tenure, leaseYear }) => ({
            sql:  "UPDATE private_property_master SET tenure = ?, lease_commencement_year = ? WHERE id = ?",
            args: [tenure, leaseYear, id],
          })) as Parameters<typeof db.batch>[0],
          "write",
        );
      }

      done += updates.length;
      const missed = batch.length - updates.length;
      process.stdout.write(`${updates.length} set${missed ? `, ${missed} defaulted` : ""}\n`);
    } catch (e) {
      process.stdout.write(`error: ${e instanceof Error ? e.message : e}\n`);
    }

    await sleep(600);
  }

  // Default remaining nulls to 99yr without a start year
  const defaultRes = await db.execute(
    "UPDATE private_property_master SET tenure = '99-year leasehold' WHERE tenure IS NULL"
  );

  // Report
  const distRes = await db.execute(
    "SELECT tenure, COUNT(*) as n FROM private_property_master GROUP BY tenure ORDER BY n DESC"
  );
  const leaseRes = await db.execute(
    "SELECT COUNT(*) as n FROM private_property_master WHERE lease_commencement_year IS NOT NULL"
  );

  console.log("\n══ Tenure Seed Report ════════════════════════════════════");
  console.log(`  Claude classified  : ${done}`);
  console.log(`  Defaulted to 99yr  : ${defaultRes.rowsAffected}`);
  console.log(`  With lease year    : ${Number(leaseRes.rows[0].n)}`);

  // Show a few sample remaining leases
  const sampleRes = await db.execute(`
    SELECT project_name, tenure, lease_commencement_year,
      CASE
        WHEN tenure = 'Freehold' THEN NULL
        WHEN tenure = '999-year leasehold' AND lease_commencement_year IS NOT NULL
          THEN lease_commencement_year + 999 - ${currentYear}
        WHEN tenure = '99-year leasehold' AND lease_commencement_year IS NOT NULL
          THEN lease_commencement_year + 99 - ${currentYear}
        ELSE NULL
      END AS remaining_lease
    FROM private_property_master
    WHERE project_name IN ('PARC RIVIERA','TWIN VEW','NEWest','Botannia','The Trilinq','Seahill')
      OR UPPER(project_name) IN ('PARC RIVIERA','TWIN VEW','NEWEST','BOTANNIA','THE TRILINQ','SEAHILL')
    LIMIT 10
  `);

  console.log("\n  Sample remaining leases:");
  sampleRes.rows.forEach((r) =>
    console.log(`    ${String(r.project_name).padEnd(28)} ${String(r.tenure).padEnd(24)} ${r.lease_commencement_year ?? "—"} → ${r.remaining_lease ?? "Freehold"} yrs`)
  );

  console.log("\n  Distribution:");
  distRes.rows.forEach((r) => console.log(`    ${String(r.tenure).padEnd(24)} ${r.n}`));
  console.log("\n✓ Done");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
