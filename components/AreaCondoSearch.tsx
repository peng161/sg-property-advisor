"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AreaCondoProperty, AreaCondosResponse } from "@/app/api/area-condos/route";
import type { EnrichedProperty } from "@/lib/services/propertyTransactionService";

// ── Colours ───────────────────────────────────────────────────────────────────

const C = {
  home:  "#4f46e5",
  EC:    "#10b981",
  Condo: "#6366f1",
  white: "#ffffff",
  bg:    "#f8fafc",
  text:  "#1e293b",
  muted: "#64748b",
  bord:  "#e2e8f0",
};

function catColor(cat: string) {
  return cat === "EC" ? C.EC : C.Condo;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EnrichedProperty["transaction_status"] }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    success: { label: "Updated",  cls: "bg-emerald-100 text-emerald-700" },
    cached:  { label: "Cached",   cls: "bg-slate-100 text-slate-500" },
    no_data: { label: "No data",  cls: "bg-amber-100 text-amber-700" },
    failed:  { label: "Failed",   cls: "bg-red-100 text-red-600" },
  };
  const { label, cls } = cfg[status] ?? cfg.failed;
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function TrendPill({ label }: { label: string }) {
  const cls   = label === "Rising" ? "text-emerald-600" : label === "Softening" ? "text-red-500" : "text-slate-500";
  const icon  = label === "Rising" ? "↑" : label === "Softening" ? "↓" : "→";
  return <span className={`font-semibold ${cls}`}>{icon} {label}</span>;
}

function CategoryBadge({ cat }: { cat: string }) {
  const bg = cat === "EC" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700";
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${bg}`}>{cat}</span>;
}

// ── Map builder ───────────────────────────────────────────────────────────────

function markerIcon(L: typeof import("leaflet"), cat: string) {
  const color = catColor(cat);
  return L.divIcon({
    className: "",
    iconSize:  [26, 26],
    iconAnchor:[13, 13],
    html: `<div style="
      width:26px;height:26px;border-radius:50%;
      background:${color};border:2px solid ${C.white};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,.25);
      font-size:8px;font-weight:800;color:${C.white};
    ">${cat === "EC" ? "EC" : "C"}</div>`,
  });
}

function popupHtml(p: AreaCondoProperty, enriched: EnrichedProperty | null): string {
  const color = catColor(p.property_category);
  const psfLine = enriched?.latest_psf
    ? `<div style="margin-top:4px;font-size:10px;font-weight:700;color:${C.home};">$${enriched.latest_psf.toLocaleString("en-SG")} psf (latest)</div>`
    : "";
  return `
    <div style="font-family:system-ui,sans-serif;min-width:190px;padding:10px 12px;background:${C.bg};border-radius:10px;">
      <div style="font-weight:800;font-size:13px;color:${C.text};margin-bottom:4px;">${p.project_name}</div>
      <div style="font-size:10px;color:${C.muted};margin-bottom:6px;">📍 ${p.address || "—"}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:${color}22;color:${color};">${p.property_category}</span>
        <span style="font-size:10px;color:${C.home};font-weight:700;">📍 ${p.distance_km} km</span>
        ${p.postal_code ? `<span style="font-size:10px;color:${C.muted};">S(${p.postal_code})</span>` : ""}
      </div>
      ${psfLine}
    </div>
  `;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AreaCondoSearch({ initialPostalCode }: { initialPostalCode?: string } = {}) {
  // ── Search state ──────────────────────────────────────────────────────────
  const [query,       setQuery]       = useState(initialPostalCode ?? "");
  const [radius,      setRadius]      = useState(1500);
  const [catFilter,   setCatFilter]   = useState<"All" | "Condo" | "EC">("All");
  const [searching,   setSearching]   = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Results state ─────────────────────────────────────────────────────────
  const [centre,     setCentre]     = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [properties, setProperties] = useState<AreaCondoProperty[]>([]);
  const [selected,   setSelected]   = useState<string | null>(null);
  const [debugInfo,  setDebugInfo]  = useState<AreaCondosResponse["debug"] | null>(null);
  const [showDebug,  setShowDebug]  = useState(false);

  // ── Enrichment state ──────────────────────────────────────────────────────
  const [enrichedMap,      setEnrichedMap]      = useState<Record<string, EnrichedProperty>>({});
  const [enrichingProject, setEnrichingProject] = useState<string | null>(null);
  const [enrichDone,       setEnrichDone]       = useState(false);

  // ── Map refs ──────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<import("leaflet").Map | null>(null);
  const markersRef   = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const listRef      = useRef<HTMLDivElement>(null);

  const visible = catFilter === "All"
    ? properties
    : properties.filter((p) => p.property_category === catFilter);

  // ── Search handler ────────────────────────────────────────────────────────
  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) return;
    if (overrideQuery) setQuery(overrideQuery);
    setSearching(true);
    setSearchError(null);
    setProperties([]);
    setCentre(null);
    setSelected(null);
    setDebugInfo(null);
    setEnrichedMap({});
    setEnrichDone(false);
    setEnrichingProject(null);

    try {
      const res = await fetch(
        `/api/area-condos?query=${encodeURIComponent(q)}&radius=${radius}`,
      );
      const data: AreaCondosResponse & { error?: string } = await res.json();

      if (!res.ok || data.error) {
        setSearchError(data.error ?? "Search failed. Please try again.");
        return;
      }

      setCentre(data.centre);
      setProperties(data.properties);
      setDebugInfo(data.debug);
    } catch {
      setSearchError("Network error. Please try again.");
    } finally {
      setSearching(false);
    }
  }, [query, radius]);

  // ── Auto-search when pre-populated ───────────────────────────────────────
  useEffect(() => {
    if (initialPostalCode?.trim()) {
      handleSearch(initialPostalCode.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  // ── Enrichment: sequential, one property at a time ────────────────────────
  useEffect(() => {
    if (!properties.length) { setEnrichDone(true); return; }

    setEnrichedMap({});
    setEnrichDone(false);
    setEnrichingProject(null);

    let cancelled = false;

    (async () => {
      for (const p of properties) {
        if (cancelled) break;
        setEnrichingProject(p.project_name);
        try {
          const res = await fetch("/api/private-property/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              properties: [{
                project_name:      p.project_name,
                address:           p.address,
                postal_code:       p.postal_code,
                lat:               p.lat,
                lng:               p.lng,
                property_category: p.property_category,
                distance_km:       p.distance_km,
              }],
            }),
          });
          if (res.ok && !cancelled) {
            const data: { results?: EnrichedProperty[] } = await res.json();
            const enriched = data.results?.[0];
            if (enriched) {
              setEnrichedMap((prev) => ({ ...prev, [p.project_name]: enriched }));
            }
          }
        } catch { /* non-fatal */ }
        if (!cancelled) await new Promise<void>((r) => setTimeout(r, 150));
      }
      if (!cancelled) { setEnrichingProject(null); setEnrichDone(true); }
    })();

    return () => { cancelled = true; };
  }, [properties]);

  // ── Build/rebuild Leaflet map ─────────────────────────────────────────────
  useEffect(() => {
    if (!centre || !containerRef.current) return;

    const centreSnap = centre;
    let destroyed = false;

    async function init() {
      const L = (await import("leaflet")).default;

      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css"; link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      if (!document.getElementById("leaflet-acs-css")) {
        const style = document.createElement("style");
        style.id = "leaflet-acs-css";
        style.textContent = `
          .leaflet-popup-content-wrapper{padding:0!important;border-radius:10px!important;border:1px solid ${C.bord}!important;box-shadow:0 4px 16px rgba(0,0,0,.1)!important;overflow:hidden!important;}
          .leaflet-popup-content{margin:0!important;}
          .leaflet-popup-tip{background:${C.bg}!important;}
        `;
        document.head.appendChild(style);
      }

      if (destroyed || !containerRef.current) return;

      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current.clear();

      const map = L.map(containerRef.current, { center: [centreSnap.lat, centreSnap.lng], zoom: 15 });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd", maxZoom: 19,
      }).addTo(map);

      // Radius circle
      L.circle([centreSnap.lat, centreSnap.lng], {
        radius,
        color: C.home, weight: 1.5, opacity: 0.4,
        fillColor: C.home, fillOpacity: 0.04,
        dashArray: "6 4",
      }).addTo(map);

      // Centre marker
      L.marker([centreSnap.lat, centreSnap.lng], {
        icon: L.divIcon({
          className: "",
          iconSize: [38, 38], iconAnchor: [19, 19],
          html: `<div style="width:38px;height:38px;border-radius:50%;background:${C.home};border:3px solid ${C.white};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(79,70,229,.45);font-size:18px;">📍</div>`,
        }),
        zIndexOffset: 1000,
      }).addTo(map).bindPopup(
        `<div style="font-family:system-ui,sans-serif;padding:8px 12px;font-weight:700;font-size:13px;color:${C.text};">${centreSnap.label}</div>`,
        { maxWidth: 260 },
      );

      // Property markers
      const enrichSnap = enrichedMap;
      visible.forEach((p) => {
        const marker = L.marker([p.lat, p.lng], { icon: markerIcon(L, p.property_category) })
          .addTo(map)
          .bindPopup(popupHtml(p, enrichSnap[p.project_name] ?? null), { maxWidth: 260 });
        marker.on("click", () => setSelected(p.project_name));
        markersRef.current.set(p.project_name, marker);
      });
    }

    init();

    return () => {
      destroyed = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre, radius, visible]);

  // ── Scroll list to selected ───────────────────────────────────────────────
  useEffect(() => {
    if (!selected || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-project="${CSS.escape(selected)}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  const enrichedCount = Object.keys(enrichedMap).length;
  const isEnriching   = !!enrichingProject;

  return (
    <div className="space-y-4">

      {/* ── Search bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Area / MRT / Postal Code / Address
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="e.g. Clementi MRT, 126740, Jurong East, Bishan…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div className="sm:w-40 shrink-0">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Radius
            </label>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value={500}>500 m</option>
              <option value={1000}>1 km</option>
              <option value={1500}>1.5 km</option>
              <option value={2000}>2 km</option>
            </select>
          </div>

          <div className="sm:self-end">
            <button
              onClick={() => handleSearch()}
              disabled={searching || !query.trim()}
              className="w-full sm:w-auto px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </div>

        {/* Error */}
        {searchError && (
          <p className="mt-2 text-xs text-red-500">{searchError}</p>
        )}
      </div>

      {/* ── Enrichment status bar ── */}
      {(isEnriching || (enrichDone && enrichedCount > 0)) && (
        <div className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
          isEnriching
            ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
            : "bg-slate-50 text-slate-500 border border-slate-100"
        }`}>
          {isEnriching ? (
            <>
              <span className="animate-spin text-base">⟳</span>
              <span>
                Found {properties.length} propert{properties.length !== 1 ? "ies" : "y"}.
                &nbsp;Fetching transaction data for{" "}
                <span className="font-semibold">{enrichingProject}</span>…
                &nbsp;<span className="text-indigo-500">({enrichedCount}/{properties.length})</span>
              </span>
            </>
          ) : (
            <span>✓ Enriched {enrichedCount}/{properties.length} properties with latest transaction data.</span>
          )}
        </div>
      )}

      {/* ── Map + list ── */}
      {centre && (
        <div className="space-y-3">

          {/* Count summary + category filter */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Condo / EC counts */}
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shrink-0">
              <span className="text-sm font-black text-indigo-600">
                {properties.filter((p) => p.property_category === "Condo").length}
              </span>
              <span className="text-xs text-slate-500">Condos</span>
              <span className="w-px h-4 bg-slate-200" />
              <span className="text-sm font-black text-emerald-600">
                {properties.filter((p) => p.property_category === "EC").length}
              </span>
              <span className="text-xs text-slate-500">ECs</span>
              <span className="w-px h-4 bg-slate-200" />
              <span className="text-xs text-slate-400">within {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}</span>
            </div>

            {/* Category filter */}
            <div className="flex gap-1">
              {(["All", "Condo", "EC"] as const).map((c) => (
                <button key={c} onClick={() => setCatFilter(c)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ${
                    catFilter === c
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "border-slate-200 text-slate-500 hover:border-slate-400"
                  }`}>
                  {c}
                </button>
              ))}
            </div>

            {/* Debug toggle */}
            {debugInfo && (
              <button
                onClick={() => setShowDebug((v) => !v)}
                className="ml-auto text-[10px] text-slate-400 hover:text-slate-600 underline shrink-0"
              >
                {showDebug ? "Hide debug" : "Debug"}
              </button>
            )}
          </div>

          {/* Debug panel */}
          {showDebug && debugInfo && (
            <div className="bg-slate-900 text-slate-300 rounded-xl text-[11px] font-mono p-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
              <div>
                <p className="text-slate-500 text-[9px] uppercase tracking-wider">Geocoded as</p>
                <p className="text-white font-semibold truncate">{debugInfo.geocoded_label}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[9px] uppercase tracking-wider">OneMap API hits</p>
                <p className="text-white font-semibold">{debugInfo.total_api_results.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[9px] uppercase tracking-wider">Within {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}</p>
                <p className="text-white font-semibold">{debugInfo.within_radius}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[9px] uppercase tracking-wider">After filter</p>
                <p className="text-white font-semibold">{debugInfo.after_filter}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[9px] uppercase tracking-wider">After dedup</p>
                <p className="text-white font-semibold">{debugInfo.after_dedup}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[9px] uppercase tracking-wider">Condos / ECs</p>
                <p className="text-white font-semibold">
                  {properties.filter((p) => p.property_category === "Condo").length} / {properties.filter((p) => p.property_category === "EC").length}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-3">

            {/* Map */}
            <div className="flex-1 rounded-xl border border-slate-200 overflow-hidden" style={{ minHeight: 420 }}>
              {searching ? (
                <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm" style={{ minHeight: 420 }}>
                  <span className="animate-pulse">Searching nearby private properties…</span>
                </div>
              ) : (
                <div ref={containerRef} className="w-full" style={{ height: 420 }} />
              )}
            </div>

            {/* List */}
            <div className="w-full md:w-72 shrink-0 flex flex-col gap-1">
              {visible.length === 0 && !searching ? (
                <div className="flex-1 min-h-[120px] flex items-center justify-center text-center text-slate-400 text-sm bg-white rounded-xl border border-slate-200 px-4 py-8">
                  No private condos or ECs found within this radius.
                </div>
              ) : (
                <div
                  ref={listRef}
                  className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-y-auto"
                  style={{ maxHeight: 420 }}
                >
                  {visible.map((p) => {
                    const isSelected = p.project_name === selected;
                    const enriched   = enrichedMap[p.project_name];
                    const isFetching = enrichingProject === p.project_name;
                    const color      = catColor(p.property_category);

                    return (
                      <button
                        key={`${p.project_name}|${p.postal_code}`}
                        data-project={p.project_name}
                        onClick={() => {
                          const next = isSelected ? null : p.project_name;
                          setSelected(next);
                          if (next && mapRef.current) {
                            mapRef.current.setView([p.lat, p.lng], 16, { animate: true });
                            markersRef.current.get(p.project_name)?.openPopup();
                          }
                        }}
                        className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-slate-50 ${isSelected ? "bg-indigo-50" : ""}`}
                      >
                        {/* Row 1 */}
                        <div className="flex items-start gap-2">
                          <div
                            className="mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black text-white"
                            style={{ background: color }}
                          >
                            {p.property_category === "EC" ? "EC" : "C"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <p className={`text-xs font-semibold leading-tight truncate ${isSelected ? "text-indigo-700" : "text-slate-800"}`}>
                                {p.project_name}
                              </p>
                              {isFetching ? (
                                <span className="text-[9px] text-indigo-400 animate-pulse shrink-0">fetching…</span>
                              ) : enriched ? (
                                <StatusBadge status={enriched.transaction_status} />
                              ) : null}
                            </div>
                            <p className="text-[10px] text-slate-400 truncate">{p.address || "—"}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <CategoryBadge cat={p.property_category} />
                              <span className="text-[10px] text-indigo-500 font-medium">📍 {p.distance_km} km</span>
                              {p.postal_code && (
                                <span className="text-[9px] text-slate-400">S({p.postal_code})</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Row 2: transaction metrics */}
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
              {visible.length > 0 && (
                <div className="flex gap-4 px-1 pt-1 flex-wrap">
                  {(["Condo", "EC"] as const).map((cat) => (
                    <div key={cat} className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full" style={{ background: catColor(cat) }} />
                      <span className="text-[9px] text-slate-500">{cat}</span>
                    </div>
                  ))}
                  <span className="text-[9px] text-slate-400 ml-auto">OneMap · data.gov.sg</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Idle state ── */}
      {!centre && !searching && !searchError && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center gap-3 text-center">
          <span className="text-4xl">🗺️</span>
          <p className="text-sm font-semibold text-slate-600">Search for an area to find nearby condos and ECs</p>
          <p className="text-xs text-slate-400">
            Enter a postal code, MRT station name, address, or town name (e.g. "Tampines", "Dover MRT", "138648")
          </p>
        </div>
      )}
    </div>
  );
}
