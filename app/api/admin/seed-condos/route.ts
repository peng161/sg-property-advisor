import { getDb } from "@/lib/sqlite";

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

const REJECT_PHRASES = [
  "GARDENS BY THE BAY",
  "MRT STATION", "MRT EXIT", "STATION EXIT",
  "BUS STOP",
  "AVENUE TOWARDS", "ROAD TOWARDS",
  "EXPRESSWAY", "PARK CONNECTOR",
  "NATURE RESERVE",
  "SCHOOL", "HOSPITAL", "CLINIC",
  "CHURCH", "TEMPLE", "MOSQUE",
  "COMMUNITY CENTRE",
  "INDUSTRIAL", "WAREHOUSE", "FACTORY",
] as const;

const HIGH_CONF_TERMS = [
  "EXECUTIVE CONDOMINIUM", "CONDOMINIUM", "CONDO",
  "APARTMENT", "RESIDENCES", "RESIDENCE", "SUITES",
] as const;

const BRANDING_WORDS = [
  "PARC", "PARK", "VIEW", "HEIGHTS", "HILL", "CREST", "GREEN", "GARDENS",
  "VALLEY", "BAY", "SHORE", "TOWERS", "GROVE", "LOFT", "CASA", "COURT",
  "POINT", "PLACE", "MANSION", "TREES", "LAKE",
] as const;

const ROAD_SUFFIX_RE = /\b(AVENUE|ROAD|STREET|DRIVE|CRESCENT|WALK|WAY|LANE|CLOSE|LINK|FLYOVER|HIGHWAY|BOULEVARD|RING)\s*\d*$/;

const MAX_PAGES = 80;
const PAGE_DELAY = 120;

interface OneMapResult {
  BUILDING:   string;
  SEARCHVAL:  string;
  ADDRESS:    string;
  POSTAL:     string;
  LATITUDE:   string;
  LONGITUDE:  string;
  LONGTITUDE: string;
}

type Bucket = "master" | "candidate" | "reject";

interface Classified {
  bucket:       Bucket;
  score:        number;
  reason:       string;
  projectName:  string;
  propertyType: "Condo" | "EC";
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

function classify(
  building: string, searchval: string, address: string,
  postal: string, lat: number, lng: number,
): Classified {
  const rawBuilding = (building || searchval || "").trim();
  const b     = rawBuilding.toUpperCase();
  const a     = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  // Hard rejects — specific non-residential phrases only
  for (const phrase of REJECT_PHRASES) {
    if (combo.includes(phrase)) {
      return { bucket: "reject", score: 0, reason: `reject: "${phrase}"`, projectName: rawBuilding, propertyType: "Condo" };
    }
  }
  if (/\bERP\b/.test(combo)) {
    return { bucket: "reject", score: 0, reason: 'reject: "ERP"', projectName: rawBuilding, propertyType: "Condo" };
  }

  let score = 0;
  const reasons: string[] = [];
  let isEC = false;

  // +4 definitive condo / EC identifier
  for (const term of HIGH_CONF_TERMS) {
    if (combo.includes(term)) {
      score += 4;
      reasons.push(`+4 "${term}"`);
      if (term === "EXECUTIVE CONDOMINIUM") isEC = true;
      break;
    }
  }

  // +2 named residential project
  const cleanPostal = postal.replace(/\D/g, "");
  if (rawBuilding.length > 0 && cleanPostal.length === 6 && lat && lng) {
    const wordCount       = b.split(/\s+/).filter(Boolean).length;
    const isBuildingBlock = /^(BLK|BLOCK)\s*\d/i.test(rawBuilding);
    const startsWithDigit = /^\d/.test(rawBuilding);
    const isRoadName      = ROAD_SUFFIX_RE.test(b);

    if (!isBuildingBlock && !startsWithDigit && !isRoadName && wordCount >= 2 && wordCount <= 5) {
      score += 2;
      reasons.push("+2 named project");
    }
  }

  // +1 residential branding word (whole-word match)
  for (const word of BRANDING_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(b)) {
      score += 1;
      reasons.push(`+1 branding "${word}"`);
      break;
    }
  }

  const projectName   = rawBuilding || address.split(" ").slice(0, 4).join(" ");
  const propertyType: "Condo" | "EC" = isEC ? "EC" : "Condo";
  const reasonStr     = reasons.join(", ") || "no positive signals";

  // score >= 4 → master, 2–3 → candidate, < 2 → reject
  if (score < 2)  return { bucket: "reject",    score, reason: `score ${score}: ${reasonStr}`, projectName, propertyType };
  if (score <= 3) return { bucket: "candidate", score, reason: reasonStr,                       projectName, propertyType };
  return                  { bucket: "master",    score, reason: reasonStr,                       projectName, propertyType };
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

        // Create tables
        await db.execute(`
          CREATE TABLE IF NOT EXISTS private_property_master (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name     TEXT    NOT NULL,
            property_type    TEXT    NOT NULL DEFAULT 'Condo',
            address          TEXT,
            postal_code      TEXT,
            lat              REAL    NOT NULL,
            lng              REAL    NOT NULL,
            confidence_score INTEGER NOT NULL,
            source_keyword   TEXT,
            seeded_at        TEXT    NOT NULL,
            UNIQUE(project_name, postal_code)
          )
        `);
        await db.execute(
          "CREATE INDEX IF NOT EXISTS idx_ppm_loc ON private_property_master(lat, lng)"
        );
        await db.execute(`
          CREATE TABLE IF NOT EXISTS private_property_candidates (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name     TEXT    NOT NULL,
            property_type    TEXT    NOT NULL DEFAULT 'Condo',
            address          TEXT,
            postal_code      TEXT,
            lat              REAL    NOT NULL,
            lng              REAL    NOT NULL,
            confidence_score INTEGER NOT NULL,
            reason           TEXT,
            source_keyword   TEXT,
            seeded_at        TEXT    NOT NULL,
            UNIQUE(project_name, postal_code)
          )
        `);
        await db.execute(
          "CREATE INDEX IF NOT EXISTS idx_ppc_loc ON private_property_candidates(lat, lng)"
        );

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

        // Deduplicate
        const masterMap = new Map<string, SeedRecord>();
        for (const r of allMasters) {
          const key = `${normalize(r.project_name)}|${r.postal_code}`;
          const ex  = masterMap.get(key);
          if (!ex || r.confidence_score > ex.confidence_score) masterMap.set(key, r);
        }
        const dedupedMasters = [...masterMap.values()];

        const candidateMap = new Map<string, SeedRecord>();
        for (const r of allCandidates) {
          const key = `${normalize(r.project_name)}|${r.postal_code}`;
          if (masterMap.has(key)) continue;
          if (!candidateMap.has(key)) candidateMap.set(key, r);
        }

        // Exclude anything already promoted to master in a previous run
        const existingMasterRes = await db.execute(
          "SELECT project_name, postal_code FROM private_property_master",
        );
        const existingMasterKeys = new Set(
          existingMasterRes.rows.map(
            (r) => `${normalize(String(r.project_name))}|${String(r.postal_code)}`,
          ),
        );
        const dedupedCandidates = [...candidateMap.values()].filter(
          (r) => !existingMasterKeys.has(`${normalize(r.project_name)}|${r.postal_code}`),
        );

        // Also clean up any stale candidates that were previously accepted
        if (existingMasterKeys.size > 0) {
          const staleCheck = await db.execute(
            "SELECT id, project_name, postal_code FROM private_property_candidates",
          );
          const staleIds = staleCheck.rows
            .filter((r) => existingMasterKeys.has(`${normalize(String(r.project_name))}|${String(r.postal_code)}`))
            .map((r) => Number(r.id))
            .filter(Boolean);
          if (staleIds.length > 0) {
            const CHUNK = 500;
            for (let i = 0; i < staleIds.length; i += CHUNK) {
              const batch = staleIds.slice(i, i + CHUNK);
              await db.execute({
                sql:  `DELETE FROM private_property_candidates WHERE id IN (${batch.map(() => "?").join(",")})`,
                args: batch,
              });
            }
            send({ type: "cleanup", removed: staleIds.length });
          }
        }

        send({ type: "inserting", masters: dedupedMasters.length, candidates: dedupedCandidates.length });

        const CHUNK = 500;
        for (let i = 0; i < dedupedMasters.length; i += CHUNK) {
          await db.batch(
            dedupedMasters.slice(i, i + CHUNK).map((r) => ({
              sql:  "INSERT OR REPLACE INTO private_property_master (project_name, property_type, address, postal_code, lat, lng, confidence_score, source_keyword, seeded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              args: [r.project_name, r.property_type, r.address, r.postal_code, r.lat, r.lng, r.confidence_score, r.source_keyword, seededAt],
            })),
            "write",
          );
        }

        for (let i = 0; i < dedupedCandidates.length; i += CHUNK) {
          await db.batch(
            dedupedCandidates.slice(i, i + CHUNK).map((r) => ({
              sql:  "INSERT OR IGNORE INTO private_property_candidates (project_name, property_type, address, postal_code, lat, lng, confidence_score, reason, source_keyword, seeded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              args: [r.project_name, r.property_type, r.address, r.postal_code, r.lat, r.lng, r.confidence_score, r.reason, r.source_keyword, seededAt],
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
          written_master: dedupedMasters.length,
          written_cand:   dedupedCandidates.length,
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
