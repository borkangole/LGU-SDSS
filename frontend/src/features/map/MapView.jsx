import { useEffect, useLayoutEffect, useState, useMemo, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, GeoJSON, Marker, Tooltip, Circle, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { getGISBarangays, getGISRoads, getGISFlood, getGISLandslide, getVulnBarangayStage1, getVulnBarangayStage1Explain, getVulnBarangaySummary, getHouseholds, getVulnHousehold, globalSearch, getDomainBarangays, getDomainBarangayExplain, getDomainBarangayAiExplain, getDomainTypologyBarangay, getDomainTypologyHousehold, getDomainFacilityAccess, getDomainCapacity } from '../../api/api';
import CapacityBreakdown from "../capacity/CapacityBreakdown";
import { capacityColorByRank, capacityTierFromRank, CAPACITY_TIER_LEGEND } from "../capacity/capacityShared";
import { TypologyInfoCard, InfoToggleButton } from "../shared/typologyInfo";
import { SVI_TIER_COLORS, SVI_LEGEND, SVI_GRADIENT, sviColorByRank, TYPOLOGY_COLORS, TYPOLOGY_LEGEND, typologyColor, HAZARD_EXPOSURE_COLORS as HZC, HAZARD_EXPOSURE_TEXT as HZT, DISTANCE_COLORS, PLAIN_DOT } from "../shared/domainColors";
import { useTheme } from "../../hooks/useTheme";
import HouseholdDetailModal from "./HouseholdDetailModal";
import MapReportExport from "./MapReportExport";
import { OFFICIAL_BARANGAY_NAME } from "../shared/barangays";
import HazardWatchlistExport from "./HazardWatchlistExport";
import { useUrlParam } from "../../hooks/useRoute";

/* ─────────────────────────────────────────────────────────────
   CONSTANTS & PURE HELPERS  (outside component — never re-created)
───────────────────────────────────────────────────────────── */

// GIS overlays go through the shared axios client (api.js) so they follow
// the same base URL + JWT header as every other request -- no hard-coded
// 127.0.0.1 address, which would break once the app is deployed.
const fetchRoads     = () => getGISRoads().then((r) => r.data);
const fetchFlood     = () => getGISFlood().then((r) => r.data);
const fetchLandslide = () => getGISLandslide().then((r) => r.data);

/* ── Colour token objects — defined OUTSIDE so useMemo is cheap ── */
const DARK_TOKENS = {
  panelBg: "rgba(10,14,26,0.92)",
  panelBorder: "rgba(59,130,246,0.18)",
  panelShadow: "0 8px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(59,130,246,0.12) inset",
  cardBg: "rgba(14,20,36,0.95)",
  cardBorder: "rgba(59,130,246,0.14)",
  metricBg: "rgba(20,30,52,0.8)",
  metricBorder: "rgba(59,130,246,0.2)",
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#475569",
  textAccent: "#60a5fa",
  tbBg: "rgba(10,14,26,0.92)",
  tbBorder: "rgba(59,130,246,0.18)",
  tbBtnBg: "transparent",
  tbBtnBorder: "rgba(59,130,246,0.2)",
  tbBtnText: "#64748b",
  tbActiveBg: "rgba(37,99,235,0.25)",
  tbActiveBorder: "#3b82f6",
  tbActiveText: "#93c5fd",
  divider: "rgba(59,130,246,0.1)",
  barTrack: "rgba(255,255,255,0.06)",
  hoverBg: "rgba(14,20,36,0.97)",
  statusDot: "#22c55e",
  accentLine: "linear-gradient(180deg,#3b82f6,#1d4ed8)",
};

const LIGHT_TOKENS = {
  panelBg: "rgba(255,255,255,0.95)",
  panelBorder: "rgba(30,64,175,0.12)",
  panelShadow: "0 4px 24px rgba(30,64,175,0.1), 0 1px 0 rgba(255,255,255,0.8) inset",
  cardBg: "#ffffff",
  cardBorder: "rgba(30,64,175,0.1)",
  metricBg: "rgba(239,246,255,0.8)",
  metricBorder: "rgba(59,130,246,0.2)",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  textAccent: "#1d4ed8",
  tbBg: "rgba(255,255,255,0.95)",
  tbBorder: "rgba(30,64,175,0.1)",
  tbBtnBg: "transparent",
  tbBtnBorder: "rgba(30,64,175,0.15)",
  tbBtnText: "#64748b",
  tbActiveBg: "rgba(37,99,235,0.08)",
  tbActiveBorder: "#3b82f6",
  tbActiveText: "#1d4ed8",
  divider: "rgba(30,64,175,0.08)",
  barTrack: "rgba(0,0,0,0.05)",
  hoverBg: "rgba(255,255,255,0.98)",
  statusDot: "#22c55e",
  accentLine: "linear-gradient(180deg,#3b82f6,#1d4ed8)",
};

const RESULT_TYPE_META = {
  household: { color: "#3b82f6", label: "Household", icon: "M3 11l9-7 9 7M5 9v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9" },
  member:    { color: "#a855f7", label: "Resident",  icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM5 21a7 7 0 0114 0" },
  barangay:  { color: "#22c55e", label: "Barangay",  icon: "M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11zM12 13a2 2 0 100-4 2 2 0 000 4z" },
};

function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    // "Brgy." / "Bgy." (both spellings, with or without the period)
    .replace(/\bb\.?r?gy\.?\s*/gi, "")
    .replace(/\bbarangay\s*/gi, "")
    // "Pob." / "Poblacion" suffix, e.g. "Bgy. 1 Pob." -> "Bgy. 1"
    .replace(/\bpob(lacion)?\.?\s*/gi, "")
    .replace(/ñ/g, "n")
    // Canonicalize "Santo"/"Santa" long forms to their "Sto"/"Sta" abbreviations
    // so "Santo Angel" (domain model) matches "Sto Angel" (GeoJSON), etc.
    .replace(/\bsanto\b/g, "sto")
    .replace(/\bsanta\b/g, "sta")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* OPT #1 — O(1) stat lookup; falls back to fuzzy only on cache miss */
function findStatFast(featureName, statByName, barangayStats) {
  if (!featureName) return null;
  const fNorm = normalizeName(featureName);
  const exact = statByName[fNorm];
  if (exact) return exact;
  if (/^\d+$/.test(fNorm)) return null;
  return (
    barangayStats.find((b) => {
      const bNorm = normalizeName(b.barangay_name);
      if (/^\d+$/.test(bNorm)) return false;
      return bNorm.includes(fNorm) || fNorm.includes(bNorm);
    }) ?? null
  );
}

function getFeatureName(feature) {
  const p = feature.properties;
  return p?.Barangay_n || p?.NAME_3 || p?.name || p?.BARANGAY || "Unknown";
}

// Category → color. Stage 1 classification is quantile-based (equal quartiles
// across the 24 barangays, computed in barangay_stage1_vulnerability.py), NOT
// fixed score cutoffs — so color must come from the server-computed
// vuln_category, never re-derived from the raw score client-side.
const CATEGORY_COLORS = {
  "Very High": "#7b1fa2",
  "High":      "#ef4444",
  "Moderate":  "#f59e0b",
  "Low":       "#22c55e",
};

function getColor(category) {
  if (!category) return "#6b7280"; // no data
  return CATEGORY_COLORS[category] || "#6b7280";
}

function getScoreLabel(category) {
  return category && CATEGORY_COLORS[category] ? category : "No Data";
}

// Picks legible badge text (near-black vs. white) for whatever color a
// rank/category ramp hands it -- needed because several ramps in this file
// span from near-white (SVI's "Low" swatch, #fef2f2) to near-black (its
// "High" swatch, #7f1d1d), and a badge hardcoded to white text goes
// invisible at the light end (e.g. "SVI — Rank #24 · Low" was unreadable:
// white text on #fef2f2). Accepts "#rgb", "#rrggbb", or "rgb(r,g,b)".
function getContrastTextColor(bgColor) {
  if (!bgColor) return "#ffffff";
  let r, g, b;
  if (bgColor.startsWith("#")) {
    const hex = bgColor.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    r = parseInt(full.substring(0, 2), 16);
    g = parseInt(full.substring(2, 4), 16);
    b = parseInt(full.substring(4, 6), 16);
  } else {
    const m = bgColor.match(/rgba?\(([^)]+)\)/);
    if (!m) return "#ffffff";
    [r, g, b] = m[1].split(",").map((n) => parseFloat(n));
  }
  if ([r, g, b].some((n) => Number.isNaN(n))) return "#ffffff";
  // Perceptual luminance (ITU-R BT.601 weights) -- above the midpoint reads
  // as a "light" background, so dark text is more legible than white.
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? "#111827" : "#ffffff";
}

// ── Hazard dot map: household coloring by REAL physical hazard exposure ──
// Previously these dots were colored by the legacy per-household BVI score
// (tbl_vulnerability_index.vuln_category, a separate/older single-index
// model unrelated to Sir Shem's framework). Corrected so the Hazard dot map
// actually shows what its name says -- hazard exposure -- using the
// household's own hazard_exposure_score (0-4), the same field
// hazard_engine.detect_hazard_exposure() writes from real point-in-polygon
// checks against the flood/landslide hazard layers (Sir Shem's Domain B,
// View 1: calculate_hazard_exposure()). Score = max(flood, landslide)
// severity, so a household gets whichever hazard is worse for it.
const HAZARD_EXPOSURE_TIERS = {
  4: { label: "Very High",   color: HZC["Very High"] },
  3: { label: "High",        color: HZC["High"] },
  2: { label: "Moderate",    color: HZC["Moderate"] },
  1: { label: "Low",         color: HZC["Low"] },
  0: { label: "No Exposure", color: HZC["No Exposure"] },
};
// The score can arrive as 3, "3" or "3.0" depending on the column type, so
// it is normalised to a whole number before the lookup.
function hazardTierKey(score) {
  if (score == null || score === "") return null;
  const v = Math.round(Number(score));
  return Number.isFinite(v) ? v : null;
}
function getHazardExposureLabel(score) {
  return HAZARD_EXPOSURE_TIERS[hazardTierKey(score)]?.label ?? "No Data";
}
function getHazardExposureColor(score) {
  return HAZARD_EXPOSURE_TIERS[hazardTierKey(score)]?.color ?? "#94a3b8";
}
const HAZARD_EXPOSURE_LEGEND_ITEMS = [4, 3, 2, 1, 0].map((score) => ({
  score,
  label: HAZARD_EXPOSURE_TIERS[score].label,
  color: HAZARD_EXPOSURE_TIERS[score].color,
}));

/**
 * Renders the barangay boundaries straight from geojson coordinates onto a
 * plain <canvas>, colored the same way as the on-screen choropleth. This
 * sidesteps html2canvas entirely for the map — no tile loading races, no
 * Leaflet pane/CSS quirks, no dependency on whatever pan/zoom the live map
 * happens to be at. The output is always a clean, boundary-only image.
 *
 * @param {Object} geojson
 * @param {Object} statByName - normalized-name -> stat row lookup
 * @param {Array} barangayStats - fallback fuzzy-match list
 * @param {Object} [opts]
 * @param {number} [opts.width=1400]
 * @param {number} [opts.height=1000]
 * @param {number} [opts.padding=30]
 * @param {number} [opts.scale=2]
 * @returns {HTMLCanvasElement}
 */
function getFloodColor(code) {
  switch (code) {
    case "VHF": return "#000000"; // Very High — black
    case "HF":  return "#2E3192"; // High — blue
    case "MF":  return "#92278F"; // Moderate — purple
    case "LF":  return "#E6D6EC"; // Low — light purple/lavender
    default:    return "#94a3b8";
  }
}
function getFloodLabel(code) {
  switch (code) {
    case "VHF": return "Very High Flood Susceptibility";
    case "HF":  return "High Flood Susceptibility";
    case "MF":  return "Moderate Flood Susceptibility";
    case "LF":  return "Low Flood Susceptibility";
    default:    return "Unknown";
  }
}

function getLandslideColor(code) {
  switch (code) {
    case "HL": return "#ED1C24"; // High — red
    case "ML": return "#39B54A"; // Moderate — green
    case "LL": return "#FFF200"; // Low — yellow
    default:   return "#94a3b8";
  }
}
function getLandslideLabel(code) {
  switch (code) {
    case "HL": return "High Landslide Susceptibility";
    case "ML": return "Moderate Landslide Susceptibility";
    case "LL": return "Low Landslide Susceptibility";
    default:   return "Unknown";
  }
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((p) => p[0]);
  return [];
}

function randomPointsInFeature(feature, count, seed = 0) {
  const rings = getRings(feature.geometry);
  if (!rings.length || count === 0) return [];
  let bestRing = rings[0];
  let bestArea = 0;
  for (const ring of rings) {
    const lngs = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    const area =
      (Math.max(...lngs) - Math.min(...lngs)) *
      (Math.max(...lats) - Math.min(...lats));
    if (area > bestArea) { bestArea = area; bestRing = ring; }
  }
  const ring = bestRing;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const points = [];
  let s = seed + 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
  let attempts = 0;
  const maxAttempts = count * 200;
  while (points.length < count && attempts < maxAttempts) {
    attempts++;
    const lng = minLng + rand() * (maxLng - minLng);
    const lat = minLat + rand() * (maxLat - minLat);
    if (pointInPolygon([lng, lat], ring)) points.push([lat, lng]);
  }
  return points;
}

// Household-level classification (n=7,252, from compute_vulnerability.py /
// tbl_vuln_classification_breaks) genuinely uses this quantile scheme
// (top 5% / 75th-95th / 25th-75th / bottom 25%) — correct for the dot map.
// Hazard dot map legend -- describes real physical flood/landslide
// exposure (hazard_exposure_score, Sir Shem's Domain B View 1), NOT a
// vulnerability percentile band. Colors/labels match HAZARD_EXPOSURE_TIERS.
const HOUSEHOLD_LEGEND_ITEMS = [
  { color: HZC["Very High"],   label: "Very High",   range: "Flood: Very High",         category: "Very High"   },
  { color: HZC["High"],        label: "High",        range: "Flood or landslide: High", category: "High"        },
  { color: HZC["Moderate"],    label: "Moderate",    range: "Flood or landslide: Moderate", category: "Moderate" },
  { color: HZC["Low"],         label: "Low",         range: "Flood: Low",               category: "Low"         },
  { color: HZC["No Exposure"], label: "No Exposure", range: "Outside mapped hazard area", category: "No Exposure" },
  { color: "#94a3b8", label: "No data",     range: "—",                        category: null          },
];

// Barangay-level Stage 1 classification (n=24, barangay_stage1_vulnerability.py)
// uses plain equal quartiles, NOT the household-level top-5%/75-95th scheme —
// "top 5%" isn't a meaningful cut at n=24. Was previously copy-pasted from the
// household legend; corrected to describe what the barangay classification
// actually computes.
const BARANGAY_LEGEND_ITEMS = [
  { color: "#7b1fa2", label: "Very High", range: "Top quartile",    category: "Very High" },
  { color: "#ef4444", label: "High",      range: "51st–75th",       category: "High"      },
  { color: "#f59e0b", label: "Moderate",  range: "26th–50th",       category: "Moderate"  },
  { color: "#22c55e", label: "Low",       range: "Bottom quartile", category: "Low"       },
  { color: "#6b7280", label: "No data",   range: "—",               category: null        },
];

// Official SVI model (Sir Shem's reference implementation, n=24 barangays).
// Tier labels/order per the panel's own redesign spec: qcut(score, 4) ->
// Low / Moderate-low / Moderate-high / High, 6 barangays per tier (24÷4),
// rank 1 = most socially vulnerable. NOT the legacy Stage 1 BVI's
// Very High/High/Moderate/Low naming (BARANGAY_LEGEND_ITEMS above) — the
// two models use different tier vocabularies on purpose, so don't unify them.
// Colored red (most vulnerable) -> orange -> amber -> green (least
// vulnerable), from shared/domainColors.js so every page matches. Kept as 4 named tiers
// for the legend/badges, but the actual choropleth fill (getSviColorByRank
// below) interpolates continuously across all 24 ranks so barangays within
// the same quartile still show a visible shade difference on the map.
const SVI_CATEGORY_COLORS = SVI_TIER_COLORS; // red -> orange -> amber -> green (shared/domainColors.js)
function getSviColor(category) {
  if (!category) return "#6b7280"; // no data
  return SVI_CATEGORY_COLORS[category] || "#6b7280";
}
const SVI_LEGEND_ITEMS = [...SVI_LEGEND, { color: "#6b7280", label: "No data", range: "—", category: null }];
function sviCategoryFromRank(rank) {
  if (rank == null) return null;
  if (rank <= 6) return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}
// Continuous per-barangay shade for the choropleth fill itself — rank 1
// (most vulnerable) is deep red, rank 24 (least vulnerable) is near white,
// with every rank in between interpolated linearly, same endpoints as
// SVI_CATEGORY_COLORS' "High" and "Low" swatches above.
const getSviColorByRank = sviColorByRank;

// ── Operational Capacity (Sir Shem's Domain B, organizational/medical/
// mobility/comms/fiscal indicators, sanmiguel_student/capacity.py) — its
// own map view, deliberately separate from SVI above. His own docstring on
// score_capacity() says it plainly: "Capacity remains a separate construct
// from vulnerability." The two are never summed into one number anywhere in
// this app (verified: domain_vulnerability_routes.py returns svi_score and
// capacity_score as independent fields, no combined/overall score exists),
// and this view's own choropleth/legend/ranking are all keyed off
// capacity_rank alone -- SVI is not part of this fill or this ranking list.
// capacity_rank: 1 = HIGHEST capacity_score = the barangay best equipped to
// respond (see capacity.py: rank(ascending=False)) -- the OPPOSITE
// direction from svi_rank, where 1 = most vulnerable. So the ramp/labels
// below are intentionally inverted from SVI's: rank 1 here is the "good"
// end, colored green, not red. A separate green/amber/red ramp (rather than
// reusing SVI's red-only ramp) makes that inversion visually unambiguous
// when flipping between the two tabs.
function capacityCategoryFromRank(rank) {
  if (rank == null) return null;
  if (rank <= 6) return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}
const CAPACITY_RAMP_GOOD = { r: 21,  g: 128, b: 61  }; // #15803d — rank 1, best-equipped
const CAPACITY_RAMP_MID  = { r: 217, g: 119, b: 6   }; // #d97706 — mid-table
const CAPACITY_RAMP_BAD  = { r: 185, g: 28,  b: 28  }; // #b91c1c — rank 24, least-equipped
function getCapacityColorByRank(rank) {
  if (rank == null) return "#d1d5db"; // no data — neutral gray
  const clamped = Math.min(24, Math.max(1, rank));
  const t = (clamped - 1) / 23; // 0 = rank 1 (best capacity) -> 1 = rank 24 (worst capacity)
  let c1, c2, localT;
  if (t <= 0.5) { c1 = CAPACITY_RAMP_GOOD; c2 = CAPACITY_RAMP_MID; localT = t / 0.5; }
  else { c1 = CAPACITY_RAMP_MID; c2 = CAPACITY_RAMP_BAD; localT = (t - 0.5) / 0.5; }
  const r = Math.round(c1.r + (c2.r - c1.r) * localT);
  const g = Math.round(c1.g + (c2.g - c1.g) * localT);
  const b = Math.round(c1.b + (c2.b - c1.b) * localT);
  return `rgb(${r}, ${g}, ${b})`;
}
const CAPACITY_LEGEND_ITEMS = [
  { rank: 3,  label: "High capacity",       range: "Rank 1–6"   },
  { rank: 9,  label: "Moderate-high",       range: "Rank 7–12"  },
  { rank: 15, label: "Moderate-low",        range: "Rank 13–18" },
  { rank: 21, label: "Low capacity",        range: "Rank 19–24" },
].map((item) => ({ ...item, color: getCapacityColorByRank(item.rank) }));

// ── Household typology (k=5 k-modes clusters), shown at barangay level ──
// Barangay-level only: each barangay is colored by its DOMINANT cluster
// (% breakdown in the tooltip). No household-level point/coordinate is
// ever fetched or plotted here — see docs/METHOD_GUIDE.md and
// backend/typology_barangay_aggregate.py. Cluster labels are our own
// best-fit match to Sir Shem's demo label names, NOT yet confirmed by
// him — flagged in the legend caption below, not hidden.
// FIXED 2026-09: these 5 labels had drifted out of sync with the backend's
// current CLUSTER_LABELS (typology_household_export.py /
// typology_barangay_aggregate.py), which were re-derived after a formula
// fix reshuffled the k-modes clusters. Ids 2 and 4 were transposed here,
// and id 3's text said "structurally sound" -- the OPPOSITE of what that
// cluster actually is ("structurally insecure", 100% weak-wall + 100%
// financially-excluded). Colors are arbitrary per-id assignments and are
// left as-is; only the label text below was wrong.
const TYPOLOGY_CLUSTER_COLORS = TYPOLOGY_COLORS; // own non-risk palette (shared/domainColors.js)
const TYPOLOGY_LEGEND_ITEMS = TYPOLOGY_LEGEND;
const getTypologyColor = typologyColor;

// ── Household overlay: what the dots are colored by ──
// The household dots are drawn in EVERY map view, on top of that view's
// barangay fill. Each view's score is still computed on its own; the dots
// only show where the households are and one household-level attribute.
const DOT_COLOR_OPTIONS = [
  { id: "hazard",   label: "Hazard",   title: "Color households by their own flood / landslide exposure" },
  { id: "distance", label: "Distance", title: "Color households by their straight-line distance to the RHU and the Fire Station (2 km)" },
  { id: "cluster",  label: "Typology", title: "Color households by their typology (k-modes cluster)" },
  { id: "plain",    label: "Location", title: "Plain dots: household locations only" },
];
const DOT_COLOR_DEFAULT = { hazard: "hazard", svi: "distance", capacity: "plain", typology: "cluster" };
const DISTANCE_TIERS = [
  { key: "Beyond both", color: DISTANCE_COLORS["Beyond both"], label: "Beyond 2 km of both", short: "Beyond both", range: "RHU and Fire Station" },
  { key: "Beyond one",  color: DISTANCE_COLORS["Beyond one"],  label: "Beyond 2 km of one",  short: "Beyond one", range: "RHU or Fire Station" },
  { key: "Within 2 km", color: DISTANCE_COLORS["Within 2 km"], label: "Within 2 km of both", short: "Within both", range: "RHU and Fire Station" },
];
const DISTANCE_COLOR = Object.fromEntries(DISTANCE_TIERS.map((t) => [t.key, t.color]));
const PLAIN_DOT_COLOR = PLAIN_DOT.fill;
// Flood has 4 levels, landslide 3; both map onto the same tier colours.
const EXPOSURE_COLOR_BY_LABEL = HZC;
function exposureLabelOf(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "very high") return "Very High";
  if (v === "high") return "High";
  if (v === "moderate") return "Moderate";
  if (v === "low") return "Low";
  return "No Exposure";
}

// Facility Distance choropleth ramp (Domain B, View 2 -- distance-only
// subset, 2 of its 6 indicators) -- light teal (0% of households beyond
// 2km, best access) to dark teal (100% beyond, worst access). Same teal
// family as the "Facility Distance" toggle pill/legend.
const FACILITY_ACCESS_RAMP_LIGHT = { r: 224, g: 247, b: 250 };
const FACILITY_ACCESS_RAMP_DARK  = { r: 8,   g: 81,  b: 96  };
function getFacilityAccessColor(pctBeyond) {
  if (pctBeyond == null) return "#d1d5db";
  const t = Math.min(100, Math.max(0, pctBeyond)) / 100;
  const r = Math.round(FACILITY_ACCESS_RAMP_LIGHT.r + (FACILITY_ACCESS_RAMP_DARK.r - FACILITY_ACCESS_RAMP_LIGHT.r) * t);
  const g = Math.round(FACILITY_ACCESS_RAMP_LIGHT.g + (FACILITY_ACCESS_RAMP_DARK.g - FACILITY_ACCESS_RAMP_LIGHT.g) * t);
  const b = Math.round(FACILITY_ACCESS_RAMP_LIGHT.b + (FACILITY_ACCESS_RAMP_DARK.b - FACILITY_ACCESS_RAMP_LIGHT.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// ── Capacity + Distance (Domain B, View 2 -- the slide's actual 6-indicator
// score: 4 institutional flags + RHU/Fire distance, see
// backend/capacity_distance_score.py) -- the map's "Capacity" view was
// repurposed to show THIS score, in place of the old Operational Capacity
// score (capacity_score/capacity_rank, which stays available elsewhere --
// household popup, dashboard card -- just not as its own map tab anymore).
// capacity_distance_rank runs the SAME direction as svi_rank: 1 = HIGHEST
// score = MORE flags absent + farther from facilities = WORST capacity, NOT
// best (that inversion was specific to the old capacity_rank; this new
// score follows the SVI-style "1 = worst" convention throughout). A
// distinct amber/brown ramp keeps it visually unmistakable from both SVI's
// red ramp and the old green/amber/red Operational Capacity ramp above.
function capDistCategoryFromRank(rank) {
  if (rank == null) return null;
  if (rank <= 6) return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}

/* ── Map icons ── */
const makeIcon = (gradient, svgPath) =>
  L.divIcon({
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    tooltipAnchor: [16, 0],
    html: `<div style="width:32px;height:32px;border-radius:50%;background:${gradient};border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">${svgPath}</div>`,
  });

// Labelled pin for the two facilities the 2 km distance is measured from.
const facilityPin = (label, color) => L.divIcon({
  className: "",
  iconSize: [0, 0],
  iconAnchor: [0, 0],
  tooltipAnchor: [0, -14],
  html: `<div style="position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto">
    <div style="padding:3px 8px;border-radius:999px;background:${color};color:#fff;font:700 11px/1.2 'Segoe UI',system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.35);border:1.5px solid #fff">${label}</div>
    <div style="width:2px;height:7px;background:${color}"></div>
    <div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);margin-top:-1px"></div>
  </div>`,
});

const pharmacyIcon = makeIcon(
  "linear-gradient(135deg,#7c3aed,#4c1d95)",
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="20" rx="1.5" fill="white"/><rect x="2" y="9" width="20" height="6" rx="1.5" fill="white"/></svg>`
);
const elementarySchoolIcon = makeIcon(
  "linear-gradient(135deg,#f59e0b,#d97706)",
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/></svg>`
);
const highSchoolIcon = makeIcon(
  "linear-gradient(135deg,#3b82f6,#1d4ed8)",
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/></svg>`
);
const governmentIcon = makeIcon(
  "linear-gradient(135deg,#10b981,#065f46)",
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M3 22V9l9-7 9 7v13H3zm2-2h14V10l-7-5.5L5 10v10zm3-5h8v2H8v-2zm0-4h8v2H8v-2z"/></svg>`
);

/* ── Static data ── */
// Same facility points as backend/facility_distance.py (Capacity + Distance pipeline).
const RHU_POINT  = [10.7815, 122.4647];
const FIRE_POINT = [10.7869, 122.4683];

const HEALTHCARE = [
  { name: "Five C Clinic and Pharmacy", lat: 10.7777246, lng: 122.4611669 },
  { name: "TGP The Generics Pharmacy (Ajuy)", lat: 10.7824868, lng: 122.4439603 },
  { name: "Guelos Pharmacy", lat: 10.7803114, lng: 122.4661413 },
  { name: "Gillet Pharmacy, San Miguel Branch", lat: 10.7810983, lng: 122.4671907 },
  { name: "Soliva Drugstore", lat: 10.7799648, lng: 122.4667181 },
  { name: "Onemig Pharmacy", lat: 10.7803536, lng: 122.4679663 },
  { name: "Happy Med", lat: 10.7869727, lng: 122.4690797 },
  { name: "Centeno Pharmacy", lat: 10.7584844, lng: 122.5006199 },
  { name: "Rural Health Unit - Municipality of San Miguel (Main Health Center)", lat: 10.7814615, lng: 122.4647052 },
  { name: "The Specialist Medical Clinic - San Miguel", lat: 10.7791401, lng: 122.4688226 },
  { name: "Sabando Medical and Surgical Clinic", lat: 10.7804993, lng: 122.4666358 },
  { name: "Lyssa Animal Bite Center - San Miguel Branch", lat: 10.7807191, lng: 122.4675694 },
  { name: "San Miguel Diagnostics Inc.", lat: 10.7803956, lng: 122.4658285 },
  { name: "San Jose Barangay Health Center", lat: 10.7612842, lng: 122.4968367 },
  { name: "The Specialist Medical Laboratory Center", lat: 10.7771592, lng: 122.471792 },
];

// The main Rural Health Unit -- same coordinate as its entry in HEALTHCARE
// above. Kept as its own constant for the "RHU 2km" service-radius overlay,
// which mirrors Sir Shem's calculate_facility_capacity_2km() framing (the
// RHU's own 2km catchment), distinct from the general Healthcare layer's
// per-household nearest-facility distance stat.
const RHU_LOCATION = { name: "Rural Health Unit - Municipality of San Miguel (Main Health Center)", lat: 10.7814615, lng: 122.4647052 };

// The municipal Fire Station -- same coordinate used by the backend's
// Domain B capacity/distance calculations (sanmiguel_student/config.py's
// FIRE_LAT/FIRE_LON, and facility_access_score.py's calculate_facility_capacity_2km()).
// Powers the "Fire 2km" service-radius overlay, the same visual treatment
// as RHU_LOCATION above but its own color so the two are never confused.
const FIRE_LOCATION = { name: "Fire Station - Municipality of San Miguel", lat: 10.78698, lng: 122.46827 };


/* Great-circle distance in km -- accurate at this geographic scale (a single
   municipality), much simpler than a real routing-distance API, and needs
   zero external calls since it's pure math over coordinates we already have. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Straight-line distance to the closest healthcare facility, in km, plus
   which facility that is. Called once per household during dot construction
   (15 facilities x ~7,249 households is trivial for plain JS math). */
function nearestHealthcare(lat, lng) {
  let bestDist = Infinity, bestFacility = null;
  for (const h of HEALTHCARE) {
    const d = haversineKm(lat, lng, h.lat, h.lng);
    if (d < bestDist) { bestDist = d; bestFacility = h; }
  }
  return { distanceKm: bestDist, facility: bestFacility };
}

const GOVERNMENT = [
  { name: "Municipal Hall of San Miguel", lat: 10.782, lng: 122.4637 },
  { name: "COMELEC Office", lat: 10.782, lng: 122.4637 },
  { name: "Civil Registry Office (LCR)", lat: 10.782, lng: 122.4637 },
  { name: "MDRRMO Office", lat: 10.782, lng: 122.4637 },
  { name: "MSWD Office", lat: 10.782, lng: 122.4637 },
  { name: "Senior Citizens Center", lat: 10.782, lng: 122.463 },
  { name: "PWD Office", lat: 10.782, lng: 122.4637 },
];

const ELEMENTARY_SCHOOLS = [
  { name: "San Miguel Central Elementary School", lat: 10.7790349, lng: 122.4676097 },
  { name: "Consolacion Elementary School", lat: 10.8100043, lng: 122.4754063 },
  { name: "San Jose Elementary School", lat: 10.7620601, lng: 122.4959247 },
  { name: "Sta. Cruz Elementary School", lat: 10.7902889, lng: 122.4583487 },
  { name: "Igtambo Elementary School", lat: 10.7772, lng: 122.4526 },
  { name: "San Antonio Elementary School", lat: 10.7766, lng: 122.4376 },
  { name: "Sta. Teresa Elementary School", lat: 10.8046, lng: 122.4914 },
  { name: "Sto. Angel Elementary School", lat: 10.7629, lng: 122.4208 },
  { name: "Sto. Niño Elementary School", lat: 10.7846, lng: 122.4809 },
];

const HIGH_SCHOOLS = [
  { name: "Leonora S. Salapantan National High School (LSSNHS)", type: "Public", lat: 10.7824868, lng: 122.4639603 },
  { name: "The Integrated Academy School System Inc. — San Miguel Ext. (TIA)", type: "Private", lat: 10.7785099, lng: 122.4592824 },
  { name: "Shepherd's Way Christian Academy", type: "Private", lat: 10.7738872, lng: 122.4611283 },
];

/* ─────────────────────────────────────────────────────────────
   CHILD COMPONENTS
───────────────────────────────────────────────────────────── */

function FitBounds({ geojson }) {
  const map = useMap();
  useEffect(() => {
    if (!geojson) return;
    try {
      const bounds = L.geoJSON(geojson).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
    } catch (e) {
      console.warn("fitBounds failed:", e);
    }
  }, [geojson, map]);
  return null;
}


/* Zoom to the focused barangay; back to the whole municipality when cleared. */
function FocusBounds({ feature, geojson }) {
  const map = useMap();
  const wasFocused = useRef(false);
  useEffect(() => {
    try {
      if (feature) {
        const b = L.geoJSON(feature).getBounds();
        if (b.isValid()) map.flyToBounds(b, { padding: [40, 40], maxZoom: 16, duration: 0.6 });
        wasFocused.current = true;
      } else if (wasFocused.current && geojson) {
        const b = L.geoJSON(geojson).getBounds();
        if (b.isValid()) map.flyToBounds(b, { padding: [30, 30], duration: 0.6 });
        wasFocused.current = false;
      }
    } catch (e) { /* ignore */ }
  }, [feature, geojson, map]);
  return null;
}

/* OPT #2 — CoordTracker writes directly to a DOM span ref — zero React re-renders on mousemove */
function CoordTracker({ coordSpanRef }) {
  const map = useMap();
  useEffect(() => {
    const handler = (e) => {
      if (coordSpanRef.current) {
        coordSpanRef.current.textContent =
          `${e.latlng.lat.toFixed(4)}° N  ${e.latlng.lng.toFixed(4)}° E`;
      }
    };
    map.on("mousemove", handler);
    return () => map.off("mousemove", handler);
  }, [map, coordSpanRef]);
  return null;
}

/* Pulsing highlight ring dropped on a dot found via search. Uses its own
   pane above householdDotsPane so it's always visible on top of the dot
   cloud, and a plain L.marker + divIcon (not a React-managed layer) since
   it only ever needs to exist/not-exist, not participate in re-renders. */
function SearchPulseMarker({ position }) {
  const map = useMap();
  useEffect(() => {
    if (!position) return;

    if (!map.getPane("searchPulsePane")) {
      const pane = map.createPane("searchPulsePane");
      pane.style.zIndex = 470; // above householdDotsPane (450)
      pane.style.pointerEvents = "none";
    }

    const icon = L.divIcon({
      className: "search-pulse-icon",
      html: `<span class="search-pulse-ring"></span><span class="search-pulse-ring search-pulse-ring--delay"></span><span class="search-pulse-dot"></span>`,
      iconSize: [1, 1],
    });

    const marker = L.marker(position, {
      icon,
      pane: "searchPulsePane",
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);

    return () => { try { marker.remove(); } catch { /* cleanup */ } };
  }, [map, position]);

  return null;
}

/* Expose map ref outside MapContainer */
function MapRefCapture({ mapRef }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

/* ── Breakdown bar ── */
function BreakdownBar({ value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
      <div style={{ flex: 1, height: 4, background: "rgba(128,128,128,0.15)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: color, borderRadius: 2,
          transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 32, textAlign: "right", fontWeight: 600, opacity: 0.9 }}>
        {pct}%
      </span>
    </div>
  );
}

/* OPT #3 — DotMapLayer: canvas renderer replaces thousands of React CircleMarker components.
   All dots share ONE <canvas> element — dramatically faster render and pan/zoom.

   FIX: dots render in their own dedicated Leaflet pane ("householdDotsPane") with a
   z-index above the flood/landslide/choropleth polygon panes. Without this, those
   polygons (declared later in JSX, so stacked on top in the DOM) intercept clicks
   meant for a dot sitting underneath them -- exactly the conflict where a dot inside
   a flood/landslide zone became unclickable. The dedicated pane makes dots always
   win the click regardless of which overlays are toggled on or their JSX order. */
const DotMapLayer = memo(function DotMapLayer({ dots, dotFilters, onDotClick, clusterFilter, glowLabel = null }) {
  const map = useMap();

  /* Filter is the only thing that changes frequently — useMemo keeps it cheap.
     clusterFilter (optional -- only passed for the Hazard view's
     exposure-colored dots, see hazardClusterFilter) layers a typology-cluster
     narrow on top of the hazard-tier filter, so a household dot's hazard-tier
     COLOR stays the point while only one cluster's worth of dots are on
     screen at a time. A dot with no cluster match (d.clusterId == null) is
     never hidden by this filter — it has no cluster to be excluded by. */
  const visibleDots = useMemo(
    () => dots.filter((d) => {
      if (dotFilters[d.vulnLabel] === false) return false;
      if (clusterFilter && d.clusterId != null && clusterFilter[d.clusterId] === false) return false;
      return true;
    }),
    [dots, dotFilters, clusterFilter]
  );

  useEffect(() => {
    if (!visibleDots.length) return;

    /* Dedicated pane above the barangay fills (overlayPane 400) and below
       markerPane (600) so facility pins stay on top. The pane does NOT take
       pointer events: clicks and hovers pass through to the barangay fill
       underneath (its tooltip and click-to-select keep working), and dot
       clicks are found by the hit test in the next effect instead. */
    if (!map.getPane("householdDotsPane")) {
      const pane = map.createPane("householdDotsPane");
      pane.style.zIndex = 450;
    }
    map.getPane("householdDotsPane").style.pointerEvents = "none";

    /* Single shared canvas renderer for ALL dots -- the main performance win. */
    const renderer = L.canvas({ padding: 0.5, pane: "householdDotsPane" });
    const group = L.layerGroup().addTo(map);

    /* Highlighted tier (Very High exposure): drawn LAST so it sits on top of
       every other dot, slightly larger, with a soft static halo on the same
       canvas (no extra DOM, no per-frame work). */
    const isHot = (d) => glowLabel != null && d.vulnLabel === glowLabel;
    const ordered = glowLabel == null ? visibleDots
      : [...visibleDots.filter((d) => !isHot(d)), ...visibleDots.filter(isHot)];
    if (glowLabel != null) {
      ordered.filter(isHot).forEach((dot) => {
        group.addLayer(L.circleMarker(dot.pos, {
          radius: 9, stroke: false, fillColor: "#ef4444", fillOpacity: 0.22,
          renderer, interactive: false, pane: "householdDotsPane",
        }));
      });
    }

    ordered.forEach((dot) => {
      const hot = isHot(dot);
      group.addLayer(L.circleMarker(dot.pos, {
        radius: hot ? 4.2 : 3,
        fillColor: dot.color,
        fillOpacity: hot ? 1 : 0.9,
        color: hot ? "#fca5a5" : (dot.stroke || "#fff"),
        weight: hot ? 1.1 : 0.6,
        renderer,
        interactive: false,
        pane: "householdDotsPane",
      }));
    });

    return () => {
      try { group.remove(); } catch { /* cleanup */ }
      try { renderer.remove(); } catch { /* cleanup */ }
    };
  }, [map, visibleDots, glowLabel]);

  /* Hit test for dot clicks. Screen positions of the dots in view are put
     in a 16px grid after every pan/zoom, so a click or hover only looks at
     the few dots in the 3x3 cells around the pointer. A click that lands on
     a dot is stopped before it reaches the barangay fill; a click anywhere
     else goes through to the fill as normal. */
  useEffect(() => {
    if (!visibleDots.length || !onDotClick) return;
    const container = map.getContainer();
    const CELL = 16, HIT = 7;
    let grid = null;
    const build = () => {
      grid = new Map();
      const size = map.getSize();
      for (let i = 0; i < visibleDots.length; i++) {
        const d = visibleDots[i];
        if (!d.householdId) continue;
        const p = map.latLngToContainerPoint(d.pos);
        if (p.x < -HIT || p.y < -HIT || p.x > size.x + HIT || p.y > size.y + HIT) continue;
        const key = Math.floor(p.x / CELL) + ":" + Math.floor(p.y / CELL);
        let arr = grid.get(key);
        if (!arr) { arr = []; grid.set(key, arr); }
        arr.push({ x: p.x, y: p.y, d });
      }
    };
    const nearest = (x, y) => {
      if (!grid) return null;
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      let best = null, bestD = HIT * HIT;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const arr = grid.get((cx + i) + ":" + (cy + j));
        if (!arr) continue;
        for (const c of arr) {
          const dd = (c.x - x) ** 2 + (c.y - y) ** 2;
          if (dd <= bestD) { bestD = dd; best = c; }
        }
      }
      return best;
    };
    const rel = (e) => {
      const r = container.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const onOverlay = (e) => !!(e.target && e.target.closest &&
      e.target.closest(".leaflet-control, .leaflet-marker-icon, .leaflet-popup, .leaflet-tooltip"));
    let down = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onClick = (e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; // a drag, not a click
      if (onOverlay(e)) return;
      const [x, y] = rel(e);
      const hit = nearest(x, y);
      if (!hit) return;
      e.stopPropagation();
      onDotClick(hit.d.householdId);
    };
    let raf = 0, last = null;
    const onMove = (e) => {
      last = onOverlay(e) ? null : rel(e);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        container.classList.toggle("hh-dot-hover", !!(last && nearest(last[0], last[1])));
      });
    };
    const onLeave = () => container.classList.remove("hh-dot-hover");
    const stale = () => { grid = null; container.classList.remove("hh-dot-hover"); };

    build();
    map.on("moveend zoomend resize viewreset", build);
    map.on("movestart zoomstart", stale);
    container.addEventListener("mousedown", onDown, true);
    container.addEventListener("click", onClick, true);
    container.addEventListener("mousemove", onMove, { passive: true });
    container.addEventListener("mouseleave", onLeave);
    return () => {
      map.off("moveend zoomend resize viewreset", build);
      map.off("movestart zoomstart", stale);
      container.removeEventListener("mousedown", onDown, true);
      container.removeEventListener("click", onClick, true);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      container.classList.remove("hh-dot-hover");
    };
  }, [map, visibleDots, onDotClick]);

  /* Pulsing ring for the highlighted tier. Lightweight DivIcon markers in
     their own non-interactive pane (clicks fall through to the canvas dot
     underneath). The animation only touches transform + opacity, so the
     browser runs it on the GPU compositor -- no layout or repaint per frame,
     and pan/zoom stay smooth. Respects "reduce motion" (static halo only). */
  useEffect(() => {
    if (glowLabel == null) return;
    const hot = visibleDots.filter((d) => d.vulnLabel === glowLabel);
    if (!hot.length) return;
    if (!map.getPane("hazardGlowPane")) {
      const pane = map.createPane("hazardGlowPane");
      pane.style.zIndex = 445;            // just under the dot canvas (450)
      pane.style.pointerEvents = "none";
    }
    const icon = (i) => L.divIcon({
      className: "",
      html: `<span class="vh-pulse" style="animation-delay:${(i % 6) * 0.35}s"></span>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    });
    const glow = L.layerGroup(hot.map((d, i) => L.marker(d.pos, {
      icon: icon(i), interactive: false, keyboard: false, pane: "hazardGlowPane",
    }))).addTo(map);
    return () => { try { glow.remove(); } catch { /* cleanup */ } };
  }, [map, visibleDots, glowLabel]);

  return null;
});

/* Pulse styling for highlighted (Very High) households -- injected once. */
if (typeof document !== "undefined" && !document.getElementById("vh-pulse-style")) {
  const st = document.createElement("style");
  st.id = "vh-pulse-style";
  st.textContent = `
    .vh-pulse { position:absolute; inset:0; border-radius:50%; pointer-events:none;
      background: radial-gradient(circle, rgba(239,68,68,0.55) 0%, rgba(239,68,68,0.18) 45%, rgba(239,68,68,0) 70%);
      box-shadow: 0 0 0 1.5px rgba(239,68,68,0.55);
      transform: scale(0.35); opacity: 0.9; will-change: transform, opacity;
      animation: vhPulse 2.1s cubic-bezier(0.22, 0.61, 0.36, 1) infinite; }
    @keyframes vhPulse { 0% { transform: scale(0.35); opacity: 0.9; } 70% { opacity: 0.15; } 100% { transform: scale(1); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .vh-pulse { animation: none; transform: scale(0.6); opacity: 0.45; } }
    .hh-dot-hover, .hh-dot-hover * { cursor: pointer !important; }
  `;
  document.head.appendChild(st);
}

/* ── Back-to-back breakdown bar ── */
const MirrorBar = memo(function MirrorBar({ valueA, valueB, total, colorA, colorB }) {
  const pA = total > 0 ? Math.round((valueA / total) * 100) : 0;
  const pB = total > 0 ? Math.round((valueB / total) * 100) : 0;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4, width:"100%" }}>
      <span style={{ fontSize:11, fontWeight:700, color:colorA, minWidth:28, textAlign:"right" }}>{pA}%</span>
      <div style={{ flex:1, height:5, background:"rgba(128,128,128,0.12)", borderRadius:2, overflow:"hidden", direction:"rtl" }}>
        <div style={{ width:`${pA}%`, height:"100%", background:colorA, borderRadius:2, transition:"width 0.6s ease" }} />
      </div>
      <div style={{ width:1, background:"rgba(128,128,128,0.25)", height:14, flexShrink:0 }} />
      <div style={{ flex:1, height:5, background:"rgba(128,128,128,0.12)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${pB}%`, height:"100%", background:colorB, borderRadius:2, transition:"width 0.6s ease" }} />
      </div>
      <span style={{ fontSize:11, fontWeight:700, color:colorB, minWidth:28 }}>{pB}%</span>
    </div>
  );
});

// ── "How was this calculated?" — live per-indicator breakdown for the
//    selected barangay's Stage 1 classification. Fetches
//    /vulnerability/barangay-stage1/<id>/explain on open (not precomputed
//    client-side) so this always reflects the real current data, same
//    transparency principle as the household "BVI Computation Breakdown"
//    modal it's styled to match.
const BarangayExplainModal = memo(function BarangayExplainModal({ barangayId, dark, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    // No setLoading(true)/setError(null) here — the parent renders this with
    // key={barangayId}, so a barangayId change fully remounts the component
    // and the useState initial values (true/null) already cover the reset.
    getVulnBarangayStage1Explain(barangayId)
      .then((r) => { if (!cancelled) { setData(r.data); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.response?.data?.error || e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [barangayId]);

  const IndicatorRow = ({ ind }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>
      <span style={{ flex: 1, fontSize: 12.5, color: dark ? "#e2e8f0" : "#334155" }}>{ind.label}</span>
      <span style={{ fontSize: 11.5, color: dark ? "#94a3b8" : "#64748b", fontFamily: "monospace", minWidth: 130, textAlign: "right" }}>
        {ind.households_present} of {data?.total_households} HH ({ind.pct}%)
      </span>
      <span style={{
        fontSize: 11, fontWeight: 800, minWidth: 34, textAlign: "center",
        padding: "2px 0", borderRadius: 5,
        background: dark ? "rgba(59,130,246,0.15)" : "rgba(219,234,254,0.7)",
        color: dark ? "#93c5fd" : "#1d4ed8",
      }}>
        {ind.bin_score}/4
      </span>
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 3000,
      background: "rgba(10,18,40,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: dark ? "#0f1729" : "#fff", borderRadius: 16,
        width: "100%", maxWidth: 640, maxHeight: "88vh",
        boxShadow: "0 32px 80px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#0d1b5e 0%,#1565c0 100%)",
          padding: "15px 22px", flexShrink: 0,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>
              Barangay Classification — How This Was Calculated
            </div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>
              Stage 1 top-down method · % of households per indicator, binned 1-4, ranked by quartile across all 24 barangays
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
            width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          {loading && (
            <div style={{ textAlign: "center", padding: "40px 0", color: dark ? "#94a3b8" : "#64748b", fontSize: 13 }}>
              ⏳ Loading live computation…
            </div>
          )}
          {error && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#ef4444", fontSize: 13 }}>
              ❌ {error}
            </div>
          )}
          {data && !loading && !error && (
            <>
              <div style={{
                background: getColor(data.vuln_category) + "14",
                border: `1px solid ${getColor(data.vuln_category)}33`,
                borderRadius: 10, padding: "12px 14px", marginBottom: 16,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: dark ? "#f1f5f9" : "#1e293b" }}>{data.barangay_name}</div>
                  <div style={{ fontSize: 11.5, color: dark ? "#94a3b8" : "#64748b", marginTop: 2 }}>
                    {data.total_households.toLocaleString()} households · Stage 1 Vuln Score {data.stored_vuln_score?.toFixed(4) ?? data.vuln_score.toFixed(4)}
                  </div>
                </div>
                <span style={{
                  background: getColor(data.vuln_category), color: getContrastTextColor(getColor(data.vuln_category)),
                  fontSize: 11.5, fontWeight: 800, padding: "5px 12px", borderRadius: 20,
                }}>
                  {data.vuln_category}
                </span>
              </div>

              {data.stale && (
                <div style={{
                  background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)",
                  borderRadius: 8, padding: "9px 12px", marginBottom: 16,
                  fontSize: 11.5, color: dark ? "#fbbf24" : "#b45309",
                }}>
                  ⚠️ Live recomputation ({data.vuln_score.toFixed(4)}) doesn't match the last batch run
                  ({data.stored_vuln_score?.toFixed(4)}) — household data has likely changed since
                  barangay_stage1_vulnerability.py was last run. Re-run the pipeline to refresh the
                  choropleth and quartile ranking.
                </div>
              )}

              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                color: "#ef4444", marginBottom: 4 }}>
                Sensitivity — {data.avg_sensitivity.toFixed(2)}/4 avg
              </div>
              <div style={{ marginBottom: 16 }}>
                {data.sensitivity_indicators.map((ind) => <IndicatorRow key={ind.key} ind={ind} />)}
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                color: "#1565c0", marginBottom: 4 }}>
                Adaptive Capacity (inverted — lower % coverage = worse) — {data.avg_adaptive_capacity.toFixed(2)}/4 avg
              </div>
              <div>
                {data.ac_indicators.map((ind) => <IndicatorRow key={ind.key} ind={ind} />)}
              </div>

              <div style={{
                marginTop: 16, padding: "10px 12px", borderRadius: 8,
                background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                fontSize: 11, color: dark ? "#94a3b8" : "#64748b", lineHeight: 1.6,
              }}>
                Vuln Score = (Avg Sensitivity + Avg Adaptive Capacity) / 2 = ({data.avg_sensitivity.toFixed(4)} + {data.avg_adaptive_capacity.toFixed(4)}) / 2 = {data.vuln_score.toFixed(4)}.
                Category is this score's quartile rank against the other 23 barangays (Very High = top quartile,
                High = 51st–75th, Moderate = 26th–50th, Low = bottom quartile) — not a fixed cutoff.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});


// "How was this calculated?" panel for the Official SVI model — separate
// from BarangayExplainModal above (different data source, different
// indicator set: 11 social indicators + 5 capacity dimensions + real
// hazard exposure, not the legacy Stage 1 sensitivity/AC bins).
const DomainExplainModal = memo(function DomainExplainModal({ psgcId, dark, onClose, mode }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // ── Sir Shem's Gemini-API explainer suggestion: on-demand only (button
  // click, not auto-fired on open) -- one request per click, well within
  // the free tier for normal use, and never a free-form chat. ──
  const [aiText, setAiText]       = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDomainBarangayExplain(psgcId)
      .then((r) => { if (!cancelled) { setData(r.data); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.response?.data?.error || e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [psgcId]);

  const handleAiExplain = useCallback(() => {
    setAiLoading(true);
    setAiError(null);
    getDomainBarangayAiExplain(psgcId, mode === "capacity" ? "capacity" : "svi")
      .then((r) => { setAiText(r.data.explanation); setAiLoading(false); })
      .catch((e) => {
        setAiError(e.response?.data?.error || e.message);
        setAiLoading(false);
      });
  }, [psgcId, mode]);

  const cat = data ? sviCategoryFromRank(data.svi_rank) : null;
  const capCat = data ? capacityCategoryFromRank(data.capacity_rank) : null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 3000,
      background: "rgba(10,18,40,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: dark ? "#0f1729" : "#fff", borderRadius: 16,
        width: "100%", maxWidth: 680, maxHeight: "88vh",
        boxShadow: "0 32px 80px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={(e) => e.stopPropagation()}>

        <div style={{
          background: "linear-gradient(135deg,#0c4a6e 0%,#0ea5e9 100%)",
          padding: "15px 22px", flexShrink: 0,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>
              {mode === "svi" ? "SVI — How This Was Calculated" : mode === "capacity" ? "Operational Capacity — How This Was Calculated" : "Barangay Reference — How This Was Calculated"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 }}>
              {mode === "svi"
                ? "Reference implementation · Social Vulnerability Index (Domain A) only · barangay-level aggregate only"
                : mode === "capacity"
                ? "Reference implementation · Operational Capacity (Domain B) only · a separate construct from vulnerability, never combined with SVI · barangay-level aggregate only"
                : "Reference implementation · SVI (Domain A) and Operational Capacity (Domain B) shown side by side as independent scores — never combined · barangay-level aggregate only"}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
            width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          {loading && (
            <div style={{ textAlign: "center", padding: "40px 0", color: dark ? "#94a3b8" : "#64748b", fontSize: 13 }}>
              ⏳ Loading…
            </div>
          )}
          {error && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#ef4444", fontSize: 13 }}>
              ❌ {error}
            </div>
          )}
          {data && !loading && !error && (
            <>
              <div style={{
                background: getSviColor(cat) + "14",
                border: `1px solid ${getSviColor(cat)}33`,
                borderRadius: 10, padding: "12px 14px", marginBottom: 16,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: dark ? "#f1f5f9" : "#1e293b" }}>{data.barangay}</div>
                  <div style={{ fontSize: 11.5, color: dark ? "#94a3b8" : "#64748b", marginTop: 2 }}>
                    {data.households?.toLocaleString()} households
                    {mode !== "capacity" && <> · SVI Score {data.svi_score?.toFixed(2)}</>}
                    {mode !== "svi" && <> · Capacity Score {data.capacity_score?.toFixed(2)}</>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", flexShrink: 0 }}>
                  {/* Hidden entirely in the Capacity view -- that view is
                      Capacity-only, mirroring the SVI badge being hidden in
                      the SVI view. Two separate domains, never averaged. */}
                  {mode !== "capacity" && (
                    <span style={{
                      background: getSviColor(cat), color: getContrastTextColor(getSviColor(cat)),
                      fontSize: 11.5, fontWeight: 800, padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap",
                    }}>
                      SVI — Rank #{data.svi_rank} · {cat}
                    </span>
                  )}
                  {/* Separate badge, separate domain -- capacity_rank 1 = BEST
                      equipped (opposite direction from svi_rank), so this is
                      never averaged with the SVI badge above. Hidden entirely
                      in the SVI view -- that view is SVI-only, the Capacity
                      badge/breakdown only makes sense from the Capacity view. */}
                  {mode !== "svi" && (
                    <span style={{
                      background: getCapacityColorByRank(data.capacity_rank), color: getContrastTextColor(getCapacityColorByRank(data.capacity_rank)),
                      fontSize: 11.5, fontWeight: 800, padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap",
                    }}>
                      Capacity — Rank #{data.capacity_rank} · {capCat}
                    </span>
                  )}
                </div>
              </div>

              {mode !== "capacity" && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "#0ea5e9", marginBottom: 4 }}>
                    Social vulnerability indicators — rate + percentile rank across 24 barangays
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    {data.social_indicator_breakdown?.map((ind) => (
                      <div key={ind.indicator} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>
                        <span style={{ flex: 1, fontSize: 12.5, color: dark ? "#e2e8f0" : "#334155" }}>{ind.indicator}</span>
                        <span style={{ fontSize: 11.5, color: dark ? "#94a3b8" : "#64748b", fontFamily: "monospace", minWidth: 60, textAlign: "right" }}>
                          {ind.rate_pct != null ? `${ind.rate_pct}%` : "—"}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 800, minWidth: 54, textAlign: "center",
                          padding: "2px 0", borderRadius: 5,
                          background: dark ? "rgba(14,165,233,0.15)" : "rgba(224,242,254,0.9)",
                          color: dark ? "#7dd3fc" : "#0369a1",
                        }}>
                          {ind.percentile_rank_access_augmented != null ? `${ind.percentile_rank_access_augmented.toFixed(0)}pct` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {mode === "capacity" && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "#059669", marginBottom: 4 }}>
                    Operational capacity dimensions — 0–100 scale
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    {data.capacity_breakdown?.map((c) => (
                      <div key={c.dimension} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>
                        <span style={{ flex: 1, fontSize: 12.5, color: dark ? "#e2e8f0" : "#334155" }}>{c.dimension}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: dark ? "#6ee7b7" : "#047857", fontFamily: "monospace" }}>
                          {c.score_0_100 != null ? c.score_0_100.toFixed(1) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {mode !== "svi" && mode !== "capacity" && data.hazard_exposure && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "#dc2626", marginBottom: 4 }}>
                    Hazard exposure — real spatial join, households outside a layer's polygons are "unmapped"
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 11.5, color: dark ? "#94a3b8" : "#64748b" }}>
                      Flood: {data.hazard_exposure.flood?.high_or_very_high_households ?? 0} HH high/very-high
                      ({data.hazard_exposure.flood?.high_or_very_high_pct_total?.toFixed(1) ?? 0}%),
                      {" "}{data.hazard_exposure.flood?.unmapped_households ?? 0} unmapped
                    </div>
                    <div style={{ fontSize: 11.5, color: dark ? "#94a3b8" : "#64748b" }}>
                      Landslide: {data.hazard_exposure.landslide?.moderate_or_high_households ?? 0} HH moderate/high
                      ({data.hazard_exposure.landslide?.moderate_or_high_pct_total?.toFixed(1) ?? 0}%),
                      {" "}{data.hazard_exposure.landslide?.unmapped_households ?? 0} unmapped
                    </div>
                  </div>
                </>
              )}

              {/* ── AI explainer (Sir Shem's suggestion) -- on-demand only,
                  narrates ONLY the numbers already shown above for this
                  domain (mode). Never auto-fires, never a chat. ── */}
              <div style={{
                marginTop: 4, marginBottom: 12, padding: "10px 12px", borderRadius: 8,
                border: `1px dashed ${dark ? "rgba(168,85,247,0.35)" : "rgba(168,85,247,0.3)"}`,
                background: dark ? "rgba(168,85,247,0.06)" : "rgba(250,245,255,0.7)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#a855f7" }}>
                    AI Summary {mode === "capacity" ? "(Capacity)" : "(SVI)"}
                  </span>
                  {!aiText && (
                    <button
                      onClick={handleAiExplain}
                      disabled={aiLoading}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6,
                        border: "0.5px solid rgba(168,85,247,0.4)", cursor: aiLoading ? "default" : "pointer",
                        background: "rgba(168,85,247,0.15)", color: "#a855f7",
                        opacity: aiLoading ? 0.6 : 1,
                      }}
                    >
                      {aiLoading ? "Generating…" : "Generate"}
                    </button>
                  )}
                </div>
                {aiText && (
                  <div style={{ fontSize: 12, color: dark ? "#e2e8f0" : "#334155", lineHeight: 1.6, marginTop: 8 }}>
                    {aiText}
                  </div>
                )}
                {aiError && (
                  <div style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.5, marginTop: 8 }}>
                    {aiError}
                  </div>
                )}
                {!aiText && !aiError && !aiLoading && (
                  <div style={{ fontSize: 10.5, color: dark ? "#94a3b8" : "#64748b", marginTop: 4 }}>
                    Optional -- generates a short AI-narrated summary of the numbers above. Does not change any score.
                  </div>
                )}
              </div>

              <div style={{
                marginTop: 4, padding: "10px 12px", borderRadius: 8,
                background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                fontSize: 11, color: dark ? "#94a3b8" : "#64748b", lineHeight: 1.6,
              }}>
                {data.note}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

// "How This Was Calculated" panel for Capacity + Distance (Domain B, View
// 2) -- deliberately its own component, NOT a reuse of DomainExplainModal
// above. That modal's data comes from getDomainBarangayExplain(), which
// only knows the OLD Operational Capacity construct (capacity_score /
// capacity_breakdown) -- there is no backend "explain" endpoint for
// capacity_distance_score, and opening the old one under this heading was
// exactly the bug fixed earlier (right-looking box, wrong data inside).
// Every input to capacity_distance_score is already sitting in
// capacityDistanceStats (fetched once for the whole municipality, 24
// rows), so this recomputes the same percentile-rank-and-sum
// capacity_distance_score.py does, entirely client-side from that array,
// rather than adding a new endpoint just to re-fetch data already in
// memory. No AI-explain button here either, for the same reason -- the
// backend's ai-explain endpoint only narrates svi/capacity(-operational)
// data too.
// Barangay Capacity "How was this calculated?" -- built from the /capacity
// row already loaded for the map (no extra request).
const CapacityExplainModal = memo(function CapacityExplainModal({ row, dark, onClose }) {
  if (!row) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 3000,
      background: "rgba(10,18,40,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: dark ? "#0f1729" : "#fff", borderRadius: 16,
        width: "100%", maxWidth: 640, maxHeight: "88vh",
        boxShadow: "0 32px 80px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{
          background: "linear-gradient(135deg,#15803d 0%,#16a34a 55%,#f59e0b 100%)",
          padding: "15px 22px", flexShrink: 0,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>{row.barangay} — Barangay Capacity</div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 2 }}>
              What the barangay has to respond · computed separately from vulnerability
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
            width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>
        <div style={{ padding: "16px 22px 20px", overflowY: "auto", flex: 1 }}>
          <CapacityBreakdown row={row} dark={dark} />
        </div>
      </div>
    </div>
  );
});


const CompareSectionTitle = memo(function CompareSectionTitle({ children, color }) {
  return (
    <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase",
      letterSpacing:"0.08em", color, marginBottom:7 }}>{children}</div>
  );
});

const CompareColHeader = memo(function CompareColHeader({ name, score, color, label, hh, better, textPrimary, textMuted }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:12, fontWeight:700, color:textPrimary, marginBottom:4,
        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{name}</div>
      <div style={{ fontSize:20, fontWeight:800, color, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>
        {score.toFixed(4)}
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:5, marginTop:5 }}>
        <span style={{ fontSize:10, fontWeight:700, color, padding:"2px 7px", borderRadius:4,
          background:color+"18", border:`0.5px solid ${color}44` }}>{label}</span>
        {better && <span style={{ fontSize:9, color:"#22c55e", fontWeight:700 }}>✓ Lower risk</span>}
      </div>
      <div style={{ fontSize:11, color:textMuted, marginTop:4 }}>{hh.toLocaleString()} HH</div>
    </div>
  );
});

const ComparePanel = memo(function ComparePanel({ a, b, dark, D, onClose }) {
  const sA = parseFloat(a.avg_vulnerability_score) || 0;
  const sB = parseFloat(b.avg_vulnerability_score) || 0;
  const cA = getColor(a.vuln_category); const cB = getColor(b.vuln_category);
  const lA = getScoreLabel(a.vuln_category); const lB = getScoreLabel(b.vuln_category);
  const hhA = parseInt(a.total_households || 0);
  const hhB = parseInt(b.total_households || 0);
  const betterBVI = sA < sB ? "a" : sB < sA ? "b" : null;

  const bkRows = [
    { label:"Very High", cA: parseInt(a.very_high_vuln_count||0), cB: parseInt(b.very_high_vuln_count||0), color:"#7b1fa2" },
    { label:"High",      cA: parseInt(a.high_vuln_count||0),      cB: parseInt(b.high_vuln_count||0),      color:"#ef4444" },
    { label:"Moderate",  cA: parseInt(a.medium_vuln_count||0),    cB: parseInt(b.medium_vuln_count||0),    color:"#f59e0b" },
    { label:"Low",       cA: parseInt(a.low_vuln_count||0),       cB: parseInt(b.low_vuln_count||0),       color:"#22c55e" },
  ];
  const rRows = [
    { label:"High",     cA: parseInt(a.high_resil_count||0),     cB: parseInt(b.high_resil_count||0),     color:"#22c55e" },
    { label:"Moderate", cA: parseInt(a.moderate_resil_count||0), cB: parseInt(b.moderate_resil_count||0), color:"#84cc16" },
    { label:"Low",      cA: parseInt(a.low_resil_count||0),      cB: parseInt(b.low_resil_count||0),      color:D.textMuted },
    { label:"Very Low", cA: parseInt(a.very_low_resil_count||0), cB: parseInt(b.very_low_resil_count||0), color:"#ef4444"  },
  ];

  return (
    <div style={{ animation:"cardSpring 0.28s cubic-bezier(0.34,1.2,0.64,1)" }}>
      <div style={{ padding:"10px 14px", display:"flex", alignItems:"center",
        justifyContent:"space-between", borderBottom:`0.5px solid ${D.divider}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={D.textAccent}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="18"/><rect x="14" y="3" width="7" height="18"/>
          </svg>
          <span style={{ fontSize:12, fontWeight:700, color:D.textPrimary }}>Barangay comparison</span>
        </div>
        <button onClick={onClose} style={{ width:22, height:22, borderRadius:"50%", cursor:"pointer",
          border:`0.5px solid ${D.panelBorder}`, background:"transparent",
          display:"flex", alignItems:"center", justifyContent:"center",
          color:D.textMuted, fontSize:12, fontWeight:700 }}>✕</button>
      </div>

      <div style={{ padding:"12px 14px 8px", display:"grid", gridTemplateColumns:"1fr 1px 1fr", gap:10,
        borderBottom:`0.5px solid ${D.divider}` }}>
        <CompareColHeader name={a.barangay_name} score={sA} color={cA} label={lA} hh={hhA} better={betterBVI==="a"} textPrimary={D.textPrimary} textMuted={D.textMuted} />
        <div style={{ background:D.divider }} />
        <CompareColHeader name={b.barangay_name} score={sB} color={cB} label={lB} hh={hhB} better={betterBVI==="b"} textPrimary={D.textPrimary} textMuted={D.textMuted} />
      </div>

      <div style={{ padding:"10px 14px 0",
        background:dark?"rgba(239,68,68,0.05)":"rgba(254,242,242,0.6)",
        borderBottom:`0.5px solid ${D.divider}` }}>
        <CompareSectionTitle color="#ef4444">Vulnerability breakdown</CompareSectionTitle>
        <div style={{ display:"grid", gridTemplateColumns:"52px 1fr", gap:"0 6px", marginBottom:10 }}>
          <div style={{ fontSize:9, color:D.textMuted, textAlign:"right", paddingRight:4,
            display:"flex", flexDirection:"column", justifyContent:"space-around", paddingBottom:2 }}>
            {bkRows.map(r => <span key={r.label}>{r.label}</span>)}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {bkRows.map(r => (
              <MirrorBar key={r.label}
                valueA={r.cA} valueB={r.cB} total={Math.max(hhA, hhB, 1)}
                colorA={r.color} colorB={r.color} />
            ))}
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"52px 1fr", gap:"0 6px", marginBottom:8 }}>
          <div />
          <div style={{ display:"flex", fontSize:9, color:D.textMuted }}>
            <span style={{ flex:1, textAlign:"right", paddingRight:6 }}>{a.barangay_name.replace(/Brgy\.?\s*/i,"")}</span>
            <span style={{ width:1 }} />
            <span style={{ flex:1, paddingLeft:6 }}>{b.barangay_name.replace(/Brgy\.?\s*/i,"")}</span>
          </div>
        </div>
      </div>

      <div style={{ padding:"10px 14px 14px",
        background:dark?"rgba(34,197,94,0.05)":"rgba(240,253,244,0.6)" }}>
        <CompareSectionTitle color="#22c55e">Resilience breakdown</CompareSectionTitle>
        <div style={{ display:"grid", gridTemplateColumns:"52px 1fr", gap:"0 6px" }}>
          <div style={{ fontSize:9, color:D.textMuted, textAlign:"right", paddingRight:4,
            display:"flex", flexDirection:"column", justifyContent:"space-around", paddingBottom:2 }}>
            {rRows.map(r => <span key={r.label}>{r.label}</span>)}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {rRows.map(r => (
              <MirrorBar key={r.label}
                valueA={r.cA} valueB={r.cB} total={Math.max(hhA, hhB, 1)}
                colorA={r.color} colorB={r.color} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────── */
export default function MapView({ intent } = {}) {
  const { dark } = useTheme();
  const C = useMemo(() => (dark ? DARK_TOKENS : LIGHT_TOKENS), [dark]);

  /* ── Refs ── */
  const mapRef        = useRef(null);
  const layerRefs     = useRef({});
  const mapAreaRef       = useRef(null);   // reserved: wraps the Leaflet map div
  const comparisonPanelRef = useRef(null); // wraps the ComparePanel (unused by PDF export now — table is built natively)

  /* OPT #4 — these refs are updated synchronously during render so closures always
     read the latest values without needing to be in useCallback dependency arrays */
  const layersRef          = useRef(null);
  const darkRef            = useRef(dark);
  const statByNameRef      = useRef({});
  const barangayStatsRef   = useRef([]);

  /* OPT #2 — DOM refs for direct manipulation (bypass React state on hot paths) */
  const coordSpanRef    = useRef(null);   // live coordinate display
  const hoverTooltipRef = useRef(null);   // hover tooltip DOM node
  const hoverInitPosRef = useRef({ x: 0, y: 0 }); // position captured on mouseover

  /* ── State ── */
  const [geojson, setGeojson]               = useState(null);
  const [roadsGeojson, setRoadsGeojson]     = useState(null);
  const [floodGeojson, setFloodGeojson]         = useState(null);
  const [landslideGeojson, setLandslideGeojson] = useState(null);
  const [barangayStats, setBarangayStats]   = useState([]);
  const [households, setHouseholds]         = useState([]);
  const [baseDots, setBaseDots]             = useState([]); // OPT #3 — expensive per-household computation (position, color, healthcare distance)
  const [dotLoading, setDotLoading]         = useState(false);
  const [tileLayer, setTileLayer]           = useState("satellite");
  const [showRoads, setShowRoads]           = useState(false);
  const [showFlood, setShowFlood]           = useState(false);
  const [showLandslide, setShowLandslide]   = useState(false);
  const [showHealthcare, setShowHealthcare] = useState(false);
  const [showRhuRadius, setShowRhuRadius]   = useState(false);
  const [showFireRadius, setShowFireRadius] = useState(false);
  const [showFacilityAccess, setShowFacilityAccess] = useState(false);
  // Sir Shem's ask: household typology (k-modes cluster) membership should
  // be available on the Hazard view, not only reachable by switching
  // entirely away to the separate Typology tab. REVISED after user
  // feedback: an earlier version added this as a second, independently-
  // toggled dot layer stacked on top of Hazard's own exposure-tier dots --
  // confusing, since both layers are literally the same households at the
  // same positions, just colored two different ways at once. Replaced with
  // a single "color by" mode for Hazard's one dot layer (still driven by
  // the shared "Dot map" pill/layers.dotmap): "exposure" (default, colors
  // by hazard exposure tier, same as before) or "cluster" (colors by
  // k-modes typology cluster instead, reusing typologyComputedDots/
  // typologyDotFilters). Only one set of dots ever renders in Hazard mode.
  const [hazardDotColorMode, setHazardDotColorMode] = useState("exposure"); // "exposure" | "cluster"
  const [showSchools, setShowSchools]       = useState(false);
  const [showGovernment, setShowGovernment] = useState(false);
  const [geoError, setGeoError]             = useState(null);
  const [selected, setSelected]             = useState(null);
  /* OPT #2 — hoverLabel holds content only (no x/y); position is managed via DOM ref */
  const [hoverLabel, setHoverLabel]         = useState(null);
  const [dotFilters, setDotFilters]         = useState({ "Very High": true, High: true, Moderate: true, Low: true, "No Exposure": true });
  const [highlightVeryHigh, setHighlightVeryHigh] = useState(true); // pulsing glow on Very High households
  // Typology dot map's own filter, keyed by cluster_id (0-4) -- mirrors
  // dotFilters above but independent, since a household's cluster_id and
  // its BVI vulnerability tier are different classifications.
  const [typologyDotFilters, setTypologyDotFilters] = useState({ 0: true, 1: true, 2: true, 3: true, 4: true });
  // Hazard view's OWN cluster filter -- independent of typologyDotFilters
  // above (that one only applies when hazardDotColorMode === "cluster",
  // recoloring the dots). This one narrows the Hazard view's
  // EXPOSURE-colored dots down to one or more typology clusters while
  // keeping them colored by hazard tier, so a cluster's real position
  // against the Flood/Landslide layers is visible directly -- the actual
  // ask that prompted this ("sort a cluster and see their position on the
  // hazard map"). Uses computedDots' own clusterId field (backfilled onto
  // tbl_households, see baseDots above), not typologyComputedDots, so it
  // needs no separate fetch.
  const [hazardClusterFilter, setHazardClusterFilter] = useState({ 0: true, 1: true, 2: true, 3: true, 4: true });
  // Household dots are ON by default in every view (overlaid on the
  // barangay fill); the "Households" pill turns them off.
  const [layers, setLayers]                 = useState({ choropleth: true, boundaries: false, dotmap: true });
  // Barangay area: "color" (choropleth fill), "outline" (boundaries only) or "none".
  const [areaFill, setAreaFill] = useState(() => {
    try { return localStorage.getItem("map.areaFill") || "color"; } catch { return "color"; }
  });
  useEffect(() => { try { localStorage.setItem("map.areaFill", areaFill); } catch { /* ignore */ } }, [areaFill]);
  const cycleAreaFill = useCallback(() => setAreaFill((p) => (p === "color" ? "outline" : p === "outline" ? "none" : "color")), []);
  // One barangay at a time: its boundary and its households only (normalized name, or null = all).
  const [focusBrgy, setFocusBrgy] = useState(null);
  // Map is divided into mutually-exclusive views so fills never render on
  // top of each other, and the sidebar only ever shows panels relevant to
  // whichever view is active (no more stacking every legend/summary panel
  // regardless of what's toggled on).
  // The legacy single-BVI "Vulnerability" view has been retired per the
  // two-domain model (Sir Shem): Domain A is covered by "svi" + "typology",
  // Domain B (hazard/capacity) by "hazard". Defaults to the Official SVI
  // model, Domain A's headline ranked view.
  const [mapModeRaw, setMapMode]            = useUrlParam("view", "svi", intent?.mode || (intent?.watchlist ? "hazard" : undefined)); // remembered in the address
  const mapMode = ["hazard", "svi", "capacity", "typology"].includes(mapModeRaw) ? mapModeRaw : "svi";
  // What the household dots are colored by. Resets to the view's own
  // default whenever the view changes (see DOT_COLOR_DEFAULT).
  const [dotColorBy, setDotColorBy]         = useState(DOT_COLOR_DEFAULT.svi);
  const [distanceFilters, setDistanceFilters] = useState({ "Beyond both": true, "Beyond one": true, "Within 2 km": true });
  useEffect(() => { setDotColorBy(DOT_COLOR_DEFAULT[mapMode] || "plain"); setShowFacilityAccess(false); }, [mapMode]);

  // ── Official SVI model (Sir Shem's reference implementation) ──
  // Separate data source from barangayStats above (the legacy Stage 1 BVI) —
  // fetched lazily the first time this view is opened, from
  // data/domain_pipeline_results/*.csv via /api/domain-vulnerability/*.
  const [domainStats, setDomainStats]       = useState([]);
  const [domainLoading, setDomainLoading]   = useState(false);
  const [domainError, setDomainError]       = useState(null);
  const [typologyStats, setTypologyStats]   = useState([]);
  const [typologyLoading, setTypologyLoading] = useState(false);
  const [typologyError, setTypologyError]   = useState(null);
  const [typologyNote, setTypologyNote]     = useState("");
  // Household-level typology dot map -- one real household per row, each
  // with its own cluster_id, matching Sir Shem's own cluster_households()
  // output and his demo's dot map. Fetched lazily, only once the Typology
  // view's Dot map layer is switched on (same lazy pattern as the Hazard
  // view's `households` fetch below).
  const [typologyHouseholds, setTypologyHouseholds] = useState([]);
  const [typologyHHLoading, setTypologyHHLoading]   = useState(false);
  const [typologyHHError, setTypologyHHError]       = useState(null);
  // Facility distance only (2 of Domain B, View 2's 6 indicators; Sir
  // Shem's calculate_facility_capacity_2km()) -- barangay-level RHU/Fire
  // 2km access ranking. Lazy-loaded only once the Hazard view's "Facility
  // Distance" layer is switched on, same pattern as the other domain
  // fetches above. See backend/facility_access_score.py. For the full
  // 6-indicator View 2 score, see capacityDistanceStats below.
  const [facilityAccessStats, setFacilityAccessStats]     = useState([]);
  const [facilityAccessLoading, setFacilityAccessLoading] = useState(false);
  const [facilityAccessError, setFacilityAccessError]     = useState(null);
  // Domain B, View 2's real 6-indicator score (institutional flags + RHU/
  // Fire distance) -- what the "Capacity" map view now shows, in place of
  // the old Operational Capacity score. Own fetch/state, same lazy pattern
  // as facilityAccessStats above, since it comes from its own endpoint.
  const [capacityDistanceStats, setCapacityDistanceStats]     = useState([]);
  const [capacityDistanceLoading, setCapacityDistanceLoading] = useState(false);
  const [capacityDistanceError, setCapacityDistanceError]     = useState(null);
  const [domainExplainId, setDomainExplainId] = useState(null); // psgc_10d of the barangay being explained
  const [capDistExplainId, setCapDistExplainId] = useState(null); // psgc_10d for CapacityDistanceExplainModal
  // SVI / Capacity+Dist click selection -- clicking a barangay no longer
  // jumps straight into the "How This Was Calculated" modal. It highlights
  // that barangay's boundary on the map first (see the selected-outline
  // branch added to styleFeatureSvi/styleFeatureCapacity below) and shows a
  // small pinned card with a "View calculations" button, so the click has
  // visible feedback before anything bigger opens. Clicking the same
  // barangay again, or the card's ✕, clears the selection.
  const [selectedDomainBarangay, setSelectedDomainBarangay] = useState(null); // stat object or null
  const [selectedDotHH, setSelectedDotHH]    = useState(null); // household_id from a clicked dot

  /* ── Household/resident search ── */
  const [searchQuery, setSearchQuery]     = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen]       = useState(false);
  const [highlightPos, setHighlightPos]   = useState(null); // [lat,lng] pulse ring on the matched dot
  const [activeResultIdx, setActiveResultIdx] = useState(-1); // keyboard nav in the results dropdown
  const searchBoxRef = useRef(null);
  const searchDropdownRef = useRef(null); // dropdown is portaled to document.body, so it needs its own ref for outside-click detection
  const [searchBoxRect, setSearchBoxRect] = useState(null); // screen position for the portal-rendered dropdown

  /* The dropdown is portaled to document.body (see below) so it can't be
     clipped by the top bar's own overflow:hidden panel — but that means it
     needs its own screen coordinates instead of relying on normal CSS
     flow/positioning. Recompute whenever it opens, and keep it glued to the
     input on scroll/resize while open. */
  useEffect(() => {
    if (!searchOpen) return;
    const updateRect = () => {
      if (searchBoxRef.current) setSearchBoxRect(searchBoxRef.current.getBoundingClientRect());
    };
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [searchOpen]);

  /* Debounced live search against GET /api/search (global_search route) */
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    const t = setTimeout(() => {
      globalSearch(q)
        .then((r) => { setSearchResults(r.data?.data || []); setActiveResultIdx(-1); })
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  /* Close the results dropdown on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (
        searchBoxRef.current && !searchBoxRef.current.contains(e.target) &&
        !(searchDropdownRef.current && searchDropdownRef.current.contains(e.target))
      ) setSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* Clicking a search result: fly the map to the household's real
     coordinates, open the existing household preview card, and drop a
     pulsing highlight ring on that exact dot. */
  const handleSelectResult = useCallback((result) => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);

    if (result.type === "household" || result.type === "member") {
      const hhId = result.id;
      let lat = parseFloat(result.latitude);
      let lng = parseFloat(result.longitude);

      // Fallback: if the backend didn't have coordinates for some reason,
      // try to find the household among the already-loaded dots.
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const dot = computedDotsRef.current.find((d) => String(d.householdId) === String(hhId));
        if (dot) { lat = dot.pos[0]; lng = dot.pos[1]; }
      }

      if (Number.isFinite(lat) && Number.isFinite(lng) && mapRef.current) {
        const targetZoom = Math.max(mapRef.current.getZoom(), 17);
        mapRef.current.flyTo([lat, lng], targetZoom, { duration: 1.3 });
        setHighlightPos([lat, lng]);
      }
      setSelectedDotHH(hhId);
      setShowFullModal(false);
    } else if (result.type === "barangay" && geojson) {
      const feature = geojson.features.find(
        (f) => normalizeName(getFeatureName(f)) === normalizeName(result.title)
      );
      if (feature && mapRef.current) {
        try {
          const bounds = L.geoJSON(feature).getBounds();
          if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [40, 40] });
        } catch { /* ignore */ }
      }
    }
  }, [geojson]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Omni Search: switch view and/or fly to the picked household or
     barangay once the map and boundaries are ready (retries briefly while
     the map is still being created). */
  const appliedIntentRef = useRef(null);
  useEffect(() => {
    if (!intent || appliedIntentRef.current === intent.ts) return;
    if (intent.mode) setMapMode(intent.mode);
    if (intent.focusBarangay) {
      // Planning -> "View on Map": show only this barangay's boundary and
      // households (same as picking it in "Show only this barangay").
      setFocusBrgy(normalizeName(intent.focusBarangay));
      setLayers((l) => ({ ...l, dotmap: true }));
      appliedIntentRef.current = intent.ts;
      return;
    }
    if (!intent.focus) { appliedIntentRef.current = intent.ts; return; }
    let tries = 0, timer = null;
    const attempt = () => {
      const needsGeo = intent.focus.type === "barangay";
      if (mapRef.current && (!needsGeo || geojson)) {
        appliedIntentRef.current = intent.ts;
        handleSelectResult(intent.focus);
      } else if (tries++ < 40) timer = setTimeout(attempt, 150);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [intent?.ts, geojson, handleSelectResult]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Dot clicks (from the canvas layer) should also clear any stale search highlight */
  const handleDotClick = useCallback((id) => {
    setHighlightPos(null);
    setSelectedDotHH(id);
  }, []);
  const [dotPreview, setDotPreview]          = useState({ loading: false, data: null, error: null });
  const [showFullModal, setShowFullModal]    = useState(false);
  const householdCardRef = useRef(null);

  /* Fetch a condensed preview for the sidebar card whenever a dot is clicked.
     The full HouseholdDetailModal only opens on demand (View Full Profile). */
  useEffect(() => {
    if (!selectedDotHH) { setDotPreview({ loading: false, data: null, error: null }); return; }
    let cancelled = false;
    setDotPreview({ loading: true, data: null, error: null });
    getVulnHousehold(selectedDotHH)
      .then(r => { if (!cancelled) setDotPreview({ loading: false, data: r.data, error: null }); })
      .catch(e => {
        if (!cancelled) {
          setDotPreview({ loading: false, data: null, error: e.response?.data?.error || e.message });
        }
      });
    return () => { cancelled = true; };
  }, [selectedDotHH]);

  /* The sidebar can grow tall (legend + summaries + this card), so without
     this the "View Full Profile" button could end up below the fold with
     no obvious way to reach it. Scroll the card into view the moment a new
     household is selected -- runs after the card actually renders. */
  useEffect(() => {
    if (!selectedDotHH) return;
    const id = requestAnimationFrame(() => {
      householdCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedDotHH]);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen]     = useState(false);
  const [riskTierFilter, setRiskTierFilter] = useState(null);
  const [compareMode, setCompareMode]       = useState(false);
  // Barangay ID whose "How was this calculated?" panel is open, or null.
  const [explainBarangayId, setExplainBarangayId] = useState(null);
  const [compareA, setCompareA]             = useState(null);
  const [compareB, setCompareB]             = useState(null);

  const [lastUpdate] = useState(() => {
    const now = new Date();
    return `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  });

  /* OPT #1 — O(1) stat lookup map keyed by normalized barangay name */
  const statByName = useMemo(() => {
    const map = {};
    barangayStats.forEach((b) => { map[normalizeName(b.barangay_name)] = b; });
    return map;
  }, [barangayStats]);

  /* OPT #4 — Sync ref updates during render body (NOT in useEffect) so that
     event handler closures always read current values, even before effects flush */
  layersRef.current        = layers;
  darkRef.current          = dark;
  statByNameRef.current    = statByName;
  barangayStatsRef.current = barangayStats;

  /* OPT #2 — After hoverLabel content is set, sync initial position to tooltip DOM node.
     useLayoutEffect runs synchronously after DOM commit, before paint — no flash. */
  useLayoutEffect(() => {
    if (hoverLabel && hoverTooltipRef.current) {
      const { x, y } = hoverInitPosRef.current;
      hoverTooltipRef.current.style.transform = `translate(${x + 14}px, ${y - 12}px)`;
    }
  }, [hoverLabel]);

  const toggleLayer     = (name) => setLayers((prev) => ({ ...prev, [name]: !prev[name] }));
  const toggleDotFilter = (level) => setDotFilters((prev) => ({ ...prev, [level]: !prev[level] }));
  const toggleTypologyDotFilter = (clusterId) => setTypologyDotFilters((prev) => ({ ...prev, [clusterId]: !prev[clusterId] }));
  const toggleHazardClusterFilter = (clusterId) => setHazardClusterFilter((prev) => ({ ...prev, [clusterId]: !prev[clusterId] }));
  // Turning Facility Distance on also turns on the two reference circles
  // it's actually measuring against (RHU 2km / Fire 2km) -- otherwise the
  // barangay ranking shows up with no visual explanation of what "beyond
  // 2km" is 2km *from*. Only auto-enables on the way on; toggling Facility
  // Distance back off leaves the circles as the user left them, since they
  // may still want those on their own.
  // Facility Distance = one clear read: the dots switch to distance colors
  // (within 2 km of both / beyond one / beyond both), the two 2 km circles
  // and labelled RHU / Fire Station pins appear, and nothing else is
  // painted over the map. Turning it off puts the dots back the way they were.
  const prevDotColorRef = useRef(null);
  const toggleFacilityAccess = useCallback(() => {
    setShowFacilityAccess((prev) => {
      const next = !prev;
      setShowRhuRadius(next);
      setShowFireRadius(next);
      if (next) {
        setLayers((l) => ({ ...l, dotmap: true }));
        setDotColorBy((c) => { prevDotColorRef.current = c; return "distance"; });
      } else {
        setDotColorBy((c) => (c === "distance" && prevDotColorRef.current ? prevDotColorRef.current : c));
      }
      return next;
    });
  }, []);

  /* Keyboard shortcuts */
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "1": setTileLayer("street"); break;
        case "2": setTileLayer("satellite"); break;
        case "3": setTileLayer("terrain"); break;
        case "c": case "C": case "b": case "B": cycleAreaFill(); break;
        case "d": case "D": toggleLayer("dotmap"); break;
        case "r": case "R": setShowRoads((p) => !p); break;
        case "f": case "F": setShowFlood((p) => !p); break;
        case "l": case "L": setShowLandslide((p) => !p); break;
        case "h": case "H": setShowHealthcare((p) => !p); break;
        case "u": case "U": setShowRhuRadius((p) => !p); break;
        case "i": case "I": setShowFireRadius((p) => !p); break;
        case "a": case "A": toggleFacilityAccess(); break;
        case "s": case "S": setShowSchools((p) => !p); break;
        case "g": case "G": setShowGovernment((p) => !p); break;
        case "Escape": setSelected(null); break;
        default: break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* Fullscreen */
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  /* ── Data fetching ── */
  useEffect(() => {
    getGISBarangays()
      .then((r) => setGeojson(r.data))
      .catch((e) => setGeoError(`GeoJSON: ${e.response?.status || e.message}`));
  }, []);

  useEffect(() => {
    // Stage 1 top-down barangay vulnerability drives the choropleth (all 24
    // barangays, quantile-classified) — NOT the naive bottom-up household
    // rollup. avg_vulnerability_score is kept as the field name for
    // compatibility with the rest of this component; it now holds the
    // Stage 1 vuln_score. vuln_category is the authoritative quantile
    // classification computed server-side — color by category, not by
    // re-deriving fixed thresholds from the score client-side.
    //
    // The naive summary is ALSO fetched and merged in for its per-category
    // household COUNTS (very_high_vuln_count, high_vuln_count, etc. and the
    // resilience count equivalents) — Stage 1 only has a single category for
    // the barangay as a whole, it doesn't track how many of that barangay's
    // households individually fall into each tier. The sidebar's
    // "Vulnerability/Resilience Breakdown" panels and the compare view need
    // those per-household counts, which only exist in the naive rollup.
    Promise.all([
      getVulnBarangayStage1().catch(() => ({ data: { data: [] } })),
      getVulnBarangaySummary().catch(() => ({ data: { data: [] } })),
    ]).then(([stage1Res, naiveRes]) => {
      const naiveByName = {};
      (naiveRes.data?.data || []).forEach((b) => {
        naiveByName[normalizeName(b.barangay_name)] = b;
      });
      const mapped = (stage1Res.data?.data || []).map((b) => {
        const naive = naiveByName[normalizeName(b.barangay_name)] || {};
        return {
          ...naive,   // per-tier household counts (very_high_vuln_count, high_resil_count, etc.)
          ...b,       // Stage 1 fields take precedence for anything overlapping
          avg_vulnerability_score: b.vuln_score,
        };
      });
      setBarangayStats(mapped);
    }).catch(() => setBarangayStats([]));
  }, []);

  useEffect(() => {
    // Lazy-loaded the first time the SVI view is opened, same pattern as the
    // dot-map household fetch below -- no point pulling the domain-pipeline
    // CSVs until the user actually asks to see this model. (Used to also
    // gate the Capacity view, back when it reused this same domainStats
    // array for capacity_score/capacity_rank -- that view now reads its own
    // capacity_distance_score data below instead, see capacityDistanceStats.)
    if (mapMode !== "svi" || domainStats.length > 0 || domainLoading) return;
    setDomainLoading(true);
    getDomainBarangays()
      .then((r) => { setDomainStats(r.data?.data || []); setDomainLoading(false); })
      .catch((e) => {
        setDomainError(e.response?.data?.detail || e.response?.data?.error || e.message);
        setDomainLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMode]);

  useEffect(() => {
    // Lazy-loaded the first time the Typology view is opened, same pattern
    // as the SVI fetch above. Barangay-level percentages -- see
    // backend/typology_barangay_aggregate.py. For the per-household
    // assignment (Dot map layer), see the typologyHouseholds fetch below.
    if (mapMode !== "typology" || typologyStats.length > 0 || typologyLoading) return;
    setTypologyLoading(true);
    getDomainTypologyBarangay()
      .then((r) => {
        setTypologyStats(r.data?.data || []);
        setTypologyNote(r.data?.note || "");
        setTypologyLoading(false);
      })
      .catch((e) => {
        setTypologyError(e.response?.data?.detail || e.response?.data?.error || e.message);
        setTypologyLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMode]);


  useEffect(() => {
    // Facility distance only (2 of Domain B View 2's 6 indicators) --
    // lazy-loaded only once Hazard's "Facility Distance" overlay is
    // switched on. See backend/facility_access_score.py. For the full View
    // 2 score, see the capacityDistanceStats fetch below.
    if (mapMode !== "hazard" || !showFacilityAccess || facilityAccessStats.length > 0 || facilityAccessLoading) return;
    setFacilityAccessLoading(true);
    getDomainFacilityAccess()
      .then((r) => {
        setFacilityAccessStats(r.data?.data || []);
        setFacilityAccessLoading(false);
      })
      .catch((e) => {
        setFacilityAccessError(e.response?.data?.detail || e.response?.data?.error || e.message);
        setFacilityAccessLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMode, showFacilityAccess]);

  useEffect(() => {
    // Domain B, View 2's actual 6-indicator "Capacity + Distance" score --
    // lazy-loaded the first time the map's "Capacity" view is opened, same
    // pattern as the other domain fetches above. See
    // backend/capacity_distance_score.py.
    if (mapMode !== "capacity" || capacityDistanceStats.length > 0 || capacityDistanceLoading) return;
    setCapacityDistanceLoading(true);
    getDomainCapacity()
      .then((r) => {
        setCapacityDistanceStats(r.data?.data || []);
        setCapacityDistanceLoading(false);
      })
      .catch((e) => {
        setCapacityDistanceError(e.response?.data?.detail || e.response?.data?.error || e.message);
        setCapacityDistanceLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMode]);

  useEffect(() => {
    // Scoped to Hazard mode -- layers.dotmap is now shared with Typology's
    // Dot map toggle (see typologyHouseholds fetch above), which has its own
    // separate data source and shouldn't also trigger this vulnerability
    // household fetch.
    // Household dots are shown in every view, so this one list
    // (tbl_households: location, hazard exposure, typology cluster) feeds
    // all of them.
    if (!layers.dotmap || households.length > 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setDotLoading(true);
      getHouseholds({ page: 1, per_page: 9999, limit: 9999 })
        .then((r) => { if (!cancelled) { setHouseholds(r.data?.data || []); setDotLoading(false); } })
        .catch(() => { if (!cancelled) { setHouseholds([]); setDotLoading(false); } });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.dotmap]);

  useEffect(() => {
    if (!showRoads || roadsGeojson) return;
    fetchRoads().then((data) => setRoadsGeojson(data)).catch(() => setRoadsGeojson(null));
  }, [showRoads, roadsGeojson]);

  useEffect(() => {
    if (!showFlood || floodGeojson) return;
    fetchFlood().then((data) => setFloodGeojson(data)).catch(() => setFloodGeojson(null));
  }, [showFlood, floodGeojson]);

  useEffect(() => {
    if (!showLandslide || landslideGeojson) return;
    fetchLandslide().then((data) => setLandslideGeojson(data)).catch(() => setLandslideGeojson(null));
  }, [showLandslide, landslideGeojson]);

  // Clear the SVI/Capacity+Dist barangay selection (highlight + pinned
  // card) whenever the view changes -- a gold-outlined barangay or a
  // leftover "View calculations" card from the view just left would be
  // confusing sitting on top of a different mode's fill.
  useEffect(() => {
    setSelectedDomainBarangay(null);
  }, [mapMode]);

  /* OPT #3 — Dot computation is deferred via setTimeout so it runs AFTER the map
     renders, preventing the main thread freeze that caused the original jank.

     PERFORMANCE FIX: this used to also depend on showFlood/showLandslide,
     which meant toggling either one re-ran EVERYTHING for all ~7,249
     households -- including the healthcare-distance calculation (15
     facilities x 7,249 households = ~109,000 trig calls) even though
     distance never actually changes based on those toggles. baseDots is the
     expensive, per-household-stable stuff (position, color, healthcare
     distance, population flags), and only recomputes when households/
     geojson/barangay stats actually change. computedDots below is just an
     alias for it now (Compound Risk, the only thing that used to derive
     from baseDots per-render, was removed).

     Plots each household at its REAL longitude/latitude (from tbl_households,
     populated during the CBMS import). Falls back to a scattered point inside
     the household's barangay polygon only if that household is missing valid
     coordinates — this should be rare/never for the current dataset, but keeps
     the map from silently dropping a household if coordinates are ever blank. */
  useEffect(() => {
    if (!layers.dotmap || !households.length) return;

    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;

      const featureByBarangay = {};
      if (geojson) {
        geojson.features.forEach((feature) => {
          featureByBarangay[normalizeName(getFeatureName(feature))] = feature;
        });
      }
      const fallbackSeed = {};

      const result = [];
      households.forEach((hh) => {
        const lat = parseFloat(hh.latitude);
        const lng = parseFloat(hh.longitude);
        let pos;

        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
          pos = [lat, lng]; // real coordinates — the normal case
        } else {
          // fallback only: household has no valid coordinates on file
          const key = normalizeName(hh.barangay_name);
          const feature = featureByBarangay[key];
          if (!feature) return;
          fallbackSeed[key] = (fallbackSeed[key] || 0) + 1;
          const pts = randomPointsInFeature(feature, 1, key.length * 997 + fallbackSeed[key]);
          if (!pts.length) return;
          pos = pts[0];
        }

        // Hazard dot color/tier = real physical hazard exposure (flood/
        // landslide, Sir Shem's Domain B View 1), NOT the legacy per-
        // household BVI score -- see HAZARD_EXPOSURE_TIERS above.
        const hazardScore = hh.hazard_exposure_score;
        const color = getHazardExposureColor(hazardScore);
        const vulnLabel = getHazardExposureLabel(hazardScore);
        // Kept for the household detail panel, which still shows the
        // barangay's legacy BVI figure -- unrelated to the dot's own color.
        const stat = findStatFast(hh.barangay_name, statByName, barangayStats);

        const { distanceKm, facility } = nearestHealthcare(pos[0], pos[1]);
        const rhuKm  = haversineKm(pos[0], pos[1], RHU_LOCATION.lat, RHU_LOCATION.lng);
        const fireKm = haversineKm(pos[0], pos[1], FIRE_LOCATION.lat, FIRE_LOCATION.lng);
        const beyond = (rhuKm > 2 ? 1 : 0) + (fireKm > 2 ? 1 : 0);

        result.push({
          pos,
          color,
          label: hh.household_number || "Household",
          barangay: hh.barangay_name,
          brgyKey: normalizeName(hh.barangay_name),
          vulnLabel,
          householdId: hh.household_id,
          nearestHealthcareKm: distanceKm,
          nearestHealthcareName: facility?.name || null,
          // Domain A, Level 2's typology cluster, backfilled directly onto
          // this same household row (tbl_households.typology_cluster_id,
          // see backfill_typology_clusters.py) -- already sitting right
          // here alongside hazard_exposure_score, so a household's cluster
          // and its real hazard tier can be cross-referenced with no extra
          // fetch or join. null for a household with no cluster match.
          clusterId: hh.typology_cluster_id != null ? Number(hh.typology_cluster_id) : null,
          floodLabel: exposureLabelOf(hh.flood_exposure),
          landslideLabel: exposureLabelOf(hh.landslide_exposure),
          rhuKm, fireKm,
          distLabel: beyond === 2 ? "Beyond both" : beyond === 1 ? "Beyond one" : "Within 2 km",
        });
      });

      if (!cancelled) setBaseDots(result);
    }, 0);

    return () => { cancelled = true; clearTimeout(id); };
  }, [layers.dotmap, geojson, statByName, households]);

  // Compound Risk (hazard-vs-vulnerability cross-reference) was removed --
  // it only ever worked against the legacy per-household BVI, and Sir
  // Shem's real SVI is barangay-only, which made the "cross-reference"
  // uniform across an entire barangay and not worth keeping. The Hazard dot
  // map now just shows each household's own real hazard-exposure tier
  // (baseDots, colored above), and the existing "Filter" row lets you show
  // only the households actually inside a hazard zone (toggle off
  // "No Exposure") -- that filter *is* the sorting-by-hazard-layer this
  // replaces Compound Risk with. computedDots is kept as a name (rather
  // than renaming every call site) but is now just baseDots, unmodified.
  const computedDots = baseDots;

  const computedDotsRef = useRef([]);
  useEffect(() => { computedDotsRef.current = computedDots; }, [computedDots]);

  /* ── Map styles ── */
  const styleFeature = useCallback((feature) => {
    const name   = getFeatureName(feature);
    const stat   = findStatFast(name, statByNameRef.current, barangayStatsRef.current);
    const normName = normalizeName(name);

    if (compareModeRef.current && compareARef.current && compareBRef.current) {
      const isCompared =
        normalizeName(compareARef.current.barangay_name) === normName ||
        normalizeName(compareBRef.current.barangay_name) === normName;
      return {
        fillColor:   getColor(stat?.vuln_category),
        fillOpacity: isCompared ? 0.88 : 0.04,
        color:       isCompared ? "#ffffff" : "rgba(128,128,128,0.08)",
        weight:      isCompared ? 2.5 : 0.3,
      };
    }

    const tierLabel = getScoreLabel(stat?.vuln_category);
    const matches   = !riskTierFilter || tierLabel === riskTierFilter;
    return {
      fillColor:   getColor(stat?.vuln_category),
      fillOpacity: matches ? 0.68 : 0.08,
      color:       matches
        ? (dark ? "rgba(30,60,120,0.6)" : "rgba(30,60,120,0.5)")
        : "rgba(128,128,128,0.2)",
      weight: matches ? 1 : 0.5,
    };
  }, [barangayStats, dark, riskTierFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Official SVI model styling ──────────────────────────────────
  // Deliberately independent of styleFeature/applySelectionStyles above
  // (which are tightly wired to the legacy vuln_category imperative-ref
  // machinery) — this is a plain, lower-frequency-interaction layer since
  // the SVI view has no hover dot-map to optimize around.
  const sviByName = useMemo(() => {
    const m = {};
    domainStats.forEach((b) => { m[normalizeName(b.barangay)] = b; });
    return m;
  }, [domainStats]);

  const findSviStat = useCallback((featureName) => {
    const fNorm = normalizeName(featureName);
    if (sviByName[fNorm]) return sviByName[fNorm];
    if (/^\d+$/.test(fNorm)) return null;
    return domainStats.find((b) => {
      const bNorm = normalizeName(b.barangay);
      return !/^\d+$/.test(bNorm) && (bNorm.includes(fNorm) || fNorm.includes(bNorm));
    }) || null;
  }, [sviByName, domainStats]);

  // psgc_10d -> its live Leaflet layer, populated below as each SVI/
  // Capacity+Dist polygon mounts. Selection highlighting restyles just
  // these two layers directly (layer.setStyle) instead of changing the
  // GeoJSON's `key` to force a full remount -- remounting all 24 polygons
  // on every click briefly showed Leaflet's default unstyled path (a plain
  // black-stroked box) for one frame before the real style reapplied,
  // which is the "box that appears for less than a second" -- gone now
  // that selection never touches `key`.
  const domainLayerRefs = useRef({});

  // Outline-only mode: no fill, a clear line that reads on every basemap.
  const outlineColor = tileLayer === "satellite" ? "rgba(255,255,255,0.95)" : (dark ? "rgba(147,197,253,0.9)" : "rgba(30,64,175,0.85)");
  const outlineStyle = useCallback((fillColor, isSelected) => ({
    fillColor, fillOpacity: isSelected ? 0.2 : 0,
    color: isSelected ? "#facc15" : outlineColor,
    weight: isSelected ? 3.5 : (focusBrgy ? 3 : 1.8),
  }), [outlineColor, focusBrgy]);

  const sviFeatureStyle = useCallback((stat, isSelected) => areaFill === "outline"
    ? outlineStyle(getSviColorByRank(stat?.svi_rank), isSelected) : ({
    fillColor: getSviColorByRank(stat?.svi_rank),
    // Lighter fill while household dots are on, so the dots stay readable.
    fillOpacity: isSelected ? 0.9 : (layers.dotmap ? 0.42 : 0.78),
    color: isSelected ? "#facc15" : (dark ? "rgba(30,60,120,0.6)" : "rgba(30,60,120,0.5)"),
    weight: isSelected ? 3.5 : (focusBrgy ? 3 : 1),
  }), [dark, layers.dotmap, areaFill, outlineStyle, focusBrgy]);

  const styleFeatureSvi = useCallback((feature) => {
    const stat = findSviStat(getFeatureName(feature));
    const isSelected = !!(stat && selectedDomainBarangay?.psgc_10d === stat.psgc_10d);
    return sviFeatureStyle(stat, isSelected);
  }, [findSviStat, sviFeatureStyle, selectedDomainBarangay]);

  const onEachFeatureSvi = useCallback((feature, layer) => {
    const name = getFeatureName(feature);
    const stat = findSviStat(name);
    if (!stat) {
      layer.bindTooltip(`<b>${name}</b><br/>No SVI data`, { sticky: true });
      return;
    }
    domainLayerRefs.current[stat.psgc_10d] = layer;
    const cat = sviCategoryFromRank(stat.svi_rank);
    layer.bindTooltip(
      `<b>${stat.barangay}</b><br/>SVI: ${stat.svi_score?.toFixed(1)} (rank #${stat.svi_rank}) — ${cat}` +
      `<br/><span style="opacity:.75">Click for the indicator breakdown</span>`,
      { sticky: true }
    );
    // Click highlights the barangay's boundary first (imperatively, see
    // domainLayerRefs above) and shows the pinned selection card with its
    // own "View calculations" button -- it no longer jumps straight to the
    // modal. Clicking the already-selected barangay again deselects it.
    layer.on("click", () => {
      setSelectedDomainBarangay((prev) => {
        const next = prev?.psgc_10d === stat.psgc_10d ? null : stat;
        const prevLayer = prev && domainLayerRefs.current[prev.psgc_10d];
        if (prevLayer) prevLayer.setStyle(sviFeatureStyle(prev, false));
        if (next) {
          const nextLayer = domainLayerRefs.current[next.psgc_10d];
          if (nextLayer) { nextLayer.setStyle(sviFeatureStyle(next, true)); nextLayer.bringToFront(); }
        }
        return next;
      });
    });
  }, [findSviStat, sviFeatureStyle]);

  // ── Capacity + Distance choropleth (Domain B, View 2) -- its own fetch
  // (capacityDistanceStats, above), own fill function and color ramp, keyed
  // on capacity_distance_rank. Tooltip shows all 6 indicators that feed the
  // score, not just the total, so a viewer can see WHY a barangay ranks
  // where it does without opening a separate panel.
  const capacityDistanceByName = useMemo(() => {
    const m = {};
    capacityDistanceStats.forEach((b) => { m[normalizeName(b.barangay)] = b; });
    return m;
  }, [capacityDistanceStats]);

  const findCapacityDistanceStat = useCallback((featureName) => {
    const fNorm = normalizeName(featureName);
    if (capacityDistanceByName[fNorm]) return capacityDistanceByName[fNorm];
    if (/^\d+$/.test(fNorm)) return null;
    return capacityDistanceStats.find((b) => {
      const bNorm = normalizeName(b.barangay);
      return !/^\d+$/.test(bNorm) && (bNorm.includes(fNorm) || fNorm.includes(bNorm));
    }) || null;
  }, [capacityDistanceByName, capacityDistanceStats]);

  const capFeatureStyle = useCallback((stat, isSelected) => areaFill === "outline"
    ? outlineStyle(capacityColorByRank(stat?.capacity_rank), isSelected) : ({
    fillColor: capacityColorByRank(stat?.capacity_rank),
    fillOpacity: isSelected ? 0.9 : (layers.dotmap ? 0.42 : 0.78),
    color: isSelected ? "#facc15" : (dark ? "rgba(30,60,120,0.6)" : "rgba(30,60,120,0.5)"),
    weight: isSelected ? 3.5 : (focusBrgy ? 3 : 1),
  }), [dark, layers.dotmap, areaFill, outlineStyle, focusBrgy]);

  const styleFeatureCapacity = useCallback((feature) => {
    const stat = findCapacityDistanceStat(getFeatureName(feature));
    const isSelected = !!(stat && selectedDomainBarangay?.psgc_10d === stat.psgc_10d);
    return capFeatureStyle(stat, isSelected);
  }, [findCapacityDistanceStat, capFeatureStyle, selectedDomainBarangay]);

  const onEachFeatureCapacity = useCallback((feature, layer) => {
    const name = getFeatureName(feature);
    const stat = findCapacityDistanceStat(name);
    if (!stat) {
      layer.bindTooltip(`<b>${name}</b><br/>No capacity data`, { sticky: true });
      return;
    }
    domainLayerRefs.current[stat.psgc_10d] = layer;
    layer.bindTooltip(
      `<b>${stat.barangay}</b><br/>Capacity: ${stat.capacity_score?.toFixed(1)} / 100 (rank #${stat.capacity_rank}) — ${capacityTierFromRank(stat.capacity_rank)}` +
      `<br/>Click for its resources`,
      { sticky: true }
    );
    // Same imperative click-to-select pattern as onEachFeatureSvi above:
    // restyle just the previous + newly selected layers directly, no
    // GeoJSON remount.
    layer.on("click", () => {
      setSelectedDomainBarangay((prev) => {
        const next = prev?.psgc_10d === stat.psgc_10d ? null : stat;
        const prevLayer = prev && domainLayerRefs.current[prev.psgc_10d];
        if (prevLayer) prevLayer.setStyle(capFeatureStyle(prev, false));
        if (next) {
          const nextLayer = domainLayerRefs.current[next.psgc_10d];
          if (nextLayer) { nextLayer.setStyle(capFeatureStyle(next, true)); nextLayer.bringToFront(); }
        }
        return next;
      });
    });
  }, [findCapacityDistanceStat, capFeatureStyle]);

  // ── Household typology styling (barangay-level, dominant cluster) ──
  const typologyByName = useMemo(() => {
    const m = {};
    typologyStats.forEach((b) => { m[normalizeName(b.barangay)] = b; });
    return m;
  }, [typologyStats]);

  // Municipality-wide cluster composition, weighted by each barangay's
  // household count -- same computation as the Dashboard's "Household
  // Typology — Third Analytical View" card, mirrored here so the sidebar
  // shows the same breakdown while looking at the map. Purely descriptive,
  // never fed back into the SVI ranking or the choropleth fill.
  const [typInfoOpen, setTypInfoOpen] = useState(null); // typology explainer open in the legend
  const typologyComposition = useMemo(() => {
    if (!typologyStats.length) return [];
    const totals = {};
    let totalHH = 0;
    typologyStats.forEach((b) => {
      const n = b.n_households || 0;
      totalHH += n;
      (b.clusters || []).forEach((c) => {
        const hh = n * ((c.pct || 0) / 100);
        totals[c.cluster_id] = (totals[c.cluster_id] || 0) + hh;
      });
    });
    return Object.entries(totals)
      .map(([cid, hh]) => {
        const cluster = typologyStats[0]?.clusters?.find((c) => String(c.cluster_id) === cid);
        return {
          clusterId: Number(cid),
          label: cluster?.label || `Cluster ${cid}`,
          households: Math.round(hh),
          pct: totalHH ? (hh / totalHH) * 100 : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [typologyStats]);

  const findTypologyStat = useCallback((featureName) => {
    const fNorm = normalizeName(featureName);
    if (typologyByName[fNorm]) return typologyByName[fNorm];
    if (/^\d+$/.test(fNorm)) return null;
    return typologyStats.find((b) => {
      const bNorm = normalizeName(b.barangay);
      return !/^\d+$/.test(bNorm) && (bNorm.includes(fNorm) || fNorm.includes(bNorm));
    }) || null;
  }, [typologyByName, typologyStats]);

  const styleFeatureTypology = useCallback((feature) => {
    const stat = findTypologyStat(getFeatureName(feature));
    if (areaFill === "outline") return outlineStyle(getTypologyColor(stat?.dominant_cluster_id), false);
    return {
      fillColor: getTypologyColor(stat?.dominant_cluster_id),
      fillOpacity: layers.dotmap ? 0.35 : 0.68,
      color: dark ? "rgba(30,60,120,0.6)" : "rgba(30,60,120,0.5)",
      weight: focusBrgy ? 3 : 1,
    };
  }, [findTypologyStat, dark, layers.dotmap, areaFill, outlineStyle, focusBrgy]);

  const onEachFeatureTypology = useCallback((feature, layer) => {
    const name = getFeatureName(feature);
    const stat = findTypologyStat(name);
    if (!stat) {
      layer.bindTooltip(`<b>${name}</b><br/>No typology data`, { sticky: true });
      return;
    }
    const breakdown = (stat.clusters || [])
      .slice()
      .sort((a, b) => b.pct - a.pct)
      .map((c) => `${c.label}: ${c.pct}%`)
      .join("<br/>");
    layer.bindTooltip(
      `<b>${stat.barangay}</b><br/>Dominant: ${stat.dominant_cluster_label} (${stat.dominant_cluster_pct}%)` +
      (breakdown ? `<br/><br/>${breakdown}` : ""),
      { sticky: true }
    );
  }, [findTypologyStat]);

  // ── Facility Distance choropleth (Domain B, View 2 -- distance-only
  // subset, 2 of its 6 indicators) -- same normalize/lookup pattern as
  // Typology above, keyed off facilityAccessStats instead. Colored by
  // rhu_pct_beyond: light teal = good access, dark teal = most households
  // beyond 2km of the RHU.
  const facilityAccessByName = useMemo(() => {
    const m = {};
    facilityAccessStats.forEach((b) => { m[normalizeName(b.barangay)] = b; });
    return m;
  }, [facilityAccessStats]);

  const findFacilityAccessStat = useCallback((featureName) => {
    const fNorm = normalizeName(featureName);
    if (facilityAccessByName[fNorm]) return facilityAccessByName[fNorm];
    if (/^\d+$/.test(fNorm)) return null;
    return facilityAccessStats.find((b) => {
      const bNorm = normalizeName(b.barangay);
      return !/^\d+$/.test(bNorm) && (bNorm.includes(fNorm) || fNorm.includes(bNorm));
    }) || null;
  }, [facilityAccessByName, facilityAccessStats]);

  const styleFeatureFacilityAccess = useCallback((feature) => {
    const stat = findFacilityAccessStat(getFeatureName(feature));
    return {
      fillColor: getFacilityAccessColor(stat?.rhu_pct_beyond),
      fillOpacity: 0.62,
      color: dark ? "rgba(8,145,178,0.6)" : "rgba(8,145,178,0.5)",
      weight: 1,
    };
  }, [findFacilityAccessStat, dark]);

  const onEachFeatureFacilityAccess = useCallback((feature, layer) => {
    const name = getFeatureName(feature);
    const stat = findFacilityAccessStat(name);
    if (!stat) {
      layer.bindTooltip(`<b>${name}</b><br/>No facility access data`, { sticky: true });
      return;
    }
    layer.bindTooltip(
      `<b>${stat.barangay}</b> — Rank #${stat.facility_access_rank}<br/>` +
      `RHU beyond 2km: ${stat.rhu_pct_beyond}% (${stat.rhu_n_beyond} HH)<br/>` +
      `Fire Station beyond 2km: ${stat.fire_pct_beyond}% (${stat.fire_n_beyond} HH)`,
      { sticky: true }
    );
  }, [findFacilityAccessStat]);

  /* ── Household overlay dots: the same households in every view, colored
     by whichever attribute dotColorBy picks. In Hazard coloring, when only
     the Flood layer is on the dots follow flood exposure alone (and the
     same for Landslide), so a dot always matches the zone drawn under it;
     with both or neither on they show the combined exposure (the worse of
     the two). ── */
  const hazardBasis = showFlood && !showLandslide ? "flood" : showLandslide && !showFlood ? "landslide" : "combined";
  const focusedDots = useMemo(
    () => (focusBrgy ? computedDots.filter((d) => d.brgyKey === focusBrgy) : computedDots),
    [computedDots, focusBrgy]);
  const overlayDots = useMemo(() => {
    return focusedDots.map((d) => {
      let color, key;
      if (dotColorBy === "hazard") {
        key = hazardBasis === "flood" ? d.floodLabel : hazardBasis === "landslide" ? d.landslideLabel : d.vulnLabel;
        color = hazardBasis === "combined" ? d.color : EXPOSURE_COLOR_BY_LABEL[key];
      } else if (dotColorBy === "cluster") {
        key = d.clusterId != null ? d.clusterId : "none";
        color = getTypologyColor(d.clusterId);
      } else if (dotColorBy === "distance") {
        key = d.distLabel;
        color = DISTANCE_COLOR[key];
      } else {
        key = "all";
        color = PLAIN_DOT_COLOR;
      }
      const stroke = (dotColorBy === "plain" || (dotColorBy === "distance" && key === "Within 2 km")) ? PLAIN_DOT.stroke : undefined;
      return { ...d, color, stroke, vulnLabel: key };
    });
  }, [focusedDots, dotColorBy, hazardBasis]);
  const overlayFilters = dotColorBy === "hazard" ? dotFilters
    : dotColorBy === "cluster" ? typologyDotFilters
    : dotColorBy === "distance" ? distanceFilters
    : {};
  const overlayCounts = useMemo(() => {
    const c = {};
    overlayDots.forEach((d) => { c[d.vulnLabel] = (c[d.vulnLabel] || 0) + 1; });
    return c;
  }, [overlayDots]);

  // Facility Distance sidebar: each barangay's households split into the
  // same three distance groups as the dots (computed from the dots, so the
  // bars always match what is drawn). Sorted farthest from help first.
  const [showAllDistance, setShowAllDistance] = useState(false);
  const distanceByBarangay = useMemo(() => {
    const total = { total: 0, both: 0, one: 0, within: 0 };
    if (!showFacilityAccess) return { rows: [], total };
    const m = {};
    computedDots.forEach((d) => {
      const r = m[d.brgyKey] || (m[d.brgyKey] = { key: d.brgyKey, total: 0, both: 0, one: 0, within: 0 });
      const k = d.distLabel === "Beyond both" ? "both" : d.distLabel === "Beyond one" ? "one" : "within";
      r.total++; r[k]++; total.total++; total[k]++;
    });
    const rows = Object.values(m)
      .map((r) => ({ ...r, label: OFFICIAL_BARANGAY_NAME[r.key] || r.key }))
      .sort((a, b) => (b.both + b.one) / b.total - (a.both + a.one) / a.total || b.both / b.total - a.both / a.total);
    return { rows, total };
  }, [computedDots, showFacilityAccess]);

  // How many household dots the current filters leave on the map.
  const shownDotCount = useMemo(() => {
    const clusterOn = mapMode === "hazard" && dotColorBy === "hazard"
      && Object.values(hazardClusterFilter).some((v) => v === false);
    return overlayDots.filter((d) => (dotColorBy === "plain" || overlayFilters[d.vulnLabel] !== false)
      && (!clusterOn || (d.clusterId != null && hazardClusterFilter[d.clusterId] !== false))).length;
  }, [overlayDots, overlayFilters, dotColorBy, mapMode, hazardClusterFilter]);

  const boundaryStyle = useCallback(() => ({
    fillColor: "transparent", fillOpacity: 0,
    color: dark ? "rgba(96,165,250,0.6)" : "rgba(30,64,175,0.5)",
    weight: 1.5,
  }), [dark]);

  const dotBoundaryStyle = useCallback(() => (areaFill === "outline" || focusBrgy ? {
    fillColor: "transparent", fillOpacity: 0, color: outlineColor, weight: focusBrgy ? 3 : 1.8,
  } : {
    fillColor: "transparent", fillOpacity: 0,
    color: dark ? "rgba(59,130,246,0.25)" : "rgba(148,163,184,0.5)", weight: 1,
  }), [dark, areaFill, outlineColor, focusBrgy]);

  const roadsStyle = useCallback(() => ({
    color: tileLayer === "satellite" ? "#fbbf24" : tileLayer === "terrain" ? "#f97316" : "#ef4444",
    weight: 2, opacity: 0.9,
  }), [tileLayer]);

  const floodStyle = useCallback((feature) => ({
    fillColor: getFloodColor(feature.properties?.FloodSusc),
    fillOpacity: 0.45,
    color: getFloodColor(feature.properties?.FloodSusc),
    weight: 1.5,
  }), []);

  const landslideStyle = useCallback((feature) => ({
    fillColor: getLandslideColor(feature.properties?.LndslideSu),
    fillOpacity: 0.45,
    color: getLandslideColor(feature.properties?.LndslideSu),
    weight: 1.5,
    dashArray: "4 3",
  }), []);

  /* ── Imperative style refs (keep in sync) ── */
  const selectedRef       = useRef(null);
  const compareModeRef    = useRef(false);
  const compareARef       = useRef(null);
  const compareBRef       = useRef(null);
  const riskTierFilterRef = useRef(null);

  useEffect(() => { selectedRef.current       = selected?.barangay_name || null; }, [selected]);
  useEffect(() => { compareModeRef.current    = compareMode;                      }, [compareMode]);
  useEffect(() => { compareARef.current       = compareA;                         }, [compareA]);
  useEffect(() => { compareBRef.current       = compareB;                         }, [compareB]);
  useEffect(() => { riskTierFilterRef.current = riskTierFilter;                   }, [riskTierFilter]);

  /* OPT #4 — applyCompareStyles uses only refs → empty deps → stable forever */
  const applyCompareStyles = useCallback((cA, cB) => {
    if (!cA || !cB) return;
    Object.entries(layerRefs.current).forEach(([name, layer]) => {
      const isCompared =
        normalizeName(cA.barangay_name) === normalizeName(name) ||
        normalizeName(cB.barangay_name) === normalizeName(name);
      const stat = findStatFast(name, statByNameRef.current, barangayStatsRef.current);
      layer.setStyle({
        fillColor:   getColor(stat?.vuln_category),
        fillOpacity: isCompared ? 0.88 : 0.04,
        color:       isCompared ? "#ffffff" : "rgba(128,128,128,0.08)",
        weight:      isCompared ? 2.5 : 0.3,
      });
      if (isCompared) layer.bringToFront();
    });
  }, []); // empty deps — reads everything from refs

  /* OPT #4 — applySelectionStyles uses only refs → empty deps → stable forever */
  const applySelectionStyles = useCallback((selectedName) => {
    const isChoropleth   = layersRef.current.choropleth;
    const isBoundaryOnly = layersRef.current.boundaries && !isChoropleth;
    const activeFilter   = riskTierFilterRef.current;
    const isDark         = darkRef.current;

    Object.entries(layerRefs.current).forEach(([name, layer]) => {
      const isSel = selectedName && normalizeName(selectedName) === normalizeName(name);
      if (isSel) {
        if (isBoundaryOnly) {
          layer.setStyle({ weight: 3, fillOpacity: 0, fillColor: "transparent", color: "#f59e0b" });
        } else {
          layer.setStyle({ weight: 3, fillOpacity: 0.92, color: "#ffffff" });
        }
        layer.bringToFront();
      } else {
        if (isBoundaryOnly) {
          layer.setStyle({
            fillColor: "transparent", fillOpacity: 0,
            color: isDark ? "rgba(96,165,250,0.6)" : "rgba(30,64,175,0.5)",
            weight: 1.5,
          });
        } else if (isChoropleth) {
          const stat      = findStatFast(name, statByNameRef.current, barangayStatsRef.current);
          const tierLabel = getScoreLabel(stat?.vuln_category);
          const matches   = !activeFilter || tierLabel === activeFilter;
          layer.setStyle({
            fillColor:   getColor(stat?.vuln_category),
            fillOpacity: matches ? 0.68 : 0.08,
            color:       matches
              ? (isDark ? "rgba(30,60,120,0.6)" : "rgba(30,60,120,0.5)")
              : "rgba(128,128,128,0.2)",
            weight: matches ? 1 : 0.5,
          });
        }
      }
    });
  }, []); // empty deps — reads everything from refs

  /* Barangay selection, compare mode, and the "how was this calculated?"
     modal are all choropleth/boundary click-driven — they only make sense in
     Vulnerability view. Clear them on switch so a stale barangay panel can
     never show up over the Hazard view. */
  useEffect(() => {
    if (mapMode !== "hazard") return;
    setSelected(null);
    selectedRef.current = null;
    setCompareMode(false);
    setCompareA(null);
    setCompareB(null);
    applySelectionStyles(null);
  }, [mapMode, applySelectionStyles]);

  const combinedBoundaryStyle = useCallback((feature) => ({
    ...boundaryStyle(feature),
    interactive: !layers.choropleth,
  }), [layers.choropleth]); // eslint-disable-line react-hooks/exhaustive-deps

  /* OPT #2 + #4 — onEachFeature:
     - mousemove NO LONGER calls setState → zero React re-renders while moving the mouse
     - uses layersRef/darkRef → layers toggles no longer recreate this callback
     - stable deps → Leaflet never needs to rebind all feature event listeners */
  const onEachFeature = useCallback((feature, layer) => {
    const name  = getFeatureName(feature);
    const stat  = findStatFast(name, statByNameRef.current, barangayStatsRef.current);
    const score = stat?.vuln_score ?? null;
    const color = getColor(stat?.vuln_category);
    const label = getScoreLabel(stat?.vuln_category);

    layerRefs.current[name] = layer;

    layer.on({
      mouseover: (e) => {
        const cA = compareARef.current;
        const cB = compareBRef.current;

        if (compareModeRef.current && cA && cB) {
          const isCompared =
            normalizeName(cA.barangay_name) === normalizeName(name) ||
            normalizeName(cB.barangay_name) === normalizeName(name);
          e.target.setStyle({
            fillOpacity: isCompared ? 0.88 : 0.04,
            weight:      isCompared ? 2.5 : 0.3,
            color:       isCompared ? "#ffffff" : "rgba(128,128,128,0.08)",
          });
          hoverInitPosRef.current = e.containerPoint;
          setHoverLabel({ name, score, label, color });
          return;
        }

        if (riskTierFilterRef.current) {
          const tierLabel = getScoreLabel(stat?.vuln_category);
          const matches   = tierLabel === riskTierFilterRef.current;
          e.target.setStyle({
            fillOpacity: matches ? 0.88 : 0.08,
            weight:      matches ? 2.5 : 0.5,
            color:       matches
              ? (darkRef.current ? "rgba(30,60,120,0.6)" : "rgba(30,60,120,0.5)")
              : "rgba(128,128,128,0.2)",
          });
          if (matches) {
            hoverInitPosRef.current = e.containerPoint;
            setHoverLabel({ name, score, label, color });
          }
          return;
        }

        const isSel = selectedRef.current && normalizeName(selectedRef.current) === normalizeName(name);
        if (!isSel) {
          layersRef.current.boundaries && !layersRef.current.choropleth
            ? e.target.setStyle({ weight: 3, color: "#f59e0b" })
            : e.target.setStyle({ weight: 2.5, fillOpacity: 0.88 });
        }
        hoverInitPosRef.current = e.containerPoint;
        setHoverLabel({ name, score, label, color });
      },

      /* OPT #2 — mousemove only updates DOM ref position — ZERO React re-renders */
      mousemove: (e) => {
        if (hoverTooltipRef.current) {
          const { x, y } = e.containerPoint;
          hoverTooltipRef.current.style.transform = `translate(${x + 14}px, ${y - 12}px)`;
        }
      },

      mouseout: (e) => {
        setHoverLabel(null);
        const cA = compareARef.current;
        const cB = compareBRef.current;

        if (compareModeRef.current && cA && cB) {
          const isCompared =
            normalizeName(cA.barangay_name) === normalizeName(name) ||
            normalizeName(cB.barangay_name) === normalizeName(name);
          e.target.setStyle({
            fillOpacity: isCompared ? 0.88 : 0.04,
            weight:      isCompared ? 2.5 : 0.3,
            color:       isCompared ? "#ffffff" : "rgba(128,128,128,0.08)",
          });
          return;
        }

        if (riskTierFilterRef.current) {
          const tierLabel = getScoreLabel(stat?.vuln_category);
          const matches   = tierLabel === riskTierFilterRef.current;
          e.target.setStyle({
            fillOpacity: matches ? 0.68 : 0.08,
            weight:      matches ? 1 : 0.5,
            color:       matches
              ? (darkRef.current ? "rgba(30,60,120,0.6)" : "rgba(30,60,120,0.5)")
              : "rgba(128,128,128,0.2)",
          });
          return;
        }

        const isSel = selectedRef.current && normalizeName(selectedRef.current) === normalizeName(name);
        if (!isSel) {
          layersRef.current.boundaries && !layersRef.current.choropleth
            ? e.target.setStyle({ weight: 1.5, color: darkRef.current ? "rgba(96,165,250,0.6)" : "rgba(30,64,175,0.5)" })
            : e.target.setStyle({ weight: 1, fillOpacity: 0.68 });
        }
      },

      click: (e) => {
        L.DomEvent.stopPropagation(e);
        setHoverLabel(null);
        const clickedBarangay = stat
          ? { ...stat, featureName: name }
          : { barangay_name: name, featureName: name };

        if (riskTierFilterRef.current) {
          const tierLabel = getScoreLabel(stat?.vuln_category);
          if (tierLabel !== riskTierFilterRef.current) return;
        }

        if (compareModeRef.current) {
          if (!compareARef.current) {
            compareARef.current = clickedBarangay;
            setCompareA(clickedBarangay);
          } else if (normalizeName(clickedBarangay.barangay_name) !== normalizeName(compareARef.current.barangay_name)) {
            compareBRef.current = clickedBarangay;
            setCompareB(clickedBarangay);
            applyCompareStyles(compareARef.current, clickedBarangay);
          }
          return;
        }

        selectedRef.current = clickedBarangay.barangay_name;
        setSelected(clickedBarangay);
        applySelectionStyles(clickedBarangay.barangay_name);
      },
    });
  }, [applySelectionStyles, applyCompareStyles]); // minimal stable deps

  /* ── Derived stats ── */
  const statCounts = useMemo(() => BARANGAY_LEGEND_ITEMS.filter((i) => i.category !== null).map((s) => ({
    color: s.color,
    label: s.label,
    count: barangayStats.filter((b) => b.vuln_category === s.category).length,
  })), [barangayStats]);

  const totalHouseholds = useMemo(
    () => barangayStats.reduce((s, b) => s + parseInt(b.total_households || 0), 0),
    [barangayStats]
  );

  // Cross-tab for the Hazard/Exposure view's "Filter by cluster" row: for
  // whichever clusters are currently isolated (hazardClusterFilter), how
  // many of THEIR households fall in each hazard-exposure tier. This is
  // the actual "sort a cluster and see their position on the hazard map"
  // answer as a number, not just a visual -- same filter predicate
  // DotMapLayer itself applies (dotFilters excluded here on purpose, since
  // the whole point is to see the tier split, not one already-narrowed
  // tier), so the counts always match what's on screen once dotFilters is
  // all-on (the default).
  const hazardClusterBreakdown = useMemo(() => {
    const anyClusterOff = Object.values(hazardClusterFilter).some((v) => v === false);
    if (!anyClusterOff) return null; // no cluster isolated -- nothing extra to show
    const matched = computedDots.filter((d) => d.clusterId != null && hazardClusterFilter[d.clusterId] !== false);
    const tiers = ["Very High", "High", "Moderate", "Low", "No Exposure"];
    const counts = Object.fromEntries(tiers.map((t) => [t, 0]));
    matched.forEach((d) => { if (counts[d.vulnLabel] != null) counts[d.vulnLabel] += 1; });
    return { total: matched.length, counts };
  }, [computedDots, hazardClusterFilter]);

  /* Households more than 2km (straight-line) from the nearest healthcare
     facility -- a simple, defensible threshold for "meaningfully isolated"
     at this scale. */
  const healthcareIsolatedCount = useMemo(
    () => computedDots.filter((d) => d.nearestHealthcareKm != null && d.nearestHealthcareKm > 2).length,
    [computedDots]
  );

  const streetUrl = dark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  /* ── Shared panel shell ── */
  const panelStyle = {
    background: C.panelBg,
    /* backdropFilter removed -- blur() over a live, actively panning/zooming
       map with thousands of dots forces continuous re-blurring on every
       frame, which was the dominant cause of pervasive lag (not tied to
       any specific interaction -- it's a constant per-frame cost). The
       background is already 92-95% opaque, so this has minimal visual
       impact while removing the biggest rendering cost in the app. */
    border: `0.5px solid ${C.panelBorder}`,
    borderRadius: 12,
    boxShadow: C.panelShadow,
    overflow: "hidden",
  };

  /* ── Pill button ── */
  const Pill = ({ children, active, color = "#3b82f6", onClick, title: tipTitle }) => (
    <button
      onClick={onClick}
      title={tipTitle}
      className="pill-btn"
      data-active={active ? "true" : "false"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        padding: "4px 6px", fontSize: 10.5, fontWeight: active ? 600 : 500,
        borderRadius: 6, cursor: "pointer", height: 26, flex: "1 1 0", minWidth: 0,
        whiteSpace: "nowrap", overflow: "hidden",
        border: `0.5px solid ${active ? color : C.tbBtnBorder}`,
        background: active ? `${color}22` : C.tbBtnBg,
        color: active ? color : C.tbBtnText,
        transition: "all 0.15s ease",
        outline: "none",
      }}
    >
      {children}
    </button>
  );

  // One chip style for every dot filter on the map page: coloured dot,
  // label (ellipsis + tooltip when long), optional count on the right.
  const FilterChip = ({ active, color, label, title, count, onClick }) => (
    <button onClick={onClick} title={title || label} aria-label={title || label} className="map-chip" aria-pressed={active}
      style={{
        display: "flex", alignItems: "center", gap: 6, height: 26, padding: "0 8px", minWidth: 0, width: "100%",
        borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: active ? 600 : 500, outline: "none",
        border: `0.5px solid ${active ? color : C.tbBtnBorder}`,
        background: active ? `${color}1f` : C.tbBtnBg,
        color: active ? C.textPrimary : C.textMuted,
      }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: active ? color : "transparent", border: `1.5px solid ${active ? "rgba(0,0,0,0.15)" : C.textMuted}`,
        boxSizing: "border-box" }} />
      <span style={{ flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {count != null && <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{count.toLocaleString()}</span>}
    </button>
  );
  const FilterSection = ({ title, count, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>{title}</span>
        {count != null && <span style={{ fontSize: 10, color: C.textMuted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          <b style={{ color: C.textPrimary, fontWeight: 600 }}>{count.toLocaleString()}</b> shown</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4 }}>{children}</div>
    </div>
  );

  const GroupLabel = ({ children }) => (
    <span style={{
      fontSize: 9, fontWeight: 700, color: C.textMuted,
      textTransform: "uppercase", letterSpacing: "0.08em",
      marginBottom: 3, display: "block",
    }}>
      {children}
    </span>
  );

  const PillGroup = ({ label, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <GroupLabel>{label}</GroupLabel>
      <div style={{ display: "flex", gap: 3 }}>{children}</div>
    </div>
  );

  const TbDivider = () => (
    <div style={{
      width: "0.5px",
      height: 28,
      background: C.divider,
      alignSelf: "center",
      margin: "0 4px",
    }} />
  );

  const PanelHeader = ({ children, right }) => (
    <div style={{
      padding: "9px 14px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: `0.5px solid ${C.divider}`,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: C.textMuted,
      }}>
        {children}
      </span>
      {right}
    </div>
  );

  const VulnBadge = ({ category }) => {
    const label = getScoreLabel(category);
    const color = getColor(category);
    const bgMap = {
      "Very High": dark ? "rgba(123,31,162,0.15)"  : "rgba(123,31,162,0.1)",
      High:        dark ? "rgba(239,68,68,0.15)"   : "rgba(239,68,68,0.1)",
      Moderate:    dark ? "rgba(245,158,11,0.15)"  : "rgba(245,158,11,0.1)",
      Low:         dark ? "rgba(34,197,94,0.15)"   : "rgba(34,197,94,0.1)",
      "No Data":   dark ? "rgba(107,114,128,0.15)" : "rgba(107,114,128,0.1)",
    };
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 4,
        background: bgMap[label] || bgMap["No Data"],
        color,
        border: `0.5px solid ${color}40`,
      }}>
        {label} risk
      </span>
    );
  };

  const markerTooltip = (name, type, iconColor, coords) => (
    <Tooltip direction="top" offset={[0, -18]} opacity={0.97}>
      <div style={{ minWidth: 170 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: iconColor, marginBottom: 3 }}>{name}</div>
        <div style={{ fontSize: 11, color: "#777" }}>{type}</div>
        <div style={{ fontSize: 10, color: "#aaa", marginTop: 2, fontFamily: "monospace" }}>{coords}</div>
      </div>
    </Tooltip>
  );

  /* Focused barangay: only its polygon is drawn. */
  const focusFeature = useMemo(() => (focusBrgy && geojson
    ? geojson.features.find((f) => normalizeName(getFeatureName(f)) === focusBrgy) || null : null), [focusBrgy, geojson]);
  const shownGeojson = useMemo(() => (focusFeature ? { type: "FeatureCollection", features: [focusFeature] } : geojson),
    [focusFeature, geojson]);
  const barangayOptions = useMemo(() => (geojson ? geojson.features.map((f) => {
    const name = getFeatureName(f);
    const key = normalizeName(name);
    return { key, label: OFFICIAL_BARANGAY_NAME[key] || name };
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) : []),
  [geojson]);
  const areaKey = `${areaFill}-${focusBrgy || "all"}-${tileLayer}`;
  const showArea = areaFill !== "none";

  /* GeoJSON key — does NOT include selected/layer state so toggles don't remount the layer */
  const choroplethKey = `choropleth-${barangayStats.length}-${tileLayer}-${dark}-${riskTierFilter}`;
  const boundariesKey = `boundaries-${tileLayer}-${dark}-${layers.choropleth}-${layers.dotmap}`;

  /* Dot map loading: show overlay until fetch AND computation are both done */
  const dotsLoading = layers.dotmap && (dotLoading || (households.length > 0 && computedDots.length === 0));

  /* ══════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════ */
  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", display: "flex", flexDirection: "column", width: "100%", height: "100vh", overflow: "hidden", position: "relative" }}>
      <style>{`
        @keyframes cardIn    { from{opacity:0;transform:translateY(8px)}  to{opacity:1;transform:none} }
        @keyframes cardSpring{ from{opacity:0;transform:scale(0.97)}      to{opacity:1;transform:none} }
        @keyframes spin      { to { transform: rotate(360deg); } }
        @keyframes pulseDot  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.5)} }
        @keyframes fadeIn    { from{opacity:0} to{opacity:1} }
        .leaflet-container { background: ${dark ? "#0d1117" : "#e8edf2"} !important; }
        /* Leaflet gives every interactive vector layer (barangay polygon)
           a tabindex for keyboard accessibility, so clicking one also
           gives it browser focus -- and the browser's default focus ring
           on an SVG <path> is a rectangle around the path's bounding box,
           not its actual shape. That's the black box that was appearing
           on every barangay click (rectangular, not polygon-shaped) --
           it was never anything this app drew. The gold selection
           highlight (layer.setStyle in onEachFeatureSvi/Capacity) already
           gives the same "this one is selected" feedback without it, so
           the default ring is just suppressed here rather than needed. */
        .leaflet-interactive:focus { outline: none !important; }
        .overlay-scroll::-webkit-scrollbar { width: 3px; }
        .overlay-scroll::-webkit-scrollbar-track { background: transparent; }
        .overlay-scroll::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.25); border-radius: 2px; }
        .map-ctrl-btn:hover { background: rgba(59,130,246,0.2) !important; }
        .pill-btn:not([data-active="true"]):hover { border-color: ${dark ? "rgba(147,197,253,0.45)" : "rgba(37,99,235,0.45)"} !important; color: ${dark ? "#cbd5e1" : "#1e3a8a"} !important; background: ${dark ? "rgba(59,130,246,0.08)" : "rgba(219,234,254,0.5)"} !important; }
        .pill-btn:focus-visible, .map-chip:focus-visible { outline: 2px solid #3b82f6 !important; outline-offset: 1px; }
        .map-chip { transition: background .15s, border-color .15s, color .15s; }
        .map-chip:hover { border-color: ${dark ? "rgba(147,197,253,0.45)" : "rgba(37,99,235,0.4)"} !important; }
        .map-legend-body > .lg-sec:first-child { border-top: none !important; padding-top: 0 !important; margin-top: 0 !important; }
        .leaflet-control-zoom { display: none !important; }
        .search-pulse-icon { position: relative; }
        .search-pulse-ring {
          position: absolute; left: 50%; top: 50%;
          width: 14px; height: 14px; margin: -7px 0 0 -7px;
          border-radius: 50%; border: 2px solid #38bdf8;
          animation: searchPulseRing 1.8s ease-out infinite;
        }
        .search-pulse-ring--delay { animation-delay: 0.9s; }
        .search-pulse-dot {
          position: absolute; left: 50%; top: 50%;
          width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px;
          border-radius: 50%; background: #38bdf8;
          box-shadow: 0 0 8px 2px rgba(56,189,248,0.85);
        }
        @keyframes searchPulseRing {
          0%   { transform: scale(0.5); opacity: 1; }
          100% { transform: scale(3.4); opacity: 0; }
        }
        .search-results-dropdown::-webkit-scrollbar { width: 3px; }
        .search-results-dropdown::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.25); border-radius: 2px; }
        .search-result-row:hover { background: rgba(59,130,246,0.1) !important; }
      `}</style>

      {/* ─── TOP BAR ─────────────────────────────── */}
      {/* zIndex 650 (not 600, same as the toolbar below) so the search
          results dropdown nested inside this bar always paints above the
          Basemap/Layers/Filter toolbar panel, regardless of DOM order. */}
      <div style={{ position: "relative", zIndex: 650, padding: "12px 14px 0", flexShrink: 0 }}>
        <div style={{
          ...panelStyle,
          padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 3, height: 24, borderRadius: 2, background: C.accentLine, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, lineHeight: 1.2, display: "flex", alignItems: "baseline", gap: 8 }}>
                {mapMode === "hazard" ? "Spatial Hazard Map"
                  : mapMode === "svi" ? "Official SVI Model"
                  : mapMode === "capacity" ? "Barangay Capacity"
                  : "Household Typology (k=5)"}
                {/* Framework tag -- ties every view back to the slide it
                    came from (Domain A Level 1/2, Domain B View 1/2), same
                    grouping the thesis itself uses, so the map never reads
                    as 4 unrelated tabs. */}
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: C.textMuted,
                  padding: "1px 7px", borderRadius: 20, border: `0.5px solid ${C.divider}`,
                }}>
                  {mapMode === "hazard" ? "Domain B · View 1"
                    : mapMode === "svi" ? "Domain A · Level 1"
                    : mapMode === "capacity" ? "Domain B · Capacity"
                    : "Domain A · Level 2"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 1 }}>
                {mapMode === "hazard"
                  ? (showFlood || showLandslide
                      ? "Flood / landslide zones with each household's own exposure · click a dot for the household"
                      : "Each household's hazard exposure · turn on Flood or Landslide to see the zones")
                  : mapMode === "svi"
                  ? "Barangay SVI rank (fill) with households overlaid · click a barangay for its breakdown, or a dot for the household"
                  : mapMode === "capacity"
                  ? "What each barangay has to respond: equipment, organisation and DRRM budget (fill) · computed separately from vulnerability"
                  : "Household typology (k-modes) · each dot is one household; the fill shows the most common type per barangay"}
              </div>
            </div>

            {/* ─── Household / resident search ─── */}
            <div ref={searchBoxRef} style={{ position: "relative", width: 280, marginLeft: 8 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px 6px 12px", borderRadius: 20, height: 32,
                border: `1px solid ${searchOpen ? C.tbActiveBorder : C.panelBorder}`,
                background: dark
                  ? (searchOpen ? "rgba(30,42,74,0.9)" : "rgba(20,30,52,0.7)")
                  : (searchOpen ? "#ffffff" : "rgba(239,246,255,0.7)"),
                boxShadow: searchOpen ? `0 0 0 3px ${C.tbActiveBorder}22, 0 2px 10px rgba(0,0,0,0.12)` : "none",
                transition: "all 0.18s ease",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke={searchOpen ? C.tbActiveBorder : C.textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transition: "stroke 0.18s ease" }}>
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchOpen(false); e.currentTarget.blur(); return; }
                    if (!searchResults.length) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveResultIdx((i) => (i + 1) % searchResults.length);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveResultIdx((i) => (i <= 0 ? searchResults.length - 1 : i - 1));
                    } else if (e.key === "Enter") {
                      const pick = searchResults[activeResultIdx] ?? searchResults[0];
                      if (pick) handleSelectResult(pick);
                    }
                  }}
                  placeholder="Search household or resident…"
                  style={{
                    flex: 1, minWidth: 0, border: "none", outline: "none",
                    background: "transparent", fontSize: 12.5, fontWeight: 500, color: C.textPrimary,
                  }}
                />
                {searchLoading && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textAccent}
                    strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                )}
                {!searchLoading && searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(false); }}
                    title="Clear"
                    style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                      border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      background: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", color: C.textMuted,
                    }}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {searchOpen && searchQuery.trim().length >= 2 && searchBoxRect && createPortal(
                <div className="search-results-dropdown" ref={searchDropdownRef} style={{
                  ...panelStyle,
                  // Deliberately more opaque than the shared panelStyle: this
                  // dropdown floats directly over a live satellite map, so
                  // the usual ~92% panel opacity let the map/toolbar ghost
                  // through it whenever there was no result content yet.
                  background: dark ? "rgba(8,12,22,0.99)" : "rgba(255,255,255,0.99)",
                  // Rendered via portal into document.body specifically to
                  // escape the top bar's own `overflow:hidden` panel (used
                  // elsewhere to clip content to its rounded corners) —
                  // nesting the dropdown inside that panel silently clipped
                  // it to the bar's own height, which is why it never
                  // actually appeared below the search box no matter what
                  // z-index it was given.
                  position: "fixed",
                  top: searchBoxRect.bottom + 8,
                  left: searchBoxRect.left,
                  width: searchBoxRect.width,
                  maxHeight: 320, overflowY: "auto", zIndex: 9999,
                  animation: "cardIn 0.16s cubic-bezier(0.34,1.4,0.64,1)",
                }}>
                  {searchLoading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 14px" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textAccent}
                        strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                      <span style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 500 }}>
                        Searching households and residents…
                      </span>
                    </div>
                  )}
                  {!searchLoading && searchResults.length === 0 && (
                    <div style={{ padding: "22px 14px", textAlign: "center" }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.6"
                        strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 8px", display: "block", opacity: 0.6 }}>
                        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
                      </svg>
                      <div style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 500 }}>
                        No households or residents match "{searchQuery}"
                      </div>
                    </div>
                  )}
                  {!searchLoading && searchResults.length > 0 && (
                    <div style={{
                      padding: "7px 12px", fontSize: 9.5, fontWeight: 700, color: C.textMuted,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      borderBottom: `0.5px solid ${C.divider}`,
                    }}>
                      {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                    </div>
                  )}
                  {!searchLoading && searchResults.map((r, i) => {
                    const meta = RESULT_TYPE_META[r.type] || RESULT_TYPE_META.household;
                    const active = i === activeResultIdx;
                    return (
                      <button
                        key={`${r.type}-${r.id}-${r.title}-${i}`}
                        className="search-result-row"
                        onClick={() => handleSelectResult(r)}
                        onMouseEnter={() => setActiveResultIdx(i)}
                        style={{
                          width: "100%", textAlign: "left", padding: "9px 12px", cursor: "pointer",
                          border: "none", borderBottom: `0.5px solid ${C.divider}`,
                          background: active ? `${meta.color}14` : "transparent",
                          display: "flex", alignItems: "center", gap: 10,
                          transition: "background 0.1s ease",
                        }}
                      >
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                          background: `${meta.color}1c`, border: `0.5px solid ${meta.color}40`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d={meta.icon} />
                          </svg>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{
                            fontSize: 12.5, fontWeight: 700, color: C.textPrimary,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {r.title}
                          </div>
                          <div style={{
                            fontSize: 10.5, color: C.textMuted, marginTop: 1,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                            {r.subtitle ? ` · ${r.subtitle}` : ""}
                            {r.detail ? ` · ${r.detail}` : ""}
                          </div>
                        </div>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: active ? 1 : 0.4 }}>
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                    );
                  })}
                </div>,
                document.body
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {geoError && (
              <div style={{
                fontSize: 11, color: "#f97316", padding: "4px 10px", borderRadius: 6,
                background: dark ? "rgba(249,115,22,0.1)" : "rgba(249,115,22,0.08)",
                border: "0.5px solid rgba(249,115,22,0.3)",
              }}>⚠ {geoError}</div>
            )}
            {layers.dotmap && dotLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.textMuted }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textAccent}
                  strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                Generating dots…
              </div>
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "3px 9px", borderRadius: 20,
              background: dark ? "rgba(56,189,248,0.08)" : "rgba(219,234,254,0.6)",
              border: "0.5px solid rgba(56,189,248,0.2)",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#38bdf8", fontFamily: "monospace", letterSpacing: "0.05em" }}>
                {lastUpdate}
              </span>
            </div>
            {[
              {
                title: isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)",
                path: isFullscreen
                  ? "M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"
                  : "M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3",
                onClick: toggleFullscreen,
              },
            ].map((btn) => (
              <button key={btn.title} title={btn.title} onClick={btn.onClick} disabled={btn.disabled} style={{
                width: 30, height: 30, borderRadius: 7, cursor: btn.disabled ? "wait" : "pointer",
                border: `0.5px solid ${C.panelBorder}`,
                background: dark ? "rgba(30,40,70,0.6)" : "rgba(239,246,255,0.8)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: C.textSecondary, transition: "all 0.15s",
                opacity: btn.disabled ? 0.5 : 1,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={btn.path} />
                </svg>
              </button>
            ))}
            {mapMode === "hazard" && <HazardWatchlistExport dark={dark} autoOpenKey={intent?.watchlist ? intent.ts : null} />}
            <MapReportExport
              mode={mapMode === "hazard" && showFacilityAccess ? "distance" : mapMode}
              dark={dark}
              focusKey={focusBrgy}
              geojson={geojson}
              households={households}
              floodGeojson={floodGeojson}
              landslideGeojson={landslideGeojson}
            />
          </div>
        </div>
      </div>

      {/* ─── MAP + SIDEBAR ROW ──────────────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative", background: dark ? "#0d1117" : "#eef2f7", padding: "12px 0 12px 12px", gap: 12 }}>
        {/* ─── MAP ─────────────────────────────── */}
        <div ref={mapAreaRef} style={{
          flex: 1, minHeight: 0, position: "relative", overflow: "hidden",
          borderRadius: 14, border: `1px solid ${C.panelBorder}`,
          boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.35)" : "0 4px 20px rgba(15,23,42,0.08)",
        }}>
        <MapContainer center={[10.87, 122.46]} zoom={5} style={{ height: "100%", width: "100%" }} zoomControl={false}
          preferCanvas={true} /* one shared canvas for every polygon layer instead of thousands of SVG nodes -- the main smoothness win */
          wheelPxPerZoomLevel={90} zoomSnap={0.5} zoomDelta={0.5}>
          {tileLayer === "street" && <TileLayer url={streetUrl} attribution="© OpenStreetMap contributors" updateWhenZooming={false} keepBuffer={4} />}
          {tileLayer === "satellite" && (
            <>
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxZoom={19} updateWhenZooming={false} keepBuffer={4} />
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} updateWhenZooming={false} keepBuffer={4} />
            </>
          )}
          {tileLayer === "terrain" && (
            <TileLayer url="https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png" attribution="© Stadia Maps © Stamen © OpenStreetMap" maxZoom={18} updateWhenZooming={false} keepBuffer={4} />
          )}

          {geojson && <FitBounds geojson={geojson} />}
          <FocusBounds feature={focusFeature} geojson={geojson} />

          {/* OPT #2 — CoordTracker now writes directly to DOM; no React state update on mousemove */}
          <CoordTracker coordSpanRef={coordSpanRef} />
          <MapRefCapture mapRef={mapRef} />

          {/* ── Hazard view: household dot map — the legacy Vulnerability
              (BVI) choropleth/boundaries/dots have been retired; the dot map
              lives on here only. ONE dot layer, colored by whichever key
              hazardDotColorMode picks: each household's real hazard
              exposure tier (default, with the Filter row letting you narrow
              down to just households inside a hazard zone), or its own
              k-modes typology cluster (Sir Shem's ask: cluster membership
              available on the Hazard view too). Never both at once -- an
              earlier version stacked a second dot layer on top for cluster
              membership, which was confusing since it's literally the same
              households at the same positions just colored twice; a single
              color-mode switch is clearer. ── */}
          {/* Faint barangay outline under the dots in Hazard view, when no
              flood/landslide fill is already drawing one. */}
          {mapMode === "hazard" && showArea && (layers.dotmap || areaFill === "outline" || focusBrgy) && shownGeojson && !showFlood && !showLandslide && (
            <GeoJSON key={`dotboundary-${dark}-${areaKey}`} data={shownGeojson} style={dotBoundaryStyle} interactive={false} />
          )}

          {/* Search highlight ring — independent of the dot layer being on,
              since search should work whether or not Dot map is toggled */}
          <SearchPulseMarker position={highlightPos} />

          {showRoads && roadsGeojson && (
            <GeoJSON key="roads-layer" data={roadsGeojson} style={roadsStyle} smoothFactor={1.5} interactive={false} />
          )}

          {/* ── Hazard view: flood / landslide fill — gated on mapMode so it
              never paints over the SVI / Typology choropleth fills. ── */}
          {mapMode === "hazard" && showFlood && floodGeojson && (
            <GeoJSON
              key="flood-layer" smoothFactor={1.5}
              data={floodGeojson}
              style={floodStyle}
              onEachFeature={(feature, layer) => {
                const label = getFloodLabel(feature.properties?.FloodSusc);
                layer.bindTooltip(label, { sticky: true });
              }}
            />
          )}

          {mapMode === "hazard" && showLandslide && landslideGeojson && (
            <GeoJSON
              key="landslide-layer" smoothFactor={1.5}
              data={landslideGeojson}
              style={landslideStyle}
              onEachFeature={(feature, layer) => {
                const label = getLandslideLabel(feature.properties?.LndslideSu);
                layer.bindTooltip(label, { sticky: true });
              }}
            />
          )}

          {/* ── Official SVI model view: choropleth by svi_rank quartile.
              Click a barangay to highlight its boundary + open the pinned
              selection card (see selectedDomainBarangay); the card's own
              button opens the indicator-level explain panel. Selection is
              deliberately NOT part of this layer's `key` -- it used to be,
              which forced the whole GeoJSON (all 24 polygons) to unmount
              and remount on every click, flashing Leaflet's default
              unstyled path (a plain black-stroked box) for one frame
              before the real style reapplied. The highlight now happens by
              calling layer.setStyle() directly inside the click handler
              (see onEachFeatureSvi / domainLayerRefs), so this layer only
              remounts for the reasons already in the key: new data, or a
              dark-mode switch. ── */}
          {mapMode === "svi" && showArea && shownGeojson && domainStats.length > 0 && (
            <GeoJSON
              key={`svi-${domainStats.length}-${dark}-${layers.dotmap}-${areaKey}`}
              data={shownGeojson}
              style={styleFeatureSvi}
              onEachFeature={onEachFeatureSvi}
            />
          )}

          {/* ── Capacity + Distance view (Domain B, View 2): choropleth by
              capacity_distance_rank -- Sir Shem's other Domain B construct,
              deliberately its own tab/fill, never blended with the SVI fill
              above or the Hazard fill. Same imperative click-to-select
              pattern as SVI above -- selection is not part of the key. ── */}
          {mapMode === "capacity" && showArea && shownGeojson && capacityDistanceStats.length > 0 && (
            <GeoJSON
              key={`capacity-${capacityDistanceStats.length}-${dark}-${layers.dotmap}-${areaKey}`}
              data={shownGeojson}
              style={styleFeatureCapacity}
              onEachFeature={onEachFeatureCapacity}
            />
          )}

          {/* ── Household typology view: choropleth by dominant k=5 cluster.
              Independently toggled via the Choropleth pill, same pattern as
              the dot map's own toggle below. ── */}
          {mapMode === "typology" && showArea && shownGeojson && typologyStats.length > 0 && (
            <GeoJSON
              key={`typology-${typologyStats.length}-${dark}-${layers.dotmap}-${areaKey}`}
              data={shownGeojson}
              style={styleFeatureTypology}
              onEachFeature={onEachFeatureTypology}
            />
          )}

          {/* ── Households: one dot per real household, overlaid on whichever
              view is active (Sir's note: calculations stay separate, the
              households are overlaid). Colored by dotColorBy; click a dot
              for the household card. ── */}
          {layers.dotmap && overlayDots.length > 0 && (
            <DotMapLayer
              dots={overlayDots}
              dotFilters={overlayFilters}
              onDotClick={handleDotClick}
              clusterFilter={mapMode === "hazard" && dotColorBy === "hazard" ? hazardClusterFilter : undefined}
              glowLabel={dotColorBy === "hazard" && highlightVeryHigh ? "Very High" : null}
            />
          )}

          {showHealthcare && HEALTHCARE.map((p, i) => (
            <Marker key={`hc-${i}`} position={[p.lat, p.lng]} icon={pharmacyIcon}>
              {markerTooltip(p.name, "Healthcare facility", "#7c3aed", `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)}
            </Marker>
          ))}
          {/* RHU 2km service radius -- visual catchment ring around the main
              Rural Health Unit, echoing Sir Shem's calculate_facility_capacity_2km()
              framing. Straight-line 2km, not a road-network isochrone.
              Available in every view, same as the other Reference overlays. */}
          {showRhuRadius && (
            <Circle
              center={[RHU_LOCATION.lat, RHU_LOCATION.lng]}
              radius={2000}
              pathOptions={{ color: "#7c3aed", weight: 2.5, fillColor: "#7c3aed", fillOpacity: showFacilityAccess ? 0 : 0.08, dashArray: "8 6" }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{RHU_LOCATION.name}</div>
                <div style={{ fontSize: 11, color: "#666" }}>2 km straight-line service radius</div>
              </Tooltip>
            </Circle>
          )}
          {/* Fire Station 2km service radius -- same catchment framing as
              the RHU 2km ring above (calculate_facility_capacity_2km()),
              just the Fire Station's own coordinate. Distinct color (red)
              so it's never confused with the RHU (purple) ring. */}
          {showFacilityAccess && (
            <>
              <Marker position={[RHU_LOCATION.lat, RHU_LOCATION.lng]} icon={facilityPin("RHU", "#6d28d9")} zIndexOffset={900}>
                <Tooltip direction="top" offset={[0, -18]} opacity={1}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{RHU_LOCATION.name}</div>
                </Tooltip>
              </Marker>
              <Marker position={[FIRE_LOCATION.lat, FIRE_LOCATION.lng]} icon={facilityPin("Fire Station", "#b91c1c")} zIndexOffset={900}>
                <Tooltip direction="top" offset={[0, -18]} opacity={1}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{FIRE_LOCATION.name}</div>
                </Tooltip>
              </Marker>
            </>
          )}
          {showFireRadius && (
            <Circle
              center={[FIRE_LOCATION.lat, FIRE_LOCATION.lng]}
              radius={2000}
              pathOptions={{ color: "#dc2626", weight: 2.5, fillColor: "#dc2626", fillOpacity: showFacilityAccess ? 0 : 0.08, dashArray: "8 6" }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{FIRE_LOCATION.name}</div>
                <div style={{ fontSize: 11, color: "#666" }}>2 km straight-line service radius</div>
              </Tooltip>
            </Circle>
          )}
          {showSchools && ELEMENTARY_SCHOOLS.map((s, i) => (
            <Marker key={`elem-${i}`} position={[s.lat, s.lng]} icon={elementarySchoolIcon}>
              {markerTooltip(s.name, "Elementary school", "#d97706", `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`)}
            </Marker>
          ))}
          {showSchools && HIGH_SCHOOLS.map((s, i) => (
            <Marker key={`high-${i}`} position={[s.lat, s.lng]} icon={highSchoolIcon}>
              {markerTooltip(s.name, `${s.type} high school`, "#1d4ed8", `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`)}
            </Marker>
          ))}
          {showGovernment && GOVERNMENT.map((g, i) => (
            <Marker key={`gov-${i}`} position={[g.lat, g.lng]} icon={governmentIcon}>
              {markerTooltip(g.name, "Government & social services", "#059669", `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`)}
            </Marker>
          ))}
        </MapContainer>

        {/* ── Legend — floats over the map (top-left) instead of living in
            the sidebar, so the sidebar stays just the toolbar. Content is
            entirely mode-specific. Hazard view shows the flood/landslide
            legend and, when the dot map is on, the per-household
            hazard-exposure tier scale. Reference-overlay entries
            (roads/healthcare/schools/gov) are the only thing shared across
            views. Own maxHeight + scroll so a long barangay ranking list
            never grows past the map's own height. ── */}
        <div className="overlay-scroll" style={{
          ...panelStyle, pointerEvents: "auto",
          position: "absolute", top: 14, left: 14, zIndex: 700,
          width: 300, maxHeight: "calc(100% - 88px)", overflowY: "auto",
          animation: "fadeIn 0.3s ease",
        }}>
          <PanelHeader>
            {mapMode === "hazard"
              ? "Hazard exposure (Domain B, View 1)"
              : mapMode === "svi"
              ? "Social vulnerability (Domain A, Level 1)"
              : mapMode === "capacity"
              ? "Barangay capacity (Domain B)"
              : "Household typology (Domain A, Level 2)"}
          </PanelHeader>
          <div className="map-legend-body" style={{ padding: "10px 14px" }}>

            {mapMode === "svi" && (
              <>
                {domainLoading && (
                  <div style={{ fontSize: 11, color: C.textMuted }}>Loading SVI data…</div>
                )}
                {domainError && (
                  <div style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>{domainError}</div>
                )}
                {!domainLoading && !domainError && SVI_LEGEND_ITEMS.map((item) => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
                    <div style={{ width: 16, height: 8, borderRadius: 2, background: item.color, border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, flex: 1, fontWeight: 500 }}>{item.label}</span>
                    <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>{item.range}</span>
                  </div>
                ))}
                <div style={{
                  height: 10, borderRadius: 4, marginTop: 2, marginBottom: 8,
                  background: SVI_GRADIENT,
                  border: "0.5px solid rgba(0,0,0,0.15)",
                }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: C.textMuted, marginTop: -4, marginBottom: 4 }}>
                  <span>Most vulnerable (rank 1)</span>
                  <span>Least vulnerable (rank 24)</span>
                </div>
                <div style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 8, marginTop: 4, fontSize: 10.5, color: C.textMuted, lineHeight: 1.5 }}>
                  Social Vulnerability Index (13 components: 11 social indicators + % of households beyond 2 km of the RHU/fire station, equal-weight percentile sum, max 1,300). Full barangay ranking is in the sidebar.
                </div>
              </>
            )}

            {mapMode === "capacity" && (
              <>
                {capacityDistanceLoading && (
                  <div style={{ fontSize: 11, color: C.textMuted }}>Loading capacity data…</div>
                )}
                {capacityDistanceError && (
                  <div style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>{capacityDistanceError}</div>
                )}
                {!capacityDistanceLoading && !capacityDistanceError && CAPACITY_TIER_LEGEND.map((item) => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
                    <div style={{ width: 16, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, flex: 1, fontWeight: 500 }}>{item.label}</span>
                    <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>{item.range}</span>
                  </div>
                ))}
                <div style={{
                  height: 10, borderRadius: 4, marginTop: 2, marginBottom: 8,
                  background: `linear-gradient(90deg, ${capacityColorByRank(1)}, ${capacityColorByRank(12)}, ${capacityColorByRank(24)})`,
                }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: C.textMuted, marginTop: -4, marginBottom: 4 }}>
                  <span>Best equipped (rank 1)</span>
                  <span>Least equipped (rank 24)</span>
                </div>
                <div style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 8, marginTop: 4, fontSize: 10.5, color: C.textMuted, lineHeight: 1.5 }}>
                  Scored: disaster committee, response team, hotline, preparedness seminar, DRRM plan,
                  evacuation map, hazard map, schools, evacuation centres, first-aid kits, ambulances, heavy
                  equipment, sirens, radios, generators, emergency lights and the DRRM budget (each compared
                  across the 24 barangays, then averaged). Distance is part of vulnerability, not capacity.
                </div>
              </>
            )}

            {mapMode === "typology" && (
              <>
                {typologyLoading && (
                  <div style={{ fontSize: 11, color: C.textMuted }}>Loading typology data…</div>
                )}
                {typologyError && (
                  <div style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.5 }}>{typologyError}</div>
                )}
                {/* Municipality-wide composition — same ranked breakdown as
                    the Dashboard's "Household Typology — Third Analytical
                    View" card, so the two pages read as one system. */}
                {!typologyLoading && !typologyError && typologyComposition.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 10 }}>
                    {typologyComposition.map((c) => (
                      <div key={c.clusterId}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 4 }}>
                          <div style={{ width: 9, height: 9, borderRadius: "50%", background: getTypologyColor(c.clusterId), flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {c.label}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: getTypologyColor(c.clusterId) }}>
                            {c.pct.toFixed(1)}%
                          </span>
                          <InfoToggleButton open={typInfoOpen === c.clusterId} color={getTypologyColor(c.clusterId)} label={`About ${c.label}`}
                            onClick={() => setTypInfoOpen((o) => (o === c.clusterId ? null : c.clusterId))} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 7, background: dark ? "#1a2540" : "#eef0f5", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${c.pct}%`, height: "100%", background: `linear-gradient(90deg, ${getTypologyColor(c.clusterId)}88, ${getTypologyColor(c.clusterId)})`, borderRadius: 4, transition: "width 0.6s ease" }} />
                          </div>
                          <span style={{ fontSize: 10.5, color: C.textMuted, flexShrink: 0 }}>{c.households.toLocaleString()} HH</span>
                        </div>
                        {typInfoOpen === c.clusterId && (
                          <div style={{ marginTop: 8 }}>
                            <TypologyInfoCard clusterId={c.clusterId} share={c.pct} households={c.households} compact
                              D={{ textMuted: C.textMuted, textBody: C.textPrimary, textPrimary: C.textPrimary }} />
                          </div>
                        )}
                      </div>
                    ))}
                    <div style={{ fontSize: 10.5, color: C.textMuted }}>Click <b>i</b> for a profile's defining factors and reference.</div>
                  </div>
                )}
                {!typologyLoading && !typologyError && typologyComposition.length === 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 7 }}>
                    {TYPOLOGY_LEGEND_ITEMS.map((item) => (
                      <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: C.textPrimary, flex: 1, fontWeight: 500 }}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {mapMode === "hazard" && !showFlood && !showLandslide && !layers.dotmap && (
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>
                Turn on Flood or Landslide above to see hazard exposure.
              </div>
            )}

            {mapMode === "hazard" && showFlood && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  <div style={{ width: 16, height: 8, borderRadius: 2, background: "#E6D6EC", border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Flood — Low</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  <div style={{ width: 16, height: 8, borderRadius: 2, background: "#92278F", border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Flood — Moderate</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  <div style={{ width: 16, height: 8, borderRadius: 2, background: "#2E3192", border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Flood — High</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  <div style={{ width: 16, height: 8, borderRadius: 2, background: "#000000", border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Flood — Very High</span>
                </div>
              </>
            )}
            {mapMode === "hazard" && showLandslide && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  <div style={{ width: 16, height: 8, borderRadius: 2, background: "#FFF200", border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Landslide — Low</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  <div style={{ width: 16, height: 8, borderRadius: 2, background: "#39B54A", border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Landslide — Moderate</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  <div style={{ width: 16, height: 8, borderRadius: 2, background: "#ED1C24", border: "0.5px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Landslide — High</span>
                </div>
              </>
            )}

            {/* ── Facility Distance: what the dots and circles mean ── */}
            {mapMode === "hazard" && showFacilityAccess && (
              <div className="lg-sec" style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 8, marginTop: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Facility Distance</div>
                <div style={{ fontSize: 10.5, color: C.textMuted, lineHeight: 1.5 }}>
                  Each dot is colored by its straight-line distance to the RHU and the Fire Station. The dashed circles mark 2 km. Outside a circle = beyond 2 km of that facility.
                </div>
              </div>
            )}

            {/* ── Reference overlays — shared between both views ── */}
            {(showRoads || showHealthcare || showRhuRadius || showFireRadius || showSchools || showGovernment || layers.boundaries) && (
              <div className="lg-sec" style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 8, marginTop: 8 }}>
                {showRoads && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                    <div style={{ width: 16, height: 3, background: tileLayer === "satellite" ? "#fbbf24" : tileLayer === "terrain" ? "#f97316" : "#ef4444", borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Roads</span>
                  </div>
                )}
                {showHealthcare && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#7c3aed", border: "1.5px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Healthcare ({HEALTHCARE.length})</span>
                  </div>
                )}
                {showHealthcare && layers.dotmap && computedDots.length > 0 && (
                  <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 8, marginLeft: 19, lineHeight: 1.5 }}>
                    {healthcareIsolatedCount.toLocaleString()} households are more than 2 km (straight-line) from the nearest facility
                  </div>
                )}
                {showRhuRadius && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px dashed #7c3aed", background: "rgba(124,58,237,0.08)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>2 km from the RHU</span>
                  </div>
                )}
                {showRhuRadius && !(mapMode === "hazard" && showFacilityAccess) && (
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 8, marginLeft: 19, lineHeight: 1.5 }}>
                    Straight-line 2 km catchment around the Rural Health Unit (Main Health Center) — not a road-network isochrone.
                  </div>
                )}
                {showFireRadius && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px dashed #dc2626", background: "rgba(220,38,38,0.08)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>2 km from the Fire Station</span>
                  </div>
                )}
                {showFireRadius && !(mapMode === "hazard" && showFacilityAccess) && (
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 8, marginLeft: 19, lineHeight: 1.5 }}>
                    Straight-line 2 km catchment around the Fire Station — not a road-network isochrone.
                  </div>
                )}
                {showSchools && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#f59e0b", border: "1.5px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Elementary ({ELEMENTARY_SCHOOLS.length})</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#3b82f6", border: "1.5px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>High school ({HIGH_SCHOOLS.length})</span>
                    </div>
                  </>
                )}
                {showGovernment && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#059669", border: "1.5px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Government ({GOVERNMENT.length})</span>
                  </div>
                )}
                {layers.boundaries && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                    <div style={{ width: 16, height: 8, border: `1.5px solid ${dark ? "rgba(96,165,250,0.8)" : "rgba(30,64,175,0.7)"}`, borderRadius: 2, background: "transparent", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>Barangay boundaries</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Households legend: same block in every view, follows what the
                dots are colored by. Counts are all households in the data. ── */}
            {layers.dotmap && mapMode === "typology" && dotColorBy === "cluster" && (
              <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.5, marginTop: 4 }}>
                Each dot is one household, colored by its own typology (same colors as above); click it for details.
              </div>
            )}
            {layers.dotmap && !(mapMode === "typology" && dotColorBy === "cluster") && (() => {
              const n = (k) => (overlayCounts[k] || 0).toLocaleString();
              const items = dotColorBy === "hazard"
                ? HOUSEHOLD_LEGEND_ITEMS.filter((i) => i.category != null && !(hazardBasis === "landslide" && i.category === "Very High"))
                    .map((i) => ({ key: i.category, color: i.color, label: i.label }))
                : dotColorBy === "distance"
                ? DISTANCE_TIERS.map((t) => ({ key: t.key, color: t.color, label: t.label, ring: t.key === "Within 2 km" ? PLAIN_DOT.stroke : undefined }))
                : dotColorBy === "cluster"
                ? TYPOLOGY_LEGEND_ITEMS.map((t) => ({ key: t.clusterId, color: t.color, label: t.label }))
                : [{ key: "all", color: PLAIN_DOT_COLOR, label: "Household", ring: PLAIN_DOT.stroke }];
              const heading = dotColorBy === "hazard"
                ? (hazardBasis === "flood" ? "Households · flood exposure" : hazardBasis === "landslide" ? "Households · landslide exposure" : "Households · hazard exposure")
                : dotColorBy === "distance" ? "Households · distance to RHU / Fire Station"
                : dotColorBy === "cluster" ? "Households · typology"
                : "Households";
              const note = dotColorBy === "hazard"
                ? (hazardBasis === "combined"
                    ? "Combined exposure: the worse of flood or landslide at the household's location. Turn on only Flood (or only Landslide) to color by that hazard alone."
                    : hazardBasis === "flood" ? "Flood layer on: dots show flood exposure only, matching the zone under each dot."
                    : "Landslide layer on: dots show landslide exposure only, matching the zone under each dot.")
                : dotColorBy === "distance" ? "Straight-line distance from each household to the RHU and to the Fire Station."
                : dotColorBy === "cluster" ? "Each household's own typology group."
                : "Household locations only.";
              return (
                <div className="lg-sec" style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 8, marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, marginBottom: 7 }}>{heading}</div>
                  {items.map((it) => (
                    <div key={String(it.key)} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", background: it.color, border: `1px solid ${it.ring || "rgba(255,255,255,0.8)"}`, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.25)", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: C.textPrimary, flex: 1, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                      <span style={{ fontSize: 11, color: C.textMuted, fontVariantNumeric: "tabular-nums" }}>{n(it.key)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.5, marginTop: 2 }}>
                    {note} Each dot is one household; click it for details.
                  </div>
                </div>
              );
            })()}
          </div>
        </div>


        {/* OPT #2 — Coordinate display: span has a DOM ref; CoordTracker writes to it directly */}
        <div style={{
          position: "absolute", bottom: 56, left: 14, zIndex: 700,
          ...panelStyle, padding: "6px 10px",
          animation: "fadeIn 0.4s ease",
        }}>
          <span
            ref={coordSpanRef}
            style={{ fontSize: 10, fontFamily: "monospace", color: C.textSecondary, letterSpacing: "0.05em" }}
          >
            10.7500° N  122.5281° E
          </span>
        </div>

        {selected && (
          <div style={{
            position: "absolute", bottom: 20, left: 14, zIndex: 700,
            ...panelStyle, padding: "6px 12px",
            display: "flex", alignItems: "center", gap: 7,
            animation: "cardIn 0.2s ease",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: getColor(selected.vuln_category),
              animation: "pulseDot 2s ease infinite",
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: C.textPrimary }}>{selected.barangay_name}</span>
            <span style={{ fontSize: 10, color: C.textMuted }}>selected</span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: getColor(selected.vuln_category),
              padding: "1px 6px", borderRadius: 10,
              background: `${getColor(selected.vuln_category)}18`,
              border: `0.5px solid ${getColor(selected.vuln_category)}40`,
            }}>
              {getScoreLabel(selected.vuln_category)} Risk
            </span>
            <button
              onClick={() => { setSelected(null); selectedRef.current = null; applySelectionStyles(null); }}
              style={{
                width: 18, height: 18, borderRadius: "50%", cursor: "pointer",
                border: `0.5px solid ${C.panelBorder}`,
                background: "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: C.textMuted, fontSize: 10, fontWeight: 700, marginLeft: 2,
              }}
            >✕</button>
          </div>
        )}

        {/* Zoom + fullscreen buttons -- the sidebar is now a real flex
            column next to the map (not an overlay on top of it), so this
            no longer needs to dodge panelCollapsed's width. */}
        <div style={{
          position: "absolute", bottom: 20, right: 14, zIndex: 700,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {[
            { title: "Zoom in (+)",  path: "M12 5v14M5 12h14",  onClick: () => mapRef.current?.zoomIn()  },
            { title: "Zoom out (-)", path: "M5 12h14",            onClick: () => mapRef.current?.zoomOut() },
            {
              title: isFullscreen ? "Exit fullscreen" : "Fullscreen",
              path: isFullscreen
                ? "M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"
                : "M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3",
              onClick: toggleFullscreen,
            },
          ].map((btn) => (
            <button key={btn.title} title={btn.title} onClick={btn.onClick} className="map-ctrl-btn" style={{
              width: 30, height: 30, borderRadius: 8, cursor: "pointer",
              border: `0.5px solid ${C.panelBorder}`,
              background: dark ? "rgba(10,14,26,0.85)" : "rgba(255,255,255,0.9)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.textSecondary, transition: "all 0.15s", boxShadow: C.panelShadow,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={btn.path} />
              </svg>
            </button>
          ))}
        </div>

        {/* OPT #2 — Hover tooltip: position is updated via ref on mousemove (no setState).
            Content re-renders only on enter/exit. */}
        {hoverLabel && !layers.dotmap && (
          <div
            ref={hoverTooltipRef}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: "translate(0px, 0px)", /* initial; overwritten by useLayoutEffect */
              zIndex: 2000,
              pointerEvents: "none",
              background: C.hoverBg,
              borderRadius: 8,
              padding: "8px 12px",
              border: `0.5px solid ${hoverLabel.color}50`,
              boxShadow: `0 4px 16px rgba(0,0,0,0.3), 0 0 0 0.5px ${hoverLabel.color}30`,
              animation: "fadeIn 0.1s ease",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
              {hoverLabel.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: hoverLabel.color }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: hoverLabel.color }}>
                {hoverLabel.label}
              </span>
              {hoverLabel.score != null && (
                <span style={{ fontSize: 11, color: C.textSecondary, fontFamily: "monospace" }}>
                  {Number(hoverLabel.score).toFixed(4)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Dot map loading overlay — stays visible through fetch AND computation */}
        {dotsLoading && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 1000,
            background: dark ? "rgba(8,11,20,0.75)" : "rgba(241,245,249,0.8)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: dark ? "rgba(30,40,70,0.9)" : "rgba(255,255,255,0.9)",
              border: `0.5px solid ${C.panelBorder}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: C.panelShadow,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.textAccent} strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Generating household dots</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                Placing {totalHouseholds.toLocaleString()} dots across {barangayStats.length} barangays
              </div>
            </div>
          </div>
        )}
      </div>

        {/* ─── SIDEBAR (toolbar + rankings + details) ── */}
        <div style={{
          width: 340, flexShrink: 0, position: "relative",
          borderLeft: `0.5px solid ${C.panelBorder}`, background: C.panelBg,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
      {/* ── Scrollable region: rankings, filters, barangay/summary panels.
          It's its own flex child with minHeight: 0 (required so a flex
          child can actually shrink below its content height) so that
          whatever comes after it — the household preview card — is
          never pushed off-screen no matter how tall the ranking/overlay
          list or population filters grow. No collapse button any more --
          always expanded, so Basemap sits right at the very top. ── */}
      <div
        className="overlay-scroll"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          overflowX: "visible",
          display: "flex", flexDirection: "column", gap: 8,
          padding: "8px 10px",
        }}
      >
        {/* ─── TOOLBAR (moved into sidebar) ────── */}
        <div style={{
          ...panelStyle,
          padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: 7,
          minWidth: 0, flexShrink: 0,
        }}>
          {/* Row 1: Basemap */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Basemap</span>
            <div style={{ display: "flex", flexWrap: "nowrap", gap: 4 }}>
              {[
                { id: "street",    label: "Street",    icon: "M8 3L4 21M20 3l-4 18M4 9h16M4 15h16",                          shortcut: "1" },
                { id: "satellite", label: "Satellite", icon: "M12 2a10 10 0 100 20A10 10 0 0012 2zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20", shortcut: "2" },
                { id: "terrain",   label: "Terrain",   icon: "M3 20l6-16 6 10 3-4 3 10H3",                                    shortcut: "3" },
              ].map(({ id, label, icon, shortcut }) => (
                <Pill key={id} active={tileLayer === id} onClick={() => setTileLayer(id)} title={`${label} basemap (press ${shortcut})`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
                  {label}
                </Pill>
              ))}
            </div>
          </div>

          <div style={{ height: "0.5px", background: C.divider, margin: "0 -2px" }} />

          {/* Row: View mode — Hazard, SVI, Capacity, and Typology choropleths/
              base layers are mutually exclusive. Switching clears the other
              views' layers so their fills never render on top of each
              other, and the sidebar swaps to show only panels relevant to
              the active view. SVI and Capacity are Sir Shem's own two
              separate domains (his score_capacity() docstring: "Capacity
              remains a separate construct from vulnerability") -- kept as
              two distinct tabs/choropleths on purpose, never merged into
              one fill or score.
              ONE deliberate exception: the Hazard view's dot map can be
              colored by household typology (k-modes cluster) instead of
              hazard exposure tier, via the "Dots colored by" switch (see
              hazardDotColorMode below) -- Sir Shem specifically asked for
              cluster membership to be available on the Hazard view. This
              doesn't blend Domain A's typology into Domain B's hazard
              score; it's the same single dot layer, just recolored by a
              different key, never two stacked dot layers at once. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>View</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 5 }}>
              {[
                { id: "hazard",        label: "Hazard",        color: "#dc2626", icon: "M12 2c4 5 7 8.5 7 12a7 7 0 1 1-14 0c0-3.5 3-7 7-12z" },
                { id: "svi",           label: "SVI (Official)", color: "#0ea5e9", icon: "M12 20V10M18 20V4M6 20v-4" },
                { id: "capacity",      label: "Capacity",      color: "#16a34a", icon: "M13 2L3 14h7v8l10-12h-7z" },
                { id: "typology",      label: "Typology (k=5)", color: "#9333ea", icon: "M12 2a4 4 0 100 8 4 4 0 000-8zM5 21a7 7 0 0114 0" },
              ].map(({ id, label, color, icon }) => {
                const active = mapMode === id;
                return (
                  <button key={id} onClick={() => setMapMode(id)} title={`Switch to ${label} view`} className="pill-btn" data-active={active ? "true" : "false"} style={{
                    display: "flex", alignItems: "center", gap: 6, minWidth: 0,
                    padding: "5px 10px", fontSize: 11.5, fontWeight: active ? 700 : 500,
                    borderRadius: 6, cursor: "pointer", height: 30, outline: "none",
                    border: `0.5px solid ${active ? color : C.tbBtnBorder}`,
                    background: active ? `${color}22` : C.tbBtnBg,
                    color: active ? color : C.tbBtnText, transition: "all 0.15s",
                    overflow: "hidden",
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d={icon} /></svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ height: "0.5px", background: C.divider, margin: "0 -2px" }} />

          {/* Row: Barangay area (fill / outline / none) and one-barangay focus */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Barangay area</span>
            <div style={{ display: "flex", flexWrap: "nowrap", gap: 4 }}>
              {[
                { id: "color",   label: mapMode === "hazard" ? "Shaded" : "Colored", title: "Barangays filled with the active view's colours", icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" },
                { id: "outline", label: "Boundaries", title: "Boundary lines only, no fill", icon: "M4 4h16v16H4z" },
                { id: "none",    label: "None", title: "No barangay fill or boundary", icon: "M4 4l16 16M20 4L4 20" },
              ].map(({ id, label, title, icon }) => (
                <Pill key={id} active={areaFill === id} onClick={() => setAreaFill(id)} title={`${title} (press B to cycle)`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
                  {label}
                </Pill>
              ))}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select value={focusBrgy || ""} onChange={(e) => { setFocusBrgy(e.target.value || null); setSelectedDomainBarangay(null); }}
                title="Show one barangay only: its boundary and its households"
                style={{ flex: 1, minWidth: 0, height: 28, borderRadius: 6, fontSize: 11.5, padding: "0 8px", cursor: "pointer",
                  border: `0.5px solid ${focusBrgy ? C.tbActiveBorder : C.tbBtnBorder}`,
                  background: focusBrgy ? `${C.tbActiveBorder}18` : C.tbBtnBg,
                  color: focusBrgy ? C.tbActiveText : C.tbBtnText, fontWeight: focusBrgy ? 700 : 500, outline: "none" }}>
                <option value="">All barangays</option>
                {barangayOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              {focusBrgy && (
                <button onClick={() => setFocusBrgy(null)} title="Show all barangays" className="pill-btn" style={{
                  height: 28, padding: "0 9px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
                  border: `0.5px solid ${C.tbBtnBorder}`, background: C.tbBtnBg, color: C.tbBtnText, outline: "none" }}>
                  Show all
                </button>
              )}
            </div>
          </div>

          <div style={{ height: "0.5px", background: C.divider, margin: "0 -2px" }} />

          {/* Row 2: Layers -- the Households pill is in every view (dots are
              overlaid on the barangay fill), plus each view's own layers. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Layers</span>
            <div style={{ display: "flex", flexWrap: "nowrap", gap: 4 }}>
              <Pill active={layers.dotmap} onClick={() => toggleLayer("dotmap")} title="Show or hide the household dots (press D)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12m-1 0a1 1 0 102 0 1 1 0 10-2 0M6 6m-1 0a1 1 0 102 0 1 1 0 10-2 0M18 6m-1 0a1 1 0 102 0 1 1 0 10-2 0M6 18m-1 0a1 1 0 102 0 1 1 0 10-2 0M18 18m-1 0a1 1 0 102 0 1 1 0 10-2 0" /></svg>
                Households
              </Pill>
              {mapMode === "hazard" && (
                <Pill active={showFacilityAccess} color="#0891b2" onClick={toggleFacilityAccess}
                  title="Barangays shaded by the share of households beyond 2 km of the RHU / Fire Station (part of vulnerability; also shows the 2 km circles). Press A">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 16l4-6 4 3 5-8" /></svg>
                  Facility Distance
                </Pill>
              )}
            </div>
            {layers.dotmap && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Color households by</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 4 }}>
                  {DOT_COLOR_OPTIONS.map(({ id, label, title }) => (
                    <Pill key={id} active={dotColorBy === id} onClick={() => setDotColorBy(id)} title={title}>{label}</Pill>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ height: "0.5px", background: C.divider, margin: "0 -2px" }} />

          {/* Row 3: Reference overlays — roads/amenities, useful in either view,
              so these stay available regardless of mapMode. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Reference</span>
            {/* Grid, not nowrap-flex: a fixed 3-column grid always lays pills
                out in clean rows (3+3 now), so nothing gets squeezed
                off-screen (icons/labels were clipping under nowrap+flex). */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}>
              {[
                { key: "roads",      label: "Roads",      color: tileLayer === "satellite" ? "#d97706" : tileLayer === "terrain" ? "#f97316" : "#ef4444", val: showRoads,      set: () => setShowRoads((p) => !p),      icon: "M8 3L4 21M20 3l-4 18M4 9h16M3 15h16",                   shortcut: "R" },
                { key: "healthcare", label: "Healthcare", color: "#7c3aed", val: showHealthcare,  set: () => setShowHealthcare((p) => !p), icon: "M12 2v20M2 12h20",                                     shortcut: "H" },
                { key: "rhuRadius",  label: "RHU 2km",    color: "#7c3aed", val: showRhuRadius,   set: () => setShowRhuRadius((p) => !p),  icon: "M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 10m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0", shortcut: "U" },
                { key: "fireRadius", label: "Fire 2km",   color: "#dc2626", val: showFireRadius,  set: () => setShowFireRadius((p) => !p), icon: "M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 10m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0", shortcut: "I" },
                { key: "schools",    label: "Schools",    color: "#d97706", val: showSchools,     set: () => setShowSchools((p) => !p),    icon: "M22 10v6M2 10l10-5 10 5-10 5zM6 12v5c3 3 9 3 12 0v-5", shortcut: "S" },
                { key: "gov",        label: "Gov't", color: "#059669", val: showGovernment,  set: () => setShowGovernment((p) => !p), icon: "M3 22V9l9-7 9 7v13H3zM9 14h6v8H9z",                   shortcut: "G" },
              ].map(({ key, label, color, val, set, icon, shortcut }) => (
                <Pill key={key} active={val} color={color} onClick={set} title={`Toggle ${label} overlay (press ${shortcut})`} style={{ justifyContent: "center", width: "100%" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d={icon} /></svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                </Pill>
              ))}
            </div>
          </div>

          {/* Row 3b: Hazard fill — only in Hazard view, so it can never paint
              on top of the SVI / Typology choropleth fills. */}
          {mapMode === "hazard" && (
            <>
              <div style={{ height: "0.5px", background: C.divider, margin: "0 -2px" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Hazard</span>
                <div style={{ display: "flex", flexWrap: "nowrap", gap: 4 }}>
                  {[
                    { key: "flood",     label: "Flood",     color: "#dc2626", val: showFlood,     set: () => setShowFlood((p) => !p),     icon: "M12 2c4 5 7 8.5 7 12a7 7 0 1 1-14 0c0-3.5 3-7 7-12z", shortcut: "F" },
                    { key: "landslide", label: "Landslide", color: "#991b1b", val: showLandslide, set: () => setShowLandslide((p) => !p), icon: "M3 20l6-11 4 6 3-4 5 9H3z",                           shortcut: "L" },
                  ].map(({ key, label, color, val, set, icon, shortcut }) => (
                    <Pill key={key} active={val} color={color} onClick={set} title={`Toggle ${label} overlay (press ${shortcut})`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
                      {label}
                    </Pill>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Row 4: one filter section for whatever the household dots are
              colored by. Same chip, same 2-column grid and the same "shown"
              count in every mode, so switching Hazard / Distance / Typology
              never changes how the controls look. */}
          {layers.dotmap && dotColorBy !== "plain" && !dotLoading && overlayDots.length > 0 && (() => {
            const items = dotColorBy === "hazard"
              ? HOUSEHOLD_LEGEND_ITEMS.filter((i) => i.category != null).map((i) => ({ key: i.category, color: i.color, label: i.label }))
              : dotColorBy === "distance"
              ? DISTANCE_TIERS.map((t) => ({ key: t.key, color: t.color, label: t.label, short: t.short }))
              : TYPOLOGY_LEGEND_ITEMS.map((t) => ({ key: t.clusterId, color: t.color, label: t.label, short: t.short }));
            const toggle = dotColorBy === "hazard" ? toggleDotFilter
              : dotColorBy === "distance" ? (k) => setDistanceFilters((p) => ({ ...p, [k]: !p[k] }))
              : toggleTypologyDotFilter;
            const title = dotColorBy === "hazard" ? "Filter · hazard exposure"
              : dotColorBy === "distance" ? "Filter · distance" : "Filter · typology";
            return (
              <>
                <div style={{ height: "0.5px", background: C.divider, margin: "0 -2px" }} />
                <FilterSection title={title} count={shownDotCount}>
                  {items.map((it) => (
                    <FilterChip key={String(it.key)} active={overlayFilters[it.key] !== false} color={it.color}
                      label={it.short || it.label} title={`${it.label} · ${(overlayCounts[it.key] || 0).toLocaleString()} households`} onClick={() => toggle(it.key)} />
                  ))}
                </FilterSection>
                {dotColorBy === "hazard" && (
                  <button onClick={() => setHighlightVeryHigh(v => !v)} className="map-chip" role="switch" aria-checked={highlightVeryHigh}
                    title="Pulsing highlight on households in the Very High band"
                    style={{ display: "flex", alignItems: "center", gap: 8, height: 26, padding: "0 8px", borderRadius: 6, cursor: "pointer",
                      fontSize: 11, color: C.textPrimary, background: C.tbBtnBg, border: `0.5px solid ${C.tbBtnBorder}`, outline: "none" }}>
                    <span style={{ position: "relative", width: 24, height: 14, borderRadius: 7, flexShrink: 0, transition: "background .15s",
                      background: highlightVeryHigh ? HZC["Very High"] : (dark ? "rgba(148,163,184,0.3)" : "#cbd5e1") }}>
                      <span style={{ position: "absolute", top: 2, left: highlightVeryHigh ? 12 : 2, width: 10, height: 10, borderRadius: "50%",
                        background: "#fff", transition: "left .15s cubic-bezier(0.23,1,0.32,1)" }} />
                    </span>
                    Highlight Very High households
                  </button>
                )}
                {mapMode === "hazard" && dotColorBy === "hazard" && (
                  <>
                    <div style={{ height: "0.5px", background: C.divider, margin: "0 -2px" }} />
                    <FilterSection title="Show only these typologies"
                      count={hazardClusterBreakdown ? hazardClusterBreakdown.total : null}>
                      {TYPOLOGY_LEGEND_ITEMS.map(({ clusterId, color, label, short }) => (
                        <FilterChip key={clusterId} active={hazardClusterFilter[clusterId] !== false} color={color}
                          label={short} title={label} onClick={() => toggleHazardClusterFilter(clusterId)} />
                      ))}
                    </FilterSection>
                    {hazardClusterBreakdown && (
                      <div style={{ fontSize: 10.5, color: C.textMuted, lineHeight: 1.6 }}>
                        Of these:{" "}
                        {HOUSEHOLD_LEGEND_ITEMS.filter(({ category }) => category != null).map(({ category, label }, i) => (
                          <span key={category}>{i ? " · " : ""}{label} <b style={{ color: C.textPrimary, fontWeight: 600 }}>{(hazardClusterBreakdown.counts[category] ?? 0).toLocaleString()}</b></span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </div>

        {/* ─── RANKINGS card — full barangay ranking lists, moved out of the
            floating map legend so the legend stays short. Mode-specific,
            same content and sort order as before, just relocated. ── */}
        {mapMode === "svi" && !domainLoading && !domainError && domainStats.length > 0 && (
          <div style={{ ...panelStyle, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              Barangay ranking — most to least vulnerable
            </span>
            <div>
              {[...domainStats]
                .sort((a, b) => (a.svi_rank ?? 999) - (b.svi_rank ?? 999))
                .map((b) => (
                  <div key={b.psgc_10d ?? b.barangay} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                  }}>
                    <span style={{
                      width: 20, flexShrink: 0, fontSize: 10.5, fontWeight: 700,
                      color: C.textMuted, fontFamily: "monospace", textAlign: "right",
                    }}>
                      #{b.svi_rank}
                    </span>
                    <div style={{
                      width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                      background: getSviColorByRank(b.svi_rank),
                      border: "0.5px solid rgba(0,0,0,0.15)",
                    }} />
                    <span style={{
                      flex: 1, fontSize: 11.5, color: C.textPrimary, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {b.barangay}
                    </span>
                    <span style={{ fontSize: 10.5, color: C.textMuted, fontFamily: "monospace" }}>
                      {b.svi_score?.toFixed(1)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {mapMode === "capacity" && !capacityDistanceLoading && !capacityDistanceError && capacityDistanceStats.length > 0 && (
          <div style={{ ...panelStyle, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              Barangay ranking — best to least equipped
            </span>
            <div>
              {[...capacityDistanceStats]
                .sort((a, b) => (a.capacity_rank ?? 999) - (b.capacity_rank ?? 999))
                .map((b) => (
                  <div key={b.psgc_10d ?? b.barangay} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                  }}>
                    <span style={{
                      width: 20, flexShrink: 0, fontSize: 10.5, fontWeight: 700,
                      color: C.textMuted, fontFamily: "monospace", textAlign: "right",
                    }}>
                      #{b.capacity_rank}
                    </span>
                    <div style={{
                      width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                      background: capacityColorByRank(b.capacity_rank),
                    }} />
                    <span style={{
                      flex: 1, fontSize: 11.5, color: C.textPrimary, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {b.barangay}
                    </span>
                    <span style={{ fontSize: 10.5, color: C.textMuted, fontFamily: "monospace" }}>
                      {b.capacity_score?.toFixed(1)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {mapMode === "hazard" && showFacilityAccess && distanceByBarangay.rows.length > 0 && (() => {
          const T = distanceByBarangay.total;
          const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
          const rows = showAllDistance ? distanceByBarangay.rows : distanceByBarangay.rows.slice(0, 8);
          const seg = (n, d, color, extra) => (n ? <div style={{ width: `${(n / d) * 100}%`, background: color, ...extra }} /> : null);
          return (
            <div style={{ ...panelStyle, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Distance to help · 2 km
              </span>
              {/* Municipality summary: three plain numbers */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
                {DISTANCE_TIERS.map((t) => {
                  const n = t.key === "Beyond both" ? T.both : t.key === "Beyond one" ? T.one : T.within;
                  return (
                    <div key={t.key} style={{ padding: "7px 8px", borderRadius: 8, background: C.tbBtnBg, border: `0.5px solid ${C.tbBtnBorder}`, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.color, border: `1px solid ${PLAIN_DOT.stroke}`, flexShrink: 0 }} />
                        <span style={{ fontSize: 16, fontWeight: 800, color: C.textPrimary, fontVariantNumeric: "tabular-nums" }}>{pct(n, T.total)}%</span>
                      </div>
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, lineHeight: 1.3 }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: C.textSecondary, fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()} HH</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textPrimary, marginTop: 2 }}>Barangays farthest from help</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {rows.map((r) => (
                  <button key={r.key} onClick={() => setFocusBrgy(focusBrgy === r.key ? null : r.key)}
                    title={`${r.label}: ${r.both} beyond both, ${r.one} beyond one, ${r.within} within 2 km of both (of ${r.total} households). Click to show only this barangay.`}
                    style={{ display: "flex", flexDirection: "column", gap: 3, padding: "3px 4px", margin: "0 -4px", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left",
                      background: focusBrgy === r.key ? `${C.tbActiveBorder}18` : "transparent" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, width: "100%" }}>
                      <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: focusBrgy === r.key ? 700 : 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                      <span style={{ fontSize: 11, color: C.textSecondary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        <b style={{ color: C.textPrimary }}>{pct(r.both + r.one, r.total)}%</b> beyond 2 km
                      </span>
                    </div>
                    <div style={{ display: "flex", height: 8, width: "100%", borderRadius: 4, overflow: "hidden", background: C.tbBtnBg, border: `0.5px solid ${C.tbBtnBorder}` }}>
                      {seg(r.both, r.total, DISTANCE_COLOR["Beyond both"])}
                      {seg(r.one, r.total, DISTANCE_COLOR["Beyond one"])}
                      {seg(r.within, r.total, DISTANCE_COLOR["Within 2 km"])}
                    </div>
                  </button>
                ))}
              </div>
              {distanceByBarangay.rows.length > 8 && (
                <button onClick={() => setShowAllDistance((v) => !v)} className="pill-btn" style={{
                  height: 26, borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
                  border: `0.5px solid ${C.tbBtnBorder}`, background: C.tbBtnBg, color: C.tbBtnText, outline: "none" }}>
                  {showAllDistance ? "Show top 8" : `Show all ${distanceByBarangay.rows.length} barangays`}
                </button>
              )}
              <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.5 }}>
                Bar = the barangay's households: dark beyond 2 km of both, blue beyond one, light within 2 km of both. Click a barangay to show only it.
              </div>
            </div>
          );
        })()}

      </div>
      {/* ── /Scrollable region ── */}

        {/* ── Household preview card — pinned below the scrollable region so it's
            always fully visible (including the "View Full Profile" button) even
            when overlays/population filters make the legend above it tall ── */}
        {selectedDotHH && (() => {
          const isLoading = dotPreview.loading;
          const isError   = !!dotPreview.error;
          const d = dotPreview.data;
          const hh = d?.household;
          // Three-domain household view (the retired BVI / resilience
          // scores from tbl_vulnerability_index are no longer shown).
          const hzScore = hh?.hazard_exposure_score != null ? Number(hh.hazard_exposure_score) : null;
          const vColor = getHazardExposureColor(hzScore);
          const pwds    = d?.members?.filter(m => m.is_pwd).length || 0;
          const seniors = d?.members?.filter(m => (parseFloat(m.age) || 0) >= 60).length || 0;
          const matchedDot = computedDots.find((cd) => cd.householdId === selectedDotHH);
          const healthDistKm = matchedDot?.nearestHealthcareKm;
          const healthName = matchedDot?.nearestHealthcareName;
          const hhLat = parseFloat(hh?.latitude), hhLng = parseFloat(hh?.longitude);
          const hasPos = Number.isFinite(hhLat) && Number.isFinite(hhLng);
          const rhuKm  = hasPos ? haversineKm(hhLat, hhLng, RHU_POINT[0], RHU_POINT[1]) : null;
          const fireKm = hasPos ? haversineKm(hhLat, hhLng, FIRE_POINT[0], FIRE_POINT[1]) : null;
          const no = (v) => ["no", "false", "0"].includes(String(v ?? "").trim().toLowerCase());
          const floodC = HZT[hh?.flood_exposure] || HZT["No Exposure"];
          const slideC = HZT[hh?.landslide_exposure] || HZT["No Exposure"];

          return (
            <div ref={householdCardRef} style={{ ...panelStyle, pointerEvents: "auto", flexShrink: 0, maxHeight: "60vh", overflowY: "auto", animation: "cardIn 0.2s cubic-bezier(0.34,1.4,0.64,1)" }}>
              <div style={{
                padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
                borderBottom: `0.5px solid ${C.divider}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <div style={{ width: 3, height: 20, borderRadius: 2, background: vColor, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d ? d.household.household_number : "Household"}
                  </span>
                </div>
                <button onClick={() => { setSelectedDotHH(null); setShowFullModal(false); setHighlightPos(null); }} style={{
                  width: 22, height: 22, borderRadius: "50%", cursor: "pointer", flexShrink: 0,
                  border: `0.5px solid ${C.panelBorder}`,
                  background: dark ? "rgba(30,40,70,0.6)" : "rgba(239,246,255,0.8)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: C.textMuted, fontSize: 12, fontWeight: 700,
                }}>✕</button>
              </div>

              {isLoading && (
                <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: C.textMuted }}>Loading...</div>
              )}
              {isError && (
                <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "#ef4444" }}>{dotPreview.error}</div>
              )}

              {d && hh && (
                <>
                  <div style={{ padding: "10px 14px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: C.metricBg, border: `0.5px solid ${C.metricBorder}`, borderTop: `2px solid ${floodC}`, borderRadius: 8, padding: "9px 10px" }}>
                      <div style={{ fontSize: 9, color: C.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Flood</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: floodC, lineHeight: 1.1 }}>{hh.flood_exposure || "Not mapped"}</div>
                    </div>
                    <div style={{ background: C.metricBg, border: `0.5px solid ${C.metricBorder}`, borderTop: `2px solid ${slideC}`, borderRadius: 8, padding: "9px 10px" }}>
                      <div style={{ fontSize: 9, color: C.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Landslide</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: slideC, lineHeight: 1.1 }}>{hh.landslide_exposure || "Not mapped"}</div>
                    </div>
                  </div>

                  <div style={{ padding: "10px 14px", fontSize: 11, color: C.textSecondary, lineHeight: 1.9 }}>
                    <div><strong style={{ color: C.textPrimary }}>Barangay:</strong> {hh.barangay_name}</div>
                    <div><strong style={{ color: C.textPrimary }}>Members:</strong> {d.members.length} ({pwds} PWD, {seniors} senior)</div>
                    <div>
                      <strong style={{ color: C.textPrimary }}>Distance to help:</strong>{" "}
                      {rhuKm != null ? (
                        <>
                          <span style={{ color: rhuKm > 2 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>RHU {rhuKm.toFixed(1)} km</span>
                          {" · "}
                          <span style={{ color: fireKm > 2 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>Fire {fireKm.toFixed(1)} km</span>
                        </>
                      ) : "—"}
                    </div>
                    <div>
                      <strong style={{ color: C.textPrimary }}>Knows:</strong>{" "}
                      evacuation site {no(hh?.knows_evacuation_location) ? "✗" : "✓"} · hotline {no(hh?.knows_emergency_hotline) ? "✗" : "✓"}
                    </div>
                    <div><strong style={{ color: C.textPrimary }}>Profile:</strong> {hh.typology_cluster_label || "—"}</div>
                    {healthDistKm != null && (
                      <div>
                        <strong style={{ color: C.textPrimary }}>Nearest healthcare:</strong>{" "}
                        <span style={{ color: healthDistKm > 2 ? "#ef4444" : healthDistKm > 1 ? "#f59e0b" : "#22c55e", fontWeight: 700 }}>
                          {healthDistKm.toFixed(2)} km
                        </span>
                        {healthName && <span style={{ color: C.textMuted }}> ({healthName})</span>}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: "0 14px 14px" }}>
                    <button onClick={() => setShowFullModal(true)} style={{
                      width: "100%", padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                      fontSize: 12, fontWeight: 700, border: `0.5px solid ${C.tbActiveBorder}`,
                      background: `${C.tbActiveBorder}18`, color: C.tbActiveText,
                    }}>
                      View Full Profile
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* ── Barangay selection card (SVI / Capacity+Dist) — appears once a
            barangay's boundary is highlighted on click (see
            selectedDomainBarangay / styleFeatureSvi / styleFeatureCapacity
            above). Same pinned-card pattern as the household preview card
            above: highlight first, details on demand via this card's own
            button, never straight into the modal from a map click. ── */}
        {selectedDomainBarangay && (mapMode === "svi" || mapMode === "capacity") && (() => {
          const b = selectedDomainBarangay;
          const isSvi = mapMode === "svi";
          const accent = isSvi ? getSviColorByRank(b.svi_rank) : capacityColorByRank(b.capacity_rank);
          return (
            <div style={{ ...panelStyle, pointerEvents: "auto", flexShrink: 0, animation: "cardIn 0.2s cubic-bezier(0.34,1.4,0.64,1)" }}>
              <div style={{
                padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
                borderBottom: `0.5px solid ${C.divider}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <div style={{ width: 3, height: 20, borderRadius: 2, background: accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.barangay}
                  </span>
                </div>
                <button onClick={() => setSelectedDomainBarangay(null)} style={{
                  width: 22, height: 22, borderRadius: "50%", cursor: "pointer", flexShrink: 0,
                  border: `0.5px solid ${C.panelBorder}`,
                  background: dark ? "rgba(30,40,70,0.6)" : "rgba(239,246,255,0.8)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: C.textMuted, fontSize: 12, fontWeight: 700,
                }}>✕</button>
              </div>

              <div style={{ padding: "10px 14px 0", fontSize: 11, color: C.textSecondary, lineHeight: 1.9 }}>
                {isSvi ? (
                  <>
                    <div><strong style={{ color: C.textPrimary }}>SVI:</strong> {b.svi_score?.toFixed(1)} (rank #{b.svi_rank} of 24)</div>
                    <div><strong style={{ color: C.textPrimary }}>Tier:</strong> {sviCategoryFromRank(b.svi_rank)} · {b.households?.toLocaleString?.() ?? "—"} households</div>
                    {b.access && b.access.rhu_pct_beyond != null && (
                      <div><strong style={{ color: C.textPrimary }}>Beyond 2 km:</strong> RHU {b.access.rhu_pct_beyond}% · Fire Station {b.access.fire_pct_beyond}% of households</div>
                    )}
                  </>
                ) : (
                  <>
                    <div><strong style={{ color: C.textPrimary }}>Capacity:</strong> {b.capacity_score?.toFixed(1)} / 100 (rank #{b.capacity_rank} of 24)</div>
                    <div><strong style={{ color: C.textPrimary }}>Tier:</strong> {capacityTierFromRank(b.capacity_rank)}</div>
                    <div>
                      <strong style={{ color: C.textPrimary }}>On record:</strong>{" "}
                      {(b.readiness || []).map((r) => `${r.label} ${r.has ? "✓" : "✗"}`).join(" · ")}
                      {" · "}{(b.schools || []).length} school{(b.schools || []).length === 1 ? "" : "s"}
                      {" · "}{(b.evacuation_centers || []).length} evacuation centre{(b.evacuation_centers || []).length === 1 ? "" : "s"}
                    </div>
                  </>
                )}
              </div>

              <div style={{ padding: "10px 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                {focusBrgy !== normalizeName(b.barangay) && (
                  <button
                    onClick={() => { setFocusBrgy(normalizeName(b.barangay)); setSelectedDomainBarangay(null); }}
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                      fontSize: 12, fontWeight: 600, border: `0.5px solid ${C.tbBtnBorder}`,
                      background: C.tbBtnBg, color: C.tbBtnText,
                    }}>
                    Show only this barangay
                  </button>
                )}
                <button
                  onClick={() => (isSvi ? setDomainExplainId(b.psgc_10d) : setCapDistExplainId(b.psgc_10d))}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                    fontSize: 12, fontWeight: 700, border: `0.5px solid ${C.tbActiveBorder}`,
                    background: `${C.tbActiveBorder}18`, color: C.tbActiveText,
                  }}>
                  View calculations
                </button>
              </div>
            </div>
          );
        })()}
      </div>
      </div>

      {/* Barangay Stage 1 "How was this calculated?" panel */}
      {explainBarangayId != null && (
        <BarangayExplainModal
          key={explainBarangayId}
          barangayId={explainBarangayId}
          dark={dark}
          onClose={() => setExplainBarangayId(null)}
        />
      )}

      {/* Official SVI model "How was this calculated?" panel */}
      {domainExplainId != null && (
        <DomainExplainModal
          key={domainExplainId}
          psgcId={domainExplainId}
          dark={dark}
          mode={mapMode}
          onClose={() => setDomainExplainId(null)}
        />
      )}

      {/* Barangay Capacity "How was this calculated?" panel */}
      {capDistExplainId != null && (
        <CapacityExplainModal
          key={capDistExplainId}
          row={capacityDistanceStats.find((r) => r.psgc_10d === capDistExplainId)}
          dark={dark}
          onClose={() => setCapDistExplainId(null)}
        />
      )}

      {/* Full household detail modal — opened via "View Full Profile" in the sidebar card */}
      {showFullModal && selectedDotHH && (
        <HouseholdDetailModal
          key={selectedDotHH}
          householdId={selectedDotHH}
          onClose={() => setShowFullModal(false)}
          nearestHealthcareKm={computedDots.find((cd) => cd.householdId === selectedDotHH)?.nearestHealthcareKm ?? null}
          nearestHealthcareName={computedDots.find((cd) => cd.householdId === selectedDotHH)?.nearestHealthcareName ?? null}
        />
      )}
    </div>
  );
}