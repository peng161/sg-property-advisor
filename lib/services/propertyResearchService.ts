// PSF research service.
// Primary: queries private_project_price_estimates (pre-seeded by npm run seed).
// Fallback: Claude agent fetches public portal pages, then saves result to DB.

import { getDb } from "@/lib/sqlite";
import { runPropertyResearchAgent, type ResearchResult } from "@/lib/agents/propertyResearchAgent";

export type { ResearchResult };

async function getFromDb(projectName: string): Promise<ResearchResult | null> {
  const db = getDb();
  if (!db) return null;
  try {
    // Exact match first, then fuzzy
    let res = await db.execute({
      sql: `SELECT * FROM private_project_price_estimates
            WHERE UPPER(project_name) = UPPER(?) AND unit_type = 'any' LIMIT 1`,
      args: [projectName],
    });
    if (!res.rows.length) {
      res = await db.execute({
        sql: `SELECT * FROM private_project_price_estimates
              WHERE UPPER(project_name) LIKE UPPER(?) AND unit_type = 'any'
              ORDER BY estimated_psf_mid DESC LIMIT 1`,
        args: [`%${projectName}%`],
      });
    }
    if (!res.rows.length) return null;

    const row = res.rows[0];
    return {
      project_name:       String(row.project_name),
      estimated_psf_low:  Number(row.estimated_psf_low),
      estimated_psf_mid:  Number(row.estimated_psf_mid),
      estimated_psf_high: Number(row.estimated_psf_high),
      confidence:         String(row.confidence) as "High" | "Medium" | "Low",
      price_basis:        String(row.price_basis),
      sources:            JSON.parse(String(row.sources_json || "[]")),
      notes:              JSON.parse(String(row.notes_json   || "[]")),
      checked_at:         String(row.checked_at),
    };
  } catch {
    return null;
  }
}

async function saveToDb(result: ResearchResult, unitType: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO private_project_price_estimates
              (project_name, unit_type, estimated_psf_low, estimated_psf_mid, estimated_psf_high,
               confidence, price_basis, sources_json, notes_json, checked_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        result.project_name, unitType,
        result.estimated_psf_low, result.estimated_psf_mid, result.estimated_psf_high,
        result.confidence, result.price_basis,
        JSON.stringify(result.sources), JSON.stringify(result.notes),
        result.checked_at, new Date().toISOString(),
      ],
    });
  } catch { /* non-fatal */ }
}

export async function getPropertyEstimate(
  projectName:  string,
  unitType:     string,
  targetPsf:    number,
  forceRefresh = false,
): Promise<ResearchResult> {
  if (!forceRefresh) {
    const seeded = await getFromDb(projectName);
    if (seeded) return seeded;
  }

  // Not in DB → run Claude agent (web research)
  const result = await runPropertyResearchAgent(projectName, unitType, targetPsf);
  await saveToDb(result, unitType);
  return result;
}
