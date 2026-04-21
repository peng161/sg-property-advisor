import { assess } from "@/lib/calculator";
import { fetchHdbPrices } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import Link from "next/link";

const OPTION_STYLE: Record<string, { icon: string; accent: string; lightBg: string }> = {
  "Stay":          { icon: "🏠", accent: "text-slate-700",   lightBg: "bg-slate-50"   },
  "Bigger HDB":    { icon: "📈", accent: "text-blue-700",    lightBg: "bg-blue-50"    },
  "EC":            { icon: "🏙️", accent: "text-violet-700",  lightBg: "bg-violet-50"  },
  "Private Condo": { icon: "✨", accent: "text-emerald-700", lightBg: "bg-emerald-50" },
};

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

export default async function ResultsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const input = {
    flatType:       params.flatType ?? "",
    town:           params.town ?? "",
    estimatedValue: Number(params.estimatedValue ?? 0),
    remainingLoan:  Number(params.remainingLoan ?? 0),
    myIncome:       Number(params.myIncome ?? 0),
    wifeIncome:     Number(params.wifeIncome ?? 0),
  };

  const [hdb, privatePrices] = await Promise.all([
    fetchHdbPrices(input.town),
    fetchPrivatePrices(),
  ]);

  const result = assess(input, { hdb, private: privatePrices });
  const recStyle = OPTION_STYLE[result.recommendation];

  return (
    <main className="min-h-screen bg-slate-50">

      {/* Top bar */}
      <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-base tracking-tight">
          SG Property Advisor
        </Link>
        <Link
          href="/assessment"
          className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded-full px-3 py-1.5 transition-colors"
        >
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
                {input.flatType} · {input.town}
              </p>
            </div>
          </div>

          {/* Data source badges */}
          <div className="flex gap-2 flex-wrap">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
              result.dataSource.hdb === "live"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-slate-800 border-slate-700 text-slate-500"
            }`}>
              {result.dataSource.hdb === "live" ? "🟢" : "⚪"} HDB: {result.dataSource.hdb === "live" ? "Live data" : "Sample data"}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
              result.dataSource.private === "live"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-slate-800 border-slate-700 text-slate-500"
            }`}>
              {result.dataSource.private === "live" ? "🟢" : "⚪"} Private: {result.dataSource.private === "live" ? "Live (URA)" : "Sample data"}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">

        {/* Financial snapshot */}
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">📊 Financial Snapshot</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Combined monthly income",     value: `S$${result.combinedIncome.toLocaleString("en-SG")}`,  dim: false },
              { label: "Est. cash proceeds from sale", value: `S$${result.cashProceeds.toLocaleString("en-SG")}`,   dim: false },
              { label: "Max HDB loan (MSR 30%)",       value: `S$${result.maxHdbLoan.toLocaleString("en-SG")}`,     dim: false },
              { label: "Max bank loan (TDSR 55%)",     value: `S$${result.maxBankLoan.toLocaleString("en-SG")}`,    dim: false },
              { label: "Total HDB upgrade budget",     value: `S$${result.hdbBudget.toLocaleString("en-SG")}`,      dim: true  },
              { label: "Total private upgrade budget", value: `S$${result.privateBudget.toLocaleString("en-SG")}`,  dim: true  },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center px-5 py-3.5">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`text-sm font-semibold ${row.dim ? "text-emerald-600" : "text-slate-900"}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
            <p className="text-xs text-slate-400">
              Simplified estimate. Excludes CPF accrued interest, BSD, ABSD, legal fees.
            </p>
          </div>
        </section>

        {/* Upgrade options */}
        <div>
          <h2 className="font-bold text-slate-900 mb-3 px-1">All Options</h2>
          <div className="space-y-3">
            {result.options.map((option) => {
              const style = OPTION_STYLE[option.type];
              const isRec = option.type === result.recommendation;
              return (
                <div
                  key={option.type}
                  className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
                    isRec ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-100"
                  }`}
                >
                  {isRec && (
                    <div className="bg-emerald-500 px-4 py-1.5 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      <span className="text-white text-xs font-semibold">Recommended for you</span>
                    </div>
                  )}

                  <div className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl ${style.lightBg} flex items-center justify-center text-xl`}>
                          {style.icon}
                        </div>
                        <h3 className="font-bold text-slate-900">{option.label}</h3>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        option.affordable
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-50 text-red-500"
                      }`}>
                        {option.affordable ? "✓ Affordable" : "✗ Out of range"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 mb-0.5">Est. Price</p>
                        <p className="text-sm font-semibold text-slate-800">{option.priceRange}</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 mb-0.5">Monthly Repayment</p>
                        <p className="text-sm font-semibold text-slate-800">{option.monthlyRepayment}</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed">{option.notes}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-center pt-2 pb-10">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-600 underline">
            Start over
          </Link>
        </div>
      </div>
    </main>
  );
}
