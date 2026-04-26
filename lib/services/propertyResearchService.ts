// Caching layer for property PSF research.
// Checks Turso/SQLite for a cached estimate (7-day TTL) before calling the agent.

import { getDb } from "@/lib/sqlite";
import { runPropertyResearchAgent, type ResearchResult } from "@/lib/agents/propertyResearchAgent";

export type { ResearchResult };

const CACHE_TTL_DAYS = 7;

async function ensureTable(): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS private_project_price_estimates (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name       TEXT NOT NULL,
        unit_type          TEXT NOT NULL,
        estimated_psf_low  REAL,
        estimated_psf_mid  REAL,
        estimated_psf_high REAL,
        confidence         TEXT,
        price_basis        TEXT,
        sources_json       TEXT,
        notes_json         TEXT,
        checked_at         TEXT,
        created_at         TEXT,
        UNIQUE(project_name, unit_type)
      )
    `);
  } catch { /* table already exists or DB unavailable */ }
}

async function getCached(projectName: string, unitType: string): Promise<ResearchResult | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const res = await db.execute({
      sql: `SELECT * FROM private_project_price_estimates
            WHERE UPPER(project_name) = UPPER(?) AND LOWER(unit_type) = LOWER(?)
            LIMIT 1`,
      args: [projectName, unitType],
    });
    if (!res.rows.length) return null;

    const row     = res.rows[0];
    const ageMs   = Date.now() - new Date(String(row.checked_at)).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > CACHE_TTL_DAYS) return null;

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

async function saveCache(result: ResearchResult, unitType: string): Promise<void> {
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
  } catch { /* cache write failure is non-fatal */ }
}

export async function getPropertyEstimate(
  projectName:  string,
  unitType:     string,
  targetPsf:    number,
  forceRefresh = false,
): Promise<ResearchResult> {
  await ensureTable();

  if (!forceRefresh) {
    const cached = await getCached(projectName, unitType);
    if (cached) return cached;
  }

  const result = await runPropertyResearchAgent(projectName, unitType, targetPsf);
  await saveCache(result, unitType);
  return result;
}
