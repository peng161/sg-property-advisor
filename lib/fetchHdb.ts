// Fetches HDB resale transaction data from data.gov.sg.
// Tries the CKAN API first, falls back to the v2 API, then to mock data.

const RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";

const FLAT_TYPE_API: Record<string, string> = {
  "3-Room":    "3 ROOM",
  "4-Room":    "4 ROOM",
  "5-Room":    "5 ROOM",
  "Executive": "EXECUTIVE",
};

// ---- Types ----

export interface HdbResaleRecord {
  block:              string;
  streetName:         string;
  town:               string;
  flatType:           string;
  storeyRange:        string;
  sqm:                number;
  resalePrice:        number;
  pricePerSqm:        number;
  month:              string; // "YYYY-MM"
  leaseCommenceYear:  number;
  remainingLease:     number; // years
}

// ---- Parsers ----

function parseRemainingLease(raw: string): number {
  if (!raw) return 0;
  const m = raw.match(/(\d+)\s*year/i);
  return m ? Number(m[1]) : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ---- API fetch helpers ----

interface RawRow { [key: string]: string }

async function tryDataGovCkan(town: string, flatType: string): Promise<RawRow[]> {
  const filters = encodeURIComponent(
    JSON.stringify({ town: town.toUpperCase(), flat_type: flatType })
  );
  const url =
    `https://data.gov.sg/api/action/datastore_search` +
    `?resource_id=${RESOURCE_ID}&limit=500&filters=${filters}&sort=month%20desc`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`CKAN ${res.status}`);
  const json = await res.json();
  const rows: RawRow[] = json?.result?.records ?? [];
  if (!rows.length) throw new Error("CKAN empty");
  return rows;
}

async function tryDataGovV2(town: string, flatType: string): Promise<RawRow[]> {
  // data.gov.sg v2 API — filter via query params
  const params = new URLSearchParams({
    limit:     "500",
    town:      town.toUpperCase(),
    flat_type: flatType,
  });
  const url = `https://api-production.data.gov.sg/v2/public/api/datasets/${RESOURCE_ID}/records?${params}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`v2 ${res.status}`);
  const json = await res.json();
  // v2 wraps results in different shapes — handle both
  const rows: RawRow[] =
    json?.data?.records ??
    json?.result?.records ??
    json?.records ??
    [];
  if (!rows.length) throw new Error("v2 empty");
  return rows;
}

function rawRowToRecord(r: RawRow): HdbResaleRecord | null {
  const price = Number(r.resale_price);
  const sqm   = Number(r.floor_area_sqm);
  if (!price || !sqm) return null;
  return {
    block:             r.block            ?? "",
    streetName:        r.street_name      ?? "",
    town:              r.town             ?? "",
    flatType:          r.flat_type        ?? "",
    storeyRange:       r.storey_range     ?? "",
    sqm,
    resalePrice:       price,
    pricePerSqm:       Math.round(price / sqm),
    month:             r.month            ?? "",
    leaseCommenceYear: Number(r.lease_commence_date) || 0,
    remainingLease:    parseRemainingLease(r.remaining_lease ?? ""),
  };
}

async function fetchRows(town: string, flatType: string): Promise<RawRow[]> {
  try { return await tryDataGovCkan(town, flatType); } catch { /* fall through */ }
  try { return await tryDataGovV2(town, flatType);   } catch { /* fall through */ }
  return [];
}

// ---- Public API ----

// Returns median resale price per flat type for a given town.
// Used by the calculator to estimate current market value.
export async function fetchHdbPrices(
  town: string
): Promise<Record<string, number> | null> {
  const results = await Promise.all(
    Object.entries(FLAT_TYPE_API).map(async ([ft, apiFlat]) => {
      const rows = await fetchRows(town, apiFlat);
      const prices = rows.map((r) => Number(r.resale_price)).filter((p) => p > 0);
      return [ft, prices.length ? median(prices.slice(0, 100)) : 0] as const;
    })
  );

  const prices: Record<string, number> = {};
  for (const [ft, val] of results) {
    if (val > 0) prices[ft] = val;
  }
  return Object.keys(prices).length > 0 ? prices : null;
}

// Returns recent individual HDB resale transactions for a given town.
// Includes remaining lease, floor area, storey range.
export async function fetchHdbTransactions(
  town: string,
  flatType?: string  // optional — if omitted, fetches all flat types
): Promise<HdbResaleRecord[]> {
  const typesToFetch = flatType
    ? [[flatType, FLAT_TYPE_API[flatType] ?? flatType] as [string, string]]
    : Object.entries(FLAT_TYPE_API);

  const allRows = (
    await Promise.all(typesToFetch.map(([, apiFlat]) => fetchRows(town, apiFlat)))
  ).flat();

  const records = allRows
    .map(rawRowToRecord)
    .filter((r): r is HdbResaleRecord => r !== null)
    // keep last 3 years
    .filter((r) => Number(r.month.slice(0, 4)) >= new Date().getFullYear() - 3)
    .sort((a, b) => b.month.localeCompare(a.month));

  return records;
}
