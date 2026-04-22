import { type NextRequest } from "next/server";
import { fetchPrivateTransactions } from "@/lib/fetchPrivateTransactions";

// Cache the response for 1 hour on Vercel CDN
export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const minYear  = Number(searchParams.get("minYear")  ?? 2022);
  const maxPrice = Number(searchParams.get("maxPrice") ?? 0);
  const segment  = searchParams.get("segment") ?? "";   // CCR | RCR | OCR | ""

  let transactions = await fetchPrivateTransactions();

  // Filter by year
  transactions = transactions.filter(
    (t) => Number(t.contractDate.slice(0, 4)) >= minYear
  );

  // Filter by max price
  if (maxPrice > 0) {
    transactions = transactions.filter((t) => t.price <= maxPrice);
  }

  // Filter by market segment
  if (segment === "CCR" || segment === "RCR" || segment === "OCR") {
    transactions = transactions.filter((t) => t.marketSegment === segment);
  }

  return Response.json({
    total: transactions.length,
    source: process.env.URA_ACCESS_KEY ? "ura-live" : "mock",
    transactions,
  });
}
