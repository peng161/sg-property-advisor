import { assess, fmtPrice, fmt } from "@/lib/calculator";
import { fetchHdbPrices, fetchHdbTransactions } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import { geocodePostal } from "@/lib/geocode";
import { getTransactions as getMockHdb } from "@/lib/mockTransactions";
import NearbyHdbPanel from "@/components/NearbyHdbPanel";
import PrivatePropertyPanel from "@/components/PrivatePropertyPanel";
import Link from "next/link";

const OPTION_STYLE: Record<string, { icon: string; lightBg: string }> = {
  "Stay":          { icon: "🏠", lightBg: "bg-slate-50"   },
  "Bigger HDB":    { icon: "📈", lightBg: "bg-blue-50"    },
  "EC":            { icon: "🏙️", lightBg: "bg-violet-50"  },
  "Private Condo": { icon: "✨", lightBg: "bg-emerald-50" },
};

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

  // Geocode postal code → accurate town name
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

  // Remaining lease from lease commence year
  const remainingLease = input.leaseYear > 0
    ? Math.max(0, 99 - (new Date().getFullYear() - input.leaseYear))
    : 0;

  // Fetch all data in parallel
  const [hdb, privatePrices, hdbTx] = await Promise.all([
    fetchHdbPrices(town),
    fetchPrivatePrices(),
    town ? fetchHdbTransactions(town) : Promise.resolve([]),
  ]);

  // Fall back to mock nearby HDB data if live fetch returned nothing
  const nearbyHdb  = hdbTx.length > 0 ? hdbTx : [];
  const mockNearby = getMockHdb(town);
  const hdbSource  = hdbTx.length > 0 ? "live" : "mock";

  const result = assess(input, { hdb, private: privatePrices });
  const recStyle = OPTION_STYLE[result.recommendation];
  const gainPositive = result.capitalGain >= 0;

  return (
    <main className="min-h-screen bg-slate-50">

      {/* Top bar */}
      <div className="bg-slate-900 px-4 sm:px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-base tracking-tight">
          SG Property Advisor
        </Link>
        <Link href="/assessment"
          className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded-full px-3 py-1.5 transition-colors">
          ← Edit
        </Link>
      </div>

      {/* Recommendation banner */}
      <div className="bg-slate-900 pb-8 pt-6 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-3">Our Recommendation</p>
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <span className="text-4xl sm:text-5xl">{recStyle.icon}</span>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{result.recommendation}</h1>
              <p className="text-slate-400 text-sm mt-0.5">
                {input.flatType}
                {input.town && ` · ${input.town}`}
                {geoAddress && ` · ${geoAddress.split(" SINGAPORE")[0]}`}
              </p>
            </div>
          </div>
          {/* Data source badges */}
          <div className="flex gap-2 flex-wrap">
            {[
              { label: "HDB",     live: result.dataSource.hdb     === "live" },
              { label: "Private", live: result.dataSource.private === "live" },
            ].map(({ label, live }) => (
              <span key={label} className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                live ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                     : "bg-slate-800 border-slate-700 text-slate-500"
              }`}>
                {live ? "🟢" : "⚪"} {label}: {live ? "Live" : "Sample"}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── Current flat ── */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">🏠 Your Current Flat</h2>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                input.flatType,
                input.town,
                input.floor && `Floor ${input.floor}`,
                input.sqm > 0 && `${input.sqm} sqm`,
                remainingLease > 0 && `${remainingLease} yrs lease left`,
              ].filter(Boolean).map((tag) => (
                <span key={String(tag)} className={`text-xs px-2 py-0.5 rounded-full ${
                  String(tag).includes("yrs lease")
                    ? remainingLease >= 80 ? "bg-emerald-100 text-emerald-700"
                    : remainingLease >= 70 ? "bg-teal-100 text-teal-700"
                    : remainingLease >= 60 ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-600"
                  : "bg-slate-100 text-slate-500"
                }`}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {([
              { label: "Purchase price",        value: `S$${fmt(input.purchasePrice)}` },
              { label: "Estimated market value", value: `S$${fmt(result.currentMarketValue)}` },
              ...(input.sqm > 0 ? [{ label: "Est. price per sqm", value: `S$${fmt(Math.round(result.currentMarketValue / input.sqm))}/sqm` }] : []),
              ...(remainingLease > 0 ? [{ label: "Remaining lease", value: `${remainingLease} years`, leaseVal: remainingLease }] : []),
              ...(input.cpfUsed > 0 ? [{ label: "CPF used to date", value: `S$${fmt(input.cpfUsed)}` }] : []),
              { label: "Capital gain",           value: `${gainPositive ? "+" : ""}S$${fmt(result.capitalGain)}`, gain: gainPositive },
            ] as Array<{ label: string; value: string; gain?: boolean; leaseVal?: number }>).map((row) => (
              <div key={row.label} className="flex justify-between items-center px-4 sm:px-5 py-3">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`text-sm font-semibold ${
                  row.gain !== undefined
                    ? row.gain ? "text-emerald-600" : "text-red-500"
                    : row.leaseVal !== undefined
                    ? row.leaseVal >= 80 ? "text-emerald-600"
                    : row.leaseVal >= 70 ? "text-teal-600"
                    : row.leaseVal >= 60 ? "text-amber-600" : "text-red-500"
                    : "text-slate-900"
                }`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Selling costs ── */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">💸 If You Sell Today</h2>
            <p className="text-xs text-slate-400 mt-0.5">Standard Singapore agent & legal fees</p>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Agent fee (2% of market value)", value: `-S$${fmt(result.sellingCosts.agentFee)}` },
              { label: "Legal fees",                     value: `-S$${fmt(result.sellingCosts.legalFee)}` },
              { label: "Outstanding loan",               value: `-S$${fmt(input.remainingLoan)}` },
              ...(input.cpfUsed > 0 ? [{ label: "CPF refund (approx.)", value: `-S$${fmt(input.cpfUsed)}`, note: true }] : []),
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center px-4 sm:px-5 py-3">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className="text-sm font-medium text-red-500">{row.value}</span>
              </div>
            ))}
          </div>
          <div className="px-4 sm:px-5 py-4 bg-slate-900 flex items-center justify-between">
            <span className="text-sm font-bold text-white">Net Proceeds</span>
            <span className="text-lg font-bold text-emerald-400">S${fmt(result.netProceeds)}</span>
          </div>
        </section>

        {/* ── Loan eligibility ── */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">📊 Loan Eligibility</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Combined monthly income",      value: `S$${fmt(result.combinedIncome)}` },
              { label: "Max HDB loan (MSR 30%)",       value: `S$${fmt(result.maxHdbLoan)}` },
              { label: "Max bank loan (TDSR 55%)",     value: `S$${fmt(result.maxBankLoan)}` },
              { label: "Total HDB upgrade budget",     value: `S$${fmt(result.hdbBudget)}`,     hi: true },
              { label: "Total private upgrade budget", value: `S$${fmt(result.privateBudget)}`, hi: true },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center px-4 sm:px-5 py-3">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`text-sm font-semibold ${"hi" in row && row.hi ? "text-emerald-600" : "text-slate-900"}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Upgrade options ── */}
        <div>
          <h2 className="font-bold text-slate-900 mb-3 px-1">All Options</h2>
          <div className="space-y-3">
            {result.options.map((option) => {
              const style = OPTION_STYLE[option.type];
              const isRec = option.type === result.recommendation;
              const costs = option.costs;
              return (
                <div key={option.type}
                  className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md
                    ${isRec ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-100"}`}>
                  {isRec && (
                    <div className="bg-emerald-500 px-4 py-1.5 flex items-center gap-1.5">
                      <span className="text-white text-xs font-semibold">★ Recommended for you</span>
                    </div>
                  )}
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl ${style.lightBg} flex items-center justify-center text-xl shrink-0`}>
                          {style.icon}
                        </div>
                        <h3 className="font-bold text-slate-900">{option.label}</h3>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                        option.affordable ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-500"
                      }`}>
                        {option.affordable ? "✓ Affordable" : "✗ Out of range"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 mb-0.5">Est. Price</p>
                        <p className="text-sm font-semibold text-slate-800">{option.priceRange}</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 mb-0.5">Monthly Repayment</p>
                        <p className="text-sm font-semibold text-slate-800">{option.monthlyRepayment}</p>
                      </div>
                    </div>
                    {option.type !== "Stay" && costs.total > 0 && (
                      <div className="border border-slate-100 rounded-xl overflow-hidden mb-3">
                        <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Upfront Cost Breakdown
                        </div>
                        <div className="divide-y divide-slate-50">
                          {[
                            { label: "Down payment",   value: costs.downPayment },
                            { label: "BSD",            value: costs.bsd         },
                            { label: "ABSD",           value: costs.absd,       hi: costs.absd > 0 },
                            { label: "Agent fee (1%)", value: costs.agentFee    },
                            { label: "Legal fees",     value: costs.legalFee    },
                          ].map((r) => (
                            <div key={r.label} className="flex justify-between px-3 py-2">
                              <span className="text-xs text-slate-500">{r.label}</span>
                              <span className={`text-xs font-semibold ${"hi" in r && r.hi ? "text-orange-600" : "text-slate-700"}`}>
                                {r.value === 0 ? <span className="text-slate-300">—</span> : `S$${fmt(r.value)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="bg-slate-900 px-3 py-2.5 flex justify-between items-center">
                          <span className="text-xs font-bold text-white">Total Upfront</span>
                          <span className={`text-sm font-bold ${
                            result.netProceeds >= costs.total ? "text-emerald-400" : "text-red-400"
                          }`}>
                            S${fmt(costs.total)}
                          </span>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-slate-500 leading-relaxed">{option.notes}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Nearby HDB market ── */}
        <NearbyHdbPanel
          transactions={nearbyHdb.length > 0 ? nearbyHdb : mockNearby.map((t) => ({
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
          }))}
          myFlatType={input.flatType}
          myFloor={input.floor}
          mySqm={input.sqm}
          source={hdbSource}
        />

        {/* ── Private property ── */}
        <PrivatePropertyPanel />

        <p className="bg-slate-100 rounded-xl px-4 py-3 text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-700">Disclaimer:</strong> Estimates only. BSD/ABSD based on 2024 IRAS rates.
          Agent fees at CEA standard rates (2% seller, 1% buyer). CPF refund shown is principal only — actual amount
          includes accrued interest. Consult a licensed property agent for personalised advice.
        </p>

        <div className="text-center pb-10">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-600 underline">
            Start over
          </Link>
        </div>
      </div>
    </main>
  );
}
