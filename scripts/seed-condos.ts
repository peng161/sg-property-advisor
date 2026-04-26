/**
 * Seed script — discovers all private condos & ECs in Singapore from OneMap
 * using broad search terms + confidence scoring.
 *
 * Run: npm run seed:condos
 *
 * Writes to:
 *   private_property_master     — confidence_score >= 4  (used by the app)
 *   private_property_candidates — confidence_score 2–3   (needs manual review)
 *
 * No hardcoded project names — discovery is purely keyword + scoring.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

// ── Search keywords ───────────────────────────────────────────────────────────
// Broad project-name fragments capture condos like The Trilinq, Hundred Trees.
// Strong condo identifiers (condominium, residences…) are kept for maximum recall.

const SEARCH_KEYWORDS = [
  // Strong condo identifiers
  "executive condominium", "condominium", "residences", "residence",
  "apartments", "suites", "estate",
  // Broad project-name fragments
  "the", "park", "parc", "view", "trees", "tree", "heights", "hill",
  "crest", "green", "gardens", "valley", "bay", "shore", "towers",
  "grove", "loft", "casa", "court", "point", "place", "mansion",
] as const;

// ── Classification rules ──────────────────────────────────────────────────────

// Reject on exact phrase match — strong non-residential signals only.
// Generic words like garden/lake/bay/park are NOT rejected here;
// valid condos are often named after them.
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

// ERP is short so we use whole-word matching (\bERP\b) in classify().

// +4 — definitive condo / EC type identifier in the name
const HIGH_CONF_TERMS = [
  "EXECUTIVE CONDOMINIUM", "CONDOMINIUM", "CONDO",
  "APARTMENT", "RESIDENCES", "RESIDENCE", "SUITES",
] as const;

// +1 — common residential branding words (whole-word match)
const BRANDING_WORDS = [
  "PARC", "PARK", "VIEW", "HEIGHTS", "HILL", "CREST", "GREEN", "GARDENS",
  "VALLEY", "BAY", "SHORE", "TOWERS", "GROVE", "LOFT", "CASA", "COURT",
  "POINT", "PLACE", "MANSION", "TREES", "LAKE",
] as const;

// Road/infrastructure name suffix pattern — used to exclude pure address strings
const ROAD_SUFFIX_RE = /\b(AVENUE|ROAD|STREET|DRIVE|CRESCENT|WALK|WAY|LANE|CLOSE|LINK|FLYOVER|HIGHWAY|BOULEVARD|RING)\s*\d*$/;

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

// ── Classifier ────────────────────────────────────────────────────────────────

export function classify(
  building: string, searchval: string, address: string,
  postal: string, lat: number, lng: number,
): Classified {
  const rawBuilding = (building || searchval || "").trim();
  const b     = rawBuilding.toUpperCase();
  const a     = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  // ── Hard rejects — specific non-residential phrases only ─────────────────
  for (const phrase of REJECT_PHRASES) {
    if (combo.includes(phrase)) {
      return { bucket: "reject", score: 0, reason: `reject: "${phrase}"`, projectName: rawBuilding, propertyType: "Condo" };
    }
  }
  if (/\bERP\b/.test(combo)) {
    return { bucket: "reject", score: 0, reason: 'reject: "ERP"', projectName: rawBuilding, propertyType: "Condo" };
  }

  // ── Positive scoring ──────────────────────────────────────────────────────
  let score = 0;
  const reasons: string[] = [];
  let isEC = false;

  // +4 definitive condo / EC identifier in the name
  for (const term of HIGH_CONF_TERMS) {
    if (combo.includes(term)) {
      score += 4;
      reasons.push(`+4 "${term}"`);
      if (term === "EXECUTIVE CONDOMINIUM") isEC = true;
      break;
    }
  }

  // +2 named residential project: BUILDING exists, valid postal + coords,
  //    2–5 words, not a block reference, not starting with a digit, not a road name
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

  // +1 residential branding word (whole-word match, count only first hit)
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

  // score >= 4 → master, 2–3 → candidate, < 2 → reject
  if (score < 2)  return { bucket: "reject",    score, reason: `score ${score}: ${reasonStr}`, projectName, propertyType };
  if (score <= 3) return { bucket: "candidate", score, reason: reasonStr,                       projectName, propertyType };
  return                  { bucket: "master",    score, reason: reasonStr,                       projectName, propertyType };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function normalize(name: string): string {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
}

// ── DB ────────────────────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "data", "sg-property.db");

function openDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS private_property_master (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name     TEXT    NOT NULL,
      property_type    TEXT    NOT NULL DEFAULT 'Condo',
      address          TEXT,
      postal_code      TEXT,
      lat              REAL    NOT NULL,
      lng              REAL    NOT NULL,
      confidence_score INTEGER NOT NULL,
      source_keyword   TEXT,
      seeded_at        TEXT    NOT NULL,
      UNIQUE(project_name, postal_code)
    );
    CREATE INDEX IF NOT EXISTS idx_ppm_loc ON private_property_master(lat, lng);

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
    );
    CREATE INDEX IF NOT EXISTS idx_ppc_loc ON private_property_candidates(lat, lng);
  `);
  return db;
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
  const token = process.env.ONEMAP_TOKEN ?? "";
  if (!token) console.warn("⚠  ONEMAP_TOKEN not set — unauthenticated (may hit rate limits)");

  console.log(`\nOpening SQLite: ${DB_PATH}`);
  const db = openDb();

  const seededAt       = new Date().toISOString();
  const allMasters:     SeedRecord[] = [];
  const allCandidates:  SeedRecord[] = [];
  let   grandTotalRaw  = 0;
  let   grandRejected  = 0;

  for (const keyword of SEARCH_KEYWORDS) {
    console.log(`\n▸ Keyword: "${keyword}"`);
    const { masters, candidates, totalRaw, rejected } = await fetchKeyword(keyword, token);
    allMasters.push(...masters);
    allCandidates.push(...candidates);
    grandTotalRaw += totalRaw;
    grandRejected += rejected;
    console.log(`  ✓ "${keyword}": ${masters.length} master, ${candidates.length} cand, ${rejected} rejected of ${totalRaw} raw`);
  }

  // ── Deduplicate ───────────────────────────────────────────────────────────

  console.log("\nDeduplicating…");

  const masterMap = new Map<string, SeedRecord>();
  for (const r of allMasters) {
    const key = `${normalize(r.project_name)}|${r.postal_code}`;
    const ex  = masterMap.get(key);
    if (!ex || r.confidence_score > ex.confidence_score) masterMap.set(key, r);
  }
  const dedupedMasters = [...masterMap.values()];

  const candidateMap = new Map<string, SeedRecord>();
  for (const r of allCandidates) {
    const key = `${normalize(r.project_name)}|${r.postal_code}`;
    if (masterMap.has(key)) continue;        // already promoted to master
    if (!candidateMap.has(key)) candidateMap.set(key, r);
  }
  const dedupedCandidates = [...candidateMap.values()];

  // ── Write to DB ───────────────────────────────────────────────────────────

  console.log(`Writing ${dedupedMasters.length} master records…`);
  const insertMaster = db.prepare(`
    INSERT OR REPLACE INTO private_property_master
      (project_name, property_type, address, postal_code, lat, lng,
       confidence_score, source_keyword, seeded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction((rows: SeedRecord[]) => {
    for (const r of rows)
      insertMaster.run(r.project_name, r.property_type, r.address, r.postal_code,
                       r.lat, r.lng, r.confidence_score, r.source_keyword, seededAt);
  })(dedupedMasters);

  console.log(`Writing ${dedupedCandidates.length} candidate records…`);
  const insertCandidate = db.prepare(`
    INSERT OR IGNORE INTO private_property_candidates
      (project_name, property_type, address, postal_code, lat, lng,
       confidence_score, reason, source_keyword, seeded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction((rows: SeedRecord[]) => {
    for (const r of rows)
      insertCandidate.run(r.project_name, r.property_type, r.address, r.postal_code,
                          r.lat, r.lng, r.confidence_score, r.reason, r.source_keyword, seededAt);
  })(dedupedCandidates);

  const masterTotal    = (db.prepare("SELECT COUNT(*) as n FROM private_property_master").get() as { n: number }).n;
  const candidateTotal = (db.prepare("SELECT COUNT(*) as n FROM private_property_candidates").get() as { n: number }).n;
  db.close();

  // ── Report ────────────────────────────────────────────────────────────────

  console.log("\n══ Seed Report ══════════════════════════════════════════════════");
  console.log(`  Total raw OneMap results : ${grandTotalRaw.toLocaleString()}`);
  console.log(`  Accepted  (master ≥4)   : ${dedupedMasters.length.toLocaleString()} this run`);
  console.log(`  Candidate (score 2–3)   : ${dedupedCandidates.length.toLocaleString()} this run`);
  console.log(`  Rejected  (score <2)    : ${grandRejected.toLocaleString()}`);
  console.log(`  DB master  total         : ${masterTotal.toLocaleString()}`);
  console.log(`  DB candidate total       : ${candidateTotal.toLocaleString()}`);
  console.log(`  Database                 : ${DB_PATH}`);

  if (dedupedCandidates.length > 0) {
    console.log("\n── Top 50 candidates (needs review) ─────────────────────────────");
    const top50 = [...dedupedCandidates]
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
