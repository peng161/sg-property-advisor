import { type NextRequest } from "next/server";
import { fetchDataGovPrivate, type PrivateRecord } from "@/lib/fetchDataGovPrivate";
import { MOCK_PRIVATE_TRANSACTIONS } from "@/lib/mockPrivateTransactions";

let CACHE: { records: PrivateRecord[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const revalidate = 1800;

export async function GET(request: NextRequest) {
  const sp       = request.nextUrl.searchParams;
  const minYear  = Number(sp.get("minYear")  ?? 0);
  const maxPrice = Number(sp.get("maxPrice") ?? 0);
  const segment  = sp.get("segment") ?? "";

  const now = Date.now();
  let source = "data.gov.sg";

  if (!CACHE || now > CACHE.expiresAt) {
    try {
      console.log("[private-properties] fetching from data.gov.sg…");
      const records = await fetchDataGovPrivate();
      CACHE = { records, expiresAt: now + CACHE_TTL_MS };
      console.log(`[private-properties] cached ${records.length} records`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[private-properties] fetch failed:", msg);

      if (CACHE && CACHE.records.length > 0) {
        // Serve previous live data, retry next request
        console.warn("[private-properties] serving stale cache");
        source = "data.gov.sg (cached)";
      } else {
        // No cache at all — serve mock data so the UI stays useful
        console.warn("[private-properties] no cache available, serving mock data");
        CACHE = { records: MOCK_PRIVATE_TRANSACTIONS, expiresAt: now + CACHE_TTL_MS };
        source = "sample data";
      }
    }
  }

  let data = CACHE!.records;

  if (minYear > 0)
    data = data.filter((r) => Number(r.transactionDate.slice(0, 4)) >= minYear);
  if (maxPrice > 0)
    data = data.filter((r) => r.price <= maxPrice);
  if (segment === "CCR" || segment === "RCR" || segment === "OCR")
    data = data.filter((r) => r.marketSegment === segment);

  return Response.json({ total: data.length, source, transactions: data });
}
