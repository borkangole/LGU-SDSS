import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PlanningMap from "./PlanningMap";
import { buildPlanningReport } from "./planningReport";
import { getVulnBarangaySummary, getDomainBarangays, getDomainCapacity } from '../../api/api';
import { capacityGapFields, capacityGapRank, CAP_GAP_TIER_COLORS, CAP_GAP_TIER_LABEL, CAPACITY_GAP_ITEMS } from "../capacity/capacityShared";
import { useTheme } from "../../hooks/useTheme";
import { SVI_TIER_COLORS as SHARED_SVI_TIER_COLORS } from "../shared/domainColors";
import { getParam, setParam, useUrlParam } from "../../hooks/useRoute";
import { sviRecommendations, capacityRecommendations, hazardRecommendations } from "./planningRecommendations";

const toNum = (v) => parseFloat(v) || 0;

// Human labels for the 11 raw SVI indicator proportions, matching
// CORE_SOCIAL_LABELS in backend/routes/domain_vulnerability_routes.py --
// used only to name the top drivers behind a barangay's SVI tier, never
// to recompute or re-rank the score itself.
const SVI_INDICATOR_LABELS = {
  overcrowding_prop: "Overcrowding",
  food_insecure_prop: "Food insecurity",
  no_internet_prop: "No internet access",
  weak_roof_prop: "Weak roof material",
  weak_wall_prop: "Weak wall material",
  insecure_tenure_prop: "Insecure tenure",
  unimproved_sanitation_prop: "Unimproved sanitation",
  pwd_prop: "PWD population share",
  senior_prop: "Senior citizen population share",
  solo_parent_prop: "Solo-parent population share",
  low_adult_education_prop: "Low adult education rate",
};

// Same barangay-name normalization used across the app (ReportsPage.jsx,
// NetworkAnalysis.jsx) -- strips every "barangay" spelling the different
// data sources use ("Brgy", "Bgy.", "Barangay") plus the domain-pipeline
// CSVs' trailing "Pob."/"Poblacion" suffix on numbered barangays, and
// expands the naive rollup's "Sto"/"Sta" abbreviations to match the
// pipeline's full "Santo"/"Santa" spelling.
function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\bbrgy\.?\s*/gi,"").replace(/\bbgy\.?\s*/gi,"").replace(/\bbarangay\s*/gi,"")
    .replace(/\bpob(lacion)?\.?\s*/gi,"")
    .replace(/ñ/g,"n").replace(/[^a-z0-9\s]/g,"")
    .replace(/\s+/g," ").trim()
    .replace(/\bsto\b/g, "santo")
    .replace(/\bsta\b/g, "santa");
}
function fuzzyFind(name, list, field = "barangay_name") {
  if (!name) return null;
  const fNorm = normalizeName(name);
  const exact = list.find(x => normalizeName(x[field]) === fNorm);
  if (exact) return exact;
  if (/^\d+$/.test(fNorm)) return null;
  return list.find(x => {
    const xNorm = normalizeName(x[field]);
    if (/^\d+$/.test(xNorm)) return false;
    return xNorm.includes(fNorm) || fNorm.includes(xNorm);
  }) || null;
}

// Barangay-level tiers -- equal 6-barangay quartiles BY RANK POSITION
// (never fixed score cutoffs), same convention as ReportsPage.jsx and the
// thesis handoff doc §3.2. Rank 1 = worst in each domain, both for SVI
// (most socially vulnerable) and Barangay Capacity (most institutional
// gaps + farthest from facilities) -- same rank direction, deliberately.
function rankTier(rank) {
  if (rank == null) return "No Data";
  if (rank <= 6)  return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}
const SVI_TIER_COLORS = SHARED_SVI_TIER_COLORS; // red -> orange -> amber -> green
function sviTier(rank)      { return rankTier(rank); }
function sviTierColor(rank) { return SVI_TIER_COLORS[rankTier(rank)]; }

// Barangay Capacity (resources and readiness), read as a gap: gap rank 1 =
// least equipped, so the flags below work like SVI's. The rank shown is
// always the real capacity_rank (1 = best equipped).
const CAPDIST_TIER_COLORS = CAP_GAP_TIER_COLORS;
function capDistTier(gapRank)      { return rankTier(gapRank); }
function capDistTierColor(gapRank) { return CAPDIST_TIER_COLORS[rankTier(gapRank)]; }
function capDistTierLabel(gapRank) { return CAP_GAP_TIER_LABEL[rankTier(gapRank)]; }

// "Significant" hazard exposure at barangay level reuses the exact same
// flood/landslide thresholds as the household-level "High-Risk Households"
// report (see ReportsPage.jsx) and the pipeline's own
// hazard_exposure_by_barangay.csv columns -- a barangay is flagged when at
// least a quarter of its (mapped) households sit in the High/Very-High
// flood band or the Moderate/High landslide band. Flood and landslide are
// always evaluated and shown separately, never summed.
const HAZARD_FLAG_PCT = 25;
function isHazardSignificant(b) {
  return toNum(b.flood_pct) >= HAZARD_FLAG_PCT || toNum(b.landslide_pct) >= HAZARD_FLAG_PCT;
}

// Shared read of the three domains -- used by BOTH generateInsights() (the
// detail-panel prose) and priorityInfo() (the scannable list badge/sort
// below), so the two can never drift out of sync with each other.
function domainFlags(b) {
  const sviT = sviTier(b.svi_rank);
  const capT = capDistTier(b.capacity_gap_rank);
  const floodPct = toNum(b.flood_pct);
  const landslidePct = toNum(b.landslide_pct);
  const hazardHigh = isHazardSignificant(b);
  const sviBad = sviT === "High" || sviT === "Moderate-high";
  const capBad = capT === "High" || capT === "Moderate-high";
  return { sviT, capT, floodPct, landslidePct, hazardHigh, sviBad, capBad };
}

// A single scannable priority level for the LIST view -- generateInsights()
// below gives the full prose explanation once a barangay is opened, but a
// planner scanning all 24 rows shouldn't have to click each one just to
// find out which ones are urgent. This reads the exact same three domain
// flags as generateInsights() (via domainFlags) and reduces them to one
// rank + badge, purely for scanning/sorting -- it is a display label, not
// a new computed score, and the underlying domains are still shown
// separately in their own columns.
function priorityInfo(b) {
  if (b.svi_rank == null && b.capacity_gap_rank == null)
    return { rank:0, label:"No data yet", color:"#94a3b8" };
  const { sviBad, capBad, hazardHigh } = domainFlags(b);
  const badCount = (sviBad?1:0) + (capBad?1:0) + (hazardHigh?1:0);
  if (sviBad && capBad && hazardHigh) return { rank:5, label:"Top Priority",       color:"#7b1fa2" };
  if (badCount >= 2)                  return { rank:4, label:"High Priority",      color:"#dc2626" };
  if (sviBad)                         return { rank:3, label:"Watch — SVI",        color:"#f97316" };
  if (capBad)                         return { rank:3, label:"Watch — Capacity",   color:"#c2410c" };
  if (hazardHigh)                     return { rank:2, label:"Watch — Hazard",     color:"#1565c0" };
  return                                     { rank:1, label:"Monitor",            color:"#388e3c" };
}

// Cross-tabs the THREE independently-computed domains (SVI tier,
// Barangay Capacity gap tier, real hazard-exposure %) into plain-language
// planning guidance -- WITHOUT merging them into one sentence. This never
// sums or averages the domains into one score, and it never lets a
// "good" domain go unmentioned just because another domain is worse: a
// planner needs to see all three individually, every time, to know
// exactly which lever (social program vs. institutional/DRRM investment
// vs. hazard monitoring) applies to THIS barangay. Returns
// { verdict, domains: [svi, capacityDistance, hazard] }. The verdict is a
// one-line priority summary (reusing priorityInfo's label/color, itself
// just a classification, not a new computed score). Each domain entry is
// always present, independently generated from that domain alone, and
// deliberately SHORT -- one tier line + one action line. The specific
// gap-by-gap detail (which institutional flags are missing, exact RHU/Fire
// %) already has its own "Identified Barangay Capacity Gaps" section right
// above this one, so it is not repeated here -- this section is the
// takeaway, not the data dump.
// Per-domain urgency badges. Deliberately a DIFFERENT vocabulary from the
// cross-domain verdict labels ("Top Priority"/"High Priority"/"Watch"/
// "Monitor" from priorityInfo(), which describe how the three domains
// converge) -- these describe ONE domain, read from that domain's own
// tier/threshold alone, so a "Critical" badge here can never be mistaken
// for the overall barangay-wide verdict above it. Severity color
// (red/amber/green) is intentionally separate from each domain's identity
// color (the SVI/CAP/HAZ tag chip color) so "how urgent" and "which
// domain" are two independent visual channels, not one conflated color.
const SEVERITY_COLOR = { critical:"#dc2626", watch:"#d97706", ok:"#16a34a", none:"#9aa1b2" };
function sviBadge(sviT) {
  if (sviT === "High")           return { label:"Critical",        color:SEVERITY_COLOR.critical };
  if (sviT === "Moderate-high")  return { label:"Needs Attention",  color:SEVERITY_COLOR.watch };
  if (sviT === "No Data")        return { label:"No Data",          color:SEVERITY_COLOR.none };
  return                                { label:"Stable",           color:SEVERITY_COLOR.ok };
}
function capBadge(capT) {
  if (capT === "High")           return { label:"Critical Gap",     color:SEVERITY_COLOR.critical };
  if (capT === "Moderate-high")  return { label:"Needs Attention",  color:SEVERITY_COLOR.watch };
  if (capT === "No Data")        return { label:"No Data",          color:SEVERITY_COLOR.none };
  return                                { label:"Adequate",         color:SEVERITY_COLOR.ok };
}
function hazardBadge(floodPct, landslidePct) {
  const worst = Math.max(floodPct, landslidePct);
  if (worst >= HAZARD_FLAG_PCT) return { label:"High Exposure",     color:SEVERITY_COLOR.critical };
  if (worst >= 10)              return { label:"Moderate Exposure", color:SEVERITY_COLOR.watch };
  return                               { label:"Low Exposure",      color:SEVERITY_COLOR.ok };
}

function generateInsights(b) {
  const { sviT, capT, sviBad, capBad, hazardHigh, floodPct, landslidePct } = domainFlags(b);
  const prio = priorityInfo(b);

  const verdictText = {
    5: "All three domains converge here — needs social protection AND DRRM investment together.",
    4: "Two of the three domains are flagged — open each tab below to see which.",
    3: "One domain needs focused attention; the other two are within normal range.",
    2: "Hazard exposure is significant even though the other two domains are manageable.",
    1: "All three domains are within normal range — monitor regularly.",
  }[prio.rank];
  const verdict = { tag: prio.label, color: prio.color, text: verdictText };

  // Domain 1: Social Vulnerability (SVI) -- "top drivers" are the 2-3
  // highest of the 11 raw indicator proportions feeding this barangay's
  // SVI score, named individually. This answers WHY the tier is what it
  // is, not just that it is -- but it only ever explains the SVI number
  // using SVI's own 11 inputs, never anything from Capacity or Hazard.
  const sviDrivers = Object.entries(b.social_indicators || {})
    .filter(([, v]) => v != null)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, v]) => ({ label: SVI_INDICATOR_LABELS[k] || k, value: `${(v * 100).toFixed(0)}%` }));
  const sviInsight = {
    key: "svi",
    tag: "Social Vulnerability",
    short: "SVI",
    color: sviTierColor(b.svi_rank),
    badge: sviBadge(sviT),
    tier: `${sviT} · Rank ${b.svi_rank ?? "—"}/24`,
    driversLabel: "Top drivers",
    drivers: sviDrivers,   // distance to the RHU / fire station is shown on its own line
    action: sviBad
      ? "Priority for livelihood & social protection programs."
      : "No urgent social-program intervention needed.",
  };

  // Domain 2: Barangay Capacity -- "top drivers" are the SPECIFIC
  // institutional/distance gaps that are actually flagged for this
  // barangay (from the same capacity_scores.csv indicators as
  // the "Identified Barangay Capacity Gaps" section), not a repeat of
  // the gap COUNT alone.
  const capDrivers = CAPACITY_GAP_ITEMS.filter(g => b[g.key]).map(g => ({ label:g.label, value:"None" }));
  const capInsight = {
    key: "capacity",
    tag: "Barangay Capacity",
    short: "CAP",
    color: capDistTierColor(b.capacity_gap_rank),
    badge: capBadge(capT),
    tier: `${capDistTierLabel(b.capacity_gap_rank)} · Rank ${b.capacity_rank ?? "—"}/24`,
    driversLabel: "Flagged gaps",
    drivers: capDrivers.slice(0, 3),
    action: capBad
      ? `Priority for DRRM investment${capDrivers.length ? ` — ${capDrivers.length} resource/readiness gap${capDrivers.length>1?"s":""} flagged below` : ""}.`
      : "Resources and readiness adequate.",
  };

  // Domain 3: real Hazard Exposure -- household counts alongside the %,
  // flood and landslide always shown together but never summed together
  // or with SVI/Capacity.
  const hazDrivers = [];
  if (floodPct > 0)     hazDrivers.push({ label:"Flood-exposed households",     value:`${(b.flood_hh||0).toLocaleString()} (${floodPct.toFixed(1)}%)` });
  if (landslidePct > 0) hazDrivers.push({ label:"Landslide-exposed households", value:`${(b.landslide_hh||0).toLocaleString()} (${landslidePct.toFixed(1)}%)` });
  const hazInsight = {
    key: "hazard",
    tag: "Hazard Exposure",
    short: "HAZ",
    color: floodPct >= landslidePct ? "#1565c0" : "#8d6e63",
    badge: hazardBadge(floodPct, landslidePct),
    tier: `${floodPct.toFixed(1)}% flood · ${landslidePct.toFixed(1)}% landslide`,
    driversLabel: "Households affected",
    drivers: hazDrivers,
    action: hazardHigh
      ? "Priority for evacuation planning & hazard monitoring."
      : "Maintain routine hazard monitoring.",
  };

  return { verdict, domains: [sviInsight, capInsight, hazInsight] };
}

function ScoreBar({ value, max = 1, color, trackColor }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ flex:1, height:6, background:trackColor, borderRadius:3, overflow:"hidden" }}>
      <div style={{ width:`${pct}%`, height:"100%", background:color,
        borderRadius:3, transition:"width 0.5s ease" }}/>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────
// One domain at a time. The planner picks Social Vulnerability, Barangay
// Capacity or Hazard Exposure with the tabs at the top and sees only that
// domain's numbers, drivers and recommendation -- the domains are never
// shown mixed together, and never combined. Sized to its content (no inner
// scrolling).
const DOMAIN_TABS = [
  { key: "svi",      label: "SVI",      full: "Social Vulnerability Index", accent: "#dc2626" },
  { key: "capacity", label: "Capacity", full: "Barangay Capacity",          accent: "#16a34a" },
  { key: "hazard",   label: "Hazard",   full: "Hazard Exposure",            accent: "#2563eb" },
];

function RankStrip({ rank, color, D, leftLabel, rightLabel }) {
  const r = Number(rank);
  const pos = Number.isFinite(r) ? ((r - 1) / 23) * 100 : null;
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ position: "relative", height: 6, borderRadius: 3, background: D.trackColor }}>
        {pos != null && (
          <span style={{ position: "absolute", left: `calc(${pos}% - 6px)`, top: -3, width: 12, height: 12,
            borderRadius: "50%", background: color, border: `2px solid ${D.cardBg}`, boxShadow: `0 0 0 1px ${color}` }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10, color: D.textMuted }}>
        <span>{leftLabel}</span><span>{rightLabel}</span>
      </div>
    </div>
  );
}

function SectionLabel({ children, D }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: D.textMuted, textTransform: "uppercase",
      letterSpacing: 0.6, margin: "12px 0 6px" }}>{children}</div>
  );
}

// Recommendation for ONE domain: the headline, then every recommended
// action listed right under it (no extra click). Each action shows the
// barangay's own number that triggered it and the usual lead office; the
// longer explanation is in the tooltip.
const MAX_ACTIONS = 4;
function Recommendation({ d, recs, accent, D, dark }) {
  const shown = recs.slice(0, MAX_ACTIONS), rest = recs.slice(MAX_ACTIONS);
  return (
    <div style={{ marginTop: 14, borderRadius: 9, border: `1px solid ${d.badge.color}${dark ? "40" : "2e"}`,
      background: d.badge.color + (dark ? "12" : "08"), padding: "10px 12px 6px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: d.badge.color, textTransform: "uppercase", letterSpacing: 0.6 }}>
        Recommendation
      </div>
      <div style={{ fontSize: 12.5, color: D.textBody, lineHeight: 1.4, fontWeight: 700, margin: "2px 0 6px" }}>{d.action}</div>
      {shown.map((r) => (
        <div key={r.title} title={r.text || r.title}
          style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 7, padding: "6px 0", borderTop: `1px solid ${d.badge.color}${dark ? "26" : "1c"}` }}>
          <span style={{ color: d.badge.color, fontSize: 13, fontWeight: 800, lineHeight: 1.2 }}>›</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.3, fontWeight: 600, color: D.textBody, lineHeight: 1.3 }}>{r.title}</div>
            <div style={{ fontSize: 10.5, color: D.textCell, marginTop: 1, lineHeight: 1.35 }}>
              <span style={{ color: d.badge.color, fontWeight: 600 }}>{r.reason}</span>
              <span style={{ color: D.textMuted }}> · {r.office}</span>
            </div>
          </div>
        </div>
      ))}
      {rest.length > 0 && (
        <div title={rest.map((r) => r.title).join("\n")}
          style={{ fontSize: 10.5, color: D.textCell, padding: "5px 0 2px 21px", borderTop: `1px solid ${d.badge.color}${dark ? "26" : "1c"}` }}>
          + {rest.length} more: {rest.map((r) => r.title).join(" · ")}
        </div>
      )}
    </div>
  );
}

function Hero({ label, value, sub, color, badge, D, dark }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.1, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color, marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: badge.color, background: badge.color + (dark ? "22" : "14"),
        border: `1px solid ${badge.color}${dark ? "55" : "33"}`, borderRadius: 6, padding: "4px 9px", whiteSpace: "nowrap", marginTop: 2 }}>
        {badge.label}
      </span>
    </div>
  );
}

// Map colour + caption for the open domain tab (one domain at a time).
function domainMapStyle(b, key, badge) {
  if (key === "capacity") return {
    color: capDistTierColor(b.capacity_gap_rank),
    label: `Barangay Capacity · ${capDistTierLabel(b.capacity_gap_rank)}`,
    sub: `Rank ${b.capacity_rank ?? "—"} of 24 (rank 1 = best equipped)`,
  };
  if (key === "hazard") return {
    color: badge.color,
    label: `Hazard exposure · ${badge.label}`,
    sub: `Flood ${toNum(b.flood_pct).toFixed(1)}% · Landslide ${toNum(b.landslide_pct).toFixed(1)}% of households`,
  };
  return {
    color: sviTierColor(b.svi_rank),
    label: `SVI · ${sviTier(b.svi_rank)} tier`,
    sub: `Rank ${b.svi_rank ?? "—"} of 24 (rank 1 = most vulnerable)`,
  };
}

// Everything the PDF needs for one domain, from the same functions the
// overlay uses (so the report always matches the screen).
function domainPack(b, all, key) {
  const insights = generateInsights(b);
  const d = insights.domains.find((x) => x.key === key);
  const { capBad } = domainFlags(b);
  const pct0 = (v) => (v != null ? `${toNum(v).toFixed(0)}%` : "—");
  if (key === "svi") {
    const ind = Object.entries(b.social_indicators || {}).filter(([, v]) => v != null).sort((x, y) => y[1] - x[1]);
    return {
      key, short: "SVI", title: "Social Vulnerability (SVI)", color: sviTierColor(b.svi_rank), badge: d.badge.label, action: d.action,
      headline: `SVI ${b.svi_score != null ? b.svi_score.toFixed(2) : "N/A"}`, sub: `${sviTier(b.svi_rank)} tier · rank ${b.svi_rank ?? "—"} of 24 (1 = most vulnerable)`,
      detailsTitle: "What drives this score",
      details: [
        ...ind.map(([k, v]) => [SVI_INDICATOR_LABELS[k] || k, `${(v * 100).toFixed(0)}%`, false]),
        ["Households beyond 2 km of the RHU", pct0(b.rhu_pct_beyond), toNum(b.rhu_pct_beyond) >= 50],
        ["Households beyond 2 km of the fire station", pct0(b.fire_pct_beyond), toNum(b.fire_pct_beyond) >= 50],
        ["PWDs · seniors · solo parents · 4Ps", `${toNum(b.pwd_count)} · ${toNum(b.senior_count)} · ${toNum(b.solo_parent_count)} · ${toNum(b.fourps_count)}`, false],
      ],
      recs: sviRecommendations(b, all || []), levelCol: "Conditions",
    };
  }
  if (key === "capacity") {
    return {
      key, short: "Capacity", title: "Barangay Capacity", color: capDistTierColor(b.capacity_gap_rank), badge: d.badge.label, action: d.action,
      headline: `Capacity ${b.capacity_score != null ? b.capacity_score.toFixed(1) : "N/A"} / 100`,
      sub: `${capDistTierLabel(b.capacity_gap_rank)} · rank ${b.capacity_rank ?? "—"} of 24 (1 = best equipped)`,
      detailsTitle: "Resources and readiness",
      details: [
        ...CAPACITY_GAP_ITEMS.map((g) => [g.label, b[g.key] ? "Missing" : "In place", !!b[g.key]]),
        ["Schools · evacuation centres", `${b.schools_count ?? 0} · ${b.evac_centers_count ?? 0}`, toNum(b.evac_centers_count) === 0],
      ],
      recs: capacityRecommendations(b, CAPACITY_GAP_ITEMS, capBad), levelCol: "Doesn't know",
    };
  }
  const hh = toNum(b.total_households);
  return {
    key, short: "Hazard", title: "Hazard Exposure", color: d.badge.color, badge: d.badge.label, action: d.action,
    headline: `Flood ${toNum(b.flood_pct).toFixed(1)}% · Landslide ${toNum(b.landslide_pct).toFixed(1)}%`, sub: "share of households in high hazard zones",
    detailsTitle: "Households in hazard zones",
    details: [
      ["Flood — High or Very High zone", `${toNum(b.flood_hh).toLocaleString()} of ${hh.toLocaleString()} (${toNum(b.flood_pct).toFixed(1)}%)`, toNum(b.flood_pct) >= HAZARD_FLAG_PCT],
      ["Landslide — Moderate or High zone", `${toNum(b.landslide_hh).toLocaleString()} of ${hh.toLocaleString()} (${toNum(b.landslide_pct).toFixed(1)}%)`, toNum(b.landslide_pct) >= HAZARD_FLAG_PCT],
    ],
    note: `Flood and landslide are counted separately. ${HAZARD_FLAG_PCT}% or more of households counts as significant exposure.`,
    recs: hazardRecommendations(b), levelCol: "Hazard level",
  };
}

function ReportButton({ b, all, domain, dark }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const label = DOMAIN_TABS.find((t) => t.key === domain)?.label || "SVI";
  const run = async (keys) => {
    setOpen(false);
    setBusy("Preparing report…");
    try {
      const prio = priorityInfo(b);
      await buildPlanningReport({
        b, packs: keys.map((k) => domainPack(b, all, k)), verdict: generateInsights(b).verdict.text,
        priority: { label: prio.label, color: prio.color }, onProgress: setBusy,
      });
    } catch (e) {
      window.alert?.(`Could not build the report: ${e.message}`);
    } finally { setBusy(null); }
  };
  const item = { display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer",
    padding: "8px 12px", fontSize: 12.5, fontFamily: "inherit", color: dark ? "#e5e7eb" : "#1f2937", borderRadius: 6 };
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} disabled={!!busy} title="Download a PDF report for this barangay"
        style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px", borderRadius: 14, border: "none",
          background: "#fff", color: "#1a237e", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
        </svg>
        {busy || "PDF report"}
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: 34, zIndex: 10, width: 250, padding: 5, borderRadius: 10,
          background: dark ? "#161b26" : "#fff", border: `1px solid ${dark ? "#2a3245" : "#e3e7ef"}`, boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
          <button role="menuitem" style={item} onClick={() => run([domain])}
            onMouseEnter={(e) => (e.currentTarget.style.background = dark ? "#1e2638" : "#f1f5ff")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <b>{label} only</b><div style={{ fontSize: 11, opacity: 0.7 }}>The tab that is open now</div>
          </button>
          <button role="menuitem" style={item} onClick={() => run(["svi", "capacity", "hazard"])}
            onMouseEnter={(e) => (e.currentTarget.style.background = dark ? "#1e2638" : "#f1f5ff")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <b>All three domains</b><div style={{ fontSize: 11, opacity: 0.7 }}>SVI, Capacity and Hazard, one section each</div>
          </button>
          <div style={{ fontSize: 10.5, color: dark ? "#9ca3af" : "#6b7280", padding: "6px 12px 4px", lineHeight: 1.4 }}>
            Lists household heads' names — confidential, for LGU use only (RA 10173).
          </div>
        </div>
      )}
    </div>
  );
}

function useWide(min = 900) {
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [min]);
  return wide;
}

function PlanningDetail({ b, all, D, dark, domain, onDomain, onClose, onPrev, onNext, position }) {
  const wide = useWide();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev && !/input|select|textarea/i.test(e.target.tagName)) onPrev();
      else if (e.key === "ArrowRight" && onNext && !/input|select|textarea/i.test(e.target.tagName)) onNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose, onPrev, onNext]);
  const insights = generateInsights(b);
  const prio = priorityInfo(b);
  const hh = toNum(b.total_households);
  const dom = Object.fromEntries(insights.domains.map((d) => [d.key, d]));
  const d = dom[domain] || dom.svi;
  const { capBad } = domainFlags(b);
  const recs = d.key === "svi" ? sviRecommendations(b, all || [])
    : d.key === "capacity" ? capacityRecommendations(b, CAPACITY_GAP_ITEMS, capBad)
    : hazardRecommendations(b);
  const accent = DOMAIN_TABS.find((t) => t.key === d.key).accent;
  const row = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" };
  const cellLbl = { fontSize: 12, color: D.textCell };
  const cellVal = { fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" };


  const mapStyle = domainMapStyle(b, d.key, d.badge);
  const navBtn = (label, fn, txt) => (
    <button onClick={fn} disabled={!fn} aria-label={label} title={label} style={{ background: "rgba(255,255,255,0.15)", border: "none",
      color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: fn ? "pointer" : "default", opacity: fn ? 1 : 0.35,
      fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{txt}</button>
  );

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${b.barangay_name} planning details`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(8,12,24,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: wide ? 24 : 10, animation: "pdFade 0.15s ease" }}>
    <div style={{ background: D.cardBg, borderRadius: 14, border: `1px solid ${D.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
      overflow: "hidden", width: "min(1240px, 100%)", height: wide ? "min(860px, 100%)" : "100%", display: "flex", flexDirection: "column",
      animation: "slideIn 0.2s ease", fontFamily: "'Segoe UI', sans-serif" }}>
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        @keyframes pdFade { from { opacity:0; } to { opacity:1; } }
        .pd-tab, .pd-tab:focus { outline: none; } .pd-tab:focus-visible { outline: 2px solid #5b8dee; outline-offset: 1px; }`}</style>

      {/* Header */}
      <div style={{ background: D.headerGrad, padding: "14px 16px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>{b.barangay_name}</div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11.5, marginTop: 2 }}>
              {hh.toLocaleString()} households
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <ReportButton b={b} all={all} domain={d.key} dark={dark} />
            {position && <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 11.5, margin: "0 4px 0 6px" }}>{position}</span>}
            {navBtn("Previous barangay (←)", onPrev, "‹")}
            {navBtn("Next barangay (→)", onNext, "›")}
            <button onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)" style={{ background: "rgba(255,255,255,0.15)", border: "none",
              color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 4 }}>✕</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
          <span style={{ background: "#fff", color: prio.color, borderRadius: 5, padding: "2px 8px", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>
            {prio.label}
          </span>
          <span style={{ color: "rgba(255,255,255,0.82)", fontSize: 11, lineHeight: 1.35 }}>{insights.verdict.text}</span>
        </div>
      </div>

      {/* Body: map (left) + one domain at a time (right) */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: wide ? "minmax(0,1.15fr) minmax(380px,1fr)" : "1fr",
        gridTemplateRows: wide ? "1fr" : "300px auto", overflowY: wide ? "hidden" : "auto" }}>
      <div style={{ padding: wide ? "14px 0 14px 14px" : "12px 12px 0", minHeight: 0 }}>
        <PlanningMap barangay={b.barangay_name} color={mapStyle.color} label={mapStyle.label} sub={mapStyle.sub} dark={dark} />
      </div>
      <div style={{ minHeight: 0, overflowY: wide ? "auto" : "visible" }}>
      {/* Domain tabs */}
      <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, padding: 6,
        margin: "12px 14px 0", background: D.subBg, border: `1px solid ${D.border}`, borderRadius: 9 }}>
        {DOMAIN_TABS.map((t) => {
          const on = t.key === d.key;
          const sev = dom[t.key].badge.color;
          return (
            <button key={t.key} role="tab" aria-selected={on} onClick={() => onDomain(t.key)}
              className="pd-tab" title={`${t.full} · ${dom[t.key].badge.label}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 4px",
                border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                fontSize: 12.5, fontWeight: on ? 700 : 600, lineHeight: 1.2,
                background: on ? D.cardBg : "transparent", color: on ? t.accent : D.textCell,
                boxShadow: on ? (dark ? "0 1px 3px rgba(0,0,0,0.5)" : "0 1px 3px rgba(15,23,42,0.12)") : "none",
                transition: "background .15s, color .15s" }}>
              <span title={dom[t.key].badge.label} style={{ width: 7, height: 7, borderRadius: "50%", background: sev, flexShrink: 0 }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Active domain only */}
      <div key={d.key} style={{ padding: "14px 16px 14px", animation: "slideIn 0.15s ease" }}>
        {d.key === "svi" && (
          <>
            <Hero label="Social Vulnerability Index" value={b.svi_score != null ? b.svi_score.toFixed(2) : "N/A"}
              sub={`${sviTier(b.svi_rank)} tier · Rank ${b.svi_rank ?? "—"} of 24`} color={sviTierColor(b.svi_rank)}
              badge={d.badge} D={D} dark={dark} />
            <RankStrip rank={b.svi_rank} color={sviTierColor(b.svi_rank)} D={D} leftLabel="Rank 1 · most vulnerable" rightLabel="Rank 24" />

            {d.drivers?.length > 0 && <SectionLabel D={D}>What drives this score</SectionLabel>}
            {d.drivers?.map((dr) => (
              <div key={dr.label} style={row}><span style={cellLbl}>{dr.label}</span><span style={{ ...cellVal, color: d.color }}>{dr.value}</span></div>
            ))}

            <div style={{ ...row, marginTop: 6, paddingTop: 8, borderTop: `1px solid ${D.divider}` }}>
              <span style={cellLbl}>Beyond 2 km of help</span>
              <span style={{ fontSize: 12, color: D.textCell }}>
                RHU <b style={{ color: toNum(b.rhu_pct_beyond) >= 50 ? "#dc2626" : D.textBody }}>{b.rhu_pct_beyond != null ? `${toNum(b.rhu_pct_beyond).toFixed(0)}%` : "—"}</b>
                {"  ·  "}Fire station <b style={{ color: toNum(b.fire_pct_beyond) >= 50 ? "#dc2626" : D.textBody }}>{b.fire_pct_beyond != null ? `${toNum(b.fire_pct_beyond).toFixed(0)}%` : "—"}</b>
              </span>
            </div>

            <SectionLabel D={D}>People who may need help</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {[["PWDs", b.pwd_count, "#7c3aed"], ["Seniors", b.senior_count, "#1565c0"], ["Solo parents", b.solo_parent_count, "#c62828"], ["4Ps", b.fourps_count, "#f57c00"]].map(([l, v, c]) => (
                <div key={l} style={{ background: D.subBg, border: `1px solid ${D.border}`, borderRadius: 7, padding: "6px 6px", textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: toNum(v) > 0 ? c : D.textMuted, fontVariantNumeric: "tabular-nums" }}>{toNum(v).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: D.textMuted, marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
            <Recommendation d={d} recs={recs} accent={accent} D={D} dark={dark} />
          </>
        )}

        {d.key === "capacity" && (
          <>
            <Hero label="Barangay Capacity (0–100)" value={b.capacity_score != null ? b.capacity_score.toFixed(1) : "N/A"}
              sub={`${capDistTierLabel(b.capacity_gap_rank)} · Rank ${b.capacity_rank ?? "—"} of 24`} color={capDistTierColor(b.capacity_gap_rank)}
              badge={d.badge} D={D} dark={dark} />
            <RankStrip rank={b.capacity_rank} color={capDistTierColor(b.capacity_gap_rank)} D={D} leftLabel="Rank 1 · best equipped" rightLabel="Rank 24" />

            <SectionLabel D={D}>Resources and readiness</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 6px" }}>
              {CAPACITY_GAP_ITEMS.map((g) => {
                const missing = !!b[g.key];
                return (
                  <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 8px", borderRadius: 6,
                    background: missing ? (dark ? "#2a0f12" : "#fef2f2") : D.subBg,
                    border: `1px solid ${missing ? (dark ? "#5c1d22" : "#fecaca") : D.border}` }}>
                    <span style={{ width: 15, height: 15, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 900, color: "#fff", background: missing ? "#dc2626" : "#16a34a" }}>{missing ? "✕" : "✓"}</span>
                    <span style={{ fontSize: 11.5, color: missing ? "#dc2626" : D.textCell, fontWeight: missing ? 600 : 500, lineHeight: 1.2 }}>{g.label}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ ...row, marginTop: 8 }}>
              <span style={cellLbl}>Schools · evacuation centres</span>
              <span style={{ ...cellVal, color: D.textBody }}>{b.schools_count ?? 0} · {b.evac_centers_count ?? 0}</span>
            </div>
            <Recommendation d={d} recs={recs} accent={accent} D={D} dark={dark} />
          </>
        )}

        {d.key === "hazard" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>Households in hazard zones</div>
                <div style={{ fontSize: 11.5, color: D.textCell, marginTop: 3 }}>Flood and landslide are counted separately</div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: d.badge.color, background: d.badge.color + (dark ? "22" : "14"),
                border: `1px solid ${d.badge.color}${dark ? "55" : "33"}`, borderRadius: 6, padding: "4px 9px", whiteSpace: "nowrap" }}>{d.badge.label}</span>
            </div>
            {[
              { label: "Flood", sub: "High or very high zone", pct: toNum(b.flood_pct), n: b.flood_hh, color: "#1565c0" },
              { label: "Landslide", sub: "Moderate or high zone", pct: toNum(b.landslide_pct), n: b.landslide_hh, color: "#8d6e63" },
            ].map((h) => {
              const flagged = h.pct >= HAZARD_FLAG_PCT;
              const c = flagged ? "#dc2626" : h.color;
              return (
                <div key={h.label} style={{ marginTop: 8, padding: "10px 12px", borderRadius: 9, background: D.subBg, border: `1px solid ${D.border}` }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: D.textBody }}>{h.label}</div>
                      <div style={{ fontSize: 10.5, color: D.textMuted }}>{h.sub}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: c, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{h.pct.toFixed(1)}%</div>
                      <div style={{ fontSize: 10.5, color: D.textMuted, marginTop: 2 }}>{(h.n || 0).toLocaleString()} of {hh.toLocaleString()} households</div>
                    </div>
                  </div>
                  <div style={{ position: "relative", height: 6, borderRadius: 3, background: D.trackColor, marginTop: 10 }}>
                    <div style={{ width: `${Math.min(100, h.pct)}%`, height: "100%", borderRadius: 3, background: c }} />
                    <span title={`${HAZARD_FLAG_PCT}% significance line`} style={{ position: "absolute", left: `${HAZARD_FLAG_PCT}%`, top: -3, width: 2, height: 12, background: D.textMuted }} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: D.textMuted, marginTop: 10, lineHeight: 1.5 }}>
              Each household's GPS point is checked against the flood and landslide maps. The mark on each bar is the {HAZARD_FLAG_PCT}% line where exposure counts as significant.
            </div>
            {/* Quick action: the households themselves live on Map View */}
            <button onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("lgu:open", { detail: { tab: "map", mode: "hazard", focusBarangay: b.barangay_name } })); }}
              style={{ marginTop: 12, width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                borderRadius: 9, border: `1px solid ${dark ? "#1e3a6e" : "#bfd3f5"}`, background: dark ? "#0f1c35" : "#eef4ff",
                cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={dark ? "#7cb4ff" : "#1565c0"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
              </svg>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: dark ? "#cfe0ff" : "#1a237e" }}>View these households on Map View</span>
                <span style={{ display: "block", fontSize: 11, color: D.textCell, marginTop: 1 }}>
                  Opens the Hazard map on {b.barangay_name} only, with each household coloured by its flood / landslide level ({(toNum(b.flood_hh) + toNum(b.landslide_hh)).toLocaleString()} in high zones)
                </span>
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: dark ? "#7cb4ff" : "#1565c0" }}>→</span>
            </button>
            <Recommendation d={d} recs={recs} accent={accent} D={D} dark={dark} />
          </>
        )}
      </div>
      </div>
      </div>
    </div>
    </div>,
    document.body
  );
}

export default function BarangayPlanning({ intent } = {}) {
  const { dark } = useTheme();

  const D = {
    pageBg:      dark ? "#0d0f14" : "#f5f6fa",
    cardBg:      dark ? "#141720" : "#ffffff",
    subBg:       dark ? "#0f1117" : "#f8f9fc",
    border:      dark ? "#1e2235" : "#e8eaf0",
    divider:     dark ? "#181c2a" : "#f0f0f0",
    inputBg:     dark ? "#0f1117" : "#ffffff",
    inputBorder: dark ? "#1e2235" : "#dddddd",
    textPrimary: dark ? "#5b8dee" : "#1a237e",
    textBody:    dark ? "#8b95a9" : "#333333",
    textMuted:   dark ? "#3d4560" : "#999999",
    textCell:    dark ? "#6b7590" : "#555555",
    rowEven:     dark ? "#141720" : "#ffffff",
    rowOdd:      dark ? "#111420" : "#fafafa",
    rowHover:    dark ? "#161b2e" : "#f0f4ff",
    trackColor:  dark ? "#1e2235" : "#eef0f5",
    shadow:      dark ? "0 2px 12px rgba(0,0,0,0.4)" : "0 2px 8px rgba(0,0,0,0.06)",
    headerGrad:  "linear-gradient(135deg, #1a237e 0%, #1565c0 100%)",
    icoColor:    dark ? "#4a5268" : "#888888",
  };

  const [stats,    setStats]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [sortBy,   setSortBy]   = useState("priority_desc");
  const [selected, setSelected] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState(null); // priorityInfo(b).rank, or null for all
  const [insightTabRaw, setInsightTab] = useUrlParam("domain", "svi"); // which domain the detail panel shows
  const insightTab = ["svi", "capacity", "hazard"].includes(insightTabRaw) ? insightTabRaw : "svi";

  useEffect(() => {
    Promise.all([
      // Two-domain model (Sir Shem's framework) -- the authoritative
      // barangay-level scores. domB is also the source of the real
      // per-barangay hazard-exposure aggregate (never combined with SVI
      // or Capacity into one score -- handoff §3, ground rule).
      getDomainBarangays().then(r => r.data?.data || []),
      getDomainCapacity().then(r => r.data?.data || []),
      // Naive rollup is kept ONLY for its household demographic counts
      // (pwd/senior/solo-parent/4Ps/total households) -- its own
      // vuln_score/vuln_category are retired and never read here.
      getVulnBarangaySummary().then(r => r.data?.data || []).catch(() => []),
    ]).then(([domB, capDist, rollup]) => {
      const merged = domB.map(dom => {
        const cd  = fuzzyFind(dom.barangay, capDist, "barangay");
        const roll = fuzzyFind(dom.barangay, rollup, "barangay_name");
        return {
          barangay_name: dom.barangay,
          psgc_10d: dom.psgc_10d,
          total_households: dom.households ?? roll?.total_households ?? 0,

          svi_score: dom.svi_score, svi_rank: dom.svi_rank,
          core_social_score: dom.core_social_score, core_social_rank: dom.core_social_rank,
          access_augmented_score: dom.access_augmented_score, access_augmented_rank: dom.access_augmented_rank,
          rhu_median_km: dom.rhu_median_km, fire_median_km: dom.fire_median_km,
          // Raw per-indicator proportions behind the SVI score (11 fields,
          // e.g. food_insecure_prop=0.78) -- kept as-is (not just the
          // summed score) so generateInsights() can name the SPECIFIC
          // indicators driving a barangay's SVI tier, not just report the
          // tier itself.
          social_indicators: dom.social_indicators || {},

          capacity_score: cd ? cd.capacity_score : null,
          capacity_rank:  cd ? cd.capacity_rank  : null,
          capacity_gap_rank: capacityGapRank(cd, capDist),
          ...capacityGapFields(cd),
          // Distance to help (household vulnerability): % beyond 2 km.
          rhu_pct_beyond:  dom.access?.rhu_pct_beyond ?? null,
          fire_pct_beyond: dom.access?.fire_pct_beyond ?? null,

          flood_pct:     dom.hazard?.flood_high_or_very_high_pct_total ?? 0,
          landslide_pct: dom.hazard?.landslide_moderate_or_high_pct_total ?? 0,
          flood_hh:     dom.hazard?.flood_high_or_very_high_households ?? 0,
          landslide_hh: dom.hazard?.landslide_moderate_or_high_households ?? 0,

          pwd_count: roll?.pwd_count||0, senior_count: roll?.senior_count||0,
          solo_parent_count: roll?.solo_parent_count||0, fourps_count: roll?.fourps_count||0,
        };
      });
      setStats(merged);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Open the barangay picked in Omni Search, or the one that was open before
  // a refresh (kept in the address), once the list has loaded.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!stats.length) return;
    const name = intent?.barangay || (!restoredRef.current ? getParam("brgy") : null);
    restoredRef.current = true;
    if (!name) return;
    const want = normalizeName(name);
    const hit = stats.find((b) => normalizeName(b.barangay_name) === want);
    if (hit) { setSelected(hit); if (intent?.barangay) setInsightTab("svi"); }
  }, [intent?.ts, stats.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (restoredRef.current) setParam("brgy", selected?.barangay_name || null);
  }, [selected]);

  const filtered = stats
    .filter(b => b.barangay_name?.toLowerCase().includes(search.toLowerCase()))
    .filter(b => priorityFilter == null || priorityInfo(b).rank === priorityFilter)
    .sort((a, b) => {
      if (sortBy === "priority_desc") {
        const pd = priorityInfo(b).rank - priorityInfo(a).rank;
        if (pd !== 0) return pd;
        return (a.svi_rank??999) - (b.svi_rank??999); // tie-break: worse SVI rank first
      }
      if (sortBy === "svi_worst") return (a.svi_rank??999) - (b.svi_rank??999);
      if (sortBy === "svi_best")  return (b.svi_rank??-1) - (a.svi_rank??-1);
      if (sortBy === "cap_worst") return (a.capacity_gap_rank??999) - (b.capacity_gap_rank??999);
      if (sortBy === "cap_best")  return (b.capacity_gap_rank??-1) - (a.capacity_gap_rank??-1);
      if (sortBy === "name")      return a.barangay_name.localeCompare(b.barangay_name);
      return 0;
    });

  return (
    <div style={{ padding:"18px 20px", fontFamily:"'Segoe UI', sans-serif",
      background:D.pageBg, minHeight:"100%", transition:"background 0.25s ease" }}>

      {/* Page Header */}
      <div style={{ marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <div style={{ width:4, height:22, borderRadius:2, background:D.headerGrad }}/>
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, color:D.textPrimary }}>
            Barangay Planning Summary
          </h2>
        </div>
        <div style={{ fontSize:12, color:D.textMuted, marginLeft:14 }}>
          Translate the SVI, Barangay Capacity & hazard-exposure domains into actionable planning insights per barangay
        </div>
      </div>

      {/* Priority overview -- a quiet KPI row, not a loud color bar. The
          number carries the information; color is reduced to a small dot
          and a thin proportional underline per column. Clicking a column
          filters the list below to that tier. This replaces an earlier,
          too-saturated "severity bar" version per design feedback -- same
          underlying data and interaction, restrained presentation. */}
      {!loading && (() => {
        const PRIORITY_LEVELS = [
          { rank:5, label:"Top Priority",  color:"#7c3aed" },
          { rank:4, label:"High Priority", color:"#dc2626" },
          { rank:3, label:"Watch",         color:"#c2762a" },
          { rank:2, label:"Hazard Watch",  color:"#2563a8" },
          { rank:1, label:"Monitor",       color:"#2e7d4f" },
        ];
        const counts = PRIORITY_LEVELS.map(lvl => ({ ...lvl, count: stats.filter(b => priorityInfo(b).rank === lvl.rank).length }));
        const maxCount = Math.max(1, ...counts.map(c => c.count));
        const urgent = counts.filter(c => c.rank >= 4).reduce((s,c) => s+c.count, 0);
        const anyFilter = priorityFilter != null;
        return (
          <div style={{ marginBottom:16, background:D.cardBg, border:`1px solid ${D.border}`, borderRadius:10, boxShadow:D.shadow, overflow:"hidden" }}>

            {/* Header strip */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 18px", borderBottom:`1px solid ${D.divider}` }}>
              <span style={{ fontSize:11, fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.6 }}>
                Priority overview
                <span style={{ marginLeft:10, fontWeight:500, textTransform:"none", letterSpacing:0, color:D.textCell }}>
                  {urgent} of {stats.length} barangays need attention
                </span>
              </span>
              {anyFilter && (
                <button onClick={()=>setPriorityFilter(null)} style={{ fontSize:11, fontWeight:600, color:D.textMuted, background:"none", border:"none", cursor:"pointer", padding:0 }}>
                  Clear filter ✕
                </button>
              )}
            </div>

            {/* KPI columns */}
            <div style={{ display:"flex" }}>
              {counts.map((c, i) => {
                const isOn = priorityFilter === c.rank;
                const isDimmed = anyFilter && !isOn;
                const barPct = (c.count / maxCount) * 100;
                return (
                  <button key={c.rank} onClick={()=>setPriorityFilter(isOn ? null : c.rank)}
                    style={{
                      flex:1, textAlign:"left", cursor:"pointer",
                      background: isOn ? c.color+(dark?"1c":"0c") : "transparent",
                      border:"none", borderRight: i<counts.length-1 ? `1px solid ${D.divider}` : "none",
                      padding:"14px 16px 12px", opacity: isDimmed ? 0.45 : 1,
                      transition:"background 0.15s ease, opacity 0.15s ease",
                    }}
                    onMouseEnter={e=>{ if(!isOn) e.currentTarget.style.background = D.rowHover; }}
                    onMouseLeave={e=>{ if(!isOn) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:c.color, flexShrink:0 }}/>
                      <span style={{ fontSize:11.5, fontWeight:600, color:D.textCell }}>{c.label}</span>
                    </div>
                    <div style={{ fontSize:26, fontWeight:700, color: isOn ? c.color : D.textPrimary, lineHeight:1, letterSpacing:-0.5, marginBottom:8 }}>
                      {c.count}
                    </div>
                    <div style={{ height:3, borderRadius:2, background:D.trackColor, overflow:"hidden" }}>
                      <div style={{ width:`${barPct}%`, height:"100%", background:c.color, borderRadius:2, opacity: isOn ? 1 : 0.55, transition:"width 0.4s ease" }}/>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Domain counts -- a single quiet reference line, secondary to the
          priority overview above. */}
      {!loading && (
        <div style={{ marginBottom:18, fontSize:11.5, color:D.textMuted, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontWeight:600, color:D.textCell }}>{stats.length} barangays</span>
          <span>·</span>
          <span><strong style={{ color:D.textCell }}>{stats.filter(b => ["High","Moderate-high"].includes(sviTier(b.svi_rank))).length}</strong> high/mod-high SVI</span>
          <span>·</span>
          <span><strong style={{ color:D.textCell }}>{stats.filter(b => ["High","Moderate-high"].includes(capDistTier(b.capacity_gap_rank))).length}</strong> low/moderate-low capacity</span>
          <span>·</span>
          <span><strong style={{ color:D.textCell }}>{stats.filter(isHazardSignificant).length}</strong> significant hazard exposure</span>
        </div>
      )}

      {/* Filter + Sort */}
      <div style={{ background:dark?"#0f1828":"#f0f4ff", border:`1px solid ${dark?"#1a2a50":"#c5d8fb"}`, borderRadius:8, padding:"10px 14px", marginBottom:14, fontSize:11.5, color:dark?"#8b95a9":"#444", lineHeight:1.5 }}>
        <strong style={{ color:D.textPrimary }}>Note:</strong> Social Vulnerability Index (SVI), Barangay Capacity, and Hazard Exposure are <strong>three separate domains</strong> — they are never combined into one score. SVI/Capacity tiers are equal 6-barangay quartiles by rank position (rank 1 = worst in each domain); the Planning Insights below cross-reference the three domains without inventing a combined number.
      </div>
      <div style={{ background:D.cardBg, borderRadius:8, border:`1px solid ${D.border}`,
        padding:"10px 14px", marginBottom:14, boxShadow:D.shadow,
        display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ position:"relative", flex:1, minWidth:180 }}>
          <span style={{ position:"absolute", left:9, top:"50%",
            transform:"translateY(-50%)", pointerEvents:"none" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke={D.textMuted} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input placeholder="Search barangay..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width:"100%", padding:"7px 10px 7px 30px",
              border:`1px solid ${D.inputBorder}`, borderRadius:6, fontSize:13,
              outline:"none", boxSizing:"border-box",
              background:D.inputBg, color:D.textBody }}/>
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding:"7px 10px", border:`1px solid ${D.inputBorder}`,
            borderRadius:6, fontSize:13, color:D.textBody,
            background:D.inputBg, minWidth:210 }}>
          <option value="priority_desc">Sort: Priority (Top First)</option>
          <option value="svi_worst">Sort: SVI ↑ Most Vulnerable First</option>
          <option value="svi_best">Sort: SVI ↓ Least Vulnerable First</option>
          <option value="cap_worst">Sort: Capacity — least equipped first</option>
          <option value="cap_best">Sort: Capacity — best equipped first</option>
          <option value="name">Sort: Name A–Z</option>
        </select>
        <div style={{ fontSize:11, color:D.textMuted, marginLeft:"auto" }}>
          {filtered.length} of {stats.length} barangays
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display:"grid",
        gridTemplateColumns: "1fr",
        gap:14, alignItems:"start" }}>

        {/* Barangay list */}
        <div style={{ background:D.cardBg, borderRadius:10,
          border:`1px solid ${D.border}`, boxShadow:D.shadow, overflow:"hidden" }}>
          <div style={{
            background: dark ? "#0f1117" : "#f2f4f8",
            borderBottom: `1px solid ${D.border}`,
            padding: "12px 16px",
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr 1.1fr 75px 1.15fr",
            gap: 8, alignItems: "center",
          }}>
            {["Barangay","SVI Score","Capacity (0–100)","Hazard Exposure","HH","Priority"].map(h => (
              <div key={h} style={{ fontSize:11, fontWeight:700,
                color: dark ? "#8b95a9" : "#555555",
                textTransform:"uppercase", letterSpacing:0.5 }}>{h}</div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding:48, textAlign:"center", color:D.textMuted, fontSize:13 }}>
              Loading barangay data...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:40, textAlign:"center", color:D.textMuted, fontSize:13 }}>
              No barangays found.
            </div>
          ) : filtered.map((b, i) => {
            const sviT = sviTier(b.svi_rank), sviC = sviTierColor(b.svi_rank);
            const capT = capDistTier(b.capacity_gap_rank), capC = capDistTierColor(b.capacity_gap_rank);
            const prio = priorityInfo(b);
            const isActive = selected?.barangay_name === b.barangay_name;
            return (
              <div key={b.barangay_name} onClick={() => setSelected(isActive ? null : b)}
                style={{ padding:"11px 16px", borderBottom:`1px solid ${D.divider}`,
                  cursor:"pointer",
                  background: isActive ? (dark?"#1a2a50":"#e8f0fe") : i%2===0 ? D.rowEven : D.rowOdd,
                  display:"grid", gridTemplateColumns:"1.4fr 1fr 1fr 1.1fr 75px 1.15fr",
                  gap:8, alignItems:"center", transition:"background 0.12s",
                  borderLeft: isActive ? "3px solid #1565c0" : "3px solid transparent" }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = D.rowHover; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = i%2===0 ? D.rowEven : D.rowOdd; }}
              >
                <div style={{ fontWeight:600, fontSize:13, color:D.textPrimary }}>
                  {b.barangay_name}
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:sviC, marginBottom:3 }}>
                    {b.svi_score != null ? b.svi_score.toFixed(2) : "—"}
                  </div>
                  <ScoreBar value={b.svi_score??0} max={1300} color={sviC} trackColor={D.trackColor}/>
                  <span style={{ fontSize:9, fontWeight:700, color:sviC }}>{sviT}</span>
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:capC, marginBottom:3 }}>
                    {b.capacity_score != null ? b.capacity_score.toFixed(1) : "—"}
                  </div>
                  <ScoreBar value={b.capacity_score??0} max={100} color={capC} trackColor={D.trackColor}/>
                  <span style={{ fontSize:9, fontWeight:700, color:capC }}>{capDistTierLabel(b.capacity_gap_rank)}</span>
                </div>
                <div style={{ fontSize:11, color:D.textCell, lineHeight:1.6 }}>
                  <div>Flood: <strong style={{ color: toNum(b.flood_pct)>=HAZARD_FLAG_PCT?"#dc2626":D.textCell }}>{toNum(b.flood_pct).toFixed(1)}%</strong></div>
                  <div>Landslide: <strong style={{ color: toNum(b.landslide_pct)>=HAZARD_FLAG_PCT?"#dc2626":D.textCell }}>{toNum(b.landslide_pct).toFixed(1)}%</strong></div>
                </div>
                <div style={{ fontSize:13, color:D.textCell }}>
                  {(b.total_households||0).toLocaleString()}
                </div>
                <div>
                  <span style={{ background:prio.color+(dark?"22":"18"), color:prio.color,
                    border:`1px solid ${prio.color}${dark?"33":"33"}`,
                    borderRadius:5, padding:"3px 9px", fontSize:10.5, fontWeight:700, whiteSpace:"nowrap" }}>
                    {prio.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel -- one domain at a time, chosen with the tabs at
            the top; sized to its content so it never scrolls on its own. */}
        {selected && (() => {
          const idx = filtered.findIndex((x) => x.barangay_name === selected.barangay_name);
          return (
            <PlanningDetail b={selected} all={stats} D={D} dark={dark}
              domain={insightTab} onDomain={setInsightTab}
              onClose={() => setSelected(null)}
              onPrev={idx > 0 ? () => setSelected(filtered[idx - 1]) : null}
              onNext={idx >= 0 && idx < filtered.length - 1 ? () => setSelected(filtered[idx + 1]) : null}
              position={idx >= 0 ? `${idx + 1} of ${filtered.length}` : null} />
          );
        })()}
      </div>
    </div>
  );
}

// Shared with Reports > Planning Recommendations so both pages give the same
// priority, statuses and recommendations.
export { domainPack, generateInsights, priorityInfo };
