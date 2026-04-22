import { type NextRequest } from "next/server";
import { fetchDataGovPrivate, type PrivateRecord } from "@/lib/fetchDataGovPrivate";

// In-memory cache — survives across requests in the same warm serverless instance
let CACHE: { records: PrivateRecord[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Also tell Vercel CDN to cache the response for 5 minutes
export const revalidate = 300;

export async function GET(request: NextRequest) {
  const sp       = request.nextUrl.searchParams;
  const minYear  = Number(sp.get("minYear")  ?? 0);
  const maxPrice = Number(sp.get("maxPrice") ?? 0);
  const segment  = sp.get("segment") ?? "";

  // Serve from in-memory cache if still fresh
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
      return Response.json(
        { error: msg, source: "error", transactions: [] },
        { status: 502 }
      );
    }
  }

  let data = CACHE.records;

  if (minYear > 0) {
    data = data.filter((r) => Number(r.transactionDate.slice(0, 4)) >= minYear);
  }
  if (maxPrice > 0) {
    data = data.filter((r) => r.price <= maxPrice);
  }
  if (segment === "CCR" || segment === "RCR" || segment === "OCR") {
    data = data.filter((r) => r.marketSegment === segment);
  }

  return Response.json({
    total:        data.length,
    source:       "data.gov.sg",
    transactions: data,
  });
}
