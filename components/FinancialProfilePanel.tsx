"use client";

import { useState, useEffect, useCallback } from "react";
import type { FinancialProfile } from "@/lib/myinfo/types";

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  // Server-side pre-fetched profile (may be null if no session)
  initialProfile: FinancialProfile | null;
  // Whether Myinfo is configured in this environment
  myinfoAvailable: boolean;
  // The current assessment values to enhance
  currentMarketValue: number;
  purchasePrice:      number;
  returnUrl:          string; // where to redirect back after Singpass
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtS(n: number | null): string {
  if (n === null) return "—";
  return `S$${Math.round(n).toLocaleString("en-SG")}`;
}
function fmtSK(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `S$${(n / 1_000_000).toFixed(2)}M`;
  return `S$${(n / 1_000).toFixed(0)}K`;
}

// ── Affordability calculation ─────────────────────────────────────────────────

function calcAffordability(profile: FinancialProfile, currentMarketValue: number) {
  const outstanding    = profile.outstandingLoanBalance ?? 0;
  const cpfOa          = profile.cpfOaBalance ?? 0;
  const cpfUsed        = profile.cpfUsedForHousing ?? 0;
  const monthlyContrib = profile.monthlyContribution ?? 0;

  // Net cash after selling: market value − outstanding loan − ~3% transaction costs
  const sellingCost = Math.round(currentMarketValue * 0.03);
  const netCash     = Math.max(0, currentMarketValue - outstanding - sellingCost);

  // CPF OA refund after selling (CPF used + accrued interest ~2.5%/yr est)
  // We use a simplified estimate; actual accrued interest depends on years held
  const cpfRefund = cpfUsed > 0 ? Math.round(cpfUsed * 1.05) : 0;

  // Available for down payment = net cash + CPF OA balance
  const availableForDownPayment = netCash + cpfOa;

  // Estimated monthly CPF contribution remaining after current instalment
  const surplusMonthly = Math.max(0, monthlyContrib - (profile.monthlyLoanInstalment ?? 0));

  // Upgrade suitability score (0-100)
  let score = 40;
  if (availableForDownPayment >= 200_000) score += 20;
  else if (availableForDownPayment >= 100_000) score += 12;
  else if (availableForDownPayment >= 50_000) score += 6;
  if (surplusMonthly >= 1_500) score += 15;
  else if (surplusMonthly >= 800) score += 8;
  if (cpfOa >= 50_000) score += 10;
  else if (cpfOa >= 20_000) score += 5;
  if (profile.outstandingLoanBalance === 0) score += 10;
  else if ((profile.outstandingLoanBalance ?? 0) < 50_000) score += 5;
  score = Math.min(score, 99);

  return { netCash, cpfRefund, availableForDownPayment, surplusMonthly, score };
}

// ── Manual form ────────────────────────────────────────────────────────────────

interface ManualValues {
  cpfOaBalance:           string;
  cpfSaBalance:           string;
  monthlyContribution:    string;
  outstandingLoanBalance: string;
  monthlyLoanInstalment:  string;
  cpfUsedForHousing:      string;
}

const EMPTY_MANUAL: ManualValues = {
  cpfOaBalance:           "",
  cpfSaBalance:           "",
  monthlyContribution:    "",
  outstandingLoanBalance: "",
  monthlyLoanInstalment:  "",
  cpfUsedForHousing:      "",
};

function numVal(v: string): number | null {
  const n = parseFloat(v.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function formatMoney(v: string): string {
  const digits = v.replace(/[^\d.]/g, "");
  const n = parseFloat(digits);
  return isNaN(n) ? digits : Math.floor(n).toLocaleString("en-SG");
}

// ── Main component ────────────────────────────────────────────────────────────

type View = "idle" | "consent" | "manual" | "profile" | "saving";

export default function FinancialProfilePanel({
  initialProfile,
  myinfoAvailable,
  currentMarketValue,
  purchasePrice,
  returnUrl,
}: Props) {
  const [profile, setProfile] = useState<FinancialProfile | null>(initialProfile);
  const [view, setView]       = useState<View>(initialProfile ? "profile" : "idle");
  const [manual, setManual]   = useState<ManualValues>(EMPTY_MANUAL);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Re-check session on client in case cookie was set by Myinfo callback
  useEffect(() => {
    if (!initialProfile) {
      fetch("/api/myinfo/profile")
        .then((r) => r.json())
        .then((data: FinancialProfile | null) => {
          if (data) { setProfile(data); setView("profile"); }
        })
        .catch(() => undefined);
    }
  }, [initialProfile]);

  // Show error from Myinfo callback redirect param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const myinfoError = params.get("myinfo_error");
    if (myinfoError && myinfoError !== "access_denied") {
      setError("Singpass connection failed. Please try again or enter manually.");
    }
  }, []);

  // ── Manual form handlers ─────────────────────────────────────────────────

  function setField(key: keyof ManualValues, val: string) {
    setManual((m) => ({ ...m, [key]: val }));
  }

  const applyManual = useCallback(() => {
    const p: FinancialProfile = {
      source:                 "manual",
      cpfOaBalance:           numVal(manual.cpfOaBalance),
      cpfSaBalance:           numVal(manual.cpfSaBalance),
      cpfMaBalance:           null,
      cpfUsedForHousing:      numVal(manual.cpfUsedForHousing),
      monthlyContribution:    numVal(manual.monthlyContribution),
      outstandingLoanBalance: numVal(manual.outstandingLoanBalance),
      monthlyLoanInstalment:  numVal(manual.monthlyLoanInstalment),
      hdbFlat:                null,
    };
    setProfile(p);
    setView("profile");
  }, [manual]);

  async function saveManual() {
    setSaving(true);
    try {
      const body: FinancialProfile = {
        source:                 "manual",
        cpfOaBalance:           numVal(manual.cpfOaBalance),
        cpfSaBalance:           numVal(manual.cpfSaBalance),
        cpfMaBalance:           null,
        cpfUsedForHousing:      numVal(manual.cpfUsedForHousing),
        monthlyContribution:    numVal(manual.monthlyContribution),
        outstandingLoanBalance: numVal(manual.outstandingLoanBalance),
        monthlyLoanInstalment:  numVal(manual.monthlyLoanInstalment),
        hdbFlat:                null,
      };
      await fetch("/api/myinfo/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setProfile(body);
      setView("profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    await fetch("/api/myinfo/logout", { method: "POST" });
    setProfile(null);
    setManual(EMPTY_MANUAL);
    setView("idle");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">💼</span>
          <h2 className="text-sm font-semibold text-slate-800">Financial Profile</h2>
          {profile && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              profile.source === "myinfo"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-slate-100 text-slate-500"
            }`}>
              {profile.source === "myinfo" ? "via Singpass" : "Manual"}
            </span>
          )}
        </div>
        {profile && (
          <button
            onClick={handleDisconnect}
            className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div className="p-4">
        {/* Error banner */}
        {error && (
          <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* IDLE — CTA */}
        {view === "idle" && (
          <IdleView
            myinfoAvailable={myinfoAvailable}
            returnUrl={returnUrl}
            onConsent={() => setView("consent")}
            onManual={() => setView("manual")}
          />
        )}

        {/* CONSENT — shown before Singpass redirect */}
        {view === "consent" && (
          <ConsentView
            returnUrl={returnUrl}
            onBack={() => setView("idle")}
            onManual={() => setView("manual")}
          />
        )}

        {/* MANUAL ENTRY */}
        {view === "manual" && (
          <ManualView
            manual={manual}
            saving={saving}
            onBack={() => setView("idle")}
            onChange={setField}
            onApply={applyManual}
            onSave={saveManual}
          />
        )}

        {/* PROFILE — show data + affordability */}
        {view === "profile" && profile && (
          <ProfileView
            profile={profile}
            currentMarketValue={currentMarketValue}
            purchasePrice={purchasePrice}
            onEdit={() => setView("manual")}
          />
        )}
      </div>
    </section>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────────────────

function IdleView({
  myinfoAvailable,
  returnUrl,
  onConsent,
  onManual,
}: {
  myinfoAvailable: boolean;
  returnUrl:       string;
  onConsent:       () => void;
  onManual:        () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Add your real CPF and HDB loan details for a more accurate upgrade affordability analysis.
      </p>
      <div className="flex flex-col gap-2">
        {myinfoAvailable && (
          <button
            onClick={onConsent}
            className="flex items-center justify-center gap-2 w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2.5 px-4 rounded-xl transition-colors"
          >
            <img
              src="https://www.singpass.gov.sg/assets/img/logo/sp-logo-white.svg"
              alt=""
              className="h-4 w-auto"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            Connect Singpass Myinfo
          </button>
        )}
        <button
          onClick={onManual}
          className={`w-full border border-slate-200 hover:border-slate-300 text-slate-700 text-sm font-medium py-2.5 px-4 rounded-xl transition-colors ${
            myinfoAvailable ? "bg-white" : "bg-indigo-50 border-indigo-200 text-indigo-700 hover:border-indigo-300"
          }`}
        >
          {myinfoAvailable ? "Enter Manually Instead" : "Enter Financials Manually"}
        </button>
      </div>
      {!myinfoAvailable && (
        <p className="text-[10px] text-slate-400">
          Singpass Myinfo integration not configured in this environment.
        </p>
      )}
    </div>
  );
}

function ConsentView({
  returnUrl,
  onBack,
  onManual,
}: {
  returnUrl: string;
  onBack:    () => void;
  onManual:  () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
        <p className="text-[11px] font-semibold text-amber-800 mb-1.5">Data Access Consent</p>
        <p className="text-[11px] text-amber-700 leading-relaxed mb-2">
          By clicking <strong>Proceed</strong>, you authorise this app to retrieve the following
          data from your Myinfo profile via Singpass:
        </p>
        <ul className="text-[11px] text-amber-700 space-y-0.5 list-none">
          {[
            "CPF Ordinary, Special & Medisave Account balances",
            "CPF contribution history (last 15 months)",
            "CPF housing withdrawal amounts",
            "HDB ownership, outstanding loan & monthly instalment",
          ].map((item) => (
            <li key={item} className="flex items-start gap-1.5">
              <span className="text-amber-500 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1">
        <p className="text-[10px] text-slate-500 leading-relaxed">
          <strong>Privacy:</strong> Your financial data is encrypted and stored only for this
          session (1 hour). It is never logged, shared with third parties, or stored permanently
          without your explicit action.
        </p>
        <p className="text-[10px] text-slate-500">
          You will be redirected to the official Singpass login page.
          Your Singpass password is entered only on the Singpass website — never here.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <a
          href={`/api/myinfo/auth?returnUrl=${encodeURIComponent(returnUrl)}`}
          className="flex items-center justify-center gap-2 w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2.5 px-4 rounded-xl transition-colors text-center"
        >
          Proceed with Singpass
        </a>
        <button
          onClick={onManual}
          className="w-full text-slate-600 text-xs py-2 hover:text-indigo-600 transition-colors"
        >
          Enter manually instead
        </button>
        <button
          onClick={onBack}
          className="w-full text-slate-400 text-xs py-1 hover:text-slate-600 transition-colors"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

function ManualView({
  manual,
  saving,
  onBack,
  onChange,
  onApply,
  onSave,
}: {
  manual:   ManualValues;
  saving:   boolean;
  onBack:   () => void;
  onChange: (k: keyof ManualValues, v: string) => void;
  onApply:  () => void;
  onSave:   () => void;
}) {
  const fields: { key: keyof ManualValues; label: string; placeholder: string }[] = [
    { key: "cpfOaBalance",           label: "CPF Ordinary Account (OA)",     placeholder: "e.g. 45,000" },
    { key: "cpfSaBalance",           label: "CPF Special Account (SA)",       placeholder: "e.g. 22,000" },
    { key: "monthlyContribution",    label: "Monthly CPF Contribution (total)", placeholder: "e.g. 2,340" },
    { key: "outstandingLoanBalance", label: "Outstanding HDB Loan",           placeholder: "e.g. 85,000" },
    { key: "monthlyLoanInstalment",  label: "Monthly HDB Instalment",         placeholder: "e.g. 800" },
    { key: "cpfUsedForHousing",      label: "CPF Used for Housing (total)",   placeholder: "e.g. 80,000" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        All amounts in SGD. Data stays in your browser unless you save it.
      </p>
      <div className="space-y-2">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">S$</span>
              <input
                type="text"
                inputMode="numeric"
                value={manual[key]}
                onChange={(e) => onChange(key, formatMoney(e.target.value))}
                placeholder={placeholder}
                className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApply}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
        >
          Apply
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-sm font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save to Session"}
        </button>
      </div>
      <button
        onClick={onBack}
        className="w-full text-slate-400 text-xs hover:text-slate-600 transition-colors py-1"
      >
        ← Back
      </button>
    </div>
  );
}

function ProfileView({
  profile,
  currentMarketValue,
  purchasePrice,
  onEdit,
}: {
  profile:            FinancialProfile;
  currentMarketValue: number;
  purchasePrice:      number;
  onEdit:             () => void;
}) {
  const aff = calcAffordability(profile, currentMarketValue);

  const scoreColor =
    aff.score >= 75 ? "text-emerald-600 bg-emerald-50 border-emerald-100"
    : aff.score >= 55 ? "text-amber-600 bg-amber-50 border-amber-100"
    : "text-red-600 bg-red-50 border-red-100";

  const rows: { label: string; value: string; highlight?: boolean }[] = [
    { label: "CPF OA Balance",           value: fmtS(profile.cpfOaBalance) },
    { label: "CPF SA Balance",           value: fmtS(profile.cpfSaBalance) },
    ...(profile.cpfMaBalance !== null
      ? [{ label: "CPF MA Balance", value: fmtS(profile.cpfMaBalance) }]
      : []),
    { label: "CPF Used for Housing",     value: fmtS(profile.cpfUsedForHousing) },
    { label: "Monthly Contribution",     value: profile.monthlyContribution ? `${fmtS(profile.monthlyContribution)}/mo` : "—" },
    { label: "Outstanding HDB Loan",     value: fmtS(profile.outstandingLoanBalance) },
    { label: "Monthly Instalment",       value: profile.monthlyLoanInstalment ? `${fmtS(profile.monthlyLoanInstalment)}/mo` : "—" },
  ];

  return (
    <div className="space-y-3">
      {/* HDB flat info (if from Myinfo) */}
      {profile.hdbFlat && (
        <div className="text-[10px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          <span className="font-medium text-slate-700">{profile.hdbFlat.type}</span>
          {profile.hdbFlat.address && ` · ${profile.hdbFlat.address}`}
        </div>
      )}

      {/* CPF & HDB data rows */}
      <div className="divide-y divide-slate-100">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between items-center py-1.5">
            <span className="text-[11px] text-slate-500">{label}</span>
            <span className="text-[11px] font-semibold text-slate-800">{value}</span>
          </div>
        ))}
      </div>

      {/* Affordability summary */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-indigo-800">Upgrade Affordability</p>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${scoreColor}`}>
            {aff.score}/100
          </span>
        </div>
        <div className="space-y-1">
          {[
            { label: "Net cash after selling",   value: fmtSK(aff.netCash) },
            { label: "Available for down pmt",   value: fmtSK(aff.availableForDownPayment) },
            { label: "Monthly CPF surplus",      value: aff.surplusMonthly > 0 ? `${fmtS(aff.surplusMonthly)}/mo` : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <span className="text-[10px] text-indigo-600">{label}</span>
              <span className="text-[10px] font-semibold text-indigo-900">{value}</span>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-indigo-400 leading-relaxed">
          Down payment = Net cash after selling + CPF OA balance.
          Estimates only — consult your HDB or bank for exact figures.
        </p>
      </div>

      <button
        onClick={onEdit}
        className="w-full text-[11px] text-slate-400 hover:text-indigo-600 transition-colors py-1"
      >
        Edit manually
      </button>
    </div>
  );
}
