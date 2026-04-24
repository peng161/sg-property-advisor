import { assess } from "@/lib/calculator";
import { fetchHdbPrices, fetchHdbTransactions, fetchHdbBlockLeaseYear } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import { fetchPrivateTransactions } from "@/lib/fetchPrivateTransactions";
import type { PrivateTransaction } from "@/lib/fetchPrivateTransactions";
import { EC_OPTIONS } from "@/lib/mockData";
import { geocodePostal } from "@/lib/geocode";
import ResultsDashboard from "@/components/ResultsDashboard";
import type { ExtendedProjectSummary } from "@/components/ResultsDashboard";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FLAT_TYPE_API: Record<string, string> = {
  "3-Room": "3 ROOM", "4-Room": "4 ROOM", "5-Room": "5 ROOM", "Executive": "EXECUTIVE",
};

function medianOf(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function getLeaseBand(years: number) {
  if (years >= 90) return "90+";
  if (years >= 80) return "80–90";
  if (years >= 70) return "70–80";
  if (years >= 60) return "60–70";
  return "<60";
}

function computePropertyScore(
  p: { marketSegment: string; minPrice: number; tenure: string; txCount: number },
  budget: number
): number {
  let score = 58;
  score += p.marketSegment === "OCR" ? 12 : p.marketSegment === "RCR" ? 9 : 5;
  if (p.minPrice <= budget) score += 12;
  else if (p.minPrice <= budget * 1.2) score += 5;
  score += Math.min(Math.floor(p.txCount / 3), 7);
  if (p.tenure.toLowerCase().includes("freehold") || p.tenure.includes("999")) score += 5;
  return Math.min(Math.round(score), 99);
}

function computeOptionScore(
  type: string, affordable: boolean, gainPct: number, lease: number
): number {
  const base: Record<string, number> = {
    Stay: 32, "Bigger HDB": 52, EC: 67, "Private Condo": 72,
  };
  let s = base[type] ?? 50;
  if (affordable) s += 18;
  if (gainPct > 50) s += 5; else if (gainPct > 20) s += 3;
  if (lease >= 75) s += 5; else if (lease >= 60) s += 2;
  return Math.min(Math.round(s), 99);
}

// ── PageProps ─────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ResultsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const numChildren = Number(params.numChildren ?? 0);

  const rawCitizenship = params.citizenship ?? "SC";
  const citizenship: "SC" | "PR" | "Foreigner" =
    rawCitizenship === "PR" ? "PR"
    : rawCitizenship === "Foreigner" ? "Foreigner"
    : "SC";

  const postalCode = params.postalCode ?? "";
  let town = params.town ?? "";
  let geoAddress = "";
  let geoBlock   = "";
  let geoStreet  = "";
  let lat = 0; let lng = 0;

  if (postalCode) {
    const geo = await geocodePostal(postalCode);
    if (geo) {
      if (!town && geo.town) town = geo.town;
      geoAddress = geo.fullAddress;
      geoBlock   = geo.block;
      geoStreet  = geo.street;
      lat = geo.lat;
      lng = geo.lng;
    }
  }

  const input = {
    flatType:      params.flatType      ?? "",
    town,
    postalCode,
    floor:         Number(params.floor       ?? 10),
    sqm:           Number(params.sqm         ?? 0),
    leaseYear:     Number(params.leaseYear   ?? 0),
    purchasePrice: Number(params.purchasePrice ?? 0),
    purchaseYear:  Number(params.purchaseYear  ?? new Date().getFullYear() - 10),
    remainingLoan: Number(params.remainingLoan ?? 0),
    cpfUsed:       Number(params.cpfUsed       ?? 0),
    myIncome:      Number(params.myIncome      ?? 0),
    wifeIncome:    Number(params.wifeIncome    ?? 0),
    citizenship,
    sellingFirst:  params.sellingFirst !== "no",
  };

  const [hdb, privatePrices, hdbTx] = await Promise.all([
    fetchHdbPrices(town),
    fetchPrivatePrices(),
    town ? fetchHdbTransactions(town) : Promise.resolve([]),
  ]);

  // Auto-detect lease year
  const matchingTx = geoBlock
    ? hdbTx.find((t) => t.block.trim().toUpperCase() === geoBlock.trim().toUpperCase())
    : undefined;
  const leaseYearFromApi =
    !matchingTx && geoBlock && town
      ? await fetchHdbBlockLeaseYear(geoBlock, town, geoStreet || undefined)
      : null;
  const autoLeaseYear =
    matchingTx?.leaseCommenceYear ?? leaseYearFromApi ?? input.leaseYear;
  const remainingLease = autoLeaseYear > 0
    ? Math.max(0, 99 - (new Date().getFullYear() - autoLeaseYear))
    : 0;

  // Nearby market value
  const myLeaseBand = remainingLease > 0 ? getLeaseBand(remainingLease) : null;
  const apiFlatType = FLAT_TYPE_API[input.flatType];
  let nearbyMarketValue = 0;
  if (hdbTx.length > 0 && apiFlatType && myLeaseBand) {
    const comparable = hdbTx.filter(
      (t) => t.flatType === apiFlatType && getLeaseBand(t.remainingLease) === myLeaseBand
    );
    if (comparable.length > 0)
      nearbyMarketValue = medianOf(comparable.map((t) => t.resalePrice));
  }

  const hdbWithNearby = nearbyMarketValue > 0
    ? { ...(hdb ?? {}), [input.flatType]: nearbyMarketValue }
    : hdb;

  const result = assess(input, { hdb: hdbWithNearby, private: privatePrices });
  const gainPct = input.purchasePrice > 0
    ? (result.capitalGain / input.purchasePrice) * 100
    : 0;

  const optionScores = result.options.map((o) =>
    computeOptionScore(o.type, o.affordable, gainPct, remainingLease)
  );

  // Next flat type for HDB upgrade
  const FLAT_ORDER = ["3-Room", "4-Room", "5-Room", "Executive"] as const;
  const nextFlatType: string | null =
    FLAT_ORDER[FLAT_ORDER.indexOf(input.flatType as typeof FLAT_ORDER[number]) + 1] ?? null;
  const nextApiFlatType = nextFlatType ? FLAT_TYPE_API[nextFlatType] : null;
  const biggerHdbListings = nextApiFlatType
    ? hdbTx.filter((t) => t.flatType === nextApiFlatType).slice(0, 12)
    : [];

  // Private listings with scores and trends
  const privateTx = await fetchPrivateTransactions();
  const TOWN_SEGMENT: Record<string, "OCR" | "RCR" | "CCR"> = {
    "Ang Mo Kio": "OCR", "Bedok": "OCR", "Bishan": "RCR", "Bukit Batok": "OCR",
    "Bukit Merah": "RCR", "Bukit Panjang": "OCR", "Bukit Timah": "RCR",
    "Central Area": "CCR", "Choa Chu Kang": "OCR", "Clementi": "RCR",
    "Geylang": "RCR", "Hougang": "OCR", "Jurong East": "OCR", "Jurong West": "OCR",
    "Kallang/Whampoa": "RCR", "Marine Parade": "RCR", "Pasir Ris": "OCR",
    "Punggol": "OCR", "Queenstown": "RCR", "Sembawang": "OCR", "Sengkang": "OCR",
    "Serangoon": "RCR", "Tampines": "OCR", "Toa Payoh": "RCR",
    "Woodlands": "OCR", "Yishun": "OCR",
  };
  const userSegment: "OCR" | "RCR" | "CCR" = TOWN_SEGMENT[town] ?? "OCR";

  type ProjectBucket = {
    txs: PrivateTransaction[];
    min: number; max: number;
    psms: number[]; sqms: number[];
  };
  const byProject = new Map<string, ProjectBucket>();
  for (const t of privateTx) {
    if (t.marketSegment !== userSegment) continue;
    const b = byProject.get(t.project);
    if (!b) {
      byProject.set(t.project, { txs: [t], min: t.price, max: t.price, psms: [t.pricePerSqm], sqms: [t.sqm] });
    } else {
      b.txs.push(t);
      b.min = Math.min(b.min, t.price);
      b.max = Math.max(b.max, t.price);
      b.psms.push(t.pricePerSqm);
      b.sqms.push(t.sqm);
    }
  }

  function projectTrend3Y(txs: PrivateTransaction[]): number {
    const sorted = [...txs].sort((a, b) => a.contractDate.localeCompare(b.contractDate));
    if (sorted.length < 2) return 0;
    const first = sorted[0].pricePerSqm;
    const last  = sorted[sorted.length - 1].pricePerSqm;
    return first > 0 ? ((last - first) / first * 100) : 0;
  }

  const privateListings: ExtendedProjectSummary[] = Array.from(byProject.entries())
    .map(([project, b]) => {
      const med = medianOf(b.psms);
      const score = computePropertyScore({
        marketSegment: b.txs[0].marketSegment,
        minPrice:      b.min,
        tenure:        b.txs[0].tenure,
        txCount:       b.txs.length,
      }, result.privateBudget);
      return {
        project,
        street:        b.txs[0].street,
        tenure:        b.txs[0].tenure,
        marketSegment: b.txs[0].marketSegment,
        minPrice:      b.min,
        maxPrice:      b.max,
        medianPsm:     med,
        txCount:       b.txs.length,
        latestDate:    b.txs.sort((a, c) => c.contractDate.localeCompare(a.contractDate))[0].contractDate,
        minSqm:        Math.min(...b.sqms),
        maxSqm:        Math.max(...b.sqms),
        propertyScore: score,
        trend3Y:       projectTrend3Y(b.txs),
      };
    })
    .sort((a, b) => b.propertyScore - a.propertyScore || b.txCount - a.txCount)
    .slice(0, 15);

  const displayAddress = geoAddress
    ? geoAddress.split(" SINGAPORE")[0].replace(/^BLK\s*/i, "Blk ")
    : input.town || "—";

  const ecListings = EC_OPTIONS.map((ec) => ({
    name: ec.name, price: ec.price, location: ec.location, bedrooms: ec.bedrooms,
  }));

  return (
    <ResultsDashboard
      assessment={result}
      optionScores={optionScores}
      gainPct={gainPct}
      remainingLease={remainingLease}
      displayAddress={displayAddress}
      postalCode={postalCode}
      numChildren={numChildren}
      lat={lat}
      lng={lng}
      flatType={input.flatType}
      town={town}
      sqm={input.sqm}
      purchaseYear={input.purchaseYear}
      purchasePrice={input.purchasePrice}
      remainingLoan={input.remainingLoan}
      sellingFirst={input.sellingFirst}
      privateListings={privateListings}
      ecListings={ecListings}
      biggerHdbListings={biggerHdbListings}
      nextFlatType={nextFlatType}
    />
  );
}
