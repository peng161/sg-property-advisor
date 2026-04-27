/**
 * Comprehensive condo seeder.
 *
 * Phase 1 — Discovery: asks Claude (Opus 4.7) to enumerate all Singapore
 *   private condominiums and ECs it knows about, district by district.
 *   Validates each name against OneMap — anything not geocodable is dropped.
 *
 * Phase 2 — Geocoding: searches OneMap directly for each project name, groups
 *   all matching blocks into one record (centroid), upserts into
 *   private_property_master.
 *
 * Additive — never drops or overwrites existing master rows.
 * Resumable — skips projects already in the master table.
 *
 * Run:  npm run scrape:condos
 * ETA:  ~15–20 min (Claude call + ~1000 OneMap lookups)
 *
 * Required env vars:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ANTHROPIC_API_KEY
 * Optional:
 *   ONEMAP_TOKEN   — raises OneMap rate limits
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import Anthropic         from "@anthropic-ai/sdk";
import { classify }      from "../lib/property-classifier";

// ── DB ────────────────────────────────────────────────────────────────────────

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function normalizeKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function titleCase(s: string): string {
  const stop = new Set(["a","an","and","at","by","for","in","of","on","the","to","@"]);
  return s.toLowerCase().split(" ").map((w, i) =>
    i === 0 || !stop.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w
  ).join(" ");
}

// ── Phase 1: Claude generates comprehensive condo list ────────────────────────

const anthropic = new Anthropic();

async function discoverViaClaudeKnowledge(): Promise<string[]> {
  console.log("Phase 1: asking Claude to enumerate Singapore condos by district…\n");

  const districts = [
    "D01 Boat Quay / Raffles Place / Marina",
    "D02 Chinatown / Tanjong Pagar",
    "D03 Alexandra / Commonwealth",
    "D04 Harbourfront / Telok Blangah",
    "D05 Buona Vista / West Coast / Clementi",
    "D06 City Hall / Clarke Quay",
    "D07 Beach Road / Bugis / Rochor",
    "D08 Farrer Park / Serangoon Road",
    "D09 Orchard / River Valley",
    "D10 Bukit Timah / Holland Village / Tanglin",
    "D11 Novena / Newton / Thomson",
    "D12 Balestier / Toa Payoh / Serangoon",
    "D13 Macpherson / Potong Pasir",
    "D14 Eunos / Geylang / Paya Lebar",
    "D15 East Coast / Marine Parade / Katong",
    "D16 Bedok / Upper East Coast / Eastwood",
    "D17 Changi / Loyang / Pasir Ris",
    "D18 Pasir Ris / Tampines",
    "D19 Hougang / Punggol / Sengkang",
    "D20 Ang Mo Kio / Bishan / Thomson",
    "D21 Clementi Park / Upper Bukit Timah",
    "D22 Boon Lay / Jurong / Tuas",
    "D23 Bukit Batok / Bukit Panjang / Choa Chu Kang",
    "D24 Lim Chu Kang / Tengah",
    "D25 Admiralty / Woodlands",
    "D26 Mandai / Upper Thomson",
    "D27 Sembawang / Yishun",
    "D28 Seletar / Yio Chu Kang",
  ];

  const allNames: string[] = [];

  // Query Claude district by district so the list stays focused and complete
  for (let i = 0; i < districts.length; i++) {
    const district = districts[i];
    process.stdout.write(`  [${String(i + 1).padStart(2)}/28] ${district} … `);

    try {
      const resp = await anthropic.messages.create({
        model:      "claude-opus-4-7",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content:
            `List every private condominium and Executive Condominium (EC) project in Singapore's ${district} that you know of.\n` +
            `Include all projects: completed, under construction, and recently launched up to your knowledge cutoff.\n` +
            `Return ONLY a JSON array of project name strings. No explanation, no extra text.\n` +
            `Example: ["Parc Riviera","Twin VEW","Seahill"]`,
        }],
      });

      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const m = text.match(/\[[\s\S]*\]/);
      if (m) {
        const names = (JSON.parse(m[0]) as unknown[])
          .filter((v): v is string => typeof v === "string" && v.trim().length > 2)
          .map((s) => s.trim());
        allNames.push(...names);
        process.stdout.write(`${names.length} found\n`);
      } else {
        process.stdout.write("no JSON returned\n");
      }
    } catch (e) {
      process.stdout.write(`error: ${e instanceof Error ? e.message : e}\n`);
    }

    await sleep(500); // small pause between district queries
  }

  // Deduplicate by normalised key
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of allNames) {
    const k = normalizeKey(n);
    if (k.length < 3 || seen.has(k)) continue;
    seen.add(k);
    unique.push(n);
  }

  return unique;
}

// ── Phase 2: geocode each project name via OneMap ─────────────────────────────

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";
const ONEMAP_DELAY  = 250;
const MAX_PAGES     = 4;

interface Block {
  lat:        number;
  lng:        number;
  postal:     string;
  address:    string;
  confidence: number;
  propType:   "Condo" | "EC";
}

async function geocodeProject(
  displayName: string,
  token:       string,
): Promise<{ blocks: Block[]; propertyType: "Condo" | "EC" } | null> {
  const normSearch  = normalizeKey(displayName);
  const blocks: Block[] = [];
  const seenPostals     = new Set<string>();
  let   propertyType: "Condo" | "EC" = "Condo";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(displayName)}` +
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

      // Name must match what we searched for (substring in either direction)
      const normBuilding = normalizeKey(building || searchval);
      const shorter = normBuilding.length <= normSearch.length ? normBuilding : normSearch;
      const longer  = normBuilding.length <= normSearch.length ? normSearch   : normBuilding;
      if (shorter.length < 3 || !longer.includes(shorter)) continue;

      // Use classifier only for property type + reject obvious non-residential buildings.
      // We intentionally do NOT gate on bucket/score here — Claude already told us it's a condo.
      const c = classify(building, searchval, address, postal, lat, lng);
      if (c.bucket === "reject") continue;

      if (seenPostals.has(postal)) continue;
      seenPostals.add(postal);

      if (c.propertyType === "EC") propertyType = "EC";
      blocks.push({ lat, lng, postal, address, confidence: c.score, propType: c.propertyType });
    }

    if (!results.length || page >= totalPages) break;
    await sleep(ONEMAP_DELAY);
  }

  return blocks.length ? { blocks, propertyType } : null;
}

// ── Phase 3: upsert batch into master ────────────────────────────────────────

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
        name, propertyType, best.address,
        JSON.stringify(postalCodes), blocks.length,
        lat, lng, best.confidence,
        "claude-discovery", seededAt,
      ],
    };
  });
  await db.batch(statements as Parameters<typeof db.batch>[0], "write");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const v of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const) {
    if (!process.env[v]) {
      console.error(`✗ ${v} must be set in .env.local`);
      process.exit(1);
    }
  }

  console.log(`Connecting to Turso: ${process.env.TURSO_DATABASE_URL}\n`);

  const token = process.env.ONEMAP_TOKEN ?? "";
  if (!token) console.warn("⚠  ONEMAP_TOKEN not set — unauthenticated\n");

  // ── Phase 1 ──────────────────────────────────────────────────────────────────

  const discovered = await discoverViaClaudeKnowledge();
  console.log(`\n✓ Claude enumerated ${discovered.length} unique project names\n`);

  // ── Skip already-seeded projects ─────────────────────────────────────────────

  const existingRes = await db.execute(
    "SELECT UPPER(REPLACE(REPLACE(project_name,' ',''),'-','')) as n FROM private_property_master"
  );
  const existing = new Set(existingRes.rows.map((r) => String(r.n)));

  const toGeocode = discovered.filter((name) => !existing.has(normalizeKey(name)));

  console.log(`Phase 2: geocoding ${toGeocode.length} new projects via OneMap`);
  console.log(`  (${existing.size} already in DB, skipping)\n`);

  // ── Phase 2 + 3 ───────────────────────────────────────────────────────────────

  const seededAt = new Date().toISOString();
  let geocoded   = 0;
  let notFound   = 0;
  const missed:  string[] = [];
  const pending: Array<{ name: string; geo: { blocks: Block[]; propertyType: "Condo" | "EC" } }> = [];

  for (let i = 0; i < toGeocode.length; i++) {
    const name = toGeocode[i];
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${toGeocode.length}] ${name.padEnd(48)}`);

    const geo = await geocodeProject(name, token);
    if (!geo) {
      process.stdout.write("✗ not found on OneMap\n");
      notFound++;
      missed.push(name);
    } else {
      process.stdout.write(`✓ ${geo.blocks.length} block(s)\n`);
      geocoded++;
      pending.push({ name: titleCase(name), geo });
    }

    if (pending.length >= CHUNK) {
      await upsertBatch(pending.splice(0, CHUNK), seededAt);
    }

    await sleep(ONEMAP_DELAY);
  }

  if (pending.length) await upsertBatch(pending, seededAt);

  // ── Report ────────────────────────────────────────────────────────────────────

  const mCount = await db.execute("SELECT COUNT(*) as n FROM private_property_master");

  console.log("\n══ Scrape Report ═══════════════════════════════════════════════");
  console.log(`  Claude discovered     : ${discovered.length}`);
  console.log(`  Already in DB         : ${existing.size}`);
  console.log(`  Geocoded & inserted   : ${geocoded}`);
  console.log(`  Not found on OneMap   : ${notFound}`);
  console.log(`  DB master total       : ${Number(mCount.rows[0]?.n ?? 0)}`);

  if (missed.length) {
    console.log("\n── Not found on OneMap (new launches or Claude hallucinations) ──");
    for (const m of missed.slice(0, 30)) console.log(`  • ${m}`);
    if (missed.length > 30) console.log(`  … and ${missed.length - 30} more`);
  }

  console.log("\n✓ Scrape complete");
}

main().catch((e) => { console.error("Scrape failed:", e); process.exit(1); });
