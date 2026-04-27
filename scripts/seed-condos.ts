/**
 * Seed script — full refresh of private condo / EC data from OneMap.
 *
 * Run: npm run seed:condos
 *
 * IMPORTANT: This script DROPS and recreates both tables on every run.
 * Use `npm run discover` to add new condos without wiping existing data.
 *
 * Required env vars (in .env.local):
 *   TURSO_DATABASE_URL   — libsql://... URL from Turso dashboard
 *   TURSO_AUTH_TOKEN     — Turso auth token
 *
 * Writes to:
 *   private_property_master     — confidence_score >= 4  (used by the app)
 *   private_property_candidates — confidence_score 2–3   (needs manual review)
 *
 * Master records are merged per project_name (centroid of all blocks).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { classify } from "../lib/property-classifier";
import type { Classified, Bucket } from "../lib/property-classifier";

// ── DB ────────────────────────────────────────────────────────────────────────

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// ── Search keywords ───────────────────────────────────────────────────────────

const SEARCH_KEYWORDS = [
  "executive condominium", "condominium", "residences", "residence",
  "apartments", "suites", "estate",
  "the", "park", "parc", "view", "trees", "tree", "heights", "hill",
  "crest", "green", "gardens", "valley", "bay", "shore", "towers",
  "grove", "loft", "casa", "court", "point", "place", "mansion",
] as const;

const CHUNK = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

interface OneMapResult {
  BUILDING:   string;
  SEARCHVAL:  string;
  ADDRESS:    string;
  POSTAL:     string;
  LATITUDE:   string;
  LONGITUDE:  string;
  LONGTITUDE: string;
}

interface SeedRecord {
  project_name:     string;
  property_type:    "Condo" | "EC";
  address:          string;
  postal_code:      string;
  lat:              number;
  lng:              number;
  confidence_score: number;
  source_keyword:   string;
  reason:           string;
}

interface MergedMasterRecord {
  project_name:     string;
  property_type:    "Condo" | "EC";
  address:          string;
  postal_codes:     string; // JSON array
  block_count:      number;
  lat:              number;
  lng:              number;
  confidence_score: number;
  source_keyword:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function normalize(name: string): string {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
}

// ── Table setup (fresh every seed run) ───────────────────────────────────────

async function createTables() {
  // Full refresh — drop and recreate both tables
  await db.execute("DROP TABLE IF EXISTS private_property_master");
  await db.execute("DROP TABLE IF EXISTS private_property_candidates");

  await db.execute(`
    CREATE TABLE private_property_master (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name     TEXT    NOT NULL UNIQUE,
      property_type    TEXT    NOT NULL DEFAULT 'Condo',
      address          TEXT,
      postal_codes     TEXT    NOT NULL DEFAULT '[]',
      block_count      INTEGER NOT NULL DEFAULT 1,
      lat              REAL    NOT NULL,
      lng              REAL    NOT NULL,
      confidence_score INTEGER NOT NULL,
      source_keyword   TEXT,
      seeded_at        TEXT    NOT NULL
    )
  `);
  await db.execute("CREATE INDEX idx_ppm_loc ON private_property_master(lat, lng)");

  await db.execute(`
    CREATE TABLE private_property_candidates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name     TEXT    NOT NULL UNIQUE,
      property_type    TEXT    NOT NULL DEFAULT 'Condo',
      address          TEXT,
      postal_codes     TEXT    NOT NULL DEFAULT '[]',
      block_count      INTEGER NOT NULL DEFAULT 1,
      lat              REAL    NOT NULL,
      lng              REAL    NOT NULL,
      confidence_score INTEGER NOT NULL,
      reason           TEXT,
      source_keyword   TEXT,
      seeded_at        TEXT    NOT NULL
    )
  `);
  await db.execute("CREATE INDEX idx_ppc_loc ON private_property_candidates(lat, lng)");
}

// ── OneMap fetch ──────────────────────────────────────────────────────────────

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";
const MAX_PAGES     = 80;
const PAGE_DELAY    = 120;

async function fetchKeyword(
  keyword: string,
  token:   string,
): Promise<{ masters: SeedRecord[]; candidates: SeedRecord[]; totalRaw: number; rejected: number }> {
  const masters:    SeedRecord[] = [];
  const candidates: SeedRecord[] = [];
  let totalRaw = 0;
  let rejected = 0;

  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(keyword)}` +
      `&returnGeom=Y&getAddrDetails=Y&pageNum=${page}`;

    let data: { totalNumPages?: number; results?: OneMapResult[] };
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { process.stdout.write(`\n  ⚠ HTTP ${res.status} on page ${page}`); break; }
      data = await res.json() as typeof data;
    } catch {
      process.stdout.write(`\n  ⚠ fetch error on page ${page}`);
      break;
    }

    const pageResults = data.results ?? [];
    const totalPages  = data.totalNumPages ?? 1;
    totalRaw += pageResults.length;

    for (const r of pageResults) {
      const lat = Number(r.LATITUDE);
      const lng = Number(r.LONGITUDE || r.LONGTITUDE);
      if (!lat || !lng) { rejected++; continue; }

      const building  = (r.BUILDING  || "").trim();
      const searchval = (r.SEARCHVAL || "").trim();
      const address   = (r.ADDRESS   || "").trim();
      const postal    = (r.POSTAL    || "").replace(/\D/g, "");

      const c = classify(building, searchval, address, postal, lat, lng);
      if (c.bucket === "reject") { rejected++; continue; }

      const record: SeedRecord = {
        project_name:     c.projectName,
        property_type:    c.propertyType,
        address,
        postal_code:      postal,
        lat,
        lng,
        confidence_score: c.score,
        source_keyword:   keyword,
        reason:           c.reason,
      };

      if (c.bucket === "master") masters.push(record);
      else                       candidates.push(record);
    }

    process.stdout.write(
      `\r  [${keyword}] page ${page}/${totalPages} — raw:${totalRaw} master:${masters.length} cand:${candidates.length} rej:${rejected}    `
    );

    if (!pageResults.length || page >= totalPages) break;
    await sleep(PAGE_DELAY);
  }

  process.stdout.write("\n");
  return { masters, candidates, totalRaw, rejected };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error("✗ TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env.local");
    process.exit(1);
  }

  console.log(`Connecting to Turso: ${process.env.TURSO_DATABASE_URL}\n`);
  await createTables();
  console.log("Tables ready.\n");

  const token = process.env.ONEMAP_TOKEN ?? "";
  if (!token) console.warn("⚠  ONEMAP_TOKEN not set — unauthenticated (may hit rate limits)\n");

  const seededAt      = new Date().toISOString();
  const allMasters:    SeedRecord[] = [];
  const allCandidates: SeedRecord[] = [];
  let grandTotalRaw  = 0;
  let grandRejected  = 0;

  for (const keyword of SEARCH_KEYWORDS) {
    console.log(`\n▸ Keyword: "${keyword}"`);
    const { masters, candidates, totalRaw, rejected } = await fetchKeyword(keyword, token);
    allMasters.push(...masters);
    allCandidates.push(...candidates);
    grandTotalRaw += totalRaw;
    grandRejected += rejected;
    console.log(`  ✓ "${keyword}": ${masters.length} master, ${candidates.length} cand, ${rejected} rejected of ${totalRaw} raw`);
  }

  // ── Deduplicate per-block ─────────────────────────────────────────────────

  console.log("\nDeduplicating…");

  const masterMap = new Map<string, SeedRecord>();
  for (const r of allMasters) {
    const key = `${normalize(r.project_name)}|${r.postal_code}`;
    const ex  = masterMap.get(key);
    if (!ex || r.confidence_score > ex.confidence_score) masterMap.set(key, r);
  }
  const dedupedMasters = [...masterMap.values()];

  // For candidates: exclude by project_name (not postal_code) — if any block
  // of the project is in master, all blocks belong to master.
  const masterProjectNames = new Set(
    [...masterMap.keys()].map((k) => k.split("|")[0]),
  );
  const candidateMap = new Map<string, SeedRecord>();
  for (const r of allCandidates) {
    if (masterProjectNames.has(normalize(r.project_name))) continue;
    const key = `${normalize(r.project_name)}|${r.postal_code}`;
    if (!candidateMap.has(key)) candidateMap.set(key, r);
  }
  const dedupedCandidates = [...candidateMap.values()];

  // ── Merge masters by project_name (centroid of all blocks) ────────────────

  const projectGroupMap = new Map<string, SeedRecord[]>();
  for (const r of dedupedMasters) {
    const key = normalize(r.project_name);
    if (!projectGroupMap.has(key)) projectGroupMap.set(key, []);
    projectGroupMap.get(key)!.push(r);
  }

  const mergedMasters: MergedMasterRecord[] = [...projectGroupMap.values()].map((records) => {
    const best = records.reduce((b, r) => r.confidence_score > b.confidence_score ? r : b, records[0]);
    const lat  = records.reduce((s, r) => s + r.lat, 0) / records.length;
    const lng  = records.reduce((s, r) => s + r.lng, 0) / records.length;
    const postalCodes = [...new Set(records.map((r) => r.postal_code).filter(Boolean))];
    return {
      project_name:     best.project_name,
      property_type:    best.property_type,
      address:          best.address,
      postal_codes:     JSON.stringify(postalCodes),
      block_count:      records.length,
      lat,
      lng,
      confidence_score: best.confidence_score,
      source_keyword:   best.source_keyword,
    };
  });

  // ── Write masters ─────────────────────────────────────────────────────────

  console.log(`\nWriting ${mergedMasters.length} merged master projects to Turso…`);
  const masterRows = mergedMasters.map((r) => ({
    sql: `INSERT INTO private_property_master
            (project_name, property_type, address, postal_codes, block_count,
             lat, lng, confidence_score, source_keyword, seeded_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [r.project_name, r.property_type, r.address, r.postal_codes, r.block_count,
           r.lat, r.lng, r.confidence_score, r.source_keyword, seededAt],
  }));

  let written = 0;
  for (let i = 0; i < masterRows.length; i += CHUNK) {
    await db.batch(masterRows.slice(i, i + CHUNK), "write");
    written += Math.min(CHUNK, masterRows.length - i);
    process.stdout.write(`\r  Masters written: ${written}/${masterRows.length}`);
  }
  process.stdout.write("\n");

  // ── Merge candidates by project_name (same pattern as masters) ────────────

  const candidateGroupMap = new Map<string, SeedRecord[]>();
  for (const r of dedupedCandidates) {
    if (masterProjectNames.has(normalize(r.project_name))) continue;
    const key = normalize(r.project_name);
    if (!candidateGroupMap.has(key)) candidateGroupMap.set(key, []);
    candidateGroupMap.get(key)!.push(r);
  }

  const mergedCandidates: MergedMasterRecord[] = [...candidateGroupMap.values()].map((records) => {
    const best = records.reduce((b, r) => r.confidence_score > b.confidence_score ? r : b, records[0]);
    const lat  = records.reduce((s, r) => s + r.lat, 0) / records.length;
    const lng  = records.reduce((s, r) => s + r.lng, 0) / records.length;
    const postalCodes = [...new Set(records.map((r) => r.postal_code).filter(Boolean))];
    return {
      project_name:     best.project_name,
      property_type:    best.property_type,
      address:          best.address,
      postal_codes:     JSON.stringify(postalCodes),
      block_count:      records.length,
      lat, lng,
      confidence_score: best.confidence_score,
      source_keyword:   best.source_keyword,
    };
  });

  // ── Write candidates ──────────────────────────────────────────────────────

  console.log(`Writing ${mergedCandidates.length} merged candidate projects to Turso…`);
  const candRows = mergedCandidates.map((r) => ({
    sql: `INSERT INTO private_property_candidates
            (project_name, property_type, address, postal_codes, block_count,
             lat, lng, confidence_score, reason, source_keyword, seeded_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [r.project_name, r.property_type, r.address, r.postal_codes, r.block_count,
           r.lat, r.lng, r.confidence_score,
           candidateGroupMap.get(normalize(r.project_name))![0].reason,
           r.source_keyword, seededAt],
  }));

  written = 0;
  for (let i = 0; i < candRows.length; i += CHUNK) {
    await db.batch(candRows.slice(i, i + CHUNK), "write");
    written += Math.min(CHUNK, candRows.length - i);
    process.stdout.write(`\r  Candidates written: ${written}/${candRows.length}`);
  }
  process.stdout.write("\n");

  // ── Counts ────────────────────────────────────────────────────────────────

  const [mCount, cCount] = await Promise.all([
    db.execute("SELECT COUNT(*) as n FROM private_property_master"),
    db.execute("SELECT COUNT(*) as n FROM private_property_candidates"),
  ]);
  const masterTotal    = Number(mCount.rows[0]?.n ?? 0);
  const candidateTotal = Number(cCount.rows[0]?.n ?? 0);

  // ── Report ────────────────────────────────────────────────────────────────

  console.log("\n══ Seed Report ══════════════════════════════════════════════════");
  console.log(`  Total raw OneMap results  : ${grandTotalRaw.toLocaleString()}`);
  console.log(`  Master blocks found       : ${dedupedMasters.length.toLocaleString()} (${mergedMasters.length} unique projects)`);
  console.log(`  Candidate projects found  : ${mergedCandidates.length.toLocaleString()} (merged from ${dedupedCandidates.length} blocks)`);
  console.log(`  Rejected  (score <2)      : ${grandRejected.toLocaleString()}`);
  console.log(`  DB master total (projects): ${masterTotal.toLocaleString()}`);
  console.log(`  DB candidate total (blocks): ${candidateTotal.toLocaleString()}`);
  console.log(`  Turso DB                  : ${process.env.TURSO_DATABASE_URL}`);

  if (mergedCandidates.length > 0) {
    console.log("\n── Top 50 candidates (needs review) ─────────────────────────────");
    const top50 = [...mergedCandidates]
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, 50);
    for (const c of top50) {
      const postals = JSON.parse(c.postal_codes) as string[];
      console.log(`  [${c.confidence_score}] ${c.project_name.padEnd(42)} ${c.block_count} block(s)  ${postals.join(" ")}`);
    }
  }

  console.log("\n✓ Seed complete");
  console.log("  The app now reads from private_property_master automatically.");
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
