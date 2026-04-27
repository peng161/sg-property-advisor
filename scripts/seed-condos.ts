/**
 * Seed script — discovers all private condos & ECs in Singapore from OneMap
 * using broad search terms + confidence scoring, then writes to Turso.
 *
 * Run: npm run seed:condos
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
 * Reseeding updates centroid + postal codes; manually accepted projects
 * are preserved and enriched with fresh data.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

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

// ── Classification rules ──────────────────────────────────────────────────────

const REJECT_PHRASES = [
  "GARDENS BY THE BAY",
  "MRT STATION", "MRT EXIT", "STATION EXIT",
  "BUS STOP",
  "AVENUE TOWARDS", "ROAD TOWARDS",
  "EXPRESSWAY", "PARK CONNECTOR",
  "NATURE RESERVE",
  "SCHOOL", "HOSPITAL", "CLINIC",
  "CHURCH", "TEMPLE", "MOSQUE",
  "COMMUNITY CENTRE",
  "INDUSTRIAL", "WAREHOUSE", "FACTORY",
] as const;

const HIGH_CONF_TERMS = [
  "EXECUTIVE CONDOMINIUM", "CONDOMINIUM", "CONDO",
  "APARTMENT", "RESIDENCES", "RESIDENCE", "SUITES",
] as const;

const BRANDING_WORDS = [
  "PARC", "PARK", "VIEW", "HEIGHTS", "HILL", "CREST", "GREEN", "GARDENS",
  "VALLEY", "BAY", "SHORE", "TOWERS", "GROVE", "LOFT", "CASA", "COURT",
  "POINT", "PLACE", "MANSION", "TREES", "LAKE",
] as const;

const ROAD_SUFFIX_RE = /\b(AVENUE|ROAD|STREET|DRIVE|CRESCENT|WALK|WAY|LANE|CLOSE|LINK|FLYOVER|HIGHWAY|BOULEVARD|RING)\s*\d*$/;

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

type Bucket = "master" | "candidate" | "reject";

interface Classified {
  bucket:       Bucket;
  score:        number;
  reason:       string;
  projectName:  string;
  propertyType: "Condo" | "EC";
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

// ── Classifier ────────────────────────────────────────────────────────────────

export function classify(
  building: string, searchval: string, address: string,
  postal: string, lat: number, lng: number,
): Classified {
  const rawBuilding = (building || searchval || "").trim();
  const b     = rawBuilding.toUpperCase();
  const a     = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  for (const phrase of REJECT_PHRASES) {
    if (combo.includes(phrase)) {
      return { bucket: "reject", score: 0, reason: `reject: "${phrase}"`, projectName: rawBuilding, propertyType: "Condo" };
    }
  }
  if (/\bERP\b/.test(combo)) {
    return { bucket: "reject", score: 0, reason: 'reject: "ERP"', projectName: rawBuilding, propertyType: "Condo" };
  }

  let score = 0;
  const reasons: string[] = [];
  let isEC = false;

  for (const term of HIGH_CONF_TERMS) {
    if (combo.includes(term)) {
      score += 4;
      reasons.push(`+4 "${term}"`);
      if (term === "EXECUTIVE CONDOMINIUM") isEC = true;
      break;
    }
  }

  const cleanPostal = postal.replace(/\D/g, "");
  if (rawBuilding.length > 0 && cleanPostal.length === 6 && lat && lng) {
    const wordCount       = b.split(/\s+/).filter(Boolean).length;
    const isBuildingBlock = /^(BLK|BLOCK)\s*\d/i.test(rawBuilding);
    const startsWithDigit = /^\d/.test(rawBuilding);
    const isRoadName      = ROAD_SUFFIX_RE.test(b);
    if (!isBuildingBlock && !startsWithDigit && !isRoadName && wordCount >= 2 && wordCount <= 5) {
      score += 2;
      reasons.push("+2 named project");
    }
  }

  for (const word of BRANDING_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(b)) {
      score += 1;
      reasons.push(`+1 branding "${word}"`);
      break;
    }
  }

  const projectName   = rawBuilding || address.split(" ").slice(0, 4).join(" ");
  const propertyType: "Condo" | "EC" = isEC ? "EC" : "Condo";
  const reasonStr     = reasons.join(", ") || "no positive signals";

  if (score < 2)  return { bucket: "reject",    score, reason: `score ${score}: ${reasonStr}`, projectName, propertyType };
  if (score <= 3) return { bucket: "candidate", score, reason: reasonStr,                       projectName, propertyType };
  return                  { bucket: "master",    score, reason: reasonStr,                       projectName, propertyType };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function normalize(name: string): string {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
}

// ── Table setup + migration ───────────────────────────────────────────────────

async function createTables() {
  // Check current master schema and migrate if needed
  const info = await db.execute("PRAGMA table_info(private_property_master)");
  const cols = info.rows.map((r) => String(r.name));

  if (cols.length === 0) {
    // Fresh install — create with merged schema
    await db.execute(`
      CREATE TABLE IF NOT EXISTS private_property_master (
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
  } else if (!cols.includes("postal_codes")) {
    // Old schema (UNIQUE per project+postal) — migrate to merged schema
    await migrateToMergedSchema();
  }
  await db.execute("CREATE INDEX IF NOT EXISTS idx_ppm_loc ON private_property_master(lat, lng)");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS private_property_candidates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name     TEXT    NOT NULL,
      property_type    TEXT    NOT NULL DEFAULT 'Condo',
      address          TEXT,
      postal_code      TEXT,
      lat              REAL    NOT NULL,
      lng              REAL    NOT NULL,
      confidence_score INTEGER NOT NULL,
      reason           TEXT,
      source_keyword   TEXT,
      seeded_at        TEXT    NOT NULL,
      UNIQUE(project_name, postal_code)
    )
  `);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_ppc_loc ON private_property_candidates(lat, lng)");
}

async function migrateToMergedSchema() {
  console.log("  Migrating private_property_master to per-project (merged) schema…");
  const { rows } = await db.execute("SELECT * FROM private_property_master");

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = normalize(String(row.project_name));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  await db.execute("DROP TABLE IF EXISTS private_property_master_new");
  await db.execute(`
    CREATE TABLE private_property_master_new (
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

  const insertRows = [...groups.values()].map((group) => {
    const best = group.reduce((b, r) => Number(r.confidence_score) > Number(b.confidence_score) ? r : b, group[0]);
    const lat  = group.reduce((s, r) => s + Number(r.lat), 0) / group.length;
    const lng  = group.reduce((s, r) => s + Number(r.lng), 0) / group.length;
    const postalCodes = [...new Set(group.map((r) => String(r.postal_code)).filter(Boolean))];
    return {
      sql:  "INSERT INTO private_property_master_new (project_name, property_type, address, postal_codes, block_count, lat, lng, confidence_score, source_keyword, seeded_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [String(best.project_name), String(best.property_type), String(best.address), JSON.stringify(postalCodes), group.length, lat, lng, Number(best.confidence_score), String(best.source_keyword), String(best.seeded_at)],
    };
  });

  for (let i = 0; i < insertRows.length; i += CHUNK) {
    await db.batch(insertRows.slice(i, i + CHUNK), "write");
  }

  await db.execute("DROP TABLE private_property_master");
  await db.execute("ALTER TABLE private_property_master_new RENAME TO private_property_master");
  console.log(`  Migrated ${insertRows.length} merged projects.`);
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

  // ── Write masters (upsert — preserves existing manual accepts) ────────────

  console.log(`\nWriting ${mergedMasters.length} merged master projects to Turso…`);
  const masterRows = mergedMasters.map((r) => ({
    sql: `INSERT INTO private_property_master
            (project_name, property_type, address, postal_codes, block_count,
             lat, lng, confidence_score, source_keyword, seeded_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(project_name) DO UPDATE SET
            property_type=excluded.property_type,
            address=excluded.address,
            postal_codes=excluded.postal_codes,
            block_count=excluded.block_count,
            lat=excluded.lat,
            lng=excluded.lng,
            confidence_score=excluded.confidence_score,
            source_keyword=excluded.source_keyword,
            seeded_at=excluded.seeded_at`,
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

  // ── Filter candidates: exclude project_names already in master ────────────

  const existingMasterRes = await db.execute(
    "SELECT project_name FROM private_property_master",
  );
  const existingMasterNames = new Set(
    existingMasterRes.rows.map((r) => normalize(String(r.project_name))),
  );
  const filteredCandidates = dedupedCandidates.filter(
    (r) => !existingMasterNames.has(normalize(r.project_name)),
  );

  // Also remove stale candidate rows whose project is now in master
  const staleRes = await db.execute(
    "SELECT id, project_name FROM private_property_candidates",
  );
  const staleIds = staleRes.rows
    .filter((r) => existingMasterNames.has(normalize(String(r.project_name))))
    .map((r) => Number(r.id))
    .filter(Boolean);
  if (staleIds.length > 0) {
    for (let i = 0; i < staleIds.length; i += CHUNK) {
      const batch = staleIds.slice(i, i + CHUNK);
      await db.execute({
        sql:  `DELETE FROM private_property_candidates WHERE id IN (${batch.map(() => "?").join(",")})`,
        args: batch,
      });
    }
    console.log(`  Removed ${staleIds.length} stale candidate rows already in master.`);
  }

  // ── Write candidates ──────────────────────────────────────────────────────

  console.log(`Writing ${filteredCandidates.length} candidate records to Turso…`);
  const candRows = filteredCandidates.map((r) => ({
    sql: `INSERT OR IGNORE INTO private_property_candidates
            (project_name, property_type, address, postal_code, lat, lng,
             confidence_score, reason, source_keyword, seeded_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [r.project_name, r.property_type, r.address, r.postal_code,
           r.lat, r.lng, r.confidence_score, r.reason, r.source_keyword, seededAt],
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
  console.log(`  Candidate blocks found    : ${filteredCandidates.length.toLocaleString()} this run`);
  console.log(`  Rejected  (score <2)      : ${grandRejected.toLocaleString()}`);
  console.log(`  DB master total (projects): ${masterTotal.toLocaleString()}`);
  console.log(`  DB candidate total (blocks): ${candidateTotal.toLocaleString()}`);
  console.log(`  Turso DB                  : ${process.env.TURSO_DATABASE_URL}`);

  if (filteredCandidates.length > 0) {
    console.log("\n── Top 50 candidates (needs review) ─────────────────────────────");
    const top50 = [...filteredCandidates]
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, 50);
    for (const c of top50) {
      console.log(`  [${c.confidence_score}] ${c.project_name.padEnd(42)} ${c.postal_code}  ${c.reason}`);
    }
  }

  console.log("\n✓ Seed complete");
  console.log("  The app now reads from private_property_master automatically.");
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
