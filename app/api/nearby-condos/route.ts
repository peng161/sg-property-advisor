import { type NextRequest } from "next/server";
import { getDb } from "@/lib/sqlite";

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

  try {
    // Haversine formula implemented in SQLite arithmetic
    const res = await db.execute({
      sql: `
        SELECT
          project, street, district, market_segment, lat, lng,
          ROUND(
            6371 * 2 * asin(sqrt(
              (sin(((lat  - ?) * 0.017453293) / 2) * sin(((lat  - ?) * 0.017453293) / 2)) +
              cos(? * 0.017453293) * cos(lat * 0.017453293) *
              (sin(((lng  - ?) * 0.017453293) / 2) * sin(((lng  - ?) * 0.017453293) / 2))
            )),
          2) AS distance_km
        FROM private_project
        WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat > 0 AND lng > 0
        HAVING distance_km <= ?
        ORDER BY distance_km ASC
        LIMIT 60
      `,
      args: [lat, lat, lat, lng, lng, radiusKm],
    });

    const projects: NearbyProject[] = res.rows.map((r) => ({
      project:        String(r.project),
      street:         String(r.street  ?? ""),
      district:       String(r.district ?? ""),
      market_segment: String(r.market_segment ?? "OCR"),
      lat:            Number(r.lat),
      lng:            Number(r.lng),
      distance_km:    Number(r.distance_km),
    }));

    return Response.json({ projects });
  } catch (err) {
    console.error("[nearby-condos]", err);
    return Response.json({ projects: [] as NearbyProject[] });
  }
}
