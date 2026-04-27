import { assess } from "@/lib/calculator";
import type { HdbResaleRecord } from "@/lib/fetchHdb";
import { EC_OPTIONS } from "@/lib/mockData";
import { geocodePostal } from "@/lib/geocode";
import ResultsDashboard from "@/components/ResultsDashboard";
import type { ExtendedProjectSummary } from "@/components/ResultsDashboard";
import {
  getHdbNearby,
  getHdbByTown,
  getPrivateProjectsNearby,
  getHdbPricesByTown,
  getHdbLeaseYear,
} from "@/lib/dbQueries";
import { isDbReady } from "@/lib/sqlite";
import { getUserFinancialProfile } from "@/lib/financialProfile";
import { isMyinfoConfigured } from "@/lib/myinfo/config";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FLAT_TYPE_API: Record<string, string> = {
  "3-Room": "3 ROOM", "4-Room": "4 ROOM", "5-Room": "5 ROOM", "Executive": "EXECUTIVE",
};

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

export const dynamic = "force-dynamic";

// ── PageProps ─────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ResultsPage({ searchParams }: PageProps) {
  try {
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

  const apiFlatType = FLAT_TYPE_API[input.flatType];

  // All property data comes from the seeded DB — no live API calls
  const [hdbPrices, leaseYearFromDb] = await Promise.all([
    town ? getHdbPricesByTown(town) : Promise.resolve({} as Record<string, number>),
    geoBlock && town ? getHdbLeaseYear(geoBlock, town) : Promise.resolve(null),
  ]);

  // Priority: user input > DB block lookup > unknown
  const leaseCommencementYear =
    userLeaseCommencementYear > 0 ? userLeaseCommencementYear : leaseYearFromDb ?? 0;

  const leaseKnown = leaseCommencementYear > 0 && leaseCommencementYear < currentYear;
  const remainingLease = leaseKnown
    ? Math.max(0, 99 - (currentYear - leaseCommencementYear))
    : 95;

  const result = assess(input, {
    hdb:     Object.keys(hdbPrices).length > 0 ? hdbPrices : null,
    private: null,
  });
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
  let dbProjectCount = 0;

  if (isDbReady()) {
    const { projects, count } = await getPrivateProjectsNearby(lat, lng, result.privateBudget, 30);
    privateListings = projects;
    dbProjectCount  = count;
  }

  // ── HDB: same flat type nearby (for "Stay" path) ──────────────────────────

  const FLAT_ORDER = ["3-Room", "4-Room", "5-Room", "Executive"] as const;
  const nextFlatType: string | null =
    FLAT_ORDER[FLAT_ORDER.indexOf(input.flatType as typeof FLAT_ORDER[number]) + 1] ?? null;
  const nextApiFlatType = nextFlatType ? FLAT_TYPE_API[nextFlatType] : null;

  let sameTypeHdbListings: HdbResaleRecord[] = [];
  let biggerHdbListings:   HdbResaleRecord[] = [];
  let hdbFromDb = false;

  if (isDbReady()) {
    const dbQueries: Promise<void>[] = [];

    if (apiFlatType) {
      const nearbyOrTown = hasUserCoords
        ? getHdbNearby(lat, lng, apiFlatType, result.hdbBudget)
        : getHdbByTown(town, apiFlatType, 7);
      dbQueries.push(nearbyOrTown.then(({ records, fromDb }) => {
        if (fromDb && records.length > 0) { sameTypeHdbListings = records; hdbFromDb = true; }
      }));
    }

    if (nextApiFlatType && town) {
      dbQueries.push(getHdbByTown(town, nextApiFlatType, 12).then(({ records, fromDb }) => {
        if (fromDb && records.length > 0) biggerHdbListings = records;
      }));
    }

    await Promise.all(dbQueries);
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  const displayAddress = geoAddress
    ? geoAddress.split(" SINGAPORE")[0].replace(/^BLK\s*/i, "Blk ")
    : input.town || "—";

  const ecListings = EC_OPTIONS.map((ec) => ({
    name: ec.name, price: ec.price, location: ec.location, bedrooms: ec.bedrooms,
  }));

  const debugInfo = {
    postalCode,
    lat,
    lng,
    leaseCommencementYear,
    leaseKnown,
    remainingLease,
    hdbTxCount: sameTypeHdbListings.length,
    privateProjectCount: privateListings.length,
    privateSource: privateListings.length > 0 ? "DB (1.5 km radius)" : "none",
    hdbSource: hdbFromDb ? "DB (nearby/town)" : "none",
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
  } catch (err) {
    const msg   = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? "") : "";
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-2xl w-full bg-white rounded-2xl border border-red-200 p-8 shadow-sm">
          <h1 className="text-lg font-bold text-red-600 mb-2">Something went wrong</h1>
          <p className="text-slate-500 text-sm mb-4">The results page encountered an error. Please try again or go back and resubmit.</p>
          <pre className="bg-slate-50 rounded-lg p-3 text-xs text-slate-700 overflow-auto whitespace-pre-wrap border border-slate-200 max-h-96">{msg}{stack ? `\n\n${stack}` : ""}</pre>
          <a href="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">← Back to home</a>
        </div>
      </main>
    );
  }
}
