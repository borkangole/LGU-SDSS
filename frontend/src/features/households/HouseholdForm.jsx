import { useState, useEffect, useCallback } from "react";
import { createHousehold, updateHousehold, getBarangays, getGISBarangays } from '../../api/api';
import axios from "axios";
import { MapContainer, TileLayer, GeoJSON, Marker, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import AddHouseholdWizard from "./AddHouseholdWizard";

// Rough center of the municipality — used only as the picker's initial
// view before a household has a pinned location.
const DEFAULT_MAP_CENTER = [10.78, 122.47];

// Same flood color scale as MapView.jsx, for visual consistency.
function getFloodColor(code) {
  switch (code) {
    case "VHF": return "#000000"; // Very High — black
    case "HF":  return "#2E3192"; // High — blue
    case "MF":  return "#92278F"; // Moderate — purple
    case "LF":  return "#E6D6EC"; // Low — light purple/lavender
    default:    return "#94a3b8";
  }
}
const FLOOD_LEGEND = [
  { code: "LF",  label: "Low" },
  { code: "MF",  label: "Moderate" },
  { code: "HF",  label: "High" },
  { code: "VHF", label: "Very High" },
];

// Same name-matching approach as MapView.jsx, so a pin lands on the same
// barangay the map page would attribute it to.
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/brgy\.?\s*/i, "")
    .replace(/barangay\s*/i, "")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function getFeatureName(feature) {
  const p = feature.properties;
  return p?.Barangay_n || p?.NAME_3 || p?.name || p?.BARANGAY || "Unknown";
}

// Point-in-polygon (ray casting), handles Polygon + MultiPolygon + holes.
// GeoJSON coordinates are [lng, lat] — pass point as [lng, lat] to match.
function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygonCoords(point, polygonCoords) {
  if (!polygonCoords?.length || !pointInRing(point, polygonCoords[0])) return false;
  for (let k = 1; k < polygonCoords.length; k++) {
    if (pointInRing(point, polygonCoords[k])) return false; // inside a hole
  }
  return true;
}
function findBarangayFeatureForPoint(boundariesGeojson, lng, lat) {
  if (!boundariesGeojson?.features) return null;
  const point = [lng, lat];
  return boundariesGeojson.features.find(f => {
    const geom = f.geometry;
    if (!geom) return false;
    if (geom.type === "Polygon") return pointInPolygonCoords(point, geom.coordinates);
    if (geom.type === "MultiPolygon") return geom.coordinates.some(pc => pointInPolygonCoords(point, pc));
    return false;
  }) || null;
}

// Custom pin (avoids react-leaflet's broken default marker image path),
// same divIcon approach as MapView.jsx for visual consistency.
const pinIcon = L.divIcon({
  className: "",
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#c62828" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="5.5" fill="#fff"/></svg>`,
});

function LocationClickHandler({ onPick }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

// ── Dropdown options — exact values from tbl_households ───────────────────────
// Matches the wall_risk categories used by the CBMS importer's compute_scores() —
// these are the actual raw values stored in housing_material, not guesses.
const HOUSING_MATERIALS = [
  "Concrete/brick/stone", "Fiber cement board",
  "Half concrete/brick/stone and half wood", "Metal sheet",
  "Wood/bamboo", "Sawali/cogon/nipa", "Asbestos",
  "Makeshift/salvaged/improvised", "Glass", "Others", "Not Stated",
];
// Pulled directly from aligned_data_FINAL.csv distinct values (2026-07-27).
const HOUSING_ROOFS = [
  "Concrete/clay/slate tile", "Half galvanized iron and half concrete",
  "Metal roofing sheets", "Sod/thatch", "Wood/bamboo", "Not Stated",
];
const HOUSING_FLOORS = [
  "Bamboo", "Coconut lumber", "Concrete", "Earth/sand/mud",
  "Makeshift/salvaged/improvised", "Wood", "Not Stated",
];
const LIGHTING_FUELS = [
  "Candle", "Electricity", "Kerosene (Gaas)", "Solar Panel/Solar Lamp", "Not Stated",
];
const COOKING_FUELS = [
  "Charcoal", "Electricity", "Liquefied Petroleum Gas (LPG)", "Wood", "Not Stated",
];
const TENURE_STATUSES = [
  "Own house, rent lot",
  "Own house, rent-free lot with consent of owner",
  "Own house, rent-free lot without consent of owner",
  "Own or owner-like possession of the house and lot",
  "Rent house / room, including lot",
  "Rent-free house and lot with consent of owner",
  "Rent-free house and lot without consent of owner",
  "Not Stated",
];
const WATER_SOURCES = [
  "Piped into dwelling", "Piped into yard/plot", "Protected spring",
  "Protected well/tube well/borehole", "Public tap/standpipe", "Rainwater",
  "Surface water", "Tanker truck/peddler/neighbor", "Unprotected open dug well",
  "Unprotected spring", "Not Stated",
];
const TOILET_TYPES = [
  "Flush to open drain", "Flush to pit latrine", "Flush to septic tank",
  "Flush, unknown destination", "Open defecation", "Pit latrine with slab",
  "Pit latrine without slab/open pit", "Ventilated improved latrine", "Not Stated",
];
const CIVIL_STATUSES = [
  "Single", "Married", "Widowed", "Separated", "Divorced", "Live-in", "Not Stated",
];
const OCCUPATIONS = [
  "Farmer", "Fisherfolk", "Laborer/Worker", "Driver",
  "Vendor/Trader", "Office Worker", "Teacher",
  "Nurse/Health Worker", "Engineer", "Student",
  "Student (High School)", "Student (Elementary)",
  "Housewife/Homemaker", "Office Accountant",
  "Unemployed", "Not Stated",
];

const RELATIONSHIPS = [
  "Household Head",
  "Spouse",
  "Son/Daughter",
  "Son/Daughter-in-Law",
  "Grandchildren",
  "Brother/Sister",
  "Sister/Brother-in-Law",
  "Parents",
  "Other Relatives",
];

const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const EDUCATIONAL_ATTAINMENTS = [
  "ALS", "ALS Graduate", "College Graduate", "College Level",
  "Elementary Graduate", "Elementary Level", "High School Graduate",
  "High School Level", "Masters/Doctoral", "No Grade Completed",
  "Not Stated", "Pre-school", "Vocational/Technical",
];

// ── Shared styles ─────────────────────────────────────────────────────────────
const FIELD_STYLE = {
  width: "100%", padding: "8px 11px",
  border: "1px solid #e0e0e0", borderRadius: 6,
  fontSize: 13, outline: "none", boxSizing: "border-box",
  background: "#fafbff", color: "#333",
};
const LABEL_STYLE = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: "#666", marginBottom: 5,
  textTransform: "uppercase", letterSpacing: 0.4,
};

function Field({ label, required, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label style={LABEL_STYLE}>
        {label}
        {required && <span style={{ color: "#e53935", marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {hint && <span style={{ fontSize: 10, color: "#999", marginTop: 3 }}>{hint}</span>}
    </div>
  );
}

function Toggle({ checked, onChange, labelOn = "Yes", labelOff = "No" }) {
  return (
    <label style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: 10 }}>
      <div style={{ position: "relative" }}>
        <input type="checkbox" checked={checked} onChange={onChange}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
        <div style={{
          width: 40, height: 22, borderRadius: 11,
          background: checked ? "#1565c0" : "#ddd",
          transition: "background 0.2s", position: "relative",
        }}>
          <div style={{
            position: "absolute", top: 3,
            left: checked ? 21 : 3, width: 16, height: 16,
            borderRadius: "50%", background: "#fff",
            transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }} />
        </div>
      </div>
      <span style={{ fontSize: 13, color: "#555" }}>
        {checked ? labelOn : labelOff}
      </span>
    </label>
  );
}

// Toggle variant for fields stored as "Yes"/"No" or "True"/"False" strings (CBMS convention)
function StringToggle({ value, onOn, onOff, onChange, labelOn = "Yes", labelOff = "No" }) {
  const checked = value === onOn;
  return (
    <Toggle
      checked={checked}
      onChange={e => onChange(e.target.checked ? onOn : onOff)}
      labelOn={labelOn}
      labelOff={labelOff}
    />
  );
}

// Ensures the household's actual stored value is always selectable, even if it
// isn't in our known option list (prevents CBMS text mismatches from silently
// blanking a dropdown that actually has data).
function withCurrentValue(list, value) {
  if (value && !list.includes(value)) return [...list, value];
  return list;
}

function StepBar({ step }) {
  const steps = ["Household Info", "Add Members", "Done"];
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "14px 22px 0", gap: 0 }}>
      {steps.map((label, i) => {
        const idx = i + 1;
        const done   = step > idx;
        const active = step === idx;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: done || active ? "#1565c0" : "#e0e0e0",
                color: done || active ? "#fff" : "#999",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>
                {done ? "✓" : idx}
              </div>
              <span style={{ fontSize: 10, color: active || done ? "#1565c0" : "#999", fontWeight: active ? 700 : 400, whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? "#1565c0" : "#e0e0e0", margin: "0 8px", marginBottom: 18 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MemberCard({ member, index, onChange, onRemove }) {
  const update = (field, val) => onChange(index, { ...member, [field]: val });
  const income = parseFloat(member.monthly_income) || 0;

  const handleAgeChange = (e) => {
    const age = e.target.value;
    const isSnr = parseInt(age) >= 60;
    onChange(index, { ...member, age, is_senior: isSnr });
  };

  return (
    <div style={{
      border: "1px solid #e3e8f0", borderRadius: 10,
      padding: "14px 14px 12px", background: "#fafbff",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1565c0" }}>
          Member {index + 1}
          {income > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: "#2e7d32", fontWeight: 600 }}>
              ₱{income.toLocaleString()}/mo
            </span>
          )}
        </span>
        <button type="button" onClick={() => onRemove(index)}
          style={{ background: "#ffebee", border: "none", color: "#c62828", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          ✕ Remove
        </button>
      </div>

      {/* Row: Full Name + Gender */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Field label="Full Name" required>
          <input
            type="text"
            value={member.full_name || ""}
            onChange={e => update("full_name", e.target.value)}
            placeholder="e.g. Dela Cruz, Juan"
            style={FIELD_STYLE}
            required
          />
        </Field>
        <Field label="Gender">
          <select value={member.gender || ""} onChange={e => update("gender", e.target.value)} style={FIELD_STYLE}>
            <option value="">-- Select --</option>
            {GENDERS.map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
      </div>

      {/* Row: Relationship + Head toggle */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 10, alignItems: "end" }}>
        <Field label="Relationship to Household Head" required>
          <select
            value={member.relationship_to_hh || ""}
            onChange={e => {
              const rel = e.target.value;
              const isHead = rel === "Household Head";
              update("relationship_to_hh", rel);
              if (isHead) onChange(index, { ...member, relationship_to_hh: rel, is_household_head: true });
            }}
            style={{ ...FIELD_STYLE, borderColor: !member.relationship_to_hh ? "#f57c00" : "#e0e0e0" }}
            required
          >
            <option value="">-- Select --</option>
            {RELATIONSHIPS.map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        {member.relationship_to_hh === "Household Head" && (
          <div style={{ padding: "6px 10px", background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 6, fontSize: 11, fontWeight: 700, color: "#1565c0", whiteSpace: "nowrap", marginBottom: 1 }}>
            👤 HH Head
          </div>
        )}
      </div>

      {/* Row: Age, Civil Status, Income */}
      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Field label="Age" required>
          <input type="number" min="0" max="120"
            value={member.age || ""}
            onChange={handleAgeChange}
            placeholder="35" style={FIELD_STYLE} required />
        </Field>
        <Field label="Civil Status">
          <select value={member.civil_status || ""} onChange={e => update("civil_status", e.target.value)} style={FIELD_STYLE}>
            <option value="">-- Select --</option>
            {CIVIL_STATUSES.map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Monthly Income (₱)" hint="0 if none">
          <input type="number" min="0"
            value={member.monthly_income || ""}
            onChange={e => update("monthly_income", e.target.value)}
            placeholder="0" style={FIELD_STYLE} />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Field label="Occupation">
          <select value={member.occupation || ""} onChange={e => update("occupation", e.target.value)} style={FIELD_STYLE}>
            <option value="">-- Select --</option>
            {OCCUPATIONS.map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Educational Attainment">
          <select value={member.educational_attainment || ""} onChange={e => update("educational_attainment", e.target.value)} style={FIELD_STYLE}>
            <option value="">-- Select --</option>
            {EDUCATIONAL_ATTAINMENTS.map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {[
          { field: "is_senior",      label: "Senior Citizen (60+)" },
          { field: "is_pwd",         label: "Person with Disability" },
          { field: "is_solo_parent", label: "Solo Parent" },
          { field: "is_4ps",         label: "4Ps Beneficiary" },
        ].map(({ field, label }) => (
          <label key={field} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#444" }}>
            <input type="checkbox" checked={!!member[field]}
              onChange={e => update(field, e.target.checked)}
              style={{ accentColor: "#1565c0", width: 14, height: 14 }} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function IncomeSummary({ members }) {
  const total   = members.reduce((s, m) => s + (parseFloat(m.monthly_income) || 0), 0);
  const earners = members.filter(m => parseFloat(m.monthly_income) > 0).length;
  if (total === 0) return null;
  return (
    <div style={{
      background: "#e8f5e9", border: "1px solid #a5d6a7",
      borderRadius: 8, padding: "10px 14px",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div style={{ fontSize: 12, color: "#2e7d32" }}>
        💰 <b>{earners}</b> earner{earners !== 1 ? "s" : ""} — total household income
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#1b5e20" }}>
        ₱{total.toLocaleString()}/mo
      </div>
    </div>
  );
}

function blankMember() {
  return { full_name: "", gender: "", age: "", civil_status: "", occupation: "", monthly_income: "",
           educational_attainment: "", relationship_to_hh: "", is_household_head: false,
           is_senior: false, is_pwd: false, is_solo_parent: false, is_4ps: false };
}

function getAuthHeaders() {
  const token =
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("access_token") ||
    sessionStorage.getItem("token") ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ══════════════════════════════════════════════════════════════════════════════
// Adding a household uses the CBMS-questionnaire wizard (AddHouseholdWizard);
// this form is now only used to edit an existing household's details.
export default function HouseholdForm(props) {
  return props.existing ? <EditHouseholdForm {...props} /> : <AddHouseholdWizard {...props} />;
}

function EditHouseholdForm({ existing, onSaved, onCancel }) {
  const isEdit = !!existing;

  const [step,           setStep]           = useState(1);
  const [barangays,      setBarangays]      = useState([]);
  const [errors,         setErrors]         = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [autoNumLoading, setAutoNumLoading] = useState(false);
  const [newHHId,        setNewHHId]        = useState(null);
  const [members,        setMembers]        = useState([blankMember()]);
  const [hazardPreview,      setHazardPreview]      = useState(null);
  const [hazardLoading,      setHazardLoading]      = useState(false);
  const [hazardError,        setHazardError]        = useState("");
  const [floodGeojson,       setFloodGeojson]       = useState(null);
  const [boundariesGeojson,  setBoundariesGeojson]  = useState(null);
  const [barangayAutoNote,   setBarangayAutoNote]   = useState("");

  const [form, setForm] = useState({
    household_number: "",
    barangay_id:      "",
    longitude:        "",
    latitude:          "",
    housing_material: "",
    housing_roof:     "",
    housing_floor:    "",
    tenure_status:    "",
    has_electricity:  false,
    o12_fuel_for_lighting: "",
    o13_fuel_for_cooking:  "",
    water_source:     "",
    toilet_type:      "",
    surveyed_date:    "",


    // ── Social program / vulnerability composition (manual, CBMS-aligned) ──
    is_4ps_beneficiary:           "No",   // "Yes" | "No"
    overcrowding_status:          "No",   // "Yes" | "No"
    food_insecurity_score:        "",
    has_formal_financial_account: "No",
    has_social_insurance:         "No",
    knows_evacuation_location:    "No",
    knows_emergency_hotline:      "No",
  });

  useEffect(() => {
    getBarangays()
      .then(res => setBarangays(res.data?.data || res.data || []))
      .catch(() => setBarangays([]));
    axios.get("/api/gis/flood", { headers: getAuthHeaders() })
      .then(res => setFloodGeojson(res.data))
      .catch(() => setFloodGeojson(null));
    getGISBarangays()
      .then(res => setBoundariesGeojson(res.data))
      .catch(() => setBoundariesGeojson(null));
    if (existing) {
      setForm({
        household_number: existing.household_number || "",
        barangay_id:      existing.barangay_id      || "",
        longitude:        existing.longitude != null ? String(existing.longitude) : "",
        latitude:         existing.latitude  != null ? String(existing.latitude)  : "",
        housing_material: existing.housing_material || "",
        housing_roof:     existing.housing_roof     || "",
        housing_floor:    existing.housing_floor    || "",
        tenure_status:    existing.tenure_status    || "",
        has_electricity:  existing.has_electricity  || false,
        o12_fuel_for_lighting: existing.o12_fuel_for_lighting || "",
        o13_fuel_for_cooking:  existing.o13_fuel_for_cooking  || "",
        water_source:     existing.water_source     || "",
        toilet_type:      existing.toilet_type      || "",
        surveyed_date:    existing.surveyed_date    || "",


        is_4ps_beneficiary:           existing.is_4ps_beneficiary           || "No",
        // older records stored "True"/"False"; the CBMS import stores "Yes"/"No"
        overcrowding_status:          ({ True: "Yes", true: "Yes", False: "No", false: "No" })[existing.overcrowding_status] || existing.overcrowding_status || "No",
        food_insecurity_score:        existing.food_insecurity_score        ?? "",
        has_formal_financial_account: existing.has_formal_financial_account || "No",
        has_social_insurance:         existing.has_social_insurance         || "No",
        knows_evacuation_location:    existing.knows_evacuation_location    || "No",
        knows_emergency_hotline:      existing.knows_emergency_hotline      || "No",
      });
      if (existing.longitude != null && existing.latitude != null) {
        fetchHazardPreview(existing.latitude, existing.longitude);
      }
    }
  }, [existing]);

  // ── Location pin + hazard preview ────────────────────────────────────────
  const fetchHazardPreview = useCallback(async (lat, lng) => {
    setHazardLoading(true);
    setHazardError("");
    try {
      const headers = getAuthHeaders();
      const res = await axios.get(
        `/api/households/hazard-preview?longitude=${lng}&latitude=${lat}`,
        { headers }
      );
      setHazardPreview(res.data);
    } catch (err) {
      setHazardError(err.response?.data?.error || "Could not compute hazard exposure.");
      setHazardPreview(null);
    } finally {
      setHazardLoading(false);
    }
  }, []);

  const handlePinPick = useCallback((lat, lng) => {
    setForm(f => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
    fetchHazardPreview(lat, lng);

    if (!boundariesGeojson) { setBarangayAutoNote(""); return; }
    const feature = findBarangayFeatureForPoint(boundariesGeojson, lng, lat);
    if (!feature) {
      setBarangayAutoNote("⚠ Pinned point is outside all mapped barangay boundaries — select the barangay manually.");
      return;
    }
    const name = normalizeName(getFeatureName(feature));
    const match =
      barangays.find(b => normalizeName(b.barangay_name) === name) ||
      barangays.find(b => {
        const bNorm = normalizeName(b.barangay_name);
        return bNorm.includes(name) || name.includes(bNorm);
      });
    if (match) {
      setForm(f => ({ ...f, barangay_id: match.barangay_id }));
      setBarangayAutoNote(`📍 Auto-detected barangay: ${match.barangay_name}`);
      fetchNextNumber(match.barangay_id);
    } else {
      setBarangayAutoNote(`⚠ Pin falls inside "${getFeatureName(feature)}" but that name doesn't match any barangay in the system — select manually.`);
    }
  }, [boundariesGeojson, barangays, fetchHazardPreview]);

  // Auto-generate household number when barangay is selected
  const fetchNextNumber = useCallback(async (barangayId) => {
    if (!barangayId || isEdit) return;
    setAutoNumLoading(true);
    setForm(f => ({ ...f, household_number: "" }));
    try {
      // Use the same base URL pattern as other API calls
      const headers = getAuthHeaders();
      console.log("[next-number] fetching for barangay_id:", barangayId, "headers:", headers);
      const res = await axios.get(
        `/api/households/next-number?barangay_id=${barangayId}`,
        { headers }
      );
      console.log("[next-number] response:", res.data);
      const num = res.data?.household_number || "";
      setForm(f => ({ ...f, household_number: num }));
      if (!num) setErrors(["Auto-number returned empty — check backend /api/households/next-number"]);
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.statusText || err.message;
      console.error("[next-number] FAILED:", err.response?.status, msg, err.response?.data);
      setErrors([`Could not generate household number: ${msg}`]);
      setForm(f => ({ ...f, household_number: "" }));
    } finally {
      setAutoNumLoading(false);
    }
  }, [isEdit]);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
    if (name === "barangay_id") fetchNextNumber(value);
  };

  // ── Step 1 ────────────────────────────────────────────────────────────────
  const handleStep1 = async e => {
    e.preventDefault();
    if (!form.latitude || !form.longitude) {
      setErrors(["Please pin the household's location on the map before saving — this is required to determine flood/landslide exposure."]);
      return;
    }
    setLoading(true);
    setErrors([]);
    try {
      const payload = {
        ...form,
        barangay_id:      parseInt(form.barangay_id),
        longitude:        parseFloat(form.longitude),
        latitude:         parseFloat(form.latitude),
        has_electricity:  Boolean(form.has_electricity),
        housing_material: form.housing_material || null,
        housing_roof:     form.housing_roof     || null,
        housing_floor:    form.housing_floor    || null,
        tenure_status:    form.tenure_status    || null,
        o12_fuel_for_lighting: form.o12_fuel_for_lighting || null,
        o13_fuel_for_cooking:  form.o13_fuel_for_cooking  || null,
        water_source:     form.water_source     || null,
        toilet_type:      form.toilet_type      || null,
        surveyed_date:    form.surveyed_date    || null,


        is_4ps_beneficiary:           form.is_4ps_beneficiary,
        overcrowding_status:          form.overcrowding_status,
        food_insecurity_score:        form.food_insecurity_score !== "" ? parseFloat(form.food_insecurity_score) : null,
        has_formal_financial_account: form.has_formal_financial_account,
        has_social_insurance:         form.has_social_insurance,
        knows_evacuation_location:    form.knows_evacuation_location,
        knows_emergency_hotline:      form.knows_emergency_hotline,

      };
      if (isEdit) {
        await updateHousehold(existing.household_id, payload);
        onSaved();
      } else {
        const res = await createHousehold(payload);
        setNewHHId(res.data.household_id);
        setStep(2);
      }
    } catch (err) {
      const d = err.response?.data;
      if (d?.details)    setErrors(d.details);
      else if (d?.error) setErrors([d.error]);
      else if (err.response?.status === 409) setErrors(["Household number already exists!"]);
      else setErrors([`Error ${err.response?.status || "unknown"}: ${JSON.stringify(d) || "Something went wrong"}`]);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 ────────────────────────────────────────────────────────────────
  const handleStep2 = async e => {
    e.preventDefault();
    if (members.length === 0) { setErrors(["Add at least 1 member."]); return; }
    const noNameIdx = members.findIndex(m => !m.full_name || !m.full_name.trim());
    if (noNameIdx !== -1) { setErrors([`Member ${noNameIdx + 1}: Full name is required.`]); return; }
    const badIdx = members.findIndex(m => !m.age || isNaN(parseInt(m.age)));
    if (badIdx !== -1) { setErrors([`Member ${badIdx + 1}: Age is required.`]); return; }
    const noRelIdx = members.findIndex(m => !m.relationship_to_hh);
    if (noRelIdx !== -1) { setErrors([`Member ${noRelIdx + 1}: Relationship to household head is required.`]); return; }
    const headCount = members.filter(m => m.relationship_to_hh === "Household Head").length;
    if (headCount === 0) { setErrors(["Please mark one member as Household Head."]); return; }
    if (headCount > 1)   { setErrors(["Only one member can be the Household Head."]); return; }

    setLoading(true);
    setErrors([]);
    try {
      const headers = getAuthHeaders();
      for (const m of members) {
        await axios.post(
          `/api/households/${newHHId}/members`,
          {
            age:            parseInt(m.age),
            civil_status:   m.civil_status   || null,
            occupation:     m.occupation     || null,
            full_name:                m.full_name || null,
            gender:                   m.gender || null,
            educational_attainment:   m.educational_attainment || null,
            monthly_income:      m.monthly_income !== "" ? parseFloat(m.monthly_income) : null,
            relationship_to_hh:  m.relationship_to_hh || null,
            is_household_head:   !!m.is_household_head,
            is_senior:           !!m.is_senior,
            is_pwd:         !!m.is_pwd,
            is_solo_parent: !!m.is_solo_parent,
            is_4ps:         !!m.is_4ps,
          },
          { headers }
        );
      }
      // Sync summed income back to tbl_households.monthly_income
      await axios.patch(`/api/households/${newHHId}/sync-income`, {}, { headers });
      setStep(3);
    } catch (err) {
      const d = err.response?.data;
      setErrors([d?.error || d?.message || "Failed to save members."]);
    } finally {
      setLoading(false);
    }
  };

  const updateMember = (i, updated) => setMembers(ms => ms.map((m, idx) => idx === i ? updated : m));
  const removeMember = i => setMembers(ms => ms.filter((_, idx) => idx !== i));
  const addMember    = () => setMembers(ms => [...ms, blankMember()]);
  const totalIncome  = members.reduce((s, m) => s + (parseFloat(m.monthly_income) || 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>

      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: step === 2 ? 700 : 580, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden", animation: "hhModalIn 0.2s ease", transition: "max-width 0.3s ease" }}>
        <style>{`@keyframes hhModalIn { from{opacity:0;transform:translateY(-14px) scale(0.98)} to{opacity:1;transform:translateY(0) scale(1)} }`}</style>

        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#1a237e 0%,#1565c0 100%)", padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>
              {isEdit ? "Edit Household" : step === 3 ? "Household Added!" : "Add New Household"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 }}>
              {isEdit ? `Editing: ${existing.household_number}`
                : step === 1 ? "Step 1 of 2 — Fill in household details"
                : step === 2 ? `Step 2 of 2 — Add members to ${form.household_number}`
                : "All data saved successfully"}
            </div>
          </div>
          <button type="button" onClick={onCancel} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {!isEdit && <StepBar step={step} />}

        {/* Errors */}
        {errors.length > 0 && (
          <div style={{ background: "#fff3f3", borderBottom: "1px solid #ffcdd2", padding: "10px 22px", fontSize: 12, color: "#c62828" }}>
            {errors.map((e, i) => <div key={i} style={{ display: "flex", gap: 6, marginBottom: i < errors.length-1 ? 4 : 0 }}><span>⚠</span>{e}</div>)}
          </div>
        )}

        {/* STEP 1 */}
        {(step === 1 || isEdit) && (
          <form onSubmit={handleStep1}>
            <div style={{ padding: "16px 22px", maxHeight: "62vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>

              <Field label="Barangay" required>
                <select name="barangay_id" value={form.barangay_id} onChange={handleChange} required style={FIELD_STYLE}>
                  <option value="">-- Select Barangay --</option>
                  {barangays.map(b => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
                </select>
              </Field>

              {!isEdit && (
                <Field label="Household No." required hint={form.barangay_id ? "Auto-generated — edit only if needed" : "Select a barangay first"}>
                  <div style={{ position: "relative" }}>
                    <input name="household_number" value={form.household_number}
                      onChange={handleChange} placeholder={autoNumLoading ? "Generating…" : "Select a barangay first"}
                      required readOnly={autoNumLoading}
                      style={{ ...FIELD_STYLE, background: autoNumLoading ? "#f0f4ff" : "#fafbff", color: autoNumLoading ? "#888" : "#333" }} />
                    {autoNumLoading && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#1565c0" }}>⟳</span>}
                  </div>
                </Field>
              )}

              {/* ── Location pin — required. Coordinates drive hazard_engine.py's
                   flood/landslide detection automatically on save. ── */}
              <Field label="Household Location" required hint="Click the map to pin the exact location">
                <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #e0e0e0", height: 220 }}>
                  <MapContainer
                    center={form.latitude && form.longitude ? [parseFloat(form.latitude), parseFloat(form.longitude)] : DEFAULT_MAP_CENTER}
                    zoom={form.latitude && form.longitude ? 16 : 13}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap contributors'
                    />
                    {floodGeojson && (
                      <GeoJSON
                        data={floodGeojson}
                        interactive={false}
                        style={feature => ({
                          fillColor: getFloodColor(feature.properties?.FloodSusc),
                          fillOpacity: 0.45,
                          color: getFloodColor(feature.properties?.FloodSusc),
                          weight: 1,
                        })}
                      />
                    )}
                    {boundariesGeojson && (
                      <GeoJSON
                        data={boundariesGeojson}
                        interactive={false}
                        style={{ fillOpacity: 0, color: "#1e3a8a", weight: 2.5, opacity: 0.9 }}
                      />
                    )}
                    <LocationClickHandler onPick={handlePinPick} />
                    {form.latitude && form.longitude && (
                      <Marker position={[parseFloat(form.latitude), parseFloat(form.longitude)]} icon={pinIcon} />
                    )}
                  </MapContainer>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 5, fontSize: 10, color: "#666" }}>
                  <span style={{ fontWeight: 700, color: "#999" }}>FLOOD SUSCEPTIBILITY:</span>
                  {FLOOD_LEGEND.map(l => (
                    <span key={l.code} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: getFloodColor(l.code), display: "inline-block", border: "1px solid rgba(0,0,0,0.15)" }} />
                      {l.label}
                    </span>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: "#777", marginTop: 5 }}>
                  📍 {form.latitude && form.longitude ? `${form.latitude}, ${form.longitude}` : "No location pinned yet — click the map above"}
                </div>

                {barangayAutoNote && (
                  <div style={{ fontSize: 11, marginTop: 3, color: barangayAutoNote.startsWith("⚠") ? "#b45309" : "#1565c0", fontWeight: 600 }}>
                    {barangayAutoNote}
                  </div>
                )}

                {(hazardLoading || hazardError || hazardPreview) && (
                  <div style={{ marginTop: 6, padding: "9px 12px", borderRadius: 8, background: "#f5f8ff", border: "1px solid #dbe6fb", fontSize: 12 }}>
                    {hazardLoading ? (
                      <span style={{ color: "#1565c0" }}>⟳ Computing hazard exposure from coordinates…</span>
                    ) : hazardError ? (
                      <span style={{ color: "#c62828" }}>⚠ {hazardError}</span>
                    ) : hazardPreview ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                        <span><b>Flood:</b> {hazardPreview.flood_exposure || "None"}</span>
                        <span><b>Landslide:</b> {hazardPreview.landslide_exposure || "None"}</span>
                        <span><b>Score:</b> {hazardPreview.hazard_exposure_score ?? "—"}/4</span>
                        <span style={{ color: "#666" }}>{hazardPreview.hazard_data_status}</span>
                        {hazardPreview.compound_hazard && (
                          <span style={{ color: "#c62828", fontWeight: 700 }}>⚠ Compound hazard zone</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Housing Material">
                  <select name="housing_material" value={form.housing_material || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(HOUSING_MATERIALS, form.housing_material).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Tenure Status">
                  <select name="tenure_status" value={form.tenure_status || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(TENURE_STATUSES, form.tenure_status).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Water Source">
                  <select name="water_source" value={form.water_source || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(WATER_SOURCES, form.water_source).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Toilet Type">
                  <select name="toilet_type" value={form.toilet_type || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(TOILET_TYPES, form.toilet_type).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Surveyed Date">
                  <input type="date" name="surveyed_date" value={form.surveyed_date || ""} onChange={handleChange} style={FIELD_STYLE} />
                </Field>
                <Field label="Has Electricity">
                  <div style={{ paddingTop: 6 }}>
                    <Toggle checked={form.has_electricity}
                      onChange={e => setForm(f => ({ ...f, has_electricity: e.target.checked }))}
                      labelOn="Yes — has electricity" labelOff="No — no electricity" />
                  </div>
                </Field>
              </div>

              {/* ── Housing detail (roof / floor / fuel) — CBMS-aligned, not covered by Housing Material ── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1565c0", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 }}>Housing Detail</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Roof Material">
                  <select name="housing_roof" value={form.housing_roof || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(HOUSING_ROOFS, form.housing_roof).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Floor Material">
                  <select name="housing_floor" value={form.housing_floor || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(HOUSING_FLOORS, form.housing_floor).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Fuel for Lighting">
                  <select name="o12_fuel_for_lighting" value={form.o12_fuel_for_lighting || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(LIGHTING_FUELS, form.o12_fuel_for_lighting).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Fuel for Cooking">
                  <select name="o13_fuel_for_cooking" value={form.o13_fuel_for_cooking || ""} onChange={handleChange} style={FIELD_STYLE}>
                    <option value="">-- Select --</option>
                    {withCurrentValue(COOKING_FUELS, form.o13_fuel_for_cooking).map(v => <option key={v}>{v}</option>)}
                  </select>
                </Field>
              </div>

              {/* ── Social program & disaster readiness ── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1565c0", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 }}>Social Program &amp; Readiness</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="4Ps Beneficiary">
                  <StringToggle value={form.is_4ps_beneficiary} onOn="Yes" onOff="No"
                    onChange={v => setForm(f => ({ ...f, is_4ps_beneficiary: v }))} />
                </Field>
                <Field label="Overcrowded Household">
                  <StringToggle value={form.overcrowding_status} onOn="Yes" onOff="No"
                    onChange={v => setForm(f => ({ ...f, overcrowding_status: v }))} />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Formal Financial Account">
                  <StringToggle value={form.has_formal_financial_account} onOn="Yes" onOff="No"
                    onChange={v => setForm(f => ({ ...f, has_formal_financial_account: v }))} />
                </Field>
                <Field label="Social Insurance">
                  <StringToggle value={form.has_social_insurance} onOn="Yes" onOff="No"
                    onChange={v => setForm(f => ({ ...f, has_social_insurance: v }))} />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Knows Evacuation Location">
                  <StringToggle value={form.knows_evacuation_location} onOn="Yes" onOff="No"
                    onChange={v => setForm(f => ({ ...f, knows_evacuation_location: v }))} />
                </Field>
                <Field label="Knows Emergency Hotline">
                  <StringToggle value={form.knows_emergency_hotline} onOn="Yes" onOff="No"
                    onChange={v => setForm(f => ({ ...f, knows_emergency_hotline: v }))} />
                </Field>
              </div>
              <Field label="Food Insecurity Score (0–8)" hint="From CBMS food insecurity module; leave blank if unsurveyed">
                <input type="number" min="0" max="8" name="food_insecurity_score"
                  value={form.food_insecurity_score} onChange={handleChange}
                  placeholder="0" style={FIELD_STYLE} />
              </Field>
            </div>

            <div style={{ padding: "14px 22px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end", gap: 8, background: "#fafbff" }}>
              <button type="button" onClick={onCancel} style={{ padding: "9px 20px", borderRadius: 7, fontSize: 13, border: "1px solid #ddd", background: "#fff", color: "#555", cursor: "pointer", fontWeight: 500 }}>Cancel</button>
              <button type="submit" disabled={loading || autoNumLoading} style={{ padding: "9px 24px", borderRadius: 7, fontSize: 13, border: "none", background: loading ? "#90caf9" : "linear-gradient(135deg,#1a237e,#1565c0)", color: "#fff", cursor: loading || autoNumLoading ? "not-allowed" : "pointer", fontWeight: 700, boxShadow: "0 3px 10px rgba(21,101,192,0.3)" }}>
                {loading ? "Saving…" : isEdit ? "Save Changes" : "Next: Add Members →"}
              </button>
            </div>
          </form>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <form onSubmit={handleStep2}>
            <div style={{ padding: "16px 22px", maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "#666" }}>Add all members. At least <b>1</b> is needed to compute vulnerability.</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1565c0" }}>{members.length} member{members.length !== 1 ? "s" : ""}</span>
              </div>

              <IncomeSummary members={members} />

              {members.map((m, i) => (
                <MemberCard key={i} member={m} index={i} onChange={updateMember} onRemove={removeMember} />
              ))}

              <button type="button" onClick={addMember} style={{ border: "2px dashed #bbdefb", background: "#f0f7ff", borderRadius: 10, padding: 11, color: "#1565c0", cursor: "pointer", fontSize: 13, fontWeight: 600, width: "100%" }}>
                + Add Another Member
              </button>
            </div>

            <div style={{ padding: "14px 22px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", gap: 8, background: "#fafbff" }}>
              <button type="button" onClick={() => { setErrors([]); setStep(1); }} style={{ padding: "9px 18px", borderRadius: 7, fontSize: 13, border: "1px solid #ddd", background: "#fff", color: "#555", cursor: "pointer", fontWeight: 500 }}>← Back</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => { setStep(3); setTimeout(onSaved, 1000); }} style={{ padding: "9px 18px", borderRadius: 7, fontSize: 13, border: "1px solid #ddd", background: "#fff", color: "#888", cursor: "pointer", fontWeight: 500 }}>Skip (add later)</button>
                <button type="submit" disabled={loading} style={{ padding: "9px 24px", borderRadius: 7, fontSize: 13, border: "none", background: loading ? "#90caf9" : "linear-gradient(135deg,#1a237e,#1565c0)", color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, boxShadow: "0 3px 10px rgba(21,101,192,0.3)" }}>
                  {loading ? "Saving…" : `Save ${members.length} Member${members.length !== 1 ? "s" : ""} & Finish`}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div style={{ padding: "36px 22px", textAlign: "center" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>✅</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#1a237e", marginBottom: 8 }}>Household successfully added!</div>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 10, lineHeight: 1.7 }}>
              <b>{form.household_number}</b> saved with <b>{members.length} member{members.length !== 1 ? "s" : ""}</b>
              {totalIncome > 0 && <> · Total income: <b>₱{totalIncome.toLocaleString()}/mo</b></>}
            </div>
            <div style={{ fontSize: 12, color: "#777", background: "#f5f5f5", borderRadius: 8, padding: "10px 14px", marginBottom: 24, lineHeight: 1.8, textAlign: "left" }}>
              🔄 Vulnerability score is computing in the background<br />
              🗺 Map dot will appear on the Spatial Vulnerability Map<br />
              🌐 Network graph ready under Family Network Analysis
            </div>
            <button onClick={onSaved} style={{ padding: "11px 36px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1a237e,#1565c0)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 3px 10px rgba(21,101,192,0.3)" }}>
              Back to Households
            </button>
          </div>
        )}
      </div>
    </div>
  );
}