/**
 * MongoDB query helpers for the results page.
 * When MONGODB_URI is set and the DB is seeded, these replace the API-based
 * lookups and enable real 1.5 km radius filtering.
 */

import { connectDb } from "./mongodb";
import { HdbTx } from "./models/HdbTx";
import { PrivateProject } from "./models/PrivateProject";
import type { HdbResaleRecord } from "./fetchHdb";
import type { ExtendedProjectSummary } from "@/components/ResultsDashboard";

const MAX_DIST_M = 1500; // 1.5 km

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

// ── Layer 2 scoring — HDB (ranks options within "Stay" / "Bigger HDB" path) ──

function scoreHdb(
  remainingLease: number,
  resalePrice: number,
  storeyRange: string,
  budget: number,
  distKm: number,
): number {
  // Remaining lease — highest weight (0-40)
  const leaseScore = remainingLease > 0 ? Math.min(remainingLease / 99, 1) * 40 : 0;

  // Affordability (0-30)
  const priceScore = resalePrice <= budget ? 30 : resalePrice <= budget * 1.1 ? 15 : 5;

  // Floor level (0-15)
  const floorLow = parseInt(storeyRange) || 1;
  const floorScore = Math.min(floorLow / 25, 1) * 15;

  // Distance within 1.5 km (0-15)
  const distScore = distKm < 0.5 ? 15 : distKm < 1 ? 11 : 7;

  return Math.round(leaseScore + priceScore + floorScore + distScore);
}

// ── Layer 2 scoring — Private (ranks options within "Private Condo" path) ─────

function scorePrivateProject(
  minPrice: number,
  tenure: string,
  txCount: number,
  trend3Y: number,
  budget: number,
  distKm: number,
): number {
  let score = 30; // base

  // Distance within 1.5 km — critical factor (0-30)
  score += distKm < 0.5 ? 30 : distKm < 1 ? 24 : 16;

  // Affordability (0-18)
  score += minPrice <= budget ? 18 : minPrice <= budget * 1.1 ? 10 : 3;

  // 3-year PSM trend (0-12)
  score += trend3Y > 20 ? 12 : trend3Y > 10 ? 8 : trend3Y > 0 ? 4 : 0;

  // Liquidity (0-6)
  score += Math.min(Math.floor(txCount / 4), 6);

  // Tenure (0-4)
  score += (tenure.includes("Freehold") || tenure.includes("999")) ? 4 : 1;

  return Math.min(Math.round(score), 99);
}

// ── HDB nearby (for "Stay" path — same flat type, within 1.5 km) ─────────────

export interface ScoredHdbRecord extends HdbResaleRecord {
  score:   number;
  distKm:  number;
}

export async function getHdbNearby(
  lat: number,
  lng: number,
  flatType: string,   // API format e.g. "4 ROOM"
  budget: number,
  limit = 7,
): Promise<{ records: ScoredHdbRecord[]; fromDb: boolean }> {
  const db = await connectDb();
  if (!db) return { records: [], fromDb: false };

  const docs = await HdbTx.find({
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: MAX_DIST_M,
      },
    },
    flatType,
  })
    .sort({ month: -1 })
    .limit(150)
    .lean();

  const scored: ScoredHdbRecord[] = docs.map((doc) => {
    const [docLng, docLat] = (doc.location as { coordinates: number[] }).coordinates;
    const distKm = Math.round(haversineKm(lat, lng, docLat, docLng) * 10) / 10;
    return {
      block:             doc.block ?? "",
      streetName:        doc.streetName ?? "",
      town:              doc.town ?? "",
      flatType:          doc.flatType ?? "",
      storeyRange:       doc.storeyRange ?? "",
      sqm:               doc.sqm ?? 0,
      resalePrice:       doc.resalePrice ?? 0,
      pricePerSqm:       doc.pricePerSqm ?? 0,
      month:             doc.month ?? "",
      leaseCommenceYear: doc.leaseCommenceYear ?? 0,
      remainingLease:    doc.remainingLease ?? 0,
      score:             scoreHdb(doc.remainingLease ?? 0, doc.resalePrice ?? 0, doc.storeyRange ?? "", budget, distKm),
      distKm,
    };
  });

  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  return { records: top, fromDb: true };
}

// ── Private projects nearby (for "Private Condo" path, within 1.5 km) ────────

export async function getPrivateProjectsNearby(
  lat: number,
  lng: number,
  budget: number,
  limit = 15,
): Promise<{ projects: ExtendedProjectSummary[]; fromDb: boolean; count: number }> {
  const db = await connectDb();
  if (!db) return { projects: [], fromDb: false, count: 0 };

  const docs = await PrivateProject.find({
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: MAX_DIST_M,
      },
    },
  })
    .limit(60)
    .lean();

  const total = docs.length;

  const scored: ExtendedProjectSummary[] = docs.map((doc) => {
    const [docLng, docLat] = (doc.location as { coordinates: number[] }).coordinates;
    const distKm = Math.round(haversineKm(lat, lng, docLat, docLng) * 10) / 10;
    const propertyScore = scorePrivateProject(
      doc.minPrice ?? 0,
      doc.tenure ?? "",
      doc.txCount ?? 0,
      doc.trend3Y ?? 0,
      budget,
      distKm,
    );
    return {
      project:       doc.project ?? "",
      street:        doc.street ?? "",
      tenure:        doc.tenure ?? "",
      marketSegment: (doc.marketSegment ?? "OCR") as "OCR" | "RCR" | "CCR",
      minPrice:      doc.minPrice ?? 0,
      maxPrice:      doc.maxPrice ?? 0,
      medianPsm:     doc.medianPsm ?? 0,
      txCount:       doc.txCount ?? 0,
      latestDate:    doc.latestDate ?? "",
      minSqm:        doc.minSqm ?? 0,
      maxSqm:        doc.maxSqm ?? 0,
      propertyScore,
      trend3Y:       doc.trend3Y ?? 0,
      distanceKm:    distKm,
      projectLat:    docLat,
      projectLng:    docLng,
    };
  });

  const top = scored.sort((a, b) => b.propertyScore - a.propertyScore).slice(0, limit);
  return { projects: top, fromDb: true, count: total };
}

export async function dbStatus(): Promise<{ connected: boolean; hdbCount: number; privateCount: number }> {
  const db = await connectDb();
  if (!db) return { connected: false, hdbCount: 0, privateCount: 0 };
  const [hdbCount, privateCount] = await Promise.all([
    HdbTx.countDocuments(),
    PrivateProject.countDocuments(),
  ]);
  return { connected: true, hdbCount, privateCount };
}
