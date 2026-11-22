/* eslint-disable */
import { useState, useEffect, useRef } from "react";
import HouseholdList     from "./features/households/HouseholdList";
import MapView           from "./features/map/MapView";
import VulnerabilityPage from "./features/vulnerability/VulnerabilityPage";
import Dashboard         from "./features/dashboard/Dashboard";
import LandingPage       from "./auth/LandingPage";
import NetworkAnalysis   from "./features/network/NetworkAnalysis";
import BarangayPlanning  from "./features/planning/BarangayPlanning";
import axios             from "axios";
import profilePic        from "./assets/profile.png";
import lguIcon from "./assets/logo.png"; // system logo
import { useTheme }      from "./hooks/useTheme";
import ReportsPage from "./features/reports/ReportsPage";
import NlpQueryPage from "./features/nlpquery/NlpQueryPage";
import AboutPage from "./pages/AboutPage";
import AttributesPage from "./pages/AttributesPage";
import AccountSettings from "./pages/AccountSettings";
import OmniSearch, { OmniSearchTrigger } from "./components/OmniSearch";
import { readRoute, pushPage, getParam, getDefaultPage } from "./hooks/useRoute";
import DataStatusBanner from "./components/DataStatusBanner";

function getInitialAuth() {
  try {
    const savedToken = localStorage.getItem("token");
    const savedUser  = localStorage.getItem("user");
    if (!savedToken || !savedUser) return { user: null, token: null };
    // JWT parts are base64url ("-" and "_", no padding); atob needs plain base64.
    const part = savedToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
    if (payload.exp * 1000 > Date.now()) {
      return { user: JSON.parse(savedUser), token: savedToken };
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    return { user: null, token: null };
  } catch {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    return { user: null, token: null };
  }
}

const IconSun = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);
const IconMoon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const IconDashboard  = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
const IconHouseholds = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
const IconMapNav     = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>;
const IconVuln       = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>;
const IconNetwork    = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/><line x1="5" y1="19" x2="19" y2="19"/></svg>;
const IconPlanning   = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
const IconReports = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="12" y1="9" x2="8" y2="9"/></svg>;
const IconAttributes = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>;
// NLP-to-DB constrained query layer -- speech-bubble-with-search icon
const IconAsk = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>;

const NAV_ITEMS = [
  { key: "dashboard",     label: "Dashboard",        Icon: IconDashboard  },
  { key: "households",    label: "Households",        Icon: IconHouseholds },
  { key: "map",           label: "Map View",          Icon: IconMapNav     },
  { key: "vulnerability", label: "Vulnerability",     Icon: IconVuln       },
  { key: "attributes",    label: "Data Attributes",   Icon: IconAttributes },
  { key: "network",       label: "Network",           Icon: IconNetwork    },
  { key: "planning",      label: "Planning",          Icon: IconPlanning   },
  { key: "reports",       label: "Reports & Export",  Icon: IconReports    },
  { key: "nlp-query",     label: "Ask the Data",      Icon: IconAsk        },
];

// ── Role-based access control ─────────────────────────────────
const ROLE_ACCESS = {
  ADMIN:          ["dashboard","households","map","vulnerability","attributes","network","planning","reports","nlp-query"],
  MPDO:           ["dashboard","households","map","vulnerability","attributes","network","planning","reports","nlp-query"],
  MSWDO:          ["dashboard","households","attributes","network","planning","reports","nlp-query"],
  "LGU PLANNING": ["dashboard","map","vulnerability","attributes","planning","nlp-query"],
};

// Helper: normalize role key for lookup
function getRoleAccess(role) {
  if (!role) return ROLE_ACCESS["ADMIN"];
  return ROLE_ACCESS[role.toUpperCase()] || ROLE_ACCESS["ADMIN"];
}

export default function App() {
  // The page comes from the address (#/map, #/reports?report=custom, ...) so a
  // refresh lands on the same page; a fresh start opens the default page.
  const [tab,                setTab]                = useState(() => readRoute().page || getDefaultPage());
  const [user,               setUser]               = useState(() => getInitialAuth().user);
  const [token,              setToken]              = useState(() => getInitialAuth().token);
  const [checking,           setChecking]           = useState(true);
  const [dropdownOpen,       setDropdownOpen]       = useState(false);
  const [searchTarget,       setSearchTarget]       = useState(() => (readRoute().page === "households" ? getParam("q") || "" : ""));
  const [showAccountSettings,setShowAccountSettings] = useState(false);
  const [accountTab,         setAccountTab]          = useState("profile");
  // Omni Search: open state + the "where to go and what to open" intent the
  // target page reads on arrival. Cleared whenever the sidebar is used, so a
  // page never re-applies an old intent.
  const [omniOpen,           setOmniOpen]            = useState(false);
  const [intent,             setIntent]              = useState(null);

  const { dark, toggle } = useTheme();
  const dropdownRef = useRef(null);

  const D = {
    pageBg: dark
      ? "radial-gradient(ellipse at 20% 0%, #0d1b35 0%, #0a1020 45%, #080b14 100%)"
      : "radial-gradient(ellipse at 20% 0%, #dce8ff 0%, #eaf0ff 45%, #f5f6fa 100%)",

    textMuted:       dark ? "#3d4560"  : "#888888",

    // ── Sidebar — always a dark navy/blue gradient, independent of the
    // light/dark mode toggle above (which only affects the main content
    // area). Kept as its own set of tokens so nothing here leaks into
    // AccountSettings or other consumers of the shared D.textMuted etc. ──
    sidebarBg:             "linear-gradient(165deg, #0b1130 0%, #111f45 48%, #090e22 100%)",
    sidebarBorder:         "rgba(91,141,238,0.14)",
    sidebarDivider:        "rgba(91,141,238,0.12)",
    sidebarTextPrimary:    "#eef3ff",
    sidebarTextMuted:      "rgba(203,216,245,0.56)",
    sidebarNavActive:      "linear-gradient(90deg, rgba(91,141,238,0.24) 0%, rgba(91,141,238,0.05) 100%)",
    sidebarNavActiveBorder:"#5b8dee",
    sidebarNavActiveText:  "#eaf1ff",
    sidebarNavHover:       "rgba(91,141,238,0.10)",
    sidebarNavText:        "rgba(197,209,235,0.68)",
    sidebarHoverBg:        "rgba(91,141,238,0.10)",
    sidebarDropdownBg:     "#131a33",
    sidebarDropdownBorder: "rgba(91,141,238,0.18)",
    sidebarToggleBg:       "rgba(91,141,238,0.10)",
    sidebarToggleColor:    "#8fb4ff",
    sidebarToggleBorder:   "rgba(91,141,238,0.24)",
    sidebarShadow:         "2px 0 28px rgba(2,6,18,0.55)",
  };

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) { Promise.resolve().then(() => setChecking(false)); return; }
    axios.get("http://127.0.0.1:5000/api/auth/me", {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
      .then(res => { setUser(res.data); setToken(savedToken); setChecking(false); })
      .catch(() => {
        localStorage.removeItem("token"); localStorage.removeItem("user");
        setUser(null); setToken(null); setChecking(false);
      });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (!user || !token) return;
      const k = e.key?.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); setOmniOpen((o) => !o); return; }
      const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (k === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOmniOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, token]);

  // Any page can open Account Settings on a tab (e.g. "Change Gemini key"
  // under an AI quota message).
  useEffect(() => {
    const onOpen = (e) => { setAccountTab(e.detail || "profile"); setShowAccountSettings(true); };
    window.addEventListener("lgu:open-settings", onOpen);
    return () => window.removeEventListener("lgu:open-settings", onOpen);
  }, []);
  // Other pages can open a page with an intent (e.g. Planning -> Map View
  // on one barangay's hazard households): dispatch "lgu:open" with
  // { tab, ...intent } as detail.
  const openRef = useRef(null);
  useEffect(() => {
    const onOpen = (e) => openRef.current?.(e.detail);
    window.addEventListener("lgu:open", onOpen);
    return () => window.removeEventListener("lgu:open", onOpen);
  }, []);
  const openFromSearch = (it) => {
    if (!it) return;
    if (it.action === "theme") { toggle(); return; }
    if (it.action === "account") { setAccountTab(it.accountTab || "profile"); setShowAccountSettings(true); return; }
    if (it.tab === "households") setSearchTarget(it.household || "");
    pushPage(it.tab, it.tab === "households" ? { q: it.household } : {});
    setIntent({ ...it, ts: Date.now() });
    setTab(it.tab);
  };
  openRef.current = openFromSearch;
  const goTab = (key) => {
    if (key === tab && !intent) return;          // already here: keep the current view
    pushPage(key); setIntent(null); setSearchTarget(""); setTab(key);
  };

  // Make sure the address always names the page (first load, after login),
  // and follow the browser's Back / Forward buttons.
  useEffect(() => {
    if (!user || !token) return;
    if (!readRoute().page) window.history.replaceState(null, "", `#/${tab}`);
  }, [user, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onPop = () => {
      const page = readRoute().page || getDefaultPage();
      if (!readRoute().page) window.history.replaceState(null, "", `#/${page}`);
      setIntent(null);
      setSearchTarget(page === "households" ? getParam("q") || "" : "");
      setTab(page);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const pageIntent = (key) => (intent && intent.tab === key ? intent : null);

  const handleLogin  = (userData, jwtToken) => { setUser(userData); setToken(jwtToken); };

  const handleLogout = () => {
    localStorage.removeItem("token"); localStorage.removeItem("user");
    setUser(null); setToken(null); setTab(getDefaultPage()); setIntent(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setDropdownOpen(false);
  };

  // Filter nav items based on the logged-in user's role
  const allowedNav = NAV_ITEMS.filter(({ key }) =>
    getRoleAccess(user?.role).includes(key)
  );

  // A remembered page this account cannot open falls back to its first page.
  useEffect(() => {
    if (!user || tab === "about" || allowedNav.some((n) => n.key === tab)) return;
    const first = allowedNav[0]?.key || "dashboard";
    window.history.replaceState(null, "", `#/${first}`); setTab(first);
  }, [user, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading / session check ──
  if (checking) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center",
      justifyContent:"center",
      background:"linear-gradient(135deg,#1a237e 0%,#1565c0 50%,#0288d1 100%)",
      flexDirection:"column", gap:16 }}>
      <div style={{ width:48, height:48, border:"4px solid rgba(255,255,255,0.3)",
        borderTop:"4px solid #fff", borderRadius:"50%",
        animation:"spin 0.8s linear infinite" }}/>
      <div style={{ color:"#fff", fontSize:14, fontWeight:600 }}>Verifying session...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  // ── Landing page (with built-in login modal) ──
  if (!user || !token) {
    return <LandingPage onLogin={handleLogin} />;
  }

  // ── Main app ──
  return (
    <div style={{
      display: "flex",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
      background: D.pageBg,
      fontFamily: "'Segoe UI', sans-serif",
      fontSize: "15px",
      transition: "background 0.4s ease",
    }}>

      {/* ── LEFT SIDEBAR — always a dark navy/blue gradient ── */}
      <div style={{
        width: 240,
        flexShrink: 0,
        height: "100vh",
        background: D.sidebarBg,
        borderRight: `1px solid ${D.sidebarBorder}`,
        display: "flex", flexDirection: "column",
        boxShadow: D.sidebarShadow, zIndex: 100,
        position: "relative",
        overflowY: "auto",
      }}>

        {/* Soft top glow for depth */}
        <div style={{
          position:"absolute", top:0, left:0, right:0, height:180,
          background:"radial-gradient(ellipse at 30% 0%, rgba(91,141,238,0.16) 0%, transparent 65%)",
          pointerEvents:"none",
        }}/>

        {/* Logo block */}
        <div style={{ padding:"22px 20px 18px", flexShrink:0,
          borderBottom:`1px solid ${D.sidebarDivider}`, position:"relative" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <img src={lguIcon} alt="LGU-SDSS"
              style={{ width:42, height:42, objectFit:"contain", borderRadius:10,
                boxShadow:"0 0 0 1px rgba(91,141,238,0.25)" }}/>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:D.sidebarTextPrimary, lineHeight:1.2 }}>
                LGU-SDSS
              </div>
              <div style={{ fontSize:11, color:D.sidebarTextMuted, marginTop:2 }}>
                Spatial Decision Support
              </div>
            </div>
          </div>
          <div style={{ marginTop:12, paddingTop:12,
            borderTop:`1px solid ${D.sidebarDivider}` }}>
            <div style={{ fontSize:12, fontWeight:700, color:D.sidebarTextPrimary, lineHeight:1.2 }}>
              Municipality of San Miguel
            </div>
            <div style={{ fontSize:11, color:D.sidebarTextMuted, marginTop:2 }}>
              Iloilo, Philippines
            </div>
          </div>
        </div>

        {/* Omni Search -- one search for the whole system (also Ctrl+K) */}
        <div style={{ padding:"14px 12px 2px", flexShrink:0, position:"relative" }}>
          <OmniSearchTrigger onOpen={() => setOmniOpen(true)} />
        </div>

        {/* Nav items — filtered by role */}
        <nav style={{ flex:1, padding:"14px 12px",
          display:"flex", flexDirection:"column", gap:3, position:"relative" }}>
          {allowedNav.map(({ key, label, Icon: NavIcon }) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => goTab(key)} style={{
                display:"flex", alignItems:"center", gap:12,
                padding:"11px 14px", borderRadius:8, cursor:"pointer",
                border:"none", width:"100%", textAlign:"left",
                background: active ? D.sidebarNavActive : "transparent",
                borderLeft: active
                  ? `3px solid ${D.sidebarNavActiveBorder}`
                  : "3px solid transparent",
                color: active ? D.sidebarNavActiveText : D.sidebarNavText,
                fontWeight: active ? 700 : 500,
                fontSize: 14, transition:"all 0.15s",
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = D.sidebarNavHover; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <NavIcon color={active ? D.sidebarNavActiveText : D.sidebarNavText}/>
                {label}
              </button>
            );
          })}
        </nav>

        {/* Bottom: toggle + user */}
        <div style={{ padding:"14px 12px", flexShrink:0,
          borderTop:`1px solid ${D.sidebarDivider}`, position:"relative" }}>

          {/* Dark mode toggle (controls the main content area's theme) */}
          <button onClick={toggle} style={{
            display:"flex", alignItems:"center", gap:8,
            width:"100%", padding:"10px 14px", borderRadius:8,
            border:`1px solid ${D.sidebarToggleBorder}`,
            background:D.sidebarToggleBg, color:D.sidebarToggleColor,
            fontSize:13, fontWeight:600, cursor:"pointer",
            marginBottom:10, transition:"all 0.2s",
          }}>
            {dark ? <IconSun/> : <IconMoon/>}
            {dark ? "Light Mode" : "Dark Mode"}
          </button>

          {/* User info + logout dropdown */}
          <div style={{ position:"relative" }} ref={dropdownRef}>
            <button onClick={() => setDropdownOpen(o => !o)} style={{
              display:"flex", alignItems:"center", gap:10,
              width:"100%", padding:"10px 12px", borderRadius:8,
              background:"none", border:"none", cursor:"pointer",
              transition:"background 0.15s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = D.sidebarHoverBg}
              onMouseLeave={e => e.currentTarget.style.background = "none"}
            >
              <img src={profilePic} alt="profile"
                style={{ width:34, height:34, borderRadius:"50%",
                  objectFit:"cover", border:`2px solid ${D.sidebarDivider}`, flexShrink:0 }}/>
              <div style={{ flex:1, textAlign:"left", minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:D.sidebarTextPrimary,
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {user.full_name || user.username}
                </div>
                <div style={{ fontSize:11, color:D.sidebarTextMuted,
                  textTransform:"uppercase", letterSpacing:0.4 }}>
                  {user.role}
                </div>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
                viewBox="0 0 24 24" fill="none" stroke={D.sidebarTextMuted}
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition:"transform 0.2s", flexShrink:0 }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {dropdownOpen && (
              <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:0, right:0,
                background:D.sidebarDropdownBg, borderRadius:10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                border:`1px solid ${D.sidebarDropdownBorder}`,
                zIndex:9999, overflow:"hidden",
                animation:"fadeUp 0.15s ease" }}>
                <style>{`
                  @keyframes fadeUp {
                    from { opacity:0; transform:translateY(6px); }
                    to   { opacity:1; transform:translateY(0); }
                  }
                `}</style>
                <button onClick={handleLogout} style={{
                  width:"100%", padding:"12px 16px",
                  background:"none", border:"none", cursor:"pointer",
                  textAlign:"left", fontSize:13, color:"#f06868",
                  fontWeight:600, display:"flex", alignItems:"center", gap:10,
                  transition:"background 0.15s",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(240,104,104,0.12)"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{
        flex: 1,
        minWidth: 0,
        height: "100vh",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        background: D.pageBg,
        transition: "background 0.4s ease",
      }}>
        {tab !== "about" && (
          <DataStatusBanner tab={tab} dark={dark}
            onImport={() => openFromSearch({ tab: "households", action: "import" })} />
        )}
        {tab === "dashboard" && (
          <Dashboard
            onViewMap={() => goTab("map")}
            user={user}
            onSearchSelect={(item) => {
              if (item.type === "member") {
                const hhNumber = item.detail?.replace("HH: ", "").trim();
                setSearchTarget(hhNumber);
              } else if (item.type === "household") {
                setSearchTarget(item.title);
              } else if (item.type === "barangay") {
                setSearchTarget("");
              }
              setTab("households");
            }}
            onAbout={() => goTab("about")}
            onOpenAttributes={() => goTab("attributes")}
            onOpenVulnerability={() => goTab("vulnerability")}
            onImport={() => openFromSearch({ tab: "households", action: "import" })}
            onAccountSettings={(tab) => { setAccountTab(typeof tab === "string" ? tab : "profile"); setShowAccountSettings(true); }}
          />
        )}
        {tab === "households" && (
          <HouseholdList
            intent={pageIntent("households")}
            initialSearch={searchTarget}
            onClearSearch={() => setSearchTarget("")}
          />
        )}
        {tab === "map"           && <MapView intent={pageIntent("map")} />}
        {tab === "vulnerability" && <VulnerabilityPage intent={pageIntent("vulnerability")} />}
        {tab === "attributes"    && <AttributesPage intent={pageIntent("attributes")} />}
        {tab === "network"       && <NetworkAnalysis />}
        {tab === "planning"      && <BarangayPlanning intent={pageIntent("planning")} />}
        {tab === "reports"       && <ReportsPage intent={pageIntent("reports")} />}
        {tab === "nlp-query"     && <NlpQueryPage intent={pageIntent("nlp-query")} />}
        {tab === "about" && <AboutPage onBack={() => goTab("dashboard")} />}
      </div>

      <OmniSearch open={omniOpen} onClose={() => setOmniOpen(false)} onNavigate={openFromSearch}
        dark={dark} allowedTabs={allowedNav.map((n) => n.key)} />

      {/* ── ACCOUNT SETTINGS OVERLAY ── */}
      {showAccountSettings && (
        <AccountSettings
          user={user}
          initialTab={accountTab}
          onClose={() => { setShowAccountSettings(false); setAccountTab("profile"); }}
          onUserUpdate={(updatedUser) => {
            setUser(updatedUser);
            localStorage.setItem("user", JSON.stringify(updatedUser));
          }}
          D={D}
        />
      )}

    </div>
  );
}