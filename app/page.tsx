import Link from "next/link";

const STATS = [
  { value: "26",   label: "HDB Towns Covered"     },
  { value: "4",    label: "Upgrade Paths Analysed" },
  { value: "100%", label: "Free to Use"            },
];

const FEATURES = [
  {
    icon: "📍",
    title: "Nearby Market Prices",
    desc: "Live HDB resale and private condo prices pulled from official Singapore data.",
  },
  {
    icon: "💰",
    title: "Affordability Analysis",
    desc: "Calculates your max loan using MSR and TDSR rules — the same way banks do.",
  },
  {
    icon: "✅",
    title: "Clear Recommendation",
    desc: "Stay put, upgrade HDB, buy an EC, or go private — we tell you which makes sense.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#D9E4D7] font-sans">

      {/* Nav */}
      <nav className="sticky top-0 z-20 bg-white/75 backdrop-blur-md border-b border-white/50 px-4 sm:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-neutral-900 rounded-full flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-black tracking-tighter">SG</span>
          </div>
          <span className="font-bold text-neutral-900 text-sm">SG Property Advisor</span>
        </div>
        <Link
          href="/assessment"
          className="text-xs font-medium text-neutral-500 bg-neutral-100 hover:bg-neutral-200 transition-colors rounded-full px-4 py-1.5"
        >
          Get Started →
        </Link>
      </nav>

      {/* Hero */}
      <section className="relative bg-neutral-900 overflow-hidden">
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        {/* Amber glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-amber-400/10 blur-[120px] rounded-full" />

        <div className="relative max-w-4xl mx-auto px-6 pt-32 pb-24 text-center">
          <span className="inline-flex items-center gap-2 text-amber-400 text-sm font-medium bg-amber-400/10 border border-amber-400/20 px-4 py-1.5 rounded-full mb-6">
            🇸🇬 Built for Singapore homeowners
          </span>
          <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight mb-5 tracking-tight">
            Should you upgrade<br />
            <span className="text-amber-400">your property?</span>
          </h1>
          <p className="text-neutral-400 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Enter your current flat details and household income. We&apos;ll tell
            you exactly what you can afford — and whether it&apos;s time to move up.
          </p>
          <Link
            href="/assessment"
            className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-neutral-900 font-bold px-8 py-3.5 rounded-full text-base transition-colors shadow-lg shadow-amber-400/20"
          >
            Start Free Assessment
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <p className="text-neutral-600 text-sm mt-4">Takes 2 minutes · No sign-up needed</p>
        </div>

        {/* Stats bar */}
        <div className="relative border-t border-neutral-800 bg-neutral-900/80">
          <div className="max-w-4xl mx-auto px-6 py-6 grid grid-cols-3 divide-x divide-neutral-800">
            {STATS.map((s) => (
              <div key={s.label} className="text-center px-4">
                <div className="text-2xl font-black text-white">{s.value}</div>
                <div className="text-neutral-500 text-xs mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-2xl font-black text-neutral-900 text-center mb-2 tracking-tight">
          Everything you need to decide
        </h2>
        <p className="text-neutral-500 text-center text-sm mb-10">
          Powered by live data from HDB and URA
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-bold text-neutral-900 mb-2">{f.title}</h3>
              <p className="text-neutral-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA strip */}
      <section className="mx-4 sm:mx-6 mb-12 max-w-4xl md:mx-auto bg-neutral-900 rounded-3xl p-10 text-center">
        <h2 className="text-2xl font-black text-white mb-3 tracking-tight">
          Ready to find out your options?
        </h2>
        <p className="text-neutral-400 text-sm mb-6">
          Free analysis based on your income and current flat
        </p>
        <Link
          href="/assessment"
          className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-neutral-900 font-bold px-7 py-3 rounded-full transition-colors"
        >
          Start Assessment →
        </Link>
      </section>

      {/* Footer */}
      <footer className="text-center pb-8">
        <Link href="/admin" className="text-[10px] text-neutral-400 hover:text-neutral-600 transition-colors">
          Admin
        </Link>
      </footer>

    </main>
  );
}
