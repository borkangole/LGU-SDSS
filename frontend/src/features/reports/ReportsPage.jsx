import { useState, useEffect, useRef } from "react";
import { capacityGapFields } from "../capacity/capacityShared";
import { OFFICIAL_BARANGAY_NAME } from "../shared/barangays";
import { domainPack, generateInsights as planInsights, priorityInfo as planPriority } from "../planning/BarangayPlanning";
import { buildPlanningReport } from "../planning/planningReport";
import systemLogo from "../../assets/logo.png";
import { getVulnBarangaySummary, getVulnBarangayStage1, getDomainBarangays, getDomainCapacity, getHouseholds, getStats, getGISBarangays, getHighRiskHouseholds, getGISFlood, getGISLandslide } from '../../api/api';
import { useTheme } from "../../hooks/useTheme";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip as LTooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import jsPDF from "jspdf";
import { renderVulnerabilityMapCanvas } from "../../utils/renderVulnerabilityMap";
import { SVI_TIER_COLORS as SHARED_SVI_TIER_COLORS, HAZARD_EXPOSURE_COLORS as HZ_DOT_COLORS } from "../shared/domainColors";
import CustomPopulationReport from "./CustomPopulationReport";
import TypologyReportTab, { TypologyOverallSection, typologyPrintSection } from "./TypologyReport";
import { useUrlParam } from "../../hooks/useRoute";

const toNum = (v) => parseFloat(v) || 0;

// NOTE: These are an approximate fallback for HOUSEHOLD-level scores only, since
// the household quantile breaks (tbl_vuln_classification_breaks) aren't exposed
// to this page yet. Do NOT use these for barangay-level values — barangay Stage 1
// classification is quantile-based (equal quartiles) and computed server-side;
// use stage1Color()/stage1Label() below instead, same as Dashboard.jsx.
function vulnColor(s)  { if (s > 3.0) return "#7b1fa2"; if (s > 2.0) return "#d32f2f"; if (s > 1.0) return "#f57c00"; return "#388e3c"; }
function vulnLabel(s)  { if (s > 3.0) return "Very High"; if (s > 2.0) return "High"; if (s > 1.0) return "Moderate"; if (s > 0) return "Low"; return "No Data"; }

// Barangay Stage 1 (top-down) classification — server-computed category, quantile
// based (equal quartiles across the 24 barangays). Mirrors Dashboard.jsx exactly.
const STAGE1_COLORS = { "Very High": "#7b1fa2", "High": "#b71c1c", "Moderate": "#f57c00", "Low": "#388e3c" };
function stage1Color(category) { return STAGE1_COLORS[category] || "#aaaaaa"; }
function stage1Label(category) { return category && STAGE1_COLORS[category] ? category : "No Data"; }
function resilColor(s) { if (!s||s===0) return "#aaa"; if (s>=0.75) return "#1565c0"; if (s>=0.50) return "#388e3c"; if (s>=0.25) return "#f57c00"; return "#d32f2f"; }
function resilLabel(s) { if (!s||s===0) return "No Data"; if (s>=0.75) return "High"; if (s>=0.50) return "Moderate"; if (s>=0.25) return "Low"; return "Very Low"; }

// ─────────────────────────────────────────────────────────────────────────
// Sir Shem's two-domain model (SVI + Capacity/Hazard) -- replaces the
// retired single BVI/Stage-1/Resilience framework above. The old helpers
// stay in place (unchanged) until every report tab below has been
// migrated off them; new tabs use these instead. See thesis-system-handoff.md
// §3 for the exact formulas and §4.2 for the color conventions this
// mirrors from Dashboard.jsx/MapView.jsx.
//
// Equal 6-barangay quartile bucketing by RANK POSITION (not score cutoffs)
// -- the app-wide convention for the 24-barangay set (handoff §3.2).
function rankTier(rank) {
  if (rank == null) return "No Data";
  if (rank <= 6)  return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}
// SVI: rank 1 = MOST socially vulnerable -- red -> orange -> amber -> green.
const SVI_TIER_COLORS = SHARED_SVI_TIER_COLORS;
function sviTier(rank)      { return rankTier(rank); }
function sviTierColor(rank) { return SVI_TIER_COLORS[rankTier(rank)]; }

// Barangay Capacity: what the barangay HAS to respond (resources and
// readiness), score 0-100, capacity_rank 1 = best equipped. Internally the
// report logic orders capacity as a GAP (capacity_gap_rank 1 = least
// equipped) so "worst first" lists and the priority flags work the same
// way as SVI; every rank shown to the reader is the real capacity_rank.
// Distance is household vulnerability, not capacity.
const CAPDIST_TIER_COLORS = { "High":"#dc2626", "Moderate-high":"#f97316", "Moderate-low":"#84cc16", "Low":"#16a34a", "No Data":"#aaaaaa" };
const CAP_TIER_LABEL = { "High":"Low capacity", "Moderate-high":"Moderate-low", "Moderate-low":"Moderate-high", "Low":"High capacity", "No Data":"No Data" };
const CAP_TIER_RANGES = { "High":"Rank 19–24", "Moderate-high":"Rank 13–18", "Moderate-low":"Rank 7–12", "Low":"Rank 1–6" };
function capDistTier(gapRank)      { return rankTier(gapRank); }
function capDistTierColor(gapRank) { return CAPDIST_TIER_COLORS[rankTier(gapRank)]; }
function capDistTierLabel(gapRank) { return CAP_TIER_LABEL[rankTier(gapRank)]; }

// Hazard exposure has no barangay-level "rank" in Sir Shem's methodology
// (only a real per-household spatial join + % aggregates, kept flood and
// landslide always separate -- handoff §3.5). So this page shows plain
// exposed-household counts/percentages rather than inventing a ranking; a
// household counts as hazard-exposed if it has a non-null flood_exposure
// OR landslide_exposure label (both are real GIS point-in-polygon results,
// not booleans -- see hazard_engine.py).
function isHazardExposedHH(hh) { return !!(hh?.flood_exposure || hh?.landslide_exposure); }

// "High-risk" for the High-Risk Households report is a STRICTER cut than
// isHazardExposedHH's "any mapped exposure" -- it reuses the exact same
// flood/landslide thresholds Sir Shem's own barangay-level pipeline
// aggregate already treats as the risk-worthy band (see
// hazard_exposure_by_barangay.csv's flood_high_or_very_high_households /
// landslide_moderate_or_high_households columns): flood High or Very High,
// OR landslide Moderate or High. Flood and landslide are still never summed
// into one score -- a household qualifies if EITHER crosses its own
// threshold, and both severities are always shown separately.
function isHighRiskHazardHH(hh) {
  const f = hh?.flood_exposure, l = hh?.landslide_exposure;
  return f === "High" || f === "Very High" || l === "Moderate" || l === "High";
}
const FLOOD_EXPOSURE_COLORS     = { "Very High":"#7f1d1d", "High":"#dc2626", "Moderate":"#f97316", "Low":"#fbbf24" };
const LANDSLIDE_EXPOSURE_COLORS = { "High":"#7f1d1d", "Moderate":"#dc2626", "Low":"#f97316" };
const NO_EXPOSURE_COLOR = "#94a3b8";

// ─── THREE-DOMAIN HELPERS (Overall Report) ───────────────────────────────────
// Same flags/priority/badge logic as features/planning/BarangayPlanning.jsx,
// duplicated here per this codebase's per-file-helper convention, so the
// Planning page and the Overall Report always classify a barangay the same
// way. None of this combines SVI, Capacity and Hazard into one
// number: each domain is read from its own tier/threshold, and the priority
// level is only a count of how many domains are flagged.
const HAZARD_FLAG_PCT = 25;
const FLOOD_COLOR = "#1565c0", LANDSLIDE_COLOR = "#8d6e63";

function domainFlags(b) {
  const sviT = sviTier(b.svi_rank);
  const capT = capDistTier(b.capacity_gap_rank);
  const floodPct = toNum(b.flood_hi_pct), landslidePct = toNum(b.landslide_hi_pct);
  const hazardHigh = floodPct >= HAZARD_FLAG_PCT || landslidePct >= HAZARD_FLAG_PCT;
  const sviBad = sviT === "High" || sviT === "Moderate-high";
  const capBad = capT === "High" || capT === "Moderate-high";
  return { sviT, capT, floodPct, landslidePct, hazardHigh, sviBad, capBad };
}
function priorityInfo(b) {
  const { sviBad, capBad, hazardHigh } = domainFlags(b);
  const badCount = (sviBad?1:0) + (capBad?1:0) + (hazardHigh?1:0);
  if (sviBad && capBad && hazardHigh) return { rank:5, label:"Top Priority",     color:"#7b1fa2" };
  if (badCount >= 2)                  return { rank:4, label:"High Priority",    color:"#dc2626" };
  if (sviBad)                         return { rank:3, label:"Watch — SVI",      color:"#f97316" };
  if (capBad)                         return { rank:3, label:"Watch — Capacity", color:"#c2410c" };
  if (hazardHigh)                     return { rank:2, label:"Watch — Hazard",   color:"#1565c0" };
  return                                     { rank:1, label:"Monitor",          color:"#388e3c" };
}
const PRIORITY_LEVELS = [
  { rank:5, label:"Top Priority",  color:"#7b1fa2", desc:"All 3 domains flagged" },
  { rank:4, label:"High Priority", color:"#dc2626", desc:"2 of 3 domains flagged" },
  { rank:3, label:"Watch",         color:"#f97316", desc:"SVI or Capacity only" },
  { rank:2, label:"Hazard Watch",  color:"#1565c0", desc:"Hazard only" },
  { rank:1, label:"Monitor",       color:"#388e3c", desc:"No domain flagged" },
];

// Per-domain urgency badges -- deliberately different words from the
// cross-domain priority labels above, so a single-domain "Critical" can
// never be read as the barangay-wide verdict.
const SEVERITY_COLOR = { critical:"#dc2626", watch:"#d97706", ok:"#16a34a", none:"#9aa1b2" };
function sviBadge(t) {
  if (t === "High")          return { label:"Critical",        color:SEVERITY_COLOR.critical };
  if (t === "Moderate-high") return { label:"Needs Attention", color:SEVERITY_COLOR.watch };
  if (t === "No Data")       return { label:"No Data",         color:SEVERITY_COLOR.none };
  return                            { label:"Stable",          color:SEVERITY_COLOR.ok };
}
function capBadge(t) {
  if (t === "High")          return { label:"Critical Gap",    color:SEVERITY_COLOR.critical };
  if (t === "Moderate-high") return { label:"Needs Attention", color:SEVERITY_COLOR.watch };
  if (t === "No Data")       return { label:"No Data",         color:SEVERITY_COLOR.none };
  return                            { label:"Adequate",        color:SEVERITY_COLOR.ok };
}
function hazardBadge(floodPct, landslidePct) {
  const worst = Math.max(floodPct, landslidePct);
  if (worst >= HAZARD_FLAG_PCT) return { label:"High Exposure",     color:SEVERITY_COLOR.critical };
  if (worst >= 10)              return { label:"Moderate Exposure", color:SEVERITY_COLOR.watch };
  return                               { label:"Low Exposure",      color:SEVERITY_COLOR.ok };
}

// The 11 SVI indicators (CORE_SOCIAL_LABELS in domain_vulnerability_routes.py),
// each paired with the program type that addresses it -- used to turn a
// barangay's top SVI drivers into a specific recommendation.
const SVI_INDICATORS = {
  food_insecure_prop:         { label:"Food insecurity",            program:"food security / supplementary feeding" },
  weak_wall_prop:             { label:"Weak wall material",         program:"shelter & housing repair assistance" },
  weak_roof_prop:             { label:"Weak roof material",         program:"shelter & housing repair assistance" },
  overcrowding_prop:          { label:"Overcrowding",               program:"housing / shelter support" },
  insecure_tenure_prop:       { label:"Insecure tenure",            program:"land-tenure & resettlement support" },
  unimproved_sanitation_prop: { label:"Unimproved sanitation",      program:"WASH / sanitation facilities" },
  no_internet_prop:           { label:"No internet access",         program:"connectivity & early-warning reach" },
  low_adult_education_prop:   { label:"Low adult education",        program:"adult education & skills training (ALS/TESDA)" },
  pwd_prop:                   { label:"PWD population share",       program:"PWD-targeted welfare & accessible evacuation" },
  senior_prop:                { label:"Senior citizen share",       program:"senior-citizen welfare & assisted evacuation" },
  solo_parent_prop:           { label:"Solo-parent share",          program:"solo-parent support services" },
};

// Percentile rank (0-1, pandas rank(pct=True) "average" method) of every
// barangay on every SVI indicator. SVI itself is a sum of these percentile
// ranks, so a barangay's "top drivers" are the indicators where it ranks
// highest relative to the other barangays -- NOT simply its largest raw
// rate (a rate that is high everywhere, e.g. food insecurity, would
// otherwise top every list without explaining why this barangay ranks
// where it does). The raw rate is still what gets displayed.
function sviPercentiles(stats) {
  const out = new Map(stats.map(b => [b.barangay_name, {}]));
  Object.keys(SVI_INDICATORS).forEach(k => {
    const vals = stats.map(b => b.social_indicators?.[k]).filter(v => v != null);
    const n = vals.length;
    stats.forEach(b => {
      const v = b.social_indicators?.[k];
      if (v == null || !n) return;
      const less = vals.filter(x => x < v).length, eq = vals.filter(x => x === v).length;
      out.get(b.barangay_name)[k] = (less + (eq + 1) / 2) / n;
    });
  });
  return out;
}
function topSviDrivers(b, pctMap, n = 3) {
  const pct = pctMap.get(b.barangay_name) || {};
  return Object.keys(SVI_INDICATORS)
    .filter(k => b.social_indicators?.[k] != null && pct[k] != null)
    .sort((x, y) => (pct[y] - pct[x]) || (b.social_indicators[y] - b.social_indicators[x]))
    .slice(0, n)
    .map(k => ({ key:k, ...SVI_INDICATORS[k], rate:b.social_indicators[k], pct:pct[k] }));
}

// Barangay Capacity gaps, each with the action that closes it. Built from
// the /capacity row: readiness checks and resources the
// barangay reported having none of.
const CAPDIST_INDICATORS = [
  { key:"no_drrm_plan",      label:"No barangay DRRM plan",      action:"formulate a BDRRM plan",               test:b=>b.no_drrm_plan },
  { key:"no_hotline",        label:"No emergency hotline",       action:"set up an emergency hotline",          test:b=>b.no_hotline },
  { key:"no_response_team",  label:"No emergency response team", action:"organise a barangay response team",    test:b=>b.no_response_team },
  { key:"no_evacuation_map", label:"No evacuation map",          action:"produce an evacuation map",            test:b=>b.no_evacuation_map },
  { key:"no_hazard_map",     label:"No hazard map",              action:"produce a hazard map",                 test:b=>b.no_hazard_map },
  { key:"no_seminar",        label:"No preparedness seminar",    action:"hold a preparedness seminar",          test:b=>b.no_seminar },
  { key:"no_ambulance",      label:"No ambulance",               action:"arrange an ambulance or patient transport", test:b=>b.no_ambulance },
  { key:"no_first_aid",      label:"No first-aid kits",          action:"stock first-aid kits",                 test:b=>b.no_first_aid },
  { key:"no_radio",          label:"No two-way radios",          action:"provide two-way radios",               test:b=>b.no_radio },
  { key:"no_generator",      label:"No generator",               action:"provide a portable/solar generator",   test:b=>b.no_generator },
  { key:"no_lights",         label:"No emergency lights",        action:"provide emergency lights / flashlights", test:b=>b.no_lights },
  { key:"no_drrm_budget",    label:"No DRRM spending recorded",  action:"allocate DRRM funds",                  test:b=>b.no_drrm_budget },
];

// Per-domain recommendation text, each built only from that domain's data.
function sviRecommendation(b, pctMap) {
  const { sviBad, sviT } = domainFlags(b);
  if (sviT === "No Data") return "No SVI data.";
  if (!sviBad) return "No urgent social-program intervention; monitor.";
  const programs = [...new Set(topSviDrivers(b, pctMap, 2).map(d => d.program))];
  const far = [];
  if (toNum(b.rhu_pct_beyond) >= 50) far.push("extend health-service reach (BHS / mobile clinic)");
  if (toNum(b.fire_pct_beyond) >= 50) far.push("improve fire-response reach");
  return `Prioritize ${programs.join(" and ")}.${far.length ? ` Most households are far from help: ${far.join("; ")}.` : ""}`;
}
function capRecommendation(b) {
  const { capBad, capT } = domainFlags(b);
  if (capT === "No Data") return "No capacity data.";
  const gaps = CAPDIST_INDICATORS.filter(g => g.test(b));
  if (!gaps.length) return "Resources and readiness adequate.";
  const acts = gaps.slice(0, 3).map(g => g.action).join("; ");
  return capBad ? `Priority: ${acts}.` : `Close remaining gaps: ${acts}.`;
}
function hazardRecommendation(b) {
  const { floodPct, landslidePct } = domainFlags(b);
  const acts = [];
  if (floodPct >= HAZARD_FLAG_PCT)     acts.push("flood early-warning & evacuation planning");
  if (landslidePct >= HAZARD_FLAG_PCT) acts.push("landslide monitoring & pre-emptive evacuation");
  if (acts.length) return `Priority: ${acts.join("; ")}.`;
  if (Math.max(floodPct, landslidePct) >= 10) return "Moderate exposure — keep evacuation plans current.";
  return "Routine hazard monitoring.";
}

// Everything the Overall Report (screen AND print) says, computed once so
// the two can never disagree.
function buildOverallSummary(stats, households) {
  const n = stats.length;
  const pctMap = sviPercentiles(stats);
  const totalHH = stats.reduce((s,b) => s + toNum(b.total_households), 0);
  const hazardHighRiskHH = households.filter(isHighRiskHazardHH).length;
  const rows = stats.map(b => ({ b, f:domainFlags(b), p:priorityInfo(b) }));
  const prioCounts = PRIORITY_LEVELS.map(l => ({ ...l, count: rows.filter(r => r.p.rank === l.rank).length }));
  const byPriority = [...rows].sort((x,y) => (y.p.rank - x.p.rank) || ((x.b.svi_rank??999) - (y.b.svi_rank??999)));
  const urgent = byPriority.filter(r => r.p.rank >= 4);
  const sviOrder = stats.filter(b => b.svi_rank != null).sort((a,b) => a.svi_rank - b.svi_rank);
  const capOrder = stats.filter(b => b.capacity_gap_rank != null).sort((a,b) => a.capacity_gap_rank - b.capacity_gap_rank);
  const hazWorst = b => Math.max(toNum(b.flood_hi_pct), toNum(b.landslide_hi_pct));
  const hazOrder = [...stats].sort((a,b) => hazWorst(b) - hazWorst(a));
  const tiers = key => ["High","Moderate-high","Moderate-low","Low"].map(t => ({ tier:t, count:stats.filter(b => rankTier(b[key]) === t).length }));
  const indicatorStats = Object.keys(SVI_INDICATORS).map(k => {
    const vals = stats.map(b => b.social_indicators?.[k]).filter(v => v != null);
    return {
      key:k, ...SVI_INDICATORS[k],
      avg: vals.length ? vals.reduce((s,v) => s+v, 0) / vals.length : null,
      topIn: stats.filter(b => topSviDrivers(b, pctMap, 1)[0]?.key === k).length,
    };
  }).filter(x => x.avg != null).sort((a,b) => b.avg - a.avg);
  const commonDriver = [...indicatorStats].sort((a,b) => b.topIn - a.topIn)[0];
  const gapCoverage = CAPDIST_INDICATORS.map(g => ({ ...g, count: stats.filter(g.test).length }));
  return {
    n, pctMap, totalHH, hazardHighRiskHH, rows, prioCounts, byPriority, urgent,
    sviOrder, capOrder, hazOrder, sviTiers:tiers("svi_rank"), capTiers:tiers("capacity_gap_rank").map(t => ({ ...t, label:CAP_TIER_LABEL[t.tier], ranks:CAP_TIER_RANGES[t.tier] })).reverse(),
    sviFlagged: rows.filter(r => r.f.sviBad).length,
    capFlagged: rows.filter(r => r.f.capBad).length,
    hazFlagged: rows.filter(r => r.f.hazardHigh).length,
    floodHH: stats.reduce((s,b) => s + toNum(b.flood_hi_hh), 0),
    landslideHH: stats.reduce((s,b) => s + toNum(b.landslide_hi_hh), 0),
    floodBrgy: stats.filter(b => toNum(b.flood_hi_pct) >= HAZARD_FLAG_PCT).length,
    landslideBrgy: stats.filter(b => toNum(b.landslide_hi_pct) >= HAZARD_FLAG_PCT).length,
    indicatorStats, commonDriver, gapCoverage,
    totalPWD:    stats.reduce((s,b) => s + (b.pwd_count||0), 0),
    totalSenior: stats.reduce((s,b) => s + (b.senior_count||0), 0),
    totalSolo:   stats.reduce((s,b) => s + (b.solo_parent_count||0), 0),
    totalFps:    stats.reduce((s,b) => s + (b.fourps_count||0), 0),
  };
}

// Plain-language key findings, one per domain plus the cross-domain one --
// written so an LGU planner can read them without the charts.
function buildKeyFindings(S) {
  const names = arr => arr.map(b => b.barangay_name);
  const list = (arr, max = 3) => { const a = arr.slice(0, max); return a.length > 1 ? `${a.slice(0,-1).join(", ")} and ${a[a.length-1]}` : (a[0] || "none"); };
  const top = S.gapCoverage.filter(g => g.count > 0).sort((a,b) => b.count - a.count)[0];
  return [
    { domain:"Priority", color:"#7b1fa2",
      text: S.urgent.length
        ? `${S.urgent.length} of ${S.n} barangays are Top or High Priority (2+ domains flagged): ${S.urgent.length > 5
            ? `${S.urgent.slice(0,5).map(r => r.b.barangay_name).join(", ")} and ${S.urgent.length - 5} other${S.urgent.length - 5 > 1 ? "s" : ""}`
            : list(S.urgent.map(r => r.b.barangay_name), 5)}.`
        : `No barangay has two or more domains flagged at the same time.` },
    { domain:"SVI", color:SVI_TIER_COLORS["High"],
      text: `Highest social vulnerability: ${list(names(S.sviOrder))}. ${S.sviFlagged} barangays are High or Moderate-high SVI.${S.commonDriver && S.commonDriver.topIn ? ` The most frequent top driver is ${S.commonDriver.label.toLowerCase()} (top driver in ${S.commonDriver.topIn} barangays).` : ""}` },
    { domain:"Capacity", color:CAPDIST_TIER_COLORS["Low"],
      text: `Least equipped barangays: ${list(names(S.capOrder))}.${top ? ` Most common gap: ${top.label.toLowerCase()} (${top.count} of ${S.n} barangays).` : ""}` },
    { domain:"Hazard", color:FLOOD_COLOR,
      text: S.hazFlagged
        ? `${S.hazFlagged} barangays have ≥${HAZARD_FLAG_PCT}% of households in High/Very-High flood or Moderate/High landslide zones (${S.floodBrgy} flood, ${S.landslideBrgy} landslide). Municipality-wide: ${S.floodHH.toLocaleString()} households in severe flood zones, ${S.landslideHH.toLocaleString()} in moderate/high landslide zones.`
        : `No barangay has ≥${HAZARD_FLAG_PCT}% of households in a severe flood or landslide band.` },
  ];
}

// ─── SVG chart builders (shared by the on-screen tab and the print report) ──
function escHtml(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function shortBrgy(name, max = 11) {
  const l = (name || "").replace(/^(brgy\.?|bgy\.?|barangay)\s*/i, "");
  return l.length > max ? l.slice(0, max - 1) + "…" : l;
}
// Horizontal ranked bar chart: one row per barangay, in the given order --
// rank, barangay name, a bar on a light track and the value at the bar's
// end. Drawn on a targetW-wide viewBox; on screen it scales up to maxW so
// text never balloons, print passes a narrower targetW for A4.
const brgyLabel = (r) => r.display_name || shortBrgy(r.barangay_name, 40);
function svgRankedBars({ rows, value, max, color, tip, ticks, rank = () => null, fmtVal = v => toNum(v).toFixed(1), fmtTick = t => t,
  grid = "#e8ecf3", axis = "#c7cfdc", text = "#888", label = "#333", targetW = 1200, maxW = 1500, rowH = null }) {
  const compact = targetW < 900;
  const RH = rowH || (compact ? 15 : 21), fs = compact ? 8.5 : 11.5, padT = compact ? 16 : 22, padB = 6;
  const rankW = compact ? 22 : 30, nameW = compact ? 92 : 150, valW = compact ? 44 : 64;
  const x0 = rankW + nameW, x1 = targetW - valW;
  const W = targetW, H = padT + rows.length * RH + padB;
  const xOf = v => x0 + (Math.max(0, Math.min(v, max)) / max) * (x1 - x0);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;max-width:${maxW}px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif">`;
  ticks.forEach(t => { const x = xOf(t); s += `<line x1="${x}" x2="${x}" y1="${padT - 4}" y2="${H - padB}" stroke="${grid}" stroke-width="1"/><text x="${x}" y="${padT - 8}" text-anchor="middle" font-size="${fs - 2}" fill="${text}">${fmtTick(t)}</text>`; });
  s += `<line x1="${x0}" x2="${x0}" y1="${padT - 4}" y2="${H - padB}" stroke="${axis}" stroke-width="1.2"/>`;
  rows.forEach((r, i) => {
    const v = toNum(value(r)), y = padT + i * RH, bh = RH * 0.62, by = y + (RH - bh) / 2, cy = y + RH / 2 + fs * 0.35;
    const xe = xOf(v), c = color(r), rk = rank(r);
    if (i % 2 === 1) s += `<rect x="0" y="${y}" width="${W}" height="${RH}" fill="${grid}" opacity="0.35"/>`;
    s += `<g><title>${escHtml(tip(r))}</title>`;
    if (rk != null) s += `<text x="${rankW - 8}" y="${cy}" text-anchor="end" font-size="${fs - 1.5}" font-weight="700" fill="${c}">${rk}</text>`;
    s += `<text x="${rankW}" y="${cy}" font-size="${fs}" fill="${label}">${escHtml(brgyLabel(r))}</text>`;
    s += `<rect x="${x0}" y="${by.toFixed(1)}" width="${Math.max(v > 0 ? 2 : 0, xe - x0).toFixed(1)}" height="${bh.toFixed(1)}" rx="${(bh / 2).toFixed(1)}" fill="${c}"/>`;
    s += `<text x="${(xe + 6).toFixed(1)}" y="${cy}" font-size="${fs - 0.5}" font-weight="700" fill="${c}">${escHtml(fmtVal(value(r)))}</text></g>`;
  });
  return s + `</svg>`;
}
// Flood and landslide per barangay as two thin horizontal bars per row --
// side by side, never stacked or summed -- with the 25% significance line.
function svgHazardPairs({ rows, grid = "#e8ecf3", axis = "#c7cfdc", text = "#888", label = "#333", targetW = 1200, maxW = 1500 }) {
  const compact = targetW < 900;
  const RH = compact ? 17 : 24, fs = compact ? 8.5 : 11.5, padT = compact ? 16 : 22, padB = 6;
  const nameW = compact ? 100 : 160, valW = compact ? 70 : 100;
  const x0 = nameW, x1 = targetW - valW, W = targetW, H = padT + rows.length * RH + padB;
  const xOf = v => x0 + (Math.max(0, Math.min(v, 100)) / 100) * (x1 - x0);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;max-width:${maxW}px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif">`;
  [0,25,50,75,100].forEach(t => { const x = xOf(t); s += `<line x1="${x}" x2="${x}" y1="${padT - 4}" y2="${H - padB}" stroke="${grid}" stroke-width="1"/><text x="${x}" y="${padT - 8}" text-anchor="middle" font-size="${fs - 2}" fill="${text}">${t}%</text>`; });
  s += `<line x1="${x0}" x2="${x0}" y1="${padT - 4}" y2="${H - padB}" stroke="${axis}" stroke-width="1.2"/>`;
  rows.forEach((r, i) => {
    const y = padT + i * RH, f = toNum(r.flood_hi_pct), l = toNum(r.landslide_hi_pct), bh = RH * 0.28, cy = y + RH / 2 + fs * 0.35;
    if (i % 2 === 1) s += `<rect x="0" y="${y}" width="${W}" height="${RH}" fill="${grid}" opacity="0.35"/>`;
    s += `<text x="0" y="${cy}" font-size="${fs}" fill="${label}">${escHtml(brgyLabel(r))}</text>`;
    const yf = y + RH * 0.18, yl = yf + bh + RH * 0.08;
    s += `<rect x="${x0}" y="${yf.toFixed(1)}" width="${Math.max(f > 0 ? 2 : 0, xOf(f) - x0).toFixed(1)}" height="${bh.toFixed(1)}" rx="${(bh / 2).toFixed(1)}" fill="${FLOOD_COLOR}"><title>${escHtml(`${brgyLabel(r)}: flood High/Very-High ${f.toFixed(1)}% (${toNum(r.flood_hi_hh)} HH)`)}</title></rect>`;
    s += `<rect x="${x0}" y="${yl.toFixed(1)}" width="${Math.max(l > 0 ? 2 : 0, xOf(l) - x0).toFixed(1)}" height="${bh.toFixed(1)}" rx="${(bh / 2).toFixed(1)}" fill="${LANDSLIDE_COLOR}"><title>${escHtml(`${brgyLabel(r)}: landslide Moderate/High ${l.toFixed(1)}% (${toNum(r.landslide_hi_hh)} HH)`)}</title></rect>`;
    const xv = Math.max(xOf(f), xOf(l)) + 6;
    s += `<text x="${xv.toFixed(1)}" y="${cy}" font-size="${fs - 1}" font-weight="700"><tspan fill="${FLOOD_COLOR}">${f.toFixed(1)}%</tspan><tspan fill="${text}"> · </tspan><tspan fill="${LANDSLIDE_COLOR}">${l.toFixed(1)}%</tspan></text>`;
  });
  const tx = xOf(HAZARD_FLAG_PCT);
  s += `<line x1="${tx}" x2="${tx}" y1="${padT - 4}" y2="${H - padB}" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  return s + `</svg>`;
}
// Horizontal labelled bars (HTML, works on screen and in print).
function htmlHBars(items, { track = "#eef1f7", text = "#333", muted = "#888", max = null } = {}) {
  const m = max ?? Math.max(1e-9, ...items.map(i => i.value));
  return items.map(i => {
    const pct = Math.max(i.value > 0 ? 2 : 0, (i.value / m) * 100);
    return `<div style="display:grid;grid-template-columns:minmax(120px,190px) 1fr 170px;align-items:center;gap:10px;margin-bottom:7px">
      <span style="font-size:11px;color:${text}">${escHtml(i.label)}</span>
      <div style="height:8px;background:${track};border-radius:4px;overflow:hidden"><div style="width:${pct.toFixed(1)}%;height:100%;background:${i.color};border-radius:4px"></div></div>
      <span style="font-size:11px;font-weight:700;color:${i.color};text-align:right;white-space:nowrap">${escHtml(i.display)}${i.sub ? `<span style="font-weight:500;color:${muted}"> ${escHtml(i.sub)}</span>` : ""}</span>
    </div>`;
  }).join("");
}

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase()
    // Strip every "barangay" spelling the various data sources use:
    // "Brgy", "Bgy.", "Barangay" -- plus the trailing "Pob."/"Poblacion"
    // suffix the domain-pipeline CSVs append to numbered barangays
    // ("Bgy. 5 Pob." -> "5"), so a numbered barangay normalizes down to
    // just its number the same way on every source.
    .replace(/\bbrgy\.?\s*/gi,"").replace(/\bbgy\.?\s*/gi,"").replace(/\bbarangay\s*/gi,"")
    .replace(/\bpob(lacion)?\.?\s*/gi,"")
    .replace(/ñ/g,"n").replace(/[^a-z0-9\s]/g,"")
    .replace(/\s+/g," ").trim()
    // CBMS/GIS source files spell these out in full ("Santo Angel", "Santa
    // Teresa") while the old vulnerability rollup abbreviates them ("Sto
    // Angel", "Sta Teresa"). Expand the abbreviation so both sides key the
    // same way -- word-boundary only, so "sto" inside another word is left
    // alone.
    .replace(/\bsto\b/g, "santo")
    .replace(/\bsta\b/g, "santa");
}
// Fuzzy match `name` against `list`, reading each item's name from `field`
// (defaults to barangay_name). Tries an exact normalized match first, then
// falls back to substring containment either way -- used wherever two
// endpoints/sources spell the same barangay slightly differently (e.g. the
// legacy rollup's "Brgy 5" vs the domain CSVs' "Barangay 5").
function fuzzyFind(name, list, field = "barangay_name") {
  if (!name) return null;
  const fNorm = normalizeName(name);
  const exact = list.find(x => normalizeName(x[field]) === fNorm);
  if (exact) return exact;
  if (/^\d+$/.test(fNorm)) {
    // Numbered barangays: only match on the number itself once digits-only,
    // so "Brgy 1" doesn't substring-match into "Brgy 15"/"Brgy 12" etc.
    return list.find(x => normalizeName(x[field]) === fNorm) || null;
  }
  return list.find(x => {
    const xNorm = normalizeName(x[field]);
    if (/^\d+$/.test(xNorm)) return false;
    return xNorm.includes(fNorm) || fNorm.includes(xNorm);
  }) || null;
}
function findStat(featureName, stats) {
  return fuzzyFind(featureName, stats, "barangay_name");
}
function getFeatureName(f) {
  const p = f.properties;
  return p?.Barangay_n || p?.NAME_3 || p?.name || p?.BARANGAY || "Unknown";
}

function FitBounds({ geojson }) {
  const map = useMap();
  useEffect(() => {
    if (!geojson) return;
    try {
      const bounds = L.geoJSON(geojson).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] });
    } catch { /* safe */ }
  }, [geojson, map]);
  return null;
}

function downloadCSV(filename, headers, rows) {
  const escape = (v) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s; };
  const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function printTable(title, subtitle, headers, rows, footerNote = "Formula: BVI = (Sensitivity + Adaptive Capacity) / 2 · Household tiers: quantile-based (bottom 25% Low · 25–75% Moderate · 75–95% High · top 5% Very High) · Resilience = (4 − BVI) / 3") {
  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',sans-serif;padding:40px;color:#1a1a2e;background:#fff}
    .header{margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #1a237e}
    .title{font-size:18px;font-weight:800;color:#1a237e;margin-bottom:4px}
    .meta{font-size:11px;color:#888;display:flex;gap:16px;align-items:center}
    .badge{background:#e8f0fe;color:#1565c0;border-radius:4px;padding:2px 8px;font-weight:700;font-size:10px}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px}
    thead tr{background:linear-gradient(135deg,#1a237e,#1565c0)}
    th{color:#fff;padding:9px 11px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.6px;font-weight:700}
    td{padding:8px 11px;border-bottom:1px solid #f0f0f0;color:#333}
    tr:nth-child(even) td{background:#f8f9fc}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:10px;color:#aaa}
    @media print{body{padding:24px}.footer{position:fixed;bottom:16px;left:24px;right:24px}}
  </style></head><body>
  <div class="header">
    <div class="title">${title}</div>
    <div class="meta"><span>${subtitle}</span><span class="badge">LGU-SDSS · DESUD Framework</span></div>
  </div>
  <table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??'—'}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <div class="footer">
    <span>${footerNote}</span>
    <span>Municipality of San Miguel, Iloilo | Generated: ${new Date().toLocaleDateString("en-PH",{year:"numeric",month:"long",day:"numeric"})}</span>
  </div></body></html>`;
  const w = window.open("","_blank"); w.document.write(html); w.document.close();
  w.focus(); setTimeout(()=>w.print(), 400);
}

// ─── HEAT MAP: one domain at a time ──────────────────────────────────────────
// The heat map shows ONE domain per map -- SVI tier, Capacity gap
// tier, flood exposure or landslide exposure -- never a blended color. The
// planner switches between them; the print/PDF exports whichever domain is
// selected, with that domain's own legend, summary, method note and table.
const FLOOD_MAP_RAMP     = [[50,"#0d47a1"],[25,"#1976d2"],[10,"#64b5f6"],[0.0001,"#bbdefb"]];
const LANDSLIDE_MAP_RAMP = [[50,"#4e342e"],[25,"#8d6e63"],[10,"#bcaaa4"],[0.0001,"#e7dfdc"]];
const NO_HAZARD_FILL = "#f1f3f6";
function rampColor(v, ramp) { for (const [min, c] of ramp) if (v >= min) return c; return NO_HAZARD_FILL; }
const TIER_RANGES = { "High":"ranks 1–6", "Moderate-high":"ranks 7–12", "Moderate-low":"ranks 13–18", "Low":"ranks 19–24" };
const TIER_ORDER = ["High","Moderate-high","Moderate-low","Low"];

// Hazard zone colours: the same as the Map View flood / landslide layers.
const FLOOD_ZONE_COLORS = { VHF:"#000000", HF:"#2E3192", MF:"#92278F", LF:"#E6D6EC" };
const LANDSLIDE_ZONE_COLORS = { HL:"#ED1C24", ML:"#39B54A", LL:"#FFF200" };

function hazardDomain(kind) {
  const isFlood = kind === "flood";
  const ramp = isFlood ? FLOOD_MAP_RAMP : LANDSLIDE_MAP_RAMP;
  const pctKey = isFlood ? "flood_hi_pct" : "landslide_hi_pct";
  const hhKey  = isFlood ? "flood_hi_hh"  : "landslide_hi_hh";
  const band   = isFlood ? "High/Very-High flood" : "Moderate/High landslide";
  const color  = isFlood ? FLOOD_COLOR : LANDSLIDE_COLOR;
  const level = v => v >= 50 ? "Very high (≥50%)" : v >= HAZARD_FLAG_PCT ? "Significant (25–50%)" : v >= 10 ? "Moderate (10–25%)" : v > 0 ? "Low (<10%)" : "None";
  return {
    key: kind, tag: "HAZ", color,
    title: isFlood ? "Flood Exposure" : "Landslide Exposure",
    mapTitle: `% of households in ${band} zones`,
    fill: b => b ? rampColor(toNum(b[pctKey]), ramp) : "#aaaaaa",
    // The map shows the hazard zones themselves plus the households in the
    // high levels (the same rule as the exposure %), not a barangay shade.
    hazardMap: true,
    mapTitle2: isFlood ? "Flood zones · households in High / Very High flood zones" : "Landslide zones · households in Moderate / High landslide zones",
    zoneProp: isFlood ? "FloodSusc" : "LndslideSu",
    zoneColors: isFlood ? FLOOD_ZONE_COLORS : LANDSLIDE_ZONE_COLORS,
    dotField: isFlood ? "flood_exposure" : "landslide_exposure",
    dotLevels: isFlood ? ["Very High", "High"] : ["High", "Moderate"],
    legend: isFlood ? [
      { color:FLOOD_ZONE_COLORS.VHF, label:"Very High flood zone", range:"zone" },
      { color:FLOOD_ZONE_COLORS.HF,  label:"High flood zone", range:"zone" },
      { color:FLOOD_ZONE_COLORS.MF,  label:"Moderate flood zone", range:"zone" },
      { color:FLOOD_ZONE_COLORS.LF,  label:"Low flood zone", range:"zone" },
      { color:HZ_DOT_COLORS["Very High"], label:"Household · Very High", range:"dot", dot:true },
      { color:HZ_DOT_COLORS["High"], label:"Household · High", range:"dot", dot:true },
    ] : [
      { color:LANDSLIDE_ZONE_COLORS.HL, label:"High landslide zone", range:"zone" },
      { color:LANDSLIDE_ZONE_COLORS.ML, label:"Moderate landslide zone", range:"zone" },
      { color:LANDSLIDE_ZONE_COLORS.LL, label:"Low landslide zone", range:"zone" },
      { color:HZ_DOT_COLORS["High"], label:"Household · High", range:"dot", dot:true },
      { color:HZ_DOT_COLORS["Moderate"], label:"Household · Moderate", range:"dot", dot:true },
    ],
    summary: stats => [
      { label:"Total barangays", value:stats.length },
      { label:`Brgy ≥${HAZARD_FLAG_PCT}% exposed`, value:stats.filter(b => toNum(b[pctKey]) >= HAZARD_FLAG_PCT).length, color },
      { label:"Brgy with any exposure", value:stats.filter(b => toNum(b[pctKey]) > 0).length, color },
      { label:`HH in ${band} zones`, value:stats.reduce((s,b) => s + toNum(b[hhKey]), 0).toLocaleString(), color },
    ],
    method: `Share of each barangay's households located inside a ${band} zone (real GIS point-in-polygon). Significant at ≥${HAZARD_FLAG_PCT}%. ${isFlood ? "Landslide" : "Flood"} exposure is mapped separately and never added to this one.`,
    table: stats => ({
      headers: ["Barangay", `% HH in ${band} zones`, "Households exposed", "Exposure level", "Total HH"],
      widths:  [44, 40, 34, 40, 24],
      rows: [...stats].sort((a,b) => toNum(b[pctKey]) - toNum(a[pctKey])).map(b => {
        const v = toNum(b[pctKey]), c = v >= HAZARD_FLAG_PCT ? "#dc2626" : color;
        return [
          { t:b.display_name || b.barangay_name, bold:true },
          { t:`${v.toFixed(1)}%`, c, bold:true },
          { t:toNum(b[hhKey]).toLocaleString() },
          { t:level(v), c: v >= HAZARD_FLAG_PCT ? "#dc2626" : v >= 10 ? "#d97706" : "#16a34a", badge:true },
          { t:toNum(b.total_households).toLocaleString() },
        ];
      }),
    }),
  };
}

const HEATMAP_DOMAINS = {
  svi: {
    key:"svi", tag:"SVI", color:SVI_TIER_COLORS["High"],
    title:"Social Vulnerability (SVI)", mapTitle:"SVI tier (equal 6-barangay quartiles by rank)",
    fill: b => b ? sviTierColor(b.svi_rank) : "#aaaaaa",
    legend: [...TIER_ORDER.map(t => ({ color:SVI_TIER_COLORS[t], label:t, range:TIER_RANGES[t] })), { color:"#aaaaaa", label:"No Data", range:"—" }],
    summary: stats => [
      { label:"Total barangays", value:stats.length },
      ...TIER_ORDER.map(t => ({ label:`${t} SVI`, value:stats.filter(b => sviTier(b.svi_rank) === t).length, color:SVI_TIER_COLORS[t] })),
      { label:"Total households", value:stats.reduce((s,b) => s + toNum(b.total_households), 0).toLocaleString() },
    ],
    method: "13 components -- 11 household-condition indicators (food insecurity, housing materials, tenure, sanitation, internet, overcrowding, PWD/senior/solo-parent share, adult education) plus share of households beyond 2 km of the RHU and of the fire station -- each percentile-ranked across the 24 barangays and summed (max 1,300). Rank 1 = most vulnerable.",
    table: stats => {
      const pctMap = sviPercentiles(stats);
      return {
        headers: ["Barangay", "SVI score", "Rank", "Tier", "Top drivers", "Total HH"],
        widths:  [36, 20, 13, 26, 70, 17],
        rows: [...stats].sort((a,b) => (a.svi_rank??999) - (b.svi_rank??999)).map(b => [
          { t:b.display_name || b.barangay_name, bold:true },
          { t:b.svi_score != null ? toNum(b.svi_score).toFixed(2) : "—", c:sviTierColor(b.svi_rank), bold:true },
          { t:b.svi_rank != null ? `#${b.svi_rank}` : "—" },
          { t:sviTier(b.svi_rank), c:sviTierColor(b.svi_rank), badge:true },
          { t:topSviDrivers(b, pctMap, 2).map(d => `${d.label} ${(d.rate*100).toFixed(0)}%`).join(", ") || "—" },
          { t:toNum(b.total_households).toLocaleString() },
        ]),
      };
    },
  },
  capacity: {
    key:"capacity", tag:"CAP", color:CAPDIST_TIER_COLORS["Low"],
    title:"Barangay Capacity", mapTitle:"Barangay capacity tier (equal 6-barangay groups by rank)",
    fill: b => b ? capDistTierColor(b.capacity_gap_rank) : "#aaaaaa",
    legend: [...[...TIER_ORDER].reverse().map(t => ({ color:CAPDIST_TIER_COLORS[t], label:CAP_TIER_LABEL[t], range:CAP_TIER_RANGES[t] })), { color:"#aaaaaa", label:"No Data", range:"—" }],
    summary: stats => {
      const top = CAPDIST_INDICATORS.map(g => ({ ...g, n:stats.filter(g.test).length })).sort((a,b) => b.n - a.n)[0];
      return [
        { label:"Total barangays", value:stats.length },
        ...TIER_ORDER.map(t => ({ label:CAP_TIER_LABEL[t], value:stats.filter(b => capDistTier(b.capacity_gap_rank) === t).length, color:CAPDIST_TIER_COLORS[t] })),
        ...(top && top.n ? [{ label:`Most common: ${top.label.replace(/^No /, "no ")}`, value:`${top.n}/${stats.length}`, color:CAPDIST_TIER_COLORS["Moderate-high"] }] : []),
      ];
    },
    method: "What the barangay has to respond: disaster committee, response team, hotline, preparedness seminar, DRRM plan, evacuation map, hazard map, schools, evacuation centres, first-aid kits, ambulances, heavy equipment, sirens, radios, generators, emergency lights and DRRM budget — each turned into a 0–100 percentile across the 24 barangays and averaged (score 0–100). Rank 1 = best equipped.",
    table: stats => ({
      headers: ["Barangay", "Capacity (0–100)", "Rank", "Tier", "Gaps", "Total HH"],
      widths:  [36, 22, 13, 30, 64, 17],
      rows: [...stats].sort((a,b) => (a.capacity_gap_rank??999) - (b.capacity_gap_rank??999)).map(b => [
        { t:b.display_name || b.barangay_name, bold:true },
        { t:b.capacity_score != null ? toNum(b.capacity_score).toFixed(2) : "—", c:capDistTierColor(b.capacity_gap_rank), bold:true },
        { t:b.capacity_gap_rank != null ? `#${b.capacity_rank}` : "—" },
        { t:capDistTierLabel(b.capacity_gap_rank), c:capDistTierColor(b.capacity_gap_rank), badge:true },
        { t:CAPDIST_INDICATORS.filter(g => g.test(b)).map(g => g.label.replace(/^No /, "no ")).join(", ") || "none" },
        { t:toNum(b.total_households).toLocaleString() },
      ]),
    }),
  },
  flood: hazardDomain("flood"),
  landslide: hazardDomain("landslide"),
};
const HEATMAP_DOMAIN_ORDER = ["svi", "capacity", "flood", "landslide"];

function hazardPoints(households, dom) {
  if (!dom.hazardMap) return [];
  return (households || [])
    .filter(h => dom.dotLevels.includes(h[dom.dotField]))
    .map(h => ({ lat: parseFloat(h.latitude), lng: parseFloat(h.longitude), level: h[dom.dotField], color: HZ_DOT_COLORS[h[dom.dotField]] }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat || p.lng))
    // worst level drawn last (on top)
    .sort((a, b) => dom.dotLevels.indexOf(b.level) - dom.dotLevels.indexOf(a.level));
}

function heatmapCanvas(geojson, barangayStats, dom, size = { width:1400, height:1000, padding:30 }, extra = {}) {
  if (dom.hazardMap) {
    return renderVulnerabilityMapCanvas(geojson, barangayStats, { ...size, scale:2,
      zones: extra.zones ? { geojson: extra.zones, colorFor: z => dom.zoneColors[z.properties?.[dom.zoneProp]] || null, alpha: 0.55 } : null,
      points: (extra.points || []).map(p => ({ ...p, r: p.level === dom.dotLevels[0] ? 4.6 : 3.6 })) });
  }
  return renderVulnerabilityMapCanvas(geojson, barangayStats, { ...size, scale:2,
    colorFor: name => dom.fill(findStat(name, barangayStats)) });
}

async function printHeatmap(geojson, barangayStats, domainKey = "svi", extra = {}) {
  const dom = HEATMAP_DOMAINS[domainKey] || HEATMAP_DOMAINS.svi;
  const now = new Date().toLocaleDateString("en-PH",{year:"numeric",month:"long",day:"numeric"});
  let mapDataUrl = "";
  try { mapDataUrl = heatmapCanvas(geojson, barangayStats, dom, undefined, extra).toDataURL("image/png"); } catch { mapDataUrl = ""; }
  const tbl = dom.table(barangayStats);
  const cell = c => c.badge
    ? `<td><span style="background:${c.c}18;color:${c.c};border:1px solid ${c.c}44;border-radius:4px;padding:2px 8px;font-size:9.5px;font-weight:700;white-space:nowrap">${escHtml(c.t)}</span></td>`
    : `<td style="${c.c ? `color:${c.c};` : ""}${c.bold ? "font-weight:700;" : ""}">${escHtml(c.t)}</td>`;
  const html = `<!DOCTYPE html><html><head><title>${escHtml(dom.title)} Heat Map Report</title><style>
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;padding:28px 32px;color:#1a1a2e;background:#fff;font-size:12px}
    .page-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:3px solid ${dom.color}}
    .title{font-size:18px;font-weight:800;color:#1a237e;display:flex;align-items:center;gap:8px}.tag{font-size:10px;font-weight:800;color:#fff;background:${dom.color};border-radius:4px;padding:2px 8px}
    .sub{font-size:11px;color:#888;margin-top:3px}.badge{display:inline-block;background:#e8f0fe;color:#1565c0;border-radius:4px;padding:3px 10px;font-weight:700;font-size:10px}
    .map-section{display:flex;gap:16px;margin-bottom:16px}.map-box{flex:1;border-radius:8px;overflow:hidden;border:1px solid #dde3f0}.map-box img{width:100%;height:auto;display:block}
    .sidebar{width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:10px}.card{background:#f8f9fc;border-radius:8px;padding:12px;border:1px solid #e8eaf0}
    .card-title{font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:8px}
    .leg-row{display:flex;align-items:center;gap:7px;margin-bottom:6px}.dot{width:10px;height:10px;border-radius:2px;flex-shrink:0;border:1px solid #0001}
    .leg-label{font-size:10px;color:#444;font-weight:500;flex:1}.leg-range{font-size:9px;color:#999}
    .stat-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #eef0f6}.stat-label{font-size:10px;color:#666}.stat-val{font-size:13px;font-weight:800;color:#1a237e}
    .method{background:#e8f0fe;border:1px solid #c5d8fb;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:10.5px;color:#333;line-height:1.55}
    .table-title{font-size:12px;font-weight:700;color:#1a237e;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:linear-gradient(135deg,#1a237e,#1565c0)}
    th{color:#fff;padding:7px 9px;text-align:left;font-size:9px;text-transform:uppercase;font-weight:700}td{padding:6px 9px;border-bottom:1px solid #f0f0f0;color:#333}
    tr:nth-child(even) td{background:#f8f9fc}.footer{margin-top:16px;padding-top:10px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:9px;color:#aaa}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{body{padding:20px 24px}}
  </style></head><body>
  <div class="page-header"><div><div class="title"><span class="tag">${dom.tag}</span>${escHtml(dom.title)} — Heat Map</div><div class="sub">${escHtml(dom.mapTitle2 || dom.mapTitle)} · Municipality of San Miguel, Iloilo</div></div><div style="text-align:right"><div class="badge">LGU-SDSS Official Report</div><div style="font-size:11px;color:#888;margin-top:4px">Generated: ${now}</div></div></div>
  <div class="map-section">
    <div class="map-box">${mapDataUrl ? `<img src="${mapDataUrl}" alt="${escHtml(dom.title)} heat map"/>` : `<div style="padding:40px;text-align:center;color:#999">Map unavailable</div>`}</div>
    <div class="sidebar">
      <div class="card"><div class="card-title">Legend</div>${dom.legend.map(l => `<div class="leg-row"><div class="dot" style="background:${l.color};${l.dot ? "border-radius:50%;border:1.5px solid #fff;box-shadow:0 0 0 1px #0003" : ""}"></div><span class="leg-label">${escHtml(l.label)}</span><span class="leg-range">${escHtml(l.range)}</span></div>`).join("")}</div>
      <div class="card"><div class="card-title">Summary</div>${dom.summary(barangayStats).map(s => `<div class="stat-row"><span class="stat-label">${escHtml(s.label)}</span><span class="stat-val" style="${s.color ? `color:${s.color}` : ""}">${escHtml(s.value)}</span></div>`).join("")}</div>
    </div>
  </div>
  <div class="method"><strong>Method.</strong> ${escHtml(dom.method)} This map shows one domain only; SVI, Barangay Capacity and Hazard Exposure are never combined into one score.</div>
  <div class="table-title">All Barangays — ${escHtml(dom.title)}</div>
  <table><thead><tr>${tbl.headers.map(h => `<th>${escHtml(h)}</th>`).join("")}</tr></thead><tbody>${tbl.rows.map(r => `<tr>${r.map(cell).join("")}</tr>`).join("")}</tbody></table>
  <div class="footer"><span>LGU-SDSS - Spatial Decision Support System - Municipality of San Miguel, Iloilo</span><span>PSA-CBMS Compliant - ${now} - Confidential - For Official Use Only</span></div>
  </body></html>`;
  const w = window.open("","_blank"); w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>w.print(), 800);
}

async function downloadHeatmapPDF(geojson, barangayStats, domainKey = "svi", extra = {}) {
  const dom = HEATMAP_DOMAINS[domainKey] || HEATMAP_DOMAINS.svi;
  const now = new Date().toLocaleDateString("en-PH",{year:"numeric",month:"long",day:"numeric"});
  const rgb = hex => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
  // jsPDF's built-in fonts are Latin-1 only; swap the few symbols we use.
  const ascii = s => String(s ?? "").replace(/≥/g, ">=").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/ñ/g, "n").replace(/Ñ/g, "N");
  const mapCanvas = heatmapCanvas(geojson, barangayStats, dom, undefined, extra);
  const mapImg = mapCanvas.toDataURL("image/jpeg", 0.9);
  const pdf = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
  const pageW=210, pageH=297, margin=14, contentW=pageW-margin*2; let y=margin;

  pdf.setFontSize(7); pdf.setTextColor(120,120,120); pdf.text("REPUBLIC OF THE PHILIPPINES - MUNICIPALITY OF SAN MIGUEL, ILOILO", margin, y); pdf.text("LGU-SDSS Official Report", pageW-margin, y, {align:"right"}); y+=6;
  pdf.setFillColor(...rgb(dom.color)); pdf.roundedRect(margin, y-4, 11, 5.5, 1, 1, "F");
  pdf.setFontSize(7.5); pdf.setFont("helvetica","bold"); pdf.setTextColor(255,255,255); pdf.text(dom.tag, margin+5.5, y, {align:"center"});
  pdf.setFontSize(15); pdf.setTextColor(26,35,126); pdf.text(ascii(`${dom.title} - Heat Map`), margin+14, y+0.5); y+=6;
  pdf.setFontSize(8); pdf.setFont("helvetica","normal"); pdf.setTextColor(120,120,120); pdf.text(ascii(dom.mapTitle2 || dom.mapTitle), margin, y); pdf.text("Generated: "+now, pageW-margin, y, {align:"right"}); y+=4;
  pdf.setDrawColor(...rgb(dom.color)); pdf.setLineWidth(0.8); pdf.line(margin, y, pageW-margin, y); y+=5;

  const mapW=contentW*0.68, mapH=(mapCanvas.height/mapCanvas.width)*mapW;
  pdf.addImage(mapImg,"JPEG",margin,y,mapW,mapH);
  const sideX=margin+mapW+4, sideW=contentW-mapW-4; let sy=y;
  const legH = 8 + dom.legend.length*5;
  pdf.setFillColor(248,249,252); pdf.setDrawColor(232,234,240); pdf.setLineWidth(0.3); pdf.roundedRect(sideX,sy,sideW,legH,2,2,"FD");
  pdf.setFontSize(7); pdf.setFont("helvetica","bold"); pdf.setTextColor(150,150,150); pdf.text("LEGEND",sideX+3,sy+5);
  dom.legend.forEach((l,i) => { const ly=sy+10+i*5; pdf.setFillColor(...rgb(l.color)); pdf.setDrawColor(200,200,200); if (l.dot) pdf.circle(sideX+5,ly-1.1,1.5,"FD"); else pdf.rect(sideX+3.5,ly-2.6,3,3,"FD"); pdf.setFontSize(7); pdf.setFont("helvetica","normal"); pdf.setTextColor(60,60,60); pdf.text(ascii(l.label),sideX+8.5,ly); pdf.setTextColor(150,150,150); pdf.text(ascii(l.range),sideX+sideW-3,ly,{align:"right"}); });
  sy += legH + 3;
  const sum = dom.summary(barangayStats), sumH = 8 + sum.length*6;
  pdf.setFillColor(248,249,252); pdf.setDrawColor(232,234,240); pdf.roundedRect(sideX,sy,sideW,sumH,2,2,"FD");
  pdf.setFontSize(7); pdf.setFont("helvetica","bold"); pdf.setTextColor(150,150,150); pdf.text("SUMMARY",sideX+3,sy+5);
  sum.forEach((s,i) => { const ry=sy+11+i*6; pdf.setFontSize(6.5); pdf.setFont("helvetica","normal"); pdf.setTextColor(100,100,100);
    pdf.text(pdf.splitTextToSize(ascii(s.label), sideW-16)[0], sideX+3, ry); pdf.setFont("helvetica","bold"); pdf.setTextColor(...rgb(s.color || "#1a237e")); pdf.text(ascii(s.value),sideX+sideW-3,ry,{align:"right"}); });
  sy += sumH + 3;
  y = Math.max(y+mapH, sy) + 4;

  const methodLines = pdf.splitTextToSize(ascii(`Method. ${dom.method} This map shows one domain only; SVI, Barangay Capacity and Hazard Exposure are never combined into one score.`), contentW-8);
  const mH = 5 + methodLines.length*3.4;
  pdf.setFillColor(232,240,254); pdf.setDrawColor(197,216,251); pdf.roundedRect(margin,y,contentW,mH,2,2,"FD");
  pdf.setFontSize(7); pdf.setFont("helvetica","normal"); pdf.setTextColor(50,50,50); pdf.text(methodLines, margin+4, y+4.5); y += mH + 5;

  const tbl = dom.table(barangayStats);
  const scale = contentW / tbl.widths.reduce((s,w) => s+w, 0);
  const cols = tbl.widths.map(w => w*scale);
  const drawHeader = () => {
    pdf.setFillColor(26,35,126); pdf.rect(margin,y,contentW,7,"F"); pdf.setFontSize(6.3); pdf.setFont("helvetica","bold"); pdf.setTextColor(255,255,255);
    let cx = margin; tbl.headers.forEach((h,i) => { pdf.text(pdf.splitTextToSize(ascii(h).toUpperCase(), cols[i]-3)[0], cx+2, y+4.8); cx += cols[i]; }); y += 7;
  };
  pdf.setFontSize(10); pdf.setFont("helvetica","bold"); pdf.setTextColor(26,35,126); pdf.text(ascii(`All Barangays - ${dom.title}`),margin,y); y+=4;
  drawHeader();
  tbl.rows.forEach((r,i) => {
    pdf.setFontSize(6.5);
    const lines = r.map((c,j) => pdf.splitTextToSize(ascii(c.t), cols[j]-4));
    const rowH = Math.max(6, 2.5 + Math.max(...lines.map(l => l.length))*2.9);
    if (y + rowH > pageH-16) { pdf.addPage(); y = margin; drawHeader(); }
    if (i%2===0) { pdf.setFillColor(248,249,252); pdf.rect(margin,y,contentW,rowH,"F"); }
    let cx = margin;
    r.forEach((c,j) => {
      const col = rgb(c.c || "#333333");
      if (c.badge) {
        const tw = Math.min(cols[j]-3, pdf.getTextWidth(lines[j][0]) + 4);
        pdf.setFillColor(...col.map(v => Math.min(255, v+185))); pdf.roundedRect(cx+1.5,y+1.2,tw,3.8,1,1,"F");
        pdf.setFont("helvetica","bold"); pdf.setTextColor(...col); pdf.text(lines[j][0], cx+3.5, y+4);
      } else {
        pdf.setFont("helvetica", c.bold ? "bold" : "normal"); pdf.setTextColor(...col); pdf.text(lines[j], cx+2, y+4);
      }
      cx += cols[j];
    });
    y += rowH;
  });

  const totalPages=pdf.internal.getNumberOfPages();
  for(let p=1;p<=totalPages;p++){pdf.setPage(p); pdf.setDrawColor(220,220,220); pdf.setLineWidth(0.3); pdf.line(margin,pageH-10,pageW-margin,pageH-10); pdf.setFontSize(7); pdf.setFont("helvetica","normal"); pdf.setTextColor(170,170,170); pdf.text("LGU-SDSS - Municipality of San Miguel, Iloilo",margin,pageH-6); pdf.text("PSA-CBMS Compliant - "+now+" - Page "+p+" of "+totalPages,pageW-margin,pageH-6,{align:"right"});}
  pdf.save(`${dom.title.replace(/[^A-Za-z]+/g,"_").replace(/_+$/,"")}_HeatMap_Report_${Date.now()}.pdf`);
}

// ─── OVERALL REPORT: Print HTML ───────────────────────────────────────────────
// Three-domain version: SVI, Barangay Capacity and Hazard Exposure are
// reported side by side, each with its own chart, map and recommendation,
// and never merged into a single index. All numbers come from
// buildOverallSummary(), the same function the on-screen tab uses.
async function printOverallReport(geojson, barangayStats, households, sysStats) {
  const now = new Date().toLocaleDateString("en-PH",{year:"numeric",month:"long",day:"numeric"});
  const S = buildOverallSummary(barangayStats, households);
  const findings = buildKeyFindings(S);
  const findingTag = { Priority:"PRIORITY", SVI:"SVI", Capacity:"CAP", Hazard:"HAZ" };
  const pill = (color, label) => `<span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}44">${escHtml(label)}</span>`;

  // One map per domain (hazard split into flood and landslide), each colored
  // from that domain's own data only -- same definitions as the Heat Map tab.
  // Flood / landslide maps show the hazard zones and the exposed households
  // (same as the Heat Map tab), so their zone layers are loaded first.
  const zones = {};
  await Promise.all([["flood", getGISFlood], ["landslide", getGISLandslide]].map(([k, fn]) =>
    fn().then(r => { zones[k] = r.data; }).catch(() => { zones[k] = null; })));
  const maps = HEATMAP_DOMAIN_ORDER.map(k => {
    const dom = HEATMAP_DOMAINS[k];
    let img = "";
    const extra = dom.hazardMap ? { zones: zones[k], points: hazardPoints(households, dom) } : {};
    if (geojson) { try { img = heatmapCanvas(geojson, barangayStats, dom, { width:900, height:700, padding:18 }, extra).toDataURL("image/png"); } catch { img = ""; } }
    return { title:`${dom.title} — ${dom.mapTitle2 || dom.mapTitle}`, img, dotLegend: true,
      legend:dom.legend.filter(l => l.label !== "No Data").map(l => [l.color, ["zone", "dot"].includes(l.range) ? l.label : `${l.label} (${l.range})`, !!l.dot]) };
  });
  const hasMaps = maps.some(m => m.img);

  const sviChart = svgRankedBars({ rows:S.sviOrder, value:b => b.svi_score, max:1300, ticks:[0,325,650,975,1300],
    color:b => sviTierColor(b.svi_rank), tip:b => `${b.barangay_name}: SVI ${toNum(b.svi_score).toFixed(2)} (rank ${b.svi_rank})`,
    rank:b => b.svi_rank, fmtVal:v => toNum(v).toFixed(2), targetW:760 });
  const capChart = svgRankedBars({ rows:S.capOrder, value:b => b.capacity_score, max:100, ticks:[0,25,50,75,100],
    color:b => capDistTierColor(b.capacity_gap_rank), tip:b => `${b.barangay_name}: Capacity ${toNum(b.capacity_score).toFixed(2)} (rank ${b.capacity_rank})`,
    rank:b => b.capacity_rank, targetW:760 });
  const hazChart = svgHazardPairs({ rows:S.hazOrder, targetW:760 });
  const sviDrivers = htmlHBars(S.indicatorStats.map(x => ({ label:x.label, value:x.avg, color:SVI_TIER_COLORS["Moderate-high"],
    display:`${(x.avg*100).toFixed(1)}%`, sub: x.topIn ? `· top driver in ${x.topIn} brgy` : "" })), { max:1 });
  const capGaps = htmlHBars([...S.gapCoverage].sort((a,b) => b.count - a.count).map(g => ({ label:g.label, value:g.count,
    color:CAPDIST_TIER_COLORS["Moderate-high"], display:`${g.count} of ${S.n}` })), { max:S.n || 1 });

  const tierRow = (tiers, colors, suffix = "") => `<div class="tier-grid">${tiers.map(t =>
    `<div class="tier-card" style="border-left-color:${colors[t.tier]}"><div class="tier-val" style="color:${colors[t.tier]}">${t.count}</div><div><div class="tier-lbl">${t.label ?? `${t.tier}${suffix}`}</div><div class="tier-sub">${t.ranks ?? `ranks ${({ "High":"1–6","Moderate-high":"7–12","Moderate-low":"13–18","Low":"19–24" })[t.tier]}`}</div></div></div>`).join("")}</div>`;

  const attentionRows = (S.urgent.length ? S.urgent : S.byPriority.slice(0,5)).map(({ b, f, p }) => {
    const sb = sviBadge(f.sviT), cb = capBadge(f.capT), hb = hazardBadge(f.floodPct, f.landslidePct);
    return `<tr><td style="font-weight:700;color:#1a237e">${escHtml(b.barangay_name)}</td><td>${pill(p.color,p.label)}</td>
      <td>${pill(sb.color,sb.label)} <span class="muted">rank ${b.svi_rank ?? "—"}</span></td>
      <td>${pill(cb.color,cb.label)} <span class="muted">rank ${b.capacity_rank ?? "—"}</span></td>
      <td>${pill(hb.color,hb.label)} <span class="muted">${f.floodPct.toFixed(0)}% flood · ${f.landslidePct.toFixed(0)}% landslide</span></td>
      <td>${toNum(b.total_households).toLocaleString()}</td></tr>`;
  }).join("");

  const fullRows = S.byPriority.map(({ b, f, p }) => `<tr>
    <td style="font-weight:600;color:#1a237e">${escHtml(b.barangay_name)}</td>
    <td>${toNum(b.total_households).toLocaleString()}</td>
    <td style="font-weight:700;color:${sviTierColor(b.svi_rank)}">${b.svi_score != null ? toNum(b.svi_score).toFixed(2) : "—"}</td>
    <td>${pill(sviTierColor(b.svi_rank), `${f.sviT} · #${b.svi_rank ?? "—"}`)}</td>
    <td style="font-weight:700;color:${capDistTierColor(b.capacity_gap_rank)}">${b.capacity_score != null ? toNum(b.capacity_score).toFixed(2) : "—"}</td>
    <td>${pill(capDistTierColor(b.capacity_gap_rank), `${capDistTierLabel(b.capacity_gap_rank)} · #${b.capacity_rank ?? "—"}`)}</td>
    <td style="font-weight:700;color:${f.floodPct >= HAZARD_FLAG_PCT ? "#dc2626" : FLOOD_COLOR}">${f.floodPct.toFixed(1)}%</td>
    <td style="font-weight:700;color:${f.landslidePct >= HAZARD_FLAG_PCT ? "#dc2626" : LANDSLIDE_COLOR}">${f.landslidePct.toFixed(1)}%</td>
    <td>${pill(p.color, p.label)}</td></tr>`).join("");

  const recRows = S.byPriority.map(({ b, p }) => `<tr>
    <td style="font-weight:600;color:#1a237e;white-space:nowrap">${escHtml(b.barangay_name)}<br>${pill(p.color, p.label)}</td>
    <td>${escHtml(sviRecommendation(b, S.pctMap))}</td>
    <td>${escHtml(capRecommendation(b))}</td>
    <td>${escHtml(hazardRecommendation(b))}</td></tr>`).join("");

  // Population profile — each column scaled to its own max.
  const maxOf = k => Math.max(...barangayStats.map(b => b[k]||0), 1);
  const maxPWD = maxOf("pwd_count"), maxSenior = maxOf("senior_count"), maxSolo = maxOf("solo_parent_count"), maxFps = maxOf("fourps_count");
  const popBar = (v, max, color) => {
    const pct = Math.max(Math.round((v/max)*100), v?4:0);
    return `<div style="display:flex;align-items:center;gap:5px"><span style="font-size:9px;font-weight:700;color:${v?'#333':'#bbb'};min-width:16px;text-align:right">${v}</span><div style="flex:1;height:5px;background:#eef1f7;border-radius:3px;overflow:hidden;min-width:50px"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div></div></div>`;
  };
  const popRows = [...barangayStats]
    .sort((a,b) => ((b.pwd_count||0)+(b.senior_count||0)+(b.solo_parent_count||0)+(b.fourps_count||0)) - ((a.pwd_count||0)+(a.senior_count||0)+(a.solo_parent_count||0)+(a.fourps_count||0)))
    .map(b => `<tr><td style="font-size:10px;padding:5px 8px;color:#333;white-space:nowrap;font-weight:600">${escHtml(b.barangay_name)}</td>
      <td style="padding:5px 8px;min-width:90px">${popBar(b.pwd_count||0,maxPWD,"#7c3aed")}</td>
      <td style="padding:5px 8px;min-width:90px">${popBar(b.senior_count||0,maxSenior,"#1565c0")}</td>
      <td style="padding:5px 8px;min-width:90px">${popBar(b.solo_parent_count||0,maxSolo,"#c62828")}</td>
      <td style="padding:5px 8px;min-width:90px">${popBar(b.fourps_count||0,maxFps,"#f57c00")}</td></tr>`).join("");

  const html = `<!DOCTYPE html><html><head><title>Overall Three-Domain Report — Municipality of San Miguel</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,sans-serif;color:#1a1a2e;background:#fff;font-size:12px}
    .cover{min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:linear-gradient(160deg,#0d1b4b 0%,#1a237e 40%,#1565c0 100%);color:#fff;padding:60px 40px;page-break-after:always}
    .cover-seal{width:80px;height:80px;border-radius:18px;box-shadow:0 6px 20px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:28px}
    .cover-org{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:8px}
    .cover-title{font-size:30px;font-weight:800;line-height:1.2;margin-bottom:12px}
    .cover-sub{font-size:14px;color:rgba(255,255,255,0.75);margin-bottom:32px;line-height:1.5}
    .cover-divider{width:80px;height:3px;background:rgba(255,255,255,0.4);margin:0 auto 32px;border-radius:2px}
    .cover-meta{display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
    .cover-meta-item{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:12px 20px;text-align:center}
    .cover-meta-val{font-size:22px;font-weight:800}
    .cover-meta-lbl{font-size:10px;color:rgba(255,255,255,0.65);margin-top:2px}
    .cover-footer{margin-top:48px;font-size:10px;color:rgba(255,255,255,0.45)}
    .section{padding:28px 36px;page-break-inside:avoid}
    .section-title{font-size:16px;font-weight:800;color:#1a237e;margin-bottom:4px;display:flex;align-items:center;gap:8px}
    .section-title::before{content:'';display:inline-block;width:4px;height:18px;background:var(--accent,#1a237e);border-radius:2px;flex-shrink:0}
    .tag{font-size:9px;font-weight:800;color:#fff;border-radius:4px;padding:2px 7px;letter-spacing:0.4px}
    .section-sub{font-size:11px;color:#888;margin-bottom:18px;margin-left:12px}
    .stat-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px}
    .stat-card{background:#f8f9fc;border:1px solid #e3e7f0;border-radius:8px;padding:12px 10px;text-align:center}
    .stat-val{font-size:20px;font-weight:800;color:#1a237e}
    .stat-lbl{font-size:9.5px;color:#888;margin-top:3px}
    .box{background:#f8f9fc;border:1px solid #e8eaf0;border-radius:10px;padding:14px 16px;margin-bottom:14px}
    .box-title{font-size:10px;font-weight:700;color:#555;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px}
    .finding{display:flex;gap:12px;align-items:flex-start;padding:8px 0;border-top:1px solid #eceff5}
    .finding:first-of-type{border-top:none}
    .finding-tag{flex-shrink:0;min-width:62px;text-align:center;color:#fff;font-size:9px;font-weight:800;border-radius:4px;padding:3px 6px}
    .prio-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}
    .prio-card{background:#fff;border:1px solid #e8eaf0;border-radius:8px;padding:10px 12px;border-top:3px solid}
    .tier-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
    .tier-card{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e8eaf0;border-left:3px solid;border-radius:8px;padding:8px 12px}
    .tier-val{font-size:20px;font-weight:800}
    .tier-lbl{font-size:10.5px;font-weight:700;color:#333}
    .tier-sub{font-size:9px;color:#999}
    .data-table{width:100%;border-collapse:collapse;font-size:10px}
    .data-table thead tr{background:linear-gradient(135deg,#1a237e,#1565c0)}
    .data-table th{color:#fff;padding:7px 9px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:0.4px;font-weight:700}
    .data-table td{padding:6px 9px;border-bottom:1px solid #f0f0f0;color:#333;vertical-align:top}
    .data-table tr:nth-child(even) td{background:#f8f9fc}
    .badge{display:inline-block;border-radius:4px;padding:1px 7px;font-size:8.5px;font-weight:700;white-space:nowrap}
    .muted{font-size:9px;color:#999}
    .map-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .map-card{border:1px solid #dde3f0;border-radius:8px;padding:10px;page-break-inside:avoid}
    .map-card img{width:100%;height:auto;display:block;border-radius:4px}
    .map-title{font-size:10.5px;font-weight:700;color:#1a237e;margin-bottom:6px}
    .legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
    .legend span{display:flex;align-items:center;gap:4px;font-size:8.5px;color:#555}
    .legend i{width:9px;height:9px;border-radius:2px;display:inline-block}
    .method{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;font-size:10px;color:#444;line-height:1.55}
    .pop-table{width:100%;border-collapse:collapse;font-size:10px}
    .pop-table th{background:#f8f9fc;padding:7px 8px;text-align:left;font-size:9px;font-weight:700;color:#555;text-transform:uppercase;border-bottom:2px solid #e8eaf0}
    .report-footer{background:#1a237e;color:#fff;padding:14px 36px;display:flex;justify-content:space-between;align-items:center;font-size:9px;margin-top:24px}
    @media print{
      .cover,.report-footer,.data-table thead tr,.finding-tag,.tag{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
  </style></head><body>

  <!-- COVER -->
  <div class="cover">
    <div class="cover-seal"><img src="${new URL(systemLogo, window.location.href).href}" alt="LGU-SDSS" style="width:80px;height:80px;border-radius:18px"></div>
    <div class="cover-org">Republic of the Philippines · Province of Iloilo</div>
    <div class="cover-title">Barangay Vulnerability, Capacity<br>&amp; Hazard Exposure Report</div>
    <div class="cover-sub">Municipality of San Miguel · Spatial Decision Support System<br>Three-domain assessment: Social Vulnerability · Barangay Capacity · Hazard Exposure</div>
    <div class="cover-divider"></div>
    <div class="cover-meta">
      <div class="cover-meta-item"><div class="cover-meta-val">${S.n}</div><div class="cover-meta-lbl">Barangays</div></div>
      <div class="cover-meta-item"><div class="cover-meta-val">${S.totalHH.toLocaleString()}</div><div class="cover-meta-lbl">Households</div></div>
      <div class="cover-meta-item"><div class="cover-meta-val">${(sysStats.total_individuals||0).toLocaleString()}</div><div class="cover-meta-lbl">Individuals</div></div>
      <div class="cover-meta-item" style="border-color:rgba(206,147,216,0.6)"><div class="cover-meta-val" style="color:#e1bee7">${S.urgent.length}</div><div class="cover-meta-lbl">Top / High Priority Brgy</div></div>
      <div class="cover-meta-item" style="border-color:rgba(255,138,128,0.6)"><div class="cover-meta-val" style="color:#ff8a80">${S.hazardHighRiskHH.toLocaleString()}</div><div class="cover-meta-lbl">HH in Severe Hazard Zones</div></div>
    </div>
    <div class="cover-footer">Generated: ${now} &nbsp;·&nbsp; LGU-SDSS Official Report &nbsp;·&nbsp; Confidential — For Official Use Only &nbsp;·&nbsp; PSA-CBMS Compliant</div>
  </div>

  <!-- 1. EXECUTIVE SUMMARY -->
  <div class="section">
    <div class="section-title">Executive Summary</div>
    <div class="section-sub">Key statistics and findings, reported separately for each of the three domains</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-val">${S.n}</div><div class="stat-lbl">Barangays</div></div>
      <div class="stat-card"><div class="stat-val">${S.totalHH.toLocaleString()}</div><div class="stat-lbl">Households</div></div>
      <div class="stat-card"><div class="stat-val">${(sysStats.total_individuals||0).toLocaleString()}</div><div class="stat-lbl">Individuals</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#7b1fa2">${S.urgent.length}</div><div class="stat-lbl">Top / High Priority Brgy</div></div>
      <div class="stat-card"><div class="stat-val" style="color:${FLOOD_COLOR}">${S.hazFlagged}</div><div class="stat-lbl">Brgy w/ Significant Hazard</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#dc2626">${S.hazardHighRiskHH.toLocaleString()}</div><div class="stat-lbl">HH in Severe Hazard Zones</div></div>
    </div>
    <div class="box">
      <div class="box-title">Key Findings</div>
      ${findings.map(f => `<div class="finding"><span class="finding-tag" style="background:${f.color}">${findingTag[f.domain]}</span><span style="font-size:11px;color:#333;line-height:1.55">${escHtml(f.text)}</span></div>`).join("")}
    </div>
  </div>

  <!-- 2. PRIORITY OVERVIEW -->
  <div class="section">
    <div class="section-title" style="--accent:#7b1fa2">Priority Overview</div>
    <div class="section-sub">How many of the three domains are flagged per barangay — a count of flags, not a combined score</div>
    <div class="prio-grid">${S.prioCounts.map(p => `<div class="prio-card" style="border-top-color:${p.color}"><div style="font-size:10px;font-weight:700;color:#333">${p.label}</div><div style="font-size:22px;font-weight:800;color:${p.count ? p.color : "#bbb"}">${p.count}</div><div style="font-size:8.5px;color:#999">${p.desc}</div></div>`).join("")}</div>
    <table class="data-table">
      <thead><tr><th>Barangay</th><th>Priority</th><th>Social Vulnerability</th><th>Barangay Capacity</th><th>Hazard Exposure</th><th>HH</th></tr></thead>
      <tbody>${attentionRows}</tbody>
    </table>
  </div>

  <!-- 3. SVI -->
  <div class="section" style="page-break-before:always">
    <div class="section-title" style="--accent:${SVI_TIER_COLORS["High"]}"><span class="tag" style="background:${SVI_TIER_COLORS["High"]}">SVI</span>Social Vulnerability</div>
    <div class="section-sub">11 household-condition indicators + share of households beyond 2 km of the RHU and fire station (13 components), percentile-ranked and summed (max 1,300). Rank 1 = most socially vulnerable.</div>
    ${tierRow(S.sviTiers, SVI_TIER_COLORS)}
    <div class="box"><div class="box-title">SVI score per barangay (sorted by rank, colored by tier)</div>${sviChart}</div>
    <div class="box"><div class="box-title">What drives social vulnerability — average barangay rate · # of barangays where it is the #1 driver</div>${sviDrivers}</div>
  </div>

  <!-- 4. CAPACITY + DISTANCE -->
  <div class="section" style="page-break-before:always">
    <div class="section-title" style="--accent:${CAPDIST_TIER_COLORS["Low"]}"><span class="tag" style="background:${CAPDIST_TIER_COLORS["Low"]}">CAP</span>Barangay Capacity</div>
    <div class="section-sub">Resources and readiness: each item a 0–100 percentile across the 24 barangays, averaged (0–100). Rank 1 = best equipped. Least equipped shown first.</div>
    ${tierRow(S.capTiers, CAPDIST_TIER_COLORS)}
    <div class="box"><div class="box-title">Capacity score per barangay (least equipped first) (sorted by rank, colored by tier)</div>${capChart}</div>
    <div class="box"><div class="box-title">Institutional &amp; access gaps — number of barangays with each gap</div>${capGaps}</div>
  </div>

  <!-- 5. HAZARD -->
  <div class="section" style="page-break-before:always">
    <div class="section-title" style="--accent:${FLOOD_COLOR}"><span class="tag" style="background:${FLOOD_COLOR}">HAZ</span>Hazard Exposure</div>
    <div class="section-sub">Real GIS point-in-polygon exposure. Flood (High/Very-High) and landslide (Moderate/High) shown side by side, never added together.</div>
    <div class="tier-grid">
      <div class="tier-card" style="border-left-color:${FLOOD_COLOR}"><div class="tier-val" style="color:${FLOOD_COLOR}">${S.floodBrgy}</div><div class="tier-lbl">Brgy ≥${HAZARD_FLAG_PCT}% flood-exposed</div></div>
      <div class="tier-card" style="border-left-color:${FLOOD_COLOR}"><div class="tier-val" style="color:${FLOOD_COLOR}">${S.floodHH.toLocaleString()}</div><div class="tier-lbl">HH in High/Very-High flood zones</div></div>
      <div class="tier-card" style="border-left-color:${LANDSLIDE_COLOR}"><div class="tier-val" style="color:${LANDSLIDE_COLOR}">${S.landslideBrgy}</div><div class="tier-lbl">Brgy ≥${HAZARD_FLAG_PCT}% landslide-exposed</div></div>
      <div class="tier-card" style="border-left-color:${LANDSLIDE_COLOR}"><div class="tier-val" style="color:${LANDSLIDE_COLOR}">${S.landslideHH.toLocaleString()}</div><div class="tier-lbl">HH in Moderate/High landslide zones</div></div>
    </div>
    <div class="box"><div class="box-title">% of households in severe hazard bands per barangay — <span style="color:${FLOOD_COLOR}">■ flood</span> &nbsp;<span style="color:${LANDSLIDE_COLOR}">■ landslide</span></div>${hazChart}</div>
  </div>

  ${hasMaps ? `<!-- 6. MAPS -->
  <div class="section" style="page-break-before:always">
    <div class="section-title">Spatial View — One Map per Domain</div>
    <div class="section-sub">Each map is colored from its own domain only; hazard is split into flood and landslide</div>
    <div class="map-grid">${maps.map(m => m.img ? `<div class="map-card"><div class="map-title">${m.title}</div><img src="${m.img}" alt="${m.title}"/><div class="legend">${m.legend.map(([c,l,dot]) => `<span><i style="background:${c};${dot ? "border-radius:50%;box-shadow:0 0 0 1px #0004" : ""}"></i>${l}</span>`).join("")}</div></div>` : "").join("")}</div>
  </div>` : ""}

  <!-- 7. FULL TABLE -->
  <div class="section" style="page-break-before:always">
    <div class="section-title">All Barangays — Three-Domain Summary</div>
    <div class="section-sub">Each domain in its own columns; sorted by priority, then SVI rank</div>
    <table class="data-table">
      <thead><tr><th>Barangay</th><th>HH</th><th>SVI Score</th><th>SVI Tier · Rank</th><th>Cap+Dist Score</th><th>Cap+Dist Tier · Rank</th><th>Flood %</th><th>Landslide %</th><th>Priority</th></tr></thead>
      <tbody>${fullRows}</tbody>
    </table>
  </div>

  <!-- 8. RECOMMENDATIONS -->
  <div class="section" style="page-break-before:always">
    <div class="section-title" style="--accent:#f57c00">Planning Recommendations by Domain</div>
    <div class="section-sub">One recommendation per domain per barangay, each derived only from that domain's own data (top SVI drivers, specific capacity gaps, flood/landslide share)</div>
    <table class="data-table">
      <thead><tr><th style="width:17%">Barangay</th><th style="color:#ffcdd2">Social Vulnerability</th><th style="color:#ffe0b2">Barangay Capacity</th><th style="color:#bbdefb">Hazard Exposure</th></tr></thead>
      <tbody>${recRows}</tbody>
    </table>
  </div>

  ${typologyPrintSection(barangayStats, households)}

  <!-- 9. POPULATION -->
  <div class="section" style="page-break-before:always">
    <div class="section-title" style="--accent:#7c3aed">Vulnerable Population Groups</div>
    <div class="section-sub">PWD, Senior Citizens, Solo Parents &amp; 4Ps Beneficiaries per barangay (household-roster counts)</div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="stat-val" style="color:#7c3aed">${S.totalPWD.toLocaleString()}</div><div class="stat-lbl">PWD Members</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#1565c0">${S.totalSenior.toLocaleString()}</div><div class="stat-lbl">Senior Citizens</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#c62828">${S.totalSolo.toLocaleString()}</div><div class="stat-lbl">Solo Parents</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#f57c00">${S.totalFps.toLocaleString()}</div><div class="stat-lbl">4Ps Beneficiaries</div></div>
    </div>
    <table class="pop-table">
      <thead><tr><th>Barangay</th><th style="color:#7c3aed">PWD</th><th style="color:#1565c0">Senior</th><th style="color:#c62828">Solo Parent</th><th style="color:#f57c00">4Ps</th></tr></thead>
      <tbody>${popRows}</tbody>
    </table>
  </div>

  <!-- METHODOLOGY -->
  <div class="section">
    <div class="box" style="background:#e8f0fe;border-color:#c5d8fb">
      <div class="box-title" style="color:#1a237e">Methodology — three separate domains, never combined into one score</div>
      <div class="method">
        <div><strong style="color:${SVI_TIER_COLORS["High"]}">Social Vulnerability (SVI)</strong><br>13 components (11 social indicators + share of households beyond 2 km of the RHU and fire station), each percentile-ranked across the 24 barangays and summed. Tiers are equal 6-barangay quartiles by rank (1–6 High, 7–12 Moderate-high, 13–18 Moderate-low, 19–24 Low).</div>
        <div><strong style="color:${CAPDIST_TIER_COLORS["Low"]}">Barangay Capacity</strong><br>What the barangay has to respond (DRRM organisation, plans and maps, schools, evacuation centres, equipment, budget): each item a 0–100 percentile across the 24 barangays, averaged. Rank 1 = best equipped.</div>
        <div><strong style="color:${FLOOD_COLOR}">Hazard Exposure</strong><br>Share of households in High/Very-High flood or Moderate/High landslide zones (GIS point-in-polygon). Significant at ≥${HAZARD_FLAG_PCT}%. Flood and landslide kept separate.</div>
      </div>
      <div style="font-size:9.5px;color:#666;margin-top:10px">Priority level = number of domains flagged (SVI or Capacity in the top two tiers; hazard ≥${HAZARD_FLAG_PCT}%). SVI top drivers = indicators on which the barangay ranks highest among the 24 barangays.</div>
    </div>
  </div>

  <div class="report-footer">
    <span>LGU-SDSS · Spatial Decision Support System · Municipality of San Miguel, Iloilo · PSA-CBMS Compliant</span>
    <span>Generated: ${now} · Three-domain model · Confidential — For Official Use Only</span>
  </div>
  </body></html>`;

  const w = window.open("","_blank"); w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>w.print(), 800);
}

// ─── COMPARISON PAGE COMPONENT ────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// Smart Comparison Tool -- three-domain model (replaces the retired BVI /
// resilience comparison). SVI, Barangay Capacity and Hazard Exposure are
// shown side by side but NEVER combined: each has its own section, chart and
// badges, and the only cross-domain element is the same "domains flagged"
// priority verdict the Planning page and Overall Report use.
// ─────────────────────────────────────────────────────────────────────────
const CMP_COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed"];
const CMP_MAX = 5;
const CMP_DOMAIN = {
  priority: { label:"Priority (count of flagged domains — not a score)", short:"Priority", color:"#dc2626" },
  svi:      { label:"Social Vulnerability (SVI)", short:"SVI",       color:"#7c3aed" },
  capacity: { label:"Barangay Capacity",          short:"Capacity",  color:"#16a34a" },
  hazard:   { label:"Hazard Exposure",            short:"Hazard",    color:"#0891b2" },
  context:  { label:"Population (context only — not scored)", short:"Context", color:"#64748b" },
};
const CMP_FLOOD_LEVEL = { "Very High":4, "High":3, "Moderate":2, "Low":1 };
const CMP_LANDSLIDE_LEVEL = { "High":3, "Moderate":2, "Low":1 };
// Same facility points + haversine as backend/facility_distance.py (the
// pipeline behind the Barangay Capacity domain).
const CMP_RHU = [10.7815, 122.4647], CMP_FIRE = [10.7869, 122.4683];
function cmpKm(lat, lon, [la2, lo2]) {
  const la1 = parseFloat(lat), lo1 = parseFloat(lon);
  if (!isFinite(la1) || !isFinite(lo1)) return null;
  const R = 6371.0088, rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const cmpNo = v => ["no", "false", "0", "f", "n"].includes(String(v ?? "").trim().toLowerCase());
const cmpYes = v => ["yes", "true", "1", "t", "y"].includes(String(v ?? "").trim().toLowerCase());
const fmt1 = v => (v == null || isNaN(v)) ? "—" : Number(v).toFixed(1);

// Rows for the barangay comparison table. `worse` says which value is the
// greater concern ("high" | "low" | null = not compared), used only to mark
// the highest-concern barangay per row -- never to rank across domains.
function barangayRows(pctMap) {
  const gap = v => v ? "Gap" : "In place";
  return [
    { section:"priority" },
    { label:"Priority verdict", render:b => ({ pill:priorityInfo(b) }) },
    { label:"Domains flagged", num:b => { const f = domainFlags(b); return (f.sviBad?1:0) + (f.capBad?1:0) + (f.hazardHigh?1:0); },
      text:b => { const f = domainFlags(b); const l = [f.sviBad&&"SVI", f.capBad&&"Capacity", f.hazardHigh&&"Hazard"].filter(Boolean); return l.length ? `${l.length} — ${l.join(", ")}` : "0 — none"; }, worse:"high" },

    { section:"svi" },
    { label:"SVI score (max 1,300)", num:b => b.svi_score, text:b => b.svi_score != null ? toNum(b.svi_score).toFixed(1) : "—", worse:"high" },
    { label:"SVI rank (1 = most vulnerable)", num:b => b.svi_rank, text:b => b.svi_rank != null ? `#${b.svi_rank} of 24` : "—", worse:"low" },
    { label:"SVI tier", render:b => ({ pill:{ label:`${sviTier(b.svi_rank)} · ${sviBadge(sviTier(b.svi_rank)).label}`, color:sviBadge(sviTier(b.svi_rank)).color } }) },
    { label:"Top drivers", text:b => topSviDrivers(b, pctMap, 3).map(d => `${d.label} ${(d.rate*100).toFixed(1)}%`).join(" · ") || "—", small:true },
    { label:"Recommendation", text:b => sviRecommendation(b, pctMap), small:true },

    { section:"capacity" },
    { label:"Capacity score (0–100, higher = better equipped)", num:b => b.capacity_score, text:b => b.capacity_score != null ? toNum(b.capacity_score).toFixed(1) : "—", worse:"low" },
    { label:"Capacity rank (1 = best equipped)", num:b => b.capacity_gap_rank, text:b => b.capacity_gap_rank != null ? `#${b.capacity_rank} of 24` : "—", worse:"low" },
    { label:"Tier", render:b => ({ pill:{ label:`${capDistTierLabel(b.capacity_gap_rank)} · ${capBadge(capDistTier(b.capacity_gap_rank)).label}`, color:capBadge(capDistTier(b.capacity_gap_rank)).color } }) },
    { label:"DRRM plan",       num:b => b.no_drrm_plan ? 1 : 0,      text:b => gap(b.no_drrm_plan),      worse:"high" },
    { label:"Emergency hotline", num:b => b.no_hotline ? 1 : 0,      text:b => gap(b.no_hotline),        worse:"high" },
    { label:"Evacuation map",  num:b => b.no_evacuation_map ? 1 : 0, text:b => gap(b.no_evacuation_map), worse:"high" },
    { label:"Hazard map",      num:b => b.no_hazard_map ? 1 : 0,     text:b => gap(b.no_hazard_map),     worse:"high" },
    { label:"HH beyond 2km of RHU", num:b => b.rhu_pct_beyond, text:b => b.rhu_pct_beyond != null ? `${fmt1(b.rhu_pct_beyond)}%` : "—", worse:"high" },
    { label:"HH beyond 2km of fire station", num:b => b.fire_pct_beyond, text:b => b.fire_pct_beyond != null ? `${fmt1(b.fire_pct_beyond)}%` : "—", worse:"high" },
    { label:"Recommendation", text:b => capRecommendation(b), small:true },

    { section:"hazard" },
    { label:"Flood — High/Very-High zone", num:b => toNum(b.flood_hi_pct), text:b => `${fmt1(toNum(b.flood_hi_pct))}% · ${toNum(b.flood_hi_hh).toLocaleString()} HH`, worse:"high" },
    { label:"Landslide — Moderate/High zone", num:b => toNum(b.landslide_hi_pct), text:b => `${fmt1(toNum(b.landslide_hi_pct))}% · ${toNum(b.landslide_hi_hh).toLocaleString()} HH`, worse:"high" },
    { label:"Exposure level", render:b => ({ pill:hazardBadge(toNum(b.flood_hi_pct), toNum(b.landslide_hi_pct)) }) },
    { label:"Recommendation", text:b => hazardRecommendation(b), small:true },

    { section:"context" },
    { label:"Households",       num:b => toNum(b.total_households), text:b => toNum(b.total_households).toLocaleString() },
    { label:"PWD members",      num:b => b.pwd_count || 0,          text:b => (b.pwd_count || 0).toLocaleString() },
    { label:"Senior citizens",  num:b => b.senior_count || 0,       text:b => (b.senior_count || 0).toLocaleString() },
    { label:"Solo parents",     num:b => b.solo_parent_count || 0,  text:b => (b.solo_parent_count || 0).toLocaleString() },
    { label:"4Ps beneficiaries", num:b => b.fourps_count || 0,      text:b => (b.fourps_count || 0).toLocaleString() },
  ];
}

function householdRows(brgyByName) {
  const yn = v => cmpYes(v) ? "Yes" : cmpNo(v) ? "No" : "—";
  const brgy = h => brgyByName.get(h.barangay_name) || {};
  return [
    { section:"hazard" },
    { label:"Flood exposure", num:h => CMP_FLOOD_LEVEL[h.flood_exposure] || 0, text:h => h.flood_exposure || "Not in mapped zone", worse:"high" },
    { label:"Landslide exposure", num:h => CMP_LANDSLIDE_LEVEL[h.landslide_exposure] || 0, text:h => h.landslide_exposure || "Not in mapped zone", worse:"high" },
    { label:"High-hazard household", render:h => ({ pill: isHighRiskHazardHH(h) ? { label:"Yes", color:SEVERITY_COLOR.critical } : { label:"No", color:SEVERITY_COLOR.ok } }) },

    { section:"capacity" },
    { label:"Distance to RHU", num:h => h._rhu_km, text:h => h._rhu_km != null ? `${h._rhu_km.toFixed(2)} km` : "—", worse:"high" },
    { label:"Distance to fire station", num:h => h._fire_km, text:h => h._fire_km != null ? `${h._fire_km.toFixed(2)} km` : "—", worse:"high" },
    { label:"Knows evacuation location", num:h => cmpNo(h.knows_evacuation_location) ? 1 : 0, text:h => yn(h.knows_evacuation_location), worse:"high" },
    { label:"Knows emergency hotline", num:h => cmpNo(h.knows_emergency_hotline) ? 1 : 0, text:h => yn(h.knows_emergency_hotline), worse:"high" },

    { section:"svi", label:"Household composition (SVI-related indicators)" },
    { label:"Members", num:h => toNum(h.member_count || h.hh_size), text:h => toNum(h.member_count || h.hh_size) || "—" },
    { label:"PWD members", num:h => toNum(h.pwd_count), text:h => toNum(h.pwd_count), worse:"high" },
    { label:"Senior citizens", num:h => toNum(h.senior_count), text:h => toNum(h.senior_count), worse:"high" },
    { label:"Solo parents", num:h => toNum(h.solo_parent_count), text:h => toNum(h.solo_parent_count), worse:"high" },
    { label:"Dependency ratio", num:h => h.dependency_ratio != null ? toNum(h.dependency_ratio) : null, text:h => h.dependency_ratio != null ? toNum(h.dependency_ratio).toFixed(2) : "—", worse:"high" },
    { label:"4Ps beneficiary", text:h => cmpYes(h.is_4ps_beneficiary) ? "Yes" : "No" },
    { label:"Household profile", text:h => h.typology_cluster_label || "—", small:true },

    { section:"context", label:"Barangay context (barangay-level domains)" },
    { label:"Barangay", text:h => h.barangay_name || "—" },
    { label:"Barangay SVI tier", render:h => ({ pill:{ label:`${sviTier(brgy(h).svi_rank)} (#${brgy(h).svi_rank ?? "—"})`, color:sviTierColor(brgy(h).svi_rank) } }) },
    { label:"Barangay Barangay Capacity", render:h => ({ pill:{ label:`${capDistTierLabel(brgy(h).capacity_gap_rank)} (#${brgy(h).capacity_rank ?? "—"})`, color:capDistTierColor(brgy(h).capacity_gap_rank) } }) },
    { label:"Barangay priority", render:h => ({ pill: brgy(h).barangay_name ? priorityInfo(brgy(h)) : { label:"—", color:"#9aa1b2" } }) },
  ];
}

function worstSet(row, items) {
  if (!row.worse || !row.num || items.length < 2) return new Set();
  const vals = items.map(it => { const v = row.num(it); return v == null || isNaN(v) ? null : Number(v); });
  const valid = vals.filter(v => v != null);
  if (valid.length < 2) return new Set();
  const target = row.worse === "high" ? Math.max(...valid) : Math.min(...valid);
  if (valid.every(v => v === target)) return new Set();
  return new Set(vals.map((v, i) => v === target ? i : -1).filter(i => i >= 0));
}

function printComparison({ mode, items, rows, nameOf }) {
  const now = new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" });
  const head = items.map((it, i) => `<th><span class="dot" style="background:${CMP_COLORS[i]}"></span>${nameOf(it)}</th>`).join("");
  const body = rows.map(row => {
    if (row.section) {
      const d = CMP_DOMAIN[row.section];
      return `<tr class="sec"><td colspan="${items.length + 1}" style="border-left:4px solid ${d.color}">${row.label || d.label}</td></tr>`;
    }
    const worst = worstSet(row, items);
    const cells = items.map((it, i) => {
      let inner;
      if (row.render) { const r = row.render(it); inner = `<span class="pill" style="background:${r.pill.color}1a;color:${r.pill.color};border:1px solid ${r.pill.color}55">${r.pill.label}</span>`; }
      else inner = String(row.text(it));
      return `<td class="${worst.has(i) ? "worst" : ""}${row.small ? " small" : ""}">${inner}${worst.has(i) ? ' <span class="flag">highest concern</span>' : ""}</td>`;
    }).join("");
    return `<tr><td class="lbl">${row.label}</td>${cells}</tr>`;
  }).join("");

  const bars = mode === "barangay" ? (() => {
    const chart = (title, color, max, get, lab) => `<div class="chart"><div class="ct" style="border-color:${color}">${title}</div>${
      items.map((b, i) => { const v = toNum(get(b)); return `<div class="br"><span class="bn">${nameOf(b)}</span><span class="bt"><i style="width:${Math.min(100, v / max * 100).toFixed(1)}%;background:${CMP_COLORS[i]}"></i></span><span class="bv">${lab(b)}</span></div>`; }).join("")}</div>`;
    return `<div class="charts">
      ${chart("SVI score (max 1,300)", CMP_DOMAIN.svi.color, 1300, b => b.svi_score, b => `${toNum(b.svi_score).toFixed(0)} · #${b.svi_rank ?? "—"}`)}
      ${chart("Capacity score (0–100)", CMP_DOMAIN.capacity.color, 100, b => b.capacity_score, b => `${toNum(b.capacity_score).toFixed(0)} · #${b.capacity_rank ?? "—"}`)}
      ${chart("Flood — % HH High/Very-High", CMP_DOMAIN.hazard.color, 100, b => b.flood_hi_pct, b => `${fmt1(toNum(b.flood_hi_pct))}%`)}
      ${chart("Landslide — % HH Moderate/High", "#8d6e63", 100, b => b.landslide_hi_pct, b => `${fmt1(toNum(b.landslide_hi_pct))}%`)}
    </div>`;
  })() : "";

  const html = `<!DOCTYPE html><html><head><title>${mode === "barangay" ? "Barangay" : "Household"} Comparison — San Miguel</title><style>
    *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:'Segoe UI',Tahoma,sans-serif;color:#1f2937;font-size:11px;padding:28px 32px}
    .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1a237e;padding-bottom:10px;margin-bottom:14px}
    h1{font-size:18px;color:#1a237e} .sub{color:#6b7280;font-size:10.5px;margin-top:3px} .date{color:#6b7280;font-size:10px}
    .note{background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;color:#475569;font-size:10px;margin-bottom:14px;line-height:1.5}
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
    .chart{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;page-break-inside:avoid}
    .ct{font-size:10px;font-weight:700;border-left:3px solid;padding-left:6px;margin-bottom:6px}
    .br{display:grid;grid-template-columns:110px 1fr 70px;gap:6px;align-items:center;margin:3px 0}
    .bn{font-size:9.5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis} .bv{font-size:9.5px;text-align:right;font-weight:600}
    .bt{height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;display:block} .bt i{display:block;height:100%;border-radius:4px}
    table{width:100%;border-collapse:collapse} th{text-align:left;font-size:10px;padding:7px 8px;background:#f1f5f9;border-bottom:2px solid #e2e8f0}
    td{padding:6px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top} td.lbl{color:#64748b;width:24%}
    td.small{font-size:9.5px;color:#475569} tr.sec td{background:#fafafa;font-weight:700;font-size:10.5px;padding-top:9px}
    td.worst{background:#fef2f2} .flag{font-size:8px;color:#b91c1c;font-weight:700;text-transform:uppercase;margin-left:4px}
    .pill{display:inline-block;border-radius:10px;padding:1px 8px;font-size:9.5px;font-weight:700}
    .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
    tr{page-break-inside:avoid} .foot{margin-top:14px;color:#94a3b8;font-size:9px;text-align:center}
  </style></head><body>
    <div class="top"><div><h1>${mode === "barangay" ? "Barangay" : "Household"} Comparison</h1>
      <div class="sub">Municipality of San Miguel, Iloilo · LGU Spatial Decision Support System</div></div><div class="date">${now}</div></div>
    <div class="note">SVI, Barangay Capacity and Hazard Exposure are three separate domains and are never combined into one score.
      Tiers are equal 6-barangay quartiles by rank (rank 1 = worst in its domain). A red cell marks the highest concern in that row among the ${items.length} compared.
      ${mode === "household" ? "Households are identified by household ID only." : ""}</div>
    ${bars}
    <table><thead><tr><th>Metric</th>${head}</tr></thead><tbody>${body}</tbody></table>
    <div class="foot">Generated by LGU-SDSS · ${now}</div>
  </body></html>`;
  const w = window.open("", "_blank"); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
}

function ComparisonPage({ barangayStats, households, onClose, dark }) {
  const D = {
    pageBg: dark ? "#0a1020" : "#f5f6fa", cardBg: dark ? "#141c2e" : "#fff",
    border: dark ? "#1f2a44" : "#e6e9f0", title: dark ? "#dbe4ff" : "#111827",
    textMuted: dark ? "#7482a3" : "#6b7280", textBody: dark ? "#b8c2da" : "#374151",
    subBg: dark ? "#0f1627" : "#f8fafc", hover: dark ? "#18223a" : "#f3f6fc",
    selBg: dark ? "rgba(91,141,238,0.12)" : "#eef3ff", worst: dark ? "rgba(220,38,38,0.14)" : "#fef2f2",
  };
  const [mode, setMode] = useState("barangay");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("priority");
  const [hhSort, setHhSort] = useState("hazard");
  const [hhBrgy, setHhBrgy] = useState("");
  const [selected, setSelected] = useState([]);
  const [selectedHH, setSelectedHH] = useState([]);

  const pctMap = sviPercentiles(barangayStats);
  const brgyByName = new Map(barangayStats.map(b => [b.barangay_name, b]));

  const brgyList = (() => {
    const q = search.toLowerCase();
    const arr = barangayStats.filter(b => (b.barangay_name || "").toLowerCase().includes(q));
    const by = {
      priority:  (a, b) => (priorityInfo(b).rank - priorityInfo(a).rank) || ((a.svi_rank ?? 99) - (b.svi_rank ?? 99)),
      svi:       (a, b) => (a.svi_rank ?? 99) - (b.svi_rank ?? 99),
      capacity:  (a, b) => (a.capacity_gap_rank ?? 99) - (b.capacity_gap_rank ?? 99),
      flood:     (a, b) => toNum(b.flood_hi_pct) - toNum(a.flood_hi_pct),
      landslide: (a, b) => toNum(b.landslide_hi_pct) - toNum(a.landslide_hi_pct),
      name:      (a, b) => (a.barangay_name || "").localeCompare(b.barangay_name || ""),
    }[sort];
    return [...arr].sort(by);
  })();

  const hhList = (() => {
    const q = search.toLowerCase();
    const arr = households.filter(h =>
      (!hhBrgy || h.barangay_name === hhBrgy) &&
      ((h.household_number || "").toLowerCase().includes(q) || (h.barangay_name || "").toLowerCase().includes(q)));
    const hz = h => Math.max((CMP_FLOOD_LEVEL[h.flood_exposure] || 0) / 4, (CMP_LANDSLIDE_LEVEL[h.landslide_exposure] || 0) / 3);
    const by = {
      hazard:  (a, b) => hz(b) - hz(a) || toNum(b.member_count) - toNum(a.member_count),
      members: (a, b) => toNum(b.member_count) - toNum(a.member_count),
      dependents: (a, b) => (toNum(b.pwd_count) + toNum(b.senior_count)) - (toNum(a.pwd_count) + toNum(a.senior_count)),
      code:    (a, b) => (a.household_number || "").localeCompare(b.household_number || "", undefined, { numeric:true }),
    }[hhSort];
    return [...arr].sort(by).slice(0, 150);
  })();

  const toggleBrgy = b => setSelected(prev => prev.find(s => s.barangay_name === b.barangay_name)
    ? prev.filter(s => s.barangay_name !== b.barangay_name)
    : prev.length >= CMP_MAX ? prev : [...prev, b]);
  const toggleHH = h => setSelectedHH(prev => prev.find(s => s.household_id === h.household_id)
    ? prev.filter(s => s.household_id !== h.household_id)
    : prev.length >= CMP_MAX ? prev : [...prev, { ...h, _rhu_km: cmpKm(h.latitude, h.longitude, CMP_RHU), _fire_km: cmpKm(h.latitude, h.longitude, CMP_FIRE) }]);

  const items = mode === "barangay" ? selected : selectedHH;
  const nameOf = mode === "barangay" ? (b => b.barangay_name) : (h => h.household_number || `HH ${h.household_id}`);
  const rows = mode === "barangay" ? barangayRows(pctMap) : householdRows(brgyByName);
  const brgyNames = [...new Set(households.map(h => h.barangay_name).filter(Boolean))].sort();

  const Pill = ({ p, small }) => (
    <span style={{ display:"inline-block", fontSize:small ? 10 : 11, fontWeight:700, padding:small ? "1px 7px" : "2px 9px", borderRadius:10,
      color:p.color, background:`${p.color}1a`, border:`1px solid ${p.color}40`, whiteSpace:"nowrap" }}>{p.label}</span>
  );
  const Seg = ({ value, options, onChange }) => (
    <div style={{ display:"inline-flex", background:D.subBg, border:`1px solid ${D.border}`, borderRadius:8, padding:2 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{ padding:"5px 12px", fontSize:12, fontWeight:600, border:"none", borderRadius:6, cursor:"pointer",
          background:value === o.id ? D.cardBg : "transparent", color:value === o.id ? D.title : D.textMuted,
          boxShadow:value === o.id ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>{o.label}</button>
      ))}
    </div>
  );
  const select = { fontSize:12, padding:"6px 8px", borderRadius:7, border:`1px solid ${D.border}`, background:D.cardBg, color:D.textBody, width:"100%" };

  const DomainBars = ({ title, color, max, get, label }) => (
    <div style={{ background:D.cardBg, border:`1px solid ${D.border}`, borderRadius:10, padding:"12px 14px" }}>
      <div style={{ fontSize:11.5, fontWeight:700, color:D.title, borderLeft:`3px solid ${color}`, paddingLeft:8, marginBottom:10 }}>{title}</div>
      {items.map((it, i) => {
        const v = toNum(get(it));
        return (
          <div key={nameOf(it)} style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:D.textBody, marginBottom:3 }}>
              <span>{nameOf(it)}</span><span style={{ fontWeight:700, color:D.title }}>{label(it)}</span>
            </div>
            <div style={{ height:7, background:D.subBg, borderRadius:4, overflow:"hidden" }}>
              <div style={{ width:`${Math.min(100, v / max * 100)}%`, height:"100%", background:CMP_COLORS[i], borderRadius:4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:D.pageBg, fontFamily:"'Segoe UI',sans-serif", display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap",
        padding:"12px 20px", background:D.cardBg, borderBottom:`1px solid ${D.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={onClose} style={{ fontSize:12, fontWeight:600, padding:"6px 12px", borderRadius:7, border:`1px solid ${D.border}`, background:"transparent", color:D.textBody, cursor:"pointer" }}>← Back</button>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:D.title }}>Comparison</div>
            <div style={{ fontSize:11, color:D.textMuted }}>SVI, Barangay Capacity and Hazard side by side — never combined into one score</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <Seg value={mode} onChange={m => { setMode(m); setSearch(""); }} options={[{ id:"barangay", label:"Barangays" }, { id:"household", label:"Households" }]} />
          <button disabled={items.length < 2} onClick={() => printComparison({ mode, items, rows, nameOf })}
            style={{ fontSize:12, fontWeight:600, padding:"6px 14px", borderRadius:7, border:`1px solid ${items.length < 2 ? D.border : "#1a237e"}`,
              background:"transparent", color:items.length < 2 ? D.textMuted : (dark ? "#8fb4ff" : "#1a237e"), cursor:items.length < 2 ? "default" : "pointer" }}>
            Print
          </button>
        </div>
      </div>

      <div style={{ display:"flex", height:"calc(100vh - 58px)", minHeight:480 }}>
        {/* Picker */}
        <div style={{ width:300, flexShrink:0, borderRight:`1px solid ${D.border}`, background:D.cardBg, display:"flex", flexDirection:"column" }}>
          <div style={{ padding:14, display:"flex", flexDirection:"column", gap:8, borderBottom:`1px solid ${D.border}` }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={mode === "barangay" ? "Search barangay…" : "Search household ID…"}
              style={{ ...select, padding:"8px 10px" }} />
            {mode === "barangay" ? (
              <select value={sort} onChange={e => setSort(e.target.value)} style={select}>
                <option value="priority">Sort: Priority (domains flagged)</option>
                <option value="svi">Sort: SVI rank</option>
                <option value="capacity">Sort: capacity rank</option>
                <option value="flood">Sort: Flood exposure %</option>
                <option value="landslide">Sort: Landslide exposure %</option>
                <option value="name">Sort: Name</option>
              </select>
            ) : (
              <>
                <select value={hhBrgy} onChange={e => setHhBrgy(e.target.value)} style={select}>
                  <option value="">All barangays</option>
                  {brgyNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <select value={hhSort} onChange={e => setHhSort(e.target.value)} style={select}>
                  <option value="hazard">Sort: Hazard exposure</option>
                  <option value="dependents">Sort: Seniors + PWD</option>
                  <option value="members">Sort: Members</option>
                  <option value="code">Sort: Household ID</option>
                </select>
              </>
            )}
            <div style={{ fontSize:10.5, color:D.textMuted }}>Pick 2–{CMP_MAX} to compare · {items.length} selected</div>
          </div>
          <div style={{ overflowY:"auto", flex:1 }}>
            {mode === "barangay" ? brgyList.map(b => {
              const on = selected.find(s => s.barangay_name === b.barangay_name);
              const p = priorityInfo(b);
              return (
                <div key={b.barangay_name} onClick={() => toggleBrgy(b)} style={{ padding:"9px 14px", cursor:"pointer", borderBottom:`1px solid ${D.border}`,
                  background:on ? D.selBg : "transparent", borderLeft:`3px solid ${on ? CMP_COLORS[selected.indexOf(on)] : "transparent"}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:12.5, fontWeight:600, color:D.title }}>{b.barangay_name}</span>
                    <Pill p={p} small />
                  </div>
                  <div style={{ fontSize:10.5, color:D.textMuted, marginTop:2 }}>
                    SVI #{b.svi_rank ?? "—"} · Cap #{b.capacity_rank ?? "—"} · Flood {fmt1(toNum(b.flood_hi_pct))}% · Slide {fmt1(toNum(b.landslide_hi_pct))}%
                  </div>
                </div>
              );
            }) : hhList.map(h => {
              const on = selectedHH.find(s => s.household_id === h.household_id);
              return (
                <div key={h.household_id} onClick={() => toggleHH(h)} style={{ padding:"9px 14px", cursor:"pointer", borderBottom:`1px solid ${D.border}`,
                  background:on ? D.selBg : "transparent", borderLeft:`3px solid ${on ? CMP_COLORS[selectedHH.indexOf(on)] : "transparent"}` }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:D.title }}>{h.household_number}</div>
                  <div style={{ fontSize:10.5, color:D.textMuted, marginTop:2 }}>
                    {h.barangay_name} · Flood {h.flood_exposure || "—"} · Landslide {h.landslide_exposure || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Comparison */}
        <div style={{ flex:1, minWidth:0, padding:18, display:"flex", flexDirection:"column", gap:14, overflowY:"auto" }}>
          {items.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {items.map((it, i) => (
                <span key={nameOf(it)} style={{ display:"inline-flex", alignItems:"center", gap:7, fontSize:12, fontWeight:600, color:D.title,
                  padding:"4px 6px 4px 10px", borderRadius:16, border:`1px solid ${D.border}`, background:D.cardBg }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:CMP_COLORS[i] }} />{nameOf(it)}
                  <button onClick={() => mode === "barangay" ? toggleBrgy(it) : toggleHH(it)} style={{ border:"none", background:"transparent", color:D.textMuted, cursor:"pointer", fontSize:13, padding:"0 4px" }}>×</button>
                </span>
              ))}
            </div>
          )}

          {items.length < 2 ? (
            <div style={{ border:`1.5px dashed ${D.border}`, borderRadius:12, padding:"60px 20px", textAlign:"center", color:D.textMuted, fontSize:13 }}>
              Select at least two {mode === "barangay" ? "barangays" : "households"} on the left to compare them.
              <div style={{ fontSize:11, marginTop:6 }}>Each domain is shown separately — nothing is added into one score.</div>
            </div>
          ) : (
            <>
              {mode === "barangay" && (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:12 }}>
                  <DomainBars title="SVI score (max 1,300)" color={CMP_DOMAIN.svi.color} max={1300} get={b => b.svi_score} label={b => `${toNum(b.svi_score).toFixed(0)} · #${b.svi_rank ?? "—"}`} />
                  <DomainBars title="Capacity score (0–100)" color={CMP_DOMAIN.capacity.color} max={100} get={b => b.capacity_score} label={b => `${toNum(b.capacity_score).toFixed(0)} · #${b.capacity_rank ?? "—"}`} />
                  <DomainBars title="Flood — % HH High/Very-High" color={CMP_DOMAIN.hazard.color} max={100} get={b => b.flood_hi_pct} label={b => `${fmt1(toNum(b.flood_hi_pct))}%`} />
                  <DomainBars title="Landslide — % HH Moderate/High" color="#8d6e63" max={100} get={b => b.landslide_hi_pct} label={b => `${fmt1(toNum(b.landslide_hi_pct))}%`} />
                </div>
              )}

              <div style={{ background:D.cardBg, border:`1px solid ${D.border}`, borderRadius:12, overflow:"hidden" }}>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5 }}>
                    <thead>
                      <tr style={{ background:D.subBg }}>
                        <th style={{ textAlign:"left", padding:"10px 14px", fontSize:10.5, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.4, borderBottom:`1px solid ${D.border}` }}>Metric</th>
                        {items.map((it, i) => (
                          <th key={nameOf(it)} style={{ textAlign:"left", padding:"10px 14px", fontSize:11.5, color:D.title, borderBottom:`1px solid ${D.border}`, whiteSpace:"nowrap" }}>
                            <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:CMP_COLORS[i], marginRight:7 }} />{nameOf(it)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, ri) => {
                        if (row.section) {
                          const d = CMP_DOMAIN[row.section];
                          return (
                            <tr key={ri}><td colSpan={items.length + 1} style={{ padding:"12px 14px 6px", fontSize:11.5, fontWeight:800, color:D.title }}>
                              <span style={{ borderLeft:`3px solid ${d.color}`, paddingLeft:8 }}>{row.label || d.label}</span>
                            </td></tr>
                          );
                        }
                        const worst = worstSet(row, items);
                        return (
                          <tr key={ri}>
                            <td style={{ padding:"8px 14px", color:D.textMuted, borderTop:`1px solid ${D.border}`, width:"24%" }}>{row.label}</td>
                            {items.map((it, i) => {
                              const r = row.render ? row.render(it) : null;
                              return (
                                <td key={i} style={{ padding:"8px 14px", borderTop:`1px solid ${D.border}`, color:D.textBody, verticalAlign:"top",
                                  fontSize:row.small ? 11.5 : 12.5, background:worst.has(i) ? D.worst : "transparent" }}>
                                  {r ? <Pill p={r.pill} /> : <span style={{ fontWeight:row.small ? 400 : 600 }}>{row.text(it)}</span>}
                                  {worst.has(i) && <span style={{ marginLeft:6, fontSize:9.5, fontWeight:700, color:"#b91c1c", textTransform:"uppercase" }}>highest concern</span>}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ fontSize:11, color:D.textMuted, lineHeight:1.5 }}>
                Red cells mark the highest concern in that row among the {items.length} compared. Tiers are equal 6-barangay quartiles by rank (rank 1 = worst in its domain).
                {mode === "household" && " Households are identified by household ID only; distances are straight-line to the RHU and fire station, same method as the household distance-to-help check."}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── OVERALL REPORT TAB CONTENT ───────────────────────────────────────────────
function OverallReportTab({ barangayStats, households, sysStats, geojson, dark, D }) {
  const [generating, setGenerating] = useState(null);
  const S = buildOverallSummary(barangayStats, households);
  const findings = buildKeyFindings(S);

  const handlePrint = async () => {
    setGenerating("print");
    await printOverallReport(geojson, barangayStats, households, sysStats);
    setGenerating(null);
  };

  const chartColors = { grid: dark ? "#26314f" : "#e8ecf3", axis: dark ? "#3a4666" : "#c7cfdc", text: dark ? "#6b7590" : "#888888", label: dark ? "#c3cbe0" : "#333333" };
  const hbarColors  = { track: dark ? "#1c2740" : "#eef1f7", text: dark ? "#8b95a9" : "#333333", muted: dark ? "#6b7590" : "#888888" };
  const card = { background:D.cardBg, border:`1px solid ${D.border}`, borderRadius:10, padding:16 };
  const cardTitle = { fontSize:11, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5 };

  const SectionHead = ({ title, sub, accent, tag }) => (
    <>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
        <div style={{ width:4, height:18, borderRadius:2, background:accent }}/>
        {tag && <span style={{ fontSize:9.5, fontWeight:800, color:"#fff", background:accent, borderRadius:4, padding:"2px 7px", letterSpacing:0.4 }}>{tag}</span>}
        <div style={{ fontSize:15, fontWeight:800, color:D.textPrimary }}>{title}</div>
      </div>
      <div style={{ fontSize:11, color:D.textMuted, marginBottom:16, marginLeft:12 }}>{sub}</div>
    </>
  );
  const Pill = ({ color, children }) => (
    <span style={{ display:"inline-block", fontSize:9.5, fontWeight:800, color, background:color+(dark?"22":"16"),
      border:`1px solid ${color}${dark?"55":"33"}`, borderRadius:5, padding:"2px 7px", whiteSpace:"nowrap" }}>{children}</span>
  );
  const TierChips = ({ tiers, colors, suffix = "" }) => (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }}>
      {tiers.map(t => (
        <div key={t.tier} style={{ ...card, padding:"10px 14px", display:"flex", alignItems:"center", gap:12, borderLeft:`3px solid ${colors[t.tier]}` }}>
          <div style={{ fontSize:24, fontWeight:800, color:colors[t.tier] }}>{t.count}</div>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:D.textBody }}>{t.label ?? `${t.tier}${suffix}`}</div>
            <div style={{ fontSize:9.5, color:D.textMuted }}>{t.ranks ?? `ranks ${({ "High":"1–6", "Moderate-high":"7–12", "Moderate-low":"13–18", "Low":"19–24" })[t.tier]}`}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const kpis = [
    { label:"Barangays",                 value:S.n,                                         color:D.textPrimary },
    { label:"Households",                value:S.totalHH.toLocaleString(),                  color:D.textPrimary },
    { label:"Individuals",               value:(sysStats.total_individuals||0).toLocaleString(), color:D.textPrimary },
    { label:"Top / High Priority Brgy",  value:S.urgent.length,                             color:"#7b1fa2" },
    { label:"Brgy w/ Significant Hazard",value:S.hazFlagged,                                color:FLOOD_COLOR },
    { label:"HH in Severe Hazard Zones", value:S.hazardHighRiskHH.toLocaleString(),         color:"#dc2626" },
  ];
  const findingTag = { Priority:"PRIORITY", SVI:"SVI", Capacity:"CAP", Hazard:"HAZ" };
  const attentionRows = S.urgent.length ? S.urgent : S.byPriority.slice(0, 5);

  return (
    <div style={{ flex:1, overflowY:"auto", padding:24 }}>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .or-section{animation:fadeUp 0.3s ease both}
      `}</style>

      {/* Export */}
      <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginBottom:20 }}>
        <button onClick={handlePrint} disabled={!!generating}
          style={{ display:"flex", alignItems:"center", gap:7, padding:"9px 20px", borderRadius:8, fontSize:13, fontWeight:700, background:"linear-gradient(135deg,#1a237e,#1565c0)", color:"#fff", border:"none", cursor:generating?"wait":"pointer", opacity:generating?0.7:1, boxShadow:"0 3px 12px rgba(21,101,192,0.35)", transition:"all 0.15s" }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          {generating==="print"?"Generating Report...":"Print / PDF Overall Report"}
        </button>
      </div>

      {/* ── 1. EXECUTIVE SUMMARY ── */}
      <div className="or-section" style={{ marginBottom:28 }}>
        <SectionHead title="Executive Summary" accent="linear-gradient(180deg,#1a237e,#1565c0)"
          sub="Municipality of San Miguel, Iloilo — Social Vulnerability, Barangay Capacity and Hazard Exposure, reported as three separate domains" />
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12, marginBottom:16 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ ...card, padding:"14px 12px", textAlign:"center" }}>
              <div style={{ fontSize:22, fontWeight:800, color:k.color }}>{k.value}</div>
              <div style={{ fontSize:10, color:D.textMuted, marginTop:4, fontWeight:500 }}>{k.label}</div>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom:12 }}>Key Findings</div>
          <div style={{ display:"flex", flexDirection:"column" }}>
            {findings.map((f, i) => (
              <div key={f.domain} style={{ display:"flex", gap:12, alignItems:"flex-start", padding:"9px 0", borderTop: i ? `1px solid ${D.divider}` : "none" }}>
                <span style={{ flexShrink:0, minWidth:62, textAlign:"center", background:f.color, color:"#fff", fontSize:9.5, fontWeight:800, letterSpacing:0.4, borderRadius:5, padding:"3px 6px", marginTop:1 }}>{findingTag[f.domain]}</span>
                <span style={{ fontSize:12, color:D.textBody, lineHeight:1.6 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 2. PRIORITY OVERVIEW (cross-domain) ── */}
      <div className="or-section" style={{ marginBottom:28, animationDelay:"0.04s" }}>
        <SectionHead title="Priority Overview" accent="linear-gradient(180deg,#7b1fa2,#dc2626)"
          sub="How many of the three domains are flagged per barangay — a count of flags, not a combined score" />
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12, marginBottom:14 }}>
          {S.prioCounts.map(p => (
            <div key={p.rank} style={{ ...card, padding:"12px 14px", borderTop:`3px solid ${p.color}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:D.textBody }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:p.color }}/>{p.label}
              </div>
              <div style={{ fontSize:26, fontWeight:800, color:p.count ? p.color : D.textMuted, margin:"4px 0 2px" }}>{p.count}</div>
              <div style={{ fontSize:9.5, color:D.textMuted }}>{p.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ ...card, padding:0, overflow:"hidden" }}>
          <div style={{ ...cardTitle, padding:"12px 16px" }}>
            {S.urgent.length ? `Barangays needing attention (${S.urgent.length})` : "Highest-priority barangays"}
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5 }}>
            <thead>
              <tr style={{ background:D.subBg, borderTop:`1px solid ${D.border}`, borderBottom:`1px solid ${D.border}` }}>
                {["Barangay","Priority","Social Vulnerability","Barangay Capacity","Hazard Exposure","HH"].map(h => (
                  <th key={h} style={{ textAlign:"left", padding:"8px 16px", fontSize:9.5, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attentionRows.map(({ b, f, p }) => {
                const sb = sviBadge(f.sviT), cb = capBadge(f.capT), hb = hazardBadge(f.floodPct, f.landslidePct);
                return (
                  <tr key={b.barangay_name} style={{ borderBottom:`1px solid ${D.divider}` }}>
                    <td style={{ padding:"9px 16px", fontWeight:700, color:D.textPrimary }}>{b.barangay_name}</td>
                    <td style={{ padding:"9px 16px" }}><Pill color={p.color}>{p.label}</Pill></td>
                    <td style={{ padding:"9px 16px" }}><Pill color={sb.color}>{sb.label}</Pill> <span style={{ fontSize:10, color:D.textMuted, marginLeft:4 }}>rank {b.svi_rank ?? "—"}</span></td>
                    <td style={{ padding:"9px 16px" }}><Pill color={cb.color}>{cb.label}</Pill> <span style={{ fontSize:10, color:D.textMuted, marginLeft:4 }}>rank {b.capacity_rank ?? "—"}</span></td>
                    <td style={{ padding:"9px 16px" }}><Pill color={hb.color}>{hb.label}</Pill> <span style={{ fontSize:10, color:D.textMuted, marginLeft:4 }}>{f.floodPct.toFixed(0)}% flood · {f.landslidePct.toFixed(0)}% landslide</span></td>
                    <td style={{ padding:"9px 16px", color:D.textCell }}>{toNum(b.total_households).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 3. DOMAIN A: SOCIAL VULNERABILITY ── */}
      <div className="or-section" style={{ marginBottom:28, animationDelay:"0.08s" }}>
        <SectionHead tag="SVI" title="Social Vulnerability" accent={SVI_TIER_COLORS["High"]}
          sub="11 household-condition indicators + share of households beyond 2 km of the RHU and fire station (13 components), percentile-ranked and summed (max 1,300). Rank 1 = most socially vulnerable." />
        <TierChips tiers={S.sviTiers} colors={SVI_TIER_COLORS} />
        <div style={{ ...card, marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
            <div style={cardTitle}>SVI score per barangay</div>
            <div style={{ fontSize:10, color:D.textMuted }}>sorted by SVI rank · colored by tier</div>
          </div>
          <div style={{ overflowX:"auto" }} dangerouslySetInnerHTML={{ __html: svgRankedBars({
            rows:S.sviOrder, value:b => b.svi_score, max:1300, ticks:[0,325,650,975,1300],
            color:b => sviTierColor(b.svi_rank),
            tip:b => `${b.barangay_name}: SVI ${toNum(b.svi_score).toFixed(2)} — rank ${b.svi_rank} (${sviTier(b.svi_rank)})`,
            rank:b => b.svi_rank, fmtVal:v => toNum(v).toFixed(2), ...chartColors }) }} />
        </div>
        <div style={card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
            <div style={cardTitle}>What drives social vulnerability</div>
            <div style={{ fontSize:10, color:D.textMuted }}>average barangay rate · number of barangays where it is the #1 driver</div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: htmlHBars(S.indicatorStats.map(x => ({
            label:x.label, value:x.avg, color:SVI_TIER_COLORS["Moderate-high"],
            display:`${(x.avg*100).toFixed(1)}%`, sub: x.topIn ? `· top driver in ${x.topIn} brgy` : "",
          })), { ...hbarColors, max:1 }) }} />
        </div>
      </div>

      {/* ── 4. DOMAIN B: CAPACITY + DISTANCE ── */}
      <div className="or-section" style={{ marginBottom:28, animationDelay:"0.12s" }}>
        <SectionHead tag="CAP" title="Barangay Capacity" accent={CAPDIST_TIER_COLORS["Low"]}
          sub="Resources and readiness: each item a 0–100 percentile across the 24 barangays, averaged (0–100). Rank 1 = best equipped. Least equipped shown first." />
        <TierChips tiers={S.capTiers} colors={CAPDIST_TIER_COLORS} />
        <div style={{ ...card, marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
            <div style={cardTitle}>Capacity score per barangay (least equipped first)</div>
            <div style={{ fontSize:10, color:D.textMuted }}>sorted by gap rank · colored by tier</div>
          </div>
          <div style={{ overflowX:"auto" }} dangerouslySetInnerHTML={{ __html: svgRankedBars({
            rows:S.capOrder, value:b => b.capacity_score, max:100, ticks:[0,25,50,75,100],
            color:b => capDistTierColor(b.capacity_gap_rank),
            tip:b => `${b.barangay_name}: Capacity ${toNum(b.capacity_score).toFixed(2)} — rank ${b.capacity_rank} (${capDistTierLabel(b.capacity_gap_rank)})`,
            rank:b => b.capacity_rank, ...chartColors }) }} />
        </div>
        <div style={card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
            <div style={cardTitle}>Institutional & access gaps</div>
            <div style={{ fontSize:10, color:D.textMuted }}>number of barangays with each gap</div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: htmlHBars([...S.gapCoverage].sort((a,b) => b.count - a.count).map(g => ({
            label:g.label, value:g.count, color:CAPDIST_TIER_COLORS["Moderate-high"], display:`${g.count} of ${S.n}`,
          })), { ...hbarColors, max:S.n || 1 }) }} />
        </div>
      </div>

      {/* ── 5. HAZARD EXPOSURE ── */}
      <div className="or-section" style={{ marginBottom:28, animationDelay:"0.16s" }}>
        <SectionHead tag="HAZ" title="Hazard Exposure" accent={FLOOD_COLOR}
          sub="Real GIS point-in-polygon exposure. Flood (High/Very-High) and landslide (Moderate/High) are shown side by side and never added together." />
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:14 }}>
          {[
            { label:`Brgy ≥${HAZARD_FLAG_PCT}% flood-exposed`,     value:S.floodBrgy,                         color:FLOOD_COLOR },
            { label:"HH in High/Very-High flood zones",             value:S.floodHH.toLocaleString(),          color:FLOOD_COLOR },
            { label:`Brgy ≥${HAZARD_FLAG_PCT}% landslide-exposed`, value:S.landslideBrgy,                     color:LANDSLIDE_COLOR },
            { label:"HH in Moderate/High landslide zones",          value:S.landslideHH.toLocaleString(),      color:LANDSLIDE_COLOR },
          ].map(k => (
            <div key={k.label} style={{ ...card, padding:"12px 14px", borderLeft:`3px solid ${k.color}` }}>
              <div style={{ fontSize:22, fontWeight:800, color:k.color }}>{k.value}</div>
              <div style={{ fontSize:10, color:D.textMuted, marginTop:2 }}>{k.label}</div>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:12 }}>
            <div style={cardTitle}>% of households in severe hazard bands, per barangay</div>
            <div style={{ display:"flex", gap:14, fontSize:10, color:D.textBody }}>
              <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:10, height:10, borderRadius:2, background:FLOOD_COLOR }}/>Flood (High/Very-High)</span>
              <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:10, height:10, borderRadius:2, background:LANDSLIDE_COLOR }}/>Landslide (Moderate/High)</span>
            </div>
          </div>
          <div style={{ overflowX:"auto" }} dangerouslySetInnerHTML={{ __html: svgHazardPairs({ rows:S.hazOrder, ...chartColors }) }} />
        </div>
      </div>

      {/* ── Household typology (descriptive, not a domain) ── */}
      <TypologyOverallSection barangayStats={barangayStats} households={households} D={D} dark={dark}
        card={card} cardTitle={cardTitle} SectionHead={SectionHead} chartColors={chartColors} />

      {/* ── 6. VULNERABLE POPULATION GROUPS ── */}
      <div className="or-section" style={{ marginBottom:28, animationDelay:"0.2s" }}>
        <SectionHead title="Vulnerable Population Groups" accent="linear-gradient(180deg,#7c3aed,#1565c0)"
          sub="PWD, Senior Citizens, Solo Parents & 4Ps Beneficiaries across all barangays (household-roster counts)" />
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:16 }}>
          {[
            { label:"PWD Members",       value:S.totalPWD,    color:"#7c3aed" },
            { label:"Senior Citizens",   value:S.totalSenior, color:"#1565c0" },
            { label:"Solo Parents",      value:S.totalSolo,   color:"#c62828" },
            { label:"4Ps Beneficiaries", value:S.totalFps,    color:"#f57c00" },
          ].map(s => (
            <div key={s.label} style={{ ...card, padding:"14px 16px", textAlign:"center", borderTop:`3px solid ${s.color}` }}>
              <div style={{ fontSize:26, fontWeight:800, color:s.color }}>{s.value.toLocaleString()}</div>
              <div style={{ fontSize:11, color:D.textMuted, fontWeight:600, marginTop:4 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:14 }}>
            <div style={cardTitle}>Vulnerable groups per barangay</div>
            <div style={{ fontSize:10, color:D.textMuted }}>sorted by total vulnerable population</div>
          </div>
          {(() => {
            const cats = [
              { key:"pwd_count",         label:"PWD",         color:"#7c3aed" },
              { key:"senior_count",      label:"Senior",      color:"#1565c0" },
              { key:"solo_parent_count", label:"Solo Parent", color:"#c62828" },
              { key:"fourps_count",      label:"4Ps",         color:"#f57c00" },
            ];
            const rows = [...barangayStats]
              .map(b => ({ b, total: cats.reduce((s,c)=>s+(b[c.key]||0),0) }))
              .sort((a,b)=>b.total-a.total)
              .map(r=>r.b);
            const colMax = Object.fromEntries(cats.map(c => [c.key, Math.max(...barangayStats.map(b=>b[c.key]||0), 1)]));
            return (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                  <thead>
                    <tr style={{ borderBottom:`1.5px solid ${D.border}` }}>
                      <th style={{ textAlign:"left", padding:"0 8px 8px 0", fontSize:9.5, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.4, whiteSpace:"nowrap" }}>Barangay</th>
                      {cats.map(c=>(
                        <th key={c.key} style={{ textAlign:"left", padding:"0 8px 8px", fontSize:9.5, fontWeight:700, color:c.color, textTransform:"uppercase", letterSpacing:0.4, whiteSpace:"nowrap" }}>
                          <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:c.color, marginRight:5 }}/>{c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b,i)=>(
                      <tr key={i} style={{ borderBottom:`1px solid ${D.divider}` }}>
                        <td style={{ padding:"6px 8px 6px 0", fontWeight:600, color:D.textPrimary, whiteSpace:"nowrap" }}>{b.barangay_name}</td>
                        {cats.map(c=>{
                          const v = b[c.key]||0;
                          const pct = Math.round((v/colMax[c.key])*100);
                          return (
                            <td key={c.key} style={{ padding:"6px 8px", minWidth:110 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                                <span style={{ fontSize:10.5, fontWeight:700, color:v?D.textPrimary:D.textMuted, minWidth:22, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{v}</span>
                                <div style={{ flex:1, height:6, background:dark?"#1c2740":"#eef1f7", borderRadius:3, overflow:"hidden" }}>
                                  <div style={{ width:`${Math.max(pct,v?4:0)}%`, height:"100%", background:c.color, borderRadius:3 }}/>
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
          <div style={{ fontSize:9.5, color:D.textMuted, marginTop:10, fontStyle:"italic" }}>Each column's bar is scaled to that category's own highest value across barangays — categories aren't directly comparable by bar length.</div>
        </div>
      </div>

      {/* ── 7. METHODOLOGY ── */}
      <div className="or-section" style={{ marginBottom:20, animationDelay:"0.24s" }}>
        <div style={{ ...card, background:dark?"#0d1b3e":"#e8f0fe", border:`1px solid ${dark?"#1a3060":"#c5d8fb"}` }}>
          <div style={{ fontSize:13, fontWeight:800, color:D.textPrimary, marginBottom:8 }}>Methodology — three separate domains, never combined into one score</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, fontSize:11, color:D.textBody, lineHeight:1.6 }}>
            <div><strong style={{ color:SVI_TIER_COLORS["High"] }}>Social Vulnerability (SVI)</strong><br/>13 components (11 social indicators + share of households beyond 2 km of the RHU and fire station), each percentile-ranked across the 24 barangays and summed. Tiers are equal 6-barangay quartiles by rank.</div>
            <div><strong style={{ color:CAPDIST_TIER_COLORS["Low"] }}>Barangay Capacity</strong><br/>What the barangay has to respond (DRRM organisation, plans and maps, schools, evacuation centres, equipment, budget): each item a 0–100 percentile across the 24 barangays, averaged. Rank 1 = best equipped.</div>
            <div><strong style={{ color:FLOOD_COLOR }}>Hazard Exposure</strong><br/>Households located in High/Very-High flood or Moderate/High landslide zones (GIS point-in-polygon). Significant at ≥{HAZARD_FLAG_PCT}% of households. Flood and landslide kept separate.</div>
          </div>
          <div style={{ fontSize:10.5, color:D.textMuted, marginTop:10 }}>Priority level = how many of the three domains are flagged (SVI or Capacity in the top two tiers; hazard ≥{HAZARD_FLAG_PCT}%). It is a count of flags, not a weighted or averaged score.</div>
        </div>
      </div>

      <div style={{ background:dark?"#0f1828":"#f0f4ff", border:`1px solid ${dark?"#1a2a50":"#c5d8fb"}`, borderRadius:8, padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={dark?"#5b8dee":"#1565c0"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style={{ fontSize:12, color:dark?"#5b8dee":"#1565c0", fontWeight:500 }}>
          The <strong>Print / PDF Overall Report</strong> adds one map per domain, the full 24-barangay three-domain table, and per-domain recommendations for every barangay — formatted as a multi-page LGU document.
        </span>
      </div>
    </div>
  );
}

// ─── MAIN REPORTS PAGE ────────────────────────────────────────────────────────
const REPORTS = [
  { id:"barangay",   label:"Barangay Vulnerability",   color:"#1565c0", desc:"Each barangay's rank in SVI, Barangay Capacity and Hazard Exposure, side by side" },
  { id:"highrisk",   label:"High-Risk Households",     color:"#d32f2f", desc:"Households to look out for, one domain at a time: Hazard Exposure or Social Vulnerability (SVI)" },
  { id:"population", label:"Population Profile",       color:"#388e3c", desc:"PWD, Senior, Solo Parent & 4Ps counts per barangay, sorted by SVI rank" },
  { id:"typology",   label:"Household Typology",       color:"#4f46e5", desc:"The five household profiles (k-modes) per barangay, with every household and its profile for export" },
  { id:"custom",     label:"Custom Report",            color:"#0f766e", desc:"Choose exactly what to count (e.g. PWDs in one barangay, female seniors 70+) and where, then export to Excel, CSV or PDF" },
  { id:"planning",   label:"Planning Recommendations", color:"#f57c00", desc:"The Planning page's recommendations, one domain at a time, plus a full PDF report per barangay" },
  { id:"heatmap",    label:"Vulnerability Heat Map",   color:"#7b1fa2", desc:"One map per domain (SVI, Barangay Capacity, Flood, Landslide) + legend + full barangay table" },
  { id:"overall",    label:"Overall Report",           color:"#00838f", desc:"Complete professional report with charts, graphs & statistics" },
];

export default function ReportsPage({ intent } = {}) {
  const { dark } = useTheme();
  const mapRef = useRef(null);

  const D = {
    pageBg:      dark ? "radial-gradient(ellipse at 20% 0%, #0d1b35 0%, #0a1020 45%, #080b14 100%)" : "radial-gradient(ellipse at 20% 0%, #dce8ff 0%, #eaf0ff 45%, #f5f6fa 100%)",
    cardBg:      dark ? "linear-gradient(145deg, #141c2e 0%, #111520 100%)" : "#ffffff",
    subBg:       dark ? "#0f1117" : "#f8f9fc",
    border:      dark ? "#1a2540" : "#e8eaf0",
    divider:     dark ? "#141c2a" : "#f0f2f8",
    inputBg:     dark ? "#0f1117" : "#ffffff",
    inputBorder: dark ? "#1e2235" : "#e0e4ed",
    textPrimary: dark ? "#5b8dee" : "#1a237e",
    textBody:    dark ? "#8b95a9" : "#333333",
    textMuted:   dark ? "#3d4560" : "#999999",
    textCell:    dark ? "#6b7590" : "#555555",
    rowEven:     dark ? "#111828" : "#ffffff",
    rowOdd:      dark ? "#0e1422" : "#fafbff",
    rowHover:    dark ? "#161b2e" : "#f0f4ff",
    shadow:      dark ? "0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(91,141,238,0.06)" : "0 2px 10px rgba(26,35,126,0.07)",
    headerGrad:  "linear-gradient(135deg, #1a237e 0%, #1565c0 100%)",
    topAccent:   dark ? "#1e3a6e" : "#c5d8fb",
  };

  const [barangayStats, setBarangayStats] = useState([]);
  const [stage1Stats,   setStage1Stats]   = useState([]); // authoritative barangay classification (top-down, quantile)
  const [households,    setHouseholds]    = useState([]);
  const [sysStats,      setSysStats]      = useState({});
  const [geojson,       setGeojson]       = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [activeReport,  setActiveReport]  = useUrlParam("report", "barangay", intent?.report);
  useEffect(() => { if (intent?.report) setActiveReport(intent.report); }, [intent?.ts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [brgyFilter,    setBrgyFilter]    = useState("all");
  const [riskFilter,    setRiskFilter]    = useState("all");
  const [brgySort,      setBrgySort]      = useState("svi"); // Barangay Vulnerability: which domain orders the table
  const [brgyView,      setBrgyView]      = useState("all"); // "all" or one domain: svi | capacity | hazard
  // High-Risk Households: hazard + the household's own SVI conditions
  const [riskHH,        setRiskHH]        = useState(null);   // null = not loaded yet
  const [riskErr,       setRiskErr]       = useState(null);
  const [hrView,        setHrView]        = useState("hazard"); // "hazard" | "svi" -- one domain at a time
  const [hrHazard,      setHrHazard]      = useState("any");  // "any" | "flood" | "landslide"
  // Planning Recommendations: one domain at a time + full barangay PDF
  const [planDomain,    setPlanDomain]    = useState("svi");
  const [planBrgy,      setPlanBrgy]      = useState("");
  const [planScope,     setPlanScope]     = useState("domain"); // "domain" | "all"
  const [planBusy,      setPlanBusy]      = useState(null);
  useEffect(() => {
    if (activeReport !== "highrisk" || riskHH) return;
    getHighRiskHouseholds().then(r => setRiskHH(r.data?.households || [])).catch(e => { setRiskHH([]); setRiskErr(e.message); });
  }, [activeReport, riskHH]);
  const [generating,    setGenerating]    = useState(null);
  const [previewLimit,  setPreviewLimit]  = useState(10);
  const [customLimit,   setCustomLimit]   = useState("");
  const [showComparison, setShowComparison] = useState(false);
  const [heatDomain,    setHeatDomain]    = useState("svi"); // which ONE domain the heat map shows
  const [hazardZones,   setHazardZones]   = useState({});     // { flood: geojson, landslide: geojson }
  useEffect(() => {
    if (activeReport !== "heatmap" || !["flood", "landslide"].includes(heatDomain) || hazardZones[heatDomain]) return;
    (heatDomain === "flood" ? getGISFlood() : getGISLandslide())
      .then(r => setHazardZones(z => ({ ...z, [heatDomain]: r.data })))
      .catch(() => setHazardZones(z => ({ ...z, [heatDomain]: { type: "FeatureCollection", features: [] } })));
  }, [activeReport, heatDomain, hazardZones]);

  useEffect(() => {
    Promise.all([
      getVulnBarangaySummary().then(r => r.data?.data || []),
      getVulnBarangayStage1().then(r => r.data?.data || r.data || []).catch(() => []),
      // Sir Shem's two-domain model -- fetched alongside the legacy BVI
      // endpoints above (not replacing them yet) while report tabs are
      // migrated one at a time; see the ReportsPage rebuild tasks.
      getDomainBarangays().then(r => r.data?.data || []).catch(() => []),
      getDomainCapacity().then(r => r.data?.data || []).catch(() => []),
      getHouseholds({ page:1, per_page:9999, limit:9999 }).then(r => r.data?.data || []),
      getStats().then(r => r.data).catch(() => ({})),
      getGISBarangays().then(r => r.data).catch(() => null),
    ]).then(([b, s1, domB, capDist, hh, st, geo]) => {
      // Merge Stage 1's authoritative vuln_score/vuln_category into the naive-rollup
      // rows by barangay name, so downstream code can read b.stage1_score /
      // b.stage1_category while keeping the naive rollup's HH tier-count fields
      // (very_high_vuln_count etc.) intact and clearly separate — see system doc §1/§8.
      const s1Map = new Map(s1.map(x => [normalizeName(x.barangay_name), x]));
      // New two-domain fields (domB/capDist rows use `barangay`, not
      // `barangay_name`). Looked up per-row below via fuzzyFind() rather
      // than an exact Map.get(), since the domain-pipeline CSVs and the
      // legacy rollup don't always spell the same barangay identically
      // (e.g. "Santo Angel" vs "Sto Angel", "Barangay 5" vs "Brgy 5").

      // Live hazard-exposed household counts, computed from the SAME
      // household list this page just fetched (not a possibly-stale CSV
      // aggregate) -- flood_exposure/landslide_exposure are real
      // per-household GIS point-in-polygon labels, kept always separate
      // (handoff §3.5), never summed into one hazard "score".
      const hazardByBrgy = new Map();
      hh.forEach(h => {
        const key = normalizeName(h.barangay_name);
        const rec = hazardByBrgy.get(key) || { flood: 0, landslide: 0, exposed: 0, total: 0 };
        rec.total++;
        const isFlood = !!h.flood_exposure, isLandslide = !!h.landslide_exposure;
        if (isFlood) rec.flood++;
        if (isLandslide) rec.landslide++;
        if (isFlood || isLandslide) rec.exposed++;
        hazardByBrgy.set(key, rec);
      });

      // Nothing imported yet: the legacy rollup is empty, so list the 24
      // barangays from the domain endpoint (every value 0) to keep the tables.
      const baseRows = b.length ? b : domB.map(d => ({ barangay_name: d.barangay, total_households: 0,
        low_vuln_count: 0, medium_vuln_count: 0, high_vuln_count: 0, very_high_vuln_count: 0, vulnerable_count: 0,
        pwd_count: 0, senior_count: 0, solo_parent_count: 0, fourps_count: 0 }));
      const merged = baseRows.map(row => {
        const key = normalizeName(row.barangay_name);
        const match = s1Map.get(key);
        const dom = fuzzyFind(row.barangay_name, domB, "barangay");
        const cd  = fuzzyFind(row.barangay_name, capDist, "barangay");
        const hz  = hazardByBrgy.get(key);
        return {
          ...row,
          display_name: OFFICIAL_BARANGAY_NAME[key] || dom?.barangay || row.barangay_name,
          stage1_score:    match ? toNum(match.vuln_score) : null,
          stage1_category: match ? match.vuln_category : null,
          flagged_for_stage2: match ? !!match.flagged_for_stage2 : false,
          // -- new two-domain fields --
          svi_score: dom ? dom.svi_score : null,
          svi_rank:  dom ? dom.svi_rank  : null,
          capacity_score: cd ? cd.capacity_score : null,
          capacity_rank:  cd ? cd.capacity_rank  : null,
          // 1 = least equipped (score ascending, ties share the lower rank)
          capacity_gap_rank: cd && cd.capacity_score != null && cd.capacity_rank != null
            ? 1 + capDist.filter(x => x.capacity_score != null && x.capacity_score < cd.capacity_score).length : null,
          hazard_flood_hh:     hz ? hz.flood     : 0,
          hazard_landslide_hh: hz ? hz.landslide : 0,
          hazard_exposed_hh:   hz ? hz.exposed   : 0,
          hazard_exposed_pct:  hz && hz.total ? hz.exposed / hz.total : 0,
          // Pipeline's own "risk-worthy band" aggregates (flood High/Very-High,
          // landslide Moderate/High) from hazard_exposure_by_barangay.csv --
          // the same numbers the Planning page uses, so both pages agree on
          // which barangays have significant hazard exposure.
          flood_hi_pct:     dom?.hazard?.flood_high_or_very_high_pct_total ?? 0,
          landslide_hi_pct: dom?.hazard?.landslide_moderate_or_high_pct_total ?? 0,
          flood_hi_hh:      dom?.hazard?.flood_high_or_very_high_households ?? 0,
          landslide_hi_hh:  dom?.hazard?.landslide_moderate_or_high_households ?? 0,
          // Barangay Capacity items used for the gap list / recommendations
          // (from /capacity: resource values and the listed readiness checks).
          ...capacityGapFields(cd),
          // Distance to help (household vulnerability): % beyond 2 km.
          rhu_pct_beyond:    dom?.access?.rhu_pct_beyond ?? null,
          fire_pct_beyond:   dom?.access?.fire_pct_beyond ?? null,
          // SVI's 11 raw indicator proportions, for naming top drivers.
          social_indicators: dom?.social_indicators || {},
        };
      });
      setBarangayStats(merged); setStage1Stats(s1); setHouseholds(hh); setSysStats(st); setGeojson(geo);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const now = new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" });

  // Barangay-level tabs always list all 24 barangays; Top N is only for
  // the household list.
  const BARANGAY_LEVEL = ["barangay", "population", "planning"];
  const getSliceCount = (total) => {
    if (BARANGAY_LEVEL.includes(activeReport)) return total;
    if (previewLimit === "all") return total;
    if (previewLimit === "custom") return Math.min(Math.max(parseInt(customLimit) || 10, 1), total);
    return Math.min(previewLimit, total);
  };

  // Filters by SVI rank tier now (the "Barangay Vulnerability" tab's own
  // domain), not the retired Stage-1 category -- see rankTier() above.
  // Barangay Vulnerability: all 24 barangays, ordered by the domain the
  // user picks. Each domain keeps its own rank; nothing is combined.
  const BRGY_SORTS = {
    svi:       { label: "SVI rank (most vulnerable first)", fn: (a, b) => (a.svi_rank ?? 999) - (b.svi_rank ?? 999) },
    capacity:  { label: "Capacity rank (least equipped first)", fn: (a, b) => (b.capacity_rank ?? -1) - (a.capacity_rank ?? -1) },
    flood:     { label: "Flood exposure (highest first)", fn: (a, b) => (b.flood_hi_pct || 0) - (a.flood_hi_pct || 0) },
    landslide: { label: "Landslide exposure (highest first)", fn: (a, b) => (b.landslide_hi_pct || 0) - (a.landslide_hi_pct || 0) },
    name:      { label: "Barangay name (A–Z)", fn: (a, b) => String(a.display_name).localeCompare(String(b.display_name), undefined, { numeric: true }) },
  };
  const BRGY_VIEWS = [
    { id: "all", label: "All three domains" }, { id: "svi", label: "SVI" },
    { id: "capacity", label: "Barangay Capacity" }, { id: "hazard", label: "Hazard Exposure" },
  ];
  const SORTS_FOR_VIEW = { all: ["svi", "capacity", "flood", "landslide", "name"], svi: ["svi", "name"],
    capacity: ["capacity", "name"], hazard: ["flood", "landslide", "name"] };
  const showSvi = brgyView === "all" || brgyView === "svi";
  const showCap = brgyView === "all" || brgyView === "capacity";
  const showHaz = brgyView === "all" || brgyView === "hazard";
  const pickBrgyView = (v) => {
    setBrgyView(v);
    if (!SORTS_FOR_VIEW[v].includes(brgySort)) setBrgySort(SORTS_FOR_VIEW[v][0]);
  };
  const filteredBarangays = [...barangayStats].sort((a, b) =>
    (BRGY_SORTS[brgySort] || BRGY_SORTS.svi).fn(a, b) || (a.svi_rank ?? 999) - (b.svi_rank ?? 999));
  const HZ_SIG = 25;

  // High-risk households, per the hazard-exposure-only definition (no
  // combined BVI score): flood High/Very High OR landslide Moderate/High,
  // see isHighRiskHazardHH above. Sorted worst-first by a simple severity
  // rank so the most exposed households surface at the top -- flood and
  // landslide severity are ranked independently, never averaged together,
  // and a household exposed on both counts as its higher rank.
  const FLOOD_SEVERITY     = { "Very High":4, "High":3, "Moderate":2, "Low":1 };
  const LANDSLIDE_SEVERITY = { "High":3, "Moderate":2, "Low":1 };
  const hhSeverityRank = (hh) => Math.max(FLOOD_SEVERITY[hh.flood_exposure]||0, LANDSLIDE_SEVERITY[hh.landslide_exposure]||0);

  // Households in a high hazard zone (flood High/Very High or landslide
  // Moderate/High), each with its own count of the 13 SVI conditions. The
  // two are shown side by side and never added together. Worst hazard level
  // first, then most SVI conditions, then most people who need help.
  const SVI_FLAG_MIN = 5;
  const brgyDisplay = new Map(barangayStats.map(b => [normalizeName(b.barangay_name), b.display_name]));
  const hrBrgyName = (n) => brgyDisplay.get(normalizeName(n)) || n;
  const filteredHouseholds = (riskHH || [])
    .filter(hh => {
      if (brgyFilter !== "all" && hrBrgyName(hh.barangay_name) !== brgyFilter) return false;
      if (hrView === "hazard" && !hh.in_hazard) return false;
      if (hrView === "svi" && hh.svi_conditions < SVI_FLAG_MIN) return false;
      if (hrView === "hazard" && hrHazard === "flood" && !["High", "Very High"].includes(hh.flood_exposure)) return false;
      if (hrView === "hazard" && hrHazard === "landslide" && !["Moderate", "High"].includes(hh.landslide_exposure)) return false;
      return true;
    })
    .sort((a, b) => {
      const byCode = String(a.household_number).localeCompare(String(b.household_number), undefined, { numeric: true });
      return hrView === "svi"
        ? (b.svi_conditions - a.svi_conditions) || byCode
        : (hhSeverityRank(b) - hhSeverityRank(a)) || byCode;
    });
  const HR_VIEWS = [["hazard", "Hazard Exposure"], ["svi", "Social Vulnerability (SVI)"]];
  const needsText = (hh) => [hh.seniors && `${hh.seniors} senior${hh.seniors > 1 ? "s" : ""}`, hh.pwd && `${hh.pwd} PWD`, hh.under5 && `${hh.under5} under 5`].filter(Boolean).join(", ");
  const hhCode = (c) => String(c || "").replace(/^.*?-\s*/, "");

  // Population Profile: most socially vulnerable first (SVI rank), since
  // PWD / senior / solo-parent shares are 3 of SVI's 11 indicators.
  const populationSorted = [...barangayStats].sort((a, b) => (a.svi_rank ?? 999) - (b.svi_rank ?? 999));
  // Planning Recommendations: one recommendation PER DOMAIN, each built only
  // from that domain's own data, plus the cross-domain priority (a count of
  // flagged domains, not a score). Same helpers as the Overall Report.
  // Same functions as the Planning page (priority, status, every
  // recommendation), fed with this page's rows in the Planning page's shape.
  const PLAN_DOMAINS = [["svi", "Social Vulnerability (SVI)"], ["capacity", "Barangay Capacity"], ["hazard", "Hazard Exposure"]];
  const planShape = barangayStats.map(b => ({
    ...b, barangay_name: b.display_name,
    flood_pct: b.flood_hi_pct, landslide_pct: b.landslide_hi_pct, flood_hh: b.flood_hi_hh, landslide_hh: b.landslide_hi_hh,
  }));
  const planDomainOrder = {
    svi: (a, b) => (a.svi_rank ?? 999) - (b.svi_rank ?? 999),
    capacity: (a, b) => (b.capacity_rank ?? -1) - (a.capacity_rank ?? -1),
    hazard: (a, b) => Math.max(toNum(b.flood_pct), toNum(b.landslide_pct)) - Math.max(toNum(a.flood_pct), toNum(a.landslide_pct)),
  };
  const planningRows = planShape
    .map(b => ({ b, p: planPriority(b), pack: domainPack(b, planShape, planDomain) }))
    .sort((x, y) => (y.p.rank - x.p.rank) || planDomainOrder[planDomain](x.b, y.b));
  const downloadBarangayPlan = async () => {
    const b = planShape.find(x => x.barangay_name === (planBrgy || planningRows[0]?.b.barangay_name));
    if (!b) return;
    setPlanBusy("Preparing…");
    try {
      const pr = planPriority(b);
      const keys = planScope === "all" ? ["svi", "capacity", "hazard"] : [planDomain];
      await buildPlanningReport({ b, packs: keys.map(k => domainPack(b, planShape, k)), verdict: planInsights(b).verdict.text,
        priority: { label: pr.label, color: pr.color }, onProgress: setPlanBusy, limit: "all" });
    } catch (e) { window.alert?.(`Could not build the report: ${e.message}`); }
    finally { setPlanBusy(null); }
  };
  const recLine = (r) => `${r.title} (${r.reason}${r.office ? `; lead: ${r.office}` : ""})`;

  const handleExport = async (type) => {
    setGenerating(type);
    const heatExtra = { zones: hazardZones[heatDomain], points: hazardPoints(households, HEATMAP_DOMAINS[heatDomain]) };
    if (type === "heatmap_print") { await printHeatmap(geojson, barangayStats, heatDomain, heatExtra); setGenerating(null); return; }
    if (type === "heatmap_pdf")   { await downloadHeatmapPDF(geojson, barangayStats, heatDomain, heatExtra); setGenerating(null); return; }
    setTimeout(() => {
      if (type === "csv") {
        if (activeReport === "barangay") {
          downloadCSV(`Barangay_Vulnerability_${brgyView === "all" ? "three_domains" : brgyView}_${Date.now()}.csv`,
            ["Barangay",
             ...(showSvi ? ["SVI Rank (1 = most vulnerable)","SVI Score","SVI Tier"] : []),
             ...(showCap ? ["Capacity Rank (1 = best equipped)","Capacity Score (0-100)","Capacity Tier"] : []),
             ...(showHaz ? ["Flood High/Very High HH","Flood High/Very High %","Landslide Moderate/High HH","Landslide Moderate/High %","Significant hazard exposure (25%+)"] : []),
             "Total HH"],
            filteredBarangays.map(b => [
              b.display_name,
              ...(showSvi ? [b.svi_rank??"—", b.svi_score!=null?b.svi_score.toFixed(2):"—", sviTier(b.svi_rank)] : []),
              ...(showCap ? [b.capacity_rank??"—", b.capacity_score!=null?b.capacity_score.toFixed(2):"—", capDistTierLabel(b.capacity_gap_rank)] : []),
              ...(showHaz ? [b.flood_hi_hh||0, toNum(b.flood_hi_pct).toFixed(1), b.landslide_hi_hh||0, toNum(b.landslide_hi_pct).toFixed(1),
                (toNum(b.flood_hi_pct) >= HZ_SIG || toNum(b.landslide_hi_pct) >= HZ_SIG) ? "Yes" : "No"] : []),
              b.total_households,
            ])
          );
        } else if (activeReport === "highrisk") {
          downloadCSV(`High_Risk_Households_${hrView}_${Date.now()}.csv`,
            hrView === "svi" ? ["Household","Barangay","SVI conditions (of 13)","Which conditions"] : ["Household","Barangay","Flood","Landslide"],
            filteredHouseholds.map(hh => hrView === "svi"
              ? [hhCode(hh.household_number), hrBrgyName(hh.barangay_name), hh.svi_conditions, (hh.svi_flags || []).join("; ")]
              : [hhCode(hh.household_number), hrBrgyName(hh.barangay_name), hh.flood_exposure || "", hh.landslide_exposure || ""])
          );
        } else if (activeReport === "population") {
          downloadCSV(`Population_Profile_${Date.now()}.csv`,
            ["Barangay","SVI Rank","SVI Tier","Total HH","PWD","Seniors","Solo Parents","4Ps"],
            populationSorted.map(b => [b.barangay_name, b.svi_rank ?? "—", sviTier(b.svi_rank), b.total_households, b.pwd_count||0, b.senior_count||0, b.solo_parent_count||0, b.fourps_count||0])
          );
        } else if (activeReport === "planning") {
          downloadCSV(`Planning_Recommendations_${planDomain}_${Date.now()}.csv`,
            ["Barangay","Priority (domains flagged)","Status","Result","Action","Recommendations","Total HH"],
            planningRows.map(r => [r.b.barangay_name, r.p.label, r.pack.badge, `${r.pack.headline} · ${r.pack.sub}`, r.pack.action,
              r.pack.recs.map((x, i) => `${i + 1}. ${recLine(x)}`).join(" | "), r.b.total_households])
          );
        }
      } else {
        if (activeReport === "barangay") {
          printTable(brgyView === "all" ? "Barangay Vulnerability Summary (Three Domains)" : `Barangay Vulnerability — ${BRGY_VIEWS.find(v => v.id === brgyView).label}`, `Municipality of San Miguel, Iloilo · ${now}`,
            ["Barangay", ...(showSvi ? ["SVI Rank","SVI Score","SVI Tier"] : []), ...(showCap ? ["Capacity Rank","Capacity Score","Capacity Tier"] : []),
             ...(showHaz ? ["Flood (High/VH)","Landslide (Mod/High)","25%+"] : []), "Total HH"],
            filteredBarangays.map(b => [
              b.display_name,
              ...(showSvi ? [b.svi_rank??"—", b.svi_score!=null?b.svi_score.toFixed(2):"—", sviTier(b.svi_rank)] : []),
              ...(showCap ? [b.capacity_rank??"—", b.capacity_score!=null?b.capacity_score.toFixed(1):"—", capDistTierLabel(b.capacity_gap_rank)] : []),
              ...(showHaz ? [`${toNum(b.flood_hi_pct).toFixed(1)}% (${b.flood_hi_hh||0})`, `${toNum(b.landslide_hi_pct).toFixed(1)}% (${b.landslide_hi_hh||0})`,
                (toNum(b.flood_hi_pct) >= HZ_SIG || toNum(b.landslide_hi_pct) >= HZ_SIG) ? "Yes" : "No"] : []),
              (b.total_households||0).toLocaleString(),
            ]),
            `Ordered by ${(BRGY_SORTS[brgySort] || BRGY_SORTS.svi).label}. Social Vulnerability Index (SVI), Barangay Capacity and Hazard Exposure are three separate domains, each with its own rank, never combined into one score. SVI rank 1 = most vulnerable; Capacity rank 1 = best equipped. Hazard: share (and number) of households in a High/Very High flood zone or a Moderate/High landslide zone, counted separately; 25%+ = significant exposure.`
          );
        } else if (activeReport === "highrisk") {
          printTable(`High-Risk Households — ${HR_VIEWS.find(v => v[0] === hrView)[1]}${brgyFilter !== "all" ? ` — ${brgyFilter}` : ""}`, `Municipality of San Miguel, Iloilo · ${now} · ${filteredHouseholds.length} households`,
            hrView === "svi" ? ["Household","Barangay","SVI conditions","Which conditions"] : ["Household","Barangay","Flood","Landslide"],
            filteredHouseholds.map(hh => hrView === "svi"
              ? [hhCode(hh.household_number), hrBrgyName(hh.barangay_name), `${hh.svi_conditions} of 13`, (hh.svi_flags || []).join(", ")]
              : [hhCode(hh.household_number), hrBrgyName(hh.barangay_name), hh.flood_exposure || "—", hh.landslide_exposure || "—"]),
            hrView === "svi"
              ? "Social Vulnerability (SVI) only: households with 5 or more of their own 13 SVI conditions, most conditions first. Hazard Exposure is a separate list."
              : "Hazard Exposure only: households in a High/Very High flood zone or a Moderate/High landslide zone, worst level first. Social Vulnerability is a separate list."
          );
        } else if (activeReport === "population") {
          printTable("Population Profile Summary", `Municipality of San Miguel, Iloilo · ${now}`,
            ["Barangay","SVI Tier (rank)","Total HH","PWD","Seniors","Solo Parents","4Ps"],
            populationSorted.map(b => [b.barangay_name, `${sviTier(b.svi_rank)} (#${b.svi_rank ?? "—"})`, (b.total_households||0).toLocaleString(), b.pwd_count||0, b.senior_count||0, b.solo_parent_count||0, b.fourps_count||0]),
            "Household-roster counts. PWD, senior and solo-parent SHARES are 3 of the 13 SVI components; 4Ps is shown for program targeting and is not part of SVI. Sorted by SVI rank (1 = most socially vulnerable)."
          );
        } else {
          const domLabel = PLAN_DOMAINS.find(d => d[0] === planDomain)[1];
          printTable(`Planning Recommendations — ${domLabel}`, `Municipality of San Miguel, Iloilo · ${now}`,
            ["Barangay","Priority","Status","Recommendations","HH"],
            planningRows.map(r => [
              `<strong style="color:#1a237e">${escHtml(r.b.barangay_name)}</strong>`,
              `<span style="background:${r.p.color}18;color:${r.p.color};border:1px solid ${r.p.color}44;border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700;white-space:nowrap">${escHtml(r.p.label)}</span>`,
              `<span style="display:inline-block;background:${r.pack.color}18;color:${r.pack.color};border:1px solid ${r.pack.color}44;border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700">${escHtml(r.pack.badge)}</span><br><span style="font-size:9px;color:#777">${escHtml(r.pack.headline)} · ${escHtml(r.pack.sub)}</span>`,
              `<strong>${escHtml(r.pack.action)}</strong><ol style="margin:3px 0 0 16px;padding:0">${r.pack.recs.map(x => `<li>${escHtml(x.title)} <span style="color:#888;font-size:9px">— ${escHtml(x.reason)}${x.office ? ` · ${escHtml(x.office)}` : ""}</span></li>`).join("")}</ol>`,
              (r.b.total_households||0).toLocaleString(),
            ]),
            `${domLabel} only, the same recommendations as the Planning page. Priority = number of the three domains flagged (not a combined score); the other domains are separate reports.`
          );
        }
      }
      setGenerating(null);
    }, 300);
  };

  const styleFeature = (feature) => {
    const stat = findStat(getFeatureName(feature), barangayStats);
    return { fillColor: HEATMAP_DOMAINS[heatDomain].fill(stat), fillOpacity: 0.78, color: "#1a237e", weight: 1.5 };
  };
  // Tooltip on each barangay: only the selected domain's value.
  const onEachHeatFeature = (feature, layer) => {
    const name = getFeatureName(feature);
    const b = findStat(name, barangayStats);
    let line = "No data";
    if (b) {
      if (heatDomain === "svi")      line = `SVI ${toNum(b.svi_score).toFixed(2)} · rank ${b.svi_rank ?? "—"} (${sviTier(b.svi_rank)})`;
      if (heatDomain === "capacity") line = `Capacity ${toNum(b.capacity_score).toFixed(2)} · rank ${b.capacity_rank ?? "—"} (${capDistTierLabel(b.capacity_gap_rank)})`;
      if (heatDomain === "flood")    line = `${toNum(b.flood_hi_pct).toFixed(1)}% of HH in High/Very-High flood zones (${toNum(b.flood_hi_hh)} HH)`;
      if (heatDomain === "landslide")line = `${toNum(b.landslide_hi_pct).toFixed(1)}% of HH in Moderate/High landslide zones (${toNum(b.landslide_hi_hh)} HH)`;
    }
    layer.bindTooltip(`<strong>${escHtml(b?.barangay_name || name)}</strong><br/>${escHtml(line)}`, { sticky:true });
  };

  const tableConfig = {
    barangay: {
      // Three separate domains, never combined into one score (see
      // thesis-system-handoff.md §1/§3): Social Vulnerability Index (SVI,
      // barangay-level, 11-indicator percentile-rank sum), Capacity +
      // Distance (institutional gaps + facility distance, same rank
      // direction as SVI: rank 1 = worst), and real hazard-exposed
      // household counts (flood/landslide kept separate, no invented
      // barangay-level "hazard rank").
      headers: ["Barangay", ...(showSvi ? ["Rank","Score","Tier"] : []), ...(showCap ? ["Rank","Score (0–100)","Tier"] : []),
        ...(showHaz ? ["Flood","Landslide","25%+"] : []), "Households"],
      rows: filteredBarangays.map(b => ({
        name: b.display_name,
        sviRank: b.svi_rank ?? "—",
        sviScore: b.svi_score != null ? b.svi_score.toFixed(2) : "—",
        sviLabel: sviTier(b.svi_rank),
        sviColor: sviTierColor(b.svi_rank),
        capRank: b.capacity_rank ?? "—",
        capScore: b.capacity_score != null ? b.capacity_score.toFixed(1) : "—",
        capLabel: capDistTierLabel(b.capacity_gap_rank),
        capColor: capDistTierColor(b.capacity_gap_rank),
        hh: (b.total_households||0).toLocaleString(),
        floodPct: toNum(b.flood_hi_pct), floodHH: b.flood_hi_hh || 0,
        slidePct: toNum(b.landslide_hi_pct), slideHH: b.landslide_hi_hh || 0,
        hazSig: toNum(b.flood_hi_pct) >= HZ_SIG || toNum(b.landslide_hi_pct) >= HZ_SIG,
      })),
      total: filteredBarangays.length,
    },
    highrisk: {
      headers: hrView === "svi" ? ["Household","Barangay","SVI conditions","Which conditions"] : ["Household","Barangay","Flood","Landslide"],
      rows: filteredHouseholds.slice(0, getSliceCount(filteredHouseholds.length)).map(hh => ({
        hhno: hhCode(hh.household_number), brgy: hrBrgyName(hh.barangay_name),
        floodLabel: hh.flood_exposure || "—", floodColor: FLOOD_EXPOSURE_COLORS[hh.flood_exposure] || NO_EXPOSURE_COLOR,
        landslideLabel: hh.landslide_exposure || "—", landslideColor: LANDSLIDE_EXPOSURE_COLORS[hh.landslide_exposure] || NO_EXPOSURE_COLOR,
        svi: hh.svi_conditions, sviFlags: (hh.svi_flags || []).join(", "),
        needs: needsText(hh), knows: hh.knows_evacuation, knowsHot: hh.knows_hotline,
      })),
      total: filteredHouseholds.length,
    },
    population: {
      headers: ["Barangay","SVI Tier","Total HH","PWD Members","Senior Citizens","Solo Parents","4Ps Beneficiaries"],
      rows: populationSorted.slice(0, getSliceCount(populationSorted.length)).map(b => ({ name:b.barangay_name, sviLabel:sviTier(b.svi_rank), sviRank:b.svi_rank, sviColor:sviTierColor(b.svi_rank), hh:(b.total_households||0).toLocaleString(), pwd:b.pwd_count||0, senior:b.senior_count||0, solo:b.solo_parent_count||0, fps:b.fourps_count||0 })),
      total: barangayStats.length,
    },
    planning: {
      headers: ["Barangay","Priority","Status","Recommendations","HH"],
      rows: planningRows.slice(0, getSliceCount(planningRows.length)),
      total: planningRows.length,
    },
    heatmap: { headers:[], rows:[], total: barangayStats.length },
    overall: { headers:[], rows:[], total: barangayStats.length },
  };

  const cfg    = tableConfig[activeReport] || { headers:[], rows:[], total:0 };
  const active = REPORTS.find(r => r.id === activeReport);

  // "High risk" is now defined by real hazard exposure alone (flood and/or
  // landslide zone, per household) rather than any combined score --
  // confirmed choice, since the new model deliberately keeps SVI/Capacity/
  // Hazard separate and has no single household-level risk number.
  const hazardExposedHHCount = households.filter(isHazardExposedHH).length;
  // Barangay-level: "high exposure" = a majority (>=50%) of its households
  // are hazard-exposed -- an explicit, stated threshold, not an invented rank.
  const highExposureBrgyCount = barangayStats.filter(b => (b.hazard_exposed_pct||0) >= 0.5).length;

  const summaryItems = [
    { label:"Barangays",       value:barangayStats.length,                                               color:D.textPrimary },
    { label:"Households",      value:(sysStats.total_households||0).toLocaleString(),                    color:D.textPrimary },
    { label:"Individuals",     value:(sysStats.total_individuals||0).toLocaleString(),                   color:D.textPrimary },
    { label:"Hazard-Exposed HH",  value:hazardExposedHHCount.toLocaleString(), color:"#c2410c" },
    { label:"High-Exposure Brgy", value:highExposureBrgyCount,                 color:"#f57c00" },
  ];

  // Show Comparison Page full-screen
  if (showComparison) {
    return <ComparisonPage barangayStats={barangayStats} households={households} onClose={()=>setShowComparison(false)} dark={dark}/>;
  }

  return (
    <div style={{ minHeight:"100%", background:D.pageBg, borderTop:`2px solid ${D.topAccent}`, fontFamily:"'Segoe UI',sans-serif", transition:"background 0.4s ease", display:"flex", flexDirection:"column" }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>

      {/* ── Page Header ── */}
      <div style={{ padding:"16px 24px 0", flexShrink:0 }}>
        <div style={{ background:dark?"linear-gradient(135deg,#131c30,#0f1520)":"#fff", borderRadius:12, border:`1px solid ${D.border}`, boxShadow:dark?"0 2px 16px rgba(0,0,0,0.5),inset 0 -1px 0 rgba(91,141,238,0.15)":"0 1px 6px rgba(0,0,0,0.06)", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:3, height:22, borderRadius:2, background:"linear-gradient(180deg,#5b8dee,#1565c0)", flexShrink:0 }}/>
            <div>
              <div style={{ fontSize:17, fontWeight:800, color:D.textPrimary, lineHeight:1 }}>Reports & Export</div>
              <div style={{ fontSize:11, color:D.textMuted, marginTop:3 }}>Generate, preview, and export vulnerability & resilience reports for LGU planning</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:"#4caf7d", boxShadow:"0 0 6px rgba(76,175,125,0.7)" }}/>
              <span style={{ fontSize:11, color:D.textMuted, fontWeight:500 }}>Live Data</span>
            </div>
            {summaryItems.map(item => (
              <div key={item.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ fontSize:16, fontWeight:800, color:item.color, lineHeight:1 }}>{loading?"—":item.value}</span>
                <span style={{ fontSize:11, color:D.textMuted }}>{item.label}</span>
              </div>
            ))}
            {/* ── COMPARE BUTTON in top bar ── */}
            <button onClick={()=>setShowComparison(true)} title="Compare barangays or households side by side"
              style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 12px", borderRadius:7, fontSize:12, fontWeight:600, background:"transparent", color:dark?"#8fb4ff":"#1a237e", border:`1px solid ${D.border}`, cursor:"pointer", transition:"background 0.15s" }}
              onMouseEnter={e=>{ e.currentTarget.style.background = dark ? "rgba(91,141,238,0.1)" : "#f1f4fb"; }}
              onMouseLeave={e=>{ e.currentTarget.style.background = "transparent"; }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/></svg>
              Compare
            </button>
            <span style={{ fontSize:11, color:D.textMuted, borderLeft:`1px solid ${D.border}`, paddingLeft:16 }}>📅 {now}</span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex:1, padding:"12px 24px 24px", display:"flex", flexDirection:"column", gap:12 }}>

        {/* ── Tabs + Export ── */}
        <div style={{ background:dark?"linear-gradient(135deg,#111828,#0e1422)":"#fff", borderRadius:10, border:`1px solid ${D.border}`, boxShadow:dark?"0 2px 8px rgba(0,0,0,0.4)":"0 1px 4px rgba(0,0,0,0.04)", overflow:"hidden" }}>
        <div style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:10, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.7, marginRight:6 }}>Report</span>
          {REPORTS.map(r => {
            const isActive = activeReport === r.id;
            const isOverall = r.id === "overall";
            const activeSuffix = dark ? "22" : "12";
            const btnBg = isActive ? (r.color + activeSuffix) : isOverall ? (r.color + "08") : "transparent";
            const btnColor = isActive ? r.color : isOverall ? r.color : D.textCell;
            const dotColor = isActive ? r.color : isOverall ? r.color : D.textMuted;
            const btnBorder = `1px solid ${isActive ? r.color : D.border}`;
            return (
              <button key={r.id} onClick={() => setActiveReport(r.id)} style={{
                display:"flex", alignItems:"center", gap:7, padding:"7px 14px", borderRadius:7, fontSize:12,
                fontWeight:isActive?700:500, border:btnBorder,
                background:btnBg, color:btnColor,
                cursor:"pointer", transition:"all 0.15s", whiteSpace:"nowrap",
              }}
                onMouseEnter={e=>{if(!isActive)e.currentTarget.style.background=D.rowHover;}}
                onMouseLeave={e=>{if(!isActive)e.currentTarget.style.background=isOverall?(r.color+"08"):"transparent";}}
              >
                <div style={{ width:7, height:7, borderRadius:"50%", background:dotColor, flexShrink:0 }}/>
                {r.label}
                {isOverall && <span style={{ fontSize:9, background:r.color+"22", color:r.color, borderRadius:3, padding:"1px 5px", fontWeight:700, marginLeft:2 }}>NEW</span>}
              </button>
            );
          })}

        </div>

          {/* Second row: what to show (left) · order + export (right) */}
          {activeReport !== "overall" && activeReport !== "custom" && activeReport !== "typology" && (
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", padding:"9px 14px", borderTop:`1px solid ${D.divider}`, background:dark?"rgba(255,255,255,0.02)":"#fafbfd" }}>
              {activeReport === "barangay" ? (
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <span style={{ fontSize:10, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.7 }}>Show</span>
                  <div role="tablist" aria-label="Domains to show" style={{ display:"flex", padding:3, gap:2, borderRadius:8, background:dark?"#0b0f1a":"#eef1f7", border:`1px solid ${D.border}` }}>
                    {BRGY_VIEWS.map(v => {
                      const on = brgyView === v.id;
                      return (
                        <button key={v.id} role="tab" aria-selected={on} onClick={() => pickBrgyView(v.id)} style={{
                          padding:"5px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:on?700:500, cursor:"pointer", whiteSpace:"nowrap",
                          background:on?(dark?"#1d2a44":"#fff"):"transparent", color:on?(dark?"#cfe0ff":"#1a237e"):D.textCell,
                          boxShadow:on?(dark?"0 1px 3px rgba(0,0,0,0.5)":"0 1px 3px rgba(15,23,42,0.12)"):"none" }}>{v.label}</button>
                      );
                    })}
                  </div>
                </div>
              ) : activeReport === "planning" ? (
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <span style={{ fontSize:10, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.7 }}>Show</span>
                  <div role="tablist" aria-label="Domain" style={{ display:"flex", padding:3, gap:2, borderRadius:8, background:dark?"#0b0f1a":"#eef1f7", border:`1px solid ${D.border}` }}>
                    {PLAN_DOMAINS.map(([id, label]) => {
                      const on = planDomain === id;
                      return (
                        <button key={id} role="tab" aria-selected={on} onClick={() => setPlanDomain(id)} style={{
                          padding:"5px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:on?700:500, cursor:"pointer", whiteSpace:"nowrap",
                          background:on?(dark?"#1d2a44":"#fff"):"transparent", color:on?(dark?"#cfe0ff":"#1a237e"):D.textCell,
                          boxShadow:on?(dark?"0 1px 3px rgba(0,0,0,0.5)":"0 1px 3px rgba(15,23,42,0.12)"):"none" }}>{label}</button>
                      );
                    })}
                  </div>
                </div>
              ) : activeReport === "highrisk" ? (
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <span style={{ fontSize:10, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.7 }}>Show</span>
                  <div role="tablist" aria-label="Which households" style={{ display:"flex", padding:3, gap:2, borderRadius:8, background:dark?"#0b0f1a":"#eef1f7", border:`1px solid ${D.border}` }}>
                    {HR_VIEWS.map(([id, label]) => {
                      const on = hrView === id;
                      return (
                        <button key={id} role="tab" aria-selected={on} onClick={() => setHrView(id)} style={{
                          padding:"5px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:on?700:500, cursor:"pointer", whiteSpace:"nowrap",
                          background:on?(dark?"#1d2a44":"#fff"):"transparent", color:on?(dark?"#cfe0ff":"#1a237e"):D.textCell,
                          boxShadow:on?(dark?"0 1px 3px rgba(0,0,0,0.5)":"0 1px 3px rgba(15,23,42,0.12)"):"none" }}>{label}</button>
                      );
                    })}
                  </div>
                </div>
              ) : <span style={{ fontSize:12, color:D.textMuted }}>{active?.desc}</span>}
            <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              {activeReport === "barangay" && (
                <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:D.textMuted }}>
                  Order by
                  <select value={brgySort} onChange={e=>setBrgySort(e.target.value)} style={{ padding:"6px 10px", border:`1px solid ${D.inputBorder}`, borderRadius:6, fontSize:12, color:D.textBody, background:D.inputBg, outline:"none" }}>
                    {SORTS_FOR_VIEW[brgyView].map(k => <option key={k} value={k}>{BRGY_SORTS[k].label}</option>)}
                  </select>
                </label>
              )}
              {activeReport === "highrisk" && (
                <>
                  {hrView === "hazard" && <select value={hrHazard} onChange={e=>setHrHazard(e.target.value)} style={{ padding:"6px 10px", border:`1px solid ${D.inputBorder}`, borderRadius:6, fontSize:12, color:D.textBody, background:D.inputBg, outline:"none" }}>
                    <option value="any">Flood or landslide</option>
                    <option value="flood">Flood only (High / Very High)</option>
                    <option value="landslide">Landslide only (Moderate / High)</option>
                  </select>}
                  <select value={brgyFilter} onChange={e=>setBrgyFilter(e.target.value)} style={{ padding:"6px 10px", border:`1px solid ${D.inputBorder}`, borderRadius:6, fontSize:12, color:D.textBody, background:D.inputBg, outline:"none", minWidth:140 }}>
                    <option value="all">All barangays</option>
                    {[...barangayStats].map(b => b.display_name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </>
              )}
              {activeReport === "heatmap" ? (
                <>
                  <button onClick={()=>handleExport("heatmap_print")} disabled={!!generating||!geojson} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 16px", borderRadius:7, fontSize:12, fontWeight:600, background:generating==="heatmap_print"?"#555":"linear-gradient(135deg,#6a1b9a,#7b1fa2)", color:"#fff", border:"none", cursor:(generating||!geojson)?"wait":"pointer", opacity:(generating||!geojson)?0.7:1, boxShadow:"0 2px 8px rgba(123,31,162,0.35)" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    {generating==="heatmap_print"?"Generating...":!geojson?"Loading...":"Print Heat Map"}
                  </button>
                  <button onClick={()=>handleExport("heatmap_pdf")} disabled={!!generating||!geojson} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 16px", borderRadius:7, fontSize:12, fontWeight:600, background:generating==="heatmap_pdf"?"#555":"linear-gradient(135deg,#b71c1c,#e53935)", color:"#fff", border:"none", cursor:(generating||!geojson)?"wait":"pointer", opacity:(generating||!geojson)?0.7:1, boxShadow:"0 2px 8px rgba(183,28,28,0.35)" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    {generating==="heatmap_pdf"?"Generating...":!geojson?"Loading...":"Download PDF"}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={()=>handleExport("csv")} disabled={!!generating} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:7, fontSize:12, fontWeight:600, border:`1px solid ${active.color}55`, background:active.color+(dark ? "15" : "0d"), color:active.color, cursor:generating?"wait":"pointer", opacity:generating?0.7:1 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    {generating==="csv"?"Exporting...":"Export CSV"}
                  </button>
                  <button onClick={()=>handleExport("print")} disabled={!!generating} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:7, fontSize:12, fontWeight:600, background:"linear-gradient(135deg,#1a237e,#1565c0)", color:"#fff", border:"none", cursor:generating?"wait":"pointer", opacity:generating?0.7:1, boxShadow:"0 2px 8px rgba(21,101,192,0.3)" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    {generating==="print"?"Opening...":"Print / PDF"}
                  </button>
                </>
              )}
            </div>
            </div>
          )}
        </div>

        {/* ── Main card ── */}
        <div style={{ background:D.cardBg, borderRadius:12, border:`1px solid ${D.border}`, boxShadow:D.shadow, overflow:"hidden", flex:1, display:"flex", flexDirection:"column", animation:"fadeIn 0.2s ease" }}>

          {/* Card header */}
          <div style={{ background:activeReport==="heatmap"?"linear-gradient(135deg,#4a0072,#7b1fa2)":activeReport==="overall"?"linear-gradient(135deg,#004d40,#00838f)":activeReport==="custom"?"linear-gradient(135deg,#134e4a,#0f766e)":activeReport==="typology"?"linear-gradient(135deg,#312e81,#4f46e5)":D.headerGrad, padding:"13px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:3, height:16, borderRadius:2, background:"rgba(255,255,255,0.5)", flexShrink:0 }}/>
              <div>
                <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>{active?.label}</div>
                <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:1 }}>{activeReport === "barangay" && brgyView !== "all" ? `Each barangay's ${BRGY_VIEWS.find(v => v.id === brgyView).label} result only` : active?.desc}</div>
              </div>
            </div>
            {activeReport !== "overall" && activeReport !== "custom" && activeReport !== "typology" && (
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:20, padding:"3px 12px", fontSize:11, color:"#fff", fontWeight:600 }}>
                  {loading?"...":cfg.total} {BARANGAY_LEVEL.includes(activeReport) ? "barangays" : "records"}
                </div>
                {activeReport !== "heatmap" && !BARANGAY_LEVEL.includes(activeReport) && (
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {[10, 30, 50, "all", "custom"].map(opt => (
                      <button key={opt} onClick={()=>setPreviewLimit(opt)} style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none", transition:"all 0.15s", background:previewLimit===opt?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.15)", color:previewLimit===opt?"#1a237e":"rgba(255,255,255,0.8)" }}>
                        {opt==="all"?"All":opt==="custom"?"Custom":`Top ${opt}`}
                      </button>
                    ))}
                    {previewLimit==="custom"&&(
                      <input type="number" min="1" placeholder="e.g. 25" value={customLimit} onChange={e=>setCustomLimit(e.target.value)} style={{ width:70, padding:"3px 8px", borderRadius:6, border:"1px solid rgba(255,255,255,0.4)", background:"rgba(255,255,255,0.15)", color:"#fff", fontSize:11, outline:"none" }}/>
                    )}
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.5)" }}>showing {previewLimit==="all"?cfg.total:previewLimit==="custom"?(parseInt(customLimit)||10):Math.min(previewLimit,cfg.total)} of {cfg.total}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Custom Report Tab ── */}
          {activeReport === "custom" && <CustomPopulationReport D={D} dark={dark} />}

          {/* ── Household Typology Tab ── */}
          {activeReport === "typology" && (
            <TypologyReportTab barangayStats={barangayStats} households={households} D={D} dark={dark} loading={loading}
              downloadCSV={downloadCSV} printTable={printTable} />
          )}

          {/* ── Overall Report Tab ── */}
          {activeReport === "overall" && (
            <OverallReportTab
              barangayStats={barangayStats}
              households={households}
              sysStats={sysStats}
              geojson={geojson}
              dark={dark}
              D={D}
            />
          )}

          {/* ── Heatmap view: ONE domain at a time ── */}
          {activeReport === "heatmap" && (() => {
            const dom = HEATMAP_DOMAINS[heatDomain];
            return (
            <div style={{ flex:1, display:"flex", flexDirection:"column", padding:20, gap:14 }}>
              {/* Domain switcher */}
              <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                <span style={{ fontSize:11, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5 }}>Map domain</span>
                <div style={{ display:"flex", background:D.subBg, border:`1px solid ${D.border}`, borderRadius:9, padding:3, gap:3 }}>
                  {HEATMAP_DOMAIN_ORDER.map(k => {
                    const d = HEATMAP_DOMAINS[k], on = heatDomain === k;
                    return (
                      <button key={k} onClick={() => setHeatDomain(k)}
                        style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 14px", borderRadius:7, border:"none", cursor:"pointer",
                          background: on ? (dark ? "#1a2540" : "#ffffff") : "transparent",
                          boxShadow: on ? (dark ? "0 1px 4px rgba(0,0,0,0.5)" : "0 1px 4px rgba(26,35,126,0.12)") : "none",
                          fontSize:12, fontWeight: on ? 700 : 500, color: on ? d.color : D.textCell, transition:"all 0.15s" }}>
                        <span style={{ fontSize:9, fontWeight:800, color:"#fff", background: on ? d.color : (dark ? "#3d4560" : "#b8bfcc"), borderRadius:4, padding:"1px 6px" }}>{d.tag}</span>
                        {d.title.replace(" (SVI)", "")}
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize:11, color:D.textMuted }}>One domain per map — the three domains are never blended into one color.</span>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 240px", gap:16, flex:1 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>
                    Preview — <span style={{ color:dom.color }}>{dom.title}</span> · {dom.mapTitle2 || dom.mapTitle}
                  </div>
                  <div ref={mapRef} style={{ borderRadius:8, overflow:"hidden", border:`1px solid ${D.border}`, height:520, boxShadow:dark?"0 4px 16px rgba(0,0,0,0.5)":"0 2px 12px rgba(26,35,126,0.1)" }}>
                    {geojson && barangayStats.length > 0 ? (
                      <MapContainer center={[10.87, 122.46]} zoom={5} style={{ height:"100%", width:"100%" }} zoomControl={true} scrollWheelZoom={true} preferCanvas={true}>
                        {dom.hazardMap ? (
                          <>
                            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxZoom={19}/>
                            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19}/>
                          </>
                        ) : (
                          <TileLayer url={dark?"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png":"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"} attribution="© OpenStreetMap contributors" crossOrigin="anonymous"/>
                        )}
                        <FitBounds geojson={geojson}/>
                        {dom.hazardMap && hazardZones[heatDomain] && (
                          <GeoJSON key={"zones" + heatDomain} data={hazardZones[heatDomain]} interactive={false}
                            style={f => { const c = dom.zoneColors[f.properties?.[dom.zoneProp]] || "#94a3b8"; return { fillColor:c, fillOpacity:0.5, color:c, weight:0.6, opacity:0.8 }; }}/>
                        )}
                        <GeoJSON key={heatDomain + barangayStats.length + dark} data={geojson} onEachFeature={onEachHeatFeature}
                          style={dom.hazardMap ? () => ({ fill:true, fillOpacity:0, color:"#ffffff", weight:1.6, opacity:0.95 }) : styleFeature}/>
                        {dom.hazardMap && hazardPoints(households, dom).map((pt, i) => (
                          <CircleMarker key={i} center={[pt.lat, pt.lng]} radius={pt.level === dom.dotLevels[0] ? 4 : 3}
                            pathOptions={{ color:"#ffffff", weight:1, fillColor:pt.color, fillOpacity:1 }}>
                            <LTooltip>{`${dom.key === "flood" ? "Flood" : "Landslide"} · ${pt.level}`}</LTooltip>
                          </CircleMarker>
                        ))}
                      </MapContainer>
                    ) : (
                      <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:D.textMuted, fontSize:13 }}>{loading?"Loading map...":"Map data unavailable"}</div>
                    )}
                  </div>
                  <div style={{ fontSize:10.5, color:D.textMuted, marginTop:8 }}>
                    Hover a barangay for its {dom.title.toLowerCase()} value. <strong style={{ color:D.textPrimary }}>Print Heat Map</strong> / <strong style={{ color:D.textPrimary }}>Download PDF</strong> export the domain selected here, with its legend, summary and full barangay table.
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ background:D.subBg, borderRadius:8, padding:14, border:`1px solid ${D.border}`, borderTop:`3px solid ${dom.color}` }}>
                    <div style={{ fontSize:11, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>Legend</div>
                    {dom.legend.map(l => (
                      <div key={l.label} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                        <div style={{ width:12, height:12, borderRadius:l.dot ? "50%" : 3, background:l.color, border:l.dot ? "2px solid #fff" : "1px solid rgba(0,0,0,0.08)", boxShadow:l.dot ? "0 0 0 1px rgba(0,0,0,0.25)" : "none", flexShrink:0 }}/>
                        <span style={{ fontSize:12, color:D.textCell, flex:1, fontWeight:500 }}>{l.label}</span>
                        <span style={{ fontSize:10, color:D.textMuted }}>{l.range}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ background:D.subBg, borderRadius:8, padding:14, border:`1px solid ${D.border}` }}>
                    <div style={{ fontSize:11, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>Summary</div>
                    {dom.summary(barangayStats).map(item => (
                      <div key={item.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, padding:"5px 0", borderBottom:`1px solid ${D.divider}` }}>
                        <span style={{ fontSize:11, color:D.textCell }}>{item.label}</span>
                        <span style={{ fontSize:14, fontWeight:800, color:item.color || D.textPrimary, whiteSpace:"nowrap" }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ background:dark?"#0e1628":"#e8f0fe", border:`1px solid ${dark?"#1a2a50":"#c5d8fb"}`, borderRadius:8, padding:"12px 14px" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>How this domain is measured</div>
                    <div style={{ fontSize:10.5, color:D.textBody, lineHeight:1.6 }}>{dom.method}</div>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}

          {/* ── Table views (barangay, highrisk, population, planning) ── */}
          {activeReport === "barangay" && (
            <div style={{ margin:"14px 20px 0", padding:"10px 14px", background:dark?"#0f1828":"#f0f4ff", border:`1px solid ${dark?"#1a2a50":"#c5d8fb"}`, borderRadius:8, fontSize:11.5, color:dark?"#8b95a9":"#444", lineHeight:1.5 }}>
              <strong style={{ color:D.textPrimary }}>Note:</strong> Social Vulnerability Index (SVI), Barangay Capacity, and Hazard Exposure are <strong>three separate domains</strong> — they are never combined into one score. Each domain has its own rank: SVI rank 1 = most vulnerable, Capacity rank 1 = best equipped (tiers are equal 6-barangay groups by rank). Hazard shows the share and number of households in a High/Very High flood zone and in a Moderate/High landslide zone, counted separately; "25%+" marks significant exposure, the same rule the Planning page uses.
            </div>
          )}
          {activeReport === "highrisk" && (
            <div style={{ margin:"14px 20px 0", padding:"10px 14px", background:dark?"#2a0a0a":"#fff1f0", border:`1px solid ${dark?"#4a1010":"#f7c6c0"}`, borderRadius:8, fontSize:11.5, color:dark?"#e0a0a0":"#444", lineHeight:1.5 }}>
              <strong style={{ color:D.textPrimary }}>Note:</strong> One domain at a time. {hrView === "hazard"
                ? <><strong>Hazard Exposure</strong>: households whose GPS point is in a High/Very High flood zone or a Moderate/High landslide zone. Worst level first.</>
                : <><strong>Social Vulnerability (SVI)</strong>: households with 5 or more of the 13 SVI conditions (food insecurity, overcrowding, no internet, weak roof, weak walls, insecure tenure, unimproved toilet, low adult schooling, a PWD, a senior, a solo parent, more than 2 km from the RHU, more than 2 km from the fire station). Most conditions first.</>}
              {" "}Barangay Capacity is scored per barangay, so it has no household list.{riskErr ? ` Could not load: ${riskErr}` : ""}
            </div>
          )}
          {activeReport === "population" && (
            <div style={{ margin:"14px 20px 0", padding:"10px 14px", background:dark?"#0a1f10":"#f0faf2", border:`1px solid ${dark?"#153a20":"#bfe3c8"}`, borderRadius:8, fontSize:11.5, color:dark?"#8bc49a":"#444", lineHeight:1.5 }}>
              <strong style={{ color:D.textPrimary }}>Note:</strong> Household-roster counts per barangay, sorted by <strong>SVI rank</strong> (most socially vulnerable first). The PWD, senior-citizen and solo-parent <em>shares</em> are 3 of the 13 SVI components; 4Ps is shown for program targeting only and is not part of any domain score.
            </div>
          )}
          {activeReport === "planning" && (
            <div style={{ margin:"14px 20px 0", padding:"10px 14px", background:dark?"#2a1500":"#fff8ef", border:`1px solid ${dark?"#4a2a08":"#fbd7a8"}`, borderRadius:8, fontSize:11.5, color:dark?"#e0b080":"#444", lineHeight:1.5 }}>
              <strong style={{ color:D.textPrimary }}>Note:</strong> One domain at a time, with the <strong>same statuses and recommendations as the Planning page</strong>. <strong>Priority</strong> counts how many of the three domains are flagged; it is not a combined score.
            </div>
          )}
          {activeReport === "planning" && !loading && (
            <div style={{ margin:"10px 20px 4px", padding:"10px 14px", borderRadius:8, border:`1px solid ${D.border}`, background:D.subBg, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:D.textPrimary }}>Barangay report (PDF)</div>
              <div style={{ fontSize:11.5, color:D.textMuted, flex:"1 1 220px" }}>Same report as the Planning page, listing <strong>every</strong> household to look out for in the barangay.</div>
              <select value={planBrgy || planningRows[0]?.b.barangay_name || ""} onChange={e => setPlanBrgy(e.target.value)} style={{ padding:"6px 10px", border:`1px solid ${D.inputBorder}`, borderRadius:6, fontSize:12, color:D.textBody, background:D.inputBg }}>
                {[...planShape].sort((a, b) => a.barangay_name.localeCompare(b.barangay_name, undefined, { numeric: true })).map(b => <option key={b.barangay_name} value={b.barangay_name}>{b.barangay_name}</option>)}
              </select>
              <select value={planScope} onChange={e => setPlanScope(e.target.value)} style={{ padding:"6px 10px", border:`1px solid ${D.inputBorder}`, borderRadius:6, fontSize:12, color:D.textBody, background:D.inputBg }}>
                <option value="domain">{PLAN_DOMAINS.find(d => d[0] === planDomain)[1]} only</option>
                <option value="all">All three domains (one section each)</option>
              </select>
              <button onClick={downloadBarangayPlan} disabled={!!planBusy} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:7, fontSize:12, fontWeight:700, border:"none", background:"linear-gradient(135deg,#1a237e,#1565c0)", color:"#fff", cursor:planBusy?"wait":"pointer", opacity:planBusy?0.75:1 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {planBusy || "Download PDF"}
              </button>
              <div style={{ flexBasis:"100%", fontSize:10.5, color:"#b91c1c" }}>Lists household heads' names — confidential, for LGU use only (RA 10173).</div>
            </div>
          )}
          {activeReport !== "heatmap" && activeReport !== "overall" && activeReport !== "custom" && activeReport !== "typology" && (
            <div style={{ flex:1, overflowX:"auto" }}>
              {loading ? (
                <div style={{ padding:60, textAlign:"center", color:D.textMuted, fontSize:13 }}>Loading report data...</div>
              ) : (
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    {activeReport === "barangay" && (
                      <tr style={{ background:D.subBg }}>
                        <th style={{ padding:"10px 14px 4px" }} />
                        {[showSvi && ["Social Vulnerability (SVI)", 3, "rank 1 = most vulnerable"], showCap && ["Barangay Capacity", 3, "rank 1 = best equipped"],
                          showHaz && ["Hazard Exposure", 3, "% of households in a high zone · count"], ["", 1, ""]].filter(Boolean).map(([t, n, sub], i) => (
                          <th key={i} colSpan={n} style={{ padding:"10px 10px 4px", textAlign:"left", borderLeft:`2px solid ${D.border}`, verticalAlign:"bottom" }}>
                            {t && <div style={{ fontSize:12, fontWeight:800, color:D.textPrimary }}>{t}</div>}
                            {sub && <div style={{ fontSize:10.5, fontWeight:500, color:D.textMuted, marginTop:1, textTransform:"none" }}>{sub}</div>}
                          </th>
                        ))}
                      </tr>
                    )}
                    {activeReport === "highrisk" && (
                      <tr style={{ background:D.subBg }}>
                        <th colSpan={2} style={{ padding:"10px 16px 4px" }} />
                        {[hrView === "hazard" ? ["Hazard Exposure", 2, "flood · landslide zone at the household's GPS point"] : ["Social Vulnerability (SVI)", 2, "the household's own count of the 13 SVI conditions"]].map(([t, n, sub]) => (
                          <th key={t} colSpan={n} style={{ padding:"10px 16px 4px", textAlign:"left", borderLeft:`2px solid ${D.border}`, verticalAlign:"bottom" }}>
                            <div style={{ fontSize:12, fontWeight:800, color:D.textPrimary }}>{t}</div>
                            <div style={{ fontSize:10.5, fontWeight:500, color:D.textMuted, marginTop:1, textTransform:"none" }}>{sub}</div>
                          </th>
                        ))}
                      </tr>
                    )}
                    <tr style={{ background:D.subBg, borderBottom:`2px solid ${D.border}` }}>
                      {activeReport === "highrisk" ? cfg.headers.map((h, i) => (
                        <th key={i} style={{ padding:"8px 16px", textAlign:"left", fontWeight:700, fontSize:11, color:dark?"#6b7590":"#555", textTransform:"uppercase", letterSpacing:0.5, whiteSpace:"nowrap",
                          borderLeft: i === 2 ? `2px solid ${D.border}` : "none" }}>{h}</th>
                      )) : activeReport === "barangay" ? cfg.headers.map((h, i) => (
                        <th key={i} style={{ padding:"8px 10px", paddingLeft: i === 0 ? 14 : 10, textAlign:"left", fontWeight:700, fontSize:11, color:dark?"#6b7590":"#555", textTransform:"uppercase", letterSpacing:0.5, whiteSpace:"nowrap",
                          borderLeft: (i === 1 || (i > 1 && (i - 1) % 3 === 0)) ? `2px solid ${D.border}` : "none" }}>{h}</th>
                      )) : cfg.headers.map(h=>(
                        <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontWeight:700, fontSize:11, color:dark?"#6b7590":"#555", textTransform:"uppercase", letterSpacing:0.5, whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cfg.rows.length === 0 ? (
                      <tr><td colSpan={cfg.headers.length} style={{ padding:48, textAlign:"center", color:D.textMuted, fontSize:13 }}>No records match the current filter.</td></tr>
                    ) : cfg.rows.map((row, i) => (
                      <tr key={i} style={{ background:i%2===0?D.rowEven:D.rowOdd, borderBottom:`1px solid ${D.divider}`, transition:"background 0.1s" }}
                        onMouseEnter={e=>e.currentTarget.style.background=D.rowHover}
                        onMouseLeave={e=>e.currentTarget.style.background=i%2===0?D.rowEven:D.rowOdd}>
                        {activeReport==="barangay"&&(() => {
                          const sep = { borderLeft:`2px solid ${D.border}` };
                          const rankCell = (v, c) => <span style={{ display:"inline-block", minWidth:28, textAlign:"center", padding:"2px 6px", borderRadius:6, fontWeight:800, fontSize:12, color:c, background:c+(dark?"1f":"12") }}>{v}</span>;
                          const pill = (t, c) => <span style={{background:c+(dark ? "22" : "15"),color:c,border:`1px solid ${c}44`,borderRadius:5,padding:"3px 9px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{t}</span>;
                          const hz = (pct, n) => <span style={{ fontWeight:700, color: pct >= HZ_SIG ? "#dc2626" : pct > 0 ? D.textBody : D.textMuted }}>{pct.toFixed(1)}%<span style={{ fontWeight:500, color:D.textMuted, fontSize:11 }}> · {n}</span></span>;
                          return <>
                            <td style={{padding:"10px 14px",fontWeight:600,color:D.textPrimary,whiteSpace:"nowrap"}}>{row.name}</td>
                            {showSvi && <>
                            <td style={{padding:"10px 10px",...sep}}>{rankCell(row.sviRank, row.sviColor)}</td>
                            <td style={{padding:"10px 10px",fontWeight:700,color:row.sviColor}}>{row.sviScore}</td>
                            <td style={{padding:"10px 10px"}}>{pill(row.sviLabel, row.sviColor)}</td>
                            </>}
                            {showCap && <>
                            <td style={{padding:"10px 10px",...sep}}>{rankCell(row.capRank, row.capColor)}</td>
                            <td style={{padding:"10px 10px",fontWeight:700,color:row.capColor}}>{row.capScore}</td>
                            <td style={{padding:"10px 10px"}}>{pill(row.capLabel, row.capColor)}</td>
                            </>}
                            {showHaz && <>
                            <td style={{padding:"10px 10px",whiteSpace:"nowrap",...sep}}>{hz(row.floodPct, row.floodHH)}</td>
                            <td style={{padding:"10px 10px",whiteSpace:"nowrap"}}>{hz(row.slidePct, row.slideHH)}</td>
                            <td style={{padding:"10px 10px"}}>{row.hazSig ? pill("Yes", "#dc2626") : <span style={{ color:D.textMuted, fontSize:11 }}>No</span>}</td>
                            </>}
                            <td style={{padding:"10px 14px",color:D.textCell,...sep}}>{row.hh}</td>
                          </>;
                        })()}
                        {activeReport==="highrisk"&&<>
                          <td style={{padding:"10px 16px",fontWeight:700,color:D.textPrimary,whiteSpace:"nowrap"}}>{row.hhno}</td>
                          <td style={{padding:"10px 16px",color:D.textCell,whiteSpace:"nowrap"}}>{row.brgy}</td>
                          {hrView === "hazard" ? <>
                            <td style={{padding:"10px 16px",borderLeft:`2px solid ${D.border}`}}>{row.floodLabel === "—" ? <span style={{color:D.textMuted}}>—</span> : <span style={{background:row.floodColor+(dark ? "22" : "15"),color:row.floodColor,border:`1px solid ${row.floodColor}44`,borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{row.floodLabel}</span>}</td>
                            <td style={{padding:"10px 16px"}}>{row.landslideLabel === "—" ? <span style={{color:D.textMuted}}>—</span> : <span style={{background:row.landslideColor+(dark ? "22" : "15"),color:row.landslideColor,border:`1px solid ${row.landslideColor}44`,borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{row.landslideLabel}</span>}</td>
                          </> : <>
                            <td style={{padding:"10px 16px",borderLeft:`2px solid ${D.border}`,whiteSpace:"nowrap"}}>
                              <span style={{ fontWeight:800, color:"#7c3aed" }}>{row.svi} of 13</span>
                            </td>
                            <td style={{padding:"10px 16px",fontSize:12,color:D.textBody,lineHeight:1.5}}>{row.sviFlags || "—"}</td>
                          </>}
                        </>}
                        {activeReport==="population"&&<>
                          <td style={{padding:"10px 16px",fontWeight:600,color:D.textPrimary}}>{row.name}</td>
                          <td style={{padding:"10px 16px",whiteSpace:"nowrap"}}><span style={{background:row.sviColor+(dark ? "22" : "15"),color:row.sviColor,border:`1px solid ${row.sviColor}44`,borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:700}}>{row.sviLabel}</span><span style={{fontSize:10.5,color:D.textMuted,marginLeft:6}}>#{row.sviRank ?? "—"}</span></td>
                          <td style={{padding:"10px 16px",color:D.textCell}}>{row.hh}</td>
                          <td style={{padding:"10px 16px",fontWeight:700,color:"#7c3aed"}}>{row.pwd}</td>
                          <td style={{padding:"10px 16px",fontWeight:700,color:"#1565c0"}}>{row.senior}</td>
                          <td style={{padding:"10px 16px",fontWeight:700,color:"#c62828"}}>{row.solo}</td>
                          <td style={{padding:"10px 16px",fontWeight:700,color:"#f57c00"}}>{row.fps}</td>
                        </>}
                        {activeReport==="planning"&&(() => {
                          const pill = (color, label) => <span style={{background:color+(dark ? "22" : "15"),color,border:`1px solid ${color}44`,borderRadius:5,padding:"2px 9px",fontSize:10.5,fontWeight:700,whiteSpace:"nowrap"}}>{label}</span>;
                          const pk = row.pack;
                          return <>
                            <td style={{padding:"12px 16px",fontWeight:600,color:D.textPrimary,verticalAlign:"top",whiteSpace:"nowrap"}}>{row.b.barangay_name}</td>
                            <td style={{padding:"12px 16px",verticalAlign:"top"}}>{pill(row.p.color, row.p.label)}</td>
                            <td style={{padding:"12px 16px",verticalAlign:"top",minWidth:200}}>
                              {pill(pk.color, pk.badge)}
                              <div style={{fontSize:12,fontWeight:700,color:pk.color,marginTop:5}}>{pk.headline}</div>
                              <div style={{fontSize:11,color:D.textMuted,marginTop:1}}>{pk.sub}</div>
                            </td>
                            <td style={{padding:"12px 16px",verticalAlign:"top"}}>
                              <div style={{fontSize:12.5,fontWeight:700,color:D.textPrimary,marginBottom:4}}>{pk.action}</div>
                              <ol style={{margin:0,paddingLeft:18,fontSize:12,color:D.textBody,lineHeight:1.5}}>
                                {pk.recs.map((r, k) => (
                                  <li key={k}>{r.title} <span style={{fontSize:11,color:pk.color}}>· {r.reason}</span>{r.office && <span style={{fontSize:11,color:D.textMuted}}> · {r.office}</span>}</li>
                                ))}
                              </ol>
                            </td>
                            <td style={{padding:"12px 16px",color:D.textCell,verticalAlign:"top"}}>{(row.b.total_households||0).toLocaleString()}</td>
                          </>;
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding:"10px 20px", borderTop:`1px solid ${D.divider}`, background:D.subBg, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
              {activeReport === "barangay" ? (
                <span style={{ fontSize:10, color:D.textMuted }}>
                  SVI, Capacity & Hazard Exposure are <strong style={{ color:D.textPrimary }}>three separate domains</strong> — never combined into one score. SVI/Capacity tiers: equal 6-barangay quartiles by rank position.
                </span>
              ) : (activeReport === "heatmap" || activeReport === "overall") ? (
                <span style={{ fontSize:10, color:D.textMuted }}>
                  SVI, Capacity & Hazard Exposure are <strong style={{ color:D.textPrimary }}>three separate domains</strong> — never combined into one score or one map color. Tiers: equal 6-barangay quartiles by rank · Hazard significant at ≥{HAZARD_FLAG_PCT}% of households.
                </span>
              ) : activeReport === "highrisk" ? (
                <span style={{ fontSize:10, color:D.textMuted }}>
                  One domain at a time: <strong style={{ color:D.textPrimary }}>Hazard</strong> and <strong style={{ color:D.textPrimary }}>SVI</strong> are separate lists, never combined.
                </span>
              ) : activeReport === "custom" ? (
                <span style={{ fontSize:10, color:D.textMuted }}>
                  Counts come from the live CBMS member records · each person is counted once, in the barangay of their household.
                </span>
              ) : activeReport === "typology" ? (
                <span style={{ fontSize:10, color:D.textMuted }}>
                  Household profiles are <strong style={{ color:D.textPrimary }}>descriptive</strong> (k-modes, k = 5) · not a score, not a rank, not combined with SVI, Capacity or Hazard.
                </span>
              ) : activeReport === "population" ? (
                <span style={{ fontSize:10, color:D.textMuted }}>
                  Sorted by <strong style={{ color:D.textPrimary }}>SVI rank</strong> · PWD, senior & solo-parent shares are SVI indicators · 4Ps shown for targeting only.
                </span>
              ) : (
                <span style={{ fontSize:10, color:D.textMuted }}>
                  One recommendation <strong style={{ color:D.textPrimary }}>per domain</strong> · Priority = number of flagged domains (SVI/Capacity top two tiers; hazard ≥{HAZARD_FLAG_PCT}%), not a combined score.
                </span>
              )}
            </div>
            <span style={{ fontSize:10, color:D.textMuted }}>LGU-SDSS - Municipality of San Miguel, Iloilo</span>
          </div>
        </div>
      </div>
    </div>
  );
}