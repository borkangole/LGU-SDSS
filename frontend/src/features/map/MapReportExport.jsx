// ============================================================
// MapReportExport.jsx -- "Generate Report (PDF)" for the Map page.
//
// v6 (three-domain model): one report per map view, never a combined score.
//   - svi       -> Official SVI model (Domain A, Level 1)
//   - capacity  -> Barangay Capacity (Domain B, View 2)
//   - hazard    -> Flood / landslide exposure (Domain B, View 1),
//                  with every household drawn at its real coordinates
//   - typology  -> Household typology (k-modes, k=5), descriptive only
//
// The map image is DRAWN from the source GeoJSON onto a canvas instead of
// screenshotting the live Leaflet map. Screenshots (html2canvas /
// leaflet-image) broke in different ways per view -- tile timing, SVG vs
// canvas panes, CORS -- which is why the old report only worked in some
// views. Drawing from data is deterministic and identical in every view.
//
// Each report fetches its own data when the button is clicked (it does not
// depend on which lazy-loaded layers happen to be open on screen), then
// builds: map + legend + key figures + key findings on page 1, and the full
// 24-barangay table for that domain on the following page(s).
// ============================================================
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getDomainBarangays, getDomainCapacity, getDomainTypologyBarangay,
  getGISFlood, getGISLandslide, getHouseholds,
} from "../../api/api";
import { capacityColorByRank, capacityTierFromRank, formatCapacityValue } from "../capacity/capacityShared";
import { sviColorByRank, TYPOLOGY_COLORS, HAZARD_EXPOSURE_COLORS, DISTANCE_COLORS, PLAIN_DOT } from "../shared/domainColors";
import { OFFICIAL_BARANGAY_NAME } from "../shared/barangays";
import { SVI_COMPONENTS } from "../vulnerability/householdCalc";

// Facilities the 2 km distance is measured from (same points as the map).
const RHU = { lat: 10.7814615, lng: 122.4647052, label: "RHU", color: "#6d28d9" };
const FIRE = { lat: 10.78698, lng: 122.46827, label: "Fire Station", color: "#b91c1c" };
function haversineKm(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Colours: identical to MapView.jsx's on-screen legends ──────────────
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const ramp = (dark, light) => (rank) => {
  if (rank == null) return "#d1d5db";
  const t = (Math.min(24, Math.max(1, rank)) - 1) / 23;
  return `rgb(${lerp(dark[0], light[0], t)}, ${lerp(dark[1], light[1], t)}, ${lerp(dark[2], light[2], t)})`;
};
const sviColor = sviColorByRank; // red (rank 1) -> orange -> amber -> green
const capColor = capacityColorByRank; // green (best equipped) -> orange -> red
const tierOf = (rank) => rank == null ? "No data" : rank <= 6 ? "High" : rank <= 12 ? "Moderate-high" : rank <= 18 ? "Moderate-low" : "Low";
const TYPO_COLORS = TYPOLOGY_COLORS;
const FLOOD_COLORS = { VHF: "#000000", HF: "#2E3192", MF: "#92278F", LF: "#E6D6EC" };
const FLOOD_LABELS = { VHF: "Very High", HF: "High", MF: "Moderate", LF: "Low" };
const SLIDE_COLORS = { HL: "#ED1C24", ML: "#39B54A", LL: "#FFF200" };
const SLIDE_LABELS = { HL: "High", ML: "Moderate", LL: "Low" };
const HH_TIERS = {
  4: { label: "Very High", color: HAZARD_EXPOSURE_COLORS["Very High"] }, 3: { label: "High", color: HAZARD_EXPOSURE_COLORS["High"] },
  2: { label: "Moderate", color: HAZARD_EXPOSURE_COLORS["Moderate"] }, 1: { label: "Low", color: HAZARD_EXPOSURE_COLORS["Low"] },
  0: { label: "No exposure", color: HAZARD_EXPOSURE_COLORS["No Exposure"] },
};

const MODES = {
  svi: {
    title: "Official SVI Model", tag: "Domain A · Level 1", file: "svi",
    caption: "Figure 1. Social Vulnerability Index (SVI) by barangay — red = most socially vulnerable (rank 1), green = least (rank 24).",
  },
  capacity: {
    title: "Barangay Capacity", tag: "Domain B · Capacity", file: "barangay_capacity",
    caption: "Figure 1. Barangay capacity (resources and readiness) — green = best equipped (rank 1), red = least equipped.",
  },
  hazard: {
    title: "Spatial Hazard Map", tag: "Domain B · View 1", file: "hazard",
    caption: "Figure 1. Flood and landslide susceptibility zones with every household at its surveyed location.",
  },
  distance: {
    title: "Facility Distance", tag: "Distance to help · 2 km", file: "facility_distance",
    caption: "Figure 1. Every household colored by its straight-line distance to the RHU and the Fire Station; dashed circles mark 2 km.",
  },
  typology: {
    title: "Household Typology", tag: "Domain A · Level 2 (k = 5)", file: "typology",
    caption: "Figure 1. Dominant household profile by barangay (k-modes clustering, descriptive only).",
  },
};

// ── helpers ──────────────────────────────────────────────────────────────
const norm = (s) => String(s || "").toLowerCase()
  .replace(/\bb\.?r?gy\.?\s*/g, "").replace(/\bbarangay\s*/g, "").replace(/\bpob(lacion)?\.?/g, "")
  .replace(/\bsanto\b/g, "sto").replace(/\bsanta\b/g, "sta").replace(/ñ/g, "n")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const featName = (f) => { const p = f.properties || {}; return p.Barangay_n || p.NAME_3 || p.name || p.BARANGAY || ""; };
const num = (v) => (v == null || v === "" || isNaN(v)) ? null : Number(v);
const f1 = (v) => num(v) == null ? "—" : Number(v).toFixed(1);
const fmtInt = (v) => num(v) == null ? "—" : Number(v).toLocaleString();
function matchBy(rows, key) {
  const m = new Map(rows.map(r => [norm(r[key]), r]));
  return (name) => {
    const n = norm(name);
    if (m.has(n)) return m.get(n);
    if (/^\d+$/.test(n)) return null;
    for (const [k, r] of m) if (!/^\d+$/.test(k) && (k.includes(n) || n.includes(k))) return r;
    return null;
  };
}
function hexToRgb(c) {
  if (c.startsWith("rgb")) return c.match(/\d+/g).slice(0, 3).map(Number);
  const h = c.replace("#", "");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

// ── canvas map renderer ─────────────────────────────────────────────────
function rings(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}
function drawMap({ boundaries, fillFor, overlays = [], dots = [], circles = [], labels = true, clip = false, fitDots = false, width = 1600, height = 1150 }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  boundaries.features.forEach(f => rings(f.geometry).forEach(poly => poly[0].forEach(([x, y]) => grow(x, y))));
  // One-barangay report: also fit its households that sit just outside the line.
  if (fitDots) dots.forEach(d => grow(d.lng, d.lat));
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const pad = 40, spanX = (maxX - minX) * kx, spanY = maxY - minY;
  const s = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const ox = (width - spanX * s) / 2, oy = (height - spanY * s) / 2;
  const P = ([x, y]) => [ox + (x - minX) * kx * s, oy + (maxY - y) * s];

  const cv = document.createElement("canvas");
  cv.width = width; cv.height = height;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  const path = (poly) => {
    ctx.beginPath();
    poly.forEach(ring => ring.forEach((pt, i) => { const [px, py] = P(pt); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }));
    ctx.closePath();
  };

  boundaries.features.forEach(f => {
    const fill = fillFor ? fillFor(featName(f)) : "#f1f5f9";
    rings(f.geometry).forEach(poly => { path(poly); ctx.fillStyle = fill; ctx.fill("evenodd"); });
  });
  if (clip && overlays.length) {
    // Hazard zones only inside the drawn barangay(s).
    ctx.save(); ctx.beginPath();
    boundaries.features.forEach(f => rings(f.geometry).forEach(poly => poly.forEach(ring => ring.forEach((pt, i) => {
      const [px, py] = P(pt); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }))));
    ctx.clip("evenodd");
  }
  overlays.forEach(({ geojson, colorFor, alpha = 0.55, dash }) => {
    (geojson?.features || []).forEach(f => {
      const c = colorFor(f.properties || {});
      if (!c) return;
      rings(f.geometry).forEach(poly => {
        path(poly); ctx.globalAlpha = alpha; ctx.fillStyle = c; ctx.fill("evenodd");
        ctx.globalAlpha = 0.9; ctx.strokeStyle = c; ctx.lineWidth = 0.8; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
      });
    });
    ctx.globalAlpha = 1;
  });
  if (clip && overlays.length) ctx.restore();
  const dotR = fitDots ? 5 : 2.4;
  dots.forEach(d => {
    const [px, py] = P([d.lng, d.lat]);
    ctx.beginPath(); ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fillStyle = d.color; ctx.fill();
    ctx.lineWidth = d.stroke ? 1.4 : (fitDots ? 1 : 0.4); ctx.strokeStyle = d.stroke || "rgba(255,255,255,0.85)"; ctx.stroke();
  });
  boundaries.features.forEach(f => rings(f.geometry).forEach(poly => {
    path(poly); ctx.strokeStyle = "rgba(15,23,42,0.55)"; ctx.lineWidth = 1.1; ctx.stroke();
  }));
  // Service circles (radius in metres) with a labelled pin at the centre.
  circles.forEach(({ lat, lng, radiusM, color, label }) => {
    const [px, py] = P([lng, lat]);
    const r = (radiusM / 111320) * s;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "#ffffff"; ctx.stroke();
    if (label) {
      ctx.font = "700 18px Helvetica, Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = color; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(px - w / 2, py - 40, w, 26, 13); else ctx.rect(px - w / 2, py - 40, w, 26);
      ctx.fill(); ctx.fillStyle = "#ffffff"; ctx.fillText(label, px, py - 19);
    }
  });
  if (labels) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    boundaries.features.forEach(f => {
      let best = null;
      rings(f.geometry).forEach(poly => {
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        poly[0].forEach(pt => { const [x, y] = P(pt); a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); });
        const area = (c - a) * (d - b);
        if (!best || area > best.area) best = { area, cx: (a + c) / 2, cy: (b + d) / 2, w: c - a };
      });
      if (!best || (best.w < 60 && boundaries.features.length > 1)) return; // too small to label legibly (poblacion blocks)
      const name = featName(f).replace(/^(Brgy\.?|Barangay)\s*/i, "");
      ctx.font = "600 17px Helvetica, Arial, sans-serif";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.strokeText(name, best.cx, best.cy);
      ctx.fillStyle = "#0f172a"; ctx.fillText(name, best.cx, best.cy);
    });
  }
  return cv;
}

// ── report content per view (pure data, no drawing) ─────────────────────
async function buildContent(mode, { households, floodGeojson, landslideGeojson }) {
  if (mode === "svi") {
    const rows = (await getDomainBarangays()).data?.data || [];
    const find = matchBy(rows, "barangay");
    const sorted = [...rows].sort((a, b) => a.svi_rank - b.svi_rank);
    const tiers = ["High", "Moderate-high"].map(t => sorted.filter(r => tierOf(r.svi_rank) === t).map(r => r.barangay));
    return {
      fillFor: (n) => sviColor(find(n)?.svi_rank),
      legend: [["High", "Rank 1–6", sviColor(3)], ["Moderate-high", "Rank 7–12", sviColor(9)], ["Moderate-low", "Rank 13–18", sviColor(15)], ["Low", "Rank 19–24", sviColor(21)]],
      kpis: [["Barangays", sorted.length], ["Most vulnerable", sorted[0]?.barangay || "—"], ["Highest SVI score", f1(sorted[0]?.svi_score)], ["Score range", `${f1(sorted[sorted.length - 1]?.svi_score)}–${f1(sorted[0]?.svi_score)}`]],
      findings: [
        `High SVI tier (rank 1–6): ${tiers[0].join(", ")}.`,
        `Moderate-high tier (rank 7–12): ${tiers[1].join(", ")}.`,
        "SVI is the equal-weight percentile-rank sum of 13 components (11 social indicators + share of households beyond 2 km of the RHU and fire station, max 1,300); tiers are equal 6-barangay quartiles by rank, not fixed score cutoffs.",
        "SVI is reported on its own. It is never added to or averaged with Barangay Capacity or hazard exposure.",
      ],
      table: {
        title: "SVI ranking — all barangays",
        cols: [["Rank", 14], ["Barangay", 52], ["Households", 26], ["SVI score", 26], ["Tier", 38]],
        rows: sorted.map(r => [`#${r.svi_rank}`, r.barangay, fmtInt(r.households), f1(r.svi_score), tierOf(r.svi_rank)]),
        swatch: (i) => sviColor(sorted[i].svi_rank), swatchCol: 4,
      },
    };
  }

  if (mode === "capacity") {
    const rows = (await getDomainCapacity()).data?.data || [];
    const find = matchBy(rows, "barangay");
    const sorted = [...rows].sort((a, b) => a.capacity_rank - b.capacity_rank);
    const val = (r, k) => (r.indicators || []).find(i => i.key === k);
    const has = (r, k) => (r.readiness || []).find(x => x.key === k)?.has;
    const none = (k) => rows.filter(r => num(val(r, k)?.value) === 0).length;
    const lacks = (k) => rows.filter(r => has(r, k) === false).length;
    return {
      fillFor: (n) => capColor(find(n)?.capacity_rank),
      legend: [["High capacity", "Rank 1–6", capColor(3)], ["Moderate-high", "Rank 7–12", capColor(9)], ["Moderate-low", "Rank 13–18", capColor(15)], ["Low capacity", "Rank 19–24", capColor(21)]],
      kpis: [["No ambulance", `${none("f16_c_ambulance")} brgy`], ["No generator", `${none("f16_h_generator")} brgy`], ["No evacuation map", `${lacks("f09_evacuation_map_presence")} brgy`], ["No hazard map", `${lacks("f11_hazard_map_presence")} brgy`]],
      findings: [
        `Best equipped (rank 1–6): ${sorted.filter(r => r.capacity_rank <= 6).map(r => r.barangay).join(", ")}.`,
        `Least equipped (rank 19–24): ${sorted.filter(r => r.capacity_rank >= 19).map(r => r.barangay).join(", ")}.`,
        "Score = average of 0–100 percentiles of the barangay's DRRM organisation, plans and maps, schools and evacuation centres, equipment and budget across the 24 barangays. Rank 1 = best equipped.",
        "DRRM plan, evacuation map, hazard map, schools and evacuation centres are scored items. Distance is part of vulnerability, not capacity. Kept separate from SVI and hazard.",
      ],
      table: {
        title: "Barangay capacity ranking — all barangays",
        cols: [["Rank", 12], ["Barangay", 36], ["Score", 14], ["Tier", 26], ["Ambulance", 18], ["Radios", 15], ["Generator", 18], ["Evac map", 16], ["Schools", 15]],
        rows: sorted.map(r => [`#${r.capacity_rank}`, r.barangay, f1(r.capacity_score), capacityTierFromRank(r.capacity_rank),
          formatCapacityValue(val(r, "f16_c_ambulance")), formatCapacityValue(val(r, "f16_g_radio")), formatCapacityValue(val(r, "f16_h_generator")),
          has(r, "f09_evacuation_map_presence") ? "Yes" : "No", String((r.schools || []).length)]),
        swatch: (i) => capColor(sorted[i].capacity_rank), swatchCol: 0,
      },
    };
  }

  if (mode === "hazard") {
    const [rowsRes, fl, ls, hh] = await Promise.all([
      getDomainBarangays(),
      floodGeojson ? Promise.resolve({ data: floodGeojson }) : getGISFlood().catch(() => ({ data: null })),
      landslideGeojson ? Promise.resolve({ data: landslideGeojson }) : getGISLandslide().catch(() => ({ data: null })),
      households?.length ? Promise.resolve({ data: { data: households } }) : getHouseholds({ page: 1, per_page: 9999, limit: 9999 }).catch(() => ({ data: { data: [] } })),
    ]);
    const rows = rowsRes.data?.data || [];
    const hhs = hh.data?.data || [];
    const dots = hhs.map(h => ({ lat: num(h.latitude), lng: num(h.longitude), score: num(h.hazard_exposure_score) }))
      .filter(d => d.lat && d.lng).map(d => ({ ...d, color: (HH_TIERS[d.score] || { color: "#94a3b8" }).color }));
    dots.sort((a, b) => (a.score ?? -1) - (b.score ?? -1)); // most exposed drawn last (on top)
    const tierCount = [4, 3, 2, 1, 0].map(s => [HH_TIERS[s].label, hhs.filter(h => num(h.hazard_exposure_score) === s).length]);
    const hz = (r) => ({ f: num(r.hazard?.flood_high_or_very_high_pct_total) ?? 0, l: num(r.hazard?.landslide_moderate_or_high_pct_total) ?? 0,
      fh: num(r.hazard?.flood_high_or_very_high_households) ?? 0, lh: num(r.hazard?.landslide_moderate_or_high_households) ?? 0 });
    const worst = (r) => Math.max(hz(r).f, hz(r).l);
    const sorted = [...rows].sort((a, b) => worst(b) - worst(a));
    const level = (r) => worst(r) >= 25 ? "High exposure" : worst(r) >= 10 ? "Moderate" : "Low";
    const flagged = sorted.filter(r => worst(r) >= 25);
    const totF = rows.reduce((s, r) => s + hz(r).fh, 0), totL = rows.reduce((s, r) => s + hz(r).lh, 0);
    return {
      fillFor: () => "#f8fafc",
      overlays: [
        { geojson: fl.data, colorFor: (p) => FLOOD_COLORS[p.FloodSusc], alpha: 0.5 },
        { geojson: ls.data, colorFor: (p) => SLIDE_COLORS[p.LndslideSu], alpha: 0.45, dash: [6, 4] },
      ],
      dots,
      legend: [
        ...["VHF", "HF", "MF", "LF"].map(k => [`Flood — ${FLOOD_LABELS[k]}`, "zone", FLOOD_COLORS[k]]),
        ...["HL", "ML", "LL"].map(k => [`Landslide — ${SLIDE_LABELS[k]}`, "zone", SLIDE_COLORS[k]]),
        ...[4, 3, 2, 1, 0].map(s => [`Household: ${HH_TIERS[s].label}`, "dot", HH_TIERS[s].color]),
      ],
      kpis: [["Households mapped", dots.length.toLocaleString()], ["In High/V.High flood", totF.toLocaleString()], ["In Mod/High landslide", totL.toLocaleString()], ["Brgy 25%+ exposed", flagged.length]],
      findings: [
        `Significant exposure (25% or more of households in the High/Very-High flood band or the Moderate/High landslide band): ${flagged.map(r => `${r.barangay} (flood ${f1(hz(r).f)}%, landslide ${f1(hz(r).l)}%)`).join("; ") || "none"}.`,
        `Household exposure tiers — ${tierCount.map(([l, n]) => `${l}: ${n.toLocaleString()}`).join(" · ")}. A household's tier is the worse of its flood or landslide level.`,
        "Flood and landslide are always counted separately and never added together. Households outside a mapped hazard layer are \"unmapped\", not \"safe\".",
      ],
      table: {
        title: "Hazard exposure by barangay",
        cols: [["Barangay", 44], ["Households", 24], ["Flood HH", 22], ["Flood %", 20], ["Landslide HH", 26], ["Landslide %", 24], ["Level", 26]],
        rows: sorted.map(r => [r.barangay, fmtInt(r.households), fmtInt(hz(r).fh), `${f1(hz(r).f)}%`, fmtInt(hz(r).lh), `${f1(hz(r).l)}%`, level(r)]),
        swatch: (i) => ({ "High exposure": "#dc2626", Moderate: "#d97706", Low: "#16a34a" })[level(sorted[i])], swatchCol: 6,
      },
    };
  }

  if (mode === "distance") {
    const [rowsRes, hh] = await Promise.all([
      getDomainBarangays(),
      households?.length ? Promise.resolve({ data: { data: households } }) : getHouseholds({ page: 1, per_page: 9999, limit: 9999 }).catch(() => ({ data: { data: [] } })),
    ]);
    const official = matchBy(rowsRes.data?.data || [], "barangay");
    const ORDER = { "Beyond both": 2, "Beyond one": 1, "Within 2 km": 0 };
    const by = {}, tot = { all: 0, both: 0, one: 0, within: 0 };
    const dots = [];
    (hh.data?.data || []).forEach((h) => {
      const lat = num(h.latitude), lng = num(h.longitude);
      if (!lat || !lng) return;
      const beyond = (haversineKm(lat, lng, RHU.lat, RHU.lng) > 2 ? 1 : 0) + (haversineKm(lat, lng, FIRE.lat, FIRE.lng) > 2 ? 1 : 0);
      const label = beyond === 2 ? "Beyond both" : beyond === 1 ? "Beyond one" : "Within 2 km";
      dots.push({ lat, lng, label, color: DISTANCE_COLORS[label] });
      const k = norm(h.barangay_name);
      const r = by[k] || (by[k] = { name: official(h.barangay_name)?.barangay || h.barangay_name, all: 0, both: 0, one: 0, within: 0 });
      const key = beyond === 2 ? "both" : beyond === 1 ? "one" : "within";
      r.all++; r[key]++; tot.all++; tot[key]++;
    });
    dots.sort((a, b) => ORDER[a.label] - ORDER[b.label]);
    const pc = (n, d) => (d ? (n / d) * 100 : 0);
    const sorted = Object.values(by).sort((a, b) => pc(b.both + b.one, b.all) - pc(a.both + a.one, a.all) || pc(b.both, b.all) - pc(a.both, a.all));
    const allFar = sorted.filter((r) => r.both === r.all).map((r) => r.name);
    return {
      fillFor: () => "#f8fafc",
      dots,
      circles: [{ ...RHU, radiusM: 2000 }, { ...FIRE, radiusM: 2000 }],
      legend: [
        ["Beyond 2 km of both", "dot", DISTANCE_COLORS["Beyond both"]],
        ["Beyond 2 km of one", "dot", DISTANCE_COLORS["Beyond one"]],
        ["Within 2 km of both", "dot", DISTANCE_COLORS["Within 2 km"]],
        ["2 km from the RHU", "circle", RHU.color],
        ["2 km from the Fire Station", "circle", FIRE.color],
      ],
      kpis: [["Households mapped", tot.all.toLocaleString()], ["Beyond 2 km of both", `${f1(pc(tot.both, tot.all))}%`],
        ["Beyond 2 km of one", `${f1(pc(tot.one, tot.all))}%`], ["Within 2 km of both", `${f1(pc(tot.within, tot.all))}%`]],
      findings: [
        `${tot.both.toLocaleString()} households (${f1(pc(tot.both, tot.all))}%) are more than 2 km from both the RHU and the Fire Station; ${tot.within.toLocaleString()} (${f1(pc(tot.within, tot.all))}%) are within 2 km of both.`,
        allFar.length ? `Every household is beyond 2 km of both facilities in: ${allFar.join(", ")}.` : "No barangay has all of its households beyond 2 km of both facilities.",
        `Farthest from help (share of households beyond 2 km of at least one facility): ${sorted.slice(0, 5).map((r) => `${r.name} ${f1(pc(r.both + r.one, r.all))}%`).join("; ")}.`,
        "Straight-line distance from each household's CBMS location, 2 km threshold. Distance is part of household vulnerability (it enters the SVI); it is shown here on its own, never combined with capacity or hazard.",
      ],
      table: {
        title: "Distance to help by barangay",
        cols: [["Barangay", 40], ["Households", 22], ["Beyond both", 24], ["Beyond one", 24], ["Within both", 24], ["Beyond 2 km", 24]],
        rows: sorted.map((r) => [r.name, fmtInt(r.all), `${fmtInt(r.both)} (${f1(pc(r.both, r.all))}%)`, `${fmtInt(r.one)} (${f1(pc(r.one, r.all))}%)`,
          `${fmtInt(r.within)} (${f1(pc(r.within, r.all))}%)`, `${f1(pc(r.both + r.one, r.all))}%`]),
        swatch: (i) => { const r = sorted[i]; return r.both >= r.one && r.both >= r.within ? DISTANCE_COLORS["Beyond both"] : r.one >= r.within ? DISTANCE_COLORS["Beyond one"] : DISTANCE_COLORS["Within 2 km"]; },
        swatchCol: 5,
      },
    };
  }

  // typology
  const rows = (await getDomainTypologyBarangay()).data?.data || [];
  const find = matchBy(rows, "barangay");
  const totals = {}, labels = {};
  let totHH = 0;
  rows.forEach(r => {
    const n = num(r.n_households) || 0; totHH += n;
    (r.clusters || []).forEach(c => { totals[c.cluster_id] = (totals[c.cluster_id] || 0) + n * (num(c.pct) || 0) / 100; labels[c.cluster_id] = c.label; });
  });
  const comp = Object.keys(totals).map(k => ({ id: Number(k), label: labels[k], pct: totHH ? totals[k] / totHH * 100 : 0 })).sort((a, b) => b.pct - a.pct);
  const domCount = {};
  rows.forEach(r => { domCount[r.dominant_cluster_label] = (domCount[r.dominant_cluster_label] || 0) + 1; });
  const sorted = [...rows].sort((a, b) => String(a.barangay).localeCompare(String(b.barangay), undefined, { numeric: true }));
  const pctOf = (r, id) => f1((r.clusters || []).find(c => c.cluster_id === id)?.pct);
  return {
    fillFor: (n) => TYPO_COLORS[find(n)?.dominant_cluster_id] || "#d1d5db",
    legend: [0, 1, 2, 3, 4].map(id => [labels[id] || `Cluster ${id}`, "profile", TYPO_COLORS[id]]),
    kpis: [["Households", totHH.toLocaleString()], ["Profiles (k)", 5], ["Largest profile", comp[0]?.label || "—"], ["Its share", `${f1(comp[0]?.pct)}%`]],
    findings: [
      `Municipal composition — ${comp.map(c => `${c.label}: ${f1(c.pct)}%`).join(" · ")}.`,
      `Dominant profile by barangay — ${Object.entries(domCount).map(([l, n]) => `${l}: ${n}`).join(" · ")}.`,
      "Profiles are descriptive groupings of households from k-modes clustering. They are not a severity ranking and are not part of the SVI score.",
    ],
    table: {
      title: "Household profile share by barangay (%)",
      cols: [["Barangay", 34], ["HH", 16], ["Dominant profile", 46], ...[0, 1, 2, 3, 4].map(id => [`C${id}`, 13])],
      rows: sorted.map(r => [r.barangay, fmtInt(r.n_households), r.dominant_cluster_label, ...[0, 1, 2, 3, 4].map(id => pctOf(r, id))]),
      swatch: (i) => TYPO_COLORS[sorted[i].dominant_cluster_id], swatchCol: 2,
      note: [0, 1, 2, 3, 4].map(id => `C${id} = ${labels[id]}`).join(" · "),
    },
  };
}

// ── one-barangay report: its own boundary, its own households, its own figures ──
async function loadAllHouseholds(households) {
  if (households?.length) return households;
  return (await getHouseholds({ page: 1, per_page: 9999, limit: 9999 }).catch(() => ({ data: { data: [] } }))).data?.data || [];
}
const pctTxt = (n, d) => (d ? `${f1((n / d) * 100)}%` : "0.0%");
const plainDots = (hhs) => hhs.map(h => ({ lat: num(h.latitude), lng: num(h.longitude), color: PLAIN_DOT.fill, stroke: PLAIN_DOT.stroke })).filter(d => d.lat && d.lng);
const HOUSEHOLD_LEGEND = ["Household (CBMS location)", "dot", PLAIN_DOT.fill];

async function buildBarangayContent(mode, scope, { households, floodGeojson, landslideGeojson }) {
  const all = await loadAllHouseholds(households);
  const hhs = all.filter(h => norm(h.barangay_name) === scope.key);
  const name = scope.name;
  const base = { scopeName: name, fillFor: () => "#f8fafc" };

  if (mode === "svi") {
    const rows = (await getDomainBarangays()).data?.data || [];
    const r = rows.find(x => norm(x.barangay) === scope.key);
    if (!r) throw new Error(`No SVI result for ${name}.`);
    const comp = SVI_COMPONENTS.map(c => {
      const raw = c.access ? num(r[c.key]) : num(r.social_indicators?.[c.key]);
      return { ...c, value: raw == null ? "—" : c.unit === "%" ? `${f1(raw * 100)}%` : `${f1(raw)}%`, pct: num(r.svi_percentiles?.[c.key]) };
    });
    const top = [...comp].filter(c => c.pct != null).sort((a, b) => b.pct - a.pct).slice(0, 3);
    return {
      ...base,
      fillFor: () => sviColor(r.svi_rank),
      dots: plainDots(hhs),
      caption: `Figure 1. ${name} shaded by its SVI tier (${tierOf(r.svi_rank)}), with each of its ${fmtInt(hhs.length)} households at its CBMS location.`,
      legend: [[`SVI tier: ${tierOf(r.svi_rank)}`, `Rank ${r.svi_rank} of 24`, sviColor(r.svi_rank)], HOUSEHOLD_LEGEND],
      kpis: [["SVI rank (1 = most vulnerable)", `#${r.svi_rank} of 24`], ["SVI score (max 1,300)", f1(r.svi_score)], ["Tier", tierOf(r.svi_rank)], ["Households", fmtInt(r.households)]],
      findings: [
        `${name} ranks #${r.svi_rank} of 24 barangays on the Social Vulnerability Index (${tierOf(r.svi_rank)} tier), with a score of ${f1(r.svi_score)}.`,
        `Its highest components compared with the other barangays: ${top.map(c => `${c.label} (${c.value}, percentile ${f1(c.pct)})`).join("; ")}.`,
        "Each component is the barangay's share of households or people with that condition, turned into a 0–100 percentile across the 24 barangays; the SVI is the sum of the 13 percentiles.",
        "SVI is reported on its own. It is never added to or averaged with Barangay Capacity or hazard exposure.",
      ],
      table: {
        title: `${name}: the 13 SVI components`,
        cols: [["Component", 70], ["Barangay value", 30], ["Percentile (0–100)", 30]],
        rows: [...comp.map(c => [c.label, c.value, c.pct == null ? "—" : f1(c.pct)]), ["SVI score (sum of percentiles)", "", f1(r.svi_score)]],
      },
    };
  }

  if (mode === "capacity") {
    const rows = (await getDomainCapacity()).data?.data || [];
    const r = rows.find(x => norm(x.barangay) === scope.key);
    if (!r) throw new Error(`No capacity result for ${name}.`);
    const inds = r.indicators || [];
    const missing = [...new Map([...inds.filter(i => num(i.value) === 0).map(i => i.label), ...(r.readiness || []).filter(x => x.has === false).map(x => x.label)]
      .map(l => [l.toLowerCase(), l])).values()];
    const strong = inds.filter(i => num(i.percentile) >= 75).map(i => i.label);
    return {
      ...base,
      fillFor: () => capColor(r.capacity_rank),
      dots: plainDots(hhs),
      caption: `Figure 1. ${name} shaded by its capacity tier (${capacityTierFromRank(r.capacity_rank)}), with each of its households at its CBMS location.`,
      legend: [[capacityTierFromRank(r.capacity_rank), `Rank ${r.capacity_rank} of 24`, capColor(r.capacity_rank)], HOUSEHOLD_LEGEND],
      kpis: [["Capacity rank (1 = best equipped)", `#${r.capacity_rank} of 24`], ["Capacity score (0–100)", f1(r.capacity_score)],
        ["Schools", String((r.schools || []).length)], ["Evacuation centres", String((r.evacuation_centers || []).length)]],
      findings: [
        `${name} ranks #${r.capacity_rank} of 24 on Barangay Capacity (${capacityTierFromRank(r.capacity_rank)}), score ${f1(r.capacity_score)} out of 100.`,
        missing.length ? `Not on record: ${missing.join(", ")}.` : "Every scored item is on record.",
        strong.length ? `Stronger than most barangays (75th percentile or higher): ${strong.join(", ")}.` : "No item is in the top quarter of the 24 barangays.",
        "Score = average of the 0–100 percentiles of its scored items across the 24 barangays. Capacity is reported on its own, never combined with SVI or hazard.",
      ],
      table: {
        title: `${name}: capacity items`,
        cols: [["Item", 60], ["Group", 50], ["On record", 26], ["Percentile", 22]],
        rows: inds.map(i => [i.label, i.dimension || "—", formatCapacityValue(i), i.percentile == null ? "—" : f1(i.percentile)]),
      },
    };
  }

  if (mode === "hazard") {
    const [rowsRes, fl, ls] = await Promise.all([
      getDomainBarangays(),
      floodGeojson ? Promise.resolve({ data: floodGeojson }) : getGISFlood().catch(() => ({ data: null })),
      landslideGeojson ? Promise.resolve({ data: landslideGeojson }) : getGISLandslide().catch(() => ({ data: null })),
    ]);
    const r = (rowsRes.data?.data || []).find(x => norm(x.barangay) === scope.key) || {};
    const dots = hhs.map(h => ({ lat: num(h.latitude), lng: num(h.longitude), score: num(h.hazard_exposure_score) }))
      .filter(d => d.lat && d.lng).map(d => ({ ...d, color: (HH_TIERS[d.score] || { color: "#94a3b8" }).color }))
      .sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
    const counts = [4, 3, 2, 1, 0].map(t => [t, hhs.filter(h => num(h.hazard_exposure_score) === t).length]);
    const fh = num(r.hazard?.flood_high_or_very_high_households) ?? 0, lh = num(r.hazard?.landslide_moderate_or_high_households) ?? 0;
    return {
      ...base,
      dots,
      overlays: [
        { geojson: fl.data, colorFor: (p) => FLOOD_COLORS[p.FloodSusc], alpha: 0.45 },
        { geojson: ls.data, colorFor: (p) => SLIDE_COLORS[p.LndslideSu], alpha: 0.4, dash: [6, 4] },
      ],
      caption: `Figure 1. Flood and landslide zones inside ${name}, with each of its households colored by its own exposure.`,
      legend: [
        ...["VHF", "HF", "MF", "LF"].map(k => [`Flood — ${FLOOD_LABELS[k]}`, "zone", FLOOD_COLORS[k]]),
        ...["HL", "ML", "LL"].map(k => [`Landslide — ${SLIDE_LABELS[k]}`, "zone", SLIDE_COLORS[k]]),
        ...[4, 3, 2, 1, 0].map(t => [`Household: ${HH_TIERS[t].label}`, "dot", HH_TIERS[t].color]),
      ],
      kpis: [["Households", fmtInt(hhs.length)], ["In High/V.High flood", `${fmtInt(fh)} (${f1(r.hazard?.flood_high_or_very_high_pct_total)}%)`],
        ["In Mod/High landslide", `${fmtInt(lh)} (${f1(r.hazard?.landslide_moderate_or_high_pct_total)}%)`], ["Very High households", fmtInt(counts[0][1])]],
      findings: [
        `${fmtInt(fh)} of ${name}'s households are in a High or Very High flood zone and ${fmtInt(lh)} in a Moderate or High landslide zone.`,
        `Household exposure: ${counts.map(([t, n]) => `${HH_TIERS[t].label} ${fmtInt(n)}`).join(" · ")}. A household's level is the worse of its flood or landslide zone.`,
        "Flood and landslide are counted separately and never added together. A household outside every mapped zone is \"unmapped\", not \"safe\".",
      ],
      table: {
        title: `${name}: households by hazard exposure`,
        cols: [["Exposure level", 60], ["Households", 30], ["Share", 30]],
        rows: counts.map(([t, n]) => [HH_TIERS[t].label, fmtInt(n), pctTxt(n, hhs.length)]),
        swatch: (i) => HH_TIERS[counts[i][0]].color, swatchCol: 0,
      },
    };
  }

  if (mode === "distance") {
    const groups = { "Beyond both": 0, "Beyond one": 0, "Within 2 km": 0 };
    let rhuSum = 0, fireSum = 0, nPos = 0;
    const dots = [];
    hhs.forEach(h => {
      const lat = num(h.latitude), lng = num(h.longitude);
      if (!lat || !lng) return;
      const rk = haversineKm(lat, lng, RHU.lat, RHU.lng), fk = haversineKm(lat, lng, FIRE.lat, FIRE.lng);
      const b = (rk > 2 ? 1 : 0) + (fk > 2 ? 1 : 0);
      const label = b === 2 ? "Beyond both" : b === 1 ? "Beyond one" : "Within 2 km";
      groups[label]++; rhuSum += rk; fireSum += fk; nPos++;
      dots.push({ lat, lng, label, color: DISTANCE_COLORS[label] });
    });
    const order = { "Beyond both": 2, "Beyond one": 1, "Within 2 km": 0 };
    dots.sort((a, b) => order[a.label] - order[b.label]);
    const labels = { "Beyond both": "Beyond 2 km of both", "Beyond one": "Beyond 2 km of one", "Within 2 km": "Within 2 km of both" };
    return {
      ...base,
      dots,
      circles: [{ ...RHU, radiusM: 2000 }, { ...FIRE, radiusM: 2000 }],
      caption: `Figure 1. ${name}'s households colored by straight-line distance to the RHU and the Fire Station; dashed circles mark 2 km where they reach the barangay.`,
      legend: [...Object.keys(groups).map(k => [labels[k], "dot", DISTANCE_COLORS[k]]), ["2 km from the RHU", "circle", RHU.color], ["2 km from the Fire Station", "circle", FIRE.color]],
      kpis: [["Households mapped", fmtInt(nPos)], ["Beyond 2 km of both", pctTxt(groups["Beyond both"], nPos)], ["Beyond 2 km of one", pctTxt(groups["Beyond one"], nPos)], ["Within 2 km of both", pctTxt(groups["Within 2 km"], nPos)]],
      findings: [
        `${fmtInt(groups["Beyond both"])} of ${name}'s ${fmtInt(nPos)} households are more than 2 km from both the RHU and the Fire Station; ${fmtInt(groups["Within 2 km"])} are within 2 km of both.`,
        `Average straight-line distance: ${nPos ? (rhuSum / nPos).toFixed(2) : "—"} km to the RHU and ${nPos ? (fireSum / nPos).toFixed(2) : "—"} km to the Fire Station.`,
        "Straight-line distance from each household's CBMS location, 2 km threshold. Distance is part of household vulnerability (it enters the SVI); it is shown here on its own.",
      ],
      table: {
        title: `${name}: households by distance to help`,
        cols: [["Group", 60], ["Households", 30], ["Share", 30]],
        rows: Object.keys(groups).map(k => [labels[k], fmtInt(groups[k]), pctTxt(groups[k], nPos)]),
        swatch: (i) => DISTANCE_COLORS[Object.keys(groups)[i]], swatchCol: 0,
      },
    };
  }

  // typology
  const rows = (await getDomainTypologyBarangay()).data?.data || [];
  const r = rows.find(x => norm(x.barangay) === scope.key);
  if (!r) throw new Error(`No typology result for ${name}.`);
  const cl = [...(r.clusters || [])].sort((a, b) => (num(b.pct) || 0) - (num(a.pct) || 0));
  const dots = hhs.map(h => ({ lat: num(h.latitude), lng: num(h.longitude), color: TYPO_COLORS[num(h.typology_cluster_id)] || "#94a3b8" })).filter(d => d.lat && d.lng);
  return {
    ...base,
    fillFor: () => "#f8fafc",
    dots,
    caption: `Figure 1. ${name}'s households, each colored by its closest household profile (k-modes, descriptive only).`,
    legend: [0, 1, 2, 3, 4].map(id => [(r.clusters || []).find(c => c.cluster_id === id)?.label || `Cluster ${id}`, "dot", TYPO_COLORS[id]]),
    kpis: [["Households", fmtInt(r.n_households)], ["Most common profile", r.dominant_cluster_label || "—"], ["Its share", `${f1(r.dominant_cluster_pct)}%`], ["Profiles present", String(cl.filter(c => num(c.pct) > 0).length)]],
    findings: [
      `${name}: ${cl.map(c => `${c.label} ${f1(c.pct)}%`).join(" · ")}.`,
      "Profiles are descriptive groupings of households from k-modes clustering. They are not a severity ranking and are not part of the SVI score.",
    ],
    table: {
      title: `${name}: household profiles`,
      cols: [["Profile", 70], ["Share", 25], ["Households (approx.)", 35]],
      rows: cl.map(c => [c.label, `${f1(c.pct)}%`, fmtInt(Math.round((num(r.n_households) || 0) * (num(c.pct) || 0) / 100))]),
      swatch: (i) => TYPO_COLORS[cl[i].cluster_id], swatchCol: 0,
    },
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────
async function buildPdf(mode, content, mapCanvas, { save = true, pdf: into = null, pageStart = 1 } = {}) {
  const { jsPDF } = await import("jspdf");
  const meta = MODES[mode];
  const pdf = into || new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  if (into) pdf.addPage();
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 14, CW = W - 2 * M;
  const date = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  const setC = (c) => pdf.setTextColor(...hexToRgb(c));
  const header = () => {
    pdf.setFillColor(15, 42, 74); pdf.rect(0, 0, W, 3.5, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); setC("#5b7699");
    pdf.text("LGU SPATIAL DECISION SUPPORT SYSTEM · MUNICIPALITY OF SAN MIGUEL, ILOILO", M, 10);
  };
  const footer = (n) => {
    pdf.setDrawColor(214, 222, 232); pdf.setLineWidth(0.2); pdf.line(M, H - 12, W - M, H - 12);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); setC("#94a3b8");
    pdf.text(`Generated ${date} · Source: 2024 CBMS, domain pipeline outputs`, M, H - 7);
    pdf.text(`Page ${n + pageStart - 1}`, W - M, H - 7, { align: "right" });
  };

  // Page 1
  header();
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(19); setC("#0f172a");
  pdf.text(content.scopeName ? `${meta.title} — ${content.scopeName}` : meta.title, M, 21, { maxWidth: CW });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); setC("#64748b");
  pdf.text(`${meta.tag} · SVI, Barangay Capacity and Hazard are separate domains and are never combined into one score.`, M, 27, { maxWidth: CW });
  let y = 32;

  const legendW = 50, mapW = CW - legendW - 4;
  const mapH = Math.min(mapW * mapCanvas.height / mapCanvas.width, 118);
  pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(0.3); pdf.rect(M, y, mapW, mapH);
  pdf.addImage(mapCanvas.toDataURL("image/jpeg", 0.92), "JPEG", M + 0.5, y + 0.5, mapW - 1, mapH - 1);
  let ly = y + 4;
  const lx = M + mapW + 4;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); setC("#0f172a"); pdf.text("Legend", lx, ly); ly += 4.5;
  content.legend.forEach(([label, sub, color]) => {
    const [r, g, b] = hexToRgb(color);
    pdf.setFillColor(r, g, b); pdf.setDrawColor(148, 163, 184); pdf.setLineWidth(0.15);
    if (sub === "dot") { if (color.toLowerCase() === "#ffffff") pdf.setDrawColor(30, 58, 138); pdf.circle(lx + 1.8, ly - 1.2, 1.4, "FD"); }
    else if (sub === "circle") { pdf.setDrawColor(r, g, b); pdf.setLineWidth(0.5); pdf.setLineDashPattern([0.8, 0.6], 0); pdf.circle(lx + 1.8, ly - 1.2, 1.6, "S"); pdf.setLineDashPattern([], 0); }
    else pdf.rect(lx, ly - 2.8, 3.6, 3.2, "FD");
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); setC("#334155");
    const lines = pdf.splitTextToSize(label, legendW - 6);
    pdf.text(lines, lx + 5.5, ly);
    let extra = 0;
    if (sub && !["dot", "zone", "profile", "circle"].includes(sub)) { setC("#94a3b8"); pdf.text(sub, lx + 5.5, ly + 3.1 * lines.length); extra = 3; }
    ly += 3.1 * lines.length + 1.8 + extra;
  });
  y += mapH + 4;
  pdf.setFont("helvetica", "italic"); pdf.setFontSize(8); setC("#64748b");
  pdf.text(content.caption || meta.caption, M, y, { maxWidth: CW }); y += 7;

  const kw = (CW - 9) / 4;
  content.kpis.forEach(([label, value], i) => {
    const x = M + i * (kw + 3);
    pdf.setFillColor(248, 250, 252); pdf.setDrawColor(226, 232, 240); pdf.roundedRect(x, y, kw, 16, 1.5, 1.5, "FD");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(String(value).length > 14 ? 9 : 12); setC("#0f172a");
    pdf.text(pdf.splitTextToSize(String(value), kw - 4)[0], x + 3, y + 7);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); setC("#64748b"); pdf.text(label, x + 3, y + 12.5);
  });
  y += 22;

  pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); setC("#0f172a"); pdf.text("Key findings", M, y); y += 5;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.8); setC("#334155");
  content.findings.forEach(t => {
    const lines = pdf.splitTextToSize(t, CW - 5);
    if (y + lines.length * 4 > H - 16) return;
    pdf.setFillColor(26, 35, 126); pdf.circle(M + 1, y - 1.1, 0.7, "F");
    pdf.text(lines, M + 4, y); y += lines.length * 4 + 1.8;
  });
  footer(1);

  const tb = content.table;
  const total = tb.cols.reduce((s, c) => s + c[1], 0);
  const widths = tb.cols.map(c => c[1] / total * CW);
  let page = 2;
  const newPage = () => {
    pdf.addPage(); header();
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); setC("#0f172a"); pdf.text(tb.title, M, 20);
    let x = M; const hy = 27;
    pdf.setFillColor(26, 35, 126); pdf.rect(M, hy - 4.5, CW, 7, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); pdf.setTextColor(255, 255, 255);
    tb.cols.forEach((c, i) => { pdf.text(c[0], x + 1.5, hy); x += widths[i]; });
    return hy + 7;
  };
  y = newPage();
  tb.rows.forEach((row, ri) => {
    const cells = row.map((v, i) => pdf.splitTextToSize(String(v ?? "—"), widths[i] - (i === tb.swatchCol ? 6 : 3)));
    const rh = Math.max(...cells.map(c => c.length)) * 3.6 + 2.6;
    if (y + rh > H - 16) { footer(page++); y = newPage(); }
    if (ri % 2) { pdf.setFillColor(248, 250, 252); pdf.rect(M, y - 3.8, CW, rh, "F"); }
    let x = M;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); setC("#1f2937");
    cells.forEach((lines, i) => {
      let tx = x + 1.5;
      if (i === tb.swatchCol && tb.swatch) {
        const c = tb.swatch(ri);
        if (c) { const [r, g, b] = hexToRgb(c); pdf.setFillColor(r, g, b); pdf.setDrawColor(148, 163, 184); pdf.setLineWidth(0.1); pdf.rect(tx, y - 2.6, 3, 3, "FD"); tx += 4.5; }
      }
      pdf.text(lines, tx, y);
      x += widths[i];
    });
    y += rh;
  });
  if (tb.note) {
    pdf.setFont("helvetica", "italic"); pdf.setFontSize(7.5); setC("#64748b");
    const lines = pdf.splitTextToSize(tb.note, CW);
    if (y + lines.length * 3.5 > H - 16) { footer(page++); y = newPage(); }
    pdf.text(lines, M, y + 2);
  }
  footer(page);
  if (save) pdf.save(`map_report_${meta.file}_${new Date().toISOString().slice(0, 10)}.pdf`);
  return { pdf, pages: page };
}

// ── The chooser: the user picks WHAT to export, whatever the map shows ──
const REPORT_CHOICES = [
  { id: "svi",      title: "Social Vulnerability (SVI)", desc: "Barangay SVI map, tiers and the ranking of all 24 barangays.", descOne: "Its SVI rank, tier and all 13 components with their percentiles.", color: "#dc2626" },
  { id: "capacity", title: "Barangay Capacity",          desc: "Resources and readiness map, gaps (ambulance, generator, maps) and the capacity ranking.", descOne: "Its capacity rank, what is not on record, and every scored item.", color: "#16a34a" },
  { id: "hazard",   title: "Hazard Exposure",            desc: "Flood and landslide zones with every household, and exposure by barangay.", descOne: "Flood and landslide zones inside it, with its households by exposure level.", color: "#b45309" },
  { id: "distance", title: "Facility Distance",          desc: "Households within / beyond 2 km of the RHU and Fire Station, by barangay.", descOne: "Its households within / beyond 2 km of the RHU and Fire Station.", color: "#1e3a8a" },
  { id: "typology", title: "Household Typology",         desc: "Most common household profile per barangay and the profile shares.", descOne: "Its households colored by profile, and the profile shares.", color: "#7c3aed" },
];

export default function MapReportExport({ mode = "svi", geojson, households = null, floodGeojson = null, landslideGeojson = null, dark = false, focusKey = null }) {
  const [open, setOpen] = useState(false);
  // Which barangays: "" = all 24, otherwise one barangay's normalized key.
  const [scopeKey, setScopeKey] = useState("");
  const [scopeMode, setScopeMode] = useState("all");
  const barangayOptions = (geojson?.features || []).map((f) => {
    const key = norm(featName(f));
    return { key, label: OFFICIAL_BARANGAY_NAME[key] || featName(f), feature: f };
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const scope = scopeMode === "one" ? barangayOptions.find((o) => o.key === scopeKey) || null : null;
  const [picked, setPicked] = useState(() => new Set([MODES[mode] ? mode : "svi"]));
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);

  const openChooser = () => {
    setPicked(new Set([MODES[mode] ? mode : "svi"])); setError(null);
    // Start from what the map shows: a focused barangay pre-selects "One barangay".
    if (focusKey) { setScopeMode("one"); setScopeKey(focusKey); } else { setScopeMode("all"); }
    setOpen(true);
  };
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !generating) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, generating]);

  const handleGenerate = async () => {
    if (!geojson?.features?.length) { setError("Map boundaries haven't loaded yet — try again in a moment."); return; }
    const ids = REPORT_CHOICES.map((c) => c.id).filter((id) => picked.has(id));
    if (!ids.length) return;
    if (scopeMode === "one" && !scope) { setError("Choose a barangay first."); return; }
    setGenerating(true); setError(null);
    try {
      let pdf = null, pageNo = 1;
      for (let i = 0; i < ids.length; i++) {
        const m = ids[i];
        setProgress(`Building ${i + 1} of ${ids.length}: ${MODES[m].title}${scope ? ` (${scope.label})` : ""}…`);
        const ctxData = { households, floodGeojson, landslideGeojson };
        const content = scope ? await buildBarangayContent(m, { key: scope.key, name: scope.label }, ctxData) : await buildContent(m, ctxData);
        const canvas = drawMap({
          boundaries: scope ? { type: "FeatureCollection", features: [scope.feature] } : geojson,
          fillFor: content.fillFor, overlays: content.overlays, dots: content.dots, circles: content.circles,
          clip: !!scope, fitDots: !!scope, labels: !scope,
        });
        const out = await buildPdf(m, content, canvas, { save: ids.length === 1 && !scope, pdf, pageStart: pageNo });
        pdf = out.pdf; pageNo += out.pages;
      }
      const slug = scope ? `_${scope.label.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}` : "";
      if (ids.length === 1 && scope) pdf.save(`map_report_${MODES[ids[0]].file}${slug}_${new Date().toISOString().slice(0, 10)}.pdf`);
      if (ids.length > 1) pdf.save(`map_report_${ids.length}_sections${slug}_${new Date().toISOString().slice(0, 10)}.pdf`);
      setOpen(false);
    } catch (e) {
      console.error("[MapReportExport] failed:", e);
      setError(`Report generation failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setGenerating(false); setProgress("");
    }
  };

  const T = dark
    ? { card: "#111827", text: "#f1f5f9", sub: "#94a3b8", border: "rgba(148,163,184,0.25)", row: "rgba(255,255,255,0.03)", rowOn: "rgba(59,130,246,0.14)", focus: "#7cb4ff" }
    : { card: "#ffffff", text: "#0f172a", sub: "#5b6577", border: "#d6dde8", row: "#f8fafc", rowOn: "#eff6ff", focus: "#1d4ed8" };
  const n = picked.size;

  return (
    <>
      <button onClick={openChooser} title="Choose which map reports to export as one PDF"
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700,
          border: "0.5px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.14)", color: dark ? "#7cb4ff" : "#1d4ed8", cursor: "pointer",
        }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
        Generate Report (PDF)
      </button>

      {open && createPortal(
        <div onMouseDown={(e) => { if (e.target === e.currentTarget && !generating) setOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="mre-title"
            style={{ width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto", background: T.card, color: T.text, borderRadius: 14,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, fontFamily: "inherit" }}>
            <div style={{ padding: "18px 20px 10px" }}>
              <div id="mre-title" style={{ fontSize: 16, fontWeight: 800 }}>Generate map report</div>
              <div style={{ fontSize: 12, color: T.sub, marginTop: 4, lineHeight: 1.5 }}>
                Choose the barangays and the reports. Each report has its own map, key figures and table; the domains are never combined into one score.
              </div>
            </div>
            <div style={{ padding: "4px 20px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Barangays</div>
              <div role="radiogroup" aria-label="Barangays to include" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { id: "all", title: "All 24 barangays", desc: "Municipality map and full ranking" },
                  { id: "one", title: "One barangay", desc: "Only its boundary and its households" },
                ].map((o) => {
                  const on = scopeMode === o.id;
                  return (
                    <label key={o.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, cursor: generating ? "default" : "pointer",
                      border: `1.5px solid ${on ? T.focus : T.border}`, background: on ? T.rowOn : T.row }}>
                      <input type="radio" name="mre-scope" checked={on} disabled={generating} onChange={() => setScopeMode(o.id)}
                        style={{ width: 16, height: 16, marginTop: 1, accentColor: T.focus, flexShrink: 0, cursor: "pointer" }} />
                      <span>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{o.title}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: T.sub, marginTop: 2 }}>{o.desc}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {scopeMode === "one" && (
                <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} disabled={generating} aria-label="Barangay"
                  style={{ marginTop: 8, width: "100%", height: 36, borderRadius: 8, padding: "0 10px", fontSize: 13, fontFamily: "inherit",
                    border: `1.5px solid ${scope ? T.focus : T.border}`, background: T.card, color: T.text, cursor: "pointer" }}>
                  <option value="">Choose a barangay…</option>
                  {barangayOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              )}
            </div>
            <div style={{ padding: "4px 20px 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: "uppercase", letterSpacing: "0.08em" }}>Reports</span>
              <button onClick={() => setPicked(n === REPORT_CHOICES.length ? new Set() : new Set(REPORT_CHOICES.map((c) => c.id)))} disabled={generating}
                style={{ border: "none", background: "transparent", color: T.focus, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 4 }}>
                {n === REPORT_CHOICES.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {REPORT_CHOICES.map((c) => {
                const on = picked.has(c.id);
                return (
                  <label key={c.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "11px 12px", borderRadius: 10, cursor: generating ? "default" : "pointer",
                    border: `1.5px solid ${on ? T.focus : T.border}`, background: on ? T.rowOn : T.row }}>
                    <input type="checkbox" checked={on} disabled={generating} onChange={() => toggle(c.id)}
                      style={{ width: 17, height: 17, marginTop: 1, accentColor: T.focus, flexShrink: 0, cursor: "pointer" }} />
                    <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: c.color, flexShrink: 0 }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.title}</span>
                        {c.id === mode && <span style={{ fontSize: 10, fontWeight: 700, color: T.sub, border: `1px solid ${T.border}`, borderRadius: 999, padding: "1px 7px" }}>On the map now</span>}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: T.sub, marginTop: 3, lineHeight: 1.45 }}>{scopeMode === "one" ? c.descOne : c.desc}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {error && <div role="alert" style={{ margin: "12px 20px 0", padding: "8px 12px", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontSize: 12, fontWeight: 600 }}>{error}</div>}
            <div style={{ padding: "16px 20px 18px", display: "flex", alignItems: "center", gap: 10, borderTop: `1px solid ${T.border}`, marginTop: 16 }}>
              <span style={{ flex: 1, fontSize: 12, color: T.sub }} aria-live="polite">
                {generating ? progress
                  : !n ? "Pick at least one report"
                  : scopeMode === "one" && !scope ? "Choose a barangay"
                  : `${n} report${n > 1 ? "s" : ""}${scope ? ` for ${scope.label}` : ""} in one PDF · about ${n * 2} pages`}
              </span>
              <button onClick={() => setOpen(false)} disabled={generating}
                style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: `1px solid ${T.border}`, background: "transparent", color: T.text }}>
                Cancel
              </button>
              <button onClick={handleGenerate} disabled={generating || !n || (scopeMode === "one" && !scope)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                  cursor: generating ? "wait" : (!n || (scopeMode === "one" && !scope)) ? "not-allowed" : "pointer", border: "none",
                  background: (!n || (scopeMode === "one" && !scope)) ? (dark ? "#334155" : "#cbd5e1") : "#1d4ed8",
                  color: (!n || (scopeMode === "one" && !scope)) ? T.sub : "#ffffff" }}>
                {generating && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "mreSpin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                )}
                {generating ? "Generating…" : "Generate PDF"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <style>{`@keyframes mreSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
