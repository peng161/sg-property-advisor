/**
 * Seed script — pulls all private condos & ECs across Singapore from OneMap
 * and writes them to the local SQLite database (onemap_condo table).
 *
 * Run once (or to refresh):
 *   npm run seed:condos
 *
 * After seeding, /api/area-condos queries the DB instead of hitting OneMap
 * live on every search — results go from ~20 s to <200 ms.
 *
 * Requires:  ONEMAP_TOKEN in .env.local  (renew every 3 days at developers.onemap.sg)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import path from "path";
import fs   from "fs";
import Database from "better-sqlite3";

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "data", "sg-property.db");

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";

const PROPERTY_KEYWORDS = [
  "executive condominium",
  "condominium",
  "residences",
  "residence",
  "suites",
  "apartments",
  "parc",
  "towers",
  "estate",
] as const;

const LANDED_TERMS = [
  "terrace", "semi-detached", "detached", "bungalow",
  "cluster house", "good class bungalow", "gcb", "villa",
  " house", "landed",
];

const MAX_PAGES_PER_KEYWORD = 80;  // 80 × 10 = 800 results per keyword
const PAGE_DELAY_MS          = 120; // stay within OneMap rate limits

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

interface OneMapResult {
  BUILDING:   string;
  ADDRESS:    string;
  POSTAL:     string;
  LATITUDE:   string;
  LONGITUDE:  string;
  LONGTITUDE: string;
}

function classifyResult(
  building: string,
  address:  string,
  keyword:  string,
): { keep: boolean; category: "Condo" | "EC"; rejectReason?: string } {
  const b     = building.toUpperCase().trim();
  const a     = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  if (combo.includes("HDB") || combo.includes("HOUSING BOARD"))
    return { keep: false, category: "Condo", rejectReason: "HDB" };
  if (!b && (a.startsWith("BLK ") || a.startsWith("BLOCK ")))
    return { keep: false, category: "Condo", rejectReason: "HDB block" };
  if (combo.includes("HDB APARTMENT"))
    return { keep: false, category: "Condo", rejectReason: "HDB apartment" };

  for (const term of LANDED_TERMS) {
    if (combo.includes(term.toUpperCase()))
      return { keep: false, category: "Condo", rejectReason: `landed (${term})` };
  }

  if (!b) return { keep: false, category: "Condo", rejectReason: "no building name" };

  const isEc =
    keyword === "executive condominium" ||
    combo.includes("EXECUTIVE CONDOMINIUM") ||
    /\bEC\b/.test(b);

  return { keep: true, category: isEc ? "EC" : "Condo" };
}

// ── DB setup ──────────────────────────────────────────────────────────────────

function openDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS onemap_condo (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name      TEXT NOT NULL,
      property_category TEXT NOT NULL,
      address           TEXT,
      postal_code       TEXT,
      lat               REAL NOT NULL,
      lng               REAL NOT NULL,
      seeded_at         TEXT NOT NULL,
      UNIQUE(project_name, postal_code)
    );
    CREATE INDEX IF NOT EXISTS idx_onemap_condo_loc
      ON onemap_condo(lat, lng);
  `);
  return db;
}

// ── Fetch one keyword, all pages ─────────────────────────────────────────────

interface FetchedProperty {
  project_name:      string;
  property_category: "Condo" | "EC";
  address:           string;
  postal_code:       string;
  lat:               number;
  lng:               number;
}

async function fetchKeyword(
  keyword: string,
  token:   string,
): Promise<FetchedProperty[]> {
  const found: FetchedProperty[] = [];
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  for (let page = 1; page <= MAX_PAGES_PER_KEYWORD; page++) {
    const url =
      `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(keyword)}` +
      `&returnGeom=Y&getAddrDetails=Y&pageNum=${page}`;

    let data: { found?: number; totalNumPages?: number; results?: OneMapResult[] };
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn(`  keyword="${keyword}" page=${page} HTTP ${res.status} — stopping`);
        break;
      }
      data = await res.json() as typeof data;
    } catch (err) {
      console.warn(`  keyword="${keyword}" page=${page} fetch error — stopping`);
      break;
    }

    const pageResults: OneMapResult[] = data.results ?? [];
    const totalPages = data.totalNumPages ?? 1;

    process.stdout.write(
      `\r  [${keyword}] page ${page}/${totalPages} — ${found.length} kept so far`
    );

    if (!pageResults.length) break;

    for (const r of pageResults) {
      const lat = Number(r.LATITUDE);
      const lng = Number(r.LONGITUDE || r.LONGTITUDE);
      if (!lat || !lng) continue;

      const building = (r.BUILDING || "").trim();
      const address  = (r.ADDRESS  || "").trim();
      const postal   = (r.POSTAL   || "").replace(/\D/g, "");

      const { keep, category } = classifyResult(building, address, keyword);
      if (!keep) continue;

      found.push({
        project_name:      building || address.split(" ").slice(0, 4).join(" "),
        property_category: category,
        address,
        postal_code:       postal,
        lat,
        lng,
      });
    }

    if (page >= totalPages) break;
    await sleep(PAGE_DELAY_MS);
  }

  process.stdout.write("\n");
  return found;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.ONEMAP_TOKEN ?? "";
  if (!token) {
    console.warn("⚠  ONEMAP_TOKEN not set — requests will be unauthenticated (may hit rate limits faster)");
  }

  console.log(`Opening SQLite: ${DB_PATH}\n`);
  const db = openDb();

  const seededAt = new Date().toISOString();
  const allRaw: FetchedProperty[] = [];

  for (const keyword of PROPERTY_KEYWORDS) {
    console.log(`\nSearching keyword: "${keyword}"`);
    const results = await fetchKeyword(keyword, token);
    console.log(`  → ${results.length} kept for "${keyword}"`);
    allRaw.push(...results);
  }

  // Deduplicate on (project_name, postal_code)
  const seen = new Set<string>();
  const deduped: FetchedProperty[] = [];
  for (const p of allRaw) {
    const key = `${p.project_name.toUpperCase()}|${p.postal_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  console.log(`\nTotal raw: ${allRaw.length}  After dedup: ${deduped.length}`);
  console.log("Writing to onemap_condo table…");

  const insert = db.prepare(`
    INSERT OR REPLACE INTO onemap_condo
      (project_name, property_category, address, postal_code, lat, lng, seeded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: FetchedProperty[]) => {
    for (const p of rows) {
      insert.run(p.project_name, p.property_category, p.address, p.postal_code, p.lat, p.lng, seededAt);
    }
    return rows.length;
  });

  const written = insertMany(deduped);
  const total = (db.prepare("SELECT COUNT(*) as n FROM onemap_condo").get() as { n: number }).n;

  db.close();

  const condoCount = deduped.filter((p) => p.property_category === "Condo").length;
  const ecCount    = deduped.filter((p) => p.property_category === "EC").length;

  console.log(`\n✓ Seed complete`);
  console.log(`  Written this run:  ${written}`);
  console.log(`  Total in table:    ${total}`);
  console.log(`  Condos:            ${condoCount}`);
  console.log(`  ECs:               ${ecCount}`);
  console.log(`  Database:          ${DB_PATH}`);
  console.log(`\nNext steps:`);
  console.log(`  • The area-condos API will now use the DB automatically.`);
  console.log(`  • Re-run this script every few months or after renewing your OneMap token.`);
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
