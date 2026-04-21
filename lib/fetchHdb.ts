const RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";

const FLAT_TYPE_API: Record<string, string> = {
  "3-Room":    "3 ROOM",
  "4-Room":    "4 ROOM",
  "5-Room":    "5 ROOM",
  "Executive": "EXECUTIVE",
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function fetchOneType(town: string, flatType: string): Promise<number | null> {
  const apiFlat = FLAT_TYPE_API[flatType];
  if (!apiFlat) return null;

  const filters = encodeURIComponent(
    JSON.stringify({ town: town.toUpperCase(), flat_type: apiFlat })
  );
  const url =
    `https://data.gov.sg/api/action/datastore_search` +
    `?resource_id=${RESOURCE_ID}&limit=200&filters=${filters}&sort=month%20desc`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const json = await res.json();
    const records: Array<{ resale_price: string }> = json?.result?.records ?? [];
    if (records.length === 0) return null;
    const prices = records
      .slice(0, 100)
      .map((r) => Number(r.resale_price))
      .filter((p) => p > 0);
    return median(prices);
  } catch {
    return null;
  }
}

// Returns median resale price for each flat type in the given town.
// Returns null if the API is unreachable.
export async function fetchHdbPrices(
  town: string
): Promise<Record<string, number> | null> {
  const flatTypes = Object.keys(FLAT_TYPE_API);
  const results = await Promise.all(flatTypes.map((ft) => fetchOneType(town, ft)));

  const prices: Record<string, number> = {};
  flatTypes.forEach((ft, i) => {
    if (results[i]) prices[ft] = results[i]!;
  });

  return Object.keys(prices).length > 0 ? prices : null;
}
