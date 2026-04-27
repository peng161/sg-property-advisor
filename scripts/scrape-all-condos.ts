/**
 * Comprehensive condo seeder.
 *
 * Phase 1 — Discovery: scrapes EdgeProp's condo district pages (D01–D28)
 *   to collect every project name. Tries to extract __NEXT_DATA__ JSON first
 *   (fast, no parsing), then falls back to Claude agent for hard pages.
 *
 * Phase 2 — Geocoding: searches OneMap directly for each project name, groups
 *   all matching blocks into one record (centroid), then upserts into
 *   private_property_master.
 *
 * Additive — never drops or overwrites existing master rows.
 * Resumable — skips projects already in the master table.
 *
 * Run:  npm run scrape:condos
 * ETA:  ~15–25 min depending on network and number of projects found.
 *
 * Required env vars:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ANTHROPIC_API_KEY
 * Optional:
 *   ONEMAP_TOKEN   — raises OneMap rate limits
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient }  from "@libsql/client";
import Anthropic         from "@anthropic-ai/sdk";
import { classify }      from "../lib/property-classifier";

// ── DB ────────────────────────────────────────────────────────────────────────

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function normalizeForMatch(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function titleCase(s: string): string {
  const lower = ["a","an","and","at","by","for","in","of","on","the","to","@"];
  return s.toLowerCase().split(" ").map((w, i) =>
    i === 0 || !lower.includes(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w
  ).join(" ");
}

// ── Phase 1: scrape EdgeProp district pages ───────────────────────────────────
//
// EdgeProp district URLs: https://www.edgeprop.sg/condo/d01 … /d28
// Also 99.co:             https://www.99.co/singapore/condos-apartments?district_code=D01
//
// Strategy:
//   1. Fetch the page HTML
//   2. Try to extract embedded __NEXT_DATA__ JSON (Next.js SSR data blob)
//   3. If that fails / yields nothing, use Claude agent to read visible text

const DISTRICT_COUNT = 28;
const SCRAPE_DELAY   = 1_500; // ms between portal requests

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":      USER_AGENT,
        Accept:            "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-SG,en;q=0.9",
        "Cache-Control":   "no-cache",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      process.stdout.write(` HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    process.stdout.write(` fetch-err: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// Extract visible text from HTML (strip tags)
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

// Try to pull project names from __NEXT_DATA__ JSON blob embedded in the page
function extractFromNextData(html: string): string[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/);
  if (!m) return [];

  try {
    const data = JSON.parse(m[1]) as unknown;
    const names: string[] = [];

    // Walk the JSON tree looking for strings that look like project names
    function walk(node: unknown) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const obj = node as Record<string, unknown>;
      for (const [key, val] of Object.entries(obj)) {
        // Common keys that hold project names across portals
        if (
          typeof val === "string" &&
          (key === "name" || key === "project_name" || key === "projectName" ||
           key === "title" || key === "label" || key === "heading") &&
          val.length >= 4 && val.length <= 80 &&
          // crude filter: must have at least 2 words or look like a named building
          /[A-Za-z]/.test(val) && !/^https?:/.test(val)
        ) {
          names.push(val);
        }
        walk(val);
      }
    }

    walk(data);
    // Deduplicate
    return [...new Set(names)];
  } catch {
    return [];
  }
}

// Claude agent fallback: ask it to list condo names from page text
const anthropic = new Anthropic();

async function extractWithClaude(pageText: string, district: string): Promise<string[]> {
  if (!pageText.trim()) return [];

  try {
    const resp = await anthropic.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 1024,
      messages: [{
        role:    "user",
        content:
          `The following is text from a Singapore property portal page listing condos in district ${district}.\n` +
          `Extract ALL condo / apartment / EC project names you can see. ` +
          `Return ONLY a JSON array of strings, no other text. Example: ["Parc Riviera","Seahill"]\n\n` +
          pageText,
      }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    return (JSON.parse(m[0]) as unknown[])
      .filter((v): v is string => typeof v === "string" && v.length > 3)
      .map((s) => s.trim());
  } catch {
    return [];
  }
}

interface ScrapedProject {
  name:     string;    // title-cased display name
  district: string;
}

async function scrapeDistrict(district: string): Promise<ScrapedProject[]> {
  const pad    = district.padStart(2, "0");
  const urls   = [
    `https://www.edgeprop.sg/condo/d${pad}`,
    `https://www.99.co/singapore/condos-apartments?district_code=D${district.padStart(2,"0")}`,
  ];

  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;

    // Try __NEXT_DATA__ first (fast, structured)
    let names = extractFromNextData(html);

    // Fallback: Claude on visible text
    if (names.length < 3) {
      const text = htmlToText(html);
      names = await extractWithClaude(text, district);
    }

    if (names.length > 0) {
      return names.map((n) => ({ name: titleCase(n), district }));
    }
  }

  return [];
}

async function discoverProjects(): Promise<Map<string, string>> {
  // name (normalized) → display name
  const projectMap = new Map<string, string>();

  console.log("Phase 1: scraping EdgeProp / 99.co district pages…\n");

  for (let d = 1; d <= DISTRICT_COUNT; d++) {
    const district = String(d).padStart(2, "0");
    process.stdout.write(`  District ${district}/${DISTRICT_COUNT}… `);

    const results = await scrapeDistrict(district);
    let added = 0;
    for (const { name } of results) {
      const key = normalizeForMatch(name);
      if (key.length < 4) continue;
      if (!projectMap.has(key)) { projectMap.set(key, name); added++; }
    }

    process.stdout.write(`${results.length} found, ${added} new (total: ${projectMap.size})\n`);
    await sleep(SCRAPE_DELAY);
  }

  return projectMap;
}

// ── Phase 2: geocode each project via OneMap ──────────────────────────────────

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";
const ONEMAP_DELAY  = 250;
const MAX_PAGES     = 4;

interface Block {
  lat:        number;
  lng:        number;
  postal:     string;
  address:    string;
  confidence: number;
}

async function geocodeProject(
  displayName: string,
  token:       string,
): Promise<{ blocks: Block[]; propertyType: "Condo" | "EC" } | null> {
  const normSearch  = normalizeForMatch(displayName);
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

      const normBuilding = normalizeForMatch(building || searchval);
      const shorter = normBuilding.length < normSearch.length ? normBuilding : normSearch;
      const longer  = normBuilding.length < normSearch.length ? normSearch   : normBuilding;
      if (shorter.length < 4 || !longer.includes(shorter)) continue;

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
        name, propertyType, best.address,
        JSON.stringify(postalCodes), blocks.length,
        lat, lng, best.confidence,
        "edgeprop-scrape", seededAt,
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

  const discovered = await discoverProjects();
  console.log(`\n✓ Discovered ${discovered.size} unique project names\n`);

  // ── Load already-seeded names (resume support) ────────────────────────────────

  const existingRes = await db.execute(
    "SELECT UPPER(REPLACE(REPLACE(project_name,' ',''),'-','')) as n FROM private_property_master"
  );
  const existing = new Set(existingRes.rows.map((r) => String(r.n)));

  const toGeocode = [...discovered.entries()]
    .filter(([key]) => !existing.has(key))
    .map(([, name]) => name);

  console.log(`Phase 2: geocoding ${toGeocode.length} new projects`);
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
      process.stdout.write("✗ not found\n");
      notFound++;
      missed.push(name);
    } else {
      process.stdout.write(`✓ ${geo.blocks.length} block(s)\n`);
      geocoded++;
      pending.push({ name, geo });
    }

    if (pending.length >= CHUNK) {
      await upsertBatch(pending.splice(0, CHUNK), seededAt);
    }

    await sleep(ONEMAP_DELAY);
  }

  if (pending.length) await upsertBatch(pending, seededAt);

  // ── Report ────────────────────────────────────────────────────────────────────

  const [mCount] = await Promise.all([
    db.execute("SELECT COUNT(*) as n FROM private_property_master"),
  ]);

  console.log("\n══ Scrape Report ═══════════════════════════════════════════════");
  console.log(`  Projects discovered  : ${discovered.size}`);
  console.log(`  Already in DB        : ${existing.size}`);
  console.log(`  Geocoded & inserted  : ${geocoded}`);
  console.log(`  Not found on OneMap  : ${notFound}`);
  console.log(`  DB master total      : ${Number(mCount.rows[0]?.n ?? 0)}`);

  if (missed.length) {
    console.log("\n── Not found (new launches or name mismatch) ───────────────────");
    for (const m of missed.slice(0, 30)) console.log(`  • ${m}`);
    if (missed.length > 30) console.log(`  … and ${missed.length - 30} more`);
  }

  console.log("\n✓ Scrape complete");
}

main().catch((e) => { console.error("Scrape failed:", e); process.exit(1); });
