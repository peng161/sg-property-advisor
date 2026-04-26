"use client";

import { useEffect, useRef, useState } from "react";
import type { ExtendedProjectSummary } from "./ResultsDashboard";
import type { AreaCondoProperty } from "@/app/api/area-condos/route";

// ── Theme tokens (match app) ────────────────────────────────────────────────
const C = {
  indigo:   "#4f46e5",
  emerald:  "#10b981",
  violet:   "#7c3aed",
  border:   "#e2e8f0",
  bg:       "#f8fafc",
  text:     "#1e293b",
  muted:    "#64748b",
  white:    "#ffffff",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("en-SG"); }
function fmtM(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

function homeIcon(L: typeof import("leaflet")) {
  return L.divIcon({
    className: "",
    iconSize:  [38, 38],
    iconAnchor:[19, 19],
    html: `<div style="
      width:38px;height:38px;border-radius:50%;
      background:${C.indigo};border:3px solid ${C.white};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(79,70,229,.45);
      font-size:18px;
    ">🏠</div>`,
  });
}

function propIcon(L: typeof import("leaflet"), rank: number, isTop: boolean, isSelected: boolean) {
  const bg   = isSelected ? C.violet : isTop ? C.emerald : C.indigo;
  const size = isSelected ? 34 : 28;
  const half = size / 2;
  return L.divIcon({
    className: "",
    iconSize:  [size, size],
    iconAnchor:[half, half],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};border:2px solid ${C.white};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,.3);
      font-size:${isSelected ? 13 : 11}px;font-weight:800;color:${C.white};
    ">${rank}</div>`,
  });
}

function popupHtml(rank: number, p: ExtendedProjectSummary): string {
  const tenureShort = p.tenure.includes("Freehold") ? "Freehold"
    : p.tenure.includes("999") ? "999-yr" : "99-yr";
  const trendSign  = p.trend3Y >= 0 ? "+" : "";
  const trendColor = p.trend3Y >= 0 ? C.emerald : "#ef4444";
  const scoreBg    = p.propertyScore >= 80 ? C.indigo : p.propertyScore >= 70 ? C.emerald : "#f59e0b";
  return `
    <div style="
      min-width:220px;font-family:system-ui,sans-serif;
      border-radius:12px;overflow:hidden;
    ">
      <div style="background:${C.indigo};padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="
            width:26px;height:26px;border-radius:50%;
            background:${C.white};display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:800;color:${C.indigo};flex-shrink:0;
          ">${rank}</div>
          <div>
            <div style="font-weight:800;font-size:13px;color:${C.white};line-height:1.2;">
              ${p.project}
            </div>
            <div style="font-size:10px;color:rgba(255,255,255,.7);">
              ${p.street}
            </div>
          </div>
        </div>
      </div>
      <div style="background:${C.bg};padding:10px 12px;border:1px solid ${C.border};border-top:none;border-radius:0 0 12px 12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="
            font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;
            background:rgba(79,70,229,.1);color:${C.indigo};
          ">${p.marketSegment} · ${tenureShort}</span>
          <span style="
            font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;
            background:${scoreBg};color:${C.white};
          ">${p.propertyScore}/100</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:10px;">
          <div>
            <div style="color:${C.muted};">Price Range</div>
            <div style="font-weight:700;color:${C.text};">${fmtM(p.minPrice)} – ${fmtM(p.maxPrice)}</div>
          </div>
          <div>
            <div style="color:${C.muted};">Avg PSM</div>
            <div style="font-weight:700;color:${C.text};">$${fmt(p.medianPsm)}</div>
          </div>
          <div>
            <div style="color:${C.muted};">3Y Trend</div>
            <div style="font-weight:700;color:${trendColor};">${trendSign}${p.trend3Y.toFixed(1)}%</div>
          </div>
          ${p.distanceKm !== null ? `
          <div>
            <div style="color:${C.muted};">Distance</div>
            <div style="font-weight:700;color:${C.indigo};">📍 ${p.distanceKm} km</div>
          </div>` : ""}
        </div>
      </div>
    </div>
  `;
}

function legendHtml(): string {
  const items = [
    { color: C.indigo,   label: "Your Home" },
    { color: C.emerald,  label: "Top Ranked" },
    { color: C.indigo,   label: "Recommended" },
    { color: C.violet,   label: "Selected" },
    { color: "#94a3b8",  label: "Condo nearby" },
    { color: C.emerald,  label: "EC nearby" },
  ];
  return `
    <div style="
      background:${C.bg};border:1px solid ${C.border};border-radius:10px;
      padding:8px 10px;font-family:system-ui,sans-serif;
      box-shadow:0 1px 4px rgba(0,0,0,.1);min-width:120px;
    ">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${C.muted};margin-bottom:6px;">
        Legend
      </div>
      ${items.map(({ color, label }) => `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
          <span style="font-size:10px;color:${C.text};">${label}</span>
        </div>
      `).join("")}
    </div>
  `;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface LeafletMapProps {
  lat:              number;
  lng:              number;
  postalCode:       string;
  properties:       ExtendedProjectSummary[];
  nearbyCondos?:    AreaCondoProperty[];
  selectedProject:  string | null;
  onSelectProject:  (project: string) => void;
}

export default function LeafletMap({
  lat, lng, postalCode, properties, nearbyCondos = [], selectedProject, onSelectProject,
}: LeafletMapProps) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<import("leaflet").Map | null>(null);
  const nearbyLayerRef  = useRef<import("leaflet").LayerGroup | null>(null);
  const propertyLayerRef= useRef<import("leaflet").LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(0);

  const hasCoords = lat > 0 && lng > 0;

  // ── Effect 1: Initialize (or destroy + recreate) the Leaflet map ─────────
  // Only rebuilds when the home location / postal code changes.
  // Does NOT depend on nearbyCondos or properties — those are updated below.
  useEffect(() => {
    if (!hasCoords || !containerRef.current) return;

    let destroyed = false;

    async function init() {
      const L = (await import("leaflet")).default;

      // Inject Leaflet CSS once
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id   = "leaflet-css";
        link.rel  = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      // Inject theme CSS overrides once
      if (!document.getElementById("leaflet-theme-css")) {
        const style = document.createElement("style");
        style.id = "leaflet-theme-css";
        style.textContent = `
          .leaflet-popup-content-wrapper {
            padding: 0 !important;
            border-radius: 12px !important;
            border: 1px solid ${C.border} !important;
            box-shadow: 0 4px 16px rgba(0,0,0,.12) !important;
            overflow: hidden !important;
          }
          .leaflet-popup-content { margin: 0 !important; }
          .leaflet-popup-tip { background: ${C.bg} !important; }
          .leaflet-popup-close-button {
            color: ${C.muted} !important; font-size: 16px !important;
            top: 6px !important; right: 8px !important;
          }
          .leaflet-control-zoom a {
            color: ${C.text} !important;
            border-color: ${C.border} !important;
            background: ${C.bg} !important;
          }
          .leaflet-control-zoom a:hover { background: #f1f5f9 !important; }
          .leaflet-control-attribution {
            font-size: 9px !important;
            background: rgba(248,250,252,.8) !important;
            color: ${C.muted} !important;
          }
        `;
        document.head.appendChild(style);
      }

      if (destroyed || !containerRef.current) return;

      // Create map
      const map = L.map(containerRef.current, {
        center:    [lat, lng],
        zoom:      15,
        zoomControl: true,
      });
      mapRef.current = map;

      // CartoDB Positron tiles — free, no API key
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
        subdomains:  "abcd",
        maxZoom:     19,
      }).addTo(map);

      // 1.5 km radius circle
      L.circle([lat, lng], {
        radius:      1500,
        color:       C.indigo,
        weight:      1.5,
        opacity:     0.5,
        fillColor:   C.indigo,
        fillOpacity: 0.05,
        dashArray:   "6 4",
      }).addTo(map);

      // Home marker
      L.marker([lat, lng], { icon: homeIcon(L), zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:system-ui,sans-serif;padding:10px 12px;background:${C.bg};border-radius:12px;">
            <div style="font-weight:800;font-size:13px;color:${C.text};margin-bottom:2px;">Your Home</div>
            <div style="font-size:10px;color:${C.muted};">Postal Code: ${postalCode || "—"}</div>
            <div style="font-size:10px;color:${C.muted};">
              ${lat.toFixed(5)}, ${lng.toFixed(5)}
            </div>
          </div>
        `, { maxWidth: 240 });

      // Layer groups for dynamic markers (populated by Effects 2 & 3)
      nearbyLayerRef.current   = L.layerGroup().addTo(map);
      propertyLayerRef.current = L.layerGroup().addTo(map);

      // Signal Effects 2 & 3 that layer refs are now ready
      if (!destroyed) setMapReady((v) => v + 1);

      // Legend control
      const LegendControl = L.Control.extend({
        onAdd() {
          const div = L.DomUtil.create("div");
          div.innerHTML = legendHtml();
          return div;
        },
      });
      new LegendControl({ position: "bottomleft" }).addTo(map);
    }

    init();

    return () => {
      destroyed = true;
      nearbyLayerRef.current   = null;
      propertyLayerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, postalCode]);

  // ── Effect 2: Update nearby condo dots whenever nearbyCondos changes ─────
  // Clears and re-populates the nearbyLayer without touching the rest of the map.
  // Leaflet is already cached after Effect 1 runs, so the dynamic import is instant.
  useEffect(() => {
    const layer = nearbyLayerRef.current;
    if (!layer) return;

    // Capture values for the async callback
    const condos     = nearbyCondos;
    const propCoords = properties;
    let cancelled    = false;

    import("leaflet").then(({ default: L }) => {
      if (cancelled || !nearbyLayerRef.current) return;
      layer.clearLayers();

      const topLatLngs = new Set(
        propCoords
          .filter((p) => p.projectLat !== null && p.projectLng !== null)
          .map((p) => `${p.projectLat!.toFixed(4)},${p.projectLng!.toFixed(4)}`)
      );

      condos.forEach((c) => {
        if (topLatLngs.has(`${c.lat.toFixed(4)},${c.lng.toFixed(4)}`)) return;

        const isEC  = c.property_category === "EC";
        const color = isEC ? C.emerald : "#94a3b8";
        const icon  = L.divIcon({
          className:  "",
          iconSize:   [22, 22],
          iconAnchor: [11, 11],
          html: `<div style="
            width:22px;height:22px;border-radius:50%;
            background:${color};border:2px solid ${C.white};
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 1px 4px rgba(0,0,0,.25);
            font-size:7px;font-weight:800;color:${C.white};
          ">${isEC ? "EC" : "C"}</div>`,
        });

        L.marker([c.lat, c.lng], { icon })
          .addTo(layer)
          .bindPopup(
            `<div style="font-family:system-ui,sans-serif;padding:8px 10px;background:${C.bg};border-radius:10px;">
              <div style="font-weight:700;font-size:12px;color:${C.text};margin-bottom:3px;">${c.project_name}</div>
              <div style="font-size:10px;color:${C.muted};">${c.address || "—"}</div>
              <div style="margin-top:4px;font-size:10px;">
                <span style="font-weight:700;padding:1px 6px;border-radius:999px;background:${color}22;color:${color};">${c.property_category}</span>
                <span style="color:${C.indigo};font-weight:700;margin-left:6px;">📍 ${c.distance_km} km</span>
              </div>
            </div>`,
            { maxWidth: 240 },
          );
      });
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearbyCondos, mapReady]);

  // ── Effect 3: Update ranked property markers whenever selection changes ──
  useEffect(() => {
    const layer = propertyLayerRef.current;
    if (!layer) return;

    const props    = properties;
    const selected = selectedProject;
    const handler  = onSelectProject;
    let cancelled  = false;

    import("leaflet").then(({ default: L }) => {
      if (cancelled || !propertyLayerRef.current) return;
      layer.clearLayers();

      props.forEach((p, i) => {
        if (p.projectLat === null || p.projectLng === null) return;
        const rank       = i + 1;
        const isTop      = rank === 1;
        const isSelected = p.project === selected;
        const icon       = propIcon(L, rank, isTop, isSelected);

        const marker = L.marker([p.projectLat!, p.projectLng!], { icon })
          .addTo(layer)
          .bindPopup(popupHtml(rank, p), { maxWidth: 280 });

        marker.on("click", () => handler(p.project));
      });
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, selectedProject, mapReady]);

  if (!hasCoords) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 gap-3 px-6 text-center" style={{ minHeight: 360 }}>
        <span className="text-3xl">🗺️</span>
        <p className="text-sm font-semibold text-slate-600">No location data</p>
        <p className="text-xs text-slate-400">Enter a postal code on the assessment form to load the map.</p>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" style={{ minHeight: 360 }} />;
}
