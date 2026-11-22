// ============================================================
// domainColors.js -- one colour system for the whole app.
//
// Social vulnerability (SVI) reads like a traffic light:
//   red = most vulnerable -> orange -> amber -> green = least vulnerable.
// Barangay capacity uses the same "red = worse, green = better" logic
// (see capacity/capacityShared.js), so a red barangay always needs
// attention, whichever domain you are looking at.
// Household typology is a description, not a risk level, so its five
// profiles use cool, non-traffic-light colours (teal, sky, indigo,
// purple, pink) that can never be mistaken for a vulnerability tier.
// ============================================================

export const SVI_TIER_ORDER = ["High", "Moderate-high", "Moderate-low", "Low"];
export const SVI_TIER_COLORS = {
  "High":          "#dc2626", // rank 1–6, most socially vulnerable
  "Moderate-high": "#f97316", // rank 7–12
  "Moderate-low":  "#f59e0b", // rank 13–18
  "Low":           "#16a34a", // rank 19–24, least vulnerable
  "No Data":       "#9ca3af",
};
// Darker shades of the same four colours, for text and pill labels on a
// white background (amber/orange text is hard to read otherwise).
export const SVI_TIER_TEXT = {
  "High": "#b91c1c", "Moderate-high": "#c2410c", "Moderate-low": "#b45309", "Low": "#15803d", "No Data": "#6b7280",
};
export const SVI_TIER_RANGES = { "High": "Rank 1–6", "Moderate-high": "Rank 7–12", "Moderate-low": "Rank 13–18", "Low": "Rank 19–24" };

export function sviTier(rank) {
  if (rank == null) return null;
  if (rank <= 6) return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}
export const sviTierColor = (rank) => SVI_TIER_COLORS[sviTier(rank) || "No Data"];

// Continuous shade per rank for map fills, so barangays in the same tier
// still differ slightly: red (rank 1) -> orange -> amber -> green (rank 24).
const STOPS = [
  [0,    [220, 38, 38]],   // #dc2626
  [0.36, [249, 115, 22]],  // #f97316
  [0.64, [245, 158, 11]],  // #f59e0b
  [1,    [22, 163, 74]],   // #16a34a
];
export function sviColorByRank(rank) {
  if (rank == null) return "#d1d5db";
  const t = (Math.min(24, Math.max(1, rank)) - 1) / 23;
  let i = 0;
  while (i < STOPS.length - 2 && t > STOPS[i + 1][0]) i++;
  const [t0, a] = STOPS[i], [t1, b] = STOPS[i + 1];
  const u = (t - t0) / (t1 - t0);
  const c = (k) => Math.round(a[k] + (b[k] - a[k]) * u);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
export const SVI_GRADIENT = "linear-gradient(90deg, #dc2626, #f97316 36%, #f59e0b 64%, #16a34a)";
export const SVI_LEGEND = SVI_TIER_ORDER.map((t) => ({ color: SVI_TIER_COLORS[t], label: t, range: SVI_TIER_RANGES[t], category: t }));

// ── Household typology (k-modes, k = 5) ──────────────────────────────
export const TYPOLOGY_COLORS = {
  1: "#0d9488", // Relatively stable                         -- teal
  0: "#0ea5e9", // Food-insecure, otherwise stable           -- sky
  3: "#4f46e5", // Financially excluded / structurally insecure -- indigo
  2: "#9333ea", // Senior-headed, education gaps             -- purple
  4: "#db2777", // Compounded deprivation                    -- pink
};
export const TYPOLOGY_LABELS = {
  0: "Food-insecure, otherwise stable",
  1: "Relatively stable",
  2: "Senior-headed, education gaps",
  3: "Financially excluded / structurally insecure",
  4: "Compounded deprivation",
};
export const TYPOLOGY_COLOR_BY_LABEL = Object.fromEntries(
  Object.entries(TYPOLOGY_LABELS).map(([id, label]) => [label, TYPOLOGY_COLORS[id]])
);
export function typologyColor(clusterId) {
  if (clusterId == null || clusterId === "") return "#9ca3af";
  return TYPOLOGY_COLORS[clusterId] || "#9ca3af";
}
// Short names for tight spaces (filter chips); the full name shows on hover.
export const TYPOLOGY_SHORT = { 0: "Food-insecure", 1: "Stable", 2: "Senior-headed", 3: "Fin. excluded", 4: "Compounded" };
export const TYPOLOGY_LEGEND = [1, 0, 3, 2, 4].map((id) => ({ clusterId: id, color: TYPOLOGY_COLORS[id], label: TYPOLOGY_LABELS[id], short: TYPOLOGY_SHORT[id] }));

// ── Household dots on the map ─────────────────────────────────────────
// Dots sit on top of the red -> green SVI / capacity fills, so their own
// scales must never reuse the "safe = green" end of it.
// Hazard exposure: one warm sequential ramp (darker = worse); no exposure
// is neutral grey, not "good" green.
export const HAZARD_EXPOSURE_ORDER = ["Very High", "High", "Moderate", "Low", "No Exposure"];
export const HAZARD_EXPOSURE_COLORS = {
  "Very High":   "#7f1d1d",
  "High":        "#dc2626",
  "Moderate":    "#f97316",
  "Low":         "#facc15",
  "No Exposure": "#94a3b8",
};
// Distance to the RHU / Fire Station: a blue scale (darker = farther), so
// it reads clearly on top of any red -> green barangay fill.
export const DISTANCE_COLORS = {
  "Beyond both": "#1e3a8a",
  "Beyond one":  "#3b82f6",
  "Within 2 km": "#bae6fd",
};
// Plain household location: white dot with a navy ring.
export const PLAIN_DOT = { fill: "#ffffff", stroke: "#1e3a8a" };
// Darker versions for text on white cards (yellow text is unreadable).
export const HAZARD_EXPOSURE_TEXT = {
  "Very High": "#7f1d1d", "High": "#b91c1c", "Moderate": "#c2410c", "Low": "#a16207", "No Exposure": "#64748b",
};

// One fixed colour per DOMAIN (which domain), separate from the tier /
// severity colours above (how bad). Used where the three domains are
// drawn side by side, e.g. the Planning map's three-colour outline, so
// each third of the line is always recognisable. Same as Ask the Data.
export const DOMAIN_IDENTITY = { svi: "#7c3aed", capacity: "#ea580c", hazard: "#0891b2" };
