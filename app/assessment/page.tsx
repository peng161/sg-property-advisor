"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const FLAT_TYPES = [
  { value: "3-Room",    label: "3-Room",    sub: "2 bed · ~67 sqm" },
  { value: "4-Room",    label: "4-Room",    sub: "3 bed · ~95 sqm" },
  { value: "5-Room",    label: "5-Room",    sub: "3 bed · ~118 sqm" },
  { value: "Executive", label: "Executive", sub: "3 bed + study" },
];

const CITIZENSHIPS = [
  { value: "SC",        label: "🇸🇬 Citizen",  sub: "Singapore Citizen" },
  { value: "PR",        label: "🟢 PR",         sub: "Permanent Resident" },
  { value: "Foreigner", label: "🌏 Foreigner",  sub: "60% ABSD applies" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS  = Array.from({ length: CURRENT_YEAR - 1979 }, (_, i) => CURRENT_YEAR - i);
const SQM_DEFAULTS: Record<string, string> = {
  "3-Room": "67", "4-Room": "95", "5-Room": "118", "Executive": "145",
};

function rawNum(v: string) { return v.replace(/,/g, ""); }
function addCommas(v: string) {
  const d = v.replace(/\D/g, "");
  return d ? Number(d).toLocaleString("en-SG") : "";
}

const inputCls =
  "w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-slate-900 " +
  "placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 " +
  "focus:border-transparent transition-all text-sm";
const selectCls =
  "w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-slate-900 " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent " +
  "transition-all text-sm appearance-none";

interface GeoState { address: string; town: string; loading: boolean }

export default function AssessmentPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [geo, setGeo] = useState<GeoState>({ address: "", town: "", loading: false });
  const [form, setForm] = useState({
    postalCode:    "",
    flatType:      "",
    floor:         "",
    sqm:           "",
    purchasePrice: "",
    purchaseYear:  "",
    remainingLoan: "",
    cpfUsed:       "",
    leaseCommencementYear: "",   // lease commence year (auto-detected or user-entered)
    citizenship:   "",
    sellingFirst:  "yes",
    myIncome:      "",
    wifeIncome:    "",
    numChildren:   "0",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── handlers ──
  function set(key: string, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }
  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) { set(e.target.name, e.target.value); }
  function handleMoney(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((f) => ({ ...f, [e.target.name]: addCommas(e.target.value) }));
    setErrors((er) => ({ ...er, [e.target.name]: "" }));
  }
  function handleNum(e: React.ChangeEvent<HTMLInputElement>) {
    set(e.target.name, e.target.value.replace(/\D/g, ""));
  }

  // ── postal code auto-geocode ──
  async function handlePostalBlur() {
    const postal = form.postalCode.replace(/\D/g, "");
    if (postal.length !== 6) return;
    setGeo({ address: "", town: "", loading: true });
    try {
      const res = await fetch(
        `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postal}&returnGeom=N&getAddrDetails=Y&pageNum=1`
      );
      const json = await res.json();
      const r = json?.results?.[0];
      if (r) {
        const road = (r.ROAD_NAME as string) ?? "";
        const town = roadToTown(road.toUpperCase());
        setGeo({ address: r.ADDRESS ?? "", town, loading: false });
        setForm((f) => ({ ...f, postalCode: postal }));
        setErrors((er) => ({ ...er, postalCode: "" }));
      } else {
        setGeo({ address: "", town: "", loading: false });
      }
    } catch {
      setGeo({ address: "", town: "", loading: false });
    }
  }

  // ── validation ──
  function validateStep1() {
    const e: Record<string, string> = {};
    if (!/^\d{6}$/.test(form.postalCode))
      e.postalCode    = "Enter a valid 6-digit postal code";
    if (!form.flatType)
      e.flatType      = "Select your flat type";
    if (!form.purchasePrice || Number(rawNum(form.purchasePrice)) <= 0)
      e.purchasePrice = "Enter your purchase price";
    if (!form.purchaseYear)
      e.purchaseYear  = "Select purchase year";
    return e;
  }
  function validateStep2() {
    const e: Record<string, string> = {};
    if (!form.citizenship)
      e.citizenship   = "Select your citizenship";
    if (!form.myIncome || Number(rawNum(form.myIncome)) <= 0)
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
    const p = new URLSearchParams({
      postalCode:    form.postalCode,
      town:          geo.town,
      flatType:      form.flatType,
      floor:         form.floor         || "10",
      sqm:           form.sqm           || "0",
      leaseCommencementYear: form.leaseCommencementYear || "0",
      purchasePrice: rawNum(form.purchasePrice),
      purchaseYear:  form.purchaseYear,
      remainingLoan: rawNum(form.remainingLoan) || "0",
      cpfUsed:       rawNum(form.cpfUsed)       || "0",
      citizenship:   form.citizenship,
      sellingFirst:  form.sellingFirst,
      myIncome:      rawNum(form.myIncome),
      wifeIncome:    rawNum(form.wifeIncome)     || "0",
      numChildren:   form.numChildren            || "0",
    });
    router.push(`/results?${p.toString()}`);
  }

  const combinedIncome =
    (Number(rawNum(form.myIncome)) || 0) + (Number(rawNum(form.wifeIncome)) || 0);

  return (
    <main className="min-h-screen bg-[#eef2ff]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/75 backdrop-blur-md border-b border-white/50 px-4 sm:px-6 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-black tracking-tighter">SG</span>
            </div>
            <Link href="/" className="font-bold text-neutral-900 text-sm">SG Property Advisor</Link>
          </div>
          {/* Step indicators */}
          <div className="flex items-center gap-2">
            {[{ n: 1, label: "Your Flat" }, { n: 2, label: "Profile" }].map(({ n, label }) => (
              <div key={n} className="flex items-center gap-1.5">
                {n > 1 && <div className={`w-6 sm:w-10 h-px ${step >= n ? "bg-indigo-500" : "bg-neutral-200"}`} />}
                <div className={`flex items-center gap-1.5 ${step >= n ? "text-indigo-500" : "text-neutral-400"}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    step >= n ? "bg-indigo-500 text-white" : "bg-neutral-200 text-neutral-400"
                  }`}>{n}</span>
                  <span className="hidden sm:inline text-xs font-medium">{label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">

        {/* ── STEP 1: Your Flat ── */}
        {step === 1 && (
          <>
            <div className="mb-6">
              <h1 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight">Your current flat</h1>
              <p className="text-neutral-500 text-sm mt-1">Enter your postal code — we'll find nearby prices automatically</p>
            </div>

            <div className="space-y-5">

              {/* Postal code */}
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-2">
                  Postal Code
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    name="postalCode"
                    value={form.postalCode}
                    maxLength={6}
                    onChange={(e) => set("postalCode", e.target.value.replace(/\D/g, ""))}
                    onBlur={handlePostalBlur}
                    placeholder="e.g. 120123"
                    className={`${inputCls} pr-10`}
                  />
                  {geo.loading && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">
                      Looking up…
                    </span>
                  )}
                </div>
                {errors.postalCode && <p className="text-red-500 text-xs mt-1">{errors.postalCode}</p>}
                {geo.address && !errors.postalCode && (
                  <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-2xl px-3 py-2 flex items-start gap-2">
                    <span className="text-indigo-500 text-sm mt-0.5">✓</span>
                    <div>
                      <p className="text-xs font-semibold text-indigo-700">{geo.address}</p>
                      {geo.town && (
                        <p className="text-xs text-indigo-600 mt-0.5">Town: {geo.town}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Flat type tiles */}
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-2">Flat Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {FLAT_TYPES.map((ft) => (
                    <button key={ft.value} type="button"
                      onClick={() => {
                        set("flatType", ft.value);
                        if (!form.sqm) set("sqm", SQM_DEFAULTS[ft.value] ?? "");
                      }}
                      className={`text-left rounded-2xl border-2 px-4 py-3 transition-all min-h-[56px]
                        ${form.flatType === ft.value
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                      <div className={`font-bold text-sm ${form.flatType === ft.value ? "text-indigo-700" : "text-neutral-900"}`}>
                        {ft.label}
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5">{ft.sub}</div>
                    </button>
                  ))}
                </div>
                {errors.flatType && <p className="text-red-500 text-xs mt-1">{errors.flatType}</p>}
              </div>

              {/* Floor + sqm */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-2">Floor Level</label>
                  <input
                    type="text" inputMode="numeric" name="floor"
                    value={form.floor} onChange={handleNum}
                    placeholder="e.g. 12"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-2">Floor Area (sqm)</label>
                  <input
                    type="text" inputMode="numeric" name="sqm"
                    value={form.sqm} onChange={handleNum}
                    placeholder={SQM_DEFAULTS[form.flatType] ?? "95"}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Lease commencement year */}
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-1">
                  Lease Commencement Year <OptLabel />
                </label>
                <input
                  type="text" inputMode="numeric" name="leaseCommencementYear"
                  value={form.leaseCommencementYear}
                  onChange={(e) => set("leaseCommencementYear", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="e.g. 1995"
                  className={inputCls}
                />
                <p className="text-xs text-neutral-400 mt-1">
                  Found on your HDB title deed or MyHDBPage. Auto-detected from postal code when possible.
                </p>
              </div>

              {/* Purchase price + year */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-2">Purchase Price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="purchasePrice"
                      value={form.purchasePrice} onChange={handleMoney}
                      placeholder="350,000" className={`${inputCls} pl-8`} />
                  </div>
                  {errors.purchasePrice && <p className="text-red-500 text-xs mt-1">{errors.purchasePrice}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-2">Year Bought</label>
                  <div className="relative">
                    <select name="purchaseYear" value={form.purchaseYear} onChange={handleSelect} className={selectCls}>
                      <option value="">Year</option>
                      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <ChevronDown />
                  </div>
                  {errors.purchaseYear && <p className="text-red-500 text-xs mt-1">{errors.purchaseYear}</p>}
                </div>
              </div>

              {/* Loan + CPF */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-1">
                    Remaining Loan <OptLabel />
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="remainingLoan"
                      value={form.remainingLoan} onChange={handleMoney}
                      placeholder="150,000" className={`${inputCls} pl-8`} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-1">
                    CPF Used <OptLabel />
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="cpfUsed"
                      value={form.cpfUsed} onChange={handleMoney}
                      placeholder="80,000" className={`${inputCls} pl-8`} />
                  </div>
                </div>
              </div>

              <button type="button" onClick={handleNext}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl transition-colors flex items-center justify-center gap-2 mt-2 text-sm shadow-lg shadow-indigo-400/20">
                Next: Your Profile
                <ArrowRight />
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: Profile ── */}
        {step === 2 && (
          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <button type="button" onClick={() => setStep(1)}
                className="text-sm text-neutral-500 hover:text-neutral-700 mb-3 flex items-center gap-1 py-1">
                <ChevronLeft /> Back
              </button>
              <h1 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight">Your profile</h1>
              <p className="text-neutral-500 text-sm mt-1">Affects ABSD, loan limits, and EC eligibility</p>
            </div>

            {/* Flat summary */}
            {(form.flatType || geo.address) && (
              <div className="bg-neutral-900 rounded-2xl px-4 py-3 mb-6">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <div className="text-sm">
                    {form.flatType && <span className="text-white font-bold">{form.flatType} HDB</span>}
                    {geo.town && <span className="text-neutral-400 ml-2">{geo.town}</span>}
                  </div>
                  {form.purchasePrice && (
                    <span className="text-indigo-400 font-semibold text-sm">
                      Bought S${form.purchasePrice}
                      {form.purchaseYear && ` in ${form.purchaseYear}`}
                    </span>
                  )}
                </div>
                {geo.address && (
                  <p className="text-neutral-500 text-xs mt-1 truncate">{geo.address}</p>
                )}
              </div>
            )}

            <div className="space-y-5">
              {/* Citizenship */}
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-2">Citizenship Status</label>
                <div className="grid grid-cols-3 gap-2">
                  {CITIZENSHIPS.map((c) => (
                    <button key={c.value} type="button"
                      onClick={() => set("citizenship", c.value)}
                      className={`text-left rounded-2xl border-2 px-3 py-3 transition-all min-h-[64px]
                        ${form.citizenship === c.value
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                      <div className={`font-bold text-xs leading-tight ${form.citizenship === c.value ? "text-indigo-700" : "text-neutral-900"}`}>
                        {c.label}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1 leading-tight">{c.sub}</div>
                    </button>
                  ))}
                </div>
                {errors.citizenship && <p className="text-red-500 text-xs mt-1">{errors.citizenship}</p>}
              </div>

              {/* Selling first */}
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-2">
                  Sell current HDB before buying next?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: "yes", label: "Yes — sell first",  sub: "Lower ABSD risk" },
                    { v: "no",  label: "No — buy first",    sub: "ABSD may apply" },
                  ].map((opt) => (
                    <button key={opt.v} type="button"
                      onClick={() => set("sellingFirst", opt.v)}
                      className={`text-left rounded-2xl border-2 px-4 py-3 transition-all min-h-[56px]
                        ${form.sellingFirst === opt.v
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                      <div className={`font-bold text-sm ${form.sellingFirst === opt.v ? "text-indigo-700" : "text-neutral-900"}`}>
                        {opt.label}
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Number of children */}
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-1">
                  Number of children
                  <span className="text-neutral-400 font-normal ml-1 text-xs">helps us recommend room size</span>
                </label>
                <div className="grid grid-cols-6 gap-1.5">
                  {["0", "1", "2", "3", "4", "5+"].map((n) => (
                    <button key={n} type="button"
                      onClick={() => set("numChildren", n)}
                      className={`rounded-2xl border-2 py-3 font-bold text-sm transition-all
                        ${form.numChildren === n
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                          : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-300"
                        }`}>
                      {n}
                    </button>
                  ))}
                </div>
                {Number(form.numChildren) >= 3 && (
                  <p className="text-xs text-indigo-600 mt-1.5">
                    We&apos;ll default to 3BR/4BR options — ideal for your family size
                  </p>
                )}
              </div>

              {/* Incomes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-2">Your Monthly Income</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="myIncome"
                      value={form.myIncome} onChange={handleMoney}
                      placeholder="5,000" className={`${inputCls} pl-8`} />
                  </div>
                  {errors.myIncome && <p className="text-red-500 text-xs mt-1">{errors.myIncome}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-2">
                    Spouse Income <OptLabel />
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">S$</span>
                    <input type="text" inputMode="numeric" name="wifeIncome"
                      value={form.wifeIncome} onChange={handleMoney}
                      placeholder="4,000" className={`${inputCls} pl-8`} />
                  </div>
                </div>
              </div>

              {combinedIncome > 0 && (
                <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-indigo-700 font-medium">Combined household income</span>
                  <span className="text-indigo-700 font-bold text-sm">
                    S${combinedIncome.toLocaleString("en-SG")}
                    <span className="font-normal text-xs">/mo</span>
                  </span>
                </div>
              )}

              <button type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-400/20 text-sm">
                See My Upgrade Options
                <ArrowRight />
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

// ── Small reusable helpers ──

function OptLabel() {
  return <span className="text-neutral-400 font-normal ml-1 text-xs">optional</span>;
}
function ChevronDown() {
  return (
    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
function ChevronLeft() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  );
}

// ── Road name → HDB town (client-side copy, mirrors lib/geocode.ts) ──
function roadToTown(road: string): string {
  if (road.includes("ANG MO KIO"))    return "Ang Mo Kio";
  if (road.includes("BEDOK") || road.includes("NEW UPPER CHANGI") || road.includes("CHAI CHEE")) return "Bedok";
  if (road.includes("BISHAN") || road.includes("MARYMOUNT"))  return "Bishan";
  if (road.includes("BUKIT BATOK"))   return "Bukit Batok";
  if (road.includes("BUKIT MERAH") || road.includes("QUEENSWAY") || road.includes("HENDERSON") || road.includes("REDHILL") || road.includes("DEPOT")) return "Bukit Merah";
  if (road.includes("BUKIT PANJANG") || road.includes("PETIR") || road.includes("SEGAR") || road.includes("BANGKIT") || road.includes("FAJAR")) return "Bukit Panjang";
  if (road.includes("BUKIT TIMAH") || road.includes("TOH YI") || road.includes("CASHEW")) return "Bukit Timah";
  if (road.includes("CHOA CHU KANG") || road.includes("KEAT HONG") || road.includes("YEW TEE")) return "Choa Chu Kang";
  if (road.includes("CLEMENTI") || road.includes("WEST COAST") || road.includes("JALAN LEMPENG")) return "Clementi";
  if (road.includes("GEYLANG") || road.includes("ALJUNIED") || road.includes("EUNOS") || road.includes("SIMS") || road.includes("HAIG")) return "Geylang";
  if (road.includes("HOUGANG"))       return "Hougang";
  if (road.includes("JURONG EAST") || road.includes("BOON LAY AVE")) return "Jurong East";
  if (road.includes("JURONG WEST") || road.includes("CORPORATION") || road.includes("BOON LAY WAY")) return "Jurong West";
  if (road.includes("KALLANG") || road.includes("WHAMPOA") || road.includes("BOON KENG") || road.includes("CRAWFORD")) return "Kallang/Whampoa";
  if (road.includes("MARINE PARADE") || road.includes("JOO CHIAT") || road.includes("SIGLAP")) return "Marine Parade";
  if (road.includes("PASIR RIS") || road.includes("ELIAS")) return "Pasir Ris";
  if (road.includes("PUNGGOL") || road.includes("SUMANG") || road.includes("EDGEDALE") || road.includes("NORTHSHORE")) return "Punggol";
  if (road.includes("MARGARET") || road.includes("STIRLING") || road.includes("COMMONWEALTH") || road.includes("DOVER")) return "Queenstown";
  if (road.includes("SEMBAWANG") || road.includes("CANBERRA")) return "Sembawang";
  if (road.includes("SENGKANG") || road.includes("COMPASSVALE") || road.includes("RIVERVALE") || road.includes("ANCHORVALE")) return "Sengkang";
  if (road.includes("SERANGOON") || road.includes("LORONG LEW LIAN") || road.includes("UPPER SERANGOON")) return "Serangoon";
  if (road.includes("TAMPINES"))      return "Tampines";
  if (road.includes("TOA PAYOH") || road.includes("KIM KEAT")) return "Toa Payoh";
  if (road.includes("WOODLANDS") || road.includes("MARSILING") || road.includes("ADMIRALTY")) return "Woodlands";
  if (road.includes("YISHUN"))        return "Yishun";
  if (road.includes("OUTRAM") || road.includes("CANTONMENT") || road.includes("TANJONG PAGAR")) return "Central Area";
  return "";
}
