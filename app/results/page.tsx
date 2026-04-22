import { assess, fmtPrice, fmt } from "@/lib/calculator";
import { fetchHdbPrices } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import { fetchPrivateTransactions } from "@/lib/fetchPrivateTransactions";
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

  const input = {
    flatType:      params.flatType ?? "",
    town:          params.town ?? "",
    floor:         Number(params.floor ?? 10),
    sqm:           Number(params.sqm ?? 0),
    purchasePrice: Number(params.purchasePrice ?? 0),
    purchaseYear:  Number(params.purchaseYear ?? new Date().getFullYear() - 10),
    remainingLoan: Number(params.remainingLoan ?? 0),
    cpfUsed:       Number(params.cpfUsed ?? 0),
    myIncome:      Number(params.myIncome ?? 0),
    wifeIncome:    Number(params.wifeIncome ?? 0),
    citizenship,
    sellingFirst:  params.sellingFirst !== "no",
  };

  const [hdb, privatePrices, privateTransactions] = await Promise.all([
    fetchHdbPrices(input.town),
    fetchPrivatePrices(),
    fetchPrivateTransactions(),
  ]);

  const result = assess(input, { hdb, private: privatePrices });
  const recStyle = OPTION_STYLE[result.recommendation];

  const gainPositive = result.capitalGain >= 0;

  return (
    <main className="min-h-screen bg-slate-50">

      {/* Top bar */}
      <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-base tracking-tight">
          SG Property Advisor
        </Link>
        <Link href="/assessment"
          className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded-full px-3 py-1.5 transition-colors">
          ← Edit details
        </Link>
      </div>

      {/* Hero recommendation banner */}
      <div className="bg-slate-900 pb-10 pt-8 px-6">
        <div className="max-w-xl mx-auto">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-3">
            Our Recommendation
          </p>
          <div className="flex items-center gap-4 mb-4">
            <span className="text-5xl">{recStyle.icon}</span>
            <div>
              <h1 className="text-3xl font-bold text-white">{result.recommendation}</h1>
              <p className="text-slate-400 text-sm mt-0.5">
                {input.flatType} · {input.town} · {input.citizenship}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
              result.dataSource.hdb === "live"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-slate-800 border-slate-700 text-slate-500"
            }`}>
              {result.dataSource.hdb === "live" ? "🟢" : "⚪"} HDB: {result.dataSource.hdb === "live" ? "Live" : "Sample"}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
              result.dataSource.private === "live"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-slate-800 border-slate-700 text-slate-500"
            }`}>
              {result.dataSource.private === "live" ? "🟢" : "⚪"} Private: {result.dataSource.private === "live" ? "Live (URA)" : "Sample"}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">

        {/* Property value & gain */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">🏠 Your Current Flat</h2>
            {/* Flat details pill row */}
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                input.flatType && `${input.flatType}`,
                input.town && input.town,
                input.floor && `Floor ${input.floor}`,
                input.sqm > 0 && `${input.sqm} sqm`,
              ].filter(Boolean).map((tag) => (
                <span key={String(tag)} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Purchase price",         value: `S$${fmt(input.purchasePrice)}` },
              { label: "Estimated market value",  value: `S$${fmt(result.currentMarketValue)}` },
              ...(input.sqm > 0 ? [{ label: "Price per sqm (est.)", value: `S$${fmt(Math.round(result.currentMarketValue / input.sqm))}/sqm` }] : []),
              ...(input.cpfUsed > 0 ? [{ label: "CPF used to date", value: `S$${fmt(input.cpfUsed)}` }] : []),
              { label: "Capital gain",
                value: `${gainPositive ? "+" : ""}S$${fmt(result.capitalGain)}`,
                color: gainPositive ? "text-emerald-600" : "text-red-500" },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center px-5 py-3.5">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`text-sm font-semibold ${"color" in row ? row.color : "text-slate-900"}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Selling costs + net proceeds */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">💸 If You Sell Today</h2>
            <p className="text-xs text-slate-400 mt-0.5">Standard Singapore agent & legal fees</p>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Agent fee (2% of market value)", value: `-S$${fmt(result.sellingCosts.agentFee)}`, red: true },
              { label: "Legal fees",                     value: `-S$${fmt(result.sellingCosts.legalFee)}`, red: true },
              { label: "Outstanding loan",               value: `-S$${fmt(input.remainingLoan)}`,          red: true },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center px-5 py-3">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`text-sm font-medium ${row.red ? "text-red-500" : "text-slate-900"}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          <div className="px-5 py-4 bg-slate-900 flex items-center justify-between">
            <span className="text-sm font-bold text-white">Net Proceeds</span>
            <span className="text-lg font-bold text-emerald-400">
              S${fmt(result.netProceeds)}
            </span>
          </div>
        </section>

        {/* Financial snapshot */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">📊 Loan Eligibility</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Combined monthly income",     value: `S$${fmt(result.combinedIncome)}` },
              { label: "Max HDB loan (MSR 30%)",      value: `S$${fmt(result.maxHdbLoan)}` },
              { label: "Max bank loan (TDSR 55%)",    value: `S$${fmt(result.maxBankLoan)}` },
              { label: "Total HDB upgrade budget",    value: `S$${fmt(result.hdbBudget)}`,     highlight: true },
              { label: "Total private upgrade budget",value: `S$${fmt(result.privateBudget)}`, highlight: true },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center px-5 py-3.5">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`text-sm font-semibold ${"highlight" in row && row.highlight ? "text-emerald-600" : "text-slate-900"}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Upgrade option cards */}
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
                      <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      <span className="text-white text-xs font-semibold">Recommended for you</span>
                    </div>
                  )}

                  <div className="p-5">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl ${style.lightBg} flex items-center justify-center text-xl`}>
                          {style.icon}
                        </div>
                        <h3 className="font-bold text-slate-900">{option.label}</h3>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        option.affordable ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-500"
                      }`}>
                        {option.affordable ? "✓ Affordable" : "✗ Out of range"}
                      </span>
                    </div>

                    {/* Price + repayment */}
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

                    {/* Cost breakdown (hidden for Stay) */}
                    {option.type !== "Stay" && costs.total > 0 && (
                      <div className="border border-slate-100 rounded-xl overflow-hidden mb-3">
                        <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Upfront Cost Breakdown
                        </div>
                        <div className="divide-y divide-slate-50">
                          {[
                            { label: "Down payment",      value: costs.downPayment },
                            { label: "BSD",               value: costs.bsd         },
                            { label: "ABSD",              value: costs.absd, highlight: costs.absd > 0 },
                            { label: "Agent fee (1%)",    value: costs.agentFee    },
                            { label: "Legal fees",        value: costs.legalFee    },
                          ].map((row) => (
                            <div key={row.label} className="flex justify-between px-3 py-2">
                              <span className="text-xs text-slate-500">{row.label}</span>
                              <span className={`text-xs font-semibold ${
                                "highlight" in row && row.highlight ? "text-orange-600" : "text-slate-700"
                              }`}>
                                {row.value === 0 ? <span className="text-slate-300">—</span> : `S$${fmt(row.value)}`}
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

        {/* Private property transactions */}
        <PrivatePropertyPanel
          transactions={privateTransactions}
          source={process.env.URA_ACCESS_KEY ? "ura-live" : "mock"}
        />

        <div className="bg-slate-100 rounded-xl px-4 py-3 text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-700">Disclaimer:</strong> Estimates only. BSD/ABSD based on 2024 IRAS rates.
          Agent fees at standard CEA rates (2% seller, 1% buyer). Excludes CPF accrued interest, valuation fees,
          and renovation costs. Consult a licensed property agent for personalised advice.
        </div>

        <div className="text-center pb-10">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-600 underline">
            Start over
          </Link>
        </div>
      </div>
    </main>
  );
}
