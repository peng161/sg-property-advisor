/**
 * Comprehensive condo seeder.
 *
 * Phase 1 — Discovery: pages through the entire URA REALIS private residential
 *   transaction dataset on data.gov.sg to collect every distinct project name
 *   (Condominium, Executive Condominium, Apartment).
 *
 * Phase 2 — Geocoding: searches OneMap directly for each project name, groups
 *   all matching blocks into one record (centroid), then upserts into
 *   private_property_master.
 *
 * Additive — never drops or overwrites existing master rows.
 * Resumable — skips projects already in the master table.
 *
 * Run:  npm run scrape:condos
 * ETA:  ~20 min for ~2 000 projects (rate-limited on CKAN end)
 *
 * Required env vars:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 * Optional:
 *   ONEMAP_TOKEN   — raises OneMap rate limits
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { classify } from "../lib/property-classifier";

// ── DB ────────────────────────────────────────────────────────────────────────

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// ── CKAN (URA REALIS private residential transactions) ────────────────────────

const CKAN_BASE   = "https://data.gov.sg/api/action/datastore_search";
const RESOURCE_ID = "42ff9c2b-3a03-4c8c-9e4c-9e7f5c1b0cbb";

const RESIDENTIAL_TYPES = new Set([
  "Condominium",
  "Executive Condominium",
  "Apartment",
]);

interface CkanRow {
  project_name?:  string;
  property_type?: string;
  street_name?:   string;
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

async function fetchCkanPage(
  offset: number,
  limit:  number,
): Promise<{ rows: CkanRow[]; total: number } | null> {
  const url =
    `${CKAN_BASE}?resource_id=${RESOURCE_ID}` +
    `&limit=${limit}&offset=${offset}` +
    `&fields=project_name,property_type,street_name`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept:       "application/json",
          "User-Agent": "sg-property-advisor/1.0",
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (res.status === 429) {
        const wait = attempt * 12_000;
        process.stdout.write(`  ⚠ rate-limited, waiting ${wait / 1000}s…\r`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        process.stdout.write(`  ✗ CKAN HTTP ${res.status}\n`);
        return null;
      }

      const json = (await res.json()) as {
        result?: { records?: CkanRow[]; total?: number };
      };
      const rows  = json.result?.records ?? [];
      const total = json.result?.total   ?? 0;
      return { rows, total };

    } catch (e) {
      if (attempt === 4) {
        process.stdout.write(`  ✗ CKAN fetch error: ${e}\n`);
        return null;
      }
      await sleep(3_000 * attempt);
    }
  }
  return null;
}

// ── Phase 1: collect all distinct project names from CKAN ─────────────────────

interface ProjectMeta {
  propertyType: "Condo" | "EC";
  streetName:   string;
}

async function discoverProjects(): Promise<Map<string, ProjectMeta>> {
  const projects = new Map<string, ProjectMeta>(); // project_name (upper) → meta

  const PAGE_SIZE  = 2000;
  const CKAN_DELAY = 1500; // ms between pages — stays well under rate limit

  console.log("Phase 1: discovering project names from URA REALIS…\n");

  // First call to find total
  const first = await fetchCkanPage(0, PAGE_SIZE);
  if (!first) { console.error("✗ Failed to reach CKAN"); process.exit(1); }

  const total = first.total;
  const pages = Math.ceil(total / PAGE_SIZE);
  console.log(`  Total CKAN records : ${total.toLocaleString()}`);
  console.log(`  Pages (${PAGE_SIZE}/page) : ${pages}\n`);

  // Process first page
  for (const r of first.rows) {
    const name  = (r.project_name  || "").trim().toUpperCase();
    const ptype = (r.property_type || "").trim();
    const st    = (r.street_name   || "").trim();
    if (!name || !RESIDENTIAL_TYPES.has(ptype)) continue;
    if (!projects.has(name)) {
      projects.set(name, {
        propertyType: ptype === "Executive Condominium" ? "EC" : "Condo",
        streetName:   st,
      });
    }
  }

  process.stdout.write(`  [page 1/${pages}] ${projects.size} unique projects so far\r`);

  for (let page = 2; page <= pages; page++) {
    await sleep(CKAN_DELAY);
    const result = await fetchCkanPage((page - 1) * PAGE_SIZE, PAGE_SIZE);
    if (!result) break;

    for (const r of result.rows) {
      const name  = (r.project_name  || "").trim().toUpperCase();
      const ptype = (r.property_type || "").trim();
      const st    = (r.street_name   || "").trim();
      if (!name || !RESIDENTIAL_TYPES.has(ptype)) continue;
      if (!projects.has(name)) {
        projects.set(name, {
          propertyType: ptype === "Executive Condominium" ? "EC" : "Condo",
          streetName:   st,
        });
      }
    }

    process.stdout.write(`  [page ${page}/${pages}] ${projects.size} unique projects so far    \r`);
  }

  process.stdout.write("\n");
  return projects;
}

// ── Phase 2: geocode each project via OneMap ──────────────────────────────────

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";
const ONEMAP_DELAY  = 250; // ms between lookups — OneMap unauthenticated is lenient
const MAX_PAGES     = 4;   // no condo needs more than 4 pages of blocks

interface Block {
  lat:        number;
  lng:        number;
  postal:     string;
  address:    string;
  confidence: number;
}

function normalizeForMatch(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function geocodeProject(
  projectName: string,
  streetName:  string,
  token:       string,
): Promise<{ blocks: Block[]; propertyType: "Condo" | "EC" } | null> {
  const normSearch  = normalizeForMatch(projectName);
  const blocks: Block[] = [];
  const seenPostals     = new Set<string>();
  let   propertyType: "Condo" | "EC" = "Condo";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  // Try the project name first; if no hits, try appending street name
  const queries = [projectName];
  if (streetName) queries.push(`${projectName} ${streetName}`);

  for (const query of queries) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(query)}` +
        `&returnGeom=Y&getAddrDetails=Y&pageNum=${page}`;

      let data: { totalNumPages?: number; results?: Array<{
        BUILDING: string; SEARCHVAL: string; ADDRESS: string;
        POSTAL: string; LATITUDE: string; LONGITUDE: string; LONGTITUDE: string;
      }> };

      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) break;
        data = await res.json() as typeof data;
      } catch { break; }

      const results    = data.results ?? [];
      const totalPages = data.totalNumPages ?? 1;

      for (const r of results) {
        const building  = (r.BUILDING  || "").trim();
        const searchval = (r.SEARCHVAL || "").trim();
        const address   = (r.ADDRESS   || "").trim();
        const postal    = (r.POSTAL    || "").replace(/\D/g, "");
        const lat       = Number(r.LATITUDE);
        const lng       = Number(r.LONGITUDE || r.LONGTITUDE);

        if (!lat || !lng) continue;

        // Must be a close name match — avoids accepting completely unrelated buildings
        const normBuilding = normalizeForMatch(building || searchval);
        const shorter = normBuilding.length < normSearch.length ? normBuilding : normSearch;
        const longer  = normBuilding.length < normSearch.length ? normSearch   : normBuilding;
        if (!longer.includes(shorter) || shorter.length < 4) continue;

        const c = classify(building, searchval, address, postal, lat, lng);
        if (c.bucket === "reject") continue;

        if (seenPostals.has(postal)) continue;
        seenPostals.add(postal);

        if (c.propertyType === "EC") propertyType = "EC";
        blocks.push({ lat, lng, postal, address, confidence: c.score });
      }

      if (!results.length || page >= totalPages) break;
      await sleep(ONEMAP_DELAY);
    }

    if (blocks.length) break; // found via first query, no need for fallback
  }

  return blocks.length ? { blocks, propertyType } : null;
}

// ── Phase 3: upsert into master ───────────────────────────────────────────────

const CHUNK = 50;

async function upsertBatch(
  batch:    Array<{ name: string; geo: { blocks: Block[]; propertyType: "Condo" | "EC" } }>,
  seededAt: string,
): Promise<void> {
  const statements = batch.map(({ name, geo }) => {
    const { blocks, propertyType } = geo;
    const postalCodes = [...new Set(blocks.map((b) => b.postal).filter(Boolean))];
    const lat         = blocks.reduce((s, b) => s + b.lat, 0) / blocks.length;
    const lng         = blocks.reduce((s, b) => s + b.lng, 0) / blocks.length;
    const best        = blocks.reduce((b, r) => r.confidence > b.confidence ? r : b, blocks[0]);
    return {
      sql: `INSERT OR IGNORE INTO private_property_master
              (project_name, property_type, address, postal_codes, block_count,
               lat, lng, confidence_score, source_keyword, seeded_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        // Use title-case from canonical project name (capitalise each word)
        name.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "),
        propertyType,
        best.address,
        JSON.stringify(postalCodes),
        blocks.length,
        lat,
        lng,
        best.confidence,
        "ura-realis-scrape",
        seededAt,
      ],
    };
  });
  await db.batch(statements as Parameters<typeof db.batch>[0], "write");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error("✗ TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env.local");
    process.exit(1);
  }

  console.log(`Connecting to Turso: ${process.env.TURSO_DATABASE_URL}\n`);

  const token = process.env.ONEMAP_TOKEN ?? "";
  if (!token) console.warn("⚠  ONEMAP_TOKEN not set — unauthenticated (may be slower)\n");

  // ── Phase 1: collect project names from URA REALIS ──────────────────────────

  const projectMap = await discoverProjects();
  const allProjects = [...projectMap.entries()]; // [UPPERCASE_NAME, meta]
  console.log(`\n✓ Discovered ${allProjects.length} unique residential projects\n`);

  // ── Load already-seeded names to skip them (resume support) ─────────────────

  const existingRes = await db.execute("SELECT UPPER(project_name) as n FROM private_property_master");
  const existing    = new Set(existingRes.rows.map((r) => String(r.n)));
  const toGeocode   = allProjects.filter(([name]) => !existing.has(name));

  console.log(`Phase 2: geocoding ${toGeocode.length} new projects via OneMap`);
  console.log(`  (${existing.size} already in DB, skipping)\n`);

  // ── Phase 2: geocode ─────────────────────────────────────────────────────────

  const seededAt = new Date().toISOString();
  let geocoded   = 0;
  let notFound   = 0;
  const missed:  string[] = [];
  const pending: Array<{ name: string; geo: { blocks: Block[]; propertyType: "Condo" | "EC" } }> = [];

  for (let i = 0; i < toGeocode.length; i++) {
    const [upperName, meta] = toGeocode[i];

    // Use title-case for the OneMap search query
    const searchName = upperName.split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    process.stdout.write(
      `  [${String(i + 1).padStart(4)}/${toGeocode.length}] ${searchName.padEnd(48)}`
    );

    const geo = await geocodeProject(searchName, meta.streetName, token);

    if (!geo) {
      process.stdout.write("✗ not found\n");
      notFound++;
      missed.push(searchName);
    } else {
      process.stdout.write(`✓ ${geo.blocks.length} block(s)\n`);
      geocoded++;
      pending.push({ name: upperName, geo });
    }

    // Flush batch every CHUNK records
    if (pending.length >= CHUNK) {
      await upsertBatch(pending.splice(0, CHUNK), seededAt);
    }

    await sleep(ONEMAP_DELAY);
  }

  // Flush remainder
  if (pending.length) await upsertBatch(pending, seededAt);

  // ── Final counts ──────────────────────────────────────────────────────────────

  const [mCount] = await Promise.all([
    db.execute("SELECT COUNT(*) as n FROM private_property_master"),
  ]);
  const masterTotal = Number(mCount.rows[0]?.n ?? 0);

  console.log("\n══ Scrape Report ═══════════════════════════════════════════════");
  console.log(`  Projects discovered (URA) : ${allProjects.length}`);
  console.log(`  Already in DB (skipped)   : ${existing.size}`);
  console.log(`  Geocoded & inserted       : ${geocoded}`);
  console.log(`  Not found on OneMap       : ${notFound}`);
  console.log(`  DB master total           : ${masterTotal}`);

  if (missed.length) {
    console.log("\n── Not found on OneMap (may be new launches or name variants) ──");
    for (const m of missed.slice(0, 30)) console.log(`  • ${m}`);
    if (missed.length > 30) console.log(`  … and ${missed.length - 30} more`);
  }

  console.log("\n✓ Scrape complete");
}

main().catch((e) => { console.error("Scrape failed:", e); process.exit(1); });
