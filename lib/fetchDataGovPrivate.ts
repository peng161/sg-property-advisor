// Fetches private residential property transactions from data.gov.sg.
// Dataset: Private Residential Property Transactions
// Resource: 42ff9c2b-3a03-4c8c-9e4c-9e7f5c1b0cbb

const API_URL =
  "https://data.gov.sg/api/action/datastore_search" +
  "?resource_id=42ff9c2b-3a03-4c8c-9e4c-9e7f5c1b0cbb" +
  "&limit=300" +
  "&sort=transaction_date%20desc";

// ---- Types ----

export interface PrivateRecord {
  projectName:     string;
  price:           number;
  areaSqm:         number;
  pricePerSqm:     number;
  transactionDate: string;  // "YYYY-MM"
  tenure:          string;
  district:        string;
  marketSegment:   "CCR" | "RCR" | "OCR";
}

// ---- Helpers ----

// URA market segmentation by planning district number
const CCR_DISTRICTS = new Set([1, 2, 3, 4, 6, 9, 10, 11]);
const RCR_DISTRICTS = new Set([5, 7, 8, 12, 13, 14, 15, 19, 20, 21]);

function districtToSegment(raw: string): "CCR" | "RCR" | "OCR" {
  const n = parseInt(raw.replace(/\D/g, ""), 10);
  if (CCR_DISTRICTS.has(n)) return "CCR";
  if (RCR_DISTRICTS.has(n)) return "RCR";
  return "OCR";
}

// Normalise any date format to "YYYY-MM"
function toYearMonth(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{4})[^0-9](\d{2})/);
  return m ? `${m[1]}-${m[2]}` : raw.slice(0, 7);
}

// ---- Fetch ----

// Raw row from the CKAN datastore — field names as returned by the API
interface RawRow {
  project_name?:     string;
  transaction_price?: string | number;
  area_sqm?:         string | number;
  transaction_date?: string;
  tenure?:           string;
  district?:         string;
  [k: string]: unknown;
}

async function fetchOnce(): Promise<Response> {
  return fetch(API_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "sg-property-advisor/1.0 (Next.js app)",
    },
    next: { revalidate: 1800 },
  });
}

export async function fetchDataGovPrivate(): Promise<PrivateRecord[]> {
  let res = await fetchOnce();

  // Single retry after a short pause when rate-limited
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 3) * 1000;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5000)));
    res = await fetchOnce();
  }

  if (!res.ok) {
    throw new Error(
      `data.gov.sg responded ${res.status} ${res.statusText} — check resource ID`
    );
  }

  const json: unknown = await res.json();

  // CKAN wraps records under result.records
  const raw: RawRow[] =
    (json as { result?: { records?: RawRow[] } })?.result?.records ?? [];

  if (raw.length === 0) {
    throw new Error(
      "data.gov.sg returned 0 records — the resource ID may have changed or the API is down"
    );
  }

  const records: PrivateRecord[] = [];

  for (const r of raw) {
    const price   = Number(r.transaction_price);
    const areaSqm = Number(r.area_sqm);

    // Skip rows with missing or obviously wrong values
    if (!price || !areaSqm || price < 100_000 || areaSqm < 15) continue;

    const transactionDate = toYearMonth(r.transaction_date ?? "");
    if (!transactionDate) continue;

    records.push({
      projectName:     String(r.project_name ?? "").trim() || "Unknown",
      price,
      areaSqm,
      pricePerSqm:     Math.round(price / areaSqm),
      transactionDate,
      tenure:          String(r.tenure ?? "").trim() || "Unknown",
      district:        String(r.district ?? "").trim(),
      marketSegment:   districtToSegment(String(r.district ?? "")),
    });
  }

  // Sort newest first (API should already return this, but enforce it)
  records.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  return records;
}
