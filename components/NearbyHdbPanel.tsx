"use client";

import { useState, useMemo } from "react";
import type { HdbResaleRecord } from "@/lib/fetchHdb";

interface Props {
  transactions: HdbResaleRecord[];
  myFlatType:   string;
  myFloor:      number;
  mySqm:        number;
  source:       "live" | "mock";
}

function fmt(n: number) { return n.toLocaleString("en-SG"); }
function fmtK(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

// Colour-code remaining lease: green = long, red = short
function leaseBadge(years: number) {
  if (years >= 85) return { bg: "bg-emerald-100 text-emerald-700", label: `${years}y` };
  if (years >= 75) return { bg: "bg-teal-100 text-teal-700",       label: `${years}y` };
  if (years >= 65) return { bg: "bg-amber-100 text-amber-700",     label: `${years}y` };
  if (years >= 55) return { bg: "bg-orange-100 text-orange-700",   label: `${years}y` };
  return              { bg: "bg-red-100 text-red-600",             label: `${years}y` };
}

// Convert "01 TO 05" → midpoint floor number
function storeyMidpoint(range: string): number {
  const m = range.match(/(\d+)\s+TO\s+(\d+)/i);
  if (!m) return 0;
  return Math.round((Number(m[1]) + Number(m[2])) / 2);
}

// Simple SVG bar chart: median price/sqm by quarter
function PriceTrendChart({ transactions }: { transactions: HdbResaleRecord[] }) {
  const byQuarter: Map<string, number[]> = new Map();
  for (const t of transactions) {
    const [y, m] = t.month.split("-");
    const q = `${y}-Q${Math.ceil(Number(m) / 3)}`;
    if (!byQuarter.has(q)) byQuarter.set(q, []);
    byQuarter.get(q)!.push(t.pricePerSqm);
  }

  const quarters = Array.from(byQuarter.keys()).sort().slice(-8); // last 8 quarters
  if (quarters.length < 2) return null;

  function median(arr: number[]) {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  const values = quarters.map((q) => median(byQuarter.get(q)!));
  const minV   = Math.min(...values) * 0.94;
  const maxV   = Math.max(...values) * 1.04;
  const range  = maxV - minV || 1;

  const W = 480; const H = 120;
  const PAD_L = 44; const PAD_R = 8; const PAD_T = 8; const PAD_B = 24;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const barW = chartW / quarters.length - 4;
  const x = (i: number) => PAD_L + (i / quarters.length) * chartW + barW * 0.1;
  const y = (v: number) => PAD_T + chartH - ((v - minV) / range) * chartH;

  const ticks = [minV, minV + range / 2, maxV].map(Math.round);

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-slate-500 mb-1">Median $/sqm by Quarter</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD_L - 3} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">
              {(v / 1000).toFixed(0)}K
            </text>
          </g>
        ))}
        {quarters.map((q, i) => (
          <g key={q}>
            <rect
              x={x(i)} y={y(values[i])} width={barW} height={chartH - (y(values[i]) - PAD_T)}
              fill="#10b981" fillOpacity="0.7" rx="2"
            />
            {i % 2 === 0 && (
              <text x={x(i) + barW / 2} y={H - 6} textAnchor="middle" fontSize="7" fill="#94a3b8">
                {q.replace("-", " ")}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function NearbyHdbPanel({
  transactions,
  myFlatType,
  myFloor,
  mySqm,
  source,
}: Props) {
  const [filterType, setFilterType] = useState<string>(myFlatType || "");
  const [sortBy, setSortBy] = useState<"date" | "price" | "psm" | "lease">("date");

  const flatTypes = useMemo(() => {
    const types = new Set(transactions.map((t) => t.flatType));
    return Array.from(types).sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    let list = filterType
      ? transactions.filter((t) => t.flatType === filterType)
      : transactions;

    if (sortBy === "price") list = [...list].sort((a, b) => b.resalePrice - a.resalePrice);
    else if (sortBy === "psm") list = [...list].sort((a, b) => b.pricePerSqm - a.pricePerSqm);
    else if (sortBy === "lease") list = [...list].sort((a, b) => b.remainingLease - a.remainingLease);
    else list = [...list].sort((a, b) => b.month.localeCompare(a.month));

    return list.slice(0, 40);
  }, [transactions, filterType, sortBy]);

  // Stats summary
  const sameType = transactions.filter((t) => t.flatType === (myFlatType || filterType));
  const medianPrice  = sameType.length ? Math.round(sameType.reduce((s, t) => s + t.resalePrice,  0) / sameType.length) : 0;
  const medianPsm    = sameType.length ? Math.round(sameType.reduce((s, t) => s + t.pricePerSqm,  0) / sameType.length) : 0;
  const medianLease  = sameType.length ? Math.round(sameType.reduce((s, t) => s + t.remainingLease, 0) / sameType.length) : 0;
  const myPsm        = mySqm > 0 && medianPrice > 0 ? Math.round(medianPrice / mySqm) : 0;

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-bold text-slate-900 text-base">🏘️ Nearby HDB Transactions</h2>
            <p className="text-xs text-slate-400 mt-0.5">Resale prices in your area · last 3 years</p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium border shrink-0 ${
            source === "live"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
              : "bg-slate-100 border-slate-200 text-slate-500"
          }`}>
            {source === "live" ? "🟢 Live data" : "⚪ Sample"}
          </span>
        </div>
      </div>

      {/* Key stats strip */}
      {sameType.length > 0 && (
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-slate-400 mb-0.5">Median price</p>
            <p className="font-bold text-slate-900 text-sm">{fmtK(medianPrice)}</p>
            <p className="text-xs text-slate-400">{myFlatType || filterType}</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-slate-400 mb-0.5">Median $/sqm</p>
            <p className="font-bold text-slate-900 text-sm">S${fmt(medianPsm)}</p>
            {myPsm > 0 && (
              <p className="text-xs text-slate-400">your flat ~S${fmt(myPsm)}</p>
            )}
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-slate-400 mb-0.5">Avg remaining</p>
            <p className={`font-bold text-sm ${
              medianLease >= 80 ? "text-emerald-600" :
              medianLease >= 70 ? "text-teal-600" :
              medianLease >= 60 ? "text-amber-600" : "text-red-500"
            }`}>
              {medianLease} yrs
            </p>
            <p className="text-xs text-slate-400">lease left</p>
          </div>
        </div>
      )}

      {/* Trend chart */}
      <div className="px-4 pt-4">
        <PriceTrendChart transactions={filterType ? filtered : transactions} />
      </div>

      {/* Filters */}
      <div className="px-4 pb-3 flex flex-wrap gap-2 items-center border-b border-slate-50">
        <span className="text-xs font-semibold text-slate-500 w-full sm:w-auto">Type:</span>
        <button
          onClick={() => setFilterType("")}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            filterType === "" ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-500"
          }`}
        >
          All
        </button>
        {flatTypes.map((ft) => (
          <button
            key={ft}
            onClick={() => setFilterType(ft)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filterType === ft ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-500"
            }`}
          >
            {ft.replace(" ROOM", "-Room").replace("EXECUTIVE", "Executive")}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-semibold text-slate-500">Sort:</span>
          {([["date", "Latest"], ["price", "Price"], ["psm", "$/sqm"], ["lease", "Lease ↓"]] as const).map(
            ([val, label]) => (
              <button
                key={val}
                onClick={() => setSortBy(val)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  sortBy === val
                    ? "bg-slate-900 text-white border-slate-900"
                    : "border-slate-200 text-slate-500"
                }`}
              >
                {label}
              </button>
            )
          )}
        </div>
      </div>

      {/* Table — horizontally scrollable on mobile */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[580px] text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-semibold text-slate-500">Block / Street</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500 whitespace-nowrap">Type</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Storey</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500">sqm</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500 whitespace-nowrap">Price</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500 whitespace-nowrap">$/sqm</th>
              <th className="text-center px-3 py-2.5 font-semibold text-slate-500 whitespace-nowrap">Lease Left</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((t, i) => {
              const badge = leaseBadge(t.remainingLease);
              const midFloor = storeyMidpoint(t.storeyRange);
              // Highlight rows with similar floor level and size to user's flat
              const isSimilarFloor = myFloor > 0 && Math.abs(midFloor - myFloor) <= 3;
              const isSimilarSqm   = mySqm   > 0 && Math.abs(t.sqm - mySqm) <= 10;
              const isComparable   = isSimilarFloor && isSimilarSqm && t.flatType === myFlatType;

              return (
                <tr
                  key={i}
                  className={`transition-colors ${
                    isComparable ? "bg-emerald-50 hover:bg-emerald-100" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-800">{t.block} </span>
                    <span className="text-slate-500 truncate">{t.streetName}</span>
                    {isComparable && (
                      <span className="ml-1 text-emerald-600 font-semibold text-xs">★</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                    {t.flatType.replace(" ROOM", "-Rm").replace("EXECUTIVE", "Exec")}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{t.storeyRange}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{t.sqm}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                    {fmtK(t.resalePrice)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 whitespace-nowrap">
                    S${fmt(t.pricePerSqm)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${badge.bg}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{t.month}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-sm text-slate-400 py-8">No transactions found for this filter.</p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-50 text-xs text-slate-400 flex flex-wrap justify-between gap-1">
        <span>
          Showing {filtered.length} of {transactions.length} transactions ·
          {myFloor > 0 && mySqm > 0 && " ★ = similar floor & size to your flat"}
        </span>
        <span>{source === "live" ? "Source: data.gov.sg HDB resale dataset" : "Add postal code for live nearby data"}</span>
      </div>
    </section>
  );
}
