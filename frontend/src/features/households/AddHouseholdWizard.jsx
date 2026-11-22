import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { MapContainer, TileLayer, GeoJSON, Marker, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  getBarangays, getGISBarangays, getHouseholdFormOptions, createHouseholdManual, cbmsImportStatus,
} from "../../api/api";

// Add a household by hand, using the same questions and codes as the CBMS 2024
// household questionnaire. The server turns the answers into the household's
// indicators exactly as it does for an imported household (hazard from the
// pin, typology, counts), then recalculates every score in the background.

const CENTER = [10.78, 122.47];
const RHU = [10.7815, 122.4647];
const FIRE = [10.7869, 122.4683];

const C = {
  text: "#1a237e", sub: "#455a90", muted: "#8892a8", border: "#e3e8f4", soft: "#f8faff",
  blue: "#1565c0", green: "#2e7d32", amber: "#b26a00", red: "#c62828",
};
const FIELD = {
  width: "100%", padding: "8px 11px", border: "1px solid #dfe5f1", borderRadius: 6, fontSize: 13,
  outline: "none", boxSizing: "border-box", background: "#fafbff", color: "#333",
};
const LABEL = { display: "block", fontSize: 11, fontWeight: 600, color: "#5a6480", marginBottom: 5 };

const FOOD = [
  ["g01_worried", "Worried they would not have enough food to eat"],
  ["g02_not_eaten_healthy", "Unable to eat healthy and nutritious food"],
  ["g03_ate_few_food", "Ate only a few kinds of food"],
  ["g04_skipped_meal", "Had to skip a meal"],
  ["g05_ate_less", "Ate less than they thought they should"],
  ["g06_ran_out_of_food", "The household ran out of food"],
  ["g07_hungry", "Were hungry but did not eat"],
  ["g08_not_eaten_whole_day", "Went without eating for a whole day"],
];
const FINANCE = [
  ["i01_a_bank_account", "Bank account"], ["i01_b_digital_bank_account", "Digital bank account"],
  ["i01_c_emoney_or_cash_card", "E-money / cash card"], ["i01_d_nssla", "NSSLA"],
  ["i01_e_account_with_coop", "Cooperative account"], ["i01_f_microfinance", "Microfinance"],
  ["i01_g_money_remittance", "Money remittance"],
];
const INSURANCE = [
  ["m01_a_sss", "SSS"], ["m01_b_gsis", "GSIS"], ["m01_c_philhealth", "PhilHealth"],
  ["m01_d_health_insurance", "Private health insurance"],
];

const pinIcon = L.divIcon({
  className: "", iconSize: [28, 40], iconAnchor: [14, 40],
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#c62828" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="5.5" fill="#fff"/></svg>`,
});

function floodColor(code) {
  return { VHF: "#000000", HF: "#2E3192", MF: "#92278F", LF: "#E6D6EC" }[code] || "#94a3b8";
}
function norm(name) {
  return (name || "").toLowerCase().replace(/brgy\.?\s*/i, "").replace(/barangay\s*/i, "")
    .replace(/ñ/g, "n").replace(/^sto\b/, "santo").replace(/^sta\b/, "santa")
    .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function featureName(f) {
  const p = f.properties || {};
  return p.Barangay_n || p.NAME_3 || p.name || p.BARANGAY || "";
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(pt, poly) {
  if (!poly?.length || !inRing(pt, poly[0])) return false;
  return !poly.slice(1).some(h => inRing(pt, h));
}
function featureAt(geo, lng, lat) {
  return (geo?.features || []).find(f => {
    const g = f.geometry; if (!g) return false;
    if (g.type === "Polygon") return inPoly([lng, lat], g.coordinates);
    if (g.type === "MultiPolygon") return g.coordinates.some(pc => inPoly([lng, lat], pc));
    return false;
  });
}
function km(a, b) {
  const R = 6371.0088, r = x => x * Math.PI / 180;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function authHeaders() {
  const t = localStorage.getItem("access_token") || localStorage.getItem("token") ||
    sessionStorage.getItem("access_token") || sessionStorage.getItem("token") || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function PickHandler({ onPick }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function Field({ label, required, hint, children, span }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gridColumn: span ? "1 / -1" : undefined }}>
      <label style={LABEL}>{label}{required && <span style={{ color: "#e53935", marginLeft: 2 }}>*</span>}</label>
      {children}
      {hint && <span style={{ fontSize: 10, color: "#98a0b4", marginTop: 3 }}>{hint}</span>}
    </div>
  );
}
function Select({ value, onChange, options, placeholder = "-- Select --", invalid }) {
  return (
    <select value={value ?? ""} onChange={e => onChange(e.target.value)}
      style={{ ...FIELD, borderColor: invalid ? "#f0a35e" : "#dfe5f1" }}>
      <option value="">{placeholder}</option>
      {(options || []).map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  );
}
function YesNo({ value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid #dfe5f1", borderRadius: 7, overflow: "hidden" }}>
      {[[true, "Yes"], [false, "No"]].map(([v, l]) => (
        <button key={l} type="button" onClick={() => onChange(v)} style={{
          padding: "6px 16px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
          background: value === v ? C.blue : "#fff", color: value === v ? "#fff" : C.sub,
        }}>{l}</button>
      ))}
    </div>
  );
}
function Check({ checked, onChange, children }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "#3c4560", cursor: "pointer", lineHeight: 1.4 }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: C.blue, width: 15, height: 15, marginTop: 1, flexShrink: 0 }} />
      <span>{children}</span>
    </label>
  );
}
function Section({ title, note, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</div>
      {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{note}</div>}
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}
const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

function blankMember(head = false) {
  return {
    first_name: "", middle_name: "", last_name: "", suffix: "",
    a02_relation_to_hh_head: head ? "1" : "", a03_sex: "", age: "", a07_marital_status: "",
    a11_hgc_level: "", pwd: false, solo_parent: false, in_school: false, employed: false,
    e05_occupation_group: "", ofw: false, nuclear_family: "1",
  };
}

const STEPS = ["Location", "House", "Household", "Members", "Review"];

export default function AddHouseholdWizard({ onSaved, onCancel }) {
  const [step, setStep] = useState(0);
  const [opts, setOpts] = useState(null);
  const [barangays, setBarangays] = useState([]);
  const [flood, setFlood] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [errors, setErrors] = useState([]);
  const [hazard, setHazard] = useState(null);
  const [hazardBusy, setHazardBusy] = useState(false);
  const [brgyNote, setBrgyNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [job, setJob] = useState(null);
  const pollRef = useRef(null);

  const [loc, setLoc] = useState({ barangay_id: "", latitude: "", longitude: "", surveyed_date: new Date().toISOString().slice(0, 10) });
  const [ans, setAns] = useState({
    o03_roof: "", o04_outer_walls: "", o06_floor: "", o09_tenure: "", o11_electricity: true,
    o12_fuel_for_lighting: "", o13_fuel_for_cooking: "", n01_main_water: "", water_over_30min: false,
    n08_toilet_facility: "", n10_share_toilet: false, k01_internet_access: true, overcrowding_status: false,
    m05_a_4ps: false, j02_location_of_evacuation: true, j03_contact_hotline: true,
  });
  const [members, setMembers] = useState([blankMember(true)]);

  useEffect(() => {
    getHouseholdFormOptions().then(r => setOpts(r.data.options)).catch(() => setErrors(["Could not load the form choices from the server."]));
    getBarangays().then(r => setBarangays(r.data?.data || r.data || [])).catch(() => {});
    getGISBarangays().then(r => setBounds(r.data)).catch(() => {});
    axios.get("/api/gis/flood", { headers: authHeaders() }).then(r => setFlood(r.data)).catch(() => {});
    return () => clearTimeout(pollRef.current);
  }, []);

  const setA = (k, v) => setAns(a => ({ ...a, [k]: v }));
  const setM = (i, patch) => setMembers(ms => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const onPick = useCallback(async (lat, lng) => {
    setLoc(l => ({ ...l, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
    const f = featureAt(bounds, lng, lat);
    if (f) {
      const n = norm(featureName(f));
      const hit = barangays.find(b => norm(b.barangay_name) === n) ||
        barangays.find(b => norm(b.barangay_name).includes(n) || n.includes(norm(b.barangay_name)));
      if (hit) { setLoc(l => ({ ...l, barangay_id: String(hit.barangay_id) })); setBrgyNote(`Barangay detected from the pin: ${hit.barangay_name}`); }
      else setBrgyNote("Choose the barangay — the pin's area name didn't match the barangay list.");
    } else setBrgyNote("The pin is outside the mapped barangay boundaries — check the location.");
    setHazardBusy(true);
    try {
      const r = await axios.get(`/api/households/hazard-preview?longitude=${lng}&latitude=${lat}`, { headers: authHeaders() });
      setHazard(r.data);
    } catch { setHazard(null); }
    setHazardBusy(false);
  }, [bounds, barangays]);

  // ── per-step checks (the server re-checks everything) ──
  const stepErrors = (s) => {
    const e = [];
    if (s === 0) {
      if (!loc.latitude) e.push("Pin the household's location on the map.");
      if (!loc.barangay_id) e.push("Choose the barangay.");
    }
    if (s === 1) {
      [["o03_roof", "roof"], ["o04_outer_walls", "outer walls"], ["o06_floor", "floor"], ["o09_tenure", "tenure"],
       ["o12_fuel_for_lighting", "fuel for lighting"], ["o13_fuel_for_cooking", "fuel for cooking"],
       ["n01_main_water", "main water source"], ["n08_toilet_facility", "toilet facility"]]
        .forEach(([k, l]) => { if (!ans[k]) e.push(`Choose the ${l}.`); });
    }
    if (s === 3) {
      if (!members.length) e.push("Add at least one member.");
      const heads = members.filter(m => m.a02_relation_to_hh_head === "1").length;
      if (heads !== 1) e.push("Exactly one member must be the household head.");
      members.forEach((m, i) => {
        const n = i + 1;
        if (!m.first_name.trim() || !m.last_name.trim()) e.push(`Member ${n}: first and last name are required.`);
        const a = parseInt(m.age, 10);
        if (Number.isNaN(a) || a < 0 || a > 120) e.push(`Member ${n}: enter an age from 0 to 120.`);
        if (!m.a02_relation_to_hh_head) e.push(`Member ${n}: choose the relationship to the head.`);
        if (!m.a03_sex) e.push(`Member ${n}: choose the sex.`);
      });
    }
    return e;
  };
  const next = () => {
    const e = stepErrors(step);
    setErrors(e);
    if (!e.length) setStep(s => s + 1);
  };

  const derived = useMemo(() => {
    const ages = members.map(m => parseInt(m.age, 10)).filter(a => !Number.isNaN(a));
    const wa = ages.filter(a => a >= 15 && a <= 59).length;
    const dep = ages.filter(a => a < 15 || a >= 60).length;
    const food = FOOD.filter(([k]) => ans[k]).length;
    const lat = parseFloat(loc.latitude), lng = parseFloat(loc.longitude);
    return {
      size: members.length,
      seniors: ages.filter(a => a >= 60).length,
      pwd: members.filter(m => m.pwd).length,
      solo: members.filter(m => m.solo_parent && parseInt(m.age, 10) >= 10).length,
      employed: members.filter(m => m.employed && parseInt(m.age, 10) >= 15).length,
      depRatio: wa ? (dep / wa).toFixed(2) : "—",
      food,
      financial: FINANCE.some(([k]) => ans[k]),
      rhu: Number.isNaN(lat) ? null : km([lat, lng], RHU),
      fire: Number.isNaN(lat) ? null : km([lat, lng], FIRE),
    };
  }, [members, ans, loc]);

  async function save() {
    const e = [0, 1, 3].flatMap(stepErrors);
    if (e.length) { setErrors(e); return; }
    setSaving(true); setErrors([]);
    try {
      const payload = {
        ...loc, barangay_id: parseInt(loc.barangay_id, 10),
        latitude: parseFloat(loc.latitude), longitude: parseFloat(loc.longitude),
        answers: ans,
        members: members.map(m => ({ ...m, age: parseInt(m.age, 10) })),
      };
      const r = await createHouseholdManual(payload);
      setSaved(r.data);
      poll(r.data.job_id);
    } catch (err) {
      const d = err.response?.data;
      setErrors(d?.errors || [d?.error || err.message || "Could not save the household."]);
    }
    setSaving(false);
  }
  function poll(id) {
    cbmsImportStatus(id).then(r => {
      setJob(r.data);
      if (["running", "queued"].includes(r.data.state)) pollRef.current = setTimeout(() => poll(id), 1500);
    }).catch(() => { pollRef.current = setTimeout(() => poll(id), 3000); });
  }

  const optsReady = !!opts;
  const brgyName = barangays.find(b => String(b.barangay_id) === String(loc.barangay_id))?.barangay_name;
  const lbl = (field, code) => (opts?.[field] || []).find(o => o.code === String(code))?.label || "—";

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 760, maxHeight: "92vh",
      display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden" }}>
      {/* header */}
      <div style={{ background: "linear-gradient(135deg,#1a237e 0%,#1565c0 100%)", padding: "16px 22px",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>{saved ? "Household added" : "Add household"}</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 }}>
            {saved ? `${saved.household_number} · ${job && !["running", "queued"].includes(job.state) ? "scores updated" : "scores are being recalculated"}`
              : "Same questions and codes as the CBMS 2024 household questionnaire"}
          </div>
        </div>
        <button type="button" onClick={saved ? () => onSaved(saved.household_id) : onCancel} style={{
          background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 30, height: 30,
          borderRadius: "50%", cursor: "pointer", fontSize: 15, fontWeight: 700 }}>✕</button>
      </div>

      {/* steps */}
      {!saved && (
        <div style={{ display: "flex", gap: 6, padding: "12px 22px 0", flexShrink: 0 }}>
          {STEPS.map((s, i) => (
            <button key={s} type="button" onClick={() => { if (i < step) { setErrors([]); setStep(i); } }}
              style={{ flex: 1, textAlign: "left", border: "none", background: "none", padding: 0,
                cursor: i < step ? "pointer" : "default" }}>
              <div style={{ height: 3, borderRadius: 2, background: i <= step ? C.blue : "#e3e8f4" }} />
              <div style={{ fontSize: 10.5, marginTop: 5, fontWeight: i === step ? 700 : 500,
                color: i <= step ? C.blue : C.muted }}>{i + 1}. {s}</div>
            </button>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ margin: "12px 22px 0", background: "#fff3f3", border: "1px solid #ffcdd2", borderRadius: 8,
          padding: "8px 12px", fontSize: 12, color: C.red }}>
          {errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}

      <div style={{ padding: "4px 22px 18px", overflowY: "auto", flex: 1 }}>
        {!optsReady && !saved && <div style={{ padding: 30, textAlign: "center", color: C.muted, fontSize: 13 }}>Loading…</div>}

        {/* 1. LOCATION */}
        {optsReady && !saved && step === 0 && (
          <>
            <Section title="Where is the house?" note="Click the map to pin it. Flood and landslide exposure and the distance to the RHU and fire station come from this pin.">
              <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #e0e0e0", height: 260 }}>
                <MapContainer center={loc.latitude ? [parseFloat(loc.latitude), parseFloat(loc.longitude)] : CENTER}
                  zoom={loc.latitude ? 16 : 13} style={{ height: "100%", width: "100%" }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                  {flood && <GeoJSON data={flood} interactive={false} style={f => ({
                    fillColor: floodColor(f.properties?.FloodSusc), fillOpacity: 0.4,
                    color: floodColor(f.properties?.FloodSusc), weight: 1 })} />}
                  {bounds && <GeoJSON data={bounds} interactive={false} style={{ fillOpacity: 0, color: "#1e3a8a", weight: 2, opacity: 0.8 }} />}
                  <PickHandler onPick={onPick} />
                  {loc.latitude && <Marker position={[parseFloat(loc.latitude), parseFloat(loc.longitude)]} icon={pinIcon} />}
                </MapContainer>
              </div>
              <div style={{ fontSize: 11, color: "#6b7590", marginTop: 6 }}>
                {loc.latitude ? `${loc.latitude}, ${loc.longitude}` : "No pin yet"}
                {brgyNote && <span style={{ marginLeft: 10, color: brgyNote.startsWith("Barangay") ? C.blue : C.amber, fontWeight: 600 }}>{brgyNote}</span>}
              </div>
              {(hazardBusy || hazard) && (
                <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: C.soft, border: `1px solid ${C.border}`,
                  fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {hazardBusy ? <span style={{ color: C.blue }}>Checking hazard zones…</span> : (<>
                    <span><b>Flood:</b> {hazard.flood_exposure || "none"}</span>
                    <span><b>Landslide:</b> {hazard.landslide_exposure || "none"}</span>
                    <span style={{ color: C.muted }}>{hazard.hazard_data_status}</span>
                    {derived.rhu != null && <span><b>RHU:</b> {derived.rhu.toFixed(2)} km</span>}
                    {derived.fire != null && <span><b>Fire station:</b> {derived.fire.toFixed(2)} km</span>}
                  </>)}
                </div>
              )}
            </Section>
            <div style={{ ...grid2, marginTop: 14 }}>
              <Field label="Barangay" required>
                <select value={loc.barangay_id} onChange={e => setLoc(l => ({ ...l, barangay_id: e.target.value }))} style={FIELD}>
                  <option value="">-- Select --</option>
                  {barangays.map(b => <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>)}
                </select>
              </Field>
              <Field label="Date interviewed">
                <input type="date" value={loc.surveyed_date} onChange={e => setLoc(l => ({ ...l, surveyed_date: e.target.value }))} style={FIELD} />
              </Field>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
              The household code (e.g. “{brgyName || "Brgy X"} - HH…”) is given automatically when you save.
            </div>
          </>
        )}

        {/* 2. HOUSE */}
        {optsReady && !saved && step === 1 && (
          <>
            <Section title="Building">
              <div style={grid2}>
                <Field label="Roof (O3)" required><Select value={ans.o03_roof} onChange={v => setA("o03_roof", v)} options={opts.o03_roof} /></Field>
                <Field label="Outer walls (O4)" required><Select value={ans.o04_outer_walls} onChange={v => setA("o04_outer_walls", v)} options={opts.o04_outer_walls} /></Field>
                <Field label="Floor (O6)" required><Select value={ans.o06_floor} onChange={v => setA("o06_floor", v)} options={opts.o06_floor} /></Field>
                <Field label="Tenure (O9)" required><Select value={ans.o09_tenure} onChange={v => setA("o09_tenure", v)} options={opts.o09_tenure} /></Field>
                <Field label="Overcrowded (not enough space for the members)"><YesNo value={ans.overcrowding_status} onChange={v => setA("overcrowding_status", v)} /></Field>
                <Field label="Internet access at home or through a mobile device (K1)"><YesNo value={ans.k01_internet_access} onChange={v => setA("k01_internet_access", v)} /></Field>
              </div>
            </Section>
            <Section title="Power and fuel">
              <div style={grid2}>
                <Field label="Has electricity (O11)"><YesNo value={ans.o11_electricity} onChange={v => setA("o11_electricity", v)} /></Field>
                <div />
                <Field label="Fuel for lighting (O12)" required><Select value={ans.o12_fuel_for_lighting} onChange={v => setA("o12_fuel_for_lighting", v)} options={opts.o12_fuel_for_lighting} /></Field>
                <Field label="Fuel for cooking (O13)" required><Select value={ans.o13_fuel_for_cooking} onChange={v => setA("o13_fuel_for_cooking", v)} options={opts.o13_fuel_for_cooking} /></Field>
              </div>
            </Section>
            <Section title="Water and toilet">
              <div style={grid2}>
                <Field label="Main source of water (N1)" required><Select value={ans.n01_main_water} onChange={v => setA("n01_main_water", v)} options={opts.n01_main_water} /></Field>
                <Field label="Fetching water takes more than 30 minutes (round trip)"><YesNo value={ans.water_over_30min} onChange={v => setA("water_over_30min", v)} /></Field>
                <Field label="Toilet facility (N8)" required><Select value={ans.n08_toilet_facility} onChange={v => setA("n08_toilet_facility", v)} options={opts.n08_toilet_facility} /></Field>
                <Field label="Toilet shared with other households (N10)"><YesNo value={ans.n10_share_toilet} onChange={v => setA("n10_share_toilet", v)} /></Field>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>The water and sanitation service levels are worked out from these answers, as in the CBMS.</div>
            </Section>
          </>
        )}

        {/* 3. HOUSEHOLD */}
        {optsReady && !saved && step === 2 && (
          <>
            <Section title="Food security (G1–G8)" note="In the past 12 months, was there a time when, because of a lack of money or other resources, a household member…">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {FOOD.map(([k, l]) => <Check key={k} checked={ans[k]} onChange={v => setA(k, v)}>{l}</Check>)}
              </div>
            </Section>
            <Section title="Financial accounts (I1)" note="Tick every kind of account a member of the household has.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {FINANCE.map(([k, l]) => <Check key={k} checked={ans[k]} onChange={v => setA(k, v)}>{l}</Check>)}
              </div>
            </Section>
            <Section title="Social protection (M1, M5)">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {INSURANCE.map(([k, l]) => <Check key={k} checked={ans[k]} onChange={v => setA(k, v)}>{l}</Check>)}
              </div>
              <div style={{ ...grid2, marginTop: 12 }}>
                <Field label="4Ps beneficiary household"><YesNo value={ans.m05_a_4ps} onChange={v => setA("m05_a_4ps", v)} /></Field>
              </div>
            </Section>
            <Section title="Disaster preparedness (J2, J3)">
              <div style={grid2}>
                <Field label="Knows where to evacuate"><YesNo value={ans.j02_location_of_evacuation} onChange={v => setA("j02_location_of_evacuation", v)} /></Field>
                <Field label="Knows the emergency hotline"><YesNo value={ans.j03_contact_hotline} onChange={v => setA("j03_contact_hotline", v)} /></Field>
              </div>
            </Section>
          </>
        )}

        {/* 4. MEMBERS */}
        {optsReady && !saved && step === 3 && (
          <Section title={`Household members (${members.length})`} note="List everyone who usually lives in the house, starting with the head.">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {members.map((m, i) => {
                const age = parseInt(m.age, 10);
                const known = !Number.isNaN(age);
                return (
                  <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: "#fcfdff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>
                        Member {i + 1}{m.a02_relation_to_hh_head === "1" && <span style={{ marginLeft: 8, fontSize: 10.5, color: "#fff", background: C.blue, padding: "1px 7px", borderRadius: 9 }}>Head</span>}
                      </span>
                      {members.length > 1 && (
                        <button type="button" onClick={() => setMembers(ms => ms.filter((_, j) => j !== i))}
                          style={{ background: "#ffebee", border: "none", color: C.red, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Remove</button>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 70px", gap: 10 }}>
                      <Field label="First name" required><input value={m.first_name} onChange={e => setM(i, { first_name: e.target.value })} style={FIELD} /></Field>
                      <Field label="Middle name"><input value={m.middle_name} onChange={e => setM(i, { middle_name: e.target.value })} style={FIELD} /></Field>
                      <Field label="Last name" required><input value={m.last_name} onChange={e => setM(i, { last_name: e.target.value })} style={FIELD} /></Field>
                      <Field label="Suffix"><input value={m.suffix} onChange={e => setM(i, { suffix: e.target.value })} style={FIELD} placeholder="Jr." /></Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 80px 1.2fr", gap: 10, marginTop: 10 }}>
                      <Field label="Relationship to head (A2)" required><Select value={m.a02_relation_to_hh_head} onChange={v => setM(i, { a02_relation_to_hh_head: v })} options={opts.a02_relation_to_hh_head} /></Field>
                      <Field label="Sex (A3)" required><Select value={m.a03_sex} onChange={v => setM(i, { a03_sex: v })} options={opts.a03_sex} /></Field>
                      <Field label="Age" required><input type="number" min="0" max="120" value={m.age} onChange={e => setM(i, { age: e.target.value })} style={FIELD} /></Field>
                      <Field label="Marital status (A7)"><Select value={m.a07_marital_status} onChange={v => setM(i, { a07_marital_status: v })} options={opts.a07_marital_status} /></Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                      <Field label="Highest grade completed (A11)"><Select value={m.a11_hgc_level} onChange={v => setM(i, { a11_hgc_level: v })} options={opts.a11_hgc_level} placeholder="-- None / not yet --" /></Field>
                      <Field label="Nuclear family no. (B1)" hint="1 = the head's family">
                        <input type="number" min="1" max="9" value={m.nuclear_family} onChange={e => setM(i, { nuclear_family: e.target.value })} style={FIELD} />
                      </Field>
                      {known && age >= 15 && m.employed ? (
                        <Field label="Occupation group (E5)"><Select value={m.e05_occupation_group} onChange={v => setM(i, { e05_occupation_group: v })} options={opts.e05_occupation_group} /></Field>
                      ) : <div />}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 12 }}>
                      <Check checked={m.pwd} onChange={v => setM(i, { pwd: v })}>Person with disability</Check>
                      {(!known || age >= 10) && <Check checked={m.solo_parent} onChange={v => setM(i, { solo_parent: v })}>Solo parent</Check>}
                      {(!known || age >= 3) && <Check checked={m.in_school} onChange={v => setM(i, { in_school: v })}>Attending school</Check>}
                      {(!known || age >= 15) && <Check checked={m.employed} onChange={v => setM(i, { employed: v })}>Employed / has work</Check>}
                      {(!known || age >= 15) && <Check checked={m.ofw} onChange={v => setM(i, { ofw: v })}>Overseas Filipino worker</Check>}
                      {known && age >= 60 && <span style={{ fontSize: 11.5, color: C.green, fontWeight: 600 }}>Senior citizen (60+)</span>}
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={() => setMembers(ms => [...ms, blankMember(false)])}
                style={{ border: "2px dashed #bbdefb", background: "#f0f7ff", borderRadius: 10, padding: 10, color: C.blue, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                + Add another member
              </button>
            </div>
          </Section>
        )}

        {/* 5. REVIEW */}
        {optsReady && !saved && step === 4 && (
          <>
            <Section title="Check before saving">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {[
                  [derived.size, "members"], [derived.seniors, "seniors (60+)"], [derived.pwd, "with disability"],
                  [derived.solo, "solo parents"], [derived.employed, "employed"], [derived.depRatio, "dependency ratio"],
                  [`${derived.food}/8`, "food-insecurity answers"], [derived.financial ? "Yes" : "No", "has a financial account"],
                ].map(([v, l]) => (
                  <div key={l} style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: "9px 11px" }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{v}</div>
                    <div style={{ fontSize: 10.5, color: C.muted }}>{l}</div>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Summary">
              <div style={{ fontSize: 12.5, color: "#3c4560", lineHeight: 1.9 }}>
                <div><b>{brgyName}</b> · {loc.latitude}, {loc.longitude} · interviewed {loc.surveyed_date}</div>
                <div>Flood: {hazard?.flood_exposure || "none"} · Landslide: {hazard?.landslide_exposure || "none"}
                  {derived.rhu != null && <> · RHU {derived.rhu.toFixed(2)} km · Fire station {derived.fire.toFixed(2)} km</>}</div>
                <div>Roof: {lbl("o03_roof", ans.o03_roof)} · Walls: {lbl("o04_outer_walls", ans.o04_outer_walls)} · Floor: {lbl("o06_floor", ans.o06_floor)}</div>
                <div>Tenure: {lbl("o09_tenure", ans.o09_tenure)}</div>
                <div>Water: {lbl("n01_main_water", ans.n01_main_water)} · Toilet: {lbl("n08_toilet_facility", ans.n08_toilet_facility)}</div>
                <div>Head: {(() => { const h = members.find(m => m.a02_relation_to_hh_head === "1"); return h ? `${h.first_name} ${h.last_name}, ${h.age}` : "—"; })()}</div>
              </div>
            </Section>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 14, lineHeight: 1.6 }}>
              When you save, the household gets its code, its hazard exposure and typology right away. Then the
              barangay scores (SVI, Barangay Capacity, hazard), the family network and Ask the Data are
              recalculated so they include this household. That takes about a minute.
            </div>
          </>
        )}

        {/* DONE */}
        {saved && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
              {[
                [saved.household_number, "household code"],
                [saved.members, "members saved"],
                [saved.typology_cluster_label || "—", "typology"],
                [saved.flood_exposure || "none", "flood exposure"],
                [saved.landslide_exposure || "none", "landslide exposure"],
                [`${saved.rhu_km?.toFixed?.(2)} / ${saved.fire_km?.toFixed?.(2)} km`, "to RHU / fire station"],
              ].map(([v, l]) => (
                <div key={l} style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: "9px 11px" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{v}</div>
                  <div style={{ fontSize: 10.5, color: C.muted }}>{l}</div>
                </div>
              ))}
            </div>
            <Section title={!job || ["running", "queued"].includes(job.state) ? "Recalculating scores…" : job.state === "done" ? "Scores updated" : "Recalculation finished with problems"}>
              {(job?.steps || []).map(s => (
                <div key={s.label} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, padding: "5px 0",
                  borderBottom: `1px solid ${C.border}`, color: s.state === "pending" ? C.muted : C.text }}>
                  <span style={{ width: 14, textAlign: "center", fontWeight: 800,
                    color: s.state === "done" ? C.green : s.state === "failed" ? C.red : C.blue }}>
                    {s.state === "done" ? "✓" : s.state === "failed" ? "✕" : s.state === "running" ? "…" : "·"}
                  </span>
                  <span style={{ flex: 1 }}>{s.label}{s.state === "failed" && <span style={{ color: C.red }}> — {s.detail}</span>}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>You can close this window; the recalculation continues on the server.</div>
            </Section>
          </>
        )}
      </div>

      {/* footer */}
      <div style={{ padding: "12px 22px", borderTop: "1px solid #eef1f7", display: "flex", justifyContent: "space-between", background: "#fafbff", flexShrink: 0 }}>
        {saved ? <span /> : (
          <button type="button" onClick={step === 0 ? onCancel : () => { setErrors([]); setStep(s => s - 1); }}
            style={{ padding: "9px 18px", borderRadius: 7, fontSize: 13, border: "1px solid #ddd", background: "#fff", color: "#555", cursor: "pointer" }}>
            {step === 0 ? "Cancel" : "← Back"}
          </button>
        )}
        {saved ? (
          <button type="button" onClick={() => onSaved(saved.household_id)} style={primaryBtn(false)}>Back to households</button>
        ) : step < STEPS.length - 1 ? (
          <button type="button" disabled={!optsReady} onClick={next} style={primaryBtn(!optsReady)}>Next →</button>
        ) : (
          <button type="button" disabled={saving} onClick={save} style={primaryBtn(saving)}>{saving ? "Saving…" : "Save household"}</button>
        )}
      </div>
    </div>
  );
}

function primaryBtn(disabled) {
  return {
    padding: "9px 24px", borderRadius: 7, fontSize: 13, border: "none", fontWeight: 700,
    background: disabled ? "#90caf9" : "linear-gradient(135deg,#1a237e,#1565c0)", color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer", boxShadow: "0 3px 10px rgba(21,101,192,0.3)",
  };
}
