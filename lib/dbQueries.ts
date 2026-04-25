/**
 * SQLite query helpers for the results page.
 * Replaces the previous MongoDB/Mongoose implementation.
 * Geospatial filtering uses a lat/lng bounding box + haversine JS check.
 */

import { getDb } from "./sqlite";
import type { HdbResaleRecord } from "./fetchHdb";
import type { ExtendedProjectSummary } from "@/components/ResultsDashboard";

const NEARBY_DIST_KM = 1.5;

// ── Geo helper ────────────────────────────────────────────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 1.5 km in degrees (approximate, good enough for bounding-box pre-filter)
function deltaDeg(lat: number) {
  const latDelta = NEARBY_DIST_KM / 111.32;
  const lngDelta = NEARBY_DIST_KM / (111.32 * Math.cos(lat * Math.PI / 180));
  return { latDelta, lngDelta };
}

// ── Layer 2 scoring — HDB ─────────────────────────────────────────────────────

function scoreHdb(
  remainingLease: number,
  resalePrice: number,
  storeyRange: string,
  budget: number,
  distKm: number,
): number {
  const leaseScore  = remainingLease > 0 ? Math.min(remainingLease / 99, 1) * 40 : 0;
  const priceScore  = resalePrice <= budget ? 30 : resalePrice <= budget * 1.1 ? 15 : 5;
  const floorLow    = parseInt(storeyRange) || 1;
  const floorScore  = Math.min(floorLow / 25, 1) * 15;
  const distScore   = distKm < 0.5 ? 15 : distKm < 1 ? 11 : 7;
  return Math.round(leaseScore + priceScore + floorScore + distScore);
}

// ── Layer 2 scoring — Private ─────────────────────────────────────────────────

function scorePrivateProject(
  minPrice: number,
  tenure: string,
  txCount: number,
  trend3Y: number,
  budget: number,
  distKm: number,
): number {
  let score = 30;
  score += distKm < 0.5 ? 30 : distKm < 1 ? 26 : distKm < 2 ? 22
         : distKm < 5 ? 16 : distKm < 10 ? 10 : distKm < 20 ? 5 : 2;
  score += minPrice <= budget ? 18 : minPrice <= budget * 1.1 ? 10 : 3;
  score += trend3Y > 20 ? 12 : trend3Y > 10 ? 8 : trend3Y > 0 ? 4 : 0;
  score += Math.min(Math.floor(txCount / 4), 6);
  score += (tenure.includes("Freehold") || tenure.includes("999")) ? 4 : 1;
  return Math.min(Math.round(score), 99);
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface HdbRow {
  block: string; street_name: string; town: string; flat_type: string;
  storey_range: string; sqm: number; resale_price: number; price_per_sqm: number;
  month: string; lease_commence_year: number; remaining_lease: number;
  lat: number; lng: number;
}

interface PrivateRow {
  project: string; street: string; market_segment: string; tenure: string;
  min_price: number; max_price: number; median_psm: number; tx_count: number;
  latest_date: string; min_sqm: number; max_sqm: number; trend_3y: number;
  lat: number; lng: number;
}

// ── HDB nearby ────────────────────────────────────────────────────────────────

export interface ScoredHdbRecord extends HdbResaleRecord {
  score:  number;
  distKm: number;
}

export async function getHdbNearby(
  lat: number,
  lng: number,
  flatType: string,
  budget: number,
  limit = 7,
): Promise<{ records: ScoredHdbRecord[]; fromDb: boolean }> {
  const db = getDb();
  if (!db) return { records: [], fromDb: false };

  const { latDelta, lngDelta } = deltaDeg(lat);

  const rows = db.prepare(`
    SELECT * FROM hdb_tx
    WHERE flat_type = ?
      AND lat BETWEEN ? AND ?
      AND lng BETWEEN ? AND ?
    ORDER BY month DESC
    LIMIT 500
  `).all(flatType, lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta) as HdbRow[];

  const scored: ScoredHdbRecord[] = rows
    .map((row) => {
      const distKm = Math.round(haversineKm(lat, lng, row.lat, row.lng) * 10) / 10;
      if (distKm > NEARBY_DIST_KM) return null;
      return {
        block:             row.block,
        streetName:        row.street_name,
        town:              row.town,
        flatType:          row.flat_type,
        storeyRange:       row.storey_range,
        sqm:               row.sqm,
        resalePrice:       row.resale_price,
        pricePerSqm:       row.price_per_sqm,
        month:             row.month,
        leaseCommenceYear: row.lease_commence_year,
        remainingLease:    row.remaining_lease,
        score:             scoreHdb(row.remaining_lease, row.resale_price, row.storey_range, budget, distKm),
        distKm,
      };
    })
    .filter((r): r is ScoredHdbRecord => r !== null);

  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  return { records: top, fromDb: true };
}

// ── Private projects nearby ───────────────────────────────────────────────────

export async function getPrivateProjectsNearby(
  lat: number,
  lng: number,
  budget: number,
  limit = 15,
): Promise<{ projects: ExtendedProjectSummary[]; fromDb: boolean; count: number }> {
  const db = getDb();
  if (!db) return { projects: [], fromDb: false, count: 0 };

  // Load all projects and score+sort in JS. Private project count is typically
  // 500-1000 rows — small enough for full in-memory scan.
  const rows = db.prepare("SELECT * FROM private_project").all() as PrivateRow[];

  const scored: ExtendedProjectSummary[] = rows.map((row) => {
    const distKm = Math.round(haversineKm(lat, lng, row.lat, row.lng) * 10) / 10;
    return {
      project:       row.project,
      street:        row.street,
      tenure:        row.tenure,
      marketSegment: (row.market_segment ?? "OCR") as "OCR" | "RCR" | "CCR",
      minPrice:      row.min_price,
      maxPrice:      row.max_price,
      medianPsm:     row.median_psm,
      txCount:       row.tx_count,
      latestDate:    row.latest_date,
      minSqm:        row.min_sqm,
      maxSqm:        row.max_sqm,
      propertyScore: scorePrivateProject(row.min_price, row.tenure, row.tx_count, row.trend_3y, budget, distKm),
      trend3Y:       row.trend_3y,
      distanceKm:    distKm,
      projectLat:    row.lat,
      projectLng:    row.lng,
    };
  });

  const within1_5km = scored.filter((p) => p.distanceKm !== null && p.distanceKm <= NEARBY_DIST_KM).length;
  const top = scored.sort((a, b) => b.propertyScore - a.propertyScore).slice(0, limit);
  return { projects: top, fromDb: true, count: within1_5km };
}

export async function dbStatus(): Promise<{ connected: boolean; hdbCount: number; privateCount: number }> {
  const db = getDb();
  if (!db) return { connected: false, hdbCount: 0, privateCount: 0 };
  const hdbCount     = (db.prepare("SELECT COUNT(*) as n FROM hdb_tx").get() as { n: number }).n;
  const privateCount = (db.prepare("SELECT COUNT(*) as n FROM private_project").get() as { n: number }).n;
  return { connected: true, hdbCount, privateCount };
}
