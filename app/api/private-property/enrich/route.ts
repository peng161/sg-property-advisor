import { type NextRequest } from "next/server";
import {
  enrichProperty,
  type PropertyToEnrich,
  type EnrichedProperty,
} from "@/lib/services/propertyTransactionService";

export const dynamic = "force-dynamic";

const INTER_REQUEST_DELAY_MS = 350;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  let body: { properties?: unknown; forceRefresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.properties) || body.properties.length === 0) {
    return Response.json({ error: "properties array required" }, { status: 400 });
  }

  const forceRefresh = body.forceRefresh === true;
  const results: EnrichedProperty[] = [];

  for (let i = 0; i < body.properties.length; i++) {
    const raw = body.properties[i];

    if (!raw || typeof raw !== "object" || !("project_name" in raw)) {
      results.push({
        project_name: "",
        address: "", postal_code: "", lat: 0, lng: 0,
        property_category: "Condominium",
        transaction_status: "failed",
        latest_psf: null, median_psf_12m: null,
        last_12m_transaction_count: 0,
        price_trend_label: "—", liquidity_label: "—",
        confidence: "Low", checked_at: new Date().toISOString(),
      });
      continue;
    }

    const prop = raw as Record<string, unknown>;
    const input: PropertyToEnrich = {
      project_name:      String(prop.project_name      ?? ""),
      address:           String(prop.address           ?? ""),
      postal_code:       String(prop.postal_code       ?? ""),
      lat:               Number(prop.lat               ?? 0),
      lng:               Number(prop.lng               ?? 0),
      property_category: String(prop.property_category ?? "Condominium"),
      distance_km:       prop.distance_km != null ? Number(prop.distance_km) : undefined,
    };

    if (!input.project_name) {
      continue;
    }

    try {
      const enriched = await enrichProperty(input, forceRefresh);
      results.push(enriched);
    } catch (err) {
      console.error("[enrich] unexpected error:", err instanceof Error ? err.message : String(err));
      results.push({
        ...input,
        transaction_status: "failed",
        latest_psf: null, median_psf_12m: null,
        last_12m_transaction_count: 0,
        price_trend_label: "—", liquidity_label: "—",
        confidence: "Low", checked_at: new Date().toISOString(),
      });
    }

    // Pace between requests to avoid rate-limiting upstream (skip delay after last item)
    if (i < body.properties.length - 1) {
      await sleep(INTER_REQUEST_DELAY_MS);
    }
  }

  return Response.json({ results });
}
