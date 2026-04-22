"use client";

import { useState, useMemo } from "react";
import type { PrivateTransaction } from "@/lib/fetchPrivateTransactions";

interface Props {
  transactions: PrivateTransaction[];
  source: "ura-live" | "mock";
}

const SEG_COLOR: Record<string, string> = {
  CCR: "bg-violet-100 text-violet-700",
  RCR: "bg-blue-100  text-blue-700",
  OCR: "bg-emerald-100 text-emerald-700",
};

function fmt(n: number) {
  return n.toLocaleString("en-SG");
}
function fmtK(n: number) {
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : `$${(n / 1_000).toFixed(0)}K`;
}

// --- Simple SVG line chart ---
function TrendChart({ transactions }: { transactions: PrivateTransaction[] }) {
  // Group by quarter × segment → median pricePerSqm
  const quarters: Map<string, Record<string, number[]>> = new Map();

  for (const t of transactions) {
    const [y, m] = t.contractDate.split("-");
    const q = `${y} Q${Math.ceil(Number(m) / 3)}`;
    if (!quarters.has(q)) quarters.set(q, { CCR: [], RCR: [], OCR: [] });
    quarters.get(q)![t.marketSegment].push(t.pricePerSqm);
  }

  const labels = Array.from(quarters.keys()).sort();
  if (labels.length < 2) return null;

  function median(arr: number[]) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  const series = {
    CCR: labels.map((l) => median(quarters.get(l)!.CCR)),
    RCR: labels.map((l) => median(quarters.get(l)!.RCR)),
    OCR: labels.map((l) => median(quarters.get(l)!.OCR)),
  };

  const allValues = Object.values(series).flat().filter((v): v is number => v !== null);
  const minVal = Math.min(...allValues) * 0.92;
  const maxVal = Math.max(...allValues) * 1.06;
  const range  = maxVal - minVal;

  const W = 560;
  const H = 160;
  const PAD_L = 54;
  const PAD_R = 16;
  const PAD_T = 12;
  const PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  function x(i: number) {
    return PAD_L + (i / (labels.length - 1)) * chartW;
  }
  function y(v: number) {
    return PAD_T + chartH - ((v - minVal) / range) * chartH;
  }

  function polyline(values: (number | null)[]) {
    const pts = values
      .map((v, i) => (v !== null ? `${x(i)},${y(v)}` : null))
      .filter(Boolean);
    return pts.join(" ");
  }

  const seriesConfig = [
    { key: "CCR" as const, color: "#7c3aed", label: "CCR" },
    { key: "RCR" as const, color: "#2563eb", label: "RCR" },
    { key: "OCR" as const, color: "#059669", label: "OCR" },
  ];

  // Y axis ticks (3 levels)
  const yTicks = [minVal, minVal + range / 2, maxVal].map(Math.round);

  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 mb-2">
        Median Price / sqm by Quarter (S$)
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 180 }}>
        {/* Y grid lines */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)}
              stroke="#e2e8f0" strokeWidth="1"
            />
            <text
              x={PAD_L - 4} y={y(v) + 4}
              textAnchor="end" fontSize="9" fill="#94a3b8"
            >
              {(v / 1000).toFixed(0)}K
            </text>
          </g>
        ))}

        {/* X labels (every other quarter to avoid crowding) */}
        {labels.map((l, i) => (
          i % 2 === 0 && (
            <text
              key={l}
              x={x(i)} y={H - 6}
              textAnchor="middle" fontSize="8" fill="#94a3b8"
            >
              {l.replace(" ", "\n")}
            </text>
          )
        ))}

        {/* Lines */}
        {seriesConfig.map(({ key, color }) => (
          <polyline
            key={key}
            points={polyline(series[key])}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Dots */}
        {seriesConfig.map(({ key, color }) =>
          series[key].map((v, i) =>
            v !== null ? (
              <circle key={`${key}-${i}`} cx={x(i)} cy={y(v)} r="3" fill={color} />
            ) : null
          )
        )}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-1">
        {seriesConfig.map(({ key, color, label }) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main panel ---
export default function PrivatePropertyPanel({ transactions, source }: Props) {
  const [segment, setSegment] = useState<"" | "CCR" | "RCR" | "OCR">("");
  const [sortBy, setSortBy] = useState<"date" | "price" | "psm">("date");

  const filtered = useMemo(() => {
    let list = segment ? transactions.filter((t) => t.marketSegment === segment) : transactions;
    if (sortBy === "price") list = [...list].sort((a, b) => b.price - a.price);
    else if (sortBy === "psm") list = [...list].sort((a, b) => b.pricePerSqm - a.pricePerSqm);
    else list = [...list].sort((a, b) => b.contractDate.localeCompare(a.contractDate));
    return list.slice(0, 30);
  }, [transactions, segment, sortBy]);

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-bold text-slate-900">🏙️ Private Property Transactions</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Singapore condos · last 3 years
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
            source === "ura-live"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
              : "bg-slate-100 border-slate-200 text-slate-500"
          }`}>
            {source === "ura-live" ? "🟢 Live (URA)" : "⚪ Sample data"}
          </span>
        </div>
      </div>

      {/* Trend chart */}
      <div className="px-5 pt-4 pb-2">
        <TrendChart transactions={transactions} />
      </div>

      {/* Filters */}
      <div className="px-5 py-3 border-t border-slate-50 flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-slate-500">Segment:</span>
        {(["", "OCR", "RCR", "CCR"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              segment === s
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            }`}
          >
            {s || "All"}
          </button>
        ))}
        <span className="ml-auto text-xs font-semibold text-slate-500">Sort:</span>
        {([["date", "Latest"], ["price", "Price ↓"], ["psm", "$/sqm ↓"]] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setSortBy(val)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              sortBy === val
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[580px] text-xs">
          <thead>
            <tr className="bg-slate-50 border-t border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-semibold text-slate-500 whitespace-nowrap">Project</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Seg</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500 whitespace-nowrap">Price</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500">sqm</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500 whitespace-nowrap">$/sqm</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Floor</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Tenure</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((t, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">{t.project}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${SEG_COLOR[t.marketSegment] ?? ""}`}>
                    {t.marketSegment}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{fmtK(t.price)}</td>
                <td className="px-3 py-2.5 text-right text-slate-600">{t.sqm}</td>
                <td className="px-3 py-2.5 text-right text-slate-700 font-medium">S${fmt(t.pricePerSqm)}</td>
                <td className="px-3 py-2.5 text-slate-500">{t.floorRange}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[120px] truncate" title={t.tenure}>
                  {t.tenure}
                </td>
                <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{t.contractDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          No transactions match the current filter.
        </div>
      )}

      <div className="px-5 py-3 border-t border-slate-50 text-xs text-slate-400">
        Showing {filtered.length} of {transactions.length} transactions ·{" "}
        {source === "ura-live" ? "Source: URA PMI_Resi_Transaction" : "Source: Sample data — add URA_ACCESS_KEY for live data"}
      </div>
    </section>
  );
}
