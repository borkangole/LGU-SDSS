// Household Typology report (k-modes, k = 5).
//
// Typology is a DESCRIPTIVE grouping of households by the pattern of their
// 13 typology indicators -- it is not a score, not a rank and not a fourth
// domain. This file holds:
//   * buildTypologySummary()  -- municipal + per-barangay cluster counts
//   * svgTypologyStack()      -- 100% stacked bar per barangay (screen + print)
//   * typologyPrintSection()  -- the Overall Report's printed section
//   * TypologyOverallSection  -- the Overall Report's on-screen section
//   * TypologyReportTab       -- the Reports page tab, with per-barangay
//                                household export (CSV / print) by cluster
import { useMemo, useState } from "react";
import { TYPOLOGY_COLORS, TYPOLOGY_LABELS, TYPOLOGY_SHORT, TYPOLOGY_LEGEND } from "../shared/domainColors";
import { TypologyInfoCard, InfoToggleButton, TYPOLOGY_METHOD_NOTE, TYPOLOGY_INFO } from "../shared/typologyInfo";

const ORDER = TYPOLOGY_LEGEND.map(t => t.clusterId); // 1, 0, 3, 2, 4 (most stable -> most deprived)
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct1 = (v) => `${(v || 0).toFixed(1)}%`;

// What each profile means, in one line (for the legend / print).
// One-line meaning of each profile -- the same text as the typology
// explainer (shared/typologyInfo.jsx), so every page says the same thing.
export const TYPOLOGY_MEANING = Object.fromEntries(Object.entries(TYPOLOGY_INFO).map(([id, v]) => [id, v.summary]));

// The 13 typology indicators (a different set from the 13 SVI conditions).
export const TYPOLOGY_INDICATORS = [
  ["ti_food_insecure", "Food insecure"],
  ["ti_financially_excluded", "Financially excluded"],
  ["ti_insecure_tenure", "Insecure tenure"],
  ["ti_weak_roof", "Weak roof"],
  ["ti_weak_wall", "Weak wall"],
  ["ti_unimproved_sanitation", "Unimproved sanitation"],
  ["ti_overcrowding", "Overcrowded"],
  ["ti_large_household", "Large household"],
  ["ti_no_internet", "No internet"],
  ["ti_low_adult_education_hh", "Low adult education"],
  ["ti_pwd_count_cat", "PWD", true],
  ["ti_senior_count_cat", "Senior", true],
  ["ti_solo_parent_count_cat", "Solo parent", true],
];
const catText = (v) => (Number(v) >= 3 ? "3+" : String(Number(v) || 0));
export function hhConditions(h) {
  return TYPOLOGY_INDICATORS.filter(([k, , isCount]) => (isCount ? Number(h[k]) > 0 : !!h[k]))
    .map(([k, label, isCount]) => (isCount ? `${label} (${catText(h[k])})` : label));
}
const hhCode = (c) => String(c || "").replace(/^.*?-\s*/, "");

const normKey = (name) => String(name || "").toLowerCase()
  .replace(/\bbrgy\.?\s*/g, "").replace(/\bbgy\.?\s*/g, "").replace(/\bbarangay\s*/g, "")
  .replace(/\bpob(lacion)?\.?\s*/g, "").replace(/ñ/g, "n").replace(/[^a-z0-9\s]/g, "")
  .replace(/\s+/g, " ").trim().replace(/\bsto\b/g, "santo").replace(/\bsta\b/g, "santa");

export function buildTypologySummary(barangayStats, households) {
  const display = new Map((barangayStats || []).map(b => [normKey(b.barangay_name), b.display_name || b.barangay_name]));
  const nameOf = (n) => display.get(normKey(n)) || n;
  const total = { n: 0, counts: {} };
  const byB = new Map();
  (households || []).forEach(h => {
    const id = h.typology_cluster_id;
    if (id == null || id === "") return;
    const name = nameOf(h.barangay_name);
    const r = byB.get(name) || { name, n: 0, counts: {} };
    r.n++; r.counts[id] = (r.counts[id] || 0) + 1; byB.set(name, r);
    total.n++; total.counts[id] = (total.counts[id] || 0) + 1;
  });
  const rows = [...byB.values()].map(r => {
    const pct = Object.fromEntries(ORDER.map(id => [id, r.n ? ((r.counts[id] || 0) / r.n) * 100 : 0]));
    const dominant = ORDER.reduce((best, id) => ((r.counts[id] || 0) > (r.counts[best] || 0) ? id : best), ORDER[0]);
    return { ...r, pct, dominant };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const clusters = ORDER.map(id => ({
    id, label: TYPOLOGY_LABELS[id], short: TYPOLOGY_SHORT[id], color: TYPOLOGY_COLORS[id],
    count: total.counts[id] || 0, pct: total.n ? ((total.counts[id] || 0) / total.n) * 100 : 0,
    dominantIn: rows.filter(r => r.dominant === id).length,
    highest: [...rows].sort((a, b) => b.pct[id] - a.pct[id])[0] || null,
  }));
  return { n: total.n, clusters, rows, nameOf };
}

// 100% stacked horizontal bar per barangay, in the given order.
export function svgTypologyStack(rows, { grid = "#e8ecf3", text = "#888", label = "#333", targetW = 1200, maxW = 1500 } = {}) {
  const compact = targetW < 900;
  const RH = compact ? 16 : 22, fs = compact ? 8.5 : 11.5, padT = compact ? 16 : 22, padB = 6;
  const nameW = compact ? 104 : 160, nW = compact ? 44 : 64;
  const x0 = nameW, x1 = targetW - nW, W = targetW, H = padT + rows.length * RH + padB;
  const xOf = (p) => x0 + (p / 100) * (x1 - x0);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;max-width:${maxW}px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif">`;
  [0, 25, 50, 75, 100].forEach(t => { const x = xOf(t); s += `<line x1="${x}" x2="${x}" y1="${padT - 4}" y2="${H - padB}" stroke="${grid}" stroke-width="1"/><text x="${x}" y="${padT - 8}" text-anchor="middle" font-size="${fs - 2}" fill="${text}">${t}%</text>`; });
  rows.forEach((r, i) => {
    const y = padT + i * RH, bh = RH * 0.62, by = y + (RH - bh) / 2, cy = y + RH / 2 + fs * 0.35;
    if (i % 2 === 1) s += `<rect x="0" y="${y}" width="${W}" height="${RH}" fill="${grid}" opacity="0.35"/>`;
    s += `<text x="0" y="${cy}" font-size="${fs}" fill="${label}">${esc(r.name)}</text>`;
    let acc = 0;
    ORDER.forEach(id => {
      const p = r.pct[id] || 0; if (!p) return;
      const xa = xOf(acc), xb = xOf(acc + p); acc += p;
      s += `<rect x="${xa.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(0.5, xb - xa).toFixed(1)}" height="${bh.toFixed(1)}" fill="${TYPOLOGY_COLORS[id]}"><title>${esc(`${r.name}: ${TYPOLOGY_LABELS[id]} ${p.toFixed(1)}% (${r.counts[id] || 0} HH)`)}</title></rect>`;
      if (xb - xa > (compact ? 22 : 34)) s += `<text x="${((xa + xb) / 2).toFixed(1)}" y="${cy}" text-anchor="middle" font-size="${fs - 2.5}" font-weight="700" fill="#fff" pointer-events="none">${Math.round(p)}%</text>`;
    });
    s += `<text x="${(x1 + 6).toFixed(1)}" y="${cy}" font-size="${fs - 1}" fill="${text}">${r.n.toLocaleString()} HH</text>`;
  });
  return s + `</svg>`;
}

const NOTE = "Household typology groups households by the PATTERN of their 13 typology indicators (k-modes, k = 5). It describes what kind of need a household has; it is not a score or a rank and is not combined with SVI, Barangay Capacity or Hazard Exposure.";

// ── Overall Report: printed section ─────────────────────────────────────
export function typologyPrintSection(barangayStats, households) {
  const T = buildTypologySummary(barangayStats, households);
  if (!T.n) return "";
  const cards = T.clusters.map(c => `<div class="tier-card" style="border-left-color:${c.color};flex-direction:column;align-items:flex-start;gap:2px"><div class="tier-val" style="color:${c.color}">${c.pct.toFixed(0)}%</div><div><div class="tier-lbl">${esc(c.label)}</div><div class="tier-sub">${c.count.toLocaleString()} HH · most common in ${c.dominantIn} brgy</div></div></div>`).join("");
  const legend = T.clusters.map(c => `<span><i style="background:${c.color}"></i>${esc(c.label)}</span>`).join("");
  const rows = T.rows.map(r => `<tr><td style="font-weight:600;color:#1a237e;white-space:nowrap">${esc(r.name)}</td><td>${r.n.toLocaleString()}</td>${T.clusters.map(c => `<td style="color:${c.color};font-weight:${r.dominant === c.id ? 800 : 500}">${pct1(r.pct[c.id])}</td>`).join("")}<td><span class="badge" style="background:${TYPOLOGY_COLORS[r.dominant]}18;color:${TYPOLOGY_COLORS[r.dominant]};border:1px solid ${TYPOLOGY_COLORS[r.dominant]}44">${esc(TYPOLOGY_SHORT[r.dominant])}</span></td></tr>`).join("");
  return `<div class="section" style="page-break-before:always">
    <div class="section-title" style="--accent:#4f46e5"><span class="tag" style="background:#4f46e5">TYP</span>Household Typology</div>
    <div class="section-sub">${esc(NOTE)}</div>
    <div class="tier-grid" style="grid-template-columns:repeat(5,1fr)">${cards}</div>
    <div class="box"><div class="box-title">Profile mix per barangay (share of its households)</div><div class="legend" style="margin:0 0 8px">${legend}</div>${svgTypologyStack(T.rows, { targetW: 760 })}</div>
    <table class="data-table"><thead><tr><th>Barangay</th><th>HH</th>${T.clusters.map(c => `<th>${esc(c.short)}</th>`).join("")}<th>Most common</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

// ── Overall Report: on-screen section ───────────────────────────────────
export function TypologyOverallSection({ barangayStats, households, D, dark, card, cardTitle, SectionHead, chartColors }) {
  const T = useMemo(() => buildTypologySummary(barangayStats, households), [barangayStats, households]);
  if (!T.n) return null;
  return (
    <div className="or-section" style={{ marginBottom: 28, animationDelay: "0.18s" }}>
      <SectionHead tag="TYP" title="Household Typology" accent="#4f46e5" sub={NOTE} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        {T.clusters.map(c => (
          <div key={c.id} style={{ ...card, padding: "12px 14px", borderLeft: `3px solid ${c.color}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.pct.toFixed(0)}%</span>
              <span style={{ fontSize: 10.5, color: D.textMuted }}>{c.count.toLocaleString()} HH</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: D.textBody, marginTop: 2 }}>{c.label}</div>
            <div style={{ fontSize: 9.5, color: D.textMuted, marginTop: 2 }}>Most common profile in {c.dominantIn} barangay{c.dominantIn === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div style={cardTitle}>Profile mix per barangay</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 10, color: D.textBody }}>
            {T.clusters.map(c => <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c.color }} />{c.short}</span>)}
          </div>
        </div>
        <div style={{ overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: svgTypologyStack(T.rows, chartColors) }} />
      </div>
    </div>
  );
}

// ── Reports tab ─────────────────────────────────────────────────────────
export default function TypologyReportTab({ barangayStats, households, D, dark, loading, downloadCSV, printTable }) {
  const T = useMemo(() => buildTypologySummary(barangayStats, households), [barangayStats, households]);
  const [brgy, setBrgy] = useState("all");      // barangay for the household list / export
  const [profile, setProfile] = useState("all"); // cluster filter for the household list
  const [sortBy, setSortBy] = useState("name");  // barangay table: "name" or a cluster id
  const [showAll, setShowAll] = useState(false);
  const [infoOpen, setInfoOpen] = useState(null); // which profile's explainer is open
  const now = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });

  const rows = useMemo(() => {
    const r = [...T.rows];
    if (sortBy !== "name") r.sort((a, b) => (b.pct[sortBy] - a.pct[sortBy]) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return r;
  }, [T, sortBy]);

  const hhList = useMemo(() => (households || [])
    .filter(h => h.typology_cluster_id != null && h.typology_cluster_id !== "")
    .map(h => ({ h, brgy: T.nameOf(h.barangay_name) }))
    .filter(x => (brgy === "all" || x.brgy === brgy) && (profile === "all" || String(x.h.typology_cluster_id) === String(profile)))
    .sort((a, b) => a.brgy.localeCompare(b.brgy, undefined, { numeric: true })
      || ORDER.indexOf(Number(a.h.typology_cluster_id)) - ORDER.indexOf(Number(b.h.typology_cluster_id))
      || String(a.h.household_number).localeCompare(String(b.h.household_number), undefined, { numeric: true })),
  [households, T, brgy, profile]);

  const scopeLabel = `${brgy === "all" ? "All barangays" : brgy}${profile === "all" ? "" : ` — ${TYPOLOGY_LABELS[profile]}`}`;
  const fileTag = `${brgy === "all" ? "All_barangays" : brgy.replace(/[^A-Za-z0-9]+/g, "_")}${profile === "all" ? "" : `_${TYPOLOGY_SHORT[profile].replace(/[^A-Za-z0-9]+/g, "_")}`}`;

  const exportSummaryCSV = () => downloadCSV(`Household_Typology_by_Barangay_${Date.now()}.csv`,
    ["Barangay", "Households", ...T.clusters.flatMap(c => [`${c.label} (HH)`, `${c.label} (%)`]), "Most common profile"],
    rows.map(r => [r.name, r.n, ...T.clusters.flatMap(c => [r.counts[c.id] || 0, (r.pct[c.id] || 0).toFixed(1)]), TYPOLOGY_LABELS[r.dominant]]));
  const printSummary = () => printTable("Household Typology by Barangay", `Municipality of San Miguel, Iloilo · ${now} · ${T.n.toLocaleString()} households`,
    ["Barangay", "HH", ...T.clusters.map(c => `<span style="color:#fff">${esc(c.short)}</span>`), "Most common"],
    rows.map(r => [`<strong style="color:#1a237e">${esc(r.name)}</strong>`, r.n.toLocaleString(),
      ...T.clusters.map(c => `<span style="color:${c.color};font-weight:${r.dominant === c.id ? 800 : 500}">${pct1(r.pct[c.id])} <span style="color:#999;font-weight:400">(${r.counts[c.id] || 0})</span></span>`),
      `<span style="color:${TYPOLOGY_COLORS[r.dominant]};font-weight:700">${esc(TYPOLOGY_LABELS[r.dominant])}</span>`]),
    `${NOTE} Profiles: ${T.clusters.map(c => `${c.label} = ${TYPOLOGY_MEANING[c.id]}`).join(" · ")}`);
  const exportHouseholdsCSV = () => downloadCSV(`Household_Typology_${fileTag}_${Date.now()}.csv`,
    ["Household", "Barangay", "Members", "Profile ID", "Profile", ...TYPOLOGY_INDICATORS.map(([, l, isCount]) => (isCount ? `${l} (count, 3 = 3+)` : l))],
    hhList.map(({ h, brgy: b }) => [hhCode(h.household_number), b, h.member_count ?? h.hh_size ?? "", h.typology_cluster_id, TYPOLOGY_LABELS[h.typology_cluster_id] || h.typology_cluster_label,
      ...TYPOLOGY_INDICATORS.map(([k, , isCount]) => (isCount ? Number(h[k]) || 0 : (h[k] ? "Yes" : "No")))]));
  const printHouseholds = () => printTable(`Household Typology — ${scopeLabel}`, `Municipality of San Miguel, Iloilo · ${now} · ${hhList.length.toLocaleString()} households`,
    ["#", "Household", "Barangay", "Members", "Profile", "Conditions present"],
    hhList.map(({ h, brgy: b }, i) => [i + 1, esc(hhCode(h.household_number)), esc(b), h.member_count ?? h.hh_size ?? "—",
      `<span style="display:inline-block;background:${TYPOLOGY_COLORS[h.typology_cluster_id]}18;color:${TYPOLOGY_COLORS[h.typology_cluster_id]};border:1px solid ${TYPOLOGY_COLORS[h.typology_cluster_id]}44;border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700;white-space:nowrap">${esc(TYPOLOGY_LABELS[h.typology_cluster_id])}</span>`,
      `<span style="font-size:9.5px;color:#555">${esc(hhConditions(h).join(", ") || "None of the 13")}</span>`]),
    `${NOTE} Household numbers only; no names are included.`);

  const sel = { padding: "6px 10px", border: `1px solid ${D.inputBorder}`, borderRadius: 6, fontSize: 12, color: D.textBody, background: D.inputBg, outline: "none" };
  const btn = (primary) => ({ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    ...(primary ? { background: "linear-gradient(135deg,#312e81,#4f46e5)", color: "#fff", border: "none", boxShadow: "0 2px 8px rgba(79,70,229,0.3)" }
      : { background: dark ? "rgba(99,102,241,0.12)" : "#eef2ff", color: dark ? "#a5b4fc" : "#4338ca", border: `1px solid ${dark ? "#3730a3" : "#c7d2fe"}` }) });
  const card = { background: D.cardBg, border: `1px solid ${D.border}`, borderRadius: 10 };
  const label = { fontSize: 10, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.7 };
  const th = { textAlign: "left", padding: "9px 12px", fontSize: 9.5, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" };
  const brgyNames = T.rows.map(r => r.name);
  const listShown = showAll ? hhList : hhList.slice(0, 100);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: D.textMuted }}>Loading…</div>;
  if (!T.n) return <div style={{ padding: 40, textAlign: "center", color: D.textMuted }}>No household typology yet. Run the typology step after importing CBMS data.</div>;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* municipal mix */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        {T.clusters.map(c => {
          const on = String(profile) === String(c.id);
          return (
            <div key={c.id} role="button" tabIndex={0} onClick={() => setProfile(on ? "all" : String(c.id))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProfile(on ? "all" : String(c.id)); } }}
              title={`${TYPOLOGY_MEANING[c.id]} Click to list only these households.`}
              style={{ ...card, textAlign: "left", cursor: "pointer", padding: "12px 14px", borderLeft: `4px solid ${c.color}`, fontFamily: "inherit",
                outline: on ? `2px solid ${c.color}` : "none", background: on ? c.color + (dark ? "1f" : "10") : D.cardBg }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.pct.toFixed(1)}%</span>
                <span style={{ fontSize: 11, color: D.textMuted, flex: 1 }}>{c.count.toLocaleString()} HH</span>
                <InfoToggleButton open={infoOpen === c.id} color={c.color} label={`About ${c.label}`}
                  onClick={() => setInfoOpen((o) => (o === c.id ? null : c.id))} />
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: D.textBody, marginTop: 2, lineHeight: 1.3 }}>{c.label}</div>
              <div style={{ fontSize: 10, color: D.textMuted, marginTop: 3, lineHeight: 1.4 }}>{TYPOLOGY_MEANING[c.id]}</div>
              <div style={{ fontSize: 10, color: D.textMuted, marginTop: 4 }}>Most common in <strong style={{ color: c.color }}>{c.dominantIn}</strong> brgy{c.highest ? ` · highest: ${c.highest.name} (${c.highest.pct[c.id].toFixed(0)}%)` : ""}</div>
            </div>
          );
        })}
      </div>
      {infoOpen != null && (() => {
        const c = T.clusters.find((x) => x.id === infoOpen);
        return c ? (
          <div style={{ ...card, padding: 12 }}>
            <TypologyInfoCard clusterId={c.id} share={c.pct} households={c.count} D={D} />
            <div style={{ fontSize: 10.5, color: D.textMuted, marginTop: 8 }}>{TYPOLOGY_METHOD_NOTE}</div>
          </div>
        ) : null;
      })()}
      <div style={{ fontSize: 11, color: D.textMuted, marginTop: -8 }}>Click <b>i</b> on a profile for its defining factors and reference.</div>

      {/* barangay table */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderBottom: `1px solid ${D.divider}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: D.textPrimary }}>Profile mix per barangay</div>
            <div style={{ fontSize: 11, color: D.textMuted }}>Share of each barangay's households in each profile. Click a barangay to list its households below.</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: D.textMuted }}>Order by
              <select value={sortBy} onChange={e => setSortBy(e.target.value === "name" ? "name" : Number(e.target.value))} style={sel}>
                <option value="name">Barangay name (A–Z)</option>
                {T.clusters.map(c => <option key={c.id} value={c.id}>Share of {c.label} (highest first)</option>)}
              </select>
            </label>
            <button onClick={exportSummaryCSV} style={btn(false)}>Export CSV</button>
            <button onClick={printSummary} style={btn(true)}>Print / PDF</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: D.subBg, borderBottom: `1px solid ${D.border}` }}>
                <th style={th}>Barangay</th><th style={{ ...th, textAlign: "right" }}>HH</th>
                <th style={{ ...th, minWidth: 220 }}>Mix</th>
                {T.clusters.map(c => <th key={c.id} title={c.label} style={{ ...th, textAlign: "right", color: c.color }}>{c.short}</th>)}
                <th style={th}>Most common</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const on = brgy === r.name;
                return (
                  <tr key={r.name} onClick={() => { setBrgy(on ? "all" : r.name); setShowAll(false); }} style={{ cursor: "pointer",
                    background: on ? (dark ? "rgba(99,102,241,0.14)" : "#eef2ff") : i % 2 ? D.rowOdd : D.rowEven, borderBottom: `1px solid ${D.divider}` }}>
                    <td style={{ padding: "8px 12px", fontWeight: 700, color: D.textPrimary, whiteSpace: "nowrap" }}>{r.name}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", color: D.textCell, fontVariantNumeric: "tabular-nums" }}>{r.n.toLocaleString()}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: dark ? "#1c2740" : "#eef1f7" }}>
                        {ORDER.map(id => r.pct[id] > 0 && <div key={id} title={`${TYPOLOGY_LABELS[id]}: ${r.pct[id].toFixed(1)}%`} style={{ width: `${r.pct[id]}%`, background: TYPOLOGY_COLORS[id] }} />)}
                      </div>
                    </td>
                    {T.clusters.map(c => (
                      <td key={c.id} style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                        color: r.dominant === c.id ? c.color : D.textCell, fontWeight: r.dominant === c.id ? 800 : 500 }}>
                        {pct1(r.pct[c.id])} <span style={{ fontSize: 10, color: D.textMuted, fontWeight: 400 }}>({r.counts[c.id] || 0})</span>
                      </td>
                    ))}
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: TYPOLOGY_COLORS[r.dominant], background: TYPOLOGY_COLORS[r.dominant] + (dark ? "22" : "14"),
                        border: `1px solid ${TYPOLOGY_COLORS[r.dominant]}44`, borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" }}>{TYPOLOGY_SHORT[r.dominant]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* household list + export */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderBottom: `1px solid ${D.divider}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: D.textPrimary }}>Households and their profile</div>
            <div style={{ fontSize: 11, color: D.textMuted }}>{hhList.length.toLocaleString()} households · {scopeLabel} · household numbers only, no names</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={label}>Barangay</span>
            <select aria-label="Barangay" value={brgy} onChange={e => { setBrgy(e.target.value); setShowAll(false); }} style={{ ...sel, minWidth: 150 }}>
              <option value="all">All barangays</option>
              {brgyNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={label}>Profile</span>
            <select aria-label="Profile" value={profile} onChange={e => { setProfile(e.target.value); setShowAll(false); }} style={sel}>
              <option value="all">All five profiles</option>
              {T.clusters.map(c => <option key={c.id} value={String(c.id)}>{c.label}</option>)}
            </select>
            <button onClick={exportHouseholdsCSV} disabled={!hhList.length} style={btn(false)}>Export CSV</button>
            <button onClick={printHouseholds} disabled={!hhList.length} style={btn(true)}>Print / PDF</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: D.subBg, borderBottom: `1px solid ${D.border}` }}>
                {["#", "Household", "Barangay", "Members", "Profile", "Conditions present (of the 13 typology indicators)"].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {listShown.map(({ h, brgy: b }, i) => {
                const c = TYPOLOGY_COLORS[h.typology_cluster_id];
                return (
                  <tr key={h.household_id ?? `${h.household_number}-${i}`} style={{ background: i % 2 ? D.rowOdd : D.rowEven, borderBottom: `1px solid ${D.divider}` }}>
                    <td style={{ padding: "7px 12px", color: D.textMuted, fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                    <td style={{ padding: "7px 12px", fontWeight: 700, color: D.textPrimary, whiteSpace: "nowrap" }}>{hhCode(h.household_number)}</td>
                    <td style={{ padding: "7px 12px", color: D.textCell, whiteSpace: "nowrap" }}>{b}</td>
                    <td style={{ padding: "7px 12px", color: D.textCell }}>{h.member_count ?? h.hh_size ?? "—"}</td>
                    <td style={{ padding: "7px 12px" }}>
                      <span title={TYPOLOGY_MEANING[h.typology_cluster_id]} style={{ fontSize: 10, fontWeight: 800, color: c, background: c + (dark ? "22" : "14"), border: `1px solid ${c}44`, borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" }}>{TYPOLOGY_LABELS[h.typology_cluster_id]}</span>
                    </td>
                    <td style={{ padding: "7px 12px", color: D.textCell, fontSize: 11 }}>{hhConditions(h).join(", ") || <span style={{ color: D.textMuted }}>None of the 13</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hhList.length > listShown.length && (
          <div style={{ padding: "10px 14px", borderTop: `1px solid ${D.divider}`, display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: D.textMuted }}>
            Showing the first {listShown.length} of {hhList.length.toLocaleString()} on screen. The export includes all of them.
            <button onClick={() => setShowAll(true)} style={btn(false)}>Show all</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: D.textMuted, lineHeight: 1.6 }}>{NOTE}</div>
    </div>
  );
}
