// Data Attributes -- every attribute that goes into a calculation (or is
// listed beside one), what it means, where it comes from, which score uses
// it, and its value in each of the 24 barangays.
import { useEffect, useMemo, useState } from "react";
import { getAttributes } from "../api/api";
import { useTheme } from "../hooks/useTheme";
import { useUrlParam } from "../hooks/useRoute";
import AttributeCharts, { attrColor } from "./AttributeCharts";

const GROUP_COLOR = {
  "Population": "#2563eb", "Households": "#0891b2", "Social vulnerability (SVI)": "#7c3aed",
  "Distance to help": "#db2777", "Household typology": "#9333ea", "Barangay capacity": "#16a34a",
  "Hazard exposure": "#dc2626",
};
// Person counts and the household counts behind them (panel: "per-household
// and per-PWD counts"). Either side of a pair shows the other next to it.
const PAIRS = [
  { persons: "pwd", households: "ti_pwd_count_cat", noun: "persons with disability", short: "PWD" },
  { persons: "age_60_plus", households: "ti_senior_count_cat", noun: "senior citizens", short: "seniors" },
  { persons: "solo_parents", households: "ti_solo_parent_count_cat", noun: "solo parents", short: "solo parents" },
];
// Plain one-line definitions for the barangay capacity items (CBMS barangay
// record, section F, and the facility map). The catalogue only sends the
// item's group, so the page shows these instead, followed by the group.
const CAPACITY_DEFS = {
  f02_disaster_committee: "The barangay has an organized disaster risk reduction and management committee.",
  f03_disaster_response: "The barangay has an emergency or disaster response team.",
  f04_disaster_hotline_presence: "The barangay has an emergency hotline residents can call during a disaster.",
  f13_conduct_seminars: "The barangay held a disaster preparedness seminar or drill in the past 12 months.",
  f01_disaster_plan: "The barangay has a Barangay Disaster Risk Reduction and Management (BDRRM) plan.",
  f09_evacuation_map_presence: "The barangay has an evacuation map showing evacuation routes and centres.",
  f11_hazard_map_presence: "The barangay has a hazard map showing areas prone to flooding, landslides and other hazards.",
  f16_a_first_aid_kits: "Number of first-aid kits the barangay keeps for emergencies.",
  f16_b_boats: "Number of boats, vans or buses available for rescue and evacuation.",
  f16_c_ambulance: "Number of ambulances or patient-transport vehicles.",
  f16_d_amphibian: "Number of amphibian (land-and-water) rescue vehicles.",
  f16_e_backhoe: "Number of heavy equipment units (such as a backhoe) for clearing and rescue.",
  f16_f_siren: "Number of sirens or warning devices for alerting residents.",
  f16_g_radio: "Number of two-way radios or other communication equipment.",
  f16_h_generator: "Number of portable or solar generators for backup power.",
  f16_i_emergency_lights: "Number of emergency lights, such as rechargeable lamps.",
  f17_drrm_expenditures: "Amount the barangay spent on disaster risk reduction and management in 2023.",
  facility_schools: "Number of schools located inside the barangay (from the facility map); schools often serve as evacuation sites.",
  facility_evacuation_centers: "Number of designated evacuation centres located inside the barangay (from the facility map).",
};
const PAIR_ALIAS = { pwd_prop: "pwd", senior_prop: "age_60_plus", solo_parent_prop: "solo_parents" };
function pairFor(key) {
  const k = PAIR_ALIAS[key] || key;
  return PAIRS.find((p) => p.persons === k || p.households === k) || null;
}
const UNIT_NOTE = { count: "Count", pct: "Rate (%)", km: "Kilometres", yesno: "Yes / No", pesos: "Pesos" };

function fmtVal(a, v) {
  if (!v || v.value == null) return "—";
  if (a.unit === "yesno") return typeof v.value === "boolean" ? (v.value ? "Yes" : "No") : (Number(v.value) ? "Yes" : "No");
  if (a.unit === "pct") return `${Number(v.value).toFixed(1)}%`;
  if (a.unit === "km") return `${Number(v.value).toFixed(2)} km`;
  if (a.unit === "pesos") return `₱${Number(v.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return Number(v.value).toLocaleString();
}
const numeric = (a, v) => {
  if (!v || v.value == null) return null;
  if (a.unit === "yesno") return typeof v.value === "boolean" ? (v.value ? 1 : 0) : Number(v.value);
  return Number(v.value);
};

export default function AttributesPage({ intent } = {}) {
  const { dark } = useTheme();
  const D = {
    pageBg: dark ? "#0d0f14" : "#f5f6fa", cardBg: dark ? "#141720" : "#ffffff", subBg: dark ? "#0f1117" : "#f6f8fc",
    border: dark ? "#1e2235" : "#e3e8f0", inputBg: dark ? "#0f1117" : "#ffffff", inputBorder: dark ? "#263049" : "#d9dee8",
    textPrimary: dark ? "#9db8f5" : "#1a237e", textBody: dark ? "#c3cad8" : "#333333", textMuted: dark ? "#7d879c" : "#7a8294",
    hover: dark ? "#161b2e" : "#eef2ff", active: dark ? "#1a2442" : "#e8efff",
    shadow: dark ? "0 1px 8px rgba(0,0,0,0.5)" : "0 1px 3px rgba(0,0,0,0.05)",
  };
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useUrlParam("attr", "minors", intent?.attr);
  useEffect(() => { if (intent?.attr) { setSel(intent.attr); setQ(""); } }, [intent?.ts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bq, setBq] = useState("");
  const [sort, setSort] = useState({ by: "value", dir: "desc" });

  useEffect(() => {
    getAttributes().then((r) => setData(r.data)).catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  const attrs = data?.attributes || [];
  const listed = useMemo(() => {
    const s = q.trim().toLowerCase();
    return attrs.filter((a) => !s || `${a.label} ${a.group} ${a.used_in} ${a.definition} ${CAPACITY_DEFS[a.key] || ""}`.toLowerCase().includes(s));
  }, [attrs, q]);
  const a = attrs.find((x) => x.key === sel) || attrs[0];
  const pair = a ? pairFor(a.key) : null;
  const byKey = useMemo(() => Object.fromEntries(attrs.map((x) => [x.key, x])), [attrs]);
  const pPersons = pair ? byKey[pair.persons] : null, pHouseholds = pair ? byKey[pair.households] : null;
  // the extra column: the other side of the pair from what is selected
  const other = !pair ? null : (a.key === pair.households ? pPersons : pHouseholds);
  const otherLabel = !pair ? "" : (a.key === pair.households ? `${pair.short} (persons)` : `Households with ${pair.short}`);

  const rows = useMemo(() => {
    if (!a || !data) return [];
    const r = data.barangays.map((b) => ({ ...b, v: a.values[b.psgc_10d] || {} }))
      .filter((r) => !bq || r.barangay.toLowerCase().includes(bq.toLowerCase()));
    const key = (r) => sort.by === "name" ? r.barangay : sort.by === "pct" ? (r.v.pct ?? -1) : sort.by === "pctile" ? (r.v.percentile ?? -1)
      : sort.by === "other" ? Number(other?.values?.[r.psgc_10d]?.value ?? -1) : (numeric(a, r.v) ?? -1);
    return r.sort((x, y) => {
      const kx = key(x), ky = key(y);
      const c = typeof kx === "string" ? kx.localeCompare(ky, undefined, { numeric: true }) : kx - ky;
      return sort.dir === "asc" ? c : -c;
    });
  }, [a, data, bq, sort, other]);
  // Bars show a real proportion on a fixed scale (never "relative to the
  // largest barangay", which made the top row look like 100%):
  //   rate attributes        -> the rate itself, 0-100%
  //   sector counts          -> % of that barangay's residents / households
  //   population, households,
  //   equipment, pesos       -> the barangay's share of the municipal total
  //   distances              -> km on a 0-4 km scale, 2 km marked
  const munTotal = a ? (a.total != null ? Number(a.total)
    : Object.values(a.values || {}).reduce((t, v) => t + (Number(v?.value) || 0), 0)) : 0;
  const barMode = !a ? null : a.unit === "yesno" ? null : a.unit === "pct" ? "rate" : a.unit === "km" ? "km"
    : (a.base_label && a.key !== "population" && a.key !== "households") ? "ofBase" : munTotal > 0 ? "share" : null;
  const kmMax = barMode === "km" ? Math.max(4, Math.ceil(Math.max(0, ...rows.map((r) => numeric(a, r.v) ?? 0)) + 0.5)) : 4;
  const barPct = (r) => {
    const n = numeric(a, r.v);
    if (n == null) return null;
    if (barMode === "rate") return n;
    if (barMode === "ofBase") return r.v.pct;
    if (barMode === "share") return (n / munTotal) * 100;
    if (barMode === "km") return (n / kmMax) * 100;
    return null;
  };
  const barHead = { rate: "Rate (0–100%)", ofBase: a?.base_label ? `${a.base_label} (0–100%)` : "Share", share: "Share of municipal total (0–100%)", km: `Distance (0–${kmMax} km, line = 2 km)` }[barMode] || "";
  const hasPct = rows.some((r) => r.v.pct != null) && a?.key !== "population" && a?.key !== "households";
  const hasPctile = rows.some((r) => r.v.percentile != null);

  const exportCsv = () => {
    if (!a) return;
    const head = ["Barangay", a.label + (a.unit === "pct" ? " (%)" : ""), ...(other ? [otherLabel] : []), ...(hasPct ? ["Base", "% of base"] : []), ...(hasPctile ? ["Standing among 24 barangays (0-100)"] : [])];
    const lines = [head, ...rows.map((r) => [r.barangay, r.v.value ?? "", ...(other ? [other.values?.[r.psgc_10d]?.value ?? ""] : []), ...(hasPct ? [r.v.base ?? "", r.v.pct ?? ""] : []), ...(hasPctile ? [r.v.percentile ?? ""] : [])])];
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const el = document.createElement("a"); el.href = url; el.download = `attribute_${a.key}.csv`; el.click(); URL.revokeObjectURL(url);
  };

  const th = (label, by, align = "left") => (
    <th onClick={by ? () => setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" })) : undefined}
      style={{ textAlign: align, fontSize: 10.5, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
        padding: "9px 12px", borderBottom: `1px solid ${D.border}`, cursor: by ? "pointer" : "default", whiteSpace: "nowrap",
        position: "sticky", top: 0, background: D.cardBg }}>
      {label}{by && sort.by === by ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
  const td = { padding: "8px 12px", fontSize: 12.5, color: D.textBody, borderBottom: `1px solid ${D.border}` };
  const SORTS = [
    ["value:desc", a?.unit === "yesno" ? "Has it first" : "Highest value first"],
    ["value:asc", a?.unit === "yesno" ? "Does not have it first" : "Lowest value first"],
    ...(other ? [["other:desc", `Most ${otherLabel.charAt(0).toLowerCase() + otherLabel.slice(1)} first`]] : []),
    ...(hasPct ? [["pct:desc", `Highest ${(a?.base_label || "share").toLowerCase()} first`]] : []),
    ...(hasPctile ? [["pctile:desc", "Highest standing first"]] : []),
    ["name:asc", "Barangay name (A–Z)"],
  ];
  const sortValue = `${sort.by}:${sort.dir}`;
  const pairSummary = (() => {
    if (!pair || !pPersons || !pHouseholds) return null;
    const persons = Number(pPersons.total) || 0, hh = Number(pHouseholds.total) || 0, allHh = Number(byKey.households?.total) || 0;
    if (!persons || !hh) return null;
    return { persons, hh, allHh, perHh: persons / hh, pctHh: allHh ? (hh / allHh) * 100 : 0 };
  })();
  const isSvi = a?.group === "Social vulnerability (SVI)", isCap = a?.group === "Barangay capacity";
  const color = GROUP_COLOR[a?.group] || "#2563eb";
  const itemColor = attrColor(a?.key, color); // same colour as this item's slice in the pie

  return (
    <div style={{ padding: 16, background: D.pageBg, minHeight: "100%", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: D.textPrimary }}>Data Attributes</h2>
        <div style={{ fontSize: 12, color: D.textMuted, marginTop: 3 }}>
          What goes into each calculation, where it comes from, and how much of it each barangay has.
        </div>
      </div>
      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>Could not load attributes: {error}</div>}
      {!data && !error && <div style={{ color: D.textMuted, fontSize: 13 }}>Loading…</div>}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: 14, alignItems: "start" }}>
          {/* Catalogue */}
          <div style={{ background: D.cardBg, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: D.shadow, overflow: "hidden" }}>
            <div style={{ padding: 10, borderBottom: `1px solid ${D.border}` }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${attrs.length} attributes…`} aria-label="Search attributes"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, fontSize: 12.5,
                  border: `1px solid ${D.inputBorder}`, background: D.inputBg, color: D.textBody }} />
            </div>
            <div style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
              {data.groups.map((g) => {
                const items = listed.filter((x) => x.group === g);
                if (!items.length) return null;
                return (
                  <div key={g}>
                    <div style={{ padding: "10px 12px 4px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6,
                      color: GROUP_COLOR[g] || D.textMuted }}>{g}</div>
                    {items.map((x) => (
                      <button key={x.key} onClick={() => { setSel(x.key); setSort({ by: "value", dir: "desc" }); }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px 7px 14px", border: "none", cursor: "pointer",
                          borderLeft: `3px solid ${x.key === a?.key ? (GROUP_COLOR[g] || "#2563eb") : "transparent"}`,
                          background: x.key === a?.key ? D.active : "transparent", color: D.textBody, fontSize: 12.5 }}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                );
              })}
              {!listed.length && <div style={{ padding: 14, fontSize: 12, color: D.textMuted }}>No attribute matches “{q}”.</div>}
            </div>
          </div>

          {/* Detail */}
          {a && (
            <div style={{ background: D.cardBg, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: D.shadow, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${D.border}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: 0.6 }}>{a.group}</div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: D.textPrimary }}>{a.label}</div>
                  {a.total != null && a.unit === "count" && (
                    <div style={{ fontSize: 13, color: D.textMuted }}>
                      Municipality total <b style={{ fontSize: 20, color: D.textPrimary, fontVariantNumeric: "tabular-nums" }}>{a.total.toLocaleString()}</b>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 13, color: D.textBody, marginTop: 6, lineHeight: 1.5 }}>
                  {CAPACITY_DEFS[a.key] ? <>{CAPACITY_DEFS[a.key]} <span style={{ color: D.textMuted }}>Group: {String(a.definition || "").replace(/\.$/, "")}.</span></> : a.definition}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {[["Used in", a.used_in], ["Source", a.source], ["Measured as", UNIT_NOTE[a.unit] || a.unit]].map(([k, v]) => (
                    <span key={k} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 14, background: D.subBg, border: `1px solid ${D.border}`, color: D.textBody }}>
                      <span style={{ color: D.textMuted }}>{k}: </span>{v}
                    </span>
                  ))}
                </div>
                {pairSummary && (
                  <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8, background: itemColor + "12", border: `1px solid ${itemColor}40`,
                    fontSize: 12.5, color: D.textBody, lineHeight: 1.5 }}>
                    <b style={{ color: D.textPrimary }}>{pairSummary.persons.toLocaleString()} {pair.noun}</b> live in{" "}
                    <b style={{ color: D.textPrimary }}>{pairSummary.hh.toLocaleString()} households</b>
                    {" "}({pairSummary.pctHh.toFixed(1)}% of all {pairSummary.allHh.toLocaleString()} households),
                    an average of <b style={{ color: D.textPrimary }}>{pairSummary.perHh.toFixed(2)} {pair.short} per household</b> that has one.
                    <span style={{ color: D.textMuted }}> Both counts are listed per barangay in the table below.</span>
                  </div>
                )}
                <details style={{ marginTop: 10, fontSize: 12.5, color: D.textBody }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700, color: D.textPrimary, fontSize: 12.5 }}>How to read this page</summary>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                    <li><b>Circle charts</b> show parts of one whole that add up to 100%: for example male vs female residents, households with vs without a condition, or how many of the 24 barangays have an item. Hover a slice to see its number.</li>
                    {barMode && <li><b>Bars</b> show {barMode === "rate" ? "the rate itself on a 0–100% scale" : barMode === "ofBase" ? `the ${String(a.base_label).toLowerCase()} in each barangay on a 0–100% scale` : barMode === "share" ? "each barangay's share of the municipal total on a 0–100% scale" : `the distance in km on a 0–${kmMax} km scale; the line marks 2 km`}. A full bar would mean 100%, so bars can be compared across attributes.</li>}
                    {hasPctile && <li><b>Standing</b> places the barangay among the 24: 0 = lowest, 100 = highest. {isSvi ? "For SVI items a higher standing means more vulnerable." : isCap ? "For capacity items a higher standing means better equipped." : ""}</li>}
                    {other && <li><b>{otherLabel}</b> gives the other count for the same group, so you can see both people and households.</li>}
                    <li><b>Sort</b> with the menu above the table, or click a column title. <b>Export CSV</b> saves exactly what the table shows.</li>
                  </ul>
                </details>
              </div>

              <AttributeCharts attr={a} data={data} color={itemColor} D={D} />

              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 20px", borderBottom: `1px solid ${D.border}` }}>
                <input value={bq} onChange={(e) => setBq(e.target.value)} placeholder="Find a barangay…" aria-label="Find a barangay"
                  style={{ padding: "6px 10px", borderRadius: 7, fontSize: 12.5, border: `1px solid ${D.inputBorder}`, background: D.inputBg, color: D.textBody, width: 200 }} />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: D.textMuted }}>
                  Sort by
                  <select value={SORTS.some(([v]) => v === sortValue) ? sortValue : "value:desc"}
                    onChange={(e) => { const [by, dir] = e.target.value.split(":"); setSort({ by, dir }); }} aria-label="Sort barangays"
                    style={{ padding: "6px 8px", borderRadius: 7, fontSize: 12.5, border: `1px solid ${D.inputBorder}`, background: D.inputBg, color: D.textBody }}>
                    {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <button onClick={exportCsv} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${D.inputBorder}`, background: D.subBg, color: D.textPrimary }}>Export CSV</button>
              </div>

              <div style={{ maxHeight: "calc(100vh - 330px)", overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    {th("Barangay", "name")}
                    {th(a.unit === "pct" ? "Rate" : "Value", "value", "right")}
                    {other && th(otherLabel, "other", "right")}
                    {hasPct && th(a.base_label || "Share", "pct", "right")}
                    {hasPctile && th("Standing (0–100)", "pctile", "right")}
                    <th style={{ textAlign: "left", fontSize: 10.5, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
                      padding: "9px 12px", borderBottom: `1px solid ${D.border}`, position: "sticky", top: 0, background: D.cardBg, width: "34%", whiteSpace: "nowrap" }}>{barHead}</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const n = numeric(a, r.v);
                      return (
                        <tr key={r.psgc_10d}>
                          <td style={{ ...td, fontWeight: 600, color: D.textPrimary, whiteSpace: "nowrap" }}>{r.barangay}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtVal(a, r.v)}</td>
                          {other && <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtVal(other, other.values?.[r.psgc_10d])}</td>}
                          {hasPct && <td style={{ ...td, textAlign: "right", color: D.textMuted, fontVariantNumeric: "tabular-nums" }}>
                            {r.v.pct != null ? `${r.v.pct}%` : "—"}{r.v.base != null ? <span style={{ fontSize: 11 }}> of {r.v.base.toLocaleString()}</span> : null}
                          </td>}
                          {hasPctile && <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.v.percentile != null ? Number(r.v.percentile).toFixed(0) : "—"}</td>}
                          <td style={td}>
                            {barMode && barPct(r) != null ? (() => {
                              const bp = Math.max(0, Math.min(100, barPct(r)));
                              return (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={`${barHead}: ${barMode === "km" ? `${n.toFixed(2)} km` : `${barPct(r).toFixed(1)}%`}`}>
                                  <div style={{ position: "relative", flex: 1, height: 8, background: D.subBg, borderRadius: 4, overflow: "hidden", border: `1px solid ${D.border}` }}>
                                    <div style={{ width: `${bp}%`, minWidth: bp > 0 ? 2 : 0, height: "100%", background: itemColor, borderRadius: 4 }} />
                                    {barMode === "km" && <div style={{ position: "absolute", left: `${(2 / kmMax) * 100}%`, top: -1, bottom: -1, width: 2, background: D.textMuted }} />}
                                  </div>
                                  <span style={{ width: 50, textAlign: "right", fontSize: 11.5, fontWeight: 700, color: D.textPrimary, fontVariantNumeric: "tabular-nums" }}>
                                    {barMode === "km" ? `${n.toFixed(1)} km` : `${barPct(r).toFixed(1)}%`}
                                  </span>
                                </div>
                              );
                            })() : null}
                            {r.v.names?.length ? <div style={{ fontSize: 10.5, color: D.textMuted, marginTop: 3 }}>{r.v.names.join(", ")}</div> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "10px 20px", fontSize: 11, color: D.textMuted, borderTop: `1px solid ${D.border}` }}>
                Counts are live from the household and member records. Standing compares each barangay with the other 23
                (0 = lowest, 100 = highest).
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
