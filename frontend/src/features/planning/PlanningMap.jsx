// Read-only boundary map for the Planning detail overlay.
//
// Shows ONE barangay's boundary on satellite imagery (street map optional),
// outlined and lightly filled in the colour of the domain tab that is open
// (SVI tier, Barangay Capacity tier, or hazard exposure). No dragging,
// zooming or clicking -- it is a picture of where the barangay is, not a
// second Map View. Household dots and the three domains combined are
// deliberately left out; Map View is the place for those.
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { getGISBarangays } from "../../api/api";

let geojsonCache = null;        // the 24 boundaries, fetched once per session
let geojsonPromise = null;
function loadBoundaries() {
  if (geojsonCache) return Promise.resolve(geojsonCache);
  if (!geojsonPromise) {
    geojsonPromise = getGISBarangays()
      .then((r) => { geojsonCache = r.data; return geojsonCache; })
      .catch((e) => { geojsonPromise = null; throw e; });
  }
  return geojsonPromise;
}

// Same name matching as Map View ("Bgy. 5 Pob." = "Barangay 5 (Pob.)",
// "Santo Angel" = "Sto. Angel").
export function normalizeBarangayName(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\bb\.?r?gy\.?\s*/gi, "")
    .replace(/\bbarangay\s*/gi, "")
    .replace(/\bpob(lacion)?\.?\s*/gi, "")
    .replace(/ñ/g, "n")
    .replace(/\bsanto\b/g, "sto")
    .replace(/\bsanta\b/g, "sta")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const featureName = (f) => {
  const p = f.properties || {};
  return p.Barangay_n || p.NAME_3 || p.name || p.BARANGAY || "";
};

function FitTo({ feature }) {
  const map = useMap();
  useEffect(() => {
    if (!feature) return;
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(L.geoJSON(feature).getBounds(), { padding: [28, 28], maxZoom: 17, animate: false });
    };
    fit();
    const t = setTimeout(fit, 220); // after the overlay's open animation
    // re-fit when the overlay is resized (window resize, phone rotation)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit()) : null;
    ro?.observe(map.getContainer());
    return () => { clearTimeout(t); ro?.disconnect(); };
  }, [feature, map]);
  return null;
}

export default function PlanningMap({ barangay, color, label, sub, dark }) {
  const [geo, setGeo] = useState(geojsonCache);
  const [err, setErr] = useState(null);
  const [base, setBase] = useState("satellite");

  useEffect(() => {
    if (geo) return;
    loadBoundaries().then(setGeo).catch((e) => setErr(e.message || "Boundaries unavailable"));
  }, [geo]);

  const feature = useMemo(() => {
    if (!geo?.features) return null;
    const want = normalizeBarangayName(barangay);
    return geo.features.find((f) => normalizeBarangayName(featureName(f)) === want) || null;
  }, [geo, barangay]);

  const sat = base === "satellite";
  const panel = dark ? "rgba(13,17,26,0.86)" : "rgba(255,255,255,0.92)";
  const panelText = dark ? "#e5e7eb" : "#1f2937";
  const muted = dark ? "#9ca3af" : "#4b5563";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 260, borderRadius: 10, overflow: "hidden",
      background: dark ? "#0b0f17" : "#e8edf4" }}>
      {feature ? (
        <MapContainer key={barangay} center={[10.78, 122.46]} zoom={14} style={{ width: "100%", height: "100%" }}
          zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}
          boxZoom={false} keyboard={false} attributionControl={true}>
          {sat ? (
            <>
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxZoom={19} />
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
            </>
          ) : (
            <TileLayer url={dark ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
              attribution="© OpenStreetMap contributors" />
          )}
          {/* white halo first so the coloured line reads on any imagery */}
          <GeoJSON key={`halo-${barangay}-${base}`} data={feature} interactive={false}
            style={{ color: sat ? "#ffffff" : (dark ? "#0b0f17" : "#ffffff"), weight: 6, opacity: 0.9, fill: false }} />
          <GeoJSON key={`line-${barangay}-${color}-${base}`} data={feature} interactive={false}
            style={{ color, weight: 3, opacity: 1, fillColor: color, fillOpacity: sat ? 0.22 : 0.16 }} />
          <FitTo feature={feature} />
        </MapContainer>
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          color: muted, fontSize: 12, padding: 20, textAlign: "center" }}>
          {err ? `Map unavailable (${err}).` : geo ? `No boundary found for ${barangay}.` : "Loading boundary…"}
        </div>
      )}

      {/* domain legend (what the colour means) */}
      {feature && (
        <div style={{ position: "absolute", left: 10, bottom: 22, zIndex: 500, background: panel, color: panelText,
          borderRadius: 8, padding: "7px 10px", fontSize: 11.5, lineHeight: 1.35, maxWidth: "70%",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)", pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700 }}>
            <span style={{ width: 14, height: 10, borderRadius: 2, background: color + "55", border: `2px solid ${color}`, flexShrink: 0 }} />
            {label}
          </div>
          {sub && <div style={{ color: muted, marginTop: 2 }}>{sub}</div>}
        </div>
      )}

      {/* base map switch */}
      <div role="group" aria-label="Base map" style={{ position: "absolute", top: 10, right: 10, zIndex: 500, display: "flex",
        background: panel, borderRadius: 8, padding: 3, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
        {[["satellite", "Satellite"], ["street", "Street"]].map(([k, l]) => (
          <button key={k} onClick={() => setBase(k)} aria-pressed={base === k} style={{
            border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit", background: base === k ? "#1565c0" : "transparent", color: base === k ? "#fff" : panelText,
          }}>{l}</button>
        ))}
      </div>
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 500, background: panel, color: muted, borderRadius: 6,
        padding: "3px 8px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", pointerEvents: "none" }}>
        View only
      </div>
    </div>
  );
}
