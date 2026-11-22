/* eslint-disable no-unused-vars */
import { useState, useRef, useEffect } from "react";
import { useTheme } from "../hooks/useTheme";
import axios from "axios";
import { getDefaultPage, setDefaultPage as saveDefaultPage } from "../hooks/useRoute";

const API = "http://localhost:5000/api";

function Field({ label, value, editable, type = "text", onChange, placeholder, hint, required, readOnly, D, dark }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700,
        color: D.textMuted, marginBottom: 6,
        textTransform: "uppercase", letterSpacing: "0.08em",
      }}>
        {label} {required && <span style={{ color: "#e02424" }}>*</span>}
        {readOnly && (
          <span style={{
            marginLeft: 8, fontSize: 9, fontWeight: 600,
            color: dark ? "#3d4560" : "#aaa",
            background: dark ? "#1a2540" : "#f0f0f0",
            borderRadius: 4, padding: "1px 6px",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>System</span>
        )}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={type}
          value={value}
          readOnly={!editable || readOnly}
          onChange={e => onChange && onChange(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 14px",
            background: readOnly
              ? (dark ? "#0a0f1a" : "#f7f8fc")
              : (dark ? "#0f1828" : "#fff"),
            border: `1px solid ${focused && !readOnly
              ? "#1565c0"
              : (dark ? "#1a2540" : "#e0e4f0")}`,
            borderRadius: 8,
            fontSize: 13, color: readOnly
              ? (dark ? "#3d4560" : "#999")
              : (dark ? "#c8d4ea" : "#1e293b"),
            outline: "none",
            cursor: readOnly ? "not-allowed" : "text",
            transition: "border-color 0.2s, box-shadow 0.2s",
            boxShadow: focused && !readOnly
              ? "0 0 0 3px rgba(21,101,192,0.12)"
              : "none",
            fontFamily: "inherit",
          }}
        />
        {readOnly && (
          <div style={{
            position: "absolute", right: 10, top: "50%",
            transform: "translateY(-50%)",
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke={dark ? "#2a3550" : "#ccc"} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: D.textMuted, marginTop: 5, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, subtitle, icon, children, D, dark, accent = "#1565c0" }) {
  return (
    <div style={{
      background: dark
        ? "linear-gradient(145deg,#141c2e 0%,#111520 100%)"
        : "#fff",
      borderRadius: 14,
      border: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}`,
      boxShadow: dark
        ? "0 4px 20px rgba(0,0,0,0.4)"
        : "0 2px 8px rgba(0,0,0,0.06)",
      overflow: "hidden",
      marginBottom: 16,
    }}>
      {/* Card header */}
      <div style={{
        padding: "18px 24px 16px",
        borderBottom: `1px solid ${dark ? "#1a2540" : "#f0f2f8"}`,
        display: "flex", alignItems: "center", gap: 12,
        background: dark
          ? "linear-gradient(135deg,rgba(21,101,192,0.08),transparent)"
          : `linear-gradient(135deg,${accent}08,transparent)`,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: dark ? accent + "20" : accent + "12",
          border: `1px solid ${accent}30`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: dark ? "#c8d4ea" : "#1e293b" }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: dark ? "#3d4560" : "#94a3b8", marginTop: 1 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: "20px 24px" }}>
        {children}
      </div>
    </div>
  );
}

function PasswordStrength({ password, D, dark }) {
  const checks = [
    { label: "At least 8 characters", pass: password.length >= 8 },
    { label: "Uppercase letter", pass: /[A-Z]/.test(password) },
    { label: "Lowercase letter", pass: /[a-z]/.test(password) },
    { label: "Number", pass: /\d/.test(password) },
    { label: "Special character (!@#$...)", pass: /[^a-zA-Z0-9]/.test(password) },
  ];
  const passed = checks.filter(c => c.pass).length;
  const strength = passed <= 1 ? "Weak" : passed <= 3 ? "Fair" : passed === 4 ? "Good" : "Strong";
  const strengthColor = passed <= 1 ? "#e02424" : passed <= 3 ? "#d97706" : passed === 4 ? "#0e9f6e" : "#1565c0";

  if (!password) return null;
  return (
    <div style={{ marginTop: 10, padding: "12px 14px", background: dark ? "#0a0f1a" : "#f8fafc", borderRadius: 8, border: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Password Strength</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: strengthColor }}>{strength}</span>
      </div>
      <div style={{ display: "flex", gap: 3, marginBottom: 10 }}>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= passed ? strengthColor : (dark ? "#1a2540" : "#e2e8f0"),
            transition: "background 0.3s",
          }}/>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
        {checks.map(c => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
              background: c.pass ? "#0e9f6e18" : (dark ? "#1a2540" : "#f1f5f9"),
              border: `1px solid ${c.pass ? "#0e9f6e" : (dark ? "#1a2540" : "#e2e8f0")}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {c.pass && (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#0e9f6e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </div>
            <span style={{ fontSize: 10, color: c.pass ? (dark ? "#4ade80" : "#0e9f6e") : D.textMuted }}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AccountSettings({ user, onClose, onUserUpdate, D: externalD, initialTab = "profile" }) {
  const { dark } = useTheme();

  const D = externalD || {
    pageBg: dark ? "radial-gradient(ellipse at 20% 0%,#0d1b35 0%,#0a1020 45%,#080b14 100%)" : "radial-gradient(ellipse at 20% 0%,#dce8ff 0%,#eaf0ff 45%,#f5f6fa 100%)",
    cardBg: dark ? "linear-gradient(145deg,#141c2e 0%,#111520 100%)" : "#fff",
    border: dark ? "#1a2540" : "#e8eaf0",
    textPrimary: dark ? "#5b8dee" : "#1a237e",
    textBody: dark ? "#8b95a9" : "#333",
    textMuted: dark ? "#3d4560" : "#888",
    shadow: dark ? "0 4px 20px rgba(0,0,0,0.6)" : "0 2px 8px rgba(0,0,0,0.07)",
    iconBtn: dark ? "#0f1828" : "#f0f4ff",
    iconBtnBorder: dark ? "#1e2d4a" : "#dde3f5",
    iconBtnColor: dark ? "#5b8dee" : "#1565c0",
    subBg: dark ? "#0c1018" : "#f5f6fa",
    divider: dark ? "#141c2a" : "#f0f0f0",
  };

  const [activeTab, setActiveTab] = useState(initialTab);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // Profile fields
  const [fullName,     setFullName]     = useState(user?.full_name || "");
  const [email,        setEmail]        = useState(user?.email || "");
  const [phone,        setPhone]        = useState(user?.phone || "");
  const [designation,  setDesignation]  = useState(user?.designation || "");

  // Password fields
  const [currentPw,   setCurrentPw]   = useState("");
  const [newPw,        setNewPw]        = useState("");
  const [confirmPw,    setConfirmPw]    = useState("");
  const [showCurrent,  setShowCurrent]  = useState(false);
  const [showNew,      setShowNew]      = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [pwError,      setPwError]      = useState(null);

  // Preferences
  // Saved on this computer; used when LGU-SDSS opens without a remembered page.
  const [defaultPage,    setDefaultPageState] = useState(getDefaultPage);
  const setDefaultPage = (p) => { setDefaultPageState(p); saveDefaultPage(p); };

  const tabs = [
    { id: "profile",     label: "Profile",      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
    { id: "security",    label: "Security",     icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> },
    { id: "preferences", label: "Preferences",  icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
    { id: "gemini",      label: "AI / Gemini key", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> },
    { id: "status",      label: "Account Status", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
  ];

  const showSave = (msg, isError = false) => {
    setSaveMsg({ msg, isError });
    setTimeout(() => setSaveMsg(null), 3500);
  };

  const handleSaveProfile = async () => {
    if (!fullName.trim()) return showSave("Full name is required.", true);
    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      await axios.patch(`${API}/auth/profile`, { full_name: fullName, email, phone, designation }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (onUserUpdate) onUserUpdate({ ...user, full_name: fullName, email, phone, designation });
      showSave("Profile updated successfully.");
    } catch (err) {
      showSave(err.response?.data?.error || "Failed to update profile.", true);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwError(null);
    if (!currentPw || !newPw || !confirmPw) return setPwError("All password fields are required.");
    if (newPw !== confirmPw) return setPwError("New passwords do not match.");
    if (newPw.length < 8) return setPwError("Password must be at least 8 characters.");
    if (!/[A-Z]/.test(newPw) || !/[0-9]/.test(newPw)) return setPwError("Password must contain at least one uppercase letter and one number.");
    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      await axios.post(`${API}/auth/change-password`, { current_password: currentPw, new_password: newPw }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      showSave("Password changed successfully.");
    } catch (err) {
      setPwError(err.response?.data?.error || "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  const PwInput = ({ label, value, onChange, show, onToggle, placeholder }) => {
    const [focused, setFocused] = useState(false);
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: D.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</label>
        <div style={{ position: "relative" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke={focused ? "#1565c0" : (dark ? "#2a3550" : "#ccc")}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", transition: "stroke 0.2s" }}>
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <input type={show ? "text" : "password"} value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 44px 10px 38px",
              background: dark ? "#0f1828" : "#fff",
              border: `1px solid ${focused ? "#1565c0" : (dark ? "#1a2540" : "#e0e4f0")}`,
              borderRadius: 8, fontSize: 13,
              color: dark ? "#c8d4ea" : "#1e293b",
              outline: "none", fontFamily: "inherit",
              boxShadow: focused ? "0 0 0 3px rgba(21,101,192,0.12)" : "none",
              transition: "all 0.2s",
            }}/>
          <button type="button" onClick={onToggle} tabIndex={-1}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: dark ? "#3d4560" : "#aaa", display: "flex", padding: 4, transition: "color 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.color = "#1565c0"}
            onMouseLeave={e => e.currentTarget.style.color = dark ? "#3d4560" : "#aaa"}>
            {show
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        </div>
      </div>
    );
  };

  const Toggle = ({ value, onChange, label, desc }) => (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "12px 0", borderBottom: `1px solid ${dark ? "#141c2a" : "#f0f0f0"}` }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: dark ? "#c8d4ea" : "#1e293b", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11, color: D.textMuted, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <button type="button" onClick={() => onChange(!value)} style={{
        width: 42, height: 24, borderRadius: 12, flexShrink: 0,
        background: value ? "#1565c0" : (dark ? "#1a2540" : "#e2e8f0"),
        border: "none", cursor: "pointer", position: "relative",
        transition: "background 0.25s",
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          position: "absolute", top: 3,
          left: value ? 21 : 3,
          transition: "left 0.25s",
          boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
        }}/>
      </button>
    </div>
  );

  const roleColors = {
    ADMIN: "#1565c0", MPDO: "#0e9f6e", MSWDO: "#7e3af2",
    "LGU PLANNING": "#d97706",
  };
  const normalizedRole = user?.role?.toUpperCase() || "";
  const roleColor = roleColors[normalizedRole] || "#1565c0";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: dark ? "rgba(4,8,20,0.85)" : "rgba(15,36,96,0.35)",
      backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px",
      animation: "fadeIn 0.2s ease",
    }} onClick={onClose}>
      <style>{`
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px) scale(0.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>

      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 780,
        maxHeight: "92vh",
        background: dark ? "linear-gradient(170deg,#0e1525 0%,#090e1a 100%)" : "#f5f6fa",
        borderRadius: 18,
        border: `1px solid ${dark ? "#1a2540" : "#e0e4f0"}`,
        boxShadow: dark
          ? "0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(91,141,238,0.08)"
          : "0 24px 60px rgba(15,36,96,0.18)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        animation: "slideUp 0.3s cubic-bezier(0.34,1.2,0.64,1)",
      }}>

        {/* ── MODAL HEADER ── */}
        <div style={{
          padding: "20px 24px 18px",
          borderBottom: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}`,
          background: dark
            ? "linear-gradient(135deg,rgba(21,101,192,0.15),rgba(13,27,53,0.8))"
            : "linear-gradient(135deg,#e8f0fe,#f0f4ff)",
          display: "flex", alignItems: "center", gap: 14, flexShrink: 0,
        }}>
          {/* Avatar */}
          <div style={{
            width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg,${roleColor},${roleColor}cc)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 0 3px ${roleColor}30, 0 4px 12px ${roleColor}40`,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: dark ? "#c8d4ea" : "#1e293b", lineHeight: 1.2 }}>
              {user?.full_name || user?.username || "Account Settings"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: roleColor,
                background: roleColor + "18", border: `1px solid ${roleColor}30`,
                borderRadius: 4, padding: "2px 8px",
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>{user?.role || "User"}</span>
              <span style={{ fontSize: 11, color: D.textMuted }}>Municipality of San Miguel · LGU-SDSS</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: "50%",
            background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
            border: `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: D.textMuted, fontSize: 18, lineHeight: 1, transition: "all 0.2s",
            fontFamily: "inherit",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"; e.currentTarget.style.color = dark ? "#fff" : "#1e293b"; }}
          onMouseLeave={e => { e.currentTarget.style.background = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"; e.currentTarget.style.color = D.textMuted; }}>
            ×
          </button>
        </div>

        {/* ── TAB BAR ── */}
        <div style={{
          display: "flex", gap: 0,
          borderBottom: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}`,
          background: dark ? "rgba(10,15,28,0.6)" : "#fff",
          flexShrink: 0, overflowX: "auto",
        }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "12px 20px",
              background: "none", border: "none",
              borderBottom: `2px solid ${activeTab === tab.id ? "#1565c0" : "transparent"}`,
              color: activeTab === tab.id ? "#1565c0" : D.textMuted,
              fontSize: 12, fontWeight: activeTab === tab.id ? 700 : 500,
              cursor: "pointer", transition: "all 0.2s",
              whiteSpace: "nowrap", fontFamily: "inherit",
            }}
            onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.color = dark ? "#5b8dee" : "#1565c0"; }}
            onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.color = D.textMuted; }}>
              <span style={{ opacity: activeTab === tab.id ? 1 : 0.6 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── SCROLLABLE CONTENT ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── PROFILE TAB ── */}
          {activeTab === "profile" && (
            <div>
              {/* Read-only identity strip */}
              <div style={{
                background: dark ? "#0a0f1a" : "#f8fafc",
                border: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}`,
                borderLeft: "3px solid #1565c0",
                borderRadius: 10, padding: "12px 16px", marginBottom: 20,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style={{ fontSize: 11, color: dark ? "#5b8dee" : "#1565c0", lineHeight: 1.5 }}>
                  Fields marked <strong>System</strong> are managed by the Administrator and cannot be changed here.
                </span>
              </div>

              <SectionCard
                title="Personal Information"
                subtitle="Your name and contact details visible to administrators"
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                D={D} dark={dark}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                  <Field label="Full Name" value={fullName} editable onChange={setFullName}
                    placeholder="Enter your full name" required D={D} dark={dark}
                    hint="Your legal name as appearing in civil service records"/>
                  <Field label="Username / Employee ID" value={user?.username || ""} editable={false}
                    readOnly D={D} dark={dark} hint="Assigned by system administrator"/>
                  <Field label="Email Address" value={email} editable onChange={setEmail}
                    type="email" placeholder="your.email@sanmiguel.gov.ph" D={D} dark={dark}
                    hint="Contact email for this account"/>
                  <Field label="Contact Number" value={phone} editable onChange={setPhone}
                    placeholder="+63 9XX XXX XXXX" D={D} dark={dark}/>
                  <Field label="Designation / Position" value={designation} editable onChange={setDesignation}
                    placeholder="e.g. Planning Officer II" D={D} dark={dark}/>
                  <Field label="Role / Access Level" value={user?.role || ""} editable={false}
                    readOnly D={D} dark={dark} hint="Contact admin to change access level"/>
                </div>
              </SectionCard>

              <SectionCard
                title="Office Assignment"
                subtitle="Your assigned office and jurisdiction"
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0e9f6e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
                D={D} dark={dark} accent="#0e9f6e">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                  <Field label="Office" value={user?.office || "Municipal Hall, San Miguel"} editable={false} readOnly D={D} dark={dark}/>
                  <Field label="Municipality" value="San Miguel, Iloilo" editable={false} readOnly D={D} dark={dark}/>
                  <Field label="Assigned Barangay" value={user?.barangay_id ? `Barangay ${user.barangay_id}` : "All Barangays"} editable={false} readOnly D={D} dark={dark} hint="Your jurisdiction scope for data access"/>
                  <Field label="Province" value="Iloilo" editable={false} readOnly D={D} dark={dark}/>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── SECURITY TAB ── */}
          {activeTab === "security" && (
            <div>
              <SectionCard
                title="Change Password"
                subtitle="Use a strong password. Required every 90 days per LGU policy."
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e02424" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                D={D} dark={dark} accent="#e02424">

                {pwError && (
                  <div style={{
                    background: "rgba(224,36,36,0.07)", border: "1px solid rgba(224,36,36,0.2)",
                    borderLeft: "3px solid #e02424", borderRadius: 8, padding: "10px 14px",
                    marginBottom: 16, fontSize: 12, color: dark ? "#fca5a5" : "#b91c1c",
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {pwError}
                  </div>
                )}

                <PwInput label="Current Password" value={currentPw} onChange={setCurrentPw}
                  show={showCurrent} onToggle={() => setShowCurrent(p => !p)}
                  placeholder="Enter your current password"/>
                <PwInput label="New Password" value={newPw} onChange={setNewPw}
                  show={showNew} onToggle={() => setShowNew(p => !p)}
                  placeholder="Enter new password"/>
                <PasswordStrength password={newPw} D={D} dark={dark}/>
                <PwInput label="Confirm New Password" value={confirmPw} onChange={setConfirmPw}
                  show={showConfirm} onToggle={() => setShowConfirm(p => !p)}
                  placeholder="Re-enter new password"/>

                {confirmPw && newPw && confirmPw !== newPw && (
                  <div style={{ fontSize: 11, color: "#e02424", marginTop: -10, marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Passwords do not match
                  </div>
                )}
                {confirmPw && newPw && confirmPw === newPw && (
                  <div style={{ fontSize: 11, color: "#0e9f6e", marginTop: -10, marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Passwords match
                  </div>
                )}

                <button onClick={handleChangePassword} disabled={saving || !currentPw || !newPw || !confirmPw} style={{
                  padding: "10px 20px",
                  background: saving || !currentPw || !newPw || !confirmPw ? (dark ? "#1a2540" : "#e2e8f0") : "linear-gradient(135deg,#e02424,#b91c1c)",
                  color: saving || !currentPw || !newPw || !confirmPw ? D.textMuted : "#fff",
                  border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
                  cursor: saving || !currentPw || !newPw || !confirmPw ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  transition: "all 0.2s", fontFamily: "inherit",
                  boxShadow: saving || !currentPw || !newPw || !confirmPw ? "none" : "0 3px 12px rgba(224,36,36,0.35)",
                }}>
                  {saving ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> : null}
                  {saving ? "Updating..." : "Update Password"}
                </button>
              </SectionCard>

              <SectionCard
                title="Password Policy"
                subtitle="LGU-SDSS security requirements per RA 10173"
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                D={D} dark={dark} accent="#d97706">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { label: "Minimum Length", value: "8 characters" },
                    { label: "Password Rotation", value: "Every 90 days" },
                    { label: "Password History", value: "Cannot reuse last 5" },
                    { label: "Account Lockout", value: "After 5 failed attempts" },
                    { label: "Session Duration", value: "8 hours (auto-expire)" },
                    { label: "Complexity Required", value: "Upper + lower + number" },
                  ].map(p => (
                    <div key={p.label} style={{ background: dark ? "#0a0f1a" : "#f8fafc", borderRadius: 8, padding: "10px 12px", border: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{p.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: dark ? "#c8d4ea" : "#1e293b" }}>{p.value}</div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── PREFERENCES TAB ── */}
          {activeTab === "preferences" && (
            <div>
              <SectionCard
                title="Display Preferences"
                subtitle="Customize your default view and interface options"
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7e3af2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>}
                D={D} dark={dark} accent="#7e3af2">
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: D.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Default Landing Page
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {[
                      { id: "dashboard", label: "Dashboard" },
                      { id: "households", label: "Households" },
                      { id: "map", label: "Map View" },
                    ].map(p => (
                      <button key={p.id} onClick={() => setDefaultPage(p.id)} type="button" style={{
                        padding: "9px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                        background: defaultPage === p.id ? "#1565c0" : (dark ? "#0a0f1a" : "#f8fafc"),
                        color: defaultPage === p.id ? "#fff" : D.textMuted,
                        border: `1px solid ${defaultPage === p.id ? "#1565c0" : (dark ? "#1a2540" : "#e8eaf0")}`,
                        boxShadow: defaultPage === p.id ? "0 2px 8px rgba(21,101,192,0.35)" : "none",
                      }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── ACCOUNT STATUS TAB ── */}
          {activeTab === "gemini" && <GeminiKeyPanel D={D} dark={dark} />}

          {activeTab === "status" && (
            <div>
              <SectionCard
                title="Account Overview"
                subtitle="Your current account status and access information"
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0e9f6e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                D={D} dark={dark} accent="#0e9f6e">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  {[
                    { label: "Account Status", value: "Active", color: "#0e9f6e", badge: true },
                    { label: "Role", value: user?.role || "—", color: roleColor, badge: true },
                    { label: "Username", value: user?.username || "—", color: null },
                    { label: "Employee ID", value: user?.employee_id || user?.username || "—", color: null },
                    { label: "Last Login", value: user?.last_login ? new Date(user.last_login).toLocaleString("en-PH") : "Current session", color: null },
                    { label: "Account Created", value: user?.created_at ? new Date(user.created_at).toLocaleDateString("en-PH") : "—", color: null },
                    { label: "Failed Attempts", value: user?.failed_attempts != null ? `${user.failed_attempts} / 5` : "0 / 5", color: parseInt(user?.failed_attempts || 0) >= 3 ? "#d97706" : null },
                    { label: "Session Expires", value: "8 hours from login", color: null },
                  ].map(item => (
                    <div key={item.label} style={{ background: dark ? "#0a0f1a" : "#f8fafc", borderRadius: 8, padding: "12px 14px", border: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{item.label}</div>
                      {item.badge ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: item.color, background: item.color + "18", border: `1px solid ${item.color}30`, borderRadius: 5, padding: "2px 10px" }}>{item.value}</span>
                      ) : (
                        <div style={{ fontSize: 13, fontWeight: 600, color: item.color || (dark ? "#c8d4ea" : "#1e293b") }}>{item.value}</div>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Access Permissions"
                subtitle="What this role can access in LGU-SDSS"
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                D={D} dark={dark}>
                {(() => {
                  const ACCESS = {
                    ADMIN:          { Dashboard:true, Households:true, "Map View":true, Vulnerability:true, Network:true, Planning:true, Reports:true, "User Management":true },
                    MPDO:           { Dashboard:true, Households:true, "Map View":true, Vulnerability:true, Network:true, Planning:true, Reports:true, "User Management":false },
                    MSWDO:          { Dashboard:true, Households:true, "Map View":false, Vulnerability:false, Network:true, Planning:true, Reports:true, "User Management":false },
                    "LGU PLANNING": { Dashboard:true, Households:false, "Map View":true, Vulnerability:true, Network:false, Planning:true, Reports:false, "User Management":false },
                  };
                  const perms = ACCESS[user?.role?.toUpperCase()] || ACCESS.MPDO;
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                      {Object.entries(perms).map(([mod, allowed]) => (
                        <div key={mod} style={{
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "8px 10px", borderRadius: 7,
                          background: allowed ? (dark ? "#0e2010" : "#f0fdf4") : (dark ? "#0a0f1a" : "#fafafa"),
                          border: `1px solid ${allowed ? (dark ? "#1a4020" : "#bbf7d0") : (dark ? "#1a2540" : "#e8eaf0")}`,
                        }}>
                          <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: allowed ? "#0e9f6e" : (dark ? "#1a2540" : "#e2e8f0") }}>
                            {allowed
                              ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                              : <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={dark ? "#3d4560" : "#aaa"} strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            }
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: allowed ? (dark ? "#4ade80" : "#0e9f6e") : D.textMuted }}>{mod}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </SectionCard>

              {/* RA 10173 notice */}
              <div style={{
                background: dark ? "rgba(21,101,192,0.06)" : "#eff6ff",
                border: `1px solid ${dark ? "#1e3a6e" : "#bfdbfe"}`,
                borderRadius: 10, padding: "14px 16px",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: dark ? "#5b8dee" : "#1565c0", marginBottom: 3 }}>RA 10173 — Data Privacy Reminder</div>
                  <div style={{ fontSize: 11, color: dark ? "#3d6090" : "#64748b", lineHeight: 1.65 }}>
                    As an authorized user of LGU-SDSS, you are legally bound by the Philippine Data Privacy Act of 2012. All household and individual data accessed through this system is confidential and must not be shared, copied, or disclosed to unauthorized parties. Violations are subject to criminal liability under RA 10173.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div style={{
          padding: "14px 24px",
          borderTop: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: dark ? "rgba(10,15,28,0.6)" : "#fff",
          flexShrink: 0, flexWrap: "wrap", gap: 10,
        }}>
          {/* Save feedback */}
          <div style={{ flex: 1, minHeight: 24 }}>
            {saveMsg && (
              <div style={{
                display: "flex", alignItems: "center", gap: 7,
                fontSize: 12, fontWeight: 600,
                color: saveMsg.isError ? "#e02424" : "#0e9f6e",
                animation: "fadeIn 0.25s ease",
              }}>
                {saveMsg.isError
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                }
                {saveMsg.msg}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{
              padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: "none", border: `1px solid ${dark ? "#1a2540" : "#e0e4f0"}`,
              color: D.textMuted, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = dark ? "#1a2540" : "#f0f4ff"; e.currentTarget.style.color = dark ? "#c8d4ea" : "#1e293b"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = D.textMuted; }}>
              Cancel
            </button>

            {(activeTab === "profile") && (
              <button onClick={handleSaveProfile} disabled={saving} style={{
                padding: "9px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: saving ? (dark ? "#1a2540" : "#e2e8f0") : "linear-gradient(135deg,#1565c0,#1a237e)",
                color: saving ? D.textMuted : "#fff",
                border: "none", cursor: saving ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 8,
                boxShadow: saving ? "none" : "0 3px 12px rgba(21,101,192,0.4)",
                transition: "all 0.2s", fontFamily: "inherit",
              }}>
                {saving && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>}
                {saving ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
// ── Gemini API key ───────────────────────────────────────────────────────
// Ask the Data and the AI explanations call Google Gemini. The free tier has
// a small daily quota per key, so the key can be replaced here without
// restarting the system. The full key is never shown again after saving.
function GeminiKeyPanel({ D, dark }) {
  const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
  const [state, setState] = useState(null);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(null);           // "save" | "test" | "remove"
  const [msg, setMsg] = useState(null);             // { tone: ok|warn|bad, text }

  const load = () => axios.get(`${API}/settings/gemini`, auth())
    .then((r) => setState(r.data)).catch(() => setState({ error: true }));
  useEffect(() => { load(); }, []);

  const toneOf = (status, ok) => ok ? "ok" : status === "quota" || status === "offline" ? "warn" : "bad";
  const save = async () => {
    setBusy("save"); setMsg(null);
    try {
      const r = await axios.put(`${API}/settings/gemini`, { api_key: key }, auth());
      setState(r.data); setKey("");
      setMsg({ tone: r.data.status === "offline" ? "warn" : "ok", text: r.data.message });
    } catch (e) {
      setMsg({ tone: "bad", text: e.response?.data?.error || "Could not save the key." });
    } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy("test"); setMsg(null);
    try {
      const r = await axios.post(`${API}/settings/gemini/test`, key.trim() ? { api_key: key } : {}, auth());
      setMsg({ tone: toneOf(r.data.status, r.data.ok), text: r.data.message });
    } catch (e) {
      setMsg({ tone: "bad", text: e.response?.data?.error || "Could not test the key." });
    } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("remove"); setMsg(null);
    try {
      const r = await axios.delete(`${API}/settings/gemini`, auth());
      setState(r.data); setMsg({ tone: "ok", text: r.data.message });
    } catch (e) {
      setMsg({ tone: "bad", text: e.response?.data?.error || "Could not remove the key." });
    } finally { setBusy(null); }
  };

  const TONE = {
    ok:   { bg: dark ? "rgba(14,159,110,0.12)" : "#ecfdf5", bd: "#0e9f6e", fg: dark ? "#6ee7b7" : "#065f46" },
    warn: { bg: dark ? "rgba(217,119,6,0.12)" : "#fffbeb", bd: "#d97706", fg: dark ? "#fcd34d" : "#92400e" },
    bad:  { bg: dark ? "rgba(224,36,36,0.10)" : "#fef2f2", bd: "#e02424", fg: dark ? "#fca5a5" : "#b91c1c" },
  };
  const btn = (primary, disabled) => ({
    padding: "9px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    border: primary ? "none" : `1px solid ${dark ? "#1a2540" : "#d6dbe8"}`,
    background: disabled ? (dark ? "#1a2540" : "#e2e8f0") : primary ? "linear-gradient(135deg,#1565c0,#1a237e)" : (dark ? "#0f1828" : "#fff"),
    color: disabled ? D.textMuted : primary ? "#fff" : (dark ? "#c8d4ea" : "#1e293b"),
  });
  const src = state?.source;
  const label = { fontSize: 11, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" };

  return (
    <SectionCard
      title="Gemini API key"
      subtitle="Used by Ask the Data and the AI explanations. When a key's free daily quota runs out, paste another one here."
      icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>}
      D={D} dark={dark} accent="#7c3aed">

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, marginBottom: 18,
        background: dark ? "#0a0f1a" : "#f8fafc", border: `1px solid ${dark ? "#1a2540" : "#e8eaf0"}` }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
          background: !state ? "#94a3b8" : state.configured ? "#0e9f6e" : "#e02424" }} />
        <div style={{ flex: 1, fontSize: 12.5, color: dark ? "#c8d4ea" : "#1e293b", lineHeight: 1.5 }}>
          {!state ? "Checking …" : state.error ? "Could not read the current setting." : state.configured ? (
            <>Key in use: <b style={{ fontFamily: "monospace" }}>{state.masked}</b>{" "}
              <span style={{ color: D.textMuted }}>
                {src === "settings" ? "· saved here" : "· given when the system was started"}
              </span></>
          ) : <>No key yet — the AI features are off. Everything else works without it.</>}
        </div>
        <button onClick={test} disabled={!state?.configured || !!busy} style={btn(false, !state?.configured || !!busy)}
          title="Sends one tiny request to Google (uses 1 of the key's daily requests)">
          {busy === "test" && !key ? "Testing …" : "Test key"}
        </button>
      </div>

      <div style={label}>{state?.configured ? "Replace with a new key" : "Add a key"}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input type={show ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="Paste the API key (starts with AIza…)" autoComplete="off" spellCheck={false}
            onKeyDown={(e) => { if (e.key === "Enter" && key.trim() && !busy) save(); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 64px 10px 14px", borderRadius: 8, fontSize: 13,
              fontFamily: "monospace", outline: "none", background: dark ? "#0f1828" : "#fff",
              border: `1px solid ${dark ? "#1a2540" : "#e0e4f0"}`, color: dark ? "#c8d4ea" : "#1e293b" }} />
          <button onClick={() => setShow((v) => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            border: "none", background: "none", color: D.textMuted, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <button onClick={save} disabled={!key.trim() || !!busy} style={btn(true, !key.trim() || !!busy)}>
          {busy === "save" ? "Checking …" : "Save key"}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: D.textMuted, marginTop: 7, lineHeight: 1.6 }}>
        Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "#1565c0", fontWeight: 600 }}>aistudio.google.com/apikey</a>{" "}
        (sign in with a Google account → Create API key). The key is checked with Google before it is saved, and takes effect immediately.
        A different Google account or project gives a separate daily quota.
      </div>

      {msg && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.5,
          background: TONE[msg.tone].bg, color: TONE[msg.tone].fg, borderLeft: `3px solid ${TONE[msg.tone].bd}` }}>
          {msg.text}
        </div>
      )}

      {src === "settings" && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${dark ? "#1a2540" : "#f0f2f8"}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 11.5, color: D.textMuted }}>
            {state.startup_key ? `Removing it goes back to the startup key (${state.startup_key}).` : "Removing it turns the AI features off."}
          </span>
          <button onClick={remove} disabled={!!busy} style={{ ...btn(false, !!busy), color: busy ? D.textMuted : "#e02424" }}>
            {busy === "remove" ? "Removing …" : "Remove saved key"}
          </button>
        </div>
      )}
    </SectionCard>
  );
}
