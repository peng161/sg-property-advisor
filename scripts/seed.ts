/**
 * Seed script — pulls HDB resale data from data.gov.sg and writes to Turso.
 *
 * Run once:  npm run seed
 *
 * For private condo data, run:  npm run seed:condos
 *
 * Required env vars (in .env.local):
 *   TURSO_DATABASE_URL   — libsql://... URL from Turso dashboard
 *   TURSO_AUTH_TOKEN     — Turso auth token
 *
 * Optional:
 *   DATA_GOV_SG_API_KEY  — higher rate limits on data.gov.sg CKAN API
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

// ── DB ────────────────────────────────────────────────────────────────────────

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const START_YEAR   = CURRENT_YEAR - 5;
const CHUNK        = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function parseRemainingLease(raw: string): number {
  const m = raw?.match(/(\d+)\s*year/i);
  return m ? Number(m[1]) : 0;
}

// ── Town centroid fallbacks ───────────────────────────────────────────────────

const TOWN_COORDS: Record<string, [number, number]> = {
  "ANG MO KIO":      [1.3691, 103.8454], "BEDOK":           [1.3236, 103.9273],
  "BISHAN":          [1.3526, 103.8352], "BUKIT BATOK":     [1.3490, 103.7490],
  "BUKIT MERAH":     [1.2819, 103.8239], "BUKIT PANJANG":   [1.3774, 103.7719],
  "BUKIT TIMAH":     [1.3294, 103.7885], "CENTRAL AREA":    [1.2980, 103.8480],
  "CHOA CHU KANG":   [1.3840, 103.7470], "CLEMENTI":        [1.3162, 103.7649],
  "GEYLANG":         [1.3201, 103.8880], "HOUGANG":         [1.3612, 103.8863],
  "JURONG EAST":     [1.3330, 103.7436], "JURONG WEST":     [1.3404, 103.7090],
  "KALLANG/WHAMPOA": [1.3099, 103.8677], "MARINE PARADE":   [1.3010, 103.9060],
  "PASIR RIS":       [1.3721, 103.9474], "PUNGGOL":         [1.4043, 103.9021],
  "QUEENSTOWN":      [1.2942, 103.7861], "SEMBAWANG":       [1.4490, 103.8185],
  "SENGKANG":        [1.3868, 103.8914], "SERANGOON":       [1.3554, 103.8679],
  "TAMPINES":        [1.3540, 103.9440], "TOA PAYOH":       [1.3321, 103.8474],
  "WOODLANDS":       [1.4369, 103.7864], "YISHUN":          [1.4304, 103.8354],
  "LIM CHU KANG":    [1.4196, 103.7184], "TENGAH":          [1.3740, 103.7350],
};

// ── Geocoding ─────────────────────────────────────────────────────────────────

const geoCache = new Map<string, [number, number] | null>();

async function geocodeOneMap(query: string): Promise<[number, number] | null> {
  if (geoCache.has(query)) return geoCache.get(query)!;
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json() as { results?: { LATITUDE: string; LONGITUDE?: string; LONGTITUDE?: string }[] };
    const r    = json.results?.[0];
    if (!r) { geoCache.set(query, null); return null; }
    const lat = Number(r.LATITUDE);
    const lng = Number(r.LONGITUDE ?? r.LONGTITUDE);
    const result: [number, number] | null = (lat && lng) ? [lat, lng] : null;
    geoCache.set(query, result);
    return result;
  } catch {
    geoCache.set(query, null);
    return null;
  }
}

async function geocodeBulk(queries: string[], concurrency = 4, delayMs = 400) {
  const out = new Map<string, [number, number] | null>();
  for (let i = 0; i < queries.length; i += concurrency) {
    const batch   = queries.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (q) => [q, await geocodeOneMap(q)] as const));
    for (const [q, r] of results) out.set(q, r);
    if (i + concurrency < queries.length) await sleep(delayMs);
    process.stdout.write(`\r  Geocoded: ${Math.min(i + concurrency, queries.length)}/${queries.length}`);
  }
  process.stdout.write("\n");
  return out;
}

// ── HDB fetching ──────────────────────────────────────────────────────────────

const HDB_RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
const HDB_BATCH_SIZE  = 10_000;
const HDB_MAX_PAGES   = 50;
const HDB_MAX_RETRIES = 5;

interface RawHdb { [key: string]: string }

async function fetchAllHdb(): Promise<RawHdb[]> {
  const all: RawHdb[] = [];
  let offset = 0;
  let page   = 1;
  let total  = Infinity;

  while (page <= HDB_MAX_PAGES) {
    const url =
      `https://data.gov.sg/api/action/datastore_search` +
      `?resource_id=${HDB_RESOURCE_ID}` +
      `&limit=${HDB_BATCH_SIZE}` +
      `&offset=${offset}` +
      `&sort=month%20desc`;

    type HdbPage = { result?: { records?: RawHdb[]; total?: number } };
    const hdbApiKey = process.env.DATA_GOV_SG_API_KEY ?? "";
    const hdbHeaders: Record<string, string> = { Accept: "application/json" };
    if (hdbApiKey) hdbHeaders["x-api-key"] = hdbApiKey;

    let json: HdbPage | null = null;
    for (let attempt = 1; attempt <= HDB_MAX_RETRIES; attempt++) {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: hdbHeaders });
      if (res.status === 429) {
        const wait = Math.min(4000 * 2 ** (attempt - 1), 64000);
        console.log(`\n    429 — waiting ${wait / 1000}s…`);
        if (attempt === HDB_MAX_RETRIES) { console.error("  Max retries reached. Stopping."); return all; }
        await sleep(wait);
        continue;
      }
      if (!res.ok) { console.error(`  Bad response ${res.status}. Stopping.`); return all; }
      json = await res.json() as HdbPage;
      break;
    }
    if (!json) break;

    const batch = json.result?.records ?? [];
    if (typeof json.result?.total === "number") total = json.result.total;
    console.log(`  Page ${page} | offset ${offset} | got ${batch.length} | total ${total === Infinity ? "?" : total}`);

    if (batch.length === 0) { console.log("  Empty page — done."); break; }

    let passedWindow = false;
    for (const r of batch) {
      const y = parseInt((r.month ?? "0000").slice(0, 4), 10);
      if (y < START_YEAR) { passedWindow = true; continue; }
      if (y <= CURRENT_YEAR) all.push(r);
    }
    if (passedWindow) { console.log("  Reached date window start — stopping."); break; }
    if (offset + batch.length >= total) { console.log("  End of dataset."); break; }

    offset += HDB_BATCH_SIZE;
    page++;
    await sleep(hdbApiKey ? 600 : 2700);
  }

  return all;
}

// ── Table setup ───────────────────────────────────────────────────────────────

async function createTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS hdb_tx (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      block                TEXT    NOT NULL,
      street_name          TEXT    NOT NULL,
      town                 TEXT,
      flat_type            TEXT    NOT NULL,
      storey_range         TEXT,
      sqm                  REAL,
      resale_price         INTEGER,
      price_per_sqm        INTEGER,
      month                TEXT,
      lease_commence_year  INTEGER,
      remaining_lease      INTEGER,
      lat                  REAL    NOT NULL,
      lng                  REAL    NOT NULL,
      UNIQUE(block, street_name, flat_type, storey_range, month)
    )
  `);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_hdb_loc      ON hdb_tx(lat, lng)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_hdb_flattype ON hdb_tx(flat_type)");
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

  console.log(`Fetching HDB resale data (last 5 years: ${START_YEAR}–${CURRENT_YEAR})…`);
  const allHdb = await fetchAllHdb();
  console.log(`\nTotal HDB records in range: ${allHdb.length}\n`);

  const uniqueStreets = [...new Set(allHdb.map((r) => r.street_name as string))];
  console.log(`Geocoding ${uniqueStreets.length} unique streets…`);
  const hdbGeo  = await geocodeBulk(uniqueStreets, 8, 200);
  const geocoded = [...hdbGeo.values()].filter(Boolean).length;
  console.log(`  Geocoded: ${geocoded}  Skipped: ${uniqueStreets.length - geocoded}\n`);

  // Build valid rows
  const rows: Parameters<typeof db.batch>[0] = [];
  for (const row of allHdb) {
    const precise  = hdbGeo.get(row.street_name as string);
    const town     = (row.town ?? "").toUpperCase().trim();
    const fallback = TOWN_COORDS[town] ?? null;
    const coords   = precise ?? fallback;
    if (!coords) continue;
    const price = Number(row.resale_price);
    const sqm   = Number(row.floor_area_sqm);
    if (!price || !sqm) continue;
    const [lat, lng] = coords;
    rows.push({
      sql: `INSERT OR REPLACE INTO hdb_tx
              (block, street_name, town, flat_type, storey_range, sqm, resale_price,
               price_per_sqm, month, lease_commence_year, remaining_lease, lat, lng)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        row.block, row.street_name, row.town ?? "", row.flat_type,
        row.storey_range, sqm, price, Math.round(price / sqm), row.month,
        Number(row.lease_commence_date) || 0,
        parseRemainingLease(row.remaining_lease ?? ""),
        lat, lng,
      ],
    });
  }

  console.log(`Writing ${rows.length} rows to Turso in chunks of ${CHUNK}…`);
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batch(rows.slice(i, i + CHUNK), "write");
    written += Math.min(CHUNK, rows.length - i);
    process.stdout.write(`\r  Written: ${written}/${rows.length}`);
  }
  process.stdout.write("\n");

  const countRes = await db.execute("SELECT COUNT(*) as n FROM hdb_tx");
  const hdbTotal = Number(countRes.rows[0]?.n ?? 0);

  console.log("\n✓ Seed complete");
  console.log(`  HDB transactions in Turso : ${hdbTotal.toLocaleString()}`);
  console.log("\nFor private condo data, run:  npm run seed:condos");
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
