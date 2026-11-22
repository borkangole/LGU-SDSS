// ============================================================
// HouseholdDetailModal.jsx
// Place in: frontend/src/features/map/HouseholdDetailModal.jsx
//
// Restyled to match the app's existing design system (the dark
// glass panels + colored accent bars used in MapView.jsx's
// sidebar and dot-click preview card), instead of the generic
// light card this used to be. Same token shapes as MapView's
// DARK_TOKENS / LIGHT_TOKENS so light/dark mode stay in sync
// across the whole app.
//
// v4 (three-domain model): the retired BVI / Resilience scores are no
// longer shown. The profile is organised by Sir Shem's three domains, each
// shown on its own and never combined into one number:
//   1. Hazard exposure       -- this household's own flood / landslide zone
//   2. Social vulnerability  -- the 13 SVI conditions checked for this
//                               household (incl. > 2 km from the RHU / fire
//                               station); a count, not a score
//   3. Preparedness          -- knows evacuation site / hotline (CBMS answers)
// plus its household profile (k-modes cluster) and its barangay's
// barangay-level tiers for context.
// Usage in MapView.jsx:
//   import HouseholdDetailModal from "./HouseholdDetailModal";
//   ...
//   {selectedDotHH && (
//     <HouseholdDetailModal householdId={selectedDotHH} onClose={() => setSelectedDotHH(null)} />
//   )}
// ============================================================

import { useState, useEffect, useMemo } from "react";
import { getVulnHousehold, getDomainBarangays, getDomainCapacity } from "../../api/api";
import { capacityColorByRank, capacityTierFromRank } from "../capacity/capacityShared";
import { useTheme } from "../../hooks/useTheme";
import { SVI_TIER_TEXT, HAZARD_EXPOSURE_TEXT } from "../shared/domainColors";

// Local name-normalizer, matching the convention used in MapView.jsx /
// Dashboard.jsx, so "Brgy. 8 Pob." and "Bgy. 8 Pob." resolve to the same
// barangay when matching this household's barangay_name against the
// Official SVI model's barangay list (that list keys on psgc_10d, but this
// household record only carries the barangay name, not the PSGC code).
function normalizeBarangayName(name) {
  if (!name) return "";
  return name.toLowerCase()
    // "Brgy." / "Bgy." (both spellings, with or without the period)
    .replace(/\bb\.?r?gy\.?\s*/gi, "").replace(/\bbarangay\s*/gi, "")
    // "Pob." / "Poblacion" suffix, e.g. "Bgy. 1 Pob." -> "Bgy. 1"
    .replace(/\bpob(lacion)?\.?\s*/gi, "")
    .replace(/ñ/g, "n")
    // Canonicalize "Santo"/"Santa" long forms to "Sto"/"Sta" abbreviations
    .replace(/\bsanto\b/g, "sto").replace(/\bsanta\b/g, "sta")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim();
}

// Tier labels per the panel's redesign spec: qcut(score,4) -> Low /
// Moderate-low / Moderate-high / High, 6 barangays per tier, rank 1 = most
// socially vulnerable. Not the legacy BVI's Very High/High/Moderate/Low
// (VULN_COLORS below) — the two models use different tier vocabularies.
const SVI_CATEGORY_COLORS = SVI_TIER_TEXT; // same red/orange/amber/green as every page
function sviCategoryFromRank(rank) {
  if (rank == null) return null;
  if (rank <= 6) return "High";
  if (rank <= 12) return "Moderate-high";
  if (rank <= 18) return "Moderate-low";
  return "Low";
}

// ── Theme tokens — same shape as MapView.jsx's DARK_TOKENS/LIGHT_TOKENS ──
const DARK_TOKENS = {
  overlayBg: "rgba(4,7,15,0.72)",
  panelBg: "rgba(10,14,26,0.97)",
  panelBorder: "rgba(59,130,246,0.18)",
  panelShadow: "0 8px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(59,130,246,0.12) inset",
  cardBg: "rgba(14,20,36,0.95)",
  cardBorder: "rgba(59,130,246,0.14)",
  metricBg: "rgba(20,30,52,0.8)",
  metricBorder: "rgba(59,130,246,0.2)",
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  textAccent: "#60a5fa",
  divider: "rgba(59,130,246,0.12)",
  closeBg: "rgba(30,40,70,0.7)",
  ringTrack: "rgba(255,255,255,0.08)",
};

const LIGHT_TOKENS = {
  overlayBg: "rgba(15,23,42,0.55)",
  panelBg: "rgba(255,255,255,0.98)",
  panelBorder: "rgba(30,64,175,0.12)",
  panelShadow: "0 8px 32px rgba(30,64,175,0.16), 0 1px 0 rgba(255,255,255,0.8) inset",
  cardBg: "#ffffff",
  cardBorder: "rgba(30,64,175,0.1)",
  metricBg: "rgba(239,246,255,0.8)",
  metricBorder: "rgba(59,130,246,0.2)",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  textAccent: "#1d4ed8",
  divider: "rgba(30,64,175,0.08)",
  closeBg: "rgba(239,246,255,0.9)",
  ringTrack: "rgba(0,0,0,0.06)",
};

const toNum = (val) => parseFloat(val) || 0;
const isNo  = (v) => ["no", "false", "0", "f", "n"].includes(String(v ?? "").trim().toLowerCase());
const isYes = (v) => ["yes", "true", "1", "t", "y"].includes(String(v ?? "").trim().toLowerCase());

const FLOOD_COLORS = HAZARD_EXPOSURE_TEXT; // same scale as the map dots (text-safe shades)
const SLIDE_COLORS = HAZARD_EXPOSURE_TEXT;
const SEV = { critical: "#dc2626", watch: "#d97706", ok: "#16a34a", none: "#64748b" };

// Same facility points + haversine as backend/facility_distance.py.
const RHU_POINT = [10.7815, 122.4647], FIRE_POINT = [10.7869, 122.4683];
function kmTo(lat, lng, [la2, lo2]) {
  const la1 = parseFloat(lat), lo1 = parseFloat(lng);
  if (!Number.isFinite(la1) || !Number.isFinite(lo1)) return null;
  const R = 6371.0088, rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// SVI indicators that exist per household (ti_* flags on tbl_households,
// backfilled by backfill_typology_clusters.py). Shown as a checklist.
const SVI_HH_FLAGS = [
  ["ti_food_insecure", "Food insecure"],
  ["ti_overcrowding", "Overcrowded"],
  ["ti_weak_roof", "Weak roof material"],
  ["ti_weak_wall", "Weak wall material"],
  ["ti_insecure_tenure", "Insecure tenure"],
  ["ti_unimproved_sanitation", "Unimproved sanitation"],
  ["ti_no_internet", "No internet access"],
  ["ti_low_adult_education_hh", "Low adult education"],
];

function Chip({ label, value, color, C }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: C.metricBg, border: `0.5px solid ${C.metricBorder}`, borderTop: `2px solid ${color}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

function DomainCard({ number, title, badge, color, C, children }) {
  return (
    <div style={{ background: C.cardBg, border: `0.5px solid ${C.cardBorder}`, borderTop: `2px solid ${color}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: `0.5px solid ${C.divider}` }}>
        <span style={{ fontWeight: 700, fontSize: 11.5, color: C.textPrimary, letterSpacing: "0.01em" }}>{number}. {title}</span>
        {badge && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, color: badge.color, background: `${badge.color}1a`, border: `0.5px solid ${badge.color}55`, whiteSpace: "nowrap" }}>
            {badge.label}
          </span>
        )}
      </div>
      <div style={{ padding: "10px 14px", fontSize: 11.5, color: C.textSecondary, lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

function Row({ label, children, C }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", borderBottom: `0.5px dashed ${C.divider}` }}>
      <span>{label}</span><span style={{ color: C.textPrimary, fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
// NOTE: expects the parent to render this with key={householdId} (see
// MapView.jsx) -- that makes React remount a fresh instance whenever a
// different household is clicked, which naturally resets fetchState to
// its initial loading value below. No manual "reset" setState call is
// needed at the top of the effect, which is what a stricter React Hooks
// lint rule flags ("Calling setState synchronously within an Effect").
export default function HouseholdDetailModal({ householdId, onClose, nearestHealthcareKm = null, nearestHealthcareName = null }) {
  const { dark } = useTheme();
  const C = useMemo(() => (dark ? DARK_TOKENS : LIGHT_TOKENS), [dark]);

  const [fetchState, setFetchState] = useState({ loading: true, data: null, error: null });
  const { loading, data, error } = fetchState;

  // ── Official SVI model — barangay-level context only ──────────
  // Sir Shem's reference package deliberately produces aggregate-only
  // outputs ("No household-level assignment table, UUID table,
  // coordinate table, or household point map is produced" —
  // docs/METHOD_GUIDE.md). This modal respects that: it shows what the
  // household's barangay scores on the two-domain model, never a
  // household-specific cluster/typology assignment.
  const [domainBarangays, setDomainBarangays] = useState([]);
  const [domainLoading, setDomainLoading]     = useState(true);
  const [domainError, setDomainError]         = useState(null);

  const [capDist, setCapDist] = useState([]);
  useEffect(() => {
    getDomainCapacity().then(r => setCapDist(r.data?.data || [])).catch(() => setCapDist([]));
  }, []);

  useEffect(() => {
    getDomainBarangays()
      .then(r => { setDomainBarangays(r.data?.data || []); setDomainLoading(false); })
      .catch(e => {
        setDomainError(e.response?.data?.detail || e.response?.data?.error || e.message);
        setDomainLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    getVulnHousehold(householdId)
      .then(r => { if (!cancelled) setFetchState({ loading: false, data: r.data, error: null }); })
      .catch(e => {
        if (!cancelled) {
          setFetchState({ loading: false, data: null, error: e.response?.data?.error || e.message });
        }
      });
    return () => { cancelled = true; };
  }, [householdId]);

  const overlayStyle = {
    position: "fixed", inset: 0, zIndex: 9999,
    background: C.overlayBg,
    display: "flex", alignItems: "flex-start", justifyContent: "center",
    overflowY: "auto", paddingTop: 40, paddingBottom: 40,
  };

  const closeBtnStyle = {
    width: 26, height: 26, borderRadius: "50%", cursor: "pointer", flexShrink: 0,
    border: `0.5px solid ${C.panelBorder}`, background: C.closeBg,
    display: "flex", alignItems: "center", justifyContent: "center",
    color: C.textMuted, fontSize: 13, fontWeight: 700,
  };

  if (loading) return (
    <div style={overlayStyle}>
      <div style={{
        background: C.panelBg, border: `0.5px solid ${C.panelBorder}`, boxShadow: C.panelShadow,
        padding: "32px 40px", borderRadius: 12, fontSize: 13, color: C.textSecondary,
      }}>
        Loading household details…
      </div>
    </div>
  );

  if (error) return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: C.panelBg, border: `0.5px solid ${C.panelBorder}`, boxShadow: C.panelShadow,
        padding: "32px 36px", borderRadius: 12, color: "#ef4444", textAlign: "center", fontSize: 13,
      }}>
        {error}
        <br />
        <button onClick={onClose} style={{
          marginTop: 16, padding: "8px 20px", borderRadius: 6, border: `0.5px solid ${C.panelBorder}`,
          background: C.textAccent, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12,
        }}>Close</button>
      </div>
    </div>
  );

  if (!data) return null;

  const { household, members, cluster_match: clusterMatch } = data;

  const domainBarangay = domainBarangays.find(
    (b) => normalizeBarangayName(b.barangay) === normalizeBarangayName(household.barangay_name)
  ) || null;
  const capBarangay = capDist.find(
    (b) => normalizeBarangayName(b.barangay) === normalizeBarangayName(household.barangay_name)
  ) || null;
  const domainCat = domainBarangay ? sviCategoryFromRank(domainBarangay.svi_rank) : null;
  const domainColor = SVI_CATEGORY_COLORS[domainCat] || "#64748b";

  // ── Composition ──
  const adults   = members.filter(m => toNum(m.age) >= 18 && toNum(m.age) < 60).length;
  const children = members.filter(m => toNum(m.age) < 18).length;
  const seniors  = members.filter(m => toNum(m.age) >= 60).length;
  const pwds     = members.filter(m => m.is_pwd).length;
  const soloParents = members.filter(m => isYes(m.is_solo_parent) || m.is_solo_parent === true).length || toNum(household.solo_parent_count);
  const working  = members.filter(m => toNum(m.age) >= 18 && toNum(m.age) <= 59 && !m.is_pwd).length;
  const depRatio = working ? ((children + seniors) / working) : null;
  const head     = members.find(m => m.is_household_head) || (members.length > 0 ? members[0] : null);

  // ── 1. Hazard (household's own zone) ──
  const flood = household.flood_exposure || null;
  const slide = household.landslide_exposure || null;
  const inHighHazard = ["High", "Very High"].includes(flood) || ["Moderate", "High"].includes(slide);
  const hazardBadge = inHighHazard ? { label: "High-hazard zone", color: SEV.critical }
    : (flood || slide) ? { label: "Low-hazard zone", color: SEV.watch } : { label: "Outside mapped zones", color: SEV.ok };

  const rhuKm  = kmTo(household.latitude, household.longitude, RHU_POINT);
  const fireKm = kmTo(household.latitude, household.longitude, FIRE_POINT);
  const yn = (v) => isYes(v) ? <span style={{ color: SEV.ok }}>Yes</span> : isNo(v) ? <span style={{ color: SEV.critical }}>No</span> : "—";
  const km = (v) => v == null ? "—" : <span style={{ color: v > 2 ? SEV.critical : v > 1 ? SEV.watch : SEV.ok }}>{v.toFixed(2)} km</span>;

  // ── 2. The 13 SVI conditions, counted for this household ──
  // Same 13 components as the barangay SVI (and the Reports / Planning
  // household lists): 8 housing / living conditions, a PWD, a senior, a
  // solo parent, and more than 2 km from the RHU / fire station.
  const has = (k) => isYes(household[k]) || household[k] === true;
  const svi13 = [
    ...SVI_HH_FLAGS.map(([k, label]) => ({ key: k, label, on: has(k), known: household[k] != null })),
    { key: "pwd", label: "Has a PWD", on: pwds > 0, known: true, detail: pwds ? String(pwds) : null },
    { key: "senior", label: "Has a senior (60+)", on: seniors > 0, known: true, detail: seniors ? String(seniors) : null },
    { key: "solo", label: "Has a solo parent", on: soloParents > 0, known: true, detail: soloParents ? String(soloParents) : null },
    { key: "rhu", label: "More than 2 km from the RHU", on: rhuKm != null && rhuKm > 2, known: rhuKm != null, detail: rhuKm != null ? `${rhuKm.toFixed(2)} km` : null },
    { key: "fire", label: "More than 2 km from the fire station", on: fireKm != null && fireKm > 2, known: fireKm != null, detail: fireKm != null ? `${fireKm.toFixed(2)} km` : null },
  ];
  const sviCount = svi13.filter((x) => x.on).length;
  const sviBadge = { label: `${sviCount} of 13`, color: sviCount >= 5 ? SEV.critical : sviCount >= 3 ? SEV.watch : SEV.ok };

  // ── 3. Household preparedness (CBMS answers, not the Capacity score) ──
  const notKnown = [isNo(household.knows_evacuation_location), isNo(household.knows_emergency_hotline)].filter(Boolean).length;
  const prepBadge = notKnown === 2 ? { label: "Knows neither", color: SEV.critical } : notKnown === 1 ? { label: "Knows 1 of 2", color: SEV.watch } : { label: "Knows both", color: SEV.ok };

  const brgyName = domainBarangay?.barangay || household.barangay_name;
  const accent = inHighHazard ? SEV.critical : sviCount >= 5 ? SEV.watch : "#3b82f6";

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: C.panelBg, border: `0.5px solid ${C.panelBorder}`, boxShadow: C.panelShadow,
        borderRadius: 14, width: 620, maxWidth: "95vw", overflow: "hidden",
        animation: "hhModalIn 0.2s cubic-bezier(0.34,1.4,0.64,1)",
      }}>
        <style>{`@keyframes hhModalIn { from { opacity:0; transform:translateY(8px) scale(0.98);} to { opacity:1; transform:translateY(0) scale(1);} }`}</style>

        {/* ── Header ── */}
        <div style={{ padding: "14px 18px", borderBottom: `0.5px solid ${C.divider}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
              <div style={{ width: 3, borderRadius: 2, background: accent, flexShrink: 0, alignSelf: "stretch" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.textPrimary, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {household.household_number}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 22px", fontSize: 11.5, color: C.textSecondary }}>
                  <span>
                    <strong style={{ color: C.textPrimary, fontWeight: 600 }}>Family head:</strong>{" "}
                    {head ? `${head.display_name || head.full_name || head.person_code || "—"}${head?.age ? ` (${head.age} yrs)` : ""}` : "—"}
                  </span>
                  <span><strong style={{ color: C.textPrimary, fontWeight: 600 }}>Members:</strong> {members.length} ({adults} adult{adults === 1 ? "" : "s"}, {children} {children === 1 ? "child" : "children"}, {seniors} senior{seniors === 1 ? "" : "s"})</span>
                  <span><strong style={{ color: C.textPrimary, fontWeight: 600 }}>Barangay:</strong> {brgyName}</span>
                  <span><strong style={{ color: C.textPrimary, fontWeight: 600 }}>Profile:</strong> {household.typology_cluster_label || "—"}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} style={closeBtnStyle}>✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <Chip label="Flood" value={flood || "Not in mapped zone"} color={FLOOD_COLORS[flood] || SEV.ok} C={C} />
            <Chip label="Landslide" value={slide || "Not in mapped zone"} color={SLIDE_COLORS[slide] || SEV.ok} C={C} />
            <Chip label="SVI conditions" value={sviBadge.label} color={sviBadge.color} C={C} />
          </div>

          <DomainCard number={1} title="HAZARD EXPOSURE — this household's location" badge={hazardBadge} color="#0891b2" C={C}>
            <Row label="Flood susceptibility zone" C={C}><span style={{ color: FLOOD_COLORS[flood] || C.textPrimary }}>{flood || "Not in a mapped flood zone"}</span></Row>
            <Row label="Landslide susceptibility zone" C={C}><span style={{ color: SLIDE_COLORS[slide] || C.textPrimary }}>{slide || "Not in a mapped landslide zone"}</span></Row>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 6 }}>
              From the household's surveyed coordinates (point-in-polygon on the flood and landslide layers). Flood and landslide are kept separate.
              {household.hazard_data_status === "Outside mapped hazard area" && " This household is outside the mapped hazard area — that means no hazard data, not \"safe\"."}
            </div>
          </DomainCard>

          <DomainCard number={2} title="SOCIAL VULNERABILITY — the 13 SVI conditions in this household" badge={sviBadge} color="#7c3aed" C={C}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", marginBottom: 8 }}>
              {svi13.map((x) => (
                <span key={x.key} title={x.known ? undefined : "No data for this household"} style={{ display: "flex", alignItems: "center", gap: 6, color: x.on ? C.textPrimary : C.textMuted }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: x.on ? `${SEV.critical}22` : "transparent", color: x.on ? SEV.critical : C.textMuted, border: `0.5px solid ${x.on ? SEV.critical : C.divider}` }}>
                    {x.on ? "✓" : ""}
                  </span>
                  <span>{x.label}{x.detail && <span style={{ color: x.on ? SEV.critical : C.textMuted, fontWeight: 600 }}> · {x.detail}</span>}{!x.known && " (no data)"}</span>
                </span>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 6 }}>
              The same 13 components as the barangay SVI, checked for this household (straight-line distances). A count, not a score; households with 5 or more are listed in Reports › High-Risk Households (SVI) and in the Planning reports.
            </div>
          </DomainCard>

          <DomainCard number={3} title="HOUSEHOLD PREPAREDNESS — CBMS answers" badge={prepBadge} color="#ea580c" C={C}>
            <Row label="Knows evacuation location" C={C}>{yn(household.knows_evacuation_location)}</Row>
            <Row label="Knows emergency hotline" C={C}>{yn(household.knows_emergency_hotline)}</Row>
            {nearestHealthcareKm != null && (
              <Row label="Nearest health facility" C={C}>
                {km(nearestHealthcareKm)}{nearestHealthcareName && <span style={{ color: C.textMuted, fontWeight: 400 }}> ({nearestHealthcareName})</span>}
              </Row>
            )}
            <Row label="Dependency ratio (minors + seniors per working-age adult)" C={C}>{depRatio == null ? "no working-age adult" : depRatio.toFixed(2)}</Row>
            <Row label="4Ps beneficiary" C={C}>{isYes(household.is_4ps_beneficiary) ? "Yes" : "No"}</Row>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 6 }}>
              The household's own answers and details. Barangay Capacity is scored per barangay from its resources (below), not from these.
            </div>
          </DomainCard>

          <DomainCard number={4} title={`BARANGAY CONTEXT — ${brgyName}`} color="#64748b" C={C}>
            {domainLoading && <span style={{ color: C.textMuted }}>Loading…</span>}
            {domainError && <span style={{ color: "#ef4444" }}>{domainError}</span>}
            {!domainLoading && !domainError && !domainBarangay && <span style={{ color: C.textMuted }}>No barangay-level data found.</span>}
            {domainBarangay && (
              <>
                <Row label="SVI (barangay)" C={C}><span style={{ color: domainColor }}>Rank #{domainBarangay.svi_rank} of 24 · {domainCat}</span></Row>
                <Row label="Barangay capacity (resources)" C={C}>
                  {capBarangay ? <span style={{ color: capacityColorByRank(capBarangay.capacity_rank) }}>{capBarangay.capacity_score?.toFixed(1)} / 100 · rank #{capBarangay.capacity_rank} of 24 (1 = best equipped) · {capacityTierFromRank(capBarangay.capacity_rank)}</span> : "—"}
                </Row>
                <Row label="Flood — High/Very-High (barangay)" C={C}>{domainBarangay.hazard?.flood_high_or_very_high_pct_total?.toFixed(1) ?? "—"}% of households</Row>
                <Row label="Landslide — Moderate/High (barangay)" C={C}>{domainBarangay.hazard?.landslide_moderate_or_high_pct_total?.toFixed(1) ?? "—"}% of households</Row>
              </>
            )}
            {clusterMatch && (
              <Row label={`Fit to "${clusterMatch.cluster_label}" profile`} C={C}>{clusterMatch.matched_count} of {clusterMatch.total_indicators} indicators match ({clusterMatch.match_pct}%)</Row>
            )}
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 6 }}>
              The three domains are shown separately and are never combined into one score.
            </div>
          </DomainCard>

          <button onClick={onClose} style={{
            marginTop: 6, width: "100%", padding: 10, background: C.textAccent,
            color: "#fff", border: "none", borderRadius: 8, fontSize: 13,
            cursor: "pointer", fontWeight: 700,
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}
