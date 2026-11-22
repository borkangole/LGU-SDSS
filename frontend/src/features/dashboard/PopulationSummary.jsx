// Population profile -- who lives in the municipality (or one barangay).
// Three panels read left to right: the headline (people, households, sex,
// life stage), an age-and-sex pyramid, and the sectors planners act on.
// Context for planning, not a score.
import { useMemo, useState } from "react";

const MALE = "#2563eb", FEMALE = "#db2777";
const STAGES = [
  { key: "minors", label: "Children", range: "0–17", color: "#0ea5e9" },
  { key: "age_18_59", label: "Working age", range: "18–59", color: "#6366f1" },
  { key: "age_60_plus", label: "Seniors", range: "60+", color: "#f59e0b" },
];
const SECTORS = [
  { key: "age_60_plus",       label: "Senior citizens",         note: "60 and older",    color: "#f59e0b", of: "population" },
  { key: "minors",            label: "Minors",                  note: "under 18",        color: "#0ea5e9", of: "population" },
  { key: "pwd",               label: "Persons with disability", note: "",                color: "#8b5cf6", of: "population" },
  { key: "solo_parents",      label: "Solo parents",            note: "",                color: "#ec4899", of: "population" },
  { key: "fourps_members",    label: "4Ps members",             note: "",                color: "#16a34a", of: "population" },
  { key: "fourps_households", label: "4Ps households",          note: "",                color: "#15803d", of: "households" },
];
const pct = (n, d) => (d ? (n / d) * 100 : 0);
const fmt = (n) => (n ?? 0).toLocaleString();

export default function PopulationSummary({ data, D, dark, onOpenAttributes }) {
  const [brgy, setBrgy] = useState("");
  const row = useMemo(() => {
    if (!data) return null;
    return (brgy && data.data.find((r) => r.psgc_10d === brgy)) || data.total;
  }, [data, brgy]);
  const name = brgy ? data?.data.find((r) => r.psgc_10d === brgy)?.barangay : "All 24 barangays";

  const line = D.border;
  const card = { background: D.cardBg, borderRadius: 12, boxShadow: D.shadow, border: `1px solid ${line}`, overflow: "hidden" };
  const eyebrow = { fontSize: 11, fontWeight: 600, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.7 };
  const num = { fontVariantNumeric: "tabular-nums" };

  if (!row) return <div style={{ ...card, padding: 22, fontSize: 12, color: D.textMuted }}>Loading population profile…</div>;

  const pop = row.population || 0;
  const working = row.age_18_59 || 0;
  const dependents = (row.minors || 0) + (row.age_60_plus || 0);
  const bands = data.bands || [];
  const pyr = row.pyramid || { m: [], f: [] };
  const maxBand = Math.max(1, ...pyr.m, ...pyr.f);
  const maxSector = Math.max(1, ...SECTORS.map((s) => pct(row[s.key] || 0, s.of === "households" ? row.households : pop)));

  return (
    <div className="pop-card" style={card}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "16px 20px", borderBottom: `1px solid ${line}` }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ width: 3, height: 34, borderRadius: 2, background: `linear-gradient(180deg, ${MALE}, ${FEMALE})` }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: D.textPrimary, letterSpacing: -0.1 }}>Population profile</div>
            <div style={{ fontSize: 12, color: D.textMuted, marginTop: 2 }}>{name} · CBMS 2024</div>
          </div>
        </div>
        <select value={brgy} onChange={(e) => setBrgy(e.target.value)} aria-label="Barangay"
          style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12.5, border: `1px solid ${D.inputBorder}`,
            background: D.inputBg, color: D.textBody, minWidth: 200, cursor: "pointer" }}>
          <option value="">All barangays</option>
          {[...data.data].sort((a, b) => a.barangay.localeCompare(b.barangay, undefined, { numeric: true }))
            .map((r) => <option key={r.psgc_10d} value={r.psgc_10d}>{r.barangay}</option>)}
        </select>
      </div>

      <div className="pop-grid" style={{ display: "grid", gridTemplateColumns: "minmax(250px,1fr) minmax(320px,1.3fr) minmax(250px,1fr)" }}>
        {/* ── A. At a glance ── */}
        <div style={{ padding: "18px 20px", borderRight: `1px solid ${line}`, display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={eyebrow}>Residents</div>
            <div style={{ fontSize: 38, fontWeight: 800, color: D.textPrimary, lineHeight: 1.05, letterSpacing: -0.6, ...num }}>{fmt(pop)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", marginTop: 12, border: `1px solid ${line}`, borderRadius: 9, overflow: "hidden" }}>
              {[["Households", fmt(row.households)], ["Per household", row.households ? (pop / row.households).toFixed(1) : "—"],
                ["Median age", row.median_age != null ? Math.round(row.median_age) : "—"]].map(([l, v], i) => (
                <div key={l} style={{ padding: "8px 10px", borderLeft: i ? `1px solid ${line}` : "none", background: D.subBg }}>
                  <div style={{ fontSize: 15, fontWeight: 650, color: D.textPrimary, ...num }}>{v}</div>
                  <div style={{ fontSize: 10.5, color: D.textMuted }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ ...eyebrow, marginBottom: 8 }}>Sex</div>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 }}>
              <div style={{ width: `${pct(row.male, pop)}%`, background: MALE, transition: "width .5s ease" }} />
              <div style={{ flex: 1, background: pop ? FEMALE : D.border }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 12, color: D.textBody }}>
              <span><span style={{ color: MALE, fontWeight: 800 }}>{pct(row.male, pop).toFixed(1)}%</span> Male · <span style={num}>{fmt(row.male)}</span></span>
              <span><span style={num}>{fmt(row.female)}</span> · Female <span style={{ color: FEMALE, fontWeight: 800 }}>{pct(row.female, pop).toFixed(1)}%</span></span>
            </div>
          </div>

          <div>
            <div style={{ ...eyebrow, marginBottom: 8 }}>Life stage</div>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 }}>
              {STAGES.map((s) => <div key={s.key} title={`${s.label} ${fmt(row[s.key])}`}
                style={{ width: `${pct(row[s.key] || 0, pop)}%`, background: s.color, transition: "width .5s ease" }} />)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8 }}>
              {STAGES.map((s) => (
                <div key={s.key}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: s.color, ...num }}>{pct(row[s.key] || 0, pop).toFixed(0)}%</div>
                  <div style={{ fontSize: 11, color: D.textBody }}>{s.label}</div>
                  <div style={{ fontSize: 10.5, color: D.textMuted }}>{s.range} · {fmt(row[s.key])}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 9,
            background: D.subBg, border: `1px solid ${line}` }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: D.textPrimary, lineHeight: 1, ...num }}>
              {working ? Math.round((dependents / working) * 100) : "—"}
            </div>
            <div style={{ fontSize: 11, color: D.textMuted, lineHeight: 1.4 }}>
              children and seniors for every <b style={{ color: D.textBody }}>100 working-age</b> residents (dependency ratio)
            </div>
          </div>
        </div>

        {/* ── B. Age and sex pyramid ── */}
        <div style={{ padding: "18px 20px", borderRight: `1px solid ${line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <div style={eyebrow}>Age and sex</div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: D.textBody }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: MALE, marginRight: 5 }} />Male</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: FEMALE, marginRight: 5 }} />Female</span>
            </div>
          </div>
          <div role="img" aria-label="Population pyramid by five-year age group and sex">
            {bands.map((_, i) => bands.length - 1 - i).map((i) => {
              const m = pyr.m[i] || 0, f = pyr.f[i] || 0;
              return (
                <div key={i} title={`${bands[i]}: ${fmt(m)} male, ${fmt(f)} female`}
                  style={{ display: "grid", gridTemplateColumns: "1fr 46px 1fr", alignItems: "center", height: 20, marginBottom: 2 }}>
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 5, height: "100%" }}>
                    <span style={{ fontSize: 10, color: D.textMuted, ...num }}>{m ? fmt(m) : ""}</span>
                    <div style={{ width: `${(m / maxBand) * 78}%`, height: 14, background: MALE, borderRadius: "3px 0 0 3px", opacity: 0.9, transition: "width .5s ease" }} />
                  </div>
                  <div style={{ textAlign: "center", fontSize: 10.5, color: D.textBody, fontWeight: 600, ...num }}>{bands[i]}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, height: "100%" }}>
                    <div style={{ width: `${(f / maxBand) * 78}%`, height: 14, background: FEMALE, borderRadius: "0 3px 3px 0", opacity: 0.9, transition: "width .5s ease" }} />
                    <span style={{ fontSize: 10, color: D.textMuted, ...num }}>{f ? fmt(f) : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── C. Sectors to plan for ── */}
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column" }}>
          <div style={{ ...eyebrow, marginBottom: 6 }}>Sectors to plan for</div>
          <div style={{ flex: 1 }}>
            {SECTORS.map((s, i) => {
              const n = row[s.key] || 0;
              const base = s.of === "households" ? row.households : pop;
              const share = pct(n, base);
              return (
                <div key={s.key} style={{ padding: "9px 0", borderTop: i ? `1px solid ${line}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0, transform: "translateY(-1px)" }} />
                    <span style={{ fontSize: 12.5, color: D.textBody, flex: 1 }}>
                      {s.label}{s.note && <span style={{ color: D.textMuted }}> · {s.note}</span>}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 650, color: D.textPrimary, ...num }}>{fmt(n)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, paddingLeft: 16 }}>
                    <div style={{ flex: 1, height: 4, background: D.subBg, borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${(share / maxSector) * 100}%`, height: "100%", background: s.color, borderRadius: 2, transition: "width .5s ease" }} />
                    </div>
                    <span style={{ fontSize: 10.5, color: D.textMuted, minWidth: 92, textAlign: "right", ...num }}>{share.toFixed(1)}% of {s.of}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {onOpenAttributes && (
            <button onClick={onOpenAttributes} style={{ marginTop: 10, alignSelf: "flex-start", background: "none", border: "none", padding: 0,
              color: D.accent || (dark ? "#93c5fd" : "#1d4ed8"), fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              Every attribute, per barangay →
            </button>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 1200px){ .pop-grid{ grid-template-columns: 1fr !important; } .pop-grid > div{ border-right: none !important; border-bottom: 1px solid ${line}; } }`}</style>
    </div>
  );
}
