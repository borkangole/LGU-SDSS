/* eslint-disable no-unused-vars */
import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { getGISBarangays, getDomainBarangays, getDomainMeta, getDomainTypologyBarangay, getDomainCapacity, getPopulationSummary } from '../../api/api';
import PopulationSummary from "./PopulationSummary";
import BarangayRanking from "./BarangayRanking";
import { capacityColorByRank, capacityTierFromRank, CAPACITY_TIER_LEGEND } from "../capacity/capacityShared";
import { useTheme } from "../../hooks/useTheme";
import { useCounter } from "../../hooks/useCounter";
import VulnerabilityBreakdown from "./VulnerabilityBreakdown";
import HouseholdRiskDistribution from "./HouseholdRiskDistribution";
import HazardExposureCard from "./HazardExposureCard";
import { DashCard, DashCardHead, Segmented } from "./dashShared";
import { SVI_TIER_TEXT, SVI_LEGEND, sviColorByRank, typologyColor } from "../shared/domainColors";


function FitBounds({ geojson, mapRef }) {
  const map = useMap();
  useEffect(() => {
    if (!geojson) return;
    try {
      const bounds = L.geoJSON(geojson).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [10, 10] });
        setTimeout(() => map.invalidateSize(), 100);
      }
    } catch { /* safe */ }
  }, [geojson, map]);
  return null;
}

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase()
    // "Brgy." / "Bgy." (both spellings, with or without the period)
    .replace(/\bb\.?r?gy\.?\s*/gi, "").replace(/\bbarangay\s*/gi, "")
    // "Pob." / "Poblacion" suffix, e.g. "Bgy. 1 Pob." -> "Bgy. 1"
    .replace(/\bpob(lacion)?\.?\s*/gi, "")
    .replace(/ñ/g, "n")
    // Canonicalize "Santo"/"Santa" long forms to "Sto"/"Sta" abbreviations
    .replace(/\bsanto\b/g, "sto").replace(/\bsanta\b/g, "sta")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim();
}
// Barangay-name lookup for the Official SVI model's barangay list, which
// keys on `barangay` (not `barangay_name`) since it comes from the domain
// pipeline output rather than the legacy BVI tables.
function findDomainStat(featureName, domainStats) {
  if (!featureName) return null;
  const fNorm = normalizeName(featureName);
  const exact = domainStats.find(b => normalizeName(b.barangay) === fNorm);
  if (exact) return exact;
  if (/^\d+$/.test(fNorm)) return null;
  return domainStats.find(b => {
    const bNorm = normalizeName(b.barangay);
    return bNorm.includes(fNorm) || fNorm.includes(bNorm);
  }) || null;
}
// Quartile bucket by SVI rank position (24 barangays / 4 = 6 each). Tier
// labels/order per the panel's own redesign spec: qcut(score, 4) ->
// Low / Moderate-low / Moderate-high / High, 6 barangays per tier, rank 1 =
// most socially vulnerable. Purely positional, not a fabricated score cutoff.
function sviCategory(rank) {
  if (rank == null) return null;
  if (rank <= 6) return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}
function getFeatureName(f) {
  const p = f.properties;
  return p?.Barangay_n || p?.NAME_3 || p?.name || p?.BARANGAY || "Unknown";
}

// SVI colours come from shared/domainColors.js (red -> orange -> amber ->
// green), so this mini map matches the Map View and every other page.
const CATEGORY_COLORS = SVI_TIER_TEXT;
function getColor(category) {
  return CATEGORY_COLORS[category] || "#aaaaaa";
}
function getScoreLabel(category) {
  return category && CATEGORY_COLORS[category] ? category : "No Data";
}
const getSviColorByRank = sviColorByRank;


// ── Flood / Landslide -- the REAL hazard susceptibility layers (Domain B,
// View 1's own GIS source, fetched from /api/gis/flood and /api/gis/
// landslide), not a barangay choropleth derived from % exposure. Same
// susceptibility codes, colors and labels as the full Map View's own
// Hazard tab (getFloodColor/getFloodLabel/getLandslideColor/
// getLandslideLabel there) -- reproduced here so this mini map matches it
// exactly rather than approximating it with a different fill.
const fetchFlood = (token) =>
  fetch("http://127.0.0.1:5000/api/gis/flood", {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
const fetchLandslide = (token) =>
  fetch("http://127.0.0.1:5000/api/gis/landslide", {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
function getFloodSuscColor(code) {
  switch (code) {
    case "VHF": return "#000000"; // Very High — black
    case "HF":  return "#2E3192"; // High — blue
    case "MF":  return "#92278F"; // Moderate — purple
    case "LF":  return "#E6D6EC"; // Low — light purple/lavender
    default:    return "#94a3b8";
  }
}
function getFloodSuscLabel(code) {
  switch (code) {
    case "VHF": return "Very High";
    case "HF":  return "High";
    case "MF":  return "Moderate";
    case "LF":  return "Low";
    default:    return "Unknown";
  }
}
function getLandslideSuscColor(code) {
  switch (code) {
    case "HL": return "#ED1C24"; // High — red
    case "ML": return "#39B54A"; // Moderate — green
    case "LL": return "#FFF200"; // Low — yellow
    default:   return "#94a3b8";
  }
}
function getLandslideSuscLabel(code) {
  switch (code) {
    case "HL": return "High";
    case "ML": return "Moderate";
    case "LL": return "Low";
    default:   return "Unknown";
  }
}
const FLOOD_LEGEND_ITEMS = [
  { color: getFloodSuscColor("VHF"), label: "Very High" },
  { color: getFloodSuscColor("HF"),  label: "High" },
  { color: getFloodSuscColor("MF"),  label: "Moderate" },
  { color: getFloodSuscColor("LF"),  label: "Low" },
];
const LANDSLIDE_LEGEND_ITEMS = [
  { color: getLandslideSuscColor("HL"), label: "High" },
  { color: getLandslideSuscColor("ML"), label: "Moderate" },
  { color: getLandslideSuscColor("LL"), label: "Low" },
];

// ── Improved StatCard with animated counter + hover lift ──────────────────
function StatCard({ icon, label, rawValue, sub, color, dark, D }) {
  const counted  = useCounter(typeof rawValue === "number" ? rawValue : 0);
  const [hovered, setHovered] = useState(false);

  const displayValue = typeof rawValue === "number"
    ? counted.toLocaleString()
    : String(rawValue);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:    D.cardBg,
        borderRadius:  12,
        padding:       "20px 22px",
        boxShadow:     hovered
          ? `0 8px 28px rgba(0,0,0,0.45), inset 0 1px 0 ${color}22`
          : D.shadow,
        border:        `1px solid ${hovered ? color + "55" : D.border}`,
        display:       "flex",
        justifyContent:"space-between",
        alignItems:    "center",
        flex:          "1 1 180px",
        minWidth:      160,
        transition:    "all 0.2s ease",
        transform:     hovered ? "translateY(-3px)" : "translateY(0)",
        position:      "relative",
        overflow:      "hidden",
      }}
    >
      {/* ── top accent bar ── */}
      <div style={{
        position:   "absolute", top: 0, left: 0, right: 0,
        height:     3,
        background: color,
        opacity:    0.85,
        borderRadius: "12px 12px 0 0",
      }} />

      {/* ── background glow circle ── */}
      <div style={{
        position:      "absolute", top: -20, right: -20,
        width:         80, height: 80, borderRadius: "50%",
        background:    `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative" }}>
        <div style={{
          fontSize: 11, color: D.textMuted, marginBottom: 7,
          textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 600,
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 30, fontWeight: 800, color, lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.2s",
        }}>
          {displayValue}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: D.textMuted, marginTop: 6, lineHeight: 1.4 }}>
            {sub}
          </div>
        )}
      </div>

      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        background: dark ? color + "22" : color + "18",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        border: `1px solid ${color}${dark ? "44" : "33"}`,
        transition: "background 0.2s, transform 0.2s",
        transform: hovered ? "scale(1.08)" : "scale(1)",
        position: "relative",
      }}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill={color}>
          {icon === "house"   && <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>}
          {icon === "warning" && <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>}
          {icon === "shield"  && <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>}
          {icon === "people"  && <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>}
          {icon === "water"   && <path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z"/>}
          {icon === "pin"     && <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>}
        </svg>
      </div>
    </div>
  );
}

function Section({ D, title, note, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 2px 12px" }}>
        <span style={{ width: 18, height: 2, borderRadius: 2, background: D.textPrimary, opacity: 0.6 }} />
        <h2 style={{ margin: 0, fontSize: 12, fontWeight: 800, color: D.textPrimary, letterSpacing: 1, textTransform: "uppercase" }}>{title}</h2>
        {note && <span style={{ fontSize: 12, color: D.textMuted }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}
// Mini "Vulnerability Heat Map" is the Official SVI model, barangay-level
// (n=24, equal quartiles by rank position) — labels describe quartiles,
// not fixed score cutoffs.
const LEGEND_ITEMS = [...SVI_LEGEND, { color: "#aaaaaa", label: "No Data" }];

// Household typology (k-modes) — third analytical view, kept structurally
// separate from the SVI ranking above (Sir Shem: don't combine the domains
// into one score). Same 5 colors/labels used on the Map View "Typology
// (k=5)" toggle, so the two pages read as one system. Provisional — k=3 vs
// k=4 vs k=5 is still pending advisor decision; labels are our own
// best-fit match, not yet confirmed.
const getTypologyColor = typologyColor; // own non-risk palette (shared/domainColors.js)

const CONTENT_PX = "28px";

export default function Dashboard({ onViewMap, user, onSearchSelect, onAbout, onAccountSettings, onOpenAttributes, onOpenVulnerability, onImport }) {
  const { dark } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const mapContainerRef = useRef(null);
  // Row 3: the Rankings card's height should FOLLOW the Hazard card's real,
  // unscrolled content height (not the other way around, and not a
  // hardcoded pixel guess) -- Hazard never scrolls; Rankings scrolls its
  // 24-item list inside whatever height Hazard naturally ends up being.
  // HazardExposureCard measures and reports its OWN rendered height (via
  // onHeightChange, below) right after every one of its renders -- this is
  // more reliable than watching it from the outside, because it's guaranteed
  // to fire again the moment its async data finishes loading and the card's
  // real content (not the loading placeholder) is what actually gets
  // measured.
  const [hazardCardHeight, setHazardCardHeight] = useState(null);

  // Mini map's single shared toggle -- "domains" (default: SVI left,
  // Capacity + Distance right, Domain A/B's own ranked views) vs. "hazard"
  // (Flood left, Landslide right -- the real Domain B View 1 GIS
  // susceptibility layers, same source as the full Map View's Hazard tab).
  // One button swaps BOTH halves together, not two independent toggles.
  const [heatMapMode, setHeatMapMode] = useState("domains");
  const [floodGeojson, setFloodGeojson] = useState(null);
  const [landslideGeojson, setLandslideGeojson] = useState(null);
  const [hazardLayerError, setHazardLayerError] = useState(null);

  // Lazy-loaded only once "hazard" mode is actually selected -- these are
  // real GIS polygon layers (not the lightweight per-barangay % already in
  // domainStats), so there's no reason to fetch them before they're needed.
  useEffect(() => {
    if (heatMapMode !== "hazard" || (floodGeojson && landslideGeojson)) return;
    const token = localStorage.getItem("token");
    Promise.all([fetchFlood(token), fetchLandslide(token)])
      .then(([flood, landslide]) => {
        setFloodGeojson(flood);
        setLandslideGeojson(landslide);
      })
      .catch(() => setHazardLayerError("Hazard layers aren't available right now."));
  }, [heatMapMode, floodGeojson, landslideGeojson]);

  const canSeeMap = user?.role?.toUpperCase() !== "MSWDO";

  const D = {
    pageBg: dark
      ? "radial-gradient(ellipse at 20% 0%, #0d1b35 0%, #0a1020 45%, #080b14 100%)"
      : "radial-gradient(ellipse at 20% 0%, #dce8ff 0%, #eaf0ff 45%, #f5f6fa 100%)",
    cardBg: dark
      ? "linear-gradient(145deg, #141c2e 0%, #111520 100%)"
      : "#ffffff",
    subBg:         dark ? "#0c1018"  : "#f5f6fa",
    border:        dark ? "#1a2540"  : "#e8eaf0",
    headerBg: dark
      ? "linear-gradient(135deg, #131c30 0%, #0f1520 100%)"
      : "#ffffff",
    headerBorder:  dark ? "#1a2540"  : "#e8eaf0",
    divider:       dark ? "#141c2a"  : "#f0f0f0",
    textPrimary:   dark ? "#5b8dee"  : "#1a237e",
    textBody:      dark ? "#8b95a9"  : "#333333",
    textMuted:     dark ? "#5f6a88"  : "#7a7f8c",
    textCell:      dark ? "#6b7590"  : "#555555",
    rowEven:       dark ? "#111828"  : "#ffffff",
    rowOdd:        dark ? "#0e1422"  : "#fafafa",
    chartGrid:     dark ? "#1a2235"  : "#f0f0f0",
    chartText:     dark ? "#4a5268"  : "#666666",
    tooltipBg:     dark ? "#151e30"  : "#ffffff",
    tooltipBorder: dark ? "#1e2d4a"  : "#e0e0e0",
    shadow: dark
      ? "0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(91,141,238,0.06)"
      : "0 2px 8px rgba(0,0,0,0.07)",
    headerShadow: dark
      ? "0 2px 16px rgba(0,0,0,0.5), 0 1px 0 rgba(91,141,238,0.1)"
      : "0 1px 6px rgba(0,0,0,0.06)",
    lockBg:        dark ? "rgba(8,11,20,0.88)"  : "rgba(255,255,255,0.75)",
    inputBg:       dark ? "#0f1828"  : "#f0f4ff",
    inputBorder:   dark ? "#1e2d4a"  : "#dde3f5",
    iconBtn:       dark ? "#0f1828"  : "#f0f4ff",
    iconBtnBorder: dark ? "#1e2d4a"  : "#dde3f5",
    iconBtnColor:  dark ? "#5b8dee"  : "#1565c0",
    dropdownBg:    dark ? "#111c30"  : "#ffffff",
    dropdownBorder:dark ? "#1e2d4a"  : "#e0e0e0",
    topAccent:     dark ? "#1e3a6e"  : "#c5d8fb",
    barColor:      dark ? "#1e4a8a"  : "#1565c0",
    barColorHover: dark ? "#2a5fa8"  : "#1976d2",
    accent:        dark ? "#93c5fd" : "#1d4ed8",
  };

  // ── Official SVI model (Sir Shem's reference implementation) — the
  // dashboard's primary and only vulnerability data source. Social
  // Vulnerability Index + Operational Capacity + real hazard exposure,
  // read live from data/domain_pipeline_results/*.csv. The legacy
  // single-BVI endpoints (getVulnBarangaySummary, getVulnBarangayStage1)
  // are no longer used here — replaced outright, not run in parallel.
  const [domainStats, setDomainStats] = useState([]);
  const [domainMeta,  setDomainMeta]  = useState(null);
  const [geojson, setGeojson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [noData,  setNoData]  = useState(false);

  // ── Household typology (k-modes) — third analytical view. Fetched and
  // failed independently of the domain/geojson load above: the typology
  // CSV is optional (advisor hasn't confirmed k yet), so a missing file
  // here should never block the rest of the dashboard from rendering.
  const [typologyStats, setTypologyStats] = useState([]);
  const [typologyNote,  setTypologyNote]  = useState(null);
  const [typologyError, setTypologyError] = useState(null);

  // ── Capacity + Distance (Domain B, View 2) — the mini map's second half.
  // Own fetch, independent of the SVI/geojson load above, same pattern as
  // typology: this is a distinct dataset/endpoint from domainStats, so a
  // slow or failed load here shouldn't block the rest of the dashboard.
  const [capacityDistanceStats, setCapacityDistanceStats] = useState([]);
  const [population, setPopulation] = useState(null);
  useEffect(() => {
    getPopulationSummary().then(r => setPopulation(r.data)).catch(() => setPopulation(null));
  }, []);
  const [capDistError, setCapDistError] = useState(null);


  useEffect(() => {
    Promise.all([
      getDomainBarangays().then(r => r.data),
      getDomainMeta().then(r => r.data),
      getGISBarangays().then(r => r.data),
    ])
      .then(([domain, meta, geo]) => {
        setDomainStats(domain.data || []);
        setDomainMeta(meta || null);
        setGeojson(geo);
        setLoading(false);
      })
      .catch(err => {
        if (err.response?.data?.no_data) setNoData(true);
        else setError(err.response?.data?.detail || err.response?.data?.error || err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    getDomainTypologyBarangay()
      .then(r => {
        setTypologyStats(r.data?.data || []);
        setTypologyNote(r.data?.note || null);
      })
      .catch(err => {
        setTypologyError(err.response?.data?.detail || err.response?.data?.error || err.message);
      });
  }, []);

  useEffect(() => {
    getDomainCapacity()
      .then(r => setCapacityDistanceStats(r.data?.data || []))
      .catch(err => {
        setCapDistError(err.response?.data?.detail || err.response?.data?.error || err.message);
      });
  }, []);

  // Municipality-wide cluster composition, weighted by each barangay's
  // household count (barangay rows only carry percentages, not raw
  // counts per cluster). Purely descriptive — never fed back into the
  // SVI ranking above.
  const typologyComposition = useMemo(() => {
    if (!typologyStats.length) return [];
    const totals = {};
    let totalHH = 0;
    typologyStats.forEach(b => {
      const n = b.n_households || 0;
      totalHH += n;
      (b.clusters || []).forEach(c => {
        const hh = n * ((c.pct || 0) / 100);
        totals[c.cluster_id] = (totals[c.cluster_id] || 0) + hh;
      });
    });
    return Object.entries(totals)
      .map(([cid, hh]) => {
        const cluster = typologyStats[0]?.clusters?.find(c => String(c.cluster_id) === cid);
        return {
          clusterId: Number(cid),
          label: cluster?.label || `Cluster ${cid}`,
          households: Math.round(hh),
          pct: totalHH ? (hh / totalHH) * 100 : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [typologyStats]);

  // barangay psgc_10d -> its dominant typology cluster, for the rankings
  // list badge below.
  const typologyByPsgc = useMemo(() => {
    const m = {};
    typologyStats.forEach(b => { m[b.psgc_10d] = b; });
    return m;
  }, [typologyStats]);

  const typologyTotalHH = typologyComposition.reduce((s, c) => s + c.households, 0);
  const typologyAnimatedTotal = useCounter(typologyTotalHH, 1400);

  useEffect(() => {
    if (!geojson || !mapContainerRef.current) return;
    const timeouts = [
      setTimeout(() => window.dispatchEvent(new Event("resize")), 100),
      setTimeout(() => window.dispatchEvent(new Event("resize")), 300),
      setTimeout(() => window.dispatchEvent(new Event("resize")), 500),
    ];
    return () => timeouts.forEach(t => clearTimeout(t));
  }, [geojson]);

  useEffect(() => {
    const handler = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const totalHouseholds = domainStats.reduce((s, b) => s + (b.households || 0), 0);

  // Household-weighted, not household-computed: the Official SVI model only
  // scores at barangay level (n=24), so "households in a High/Very High SVI
  // barangay" is the honest way to express this at household scale — not a
  // claim that each household was individually classified.
  const totalHighSvi = domainStats
    .filter(b => b.svi_rank != null && b.svi_rank <= 12)
    .reduce((s, b) => s + (b.households || 0), 0);

  const totalStrongCapacity = domainStats
    .filter(b => b.capacity_rank != null && b.capacity_rank <= 6)
    .reduce((s, b) => s + (b.households || 0), 0);

  const highRiskBarangays = domainStats.filter(b => b.svi_rank != null && b.svi_rank <= 12).length;

  const styleFeature = (feature) => {
    const stat = findDomainStat(getFeatureName(feature), domainStats);
    return {
      // Continuous per-rank shade, same formula/result as the full Map
      // View's SVI choropleth -- not just the 4-tier legend color.
      fillColor:   getSviColorByRank(stat?.svi_rank),
      fillOpacity: 0.78,
      color:       "rgba(30,60,120,0.5)",
      weight:      1,
    };
  };
  const onEachFeature = (feature, layer) => {
    const stat  = findDomainStat(getFeatureName(feature), domainStats);
    const cat   = sviCategory(stat?.svi_rank);
    const label = cat ? getScoreLabel(cat) : "N/A";
    layer.bindTooltip(
      `<b>${getFeatureName(feature)}</b><br/>SVI: ${stat?.svi_score != null ? Number(stat.svi_score).toFixed(1) : "N/A"} (rank #${stat?.svi_rank ?? "—"}) — ${label}`,
      { sticky: true }
    );
  };

  // Right half of the mini map -- Capacity + Distance (Domain B, View 2),
  // same findDomainStat lookup helper as SVI above, just pointed at
  // capacityDistanceStats/capacity_distance_rank instead of domainStats/
  // svi_rank. Mirrors the full Map View's own "Capacity + Distance" tab.
  const styleFeatureCapacity = (feature) => {
    const stat = findDomainStat(getFeatureName(feature), capacityDistanceStats);
    return {
      fillColor:   capacityColorByRank(stat?.capacity_rank),
      fillOpacity: 0.78,
      color:       "rgba(30,60,120,0.5)",
      weight:      1,
    };
  };
  const onEachFeatureCapacity = (feature, layer) => {
    const stat  = findDomainStat(getFeatureName(feature), capacityDistanceStats);
    layer.bindTooltip(
      `<b>${getFeatureName(feature)}</b><br/>Capacity: ${stat?.capacity_score != null ? Number(stat.capacity_score).toFixed(1) : "N/A"} / 100 (rank #${stat?.capacity_rank ?? "—"}) — ${capacityTierFromRank(stat?.capacity_rank)}`,
      { sticky: true }
    );
  };

  if (loading) return (
    <div style={{ padding:60, textAlign:"center", color:D.textMuted,
      fontSize:16, background:D.pageBg, minHeight:"100%" }}>
      Loading dashboard...
    </div>
  );
  if (noData) return (
    <div style={{ padding:"48px 24px", background:D.pageBg, minHeight:"100%" }}>
      <div style={{ maxWidth:720, margin:"0 auto", background:D.cardBg, border:`1px solid ${D.border}`, borderRadius:16,
        padding:"34px 38px", boxShadow: dark ? "none" : "0 10px 30px rgba(15,23,42,0.06)" }}>
        <div style={{ fontSize:12, fontWeight:800, letterSpacing:1, color:"#2563eb", textTransform:"uppercase" }}>Welcome to LGU-SDSS</div>
        <div style={{ fontSize:24, fontWeight:800, color:D.textPrimary, marginTop:6 }}>Start by importing the CBMS data</div>
        <div style={{ fontSize:14, color:D.textMuted, marginTop:8, lineHeight:1.65 }}>
          This installation has no household data yet. The 24 barangays, the hazard maps and the facility locations are already in place;
          the dashboard, maps, scores and reports are built from the CBMS files you import.
        </div>
        <ol style={{ margin:"20px 0 0", paddingLeft:20, color:D.textPrimary, fontSize:14, lineHeight:1.9 }}>
          <li>Click <b>Import CBMS files</b> and choose the CBMS 2024 files: the <b>household</b>, <b>person</b> and <b>barangay</b> records are required (the other 4 CBMS files are optional). CSV or Excel.</li>
          <li>Check the preview (files recognised, households per barangay), then click <b>Import</b>.</li>
          <li>Wait for the recalculation (a progress bar shows at the top, a few minutes). The pages fill in when it finishes.</li>
        </ol>
        {onImport && (
          <button onClick={onImport} style={{ marginTop:24, padding:"11px 22px", borderRadius:9, border:"none", cursor:"pointer",
            background:"linear-gradient(135deg,#1a237e,#1565c0)", color:"#fff", fontSize:14, fontWeight:700 }}>
            Import CBMS files
          </button>
        )}
      </div>
    </div>
  );
  if (error) return (
    <div style={{ padding:40, textAlign:"center", background:D.pageBg, minHeight:"100vh" }}>
      <div style={{ color:"#d32f2f", fontWeight:700, fontSize:15, marginBottom:8 }}>
        Failed to load dashboard
      </div>
      <div style={{ color:D.textMuted, fontSize:13, fontFamily:"monospace",
        background:D.cardBg, padding:12, borderRadius:6,
        maxWidth:500, margin:"0 auto", border:`1px solid ${D.border}` }}>
        {error}
      </div>
    </div>
  );
  if (domainStats.length === 0) return (
    <div style={{ padding:40, textAlign:"center", color:D.textMuted,
      background:D.pageBg, minHeight:"100vh" }}>
      <div style={{ fontSize:15, fontWeight:700 }}>No barangay data found</div>
    </div>
  );

  const dropdownStyle = {
    position:"absolute", top:"calc(100% + 8px)", right:0,
    background:D.dropdownBg, border:`1px solid ${D.dropdownBorder}`,
    borderRadius:10, boxShadow: dark ? "0 12px 32px rgba(0,0,0,0.5)" : "0 12px 28px rgba(15,23,42,0.12)",
    zIndex:9999, minWidth:240, overflow:"hidden",
    animation:"fadeDown 0.15s cubic-bezier(0.23,1,0.32,1)",
  };

  const computedAt = domainMeta?.generated_at
    ? new Date(domainMeta.generated_at).toLocaleString(undefined, { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" })
    : null;
  const topThree = domainStats.filter(b => b.svi_rank != null && b.svi_rank <= 3)
    .sort((a, b) => a.svi_rank - b.svi_rank).map(b => b.barangay).join(", ");
  const mapLabel = { fontSize:11, fontWeight:600, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 };

  const renderLegend = (items, outlined) => (
    <div style={{ display:"flex", gap:"4px 12px", marginTop:10, flexWrap:"wrap" }}>
      {items.map(item => (
        <div key={item.label} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:D.textCell }}>
          <span style={{ width:9, height:9, borderRadius:2, background:item.color, flexShrink:0,
            boxShadow: outlined ? `inset 0 0 0 1px ${D.border}` : "none" }}/>
          {item.label.split(" (")[0]}
        </div>
      ))}
    </div>
  );
  const miniMap = (children, ref) => (
    <div ref={ref} style={{ flex:1, minHeight:300, borderRadius:8, overflow:"hidden", position:"relative",
      boxShadow:`inset 0 0 0 1px ${D.border}` }}>
      <MapContainer center={[10.87,122.46]} zoom={5} style={{ height:"100%", width:"100%" }}
        zoomControl={false} scrollWheelZoom={false} dragging={false} doubleClickZoom={false}
        touchZoom={false} keyboard={false}>
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="© Esri" maxZoom={19}/>
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}/>
        {children}
      </MapContainer>
    </div>
  );
  const boundary = (key) => geojson && (
    <GeoJSON key={key+dark} data={geojson}
      style={{ fillColor:"transparent", fillOpacity:0, color: dark ? "rgba(147,197,253,0.55)" : "rgba(255,255,255,0.7)", weight:1 }}/>
  );

  return (
    <>
    <div className="dash-root" style={{ display:"flex", flexDirection:"column", height:"100%",
      fontFamily:"'Segoe UI', system-ui, sans-serif", WebkitFontSmoothing:"antialiased",
      background: D.pageBg, borderTop:`2px solid ${D.topAccent}`, transition:"background 0.3s ease" }}>

      <style>{`
        @keyframes fadeDown { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
        .dash-grid-main { display:grid; grid-template-columns:minmax(0,2fr) minmax(320px,1fr); gap:16px; align-items:stretch; }
        .rank-wrap { position:relative; min-height:560px; }
        .rank-wrap > div { position:absolute; inset:0; }
        
        .dash-link { background:none; border:none; padding:0; cursor:pointer; font-size:12.5px; font-weight:600; color:${D.accent}; }
        .dash-link:hover { text-decoration:underline; text-underline-offset:3px; }
        .dash-root tbody tr:hover td { background:${dark ? "#141e33" : "#f4f7ff"}; }
        .dash-cta { transition: transform .12s, box-shadow .15s; } .dash-cta:hover { box-shadow:0 4px 14px rgba(21,101,192,0.45) !important; } .dash-cta:active { transform:scale(0.97); }
        .dash-btn { transition: background .15s, transform .12s; }
        .dash-btn:hover { background:${dark ? "#1a2540" : "#e3ebff"} !important; }
        .dash-btn:active, .dash-seg:active { transform: scale(0.97); }
        .dash-root button:focus-visible, .dash-root select:focus-visible, .dash-root input:focus-visible { outline:2px solid ${D.accent}; outline-offset:2px; }
        @media (max-width: 1200px) {
          .dash-grid-main { grid-template-columns:1fr; }
          .kpi-row { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        }
        @media (prefers-reduced-motion: reduce) { .dash-root * { animation:none !important; transition:none !important; } }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ flexShrink:0, padding:`14px ${CONTENT_PX} 0`, zIndex:50 }}>
        <div style={{ height:60, background:D.headerBg, borderRadius:12, border:`1px solid ${D.headerBorder}`,
          boxShadow:D.headerShadow, display:"flex", alignItems:"center", padding:"0 16px 0 20px", gap:12 }}>
          <div style={{ display:"flex", flexDirection:"column", marginRight:"auto", minWidth:0 }}>
            <div style={{ fontSize:18, fontWeight:700, color:D.textPrimary, lineHeight:1.2, letterSpacing:-0.2 }}>Dashboard</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2, fontSize:11.5, color:D.textMuted, whiteSpace:"nowrap" }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#22a06b" }}/>
              System operational{computedAt && <> · Data computed {computedAt}</>}
            </div>
          </div>

          <div style={{ position:"relative" }} ref={settingsRef}>
            <button onClick={() => setSettingsOpen(o=>!o)} aria-label="Settings" className="dash-btn"
              style={{ width:38, height:38, borderRadius:8, cursor:"pointer", background:D.iconBtn,
                border:`1px solid ${D.iconBtnBorder}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke={D.iconBtnColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            {settingsOpen && (
              <div style={dropdownStyle}>
                <div style={{ padding:"12px 16px", borderBottom:`1px solid ${D.dropdownBorder}` }}>
                  <div style={{ fontSize:13, fontWeight:650, color:D.textPrimary }}>Settings</div>
                </div>
                {[
                  { icon:<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>, label:"Account Settings", onClick: () => { setSettingsOpen(false); onAccountSettings && onAccountSettings(); } },
                  { icon:<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, label:"Privacy & Security", onClick: () => { setSettingsOpen(false); onAccountSettings && onAccountSettings("security"); } },
                  { icon:<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>, label:"About System", onClick: () => { setSettingsOpen(false); onAbout && onAbout(); } },
                ].map((item, i) => (
                  <div key={i} onClick={item.onClick} style={{ padding:"11px 16px",
                    borderBottom: i < 2 ? `1px solid ${D.dropdownBorder}` : "none",
                    display:"flex", gap:10, alignItems:"center", cursor:"pointer", fontSize:13, color:D.textBody }}
                    onMouseEnter={e => { e.currentTarget.style.background = dark ? "rgba(255,255,255,0.04)" : "#f5f7fb"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                    <span style={{ color:D.textMuted, display:"flex" }}>{item.icon}</span>
                    {item.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:10, background:D.iconBtn,
            border:`1px solid ${D.iconBtnBorder}`, borderRadius:8, padding:"5px 14px 5px 6px" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:"linear-gradient(135deg, #1a237e 0%, #1565c0 100%)",
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize:12.5, fontWeight:650, color:D.textPrimary, lineHeight:1.2 }}>
                {user?.full_name || user?.username || "Admin User"}
              </div>
              <div style={{ fontSize:10, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5 }}>
                {user?.role || "Admin"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SCROLLABLE CONTENT ── */}
      <div style={{ flex:1, overflowY:"auto", padding:`20px ${CONTENT_PX} 12px` }}>

        {/* ── Headline numbers ── */}
        <div className="kpi-row" style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:14, marginBottom:26 }}>
          <StatCard icon="people" label="Population" rawValue={population?.total?.population || 0}
            sub={`${(population?.total?.households || totalHouseholds).toLocaleString()} households`}
            color="#1565c0" dark={dark} D={D} />
          <StatCard icon="warning" label="Most vulnerable barangays"
            rawValue={domainStats.filter(b => b.svi_rank != null && b.svi_rank <= 6).length}
            sub={topThree ? `${topThree} lead` : "SVI rank 1–6"} color="#dc2626" dark={dark} D={D} />
          <StatCard icon="shield" label="Least equipped barangays"
            rawValue={capacityDistanceStats.filter(b => b.capacity_rank != null && b.capacity_rank >= 19).length}
            sub="Capacity rank 19–24" color="#f97316" dark={dark} D={D} />
          <StatCard icon="water" label="Flood-exposed households"
            rawValue={domainStats.reduce((s, b) => s + (b.hazard?.flood_high_or_very_high_households || 0), 0)}
            sub="In High or Very High flood zones" color="#0369a1" dark={dark} D={D} />
        </div>

        {/* ── Where things stand, barangay by barangay ── */}
        <Section D={D} title="Barangay picture" note="Social vulnerability, capacity and hazard are shown side by side, never combined">
          <div className="dash-grid-main" style={!canSeeMap ? { gridTemplateColumns:"1fr" } : undefined}>
            {canSeeMap && (
              <DashCard D={D}>
                <DashCardHead D={D} accent={heatMapMode === "domains" ? "linear-gradient(180deg,#dc2626,#16a34a)" : "linear-gradient(180deg,#2E3192,#ED1C24)"}
                  title={heatMapMode === "domains" ? "Vulnerability and capacity map" : "Hazard map"}
                  sub={heatMapMode === "domains" ? "Each barangay shaded by its SVI rank and its capacity rank" : "Flood and landslide susceptibility zones"}
                  right={<>
                    <Segmented D={D} dark={dark} value={heatMapMode} onChange={setHeatMapMode}
                      options={[{ id:"domains", label:"SVI + Capacity" }, { id:"hazard", label:"Flood + Landslide" }]} />
                    <button onClick={onViewMap} className="dash-cta" style={{ padding:"7px 14px", borderRadius:8, cursor:"pointer",
                      fontSize:12, fontWeight:600, color:"#fff", border:"none",
                      background:"linear-gradient(135deg,#1565c0,#1a237e)", boxShadow:"0 2px 8px rgba(21,101,192,0.35)" }}>
                      Open map →
                    </button>
                  </>} />
                <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, padding:"0 20px 18px", minHeight:380 }}>
                  <div style={{ display:"flex", flexDirection:"column", minWidth:0 }}>
                    <div style={mapLabel}>{heatMapMode === "domains" ? "Social vulnerability (SVI)" : "Flood susceptibility"}</div>
                    {miniMap(<>
                      {geojson && <FitBounds geojson={geojson} mapRef={mapContainerRef} />}
                      {heatMapMode === "domains" && geojson && (
                        <GeoJSON key={"svi"+JSON.stringify(domainStats)+dark} data={geojson} style={styleFeature} onEachFeature={onEachFeature}/>
                      )}
                      {heatMapMode === "hazard" && <>
                        {boundary("floodboundary")}
                        {floodGeojson && (
                          <GeoJSON key={"flood"+dark} data={floodGeojson}
                            style={(f) => ({ fillColor:getFloodSuscColor(f.properties?.FloodSusc), fillOpacity:0.55,
                              color:getFloodSuscColor(f.properties?.FloodSusc), weight:1.5 })}
                            onEachFeature={(f, layer) => layer.bindTooltip(`${getFloodSuscLabel(f.properties?.FloodSusc)} Flood Susceptibility`, { sticky:true })}/>
                        )}
                      </>}
                    </>, mapContainerRef)}
                    {renderLegend(heatMapMode === "domains" ? LEGEND_ITEMS : FLOOD_LEGEND_ITEMS, heatMapMode === "hazard")}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", minWidth:0 }}>
                    <div style={mapLabel}>{heatMapMode === "domains" ? "Barangay capacity" : "Landslide susceptibility"}</div>
                    {miniMap(<>
                      {geojson && <FitBounds geojson={geojson} />}
                      {heatMapMode === "domains" && geojson && (
                        <GeoJSON key={"capacity"+JSON.stringify(capacityDistanceStats)+dark} data={geojson} style={styleFeatureCapacity} onEachFeature={onEachFeatureCapacity}/>
                      )}
                      {heatMapMode === "hazard" && <>
                        {boundary("landslideboundary")}
                        {landslideGeojson && (
                          <GeoJSON key={"landslide"+dark} data={landslideGeojson}
                            style={(f) => ({ fillColor:getLandslideSuscColor(f.properties?.LndslideSu), fillOpacity:0.55,
                              color:getLandslideSuscColor(f.properties?.LndslideSu), weight:1.5, dashArray:"4 3" })}
                            onEachFeature={(f, layer) => layer.bindTooltip(`${getLandslideSuscLabel(f.properties?.LndslideSu)} Landslide Susceptibility`, { sticky:true })}/>
                        )}
                      </>}
                    </>)}
                    {renderLegend(heatMapMode === "domains" ? CAPACITY_TIER_LEGEND : LANDSLIDE_LEGEND_ITEMS, heatMapMode === "hazard")}
                    {heatMapMode === "domains" && capDistError && !capacityDistanceStats.length && (
                      <div style={{ fontSize:11, color:D.textMuted, marginTop:6 }}>Capacity data isn't available yet.</div>
                    )}
                    {heatMapMode === "hazard" && hazardLayerError && (
                      <div style={{ fontSize:11, color:D.textMuted, marginTop:6 }}>{hazardLayerError}</div>
                    )}
                    {heatMapMode === "hazard" && !hazardLayerError && !floodGeojson && (
                      <div style={{ fontSize:11, color:D.textMuted, marginTop:6 }}>Loading hazard layers…</div>
                    )}
                  </div>
                </div>
              </DashCard>
            )}
            <HouseholdRiskDistribution dark={dark} D={D} />
          </div>
        </Section>

        {/* ── Where to start ── */}
        <Section D={D} title="Planning priorities" note="Rank barangays by one domain at a time, and see which kinds of households live there">
          <div className="dash-grid-main">
            <div className="rank-wrap">
              <BarangayRanking domainStats={domainStats} capacity={capacityDistanceStats} population={population?.data} D={D} dark={dark} />
            </div>
            {typologyComposition.length > 0 && (
              <DashCard D={D}>
                <DashCardHead D={D} accent="linear-gradient(180deg,#0d9488,#9333ea,#db2777)" title="Household profiles" sub="Closest profile of each household"
                  right={<span style={{ fontSize:12, color:D.textMuted, fontVariantNumeric:"tabular-nums" }}>
                    <b style={{ color:D.textPrimary, fontWeight:650 }}>{typologyAnimatedTotal.toLocaleString()}</b> households
                  </span>} />
                {typologyComposition[0] && typologyTotalHH > 0 && (() => {
                  const top = typologyComposition[0], col = getTypologyColor(top.clusterId);
                  return (
                    <div style={{ margin:"0 20px 6px", display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:10,
                      background:`color-mix(in srgb, ${col} ${dark ? 14 : 8}%, transparent)`,
                      border:`1px solid color-mix(in srgb, ${col} ${dark ? 35 : 25}%, transparent)` }}>
                      <span style={{ width:10, height:10, borderRadius:"50%", background:col, flexShrink:0,
                        boxShadow:`0 0 0 4px color-mix(in srgb, ${col} 20%, transparent)` }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10.5, color:D.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6 }}>Most common household type</div>
                        <div style={{ fontSize:13.5, fontWeight:700, color:D.textPrimary, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{top.label}</div>
                      </div>
                      <div style={{ fontSize:22, fontWeight:800, color:col, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{top.pct.toFixed(1)}%</div>
                    </div>
                  );
                })()}
                <div style={{ padding:"0 20px", display:"flex", flexDirection:"column" }}>
                  {typologyComposition.map((c, i) => {
                    const col = getTypologyColor(c.clusterId);
                    return (
                      <div key={c.clusterId} style={{ padding:"10px 0" }}>
                        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:6 }}>
                          <span style={{ width:9, height:9, borderRadius:"50%", background:col, flexShrink:0 }} />
                          <span style={{ fontSize:13, fontWeight:600, color:D.textBody, flex:1, minWidth:0,
                            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }} title={c.label}>{c.label}</span>
                          <span style={{ fontSize:14, fontWeight:800, color:col, fontVariantNumeric:"tabular-nums" }}>{c.pct.toFixed(1)}%</span>
                          <span style={{ fontSize:11, color:D.textMuted, minWidth:62, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>
                            {c.households.toLocaleString()} HH
                          </span>
                        </div>
                        <div style={{ height:8, background:D.subBg, borderRadius:5, overflow:"hidden" }}>
                          <div style={{ width:`${c.pct}%`, height:"100%", borderRadius:5,
                            background:`linear-gradient(90deg, ${col}88, ${col})`, transition:"width .6s cubic-bezier(0.23,1,0.32,1)" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop:"auto", padding:"14px 20px 18px" }}>
                  <div style={{ fontSize:12, color:D.textBody, lineHeight:1.55, padding:"10px 12px", borderRadius:8, background:D.subBg, textWrap:"pretty" }}>
                    A profile describes the <b style={{ color:D.textBody, fontWeight:600 }}>typical</b> household, not a fixed box.
                    Each household is shown with the profile it is closest to, and many also share traits with a second profile.
                  </div>
                  {onOpenVulnerability && (
                    <button onClick={() => onOpenVulnerability()} className="dash-btn" style={{ marginTop:12, width:"100%", padding:"9px 12px",
                      borderRadius:8, cursor:"pointer", fontSize:12.5, fontWeight:700,
                      border:`1px solid ${dark ? "#1e3a6e" : "#c5d8fb"}`, background: dark ? "#0f1c36" : "#eff6ff",
                      color: dark ? "#93c5fd" : "#1d4ed8" }}>
                      Search and filter households by profile →
                    </button>
                  )}
                </div>
              </DashCard>
            )}
            {typologyError && !typologyStats.length && (
              <DashCard D={D} style={{ padding:20, fontSize:12, color:D.textMuted }}>
                Household typology data isn't available yet ({typologyError}).
              </DashCard>
            )}
          </div>
        </Section>

        {/* ── Who lives here ── */}
        <Section D={D} title="Population" note="CBMS 2024 census of residents, for context">
          <PopulationSummary data={population} D={D} dark={dark} onOpenAttributes={onOpenAttributes} />
        </Section>

      </div>
    </div>
    </>
  );
}
