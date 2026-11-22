// ============================================================
// capacityShared.js -- Barangay Capacity (resources and readiness)
//
// Capacity = what the barangay HAS to respond: its DRRM organisation,
// equipment and budget. Scored with the study's own capacity method
// (backend/sanmiguel_student/capacity.py): each indicator becomes a 0-100
// percentile across the 24 barangays and the score is their average.
// Rank 1 = best equipped. Distance is not part of capacity -- it is
// household vulnerability and is shown on the vulnerability side.
// The DRRM plan / evacuation map / hazard map checks, evacuation centres
// and schools are listed with the score, never added to it.
// ============================================================
import { getDomainCapacity } from "../../api/api";

// Green (well equipped) -> orange -> red (least equipped).
const GOOD = { r: 22, g: 163, b: 74 };   // #16a34a
const MID  = { r: 245, g: 158, b: 11 };  // #f59e0b
const BAD  = { r: 220, g: 38,  b: 38 };  // #dc2626

export function capacityColorByRank(rank) {
  if (rank == null) return "#d1d5db";
  const t = (Math.min(24, Math.max(1, rank)) - 1) / 23;
  const [a, b, u] = t <= 0.5 ? [GOOD, MID, t / 0.5] : [MID, BAD, (t - 0.5) / 0.5];
  const c = (k) => Math.round(a[k] + (b[k] - a[k]) * u);
  return `rgb(${c("r")}, ${c("g")}, ${c("b")})`;
}

export function capacityTierFromRank(rank) {
  if (rank == null) return "No data";
  if (rank <= 6) return "High capacity";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low capacity";
}

export const CAPACITY_TIER_LEGEND = [
  { rank: 3,  label: "High capacity", range: "Rank 1–6" },
  { rank: 9,  label: "Moderate-high", range: "Rank 7–12" },
  { rank: 15, label: "Moderate-low",  range: "Rank 13–18" },
  { rank: 21, label: "Low capacity",  range: "Rank 19–24" },
].map((i) => ({ ...i, color: capacityColorByRank(i.rank) }));

export function formatCapacityValue(ind) {
  const v = ind?.value;
  if (v == null) return "—";
  if (ind.kind === "yes/no") return Number(v) ? "Yes" : "No";
  if (ind.kind === "pesos") return `₱${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return Number(v).toLocaleString();
}

let _cache = null;
export function loadCapacity() {
  if (!_cache) {
    _cache = getDomainCapacity()
      .then((r) => r.data || { data: [] })
      .catch((e) => { _cache = null; throw e; });
  }
  return _cache;
}

// Gap view for planning/report logic: capacity_gap_rank 1 = least equipped,
// so "worst first" ordering and priority flags read the same as SVI. The
// rank shown to readers is always the real capacity_rank (1 = best).
export function capacityGapRank(row, allRows) {
  if (!row || row.capacity_score == null || row.capacity_rank == null) return null;
  return 1 + allRows.filter((x) => x.capacity_score != null && x.capacity_score < row.capacity_score).length;
}
export const CAP_GAP_TIER_COLORS = { "High": "#dc2626", "Moderate-high": "#f97316", "Moderate-low": "#84cc16", "Low": "#16a34a", "No Data": "#aaaaaa" };
export const CAP_GAP_TIER_LABEL = { "High": "Low capacity", "Moderate-high": "Moderate-low", "Moderate-low": "Moderate-high", "Low": "High capacity", "No Data": "No Data" };
export const CAP_GAP_TIER_RANGES = { "High": "Rank 19–24", "Moderate-high": "Rank 13–18", "Moderate-low": "Rank 7–12", "Low": "Rank 1–6" };

// Resource / readiness gaps of one barangay (from its /capacity row).
export function capacityGapFields(cd) {
  if (!cd) return {};
  const ind = Object.fromEntries((cd.indicators || []).map((i) => [i.key, i.value]));
  const has = Object.fromEntries((cd.readiness || []).map((r) => [r.key, r.has]));
  const none = (k) => ind[k] != null && Number(ind[k]) === 0;
  return {
    no_drrm_plan: has.f01_disaster_plan === false,
    no_evacuation_map: has.f09_evacuation_map_presence === false,
    no_hazard_map: has.f11_hazard_map_presence === false,
    no_hotline: none("f04_disaster_hotline_presence"),
    no_response_team: none("f03_disaster_response"),
    no_seminar: none("f13_conduct_seminars"),
    no_first_aid: none("f16_a_first_aid_kits"),
    no_ambulance: none("f16_c_ambulance"),
    no_radio: none("f16_g_radio"),
    no_generator: none("f16_h_generator"),
    no_lights: none("f16_i_emergency_lights"),
    no_drrm_budget: none("f17_drrm_expenditures"),
    schools_count: (cd.schools || []).length,
    evac_centers_count: (cd.evacuation_centers || []).length,
  };
}
export const CAPACITY_GAP_ITEMS = [
  { key: "no_drrm_plan",      label: "Barangay DRRM plan",       action: "formulate a BDRRM plan" },
  { key: "no_hotline",        label: "Emergency hotline",        action: "set up an emergency hotline" },
  { key: "no_response_team",  label: "Emergency response team",  action: "organise a barangay response team" },
  { key: "no_evacuation_map", label: "Evacuation map",           action: "produce an evacuation map" },
  { key: "no_hazard_map",     label: "Hazard map",               action: "produce a hazard map" },
  { key: "no_seminar",        label: "Preparedness seminar",     action: "hold a preparedness seminar" },
  { key: "no_ambulance",      label: "Ambulance",                action: "arrange an ambulance or patient transport" },
  { key: "no_first_aid",      label: "First-aid kits",           action: "stock first-aid kits" },
  { key: "no_radio",          label: "Two-way radios",           action: "provide two-way radios" },
  { key: "no_generator",      label: "Generator",                action: "provide a portable/solar generator" },
  { key: "no_lights",         label: "Emergency lights",         action: "provide emergency lights / flashlights" },
  { key: "no_drrm_budget",    label: "DRRM spending",            action: "allocate DRRM funds" },
];
