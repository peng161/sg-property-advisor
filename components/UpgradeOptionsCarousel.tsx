"use client";

import { useState } from "react";
import type { UpgradeOption } from "@/lib/calculator";

const STYLE: Record<string, { icon: string; bg: string }> = {
  "Stay":          { icon: "🏠", bg: "bg-stone-100"  },
  "Bigger HDB":    { icon: "📈", bg: "bg-sky-50"     },
  "EC":            { icon: "🏙️", bg: "bg-violet-50"  },
  "Private Condo": { icon: "✨", bg: "bg-amber-50"   },
};

function fmt(n: number) { return n.toLocaleString("en-SG"); }

interface Props {
  options:        UpgradeOption[];
  recommendation: string;
  netProceeds:    number;
}

export default function UpgradeOptionsCarousel({ options, recommendation, netProceeds }: Props) {
  const [idx, setIdx] = useState(() => {
    const i = options.findIndex((o) => o.type === recommendation);
    return i >= 0 ? i : 0;
  });
  const [touchX, setTouchX] = useState<number | null>(null);

  const prev = () => setIdx((i) => (i - 1 + options.length) % options.length);
  const next = () => setIdx((i) => (i + 1) % options.length);

  const option = options[idx];
  const style  = STYLE[option.type] ?? STYLE["Stay"];
  const isRec  = option.type === recommendation;
  const costs  = option.costs;

  return (
    <div>
      {/* Label + dot indicators */}
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
          All Options
        </p>
        <div className="flex items-center gap-1.5">
          {options.map((o, i) => (
            <button
              key={o.type}
              onClick={() => setIdx(i)}
              aria-label={o.type}
              className={`rounded-full transition-all ${
                i === idx
                  ? "w-5 h-2 bg-neutral-900"
                  : "w-2 h-2 bg-neutral-300 hover:bg-neutral-400"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Card */}
      <div
        className={`bg-white rounded-3xl overflow-hidden shadow-sm select-none ${
          isRec ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-[#D9E4D7]" : ""
        }`}
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const diff = touchX - e.changedTouches[0].clientX;
          if (Math.abs(diff) > 48) diff > 0 ? next() : prev();
          setTouchX(null);
        }}
      >
        {isRec && (
          <div className="bg-amber-400 px-5 py-1.5">
            <span className="text-white text-[11px] font-bold">★ Recommended for you</span>
          </div>
        )}

        <div className="p-5">
          {/* Option header */}
          <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-2xl ${style.bg} flex items-center justify-center text-xl shrink-0`}
              >
                {style.icon}
              </div>
              <div>
                <h3 className="font-bold text-neutral-900">{option.label}</h3>
                <p className="text-xs text-neutral-400 mt-0.5">{option.priceRange}</p>
              </div>
            </div>
            <span
              className={`text-[11px] font-bold px-3 py-1 rounded-full shrink-0 ${
                option.affordable
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-50 text-red-500"
              }`}
            >
              {option.affordable ? "✓ Affordable" : "✗ Out of range"}
            </span>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-neutral-50 rounded-2xl p-3">
              <p className="text-[10px] text-neutral-400 uppercase tracking-wider mb-1">
                Est. Price
              </p>
              <p className="text-sm font-bold text-neutral-900">{option.priceRange}</p>
            </div>
            <div className="bg-neutral-50 rounded-2xl p-3">
              <p className="text-[10px] text-neutral-400 uppercase tracking-wider mb-1">
                Monthly
              </p>
              <p className="text-sm font-bold text-neutral-900">{option.monthlyRepayment}</p>
            </div>
          </div>

          {/* Upfront cost breakdown */}
          {option.type !== "Stay" && costs.total > 0 && (
            <div className="bg-neutral-50 rounded-2xl overflow-hidden mb-4">
              <div className="px-4 py-2.5 border-b border-neutral-100">
                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                  Upfront Cost Breakdown
                </p>
              </div>
              <div className="px-4 divide-y divide-neutral-100">
                {[
                  { label: "Down payment",   value: costs.downPayment               },
                  { label: "BSD",            value: costs.bsd                       },
                  { label: "ABSD",           value: costs.absd, hi: costs.absd > 0  },
                  { label: "Agent fee (1%)", value: costs.agentFee                  },
                  { label: "Legal fees",     value: costs.legalFee                  },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between py-2">
                    <span className="text-xs text-neutral-400">{r.label}</span>
                    <span
                      className={`text-xs font-semibold ${
                        "hi" in r && r.hi ? "text-orange-500" : "text-neutral-700"
                      }`}
                    >
                      {r.value === 0 ? (
                        <span className="text-neutral-300">—</span>
                      ) : (
                        `S$${fmt(r.value)}`
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-neutral-900 flex justify-between items-center">
                <span className="text-xs font-bold text-white">Total Upfront</span>
                <span
                  className={`text-sm font-black ${
                    netProceeds >= costs.total ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  S${fmt(costs.total)}
                </span>
              </div>
            </div>
          )}

          <p className="text-xs text-neutral-400 leading-relaxed">{option.notes}</p>
        </div>

        {/* Prev / Next */}
        <div className="px-5 pb-5 flex items-center justify-between">
          <button
            onClick={prev}
            className="w-10 h-10 rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors flex items-center justify-center text-neutral-600 font-bold"
          >
            ‹
          </button>
          <span className="text-xs text-neutral-400 font-medium">
            {idx + 1} / {options.length}
          </span>
          <button
            onClick={next}
            className="w-10 h-10 rounded-full bg-neutral-900 hover:bg-neutral-800 transition-colors flex items-center justify-center text-white font-bold"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
