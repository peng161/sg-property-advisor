import { assess } from "@/lib/calculator";
import { fetchHdbPrices } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import Link from "next/link";

const RECOMMENDATION_STYLE: Record<string, { bg: string; text: string; icon: string }> = {
  "Stay":          { bg: "bg-gray-100",   text: "text-gray-700",  icon: "🏠" },
  "Bigger HDB":    { bg: "bg-blue-100",   text: "text-blue-700",  icon: "📈" },
  "EC":            { bg: "bg-purple-100", text: "text-purple-700",icon: "🏙️" },
  "Private Condo": { bg: "bg-green-100",  text: "text-green-700", icon: "✨" },
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

  // Fetch live data in parallel; each falls back to null on failure
  const [hdb, privatePrices] = await Promise.all([
    fetchHdbPrices(input.town),
    fetchPrivatePrices(),
  ]);

  const result = assess(input, { hdb, private: privatePrices });
  const rec = RECOMMENDATION_STYLE[result.recommendation];

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">

        {/* Header */}
        <div>
          <Link href="/assessment" className="text-sm text-blue-600 hover:underline">
            ← Edit details
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-3">Your Results</h1>
          <p className="text-gray-500 mt-1">
            Based on your {input.flatType} in {input.town}
          </p>

          {/* Data source badges */}
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              result.dataSource.hdb === "live"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}>
              HDB: {result.dataSource.hdb === "live" ? "🟢 Live (data.gov.sg)" : "⚪ Sample data"}
            </span>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              result.dataSource.private === "live"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}>
              Private: {result.dataSource.private === "live" ? "🟢 Live (URA)" : "⚪ Sample data"}
            </span>
          </div>
        </div>

        {/* Top recommendation */}
        <section className={`${rec.bg} rounded-xl p-6`}>
          <p className={`text-sm font-semibold uppercase tracking-wide ${rec.text} mb-1`}>
            Our Recommendation
          </p>
          <div className="flex items-center gap-3">
            <span className="text-4xl">{rec.icon}</span>
            <h2 className={`text-2xl font-bold ${rec.text}`}>{result.recommendation}</h2>
          </div>
        </section>

        {/* Financial summary */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">📊 Your Financial Snapshot</h3>
          <div className="space-y-3">
            {[
              { label: "Combined monthly income",    value: `S$${result.combinedIncome.toLocaleString("en-SG")}` },
              { label: "Est. cash proceeds from sale", value: `S$${result.cashProceeds.toLocaleString("en-SG")}` },
              { label: "Max HDB loan (MSR 30%)",     value: `S$${result.maxHdbLoan.toLocaleString("en-SG")}` },
              { label: "Max bank loan (TDSR 55%)",   value: `S$${result.maxBankLoan.toLocaleString("en-SG")}` },
              { label: "Total HDB upgrade budget",   value: `S$${result.hdbBudget.toLocaleString("en-SG")}`,    highlight: true },
              { label: "Total private upgrade budget", value: `S$${result.privateBudget.toLocaleString("en-SG")}`, highlight: true },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center text-sm">
                <span className="text-gray-600">{row.label}</span>
                <span className={`font-semibold ${row.highlight ? "text-blue-700" : "text-gray-900"}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4">
            * Simplified estimate. Excludes CPF accrued interest, BSD, ABSD, legal fees.
          </p>
        </section>

        {/* Upgrade options */}
        <section className="space-y-3">
          <h3 className="font-semibold text-gray-800">All Options</h3>
          {result.options.map((option) => (
            <div
              key={option.type}
              className={`bg-white rounded-xl border p-5 ${
                option.type === result.recommendation
                  ? "border-blue-400 ring-2 ring-blue-100"
                  : "border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-gray-900">{option.label}</h4>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  option.affordable
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-600"
                }`}>
                  {option.affordable ? "✓ Affordable" : "✗ Out of range"}
                </span>
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                <p><span className="font-medium">Price:</span> {option.priceRange}</p>
                <p><span className="font-medium">Repayment:</span> {option.monthlyRepayment}</p>
                <p className="text-gray-500 text-xs mt-2">{option.notes}</p>
              </div>
            </div>
          ))}
        </section>

        <div className="text-center pt-2 pb-8">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 underline">
            Start over
          </Link>
        </div>
      </div>
    </main>
  );
}
