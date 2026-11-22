// ============================================================
// Custom Population Report -- the LGU picks exactly what they need.
//
// Two ways to build a report:
//   1. Count people   -- e.g. "PWDs in Igtambo", "female senior citizens
//                        aged 70+", "unemployed 4Ps members by education".
//                        Any mix of sector, sex, age range, civil status,
//                        employment and education, counted per barangay
//                        and optionally split by sex / age group / etc.
//                        (backend: /api/population/custom-count)
//   2. Pick figures   -- any of the ready-made per-barangay figures from
//                        the Data Attributes page (households, 4Ps
//                        households, hazard zones, capacity items ...).
//                        (backend: /api/population/attributes)
// Either way: choose the barangays, preview, then export to Excel, CSV or
// print / save as PDF.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import systemLogo from "../../assets/logo.png";
import { getAttributes, getCustomOptions, postCustomCount, postCustomList } from "../../api/api";

const ACCENT = "#0f766e";
const PREVIEW_MAX = 500;   // rows drawn on screen; exports always include everyone
const SECTORS = [
  { key: "pwd", label: "PWD" },
  { key: "senior", label: "Senior citizen" },
  { key: "solo_parent", label: "Solo parent" },
  { key: "fourps", label: "4Ps member" },
];
const SPLITS = [
  { id: "none", label: "No breakdown" },
  { id: "sex", label: "Sex" },
  { id: "lifestage", label: "Life stage (0–4 · 5–17 · 18–59 · 60+)" },
  { id: "age5", label: "5-year age group" },
  { id: "civil_status", label: "Civil status" },
  { id: "employment_status", label: "Employment" },
  { id: "educational_attainment", label: "Education" },
];
const AGE_PRESETS = [
  { label: "Any age", min: "", max: "" },
  { label: "Children 0–17", min: 0, max: 17 },
  { label: "Working age 18–59", min: 18, max: 59 },
  { label: "Seniors 60+", min: 60, max: "" },
];
const FIGURE_PRESETS = [
  { label: "Vulnerable sectors", keys: ["pwd", "age_60_plus", "solo_parents", "fourps_members", "fourps_households"] },
  { label: "Population & sex", keys: ["population", "male", "female", "households"] },
  { label: "Age groups", keys: ["age_0_4", "age_5_17", "minors", "age_18_59", "age_60_plus"] },
  { label: "Hazard zones", keys: ["flood_low", "flood_moderate", "flood_high", "flood_very_high", "slide_low", "slide_moderate", "slide_high"] },
  { label: "Distance to help", keys: ["rhu_n_beyond", "fire_n_beyond", "not_know_evac", "not_know_hotline"] },
];

const fmtN = (n) => (n == null ? "—" : Number(n).toLocaleString());
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
const fileSafe = (s) => String(s || "report").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 100) || "report";

// Format one attribute value for display/export.
function fmtAttr(a, v) {
  if (!v || v.value == null) return "—";
  if (a.unit === "yesno") return Number(v.value) ? "Yes" : "No";
  if (a.unit === "pesos") return `₱${Number(v.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (a.unit === "pct") return `${Number(v.value).toFixed(1)}%`;
  if (a.unit === "km") return `${Number(v.value).toFixed(2)} km`;
  return fmtN(v.value);
}
function totalAttr(a, rows) {
  if (a.unit === "count") return fmtN(rows.reduce((s, r) => s + (Number(a.values[r.psgc_10d]?.value) || 0), 0));
  if (a.unit === "pesos") return `₱${rows.reduce((s, r) => s + (Number(a.values[r.psgc_10d]?.value) || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (a.unit === "yesno") return `${rows.filter((r) => Number(a.values[r.psgc_10d]?.value)).length} of ${rows.length} yes`;
  return "—";
}
function pctAttr(a, rows) {
  const n = rows.reduce((s, r) => s + (Number(a.values[r.psgc_10d]?.value) || 0), 0);
  const b = rows.reduce((s, r) => s + (Number(a.values[r.psgc_10d]?.base) || 0), 0);
  return b ? `${((100 * n) / b).toFixed(1)}%` : "—";
}

export default function CustomPopulationReport({ D, dark }) {
  const [mode, setMode] = useState("people");            // "people" | "figures"
  const [options, setOptions] = useState(null);
  const [attrs, setAttrs] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  // shared
  const [brgys, setBrgys] = useState([]);                // [] = all
  const [brgyQ, setBrgyQ] = useState("");
  const [showPct, setShowPct] = useState(true);
  const [hideZero, setHideZero] = useState(false);
  const [sortBy, setSortBy] = useState("name");          // "name" | "total"
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);

  // people mode
  const [sectors, setSectors] = useState({ pwd: true });
  const [pwdId, setPwdId] = useState("");
  const [sex, setSex] = useState("any");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [civil, setCivil] = useState([]);
  const [employ, setEmploy] = useState([]);
  const [educ, setEduc] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [split, setSplit] = useState("none");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [qErr, setQErr] = useState(null);
  const [view, setView] = useState("counts");          // "counts" | "names" (people mode)
  const [list, setList] = useState(null);
  const [listBusy, setListBusy] = useState(false);
  const [listQ, setListQ] = useState("");

  // figures mode
  const [figKeys, setFigKeys] = useState(FIGURE_PRESETS[0].keys);
  const [figQ, setFigQ] = useState("");
  const [openGroups, setOpenGroups] = useState({ Population: true, Households: true });

  useEffect(() => {
    getCustomOptions().then((r) => setOptions(r.data)).catch((e) => setLoadErr(e.message));
    getAttributes().then((r) => setAttrs(r.data)).catch(() => setAttrs({ attributes: [], groups: [], barangays: [] }));
  }, []);

  const allBrgys = options?.barangays || [];
  const brgyName = useMemo(() => Object.fromEntries(allBrgys.map((b) => [b.psgc_10d, b.barangay])), [allBrgys]);

  // ── people mode: query (debounced) ──
  const conditions = useMemo(() => {
    const c = {};
    SECTORS.forEach((s) => { if (sectors[s.key]) c[s.key] = true; });
    if (sectors.pwd && pwdId) c.pwd_id = pwdId;
    if (sex !== "any") c.sex = [sex];
    if (ageMin !== "") c.age_min = Number(ageMin);
    if (ageMax !== "") c.age_max = Number(ageMax);
    if (civil.length) c.civil_status = civil;
    if (employ.length) c.employment_status = employ;
    if (educ.length) c.educational_attainment = educ;
    return c;
  }, [sectors, pwdId, sex, ageMin, ageMax, civil, employ, educ]);

  const reqId = useRef(0);
  useEffect(() => {
    if (mode !== "people") return;
    const id = ++reqId.current;
    setBusy(true); setQErr(null);
    const t = setTimeout(() => {
      postCustomCount({ conditions, split_by: split, barangays: brgys })
        .then((r) => { if (id === reqId.current) setResult(r.data); })
        .catch((e) => { if (id === reqId.current) setQErr(e.response?.data?.error || e.message); })
        .finally(() => { if (id === reqId.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [mode, conditions, split, brgys]);

  // names list -- only fetched while the "List of names" view is open
  const listId = useRef(0);
  useEffect(() => {
    if (mode !== "people" || view !== "names") return;
    const id = ++listId.current;
    setListBusy(true);
    const t = setTimeout(() => {
      postCustomList({ conditions, barangays: brgys })
        .then((r) => { if (id === listId.current) setList(r.data); })
        .catch((e) => { if (id === listId.current) { setList(null); setQErr(e.response?.status === 401 ? "Please log in again to view names." : (e.response?.data?.error || e.message)); } })
        .finally(() => { if (id === listId.current) setListBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [mode, view, conditions, brgys]);
  const names = mode === "people" && view === "names";

  // ── auto title ──
  const autoTitle = useMemo(() => {
    const where = brgys.length === 0 ? "all barangays" : brgys.length === 1 ? (brgyName[brgys[0]] || "1 barangay") : `${brgys.length} barangays`;
    if (mode === "people") {
      const d = result?.description || "Residents";
      if (view === "names") return `List of names: ${d} — ${where}`;
      const by = split !== "none" ? ` by ${SPLITS.find((s) => s.id === split)?.label.split(" (")[0].toLowerCase()}` : "";
      return `${d}${by} — ${where}`;
    }
    const labels = (attrs?.attributes || []).filter((a) => figKeys.includes(a.key)).map((a) => a.label);
    return `${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""} — ${where}`;
  }, [mode, view, result, split, brgys, brgyName, attrs, figKeys]);
  useEffect(() => { if (!titleEdited) setTitle(autoTitle); }, [autoTitle, titleEdited]);

  // ── build the table (same shape for preview + every export) ──
  const table = useMemo(() => {
    if (mode === "people" && view === "names") {
      if (!list) return null;
      const withId = !!conditions.pwd;
      const headers = ["#", "Barangay", "Household", "Name (surname, given name)", "Sex", "Age", "Civil status", "Relationship to head", "Sector", ...(withId ? ["PWD ID"] : [])];
      const raw = list.rows.map((r, i) => [i + 1, r.barangay, r.household || "", r.name, r.sex, r.age ?? "", r.civil_status || "", r.relationship || "", r.sectors.join(", "), ...(withId ? [r.pwd_id || ""] : [])]);
      const body = raw.map((r) => r.map((c) => (c === "" || c == null ? "—" : String(c))));
      return { headers, body, raw, totalRow: null, totalRaw: null, count: list.count, desc: list.description, names: true,
        align: headers.map((h) => (h === "#" || h === "Age" ? "r" : "l")) };
    }
    if (mode === "people") {
      if (!result) return null;
      const cols = result.split_by === "none" ? [] : result.columns;
      let rows = result.rows.map((r) => ({ id: r.psgc_10d, name: r.barangay, cells: cols.map((c) => r.counts[c] || 0), total: r.total, pct: r.pct, population: r.population }));
      if (hideZero) rows = rows.filter((r) => r.total > 0);
      rows.sort(sortBy === "total" ? (a, b) => b.total - a.total || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const headers = ["Barangay", ...cols, cols.length ? "Total" : "Count", ...(showPct ? ["% of residents"] : [])];
      const body = rows.map((r) => [r.name, ...r.cells.map(fmtN), fmtN(r.total), ...(showPct ? [`${r.pct.toFixed(1)}%`] : [])]);
      const raw = rows.map((r) => [r.name, ...r.cells, r.total, ...(showPct ? [r.pct] : [])]);
      const tot = result.total;
      const showTotal = rows.length > 1;
      const totalRow = showTotal ? ["All selected barangays", ...cols.map((c) => fmtN(tot.counts[c])), fmtN(tot.total), ...(showPct ? [`${tot.pct.toFixed(1)}%`] : [])] : null;
      const totalRaw = showTotal ? ["All selected barangays", ...cols.map((c) => tot.counts[c]), tot.total, ...(showPct ? [tot.pct] : [])] : null;
      return { headers, body, raw, totalRow, totalRaw, count: rows.length, grand: tot.total, desc: result.description };
    }
    if (!attrs) return null;
    const chosen = figKeys.map((k) => attrs.attributes.find((a) => a.key === k)).filter(Boolean);
    let rows = (brgys.length ? attrs.barangays.filter((b) => brgys.includes(b.psgc_10d)) : attrs.barangays).slice();
    if (hideZero && chosen.length) rows = rows.filter((b) => chosen.some((a) => Number(a.values[b.psgc_10d]?.value)));
    const first = chosen[0];
    rows.sort(sortBy === "total" && first ? (a, b) => (Number(first.values[b.psgc_10d]?.value) || 0) - (Number(first.values[a.psgc_10d]?.value) || 0) : (a, b) => a.barangay.localeCompare(b.barangay, undefined, { numeric: true }));
    const withPct = (a) => showPct && a.unit === "count" && a.base_label;
    const headers = ["Barangay"];
    chosen.forEach((a) => { headers.push(a.label); if (withPct(a)) headers.push(`${a.label} · %`); });
    const body = [], raw = [];
    rows.forEach((b) => {
      const r = [b.barangay], rr = [b.barangay];
      chosen.forEach((a) => {
        const v = a.values[b.psgc_10d];
        r.push(fmtAttr(a, v)); rr.push(v?.value ?? "");
        if (withPct(a)) { r.push(v?.pct != null ? `${v.pct.toFixed(1)}%` : "—"); rr.push(v?.pct ?? ""); }
      });
      body.push(r); raw.push(rr);
    });
    const showTotal = rows.length > 1;
    let totalRow = null, totalRaw = null;
    if (showTotal) {
      totalRow = ["All selected barangays"]; totalRaw = ["All selected barangays"];
      chosen.forEach((a) => {
        const t = totalAttr(a, rows); totalRow.push(t); totalRaw.push(t);
        if (withPct(a)) { const p = pctAttr(a, rows); totalRow.push(p); totalRaw.push(p); }
      });
    }
    return { headers, body, raw, totalRow, totalRaw, count: rows.length, figures: chosen.length };
  }, [mode, view, list, conditions, result, attrs, figKeys, brgys, showPct, hideZero, sortBy]);
  const alignOf = (i) => (table?.align ? table.align[i] === "r" : i > 0);
  const shownBody = useMemo(() => {
    if (!table) return [];
    if (!table.names || !listQ.trim()) return table.body;
    const q = listQ.trim().toLowerCase();
    return table.body.filter((r) => `${r[3]} ${r[2]} ${r[1]}`.toLowerCase().includes(q));
  }, [table, listQ]);

  // ── exports ──
  const sourceNote = names
    ? "Source: CBMS 2024 member records (live data). Contains personal information (Data Privacy Act of 2012, RA 10173) — for official LGU use only; do not post or share publicly."
    : mode === "people"
    ? "Source: CBMS 2024 member records (live data). Counts are people, per barangay."
    : "Source: CBMS 2024 household and member records, barangay profile and hazard maps (live data).";
  const exportXlsx = () => {
    if (!table) return;
    const aoa = [[title], [`Municipality of San Miguel, Iloilo · Generated ${today()}`], [], table.headers, ...table.raw, ...(table.totalRaw ? [table.totalRaw] : []), [], [sourceNote]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = table.names
      ? table.headers.map((h) => ({ wch: { "#": 6, "Barangay": 18, "Household": 11, "Name (surname, given name)": 36, "Sex": 8, "Age": 6, "Civil status": 20, "Relationship to head": 20, "Sector": 26, "PWD ID": 8 }[h] || 12 }))
      : table.headers.map((h, i) => ({ wch: i === 0 ? 26 : Math.max(10, Math.min(30, String(h).length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${fileSafe(title)}.xlsx`);
  };
  const exportCsv = () => {
    if (!table) return;
    const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [[title], [], table.headers, ...table.raw, ...(table.totalRaw ? [table.totalRaw] : [])].map((r) => r.map(q).join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${fileSafe(title)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const exportPrint = () => {
    if (!table) return;
    const logo = new URL(systemLogo, window.location.href).href;
    const num = alignOf;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      *{margin:0;padding:0;box-sizing:border-box} body{font-family:'Segoe UI',Arial,sans-serif;padding:36px;color:#1f2937;background:#fff}
      .hd{display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:2px solid #0f766e;margin-bottom:18px}
      .hd img{width:46px;height:46px} .org{font-size:11px;color:#6b7280;letter-spacing:.3px} .t{font-size:18px;font-weight:800;color:#0f3d3a;margin-top:2px}
      .desc{font-size:12px;color:#374151;margin:0 0 14px} table{width:100%;border-collapse:collapse;font-size:11.5px}
      th{background:#0f766e;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      th.n,td.n{text-align:right;font-variant-numeric:tabular-nums} td{padding:7px 10px;border-bottom:1px solid #e5e7eb}
      tr:nth-child(even) td{background:#f8fafb} tr.tot td{font-weight:800;background:#ecfdf5;border-top:2px solid #0f766e}
      .ft{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#6b7280;display:flex;justify-content:space-between;gap:16px}
      ${table.names ? "table{font-size:10.5px} td,th{padding:5px 7px}" : ""}
      .priv{margin:0 0 12px;padding:7px 10px;border-left:3px solid #b45309;background:#fffbeb;font-size:10.5px;color:#78350f}
      @media print{body{padding:18px} @page{size:${table.headers.length > 7 ? "landscape" : "portrait"};margin:12mm} thead{display:table-header-group} tr{page-break-inside:avoid}}
    </style></head><body>
    <div class="hd"><img src="${logo}" alt=""/><div><div class="org">MUNICIPALITY OF SAN MIGUEL, ILOILO · LGU-SDSS</div><div class="t">${esc(title)}</div></div></div>
    ${table.desc ? `<p class="desc">${esc(table.desc)} · ${table.names ? `${table.count.toLocaleString()} ${table.count === 1 ? "person" : "people"}` : `${table.count} barangay${table.count === 1 ? "" : "s"}`}</p>` : ""}
    ${table.names ? `<div class="priv">Contains personal information protected by the Data Privacy Act of 2012 (RA 10173). For official LGU use only — do not post, share publicly or leave unattended.</div>` : ""}
    <table><thead><tr>${table.headers.map((h, i) => `<th class="${num(i) ? "n" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>
    ${table.body.map((r) => `<tr>${r.map((c, i) => `<td class="${num(i) ? "n" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}
    ${table.totalRow ? `<tr class="tot">${table.totalRow.map((c, i) => `<td class="${num(i) ? "n" : ""}">${esc(c)}</td>`).join("")}</tr>` : ""}
    </tbody></table>
    <div class="ft"><span>${esc(sourceNote)}</span><span>Generated ${today()}</span></div></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  };

  // ── styles ──
  const label = { fontSize: 10.5, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.6 };
  const box = { background: D.subBg, border: `1px solid ${D.border}`, borderRadius: 10, padding: 12 };
  const input = { padding: "6px 9px", borderRadius: 7, fontSize: 12.5, border: `1px solid ${D.inputBorder || D.border}`, background: D.inputBg || D.cardBg, color: D.textBody, outline: "none" };
  const chip = (on, color = ACCENT) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 16, fontSize: 12, cursor: "pointer",
    fontWeight: on ? 700 : 500, border: `1px solid ${on ? color : D.border}`, background: on ? `${color}${dark ? "2e" : "14"}` : "transparent",
    color: on ? (dark ? "#5eead4" : color) : D.textCell || D.textBody, transition: "all .15s",
  });
  const seg = (on) => ({
    flex: 1, padding: "7px 10px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: on ? 700 : 500,
    background: on ? (dark ? "#134e4a" : "#ffffff") : "transparent", color: on ? (dark ? "#99f6e4" : ACCENT) : D.textMuted,
    boxShadow: on ? (dark ? "0 1px 4px rgba(0,0,0,.4)" : "0 1px 3px rgba(15,118,110,.18)") : "none",
  });
  const exportBtn = (primary) => ({
    display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: table ? "pointer" : "not-allowed",
    border: primary ? "none" : `1px solid ${ACCENT}66`, background: primary ? `linear-gradient(135deg,#115e59,${ACCENT})` : `${ACCENT}${dark ? "1a" : "0d"}`,
    color: primary ? "#fff" : (dark ? "#5eead4" : ACCENT), opacity: table ? 1 : 0.5, boxShadow: primary ? "0 2px 8px rgba(15,118,110,.3)" : "none",
  });

  if (loadErr) return <div style={{ padding: 24, color: "#dc2626", fontSize: 13 }}>Could not load the report builder: {loadErr}</div>;
  if (!options) return <div style={{ padding: 24, color: D.textMuted, fontSize: 13 }}>Loading report builder…</div>;

  const toggleIn = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const shownBrgys = allBrgys.filter((b) => !brgyQ || b.barangay.toLowerCase().includes(brgyQ.toLowerCase()))
    .sort((a, b) => a.barangay.localeCompare(b.barangay, undefined, { numeric: true }));

  const multi = (title, key, list, sel, set) => list?.length ? (
    <div>
      <div style={{ ...label, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {list.map((o) => (
          <button key={o.value} onClick={() => toggleIn(sel, set, o.value)} style={chip(sel.includes(o.value))}>
            {o.value}<span style={{ fontSize: 10.5, opacity: 0.7 }}>{o.count.toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(320px, 380px) minmax(0, 1fr)", gap: 16, padding: 18, alignItems: "start" }} className="cpr-grid">
      <style>{`@media (max-width: 1100px){ .cpr-grid{ grid-template-columns: 1fr !important; } }
        .cpr-row:hover td{ background:${dark ? "#162038" : "#f0fdfa"} !important; }`}</style>

      {/* ───────── Builder ───────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 9, background: D.subBg, border: `1px solid ${D.border}` }}>
          <button style={seg(mode === "people")} onClick={() => setMode("people")}>Count people</button>
          <button style={seg(mode === "figures")} onClick={() => setMode("figures")}>Pick figures</button>
        </div>
        <div style={{ fontSize: 11.5, color: D.textMuted, lineHeight: 1.5, marginTop: -4 }}>
          {mode === "people"
            ? "Choose who to count (e.g. PWDs, female seniors, unemployed 4Ps members) and where. The table updates as you choose."
            : "Choose any of the ready-made figures per barangay (households, 4Ps households, hazard zones, capacity items…)."}
        </div>

        {/* 1. Barangays */}
        <div style={box}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={label}>1 · Barangays</span>
            <span style={{ fontSize: 11.5, color: D.textMuted }}>{brgys.length ? `${brgys.length} selected` : "All 24"}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input value={brgyQ} onChange={(e) => setBrgyQ(e.target.value)} placeholder="Find a barangay…" style={{ ...input, flex: 1, minWidth: 0 }} />
            <button onClick={() => setBrgys([])} style={chip(brgys.length === 0)}>All</button>
          </div>
          <div style={{ maxHeight: 168, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
            {shownBrgys.map((b) => {
              const on = brgys.includes(b.psgc_10d);
              return (
                <label key={b.psgc_10d} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: D.textBody, cursor: "pointer", padding: "3px 2px", borderRadius: 5 }}>
                  <input type="checkbox" checked={on} onChange={() => toggleIn(brgys, setBrgys, b.psgc_10d)} style={{ accentColor: ACCENT }} />
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.barangay}</span>
                </label>
              );
            })}
          </div>
        </div>

        {mode === "people" ? (
          <>
            {/* 2. Who */}
            <div style={{ ...box, display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={label}>2 · Who to count</span>
              <div>
                <div style={{ fontSize: 11.5, color: D.textMuted, marginBottom: 6 }}>Sector (pick none to count everyone)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SECTORS.map((s) => (
                    <button key={s.key} onClick={() => setSectors((p) => ({ ...p, [s.key]: !p[s.key] }))} style={chip(!!sectors[s.key])}>
                      {sectors[s.key] ? "✓ " : ""}{s.label}
                    </button>
                  ))}
                </div>
                {sectors.pwd && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: D.textBody }}>
                    PWD ID:
                    {[["", "Any"], ["Yes", "Has ID"], ["No", "No ID"]].map(([v, l]) => (
                      <button key={l} onClick={() => setPwdId(v)} style={{ ...chip(pwdId === v), padding: "3px 9px", fontSize: 11.5 }}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: D.textMuted, marginBottom: 6 }}>Sex</div>
                <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 8, background: dark ? "rgba(0,0,0,.2)" : "#fff", border: `1px solid ${D.border}` }}>
                  {[["any", "Any"], ["Male", "Male"], ["Female", "Female"]].map(([v, l]) => (
                    <button key={v} onClick={() => setSex(v)} style={{ ...seg(sex === v), padding: "5px 8px", fontSize: 12 }}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: D.textMuted, marginBottom: 6 }}>Age</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="number" min="0" max="120" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="From" style={{ ...input, width: 80 }} aria-label="Age from" />
                  <span style={{ color: D.textMuted, fontSize: 12 }}>to</span>
                  <input type="number" min="0" max="120" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="To" style={{ ...input, width: 80 }} aria-label="Age to" />
                  <span style={{ color: D.textMuted, fontSize: 11.5 }}>years</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {AGE_PRESETS.map((p) => (
                    <button key={p.label} onClick={() => { setAgeMin(p.min); setAgeMax(p.max); }}
                      style={{ ...chip(String(ageMin) === String(p.min) && String(ageMax) === String(p.max)), padding: "3px 9px", fontSize: 11.5 }}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <button onClick={() => setMoreOpen((o) => !o)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: dark ? "#5eead4" : ACCENT }}>
                  {moreOpen ? "▾" : "▸"} More conditions{(civil.length + employ.length + educ.length) ? ` (${civil.length + employ.length + educ.length} chosen)` : ""}
                </button>
                {moreOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
                    {multi("Civil status", "civil_status", options.civil_status, civil, setCivil)}
                    {multi("Employment", "employment_status", options.employment_status, employ, setEmploy)}
                    {multi("Education", "educational_attainment", options.educational_attainment, educ, setEduc)}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Breakdown */}
            <div style={box}>
              <div style={{ ...label, marginBottom: 8 }}>3 · Break down by</div>
              <select value={split} onChange={(e) => setSplit(e.target.value)} style={{ ...input, width: "100%" }}>
                {SPLITS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </>
        ) : (
          /* 2. Figures */
          <div style={box}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={label}>2 · Figures</span>
              <span style={{ fontSize: 11.5, color: D.textMuted }}>{figKeys.length} chosen{figKeys.length ? <> · <button onClick={() => setFigKeys([])} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, color: dark ? "#5eead4" : ACCENT }}>clear</button></> : null}</span>
            </div>
            <div style={{ fontSize: 11.5, color: D.textMuted, marginBottom: 6 }}>Quick sets</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {FIGURE_PRESETS.map((p) => (
                <button key={p.label} onClick={() => setFigKeys(p.keys)} style={{ ...chip(p.keys.join() === figKeys.join()), padding: "3px 10px", fontSize: 11.5 }}>{p.label}</button>
              ))}
            </div>
            <input value={figQ} onChange={(e) => setFigQ(e.target.value)} placeholder="Search figures (e.g. PWD, flood, ambulance)…" style={{ ...input, width: "100%", marginBottom: 8 }} />
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {(attrs?.groups || []).map((g) => {
                const items = attrs.attributes.filter((a) => a.group === g && (!figQ || `${a.label} ${a.definition}`.toLowerCase().includes(figQ.toLowerCase())));
                if (!items.length) return null;
                const open = figQ || openGroups[g];
                const n = items.filter((a) => figKeys.includes(a.key)).length;
                return (
                  <div key={g} style={{ borderTop: `1px solid ${D.border}`, padding: "6px 0" }}>
                    <button onClick={() => setOpenGroups((p) => ({ ...p, [g]: !p[g] }))} style={{ display: "flex", width: "100%", justifyContent: "space-between", background: "none", border: "none", padding: "3px 0", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: D.textPrimary }}>
                      <span>{open ? "▾" : "▸"} {g}</span>
                      <span style={{ fontSize: 11, color: D.textMuted, fontWeight: 500 }}>{n ? `${n} of ` : ""}{items.length}</span>
                    </button>
                    {open && items.map((a) => (
                      <label key={a.key} title={a.definition} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: D.textBody, cursor: "pointer", padding: "3px 0 3px 14px" }}>
                        <input type="checkbox" checked={figKeys.includes(a.key)} onChange={() => toggleIn(figKeys, setFigKeys, a.key)} style={{ accentColor: ACCENT }} />
                        {a.label}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Options */}
        {!names && <div style={{ ...box, display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ ...label, marginBottom: 2 }}>{mode === "people" ? "4" : "3"} · Options</span>
          {[["Show % column", showPct, setShowPct], ["Hide barangays with none", hideZero, setHideZero]].map(([l, v, set]) => (
            <label key={l} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: D.textBody, cursor: "pointer" }}>
              <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} style={{ accentColor: ACCENT }} />{l}
            </label>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: D.textBody }}>
            Sort by
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...input, padding: "4px 8px" }}>
              <option value="name">Barangay name</option>
              <option value="total">{mode === "people" ? "Highest count first" : "First figure, highest first"}</option>
            </select>
          </label>
        </div>}
      </div>

      {/* ───────── Preview + export ───────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ ...box, background: D.cardBg, display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "people" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={label}>Show</span>
              <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 9, background: D.subBg, border: `1px solid ${D.border}`, minWidth: 300 }}>
                <button style={seg(view === "counts")} onClick={() => setView("counts")}>Counts per barangay</button>
                <button style={seg(view === "names")} onClick={() => setView("names")}>List of names</button>
              </div>
              {names && <span style={{ fontSize: 11.5, color: dark ? "#fcd34d" : "#b45309" }}>Contains personal information — for official use only.</span>}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ ...label, marginBottom: 5 }}>Report title</div>
              <input value={title} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }} style={{ ...input, width: "100%", fontSize: 14, fontWeight: 700, color: D.textPrimary }} />
            </div>
            {titleEdited && (
              <button onClick={() => setTitleEdited(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, color: D.textMuted, paddingBottom: 8 }}>Reset title</button>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={exportXlsx} disabled={!table} style={exportBtn(false)}>Excel</button>
              <button onClick={exportCsv} disabled={!table} style={exportBtn(false)}>CSV</button>
              <button onClick={exportPrint} disabled={!table} style={exportBtn(true)}>Print / PDF</button>
            </div>
          </div>

          {/* headline answer */}
          {mode === "people" && result && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 9,
              background: dark ? "rgba(15,118,110,.15)" : "#f0fdfa", border: `1px solid ${dark ? "rgba(94,234,212,.25)" : "#99f6e4"}` }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: dark ? "#5eead4" : ACCENT, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{fmtN(result.total.total)}</span>
              <span style={{ fontSize: 13, color: D.textBody }}>
                {/^[A-Z][a-z]/.test(result.description) ? result.description.charAt(0).toLowerCase() + result.description.slice(1) : result.description} in {brgys.length === 1 ? (brgyName[brgys[0]] || "1 barangay") : brgys.length ? `${brgys.length} barangays` : "San Miguel"}
                <span style={{ color: D.textMuted }}> · {result.total.pct.toFixed(1)}% of {fmtN(result.total.population)} residents</span>
              </span>
              {busy && <span style={{ fontSize: 11, color: D.textMuted, marginLeft: "auto" }}>Updating…</span>}
            </div>
          )}
          {qErr && <div style={{ fontSize: 12, color: "#dc2626" }}>Could not count: {qErr}</div>}
        </div>

        <div style={{ ...box, background: D.cardBg, padding: 0, overflow: "hidden" }}>
          {names && table && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${D.border}`, flexWrap: "wrap" }}>
              <input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder="Search a name or household…" style={{ ...input, flex: 1, minWidth: 200 }} />
              <span style={{ fontSize: 11.5, color: D.textMuted }}>
                {listBusy ? "Updating…" : `${shownBody.length.toLocaleString()}${listQ ? ` of ${table.count.toLocaleString()}` : ""} ${table.count === 1 ? "person" : "people"}${shownBody.length > PREVIEW_MAX ? ` · showing the first ${PREVIEW_MAX}` : ""} · exports include everyone`}
              </span>
            </div>
          )}
          {!table || (mode === "figures" && !table.figures) ? (
            <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: D.textMuted }}>
              {mode === "figures" ? "Pick at least one figure on the left." : names && listBusy ? "Loading names…" : "Loading…"}
            </div>
          ) : (
            <div style={{ overflow: "auto", maxHeight: 620 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {table.headers.map((h, i) => (
                      <th key={i} style={{ position: "sticky", top: 0, zIndex: 1, textAlign: alignOf(i) ? "right" : "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: 0.4, color: "#fff", background: dark ? "#115e59" : ACCENT, whiteSpace: i && !table.names ? "normal" : "nowrap",
                        minWidth: table.names ? (h.startsWith("Name") ? 220 : 0) : (i ? 70 : 150) }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownBody.slice(0, PREVIEW_MAX).map((r, ri) => (
                    <tr key={ri} className="cpr-row">
                      {r.map((c, i) => {
                        const strong = table.names ? table.headers[i].startsWith("Name") : i === 0;
                        return (
                        <td key={i} style={{ padding: "7px 12px", borderBottom: `1px solid ${D.border}`, textAlign: alignOf(i) ? "right" : "left",
                          fontWeight: strong ? 600 : 500, color: strong ? D.textPrimary : D.textBody, fontVariantNumeric: "tabular-nums", whiteSpace: table.names ? "nowrap" : "normal",
                          background: ri % 2 ? (dark ? "rgba(255,255,255,.015)" : "#fafbfc") : "transparent" }}>{c}</td>
                        );
                      })}
                    </tr>
                  ))}
                  {!shownBody.length && (
                    <tr><td colSpan={table.headers.length} style={{ padding: 24, textAlign: "center", color: D.textMuted }}>{table.names ? "Nobody matches." : "No barangay matches."}</td></tr>
                  )}
                  {table.totalRow && (
                    <tr>
                      {table.totalRow.map((c, i) => (
                        <td key={i} style={{ position: "sticky", bottom: 0, padding: "8px 12px", textAlign: i ? "right" : "left", fontWeight: 800,
                          color: D.textPrimary, background: dark ? "#0f2a2a" : "#ecfdf5", borderTop: `2px solid ${ACCENT}`, fontVariantNumeric: "tabular-nums" }}>{c}</td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: D.textMuted }}>{sourceNote}</div>
      </div>
    </div>
  );
}
