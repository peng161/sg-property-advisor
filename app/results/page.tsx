import { assess, fmt } from "@/lib/calculator";
import { fetchHdbPrices, fetchHdbTransactions } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import { geocodePostal } from "@/lib/geocode";
import { getTransactions as getMockHdb } from "@/lib/mockTransactions";
import NearbyHdbPanel from "@/components/NearbyHdbPanel";
import PrivatePropertyPanel from "@/components/PrivatePropertyPanel";
import UpgradeOptionsCarousel from "@/components/UpgradeOptionsCarousel";
import Link from "next/link";

function fmtShort(n: number) {
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${(n / 1_000).toFixed(0)}K`;
}

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

export default async function ResultsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const rawCitizenship = params.citizenship ?? "SC";
  const citizenship: "SC" | "PR" | "Foreigner" =
    rawCitizenship === "PR" ? "PR"
    : rawCitizenship === "Foreigner" ? "Foreigner"
    : "SC";

  const postalCode = params.postalCode ?? "";
  let town = params.town ?? "";
  let geoAddress = "";
  if (postalCode) {
    const geo = await geocodePostal(postalCode);
    if (geo) {
      if (!town && geo.town) town = geo.town;
      geoAddress = geo.fullAddress;
    }
  }

  const input = {
    flatType:      params.flatType      ?? "",
    town,
    postalCode,
    floor:         Number(params.floor  ?? 10),
    sqm:           Number(params.sqm    ?? 0),
    leaseYear:     Number(params.leaseYear ?? 0),
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

  // Auto-detect lease year from HDB transactions matching the geocoded block.
  // Falls back to any manually-passed leaseYear for backward compatibility.
  const matchingTx = geoAddress
    ? hdbTx.find((t) => {
        const geoBlock = geoAddress.match(/^(?:BLK\s+)?(\S+)/i)?.[1] ?? "";
        return t.block.trim().toUpperCase() === geoBlock.trim().toUpperCase();
      })
    : undefined;
  const autoLeaseYear = matchingTx?.leaseCommenceYear ?? input.leaseYear;
  const remainingLease = autoLeaseYear > 0
    ? Math.max(0, 99 - (new Date().getFullYear() - autoLeaseYear))
    : 0;

  const nearbyHdb  = hdbTx.length > 0 ? hdbTx : [];
  const mockNearby = getMockHdb(town);
  const hdbSource  = hdbTx.length > 0 ? "live" : "mock";

  const result = assess(input, { hdb, private: privatePrices });
  const gainPositive = result.capitalGain >= 0;

  return (
    <main className="min-h-screen bg-[#D9E4D7]">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-white/75 backdrop-blur-md border-b border-white/50 px-4 sm:px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-neutral-900 rounded-full flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-black tracking-tighter">SG</span>
            </div>
            <span className="font-bold text-neutral-900 text-sm">SG Property Advisor</span>
          </div>
          <Link
            href="/assessment"
            className="text-xs font-medium text-neutral-500 bg-neutral-100 hover:bg-neutral-200 transition-colors rounded-full px-3 py-1.5"
          >
            ← Edit
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-7 space-y-5">

        {/* ── Hero ── */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Upgrade Analysis
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl sm:text-4xl font-black text-neutral-900 tracking-tight">
              {result.recommendation}
            </h1>
            <span className="bg-amber-400 text-white text-[11px] font-bold px-3 py-1 rounded-full shrink-0">
              ★ Best Match
            </span>
          </div>
          <p className="text-sm text-neutral-500">
            {input.flatType}
            {input.town && ` · ${input.town}`}
            {geoAddress && ` · ${geoAddress.split(" SINGAPORE")[0]}`}
          </p>
          <div className="flex gap-2 pt-1 flex-wrap">
            {[
              { label: "HDB",     live: result.dataSource.hdb     === "live" },
              { label: "Private", live: result.dataSource.private === "live" },
            ].map(({ label, live }) => (
              <span
                key={label}
                className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium border ${
                  live
                    ? "bg-emerald-100 border-emerald-200 text-emerald-700"
                    : "bg-white/60 border-neutral-200 text-neutral-400"
                }`}
              >
                {live ? "●" : "○"} {label}: {live ? "Live" : "Sample"}
              </span>
            ))}
          </div>
        </div>

        {/* ── 3 dark KPI cards ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "Market Value",
              value: fmtShort(result.currentMarketValue),
              sub:   input.sqm > 0 ? `$${fmt(Math.round(result.currentMarketValue / input.sqm))}/sqm` : null,
            },
            {
              label: "Net Proceeds",
              value: fmtShort(result.netProceeds),
              sub:   gainPositive
                       ? `+$${fmt(result.capitalGain)} gain`
                       : `-$${fmt(Math.abs(result.capitalGain))} loss`,
            },
            {
              label: "Max Budget",
              value: fmtShort(result.privateBudget),
              sub:   "incl. loan",
            },
          ].map(({ label, value, sub }) => (
            <div
              key={label}
              className="bg-neutral-900 rounded-2xl p-3 sm:p-4 flex flex-col justify-between min-h-[84px]"
            >
              <p className="text-neutral-500 text-[10px] font-semibold uppercase tracking-wider">
                {label}
              </p>
              <div>
                <p className="text-white font-black text-lg sm:text-2xl leading-tight">{value}</p>
                {sub && <p className="text-neutral-500 text-[10px] mt-0.5">{sub}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* ── 2-col: flat details + selling costs ── */}
        <div className="grid sm:grid-cols-2 gap-4">

          {/* Current flat */}
          <div className="bg-white rounded-3xl p-5 shadow-sm">
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-4">
              Your Flat
            </p>
            <div className="space-y-3">
              {([
                { label: "Purchase Price",  value: `S$${fmt(input.purchasePrice)}`,      color: ""                 },
                { label: "Market Value",    value: `S$${fmt(result.currentMarketValue)}`, color: "font-bold text-neutral-900" },
                ...(remainingLease > 0 ? [{
                  label: "Lease Left",
                  value: `${remainingLease} yrs`,
                  color: remainingLease >= 70 ? "text-emerald-600"
                       : remainingLease >= 60 ? "text-amber-600"
                       : "text-red-500",
                }] : []),
                ...(input.cpfUsed > 0 ? [{ label: "CPF Used", value: `S$${fmt(input.cpfUsed)}`, color: "" }] : []),
                {
                  label: "Capital Gain",
                  value: `${gainPositive ? "+" : ""}S$${fmt(result.capitalGain)}`,
                  color: gainPositive ? "text-emerald-600" : "text-red-500",
                },
              ] as Array<{ label: string; value: string; color: string }>).map((row) => (
                <div key={row.label} className="flex justify-between items-center">
                  <span className="text-sm text-neutral-400">{row.label}</span>
                  <span className={`text-sm font-semibold ${row.color || "text-neutral-700"}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 mt-4 pt-3 border-t border-neutral-50">
              {[
                input.flatType,
                input.town,
                input.floor && `Floor ${input.floor}`,
                input.sqm > 0 && `${input.sqm} sqm`,
              ]
                .filter(Boolean)
                .map((t) => (
                  <span
                    key={String(t)}
                    className="text-[11px] bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full"
                  >
                    {t}
                  </span>
                ))}
            </div>
          </div>

          {/* Selling costs */}
          <div className="bg-white rounded-3xl p-5 shadow-sm flex flex-col">
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-4">
              If You Sell Today
            </p>
            <div className="space-y-3 flex-1">
              {[
                { label: "Agent fee (2%)",    value: `-S$${fmt(result.sellingCosts.agentFee)}` },
                { label: "Legal fees",        value: `-S$${fmt(result.sellingCosts.legalFee)}` },
                { label: "Loan outstanding",  value: `-S$${fmt(input.remainingLoan)}`           },
                ...(input.cpfUsed > 0
                  ? [{ label: "CPF refund", value: `-S$${fmt(input.cpfUsed)}` }]
                  : []),
              ].map((row) => (
                <div key={row.label} className="flex justify-between items-center">
                  <span className="text-sm text-neutral-400">{row.label}</span>
                  <span className="text-sm font-medium text-red-400">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
              <span className="text-sm font-bold text-neutral-900">Net Proceeds</span>
              <span className="text-2xl font-black text-neutral-900">
                S${fmt(result.netProceeds)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Loan eligibility ── */}
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-4">
            Loan Eligibility
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Monthly Income",  value: `S$${fmt(result.combinedIncome)}`,  accent: false },
              { label: "Max HDB Loan",    value: `S$${fmt(result.maxHdbLoan)}`,       accent: false },
              { label: "Max Bank Loan",   value: `S$${fmt(result.maxBankLoan)}`,      accent: false },
              { label: "Private Budget",  value: `S$${fmt(result.privateBudget)}`,   accent: true  },
            ].map(({ label, value, accent }) => (
              <div
                key={label}
                className={`rounded-2xl p-3 ${accent ? "bg-amber-400" : "bg-neutral-50"}`}
              >
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                  accent ? "text-amber-900/60" : "text-neutral-400"
                }`}>
                  {label}
                </p>
                <p className={`text-sm font-black leading-tight ${
                  accent ? "text-white" : "text-neutral-900"
                }`}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Upgrade options carousel ── */}
        <UpgradeOptionsCarousel
          options={result.options}
          recommendation={result.recommendation}
          netProceeds={result.netProceeds}
        />

        {/* ── Nearby HDB ── */}
        <NearbyHdbPanel
          transactions={
            nearbyHdb.length > 0
              ? nearbyHdb
              : mockNearby.map((t) => ({
                  block:             t.block,
                  streetName:        t.street,
                  town:              town,
                  flatType:          t.flatType,
                  storeyRange:       `${String(Math.max(1, t.floor - 2)).padStart(2, "0")} TO ${String(t.floor + 2).padStart(2, "0")}`,
                  sqm:               t.sqm,
                  resalePrice:       t.resalePrice,
                  pricePerSqm:       t.pricePerSqm,
                  month:             t.month,
                  leaseCommenceYear: t.leaseCommenceYear,
                  remainingLease:    t.remainingLease,
                }))
          }
          myFlatType={input.flatType}
          myFloor={input.floor}
          mySqm={input.sqm}
          myRemainingLease={remainingLease > 0 ? remainingLease : undefined}
          source={hdbSource}
        />

        {/* ── Private property ── */}
        <PrivatePropertyPanel />

        {/* ── Disclaimer ── */}
        <div className="bg-white/50 rounded-2xl px-4 py-3">
          <p className="text-xs text-neutral-400 leading-relaxed">
            <strong className="text-neutral-600">Disclaimer:</strong> Estimates only. BSD/ABSD based
            on 2024 IRAS rates. Agent fees at CEA standard rates (2% seller, 1% buyer). CPF refund
            shown is principal only — actual amount includes accrued interest. Consult a licensed
            property agent for personalised advice.
          </p>
        </div>

        <div className="text-center pb-10">
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-neutral-600 transition-colors underline"
          >
            Start over
          </Link>
        </div>

      </div>
    </main>
  );
}
