import { useState, useEffect } from "react";
import { getMembers, deleteIndividual, createIndividual, updateIndividual } from '../../api/api';

// ── Dropdown options — match HouseholdForm exactly ────────────────────────────
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

const CBMS_MEMBER_FIELDS = [
  "line_number", "religion", "employment_status", "nuclear_family",
  "relation_to_nuclear_family_head", "with_pwd_id",
  "birthday_month", "birthday_day", "birthday_year", "age_group_five_years",
  "estimated_monthly_income",
];

function blankForm() {
  const base = {
    full_name: "", gender: "", age: "", civil_status: "",
    occupation: "", educational_attainment: "", monthly_income: "",
    relationship_to_hh: "", is_household_head: false,
    is_senior: false, is_pwd: false, is_solo_parent: false, is_4ps: false,
  };
  CBMS_MEMBER_FIELDS.forEach(f => { base[f] = ""; });
  return base;
}

export default function MemberList({ household }) {
  const [members,    setMembers]    = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [formError,  setFormError]  = useState("");
  const [loading,    setLoading]    = useState(false);
  const [form,       setForm]       = useState(blankForm());
  const [showCbmsDetails, setShowCbmsDetails] = useState(false);

  const load = () => {
    getMembers(household.household_id)
      .then(r => setMembers(r.data?.data || r.data || []))
      .catch(() => setMembers([]));
  };

  useEffect(() => { load(); }, [household]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormError("");

    // Auto-set is_senior when age >= 60
    if (name === "age") {
      const age = parseInt(value);
      setForm(f => ({
        ...f, age: value,
        is_senior: !isNaN(age) && age >= 60 ? true : f.is_senior,
      }));
      return;
    }

    // Guard: can't manually check Senior if age < 60
    if (name === "is_senior" && checked) {
      const age = parseInt(form.age);
      if (!isNaN(age) && age < 60) {
        setFormError("Cannot mark as Senior — age is less than 60.");
        return;
      }
    }

    // Auto-set is_household_head when relationship is Household Head
    if (name === "relationship_to_hh") {
      setForm(f => ({
        ...f,
        relationship_to_hh: value,
        is_household_head: value === "Household Head",
      }));
      return;
    }

    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const resetForm = () => {
    setForm(blankForm());
    setEditMember(null);
    setShowForm(false);
    setFormError("");
    setShowCbmsDetails(false);
  };

  const handleEdit = (m) => {
    setEditMember(m);
    const cbmsFields = {};
    CBMS_MEMBER_FIELDS.forEach(f => { cbmsFields[f] = m[f] ?? ""; });
    setForm({
      full_name:              m.full_name              ?? m.display_name ?? "",
      gender:                 m.gender                 ?? "",
      age:                    m.age                    ?? "",
      civil_status:           m.civil_status           ?? "",
      occupation:             m.occupation             ?? "",
      educational_attainment: m.educational_attainment ?? "",
      monthly_income:         m.monthly_income         ?? "",
      relationship_to_hh:     m.relationship_to_hh     ?? "",
      is_household_head:      !!m.is_household_head,
      is_senior:              !!m.is_senior,
      is_pwd:                 !!m.is_pwd,
      is_solo_parent:         !!m.is_solo_parent,
      is_4ps:                 !!m.is_4ps,
      ...cbmsFields,
    });
    setShowForm(true);
    setFormError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");

    // Validation
    if (!form.full_name?.trim()) { setFormError("Full name is required."); return; }
    if (!form.age || isNaN(parseInt(form.age))) { setFormError("Age is required."); return; }
    if (!form.relationship_to_hh) { setFormError("Relationship to household head is required."); return; }
    const age = parseInt(form.age);
    if (form.is_senior && age < 60) {
      setFormError("Cannot save: Senior is checked but age is less than 60.");
      return;
    }

    setLoading(true);
    const payload = {
      full_name:              form.full_name?.trim() || null,
      gender:                 form.gender            || null,
      age:                    age,
      civil_status:           form.civil_status            || null,
      occupation:             form.occupation              || null,
      educational_attainment: form.educational_attainment  || null,
      monthly_income:         form.monthly_income !== "" ? parseFloat(form.monthly_income) : null,
      relationship_to_hh:     form.relationship_to_hh      || null,
      is_household_head:      !!form.is_household_head,
      is_senior:              !!form.is_senior,
      is_pwd:                 !!form.is_pwd,
      is_solo_parent:         !!form.is_solo_parent,
      is_4ps:                 !!form.is_4ps,
      line_number:                     form.line_number !== "" ? form.line_number : null,
      religion:                        form.religion                        || null,
      employment_status:               form.employment_status               || null,
      nuclear_family:                  form.nuclear_family                  || null,
      relation_to_nuclear_family_head: form.relation_to_nuclear_family_head || null,
      with_pwd_id:                     form.with_pwd_id                     || null,
      birthday_month:                  form.birthday_month                  || null,
      birthday_day:                    form.birthday_day                    || null,
      birthday_year:                   form.birthday_year                   || null,
      age_group_five_years:            form.age_group_five_years            || null,
      estimated_monthly_income:        form.estimated_monthly_income !== "" ? parseFloat(form.estimated_monthly_income) : null,
    };

    try {
      if (editMember) {
        await updateIndividual(editMember.person_id, payload);
      } else {
        await createIndividual(household.household_id, payload);
      }
      resetForm();
      load();
    } catch (err) {
      const details = err.response?.data?.details;
      if (details?.length > 0) setFormError(details.join(" | "));
      else setFormError(err.response?.data?.error || "Failed to save member.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (person_id) => {
    if (!window.confirm("Delete this member?")) return;
    await deleteIndividual(person_id);
    load();
  };

  const isEdit = !!editMember;

  const headers = [
    "Name", "Gender", "Age", "Civil Status",
    "Occupation", "Education", "Income",
    "Senior", "PWD", "Solo", "4Ps", "Actions"
  ];

  return (
    <div style={{
      marginTop: 12, padding: 16,
      background: "#f8faff", borderRadius: 8,
      border: "1px solid #e3e8f0",
    }}>

      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1a237e" }}>
            Members of Household: {household.household_number}
          </div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>
            {members.length} member{members.length !== 1 ? "s" : ""} registered
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          style={{
            padding: "6px 14px", background: "#1565c0", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontWeight: 600, fontSize: 12,
            display: "flex", alignItems: "center", gap: 5,
            boxShadow: "0 2px 5px rgba(21,101,192,0.25)",
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Member
        </button>
      </div>

      {/* Modal */}
      {showForm && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}
          style={{
            position: "fixed", inset: 0, zIndex: 1100,
            background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div style={{
            background: "#fff", borderRadius: 14,
            width: "100%", maxWidth: 640,
            boxShadow: "0 24px 64px rgba(0,0,0,0.22)",
            overflow: "hidden", animation: "memberModalIn 0.2s ease",
          }}>
            <style>{`
              @keyframes memberModalIn {
                from { opacity:0; transform:translateY(-14px) scale(0.98); }
                to   { opacity:1; transform:translateY(0) scale(1); }
              }
            `}</style>

            {/* Header */}
            <div style={{
              background: "linear-gradient(135deg,#1a237e 0%,#1565c0 100%)",
              padding: "18px 22px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>
                  {isEdit ? "Edit Member" : "Add New Member"}
                </div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2 }}>
                  Household: {household.household_number}
                </div>
              </div>
              <button type="button" onClick={resetForm} style={{
                background: "rgba(255,255,255,0.15)", border: "none",
                color: "#fff", width: 30, height: 30, borderRadius: "50%",
                cursor: "pointer", fontSize: 16, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
            </div>

            {/* Error */}
            {formError && (
              <div style={{
                background: "#fff3f3", borderBottom: "1px solid #ffcdd2",
                padding: "10px 22px", fontSize: 12, color: "#c62828",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span>⚠</span> {formError}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ padding: "18px 22px", maxHeight: "62vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Row 1: Full Name + Gender */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <Field label="Full Name" required>
                    <input
                      name="full_name"
                      value={form.full_name}
                      onChange={handleChange}
                      placeholder="e.g. Dela Cruz, Juan"
                      style={FIELD_STYLE}
                    />
                  </Field>
                  <Field label="Gender">
                    <select name="gender" value={form.gender} onChange={handleChange} style={FIELD_STYLE}>
                      <option value="">-- Select --</option>
                      {GENDERS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                </div>

                {/* Row 2: Relationship (full width) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                  <Field label="Relationship to Household Head" required>
                    <select
                      name="relationship_to_hh"
                      value={form.relationship_to_hh}
                      onChange={handleChange}
                      style={{
                        ...FIELD_STYLE,
                        borderColor: !form.relationship_to_hh ? "#f57c00" : "#e0e0e0",
                      }}
                    >
                      <option value="">-- Select --</option>
                      {RELATIONSHIPS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                  {form.relationship_to_hh === "Household Head" && (
                    <div style={{
                      padding: "6px 10px", background: "#e3f2fd",
                      border: "1px solid #90caf9", borderRadius: 6,
                      fontSize: 11, fontWeight: 700, color: "#1565c0",
                      whiteSpace: "nowrap", marginBottom: 1,
                    }}>
                      👤 HH Head
                    </div>
                  )}
                </div>

                {/* Row 3: Age + Civil Status + Income */}
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: 14 }}>
                  <Field label="Age" required>
                    <input
                      name="age" type="number" min="0" max="120"
                      value={form.age} onChange={handleChange}
                      placeholder="35" style={FIELD_STYLE}
                    />
                  </Field>
                  <Field label="Civil Status">
                    <select name="civil_status" value={form.civil_status} onChange={handleChange} style={FIELD_STYLE}>
                      <option value="">-- Select --</option>
                      {CIVIL_STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Monthly Income (₱)" hint="0 if none">
                    <input
                      name="monthly_income" type="number" min="0"
                      value={form.monthly_income} onChange={handleChange}
                      placeholder="0" style={FIELD_STYLE}
                    />
                  </Field>
                </div>

                {/* Row 4: Occupation + Educational Attainment */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <Field label="Occupation">
                    <select name="occupation" value={form.occupation} onChange={handleChange} style={FIELD_STYLE}>
                      <option value="">-- Select --</option>
                      {OCCUPATIONS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Educational Attainment">
                    <select name="educational_attainment" value={form.educational_attainment} onChange={handleChange} style={FIELD_STYLE}>
                      <option value="">-- Select --</option>
                      {EDUCATIONAL_ATTAINMENTS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                </div>

                {/* Row 5: Classification checkboxes */}
                <div>
                  <label style={LABEL_STYLE}>Classifications</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {[
                      { name: "is_senior",      label: "Senior Citizen (60+)" },
                      { name: "is_pwd",         label: "Person with Disability" },
                      { name: "is_solo_parent", label: "Solo Parent" },
                      { name: "is_4ps",         label: "4Ps Beneficiary" },
                    ].map(({ name, label }) => (
                      <label key={name} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        cursor: "pointer", fontSize: 12, color: "#444",
                      }}>
                        <input
                          type="checkbox" name={name} checked={!!form[name]}
                          onChange={handleChange}
                          style={{ accentColor: "#1565c0", width: 14, height: 14 }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Row 6: CBMS 2024 additional indicators (collapsible) */}
                <div>
                  <button type="button" onClick={() => setShowCbmsDetails(v => !v)} style={{
                    display: "flex", alignItems: "center", gap: 6, background: "none",
                    border: "none", padding: 0, cursor: "pointer", color: "#1565c0",
                    fontSize: 12, fontWeight: 600,
                  }}>
                    <span style={{ transform: showCbmsDetails ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
                    CBMS 2024 Details {!showCbmsDetails && "(religion, employment status, birthday, etc.)"}
                  </button>
                  {showCbmsDetails && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12,
                      padding: 14, background: "#f8faff", borderRadius: 8, border: "1px solid #e3e8f0" }}>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Field label="Religion">
                          <input name="religion" value={form.religion} onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                        <Field label="Employment Status">
                          <input name="employment_status" value={form.employment_status} onChange={handleChange}
                            placeholder="e.g. Employed, Not in Labor Force" style={FIELD_STYLE} />
                        </Field>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Field label="Nuclear Family">
                          <input name="nuclear_family" value={form.nuclear_family} onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                        <Field label="Relation to Nuclear Family Head">
                          <input name="relation_to_nuclear_family_head" value={form.relation_to_nuclear_family_head}
                            onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Field label="With PWD ID" hint="ID number, if applicable">
                          <input name="with_pwd_id" value={form.with_pwd_id} onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                        <Field label="Estimated Monthly Income" hint="Raw CBMS figure (separate from Income above)">
                          <input type="number" name="estimated_monthly_income" value={form.estimated_monthly_income}
                            onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                        <Field label="Birth Month">
                          <input name="birthday_month" value={form.birthday_month} onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                        <Field label="Birth Day">
                          <input name="birthday_day" value={form.birthday_day} onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                        <Field label="Birth Year">
                          <input name="birthday_year" value={form.birthday_year} onChange={handleChange} style={FIELD_STYLE} />
                        </Field>
                        <Field label="Age Group">
                          <input name="age_group_five_years" value={form.age_group_five_years} onChange={handleChange}
                            placeholder="e.g. 35-39" style={FIELD_STYLE} />
                        </Field>
                      </div>

                      <Field label="Line Number" hint="Position in the original CBMS household roster">
                        <input name="line_number" value={form.line_number} onChange={handleChange}
                          style={{ ...FIELD_STYLE, maxWidth: 120 }} />
                      </Field>

                    </div>
                  )}
                </div>

              </div>

              {/* Footer */}
              <div style={{
                padding: "14px 22px", borderTop: "1px solid #f0f0f0",
                display: "flex", justifyContent: "flex-end", gap: 8, background: "#fafbff",
              }}>
                <button type="button" onClick={resetForm} style={{
                  padding: "9px 20px", borderRadius: 7, fontSize: 13,
                  border: "1px solid #ddd", background: "#fff", color: "#555",
                  cursor: "pointer", fontWeight: 500,
                }}>Cancel</button>
                <button type="submit" disabled={loading} style={{
                  padding: "9px 24px", borderRadius: 7, fontSize: 13, border: "none",
                  background: loading ? "#90caf9" : "linear-gradient(135deg,#1a237e,#1565c0)",
                  color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700,
                  boxShadow: "0 3px 10px rgba(21,101,192,0.3)",
                  display: "flex", alignItems: "center", gap: 7,
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {loading ? "Saving…" : isEdit ? "Update Member" : "Save Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Members Table */}
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e3e8f0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8f9fc", borderBottom: "2px solid #e8eaf6" }}>
              {headers.map(h => (
                <th key={h} style={{
                  padding: "9px 10px", textAlign: "left",
                  fontWeight: 600, color: "#555", fontSize: 11, whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={headers.length} style={{
                  textAlign: "center", padding: 24, color: "#bbb", fontSize: 13,
                }}>No members found.</td>
              </tr>
            ) : members.map((m, idx) => (
              <tr key={m.person_id} style={{
                background: idx % 2 === 0 ? "#fff" : "#fafbff",
                borderBottom: "1px solid #f0f0f0",
              }}>
                <td style={{ padding: "8px 10px", fontWeight: 600, color: "#1a237e", minWidth: 140 }}>
                  {m.full_name || m.display_name || m.person_code}
                  {(m.religion || m.employment_status) && (
                    <div style={{ fontWeight: 400, fontSize: 10, color: "#999", marginTop: 2 }}>
                      {[m.religion, m.employment_status].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td style={{ padding: "8px 10px", color: "#555" }}>{m.gender || "—"}</td>
                <td style={{ padding: "8px 10px" }}>{m.age ?? "—"}</td>
                <td style={{ padding: "8px 10px", color: "#555" }}>{m.civil_status ?? "—"}</td>
                <td style={{ padding: "8px 10px", color: "#555" }}>{m.occupation ?? "—"}</td>
                <td style={{ padding: "8px 10px", color: "#555", maxWidth: 160,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.educational_attainment || "—"}
                </td>
                <td style={{ padding: "8px 10px", fontWeight: 600, color: "#2e7d32" }}>
                  {m.monthly_income != null
                    ? `₱${parseFloat(m.monthly_income).toLocaleString()}` : "—"}
                </td>
                {[m.is_senior, m.is_pwd, m.is_solo_parent, m.is_4ps].map((val, i) => (
                  <td key={i} style={{ padding: "8px 10px", textAlign: "center" }}>
                    {val
                      ? <span style={{ color: "#2e7d32", fontSize: 14 }}>✓</span>
                      : <span style={{ color: "#ef9a9a", fontSize: 14 }}>✗</span>}
                  </td>
                ))}
                <td style={{ padding: "8px 10px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => handleEdit(m)} style={{
                      padding: "3px 10px", fontSize: 11, borderRadius: 4,
                      cursor: "pointer", border: "1px solid #a5d6a7",
                      background: "#e8f5e9", color: "#2e7d32", fontWeight: 500,
                    }}>Edit</button>
                    <button onClick={() => handleDelete(m.person_id)} style={{
                      padding: "3px 10px", fontSize: 11, borderRadius: 4,
                      cursor: "pointer", border: "1px solid #ffcdd2",
                      background: "#fce4ec", color: "#c62828", fontWeight: 500,
                    }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}