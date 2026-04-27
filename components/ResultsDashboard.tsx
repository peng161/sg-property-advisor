"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { UpgradeOption, AssessmentResult } from "@/lib/calculator";
import type { AreaCondoProperty } from "@/app/api/area-condos/route";
import type { HdbResaleRecord } from "@/lib/fetchHdb";
import type { FinancialProfile } from "@/lib/myinfo/types";
import FinancialProfilePanel from "./FinancialProfilePanel";
import UpgradeScorePanel from "./UpgradeScorePanel";

const LeafletMap       = dynamic(() => import("./LeafletMap"),       { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtendedProjectSummary {
  project:       string;
  street:        string;
  tenure:        string;
  marketSegment: "OCR" | "RCR" | "CCR";
  minPrice:      number;
  maxPrice:      number;
  medianPsm:     number;
  txCount:       number;
  latestDate:    string;
  minSqm:        number;
  maxSqm:        number;
  propertyScore:  number;
  trend3Y:        number;
  distanceKm:     number | null;
  projectLat:     number | null;
  projectLng:     number | null;
  remainingLease: number | null;
}

export interface EcSummary {
  name:     string;
  price:    number;
  location: string;
  bedrooms: string;
}

export interface DebugInfo {
  postalCode:             string;
  lat:                    number;
  lng:                    number;
  leaseCommencementYear:  number;
  leaseKnown:             boolean;
  remainingLease:         number;
  hdbTxCount:             number;
  privateProjectCount:    number;
  privateSource:          string;
  hdbSource:              string;
}

export interface DashboardProps {
  assessment:              AssessmentResult;
  optionScores:            number[];
  gainPct:                 number;
  remainingLease:          number;
  leaseKnown:              boolean;
  leaseCommencementYear:   number;
  displayAddress:          string;
  postalCode:              string;
  numChildren:             number;
  lat:                     number;
  lng:                     number;
  flatType:                string;
  town:                    string;
  sqm:                     number;
  purchaseYear:            number;
  purchasePrice:           number;
  remainingLoan:           number;
  sellingFirst:            boolean;
  privateListings:         ExtendedProjectSummary[];
  ecListings:              EcSummary[];
  biggerHdbListings:       HdbResaleRecord[];
  nextFlatType:            string | null;
  sameTypeHdbListings:     HdbResaleRecord[];
  debugInfo:               DebugInfo;
  // Financial profile (from Myinfo session or null)
  initialFinancialProfile: FinancialProfile | null;
  myinfoAvailable:         boolean;
  resultsReturnUrl:        string;
}

// ── Bedroom helpers ───────────────────────────────────────────────────────────

type BrId = "3BR" | "4BR" | "2BR" | "1BR";
const BR_DEFS: { id: BrId; label: string; sqmLow: number; sqmHigh: number }[] = [
  { id: "3BR", label: "3BR", sqmLow: 88,  sqmHigh: 108 },
  { id: "4BR", label: "4BR", sqmLow: 115, sqmHigh: 140 },
  { id: "2BR", label: "2BR", sqmLow: 60,  sqmHigh: 80  },
  { id: "1BR", label: "1BR", sqmLow: 42,  sqmHigh: 55  },
];

function defaultBrFromChildren(n: number): BrId {
  return n >= 1 ? "3BR" : "2BR";
}

function fmt(n: number) { return n.toLocaleString("en-SG"); }
function fmtM(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}
function fmtK(n: number) { return `$${(n / 1000).toFixed(1)}K`; }
function toPsf(psm: number) { return Math.round(psm / 10.764); }

function estimateMortgage(price: number): number {
  const loan = price * 0.75;
  const r = 0.035 / 12;
  const n = 300;
  return Math.round(loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
}

function familySuitability(br: BrId, numChildren: number): { label: string; color: string } {
  if (numChildren === 0) {
    return br === "1BR" ? { label: "Good for Couple", color: "text-emerald-600" } : { label: "Good", color: "text-emerald-600" };
  }
  if (br === "4BR") return { label: "Excellent", color: "text-emerald-600" };
  if (br === "3BR") return numChildren >= 3 ? { label: "Excellent", color: "text-emerald-600" } : { label: "Very Good", color: "text-emerald-600" };
  if (br === "2BR") return numChildren >= 3 ? { label: "Poor", color: "text-red-500" } : { label: "Fair", color: "text-amber-600" };
  return { label: "Not Suitable", color: "text-red-500" };
}

function unitTypeScore(propertyScore: number, br: BrId, numChildren: number): number {
  let adj = 0;
  if (numChildren >= 3) {
    adj = br === "4BR" ? 3 : br === "3BR" ? 5 : br === "2BR" ? -12 : -25;
  } else if (numChildren >= 1) {
    adj = br === "4BR" ? 2 : br === "3BR" ? 5 : br === "2BR" ? -5 : -18;
  }
  return Math.min(Math.max(propertyScore + adj, 20), 99);
}

function starsFor(score: number) {
  const full = score >= 90 ? 5 : score >= 80 ? 4 : score >= 70 ? 4 : score >= 60 ? 3 : 2;
  const half = score >= 75 && score < 80 ? 1 : score >= 65 && score < 70 ? 1 : 0;
  return { full, half, empty: 5 - full - half };
}

// ── Upgrade path config ───────────────────────────────────────────────────────

const UPGRADE_META: Record<string, {
  icon: string;
  bullets: string[];
  bottomLabel: string;
  bottomCls: string;
}> = {
  "Stay": {
    icon: "🏠",
    bullets: ["Lowest financial risk", "No transaction costs", "Opportunity cost of waiting"],
    bottomLabel: "Safest Financially",
    bottomCls: "text-amber-700 bg-amber-50 border-amber-200",
  },
  "Bigger HDB": {
    icon: "🏢",
    bullets: ["More space, lower risk", "Lower monthly repayments", "Long waiting time for BTO"],
    bottomLabel: "Safe & Comfortable",
    bottomCls: "text-emerald-700 bg-emerald-50 border-emerald-200",
  },
  "EC": {
    icon: "🏗️",
    bullets: ["Balanced option", "Subsidy + private living", "May have MOP restrictions"],
    bottomLabel: "Check Eligibility",
    bottomCls: "text-blue-700 bg-blue-50 border-blue-200",
  },
  "Private Condo": {
    icon: "🏙️",
    bullets: ["Better lifestyle & facilities", "Good upside potential", "Higher monthly commitment"],
    bottomLabel: "Best Overall Fit",
    bottomCls: "text-indigo-700 bg-indigo-50 border-indigo-200",
  },
};

// ── ScoreCircle ───────────────────────────────────────────────────────────────

function ScoreCircle({ score, recommended }: { score: number; recommended?: boolean }) {
  const r = 36; const circ = 2 * Math.PI * r;
  const dash = circ - (score / 100) * circ;
  const col = recommended ? "#6366f1" : score >= 75 ? "#10b981" : score >= 60 ? "#f59e0b" : "#9ca3af";
  return (
    <div className="flex flex-col items-center">
      <svg width="88" height="88" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={col} strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={dash}
          strokeLinecap="round" transform="rotate(-90 40 40)" />
        <text x="40" y="36" textAnchor="middle" fontSize="18" fontWeight="bold" fill={col}>{score}</text>
        <text x="40" y="50" textAnchor="middle" fontSize="9" fill="#9ca3af">/100</text>
      </svg>
      <p className="text-[10px] text-slate-400 -mt-1">Suitability Score</p>
    </div>
  );
}

// ── SmallScoreCircle ──────────────────────────────────────────────────────────

function SmallScore({ score }: { score: number }) {
  const r = 22; const circ = 2 * Math.PI * r;
  const dash = circ - (score / 100) * circ;
  const col = score >= 80 ? "#6366f1" : score >= 70 ? "#10b981" : "#f59e0b";
  return (
    <svg width="56" height="56" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={col} strokeWidth="5"
        strokeDasharray={circ} strokeDashoffset={dash}
        strokeLinecap="round" transform="rotate(-90 26 26)" />
      <text x="26" y="23" textAnchor="middle" fontSize="11" fontWeight="bold" fill={col}>{score}</text>
      <text x="26" y="33" textAnchor="middle" fontSize="7" fill="#9ca3af">/100</text>
    </svg>
  );
}

// ── Stars ─────────────────────────────────────────────────────────────────────

function Stars({ score }: { score: number }) {
  const { full, empty } = starsFor(score);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: full }).map((_, i) => (
        <span key={`f${i}`} className="text-amber-400 text-sm">★</span>
      ))}
      {Array.from({ length: empty }).map((_, i) => (
        <span key={`e${i}`} className="text-gray-200 text-sm">★</span>
      ))}
    </div>
  );
}

// ── WhyPanel ──────────────────────────────────────────────────────────────────

function WhyPanel({
  recommendation, numChildren, affordable, gainPct, remainingLease,
}: {
  recommendation: string; numChildren: number; affordable: boolean;
  gainPct: number; remainingLease: number;
}) {
  const reasons: string[] = [];
  if (affordable) reasons.push("Monthly repayment is affordable");
  if (gainPct > 15) reasons.push("Strong capital gain from your current flat");
  reasons.push("Good long-term upside potential");
  if (numChildren > 0) reasons.push(`Better space & facilities for ${numChildren} kid${numChildren !== 1 ? "s" : ""}`);
  if (remainingLease >= 70) reasons.push("Your flat has strong remaining lease");

  const explanations: Record<string, string> = {
    "Private Condo": "You have strong budget headroom for private property and your family will enjoy better living environment, schools and amenities. Monthly mortgage is within a comfortable range.",
    "Bigger HDB": "Upgrading within the HDB market offers more space at a lower financial commitment — a great step for a growing family.",
    "EC": "Executive Condominiums give you the best of both worlds — private condo facilities with an HDB-like price for eligible buyers.",
    "Stay": "Staying put minimises financial risk and lets your flat's value continue to appreciate with no transaction costs.",
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 h-full">
      <h3 className="font-bold text-slate-800 text-sm mb-2">Why {recommendation}?</h3>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        {explanations[recommendation] ?? "Based on your financial profile, this upgrade path offers the best balance of affordability and growth."}
      </p>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Key Considerations</p>
      <div className="space-y-1.5">
        {reasons.map((r) => (
          <div key={r} className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
            <span className="text-xs text-slate-600">{r}</span>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-300 mt-4 pt-3 border-t border-slate-100 leading-relaxed">
        Upgrade path is assessed using affordability, monthly repayment stress, proceeds after sale, family space & facilities, and risk buffer. This is separate from individual property scoring.
      </p>
    </div>
  );
}

// ── UpgradePathCard ───────────────────────────────────────────────────────────

function UpgradePathCard({
  option, score, isRecommended, isSelected, onClick,
}: {
  option: UpgradeOption; score: number; isRecommended: boolean; isSelected: boolean; onClick: () => void;
}) {
  const meta = UPGRADE_META[option.type] ?? UPGRADE_META["Stay"];
  return (
    <div
      onClick={onClick}
      className={`relative bg-white rounded-xl border-2 p-4 cursor-pointer transition-all select-none flex flex-col ${
        isRecommended
          ? "border-indigo-500 shadow-md shadow-indigo-100"
          : isSelected
          ? "border-slate-400"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      {isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap">
          Recommended Path
        </div>
      )}
      <div className="flex flex-col items-center">
        <div className="text-3xl mb-1">{meta.icon}</div>
        <div className="h-9 flex items-center justify-center mb-2">
          <h3 className="font-bold text-slate-800 text-[13px] leading-tight text-center">{option.label}</h3>
        </div>
        <ScoreCircle score={score} recommended={isRecommended} />
      </div>
      <ul className="mt-3 space-y-1.5 flex-1">
        {meta.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-slate-500 leading-tight">
            <span className="mt-0.5 text-slate-300 shrink-0">•</span>
            {b}
          </li>
        ))}
      </ul>
      <div className={`mt-3 text-center text-[11px] font-semibold py-1.5 rounded-lg border ${meta.bottomCls}`}>
        {meta.bottomLabel}
      </div>
    </div>
  );
}

// ── PropertyCard ──────────────────────────────────────────────────────────────

const CARD_COLORS = [
  "from-violet-600 to-indigo-700",
  "from-blue-600 to-indigo-600",
  "from-indigo-600 to-purple-700",
  "from-blue-700 to-blue-900",
  "from-purple-600 to-violet-800",
  "from-teal-600 to-cyan-700",
  "from-indigo-500 to-blue-700",
  "from-violet-500 to-purple-700",
  "from-blue-500 to-cyan-700",
  "from-indigo-600 to-blue-800",
];

function PropertyCard({
  rank, listing, numChildren, defaultBr, budget,
}: {
  rank: number; listing: ExtendedProjectSummary; numChildren: number; defaultBr: BrId; budget: number;
}) {
  const [selectedBr, setSelectedBr] = useState<BrId>(defaultBr);

  const def = BR_DEFS.find((d) => d.id === selectedBr)!;
  const estLow  = Math.round(listing.medianPsm * def.sqmLow);
  const estHigh = Math.round(listing.medianPsm * def.sqmHigh);
  const mortLow  = estimateMortgage(estLow);
  const mortHigh = estimateMortgage(estHigh);
  const suitability = familySuitability(selectedBr, numChildren);
  const utScore = unitTypeScore(listing.propertyScore, selectedBr, numChildren);
  const affordable = estLow <= budget;

  const tenureShort = listing.tenure.includes("Freehold") ? "Freehold"
    : listing.tenure.includes("999") ? "999-yr"
    : listing.tenure.match(/(\d{2,3})-year/) ? listing.tenure.match(/(\d{2,3})-year/)![1] + "-yr"
    : listing.tenure === "Unknown" || !listing.tenure ? "—"
    : "99-yr";

  const tenureCls = listing.tenure.includes("Freehold")
    ? "bg-violet-100 text-violet-700"
    : "bg-emerald-100 text-emerald-700";

  const trend = listing.trend3Y;
  const trendCls = trend >= 0 ? "text-emerald-600" : "text-red-500";

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">

      {/* ── Mobile layout ── */}
      <div className="md:hidden">
        {/* Gradient header band */}
        <div className={`bg-gradient-to-r ${CARD_COLORS[(rank - 1) % CARD_COLORS.length]} px-4 py-3`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 bg-white/25 rounded-lg flex items-center justify-center shrink-0">
                <span className="text-white font-black text-sm">{rank}</span>
              </div>
              <div className="min-w-0">
                <p className="font-bold text-white text-sm leading-tight truncate">{listing.project}</p>
                <p className="text-[10px] text-white/70 truncate">📍 {listing.street}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-black text-white leading-none">{listing.propertyScore}</p>
              <p className="text-[9px] text-white/60">/100</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white">{tenureShort}</span>
            {listing.remainingLease !== null && (
              <span className="text-[10px] text-white/70">{listing.remainingLease} yrs left</span>
            )}
            <span className="text-[10px] text-white/80">{listing.marketSegment}</span>
            {listing.distanceKm !== null && <span className="text-[10px] text-white/80">📍 {listing.distanceKm} km</span>}
            {affordable && <span className="text-[10px] bg-emerald-400/90 text-white font-bold px-2 py-0.5 rounded-full">✓ Within Budget</span>}
          </div>
        </div>

        {/* Key stats grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 p-4 border-b border-slate-100">
          <div>
            <p className="text-[9px] text-slate-400">Est. Price ({selectedBr})</p>
            <p className="text-sm font-bold text-slate-800">{fmtM(estLow)} – {fmtM(estHigh)}</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">Avg PSF</p>
            <p className="text-sm font-bold text-slate-800">${fmt(toPsf(listing.medianPsm))}</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">3Y PSF Trend</p>
            <p className={`text-sm font-bold ${trendCls}`}>{trend >= 0 ? "+" : ""}{trend.toFixed(1)}% {trend >= 0 ? "📈" : "📉"}</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">Est. Monthly Rental</p>
            <p className="text-sm font-bold text-slate-800">{fmtK(mortLow)} – {fmtK(mortHigh)}</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">Size ({selectedBr})</p>
            <p className="text-sm font-bold text-slate-700">{def.sqmLow}–{def.sqmHigh} sqm</p>
          </div>
          <div>
            <p className="text-[9px] text-slate-400">Transactions</p>
            <p className="text-sm font-bold text-slate-700">{listing.txCount} txns</p>
          </div>
        </div>

        {/* Unit type + suitability row */}
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {(["3BR", "4BR", "2BR", "1BR"] as BrId[]).map((br) => {
              const isFamily = br === "3BR" || br === "4BR";
              const isSel = selectedBr === br;
              return (
                <button key={br} onClick={() => setSelectedBr(br)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ${
                    isSel
                      ? isFamily && numChildren > 0 ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-700 text-white border-slate-700"
                      : "border-slate-200 text-slate-500"
                  }`}>
                  {br}
                </button>
              );
            })}
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-sm font-bold ${suitability.color}`}>{suitability.label}</p>
            <p className="text-[9px] text-slate-400">{utScore}/100 score</p>
          </div>
        </div>
      </div>

      {/* ── Desktop layout (unchanged) ── */}
      <div className="hidden md:flex">

        {/* Left: Image placeholder */}
        <div className={`relative w-44 shrink-0 bg-gradient-to-br ${CARD_COLORS[(rank - 1) % CARD_COLORS.length]} flex flex-col items-center justify-center`}>
          <div className="absolute top-2 left-2 w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center">
            <span className="text-white font-black text-sm">{rank}</span>
          </div>
          <div className="text-white text-center px-3">
            <div className="text-4xl mb-2">🏙️</div>
            <p className="text-[10px] font-semibold text-white/80 leading-tight text-center">{listing.marketSegment}</p>
            {listing.distanceKm !== null && <p className="text-[11px] font-bold text-white mt-1">📍 {listing.distanceKm} km</p>}
          </div>
          {affordable && (
            <div className="absolute bottom-2 left-2 right-2 bg-emerald-500/90 text-white text-[9px] font-bold text-center rounded py-0.5">
              ✓ Within Budget
            </div>
          )}
        </div>

        {/* Middle: Details */}
        <div className="flex-1 p-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <h3 className="font-bold text-slate-900 text-base leading-tight">{listing.project}</h3>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tenureCls}`}>{tenureShort}</span>
            {listing.remainingLease !== null && (
              <span className="text-[10px] text-slate-400">{listing.remainingLease} yrs left</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mb-2 flex items-center gap-1"><span>📍</span> {listing.street}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
            <div>
              <p className="text-[9px] text-slate-400">Est. Price Range ({selectedBr})</p>
              <p className="text-sm font-bold text-slate-800">{fmtM(estLow)} – {fmtM(estHigh)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">Avg PSF ({selectedBr})</p>
              <p className="text-sm font-bold text-slate-800">${fmt(toPsf(listing.medianPsm))}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">3Y PSF Trend</p>
              <p className={`text-sm font-bold ${trendCls}`}>{trend >= 0 ? "+" : ""}{trend.toFixed(1)}% {trend >= 0 ? "📈" : "📉"}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">Transactions (3yr)</p>
              <p className="text-sm font-bold text-slate-700">{listing.txCount} txns</p>
            </div>
            {listing.distanceKm !== null && (
              <div>
                <p className="text-[9px] text-slate-400">Distance from Home</p>
                <p className="text-sm font-bold text-indigo-600">📍 {listing.distanceKm} km</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Score + unit type + quick stats */}
        <div className="w-52 shrink-0 border-l border-slate-100 p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SmallScore score={listing.propertyScore} />
            <div>
              <p className="text-[9px] text-slate-400">Project Score</p>
              <Stars score={listing.propertyScore} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-widest">Select Unit Type</p>
              {numChildren > 0 && <span className="text-[8px] bg-emerald-100 text-emerald-700 font-semibold px-1.5 py-0.5 rounded-full">Recommended</span>}
            </div>
            <div className="flex gap-1 flex-wrap">
              {(["3BR", "4BR", "2BR", "1BR"] as BrId[]).map((br) => {
                const isFamily = br === "3BR" || br === "4BR";
                const isSelected = selectedBr === br;
                return (
                  <button key={br} onClick={() => setSelectedBr(br)}
                    className={`text-[10px] px-2 py-0.5 rounded border font-semibold transition-colors ${
                      isSelected
                        ? isFamily && numChildren > 0 ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-700 text-white border-slate-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-400"
                    }`}>
                    {br}
                  </button>
                );
              })}
            </div>
            {numChildren > 0 && <p className="text-[9px] text-slate-400 mt-1">✓ Recommended: 3BR or 4BR</p>}
          </div>
          <div className="bg-slate-50 rounded-lg p-2 space-y-1 text-[10px] flex-1">
            <p className="font-semibold text-slate-600 text-[9px] uppercase tracking-wide mb-1.5">Quick Stats ({selectedBr})</p>
            {[
              { label: "Est. Size", value: `${def.sqmLow} – ${def.sqmHigh} sqm` },
              { label: "Avg PSF", value: `$${fmt(toPsf(listing.medianPsm))}` },
              { label: "Est. Monthly Rental", value: `${fmtK(mortLow)} – ${fmtK(mortHigh)}` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between">
                <span className="text-slate-400">{label}</span>
                <span className="font-semibold text-slate-700">{value}</span>
              </div>
            ))}
            <div className="flex justify-between">
              <span className="text-slate-400">Suitability for Family</span>
              <span className={`font-bold ${suitability.color}`}>{suitability.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Unit Type Score ({selectedBr})</span>
              <span className="font-bold text-slate-700">{utScore}/100</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CompactListRow ────────────────────────────────────────────────────────────

function CompactListRow({
  rank, listing, numChildren, defaultBr, budget, isSelected, onSelect,
}: {
  rank: number; listing: ExtendedProjectSummary; numChildren: number; defaultBr: BrId;
  budget: number; isSelected: boolean; onSelect: () => void;
}) {
  const [selectedBr, setSelectedBr] = useState<BrId>(defaultBr);
  const def        = BR_DEFS.find((d) => d.id === selectedBr)!;
  const estLow     = Math.round(listing.medianPsm * def.sqmLow);
  const estHigh    = Math.round(listing.medianPsm * def.sqmHigh);
  const mortLow    = estimateMortgage(estLow);
  const mortHigh   = estimateMortgage(estHigh);
  const affordable  = estLow <= budget;
  const suitability = familySuitability(selectedBr, numChildren);
  const utScore     = unitTypeScore(listing.propertyScore, selectedBr, numChildren);
  const score       = listing.propertyScore;
  const scoreCls    = score >= 80 ? "bg-emerald-500" : score >= 65 ? "bg-amber-500" : "bg-red-500";
  const tenureShort = listing.tenure.includes("Freehold") ? "FH"
    : listing.tenure.includes("999") ? "999yr"
    : listing.tenure === "Unknown" || !listing.tenure ? "—"
    : "99yr";
  const trendCls    = listing.trend3Y >= 0 ? "text-emerald-600" : "text-red-500";

  return (
    <div
      onClick={onSelect}
      className={`border-b border-slate-100 cursor-pointer transition-colors select-none ${
        isSelected
          ? "bg-indigo-50 border-l-4 border-l-indigo-500"
          : "hover:bg-slate-50 border-l-4 border-l-transparent"
      }`}
    >
      {/* Compact row */}
      <div className="px-3 py-3 flex items-center gap-3">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 ${scoreCls}`}>
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 text-sm leading-tight truncate">{listing.project}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {listing.distanceKm !== null && (
              <span className="text-[10px] text-slate-400">📍 {listing.distanceKm} km</span>
            )}
            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{tenureShort}</span>
            {listing.remainingLease !== null && (
              <span className="text-[10px] text-slate-400">{listing.remainingLease} yrs</span>
            )}
            {affordable && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 font-semibold px-1.5 py-0.5 rounded-full">✓ Budget</span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className={`text-[11px] font-black text-white px-2 py-0.5 rounded-lg ${scoreCls}`}>{score}</span>
          {listing.medianPsm > 0 && (
            <span className="text-[9px] text-slate-400">${fmt(toPsf(listing.medianPsm))}/psf</span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {isSelected && (
        <div className="px-3 pb-4 space-y-2.5" onClick={(e) => e.stopPropagation()}>
          {/* BR selector */}
          <div className="flex gap-1.5">
            {(["3BR", "4BR", "2BR", "1BR"] as BrId[]).map((br) => {
              const isFamily = br === "3BR" || br === "4BR";
              return (
                <button key={br} onClick={() => setSelectedBr(br)}
                  className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                    selectedBr === br
                      ? isFamily && numChildren > 0 ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-700 text-white border-slate-700"
                      : "border-slate-200 text-slate-500 bg-white hover:border-slate-400"
                  }`}>
                  {br}
                </button>
              );
            })}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 bg-white rounded-lg p-3 border border-slate-100">
            <div>
              <p className="text-[9px] text-slate-400">Est. Price ({selectedBr})</p>
              <p className="text-sm font-bold text-slate-800">{fmtM(estLow)} – {fmtM(estHigh)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">Avg PSF</p>
              <p className="text-sm font-bold text-slate-800">${fmt(toPsf(listing.medianPsm))}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">3Y PSF Trend</p>
              <p className={`text-sm font-bold ${trendCls}`}>
                {listing.trend3Y >= 0 ? "+" : ""}{listing.trend3Y.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">Est. Monthly</p>
              <p className="text-sm font-bold text-slate-700">{fmtK(mortLow)} – {fmtK(mortHigh)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">Size ({selectedBr})</p>
              <p className="text-sm font-bold text-slate-700">{def.sqmLow}–{def.sqmHigh} sqm</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400">Family Suitability</p>
              <p className={`text-sm font-bold ${suitability.color}`}>{suitability.label}</p>
            </div>
          </div>

          {/* Score + affordability row */}
          <div className="flex items-center justify-between bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-100">
            <div>
              <p className="text-[9px] text-indigo-500 font-semibold">Suitability Score ({selectedBr})</p>
              <p className="text-base font-black text-indigo-700">{utScore}/100</p>
            </div>
            {affordable ? (
              <span className="text-[10px] bg-emerald-500 text-white font-bold px-2.5 py-1 rounded-full">✓ Within Budget</span>
            ) : (
              <span className="text-[10px] bg-slate-200 text-slate-500 font-semibold px-2.5 py-1 rounded-full">Above Budget</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── MapWrapper ────────────────────────────────────────────────────────────────

function MapWrapper({
  lat, lng, postalCode, properties, selectedProject, onSelectProject, bare, radiusM = 1500,
}: {
  lat: number; lng: number; postalCode: string;
  properties: ExtendedProjectSummary[];
  selectedProject: string | null;
  onSelectProject: (project: string) => void;
  bare?: boolean;
  radiusM?: number;
}) {
  const [nearbyCondos, setNearbyCondos] = useState<AreaCondoProperty[]>([]);

  useEffect(() => {
    if (!postalCode) return;
    fetch(`/api/area-condos?query=${encodeURIComponent(postalCode)}&radius=${radiusM}`)
      .then((r) => r.json())
      .then((data) => setNearbyCondos(Array.isArray(data.properties) ? data.properties : []))
      .catch(() => {});
  }, [postalCode, radiusM]);

  const mapEl = (
    <LeafletMap
      lat={lat} lng={lng} postalCode={postalCode}
      properties={properties}
      nearbyCondos={nearbyCondos}
      selectedProject={selectedProject}
      onSelectProject={onSelectProject}
      radiusM={radiusM}
    />
  );

  if (bare) {
    return <div className="w-full h-full" style={{ minHeight: 420 }}>{mapEl}</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col" style={{ minHeight: 420 }}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-800 text-sm">Property Map</p>
          <p className="text-[10px] text-slate-400">
            Your neighbourhood · {(radiusM / 1000).toFixed(1)} km radius
            {nearbyCondos.length > 0 && (
              <span className="ml-2 text-indigo-500 font-semibold">
                · {nearbyCondos.length} condos nearby
              </span>
            )}
          </p>
        </div>
        <div className="text-[9px] text-slate-400 bg-slate-50 rounded px-2 py-1">
          Postal: {postalCode || "—"}
        </div>
      </div>
      <div className="flex-1 relative" style={{ minHeight: 360 }}>
        {mapEl}
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function ResultsDashboard({
  assessment, optionScores, gainPct, remainingLease, leaseKnown, leaseCommencementYear,
  displayAddress, postalCode, numChildren, lat, lng,
  flatType, town, purchaseYear, purchasePrice, remainingLoan, sellingFirst,
  privateListings, ecListings, biggerHdbListings, nextFlatType, sameTypeHdbListings,
  debugInfo, initialFinancialProfile, myinfoAvailable, resultsReturnUrl,
}: DashboardProps) {
  // Filter state
  const [brFilter, setBrFilter] = useState<BrId>(defaultBrFromChildren(numChildren));
  const [tenureFilter, setTenureFilter] = useState<"All" | "99yr" | "999yr" | "Freehold">("All");

  // Property tab selector
  const [propertyTab, setPropertyTab] = useState<"HDB" | "EC" | "Condo">("Condo");

  // Map selected property
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // Section 2 filters
  const [minScoreFilter, setMinScoreFilter] = useState(0);
  const [distanceFilter, setDistanceFilter] = useState<number | "all">(1.5);

  // Mobile menu / filter drawer
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Live DB status — fetched client-side so it reflects actual connection state
  const [dbLive, setDbLive] = useState<{
    connected: boolean; hdbCount: number; privateCount: number; condosNearby: number;
  } | null>(null);

  useEffect(() => {
    const params = lat && lng ? `?lat=${lat}&lng=${lng}` : "";
    fetch(`/api/db-status${params}`)
      .then((r) => r.json())
      .then(setDbLive)
      .catch(() => setDbLive({ connected: false, hdbCount: 0, privateCount: 0, condosNearby: 0 }));
  }, [lat, lng]);

  const defaultBr = defaultBrFromChildren(numChildren);

  const hasCoords = lat > 0 && lng > 0;

  // Private Condo listings — filter then re-rank by score for the visible set.
  // Score already incorporates distance, so rank 1 is always the best condo
  // within the current radius. Changing the radius triggers a full re-rank.
  const displayedListings = propertyTab === "Condo"
    ? privateListings
        .filter((p) => {
          if (tenureFilter !== "All") {
            if (tenureFilter === "Freehold" && !p.tenure.toLowerCase().includes("freehold")) return false;
            if (tenureFilter === "999yr" && !p.tenure.includes("999")) return false;
            if (tenureFilter === "99yr" && (p.tenure.toLowerCase().includes("freehold") || p.tenure.includes("999"))) return false;
          }
          if (minScoreFilter > 0 && p.propertyScore < minScoreFilter) return false;
          if (distanceFilter !== "all" && (p.distanceKm === null || p.distanceKm > distanceFilter)) return false;
          return true;
        })
        .sort((a, b) => b.propertyScore - a.propertyScore)
    : [];

  const today = new Date().toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">

        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-black">SG</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-slate-400 leading-none">Your Home</p>
            <p className="text-sm font-semibold text-slate-800 leading-tight truncate">{displayAddress}</p>
          </div>
          <Link href="/explore" className="shrink-0 text-[10px] text-slate-500 font-semibold">
            Explore
          </Link>
          <Link href="/assessment" className="shrink-0 text-[10px] text-indigo-500 font-semibold">
            ✏ Edit
          </Link>
          <button
            onClick={() => setShowMobileMenu((v) => !v)}
            className="shrink-0 w-9 h-9 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors"
          >
            <span className="text-slate-700 text-base leading-none">{showMobileMenu ? "✕" : "☰"}</span>
          </button>
        </div>

        {/* Desktop header */}
        <div className="hidden md:flex items-center gap-4 px-4 py-3 max-w-[1600px] mx-auto">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-black">SG</span>
            </div>
            <div>
              <p className="font-black text-slate-800 text-xs leading-none">SG Property Advisor</p>
              <p className="text-[9px] text-slate-400 leading-none mt-0.5">Upgrade Smarter. Live Better.</p>
            </div>
          </div>
          <div className="w-px h-8 bg-slate-200 mx-1 shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-slate-400 text-sm shrink-0">📍</span>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-400 leading-none">Your Home</p>
              <p className="text-sm font-semibold text-slate-800 leading-tight truncate">{displayAddress}</p>
            </div>
            <Link href="/assessment" className="ml-1 text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 shrink-0">
              ✏ Edit
            </Link>
          </div>
          <div className="w-px h-8 bg-slate-200 mx-1 shrink-0" />
          <div className="flex items-center gap-5 flex-1 overflow-x-auto">
            {numChildren > 0 && (
              <div className="shrink-0">
                <p className="text-[9px] text-slate-400">Family</p>
                <p className="text-sm font-semibold text-slate-800">{numChildren} Kid{numChildren !== 1 ? "s" : ""}</p>
              </div>
            )}
            <div className="shrink-0">
              <p className="text-[9px] text-slate-400">Monthly Household Income</p>
              <p className="text-sm font-semibold text-slate-800">${fmt(assessment.combinedIncome)}</p>
            </div>
            <div className="shrink-0">
              <p className="text-[9px] text-slate-400">Selling First</p>
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                <span className="text-emerald-500">✓</span> {sellingFirst ? "Yes" : "No"}
              </p>
            </div>
          </div>
          <Link href="/explore"
            className="shrink-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs px-4 py-2 rounded-lg transition-colors">
            Explore Condos
          </Link>
          <Link href="/assessment"
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors">
            Update My Info
          </Link>
        </div>
      </header>

      {/* ── Mobile filter drawer ── */}
      {showMobileMenu && (
        <div className="md:hidden bg-white border-b border-slate-200 shadow-lg z-10">
          <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">

            {/* Property type selector */}
            <div>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Property Type</p>
              <div className="flex gap-2">
                {(["HDB", "EC", "Condo"] as const).map((tab) => (
                  <button key={tab} onClick={() => { setPropertyTab(tab); setShowMobileMenu(false); }}
                    className={`flex-1 text-sm py-2 rounded-xl border font-semibold transition-colors ${
                      propertyTab === tab ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-500"
                    }`}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Min Bedrooms */}
            <div>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Min Bedrooms</p>
              <div className="flex gap-2">
                {(["1BR", "2BR", "3BR", "4BR"] as BrId[]).map((br) => {
                  const isFamily = br === "3BR" || br === "4BR";
                  return (
                    <button key={br} onClick={() => setBrFilter(br)}
                      className={`flex-1 text-sm py-2 rounded-xl border font-semibold transition-colors ${
                        brFilter === br
                          ? isFamily && numChildren > 0 ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-700 text-white border-slate-700"
                          : "border-slate-200 text-slate-500"
                      }`}>
                      {br}
                    </button>
                  );
                })}
              </div>
              {numChildren > 0 && <p className="text-[10px] text-indigo-500 mt-1">★ 3BR/4BR recommended for your family</p>}
            </div>

            {/* Tenure filter */}
            {propertyTab === "Condo" && (
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Tenure</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["All", "99yr", "999yr", "Freehold"] as const).map((t) => {
                    const label = t === "99yr" ? "99-yr" : t === "999yr" ? "999-yr" : t;
                    return (
                      <button key={t} onClick={() => setTenureFilter(t)}
                        className={`py-2 rounded-xl border text-sm font-semibold transition-colors ${
                          tenureFilter === t ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-500"
                        }`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Financial snapshot */}
            <div>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Financial Snapshot</p>
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-2">
                <p className="text-[9px] text-indigo-500 mb-0.5">Est. Current Flat Value</p>
                <p className="text-base font-black text-indigo-700">{fmtM(assessment.currentMarketValue)}</p>
                <p className="text-[9px] text-indigo-400">
                  Capital gain: {assessment.capitalGain >= 0 ? "+" : ""}{fmtM(assessment.capitalGain)}
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                {[
                  { label: "Combined Income", value: `$${fmt(assessment.combinedIncome)}/mo` },
                  { label: "Net Proceeds (Est.)", value: fmtM(assessment.netProceeds) },
                  { label: "Private Budget", value: fmtM(assessment.privateBudget) },
                  { label: "Remaining Lease", value: leaseKnown ? `${remainingLease} yrs` : "≥95 yrs (est.)" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-semibold text-slate-800">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Profile in mobile drawer */}
            <FinancialProfilePanel
              initialProfile={initialFinancialProfile}
              myinfoAvailable={myinfoAvailable}
              currentMarketValue={assessment.currentMarketValue}
              purchasePrice={purchasePrice}
              returnUrl={resultsReturnUrl}
            />

            <Link href="/assessment"
              className="block w-full text-center bg-indigo-600 text-white font-semibold text-sm py-3 rounded-xl">
              Update My Info
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex md:flex-row max-w-[1600px] mx-auto" style={{ minHeight: "calc(100vh - 60px)" }}>

        {/* ── Left sidebar — desktop only ── */}
        <aside className="hidden md:block w-60 shrink-0 bg-white border-r border-slate-200 overflow-y-auto sticky top-[60px] self-start" style={{ maxHeight: "calc(100vh - 60px)" }}>

          {/* Filters */}
          <div className="p-4 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-700 mb-3">Search & Filters</p>

            {/* Min Bedrooms */}
            <div className="mb-3">
              <p className="text-[10px] text-slate-500 mb-1.5">Min Bedrooms</p>
              <div className="flex gap-1">
                {(["1BR", "2BR", "3BR", "4BR"] as BrId[]).map((br) => {
                  const isFamily = br === "3BR" || br === "4BR";
                  return (
                    <button key={br} onClick={() => setBrFilter(br)}
                      className={`flex-1 text-[10px] py-1.5 rounded-lg border font-medium transition-colors ${
                        brFilter === br
                          ? isFamily && numChildren > 0
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-slate-700 text-white border-slate-700"
                          : "border-slate-200 text-slate-500 hover:border-slate-400"
                      }`}>
                      {br}
                    </button>
                  );
                })}
              </div>
              {numChildren > 0 && (
                <p className="text-[9px] text-indigo-500 mt-1">★ 3BR/4BR recommended for your family</p>
              )}
            </div>

            {/* Tenure filter — Condo tab only */}
            {propertyTab === "Condo" && (
              <div className="mb-3">
                <p className="text-[10px] text-slate-500 mb-1.5">Tenure</p>
                <div className="grid grid-cols-2 gap-1">
                  {(["All", "99yr", "999yr", "Freehold"] as const).map((t) => {
                    const label = t === "99yr" ? "99-yr" : t === "999yr" ? "999-yr" : t;
                    return (
                      <button key={t} onClick={() => setTenureFilter(t)}
                        className={`text-[10px] py-1.5 rounded-lg border font-medium transition-colors ${
                          tenureFilter === t
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "border-slate-200 text-slate-500 hover:border-slate-400"
                        }`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Budget range display */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-[10px] text-slate-500">Budget Range</p>
                <p className="text-[10px] font-semibold text-indigo-600">
                  {fmtM(assessment.hdbBudget)} – {fmtM(assessment.privateBudget)}
                </p>
              </div>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: "60%" }} />
              </div>
              <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                <span>$400K</span><span>$2.5M+</span>
              </div>
            </div>
          </div>

          {/* Financial Snapshot */}
          <div className="p-4 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-700 mb-3">My Financial Snapshot</p>
            <div className="space-y-2.5">
              {/* Current flat value highlight */}
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-2">
                <p className="text-[9px] text-indigo-500 mb-0.5">Est. Current Flat Value</p>
                <p className="text-sm font-black text-indigo-700">{fmtM(assessment.currentMarketValue)}</p>
                <p className="text-[9px] text-indigo-400">
                  Capital gain: {assessment.capitalGain >= 0 ? "+" : ""}{fmtM(assessment.capitalGain)}
                </p>
              </div>
              {[
                { label: "Monthly Income (Combined)", value: `$${fmt(assessment.combinedIncome)}` },
                { label: "Remaining Loan (Current)", value: `$${fmt(remainingLoan)}` },
                { label: "Net Proceeds (Est.)", value: fmtM(assessment.netProceeds) },
                { label: "Max Bank Loan", value: fmtM(assessment.maxBankLoan) },
                {
                  label: "Remaining Lease",
                  value: leaseKnown ? `${remainingLease} yrs` : "≥95 yrs (est.)",
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-start">
                  <span className="text-[10px] text-slate-500 leading-tight pr-2">{label}</span>
                  <span className="text-[11px] font-semibold text-slate-800 shrink-0">{value}</span>
                </div>
              ))}
              <div className="pt-1.5 border-t border-slate-100">
                <p className="text-[9px] text-amber-500">ⓘ Estimates only. Actual figures may vary.</p>
              </div>
            </div>
          </div>

          {/* Financial Profile (Myinfo / manual) */}
          <div className="p-4 border-b border-slate-100">
            <FinancialProfilePanel
              initialProfile={initialFinancialProfile}
              myinfoAvailable={myinfoAvailable}
              currentMarketValue={assessment.currentMarketValue}
              purchasePrice={purchasePrice}
              returnUrl={resultsReturnUrl}
            />
          </div>

          {/* Quick links */}
          <div className="p-4">
            <p className="text-xs font-bold text-slate-700 mb-2">Quick Links</p>
            <div className="space-y-1.5">
              {[
                { icon: "📊", label: "How We Calculate" },
                { icon: "🗄️", label: "Data Sources" },
                { icon: "📋", label: "Methodology" },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-[11px] text-slate-500 hover:text-indigo-600 cursor-pointer transition-colors py-0.5">
                  <span>{icon}</span><span>{label}</span>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-slate-400 mt-3">Last updated: {today}</p>

            {/* Live data status panel */}
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-1.5 text-[10px]">
              <p className="font-semibold text-slate-500 uppercase tracking-wide text-[8px] mb-1">Data Status</p>

              {dbLive === null ? (
                <div className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-pulse flex-shrink-0" />
                  <span>Connecting…</span>
                </div>
              ) : (
                <>
                  {/* HDB */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dbLive.connected && dbLive.hdbCount > 0 ? "bg-emerald-500" : "bg-red-400"}`} />
                      <span className="text-slate-600 font-medium">HDB</span>
                    </div>
                    <span className="text-slate-500">
                      {dbLive.connected && dbLive.hdbCount > 0 ? `${dbLive.hdbCount.toLocaleString()} rows` : "not seeded"}
                    </span>
                  </div>

                  {/* Condos */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dbLive.connected && dbLive.privateCount > 0 ? "bg-emerald-500" : "bg-red-400"}`} />
                      <span className="text-slate-600 font-medium">Condos</span>
                    </div>
                    <span className="text-slate-500">
                      {dbLive.connected && dbLive.privateCount > 0 ? `${dbLive.privateCount.toLocaleString()} seeded` : "not seeded"}
                    </span>
                  </div>

                  {/* Nearby */}
                  {dbLive.connected && lat > 0 && (
                    <div className="flex items-center justify-between pt-0.5 border-t border-slate-200">
                      <span className="text-slate-400">Within 1.5 km</span>
                      <span className="font-semibold text-slate-700">{dbLive.condosNearby} condos</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-x-hidden p-3 md:p-4 space-y-4 min-w-0">


          {/* ── Section 1: Financial Overview ── */}
          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="w-7 h-7 bg-slate-900 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">1</div>
              <div className="flex-1">
                <h2 className="font-black text-slate-900 text-base uppercase tracking-wide">Financial Overview</h2>
                <p className="text-xs text-slate-400">Your upgrade capacity at a glance</p>
              </div>
              <div className="shrink-0 flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
                <span className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wide">Recommended</span>
                <span className="font-black text-indigo-800 text-sm">{assessment.recommendation}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 col-span-2 md:col-span-1">
                <p className="text-[9px] text-indigo-500 mb-0.5">Current Flat Value</p>
                <p className="text-base font-black text-indigo-700">{fmtM(assessment.currentMarketValue)}</p>
                <p className="text-[9px] text-indigo-400">
                  {assessment.capitalGain >= 0 ? "+" : ""}{fmtM(assessment.capitalGain)} gain
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[9px] text-slate-500 mb-0.5">Capital Gain</p>
                <p className={`text-base font-black ${gainPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%
                </p>
                <p className="text-[9px] text-slate-400">Since {purchaseYear}</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[9px] text-slate-500 mb-0.5">Net Proceeds</p>
                <p className="text-base font-black text-slate-800">{fmtM(assessment.netProceeds)}</p>
                <p className="text-[9px] text-slate-400">After loan repayment</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[9px] text-slate-500 mb-0.5">HDB Budget</p>
                <p className="text-base font-black text-slate-800">{fmtM(assessment.hdbBudget)}</p>
                <p className="text-[9px] text-slate-400">Resale / BTO</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[9px] text-slate-500 mb-0.5">Private Budget</p>
                <p className="text-base font-black text-slate-800">{fmtM(assessment.privateBudget)}</p>
                <p className="text-[9px] text-slate-400">EC / Condo</p>
              </div>
            </div>
          </section>

          {/* ── Section 2: Property Ranking ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

            {/* Header with 3-way tab toggle */}
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
              <div className="w-7 h-7 bg-slate-900 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">2</div>
              <div className="flex-1">
                <h2 className="font-black text-slate-900 text-base uppercase tracking-wide">Property Ranking</h2>
                <p className="text-[10px] text-slate-400">
                  <span className="text-emerald-600">✓</span> Scored by affordability, distance &amp; market data
                </p>
              </div>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                {(["HDB", "EC", "Condo"] as const).map((tab) => (
                  <button key={tab} onClick={() => setPropertyTab(tab)}
                    className={`text-sm font-semibold px-4 py-2 transition-colors ${
                      propertyTab === tab
                        ? "bg-indigo-600 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Condo tab: filter bar + map + list ── */}
            {propertyTab === "Condo" && (
              <>
                {/* Filter bar */}
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-x-4 gap-y-2 items-center">
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide mr-0.5">Tenure</span>
                    {(["All", "99yr", "999yr", "Freehold"] as const).map((t) => {
                      const label = t === "99yr" ? "99yr" : t === "999yr" ? "999yr" : t;
                      return (
                        <button key={t} onClick={() => setTenureFilter(t)}
                          className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-colors ${
                            tenureFilter === t ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-500 bg-white hover:border-slate-400"
                          }`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide mr-0.5">Score</span>
                    {([0, 60, 70, 80] as const).map((s) => (
                      <button key={s} onClick={() => setMinScoreFilter(s)}
                        className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-colors ${
                          minScoreFilter === s ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-500 bg-white hover:border-slate-400"
                        }`}>
                        {s === 0 ? "All" : `${s}+`}
                      </button>
                    ))}
                  </div>
                  {hasCoords && (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide mr-0.5">Within</span>
                      {(["all", 1, 1.5, 2] as const).map((d) => (
                        <button key={String(d)} onClick={() => setDistanceFilter(d)}
                          className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-colors ${
                            distanceFilter === d ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-500 bg-white hover:border-slate-400"
                          }`}>
                          {d === "all" ? "All" : `${d}km`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Map + List */}
                <div className="flex flex-col lg:flex-row">
                  <div className="lg:w-[65%] border-b lg:border-b-0 lg:border-r border-slate-100" style={{ height: 520 }}>
                    <MapWrapper
                      lat={lat} lng={lng} postalCode={postalCode}
                      properties={displayedListings}
                      selectedProject={selectedProject}
                      onSelectProject={setSelectedProject}
                      radiusM={distanceFilter === "all" ? 2000 : distanceFilter * 1000}
                      bare
                    />
                  </div>
                  <div className="lg:w-[35%] overflow-y-auto" style={{ height: 520 }}>
                    {displayedListings.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-400">
                        {tenureFilter !== "All" || minScoreFilter > 0 || distanceFilter !== "all" ? (
                          <>
                            <p className="text-sm font-semibold text-slate-500 mb-1">No properties match your filters</p>
                            <button
                              onClick={() => { setTenureFilter("All"); setMinScoreFilter(0); setDistanceFilter("all"); }}
                              className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 font-semibold underline">
                              Clear all filters
                            </button>
                          </>
                        ) : (
                          <p className="text-sm font-semibold text-slate-500">No listings available</p>
                        )}
                      </div>
                    ) : (
                      <>
                        {displayedListings.map((listing, i) => (
                          <CompactListRow
                            key={listing.project}
                            rank={i + 1}
                            listing={listing}
                            numChildren={numChildren}
                            defaultBr={brFilter}
                            budget={assessment.privateBudget}
                            isSelected={selectedProject === listing.project}
                            onSelect={() => setSelectedProject(selectedProject === listing.project ? null : listing.project)}
                          />
                        ))}
                        <p className="text-[9px] text-slate-400 px-4 py-3 border-t border-slate-100">
                          Prices are estimates based on latest available data.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── HDB tab ── */}
            {propertyTab === "HDB" && (
              <div className="p-5 space-y-5">
                {/* Same flat type */}
                <div>
                  <p className="font-semibold text-slate-700 text-sm mb-3">
                    Recent {flatType} Resale in {town || "your area"}
                  </p>
                  {sameTypeHdbListings.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {sameTypeHdbListings.map((t, i) => (
                        <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                          <p className="text-xs font-bold text-slate-700 truncate">Blk {t.block} {t.streetName.split(" ").slice(0, 3).join(" ")}</p>
                          <p className="text-lg font-black text-indigo-600 mt-1">{fmtM(t.resalePrice)}</p>
                          <p className="text-[10px] text-slate-400">${fmt(t.pricePerSqm)}/sqm · {t.storeyRange.replace(" TO ", "–")}F</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{t.month} · {t.sqm}sqm · {t.remainingLease}yr lease</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm">No recent {flatType} transactions found in {town || "your area"}.</p>
                  )}
                </div>

                {/* Bigger HDB */}
                {nextFlatType && (
                  <div>
                    <p className="font-semibold text-slate-700 text-sm mb-3">
                      Upgrade to {nextFlatType} in {town || "your area"}
                    </p>
                    {biggerHdbListings.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {biggerHdbListings.slice(0, 8).map((t, i) => (
                          <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                            <p className="text-xs font-bold text-slate-700 truncate">Blk {t.block} {t.streetName.split(" ").slice(0, 3).join(" ")}</p>
                            <p className="text-lg font-black text-indigo-600 mt-1">{fmtM(t.resalePrice)}</p>
                            <p className="text-[10px] text-slate-400">${fmt(t.pricePerSqm)}/sqm · {t.storeyRange.replace(" TO ", "–")}F</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{t.month} · {t.sqm}sqm</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">No recent transactions found. Enter a postal code for live data.</p>
                    )}
                  </div>
                )}

                <p className="text-[9px] text-slate-400">Note: Prices are estimates based on latest available data. Actual figures may vary.</p>
              </div>
            )}

            {/* ── EC tab ── */}
            {propertyTab === "EC" && (
              <div className="p-5">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <span className="text-xl">🏗️</span>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Executive Condominiums</p>
                    <p className="text-[10px] text-slate-400">Subsidised by HDB · privatises after 10 years · must meet eligibility</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {ecListings.map((ec) => {
                    const affordable = ec.price <= assessment.privateBudget;
                    return (
                      <div key={ec.name} className={`rounded-xl border p-4 ${affordable ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                        <p className="font-bold text-slate-800 text-sm leading-tight mb-1">{ec.name}</p>
                        <p className="text-xl font-black text-indigo-600">{fmtM(ec.price)}</p>
                        <p className="text-xs text-slate-500 mt-1">{ec.bedrooms} · {ec.location}</p>
                        {affordable ? (
                          <span className="inline-block mt-2 text-[9px] bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-full">✓ Within Budget</span>
                        ) : (
                          <span className="inline-block mt-2 text-[9px] bg-slate-200 text-slate-500 font-semibold px-2 py-0.5 rounded-full">Above Budget</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[9px] text-amber-600 mt-4 pt-3 border-t border-slate-100">
                  ⓘ EC eligibility: Singapore Citizen, household income ≤ $16,000, not owned private property in last 30 months.
                </p>
              </div>
            )}
          </div>

          {/* ── Section 3: Upgrade Suitability Score ── */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-7 h-7 bg-slate-900 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">3</div>
              <div>
                <h2 className="font-black text-slate-900 text-base uppercase tracking-wide">Upgrade Suitability Score</h2>
                <p className="text-xs text-slate-400">Should you upgrade now, wait, or improve your position first?</p>
              </div>
            </div>
            <UpgradeScorePanel
              assessment={assessment}
              flatType={flatType}
              remainingLease={remainingLease}
              numChildren={numChildren}
              remainingLoan={remainingLoan}
              purchasePrice={purchasePrice}
              financialProfile={initialFinancialProfile}
            />
          </section>

          {/* Footer */}
          <div className="flex justify-between text-[9px] text-slate-400 pt-2 border-t border-slate-200 pb-6">
            <span>Data Sources: URA Realis, data.gov.sg · BSD/ABSD at 2024 IRAS rates</span>
            <span>Last updated: {today}</span>
          </div>
        </main>
      </div>
    </div>
  );
}
