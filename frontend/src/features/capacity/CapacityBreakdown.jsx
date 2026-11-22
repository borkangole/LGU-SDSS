// Barangay Capacity breakdown: the scored resources (value + percentile,
// grouped by dimension) and, separately, the items that are listed but not
// scored (DRRM plan, evacuation map, hazard map, evacuation centres, schools).
import { memo } from "react";
import { capacityColorByRank, capacityTierFromRank, formatCapacityValue } from "./capacityShared";

const CapacityBreakdown = memo(function CapacityBreakdown({ row, dark, compact = false }) {
  if (!row) return null;
  const t = {
    text: dark ? "#e2e8f0" : "#0f172a",
    sub: dark ? "#94a3b8" : "#64748b",
    line: dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
    soft: dark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.03)",
  };
  const accent = capacityColorByRank(row.capacity_rank);
  const scored = (row.indicators || []).filter((i) => i.included);
  const unused = (row.indicators || []).filter((i) => !i.included);
  const groups = [];
  scored.forEach((i) => {
    let g = groups.find((x) => x.name === i.dimension);
    if (!g) { g = { name: i.dimension, items: [] }; groups.push(g); }
    g.items.push(i);
  });
  const avg = scored.length ? scored.reduce((s, i) => s + (i.percentile || 0), 0) / scored.length : null;
  const section = (title) => (
    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: t.sub, margin: "14px 0 6px" }}>{title}</div>
  );
  const pill = (ok) => (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
      background: ok == null ? t.soft : ok ? "rgba(22,163,74,0.14)" : "rgba(220,38,38,0.12)",
      color: ok == null ? t.sub : ok ? "#16a34a" : "#dc2626",
    }}>{ok == null ? "No data" : ok ? "Has" : "None"}</span>
  );

  return (
    <div style={{ color: t.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: compact ? 22 : 26, fontWeight: 800, color: accent, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {row.capacity_score?.toFixed(1)}<span style={{ fontSize: 13, color: t.sub, fontWeight: 600 }}> / 100</span>
        </div>
        <div style={{ fontSize: 12, color: t.sub, lineHeight: 1.5 }}>
          Rank <strong style={{ color: t.text }}>#{row.capacity_rank}</strong> of 24 · <strong style={{ color: accent }}>{capacityTierFromRank(row.capacity_rank)}</strong>
          <div>Rank 1 = best equipped barangay</div>
        </div>
      </div>

      {section("Resources and organisation (scored)")}
      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: t.text, margin: "6px 0 2px" }}>{g.name}</div>
          {g.items.map((i) => (
            <div key={i.key} style={{ display: "grid", gridTemplateColumns: "1fr auto 64px", gap: 10, alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${t.line}` }}>
              <span style={{ fontSize: 12 }}>{i.label}</span>
              <span style={{ fontSize: 12, color: t.sub, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{formatCapacityValue(i)}</span>
              <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i.percentile != null ? `${i.percentile.toFixed(0)} / 100` : "—"}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 6, padding: "9px 11px", borderRadius: 8, background: t.soft, fontSize: 11, color: t.sub, lineHeight: 1.6 }}>
        Each item is compared across the 24 barangays (0 = least, 100 = most). Capacity score = average of the {scored.length} items
        {avg != null && <> = <strong style={{ color: t.text }}>{avg.toFixed(1)}</strong></>}.
        {unused.length > 0 && <> Not used because every barangay has the same value: {unused.map((u) => u.label).join(", ")}.</>}
      </div>

      {section("Facilities and readiness on record")}
      {(row.readiness || []).map((r) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${t.line}` }}>
          <span style={{ fontSize: 12 }}>{r.label}</span>{pill(r.has)}
        </div>
      ))}
      <div style={{ padding: "7px 0", borderBottom: `1px solid ${t.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12 }}>Evacuation centres</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{(row.evacuation_centers || []).length}</span>
        </div>
        {(row.evacuation_centers || []).map((e) => <div key={e.name} style={{ fontSize: 11, color: t.sub }}>{e.name}</div>)}
      </div>
      <div style={{ padding: "7px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12 }}>Schools</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{(row.schools || []).length}</span>
        </div>
        {(row.schools || []).map((s) => <div key={s.name} style={{ fontSize: 11, color: t.sub }}>{s.name}{s.level ? ` · ${s.level}` : ""}</div>)}
      </div>
      <div style={{ fontSize: 10.5, color: t.sub, lineHeight: 1.5, marginTop: 4 }}>
        Evacuation centres and schools are counted from the facilities mapped in the system.
      </div>
    </div>
  );
});

export default CapacityBreakdown;
