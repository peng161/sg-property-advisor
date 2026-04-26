// Finds private condos and ECs near a searched area using OneMap only.
// No fallback to hardcoded data — returns [] if nothing found.
//
// MODE: search_keyword_mode
//
// OneMap Themes API was fully audited (all 163 public themes as of 2026-04-26).
// No theme exists for private condominiums, ECs, or private residential properties.
// The only residential-adjacent themes are:
//   • hdb_active_blk_p  — HDB public housing blocks only
//   • ura_project_public_pl — URA infrastructure construction projects (stale, not buildings)
//   • ura_popspoints_pt  — Privately Owned Public Spaces (outdoor civic plazas, not dwellings)
// Conclusion: the Themes API cannot be used for this feature.
//
// This route uses the elastic/search API with property-type keywords as search terms.
// Buildings that contain "CONDOMINIUM" / "EXECUTIVE CONDOMINIUM" / etc. in their
// BUILDING field are condos/ECs by definition (they are registered under those names).
// Classification is deterministic — no inference, no guessing.

import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AreaCondoProperty {
  project_name:      string;
  property_category: "Condo" | "EC";
  address:           string;
  postal_code:       string;
  lat:               number;
  lng:               number;
  distance_km:       number;
}

export interface AreaCondosResponse {
  centre: { lat: number; lng: number; label: string };
  properties: AreaCondoProperty[];
  debug: {
    geocoded_label: string;
    total_api_results: number;
    within_radius: number;
    after_filter: number;
    after_dedup: number;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";

// Keywords that reliably identify private non-landed residential developments.
// Ordered: most type-specific first so "executive condominium" is checked before "condominium".
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

// Landed terms to reject
const LANDED_TERMS = [
  "terrace", "semi-detached", "detached", "bungalow",
  "cluster house", "good class bungalow", "gcb", "villa",
  " house", "landed",
];

// How many consecutive pages with 0 within-radius results before we stop a keyword search
const EARLY_STOP_AFTER = 3;
const MAX_PAGES_PER_KEYWORD = 12;
const PAGE_DELAY_MS = 80; // stay well inside rate limits

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

interface OneMapResult {
  BUILDING:   string;
  ADDRESS:    string;
  POSTAL:     string;
  LATITUDE:   string;
  LONGITUDE:  string;
  LONGTITUDE: string; // historic typo in some responses
  BLK_NO:     string;
  ROAD_NAME:  string;
}

function classifyResult(
  building: string,
  address:  string,
  keyword:  string,
): { keep: boolean; category: "Condo" | "EC"; rejectReason?: string } {
  const b = building.toUpperCase().trim();
  const a = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  // ── Exclude HDB ──────────────────────────────────────────────────────────
  if (combo.includes("HDB") || combo.includes("HOUSING BOARD")) {
    return { keep: false, category: "Condo", rejectReason: "HDB (keyword match)" };
  }
  // Empty building name + address starts with block number = HDB
  if (!b && (a.startsWith("BLK ") || a.startsWith("BLOCK "))) {
    return { keep: false, category: "Condo", rejectReason: "HDB block (no building name)" };
  }
  // HDB apartment label
  if (combo.includes("HDB APARTMENT")) {
    return { keep: false, category: "Condo", rejectReason: "HDB apartment label" };
  }

  // ── Exclude landed ───────────────────────────────────────────────────────
  for (const term of LANDED_TERMS) {
    if (combo.includes(term.toUpperCase())) {
      return { keep: false, category: "Condo", rejectReason: `landed (${term})` };
    }
  }

  // ── Require a real building name (not just a street number) ──────────────
  if (!b) {
    return { keep: false, category: "Condo", rejectReason: "no building name" };
  }

  // ── Classify EC vs Condo ─────────────────────────────────────────────────
  const isEc =
    keyword === "executive condominium" ||
    combo.includes("EXECUTIVE CONDOMINIUM") ||
    /\bEC\b/.test(b);

  return { keep: true, category: isEc ? "EC" : "Condo" };
}

// ── Geocode input ─────────────────────────────────────────────────────────────

async function geocode(
  query: string,
  token: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;

  const data: { results?: OneMapResult[] } = await res.json();
  const first = data.results?.[0];
  if (!first) return null;

  const lat = Number(first.LATITUDE);
  const lng = Number(first.LONGITUDE || first.LONGTITUDE);
  if (!lat || !lng) return null;

  const label = first.ADDRESS || first.BUILDING || query;
  console.log(`[area-condos] geocoded "${query}" → ${lat.toFixed(5)}, ${lng.toFixed(5)} (${label})`);
  return { lat, lng, label };
}

// ── Search one keyword, paginate, filter by distance ─────────────────────────

async function searchKeyword(
  keyword:    string,
  centLat:    number,
  centLng:    number,
  radiusKm:   number,
  token:      string,
): Promise<{ found: AreaCondoProperty[]; totalApiResults: number }> {
  const found: AreaCondoProperty[]     = [];
  let   totalApiResults                = 0;
  let   consecutiveEmptyPages          = 0;

  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  for (let page = 1; page <= MAX_PAGES_PER_KEYWORD; page++) {
    const url =
      `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(keyword)}` +
      `&returnGeom=Y&getAddrDetails=Y&pageNum=${page}`;

    let data: { found?: number; totalNumPages?: number; results?: OneMapResult[] };
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) {
        console.warn(`[area-condos] keyword="${keyword}" page=${page} HTTP ${res.status}`);
        break;
      }
      data = await res.json();
    } catch (err) {
      console.warn(`[area-condos] keyword="${keyword}" page=${page} fetch error:`, err instanceof Error ? err.message : String(err));
      break;
    }

    const pageResults: OneMapResult[] = data.results ?? [];
    totalApiResults += pageResults.length;
    console.log(`[area-condos] keyword="${keyword}" page=${page}/${data.totalNumPages ?? "?"} → ${pageResults.length} results from API`);

    if (!pageResults.length) break;

    let withinRadius = 0;
    let rejected     = 0;

    for (const r of pageResults) {
      const lat = Number(r.LATITUDE);
      const lng = Number(r.LONGITUDE || r.LONGTITUDE);
      if (!lat || !lng) continue;

      const dist = Math.round(haversineKm(centLat, centLng, lat, lng) * 100) / 100;
      if (dist > radiusKm) continue;

      withinRadius++;

      const building = (r.BUILDING || "").trim();
      const address  = (r.ADDRESS  || "").trim();
      const postal   = (r.POSTAL   || "").replace(/\D/g, "");

      const { keep, category, rejectReason } = classifyResult(building, address, keyword);
      if (!keep) {
        rejected++;
        console.log(`[area-condos]   REJECTED "${building || address}" — ${rejectReason}`);
        continue;
      }

      found.push({
        project_name:      building || address.split(" ").slice(0, 4).join(" "),
        property_category: category,
        address,
        postal_code:       postal,
        lat,
        lng,
        distance_km:       dist,
      });
    }

    console.log(
      `[area-condos] keyword="${keyword}" page=${page} → ` +
      `${withinRadius} within ${radiusKm}km, ${rejected} rejected, ` +
      `${withinRadius - rejected} kept`
    );

    if (withinRadius === 0) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= EARLY_STOP_AFTER) {
        console.log(`[area-condos] stopping "${keyword}" — ${EARLY_STOP_AFTER} consecutive pages with 0 within radius`);
        break;
      }
    } else {
      consecutiveEmptyPages = 0;
    }

    // No more pages
    if (page >= (data.totalNumPages ?? 1)) break;

    await sleep(PAGE_DELAY_MS);
  }

  return { found, totalApiResults };
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  console.log("[area-condos] mode=search_keyword_mode (OneMap Themes API has no private-residential layer)");

  const sp      = req.nextUrl.searchParams;
  const query   = sp.get("query")?.trim() ?? "";
  const radiusM = Math.max(250, Math.min(5000, Number(sp.get("radius") ?? 1500)));

  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const token    = process.env.ONEMAP_TOKEN ?? "";
  const radiusKm = radiusM / 1000;

  // ── Step 1: geocode ────────────────────────────────────────────────────────
  const centre = await geocode(query, token);
  if (!centre) {
    return Response.json(
      { error: `Could not geocode "${query}". Try a postal code, MRT name, or address.` },
      { status: 404 },
    );
  }

  // ── Step 2: search each keyword ────────────────────────────────────────────
  const allRaw: AreaCondoProperty[] = [];
  let   totalApiResults              = 0;
  let   withinRadiusTotal            = 0;

  for (const keyword of PROPERTY_KEYWORDS) {
    const { found, totalApiResults: kwTotal } = await searchKeyword(
      keyword, centre.lat, centre.lng, radiusKm, token,
    );
    totalApiResults  += kwTotal;
    withinRadiusTotal += found.length;
    allRaw.push(...found);
    console.log(`[area-condos] keyword="${keyword}" subtotal: ${found.length} kept`);
  }

  // ── Step 3: deduplicate by (project_name, postal_code) ────────────────────
  const seen = new Set<string>();
  const deduped: AreaCondoProperty[] = [];
  for (const p of allRaw) {
    const key = `${p.project_name.toUpperCase()}|${p.postal_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  // Sort by distance
  deduped.sort((a, b) => a.distance_km - b.distance_km);

  console.log(
    `[area-condos] done — totalApiResults=${totalApiResults}, ` +
    `withinRadius=${withinRadiusTotal}, afterDedup=${deduped.length}`
  );

  const response: AreaCondosResponse = {
    centre,
    properties: deduped,
    debug: {
      geocoded_label: centre.label,
      total_api_results: totalApiResults,
      within_radius: withinRadiusTotal,
      after_filter: withinRadiusTotal, // filtering happens inside searchKeyword
      after_dedup: deduped.length,
    },
  };

  return Response.json(response);
}
