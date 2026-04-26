"use client";

import { useState, useEffect, useRef, useMemo } from "react";

export interface NearbyProject {
  project:        string;
  street:         string;
  district:       string;
  market_segment: string;
  lat:            number;
  lng:            number;
  distance_km:    number;
}

const C = {
  home:  "#4f46e5",
  CCR:   "#6366f1",
  RCR:   "#10b981",
  OCR:   "#f59e0b",
  white: "#ffffff",
  bg:    "#f8fafc",
  text:  "#1e293b",
  muted: "#64748b",
  bord:  "#e2e8f0",
};

function segColor(seg: string): string {
  return (C as Record<string, string>)[seg] ?? "#64748b";
}

function markerIcon(L: typeof import("leaflet"), p: NearbyProject) {
  const color = segColor(p.market_segment);
  return L.divIcon({
    className: "",
    iconSize:  [26, 26],
    iconAnchor:[13, 13],
    html: `<div style="
      width:26px;height:26px;border-radius:50%;
      background:${color};border:2px solid ${C.white};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,.25);
      font-size:9px;font-weight:800;color:${C.white};
    ">${p.market_segment}</div>`,
  });
}

function popupHtml(p: NearbyProject): string {
  const color = segColor(p.market_segment);
  return `
    <div style="font-family:system-ui,sans-serif;min-width:190px;padding:10px 12px;background:${C.bg};border-radius:10px;">
      <div style="font-weight:800;font-size:13px;color:${C.text};margin-bottom:4px;">${p.project}</div>
      <div style="font-size:10px;color:${C.muted};margin-bottom:2px;">📍 ${p.street || "—"}</div>
      <div style="font-size:10px;color:${C.muted};margin-bottom:6px;">District&nbsp;${p.district || "—"}</div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:${color}22;color:${color};">${p.market_segment}</span>
        <span style="font-size:10px;color:${C.home};font-weight:700;">📍&nbsp;${p.distance_km}&nbsp;km</span>
      </div>
    </div>
  `;
}

export default function NearbyCondoMap({ lat, lng }: { lat: number; lng: number }) {
  type RadiusOpt  = 500 | 1000 | 1500;
  type SegFilter  = "All" | "OCR" | "RCR" | "CCR";

  const [radius,    setRadius]    = useState<RadiusOpt>(1500);
  const [segFilter, setSegFilter] = useState<SegFilter>("All");
  const [projects,  setProjects]  = useState<NearbyProject[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<import("leaflet").Map | null>(null);
  const markersRef   = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const listRef      = useRef<HTMLDivElement>(null);

  const hasCoords = lat > 0 && lng > 0;

  // ── Fetch from API whenever radius or location changes ────────────────────
  useEffect(() => {
    if (!hasCoords) return;
    setLoading(true);
    setSelected(null);

    fetch(`/api/nearby-condos?lat=${lat}&lng=${lng}&radius=${radius}`)
      .then((r) => r.json())
      .then((data) => setProjects(Array.isArray(data.projects) ? data.projects : []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [lat, lng, radius, hasCoords]);

  const visibleProjects = useMemo(
    () => segFilter === "All" ? projects : projects.filter((p) => p.market_segment === segFilter),
    [projects, segFilter],
  );

  // ── Build / rebuild Leaflet map ───────────────────────────────────────────
  // Excludes `selected` — selection is handled imperatively without a full rebuild
  useEffect(() => {
    if (!hasCoords || !containerRef.current) return;

    let destroyed = false;

    async function init() {
      const L = (await import("leaflet")).default;

      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css"; link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      if (!document.getElementById("leaflet-ncm-css")) {
        const style = document.createElement("style");
        style.id = "leaflet-ncm-css";
        style.textContent = `
          .leaflet-popup-content-wrapper {
            padding:0!important;border-radius:10px!important;
            border:1px solid ${C.bord}!important;
            box-shadow:0 4px 16px rgba(0,0,0,.1)!important;overflow:hidden!important;
          }
          .leaflet-popup-content { margin:0!important; }
          .leaflet-popup-tip { background:${C.bg}!important; }
        `;
        document.head.appendChild(style);
      }

      if (destroyed || !containerRef.current) return;

      // Tear down old instance
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersRef.current.clear();

      const map = L.map(containerRef.current, { center: [lat, lng], zoom: 15 });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      // Radius circle
      L.circle([lat, lng], {
        radius,
        color: C.home, weight: 1.5, opacity: 0.4,
        fillColor: C.home, fillOpacity: 0.04,
        dashArray: "6 4",
      }).addTo(map);

      // Centre / home marker
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          iconSize: [38, 38], iconAnchor: [19, 19],
          html: `<div style="
            width:38px;height:38px;border-radius:50%;
            background:${C.home};border:3px solid ${C.white};
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 2px 8px rgba(79,70,229,.45);font-size:18px;
          ">🏠</div>`,
        }),
        zIndexOffset: 1000,
      }).addTo(map).bindPopup(
        `<div style="font-family:system-ui,sans-serif;padding:8px 12px;font-weight:700;font-size:13px;color:${C.text};">Search Location</div>`,
        { maxWidth: 180 },
      );

      // Project markers
      visibleProjects.forEach((p) => {
        const marker = L.marker([p.lat, p.lng], { icon: markerIcon(L, p) })
          .addTo(map)
          .bindPopup(popupHtml(p), { maxWidth: 240 });

        marker.on("click", () => setSelected(p.project));
        markersRef.current.set(p.project, marker);
      });
    }

    init();

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, radius, visibleProjects]);

  // ── Scroll list to selected item ──────────────────────────────────────────
  useEffect(() => {
    if (!selected || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-project="${CSS.escape(selected)}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  if (!hasCoords) return null;

  const radiusLabel = radius < 1000 ? `${radius}m` : `${radius / 1000}km`;

  return (
    <div>
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        {/* Segment filter */}
        <div className="flex gap-1">
          {(["All", "OCR", "RCR", "CCR"] as const).map((s) => (
            <button key={s} onClick={() => setSegFilter(s)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ${
                segFilter === s
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-slate-200 text-slate-500 hover:border-slate-400"
              }`}>
              {s}
            </button>
          ))}
        </div>

        {/* Radius filter */}
        <div className="flex gap-1">
          {([500, 1000, 1500] as const).map((r) => (
            <button key={r} onClick={() => setRadius(r)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ${
                radius === r
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-slate-200 text-slate-500 hover:border-slate-400"
              }`}>
              {r < 1000 ? `${r}m` : `${r / 1000}km`}
            </button>
          ))}
        </div>

        {!loading && (
          <span className="text-[10px] text-slate-400 ml-auto">
            {visibleProjects.length} project{visibleProjects.length !== 1 ? "s" : ""} within {radiusLabel}
          </span>
        )}
      </div>

      {/* ── Map + list ── */}
      <div className="flex flex-col md:flex-row gap-3">

        {/* Map */}
        <div className="flex-1 rounded-xl border border-slate-200 overflow-hidden" style={{ minHeight: 360 }}>
          <div ref={containerRef} className="w-full" style={{ height: 360 }} />
        </div>

        {/* Sidebar list */}
        <div className="w-full md:w-60 shrink-0 flex flex-col gap-1">
          {loading ? (
            <div className="flex-1 min-h-[120px] flex items-center justify-center text-sm text-slate-400 bg-white rounded-xl border border-slate-200">
              <span className="animate-pulse">Searching nearby private properties…</span>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="flex-1 min-h-[120px] flex items-center justify-center text-center text-slate-400 text-sm bg-white rounded-xl border border-slate-200 px-4 py-8">
              No private condos or ECs found within this radius.
            </div>
          ) : (
            <div
              ref={listRef}
              className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-y-auto"
              style={{ maxHeight: 360 }}
            >
              {visibleProjects.map((p) => {
                const isSelected = p.project === selected;
                const color = segColor(p.market_segment);
                return (
                  <button
                    key={p.project}
                    data-project={p.project}
                    onClick={() => {
                      const next = isSelected ? null : p.project;
                      setSelected(next);
                      if (next && mapRef.current) {
                        mapRef.current.setView([p.lat, p.lng], 16, { animate: true });
                        markersRef.current.get(p.project)?.openPopup();
                      }
                    }}
                    className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-slate-50 ${
                      isSelected ? "bg-indigo-50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white"
                        style={{ background: color }}
                      >
                        {p.market_segment}
                      </span>
                      <div className="min-w-0">
                        <p className={`text-xs font-semibold leading-tight truncate ${isSelected ? "text-indigo-700" : "text-slate-800"}`}>
                          {p.project}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">{p.street || "—"}</p>
                        <p className="text-[10px] text-indigo-500 font-medium mt-0.5">📍 {p.distance_km} km</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          {!loading && visibleProjects.length > 0 && (
            <div className="flex gap-3 flex-wrap px-1 pt-1">
              {(["OCR", "RCR", "CCR"] as const).map((s) => (
                <div key={s} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: segColor(s) }} />
                  <span className="text-[9px] text-slate-500">{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
