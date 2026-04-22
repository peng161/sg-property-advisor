"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const HDB_TOWNS = [
  "Ang Mo Kio","Bedok","Bishan","Bukit Batok","Bukit Merah","Bukit Panjang",
  "Bukit Timah","Central Area","Choa Chu Kang","Clementi","Geylang","Hougang",
  "Jurong East","Jurong West","Kallang/Whampoa","Marine Parade","Pasir Ris",
  "Punggol","Queenstown","Sembawang","Sengkang","Serangoon","Tampines",
  "Toa Payoh","Woodlands","Yishun",
];

const FLAT_TYPES = [
  { value: "3-Room",    label: "3-Room",    sub: "2 bedrooms" },
  { value: "4-Room",    label: "4-Room",    sub: "3 bedrooms" },
  { value: "5-Room",    label: "5-Room",    sub: "3 bed (larger)" },
  { value: "Executive", label: "Executive", sub: "3 bed + study" },
];

const CITIZENSHIPS = [
  { value: "SC",       label: "🇸🇬 Citizen",    sub: "Singapore Citizen" },
  { value: "PR",       label: "🟢 PR",           sub: "Permanent Resident" },
  { value: "Foreigner",label: "🌏 Foreigner",    sub: "60% ABSD applies" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1979 }, (_, i) => CURRENT_YEAR - i);
const FLOORS = Array.from({ length: 50 }, (_, i) => i + 1);

// Typical floor area hint per flat type
const SQM_PLACEHOLDER: Record<string, string> = {
  "3-Room":    "e.g. 67",
  "4-Room":    "e.g. 95",
  "5-Room":    "e.g. 118",
  "Executive": "e.g. 145",
};

function rawNumber(v: string) { return v.replace(/,/g, ""); }
function addCommas(v: string) {
  const d = v.replace(/\D/g, "");
  return d ? Number(d).toLocaleString("en-SG") : "";
}

const inputClass =
  "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm";
const selectClass =
  "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm appearance-none";

export default function AssessmentPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    flatType:      "",
    town:          "",
    floor:         "",
    sqm:           "",
    purchasePrice: "",
    purchaseYear:  "",
    remainingLoan: "",
    cpfUsed:       "",
    citizenship:   "",
    sellingFirst:  "yes",
    myIncome:      "",
    wifeIncome:    "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
  }
  function handleMoney(e: React.ChangeEvent<HTMLInputElement>) {
    setForm({ ...form, [e.target.name]: addCommas(e.target.value) });
    setErrors({ ...errors, [e.target.name]: "" });
  }
  function handleNumber(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/\D/g, "");
    setForm({ ...form, [e.target.name]: v });
    setErrors({ ...errors, [e.target.name]: "" });
  }
  function set(key: string, val: string) {
    setForm({ ...form, [key]: val });
    setErrors({ ...errors, [key]: "" });
  }

  function validateStep1() {
    const e: Record<string, string> = {};
    if (!form.flatType)      e.flatType      = "Select your flat type";
    if (!form.town)          e.town          = "Select your town";
    if (!form.purchasePrice || Number(rawNumber(form.purchasePrice)) <= 0)
                             e.purchasePrice = "Enter your purchase price";
    if (!form.purchaseYear)  e.purchaseYear  = "Select purchase year";
    return e;
  }
  function validateStep2() {
    const e: Record<string, string> = {};
    if (!form.citizenship)   e.citizenship   = "Select your citizenship";
    if (!form.myIncome || Number(rawNumber(form.myIncome)) <= 0)
                             e.myIncome      = "Enter your monthly income";
    return e;
  }

  function handleNext() {
    const errs = validateStep1();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setStep(2);
    window.scrollTo(0, 0);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateStep2();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    const params = new URLSearchParams({
      flatType:      form.flatType,
      town:          form.town,
      floor:         form.floor || "10",
      sqm:           form.sqm || "0",
      purchasePrice: rawNumber(form.purchasePrice),
      purchaseYear:  form.purchaseYear,
      remainingLoan: rawNumber(form.remainingLoan) || "0",
      cpfUsed:       rawNumber(form.cpfUsed) || "0",
      citizenship:   form.citizenship,
      sellingFirst:  form.sellingFirst,
      myIncome:      rawNumber(form.myIncome),
      wifeIncome:    rawNumber(form.wifeIncome) || "0",
    });
    router.push(`/results?${params.toString()}`);
  }

  const combinedIncome =
    (Number(rawNumber(form.myIncome)) || 0) +
    (Number(rawNumber(form.wifeIncome)) || 0);

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-base tracking-tight">
          SG Property Advisor
        </Link>
        <div className="flex items-center gap-2 text-sm">
          {[{ n: 1, label: "Your Flat" }, { n: 2, label: "Profile" }].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-1.5">
              {n > 1 && <div className={`w-8 h-px ${step >= n ? "bg-emerald-500" : "bg-slate-700"}`} />}
              <div className={`flex items-center gap-1.5 ${step >= n ? "text-emerald-400" : "text-slate-500"}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${step >= n ? "bg-emerald-500 text-white" : "bg-slate-700 text-slate-400"}`}>{n}</span>
                <span className="hidden sm:inline font-medium">{label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-10">

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-900">Your current flat</h1>
              <p className="text-slate-500 text-sm mt-1">We'll estimate its current market value automatically</p>
            </div>

            <div className="space-y-5">
              {/* Flat type tiles */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Flat Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {FLAT_TYPES.map((ft) => (
                    <button key={ft.value} type="button"
                      onClick={() => set("flatType", ft.value)}
                      className={`text-left rounded-xl border-2 px-4 py-3 transition-all
                        ${form.flatType === ft.value
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"}`}>
                      <div className={`font-semibold text-sm ${form.flatType === ft.value ? "text-emerald-700" : "text-slate-900"}`}>
                        {ft.label}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{ft.sub}</div>
                    </button>
                  ))}
                </div>
                {errors.flatType && <p className="text-red-500 text-xs mt-1">{errors.flatType}</p>}
              </div>

              {/* Town */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Town / Estate</label>
                <div className="relative">
                  <select name="town" value={form.town} onChange={handleSelect} className={selectClass}>
                    <option value="">Select your town</option>
                    {HDB_TOWNS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {errors.town && <p className="text-red-500 text-xs mt-1">{errors.town}</p>}
              </div>

              {/* Floor level + floor area side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Floor Level</label>
                  <div className="relative">
                    <select name="floor" value={form.floor} onChange={handleSelect} className={selectClass}>
                      <option value="">Select floor</option>
                      {FLOORS.map((f) => <option key={f} value={f}>Floor {f}</option>)}
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {errors.floor && <p className="text-red-500 text-xs mt-1">{errors.floor}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Floor Area (sqm)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    name="sqm"
                    value={form.sqm}
                    onChange={handleNumber}
                    placeholder={SQM_PLACEHOLDER[form.flatType] ?? "e.g. 95"}
                    className={inputClass}
                  />
                  {errors.sqm && <p className="text-red-500 text-xs mt-1">{errors.sqm}</p>}
                </div>
              </div>

              {/* Purchase price + year side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Purchase Price
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="purchasePrice"
                      value={form.purchasePrice} onChange={handleMoney}
                      placeholder="350,000"
                      className={`${inputClass} pl-8`} />
                  </div>
                  {errors.purchasePrice && <p className="text-red-500 text-xs mt-1">{errors.purchasePrice}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Year Bought
                  </label>
                  <div className="relative">
                    <select name="purchaseYear" value={form.purchaseYear} onChange={handleSelect} className={selectClass}>
                      <option value="">Year</option>
                      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {errors.purchaseYear && <p className="text-red-500 text-xs mt-1">{errors.purchaseYear}</p>}
                </div>
              </div>

              {/* Remaining loan + CPF used side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Remaining Loan
                    <span className="text-slate-400 font-normal ml-1">— optional</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="remainingLoan"
                      value={form.remainingLoan} onChange={handleMoney}
                      placeholder="150,000"
                      className={`${inputClass} pl-8`} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    CPF Used
                    <span className="text-slate-400 font-normal ml-1">— optional</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="cpfUsed"
                      value={form.cpfUsed} onChange={handleMoney}
                      placeholder="80,000"
                      className={`${inputClass} pl-8`} />
                  </div>
                </div>
              </div>

              <button type="button" onClick={handleNext}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 mt-2">
                Next: Your Profile
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <form onSubmit={handleSubmit}>
            <div className="mb-8">
              <button type="button" onClick={() => setStep(1)}
                className="text-sm text-slate-500 hover:text-slate-700 mb-3 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <h1 className="text-2xl font-bold text-slate-900">Your profile</h1>
              <p className="text-slate-500 text-sm mt-1">Affects ABSD, loan limits, and EC eligibility</p>
            </div>

            {/* Flat summary pill */}
            {form.flatType && form.town && (
              <div className="bg-slate-900 rounded-xl px-4 py-3 flex items-center justify-between mb-6">
                <div className="text-sm">
                  <span className="text-white font-semibold">{form.flatType} HDB</span>
                  <span className="text-slate-400 ml-2">{form.town}</span>
                </div>
                {form.purchasePrice && (
                  <span className="text-emerald-400 font-semibold text-sm">
                    Bought S${form.purchasePrice}
                    {form.purchaseYear && ` in ${form.purchaseYear}`}
                  </span>
                )}
              </div>
            )}

            <div className="space-y-5">
              {/* Citizenship */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Citizenship Status</label>
                <div className="grid grid-cols-3 gap-2">
                  {CITIZENSHIPS.map((c) => (
                    <button key={c.value} type="button"
                      onClick={() => set("citizenship", c.value)}
                      className={`text-left rounded-xl border-2 px-3 py-3 transition-all
                        ${form.citizenship === c.value
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"}`}>
                      <div className={`font-semibold text-xs ${form.citizenship === c.value ? "text-emerald-700" : "text-slate-900"}`}>
                        {c.label}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 leading-tight">{c.sub}</div>
                    </button>
                  ))}
                </div>
                {errors.citizenship && <p className="text-red-500 text-xs mt-1">{errors.citizenship}</p>}
              </div>

              {/* Selling first toggle */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Will you sell your current HDB first?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[{ v: "yes", label: "Yes — sell first", sub: "Lower ABSD risk" },
                    { v: "no",  label: "No — buy first",   sub: "ABSD may apply" }].map((opt) => (
                    <button key={opt.v} type="button"
                      onClick={() => set("sellingFirst", opt.v)}
                      className={`text-left rounded-xl border-2 px-4 py-3 transition-all
                        ${form.sellingFirst === opt.v
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"}`}>
                      <div className={`font-semibold text-sm ${form.sellingFirst === opt.v ? "text-emerald-700" : "text-slate-900"}`}>
                        {opt.label}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Incomes */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Your Monthly Income</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">S$</span>
                  <input type="text" inputMode="numeric" name="myIncome"
                    value={form.myIncome} onChange={handleMoney}
                    placeholder="5,000" className={`${inputClass} pl-8`} />
                </div>
                {errors.myIncome && <p className="text-red-500 text-xs mt-1">{errors.myIncome}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Spouse Monthly Income
                  <span className="text-slate-400 font-normal ml-1">— optional</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">S$</span>
                  <input type="text" inputMode="numeric" name="wifeIncome"
                    value={form.wifeIncome} onChange={handleMoney}
                    placeholder="4,000" className={`${inputClass} pl-8`} />
                </div>
              </div>

              {combinedIncome > 0 && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 flex items-center justify-between">
                  <span className="text-sm text-emerald-700 font-medium">Combined household income</span>
                  <span className="text-emerald-700 font-bold">
                    S${combinedIncome.toLocaleString("en-SG")}
                    <span className="font-normal text-xs">/mo</span>
                  </span>
                </div>
              )}

              <button type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 mt-2 shadow-lg shadow-emerald-500/20">
                See My Upgrade Options
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
