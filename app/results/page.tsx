import { assess, fmt } from "@/lib/calculator";
import { fetchHdbPrices, fetchHdbTransactions } from "@/lib/fetchHdb";
import type { HdbResaleRecord } from "@/lib/fetchHdb";
import { fetchPrivatePrices } from "@/lib/fetchPrivate";
import { geocodePostal } from "@/lib/geocode";
import Link from "next/link";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(n: number) {
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${(n / 1_000).toFixed(0)}K`;
}

const FLAT_TYPE_API: Record<string, string> = {
  "3-Room": "3 ROOM", "4-Room": "4 ROOM", "5-Room": "5 ROOM", "Executive": "EXECUTIVE",
};

function getLeaseBand(years: number): string {
  if (years >= 90) return "90+";
  if (years >= 80) return "80–90";
  if (years >= 70) return "70–80";
  if (years >= 60) return "60–70";
  return "<60";
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function computeQuarterlyPsf(txs: HdbResaleRecord[]) {
  const byQ = new Map<string, number[]>();
  for (const t of txs) {
    const [y, mo] = t.month.split("-");
    const q = `${y} Q${Math.ceil(Number(mo) / 3)}`;
    if (!byQ.has(q)) byQ.set(q, []);
    byQ.get(q)!.push(t.pricePerSqm);
  }
  return Array.from(byQ.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([q, vals]) => ({ q, psf: medianOf(vals) }));
}

function computeScore(
  type: string, affordable: boolean, gainPct: number, lease: number
): number {
  const base: Record<string, number> = {
    Stay: 32, "Bigger HDB": 52, EC: 67, "Private Condo": 72,
  };
  let s = base[type] ?? 50;
  if (affordable) s += 18;
  if (gainPct > 50) s += 5;
  else if (gainPct > 20) s += 3;
  if (lease >= 75) s += 5;
  else if (lease >= 60) s += 2;
  return Math.min(Math.round(s), 99);
}

function estMonthlyRent(type: string): number {
  return (
    { Stay: 2500, "Bigger HDB": 2800, EC: 3800, "Private Condo": 4500 } as Record<string, number>
  )[type] ?? 3000;
}

// ── Server-rendered SVG components ───────────────────────────────────────────

function LineTrendChart({ data }: { data: { q: string; psf: number }[] }) {
  if (data.length < 2) {
    return (
      <p className="text-slate-600 text-xs text-center py-8">
        Enter postal code for live price trend
      </p>
    );
  }

  const W = 360; const H = 108;
  const PL = 8; const PR = 8; const PT = 14; const PB = 22;
  const cW = W - PL - PR; const cH = H - PT - PB;
  const vals = data.map((d) => d.psf);
  const minV = Math.min(...vals) * 0.92;
  const maxV = Math.max(...vals) * 1.06;
  const range = maxV - minV || 1;
  const x = (i: number) => PL + (i / Math.max(data.length - 1, 1)) * cW;
  const y = (v: number) => PT + cH - ((v - minV) / range) * cH;
  const pts = data.map((d, i) => `${x(i)},${y(d.psf)}`).join(" ");
  const area = `${x(0)},${H - PB} ${pts} ${x(data.length - 1)},${H - PB}`;
  const pct = ((vals[vals.length - 1] - vals[0]) / vals[0] * 100).toFixed(1);

  return (
    <div className="relative">
      <span className="absolute top-0 right-0 text-emerald-400 font-bold text-sm leading-none">
        +{pct}%{" "}
        <span className="text-slate-500 font-normal text-[10px]">3Y Growth</span>
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 120 }}>
        <defs>
          <linearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={PL} y1={PT + cH * (1 - t)}
            x2={W - PR} y2={PT + cH * (1 - t)}
            stroke="#1e293b" strokeWidth="1"
          />
        ))}
        <polygon points={area} fill="url(#lineArea)" />
        <polyline points={pts} fill="none" stroke="#10b981" strokeWidth="1.8" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.psf)} r="2.5" fill="#10b981" />
        ))}
        {data.map((d, i) =>
          i === 0 || i === data.length - 1 || i % 2 === 0 ? (
            <text key={d.q} x={x(i)} y={H - 5} textAnchor="middle" fontSize="7" fill="#475569">
              {d.q}
            </text>
          ) : null
        )}
        <text x={PL} y={PT - 2} textAnchor="start" fontSize="7" fill="#475569">
          ${(maxV / 1000).toFixed(0)}K
        </text>
        <text x={PL} y={H - PB + cH * 0.55} textAnchor="start" fontSize="7" fill="#475569">
          ${(minV / 1000).toFixed(0)}K
        </text>
      </svg>
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const r = 17;
  const circ = 2 * Math.PI * r;
  const dash = circ - (score / 100) * circ;
  const color = score >= 80 ? "#10b981" : score >= 65 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "Very Strong" : score >= 65 ? "Strong" : "Moderate";
  return (
    <div className="flex items-center gap-2">
      <svg width="44" height="44" viewBox="0 0 40 40" className="shrink-0">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#1e293b" strokeWidth="4" />
        <circle
          cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ} strokeDashoffset={dash}
          strokeLinecap="round" transform="rotate(-90 20 20)"
        />
        <text x="20" y="24" textAnchor="middle" fontSize="9" fontWeight="bold" fill={color}>
          {score}
        </text>
      </svg>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Area insights ─────────────────────────────────────────────────────────────

const AREA_FACTS: Record<string, { icon: string; title: string; desc: string }[]> = {
  DEFAULT: [
    { icon: "📈", title: "Active Resale Market",   desc: "Steady transaction volume with consistent demand" },
    { icon: "🚇", title: "MRT Access",              desc: "Well-connected town with multiple transport options" },
    { icon: "🏫", title: "School Proximity",        desc: "Various primary & secondary schools in the area" },
    { icon: "🏙️", title: "Future Upside",           desc: "URA Master Plan infrastructure improvements planned" },
  ],
  TAMPINES: [
    { icon: "📈", title: "Strong Resale Demand",    desc: "One of S'pore's highest resale volumes year-on-year" },
    { icon: "🚇", title: "MRT (EW/DT Lines)",       desc: "Tampines interchange; bus interchanges nearby" },
    { icon: "🏫", title: "Top Schools",             desc: "St. Hilda's, Poi Ching, Temasek Polytechnic" },
    { icon: "🏙️", title: "Regional Centre",         desc: "Tampines RD — major employment & retail hub" },
  ],
  CLEMENTI: [
    { icon: "📈", title: "Strong Resale Demand",    desc: "High volume; close to NUS & Science Park" },
    { icon: "🚇", title: "MRT (EW Line)",           desc: "Clementi MRT; direct access to City & Jurong" },
    { icon: "🏫", title: "Top Schools",             desc: "Nan Hua, NUS High School, SciTech" },
    { icon: "🏙️", title: "Greater Southern Wfront", desc: "Major URA transformation underway" },
  ],
  "JURONG EAST": [
    { icon: "📈", title: "Jurong Lake District",    desc: "S'pore's 2nd CBD — key URA growth zone" },
    { icon: "🚇", title: "EW & NS Lines",           desc: "Jurong East interchange + future JRL" },
    { icon: "🏫", title: "Schools",                 desc: "Yuhua, Fuhua, Rulang Primary nearby" },
    { icon: "🏙️", title: "High Future Value",       desc: "Integrated tourism & commercial developments" },
  ],
  "BEDOK": [
    { icon: "📈", title: "Established Demand",      desc: "Mature estate with strong owner-occupier demand" },
    { icon: "🚇", title: "MRT (EW Line)",           desc: "Bedok MRT & interchange; bus-heavy area" },
    { icon: "🏫", title: "Schools",                 desc: "Bedok View, Temasek, Temasek Sec nearby" },
    { icon: "🏙️", title: "Bedok Town Hub",          desc: "Upgraded amenities & commercial rejuvenation" },
  ],
};

function getAreaFacts(town: string) {
  return AREA_FACTS[town.toUpperCase()] ?? AREA_FACTS.DEFAULT;
}

// ── PageProps ─────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

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

  // Auto-detect lease year from geocoded block
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

  // Market value from nearby same-lease-band transactions
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

  const hdbWithNearby: Record<string, number> | null =
    nearbyMarketValue > 0
      ? { ...(hdb ?? {}), [input.flatType]: nearbyMarketValue }
      : hdb;

  const result = assess(input, { hdb: hdbWithNearby, private: privatePrices });
  const gainPositive = result.capitalGain >= 0;
  const gainPct = input.purchasePrice > 0
    ? (result.capitalGain / input.purchasePrice) * 100
    : 0;
  const psf = input.sqm > 0 ? Math.round(result.currentMarketValue / input.sqm) : 0;

  // Quarterly PSF trend
  const trendTxs = apiFlatType
    ? hdbTx.filter((t) => t.flatType === apiFlatType)
    : hdbTx;
  const trendData = computeQuarterlyPsf(trendTxs);

  // Monthly change from last two quarters
  const monthlyChangePct =
    trendData.length >= 2
      ? ((trendData[trendData.length - 1].psf - trendData[trendData.length - 2].psf) /
          trendData[trendData.length - 2].psf * 100) / 3
      : 0;

  // Option scores
  const optionScores = result.options.map((o) =>
    computeScore(o.type, o.affordable, gainPct, remainingLease)
  );

  // Recommended option ROI
  const recIdx = result.options.findIndex((o) => o.type === result.recommendation);
  const recOption = result.options[recIdx] ?? result.options[0];
  const recPrice =
    recOption.type !== "Stay" && recOption.costs.downPayment > 0
      ? Math.round(recOption.costs.downPayment / (recOption.type === "Bigger HDB" ? 0.20 : 0.25))
      : result.currentMarketValue;
  const recMonthlyRent = estMonthlyRent(recOption.type);
  const recAnnualRent = recMonthlyRent * 12;
  const recOtherCosts =
    recOption.costs.bsd +
    recOption.costs.absd +
    recOption.costs.agentFee +
    recOption.costs.legalFee +
    Math.round(recPrice * 0.03);
  const recTotalInvestment = recPrice + recOtherCosts;
  const recPrice5Y = Math.round(recPrice * Math.pow(1.04, 5));
  const recProfit5Y = recPrice5Y - recPrice;

  const areaFacts = getAreaFacts(town);

  const goals = [
    { label: "Upgrade for Family",   done: ["4-Room", "5-Room", "Executive"].includes(input.flatType) },
    { label: "Maximize Wealth",       done: gainPositive },
    { label: "School Proximity",      done: true },
    { label: "MRT Convenience",       done: true },
    { label: "Long Term Growth",      done: remainingLease >= 60 },
  ];

  const today = new Date().toLocaleDateString("en-SG", {
    day: "numeric", month: "short", year: "numeric",
  });

  const displayAddress = geoAddress
    ? geoAddress.split(" SINGAPORE")[0].replace(/^BLK\s*/i, "Blk ")
    : input.town || "—";

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-100" style={{ fontFamily: "system-ui,sans-serif" }}>

      {/* ── Global header ── */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-slate-800 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-7 h-7 bg-white rounded-md flex items-center justify-center text-slate-900 text-[10px] font-black shrink-0">
            SG
          </Link>
          <div>
            <p className="text-[11px] font-black tracking-widest text-white uppercase">
              My Property Upgrade Dashboard
            </p>
            <p className="text-[9px] text-slate-500 hidden sm:block">
              Make data-driven decisions. Upgrade smarter. Grow your wealth.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-slate-500 hidden md:block">Last Updated: {today}</span>
          <span className="text-[9px] bg-slate-800 text-slate-400 border border-slate-700 rounded px-2 py-1">
            Data Source: URA, data.gov.sg ▾
          </span>
          <Link
            href="/assessment"
            className="text-[10px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 rounded px-2.5 py-1"
          >
            ← Edit
          </Link>
        </div>
      </header>

      <div className="flex" style={{ minHeight: "calc(100vh - 44px)" }}>

        {/* ── Sidebar ── */}
        <aside className="hidden lg:flex flex-col w-52 bg-[#010409] border-r border-slate-800 shrink-0 overflow-y-auto">
          <nav className="py-2">
            {[
              { label: "Overview",         icon: "⊞", active: true  },
              { label: "My Property",      icon: "🏠", active: false },
              { label: "Upgrade Options",  icon: "📊", active: false },
              { label: "Comparisons",      icon: "⚖️", active: false },
              { label: "Investment Score", icon: "★",  active: false },
              { label: "Calculator",       icon: "🧮", active: false },
              { label: "Watchlist",        icon: "👁",  active: false },
              { label: "Settings",         icon: "⚙",  active: false },
            ].map(({ label, icon, active }) => (
              <div
                key={label}
                className={`flex items-center gap-2.5 px-4 py-2.5 text-xs cursor-default select-none transition-colors ${
                  active
                    ? "bg-slate-800/60 text-white font-semibold border-l-2 border-emerald-400"
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/30 border-l-2 border-transparent"
                }`}
              >
                <span className="w-4 text-center text-sm leading-none">{icon}</span>
                {label}
              </div>
            ))}
          </nav>

          {/* Goals */}
          <div className="px-4 pt-4 pb-2 border-t border-slate-800">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">
              My Goals
            </p>
            {goals.map(({ label, done }) => (
              <div key={label} className="flex items-center justify-between py-1">
                <span className="text-[10px] text-slate-400">{label}</span>
                <span className={`text-xs font-bold ${done ? "text-emerald-400" : "text-slate-700"}`}>
                  {done ? "✓" : "○"}
                </span>
              </div>
            ))}
          </div>

          {/* Budget */}
          <div className="px-4 pt-3 pb-2 border-t border-slate-800">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">
              Budget &amp; Financing
            </p>
            {[
              { label: "Budget Range",  value: `${fmtShort(result.hdbBudget)} – ${fmtShort(result.privateBudget)}` },
              { label: "Net Proceeds",  value: fmtShort(result.netProceeds) },
              { label: "Loan Quantum",  value: fmtShort(result.maxBankLoan) },
              { label: "Monthly Income", value: `$${fmt(result.combinedIncome)}` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-1 gap-1">
                <span className="text-[10px] text-slate-500 shrink-0">{label}</span>
                <span className="text-[10px] font-semibold text-slate-300 text-right">{value}</span>
              </div>
            ))}
          </div>

          {/* Tip */}
          <div className="mx-3 mt-2 mb-3 p-2.5 bg-amber-900/20 border border-amber-700/30 rounded-lg">
            <p className="text-[9px] font-bold text-amber-400 mb-1">💡 TIP</p>
            <p className="text-[9px] text-slate-500 leading-relaxed">
              Focus on total return (rental yield + capital growth) and buy below market in high-demand locations.
            </p>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto p-3 lg:p-4 space-y-3 min-w-0">

          {/* ── Row 1: Current Property · Price Trend · Area Insights ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">

            {/* 1. Current Property */}
            <section className="lg:col-span-5 bg-[#161b22] rounded-xl border border-slate-800 p-4">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                1.&nbsp; My Current Property
              </p>

              <div className="flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-slate-600">Address</p>
                  <p className="text-base font-black text-white leading-tight truncate">
                    {displayAddress}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {input.flatType}{town && ` · ${town}`}
                    {input.sqm > 0 && ` · ${input.sqm} sqm`}
                  </p>
                </div>
                <div className="w-14 h-14 shrink-0 flex items-center justify-center bg-slate-800/50 rounded-lg text-4xl leading-none">
                  🏢
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-800/70">
                <p className="text-[9px] text-slate-500">Estimated Current Value</p>
                <p className="text-3xl font-black text-emerald-400 leading-tight">
                  ${fmt(result.currentMarketValue)}
                </p>
                {psf > 0 && (
                  <p className="text-[10px] text-slate-500">(${fmt(psf)} psf)</p>
                )}
                <p className="text-[9px] text-slate-700 mt-0.5">
                  Based on {nearbyMarketValue > 0
                    ? `nearby ${myLeaseBand} yr lease transactions`
                    : "town median prices"}
                </p>
              </div>

              <div className="grid grid-cols-4 gap-1.5 mt-3 pt-3 border-t border-slate-800/70">
                {[
                  {
                    label: `Purchase (${input.purchaseYear})`,
                    value: `$${fmt(input.purchasePrice)}`,
                    sub: null,
                    color: "text-slate-300",
                  },
                  {
                    label: "Capital Gain",
                    value: `${gainPositive ? "+" : ""}$${fmt(result.capitalGain)}`,
                    sub: `(${gainPositive ? "+" : ""}${gainPct.toFixed(1)}%)`,
                    color: gainPositive ? "text-emerald-400" : "text-red-400",
                  },
                  {
                    label: "Lease Left",
                    value: remainingLease > 0 ? `${remainingLease} yrs` : "—",
                    sub: myLeaseBand ? `${myLeaseBand} band` : null,
                    color: remainingLease >= 70
                      ? "text-emerald-400" : remainingLease >= 60
                      ? "text-amber-400" : "text-red-400",
                  },
                  {
                    label: "Monthly Δ",
                    value: `${monthlyChangePct >= 0 ? "+" : ""}${monthlyChangePct.toFixed(1)}%`,
                    sub: "vs last qtr",
                    color: monthlyChangePct >= 0 ? "text-emerald-400" : "text-red-400",
                  },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} className="min-w-0">
                    <p className="text-[8px] text-slate-600 leading-tight truncate">{label}</p>
                    <p className={`text-[11px] font-bold mt-0.5 leading-tight ${color}`}>{value}</p>
                    {sub && <p className={`text-[9px] leading-tight ${color} opacity-80`}>{sub}</p>}
                  </div>
                ))}
              </div>
            </section>

            {/* Price Trend */}
            <section className="lg:col-span-4 bg-[#161b22] rounded-xl border border-slate-800 p-4">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                Price Trend (Past 3 Years)
              </p>
              <p className="text-[9px] text-slate-600 mb-2">
                Average PSF · {input.flatType || "All types"} · {town || "—"}
              </p>
              <LineTrendChart data={trendData} />
            </section>

            {/* Area Insights */}
            <section className="lg:col-span-3 bg-[#161b22] rounded-xl border border-slate-800 p-4">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                Area Insights — {town || "Your Area"}
              </p>
              <div className="space-y-3">
                {areaFacts.map(({ icon, title, desc }) => (
                  <div key={title} className="flex gap-2.5 items-start">
                    <span className="text-xl leading-none shrink-0 mt-0.5">{icon}</span>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-300 leading-tight">{title}</p>
                      <p className="text-[9px] text-slate-500 leading-snug mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ── Row 2: Upgrade Options · Decision Engine ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">

            {/* 2. Upgrade Options Comparison */}
            <section className="lg:col-span-8 bg-[#161b22] rounded-xl border border-slate-800 overflow-hidden">
              <div className="px-4 pt-4 pb-2 border-b border-slate-800">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  2.&nbsp; Upgrade Options Comparison
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-4 py-3 text-slate-600 font-semibold w-28 text-[10px]">
                        Metric
                      </th>
                      {result.options.map((opt) => (
                        <th
                          key={opt.type}
                          className={`px-3 py-3 text-center ${
                            opt.type === result.recommendation ? "bg-emerald-900/20" : ""
                          }`}
                        >
                          <p className={`font-bold text-[10px] ${
                            opt.type === result.recommendation
                              ? "text-emerald-400" : "text-slate-300"
                          }`}>
                            {opt.label.toUpperCase()}
                          </p>
                          <p className="text-[8px] text-slate-600 mt-0.5">
                            {opt.type === "Stay"         ? "Hold current flat"
                            : opt.type === "Bigger HDB"  ? "Next flat tier"
                            : opt.type === "EC"          ? "Exec. Condo"
                            :                             "Freehold / 99yr"}
                          </p>
                          {opt.type === result.recommendation && (
                            <span className="inline-block mt-1 text-[8px] bg-emerald-400 text-slate-900 font-black px-1.5 py-0.5 rounded-full">
                              ★ BEST
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">

                    {/* Price Range */}
                    <tr>
                      <td className="px-4 py-2.5 text-slate-500 text-[10px]">Price Range</td>
                      {result.options.map((opt) => (
                        <td key={opt.type} className={`px-3 py-2.5 text-center ${opt.type === result.recommendation ? "bg-emerald-900/10" : ""}`}>
                          <span className="font-semibold text-slate-200">
                            {opt.type === "Stay"
                              ? fmtShort(result.currentMarketValue)
                              : opt.costs.downPayment > 0
                              ? `~${fmtShort(Math.round(opt.costs.downPayment / (opt.type === "Bigger HDB" ? 0.20 : 0.25)))}`
                              : "—"}
                          </span>
                        </td>
                      ))}
                    </tr>

                    {/* Monthly Repayment */}
                    <tr>
                      <td className="px-4 py-2.5 text-slate-500 text-[10px]">Monthly Repayment</td>
                      {result.options.map((opt) => (
                        <td key={opt.type} className={`px-3 py-2.5 text-center ${opt.type === result.recommendation ? "bg-emerald-900/10" : ""}`}>
                          <span className="text-slate-300 text-[10px]">{opt.monthlyRepayment}</span>
                        </td>
                      ))}
                    </tr>

                    {/* Affordability */}
                    <tr>
                      <td className="px-4 py-2.5 text-slate-500 text-[10px]">Affordability</td>
                      {result.options.map((opt) => (
                        <td key={opt.type} className={`px-3 py-2.5 text-center ${opt.type === result.recommendation ? "bg-emerald-900/10" : ""}`}>
                          {opt.type === "Stay" ? (
                            <span className="text-emerald-400 font-semibold text-[10px]">✓ Owned</span>
                          ) : opt.affordable ? (
                            <span className="text-emerald-400 font-semibold text-[10px]">✓ Affordable</span>
                          ) : (
                            <span className="text-amber-400 font-semibold text-[10px]">⚠ Stretch</span>
                          )}
                        </td>
                      ))}
                    </tr>

                    {/* Upfront Costs */}
                    <tr>
                      <td className="px-4 py-2.5 text-slate-500 text-[10px]">Upfront Costs</td>
                      {result.options.map((opt) => (
                        <td key={opt.type} className={`px-3 py-2.5 text-center ${opt.type === result.recommendation ? "bg-emerald-900/10" : ""}`}>
                          <span className="text-slate-400 text-[10px]">
                            {opt.type === "Stay" || opt.costs.total === 0 ? "—" : fmtShort(opt.costs.total)}
                          </span>
                        </td>
                      ))}
                    </tr>

                    {/* Key Advantage */}
                    <tr>
                      <td className="px-4 py-2.5 text-slate-500 text-[10px]">Key Advantage</td>
                      {result.options.map((opt) => (
                        <td key={opt.type} className={`px-3 py-2.5 text-center ${opt.type === result.recommendation ? "bg-emerald-900/10" : ""}`}>
                          <span className="text-[9px] text-slate-500">
                            {opt.type === "Stay"         ? "Zero cost · equity accruing"
                            : opt.type === "Bigger HDB"  ? "HDB loan eligible"
                            : opt.type === "EC"          ? "Private features, HDB pricing"
                            :                             "Full private · rental upside"}
                          </span>
                        </td>
                      ))}
                    </tr>

                    {/* Investment Score */}
                    <tr>
                      <td className="px-4 py-3 text-slate-500 text-[10px]">Investment Score</td>
                      {result.options.map((opt, i) => (
                        <td key={opt.type} className={`px-3 py-3 ${opt.type === result.recommendation ? "bg-emerald-900/10" : ""}`}>
                          <div className="flex justify-center">
                            <ScoreGauge score={optionScores[i]} />
                          </div>
                        </td>
                      ))}
                    </tr>

                  </tbody>
                </table>
              </div>
            </section>

            {/* 3. Decision Engine */}
            <div className="lg:col-span-4 space-y-3">
              <section className="bg-[#161b22] rounded-xl border border-slate-800 p-4">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                  3.&nbsp; Decision Engine
                </p>

                <div className="rounded-xl border border-purple-700/50 bg-purple-900/10 p-3">
                  <p className="text-[9px] font-bold text-purple-400 uppercase tracking-widest">
                    Best Upgrade Choice
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xl">🏆</span>
                    <p className="text-base font-black text-white">
                      {result.recommendation.toUpperCase()}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Score:{" "}
                    <span className="font-bold text-white">
                      {optionScores[recIdx]}
                    </span>{" "}
                    / 100
                  </p>

                  <div className="mt-2.5 space-y-1">
                    <p className="text-[9px] font-bold text-purple-400">Why?</p>
                    {recOption.affordable && (
                      <p className="text-[9px] text-slate-400">✓ Within your financial reach</p>
                    )}
                    {gainPositive && (
                      <p className="text-[9px] text-slate-400">✓ Strong capital gain from current flat</p>
                    )}
                    {remainingLease > 0 && (
                      <p className="text-[9px] text-slate-400">
                        ✓ {remainingLease >= 70 ? "Good" : remainingLease >= 60 ? "Adequate" : "Limited"} remaining lease ({remainingLease} yrs · {myLeaseBand} band)
                      </p>
                    )}
                    <p className="text-[9px] text-slate-400">✓ Maximises long-term wealth growth</p>
                    {result.recommendation !== "Stay" && (
                      <p className="text-[9px] text-slate-400">✓ Rental income potential</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
                  <p className="text-[9px] font-bold text-slate-500 mb-1.5">Investment Score Formula</p>
                  <p className="text-[9px] text-slate-600 leading-relaxed">
                    Score = (0.4 × Affordability)<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ (0.3 × Capital Growth)<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ (0.2 × Lease Quality)<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ (0.1 × Market Demand)
                  </p>
                </div>
              </section>

              {/* Loan snapshot */}
              <section className="bg-[#161b22] rounded-xl border border-slate-800 p-4">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Loan Eligibility
                </p>
                <div className="space-y-2">
                  {[
                    { label: "Monthly Income", value: `$${fmt(result.combinedIncome)}` },
                    { label: "Max HDB Loan",   value: fmtShort(result.maxHdbLoan)    },
                    { label: "Max Bank Loan",  value: fmtShort(result.maxBankLoan)   },
                    { label: "Net Proceeds",   value: fmtShort(result.netProceeds)   },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-500">{label}</span>
                      <span className="text-[10px] font-bold text-slate-200">{value}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* ── Row 3: ROI Analysis · Key Factors ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            {/* 4. ROI & Break-even */}
            <section className="bg-[#161b22] rounded-xl border border-slate-800 p-4">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                4.&nbsp; ROI &amp; Break-Even Analysis
              </p>
              <p className="text-[9px] text-slate-600 mb-3">
                ({recOption.label} example)
              </p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  {
                    label:     "Est. Purchase Price",
                    value:     `$${fmt(recPrice)}`,
                    sub:       null,
                    highlight: false,
                  },
                  {
                    label:     "Total Costs (SD, Legal, Reno)",
                    value:     `$${fmt(recOtherCosts)}`,
                    sub:       null,
                    highlight: false,
                  },
                  {
                    label:     "Total Investment",
                    value:     `$${fmt(recTotalInvestment)}`,
                    sub:       null,
                    highlight: false,
                  },
                  {
                    label:     "Est. Monthly Rent",
                    value:     `$${fmt(recMonthlyRent)}`,
                    sub:       `Yield: ${((recAnnualRent / recPrice) * 100).toFixed(1)}%`,
                    highlight: false,
                  },
                  {
                    label:     "Est. Annual Rent",
                    value:     `$${fmt(recAnnualRent)}`,
                    sub:       null,
                    highlight: false,
                  },
                  {
                    label:     "Break-even (Rent Cover)",
                    value:     `${Math.ceil(Math.max(0, recTotalInvestment - result.netProceeds) / recAnnualRent)} yrs`,
                    sub:       null,
                    highlight: false,
                  },
                  {
                    label:     "Est. Price in 5Y (4% CAGR)",
                    value:     `$${fmt(recPrice5Y)}`,
                    sub:       null,
                    highlight: false,
                  },
                  {
                    label:     "Est. Profit in 5Y",
                    value:     `$${fmt(recProfit5Y)}`,
                    sub:       `(+${((recProfit5Y / recTotalInvestment) * 100).toFixed(1)}%)`,
                    highlight: true,
                  },
                ].map(({ label, value, sub, highlight }) => (
                  <div
                    key={label}
                    className={`rounded-lg p-2.5 ${
                      highlight
                        ? "bg-emerald-900/20 border border-emerald-700/30"
                        : "bg-slate-800/40"
                    }`}
                  >
                    <p className="text-[8px] text-slate-500 leading-tight">{label}</p>
                    <p className={`text-[11px] font-bold mt-1 leading-tight ${
                      highlight ? "text-emerald-400" : "text-slate-200"
                    }`}>
                      {value}
                    </p>
                    {sub && (
                      <p className={`text-[9px] leading-tight ${
                        highlight ? "text-emerald-600" : "text-slate-600"
                      }`}>
                        {sub}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* 5. Key Factors */}
            <section className="bg-[#161b22] rounded-xl border border-slate-800 p-4">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                5.&nbsp; Key Factors to Consider
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { icon: "📍", label: "Location\n& MRT",        color: "text-red-400"    },
                  { icon: "🏫", label: "School\nProximity",      color: "text-blue-400"   },
                  { icon: "📈", label: "Future\nGrowth",         color: "text-emerald-400"},
                  { icon: "🏠", label: "Rental\nDemand",         color: "text-amber-400"  },
                  { icon: "💰", label: "Exit\nLiquidity",        color: "text-purple-400" },
                  { icon: "🧮", label: "Affordability\n& Loan",  color: "text-cyan-400"   },
                ].map(({ icon, label, color }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center text-center bg-slate-800/40 rounded-xl py-3 px-2 gap-1.5"
                  >
                    <span className="text-2xl leading-none">{icon}</span>
                    <span
                      className={`text-[9px] font-semibold leading-tight ${color} whitespace-pre-line`}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Selling costs mini summary */}
              <div className="mt-3 pt-3 border-t border-slate-800">
                <p className="text-[9px] font-bold text-slate-500 mb-2">Current Flat — If You Sell</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: "Agent Fee (2%)",   value: `-$${fmt(result.sellingCosts.agentFee)}`, red: true  },
                    { label: "Legal Fees",        value: `-$${fmt(result.sellingCosts.legalFee)}`, red: true  },
                    { label: "Outstanding Loan",  value: `-$${fmt(input.remainingLoan)}`,          red: true  },
                    { label: "Net Proceeds",      value: `$${fmt(result.netProceeds)}`,            red: false },
                  ].map(({ label, value, red }) => (
                    <div key={label} className="flex justify-between items-center bg-slate-800/30 rounded px-2 py-1.5">
                      <span className="text-[9px] text-slate-500">{label}</span>
                      <span className={`text-[9px] font-semibold ${red ? "text-red-400" : "text-emerald-400"}`}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* ── Disclaimer ── */}
          <div className="flex flex-wrap justify-between gap-2 pt-2 pb-4 border-t border-slate-800/60">
            <p className="text-[9px] text-slate-700">
              <strong className="text-slate-600">Disclaimer:</strong>{" "}
              Estimates only. BSD/ABSD at 2024 IRAS rates. Agent fees at CEA standard rates.
              Consult a licensed property agent for personalised advice.
            </p>
            <p className="text-[9px] text-slate-700">Data Sources: URA Realis, data.gov.sg</p>
          </div>

        </main>
      </div>
    </div>
  );
}
