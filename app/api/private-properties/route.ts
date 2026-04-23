import { type NextRequest } from "next/server";
import { fetchDataGovPrivate, type PrivateRecord } from "@/lib/fetchDataGovPrivate";

// Keep stale records so a 429 can still serve something
let CACHE: { records: PrivateRecord[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — reduces hit rate on data.gov.sg

export const revalidate = 1800;

export async function GET(request: NextRequest) {
  const sp       = request.nextUrl.searchParams;
  const minYear  = Number(sp.get("minYear")  ?? 0);
  const maxPrice = Number(sp.get("maxPrice") ?? 0);
  const segment  = sp.get("segment") ?? "";

  const now = Date.now();

  if (!CACHE || now > CACHE.expiresAt) {
    try {
      console.log("[private-properties] fetching from data.gov.sg…");
      const records = await fetchDataGovPrivate();
      CACHE = { records, expiresAt: now + CACHE_TTL_MS };
      console.log(`[private-properties] cached ${records.length} records`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[private-properties] fetch failed:", msg);

      // Serve stale cache rather than an empty error when rate-limited
      if (CACHE && CACHE.records.length > 0) {
        console.warn("[private-properties] serving stale cache after fetch failure");
        // Don't update CACHE so the next request retries sooner
      } else {
        return Response.json(
          { error: msg, source: "error", transactions: [], total: 0 },
          { status: 502 },
        );
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

  const stale = CACHE!.expiresAt < now;

  return Response.json({
    total:        data.length,
    source:       stale ? "data.gov.sg (cached)" : "data.gov.sg",
    transactions: data,
  });
}
