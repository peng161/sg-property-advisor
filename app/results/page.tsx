import { assess } from "@/lib/calculator";
import { fetchHdbPrices, fetchHdbTransactions, fetchHdbBlockLeaseYear } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import { fetchPrivateTransactions } from "@/lib/fetchPrivateTransactions";
import type { PrivateTransaction } from "@/lib/fetchPrivateTransactions";
import { EC_OPTIONS } from "@/lib/mockData";
import { geocodePostal } from "@/lib/geocode";
import ResultsDashboard from "@/components/ResultsDashboard";
import type { ExtendedProjectSummary } from "@/components/ResultsDashboard";
import {
  getHdbNearby,
  getHdbByTown,
  getPrivateProjectsNearby,
  haversineKm,
  dbStatus,
} from "@/lib/dbQueries";
import { isDbReady } from "@/lib/sqlite";
import { getUserFinancialProfile } from "@/lib/financialProfile";
import { isMyinfoConfigured } from "@/lib/myinfo/config";

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

// Singapore postal district → [lat, lng] centroid
const DISTRICT_CENTROIDS: Record<string, [number, number]> = {
  "01": [1.2810, 103.8508], "02": [1.2760, 103.8423], "03": [1.2894, 103.8083],
  "04": [1.2700, 103.8210], "05": [1.3116, 103.7633], "06": [1.2930, 103.8530],
  "07": [1.3010, 103.8610], "08": [1.3070, 103.8520], "09": [1.3010, 103.8350],
  "10": [1.3190, 103.8130], "11": [1.3300, 103.8330], "12": [1.3300, 103.8490],
  "13": [1.3370, 103.8700], "14": [1.3180, 103.8920], "15": [1.3060, 103.9050],
  "16": [1.3270, 103.9400], "17": [1.3580, 103.9730], "18": [1.3500, 103.9400],
  "19": [1.3700, 103.8930], "20": [1.3610, 103.8450], "21": [1.3410, 103.7700],
  "22": [1.3330, 103.7200], "23": [1.3780, 103.7490], "24": [1.4080, 103.7190],
  "25": [1.4340, 103.7760], "26": [1.4000, 103.8190], "27": [1.4320, 103.8320],
  "28": [1.4040, 103.8700],
};

function distanceBonus(km: number | null): number {
  if (km === null) return 0;
  if (km < 2)  return 18;
  if (km < 5)  return 12;
  if (km < 10) return 6;
  if (km < 15) return 2;
  return 0;
}

// Layer 2 scoring — private projects (used when NOT using DB / no location)
function computePropertyScore(
  p: { marketSegment: string; minPrice: number; tenure: string; txCount: number },
  budget: number,
  distKm: number | null = null
): number {
  let score = 50;
  score += p.marketSegment === "OCR" ? 10 : p.marketSegment === "RCR" ? 7 : 4;
  if (p.minPrice <= budget) score += 10;
  else if (p.minPrice <= budget * 1.2) score += 4;
  score += Math.min(Math.floor(p.txCount / 3), 6);
  if (p.tenure.toLowerCase().includes("freehold") || p.tenure.includes("999")) score += 4;
  score += distanceBonus(distKm);
  return Math.min(Math.round(score), 99);
}

// Layer 1 scoring — upgrade path assessment (financial affordability)
function computeOptionScore(
  type: string, affordable: boolean, gainPct: number, remainingLease: number
): number {
  const base: Record<string, number> = {
    Stay: 32, "Bigger HDB": 52, EC: 67, "Private Condo": 72,
  };
  let s = base[type] ?? 50;
  if (affordable) s += 18;
  if (gainPct > 50) s += 5; else if (gainPct > 20) s += 3;
  if (remainingLease >= 75) s += 5;
  else if (remainingLease >= 60) s += 2;
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

  const userPurchaseYear = Number(params.purchaseYear ?? new Date().getFullYear() - 10);

  const input = {
    flatType:      params.flatType      ?? "",
    town,
    postalCode,
    floor:         Number(params.floor       ?? 10),
    sqm:           Number(params.sqm         ?? 0),
    purchasePrice: Number(params.purchasePrice ?? 0),
    purchaseYear:  userPurchaseYear,
    remainingLoan: Number(params.remainingLoan ?? 0),
    cpfUsed:       Number(params.cpfUsed       ?? 0),
    myIncome:      Number(params.myIncome      ?? 0),
    wifeIncome:    Number(params.wifeIncome    ?? 0),
    citizenship,
    sellingFirst:  params.sellingFirst !== "no",
  };

  // ── Lease commencement year (explicit user input takes precedence) ──────────

  const userLeaseCommencementYear = Number(params.leaseCommencementYear ?? params.leaseYear ?? 0);
  const currentYear = new Date().getFullYear();

  // ── Financial profile (Myinfo session or null) ────────────────────────────
  const [financialProfile] = await Promise.all([getUserFinancialProfile()]);
  const myinfoAvailable = isMyinfoConfigured();

  // Build a stable return URL so Singpass redirects back to this exact results page
  const returnUrlParams = new URLSearchParams(params as Record<string, string>).toString();
  const resultsReturnUrl = `/results${returnUrlParams ? `?${returnUrlParams}` : ""}`;

  const [hdb, privatePrices, hdbTx] = await Promise.all([
    fetchHdbPrices(town),
    fetchPrivatePrices(),
    town ? fetchHdbTransactions(town) : Promise.resolve([]),
  ]);

  // Auto-detect lease year ONLY from block-specific API — never from town average
  const matchingTx = geoBlock
    ? hdbTx.find((t) => t.block.trim().toUpperCase() === geoBlock.trim().toUpperCase())
    : undefined;
  const leaseYearFromApi =
    !matchingTx && geoBlock && town
      ? await fetchHdbBlockLeaseYear(geoBlock, town, geoStreet || undefined)
      : null;

  // Priority: user input > block-matched transaction > API lookup > unknown
  const leaseCommencementYear =
    userLeaseCommencementYear > 0 ? userLeaseCommencementYear
    : matchingTx?.leaseCommenceYear
      ? matchingTx.leaseCommenceYear
    : leaseYearFromApi ?? 0;

  const leaseKnown = leaseCommencementYear > 0 && leaseCommencementYear < currentYear;
  const remainingLease = leaseKnown
    ? Math.max(0, 99 - (currentYear - leaseCommencementYear))
    : 95; // default assumption when lease year cannot be determined

  // ── Nearby market value (only when lease is known) ────────────────────────

  const apiFlatType = FLAT_TYPE_API[input.flatType];
  const myLeaseBand = leaseKnown ? getLeaseBand(remainingLease) : null;
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

  // ── Layer 1: Upgrade path scores (financial affordability) ───────────────

  const optionScores = result.options.map((o) =>
    computeOptionScore(o.type, o.affordable, gainPct, remainingLease)
  );

  // ── Layer 2: Private property recommendations (distance-first) ────────────

  const hasUserCoords = lat > 0 && lng > 0;

  let privateListings: ExtendedProjectSummary[] = [];
  let dbUsed = false;
  let dbProjectCount = 0;

  if (hasUserCoords && isDbReady()) {
    const { projects, fromDb, count } = await getPrivateProjectsNearby(lat, lng, result.privateBudget, 30);
    if (fromDb && projects.length > 0) {
      privateListings = projects;
      dbUsed = true;
      dbProjectCount = count;
    }
  }

  // Fallback: API-based approach (using district centroid distances)
  if (!dbUsed) {
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

    privateListings = Array.from(byProject.entries())
      .map(([project, b]) => {
        const med = medianOf(b.psms);
        const district = (b.txs[0].district ?? "").padStart(2, "0");
        const centroid = DISTRICT_CENTROIDS[district];
        const distKm = hasUserCoords && centroid
          ? Math.round(haversineKm(lat, lng, centroid[0], centroid[1]) * 10) / 10
          : null;
        const score = computePropertyScore({
          marketSegment: b.txs[0].marketSegment,
          minPrice:      b.min,
          tenure:        b.txs[0].tenure,
          txCount:       b.txs.length,
        }, result.privateBudget, distKm);
        return {
          project,
          street:        b.txs[0].street,
          tenure:        b.txs[0].tenure,
          marketSegment: b.txs[0].marketSegment,
          minPrice:      b.min,
          maxPrice:      b.max,
          medianPsm:     med,
          txCount:       b.txs.length,
          latestDate:    [...b.txs].sort((a, c) => c.contractDate.localeCompare(a.contractDate))[0].contractDate,
          minSqm:        Math.min(...b.sqms),
          maxSqm:        Math.max(...b.sqms),
          propertyScore: score,
          trend3Y:       projectTrend3Y(b.txs),
          distanceKm:    distKm,
          projectLat:    centroid ? centroid[0] : null,
          projectLng:    centroid ? centroid[1] : null,
        };
      })
      .sort((a, b) => b.propertyScore - a.propertyScore || (a.distanceKm ?? 99) - (b.distanceKm ?? 99))
      .slice(0, 30);
  }

  // ── HDB: same flat type nearby (for "Stay" path) ──────────────────────────
  // Priority: proximity search from DB → town search from DB → API fallback

  let sameTypeHdbListings = hdbTx
    .filter((t) => t.flatType === apiFlatType)
    .sort((a, b) => b.remainingLease - a.remainingLease || a.resalePrice - b.resalePrice)
    .slice(0, 7);

  let hdbFromDb = false;
  if (apiFlatType && isDbReady()) {
    if (hasUserCoords) {
      const { records, fromDb } = await getHdbNearby(lat, lng, apiFlatType, result.hdbBudget);
      if (fromDb && records.length > 0) {
        sameTypeHdbListings = records;
        hdbFromDb = true;
      }
    }
    // No precise coords — fall back to town-level DB query
    if (!hdbFromDb && town) {
      const { records, fromDb } = await getHdbByTown(town, apiFlatType, 7);
      if (fromDb && records.length > 0) {
        sameTypeHdbListings = records;
        hdbFromDb = true;
      }
    }
  }

  // ── HDB upgrade listings ──────────────────────────────────────────────────
  // Priority: town search from DB → API fallback

  const FLAT_ORDER = ["3-Room", "4-Room", "5-Room", "Executive"] as const;
  const nextFlatType: string | null =
    FLAT_ORDER[FLAT_ORDER.indexOf(input.flatType as typeof FLAT_ORDER[number]) + 1] ?? null;
  const nextApiFlatType = nextFlatType ? FLAT_TYPE_API[nextFlatType] : null;

  let biggerHdbListings = nextApiFlatType
    ? hdbTx.filter((t) => t.flatType === nextApiFlatType).slice(0, 12)
    : [];

  if (nextApiFlatType && town && isDbReady()) {
    const { records, fromDb } = await getHdbByTown(town, nextApiFlatType, 12);
    if (fromDb && records.length > 0) {
      biggerHdbListings = records;
    }
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  const displayAddress = geoAddress
    ? geoAddress.split(" SINGAPORE")[0].replace(/^BLK\s*/i, "Blk ")
    : input.town || "—";

  const ecListings = EC_OPTIONS.map((ec) => ({
    name: ec.name, price: ec.price, location: ec.location, bedrooms: ec.bedrooms,
  }));

  const { hdbCount: hdbDbCount, privateCount: privateDbCount } = isDbReady()
    ? await dbStatus()
    : { hdbCount: 0, privateCount: 0 };

  // Debug info for the debug panel
  const debugInfo = {
    postalCode,
    lat,
    lng,
    leaseCommencementYear,
    leaseKnown,
    remainingLease,
    hdbTxCount: hdbTx.length,
    hdbDbCount,
    privateProjectCount: privateListings.length,
    privateDbCount,
    dbProjectsWithin1_5km: dbProjectCount,
    privateSource: dbUsed ? "SQLite (1.5 km radius)" : "API (district centroid)",
    hdbSource: hdbFromDb ? "SQLite (1.5 km radius)" : "API (town filter)",
    dbReady: isDbReady(),
  };

  return (
    <ResultsDashboard
      assessment={result}
      optionScores={optionScores}
      gainPct={gainPct}
      remainingLease={remainingLease}
      leaseKnown={leaseKnown}
      leaseCommencementYear={leaseCommencementYear}
      displayAddress={displayAddress}
      postalCode={postalCode}
      numChildren={numChildren}
      lat={lat}
      lng={lng}
      flatType={input.flatType}
      town={town}
      sqm={input.sqm}
      purchaseYear={userPurchaseYear}
      purchasePrice={input.purchasePrice}
      remainingLoan={input.remainingLoan}
      sellingFirst={input.sellingFirst}
      privateListings={privateListings}
      ecListings={ecListings}
      biggerHdbListings={biggerHdbListings}
      nextFlatType={nextFlatType}
      sameTypeHdbListings={sameTypeHdbListings}
      debugInfo={debugInfo}
      initialFinancialProfile={financialProfile}
      myinfoAvailable={myinfoAvailable}
      resultsReturnUrl={resultsReturnUrl}
    />
  );
}
