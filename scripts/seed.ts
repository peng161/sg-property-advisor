/**
 * Seed script — pulls 5 years of HDB + private transactions, geocodes unique
 * addresses via OneMap, and upserts into MongoDB.
 *
 * Run once:  npm run seed
 * Requires:  MONGODB_URI in .env.local
 *            URA_ACCESS_KEY in .env.local (optional — uses mock private data without it)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import mongoose from "mongoose";
import { HdbTx } from "../lib/models/HdbTx";
import { PrivateProject } from "../lib/models/PrivateProject";

// ── constants ────────────────────────────────────────────────────────────────

const HDB_RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
const CURRENT_YEAR    = new Date().getFullYear();
const START_YEAR      = CURRENT_YEAR - 5;

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

// ── types ─────────────────────────────────────────────────────────────────────

interface RawHdb { [key: string]: string }

interface PrivateTx {
  project: string; street: string; district: string;
  marketSegment: "OCR" | "RCR" | "CCR"; tenure: string;
  price: number; sqm: number; pricePerSqm: number;
  contractDate: string; // "YYYY-MM"
}

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

function trend3Y(dates: string[], psms: number[]): number {
  if (dates.length < 2) return 0;
  const pairs = dates.map((d, i) => ({ d, psm: psms[i] })).sort((a, b) => a.d.localeCompare(b.d));
  const first = pairs[0].psm;
  const last  = pairs[pairs.length - 1].psm;
  return first > 0 ? +((last - first) / first * 100).toFixed(1) : 0;
}

// ── geocoding ─────────────────────────────────────────────────────────────────

const geoCache = new Map<string, [number, number] | null>();

async function geocodeOneMap(query: string): Promise<[number, number] | null> {
  if (geoCache.has(query)) return geoCache.get(query)!;
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const json = await res.json() as { results?: { LATITUDE: string; LONGITUDE?: string; LONGTITUDE?: string }[] };
    const r = json.results?.[0];
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

async function geocodeBulk(queries: string[], concurrency = 8, delayMs = 150) {
  const out = new Map<string, [number, number] | null>();
  for (let i = 0; i < queries.length; i += concurrency) {
    const batch = queries.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (q) => [q, await geocodeOneMap(q)] as const));
    for (const [q, r] of results) out.set(q, r);
    if (i + concurrency < queries.length) await sleep(delayMs);
    process.stdout.write(`\r  Geocoded: ${Math.min(i + concurrency, queries.length)}/${queries.length}`);
  }
  process.stdout.write("\n");
  return out;
}

// ── HDB data fetching ─────────────────────────────────────────────────────────

async function fetchHdbYear(year: number): Promise<RawHdb[]> {
  const rows: RawHdb[] = [];
  let offset = 0;
  const limit = 5000;
  while (true) {
    const sql = `SELECT * FROM "${HDB_RESOURCE_ID}" WHERE month >= '${year}-01' AND month <= '${year}-12' LIMIT ${limit} OFFSET ${offset}`;
    const url  = `https://data.gov.sg/api/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
    try {
      const res  = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const json = await res.json() as { result?: { records?: RawHdb[] } };
      const batch = json?.result?.records ?? [];
      rows.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
      await sleep(500);
    } catch (e) {
      console.error(`\n  Error fetching year ${year} offset ${offset}:`, e);
      break;
    }
  }
  return rows;
}

// ── private transaction fetching (URA) ────────────────────────────────────────

async function fetchPrivateTxs(): Promise<PrivateTx[]> {
  const accessKey = process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    console.log("  No URA_ACCESS_KEY — skipping private data (run with key for real data)");
    return [];
  }

  try {
    const tokenRes = await fetch(
      "https://eservice.ura.gov.sg/uraDataService/insertNewToken.action?service=PMI_Resi_Transaction",
      { headers: { AccessKey: accessKey } }
    );
    const tokenJson = await tokenRes.json() as { Status: string; Result: string };
    if (tokenJson.Status !== "Success") throw new Error("URA token failed");
    const token = tokenJson.Result;

    const condoTypes = new Set(["Condominium", "Apartment"]);
    const all: PrivateTx[] = [];

    for (const batch of [1, 2, 3, 4]) {
      process.stdout.write(`  Fetching URA batch ${batch}... `);
      try {
        const res = await fetch(
          `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batch}`,
          { headers: { AccessKey: accessKey, Token: token } }
        );
        const json = await res.json() as { Status: string; Result: { project: string; street: string; district: string; marketSegment: string; propertyType: string; tenure: string; price: string; area: string; contractDate: string }[] };
        if (json.Status !== "Success") throw new Error("bad status");

        for (const raw of json.Result) {
          if (!condoTypes.has(raw.propertyType)) continue;
          const price = Number(raw.price);
          const sqm   = Number(raw.area);
          if (!price || !sqm) continue;
          const yy   = raw.contractDate.slice(0, 2);
          const mm   = raw.contractDate.slice(2, 4);
          const year = Number(yy) < 50 ? `20${yy}` : `19${yy}`;
          const seg  = (raw.marketSegment ?? "OCR").toUpperCase();
          all.push({
            project:       raw.project,
            street:        raw.street,
            district:      raw.district,
            marketSegment: seg === "CCR" ? "CCR" : seg === "RCR" ? "RCR" : "OCR",
            tenure:        parseTenure(raw.tenure),
            price,
            sqm,
            pricePerSqm:   Math.round(price / sqm),
            contractDate:  `${year}-${mm}`,
          });
        }
        console.log(`${json.Result.length} txs`);
        await sleep(500);
      } catch (e) {
        console.log(`failed: ${e}`);
      }
    }
    return all;
  } catch (e) {
    console.error("  URA fetch error:", e);
    return [];
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error("❌  MONGODB_URI not set in .env.local"); process.exit(1); }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri, { bufferCommands: false });
  console.log("✓  Connected\n");

  // ── HDB ────────────────────────────────────────────────────────────────────

  console.log(`Fetching HDB resale data: ${START_YEAR}–${CURRENT_YEAR}`);
  const allHdb: RawHdb[] = [];
  for (let year = START_YEAR; year <= CURRENT_YEAR; year++) {
    process.stdout.write(`  Year ${year}... `);
    const rows = await fetchHdbYear(year);
    console.log(`${rows.length} records`);
    allHdb.push(...rows);
    await sleep(800);
  }
  console.log(`Total HDB records: ${allHdb.length}\n`);

  // Geocode unique HDB block+street
  const uniqueHdbAddr = [...new Set(allHdb.map((r) => `BLK ${r.block} ${r.street_name}`))];
  console.log(`Geocoding ${uniqueHdbAddr.length} unique HDB addresses via OneMap...`);
  const hdbGeo = await geocodeBulk(uniqueHdbAddr);

  const geocoded  = [...hdbGeo.values()].filter(Boolean).length;
  const notFound  = uniqueHdbAddr.length - geocoded;
  console.log(`  Geocoded: ${geocoded}  Not found: ${notFound}\n`);

  // Upsert HDB records
  console.log("Upserting HDB transactions into MongoDB...");
  let hdbOk = 0, hdbSkip = 0;
  for (const row of allHdb) {
    const key    = `BLK ${row.block} ${row.street_name}`;
    const coords = hdbGeo.get(key);
    if (!coords) { hdbSkip++; continue; }

    const price = Number(row.resale_price);
    const sqm   = Number(row.floor_area_sqm);
    if (!price || !sqm) { hdbSkip++; continue; }

    const [lat, lng] = coords;
    try {
      await HdbTx.updateOne(
        { block: row.block, streetName: row.street_name, flatType: row.flat_type, storeyRange: row.storey_range, month: row.month },
        { $set: {
          block:             row.block,
          streetName:        row.street_name,
          town:              row.town ?? "",
          flatType:          row.flat_type,
          storeyRange:       row.storey_range,
          sqm,
          resalePrice:       price,
          pricePerSqm:       Math.round(price / sqm),
          month:             row.month,
          leaseCommenceYear: Number(row.lease_commence_date) || 0,
          remainingLease:    parseRemainingLease(row.remaining_lease ?? ""),
          location:          { type: "Point", coordinates: [lng, lat] },
        }},
        { upsert: true }
      );
      hdbOk++;
    } catch (e: any) {
      if (e.code !== 11000) console.error("\nHDB upsert error:", e.message);
      hdbSkip++;
    }
    if (hdbOk % 1000 === 0) process.stdout.write(`\r  ${hdbOk} upserted...`);
  }
  console.log(`\n  Done: ${hdbOk} upserted, ${hdbSkip} skipped\n`);

  // ── Private ────────────────────────────────────────────────────────────────

  console.log("Fetching private transactions from URA...");
  const privateTxs = await fetchPrivateTxs();
  console.log(`Total private transactions: ${privateTxs.length}\n`);

  if (privateTxs.length > 0) {
    // Aggregate by project
    type ProjectBucket = {
      street: string; district: string; marketSegment: "OCR" | "RCR" | "CCR"; tenure: string;
      prices: number[]; psms: number[]; sqms: number[]; dates: string[];
    };
    const byProject = new Map<string, ProjectBucket>();
    for (const tx of privateTxs) {
      const b = byProject.get(tx.project);
      if (!b) {
        byProject.set(tx.project, {
          street: tx.street, district: tx.district, marketSegment: tx.marketSegment, tenure: tx.tenure,
          prices: [tx.price], psms: [tx.pricePerSqm], sqms: [tx.sqm], dates: [tx.contractDate],
        });
      } else {
        b.prices.push(tx.price); b.psms.push(tx.pricePerSqm);
        b.sqms.push(tx.sqm);    b.dates.push(tx.contractDate);
      }
    }

    // Geocode unique streets
    const uniqueStreets = [...new Set([...byProject.values()].map((p) => p.street))];
    console.log(`Geocoding ${uniqueStreets.length} private project streets...`);
    const privateGeo = await geocodeBulk(uniqueStreets, 5, 200);

    // Upsert private projects
    console.log("Upserting private projects...");
    let privOk = 0;
    for (const [project, b] of byProject) {
      const coords = privateGeo.get(b.street);
      const centroid = DISTRICT_CENTROIDS[b.district.padStart(2, "0")] ?? [1.3521, 103.8198];
      const [lat, lng] = coords ?? centroid;

      const sortedDates = [...b.dates].sort();
      try {
        await PrivateProject.updateOne(
          { project },
          { $set: {
            project,
            street:        b.street,
            district:      b.district,
            marketSegment: b.marketSegment,
            tenure:        b.tenure,
            minPrice:      Math.min(...b.prices),
            maxPrice:      Math.max(...b.prices),
            medianPsm:     median(b.psms),
            txCount:       b.prices.length,
            latestDate:    sortedDates[sortedDates.length - 1],
            minSqm:        Math.min(...b.sqms),
            maxSqm:        Math.max(...b.sqms),
            trend3Y:       trend3Y(b.dates, b.psms),
            location:      { type: "Point", coordinates: [lng, lat] },
          }},
          { upsert: true }
        );
        privOk++;
      } catch (e: any) {
        if (e.code !== 11000) console.error("\nPrivate upsert error:", e.message);
      }
    }
    console.log(`  Done: ${privOk} projects upserted\n`);
  }

  const hdbCount  = await HdbTx.countDocuments();
  const privCount = await PrivateProject.countDocuments();
  console.log("✓  Seed complete");
  console.log(`   HDB transactions:  ${hdbCount}`);
  console.log(`   Private projects:  ${privCount}`);
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); })
  .finally(() => mongoose.disconnect());
