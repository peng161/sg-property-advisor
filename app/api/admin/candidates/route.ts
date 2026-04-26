import { getDb } from "@/lib/sqlite";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = "admin:admin";

function isAuthed(req: Request): boolean {
  return req.headers.get("x-admin-token") === ADMIN_TOKEN;
}

function n(v: unknown): number { return Number(v ?? 0); }
function s(v: unknown): string { return String(v ?? ""); }

export async function GET(req: Request) {
  if (!isAuthed(req)) return new Response("Unauthorized", { status: 401 });

  const db = getDb();
  if (!db) return Response.json({ error: "DB not available" }, { status: 503 });

  const url    = new URL(req.url);
  const page   = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit  = 50;
  const offset = (page - 1) * limit;

  const [rows, countRes] = await Promise.all([
    db.execute({
      sql:  "SELECT * FROM private_property_candidates ORDER BY confidence_score DESC, id ASC LIMIT ? OFFSET ?",
      args: [limit, offset],
    }),
    db.execute("SELECT COUNT(*) as n FROM private_property_candidates"),
  ]);

  return Response.json({
    candidates: rows.rows.map((r) => ({
      id:               n(r.id),
      project_name:     s(r.project_name),
      property_type:    s(r.property_type),
      address:          s(r.address),
      postal_code:      s(r.postal_code),
      lat:              n(r.lat),
      lng:              n(r.lng),
      confidence_score: n(r.confidence_score),
      reason:           s(r.reason),
      source_keyword:   s(r.source_keyword),
      seeded_at:        s(r.seeded_at),
    })),
    total: n(countRes.rows[0]?.n ?? 0),
    page,
    limit,
  });
}

export async function POST(req: Request) {
  if (!isAuthed(req)) return new Response("Unauthorized", { status: 401 });

  const db = getDb();
  if (!db) return Response.json({ error: "DB not available" }, { status: 503 });

  const { action, id } = await req.json() as { action: string; id: number };

  if (action === "accept") {
    const row = await db.execute({ sql: "SELECT * FROM private_property_candidates WHERE id = ?", args: [id] });
    if (!row.rows.length) return Response.json({ error: "Not found" }, { status: 404 });
    const r = row.rows[0];
    await db.batch([
      {
        sql:  "INSERT OR REPLACE INTO private_property_master (project_name, property_type, address, postal_code, lat, lng, confidence_score, source_keyword, seeded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [r.project_name, r.property_type, r.address, r.postal_code, r.lat, r.lng, r.confidence_score, r.source_keyword, new Date().toISOString()],
      },
      { sql: "DELETE FROM private_property_candidates WHERE id = ?", args: [id] },
    ], "write");
    return Response.json({ ok: true });
  }

  if (action === "reject") {
    await db.execute({ sql: "DELETE FROM private_property_candidates WHERE id = ?", args: [id] });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
