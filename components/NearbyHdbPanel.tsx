"use client";

import { useState, useMemo } from "react";
import type { HdbResaleRecord } from "@/lib/dbQueries";

interface Props {
  transactions:      HdbResaleRecord[];
  myFlatType:        string;
  myFloor:           number;
  mySqm:             number;
  myRemainingLease?: number;
  source:            "live" | "mock";
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number)  { return n.toLocaleString("en-SG"); }
function fmtK(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function storeyMidpoint(range: string): number {
  const m = range.match(/(\d+)\s+TO\s+(\d+)/i);
  return m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : 0;
}

// Lease bands — group properties by remaining lease so comparisons are fair
type LeaseBand = "90+" | "80–90" | "70–80" | "60–70" | "<60";

function getBand(years: number): LeaseBand {
  if (years >= 90) return "90+";
  if (years >= 80) return "80–90";
  if (years >= 70) return "70–80";
  if (years >= 60) return "60–70";
  return "<60";
}

const BAND_ORDER: LeaseBand[] = ["90+", "80–90", "70–80", "60–70", "<60"];

const BAND_COLOR: Record<LeaseBand, string> = {
  "90+":   "bg-emerald-100 text-emerald-700",
  "80–90": "bg-teal-100 text-teal-700",
  "70–80": "bg-amber-100 text-amber-700",
  "60–70": "bg-orange-100 text-orange-700",
  "<60":   "bg-red-100 text-red-600",
};

const BAND_RING: Record<LeaseBand, string> = {
  "90+":   "bg-slate-900 text-white border-slate-900",
  "80–90": "bg-slate-900 text-white border-slate-900",
  "70–80": "bg-slate-900 text-white border-slate-900",
  "60–70": "bg-slate-900 text-white border-slate-900",
  "<60":   "bg-slate-900 text-white border-slate-900",
};

// ── Trend chart ──────────────────────────────────────────────────────────────

function PriceTrendChart({ transactions }: { transactions: HdbResaleRecord[] }) {
  const byQ: Map<string, number[]> = new Map();
  for (const t of transactions) {
    const [y, m] = t.month.split("-");
    const q = `${y}-Q${Math.ceil(Number(m) / 3)}`;
    if (!byQ.has(q)) byQ.set(q, []);
    byQ.get(q)!.push(t.pricePerSqm);
  }
  const quarters = Array.from(byQ.keys()).sort().slice(-8);
  if (quarters.length < 2) return null;

  const values = quarters.map((q) => median(byQ.get(q)!));
  const minV = Math.min(...values) * 0.94;
  const maxV = Math.max(...values) * 1.04;
  const range = maxV - minV || 1;

  const W = 480; const H = 120;
  const PL = 44; const PR = 8; const PT = 8; const PB = 24;
  const cW = W - PL - PR; const cH = H - PT - PB;
  const barW = cW / quarters.length - 4;
  const x = (i: number) => PL + (i / quarters.length) * cW + barW * 0.1;
  const y = (v: number) => PT + cH - ((v - minV) / range) * cH;
  const ticks = [minV, minV + range / 2, maxV].map(Math.round);

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-slate-500 mb-1">Median $/sqm by Quarter</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PL - 3} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">
              {(v / 1000).toFixed(0)}K
            </text>
          </g>
        ))}
        {quarters.map((q, i) => (
          <g key={q}>
            <rect
              x={x(i)} y={y(values[i])} width={barW}
              height={cH - (y(values[i]) - PT)}
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

// ── Main component ────────────────────────────────────────────────────────────

export default function NearbyHdbPanel({
  transactions,
  myFlatType,
  myFloor,
  mySqm,
  myRemainingLease,
  source,
}: Props) {
  const myBand: LeaseBand | null = myRemainingLease ? getBand(myRemainingLease) : null;

  const [filterType,  setFilterType]  = useState<string>(myFlatType || "");
  const [filterBand,  setFilterBand]  = useState<LeaseBand | "">(myBand ?? "");
  const [sortBy,      setSortBy]      = useState<"date" | "price" | "psm" | "lease">("date");

  const flatTypes = useMemo(() => {
    const s = new Set(transactions.map((t) => t.flatType));
    return Array.from(s).sort();
  }, [transactions]);

  // Lease band summary — only for same flat type
  const bandSummary = useMemo(() => {
    const base = filterType
      ? transactions.filter((t) => t.flatType === filterType)
      : transactions;
    return BAND_ORDER.map((band) => {
      const rows = base.filter((t) => getBand(t.remainingLease) === band);
      if (!rows.length) return null;
      return {
        band,
        count:       rows.length,
        medianPsm:   median(rows.map((t) => t.pricePerSqm)),
        medianPrice: median(rows.map((t) => t.resalePrice)),
      };
    }).filter(Boolean) as { band: LeaseBand; count: number; medianPsm: number; medianPrice: number }[];
  }, [transactions, filterType]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (filterType) list = list.filter((t) => t.flatType === filterType);
    if (filterBand) list = list.filter((t) => getBand(t.remainingLease) === filterBand);

    if (sortBy === "price") list = [...list].sort((a, b) => b.resalePrice - a.resalePrice);
    else if (sortBy === "psm")   list = [...list].sort((a, b) => b.pricePerSqm - a.pricePerSqm);
    else if (sortBy === "lease") list = [...list].sort((a, b) => b.remainingLease - a.remainingLease);
    else list = [...list].sort((a, b) => b.month.localeCompare(a.month));

    return list.slice(0, 40);
  }, [transactions, filterType, filterBand, sortBy]);

  // Stats for the active view
  const activeTx = filterBand
    ? transactions.filter((t) =>
        (!filterType || t.flatType === filterType) && getBand(t.remainingLease) === filterBand
      )
    : transactions.filter((t) => !filterType || t.flatType === filterType);
  const statsMedianPrice = median(activeTx.map((t) => t.resalePrice));
  const statsMedianPsm   = median(activeTx.map((t) => t.pricePerSqm));

  return (
    <section className="bg-white rounded-3xl shadow-sm overflow-hidden">

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

      {/* Stats strip */}
      {activeTx.length > 0 && (
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-slate-400 mb-0.5">Median price</p>
            <p className="font-bold text-slate-900 text-sm">{fmtK(statsMedianPrice)}</p>
            <p className="text-xs text-slate-400">{filterBand ? `${filterBand} yr lease` : "all leases"}</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-slate-400 mb-0.5">Median $/sqm</p>
            <p className="font-bold text-slate-900 text-sm">S${fmt(statsMedianPsm)}</p>
            <p className="text-xs text-slate-400">
              {mySqm > 0 && statsMedianPrice > 0
                ? `your flat ~S${fmt(Math.round(statsMedianPrice / mySqm))}/sqm`
                : "selected band"}
            </p>
          </div>
        </div>
      )}

      {/* Lease band comparison table */}
      {bandSummary.length > 1 && (
        <div className="px-4 pt-4 pb-2">
          <p className="text-xs font-semibold text-slate-500 mb-2">
            Median price by lease band
            {myBand && <span className="ml-1 text-slate-400">(yours: <span className="font-bold text-slate-700">{myBand} yrs</span>)</span>}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {bandSummary.map(({ band, count, medianPsm, medianPrice }) => {
              const isMyBand = band === myBand;
              return (
                <button
                  key={band}
                  onClick={() => setFilterBand(filterBand === band ? "" : band)}
                  className={`text-left rounded-xl p-2.5 border-2 transition-all ${
                    filterBand === band
                      ? "border-slate-900 bg-slate-900"
                      : isMyBand
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-slate-100 bg-slate-50 hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      filterBand === band ? "bg-white/20 text-white" : BAND_COLOR[band]
                    }`}>
                      {band} yrs
                    </span>
                    {isMyBand && filterBand !== band && (
                      <span className="text-[10px] text-emerald-600 font-semibold">← yours</span>
                    )}
                  </div>
                  <p className={`text-sm font-bold leading-tight ${filterBand === band ? "text-white" : "text-slate-900"}`}>
                    {fmtK(medianPrice)}
                  </p>
                  <p className={`text-[10px] mt-0.5 ${filterBand === band ? "text-white/60" : "text-slate-400"}`}>
                    S${fmt(medianPsm)}/sqm · {count} txn
                  </p>
                </button>
              );
            })}
          </div>
          {filterBand && (
            <button
              onClick={() => setFilterBand("")}
              className="mt-2 text-xs text-slate-400 hover:text-slate-600 underline"
            >
              Clear lease filter
            </button>
          )}
        </div>
      )}

      {/* Trend chart */}
      <div className="px-4 pt-3">
        <PriceTrendChart transactions={filterBand ? filtered : (filterType ? transactions.filter(t => t.flatType === filterType) : transactions)} />
      </div>

      {/* Filters */}
      <div className="px-4 pb-3 flex flex-wrap gap-2 items-center border-b border-slate-50">
        <span className="text-xs font-semibold text-slate-500 w-full sm:w-auto">Type:</span>
        <button
          onClick={() => setFilterType("")}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            filterType === ""
              ? "bg-slate-900 text-white border-slate-900"
              : "border-slate-200 text-slate-500 hover:border-slate-300"
          }`}
        >
          All
        </button>
        {flatTypes.map((ft) => (
          <button key={ft} onClick={() => setFilterType(ft)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filterType === ft
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            }`}
          >
            {ft.replace(" ROOM", "-Room").replace("EXECUTIVE", "Executive")}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-semibold text-slate-500">Sort:</span>
          {([["date","Latest"],["price","Price"],["psm","$/sqm"],["lease","Lease ↓"]] as const).map(([val, label]) => (
            <button key={val} onClick={() => setSortBy(val)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                sortBy === val
                  ? "bg-slate-900 text-white border-slate-900"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[580px] text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-semibold text-slate-500">Block / Street</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Type</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Storey</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500">sqm</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500">Price</th>
              <th className="text-right px-3 py-2.5 font-semibold text-slate-500">$/sqm</th>
              <th className="text-center px-3 py-2.5 font-semibold text-slate-500">Lease</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((t, i) => {
              const band = getBand(t.remainingLease);
              const midFloor = storeyMidpoint(t.storeyRange);
              const isSimilarFloor = myFloor > 0 && Math.abs(midFloor - myFloor) <= 3;
              const isSimilarSqm   = mySqm   > 0 && Math.abs(t.sqm - mySqm) <= 10;
              const isSameBand     = !myBand || band === myBand;
              const isComparable   = isSimilarFloor && isSimilarSqm && t.flatType === myFlatType && isSameBand;

              return (
                <tr key={i} className={`transition-colors ${
                  isComparable ? "bg-emerald-50 hover:bg-emerald-100" : "hover:bg-slate-50"
                }`}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-800">{t.block} </span>
                    <span className="text-slate-500">{t.streetName}</span>
                    {isComparable && <span className="ml-1 text-emerald-600 font-bold">★</span>}
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
                    <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold ${BAND_COLOR[band]}`}>
                      {t.remainingLease}y
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{t.month}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-sm text-slate-400 py-8">No transactions found.</p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-50 text-xs text-slate-400 flex flex-wrap justify-between gap-1">
        <span>
          Showing {filtered.length} of {transactions.length} ·
          {myFloor > 0 && mySqm > 0 && " ★ = similar floor, size & lease to yours"}
        </span>
        <span>{source === "live" ? "Source: data.gov.sg" : "Add postal code for live data"}</span>
      </div>
    </section>
  );
}
