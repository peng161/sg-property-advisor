// Per-project transaction enrichment service.
// Fetches per-project transactions from data.gov.sg CKAN, computes PSF metrics,
// caches results in private_project_tx_cache (7-day TTL by default).

import { getDb } from "@/lib/sqlite";

// ── Public types ──────────────────────────────────────────────────────────────

export interface PropertyToEnrich {
  project_name:      string;
  address:           string;
  postal_code:       string;
  lat:               number;
  lng:               number;
  property_category: string;
  distance_km?:      number;
}

export interface EnrichedProperty extends PropertyToEnrich {
  transaction_status:         "success" | "cached" | "no_data" | "failed";
  latest_psf:                 number | null;
  median_psf_12m:             number | null;
  last_12m_transaction_count: number;
  price_trend_label:          string;
  liquidity_label:            string;
  confidence:                 "High" | "Medium" | "Low";
  checked_at:                 string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RESOURCE_ID = "42ff9c2b-3a03-4c8c-9e4c-9e7f5c1b0cbb";
const CKAN_BASE   = "https://data.gov.sg/api/action/datastore_search";
const TTL_MS      = 7 * 24 * 60 * 60 * 1000; // 7 days
const PSM_TO_PSF  = 1 / 10.7639;

// ── Table init ────────────────────────────────────────────────────────────────

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const db = getDb();
  if (!db) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS private_project_tx_cache (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name          TEXT NOT NULL UNIQUE,
      property_category     TEXT,
      latest_psf            REAL,
      median_psf_12m        REAL,
      last_12m_tx_count     INTEGER,
      price_trend_label     TEXT,
      liquidity_label       TEXT,
      confidence            TEXT,
      transaction_status    TEXT NOT NULL,
      checked_at            TEXT NOT NULL
    )
  `);
  tableReady = true;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

interface CachedMetrics {
  transaction_status:         "success" | "cached" | "no_data" | "failed";
  latest_psf:                 number | null;
  median_psf_12m:             number | null;
  last_12m_transaction_count: number;
  price_trend_label:          string;
  liquidity_label:            string;
  confidence:                 "High" | "Medium" | "Low";
  checked_at:                 string;
}

async function readCache(projectName: string): Promise<CachedMetrics | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const res = await db.execute({
      sql: `SELECT * FROM private_project_tx_cache
            WHERE UPPER(project_name) = UPPER(?) LIMIT 1`,
      args: [projectName],
    });
    if (!res.rows.length) return null;

    const r = res.rows[0];
    const age = Date.now() - new Date(String(r.checked_at)).getTime();
    if (age > TTL_MS) return null; // expired

    return {
      transaction_status:         "cached",
      latest_psf:                 r.latest_psf != null ? Number(r.latest_psf) : null,
      median_psf_12m:             r.median_psf_12m != null ? Number(r.median_psf_12m) : null,
      last_12m_transaction_count: Number(r.last_12m_tx_count ?? 0),
      price_trend_label:          String(r.price_trend_label ?? "—"),
      liquidity_label:            String(r.liquidity_label   ?? "—"),
      confidence:                 String(r.confidence        ?? "Low") as "High" | "Medium" | "Low",
      checked_at:                 String(r.checked_at),
    };
  } catch {
    return null;
  }
}

async function writeCache(
  projectName:      string,
  propertyCategory: string,
  metrics:          CachedMetrics,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO private_project_tx_cache
              (project_name, property_category, latest_psf, median_psf_12m,
               last_12m_tx_count, price_trend_label, liquidity_label,
               confidence, transaction_status, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        projectName, propertyCategory,
        metrics.latest_psf, metrics.median_psf_12m,
        metrics.last_12m_transaction_count,
        metrics.price_trend_label, metrics.liquidity_label,
        metrics.confidence, metrics.transaction_status,
        metrics.checked_at,
      ],
    });
  } catch (err) {
    console.error("[tx-cache] write failed:", err instanceof Error ? err.message : String(err));
  }
}

// ── CKAN fetcher ──────────────────────────────────────────────────────────────

interface CkanRow {
  project_name?:      string;
  transaction_price?: string | number;
  area_sqm?:          string | number;
  transaction_date?:  string;
  [k: string]: unknown;
}

async function fetchCkanRows(projectName: string): Promise<CkanRow[]> {
  const filters = encodeURIComponent(
    JSON.stringify({ project_name: projectName.toUpperCase() })
  );
  const url = `${CKAN_BASE}?resource_id=${RESOURCE_ID}&filters=${filters}&limit=100&sort=transaction_date%20desc`;

  console.log(`[tx-enrich] fetching "${projectName}"…`);

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "sg-property-advisor/1.0 (Next.js)",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 429) {
    throw new Error("rate_limited");
  }
  if (!res.ok) {
    throw new Error(`CKAN HTTP ${res.status}`);
  }

  const json: unknown = await res.json();
  return (json as { result?: { records?: CkanRow[] } })?.result?.records ?? [];
}

// ── Metrics computation ───────────────────────────────────────────────────────

interface TxPoint { psm: number; date: string }

function medianOf(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function computeMetrics(points: TxPoint[], now: Date): Omit<CachedMetrics, "transaction_status" | "checked_at"> {
  if (!points.length) {
    return {
      latest_psf: null, median_psf_12m: null, last_12m_transaction_count: 0,
      price_trend_label: "—", liquidity_label: "—", confidence: "Low",
    };
  }

  const sorted = [...points].sort((a, b) => b.date.localeCompare(a.date));
  const latest_psf = Math.round(sorted[0].psm * PSM_TO_PSF);

  // "YYYY-MM" cutoffs
  const cut12m = new Date(now);
  cut12m.setMonth(cut12m.getMonth() - 12);
  const ym12m = cut12m.toISOString().slice(0, 7);

  const cut6m = new Date(now);
  cut6m.setMonth(cut6m.getMonth() - 6);
  const ym6m = cut6m.toISOString().slice(0, 7);

  const in12m   = sorted.filter((p) => p.date >= ym12m);
  const last6m  = in12m.filter((p) => p.date >= ym6m);
  const prev6m  = in12m.filter((p) => p.date <  ym6m);

  const last_12m_transaction_count = in12m.length;

  const median_psf_12m = in12m.length
    ? Math.round(medianOf(in12m.map((p) => p.psm)) * PSM_TO_PSF)
    : null;

  // Trend: compare median PSM of last 6m vs previous 6m (need ≥ 2 data points each)
  let price_trend_label = "Stable";
  if (last6m.length >= 2 && prev6m.length >= 2) {
    const mLast = medianOf(last6m.map((p) => p.psm));
    const mPrev = medianOf(prev6m.map((p) => p.psm));
    const pct   = ((mLast - mPrev) / mPrev) * 100;
    price_trend_label = pct > 5 ? "Rising" : pct < -5 ? "Softening" : "Stable";
  }

  const liquidity_label =
    last_12m_transaction_count >= 12 ? "High" :
    last_12m_transaction_count >= 4  ? "Medium" : "Low";

  const confidence: "High" | "Medium" | "Low" =
    in12m.length >= 8 ? "High" :
    in12m.length >= 3 ? "Medium" : "Low";

  return { latest_psf, median_psf_12m, last_12m_transaction_count, price_trend_label, liquidity_label, confidence };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function enrichProperty(
  property: PropertyToEnrich,
  forceRefresh = false,
): Promise<EnrichedProperty> {
  await ensureTable();

  if (!forceRefresh) {
    const cached = await readCache(property.project_name);
    if (cached) {
      console.log(`[tx-enrich] cache hit for "${property.project_name}"`);
      return { ...property, ...cached };
    }
  }

  const now        = new Date();
  const checked_at = now.toISOString();

  try {
    const rows = await fetchCkanRows(property.project_name);

    if (!rows.length) {
      const metrics: CachedMetrics = {
        transaction_status: "no_data", latest_psf: null, median_psf_12m: null,
        last_12m_transaction_count: 0, price_trend_label: "—",
        liquidity_label: "—", confidence: "Low", checked_at,
      };
      await writeCache(property.project_name, property.property_category, metrics);
      console.log(`[tx-enrich] no data for "${property.project_name}"`);
      return { ...property, ...metrics };
    }

    const points: TxPoint[] = rows
      .filter((r) => Number(r.transaction_price) > 0 && Number(r.area_sqm) > 0)
      .map((r) => ({
        psm:  Number(r.transaction_price) / Number(r.area_sqm),
        date: String(r.transaction_date ?? "").slice(0, 7),
      }))
      .filter((p) => p.date.length >= 7);

    const computed = computeMetrics(points, now);
    const metrics: CachedMetrics = {
      transaction_status: "success", checked_at, ...computed,
    };

    await writeCache(property.project_name, property.property_category, metrics);
    console.log(
      `[tx-enrich] ✓ "${property.project_name}" — ` +
      `${computed.last_12m_transaction_count} txns, ` +
      `PSF ${computed.latest_psf}, trend: ${computed.price_trend_label}`
    );

    return { ...property, ...metrics };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tx-enrich] ✗ "${property.project_name}": ${msg}`);

    return {
      ...property,
      transaction_status: "failed",
      latest_psf: null, median_psf_12m: null,
      last_12m_transaction_count: 0,
      price_trend_label: "—", liquidity_label: "—",
      confidence: "Low", checked_at,
    };
  }
}
