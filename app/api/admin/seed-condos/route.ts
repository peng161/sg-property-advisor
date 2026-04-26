import { getDb } from "@/lib/sqlite";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";

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

const LANDED_TERMS = [
  "terrace", "semi-detached", "detached", "bungalow",
  "cluster house", "good class bungalow", "gcb", "villa",
  " house", "landed",
];

const MAX_PAGES = 80;
const PAGE_DELAY = 120;

interface OneMapResult {
  BUILDING:   string;
  ADDRESS:    string;
  POSTAL:     string;
  LATITUDE:   string;
  LONGITUDE:  string;
  LONGTITUDE: string;
}

interface FetchedProperty {
  project_name:      string;
  property_category: "Condo" | "EC";
  address:           string;
  postal_code:       string;
  lat:               number;
  lng:               number;
}

function classify(
  building: string,
  address:  string,
  keyword:  string,
): { keep: boolean; category: "Condo" | "EC" } {
  const b     = building.toUpperCase().trim();
  const a     = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  if (combo.includes("HDB") || combo.includes("HOUSING BOARD")) return { keep: false, category: "Condo" };
  if (!b && (a.startsWith("BLK ") || a.startsWith("BLOCK ")))   return { keep: false, category: "Condo" };
  if (combo.includes("HDB APARTMENT"))                           return { keep: false, category: "Condo" };

  for (const term of LANDED_TERMS) {
    if (combo.includes(term.toUpperCase())) return { keep: false, category: "Condo" };
  }

  if (!b) return { keep: false, category: "Condo" };

  const isEc =
    keyword === "executive condominium" ||
    combo.includes("EXECUTIVE CONDOMINIUM") ||
    /\bEC\b/.test(b);

  return { keep: true, category: isEc ? "EC" : "Condo" };
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch { /* client disconnected */ }
      }

      try {
        const db = getDb();
        if (!db) {
          send({ type: "error", message: "Database not available — no local DB file and no Turso credentials." });
          controller.close();
          return;
        }

        // Ensure table + index exist
        await db.execute(`
          CREATE TABLE IF NOT EXISTS onemap_condo (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name      TEXT NOT NULL,
            property_category TEXT NOT NULL,
            address           TEXT,
            postal_code       TEXT,
            lat               REAL NOT NULL,
            lng               REAL NOT NULL,
            seeded_at         TEXT NOT NULL,
            UNIQUE(project_name, postal_code)
          )
        `);
        await db.execute(
          "CREATE INDEX IF NOT EXISTS idx_onemap_condo_loc ON onemap_condo(lat, lng)"
        );

        const token   = process.env.ONEMAP_TOKEN ?? "";
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const seededAt = new Date().toISOString();
        const allRaw: FetchedProperty[] = [];

        for (const keyword of PROPERTY_KEYWORDS) {
          send({ type: "keyword_start", keyword });
          const keptForKeyword: FetchedProperty[] = [];

          for (let page = 1; page <= MAX_PAGES; page++) {
            const url =
              `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(keyword)}` +
              `&returnGeom=Y&getAddrDetails=Y&pageNum=${page}`;

            let data: { totalNumPages?: number; results?: OneMapResult[] };
            try {
              const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
              if (!res.ok) {
                send({ type: "page_error", keyword, page, status: res.status });
                break;
              }
              data = await res.json();
            } catch (err) {
              send({ type: "page_error", keyword, page, error: err instanceof Error ? err.message : String(err) });
              break;
            }

            const pageResults = data.results ?? [];
            const totalPages  = data.totalNumPages ?? 1;

            for (const r of pageResults) {
              const lat = Number(r.LATITUDE);
              const lng = Number(r.LONGITUDE || r.LONGTITUDE);
              if (!lat || !lng) continue;

              const building = (r.BUILDING || "").trim();
              const address  = (r.ADDRESS  || "").trim();
              const postal   = (r.POSTAL   || "").replace(/\D/g, "");

              const { keep, category } = classify(building, address, keyword);
              if (!keep) continue;

              keptForKeyword.push({
                project_name:      building || address.split(" ").slice(0, 4).join(" "),
                property_category: category,
                address,
                postal_code: postal,
                lat,
                lng,
              });
            }

            send({ type: "page", keyword, page, totalPages, keptSoFar: keptForKeyword.length });

            if (!pageResults.length || page >= totalPages) break;
            await sleep(PAGE_DELAY);
          }

          allRaw.push(...keptForKeyword);
          send({ type: "keyword_done", keyword, kept: keptForKeyword.length, runningTotal: allRaw.length });
        }

        // Deduplicate on (project_name, postal_code)
        const seen = new Set<string>();
        const deduped: FetchedProperty[] = [];
        for (const p of allRaw) {
          const key = `${p.project_name.toUpperCase()}|${p.postal_code}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(p);
        }

        send({ type: "inserting", count: deduped.length });

        // Batch-insert in chunks of 500
        const CHUNK = 500;
        for (let i = 0; i < deduped.length; i += CHUNK) {
          await db.batch(
            deduped.slice(i, i + CHUNK).map((p) => ({
              sql:  "INSERT OR REPLACE INTO onemap_condo (project_name, property_category, address, postal_code, lat, lng, seeded_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
              args: [p.project_name, p.property_category, p.address, p.postal_code, p.lat, p.lng, seededAt],
            })),
            "write",
          );
        }

        const countRes = await db.execute("SELECT COUNT(*) as n FROM onemap_condo");
        const total  = Number(countRes.rows[0]?.n ?? 0);
        const condos = deduped.filter((p) => p.property_category === "Condo").length;
        const ecs    = deduped.filter((p) => p.property_category === "EC").length;

        send({ type: "done", written: deduped.length, total, condos, ecs });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
