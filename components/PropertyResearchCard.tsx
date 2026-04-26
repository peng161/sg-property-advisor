"use client";

import { useState } from "react";
import type { ResearchResult } from "@/lib/services/propertyResearchService";

interface Props {
  initialProjectName?: string;
  unitType?:           string;
  targetPsf?:          number;
  onEstimate?:         (result: ResearchResult | null) => void;
}

function ConfidenceBadge({ confidence }: { confidence: "High" | "Medium" | "Low" }) {
  const map = {
    High:   "bg-emerald-100 text-emerald-700 border-emerald-200",
    Medium: "bg-amber-100   text-amber-700   border-amber-200",
    Low:    "bg-slate-100   text-slate-500   border-slate-200",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[confidence]}`}>
      {confidence} confidence
    </span>
  );
}

function PsfFlag({
  targetPsf,
  low,
  high,
}: {
  targetPsf: number;
  low: number;
  high: number;
}) {
  if (!targetPsf || !low || !high) return null;
  if (targetPsf > high) {
    return (
      <div className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mt-2">
        Your target S${targetPsf.toLocaleString("en-SG")} psf is above the estimated high of
        S${high.toLocaleString("en-SG")} psf — potentially overpriced vs market.
      </div>
    );
  }
  if (targetPsf >= low) {
    return (
      <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5 mt-2">
        Your target S${targetPsf.toLocaleString("en-SG")} psf is within the estimated market
        range (S${low.toLocaleString("en-SG")}–S${high.toLocaleString("en-SG")} psf).
      </div>
    );
  }
  return (
    <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5 mt-2">
      Your target S${targetPsf.toLocaleString("en-SG")} psf is below the estimated market low —
      double-check the unit size or price.
    </div>
  );
}

export default function PropertyResearchCard({
  initialProjectName = "",
  unitType = "any",
  targetPsf = 0,
  onEstimate,
}: Props) {
  const [projectName, setProjectName] = useState(initialProjectName);
  const [result,      setResult]      = useState<ResearchResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function handleResearch(forceRefresh = false) {
    const name = projectName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/research-property", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ projectName: name, unitType, targetPsf, forceRefresh }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as ResearchResult;
      setResult(data);
      onEstimate?.(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
      onEstimate?.(null);
    } finally {
      setLoading(false);
    }
  }

  const hasData = result && (result.estimated_psf_mid > 0 || result.confidence === "Low");

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <span className="text-sm">🔍</span>
        <h3 className="text-sm font-semibold text-slate-800">Estimated Current PSF</h3>
        <span className="text-[10px] text-slate-400">AI research</span>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleResearch()}
            placeholder="e.g. Parc Riviera"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-slate-400"
          />
          <button
            onClick={() => handleResearch()}
            disabled={loading || !projectName.trim()}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {loading ? "…" : "Research"}
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {hasData && result && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-700">{result.project_name}</p>
              <ConfidenceBadge confidence={result.confidence} />
            </div>

            {result.estimated_psf_mid > 0 ? (
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "Low",  value: result.estimated_psf_low },
                  { label: "Mid",  value: result.estimated_psf_mid,  highlight: true },
                  { label: "High", value: result.estimated_psf_high },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className={`rounded-lg p-2 ${highlight ? "bg-indigo-50 border border-indigo-200" : "bg-slate-50 border border-slate-100"}`}>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wide">{label}</p>
                    <p className={`text-sm font-bold ${highlight ? "text-indigo-700" : "text-slate-700"}`}>
                      {value > 0 ? `$${value.toLocaleString("en-SG")}` : "—"}
                    </p>
                    <p className="text-[9px] text-slate-400">psf</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No PSF data retrieved — see notes below</p>
            )}

            {targetPsf > 0 && result.estimated_psf_mid > 0 && (
              <PsfFlag
                targetPsf={targetPsf}
                low={result.estimated_psf_low}
                high={result.estimated_psf_high}
              />
            )}

            <div className="text-[10px] text-slate-400 space-y-0.5">
              <p className="font-medium text-slate-500">Basis: {result.price_basis}</p>
              {result.notes.map((n, i) => (
                <p key={i}>• {n}</p>
              ))}
            </div>

            {result.sources.length > 0 && (
              <div className="text-[10px] text-slate-400">
                Sources: {result.sources.map((s, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    {s.startsWith("http") ? (
                      <a href={s} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">
                        {new URL(s).hostname}
                      </a>
                    ) : s}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <p className="text-[9px] text-slate-300">
                Checked: {new Date(result.checked_at).toLocaleDateString("en-SG")}
              </p>
              <button
                onClick={() => handleResearch(true)}
                disabled={loading}
                className="text-[10px] text-indigo-500 hover:text-indigo-700 disabled:opacity-50 transition-colors"
              >
                Refresh estimate
              </button>
            </div>
          </div>
        )}

        {!hasData && !loading && !error && (
          <p className="text-xs text-slate-400">
            Enter a condo project name to research its current PSF range.
            Data comes from our URA database (fast) or AI web research.
          </p>
        )}
      </div>
    </div>
  );
}
