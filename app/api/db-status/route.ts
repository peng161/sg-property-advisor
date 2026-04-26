import { getDb, getDbError } from "@/lib/sqlite";
import { haversineKm } from "@/lib/dbQueries";

export const dynamic = "force-dynamic";

function n(v: unknown): number { return Number(v ?? 0); }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat  = parseFloat(url.searchParams.get("lat")  ?? "0");
  const lng  = parseFloat(url.searchParams.get("lng")  ?? "0");

  const tursoUrl   = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  const db = getDb();
  if (!db) {
    return Response.json({
      connected: false, hdbCount: 0, privateCount: 0, condosNearby: 0,
      debug: {
        hasTursoUrl:   !!tursoUrl,
        hasTursoToken: !!tursoToken,
        tursoUrl:      tursoUrl ?? null,
        initError:     getDbError() ?? null,
      },
    });
  }

  try {
    const [h, p] = await Promise.all([
      db.execute("SELECT COUNT(*) as n FROM hdb_tx"),
      db.execute("SELECT COUNT(*) as n FROM private_property_master"),
    ]);
    const hdbCount     = n(h.rows[0]?.n ?? 0);
    const privateCount = n(p.rows[0]?.n ?? 0);

    let condosNearby = 0;
    if (lat && lng) {
      const nearby = await db.execute(
        "SELECT lat, lng FROM private_property_master WHERE lat > 0 AND lng > 0"
      );
      condosNearby = nearby.rows.filter((r) =>
        haversineKm(lat, lng, n(r.lat), n(r.lng)) <= 1.5
      ).length;
    }

    return Response.json({ connected: true, hdbCount, privateCount, condosNearby });
  } catch (err) {
    return Response.json({
      connected: false, hdbCount: 0, privateCount: 0, condosNearby: 0,
      error: err instanceof Error ? err.message : String(err),
      debug: { hasTursoUrl: !!tursoUrl, hasTursoToken: !!tursoToken },
    });
  }
}
