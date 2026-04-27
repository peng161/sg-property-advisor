/**
 * Geocodes a curated list of condo project names via OneMap and upserts into
 * private_property_master. Additive — never wipes existing data.
 *
 * Usage:
 *   npm run seed:known                      # reads data/condo-names.txt
 *   npm run seed:known -- data/my-list.txt  # custom file
 *
 * Required env vars (in .env.local):
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { join } from "path";
import { classify } from "../lib/property-classifier";

// ── DB ────────────────────────────────────────────────────────────────────────

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// ── OneMap ────────────────────────────────────────────────────────────────────

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";
const PAGE_DELAY    = 200; // ms between calls — OneMap unauthenticated is lenient
const MAX_PAGES     = 5;   // no condo needs more than 5 pages of blocks

interface OneMapResult {
  BUILDING:   string;
  SEARCHVAL:  string;
  ADDRESS:    string;
  POSTAL:     string;
  LATITUDE:   string;
  LONGITUDE:  string;
  LONGTITUDE: string;
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
function normalize(s: string) { return s.toUpperCase().replace(/[^A-Z0-9]/g, ""); }

// ── Geocode a single project name ─────────────────────────────────────────────

interface Block {
  lat:        number;
  lng:        number;
  postal:     string;
  address:    string;
  confidence: number;
}

async function geocodeProject(
  projectName: string,
  token: string,
): Promise<{ blocks: Block[]; propertyType: "Condo" | "EC" } | null> {
  const normSearch = normalize(projectName);
  const blocks: Block[]   = [];
  const seenPostals       = new Set<string>();
  let propertyType: "Condo" | "EC" = "Condo";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(projectName)}` +
      `&returnGeom=Y&getAddrDetails=Y&pageNum=${page}`;

    let data: { totalNumPages?: number; results?: OneMapResult[] };
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) break;
      data = await res.json() as typeof data;
    } catch {
      break;
    }

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

      // Only keep results where the building name matches what we searched for
      const normBuilding = normalize(building || searchval);
      if (!normBuilding.includes(normSearch) && !normSearch.includes(normBuilding)) continue;

      const c = classify(building, searchval, address, postal, lat, lng);
      if (c.bucket === "reject") continue;

      if (seenPostals.has(postal)) continue;
      seenPostals.add(postal);

      if (c.propertyType === "EC") propertyType = "EC";
      blocks.push({ lat, lng, postal, address, confidence: c.score });
    }

    if (!results.length || page >= totalPages) break;
    await sleep(PAGE_DELAY);
  }

  return blocks.length ? { blocks, propertyType } : null;
}

// ── Upsert into master ────────────────────────────────────────────────────────

async function upsertMaster(
  projectName:  string,
  propertyType: "Condo" | "EC",
  blocks:       Block[],
  seededAt:     string,
): Promise<"inserted" | "skipped"> {
  // Check if already exists
  const existing = await db.execute({
    sql:  "SELECT id FROM private_property_master WHERE UPPER(project_name) = UPPER(?)",
    args: [projectName],
  });
  if (existing.rows.length) return "skipped";

  const postalCodes = [...new Set(blocks.map((b) => b.postal).filter(Boolean))];
  const lat         = blocks.reduce((s, b) => s + b.lat, 0) / blocks.length;
  const lng         = blocks.reduce((s, b) => s + b.lng, 0) / blocks.length;
  const best        = blocks.reduce((b, r) => r.confidence > b.confidence ? r : b, blocks[0]);

  await db.execute({
    sql: `INSERT OR IGNORE INTO private_property_master
            (project_name, property_type, address, postal_codes, block_count,
             lat, lng, confidence_score, source_keyword, seeded_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      projectName,
      propertyType,
      best.address,
      JSON.stringify(postalCodes),
      blocks.length,
      lat,
      lng,
      best.confidence,
      "curated-list",
      seededAt,
    ],
  });
  return "inserted";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error("✗ TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env.local");
    process.exit(1);
  }

  const listFile = process.argv[2] ?? join(process.cwd(), "data", "condo-names.txt");
  let rawLines: string[];
  try {
    rawLines = readFileSync(listFile, "utf8").split("\n");
  } catch {
    console.error(`✗ Cannot read ${listFile}`);
    process.exit(1);
  }

  const names = rawLines
    .map((l) => l.split("#")[0].trim())   // strip inline comments
    .filter((l) => l.length > 0);

  console.log(`\nLoaded ${names.length} names from ${listFile}`);
  console.log(`Connecting to Turso: ${process.env.TURSO_DATABASE_URL}\n`);

  const token    = process.env.ONEMAP_TOKEN ?? "";
  const seededAt = new Date().toISOString();

  let inserted = 0;
  let skipped  = 0;
  let notFound = 0;
  const missed: string[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    process.stdout.write(`[${String(i + 1).padStart(3)}/${names.length}] ${name.padEnd(45)}`);

    const result = await geocodeProject(name, token);
    if (!result) {
      process.stdout.write("✗ not found\n");
      notFound++;
      missed.push(name);
      continue;
    }

    const outcome = await upsertMaster(name, result.propertyType, result.blocks, seededAt);
    if (outcome === "inserted") {
      process.stdout.write(`✓ ${result.blocks.length} block(s)\n`);
      inserted++;
    } else {
      process.stdout.write(`— already in DB\n`);
      skipped++;
    }

    await sleep(PAGE_DELAY);
  }

  // Final counts
  const [countRes] = await Promise.all([
    db.execute("SELECT COUNT(*) as n FROM private_property_master"),
  ]);
  const total = Number(countRes.rows[0]?.n ?? 0);

  console.log("\n══ Seed:known Report ════════════════════════════════════════════");
  console.log(`  Processed : ${names.length}`);
  console.log(`  Inserted  : ${inserted}`);
  console.log(`  Skipped   : ${skipped} (already in DB)`);
  console.log(`  Not found : ${notFound}`);
  console.log(`  DB master : ${total} total projects`);

  if (missed.length) {
    console.log("\n── Not found (check spelling or try discover CLI) ───────────────");
    for (const m of missed) console.log(`  • ${m}`);
  }

  console.log("\n✓ Done");
}

main().catch((e) => { console.error("Seed:known failed:", e); process.exit(1); });
