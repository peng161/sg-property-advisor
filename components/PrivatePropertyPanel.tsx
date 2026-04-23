"use client";

import { useState, useEffect, useMemo } from "react";
import type { PrivateRecord } from "@/lib/fetchDataGovPrivate";

// API response shape
interface ApiResponse {
  total:        number;
  source:       string;
  transactions: PrivateRecord[];
  error?:       string;
}

// ---- Helpers ----

const SEG_COLOR: Record<string, string> = {
  CCR: "bg-violet-100 text-violet-700",
  RCR: "bg-blue-100 text-blue-700",
  OCR: "bg-emerald-100 text-emerald-700",
};

function fmt(n: number)  { return n.toLocaleString("en-SG"); }
function fmtM(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

// ---- SVG line chart: median price/sqm by month ----
function PriceTrendChart({ records }: { records: PrivateRecord[] }) {
  // Group by month × segment
  const byMonth = new Map<string, Record<string, number[]>>();
  for (const r of records) {
    if (!byMonth.has(r.transactionDate)) byMonth.set(r.transactionDate, { CCR: [], RCR: [], OCR: [] });
    byMonth.get(r.transactionDate)![r.marketSegment].push(r.pricePerSqm);
  }

  const months = Array.from(byMonth.keys()).sort().slice(-12); // last 12 months
  if (months.length < 2) return null;

  function median(arr: number[]): number | null {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  const series = {
    CCR: months.map((m) => median(byMonth.get(m)!.CCR)),
    RCR: months.map((m) => median(byMonth.get(m)!.RCR)),
    OCR: months.map((m) => median(byMonth.get(m)!.OCR)),
  };

  const allVals = Object.values(series)
    .flat()
    .filter((v): v is number => v !== null);
  if (!allVals.length) return null;

  const minV = Math.min(...allVals) * 0.94;
  const maxV = Math.max(...allVals) * 1.05;
  const range = maxV - minV || 1;

  const W = 520; const H = 140;
  const PL = 48; const PR = 8; const PT = 10; const PB = 26;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const xOf = (i: number) => PL + (i / (months.length - 1)) * cW;
  const yOf = (v: number) => PT + cH - ((v - minV) / range) * cH;

  function points(vals: (number | null)[]) {
    return vals
      .map((v, i) => v !== null ? `${xOf(i)},${yOf(v)}` : null)
      .filter(Boolean)
      .join(" ");
  }

  const lines = [
    { key: "CCR" as const, color: "#7c3aed" },
    { key: "RCR" as const, color: "#2563eb" },
    { key: "OCR" as const, color: "#059669" },
  ];

  const ticks = [minV, minV + range / 2, maxV].map(Math.round);

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-neutral-500 mb-1">Median Price / sqm by Month (S$)</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 160 }}>
        {/* Grid + Y labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PL} y1={yOf(v)} x2={W - PR} y2={yOf(v)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PL - 4} y={yOf(v) + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
              {(v / 1000).toFixed(0)}K
            </text>
          </g>
        ))}
        {/* X labels — every other month */}
        {months.map((m, i) =>
          i % 2 === 0 ? (
            <text key={m} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="#94a3b8">
              {m.slice(2)} {/* "YY-MM" */}
            </text>
          ) : null
        )}
        {/* Lines + dots */}
        {lines.map(({ key, color }) => (
          <g key={key}>
            <polyline
              points={points(series[key])}
              fill="none" stroke={color} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            />
            {series[key].map((v, i) =>
              v !== null ? (
                <circle key={i} cx={xOf(i)} cy={yOf(v)} r="3" fill={color} />
              ) : null
            )}
          </g>
        ))}
      </svg>
      {/* Legend */}
      <div className="flex gap-4 mt-1">
        {lines.map(({ key, color }) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="w-5 h-0.5 inline-block rounded" style={{ backgroundColor: color }} />
            {key}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Loading skeleton ----
function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 px-4 py-6">
      <div className="h-4 bg-neutral-100 rounded w-1/3" />
      <div className="h-32 bg-neutral-100 rounded" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 bg-neutral-100 rounded" />
        ))}
      </div>
    </div>
  );
}

// ---- Main panel ----
export default function PrivatePropertyPanel() {
  const [records, setRecords] = useState<PrivateRecord[]>([]);
  const [source,  setSource]  = useState("data.gov.sg");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [segment, setSegment] = useState<"" | "CCR" | "RCR" | "OCR">("");
  const [sortBy,  setSortBy]  = useState<"date" | "price" | "psm">("date");

  useEffect(() => {
    fetch("/api/private-properties")
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRecords(data.transactions);
        setSource(data.source);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    let list = segment ? records.filter((r) => r.marketSegment === segment) : records;
    if (sortBy === "price") list = [...list].sort((a, b) => b.price - a.price);
    else if (sortBy === "psm") list = [...list].sort((a, b) => b.pricePerSqm - a.pricePerSqm);
    return list.slice(0, 50);
  }, [records, segment, sortBy]);

  return (
    <section className="bg-white rounded-3xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-4 border-b border-neutral-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-bold text-neutral-900">🏙️ Private Property Transactions</h2>
            <p className="text-xs text-neutral-400 mt-0.5">Singapore condos · last 300 transactions</p>
          </div>
          {!loading && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border shrink-0 ${
              error
                ? "bg-red-50 border-red-200 text-red-500"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
            }`}>
              {error ? "⚠ Error" : `🟢 ${source}`}
            </span>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && <Skeleton />}

      {/* Error */}
      {!loading && error && (
        <div className="px-4 py-6">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-red-700 mb-1">Failed to load data</p>
            <p className="text-xs text-red-500 font-mono break-all">{error}</p>
            <p className="text-xs text-neutral-500 mt-2">
              Source: data.gov.sg — resource 42ff9c2b-3a03-4c8c-9e4c-9e7f5c1b0cbb
            </p>
          </div>
        </div>
      )}

      {/* Data */}
      {!loading && !error && records.length > 0 && (
        <>
          {/* Trend chart */}
          <div className="px-4 sm:px-5 pt-4 pb-2">
            <PriceTrendChart records={segment ? filtered : records} />
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 divide-x divide-neutral-100 border-t border-neutral-100 mb-0">
            {(["OCR", "RCR", "CCR"] as const).map((seg) => {
              const segRecs = records.filter((r) => r.marketSegment === seg);
              if (!segRecs.length) return null;
              const avgPsm = Math.round(
                segRecs.reduce((s, r) => s + r.pricePerSqm, 0) / segRecs.length
              );
              return (
                <div key={seg} className="px-3 py-2.5 text-center">
                  <p className="text-xs font-semibold text-neutral-400">{seg}</p>
                  <p className="text-sm font-bold text-neutral-900 mt-0.5">S${fmt(avgPsm)}</p>
                  <p className="text-xs text-neutral-400">avg $/sqm</p>
                </div>
              );
            })}
          </div>

          {/* Filters */}
          <div className="px-4 py-3 border-t border-neutral-100 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-neutral-500">Segment:</span>
            {(["", "OCR", "RCR", "CCR"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSegment(s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  segment === s
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "border-neutral-200 text-neutral-500 hover:border-neutral-300"
                }`}
              >
                {s || "All"}
              </button>
            ))}
            <div className="ml-auto flex gap-1.5 flex-wrap items-center">
              <span className="text-xs font-semibold text-neutral-500">Sort:</span>
              {([["date", "Latest"], ["price", "Price ↓"], ["psm", "$/sqm ↓"]] as const).map(
                ([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setSortBy(val)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      sortBy === val
                        ? "bg-neutral-900 text-white border-neutral-900"
                        : "border-neutral-200 text-neutral-500 hover:border-neutral-300"
                    }`}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-xs">
              <thead>
                <tr className="bg-slate-50 border-t border-b border-neutral-100">
                  <th className="text-left px-4 py-2.5 font-semibold text-neutral-500">Project</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-neutral-500">Seg</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-neutral-500">D</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-neutral-500 whitespace-nowrap">Price</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-neutral-500">sqm</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-neutral-500 whitespace-nowrap">$/sqm</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-neutral-500">Tenure</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-neutral-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap max-w-[160px] truncate">
                      {r.projectName}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${SEG_COLOR[r.marketSegment] ?? ""}`}>
                        {r.marketSegment}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-neutral-500">{r.district}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                      {fmtM(r.price)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{r.areaSqm}</td>
                    <td className="px-3 py-2.5 text-right text-slate-700 font-medium whitespace-nowrap">
                      S${fmt(r.pricePerSqm)}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-500 whitespace-nowrap max-w-[100px] truncate" title={r.tenure}>
                      {r.tenure}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-400 whitespace-nowrap">{r.transactionDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-50 text-xs text-neutral-400 flex flex-wrap justify-between gap-1">
            <span>Showing {filtered.length} of {records.length} transactions</span>
            <span>Source: data.gov.sg · resource 42ff9c2b</span>
          </div>
        </>
      )}
    </section>
  );
}
