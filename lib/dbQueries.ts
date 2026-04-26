/**
 * Query helpers — backed by Turso (production) or a local SQLite file (dev).
 * Uses @libsql/client, which is async and works in both environments.
 */

import { getDb } from "./sqlite";
import type { HdbResaleRecord } from "./fetchHdb";
import type { ExtendedProjectSummary } from "@/components/ResultsDashboard";

const NEARBY_DIST_KM = 1.5;

// ── Geo ───────────────────────────────────────────────────────────────────────

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

function boundingBox(lat: number) {
  const latDelta = NEARBY_DIST_KM / 111.32;
  const lngDelta = NEARBY_DIST_KM / (111.32 * Math.cos(lat * Math.PI / 180));
  return { latDelta, lngDelta };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreHdb(
  remainingLease: number, resalePrice: number, storeyRange: string,
  budget: number, distKm: number,
): number {
  const leaseScore = remainingLease > 0 ? Math.min(remainingLease / 99, 1) * 40 : 0;
  const priceScore = resalePrice <= budget ? 30 : resalePrice <= budget * 1.1 ? 15 : 5;
  const floorScore = Math.min((parseInt(storeyRange) || 1) / 25, 1) * 15;
  const distScore  = distKm < 0.5 ? 15 : distKm < 1 ? 11 : 7;
  return Math.round(leaseScore + priceScore + floorScore + distScore);
}

function scorePrivate(
  minPrice: number, tenure: string, txCount: number,
  trend3Y: number, budget: number, distKm: number,
): number {
  let s = 30;
  s += distKm < 0.5 ? 30 : distKm < 1 ? 26 : distKm < 2 ? 22
      : distKm < 5 ? 16 : distKm < 10 ? 10 : distKm < 20 ? 5 : 2;
  s += minPrice <= budget ? 18 : minPrice <= budget * 1.1 ? 10 : 3;
  s += trend3Y > 20 ? 12 : trend3Y > 10 ? 8 : trend3Y > 0 ? 4 : 0;
  s += Math.min(Math.floor(txCount / 4), 6);
  s += (tenure.includes("Freehold") || tenure.includes("999")) ? 4 : 1;
  return Math.min(Math.round(s), 99);
}

// ── Type helpers ──────────────────────────────────────────────────────────────

function n(v: unknown): number { return Number(v ?? 0); }
function s(v: unknown): string { return String(v ?? ""); }

// ── HDB nearby ────────────────────────────────────────────────────────────────

export interface ScoredHdbRecord extends HdbResaleRecord {
  score:  number;
  distKm: number;
}

export async function getHdbNearby(
  lat: number, lng: number, flatType: string, budget: number, limit = 7,
): Promise<{ records: ScoredHdbRecord[]; fromDb: boolean }> {
  const db = getDb();
  if (!db) return { records: [], fromDb: false };

  const { latDelta, lngDelta } = boundingBox(lat);
  try {
    const result = await db.execute({
      sql: `SELECT * FROM hdb_tx
            WHERE flat_type = ?
              AND lat BETWEEN ? AND ?
              AND lng BETWEEN ? AND ?
            ORDER BY month DESC LIMIT 500`,
      args: [flatType, lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta],
    });

    const scored: ScoredHdbRecord[] = result.rows
      .map((row) => {
        const rowLat = n(row.lat);
        const rowLng = n(row.lng);
        const distKm = Math.round(haversineKm(lat, lng, rowLat, rowLng) * 10) / 10;
        if (distKm > NEARBY_DIST_KM) return null;
        const remLease = n(row.remaining_lease);
        const price    = n(row.resale_price);
        const storey   = s(row.storey_range);
        return {
          block:             s(row.block),
          streetName:        s(row.street_name),
          town:              s(row.town),
          flatType:          s(row.flat_type),
          storeyRange:       storey,
          sqm:               n(row.sqm),
          resalePrice:       price,
          pricePerSqm:       n(row.price_per_sqm),
          month:             s(row.month),
          leaseCommenceYear: n(row.lease_commence_year),
          remainingLease:    remLease,
          score:             scoreHdb(remLease, price, storey, budget, distKm),
          distKm,
        };
      })
      .filter((r): r is ScoredHdbRecord => r !== null);

    const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
    return { records: top, fromDb: true };
  } catch {
    return { records: [], fromDb: false };
  }
}

// ── Private projects nearby ───────────────────────────────────────────────────
// Source: onemap_condo table (seeded via `npm run seed:condos` or the /explore page button).
// Ranks by proximity — price/tenure data not available from OneMap seed.

function scoreByDistance(distKm: number): number {
  if (distKm < 0.5)  return 90;
  if (distKm < 1.0)  return 80;
  if (distKm < 1.5)  return 70;
  if (distKm < 2.0)  return 60;
  if (distKm < 5.0)  return 45;
  if (distKm < 10.0) return 30;
  return 20;
}

export async function getPrivateProjectsNearby(
  lat: number, lng: number, _budget: number, limit = 15,
): Promise<{ projects: ExtendedProjectSummary[]; fromDb: boolean; count: number }> {
  const db = getDb();
  if (!db) return { projects: [], fromDb: false, count: 0 };

  try {
    const result = await db.execute(
      "SELECT project_name, property_category, address, lat, lng FROM onemap_condo WHERE lat > 0 AND lng > 0",
    );

    const scored: ExtendedProjectSummary[] = result.rows.map((row) => {
      const rowLat = n(row.lat);
      const rowLng = n(row.lng);
      const distKm = Math.round(haversineKm(lat, lng, rowLat, rowLng) * 10) / 10;
      return {
        project:       s(row.project_name),
        street:        s(row.address),
        tenure:        "Unknown",
        marketSegment: "OCR" as const,
        minPrice:      0,
        maxPrice:      0,
        medianPsm:     0,
        txCount:       0,
        latestDate:    "",
        minSqm:        0,
        maxSqm:        0,
        propertyScore: scoreByDistance(distKm),
        trend3Y:       0,
        distanceKm:    distKm,
        projectLat:    rowLat,
        projectLng:    rowLng,
      };
    });

    const within = scored.filter((p) => p.distanceKm !== null && p.distanceKm <= NEARBY_DIST_KM).length;
    const top    = scored.sort((a, b) => b.propertyScore - a.propertyScore).slice(0, limit);
    return { projects: top, fromDb: true, count: within };
  } catch {
    return { projects: [], fromDb: false, count: 0 };
  }
}

// ── HDB by town ───────────────────────────────────────────────────────────────
// Used when no user coordinates are available (no postal code entered) or when
// fetching a different flat type (e.g. "Bigger HDB" path).

export async function getHdbByTown(
  town: string, flatType: string, limit = 12,
): Promise<{ records: HdbResaleRecord[]; fromDb: boolean }> {
  const db = getDb();
  if (!db) return { records: [], fromDb: false };

  try {
    const result = await db.execute({
      sql: `SELECT * FROM hdb_tx
            WHERE UPPER(town) = UPPER(?)
              AND flat_type = ?
            ORDER BY month DESC LIMIT ?`,
      args: [town, flatType, limit],
    });

    const records: HdbResaleRecord[] = result.rows
      .map((row) => {
        const price = n(row.resale_price);
        const sqm   = n(row.sqm);
        if (!price || !sqm) return null;
        return {
          block:             s(row.block),
          streetName:        s(row.street_name),
          town:              s(row.town),
          flatType:          s(row.flat_type),
          storeyRange:       s(row.storey_range),
          sqm,
          resalePrice:       price,
          pricePerSqm:       n(row.price_per_sqm),
          month:             s(row.month),
          leaseCommenceYear: n(row.lease_commence_year),
          remainingLease:    n(row.remaining_lease),
        };
      })
      .filter((r): r is HdbResaleRecord => r !== null);

    return { records, fromDb: true };
  } catch {
    return { records: [], fromDb: false };
  }
}

// ── Private demand metrics ────────────────────────────────────────────────────

export interface PrivateDemandMetric {
  quarter:      string;
  region:       string;
  type_of_sale: string;
  sale_status:  string;
  units:        number;
}

export async function getPrivateDemandMetrics(
  region?: string, quarters = 5,
): Promise<PrivateDemandMetric[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const recentQuarters = await db.execute(
      "SELECT DISTINCT quarter FROM private_demand_metrics ORDER BY quarter DESC LIMIT ?",
      [quarters],
    );
    if (!recentQuarters.rows.length) return [];
    const qList = recentQuarters.rows.map((r) => s(r.quarter));
    const placeholders = qList.map(() => "?").join(",");
    const args = region
      ? [...qList, region]
      : qList;
    const sql = region
      ? `SELECT * FROM private_demand_metrics WHERE quarter IN (${placeholders}) AND region = ? ORDER BY quarter DESC`
      : `SELECT * FROM private_demand_metrics WHERE quarter IN (${placeholders}) ORDER BY quarter DESC`;
    const result = await db.execute({ sql, args });
    return result.rows.map((r) => ({
      quarter:      s(r.quarter),
      region:       s(r.region),
      type_of_sale: s(r.type_of_sale),
      sale_status:  s(r.sale_status),
      units:        n(r.units),
    }));
  } catch {
    return [];
  }
}

export async function dbStatus(): Promise<{ connected: boolean; hdbCount: number; privateCount: number }> {
  const db = getDb();
  if (!db) return { connected: false, hdbCount: 0, privateCount: 0 };
  try {
    const [h, p] = await Promise.all([
      db.execute("SELECT COUNT(*) as n FROM hdb_tx"),
      db.execute("SELECT COUNT(*) as n FROM onemap_condo"),
    ]);
    return { connected: true, hdbCount: n(h.rows[0].n), privateCount: n(p.rows[0].n) };
  } catch {
    return { connected: false, hdbCount: 0, privateCount: 0 };
  }
}
