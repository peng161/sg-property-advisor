/**
 * Seed script — pulls HDB + private property data, geocodes, writes SQLite.
 *
 * Run once:  npm run seed
 *
 * Private data sources (in priority order):
 *   1. data/private_transactions.csv  — export from data.gov.sg private transactions dataset
 *   2. data.gov.sg quarterly aggregate datasets (demand metrics only)
 *   3. Built-in mock data (22 projects, last resort)
 *
 * To get individual transaction CSV: search "private residential property transactions"
 * on data.gov.sg (URA datasets) and download the CSV file to data/private_transactions.csv
 *
 * Optional env vars:
 *   DATA_GOV_SG_API_KEY  — higher rate limits on data.gov.sg CKAN API
 *
 * Output:  data/sg-property.db
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { PRIVATE_MOCK_TRANSACTIONS } from "../lib/fetchPrivateTransactions";

// ── constants ────────────────────────────────────────────────────────────────

const DB_PATH      = path.join(process.cwd(), "data", "sg-property.db");
const CURRENT_YEAR = new Date().getFullYear();
const START_YEAR   = CURRENT_YEAR - 5;

const DISTRICT_CENTROIDS: Record<string, [number, number]> = {
  "01": [1.2810, 103.8508], "02": [1.2760, 103.8423], "03": [1.2894, 103.8083],
  "04": [1.2700, 103.8210], "05": [1.3116, 103.7633], "06": [1.2930, 103.8530],
  "07": [1.3010, 103.8610], "08": [1.3070, 103.8520], "09": [1.3010, 103.8350],
  "10": [1.3190, 103.8130], "11": [1.3300, 103.8330], "12": [1.3300, 103.8490],
  "13": [1.3370, 103.8700], "14": [1.3180, 103.8920], "15": [1.3060, 103.9050],
  "16": [1.3270, 103.9400], "17": [1.3580, 103.9730], "18": [1.3500, 103.9400],
  "19": [1.3700, 103.8930], "20": [1.3610, 103.8450], "21": [1.3410, 103.7700],
  "22": [1.3330, 103.7200], "23": [1.3780, 103.7490], "24": [1.4080, 103.7190],
  "25": [1.4340, 103.7760], "26": [1.4000, 103.8190], "27": [1.4320, 103.8320],
  "28": [1.4040, 103.8700],
};

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function parseRemainingLease(raw: string): number {
  const m = raw?.match(/(\d+)\s*year/i);
  return m ? Number(m[1]) : 0;
}

function parseTenure(raw: string): string {
  if (!raw) return "Unknown";
  if (raw.toLowerCase().includes("freehold")) return "Freehold";
  if (raw.match(/999/)) return "999-year leasehold";
  const m = raw.match(/(\d+)\s*yrs.*commencing.*(\d{4})/i);
  if (m) return `${m[1]}-year leasehold (from ${m[2]})`;
  return raw.slice(0, 40);
}

function calcTrend(dates: string[], psms: number[]): number {
  if (dates.length < 2) return 0;
  const pairs = dates.map((d, i) => ({ d, psm: psms[i] })).sort((a, b) => a.d.localeCompare(b.d));
  const first = pairs[0].psm;
  const last  = pairs[pairs.length - 1].psm;
  return first > 0 ? +((last - first) / first * 100).toFixed(1) : 0;
}

// ── geocoding ─────────────────────────────────────────────────────────────────

// Town-level fallback coordinates — used when OneMap can't find a specific block.
// Gives every HDB record a coordinate so proximity search works even without
// precise geocoding. Precision is town-centroid (~500m–2km from real location).
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

// ── SQLite setup ──────────────────────────────────────────────────────────────

function openDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
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
    );
    CREATE INDEX IF NOT EXISTS idx_hdb_loc      ON hdb_tx(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_hdb_flattype ON hdb_tx(flat_type);

    CREATE TABLE IF NOT EXISTS private_project (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project        TEXT    NOT NULL UNIQUE,
      street         TEXT,
      district       TEXT,
      market_segment TEXT,
      tenure         TEXT,
      min_price      INTEGER,
      max_price      INTEGER,
      median_psm     INTEGER,
      tx_count       INTEGER,
      latest_date    TEXT,
      min_sqm        REAL,
      max_sqm        REAL,
      trend_3y       REAL,
      lat            REAL    NOT NULL,
      lng            REAL    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS private_demand_metrics (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      quarter      TEXT    NOT NULL,
      region       TEXT    NOT NULL,
      type_of_sale TEXT    NOT NULL,
      sale_status  TEXT    NOT NULL,
      units        INTEGER NOT NULL,
      UNIQUE(quarter, region, type_of_sale, sale_status)
    );
    CREATE INDEX IF NOT EXISTS idx_pdm_quarter ON private_demand_metrics(quarter);

    CREATE TABLE IF NOT EXISTS private_project_price_estimates (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name       TEXT NOT NULL,
      unit_type          TEXT NOT NULL DEFAULT 'any',
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
    );
  `);
  return db;
}

// ── HDB fetching ──────────────────────────────────────────────────────────────

const HDB_RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
const HDB_BATCH_SIZE  = 10_000;   // CKAN supports up to ~32 000; 10 K is safe and fast
const HDB_MAX_PAGES   = 50;       // 50 × 10 000 = 500 000 — well above 5 yr volume
const HDB_MAX_RETRIES = 5;

interface RawHdb { [key: string]: string }

// Safe JSON fetcher — validates status + content-type before parsing.
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal:  AbortSignal.timeout(30000),
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}:\n${text.slice(0, 500)}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Expected JSON but got "${ct}".\nFirst 500 chars:\n${text.slice(0, 500)}`
    );
  }

  return res.json() as Promise<T>;
}

// Fetches all HDB resale records with careful pagination, 429 backoff, and hard guards.
// Filters to START_YEAR–CURRENT_YEAR in JS on the "month" field ("YYYY-MM").
async function fetchAllHdb(): Promise<RawHdb[]> {
  const all: RawHdb[] = [];
  let offset  = 0;
  let page    = 1;
  let total   = Infinity; // updated from first response

  while (page <= HDB_MAX_PAGES) {
    // Sort newest-first so we can bail as soon as records fall before START_YEAR.
    const url =
      `https://data.gov.sg/api/action/datastore_search` +
      `?resource_id=${HDB_RESOURCE_ID}` +
      `&limit=${HDB_BATCH_SIZE}` +
      `&offset=${offset}` +
      `&sort=month%20desc`;

    type HdbPage = { result?: { records?: RawHdb[]; total?: number } };
    const hdbApiKey = process.env.DATA_GOV_SG_API_KEY ?? process.env.DATAGOV_API_KEY ?? "";
    const hdbHeaders: Record<string, string> = { Accept: "application/json" };
    if (hdbApiKey) hdbHeaders["x-api-key"] = hdbApiKey;

    // 429-aware fetch with up to HDB_MAX_RETRIES attempts
    let json: HdbPage | null = null;
    for (let attempt = 1; attempt <= HDB_MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(30000),
        headers: hdbHeaders,
      });

      if (res.status === 429) {
        const wait = Math.min(4000 * 2 ** (attempt - 1), 64000); // 4s,8s,16s,32s,64s
        console.log(`    429 — attempt ${attempt}/${HDB_MAX_RETRIES}, waiting ${wait / 1000}s…`);
        if (attempt === HDB_MAX_RETRIES) {
          console.error("  ✗ Max retries reached on 429. Stopping — partial data saved.");
          return all;
        }
        await sleep(wait);
        continue;
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("application/json")) {
        const text = await res.text();
        console.error(`  ✗ Bad response (${res.status}, "${ct}"):\n${text.slice(0, 500)}`);
        console.error("  Stopping — partial data saved.");
        return all;
      }

      json = await res.json() as HdbPage;
      break;
    }

    if (!json) break;

    const batch = json.result?.records ?? [];
    if (typeof json.result?.total === "number") total = json.result.total;

    console.log(`  Page ${page} | offset ${offset} | got ${batch.length} | total ${total === Infinity ? "?" : total}`);

    if (batch.length === 0) {
      console.log("  Empty page — pagination complete.");
      break;
    }

    // Keep only records within the date window; bail once all are older.
    let passedWindow = false;
    for (const r of batch) {
      const y = parseInt((r.month ?? "0000").slice(0, 4), 10);
      if (y < START_YEAR) { passedWindow = true; continue; }
      if (y <= CURRENT_YEAR) all.push(r);
    }

    if (passedWindow) {
      console.log("  Reached start of date window — stopping early.");
      break;
    }

    if (offset + batch.length >= total) {
      console.log("  Reached end of dataset.");
      break;
    }

    offset += HDB_BATCH_SIZE;
    page++;
    // With DATA_GOV_SG_API_KEY (Production): 20 calls/10s → 600ms safe. Without: 4/10s → 2700ms.
    await sleep(hdbApiKey ? 600 : 2700);
  }

  if (page > HDB_MAX_PAGES) {
    console.warn(`  ⚠ Hit MAX_PAGES (${HDB_MAX_PAGES}) safety guard — stopping.`);
  }

  return all;
}

// ── Private data sources ──────────────────────────────────────────────────────

interface PrivateTx {
  project: string; street: string; district: string;
  marketSegment: "OCR" | "RCR" | "CCR"; tenure: string;
  price: number; sqm: number; pricePerSqm: number; contractDate: string;
}

// data.gov.sg CKAN dataset IDs for private residential property transactions.
// Fields: quarter (YYYY-QN), type_of_sale, sale_status, units
// These provide quarterly aggregate demand metrics (not project-level transactions).
//
// To find IDs for missing regions: open data.gov.sg, search "private residential
// property transactions quarterly", filter by URA. The URL contains the resource_id.
const DATAGOV_DEMAND_DATASETS: { region: string; resourceId: string }[] = [
  { region: "OCR", resourceId: "d_1a7823f3d31e7db4b426833833762bab" },
  { region: "ALL", resourceId: "d_7c69c943d5f0d89d6a9a773d2b51f337" },
  // CCR and RCR dataset IDs to add once discovered:
  // { region: "CCR", resourceId: "d_..." },
  // { region: "RCR", resourceId: "d_..." },
];

// Fetch with retry on 429
async function fetchCkan<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (res.status === 429) {
      const wait = Math.min(3000 * 2 ** (attempt - 1), 30000);
      console.log(`    429 — backoff ${wait / 1000}s (attempt ${attempt}/5)…`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) { console.log(`    HTTP ${res.status}`); return null; }
    return res.json() as Promise<T>;
  }
  return null;
}

interface DemandRow { quarter: string; type_of_sale: string; sale_status: string; units: string }

async function fetchPrivateDemandMetrics(): Promise<
  { quarter: string; region: string; type_of_sale: string; sale_status: string; units: number }[]
> {
  const apiKey = process.env.DATA_GOV_SG_API_KEY ?? process.env.DATAGOV_API_KEY ?? "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  // Only last 12 months (~5 recent quarters)
  const cutoffYear = CURRENT_YEAR - 1;
  const cutoffQ    = `${cutoffYear}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`;

  const all: { quarter: string; region: string; type_of_sale: string; sale_status: string; units: number }[] = [];

  for (const { region, resourceId } of DATAGOV_DEMAND_DATASETS) {
    process.stdout.write(`  Fetching demand metrics [${region}]… `);
    let offset = 0;
    let fetched = 0;

    while (true) {
      const url = `https://data.gov.sg/api/action/datastore_search?resource_id=${resourceId}&limit=100&offset=${offset}&sort=quarter+desc`;
      type CkanResp = { success: boolean; result?: { records: DemandRow[]; total: number } };
      const data = await fetchCkan<CkanResp>(url, headers);
      if (!data?.success || !data.result) break;

      const rows = data.result.records;
      let stop = false;
      for (const row of rows) {
        if (row.quarter < cutoffQ) { stop = true; continue; }
        all.push({
          quarter:      row.quarter,
          region,
          type_of_sale: row.type_of_sale,
          sale_status:  row.sale_status,
          units:        Number(row.units) || 0,
        });
        fetched++;
      }
      if (stop || offset + rows.length >= data.result.total) break;
      offset += 100;
      await sleep(apiKey ? 600 : 2700);
    }
    console.log(`${fetched} rows`);
  }
  return all;
}

// CSV loader — reads data/private_transactions.csv if present.
// Columns (any order, case-insensitive): project, street, district, market_segment, tenure, price, sqm, contract_date
function loadPrivateCsv(): PrivateTx[] {
  const csvPath = path.join(process.cwd(), "data", "private_transactions.csv");
  if (!fs.existsSync(csvPath)) return [];

  const lines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  const hdrs = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col  = (name: string) => hdrs.indexOf(name);

  const results: PrivateTx[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const price = Number(cells[col("price")] ?? cells[col("transacted_price")] ?? 0);
    const sqm   = Number(cells[col("sqm")] ?? cells[col("area")] ?? 0);
    if (!price || !sqm) continue;
    const seg = (cells[col("market_segment")] ?? "OCR").toUpperCase();
    results.push({
      project:       cells[col("project")] ?? "",
      street:        cells[col("street")] ?? "",
      district:      cells[col("district")] ?? "",
      marketSegment: seg === "CCR" ? "CCR" : seg === "RCR" ? "RCR" : "OCR",
      tenure:        parseTenure(cells[col("tenure")] ?? ""),
      price, sqm,
      pricePerSqm:   Math.round(price / sqm),
      contractDate:  cells[col("contract_date")] ?? cells[col("sale_date")] ?? "",
    });
  }
  console.log(`  Loaded ${results.length} rows from private_transactions.csv`);
  return results;
}

// Priority: CSV → mock
// To get real data: download the "Private Residential Property Transactions" CSV
// from data.gov.sg (search URA private transactions) → save to data/private_transactions.csv
async function getPrivateTxs(): Promise<PrivateTx[]> {
  const csv = loadPrivateCsv();
  if (csv.length > 0) return csv;

  console.log("  No CSV found — using built-in mock data (22 projects).");
  console.log("  For real data: download from data.gov.sg → save to data/private_transactions.csv");
  return PRIVATE_MOCK_TRANSACTIONS.map((t) => ({
    project: t.project, street: t.street, district: t.district,
    marketSegment: t.marketSegment, tenure: t.tenure,
    price: t.price, sqm: t.sqm, pricePerSqm: t.pricePerSqm, contractDate: t.contractDate,
  }));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Opening SQLite: ${DB_PATH}\n`);
  const db = openDb();

  // ── HDB ────────────────────────────────────────────────────────────────────

  console.log(`Fetching HDB resale data (last 5 years: ${START_YEAR}–${CURRENT_YEAR}) via datastore_search…`);
  const allHdb = await fetchAllHdb();
  console.log(`\nTotal HDB records in range: ${allHdb.length}\n`);

  // Geocode by unique street name — all blocks on the same street share one lookup.
  // Reduces queries from ~6 500 (block-level) to ~1 000–1 500 (street-level), still
  // precise enough for the 2 km bounding-box proximity queries in the app.
  const uniqueStreets = [...new Set(allHdb.map((r) => r.street_name as string))];
  console.log(`Geocoding ${uniqueStreets.length} unique HDB streets (was ~${allHdb.length > 0 ? new Set(allHdb.map((r) => `${r.block} ${r.street_name}`)).size : 0} block-level)...`);
  const hdbGeo = await geocodeBulk(uniqueStreets, 8, 200);   // concurrency 8, 200 ms delay
  const geocoded = [...hdbGeo.values()].filter(Boolean).length;
  console.log(`  Geocoded: ${geocoded}  Skipped: ${uniqueStreets.length - geocoded}\n`);

  console.log("Writing HDB transactions to SQLite...");
  const insertHdb = db.prepare(`
    INSERT OR REPLACE INTO hdb_tx
      (block, street_name, town, flat_type, storey_range, sqm, resale_price,
       price_per_sqm, month, lease_commence_year, remaining_lease, lat, lng)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertManyHdb = db.transaction((rows: RawHdb[]) => {
    let ok = 0;
    for (const row of rows) {
      const precise = hdbGeo.get(row.street_name as string);
      const town    = (row.town ?? "").toUpperCase().trim();
      const fallback = TOWN_COORDS[town] ?? null;
      const coords  = precise ?? fallback;
      if (!coords) continue;
      const price = Number(row.resale_price);
      const sqm   = Number(row.floor_area_sqm);
      if (!price || !sqm) continue;
      const [lat, lng] = coords;
      insertHdb.run(
        row.block, row.street_name, row.town ?? "", row.flat_type,
        row.storey_range, sqm, price, Math.round(price / sqm), row.month,
        Number(row.lease_commence_date) || 0,
        parseRemainingLease(row.remaining_lease ?? ""),
        lat, lng
      );
      ok++;
    }
    return ok;
  });

  const hdbOk = insertManyHdb(allHdb);
  console.log(`  Done: ${hdbOk} rows written\n`);

  // ── Private demand metrics (data.gov.sg quarterly aggregates) ────────────

  console.log("Fetching private demand metrics from data.gov.sg…");
  const demandMetrics = await fetchPrivateDemandMetrics();
  console.log(`Total demand metric rows: ${demandMetrics.length}\n`);

  if (demandMetrics.length > 0) {
    const insertDemand = db.prepare(`
      INSERT OR REPLACE INTO private_demand_metrics
        (quarter, region, type_of_sale, sale_status, units)
      VALUES (?,?,?,?,?)
    `);
    const insertManyDemand = db.transaction(
      (rows: typeof demandMetrics) => { for (const r of rows) insertDemand.run(r.quarter, r.region, r.type_of_sale, r.sale_status, r.units); }
    );
    insertManyDemand(demandMetrics);
    console.log(`  Done: ${demandMetrics.length} demand rows written\n`);
  }

  // ── Private projects (CSV → mock fallback) ────────────────────────────────

  console.log("Loading private transactions…");
  const privateTxs = await getPrivateTxs();
  console.log(`Total private transactions: ${privateTxs.length}\n`);

  if (privateTxs.length > 0) {
    type Bucket = {
      street: string; district: string; marketSegment: "OCR" | "RCR" | "CCR"; tenure: string;
      prices: number[]; psms: number[]; sqms: number[]; dates: string[];
    };
    const byProject = new Map<string, Bucket>();
    for (const tx of privateTxs) {
      const b = byProject.get(tx.project);
      if (!b) {
        byProject.set(tx.project, {
          street: tx.street, district: tx.district,
          marketSegment: tx.marketSegment, tenure: tx.tenure,
          prices: [tx.price], psms: [tx.pricePerSqm], sqms: [tx.sqm], dates: [tx.contractDate],
        });
      } else {
        b.prices.push(tx.price); b.psms.push(tx.pricePerSqm);
        b.sqms.push(tx.sqm);    b.dates.push(tx.contractDate);
      }
    }

    const uniqueStreets = [...new Set([...byProject.values()].map((p) => p.street))];
    console.log(`Geocoding ${uniqueStreets.length} private project streets...`);
    const privateGeo = await geocodeBulk(uniqueStreets, 5, 200);

    console.log("Writing private projects to SQLite...");
    const insertPrivate = db.prepare(`
      INSERT OR REPLACE INTO private_project
        (project, street, district, market_segment, tenure, min_price, max_price,
         median_psm, tx_count, latest_date, min_sqm, max_sqm, trend_3y, lat, lng)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertManyPrivate = db.transaction((entries: [string, Bucket][]) => {
      let ok = 0;
      for (const [project, b] of entries) {
        const coords   = privateGeo.get(b.street);
        const centroid = DISTRICT_CENTROIDS[b.district.padStart(2, "0")] ?? [1.3521, 103.8198];
        const [lat, lng] = coords ?? centroid;
        const sortedDates = [...b.dates].sort();
        insertPrivate.run(
          project, b.street, b.district, b.marketSegment, b.tenure,
          Math.min(...b.prices), Math.max(...b.prices),
          median(b.psms), b.prices.length,
          sortedDates[sortedDates.length - 1],
          Math.min(...b.sqms), Math.max(...b.sqms),
          calcTrend(b.dates, b.psms),
          lat, lng
        );
        ok++;
      }
      return ok;
    });

    const privOk = insertManyPrivate([...byProject.entries()]);
    console.log(`  Done: ${privOk} projects written\n`);
  }

  // ── PSF estimates: derive from private_project ────────────────────────────
  console.log("Computing PSF estimates from private_project…");
  const PSF_PER_PSM = 10.7639;
  const allProjects = db.prepare("SELECT * FROM private_project").all() as {
    project: string; market_segment: string; tenure: string;
    median_psm: number; trend_3y: number; tx_count: number; latest_date: string;
  }[];

  const insertPsf = db.prepare(`
    INSERT OR REPLACE INTO private_project_price_estimates
      (project_name, unit_type, estimated_psf_low, estimated_psf_mid, estimated_psf_high,
       confidence, price_basis, sources_json, notes_json, checked_at, created_at)
    VALUES (?, 'any', ?, ?, ?, 'High', ?, ?, ?, ?, ?)
  `);

  const seedPsf = db.transaction(() => {
    let count = 0;
    const now = new Date().toISOString();
    for (const row of allProjects) {
      const medPsm = Number(row.median_psm);
      if (!medPsm) continue;
      const medPsf  = Math.round(medPsm / PSF_PER_PSM);
      const trend3y = Number(row.trend_3y) || 0;
      const spread  = trend3y > 15 ? 0.10 : 0.07;
      insertPsf.run(
        row.project,
        Math.round(medPsf * (1 - spread)),
        medPsf,
        Math.round(medPsf * (1 + spread)),
        `URA transaction records (${Number(row.tx_count)} transactions, latest: ${row.latest_date})`,
        JSON.stringify(["sg-property DB (URA data via data.gov.sg)"]),
        JSON.stringify([
          `${Number(row.tx_count)} transactions in database.`,
          `3-year price trend: ${trend3y > 0 ? "+" : ""}${trend3y.toFixed(1)}%.`,
          `Segment: ${row.market_segment}. Tenure: ${row.tenure}.`,
        ]),
        now, now,
      );
      count++;
    }
    return count;
  });

  const psfCount = seedPsf();
  console.log(`  PSF estimates written: ${psfCount}\n`);

  const hdbCount  = (db.prepare("SELECT COUNT(*) as n FROM hdb_tx").get() as { n: number }).n;
  const privCount = (db.prepare("SELECT COUNT(*) as n FROM private_project").get() as { n: number }).n;
  db.close();

  console.log("✓  Seed complete");
  console.log(`   HDB transactions:  ${hdbCount.toLocaleString()}`);
  console.log(`   Private projects:  ${privCount.toLocaleString()}`);
  console.log(`   PSF estimates:     ${psfCount.toLocaleString()}`);
  console.log(`   Database:          ${DB_PATH}`);
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
