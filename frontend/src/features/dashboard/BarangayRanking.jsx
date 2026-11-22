// Initial barangay ranking -- one row per barangay, ranked by SVI by
// default (the starting point for planning), with each domain in its own
// column. Nothing here is added together; "Rank by" just changes the order.
import { useMemo, useState } from "react";
import { capacityColorByRank, capacityTierFromRank } from "../capacity/capacityShared";
import { DashCard, DashCardHead, Segmented } from "./dashShared";
import { SVI_TIER_COLORS } from "../shared/domainColors";

const SVI_TIER = (r) => (r == null ? "—" : r <= 6 ? "High" : r <= 12 ? "Moderate-high" : r <= 18 ? "Moderate-low" : "Low");
const SVI_COLOR = { ...SVI_TIER_COLORS, "—": "#94a3b8" };
const norm = (s) => String(s || "").toLowerCase();

const SORTS = [
  { id: "svi", label: "SVI", hint: "Most vulnerable first" },
  { id: "cap", label: "Capacity", hint: "Least equipped first" },
  { id: "flood", label: "Flood", hint: "Highest share in High/Very High flood zones first" },
  { id: "slide", label: "Landslide", hint: "Highest share in Moderate/High landslide zones first" },
];

function Pill({ color, children }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap",
      color, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}>{children}</span>
  );
}

export default function BarangayRanking({ domainStats, capacity, population, D, dark, onSelect }) {
  const [sort, setSort] = useState("svi");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const capBy = Object.fromEntries((capacity || []).map((c) => [c.psgc_10d, c]));
    const popBy = Object.fromEntries((population || []).map((p) => [p.psgc_10d, p]));
    return (domainStats || []).map((b) => {
      const id = String(b.psgc_10d).padStart(10, "0");
      const c = capBy[id] || {};
      return {
        id, name: b.barangay, svi_rank: b.svi_rank, svi_score: b.svi_score,
        cap_rank: c.capacity_rank ?? null, cap_score: c.capacity_score ?? null,
        flood: b.hazard?.flood_high_or_very_high_pct_total ?? 0,
        slide: b.hazard?.landslide_moderate_or_high_pct_total ?? 0,
        households: b.households, population: popBy[id]?.population ?? null,
      };
    });
  }, [domainStats, capacity, population]);

  const shown = useMemo(() => {
    const by = {
      svi: (a, b) => (a.svi_rank ?? 99) - (b.svi_rank ?? 99),
      cap: (a, b) => (b.cap_rank ?? -1) - (a.cap_rank ?? -1),
      flood: (a, b) => b.flood - a.flood,
      slide: (a, b) => b.slide - a.slide,
    }[sort];
    return rows.filter((r) => !q || norm(r.name).includes(norm(q))).sort(by);
  }, [rows, sort, q]);

  const th = { textAlign: "left", fontSize: 11, fontWeight: 600, color: D.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
    padding: "9px 12px", borderBottom: `1px solid ${D.border}`, borderTop: `1px solid ${D.border}`, position: "sticky", top: 0,
    background: D.subBg, zIndex: 1, whiteSpace: "nowrap" };
  const td = { padding: "9px 12px", fontSize: 12.5, color: D.textBody, borderBottom: `1px solid ${D.divider || D.border}` };

  return (
    <DashCard D={D} style={{ overflow: "hidden" }}>
      <DashCardHead D={D} accent="linear-gradient(180deg,#dc2626,#16a34a)" title="Barangay ranking" sub={`${SORTS.find((s) => s.id === sort).hint} · each domain in its own column`}
        right={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a barangay…" aria-label="Find a barangay"
          style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12.5, border: `1px solid ${D.inputBorder}`,
            background: D.inputBg, color: D.textBody, width: 180 }} />} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "0 20px 14px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: D.textMuted }}>Rank by</span>
        <Segmented D={D} dark={dark} value={sort} onChange={setSort}
          options={SORTS.map((x) => ({ id: x.id, label: x.label, hint: x.hint }))} />
      </div>
      <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 34, paddingLeft: 20 }}>#</th>
              <th style={th}>Barangay</th>
              <th style={th}>Social vulnerability</th>
              <th style={th}>Capacity</th>
              <th style={{ ...th, textAlign: "right" }}>Flood</th>
              <th style={{ ...th, textAlign: "right" }}>Landslide</th>
              <th style={{ ...th, textAlign: "right", paddingRight: 20 }}>People</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const t = SVI_TIER(r.svi_rank);
              return (
                <tr key={r.id} onClick={onSelect ? () => onSelect(r) : undefined}
                  style={{ cursor: onSelect ? "pointer" : "default" }}>
                  <td style={{ ...td, color: D.textMuted, fontWeight: 500, fontVariantNumeric: "tabular-nums", paddingLeft: 20 }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 600, color: D.textPrimary, whiteSpace: "nowrap" }}>{r.name}</td>
                  <td style={td}>
                    <Pill color={SVI_COLOR[t]}>{t}</Pill>
                    <span style={{ fontSize: 11, color: D.textMuted, marginLeft: 6 }}>#{r.svi_rank ?? "—"} · {r.svi_score != null ? Number(r.svi_score).toFixed(0) : "—"}</span>
                  </td>
                  <td style={td}>
                    {r.cap_rank != null ? <Pill color={capacityColorByRank(r.cap_rank)}>{capacityTierFromRank(r.cap_rank)}</Pill> : "—"}
                    <span style={{ fontSize: 11, color: D.textMuted, marginLeft: 6 }}>#{r.cap_rank ?? "—"}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: r.flood >= 25 ? 650 : 400, color: r.flood >= 25 ? "#dc2626" : D.textBody, fontVariantNumeric: "tabular-nums" }}>{Number(r.flood).toFixed(1)}%</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: r.slide >= 25 ? 650 : 400, color: r.slide >= 25 ? "#dc2626" : D.textBody, fontVariantNumeric: "tabular-nums" }}>{Number(r.slide).toFixed(1)}%</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", paddingRight: 20 }}>{r.population != null ? r.population.toLocaleString() : "—"}</td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: D.textMuted }}>No barangay matches “{q}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "12px 20px 16px", fontSize: 11, color: D.textMuted, lineHeight: 1.55, borderTop: `1px solid ${D.border}` }}>
        SVI rank 1 = most socially vulnerable · Capacity rank 1 = best equipped · Flood = % of households in High/Very High zones,
        Landslide = Moderate/High (red at 25% or more) · The three domains are never added into one score.
      </div>
    </DashCard>
  );
}
