/**
 * Area-based condo discovery CLI.
 *
 * Usage:
 *   npm run discover -- Clementi
 *   npm run discover -- "Jurong East"
 *   npm run discover -- Queenstown
 *
 * Strategy:
 *   1. Geocode the area name via OneMap → center lat/lng
 *   2. Search OneMap with area-specific + broad keywords
 *   3. Filter all results to within RADIUS_KM of the center
 *   4. Classify (same rules as the full seed)
 *   5. Upsert new projects into DB; queue borderline ones as candidates
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

// ── CLI ───────────────────────────────────────────────────────────────────────

const area = process.argv.slice(2).join(" ").trim();
if (!area) {
  console.error('\nError: Please provide an area name.');
  console.error('Example: npm run discover -- Clementi\n');
  process.exit(1);
}

// ── DB ────────────────────────────────────────────────────────────────────────

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";
const RADIUS_KM     = 2;
const CHUNK         = 500;
const PAGE_DELAY_MS = 110;

// ── Classifier (same rules as seed-condos.ts) ─────────────────────────────────

const REJECT_PHRASES = [
  "GARDENS BY THE BAY", "MRT STATION", "MRT EXIT", "STATION EXIT",
  "BUS STOP", "AVENUE TOWARDS", "ROAD TOWARDS", "EXPRESSWAY",
  "PARK CONNECTOR", "NATURE RESERVE", "SCHOOL", "HOSPITAL", "CLINIC",
  "CHURCH", "TEMPLE", "MOSQUE", "COMMUNITY CENTRE",
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

type Bucket = "master" | "candidate" | "reject";

interface Classified {
  bucket:       Bucket;
  score:        number;
  reason:       string;
  projectName:  string;
  propertyType: "Condo" | "EC";
}

function classify(
  building: string, searchval: string, address: string,
  postal: string, lat: number, lng: number,
): Classified {
  const rawBuilding = (building || searchval || "").trim();
  const b     = rawBuilding.toUpperCase();
  const a     = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  for (const phrase of REJECT_PHRASES) {
    if (combo.includes(phrase))
      return { bucket: "reject", score: 0, reason: `reject: "${phrase}"`, projectName: rawBuilding, propertyType: "Condo" };
  }
  if (/\bERP\b/.test(combo))
    return { bucket: "reject", score: 0, reason: 'reject: "ERP"', projectName: rawBuilding, propertyType: "Condo" };

  let score = 0;
  const reasons: string[] = [];
  let isEC = false;

  for (const term of HIGH_CONF_TERMS) {
    if (combo.includes(term)) {
      score += 4; reasons.push(`+4 "${term}"`);
      if (term === "EXECUTIVE CONDOMINIUM") isEC = true;
      break;
    }
  }

  const cleanPostal = postal.replace(/\D/g, "");
  if (rawBuilding.length > 0 && cleanPostal.length === 6 && lat && lng) {
    const wc              = b.split(/\s+/).filter(Boolean).length;
    const isBuildingBlock = /^(BLK|BLOCK)\s*\d/i.test(rawBuilding);
    const startsDigit     = /^\d/.test(rawBuilding);
    if (!isBuildingBlock && !startsDigit && !ROAD_SUFFIX_RE.test(b) && wc >= 2 && wc <= 5) {
      score += 2; reasons.push("+2 named project");
    }
  }

  for (const word of BRANDING_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(b)) { score += 1; reasons.push(`+1 "${word}"`); break; }
  }

  const projectName  = rawBuilding || address.split(" ").slice(0, 4).join(" ");
  const propertyType = isEC ? "EC" : "Condo" as const;
  const reasonStr    = reasons.join(", ") || "no positive signals";

  if (score < 2)  return { bucket: "reject",    score, reason: `score ${score}: ${reasonStr}`, projectName, propertyType };
  if (score <= 3) return { bucket: "candidate", score, reason: reasonStr, projectName, propertyType };
  return               { bucket: "master",    score, reason: reasonStr, projectName, propertyType };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(name: string) { return name.toUpperCase().replace(/\s+/g, " ").trim(); }
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── OneMap geocode ─────────────────────────────────────────────────────────────

interface OneMapResult {
  BUILDING: string; SEARCHVAL: string; ADDRESS: string; POSTAL: string;
  LATITUDE: string; LONGITUDE: string; LONGTITUDE: string;
}

async function geocodeArea(name: string): Promise<{ lat: number; lng: number; label: string }> {
  const url = `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(name)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OneMap returned HTTP ${res.status}`);
  const data = await res.json() as { results?: OneMapResult[] };
  if (!data.results?.length) throw new Error(`Area not found on OneMap: "${name}"`);
  const r   = data.results[0];
  const lat = Number(r.LATITUDE);
  const lng = Number(r.LONGITUDE || r.LONGTITUDE);
  if (!lat || !lng) throw new Error(`No coordinates returned for: "${name}"`);
  return { lat, lng, label: r.ADDRESS || r.BUILDING || name };
}

// ── OneMap keyword search (all pages, filter by radius) ───────────────────────

interface DiscoveredRecord {
  project_name: string; property_type: "Condo" | "EC";
  address: string; postal_code: string;
  lat: number; lng: number;
  score: number; reason: string; bucket: Bucket;
  dist_km: number;
}

async function searchKeyword(
  keyword: string,
  centerLat: number, centerLng: number,
  headers: Record<string, string>,
  maxPages = 80,
): Promise<{ records: DiscoveredRecord[]; rawCount: number }> {
  const records: DiscoveredRecord[] = [];
  let rawCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(keyword)}&returnGeom=Y&getAddrDetails=Y&pageNum=${page}`;
    let data: { totalNumPages?: number; results?: OneMapResult[] };
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) break;
      data = await res.json();
    } catch { break; }

    const results   = data.results ?? [];
    const lastPage  = data.totalNumPages ?? 1;
    rawCount += results.length;

    for (const r of results) {
      const lat = Number(r.LATITUDE);
      const lng = Number(r.LONGITUDE || r.LONGTITUDE);
      if (!lat || !lng) continue;

      const distKm = haversineKm(centerLat, centerLng, lat, lng);
      if (distKm > RADIUS_KM) continue;

      const postal   = (r.POSTAL    || "").replace(/\D/g, "");
      const building = (r.BUILDING  || "").trim();
      const sv       = (r.SEARCHVAL || "").trim();
      const address  = (r.ADDRESS   || "").trim();

      const c = classify(building, sv, address, postal, lat, lng);
      if (c.bucket === "reject") continue;

      records.push({
        project_name:  c.projectName,
        property_type: c.propertyType,
        address,
        postal_code:   postal,
        lat, lng,
        score:         c.score,
        reason:        c.reason,
        bucket:        c.bucket,
        dist_km:       Math.round(distKm * 100) / 100,
      });
    }

    if (!results.length || page >= lastPage) break;
    await sleep(PAGE_DELAY_MS);
  }

  return { records, rawCount };
}

// ── Build keyword list ────────────────────────────────────────────────────────
// Combines area-specific searches (fast, targeted) with broad ones (filtered by radius).

function buildKeywords(area: string): string[] {
  const a = area.trim();
  return [
    // Area-specific (most targeted)
    a,
    `${a} condominium`,
    `${a} executive condominium`,
    `${a} residences`,
    `${a} residence`,
    `${a} apartments`,
    `${a} park`,
    `${a} parc`,
    `${a} view`,
    `${a} heights`,
    `${a} hill`,
    `${a} crest`,
    `${a} grove`,
    // Broad terms — filtered by radius (catch condos without the area in their name)
    "condominium",
    "executive condominium",
    "residences",
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error("\nError: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env.local\n");
    process.exit(1);
  }

  console.log(`\n🔍  Discovering condos in: ${area}`);
  console.log("─".repeat(55));

  // Geocode
  let centerLat: number, centerLng: number, areaLabel: string;
  try {
    ({ lat: centerLat, lng: centerLng, label: areaLabel } = await geocodeArea(area));
  } catch (e) {
    console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }

  console.log(`📍  ${areaLabel}`);
  console.log(`    lat ${centerLat.toFixed(5)}, lng ${centerLng.toFixed(5)}, radius ${RADIUS_KM} km\n`);

  const token   = process.env.ONEMAP_TOKEN ?? "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (!token) console.warn("⚠   ONEMAP_TOKEN not set — unauthenticated (rate limits may apply)\n");

  const keywords = buildKeywords(area);
  const seen     = new Set<string>(); // project_name|postal_code dedupe
  const masters: DiscoveredRecord[] = [];
  const candidates: DiscoveredRecord[] = [];
  let totalRaw = 0;

  for (const kw of keywords) {
    process.stdout.write(`  [${kw}] scanning…`);
    const { records, rawCount } = await searchKeyword(kw, centerLat, centerLng, headers);
    totalRaw += rawCount;

    let added = 0;
    for (const rec of records) {
      const key = `${normalize(rec.project_name)}|${rec.postal_code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added++;
      if (rec.bucket === "master") masters.push(rec);
      else candidates.push(rec);
    }
    process.stdout.write(` ${rawCount} results → ${added} new condos within ${RADIUS_KM}km\n`);
  }

  console.log(`\n  Total buildings scanned: ${totalRaw}`);
  console.log(`  Condos found           : ${masters.length + candidates.length}`);
  console.log(`    Master-quality       : ${masters.length}`);
  console.log(`    Needs review         : ${candidates.length}\n`);

  // Load existing master names to avoid stomping data
  const existingRes   = await db.execute("SELECT project_name FROM private_property_master");
  const existingNames = new Set(existingRes.rows.map((r) => normalize(String(r.project_name))));

  // Group masters by project_name → compute centroid
  const masterGroups = new Map<string, DiscoveredRecord[]>();
  for (const r of masters) {
    const key = normalize(r.project_name);
    if (!masterGroups.has(key)) masterGroups.set(key, []);
    masterGroups.get(key)!.push(r);
  }

  const seededAt   = new Date().toISOString();
  let newAdded = 0;
  let updated  = 0;
  const newlyAdded = new Map<string, DiscoveredRecord[]>();

  // Upsert each project group
  for (const [normName, records] of masterGroups) {
    const best = records.reduce((b, r) => r.score > b.score ? r : b, records[0]);
    const lat  = records.reduce((s, r) => s + r.lat, 0) / records.length;
    const lng  = records.reduce((s, r) => s + r.lng, 0) / records.length;
    const postalCodes = [...new Set(records.map((r) => r.postal_code).filter(Boolean))];

    const exRes = await db.execute({
      sql:  "SELECT postal_codes, block_count, lat, lng FROM private_property_master WHERE project_name = ?",
      args: [best.project_name],
    });

    if (exRes.rows.length > 0) {
      const ex = exRes.rows[0];
      const exPostals: string[] = JSON.parse(String(ex.postal_codes || "[]"));
      const exCount   = Number(ex.block_count) || 1;
      const newCount  = exCount + records.length;
      const allCodes  = [...new Set([...exPostals, ...postalCodes])];
      const mLat = (Number(ex.lat) * exCount + lat * records.length) / newCount;
      const mLng = (Number(ex.lng) * exCount + lng * records.length) / newCount;
      await db.execute({
        sql:  "UPDATE private_property_master SET postal_codes=?, block_count=?, lat=?, lng=?, seeded_at=? WHERE project_name=?",
        args: [JSON.stringify(allCodes), newCount, mLat, mLng, seededAt, best.project_name],
      });
      updated++;
      existingNames.add(normName); // mark as now-in-master for candidate filter
    } else {
      await db.execute({
        sql:  "INSERT OR IGNORE INTO private_property_master (project_name, property_type, address, postal_codes, block_count, lat, lng, confidence_score, source_keyword, seeded_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [best.project_name, best.property_type, best.address, JSON.stringify(postalCodes), records.length, lat, lng, best.score, area, seededAt],
      });
      newAdded++;
      newlyAdded.set(normName, records);
      existingNames.add(normName);
    }
  }

  // Write candidates — skip any project_name already in master
  const masterNames = new Set([...masterGroups.keys()]);
  const newCandidates = candidates.filter(
    (r) => !masterNames.has(normalize(r.project_name)) && !existingNames.has(normalize(r.project_name)),
  );

  if (newCandidates.length > 0) {
    const candRows = newCandidates.map((r) => ({
      sql:  "INSERT OR IGNORE INTO private_property_candidates (project_name, property_type, address, postal_code, lat, lng, confidence_score, reason, source_keyword, seeded_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [r.project_name, r.property_type, r.address, r.postal_code, r.lat, r.lng, r.score, r.reason, area, seededAt],
    }));
    for (let i = 0; i < candRows.length; i += CHUNK) {
      await db.batch(candRows.slice(i, i + CHUNK), "write");
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("── Results " + "─".repeat(44));
  console.log(`  New master projects added : ${newAdded}`);
  console.log(`  Existing projects updated : ${updated}`);
  console.log(`  New candidates queued     : ${newCandidates.length}`);

  if (newAdded > 0) {
    console.log("\n  New projects:");
    for (const [, records] of newlyAdded) {
      const best = records.reduce((b, r) => r.score > b.score ? r : b, records[0]);
      console.log(`    [score ${best.score}] ${best.project_name}  (${records.length} block${records.length > 1 ? "s" : ""}, ~${best.dist_km}km)`);
    }
  }

  if (updated > 0) {
    console.log(`\n  Updated ${updated} existing project${updated > 1 ? "s" : ""} with new block data.`);
  }

  if (newCandidates.length > 0) {
    console.log("\n  Candidates (review at /admin):");
    for (const c of newCandidates.slice(0, 15)) {
      console.log(`    [score ${c.score}] ${c.project_name}  ${c.postal_code}  ~${c.dist_km}km`);
    }
    if (newCandidates.length > 15)
      console.log(`    … and ${newCandidates.length - 15} more`);
  }

  console.log("\n✓  Done.\n");
}

main().catch((e) => { console.error("Discovery failed:", e); process.exit(1); });
