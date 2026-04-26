import { type NextRequest } from "next/server";
import { getDb } from "@/lib/sqlite";
import { haversineKm } from "@/lib/dbQueries";

export const dynamic = "force-dynamic";

export interface NearbyProject {
  project:        string;
  street:         string;
  district:       string;
  market_segment: string;
  lat:            number;
  lng:            number;
  distance_km:    number;
}

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams;
  const lat    = Number(sp.get("lat")    ?? 0);
  const lng    = Number(sp.get("lng")    ?? 0);
  const radius = Number(sp.get("radius") ?? 1500); // metres

  if (!lat || !lng) {
    return Response.json({ error: "lat and lng required" }, { status: 400 });
  }

  const db = getDb();
  if (!db) {
    return Response.json({ projects: [] as NearbyProject[] });
  }

  const radiusKm = radius / 1000;
  const delta    = radiusKm / 111.32;

  try {
    const res = await db.execute({
      sql: `SELECT project_name, address, lat, lng
            FROM onemap_condo
            WHERE lat BETWEEN ? AND ?
              AND lng BETWEEN ? AND ?
              AND lat > 0 AND lng > 0`,
      args: [lat - delta, lat + delta, lng - delta, lng + delta],
    });

    const projects: NearbyProject[] = res.rows
      .map((r) => {
        const pLat = Number(r.lat);
        const pLng = Number(r.lng);
        const distKm = Math.round(haversineKm(lat, lng, pLat, pLng) * 100) / 100;
        if (distKm > radiusKm) return null;
        return {
          project:        String(r.project_name),
          street:         String(r.address ?? ""),
          district:       "",
          market_segment: "OCR",
          lat:            pLat,
          lng:            pLng,
          distance_km:    distKm,
        };
      })
      .filter((r): r is NearbyProject => r !== null)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 60);

    return Response.json({ projects });
  } catch (err) {
    console.error("[nearby-condos]", err);
    return Response.json({ projects: [] as NearbyProject[] });
  }
}
