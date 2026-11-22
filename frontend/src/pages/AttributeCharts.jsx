// Donut charts for the Data Attributes page (panel suggestion: "make the
// bars more meaningful with charts like pie").
//
// A pie is only used where the slices are parts of ONE whole:
//   * a family of attributes that split the municipality (sex, age bands,
//     flood / landslide zones),
//   * a subgroup against the rest of its base (seniors among residents,
//     households beyond 2 km among households, ...),
//   * yes/no capacity items: barangays that have it vs those that don't,
//   * counts and pesos: which barangays hold the largest share of the total.
// Rates (% of households, km) are never summed into a pie: their donut shows
// how many of the 24 barangays fall in each level band instead.
import { useEffect, useMemo, useState } from "react";
import { getGISBarangays } from "../api/api";
import { normalizeBarangayName } from "../features/planning/PlanningMap";

const GREYS = ["#94a3b8", "#cbd5e1"];
const PALETTE = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#ca8a04"];
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pctOf = (v, t) => (t ? (v / t) * 100 : 0);

// Families whose members add up to one whole.
const FAMILIES = {
  sex: { title: "Population by sex", base: "population", keys: ["male", "female"], colors: ["#2563eb", "#db2777"] },
  age: { title: "Population by age group", base: "population", keys: ["age_0_4", "age_5_17", "age_18_59", "age_60_plus"],
    colors: ["#f59e0b", "#0891b2", "#2563eb", "#7c3aed"] },
  flood: { title: "Households by flood zone", base: "households", keys: ["flood_very_high", "flood_high", "flood_moderate", "flood_low"],
    colors: ["#111827", "#2E3192", "#92278F", "#d8c4e2"], rest: "Not in a flood zone" },
  slide: { title: "Households by landslide zone", base: "households", keys: ["slide_high", "slide_moderate", "slide_low"],
    colors: ["#ED1C24", "#39B54A", "#e8d500"], rest: "Not in a landslide zone" },
};
const FAMILY_OF = {};
Object.entries(FAMILIES).forEach(([f, d]) => d.keys.forEach((k) => { FAMILY_OF[k] = f; }));
FAMILY_OF.minors = "age";

// The colour an attribute has in its pie (e.g. Female = pink), so the map,
// the barangay donut and the table bars use the same colour. Attributes
// outside a family keep their group colour.
export function attrColor(key, fallback) {
  const f = FAMILIES[FAMILY_OF[key]];
  if (f && key !== "minors") { const i = f.keys.indexOf(key); if (i >= 0) return f.colors[i]; }
  return fallback;
}

// SVI rates -> the household / person count behind them (for "with vs without").
const RATE_TO_COUNT = {
  overcrowding_prop: "ti_overcrowding", food_insecure_prop: "ti_food_insecure", no_internet_prop: "ti_no_internet",
  weak_roof_prop: "ti_weak_roof", weak_wall_prop: "ti_weak_wall", insecure_tenure_prop: "ti_insecure_tenure",
  unimproved_sanitation_prop: "ti_unimproved_sanitation", pwd_prop: "pwd", senior_prop: "age_60_plus",
  solo_parent_prop: "solo_parents", rhu_median_km: "rhu_n_beyond", fire_median_km: "fire_n_beyond",
};

function sumValues(a) {
  return Object.values(a?.values || {}).reduce((s, v) => s + (Number(v?.value) || 0), 0);
}
function totalOf(a) { return a?.total != null ? Number(a.total) : sumValues(a); }

// Top-6 barangays + "Other barangays" share of a total.
function byBarangay(a, data, color) {
  const rows = data.barangays.map((b) => ({ label: b.barangay, value: Number(a.values[b.psgc_10d]?.value) || 0 }))
    .filter((r) => r.value > 0).sort((x, y) => y.value - x.value);
  const top = rows.slice(0, 6), other = rows.slice(6).reduce((s, r) => s + r.value, 0);
  const none = data.barangays.length - rows.length;
  const slices = top.map((r, i) => ({ label: r.label, value: r.value, color, opacity: 1 - i * 0.13 }));
  if (other > 0) slices.push({ label: `Other ${rows.length - 6} barangays`, value: other, color: GREYS[0] });
  return { slices, none, nonZero: rows.length };
}

export function buildCharts(a, data) {
  if (!a || !data) return [];
  const byKey = Object.fromEntries(data.attributes.map((x) => [x.key, x]));
  const color = a.__color || "#2563eb";
  const out = [];
  const isUnit = (u) => a.unit === u;

  // 1) Composition: the whole the attribute belongs to.
  const fam = FAMILIES[FAMILY_OF[a.key]];
  if (a.key === "population") {
    const f = FAMILIES.sex, parts = f.keys.map((k, i) => ({ label: byKey[k]?.label || k, value: totalOf(byKey[k]), color: f.colors[i] }));
    out.push({ title: f.title, slices: parts, center: { value: fmt(totalOf(a)), label: "residents" },
      note: "Pick an age group or sector on the left to see its share of the population." });
  } else if (fam) {
    const base = totalOf(byKey[fam.base]);
    const parts = fam.keys.map((k, i) => ({ k, label: byKey[k]?.label || k, value: totalOf(byKey[k]), color: fam.colors[i] }));
    const sum = parts.reduce((s, p) => s + p.value, 0);
    if (fam.rest && base > sum) parts.push({ k: "_rest", label: fam.rest, value: base - sum, color: GREYS[1] });
    const emphKeys = a.key === "minors" ? ["age_0_4", "age_5_17"] : [a.key];
    const emph = parts.filter((p) => emphKeys.includes(p.k)).reduce((s, p) => s + p.value, 0);
    out.push({
      title: fam.title, unit: fam.base === "population" ? "residents" : "households",
      slices: parts.map((p) => ({ ...p, emph: emphKeys.includes(p.k) })),
      center: { value: `${pctOf(emph, base).toFixed(1)}%`, label: a.key === "minors" ? "minors" : "this group" },
      note: `${a.label}: ${fmt(emph)} of ${fmt(base)} ${fam.base === "population" ? "residents" : "households"}.`,
    });
  } else if (isUnit("count") && a.base_label) {
    // subgroup vs the rest of its base (residents or households)
    const baseAttr = a.base_label.includes("population") ? byKey.population : byKey.households;
    const base = totalOf(baseAttr), v = totalOf(a);
    if (base > 0) {
      const what = a.base_label.includes("population") ? "residents" : "households";
      out.push({
        title: `Share of all ${what}`, unit: what,
        slices: [{ label: a.label, value: v, color, emph: true }, { label: `All other ${what}`, value: Math.max(0, base - v), color: GREYS[1] }],
        center: { value: `${pctOf(v, base).toFixed(1)}%`, label: `of ${what}` },
        note: `${fmt(v)} of ${fmt(base)} ${what} in San Miguel.`,
      });
    }
  } else if (isUnit("yesno")) {
    const vals = data.barangays.map((b) => a.values[b.psgc_10d]?.value);
    const yes = vals.filter((v) => v === true || Number(v) === 1).length, known = vals.filter((v) => v != null).length;
    out.push({
      title: "Barangays that have it", unit: "barangays",
      slices: [{ label: "Has it", value: yes, color: "#16a34a", emph: true }, { label: "Does not have it", value: known - yes, color: "#dc2626", opacity: 0.75 }],
      center: { value: `${yes} of ${known}`, label: "barangays" },
      note: yes === known ? "Every barangay has it, so it cannot tell barangays apart (left out of the capacity score)."
        : yes === 0 ? "No barangay has it, so it cannot tell barangays apart (left out of the capacity score)."
        : `${known - yes} barangay${known - yes === 1 ? "" : "s"} still without it.`,
    });
  } else if ((isUnit("pct") || isUnit("km")) && RATE_TO_COUNT[a.key] && byKey[RATE_TO_COUNT[a.key]]) {
    const c = byKey[RATE_TO_COUNT[a.key]];
    const baseAttr = (c.base_label || "").includes("population") ? byKey.population : byKey.households;
    const base = totalOf(baseAttr), v = totalOf(c);
    const what = (c.base_label || "").includes("population") ? "residents" : "households";
    out.push({
      title: isUnit("km") ? "Households beyond 2 km" : `Across all ${what}`, unit: what,
      slices: [{ label: isUnit("km") ? "Beyond 2 km" : c.label, value: v, color, emph: true },
        { label: isUnit("km") ? "Within 2 km" : `All other ${what}`, value: Math.max(0, base - v), color: GREYS[1] }],
      center: { value: `${pctOf(v, base).toFixed(1)}%`, label: `of ${what}` },
      note: `${fmt(v)} of ${fmt(base)} ${what} municipality-wide.`,
    });
  }

  // 2) Where it is concentrated (counts and pesos only; rates never summed).
  if ((isUnit("count") || isUnit("pesos")) && totalOf(a) > 0) {
    const { slices, none, nonZero } = byBarangay(a, data, color);
    if (slices.length > 1 || nonZero === 1) {
      const t = totalOf(a), top = slices[0];
      out.push({
        title: "Share by barangay", unit: isUnit("pesos") ? "pesos" : (a.base_label || "").includes("household") || a.key === "households" ? "households" : "",
        slices, money: isUnit("pesos"),
        center: { value: `${pctOf(top.value, t).toFixed(0)}%`, label: top.label.length > 14 ? top.label.slice(0, 13) + "…" : top.label },
        note: `${top.label} holds the largest share${none ? `; ${none} barangay${none === 1 ? " has" : "s have"} none` : ""}.`,
      });
    }
  }

  // 3) Rates: how many barangays at each level (counts barangays, not people).
  if (isUnit("pct")) {
    const vals = data.barangays.map((b) => a.values[b.psgc_10d]?.value).filter((v) => v != null).map(Number);
    const bands = [["Under 5%", 0, 5], ["5–15%", 5, 15], ["15–30%", 15, 30], ["30–50%", 30, 50], ["50% or more", 50, 1e9]];
    const slices = bands.map(([label, lo, hi], i) => ({ label, value: vals.filter((v) => v >= lo && v < hi).length,
      color, opacity: 0.25 + i * 0.18 })).filter((s) => s.value > 0);
    out.push({
      title: "Barangays by level", unit: "barangays", slices,
      center: { value: `${(vals.reduce((s, v) => s + v, 0) / (vals.length || 1)).toFixed(1)}%`, label: "avg. barangay" },
      note: "Each slice counts barangays; the rate itself is never added up.",
    });
  }
  return out.slice(0, 2);
}

function Donut({ chart, D }) {
  const [hover, setHover] = useState(null);
  const total = chart.slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = 62, r = 40, cx = 75, cy = 75;
  let ang = -Math.PI / 2;
  const arcs = chart.slices.map((s, i) => {
    const frac = s.value / total, a0 = ang, a1 = ang + frac * Math.PI * 2; ang = a1;
    if (frac <= 0) return null;
    if (frac >= 0.9999) return <g key={i}><circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={s.color} strokeOpacity={s.opacity ?? 1} strokeWidth={R - r}
      onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><title>{`${s.label}: ${fmt(s.value)}`}</title></circle></g>;
    const large = a1 - a0 > Math.PI ? 1 : 0, rr = hover === i || s.emph ? R + 3 : R;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(rr, a0), [x1, y1] = p(rr, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
    return (
      <path key={i} d={`M${x0} ${y0}A${rr} ${rr} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`}
        fill={s.color} fillOpacity={s.opacity ?? 1} stroke={D.cardBg} strokeWidth="1.5" style={{ cursor: "default" }}
        onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
        <title>{`${s.label}: ${chart.money ? "₱" : ""}${fmt(s.value)} (${pctOf(s.value, total).toFixed(1)}%)`}</title>
      </path>
    );
  });
  const h = hover != null ? chart.slices[hover] : null;
  return (
    <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", gap: 14, alignItems: "center", padding: "14px 16px",
      border: `1px solid ${D.border}`, borderRadius: 10, background: D.subBg }}>
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={chart.title} style={{ flexShrink: 0 }}>
        {arcs}
        <text x="75" y={h ? 72 : 76} textAnchor="middle" fontSize={h ? 15 : 17} fontWeight="800" fill={D.textPrimary}>
          {h ? `${pctOf(h.value, total).toFixed(1)}%` : chart.center.value}
        </text>
        <text x="75" y={h ? 88 : 92} textAnchor="middle" fontSize="9.5" fill={D.textMuted}>
          {h ? (h.label.length > 16 ? h.label.slice(0, 15) + "…" : h.label) : chart.center.label}
        </text>
      </svg>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{chart.title}</div>
        {chart.slices.map((s, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, padding: "2px 0", color: D.textBody,
              fontWeight: s.emph || hover === i ? 700 : 400 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, opacity: s.opacity ?? 1, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: D.textMuted }}>
              {chart.money ? "₱" : ""}{fmt(s.value)} · {pctOf(s.value, total).toFixed(1)}%
            </span>
          </div>
        ))}
        {chart.note && <div style={{ fontSize: 11, color: D.textMuted, marginTop: 6, lineHeight: 1.4 }}>{chart.note}</div>}
      </div>
    </div>
  );
}

// ── Barangay map: the 24 barangays shaded by this attribute ─────────────
// Plain SVG from the barangay boundaries (works offline, no map tiles).
// What is shaded matches the table's bar: a rate itself, a sector's % of the
// barangay's residents / households, a count or peso amount, or km; yes/no
// items are shown as has it / does not have it.
let geoCache = null, geoPromise = null;
function loadGeo() {
  if (geoCache) return Promise.resolve(geoCache);
  if (!geoPromise) geoPromise = getGISBarangays().then((r) => { geoCache = r.data; return geoCache; }).catch((e) => { geoPromise = null; throw e; });
  return geoPromise;
}
const featName = (f) => { const p = f.properties || {}; return p.Barangay_n || p.NAME_3 || p.name || p.BARANGAY || ""; };

function mapMeasure(a) {
  if (!a) return null;
  if (a.unit === "yesno") return { kind: "yesno", label: "Has it / does not have it" };
  if (a.unit === "pct") return { kind: "num", pick: (v) => v?.value, fmt: (n) => `${n.toFixed(1)}%`, label: "Rate (% of households / residents)" };
  if (a.unit === "km") return { kind: "num", pick: (v) => v?.value, fmt: (n) => `${n.toFixed(2)} km`, label: "Median distance (km)" };
  if (a.unit === "pesos") return { kind: "num", pick: (v) => v?.value, fmt: (n) => `₱${Math.round(n).toLocaleString()}`, label: "Pesos" };
  if (a.base_label && a.key !== "population" && a.key !== "households")
    return { kind: "num", pick: (v) => v?.pct, fmt: (n) => `${n.toFixed(1)}%`, label: a.base_label };
  return { kind: "num", pick: (v) => v?.value, fmt: (n) => Math.round(n).toLocaleString(), label: "Count" };
}

function BarangayMap({ a, data, color, D }) {
  const [geo, setGeo] = useState(geoCache);
  const [err, setErr] = useState(null);
  const [hover, setHover] = useState(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => { if (!geo) loadGeo().then(setGeo).catch((e) => setErr(e.message || "unavailable")); }, [geo]);
  const m = mapMeasure(a);

  const model = useMemo(() => {
    if (!geo?.features || !m) return null;
    const byName = new Map(data.barangays.map((b) => [normalizeBarangayName(b.barangay), b]));
    const vals = data.barangays.map((b) => {
      const v = a.values[b.psgc_10d];
      if (m.kind === "yesno") return v?.value == null ? null : (v.value === true || Number(v.value) === 1 ? 1 : 0);
      const n = m.pick(v); return n == null ? null : Number(n);
    });
    const nums = vals.filter((x) => x != null);
    // classes span the lowest to highest barangay, so differences between
    // barangays are visible even when all values are close (e.g. 47–56% female)
    const lo = nums.length ? Math.min(...nums) : 0;
    const hi = Math.max(...nums, lo + 1e-9);
    const steps = 5, edges = Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps);
    const valueOf = new Map(data.barangays.map((b, i) => [b.psgc_10d, vals[i]]));
    // projection: equirectangular scaled by cos(latitude)
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const walk = (c, fn) => (typeof c[0] === "number" ? fn(c) : c.forEach((cc) => walk(cc, fn)));
    geo.features.forEach((f) => walk(f.geometry.coordinates, ([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180), W = 520, H = Math.round(W * ((y1 - y0) / ((x1 - x0) * k))) || 380;
    const px = (x) => (((x - x0) * k) / ((x1 - x0) * k)) * (W - 8) + 4, py = (y) => ((y1 - y) / (y1 - y0)) * (H - 8) + 4;
    const P = ([x, y]) => `${px(x).toFixed(2)},${py(y).toFixed(2)}`;
    // town-centre box: the Poblacion barangays
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    // = the small, tightly packed shapes (each spans < 4% of the map's width)
    geo.features.forEach((f) => {
      let c0 = 1e9, c1 = -1e9, d0 = 1e9, d1 = -1e9;
      walk(f.geometry.coordinates, ([x, y]) => { c0 = Math.min(c0, px(x)); c1 = Math.max(c1, px(x)); d0 = Math.min(d0, py(y)); d1 = Math.max(d1, py(y)); });
      if (Math.max(c1 - c0, d1 - d0) < W * 0.04) { a0 = Math.min(a0, c0); a1 = Math.max(a1, c1); b0 = Math.min(b0, d0); b1 = Math.max(b1, d1); }
    });
    const pad = 6, zw = a1 - a0 + 2 * pad, zh = b1 - b0 + 2 * pad, zs = Math.max(zw, (zh * W) / H);
    const zoomBox = a1 > a0 ? `${(a0 + a1) / 2 - zs / 2} ${(b0 + b1) / 2 - (zs * H) / W / 2} ${zs} ${(zs * H) / W}` : null;
    const ring = (r) => "M" + r.map(P).join("L") + "Z";
    const shapes = geo.features.map((f) => {
      const b = byName.get(normalizeBarangayName(featName(f)));
      const g = f.geometry, polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
      return { name: b?.barangay || featName(f), psgc: b?.psgc_10d, d: polys.map((poly) => poly.map(ring).join("")).join("") };
    });
    const cls = (n) => (n == null ? null : Math.min(steps - 1, Math.floor(((n - lo) / (hi - lo || 1)) * steps)));
    const ranked = data.barangays.map((b) => ({ name: b.barangay, n: valueOf.get(b.psgc_10d) })).filter((r) => r.n != null).sort((x, y) => y.n - x.n);
    return { shapes, valueOf, edges, cls, W, H, ranked, steps, zoomBox, zf: zoomBox ? W / zs : 1 };
  }, [geo, a, data, m]);

  if (!m) return null;
  const fill = (n) => {
    if (n == null) return D.subBg;
    if (m.kind === "yesno") return n ? "#16a34a" : "#dc2626";
    return color;
  };
  const opacity = (n) => (n == null || m.kind === "yesno" ? (n == null ? 1 : 0.75) : 0.15 + (model.cls(n) / (model.steps - 1)) * 0.8);
  const fmt = (n) => (n == null ? "no data" : m.kind === "yesno" ? (n ? "Has it" : "Does not have it") : m.fmt(n));
  const h = hover && model ? { name: hover.name, n: model.valueOf.get(hover.psgc) } : null;

  return (
    <div style={{ flex: "1 1 100%", display: "flex", gap: 16, flexWrap: "wrap", padding: "14px 16px", border: `1px solid ${D.border}`, borderRadius: 10, background: D.subBg }}>
      <div style={{ flex: "1 1 420px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Where it is — by barangay</div>
          {model?.zoomBox && (
            <button type="button" onClick={() => setZoom((z) => !z)} aria-pressed={zoom}
              style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                border: `1px solid ${D.border}`, background: zoom ? D.textPrimary : D.cardBg, color: zoom ? D.cardBg : D.textBody }}>
              {zoom ? "Show whole municipality" : "Zoom to town centre (Poblacion)"}
            </button>
          )}
        </div>
        {!model ? (
          <div style={{ fontSize: 12, color: D.textMuted, padding: 20 }}>{err ? `Map unavailable (${err}).` : "Loading map…"}</div>
        ) : (
          <svg viewBox={zoom && model.zoomBox ? model.zoomBox : `0 0 ${model.W} ${model.H}`} width="100%" style={{ maxHeight: 420, display: "block", overflow: "hidden" }} role="img" aria-label={`${a.label} by barangay`}>
            {model.shapes.map((sh) => {
              const n = model.valueOf.get(sh.psgc);
              const on = hover?.psgc === sh.psgc;
              return (
                <path key={sh.name} d={sh.d} fill={fill(n)} fillOpacity={opacity(n)} fillRule="evenodd"
                  stroke={on ? D.textPrimary : D.cardBg} strokeWidth={(on ? 2 : 1) / (zoom ? model.zf : 1)} style={{ cursor: "default" }}
                  onMouseEnter={() => setHover(sh)} onMouseLeave={() => setHover(null)}>
                  <title>{`${sh.name}: ${fmt(n)}`}</title>
                </path>
              );
            })}
          </svg>
        )}
      </div>
      <div style={{ flex: "0 1 230px", minWidth: 200, fontSize: 12, color: D.textBody }}>
        <div style={{ minHeight: 44, padding: "8px 10px", borderRadius: 8, background: D.cardBg, border: `1px solid ${D.border}`, marginBottom: 10 }}>
          {h ? <><div style={{ fontWeight: 800, color: D.textPrimary }}>{h.name}</div><div>{fmt(h.n)}</div></>
            : <span style={{ color: D.textMuted }}>Point at a barangay to see its value.</span>}
        </div>
        <div style={{ fontWeight: 700, color: D.textMuted, fontSize: 11, marginBottom: 4 }}>{m.label}</div>
        {m.kind === "yesno" ? (
          [["#16a34a", "Has it"], ["#dc2626", "Does not have it"]].map(([c, l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 0" }}>
              <span style={{ width: 14, height: 10, borderRadius: 2, background: c, opacity: 0.75 }} />{l}
            </div>
          ))
        ) : model && Array.from({ length: model.steps }, (_, i) => model.steps - 1 - i).map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 0" }}>
            <span style={{ width: 14, height: 10, borderRadius: 2, background: color, opacity: 0.15 + (i / (model.steps - 1)) * 0.8 }} />
            {m.fmt(model.edges[i])} – {m.fmt(model.edges[i + 1])}
          </div>
        ))}
        {model && model.ranked.length > 0 && m.kind === "num" && (
          <div style={{ marginTop: 10, lineHeight: 1.5, color: D.textMuted }}>
            Highest: <b style={{ color: D.textPrimary }}>{model.ranked[0].name}</b> ({m.fmt(model.ranked[0].n)})<br />
            Lowest: <b style={{ color: D.textPrimary }}>{model.ranked.at(-1).name}</b> ({m.fmt(model.ranked.at(-1).n)})
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: D.textMuted }}>{m.kind === "num" ? "Darker = more. " : ""}Grey = no data. The small barangays in the middle are the Poblacion; use the zoom button to see them.</div>
      </div>
    </div>
  );
}

export default function AttributeCharts({ attr, data, color, D }) {
  const charts = useMemo(() => buildCharts(attr && { ...attr, __color: color }, data), [attr, data, color]);
  if (!attr) return null;
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "14px 20px", borderBottom: `1px solid ${D.border}` }}>
      {charts.map((c, i) => <Donut key={`${attr.key}-${i}`} chart={c} D={D} />)}
      <BarangayMap a={attr} data={data} color={color} D={D} />
    </div>
  );
}
