import { getDb } from "@/lib/sqlite";
import type { Client } from "@libsql/client/http";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = "admin:admin";

function isAuthed(req: Request): boolean {
  return req.headers.get("x-admin-token") === ADMIN_TOKEN;
}

function n(v: unknown): number { return Number(v ?? 0); }
function s(v: unknown): string { return String(v ?? ""); }
function normalize(name: string): string {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
}

// ── Upsert helper: merges candidate blocks into private_property_master ───────
// Groups rows by project_name, computes centroid, and updates or inserts.
// Works with the merged schema (UNIQUE project_name, postal_codes JSON array).

async function upsertToMaster(db: Client, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;

  // Group by project_name (rows may already be one-per-project after schema change)
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const key = normalize(s(r.project_name));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // Batch-fetch existing master entries for these projects
  const projectNames = [...new Set(rows.map((r) => s(r.project_name)))];
  const placeholders = projectNames.map(() => "?").join(",");
  const existingRes  = await db.execute({
    sql:  `SELECT project_name, postal_codes, block_count, lat, lng FROM private_property_master WHERE project_name IN (${placeholders})`,
    args: projectNames,
  });
  const existingMap = new Map(existingRes.rows.map((r) => [s(r.project_name), r]));

  const statements: Array<{ sql: string; args: unknown[] }> = [];

  for (const [, group] of groups) {
    const projectName = s(group[0].project_name);
    const best        = group.reduce(
      (b, r) => n(r.confidence_score) > n(b.confidence_score) ? r : b,
      group[0],
    );

    // Each candidate row now has postal_codes (JSON) + block_count + centroid lat/lng
    const candBlockCount = group.reduce((sum, r) => sum + n(r.block_count || 1), 0);
    const newPostals = [...new Set(
      group.flatMap((r) => {
        try { return JSON.parse(s(r.postal_codes || "[]")) as string[]; }
        catch { return []; }
      }).filter(Boolean)
    )];
    // Weighted centroid from candidate group (already centroid per row)
    const newLat = group.reduce((sum, r) => sum + n(r.lat) * n(r.block_count || 1), 0) / candBlockCount;
    const newLng = group.reduce((sum, r) => sum + n(r.lng) * n(r.block_count || 1), 0) / candBlockCount;

    const ex = existingMap.get(projectName);
    if (ex) {
      const exPostals: string[] = JSON.parse(s(ex.postal_codes) || "[]");
      const exCount   = n(ex.block_count) || 1;
      const newOnly   = newPostals.filter((p) => !exPostals.includes(p));
      const merged    = exCount + newOnly.length;
      const mergedPostals = [...new Set([...exPostals, ...newPostals])];
      const mergedLat = newOnly.length > 0
        ? (n(ex.lat) * exCount + newLat * newOnly.length) / merged
        : n(ex.lat);
      const mergedLng = newOnly.length > 0
        ? (n(ex.lng) * exCount + newLng * newOnly.length) / merged
        : n(ex.lng);
      statements.push({
        sql:  "UPDATE private_property_master SET postal_codes=?, block_count=?, lat=?, lng=? WHERE project_name=?",
        args: [JSON.stringify(mergedPostals), Math.max(exCount, merged), mergedLat, mergedLng, projectName],
      });
    } else {
      statements.push({
        sql:  "INSERT INTO private_property_master (project_name, property_type, address, postal_codes, block_count, lat, lng, confidence_score, source_keyword, seeded_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [
          projectName,
          s(best.property_type) || "Condo",
          s(best.address),
          JSON.stringify(newPostals),
          candBlockCount,
          newLat,
          newLng,
          n(best.confidence_score),
          s(best.source_keyword),
          new Date().toISOString(),
        ],
      });
    }
  }

  if (statements.length > 0) {
    await db.batch(statements as Parameters<typeof db.batch>[0], "write");
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!isAuthed(req)) return new Response("Unauthorized", { status: 401 });

  const db = getDb();
  if (!db) return Response.json({ error: "DB not available" }, { status: 503 });

  const url    = new URL(req.url);
  const page   = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit  = 50;
  const offset = (page - 1) * limit;

  const typeFilter = url.searchParams.get("type") ?? "All";
  const typeWhere  = typeFilter === "All" ? "" : " AND property_type = ?";
  const typeArgs   = typeFilter === "All" ? [] : [typeFilter];

  const [rows, countRes, masterRes] = await Promise.all([
    db.execute({
      sql:  `SELECT * FROM private_property_candidates${typeWhere} ORDER BY confidence_score DESC, id ASC LIMIT ? OFFSET ?`,
      args: [...typeArgs, limit, offset],
    }),
    db.execute({
      sql:  `SELECT COUNT(*) as n FROM private_property_candidates${typeWhere}`,
      args: typeArgs,
    }),
    db.execute("SELECT COUNT(*) as n FROM private_property_master"),
  ]);

  return Response.json({
    candidates: rows.rows.map((r) => {
      let postalCodes: string[] = [];
      try { postalCodes = JSON.parse(s(r.postal_codes || "[]")); } catch { /* empty */ }
      return {
        id:               n(r.id),
        project_name:     s(r.project_name),
        property_type:    s(r.property_type),
        address:          s(r.address),
        postal_codes:     postalCodes,
        block_count:      n(r.block_count || 1),
        lat:              n(r.lat),
        lng:              n(r.lng),
        confidence_score: n(r.confidence_score),
        reason:           s(r.reason),
        source_keyword:   s(r.source_keyword),
        seeded_at:        s(r.seeded_at),
      };
    }),
    total:       n(countRes.rows[0]?.n ?? 0),
    masterCount: n(masterRes.rows[0]?.n ?? 0),
    page,
    limit,
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!isAuthed(req)) return new Response("Unauthorized", { status: 401 });

  const db = getDb();
  if (!db) return Response.json({ error: "DB not available" }, { status: 503 });

  const { action, id, ids } = await req.json() as { action: string; id?: number; ids?: number[] };

  // ── Accept single ─────────────────────────────────────────────────────────
  if (action === "accept") {
    if (id == null) return Response.json({ error: "id required" }, { status: 400 });
    const row = await db.execute({ sql: "SELECT * FROM private_property_candidates WHERE id = ?", args: [id] });
    if (!row.rows.length) return Response.json({ error: "Not found" }, { status: 404 });
    await upsertToMaster(db, [row.rows[0] as Record<string, unknown>]);
    await db.execute({ sql: "DELETE FROM private_property_candidates WHERE id = ?", args: [id] });
    return Response.json({ ok: true });
  }

  // ── Reject single ─────────────────────────────────────────────────────────
  if (action === "reject") {
    if (id == null) return Response.json({ error: "id required" }, { status: 400 });
    await db.execute({ sql: "DELETE FROM private_property_candidates WHERE id = ?", args: [id] });
    return Response.json({ ok: true });
  }

  // ── Accept selected ───────────────────────────────────────────────────────
  if (action === "accept_many") {
    if (!ids?.length) return Response.json({ accepted: 0 });
    const placeholders = ids.map(() => "?").join(",");
    const rows = await db.execute({ sql: `SELECT * FROM private_property_candidates WHERE id IN (${placeholders})`, args: ids });
    if (!rows.rows.length) return Response.json({ accepted: 0 });
    await upsertToMaster(db, rows.rows as Array<Record<string, unknown>>);
    await db.execute({ sql: `DELETE FROM private_property_candidates WHERE id IN (${placeholders})`, args: ids });
    return Response.json({ accepted: rows.rows.length });
  }

  // ── Reject selected ───────────────────────────────────────────────────────
  if (action === "reject_many") {
    if (!ids?.length) return Response.json({ rejected: 0 });
    const placeholders = ids.map(() => "?").join(",");
    await db.execute({ sql: `DELETE FROM private_property_candidates WHERE id IN (${placeholders})`, args: ids });
    return Response.json({ rejected: ids.length });
  }

  // ── Accept all high-confidence ────────────────────────────────────────────
  if (action === "accept_high") {
    const rows = await db.execute(
      "SELECT * FROM private_property_candidates WHERE confidence_score >= 80",
    );
    if (!rows.rows.length) return Response.json({ accepted: 0 });
    await upsertToMaster(db, rows.rows as Array<Record<string, unknown>>);
    const acceptedIds = rows.rows.map((r) => n(r.id)).filter(Boolean);
    const CHUNK = 500;
    for (let i = 0; i < acceptedIds.length; i += CHUNK) {
      const batch = acceptedIds.slice(i, i + CHUNK);
      await db.execute({
        sql:  `DELETE FROM private_property_candidates WHERE id IN (${batch.map(() => "?").join(",")})`,
        args: batch,
      });
    }
    return Response.json({ accepted: rows.rows.length });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
