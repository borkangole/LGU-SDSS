import { useEffect, useState, memo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { getDomainBarangays } from '../../api/api';
import { useCounter } from "../../hooks/useCounter";
import { DashCard, DashCardHead } from "./dashShared";
import { SVI_TIER_COLORS } from "../shared/domainColors";

const TIER_COLORS = SVI_TIER_COLORS;
const TIER_RANKS = { "High": "rank 1–6", "Moderate-high": "rank 7–12", "Moderate-low": "rank 13–18", "Low": "rank 19–24" };
// Quartile bucket by rank position (24 barangays / 4 = 6 each). Tier labels
// per the panel's redesign spec: qcut(score,4) -> Low / Moderate-low /
// Moderate-high / High, same convention as the Map View and Household modal.
function sviCategory(rank) {
  if (rank <= 6) return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}

function CustomTooltip({ active, payload, total, D }) {
  if (!active || !payload?.length) return null;
  const { name, value, color, barangays } = payload[0]?.payload || {};
  if (!name) return null;
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  return (
    <div style={{
      background: D.tooltipBg,
      border: `1px solid ${D.tooltipBorder}`,
      borderRadius: 10, padding: "10px 14px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
      minWidth: 180, maxWidth: 260,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: D.textPrimary }}>{name}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>
        {value.toLocaleString()} HH
      </div>
      <div style={{ fontSize: 12, color: D.textMuted, marginTop: 4 }}>
        {pct}% of total households
      </div>
      {barangays?.length > 0 && (
        <div style={{ fontSize: 10.5, color: D.textMuted, marginTop: 6, lineHeight: 1.5 }}>
          {barangays.join(", ")}
        </div>
      )}
    </div>
  );
}

// Replaces the old household-level BVI-category donut (single-BVI model).
// The Official SVI model only computes at barangay level (n=24), so this
// is a household-weighted view: each barangay's real household count is
// bucketed into its SVI quartile category — not an individual per-household
// classification, since the domain model doesn't produce one.
const HouseholdRiskDistributionComp = memo(function HouseholdRiskDistribution({ dark, D }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const animatedTotal = useCounter(data?.total ?? 0, 1400);

  useEffect(() => {
    getDomainBarangays()
      .then(r => {
        const rows = r.data?.data || [];
        const buckets = { "High": { count: 0, brgys: [] }, "Moderate-high": { count: 0, brgys: [] },
          "Moderate-low": { count: 0, brgys: [] }, "Low": { count: 0, brgys: [] } };
        let total = 0;
        rows.forEach(b => {
          const cat = sviCategory(b.svi_rank);
          const hh = parseInt(b.households) || 0;
          buckets[cat].count += hh;
          buckets[cat].brgys.push(b.barangay);
          total += hh;
        });
        const mapped = Object.entries(buckets)
          .filter(([, v]) => v.count > 0)
          .map(([tier, v]) => ({
            name: tier, value: v.count, color: TIER_COLORS[tier] || "#aaaaaa", barangays: v.brgys,
          }));
        setData({ items: mapped, total });
        setLoading(false);
      })
      .catch(err => {
        setError(err.response?.data?.detail || err.response?.data?.error || err.message);
        setLoading(false);
      });
  }, []);

  const msg = (text, color) => (
    <DashCard D={D} style={{ alignItems:"center", justifyContent:"center", minHeight:300, fontSize:13, color }}>{text}</DashCard>
  );
  if (loading) return msg("Loading household distribution…", D.textMuted);
  if (error) return msg(`Failed to load: ${error}`, "#dc2626");
  if (!data) return null;

  return (
    <DashCard D={D}>
      <DashCardHead D={D} accent="linear-gradient(180deg,#dc2626,#f59e0b,#16a34a)" title="Households by SVI tier" sub="Each household counted under its barangay's SVI tier" />

      <div style={{ flex:1, minHeight:210, position:"relative", margin:"0 20px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.items} cx="50%" cy="50%" innerRadius="64%" outerRadius="86%"
              paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}
              isAnimationActive animationBegin={0} animationDuration={700} cornerRadius={3}>
              {data.items.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke={D.cardBg} strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip content={(props) => <CustomTooltip {...props} total={data.total} D={D} />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%, -50%)",
          textAlign:"center", pointerEvents:"none" }}>
          <div style={{ fontSize:28, fontWeight:800, color:D.textPrimary, lineHeight:1, letterSpacing:-0.5,
            fontVariantNumeric:"tabular-nums" }}>
            {animatedTotal.toLocaleString()}
          </div>
          <div style={{ fontSize:11, color:D.textMuted, marginTop:5 }}>households</div>
        </div>
      </div>

      <div style={{ padding:"12px 20px 18px" }}>
        {data.items.map((item, i) => {
          const pct = data.total ? (item.value / data.total) * 100 : 0;
          return (
            <div key={item.name} title={item.barangays.join(", ")}
              style={{ display:"grid", gridTemplateColumns:"10px 1fr auto 52px", alignItems:"center", gap:10,
                padding:"9px 0", borderTop: i ? `1px solid ${D.divider}` : `1px solid ${D.divider}` }}>
              <span style={{ width:10, height:10, borderRadius:"50%", background:item.color, boxShadow:`0 0 0 3px color-mix(in srgb, ${item.color} 18%, transparent)` }} />
              <span style={{ fontSize:13, color:D.textBody, fontWeight:500 }}>
                {item.name}
                <span style={{ fontSize:11, color:D.textMuted, fontWeight:400, marginLeft:6 }}>{TIER_RANKS[item.name]}</span>
              </span>
              <span style={{ fontSize:12, color:D.textMuted, fontVariantNumeric:"tabular-nums" }}>
                {item.value.toLocaleString()} HH
              </span>
              <span style={{ fontSize:14, fontWeight:800, color:item.color, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
        <div style={{ fontSize:11, color:D.textMuted, marginTop:8, lineHeight:1.5 }}>
          Tiers are quartiles of the 24 barangays by SVI rank (rank 1 = most vulnerable). Hover a row to see its barangays.
        </div>
      </div>
    </DashCard>
  );
})

export default HouseholdRiskDistributionComp;
