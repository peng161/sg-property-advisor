"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { EnrichedProperty } from "@/lib/services/propertyTransactionService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NearbyProject {
  project:        string;
  street:         string;
  district:       string;
  market_segment: string;
  lat:            number;
  lng:            number;
  distance_km:    number;
}

// ── Colours ───────────────────────────────────────────────────────────────────

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

// ── Map icon / popup builders ─────────────────────────────────────────────────

function markerIcon(L: typeof import("leaflet"), seg: string) {
  const color = segColor(seg);
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
    ">${seg}</div>`,
  });
}

function popupHtml(p: NearbyProject, enriched: EnrichedProperty | null): string {
  const color = segColor(p.market_segment);
  const psfLine = enriched?.latest_psf
    ? `<div style="font-size:10px;color:${C.home};font-weight:700;margin-top:4px;">$${enriched.latest_psf.toLocaleString("en-SG")} psf (latest)</div>`
    : "";
  return `
    <div style="font-family:system-ui,sans-serif;min-width:190px;padding:10px 12px;background:${C.bg};border-radius:10px;">
      <div style="font-weight:800;font-size:13px;color:${C.text};margin-bottom:4px;">${p.project}</div>
      <div style="font-size:10px;color:${C.muted};margin-bottom:2px;">📍 ${p.street || "—"}</div>
      <div style="font-size:10px;color:${C.muted};margin-bottom:6px;">District&nbsp;${p.district || "—"}</div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:${color}22;color:${color};">${p.market_segment}</span>
        <span style="font-size:10px;color:${C.home};font-weight:700;">📍&nbsp;${p.distance_km}&nbsp;km</span>
      </div>
      ${psfLine}
    </div>
  `;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EnrichedProperty["transaction_status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    success:  { label: "Updated",  cls: "bg-emerald-100 text-emerald-700" },
    cached:   { label: "Cached",   cls: "bg-slate-100 text-slate-500" },
    no_data:  { label: "No data",  cls: "bg-amber-100 text-amber-700" },
    failed:   { label: "Failed",   cls: "bg-red-100 text-red-600" },
  };
  const { label, cls } = map[status] ?? map.failed;
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

// ── Trend pill ────────────────────────────────────────────────────────────────

function TrendPill({ label }: { label: string }) {
  const map: Record<string, string> = {
    Rising:    "text-emerald-600",
    Stable:    "text-slate-500",
    Softening: "text-red-500",
  };
  const icons: Record<string, string> = { Rising: "↑", Stable: "→", Softening: "↓" };
  const cls  = map[label]  ?? "text-slate-400";
  const icon = icons[label] ?? "";
  return (
    <span className={`font-semibold ${cls}`}>{icon} {label}</span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function NearbyCondoMap({ lat, lng }: { lat: number; lng: number }) {
  type RadiusOpt = 500 | 1000 | 1500;
  type SegFilter = "All" | "OCR" | "RCR" | "CCR";

  // ── Core state ────────────────────────────────────────────────────────────
  const [radius,    setRadius]    = useState<RadiusOpt>(1500);
  const [segFilter, setSegFilter] = useState<SegFilter>("All");
  const [projects,  setProjects]  = useState<NearbyProject[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState<string | null>(null);

  // ── Enrichment state ──────────────────────────────────────────────────────
  const [enrichedMap,     setEnrichedMap]     = useState<Record<string, EnrichedProperty>>({});
  const [enrichingProject, setEnrichingProject] = useState<string | null>(null);
  const [enrichDone,       setEnrichDone]      = useState(false);

  // ── Map refs ──────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<import("leaflet").Map | null>(null);
  const markersRef   = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const listRef      = useRef<HTMLDivElement>(null);

  const hasCoords = lat > 0 && lng > 0;

  // ── 1. Fetch nearby projects from DB ──────────────────────────────────────
  useEffect(() => {
    if (!hasCoords) return;
    setLoading(true);
    setSelected(null);
    setEnrichedMap({});
    setEnrichDone(false);
    setEnrichingProject(null);

    fetch(`/api/nearby-condos?lat=${lat}&lng=${lng}&radius=${radius}`)
      .then((r) => r.json())
      .then((data) => setProjects(Array.isArray(data.projects) ? data.projects : []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [lat, lng, radius, hasCoords]);

  // ── 2. Enrich projects sequentially after fetch ───────────────────────────
  useEffect(() => {
    if (!projects.length) {
      setEnrichDone(true);
      return;
    }

    setEnrichedMap({});
    setEnrichDone(false);
    setEnrichingProject(null);

    let cancelled = false;

    (async () => {
      for (const p of projects) {
        if (cancelled) break;

        setEnrichingProject(p.project);

        try {
          const res = await fetch("/api/private-property/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              properties: [{
                project_name:      p.project,
                address:           p.street,
                postal_code:       "",
                lat:               p.lat,
                lng:               p.lng,
                property_category: "Condominium",
                distance_km:       p.distance_km,
              }],
            }),
          });

          if (res.ok && !cancelled) {
            const data: { results?: EnrichedProperty[] } = await res.json();
            const enriched = data.results?.[0];
            if (enriched) {
              setEnrichedMap((prev) => ({ ...prev, [p.project]: enriched }));
            }
          }
        } catch {
          // Non-fatal — continue with next property
        }

        // Small pause between requests so the browser stays responsive
        if (!cancelled) {
          await new Promise<void>((r) => setTimeout(r, 150));
        }
      }

      if (!cancelled) {
        setEnrichingProject(null);
        setEnrichDone(true);
      }
    })();

    return () => { cancelled = true; };
  }, [projects]);

  const radiusKm = radius / 1000;

  const visibleProjects = useMemo(
    () => projects
      .filter((p) => p.distance_km <= radiusKm)
      .filter((p) => segFilter === "All" || p.market_segment === segFilter),
    [projects, segFilter, radiusKm],
  );

  // ── 3. Build / rebuild Leaflet map ────────────────────────────────────────
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
          .leaflet-popup-content{margin:0!important;}
          .leaflet-popup-tip{background:${C.bg}!important;}
        `;
        document.head.appendChild(style);
      }

      if (destroyed || !containerRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersRef.current.clear();

      const map = L.map(containerRef.current, { center: [lat, lng], zoom: 15 });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      // Radius dashed circle — fit the map view to it with padding
      const circle = L.circle([lat, lng], {
        radius,
        color: C.home, weight: 1.5, opacity: 0.4,
        fillColor: C.home, fillOpacity: 0.04,
        dashArray: "6 4",
      }).addTo(map);
      map.fitBounds(circle.getBounds(), { padding: [24, 24] });

      // Home marker
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          iconSize: [38, 38], iconAnchor: [19, 19],
          html: `<div style="width:38px;height:38px;border-radius:50%;background:${C.home};border:3px solid ${C.white};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(79,70,229,.45);font-size:18px;">🏠</div>`,
        }),
        zIndexOffset: 1000,
      }).addTo(map).bindPopup(
        `<div style="font-family:system-ui,sans-serif;padding:8px 12px;font-weight:700;font-size:13px;color:${C.text};">Search Location</div>`,
        { maxWidth: 180 },
      );

      // Project markers — use snapshot of enrichedMap at init time
      const enrichSnapshot = enrichedMap;
      visibleProjects.forEach((p) => {
        const marker = L.marker([p.lat, p.lng], { icon: markerIcon(L, p.market_segment) })
          .addTo(map)
          .bindPopup(popupHtml(p, enrichSnapshot[p.project] ?? null), { maxWidth: 240 });

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

  // ── 4. Scroll list to selected item ──────────────────────────────────────
  useEffect(() => {
    if (!selected || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-project="${CSS.escape(selected)}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  if (!hasCoords) return null;

  const radiusLabel = radiusKm < 1 ? `${radius}m` : `${radiusKm}km`;
  const enrichedCount = Object.keys(enrichedMap).length;
  const isEnriching   = !!enrichingProject;

  return (
    <div>
      {/* ── Status bar ── */}
      {(isEnriching || (!loading && projects.length > 0)) && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
          isEnriching ? "bg-indigo-50 text-indigo-700 border border-indigo-100" : "bg-slate-50 text-slate-500 border border-slate-100"
        }`}>
          {isEnriching ? (
            <>
              <span className="animate-spin text-sm">⟳</span>
              <span>
                Found {projects.length} condo{projects.length !== 1 ? "s" : ""}.&nbsp;
                Fetching transaction data for <span className="font-semibold">{enrichingProject}</span>…&nbsp;
                <span className="text-indigo-500">({enrichedCount}/{projects.length})</span>
              </span>
            </>
          ) : enrichDone && enrichedCount > 0 ? (
            <>
              <span>✓</span>
              <span>Enriched {enrichedCount}/{projects.length} projects with latest transaction data.</span>
            </>
          ) : null}
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
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
        <div className="w-full md:w-64 shrink-0 flex flex-col gap-1">
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
              style={{ maxHeight: 400 }}
            >
              {visibleProjects.map((p) => {
                const isSelected = p.project === selected;
                const color      = segColor(p.market_segment);
                const enriched   = enrichedMap[p.project];
                const isFetching = enrichingProject === p.project;

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
                    {/* Row 1: segment badge + name + status */}
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white"
                        style={{ background: color }}
                      >
                        {p.market_segment}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className={`text-xs font-semibold leading-tight truncate ${isSelected ? "text-indigo-700" : "text-slate-800"}`}>
                            {p.project}
                          </p>
                          {isFetching ? (
                            <span className="text-[9px] text-indigo-400 animate-pulse shrink-0">fetching…</span>
                          ) : enriched ? (
                            <StatusBadge status={enriched.transaction_status} />
                          ) : null}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">{p.street || "—"}</p>
                        <p className="text-[10px] text-indigo-500 font-medium">📍 {p.distance_km} km</p>
                      </div>
                    </div>

                    {/* Row 2: transaction metrics (if available) */}
                    {enriched && enriched.transaction_status !== "failed" && enriched.transaction_status !== "no_data" && (
                      <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-0.5 pl-7">
                        {enriched.latest_psf != null && (
                          <div>
                            <p className="text-[8px] text-slate-400 leading-none">Latest PSF</p>
                            <p className="text-[10px] font-bold text-slate-700">${enriched.latest_psf.toLocaleString("en-SG")}</p>
                          </div>
                        )}
                        {enriched.median_psf_12m != null && (
                          <div>
                            <p className="text-[8px] text-slate-400 leading-none">12m Median</p>
                            <p className="text-[10px] font-bold text-slate-700">${enriched.median_psf_12m.toLocaleString("en-SG")}</p>
                          </div>
                        )}
                        {enriched.last_12m_transaction_count > 0 && (
                          <div>
                            <p className="text-[8px] text-slate-400 leading-none">12m Txns</p>
                            <p className="text-[10px] font-bold text-slate-700">{enriched.last_12m_transaction_count}</p>
                          </div>
                        )}
                        {enriched.price_trend_label !== "—" && (
                          <div className="col-span-2">
                            <p className="text-[8px] text-slate-400 leading-none">Trend</p>
                            <p className="text-[10px]"><TrendPill label={enriched.price_trend_label} /></p>
                          </div>
                        )}
                        {enriched.liquidity_label !== "—" && (
                          <div>
                            <p className="text-[8px] text-slate-400 leading-none">Liquidity</p>
                            <p className="text-[10px] font-bold text-slate-600">{enriched.liquidity_label}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {enriched?.transaction_status === "no_data" && (
                      <p className="mt-1 pl-7 text-[9px] text-amber-600">No recent transactions found in data source.</p>
                    )}
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
