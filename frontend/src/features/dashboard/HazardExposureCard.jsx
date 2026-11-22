import { useEffect, useState, useRef, useLayoutEffect, memo } from "react";
import { getDomainBarangays } from '../../api/api';

const toNum = (v) => parseFloat(v) || 0;

// Own card, own fetch -- same pattern as VulnerabilityBreakdown and
// HouseholdRiskDistribution (each Dashboard widget independently reads
// getDomainBarangays rather than sharing one lifted fetch). Split out from
// VulnerabilityBreakdown so it can sit in its own grid cell (paired with
// the barangay rankings list) instead of being stacked directly under the
// SVI vs. Capacity chart.
const HazardExposureCardComp = memo(function HazardExposureCard({ dark, D, onHeightChange }) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    getDomainBarangays()
      .then(r => { setData(r.data?.data || []); setLoading(false); })
      .catch(e => { setError(e.response?.data?.detail || e.response?.data?.error || e.message); setLoading(false); });
  }, []);

  // Reports this card's own real, rendered height to Dashboard.jsx after
  // EVERY render (no dependency array) so the Rankings card next to it can
  // match it. useLayoutEffect runs synchronously right after the DOM
  // updates, before the browser paints -- so it measures the loading
  // placeholder's height first, then re-measures and reports the real,
  // final content height the instant the data fetch resolves and this card
  // re-renders with its actual content, rather than a stale earlier value.
  useLayoutEffect(() => {
    if (rootRef.current && onHeightChange) {
      onHeightChange(rootRef.current.getBoundingClientRect().height);
    }
  });

  // Real hazard-exposure aggregates (spatial join, from hazard_exposure_by_barangay.csv
  // via getDomainBarangays' own "hazard" object). Flood and Landslide are two
  // independent household counts, not summed into one figure: a household can
  // sit in both a flood AND a landslide zone, so adding them would double-count.
  // "Dual-hazard" barangays are the real cross-tab of the two -- both
  // proportions present in the same barangay, not a fabricated combined score.
  let floodHH = 0, landslideHH = 0, floodBrgys = 0, landslideBrgys = 0;
  const dualHazardBrgys = [];
  data.forEach(b => {
    const fHH = toNum(b.hazard?.flood_high_or_very_high_households);
    const lHH = toNum(b.hazard?.landslide_moderate_or_high_households);
    floodHH += fHH;
    landslideHH += lHH;
    if (fHH > 0) floodBrgys += 1;
    if (lHH > 0) landslideBrgys += 1;
    if (fHH > 0 && lHH > 0) dualHazardBrgys.push({
      name: b.barangay,
      flood_pct: toNum(b.hazard?.flood_high_or_very_high_pct_total),
      landslide_pct: toNum(b.hazard?.landslide_moderate_or_high_pct_total),
    });
  });
  dualHazardBrgys.sort((a, b) => (b.flood_pct + b.landslide_pct) - (a.flood_pct + a.landslide_pct));
  const totalHouseholds = data.reduce((s,b) => s + (parseInt(b.households) || 0), 0);

  // Barangay-level ranking for the chart below -- every barangay carrying
  // any real flood or landslide exposure, sorted by combined proportion
  // (display only; Flood and Landslide stay separate bars, never summed
  // into a score). svi_rank is carried through so the tooltip can show
  // whether an exposed barangay is ALSO a high-SVI one.
  const hazardRanked = data
    .map(b => ({
      barangay: b.barangay,
      svi_rank: b.svi_rank,
      flood_pct: toNum(b.hazard?.flood_high_or_very_high_pct_total),
      landslide_pct: toNum(b.hazard?.landslide_moderate_or_high_pct_total),
    }))
    .filter(b => b.flood_pct > 0 || b.landslide_pct > 0)
    .sort((a, b) => (b.flood_pct + b.landslide_pct) - (a.flood_pct + a.landslide_pct))
    .slice(0, 10);

  // The real cross-tab this card exists to answer: of the barangays already
  // flagged High/Moderate-high SVI (rank<=12, same band VulnerabilityBreakdown
  // uses for Compound Priority), how many are ALSO sitting in a real flood or
  // landslide zone -- vulnerability the model ranks AND a mapped hazard
  // confirms, not vulnerability alone.
  const highSvi = data.filter(b => b.svi_rank <= 12);
  const highSviAndExposed = highSvi.filter(b =>
    toNum(b.hazard?.flood_high_or_very_high_pct_total) > 0 ||
    toNum(b.hazard?.landslide_moderate_or_high_pct_total) > 0
  ).length;

  // No explicit height and no scroll here on purpose: this card is meant to
  // show its real, natural content height, never a scrollbar. It reports
  // that height up to Dashboard.jsx (onHeightChange, above), which sizes
  // the "All Barangay Rankings" card next to it to match -- this card
  // drives the row, not the other way around.
  const cardStyle = {
    background: D.cardBg, borderRadius: 12, padding: "20px 22px",
    boxShadow: D.shadow, border: `1px solid ${D.border}`,
    transition: "background 0.25s ease",
    display: "flex", flexDirection: "column",
  };

  if (loading) return (
    <div ref={rootRef} style={{ ...cardStyle, alignItems:"center",
      justifyContent:"center", minHeight:300, color:D.textMuted, fontSize:13 }}>
      Loading hazard exposure...
    </div>
  );
  if (error) return (
    <div ref={rootRef} style={{ ...cardStyle, alignItems:"center",
      justifyContent:"center", minHeight:300, color:"#d32f2f", fontSize:13 }}>
      Failed to load: {error}
    </div>
  );

  return (
    <div ref={rootRef} style={cardStyle}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <div style={{ width:3, height:16, borderRadius:2,
          background:"linear-gradient(180deg,#0288d1,#8d6e63)", flexShrink:0 }} />
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:D.textPrimary }}>
            Real Hazard Exposure
          </div>
          <div style={{ fontSize:12, color:D.textMuted, marginTop:2 }}>
            Households inside mapped flood and landslide zones
          </div>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8 }}>
        <div style={{
          padding:"10px 12px", borderRadius:8,
          background: "#c62828"+(dark?"15":"0d"),
          border:`1px solid #c62828${dark?"33":"22"}`,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#c62828", flexShrink:0 }} />
            <span style={{ fontSize:10, fontWeight:700, color:"#c62828", textTransform:"uppercase", letterSpacing:0.5 }}>High-Risk & Exposed</span>
          </div>
          <div style={{ fontSize:19, fontWeight:800, color:"#c62828", lineHeight:1 }}>
            {highSviAndExposed} / {highSvi.length}
          </div>
          <div style={{ fontSize:10.5, color:D.textMuted, marginTop:4, lineHeight:1.4 }}>
            High-SVI barangays with a hazard zone
          </div>
        </div>
        <div style={{
          padding:"10px 12px", borderRadius:8,
          background: "#0288d1"+(dark?"15":"0d"),
          border:`1px solid #0288d1${dark?"33":"22"}`,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#0288d1", flexShrink:0 }} />
            <span style={{ fontSize:10, fontWeight:700, color:"#0288d1", textTransform:"uppercase", letterSpacing:0.5 }}>Flood</span>
          </div>
          <div style={{ fontSize:19, fontWeight:800, color:"#0288d1", lineHeight:1 }}>
            {floodHH.toLocaleString()} HH
          </div>
          <div style={{ fontSize:10.5, color:D.textMuted, marginTop:4, lineHeight:1.4 }}>
            {totalHouseholds > 0 ? ((floodHH / totalHouseholds) * 100).toFixed(1) : "0.0"}% in High/Very High zones · {floodBrgys} brgy
          </div>
        </div>
        <div style={{
          padding:"10px 12px", borderRadius:8,
          background: "#8d6e63"+(dark?"15":"0d"),
          border:`1px solid #8d6e63${dark?"33":"22"}`,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#8d6e63", flexShrink:0 }} />
            <span style={{ fontSize:10, fontWeight:700, color:"#8d6e63", textTransform:"uppercase", letterSpacing:0.5 }}>Landslide</span>
          </div>
          <div style={{ fontSize:19, fontWeight:800, color:"#8d6e63", lineHeight:1 }}>
            {landslideHH.toLocaleString()} HH
          </div>
          <div style={{ fontSize:10.5, color:D.textMuted, marginTop:4, lineHeight:1.4 }}>
            {totalHouseholds > 0 ? ((landslideHH / totalHouseholds) * 100).toFixed(1) : "0.0"}% in Moderate/High zones · {landslideBrgys} brgy
          </div>
        </div>
        <div style={{
          padding:"10px 12px", borderRadius:8,
          background: "#6a1b9a"+(dark?"15":"0d"),
          border:`1px solid #6a1b9a${dark?"33":"22"}`,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#6a1b9a", flexShrink:0 }} />
            <span style={{ fontSize:10, fontWeight:700, color:"#6a1b9a", textTransform:"uppercase", letterSpacing:0.5 }}>Dual-Hazard Brgy</span>
          </div>
          <div style={{ fontSize:19, fontWeight:800, color:"#6a1b9a", lineHeight:1 }}>
            {dualHazardBrgys.length}
          </div>
          <div style={{ fontSize:10.5, color:D.textMuted, marginTop:4, lineHeight:1.4,
            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {dualHazardBrgys.length > 0
              ? `Both zones — ${dualHazardBrgys.slice(0,3).map(b=>b.name).join(", ")}${dualHazardBrgys.length>3 ? "…" : ""}`
              : "No barangay carries both exposures"}
          </div>
        </div>
      </div>

      {/* Ranked breakdown -- same horizontal-bar convention as the SVI vs.
          Capacity chart, so the two cards read as one visual system. Every
          barangay with any real exposure, Flood and Landslide as separate
          bars (never summed), sorted by combined proportion for ordering
          only. flex:1 lets this fill whatever height the grid row settles
          on (matched against the barangay rankings card beside it). */}
      {hazardRanked.length > 0 && (
        <div style={{ marginTop:16, flex:1, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", gap:14, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, fontWeight:700, color:D.textMuted,
              textTransform:"uppercase", letterSpacing:"0.08em" }}>
              Barangays by hazard exposure
            </span>
            {[
              { color:"#0288d1", label:"Flood high/very-high %" },
              { color:"#8d6e63", label:"Landslide moderate/high %" },
            ].map(l => (
              <div key={l.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:l.color }} />
                <span style={{ fontSize:11, color:D.textCell, fontWeight:500 }}>{l.label}</span>
              </div>
            ))}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {hazardRanked.map(b => (
              <div key={b.barangay}>
                <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:D.textBody, minWidth:90,
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {b.barangay.replace(/Brgy\.?\s*/i, "")}
                  </span>
                  <span style={{ fontSize:10, color:D.textMuted }}>
                    SVI rank #{b.svi_rank}
                    {b.svi_rank <= 12 ? " · High/Mod-high" : ""}
                  </span>
                  <span style={{ flex:1 }} />
                  {b.flood_pct > 0 && (
                    <span style={{ fontSize:11, fontWeight:700, color:"#0288d1" }}>{b.flood_pct.toFixed(1)}%</span>
                  )}
                  {b.landslide_pct > 0 && (
                    <span style={{ fontSize:11, fontWeight:700, color:"#8d6e63" }}>{b.landslide_pct.toFixed(1)}%</span>
                  )}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  {b.flood_pct > 0 && (
                    <div style={{ height:6, background:D.subBg, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ width:`${Math.min(b.flood_pct, 100)}%`, height:"100%",
                        background:"linear-gradient(90deg, #0288d188, #0288d1)",
                        borderRadius:3, transition:"width 0.6s ease" }} />
                    </div>
                  )}
                  {b.landslide_pct > 0 && (
                    <div style={{ height:6, background:D.subBg, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ width:`${Math.min(b.landslide_pct, 100)}%`, height:"100%",
                        background:"linear-gradient(90deg, #8d6e6388, #8d6e63)",
                        borderRadius:3, transition:"width 0.6s ease" }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
})

export default HazardExposureCardComp;
