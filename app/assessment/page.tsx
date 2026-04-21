"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const HDB_TOWNS = [
  "Ang Mo Kio", "Bedok", "Bishan", "Bukit Batok", "Bukit Merah",
  "Bukit Panjang", "Bukit Timah", "Central Area", "Choa Chu Kang",
  "Clementi", "Geylang", "Hougang", "Jurong East", "Jurong West",
  "Kallang/Whampoa", "Marine Parade", "Pasir Ris", "Punggol",
  "Queenstown", "Sembawang", "Sengkang", "Serangoon", "Tampines",
  "Toa Payoh", "Woodlands", "Yishun",
];

const FLAT_TYPES = ["3-Room", "4-Room", "5-Room", "Executive"];

export default function AssessmentPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    flatType: "",
    town: "",
    estimatedValue: "",
    remainingLoan: "",
    myIncome: "",
    wifeIncome: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
  }

  function validate() {
    const newErrors: Record<string, string> = {};
    if (!form.flatType) newErrors.flatType = "Please select a flat type";
    if (!form.town) newErrors.town = "Please select your town";
    if (!form.estimatedValue || Number(form.estimatedValue) <= 0)
      newErrors.estimatedValue = "Enter a valid estimated value";
    if (!form.myIncome || Number(form.myIncome) <= 0)
      newErrors.myIncome = "Enter your monthly income";
    return newErrors;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    const params = new URLSearchParams({
      flatType: form.flatType,
      town: form.town,
      estimatedValue: form.estimatedValue,
      remainingLoan: form.remainingLoan || "0",
      myIncome: form.myIncome,
      wifeIncome: form.wifeIncome || "0",
    });
    router.push(`/results?${params.toString()}`);
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-8">
          <a href="/" className="text-sm text-blue-600 hover:underline">
            ← Back
          </a>
          <h1 className="text-2xl font-bold text-gray-900 mt-3">
            Your Property Details
          </h1>
          <p className="text-gray-500 mt-1">
            Fill in your current situation — we&apos;ll crunch the numbers for you.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Current Flat */}
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-semibold text-gray-800 text-lg">🏠 Current Flat</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Flat Type
              </label>
              <select
                name="flatType"
                value={form.flatType}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select flat type</option>
                {FLAT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {errors.flatType && <p className="text-red-500 text-xs mt-1">{errors.flatType}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Town / Estate
              </label>
              <select
                name="town"
                value={form.town}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select town</option>
                {HDB_TOWNS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {errors.town && <p className="text-red-500 text-xs mt-1">{errors.town}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estimated Current Value (S$)
              </label>
              <input
                type="number"
                name="estimatedValue"
                value={form.estimatedValue}
                onChange={handleChange}
                placeholder="e.g. 450000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.estimatedValue && <p className="text-red-500 text-xs mt-1">{errors.estimatedValue}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Remaining HDB Loan (S$){" "}
                <span className="text-gray-400 font-normal">— optional</span>
              </label>
              <input
                type="number"
                name="remainingLoan"
                value={form.remainingLoan}
                onChange={handleChange}
                placeholder="e.g. 150000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* Section 2: Household Income */}
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-semibold text-gray-800 text-lg">💰 Household Income</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your Monthly Income (S$)
              </label>
              <input
                type="number"
                name="myIncome"
                value={form.myIncome}
                onChange={handleChange}
                placeholder="e.g. 5000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.myIncome && <p className="text-red-500 text-xs mt-1">{errors.myIncome}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Wife&apos;s Monthly Income (S$){" "}
                <span className="text-gray-400 font-normal">— optional</span>
              </label>
              <input
                type="number"
                name="wifeIncome"
                value={form.wifeIncome}
                onChange={handleChange}
                placeholder="e.g. 4000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {(form.myIncome || form.wifeIncome) && (
              <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm text-blue-800">
                Combined household income:{" "}
                <strong>
                  S${(
                    (Number(form.myIncome) || 0) + (Number(form.wifeIncome) || 0)
                  ).toLocaleString()}
                  /month
                </strong>
              </div>
            )}
          </section>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition-colors text-lg"
          >
            See My Options →
          </button>
        </form>
      </div>
    </main>
  );
}
