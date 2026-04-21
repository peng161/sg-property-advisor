export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-xl w-full text-center">
        <div className="mb-6">
          <span className="text-5xl">🏠</span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          SG Property Upgrade Advisor
        </h1>
        <p className="text-gray-600 mb-8 text-lg">
          Find out if now is the right time to upgrade your HDB — or take the
          leap to private property.
        </p>
        <a
          href="/assessment"
          className="inline-block bg-blue-600 text-white text-lg font-semibold px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Start Assessment
        </a>
        <p className="mt-4 text-sm text-gray-400">
          Takes about 2 minutes · Uses sample Singapore data
        </p>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-4 max-w-xl w-full sm:grid-cols-4">
        {[
          { icon: "📊", label: "Affordability check" },
          { icon: "📍", label: "Nearby prices" },
          { icon: "💰", label: "Income analysis" },
          { icon: "✅", label: "Clear recommendation" },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100"
          >
            <div className="text-2xl mb-1">{item.icon}</div>
            <div className="text-xs text-gray-500 font-medium">{item.label}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
