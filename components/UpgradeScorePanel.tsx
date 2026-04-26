"use client";

import { useState, useCallback } from "react";
import {
  computeUpgradeScore, calcBSD, calcMonthlyMortgage,
  type UpgradeScoreInput, type UpgradeScoreResult, type CategoryScore,
} from "@/lib/upgradeScore";
import type { FinancialProfile } from "@/lib/myinfo/types";
import type { AssessmentResult } from "@/lib/calculator";
import PropertyResearchCard from "./PropertyResearchCard";
import type { ResearchResult } from "@/lib/services/propertyResearchService";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  assessment:      AssessmentResult;
  flatType:        string;
  remainingLease:  number;
  numChildren:     number;
  remainingLoan:   number;
  purchasePrice:   number;
  financialProfile: FinancialProfile | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtS(n: number) { return `S$${Math.round(n).toLocaleString("en-SG")}`; }
function fmtPct(n: number) { return `${(n * 100).toFixed(0)}%`; }

const COLOR_MAP: Record<string, string> = {
  emerald: "bg-emerald-500",
  amber:   "bg-amber-500",
  orange:  "bg-orange-500",
  red:     "bg-red-500",
  blue:    "bg-blue-500",
  purple:  "bg-purple-500",
  indigo:  "bg-indigo-500",
};

const TEXT_COLOR_MAP: Record<string, string> = {
  emerald: "text-emerald-700",
  amber:   "text-amber-700",
  orange:  "text-orange-700",
  red:     "text-red-700",
};

const BG_COLOR_MAP: Record<string, string> = {
  emerald: "bg-emerald-50 border-emerald-200",
  amber:   "bg-amber-50 border-amber-200",
  orange:  "bg-orange-50 border-orange-200",
  red:     "bg-red-50 border-red-200",
};

// ── Score gauge ───────────────────────────────────────────────────────────────

function ScoreGauge({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = circ - (score / 100) * circ;
  const hexMap: Record<string, string> = {
    emerald: "#10b981",
    amber:   "#f59e0b",
    orange:  "#f97316",
    red:     "#ef4444",
  };
  const hex = hexMap[color] ?? "#6366f1";
  return (
    <div className="flex flex-col items-center">
      <svg width="128" height="128" viewBox="0 0 116 116">
        <circle cx="58" cy="58" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle cx="58" cy="58" r={r} fill="none" stroke={hex} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={dash}
          strokeLinecap="round" transform="rotate(-90 58 58)" />
        <text x="58" y="54" textAnchor="middle" fontSize="26" fontWeight="900" fill={hex}>{score}</text>
        <text x="58" y="69" textAnchor="middle" fontSize="11" fill="#9ca3af">/100</text>
      </svg>
      <p className={`text-sm font-bold mt-1 ${TEXT_COLOR_MAP[color] ?? "text-slate-700"}`}>{label}</p>
    </div>
  );
}

// ── Category bar ──────────────────────────────────────────────────────────────

function CategoryBar({ cat }: { cat: CategoryScore }) {
  const [open, setOpen] = useState(false);
  const pct = cat.maxScore > 0 ? (cat.score / cat.maxScore) * 100 : 0;
  const barColor = COLOR_MAP[cat.color] ?? "bg-slate-500";
  return (
    <div className="space-y-1">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left hover:bg-slate-50 rounded px-1 py-0.5 transition-colors">
        <span className="text-[10px] text-slate-500 w-28 shrink-0">{cat.name}</span>
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[10px] font-semibold text-slate-700 w-12 text-right shrink-0">
          {cat.score}/{cat.maxScore}
        </span>
        <span className="text-[9px] text-slate-300 shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="pl-[7.5rem] space-y-1 pb-1">
          {cat.items.map((item) => (
            <div key={item.label} className="bg-slate-50 rounded p-2 border border-slate-100">
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-[10px] font-semibold text-slate-600">{item.label}</span>
                <span className="text-[10px] font-bold text-slate-700">{item.score}/{item.maxScore}</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">{item.explanation}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({ label, value, onChange, type = "number", min, step, hint }: {
  label: string; value: number | string; onChange: (v: string) => void;
  type?: string; min?: number; step?: number; hint?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        min={min} step={step}
        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      {hint && <p className="text-[9px] text-slate-300 mt-0.5">{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UpgradeScorePanel({
  assessment, flatType, remainingLease, numChildren, remainingLoan, purchasePrice, financialProfile,
}: Props) {
  const fp = financialProfile;

  // ── Form state (pre-filled where possible) ──────────────────────────────

  // Current home
  const [currentMarketValue, setCurrentMarketValue] = useState(String(assessment.currentMarketValue));
  const [outstandingLoan, setOutstandingLoan]   = useState(
    String(fp?.outstandingLoanBalance ?? remainingLoan)
  );
  const [cpfUsed, setCpfUsed] = useState(
    String((fp?.cpfUsedForHousing ?? 0) + (fp?.spouseCpfUsedForHousing ?? 0))
  );
  const [cpfOa, setCpfOa] = useState(
    String((fp?.cpfOaBalance ?? 0) + (fp?.spouseCpfOaBalance ?? 0))
  );
  const [cashSavings, setCashSavings] = useState("50000");
  const [currentLeaseYears, setCurrentLeaseYears] = useState(String(remainingLease));

  // Income & obligations
  const [monthlyIncome, setMonthlyIncome]   = useState(String(assessment.combinedIncome));
  const [monthlyCarLoan, setMonthlyCarLoan] = useState("0");
  const [otherDebt, setOtherDebt]           = useState("0");

  // Target property
  const [targetPrice, setTargetPrice]   = useState(String(Math.round(assessment.privateBudget * 0.8 / 10000) * 10000));
  const [propType, setPropType]         = useState<"HDB" | "EC" | "Condo">("Condo");
  const [targetBedrooms, setTargetBedrooms] = useState(String(numChildren >= 2 ? 4 : 3));
  const [targetLeaseYears, setTargetLeaseYears] = useState("99");
  const [targetPropertyAge, setTargetPropertyAge] = useState("5");
  const [interestRate, setInterestRate] = useState("3.5");
  const [loanTenure, setLoanTenure]     = useState("25");
  const [reno, setReno] = useState("40000");

  // Family
  const [familySize, setFamilySize]         = useState(String(numChildren + 2));
  const [hasSchoolKids, setHasSchoolKids]   = useState(numChildren > 0);
  const [distanceParents, setDistanceParents] = useState("");
  const [distanceSchool, setDistanceSchool] = useState("");

  // Market
  const [demand, setDemand]   = useState<"High" | "Medium" | "Low">("Medium");
  const [liquidity, setLiquidity] = useState<"High" | "Medium" | "Low">("Medium");
  const [priceTrend, setPriceTrend] = useState<"Rising" | "Stable" | "Falling">("Stable");

  // Mode
  const [conservative, setConservative] = useState(false);

  // PSF research
  const [psfEstimate, setPsfEstimate] = useState<ResearchResult | null>(null);
  const [researchProject, setResearchProject] = useState("");

  // UI state
  const [result, setResult]       = useState<UpgradeScoreResult | null>(null);
  const [explanation, setExplanation] = useState("");
  const [explaining, setExplaining]   = useState(false);
  const [showForm, setShowForm]     = useState(true);

  // ── Compute ──────────────────────────────────────────────────────────────

  const handleCompute = useCallback(() => {
    const tp = Number(targetPrice);
    const ir = Number(interestRate) / 100;
    const lt = Number(loanTenure);
    const ltv = propType === "HDB" ? 0.80 : 0.75;
    const loanAmt = tp * ltv;
    const bsd = calcBSD(tp);
    const legalFees = 3000;
    const mort = calcMonthlyMortgage(loanAmt, ir, lt);

    const inp: UpgradeScoreInput = {
      currentMarketValue:    Number(currentMarketValue),
      outstandingLoan:       Number(outstandingLoan),
      cpfUsedForHousing:     Number(cpfUsed),
      cpfOaBalance:          Number(cpfOa),
      cashSavings:           Number(cashSavings),
      currentFlatType:       flatType,
      currentRemainingLease: Number(currentLeaseYears),

      monthlyGrossIncome:    Number(monthlyIncome),
      monthlyCarLoan:        Number(monthlyCarLoan),
      otherMonthlyDebt:      Number(otherDebt),

      targetPropertyPrice:   tp,
      propertyType:          propType,
      targetBedrooms:        Number(targetBedrooms),
      targetRemainingLease:  Number(targetLeaseYears),
      targetPropertyAge:     Number(targetPropertyAge),

      buyerStampDuty:        bsd,
      legalAndAgentFees:     legalFees,
      renovationBudget:      Number(reno),

      expectedMonthlyMortgage: mort,
      interestRate:          ir,
      loanTenureYears:       lt,

      familySize:            Number(familySize),
      numChildren,
      hasSchoolAgeChildren:  hasSchoolKids,
      distanceToParentsKm:   distanceParents !== "" ? Number(distanceParents) : null,
      distanceToSchoolKm:    distanceSchool !== "" ? Number(distanceSchool) : null,

      transactionDemand:     demand,
      liquidity,
      priceTrend,
      conservativeMode:      conservative,
      marketPsfEstimate:     psfEstimate ?? undefined,
    };

    setResult(computeUpgradeScore(inp));
    setExplanation("");
    setShowForm(false);
  }, [
    currentMarketValue, outstandingLoan, cpfUsed, cpfOa, cashSavings, currentLeaseYears,
    monthlyIncome, monthlyCarLoan, otherDebt,
    targetPrice, propType, targetBedrooms, targetLeaseYears, targetPropertyAge,
    interestRate, loanTenure, reno,
    familySize, numChildren, hasSchoolKids, distanceParents, distanceSchool,
    demand, liquidity, priceTrend, conservative, flatType, psfEstimate,
  ]);

  // ── AI explanation ───────────────────────────────────────────────────────

  const handleExplain = useCallback(async () => {
    if (!result) return;
    setExplaining(true);
    setExplanation("");
    try {
      const res = await fetch("/api/upgrade-score/explain", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          result,
          context: {
            flatType,
            town:                "",
            targetPropertyPrice: Number(targetPrice),
            propertyType:        propType,
            monthlyGrossIncome:  Number(monthlyIncome),
          },
        }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) setExplanation((prev) => prev + dec.decode(value, { stream: true }));
      }
    } catch {
      setExplanation("Unable to generate explanation. Please try again.");
    } finally {
      setExplaining(false);
    }
  }, [result, flatType, targetPrice, propType, monthlyIncome]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="font-black text-slate-900 text-sm uppercase tracking-wide">Should I Upgrade Now?</h2>
          <p className="text-[10px] text-slate-400">Rule-based suitability score + AI explanation</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-[10px] text-slate-500">Conservative</span>
            <button
              onClick={() => { setConservative((v) => !v); setResult(null); setExplanation(""); }}
              className={`relative w-8 h-4 rounded-full transition-colors ${conservative ? "bg-amber-500" : "bg-slate-200"}`}>
              <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${conservative ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </label>
          {result && (
            <button onClick={() => setShowForm((v) => !v)}
              className="text-[10px] text-indigo-500 hover:text-indigo-700 font-semibold">
              {showForm ? "Hide inputs" : "Edit inputs"}
            </button>
          )}
        </div>
      </div>

      {/* Input form */}
      {showForm && (
        <div className="p-5 space-y-5 border-b border-slate-100">

          {/* Current home */}
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Current Home</p>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Est. Market Value (S$)" value={currentMarketValue}
                onChange={setCurrentMarketValue} min={0} step={10000} />
              <Field label="Outstanding Loan (S$)" value={outstandingLoan}
                onChange={setOutstandingLoan} min={0} step={1000} />
              <Field label="CPF Used for Housing (S$)" value={cpfUsed}
                onChange={setCpfUsed} min={0} step={1000}
                hint="Returned to CPF OA on sale" />
              <Field label="CPF OA Balance (S$)" value={cpfOa}
                onChange={setCpfOa} min={0} step={1000} />
              <Field label="Cash Savings (S$)" value={cashSavings}
                onChange={setCashSavings} min={0} step={5000} />
              <Field label="Remaining Lease (years)" value={currentLeaseYears}
                onChange={setCurrentLeaseYears} min={1} step={1} />
            </div>
          </div>

          {/* Income */}
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Income & Obligations</p>
            <div className="grid grid-cols-3 gap-2.5">
              <Field label="Monthly Gross Income (S$)" value={monthlyIncome}
                onChange={setMonthlyIncome} min={0} step={500}
                hint="Combined household" />
              <Field label="Monthly Car Loan (S$)" value={monthlyCarLoan}
                onChange={setMonthlyCarLoan} min={0} step={100} />
              <Field label="Other Monthly Debt (S$)" value={otherDebt}
                onChange={setOtherDebt} min={0} step={100} />
            </div>
          </div>

          {/* Target property */}
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Target Property</p>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Target Price (S$)" value={targetPrice}
                onChange={setTargetPrice} min={0} step={10000} />
              <SelectField label="Property Type" value={propType}
                onChange={(v) => setPropType(v as "HDB" | "EC" | "Condo")}
                options={[
                  { value: "HDB",   label: "HDB Resale" },
                  { value: "EC",    label: "Executive Condo" },
                  { value: "Condo", label: "Private Condo" },
                ]} />
              <Field label="Bedrooms" value={targetBedrooms}
                onChange={setTargetBedrooms} min={1} step={1} />
              <Field label="Remaining Lease (years)" value={targetLeaseYears}
                onChange={setTargetLeaseYears} min={1} step={1}
                hint="Use 999 or 9999 for freehold" />
              <Field label="Property Age (years)" value={targetPropertyAge}
                onChange={setTargetPropertyAge} min={0} step={1}
                hint="0 = new launch" />
              <Field label="Renovation Budget (S$)" value={reno}
                onChange={setReno} min={0} step={5000} />
              <Field label="Interest Rate (%)" value={interestRate}
                onChange={setInterestRate} min={0.1} step={0.1} />
              <Field label="Loan Tenure (years)" value={loanTenure}
                onChange={setLoanTenure} min={5} step={1} />
            </div>
          </div>

          {/* PSF Research (Condo / EC only) */}
          {(propType === "Condo" || propType === "EC") && (
            <div>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Market Price Check</p>
              <PropertyResearchCard
                initialProjectName={researchProject}
                unitType={`${targetBedrooms}-bedder`}
                targetPsf={Number(targetPrice) > 0 && Number(targetBedrooms) > 0
                  ? Math.round(Number(targetPrice) / (Number(targetBedrooms) * 100) / 10.764)
                  : 0}
                onEstimate={(est) => {
                  setPsfEstimate(est);
                  if (est) setResearchProject(est.project_name);
                }}
              />
            </div>
          )}

          {/* Family */}
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Family</p>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Family Size (total people)" value={familySize}
                onChange={setFamilySize} min={1} step={1} />
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">School-Age Children</label>
                <button onClick={() => setHasSchoolKids((v) => !v)}
                  className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                    hasSchoolKids ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "border-slate-200 text-slate-500"
                  }`}>
                  {hasSchoolKids ? "Yes" : "No"}
                </button>
              </div>
              <Field label="Distance to Parents (km)" value={distanceParents}
                onChange={setDistanceParents} min={0} step={0.5}
                hint="Leave blank if not applicable" />
              {hasSchoolKids && (
                <Field label="Distance to Target School (km)" value={distanceSchool}
                  onChange={setDistanceSchool} min={0} step={0.1} />
              )}
            </div>
          </div>

          {/* Market */}
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Market Signals</p>
            <div className="grid grid-cols-3 gap-2.5">
              <SelectField label="Demand for Current Home" value={demand}
                onChange={(v) => setDemand(v as "High" | "Medium" | "Low")}
                options={[
                  { value: "High",   label: "High" },
                  { value: "Medium", label: "Medium" },
                  { value: "Low",    label: "Low" },
                ]} />
              <SelectField label="Target Market Liquidity" value={liquidity}
                onChange={(v) => setLiquidity(v as "High" | "Medium" | "Low")}
                options={[
                  { value: "High",   label: "High" },
                  { value: "Medium", label: "Medium" },
                  { value: "Low",    label: "Low" },
                ]} />
              <SelectField label="Price Trend" value={priceTrend}
                onChange={(v) => setPriceTrend(v as "Rising" | "Stable" | "Falling")}
                options={[
                  { value: "Rising",  label: "Rising" },
                  { value: "Stable",  label: "Stable" },
                  { value: "Falling", label: "Falling" },
                ]} />
            </div>
          </div>

          <button onClick={handleCompute}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-2.5 rounded-xl transition-colors">
            Calculate Upgrade Score
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="p-5 space-y-5">

          {/* Score gauge + decision */}
          <div className={`flex flex-col sm:flex-row items-center gap-6 rounded-xl border p-5 ${BG_COLOR_MAP[result.decisionColor] ?? "bg-slate-50 border-slate-200"}`}>
            <ScoreGauge score={result.totalScore} label={result.decisionLabel} color={result.decisionColor} />
            <div className="flex-1 space-y-2 text-center sm:text-left">
              <p className="text-xs font-semibold text-slate-600">Suggested Next Step</p>
              <p className="text-sm text-slate-700 leading-relaxed">{result.suggestedNextStep}</p>
              {result.conservativeMode && (
                <span className="inline-block text-[10px] bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full border border-amber-200">
                  Conservative mode active
                </span>
              )}
            </div>
          </div>

          {/* Key metrics */}
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Key Metrics</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { label: "Net Cash After Sale",    value: fmtS(result.keyMetrics.netCashProceeds) },
                { label: "CPF OA After Refund",    value: fmtS(result.keyMetrics.cpfOaAfterRefund) },
                { label: "Total Liquid",           value: fmtS(result.keyMetrics.totalLiquidBeforePurchase) },
                { label: "Upfront Required",       value: fmtS(result.keyMetrics.totalUpfrontRequired) },
                {
                  label: "Surplus / (Shortfall)",
                  value: fmtS(result.keyMetrics.surplus),
                  highlight: result.keyMetrics.surplus >= 0 ? "text-emerald-600" : "text-red-600",
                },
                { label: "Cash Buffer Post-Buy",   value: `${result.keyMetrics.bufferMonths.toFixed(1)} months` },
                { label: "TDSR",                   value: fmtPct(result.keyMetrics.TDSR),
                  highlight: result.keyMetrics.TDSR > 0.55 ? "text-red-600" : result.keyMetrics.TDSR > 0.45 ? "text-amber-600" : "text-emerald-600" },
                { label: "MSR (HDB)",              value: fmtPct(result.keyMetrics.MSR) },
                { label: "BSD",                    value: fmtS(calcBSD(Number(targetPrice))) },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                  <p className="text-[9px] text-slate-400">{label}</p>
                  <p className={`text-sm font-bold ${highlight ?? "text-slate-800"}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Category bars */}
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Score Breakdown</p>
            <div className="space-y-1.5">
              {result.categoryScores.map((cat) => (
                <CategoryBar key={cat.name} cat={cat} />
              ))}
            </div>
            <p className="text-[9px] text-slate-300 mt-1.5">Click a category to see item-level breakdown</p>
          </div>

          {/* Top reasons & risks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {result.topReasonsToUpgrade.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2">Top Reasons to Upgrade</p>
                <div className="space-y-1.5">
                  {result.topReasonsToUpgrade.map((r) => (
                    <div key={r} className="flex gap-2 items-start bg-emerald-50 rounded-lg p-2 border border-emerald-100">
                      <span className="text-emerald-500 text-xs shrink-0 mt-0.5">✓</span>
                      <span className="text-xs text-slate-700 leading-snug">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.topRisks.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-2">Top Risks</p>
                <div className="space-y-1.5">
                  {result.topRisks.map((r) => (
                    <div key={r} className="flex gap-2 items-start bg-red-50 rounded-lg p-2 border border-red-100">
                      <span className="text-red-500 text-xs shrink-0 mt-0.5">!</span>
                      <span className="text-xs text-slate-700 leading-snug">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI explanation */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">AI Explanation</p>
              {!explanation && !explaining && (
                <button onClick={handleExplain}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                  Explain this score
                </button>
              )}
              {explaining && (
                <span className="text-[10px] text-slate-400 animate-pulse">Claude is writing…</span>
              )}
            </div>
            {(explanation || explaining) && (
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {explanation}
                  {explaining && <span className="animate-pulse text-indigo-400">▍</span>}
                </p>
                {explanation && !explaining && (
                  <p className="text-[9px] text-slate-300 mt-3 pt-2 border-t border-slate-100">
                    Generated by Claude · scores are deterministic and not AI-generated
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
