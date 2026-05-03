"use client";

import { useState } from "react";
import type { UpgradeOption } from "@/lib/calculator";
import type { HdbResaleRecord } from "@/lib/dbQueries";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("en-SG"); }
function fmtShort(n: number) {
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${(n / 1_000).toFixed(0)}K`;
}

// ── types ─────────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  project:       string;
  street:        string;
  tenure:        string;
  marketSegment: string;
  minPrice:      number;
  maxPrice:      number;
  medianPsm:     number;
  txCount:       number;
  latestDate:    string;
  minSqm?:       number;
  maxSqm?:       number;
}

export interface EcOption {
  name:     string;
  price:    number;
  location: string;
  bedrooms: string;
}

// ── Bedroom type filter helpers ───────────────────────────────────────────────

const BR_DEFS = [
  { id: "1BR", label: "1 Bed",  min: 0,   max: 54  },
  { id: "2BR", label: "2 Bed",  min: 55,  max: 79  },
  { id: "3BR", label: "3 Bed",  min: 80,  max: 114 },
  { id: "4BR", label: "4 Bed+", min: 115, max: 999 },
] as const;
type BrId = "1BR" | "2BR" | "3BR" | "4BR";

function defaultBrFromChildren(n: number): BrId {
  return n >= 1 ? "3BR" : "2BR";
}

function isFamilyBr(br: BrId) { return br === "3BR" || br === "4BR"; }

function projectHasBr(minSqm: number, maxSqm: number, br: BrId): boolean {
  const def = BR_DEFS.find((d) => d.id === br);
  if (!def) return true;
  return minSqm <= def.max && maxSqm >= def.min;
}

function ecHasBr(bedrooms: string, br: BrId): boolean {
  const numRe = /(\d)/g;
  const nums = [...bedrooms.matchAll(numRe)].map((m) => Number(m[1]));
  if (!nums.length) return true;
  const low = Math.min(...nums); const high = Math.max(...nums);
  const brNum = br === "1BR" ? 1 : br === "2BR" ? 2 : br === "3BR" ? 3 : 4;
  return brNum >= low && brNum <= high;
}

function familyFitLabel(br: BrId, numChildren: number): { text: string; color: string } | null {
  if (numChildren === 0) return null;
  if (br === "4BR") return { text: "✓ Spacious for family", color: "text-emerald-400" };
  if (br === "3BR") return { text: "✓ Recommended for your family", color: "text-emerald-400" };
  if (br === "2BR") return { text: "⚠ Possible but tight", color: "text-amber-400" };
  return { text: "⚡ Investment only", color: "text-slate-500" };
}

interface Props {
  options:            UpgradeOption[];
  optionScores:       number[];
  recommendation:     string;
  currentMarketValue: number;
  netProceeds:        number;
  privateBudget:      number;
  biggerHdbListings:  HdbResaleRecord[];
  nextFlatType:       string | null;
  ecListings:         EcOption[];
  privateListings:    ProjectSummary[];
  userTown:           string;
  userSegment:        string;
  numChildren:        number;
}

// ── ScoreGauge ────────────────────────────────────────────────────────────────

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
        <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ} strokeDashoffset={dash}
          strokeLinecap="round" transform="rotate(-90 20 20)" />
        <text x="20" y="24" textAnchor="middle" fontSize="9" fontWeight="bold" fill={color}>{score}</text>
      </svg>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Listing panels ────────────────────────────────────────────────────────────

function StayPanel({ marketValue, netProceeds }: { marketValue: number; netProceeds: number }) {
  return (
    <div className="py-4 text-center space-y-3">
      <p className="text-3xl">🏠</p>
      <p className="text-sm font-bold text-slate-300">You already own this flat</p>
      <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
        Your equity is S${fmt(marketValue)} and you would pocket S${fmt(netProceeds)} net after costs if you sell today.
        Staying means zero transaction costs and continued appreciation.
      </p>
      <div className="flex justify-center gap-6 pt-2">
        {[
          { label: "Current Value", value: `S$${fmt(marketValue)}` },
          { label: "Net if Sold",   value: `S$${fmt(netProceeds)}`  },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-[9px] text-slate-600 uppercase tracking-widest">{label}</p>
            <p className="text-base font-black text-emerald-400">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BiggerHdbPanel({
  listings, nextFlatType, userTown,
}: {
  listings: HdbResaleRecord[];
  nextFlatType: string | null;
  userTown: string;
}) {
  if (!nextFlatType) {
    return (
      <p className="text-slate-500 text-xs text-center py-6">
        Executive flat is the largest HDB type — no bigger HDB tier available.
      </p>
    );
  }
  if (!listings.length) {
    return (
      <p className="text-slate-500 text-xs text-center py-6">
        No recent {nextFlatType} transactions found in {userTown || "your area"}.
        Enter a postal code for live data.
      </p>
    );
  }
  return (
    <div>
      <p className="text-[10px] text-slate-500 mb-3">
        Recent <span className="font-semibold text-slate-300">{nextFlatType}</span> resale transactions
        in <span className="font-semibold text-slate-300">{userTown || "your area"}</span>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {listings.slice(0, 8).map((t, i) => (
          <div key={i} className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
            <p className="text-[10px] font-bold text-slate-200 truncate">
              Blk {t.block} {t.streetName.split(" ").slice(0, 3).join(" ")}
            </p>
            <p className="text-base font-black text-emerald-400 mt-1">{fmtShort(t.resalePrice)}</p>
            <p className="text-[9px] text-slate-500 mt-0.5">S${fmt(t.pricePerSqm)}/sqm</p>
            <div className="flex flex-wrap gap-1 mt-2">
              <span className="text-[8px] bg-slate-700 text-slate-400 rounded-full px-1.5 py-0.5">
                {t.storeyRange.replace(" TO ", "–")}
              </span>
              <span className="text-[8px] bg-slate-700 text-slate-400 rounded-full px-1.5 py-0.5">
                {t.sqm} sqm
              </span>
              <span className="text-[8px] bg-slate-700 text-slate-400 rounded-full px-1.5 py-0.5">
                {t.month}
              </span>
            </div>
            {t.remainingLease > 0 && (
              <p className="text-[9px] mt-1.5 font-medium"
                style={{ color: t.remainingLease >= 70 ? "#10b981" : t.remainingLease >= 60 ? "#f59e0b" : "#ef4444" }}>
                {t.remainingLease} yrs lease
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-700 mt-2">
        Source: data.gov.sg HDB Resale · Same town as your current flat
      </p>
    </div>
  );
}

function EcPanel({
  listings, budget, numChildren, defaultBr,
}: {
  listings: EcOption[];
  budget: number;
  numChildren: number;
  defaultBr: BrId;
}) {
  const [selectedBr, setSelectedBr] = useState<BrId>(defaultBr);
  const [showSmaller, setShowSmaller] = useState(false);

  const familyBrs: BrId[] = ["3BR", "4BR"];
  const smallBrs: BrId[] = ["1BR", "2BR"];
  const visibleBrs = showSmaller ? [...familyBrs, ...smallBrs] : familyBrs;

  const shown = listings.filter((ec) => ecHasBr(ec.bedrooms, selectedBr));

  return (
    <div>
      <p className="text-[10px] text-slate-500 mb-3">
        Executive Condominium projects — income ceiling S$16,000 · HDB loan eligible first 10 years
      </p>

      {/* Bedroom filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[9px] text-slate-600 font-semibold uppercase tracking-widest">Bedrooms:</span>
        <div className="flex gap-1 flex-wrap">
          {visibleBrs.map((br) => {
            const isFamily = isFamilyBr(br);
            const isSelected = selectedBr === br;
            return (
              <button key={br} onClick={() => setSelectedBr(br)}
                className={`text-[9px] px-2 py-1 rounded-full border transition-colors flex items-center gap-1 ${
                  isSelected
                    ? isFamily
                      ? "bg-emerald-400 text-slate-900 border-emerald-400 font-bold"
                      : "bg-slate-200 text-slate-900 border-slate-200 font-bold"
                    : "border-slate-700 text-slate-500 hover:border-slate-500"
                }`}>
                {BR_DEFS.find((d) => d.id === br)?.label}
                {isFamily && numChildren > 0 && (
                  <span className={isSelected ? "text-slate-700" : "text-emerald-400"}>★</span>
                )}
              </button>
            );
          })}
        </div>
        {!showSmaller && (
          <button onClick={() => setShowSmaller(true)}
            className="text-[9px] text-slate-600 hover:text-slate-400 underline ml-1">
            + smaller units
          </button>
        )}
      </div>

      {numChildren > 0 && isFamilyBr(selectedBr) && (
        <div className="mb-3 flex items-center gap-1.5 text-[9px] text-emerald-400">
          <span>★</span>
          <span className="font-semibold">Recommended for your family</span>
        </div>
      )}
      {numChildren > 0 && !isFamilyBr(selectedBr) && (
        <div className="mb-3 flex items-center gap-1.5 text-[9px] text-amber-400">
          <span>⚠</span>
          <span>Smaller units — better for investment or comparison</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(shown.length ? shown : listings).map((ec) => {
          const affordable = ec.price <= budget;
          return (
            <div key={ec.name}
              className={`rounded-xl p-3 border ${
                affordable
                  ? "bg-emerald-900/20 border-emerald-700/40"
                  : "bg-slate-800/40 border-slate-700/50"
              }`}
            >
              <p className="text-[10px] font-bold text-slate-200 leading-tight">{ec.name}</p>
              <p className="text-base font-black text-emerald-400 mt-1.5">{fmtShort(ec.price)}</p>
              <p className="text-[9px] text-slate-500 mt-0.5">{ec.bedrooms}</p>
              <p className="text-[9px] text-slate-600">{ec.location}</p>
              {affordable ? (
                <span className="inline-block mt-2 text-[8px] bg-emerald-400 text-slate-900 font-bold px-1.5 py-0.5 rounded-full">
                  ✓ Within budget
                </span>
              ) : (
                <span className="inline-block mt-2 text-[8px] bg-amber-900/40 text-amber-400 font-bold px-1.5 py-0.5 rounded-full">
                  ⚠ Over budget
                </span>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="col-span-4 text-slate-600 text-xs text-center py-4">
            No EC projects match this bedroom type.
          </p>
        )}
      </div>
      <p className="text-[9px] text-slate-700 mt-2">
        EC pricing indicative. Must not own / have disposed of private property in last 30 months.
      </p>
    </div>
  );
}

function PrivateCondoPanel({
  listings, userTown, userSegment, budget, numChildren, defaultBr,
}: {
  listings:    ProjectSummary[];
  userTown:    string;
  userSegment: string;
  budget:      number;
  numChildren: number;
  defaultBr:   BrId;
}) {
  const [segFilter, setSegFilter] = useState<string>(userSegment);
  const [selectedBr, setSelectedBr] = useState<BrId>(defaultBr);
  const [showSmaller, setShowSmaller] = useState(false);

  const familyBrs: BrId[] = ["3BR", "4BR"];
  const smallBrs: BrId[] = ["1BR", "2BR"];
  const visibleBrs = showSmaller ? [...familyBrs, ...smallBrs] : familyBrs;

  const segFiltered = listings.filter((p) => !segFilter || p.marketSegment === segFilter);
  const brFiltered = segFiltered.filter((p) =>
    p.minSqm !== undefined && p.maxSqm !== undefined
      ? projectHasBr(p.minSqm, p.maxSqm, selectedBr)
      : true
  );
  const shown = brFiltered.slice(0, 9);

  // Affordability fallback: check if any 3BR project is within budget
  const familyAffordable = segFiltered.some((p) => p.minPrice <= budget && isFamilyBr(selectedBr));
  const showFallbackHint = numChildren > 0 && isFamilyBr(selectedBr) && !familyAffordable && segFiltered.length > 0;

  const fit = numChildren > 0 ? familyFitLabel(selectedBr, numChildren) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-[10px] text-slate-500">
          Private condos near <span className="font-semibold text-slate-300">{userTown || "your area"}</span>
        </p>
        <div className="ml-auto flex gap-1">
          {(["OCR", "RCR", "CCR"] as const).map((seg) => (
            <button key={seg} onClick={() => setSegFilter(seg)}
              className={`text-[9px] px-2 py-0.5 rounded-full border transition-colors ${
                segFilter === seg
                  ? "bg-slate-100 text-slate-900 border-slate-100 font-bold"
                  : "border-slate-700 text-slate-500 hover:border-slate-500"
              }`}
            >
              {seg}
            </button>
          ))}
        </div>
      </div>

      {/* Bedroom filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[9px] text-slate-600 font-semibold uppercase tracking-widest">Bedrooms:</span>
        <div className="flex gap-1 flex-wrap">
          {visibleBrs.map((br) => {
            const isFamily = isFamilyBr(br);
            const isSelected = selectedBr === br;
            return (
              <button key={br} onClick={() => setSelectedBr(br)}
                className={`text-[9px] px-2 py-1 rounded-full border transition-colors flex items-center gap-1 ${
                  isSelected
                    ? isFamily
                      ? "bg-emerald-400 text-slate-900 border-emerald-400 font-bold"
                      : "bg-slate-200 text-slate-900 border-slate-200 font-bold"
                    : "border-slate-700 text-slate-500 hover:border-slate-500"
                }`}>
                {BR_DEFS.find((d) => d.id === br)?.label}
                {isFamily && numChildren > 0 && (
                  <span className={isSelected ? "text-slate-700" : "text-emerald-400"}>★</span>
                )}
              </button>
            );
          })}
        </div>
        {!showSmaller && (
          <button onClick={() => setShowSmaller(true)}
            className="text-[9px] text-slate-600 hover:text-slate-400 underline ml-1">
            + smaller units
          </button>
        )}
      </div>

      {/* Family fit label */}
      {fit && (
        <div className={`mb-2 text-[9px] font-semibold ${fit.color}`}>
          {fit.text}
        </div>
      )}

      {/* Affordability fallback */}
      {showFallbackHint && (
        <div className="mb-3 flex items-start gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
          <span className="text-amber-400 text-sm leading-none shrink-0">💡</span>
          <p className="text-[9px] text-amber-300 leading-relaxed">
            Based on your finances, <strong>2BR may be more realistic</strong> for private property.
            3BR options shown below for comparison.
          </p>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-slate-600 text-xs text-center py-6">
          No {segFilter} transactions match this bedroom size. Try another segment or bedroom type.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shown.map((p) => {
            const affordable = p.minPrice <= budget;
            const brFit = numChildren > 0 ? familyFitLabel(selectedBr, numChildren) : null;
            return (
              <div key={p.project}
                className={`rounded-xl p-3 border ${
                  affordable
                    ? "bg-slate-800/60 border-slate-700/50"
                    : "bg-slate-800/30 border-slate-800"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[10px] font-bold text-slate-200 leading-tight">{p.project}</p>
                  <span className={`text-[8px] shrink-0 px-1.5 py-0.5 rounded-full font-semibold ${
                    p.marketSegment === "OCR" ? "bg-emerald-900/40 text-emerald-400"
                    : p.marketSegment === "RCR" ? "bg-amber-900/40 text-amber-400"
                    : "bg-purple-900/40 text-purple-400"
                  }`}>
                    {p.marketSegment}
                  </span>
                </div>
                <p className="text-[9px] text-slate-600 truncate mt-0.5">{p.street}</p>
                <p className="text-base font-black text-emerald-400 mt-1.5">
                  {fmtShort(p.minPrice)}
                  {p.maxPrice > p.minPrice && (
                    <span className="text-[10px] font-normal text-slate-400"> – {fmtShort(p.maxPrice)}</span>
                  )}
                </p>
                <p className="text-[9px] text-slate-500">S${fmt(p.medianPsm)}/sqm</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="text-[8px] bg-slate-700/60 text-slate-400 rounded-full px-1.5 py-0.5">
                    {p.tenure.includes("Freehold") ? "Freehold" : p.tenure.includes("999") ? "999-yr" : "99-yr"}
                  </span>
                  <span className="text-[8px] bg-slate-700/60 text-slate-400 rounded-full px-1.5 py-0.5">
                    {p.txCount} txn{p.txCount !== 1 ? "s" : ""}
                  </span>
                </div>
                {brFit && (
                  <p className={`text-[8px] mt-1.5 font-medium ${brFit.color}`}>{brFit.text}</p>
                )}
                {affordable ? (
                  <span className="inline-block mt-1.5 text-[8px] bg-emerald-400 text-slate-900 font-bold px-1.5 py-0.5 rounded-full">
                    ✓ Within budget
                  </span>
                ) : (
                  <span className="inline-block mt-1.5 text-[8px] bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded-full">
                    Above budget
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[9px] text-slate-700 mt-2">
        Source: URA / data.gov.sg · Last 3 years · Filtered by {segFilter} (your area&apos;s market segment)
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UpgradeOptionsPanel({
  options, optionScores, recommendation,
  currentMarketValue, netProceeds, privateBudget,
  biggerHdbListings, nextFlatType,
  ecListings, privateListings,
  userTown, userSegment, numChildren,
}: Props) {
  const [selected, setSelected] = useState<string>(recommendation);
  const defaultBr = defaultBrFromChildren(numChildren);

  const selectedIdx = options.findIndex((o) => o.type === selected);
  const selectedScore = optionScores[selectedIdx] ?? 0;

  return (
    <section className="bg-[#161b22] rounded-xl border border-slate-800 overflow-hidden">

      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
          2.&nbsp; Upgrade Options Comparison
        </p>
        <p className="text-[9px] text-slate-600">Click any option to see available listings ↓</p>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-3 text-slate-600 font-semibold w-28 text-[10px]">Metric</th>
              {options.map((opt, i) => (
                <th key={opt.type} onClick={() => setSelected(opt.type)}
                  className={`px-3 py-3 text-center cursor-pointer select-none transition-colors ${
                    selected === opt.type
                      ? "bg-emerald-900/30"
                      : opt.type === recommendation
                      ? "bg-emerald-900/10 hover:bg-emerald-900/20"
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  <p className={`font-bold text-[10px] ${
                    selected === opt.type ? "text-emerald-300" : opt.type === recommendation ? "text-emerald-400" : "text-slate-300"
                  }`}>
                    {opt.label.toUpperCase()}
                  </p>
                  <p className="text-[8px] text-slate-600 mt-0.5">
                    {opt.type === "Stay"         ? "Hold current flat"
                    : opt.type === "Bigger HDB"  ? "Next flat tier"
                    : opt.type === "EC"          ? "Exec. Condo"
                    :                             "Freehold / 99yr"}
                  </p>
                  {opt.type === recommendation && (
                    <span className={`inline-block mt-1 text-[8px] font-black px-1.5 py-0.5 rounded-full ${
                      selected === opt.type ? "bg-emerald-400 text-slate-900" : "bg-emerald-900/40 text-emerald-300"
                    }`}>
                      ★ BEST
                    </span>
                  )}
                  {selected === opt.type && (
                    <span className="block mt-0.5 text-[8px] text-emerald-400">▼ listings</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">

            {/* Price Range */}
            <tr>
              <td className="px-4 py-2.5 text-slate-500 text-[10px]">Price Range</td>
              {options.map((opt) => (
                <td key={opt.type} onClick={() => setSelected(opt.type)}
                  className={`px-3 py-2.5 text-center cursor-pointer transition-colors ${selected === opt.type ? "bg-emerald-900/15" : "hover:bg-slate-800/20"}`}
                >
                  <span className="font-semibold text-slate-200">
                    {opt.type === "Stay"
                      ? fmtShort(currentMarketValue)
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
              {options.map((opt) => (
                <td key={opt.type} onClick={() => setSelected(opt.type)}
                  className={`px-3 py-2.5 text-center cursor-pointer transition-colors ${selected === opt.type ? "bg-emerald-900/15" : "hover:bg-slate-800/20"}`}
                >
                  <span className="text-slate-300 text-[10px]">{opt.monthlyRepayment}</span>
                </td>
              ))}
            </tr>

            {/* Affordability */}
            <tr>
              <td className="px-4 py-2.5 text-slate-500 text-[10px]">Affordability</td>
              {options.map((opt) => (
                <td key={opt.type} onClick={() => setSelected(opt.type)}
                  className={`px-3 py-2.5 text-center cursor-pointer transition-colors ${selected === opt.type ? "bg-emerald-900/15" : "hover:bg-slate-800/20"}`}
                >
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
              {options.map((opt) => (
                <td key={opt.type} onClick={() => setSelected(opt.type)}
                  className={`px-3 py-2.5 text-center cursor-pointer transition-colors ${selected === opt.type ? "bg-emerald-900/15" : "hover:bg-slate-800/20"}`}
                >
                  <span className="text-slate-400 text-[10px]">
                    {opt.type === "Stay" || opt.costs.total === 0 ? "—" : fmtShort(opt.costs.total)}
                  </span>
                </td>
              ))}
            </tr>

            {/* Key Advantage */}
            <tr>
              <td className="px-4 py-2.5 text-slate-500 text-[10px]">Key Advantage</td>
              {options.map((opt) => (
                <td key={opt.type} onClick={() => setSelected(opt.type)}
                  className={`px-3 py-2.5 text-center cursor-pointer transition-colors ${selected === opt.type ? "bg-emerald-900/15" : "hover:bg-slate-800/20"}`}
                >
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
              {options.map((opt, i) => (
                <td key={opt.type} onClick={() => setSelected(opt.type)}
                  className={`px-3 py-3 cursor-pointer transition-colors ${selected === opt.type ? "bg-emerald-900/15" : "hover:bg-slate-800/20"}`}
                >
                  <div className="flex justify-center">
                    <ScoreGauge score={optionScores[i]} />
                  </div>
                </td>
              ))}
            </tr>

          </tbody>
        </table>
      </div>

      {/* Listings panel */}
      <div className="border-t border-slate-700/60 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 rounded-full bg-emerald-400" />
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Available Options · {options.find((o) => o.type === selected)?.label ?? selected}
          </p>
          {selectedScore > 0 && (
            <span className="ml-auto text-[9px] text-slate-500">
              Score: <span className="font-bold text-slate-300">{selectedScore}/100</span>
            </span>
          )}
        </div>

        {selected === "Stay" && (
          <StayPanel marketValue={currentMarketValue} netProceeds={netProceeds} />
        )}
        {selected === "Bigger HDB" && (
          <BiggerHdbPanel listings={biggerHdbListings} nextFlatType={nextFlatType} userTown={userTown} />
        )}
        {selected === "EC" && (
          <EcPanel
            listings={ecListings}
            budget={privateBudget}
            numChildren={numChildren}
            defaultBr={defaultBr}
          />
        )}
        {selected === "Private Condo" && (
          <PrivateCondoPanel
            listings={privateListings}
            userTown={userTown}
            userSegment={userSegment}
            budget={privateBudget}
            numChildren={numChildren}
            defaultBr={defaultBr}
          />
        )}
      </div>

    </section>
  );
}
