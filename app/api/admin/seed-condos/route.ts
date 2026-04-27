import { getDb } from "@/lib/sqlite";
import { classify } from "@/lib/property-classifier";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";

const SEARCH_KEYWORDS = [
  "executive condominium", "condominium", "residences", "residence",
  "apartments", "suites", "estate",
  "the", "park", "parc", "view", "trees", "tree", "heights", "hill",
  "crest", "green", "gardens", "valley", "bay", "shore", "towers",
  "grove", "loft", "casa", "court", "point", "place", "mansion",
] as const;

const MAX_PAGES = 80;
const PAGE_DELAY = 120;
const CHUNK = 500;

interface OneMapResult {
  BUILDING:   string;
  SEARCHVAL:  string;
  ADDRESS:    string;
  POSTAL:     string;
  LATITUDE:   string;
  LONGITUDE:  string;
  LONGTITUDE: string;
}

interface SeedRecord {
  project_name:     string;
  property_type:    "Condo" | "EC";
  address:          string;
  postal_code:      string;
  lat:              number;
  lng:              number;
  confidence_score: number;
  source_keyword:   string;
  reason:           string;
}

interface MergedMasterRecord {
  project_name:     string;
  property_type:    "Condo" | "EC";
  address:          string;
  postal_codes:     string;
  block_count:      number;
  lat:              number;
  lng:              number;
  confidence_score: number;
  source_keyword:   string;
}

function normalize(name: string): string {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
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

        // ── Schema setup (full refresh) ─────────────────────────────────────

        send({ type: "status", message: "Dropping and recreating tables…" });
        await db.execute("DROP TABLE IF EXISTS private_property_master");
        await db.execute("DROP TABLE IF EXISTS private_property_candidates");

        await db.execute(`
          CREATE TABLE private_property_master (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name     TEXT    NOT NULL UNIQUE,
            property_type    TEXT    NOT NULL DEFAULT 'Condo',
            address          TEXT,
            postal_codes     TEXT    NOT NULL DEFAULT '[]',
            block_count      INTEGER NOT NULL DEFAULT 1,
            lat              REAL    NOT NULL,
            lng              REAL    NOT NULL,
            confidence_score INTEGER NOT NULL,
            source_keyword   TEXT,
            seeded_at        TEXT    NOT NULL
          )
        `);
        await db.execute("CREATE INDEX idx_ppm_loc ON private_property_master(lat, lng)");

        await db.execute(`
          CREATE TABLE private_property_candidates (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name     TEXT    NOT NULL UNIQUE,
            property_type    TEXT    NOT NULL DEFAULT 'Condo',
            address          TEXT,
            postal_codes     TEXT    NOT NULL DEFAULT '[]',
            block_count      INTEGER NOT NULL DEFAULT 1,
            lat              REAL    NOT NULL,
            lng              REAL    NOT NULL,
            confidence_score INTEGER NOT NULL,
            reason           TEXT,
            source_keyword   TEXT,
            seeded_at        TEXT    NOT NULL
          )
        `);
        await db.execute("CREATE INDEX idx_ppc_loc ON private_property_candidates(lat, lng)");

        // ── Crawl OneMap ────────────────────────────────────────────────────

        const token    = process.env.ONEMAP_TOKEN ?? "";
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const seededAt = new Date().toISOString();

        const allMasters:    SeedRecord[] = [];
        const allCandidates: SeedRecord[] = [];

        for (const keyword of SEARCH_KEYWORDS) {
          send({ type: "keyword_start", keyword });
          const masters:    SeedRecord[] = [];
          const candidates: SeedRecord[] = [];
          let totalRaw = 0;
          let rejected = 0;

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
            totalRaw += pageResults.length;

            for (const r of pageResults) {
              const lat = Number(r.LATITUDE);
              const lng = Number(r.LONGITUDE || r.LONGTITUDE);
              if (!lat || !lng) { rejected++; continue; }

              const building  = (r.BUILDING  || "").trim();
              const searchval = (r.SEARCHVAL  || "").trim();
              const address   = (r.ADDRESS    || "").trim();
              const postal    = (r.POSTAL     || "").replace(/\D/g, "");

              const c = classify(building, searchval, address, postal, lat, lng);
              if (c.bucket === "reject") { rejected++; continue; }

              const record: SeedRecord = {
                project_name:     c.projectName,
                property_type:    c.propertyType,
                address,
                postal_code:      postal,
                lat,
                lng,
                confidence_score: c.score,
                source_keyword:   keyword,
                reason:           c.reason,
              };

              if (c.bucket === "master") masters.push(record);
              else                       candidates.push(record);
            }

            send({ type: "page", keyword, page, totalPages, master: masters.length, candidate: candidates.length, rejected });

            if (!pageResults.length || page >= totalPages) break;
            await sleep(PAGE_DELAY);
          }

          allMasters.push(...masters);
          allCandidates.push(...candidates);
          send({ type: "keyword_done", keyword, master: masters.length, candidate: candidates.length });
        }

        // ── Deduplicate ─────────────────────────────────────────────────────

        const masterMap = new Map<string, SeedRecord>();
        for (const r of allMasters) {
          const key = `${normalize(r.project_name)}|${r.postal_code}`;
          const ex  = masterMap.get(key);
          if (!ex || r.confidence_score > ex.confidence_score) masterMap.set(key, r);
        }
        const dedupedMasters = [...masterMap.values()];

        // Exclude candidates whose project_name is in the master set
        const masterProjectNames = new Set(
          [...masterMap.keys()].map((k) => k.split("|")[0]),
        );
        const candidateMap = new Map<string, SeedRecord>();
        for (const r of allCandidates) {
          if (masterProjectNames.has(normalize(r.project_name))) continue;
          const key = `${normalize(r.project_name)}|${r.postal_code}`;
          if (!candidateMap.has(key)) candidateMap.set(key, r);
        }
        const dedupedCandidates = [...candidateMap.values()];

        // ── Merge masters by project_name ───────────────────────────────────

        const projectGroupMap = new Map<string, SeedRecord[]>();
        for (const r of dedupedMasters) {
          const key = normalize(r.project_name);
          if (!projectGroupMap.has(key)) projectGroupMap.set(key, []);
          projectGroupMap.get(key)!.push(r);
        }

        const mergedMasters: MergedMasterRecord[] = [...projectGroupMap.values()].map((records) => {
          const best = records.reduce((b, r) => r.confidence_score > b.confidence_score ? r : b, records[0]);
          const lat  = records.reduce((s, r) => s + r.lat, 0) / records.length;
          const lng  = records.reduce((s, r) => s + r.lng, 0) / records.length;
          const postalCodes = [...new Set(records.map((r) => r.postal_code).filter(Boolean))];
          return {
            project_name:     best.project_name,
            property_type:    best.property_type,
            address:          best.address,
            postal_codes:     JSON.stringify(postalCodes),
            block_count:      records.length,
            lat,
            lng,
            confidence_score: best.confidence_score,
            source_keyword:   best.source_keyword,
          };
        });

        // Write masters
        for (let i = 0; i < mergedMasters.length; i += CHUNK) {
          await db.batch(
            mergedMasters.slice(i, i + CHUNK).map((r) => ({
              sql:  `INSERT INTO private_property_master
                       (project_name, property_type, address, postal_codes, block_count,
                        lat, lng, confidence_score, source_keyword, seeded_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?)`,
              args: [r.project_name, r.property_type, r.address, r.postal_codes, r.block_count,
                     r.lat, r.lng, r.confidence_score, r.source_keyword, seededAt],
            })),
            "write",
          );
        }

        // Merge candidates by project_name (same pattern as masters)
        const candidateGroupMap = new Map<string, SeedRecord[]>();
        for (const r of dedupedCandidates) {
          if (masterProjectNames.has(normalize(r.project_name))) continue;
          const key = normalize(r.project_name);
          if (!candidateGroupMap.has(key)) candidateGroupMap.set(key, []);
          candidateGroupMap.get(key)!.push(r);
        }

        const mergedCandidates: MergedMasterRecord[] = [...candidateGroupMap.values()].map((records) => {
          const best = records.reduce((b, r) => r.confidence_score > b.confidence_score ? r : b, records[0]);
          const lat  = records.reduce((s, r) => s + r.lat, 0) / records.length;
          const lng  = records.reduce((s, r) => s + r.lng, 0) / records.length;
          const postalCodes = [...new Set(records.map((r) => r.postal_code).filter(Boolean))];
          return {
            project_name:     best.project_name,
            property_type:    best.property_type,
            address:          best.address,
            postal_codes:     JSON.stringify(postalCodes),
            block_count:      records.length,
            lat, lng,
            confidence_score: best.confidence_score,
            source_keyword:   best.source_keyword,
          };
        });

        send({ type: "inserting", masters: mergedMasters.length, candidates: mergedCandidates.length });

        // Write candidates
        for (let i = 0; i < mergedCandidates.length; i += CHUNK) {
          await db.batch(
            mergedCandidates.slice(i, i + CHUNK).map((r) => ({
              sql:  "INSERT INTO private_property_candidates (project_name, property_type, address, postal_codes, block_count, lat, lng, confidence_score, reason, source_keyword, seeded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              args: [r.project_name, r.property_type, r.address, r.postal_codes, r.block_count, r.lat, r.lng, r.confidence_score,
                     candidateGroupMap.get(normalize(r.project_name))![0].reason, r.source_keyword, seededAt],
            })),
            "write",
          );
        }

        const [masterCount, candidateCount] = await Promise.all([
          db.execute("SELECT COUNT(*) as n FROM private_property_master"),
          db.execute("SELECT COUNT(*) as n FROM private_property_candidates"),
        ]);

        send({
          type:           "done",
          written_master: mergedMasters.length,
          written_cand:   mergedCandidates.length,
          total_master:   Number(masterCount.rows[0]?.n ?? 0),
          total_cand:     Number(candidateCount.rows[0]?.n ?? 0),
        });
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
