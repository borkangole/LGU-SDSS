import { useState, useEffect, useRef } from "react";
import sanMiguelSeal from "../assets/san_miguel.png";
import systemLogo from "../assets/logo.png";
import psaLogo from "../assets/psa.png";
import dilgLogo from "../assets/dilg.png";
import { getStats } from "../api/api";
import { useTheme } from "../hooks/useTheme";
import { TYPOLOGY_COLORS } from "../features/shared/domainColors";

/* ── Google Fonts (falls back to system fonts when offline) ── */
const FONT_LINK = document.createElement("link");
FONT_LINK.rel = "stylesheet";
FONT_LINK.href = "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap";
if (!document.querySelector('link[href*="Lora"]')) document.head.appendChild(FONT_LINK);

/* ── Fade-in hook ── */
function useFadeIn(threshold = 0.12) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

function Section({ children, style }) {
  const [ref, visible] = useFadeIn();
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(28px)",
      transition: "opacity 0.7s ease, transform 0.7s ease",
      ...style,
    }}>
      {children}
    </div>
  );
}

const ic = (d) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

/* ── The analytical model: three domains, never combined ── */
const DOMAINS = [
  {
    key: "svi", color: "#dc2626", tag: "Domain A · Level 1",
    title: "Social Vulnerability Index (SVI)",
    count: "13 indicators", max: "max 1,300",
    desc: "How socially vulnerable each barangay's population is.",
    items: [
      "Overcrowding · food insecurity · no internet access",
      "Weak roof · weak walls · insecure tenure · unimproved sanitation",
      "PWDs · senior citizens · solo parents (share of population)",
      "Adults 25+ with little or no schooling",
      "Share of households more than 2 km from the RHU · from the fire station",
    ],
  },
  {
    key: "cap", color: "#16a34a", tag: "Domain B · Capacity",
    title: "Barangay Capacity",
    count: "19 resources", max: "score 0–100",
    desc: "What each barangay has to respond. Rank 1 = best equipped.",
    items: [
      "Disaster committee · response team · hotline · preparedness seminar",
      "First-aid kits · boats · ambulances · amphibian vehicles · heavy equipment",
      "Sirens · radios · generators · emergency lights · DRRM budget",
      "DRRM plan · evacuation map · hazard map · schools · evacuation centres",
    ],
  },
  {
    key: "haz", color: "#2563eb", tag: "Domain B · View 1",
    title: "Hazard Exposure",
    count: "2 hazard layers", max: "per household",
    desc: "Which households sit inside mapped hazard zones, from their GPS location.",
    items: [
      "Flood susceptibility: low · moderate · high · very high",
      "Landslide susceptibility: low · moderate · high",
      "Flood and landslide are always reported separately",
      "Households outside mapped zones are 'not assessed', never assumed safe",
    ],
  },
];

const TYPOLOGY = [
  { id: 1, label: "Relatively stable", color: TYPOLOGY_COLORS[1] },
  { id: 0, label: "Food-insecure, otherwise stable", color: TYPOLOGY_COLORS[0] },
  { id: 3, label: "Financially excluded / structurally insecure", color: TYPOLOGY_COLORS[3] },
  { id: 2, label: "Senior-headed, education gaps", color: TYPOLOGY_COLORS[2] },
  { id: 4, label: "Compounded deprivation", color: TYPOLOGY_COLORS[4] },
];

const MODULES = [
  { num: "01", color: "#1a56db", title: "Dashboard",
    desc: "At-a-glance view of all 24 barangays: SVI and Barangay Capacity rankings side by side, hazard exposure, household typology mix and a two-panel heat map.",
    icon: ic(<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M7 8h2v5H7zM11 10h2v3h-2zM15 6h2v7h-2z"/></>) },
  { num: "02", color: "#7e3af2", title: "Households",
    desc: "One-step import of the 7 CBMS 2024 files, matched on the household ID, plus a guided Add Household form that uses the CBMS questionnaire's own questions and codes. Every change recalculates all scores automatically.",
    icon: ic(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>) },
  { num: "03", color: "#0e9f6e", title: "Map View",
    desc: "Interactive map with four views — Hazard (real flood and landslide layers with every household plotted), SVI, Barangay Capacity and Household Typology.",
    icon: ic(<><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>) },
  { num: "04", color: "#dc2626", title: "Vulnerability",
    desc: "Shows exactly how each barangay's scores are calculated, indicator by indicator, with a printable PDF of the method and results.",
    icon: ic(<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>) },
  { num: "05", color: "#e02424", title: "Family Network",
    desc: "Splits each household into its nuclear families using the CBMS family fields, and draws the relationships between members and between families sharing one roof.",
    icon: ic(<><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5l2.5 8M15.5 7.5l-2.5 8M9 6h6"/></>) },
  { num: "06", color: "#b45309", title: "Planning",
    desc: "Barangay-by-barangay priorities: where each barangay stands in every domain, and which indicators drive its social vulnerability.",
    icon: ic(<><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>) },
  { num: "07", color: "#057a55", title: "Reports & Export",
    desc: "PDF and Excel summaries, barangay comparisons and household lists for MPDO and MSWDO use.",
    icon: ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>) },
  { num: "08", color: "#0891b2", title: "Ask the Data",
    desc: "Ask questions in plain language. Only the question is sent to the AI — never household details — and results identify households by ID only.",
    icon: ic(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>) },
];

const OBJECTIVES = [
  { label: "Data Integration", desc: "Consolidate the CBMS 2024 household, member and barangay records into one PSA-CBMS–coded database, aligned on the official household identifier, with guided entry for new households." },
  { label: "Family Network Analysis", desc: "Identify the nuclear families inside each household from the CBMS family fields and visualize the relationships within and between them." },
  { label: "Social Vulnerability Indexing", desc: "Rank all 24 barangays with a 13-indicator Social Vulnerability Index and group households into a k-modes household typology." },
  { label: "Capacity & Hazard Assessment", desc: "Measure what each barangay has to respond (Barangay Capacity), and each household's exposure to mapped flood and landslide hazards — kept as separate views." },
  { label: "Spatial Decision Support", desc: "Present the domains on maps, rankings, planning views, reports and natural-language queries for MPDO and MSWDO decision-making." },
  { label: "ISO/IEC 25010 Evaluation", desc: "Evaluate functional suitability and usability with MPDO and MSWDO officers as primary evaluators." },
];

const DELIMITATIONS = [
  { title: "Data Source", desc: "Secondary data only — the CBMS 2024 census of San Miguel. No primary survey. Household income is not part of the dataset and is not used in any score." },
  { title: "Family Relationships", desc: "Relationships within a household come from the CBMS family fields. Kinship between separate households is outside the scope." },
  { title: "Spatial Scope", desc: "A point-in-time snapshot at the households' recorded CBMS coordinates, against the flood and landslide maps available to the LGU." },
  { title: "Separate Domains", desc: "Social vulnerability, capacity and hazard are reported side by side and never merged into one combined score." },
  { title: "Decision Support", desc: "The system supports decisions; it does not make them. Staff verification is required before any benefit allocation." },
  { title: "Deployment", desc: "Runs on an LGU computer or internal network — installed locally, with no data sent to the internet except the optional AI question text." },
];

const BENEFICIARIES = [
  { color: "#1a56db", acronym: "LGU", title: "Local Government Unit", logo: sanMiguelSeal,
    desc: "Turns the CBMS census into one organized repository and ready-to-use indicators, closing the gap between raw data and planning decisions." },
  { color: "#0e9f6e", acronym: "MPDO", title: "Municipal Planning & Development Office", logo: sanMiguelSeal,
    desc: "Addresses spatial blindness: barangay rankings, hazard exposure and facility distance on one map, ready for CLUP and DRRM planning." },
  { color: "#7e3af2", acronym: "MSWDO", title: "Municipal Social Welfare & Development Office", logo: sanMiguelSeal,
    desc: "Reveals the families inside each household and the household types that need attention — the elderly, PWDs, solo parents and the financially excluded." },
  { color: "#d97706", acronym: "PSA", title: "Philippine Statistics Authority", logo: psaLogo,
    desc: "The system follows the PSA-CBMS 2024 data structure and questionnaire codes, so imported and hand-entered records stay consistent with the census." },
  { color: "#e02424", acronym: "DILG", title: "Dept. of the Interior & Local Government", logo: dilgLogo,
    desc: "Supports LGU planning under full devolution (EO 138) and the hazard and vulnerability analysis expected in the Comprehensive Land Use Plan." },
];

const TECH_STACK = [
  { layer: "Frontend", color: "#61DAFB", items: ["React 19", "Vite 7", "React Router 7", "Leaflet · React-Leaflet", "Recharts", "React Flow", "jsPDF · SheetJS"] },
  { layer: "API", color: "#64748b", items: ["Python 3.12", "Flask 3", "Flask-JWT-Extended", "Flask-CORS", "Waitress"] },
  { layer: "Analytics", color: "#3776AB", items: ["Pandas", "GeoPandas · Shapely", "NetworkX", "k-modes", "scikit-learn", "Matplotlib"] },
  { layer: "Data", color: "#336791", items: ["PostgreSQL 18", "psycopg2", "GeoJSON hazard layers", "CBMS 2024"] },
  { layer: "AI (optional)", color: "#0891b2", items: ["Google Gemini", "Question text only", "Read-only SQL views"] },
  { layer: "Deployment", color: "#646CFF", items: ["Windows installer", "Bundled Python + PostgreSQL", "Docker"] },
];

const TEAM = [
  { name: "Anton Gerald T. Añes", initials: "AGA", role: "Frontend Developer", color: "#7e3af2", thesis: "UI/UX Design · React.js · Component Architecture" },
  { name: "Miguel Jacob A. Artillero", initials: "MJA", role: "GIS & Backend Dev", color: "#0e9f6e", thesis: "Spatial Analysis · Hazard Layers · Map Rendering" },
  { name: "Mhel B. Bustamante", initials: "MB", role: "Full Stack Developer", color: "#1a56db", thesis: "System Architecture · Flask API · Database Design" },
  { name: "Ebenezer C. Danila", initials: "ED", role: "Database Engineer", color: "#d97706", thesis: "PostgreSQL · Network Analysis · Vulnerability Engine" },
];

const COMPLIANCE = [
  { label: "RA 11315 · CBMS Act", color: "#1a56db", desc: "Built on data collected under the Community-Based Monitoring System Act" },
  { label: "EO 138 · Full Devolution", color: "#0e9f6e", desc: "Supports LGUs in the full devolution of basic services" },
  { label: "DHSUD CLUP Guidelines", color: "#7e3af2", desc: "Hazard and vulnerability analysis for land use planning" },
  { label: "RA 10173 · Data Privacy Act", color: "#e02424", desc: "Role-based access; the AI never receives household details" },
  { label: "PSA-CBMS 2024 Schema", color: "#d97706", desc: "Records follow the CBMS questionnaire structure and codes" },
  { label: "ISO/IEC 25010", color: "#057a55", desc: "System quality evaluated per international software quality standards" },
];

export default function AboutPage({ onBack }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const { dark } = useTheme();

  useEffect(() => {
    getStats().then(r => setStats(r.data)).catch(() => setStats(null));
  }, []);

  /* theme tokens */
  const T = dark ? {
    pageBg: "#0b1120", card: "#111a2e", cardSoft: "#0f172a", border: "rgba(148,163,184,0.14)",
    text: "#e2e8f0", heading: "#f1f5f9", muted: "#94a3b8", faint: "#64748b",
    shadow: "0 2px 10px rgba(0,0,0,0.35)", chip: "#1e293b", chipBorder: "#334155",
    warnBg: "rgba(217,119,6,0.10)", warnTitle: "#fbbf24", warnText: "#fcd34d",
  } : {
    pageBg: "#f7f8fc", card: "#fff", cardSoft: "#f8fafc", border: "#e2e8f0",
    text: "#1e293b", heading: "#0f172a", muted: "#64748b", faint: "#94a3b8",
    shadow: "0 2px 8px rgba(0,0,0,0.05)", chip: "#f1f5f9", chipBorder: "#e2e8f0",
    warnBg: "#fffbeb", warnTitle: "#92400e", warnText: "#78350f",
  };
  const card = { background: T.card, borderRadius: 14, boxShadow: T.shadow, border: dark ? `1px solid ${T.border}` : "none" };
  const h3 = { margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, color: T.heading, fontFamily: "'Lora',serif" };
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "model", label: "Analytical Model" },
    { id: "objectives", label: "Objectives" },
    { id: "modules", label: "System Modules" },
    { id: "beneficiaries", label: "Beneficiaries" },
    { id: "tech", label: "Technology" },
    { id: "team", label: "The Team" },
  ];

  const statTiles = [
    { value: fmt(stats?.total_households), label: "Households", color: "#1a56db" },
    { value: fmt(stats?.total_individuals), label: "Residents", color: "#7e3af2" },
    { value: fmt(stats?.total_barangays ?? 24), label: "Barangays", color: "#0e9f6e" },
    { value: "13", label: "SVI Indicators", color: "#dc2626" },
    { value: "19", label: "Capacity Resources", color: "#16a34a" },
    { value: "5", label: "Household Types", color: "#0891b2" },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: T.pageBg, minHeight: "100vh", color: T.text }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-16px)} to{opacity:1;transform:translateX(0)} }
        .about-tab { transition: all 0.2s; border-bottom: 2px solid transparent; }
        .about-tab:hover { color: #bfdbfe !important; }
        .module-card { transition: all 0.25s; }
        .module-card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(0,0,0,0.12) !important; }
        .team-card { transition: all 0.25s; }
        .team-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.12) !important; }
        .compliance-pill { transition: all 0.2s; }
        .compliance-pill:hover { transform: translateY(-2px); }
        @media (max-width: 760px) { .about-2col { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* ── PAGE HEADER ── */}
      <div style={{ background: "linear-gradient(135deg, #0c1a38 0%, #0f2460 55%, #1a3a8a 100%)", padding: "3.5rem 2rem 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)", backgroundSize:"48px 48px", pointerEvents:"none" }}/>
        <div style={{ position:"absolute", top:"-30%", right:"5%", width:500, height:500, borderRadius:"50%", background:"radial-gradient(circle,rgba(59,130,246,0.18) 0%,transparent 70%)", pointerEvents:"none" }}/>

        <div style={{ maxWidth:1100, margin:"0 auto", position:"relative", zIndex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:24, animation:"fadeUp 0.5s ease both" }}>
            {onBack && (
              <button onClick={onBack} style={{
                display:"flex", alignItems:"center", gap:6,
                background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)",
                borderRadius:7, padding:"5px 12px", cursor:"pointer",
                fontSize:12, color:"rgba(255,255,255,0.7)", fontFamily:"inherit",
                transition:"all 0.2s", marginRight:4,
              }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.14)";e.currentTarget.style.color="#fff";}}
              onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(255,255,255,0.7)";}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                Back
              </button>
            )}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span style={{ color:"rgba(255,255,255,0.35)", fontSize:12 }}>LGU-SDSS</span>
            <span style={{ color:"rgba(255,255,255,0.2)", fontSize:12 }}>/</span>
            <span style={{ color:"rgba(147,197,253,0.8)", fontSize:12, fontWeight:600 }}>About the System</span>
          </div>

          <div style={{ display:"flex", alignItems:"flex-start", gap:20, marginBottom:"2.5rem", animation:"fadeUp 0.6s 0.05s ease both", opacity:0, animationFillMode:"forwards" }}>
            <div style={{ width:64, height:64, borderRadius:14, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 20px rgba(0,0,0,0.3)" }}>
              <img src={systemLogo} alt="LGU-SDSS" style={{ width:64, height:64, objectFit:"contain", borderRadius:14 }}/>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(147,197,253,0.7)", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:6 }}>
                Municipality of San Miguel, Iloilo · CBMS 2024
              </div>
              <h1 style={{ fontSize:"clamp(1.6rem,3vw,2.4rem)", fontWeight:700, color:"#fff", margin:"0 0 8px", fontFamily:"'Lora',serif", letterSpacing:"-0.3px", lineHeight:1.2 }}>
                About This System
              </h1>
              <p style={{ color:"rgba(255,255,255,0.6)", fontSize:"0.95rem", margin:0, maxWidth:600, lineHeight:1.65 }}>
                A Spatial Decision Support Information System for Visualizing Family-Level Vulnerability and Resilience to Support LGU Planning.
              </p>
            </div>
          </div>

          <div style={{ display:"flex", gap:0, borderBottom:"1px solid rgba(255,255,255,0.08)", animation:"fadeUp 0.6s 0.1s ease both", opacity:0, animationFillMode:"forwards", overflowX:"auto" }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="about-tab"
                style={{
                  background:"none", border:"none", borderBottom:"2px solid transparent",
                  padding:"12px 18px", fontSize:13, fontWeight:600, cursor:"pointer",
                  color: activeTab === tab.id ? "#93c5fd" : "rgba(255,255,255,0.5)",
                  borderBottomColor: activeTab === tab.id ? "#93c5fd" : "transparent",
                  fontFamily:"inherit", whiteSpace:"nowrap",
                }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"2.5rem 2rem 4rem" }}>

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <div style={{ animation:"fadeUp 0.5s ease both" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:32 }}>
              {statTiles.map((s,i) => (
                <div key={s.label} style={{ ...card, padding:"16px 18px", borderTop:`3px solid ${s.color}`, animation:`fadeUp 0.5s ${i*60}ms ease both` }}>
                  <div style={{ fontSize:"1.6rem", fontWeight:800, color:s.color, fontFamily:"'Lora',serif", letterSpacing:"-0.5px" }}>{s.value}</div>
                  <div style={{ fontSize:11, color:T.muted, fontWeight:600, marginTop:2, textTransform:"uppercase", letterSpacing:"0.06em" }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div className="about-2col" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
              <Section style={{ gridColumn:"1 / -1" }}>
                <div style={{ ...card, padding:"2rem", borderLeft:"4px solid #1a56db" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ width:32, height:32, background: dark ? "rgba(26,86,219,0.15)" : "#eff6ff", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <h2 style={{ margin:0, fontSize:"1.1rem", fontWeight:700, color:T.heading, fontFamily:"'Lora',serif" }}>Background of the Study</h2>
                  </div>
                  <p style={{ margin:"0 0 12px", color:T.muted, lineHeight:1.8, fontSize:"0.92rem" }}>
                    The landscape of social protection in the Philippines is undergoing a paradigm shift toward decentralized, data-driven governance, catalyzed by the <strong style={{color:T.text}}>Mandanas-Garcia Ruling</strong> and Executive Order No. 138, which mandates the full devolution of basic services to local authorities. LGUs have become the primary frontliners for localized planning and targeted poverty reduction using the <strong style={{color:T.text}}>Community-Based Monitoring System (CBMS)</strong> as the mandatory data standard.
                  </p>
                  <p style={{ margin:"0 0 12px", color:T.muted, lineHeight:1.8, fontSize:"0.92rem" }}>
                    However, a significant <strong style={{color:T.text}}>"Implementation Gap"</strong> remains: while LGUs possess vast amounts of raw data, they often lack the specialized decision-support tools to transform it into the vulnerability, capacity and hazard information needed for their Comprehensive Land Use Plans (CLUP).
                  </p>
                  <p style={{ margin:0, color:T.muted, lineHeight:1.8, fontSize:"0.92rem" }}>
                    Two critical limitations drive this system: <strong style={{color:T.text}}>Intra-household Blindness</strong> — where aggregate household data masks the vulnerabilities of individual family units like solo parents, indigent elderly, or PWDs — and <strong style={{color:T.text}}>Spatial Blindness</strong>, where tabular data fails to show the geographic distribution of need, leaving concentrations of high-risk populations invisible to planners.
                  </p>
                </div>
              </Section>

              <Section>
                <div style={{ ...card, padding:"1.75rem", height:"100%", boxSizing:"border-box" }}>
                  <h3 style={h3}>Problems Addressed</h3>
                  {[
                    { tag:"Gap 1", color:"#e02424", title:"Implementation Gap", desc:"LGUs lack tools to turn raw CBMS data into ready-to-use vulnerability, capacity and hazard indicators for planning." },
                    { tag:"Gap 2", color:"#d97706", title:"Intra-household Blindness", desc:"Household-level totals hide vulnerable family units — solo parents, elderly, PWDs — living within shared dwellings." },
                    { tag:"Gap 3", color:"#7e3af2", title:"Spatial Blindness", desc:"Tabular lists fail to show where need is concentrated. Hazard-exposed and underserved areas stay invisible without maps." },
                  ].map(p => (
                    <div key={p.tag} style={{ display:"flex", gap:12, marginBottom:16 }}>
                      <div style={{ flexShrink:0, width:48, height:48, borderRadius:10, background:`${p.color}14`, border:`1px solid ${p.color}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ fontSize:9, fontWeight:800, color:p.color, fontFamily:"'DM Mono',monospace", letterSpacing:"0.04em" }}>{p.tag}</span>
                      </div>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13, color:T.text, marginBottom:3 }}>{p.title}</div>
                        <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>{p.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Model at a glance */}
              <Section>
                <div style={{ ...card, padding:"1.75rem", height:"100%", boxSizing:"border-box" }}>
                  <h3 style={h3}>Three Domains, Never Combined</h3>
                  <div style={{ background:"linear-gradient(135deg,#0f2460,#1a3a8a)", borderRadius:12, padding:"1rem 1.25rem", marginBottom:16 }}>
                    <div style={{ fontSize:11, color:"rgba(147,197,253,0.8)", fontWeight:600, letterSpacing:"0.1em", marginBottom:6 }}>HOW EACH SCORE IS BUILT</div>
                    <div style={{ fontSize:12.5, color:"#fff", lineHeight:1.7 }}>
                      Each indicator is percentile-ranked across the 24 barangays (0–100) and the ranks are summed. <strong>Rank 1 = most vulnerable</strong>, in every domain.
                    </div>
                  </div>
                  {DOMAINS.map(d => (
                    <div key={d.key} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:11 }}>
                      <div style={{ width:10, height:28, borderRadius:3, background:d.color, flexShrink:0 }}/>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2, gap:8 }}>
                          <span style={{ fontSize:12.5, fontWeight:700, color:T.text }}>{d.title}</span>
                          <span style={{ fontSize:10.5, fontWeight:700, color:d.color, fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap" }}>{d.count}</span>
                        </div>
                        <div style={{ fontSize:11, color:T.faint }}>{d.desc}</div>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setActiveTab("model")} style={{ marginTop:8, background:"none", border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:600, color:"#3b82f6", cursor:"pointer", fontFamily:"inherit" }}>
                    See the full model →
                  </button>
                </div>
              </Section>

              <Section style={{ gridColumn:"1 / -1" }}>
                <div style={{ ...card, padding:"2rem" }}>
                  <h3 style={{ ...h3, marginBottom:20 }}>How the System Works</h3>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:18 }}>
                    {[
                      { num:"01", title:"Import the CBMS", desc:"Upload the 7 CBMS 2024 files; the system detects each one and aligns households, members and barangays by their official IDs. New households can also be added by hand.", color:"#1a56db" },
                      { num:"02", title:"Map the Families", desc:"Each household is split into its nuclear families using the CBMS family fields, and every relationship is recorded for the network view.", color:"#7e3af2" },
                      { num:"03", title:"Score Automatically", desc:"After every import, addition or deletion, the SVI, Barangay Capacity, hazard exposure and household types are recalculated.", color:"#dc2626" },
                      { num:"04", title:"Decide with Evidence", desc:"Maps, rankings, planning views, reports and plain-language questions put the results in front of MPDO and MSWDO staff.", color:"#0e9f6e" },
                    ].map(s => (
                      <div key={s.num}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                          <div style={{ width:32, height:32, borderRadius:"50%", background:s.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <span style={{ fontSize:11, fontWeight:800, color:"#fff", fontFamily:"'DM Mono',monospace" }}>{s.num}</span>
                          </div>
                          <div style={{ fontWeight:700, fontSize:13, color:T.heading }}>{s.title}</div>
                        </div>
                        <p style={{ margin:0, fontSize:12, color:T.muted, lineHeight:1.7, paddingLeft:42 }}>{s.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Section>

              <Section style={{ gridColumn:"1 / -1" }}>
                <div style={{ ...card, padding:"2rem" }}>
                  <h3 style={h3}>Regulatory & Standards Alignment</h3>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                    {COMPLIANCE.map(c => (
                      <div key={c.label} className="compliance-pill" style={{ background:`${c.color}0f`, border:`1px solid ${c.color}30`, borderLeft:`3px solid ${c.color}`, borderRadius:8, padding:"10px 14px", cursor:"default" }}>
                        <div style={{ fontSize:12, fontWeight:700, color:c.color, marginBottom:3 }}>{c.label}</div>
                        <div style={{ fontSize:11, color:T.muted }}>{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Section>
            </div>
          </div>
        )}

        {/* ── ANALYTICAL MODEL ── */}
        {activeTab === "model" && (
          <div style={{ animation:"fadeUp 0.5s ease both" }}>
            <p style={{ color:T.muted, fontSize:"0.93rem", marginBottom:24, lineHeight:1.7, maxWidth:720 }}>
              LGU-SDSS reports three separate domains side by side. They answer different questions, so they are <strong style={{color:T.text}}>never added together into one overall score</strong>. A barangay can rank high in social vulnerability and low in hazard exposure, and planners should see both.
            </p>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:16, marginBottom:20 }}>
              {DOMAINS.map(d => (
                <Section key={d.key}>
                  <div style={{ ...card, padding:"1.6rem", borderTop:`3px solid ${d.color}`, height:"100%", boxSizing:"border-box" }}>
                    <div style={{ fontSize:10.5, fontWeight:700, color:d.color, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>{d.tag}</div>
                    <div style={{ fontWeight:700, fontSize:"1.02rem", color:T.heading, fontFamily:"'Lora',serif", marginBottom:6 }}>{d.title}</div>
                    <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                      {[d.count, d.max].map(x => (
                        <span key={x} style={{ fontSize:10.5, fontWeight:600, color:d.color, background:`${d.color}14`, borderRadius:5, padding:"2px 8px", fontFamily:"'DM Mono',monospace" }}>{x}</span>
                      ))}
                    </div>
                    <p style={{ margin:"0 0 12px", fontSize:12.5, color:T.muted, lineHeight:1.65 }}>{d.desc}</p>
                    <ul style={{ margin:0, paddingLeft:18 }}>
                      {d.items.map(it => <li key={it} style={{ fontSize:12, color:T.text, lineHeight:1.7 }}>{it}</li>)}
                    </ul>
                  </div>
                </Section>
              ))}
            </div>

            <div className="about-2col" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              <Section>
                <div style={{ ...card, padding:"1.75rem", height:"100%", boxSizing:"border-box" }}>
                  <h3 style={h3}>Scoring Method</h3>
                  {[
                    ["1", "Each indicator is computed per barangay (e.g. % of households with a weak roof, % of residents who are seniors)."],
                    ["2", "Every indicator is percentile-ranked across the 24 barangays, from 0 to 100."],
                    ["3", "For SVI the ranks are summed (up to 1,300). For Barangay Capacity they are averaged into a 0–100 score, where rank 1 is the best equipped."],
                    ["4", "Barangays are ranked by score; for SVI, rank 1 is the most vulnerable."],
                    ["5", "Tiers are equal groups of six by rank: High (1–6), Moderate-high (7–12), Moderate-low (13–18), Low (19–24)."],
                  ].map(([n, t]) => (
                    <div key={n} style={{ display:"flex", gap:10, marginBottom:10 }}>
                      <span style={{ flexShrink:0, width:22, height:22, borderRadius:"50%", background: dark ? "#1e293b" : "#eff6ff", color:"#3b82f6", fontSize:11, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Mono',monospace" }}>{n}</span>
                      <span style={{ fontSize:12.5, color:T.muted, lineHeight:1.65 }}>{t}</span>
                    </div>
                  ))}
                  <div style={{ marginTop:8, padding:"10px 14px", background:T.cardSoft, borderRadius:8, borderLeft:"3px solid #1a56db", fontSize:11.5, color:T.muted, lineHeight:1.6 }}>
                    Equal weights, no expert weighting: every indicator counts the same, so the results are transparent and easy to explain.
                  </div>
                </div>
              </Section>

              <Section>
                <div style={{ ...card, padding:"1.75rem", height:"100%", boxSizing:"border-box" }}>
                  <div style={{ fontSize:10.5, fontWeight:700, color:"#0891b2", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>Domain A · Level 2</div>
                  <h3 style={{ ...h3, marginBottom:8 }}>Household Typology</h3>
                  <p style={{ margin:"0 0 14px", fontSize:12.5, color:T.muted, lineHeight:1.65 }}>
                    Households are grouped by <strong style={{color:T.text}}>k-modes clustering</strong> on 13 household characteristics — housing, food security, internet, sanitation, members who are PWDs, seniors or solo parents, schooling, household size and access to financial accounts. New households join the nearest group automatically.
                  </p>
                  {TYPOLOGY.map(t => (
                    <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                      <span style={{ width:12, height:12, borderRadius:3, background:t.color, flexShrink:0 }}/>
                      <span style={{ fontSize:12.5, color:T.text }}>{t.label}</span>
                    </div>
                  ))}
                  <div style={{ marginTop:10, fontSize:11, color:T.faint, lineHeight:1.6 }}>
                    The typology describes household profiles; it does not change any barangay's SVI rank.
                  </div>
                </div>
              </Section>
            </div>
          </div>
        )}

        {/* ── OBJECTIVES ── */}
        {activeTab === "objectives" && (
          <div style={{ animation:"fadeUp 0.5s ease both" }}>
            <div style={{ ...card, padding:"2rem", marginBottom:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <div style={{ width:32, height:32, background: dark ? "rgba(26,86,219,0.15)" : "#eff6ff", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <h2 style={{ margin:0, fontSize:"1.1rem", fontWeight:700, color:T.heading, fontFamily:"'Lora',serif" }}>General Objective</h2>
              </div>
              <p style={{ margin:0, color:T.muted, lineHeight:1.8, fontSize:"0.95rem" }}>
                To develop a <strong style={{color:T.text}}>Spatial Decision Support System (SDSS)</strong> that features Network-Based Resilience Profiling and Family-Level Vulnerability Indexing to assist LGU planning and social protection targeting in the Municipality of San Miguel, Iloilo.
              </p>
            </div>

            <h3 style={{ margin:"0 0 14px", fontSize:"0.9rem", fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.1em" }}>Specific Objectives</h3>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:14 }}>
              {OBJECTIVES.map((o, i) => (
                <Section key={o.label}>
                  <div style={{ ...card, borderRadius:12, padding:"1.5rem", display:"flex", gap:14, alignItems:"flex-start", height:"100%", boxSizing:"border-box" }}>
                    <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:`hsla(${i * 50 + 210}, 70%, 55%, 0.14)`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:`hsl(${i * 50 + 210}, 65%, ${dark ? 65 : 40}%)`, fontFamily:"'DM Mono',monospace" }}>
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:13.5, color:T.heading, marginBottom:6 }}>{o.label}</div>
                      <div style={{ fontSize:12.5, color:T.muted, lineHeight:1.7 }}>{o.desc}</div>
                    </div>
                  </div>
                </Section>
              ))}
            </div>

            <Section style={{ marginTop:24 }}>
              <div style={{ ...card, padding:"2rem", borderLeft:"4px solid #d97706" }}>
                <h3 style={h3}>Scope & Delimitations</h3>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:14 }}>
                  {DELIMITATIONS.map(d => (
                    <div key={d.title} style={{ background:T.warnBg, borderRadius:8, padding:"12px 14px" }}>
                      <div style={{ fontWeight:700, fontSize:12, color:T.warnTitle, marginBottom:4 }}>{d.title}</div>
                      <div style={{ fontSize:12, color:T.warnText, lineHeight:1.6 }}>{d.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          </div>
        )}

        {/* ── SYSTEM MODULES ── */}
        {activeTab === "modules" && (
          <div style={{ animation:"fadeUp 0.5s ease both" }}>
            <p style={{ color:T.muted, fontSize:"0.93rem", marginBottom:24, lineHeight:1.7, maxWidth:680 }}>
              LGU-SDSS is organized into eight modules, one for each page in the sidebar. Access depends on the user's role (Admin, MPDO, MSWDO or LGU Planning).
            </p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:16 }}>
              {MODULES.map(m => (
                <Section key={m.num}>
                  <div className="module-card" style={{ ...card, padding:"1.6rem", borderTop:`3px solid ${m.color}`, height:"100%", boxSizing:"border-box" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                      <div style={{ width:44, height:44, background:`${m.color}16`, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", color:m.color }}>{m.icon}</div>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, color:T.faint }}>{m.num}</span>
                    </div>
                    <div style={{ fontWeight:700, fontSize:"1rem", color:T.heading, marginBottom:8, fontFamily:"'Lora',serif" }}>{m.title}</div>
                    <p style={{ margin:0, fontSize:12.5, color:T.muted, lineHeight:1.75 }}>{m.desc}</p>
                  </div>
                </Section>
              ))}
            </div>

            <Section style={{ marginTop:24 }}>
              <div style={{ ...card, padding:"2rem" }}>
                <h3 style={{ ...h3, marginBottom:18 }}>Development Methodology — Agile Prototyping Model</h3>
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  {[
                    { phase:"Prototype 1", label:"Data Integration", color:"#1a56db", desc:"CBMS 2024 database, household and member records, 7-file import aligned on the household ID." },
                    { phase:"Prototype 2", label:"Network + Domain Scoring", color:"#7e3af2", desc:"Nuclear-family network from the CBMS family fields; SVI, Barangay Capacity, hazard exposure and household typology with automatic recalculation." },
                    { phase:"Prototype 3", label:"Spatial Mapping + Dashboard", color:"#0e9f6e", desc:"Interactive maps with real hazard layers, barangay rankings, typology composition and the dashboard." },
                    { phase:"Prototype 4", label:"Reporting, Access Control + Ask the Data", color:"#d97706", desc:"JWT login, role-based access, PDF/Excel export, privacy-safe natural-language queries and the Windows installer." },
                    { phase:"Evaluation", label:"UAT + ISO/IEC 25010", color:"#057a55", desc:"User acceptance testing with MPDO and MSWDO officers, evaluated for functional suitability and usability." },
                  ].map(p => (
                    <div key={p.phase} style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                      <div style={{ width:10, height:10, borderRadius:"50%", background:p.color, marginTop:5, flexShrink:0 }}/>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
                          <span style={{ fontSize:10, fontWeight:700, color:p.color, background:`${p.color}16`, borderRadius:4, padding:"1px 8px", fontFamily:"'DM Mono',monospace" }}>{p.phase}</span>
                          <span style={{ fontSize:13, fontWeight:700, color:T.heading }}>{p.label}</span>
                        </div>
                        <p style={{ margin:0, fontSize:12, color:T.muted, lineHeight:1.65 }}>{p.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          </div>
        )}

        {/* ── BENEFICIARIES ── */}
        {activeTab === "beneficiaries" && (
          <div style={{ animation:"fadeUp 0.5s ease both" }}>
            <p style={{ color:T.muted, fontSize:"0.93rem", marginBottom:24, lineHeight:1.7, maxWidth:680 }}>
              The system moves social protection planning from manual household-level tallies to a family-aware, spatial view of need.
            </p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:16 }}>
              {BENEFICIARIES.map(b => (
                <Section key={b.acronym}>
                  <div style={{ ...card, padding:"1.75rem", borderTop:`3px solid ${b.color}`, height:"100%", boxSizing:"border-box" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                      <div style={{ width:48, height:48, background:"#fff", border:`1px solid ${b.color}25`, borderRadius:10, padding:4, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <img src={b.logo} alt={b.acronym} style={{ width:38, height:38, objectFit:"contain" }}/>
                      </div>
                      <div>
                        <div style={{ fontSize:11, fontWeight:800, color:b.color, letterSpacing:"0.08em" }}>{b.acronym}</div>
                        <div style={{ fontWeight:700, fontSize:13, color:T.heading }}>{b.title}</div>
                      </div>
                    </div>
                    <p style={{ margin:0, fontSize:12.5, color:T.muted, lineHeight:1.75 }}>{b.desc}</p>
                  </div>
                </Section>
              ))}
              <Section>
                <div style={{ ...card, padding:"1.75rem", borderTop:"3px solid #057a55", height:"100%", boxSizing:"border-box" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                    <div style={{ width:48, height:48, background:"rgba(5,122,85,0.12)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#057a55" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:800, color:"#057a55", letterSpacing:"0.08em" }}>COMMUNITY</div>
                      <div style={{ fontWeight:700, fontSize:13, color:T.heading }}>Households & Beneficiaries</div>
                    </div>
                  </div>
                  <p style={{ margin:0, fontSize:12.5, color:T.muted, lineHeight:1.75 }}>
                    More equitable targeting of social protection. By separating the "family" from the "household", deserving families living in extended households are less likely to be missed by government aid.
                  </p>
                </div>
              </Section>
            </div>
          </div>
        )}

        {/* ── TECHNOLOGY ── */}
        {activeTab === "tech" && (
          <div style={{ animation:"fadeUp 0.5s ease both" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:16, marginBottom:20 }}>
              {TECH_STACK.map((t, i) => (
                <Section key={t.layer}>
                  <div style={{ ...card, padding:"1.5rem", borderLeft:`3px solid ${t.color}`, animation:`slideIn 0.4s ${i * 80}ms ease both`, height:"100%", boxSizing:"border-box" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:t.color }}/>
                      <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.1em" }}>{t.layer}</span>
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                      {t.items.map(item => (
                        <span key={item} style={{ fontSize:12, fontWeight:600, color:T.text, background:T.chip, borderRadius:6, padding:"4px 10px", border:`1px solid ${T.chipBorder}`, fontFamily:"'DM Mono',monospace" }}>{item}</span>
                      ))}
                    </div>
                  </div>
                </Section>
              ))}
            </div>

            <Section>
              <div style={{ ...card, padding:"2rem", borderLeft:"4px solid #1a3a8a" }}>
                <h3 style={h3}>Architecture</h3>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:12 }}>
                  {[
                    { tier:"Presentation", desc:"React single-page app with Leaflet maps, Recharts charts and React Flow network diagrams, served from the same address as the API.", color:"#61DAFB" },
                    { tier:"API", desc:"Flask REST API with JWT login and role-based access, run by the Waitress production server.", color:"#94a3b8" },
                    { tier:"Analytics", desc:"Python pipeline for CBMS import, family network, SVI, Barangay Capacity, hazard spatial join and k-modes typology — re-run automatically after data changes.", color:"#3776AB" },
                    { tier:"Data", desc:"PostgreSQL database for households, members, families and users; GeoJSON layers for barangay boundaries and hazard zones.", color:"#336791" },
                  ].map(a => (
                    <div key={a.tier} style={{ background:T.cardSoft, borderRadius:10, padding:"14px", border: dark ? `1px solid ${T.border}` : "none" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:8 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:a.color }}/>
                        <span style={{ fontWeight:700, fontSize:13, color:T.heading }}>{a.tier}</span>
                      </div>
                      <p style={{ margin:0, fontSize:11.5, color:T.muted, lineHeight:1.65 }}>{a.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          </div>
        )}

        {/* ── TEAM ── */}
        {activeTab === "team" && (
          <div style={{ animation:"fadeUp 0.5s ease both" }}>
            <Section>
              <div style={{ background:"linear-gradient(135deg,#0c1a38,#1a3a8a)", borderRadius:14, padding:"2rem", marginBottom:24, position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)", backgroundSize:"40px 40px" }}/>
                <div style={{ position:"relative", zIndex:1, display:"flex", alignItems:"flex-start", gap:16, flexWrap:"wrap" }}>
                  <div style={{ width:56, height:56, background:"#fff", borderRadius:12, padding:4, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 16px rgba(0,0,0,0.3)", flexShrink:0 }}>
                    <img src={sanMiguelSeal} alt="San Miguel LGU" style={{ width:46, height:46, objectFit:"contain" }}/>
                  </div>
                  <div style={{ flex:1, minWidth:240 }}>
                    <div style={{ fontSize:11, color:"rgba(147,197,253,0.7)", fontWeight:600, letterSpacing:"0.1em", marginBottom:5, textTransform:"uppercase" }}>Undergraduate Thesis · June 2027</div>
                    <div style={{ fontSize:"1rem", fontWeight:700, color:"#fff", fontFamily:"'Lora',serif", marginBottom:4, lineHeight:1.4 }}>
                      A Spatial Decision Support Information System for Visualizing Family-Level Vulnerability and Resilience to Support LGU Planning
                    </div>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", lineHeight:1.6 }}>
                      College of Information and Communications Technology · West Visayas State University, La Paz, Iloilo City
                      <br/>Bachelor of Science in Information Systems · Group 5
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:16 }}>
              {TEAM.map(m => (
                <Section key={m.name}>
                  <div className="team-card" style={{ ...card, padding:"1.75rem", borderTop:`3px solid ${m.color}`, textAlign:"center" }}>
                    <div style={{ width:60, height:60, borderRadius:"50%", background:`linear-gradient(135deg,${m.color}22,${m.color}44)`, border:`2px solid ${m.color}40`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px", fontSize:14, fontWeight:800, color:m.color, fontFamily:"'Lora',serif" }}>
                      {m.initials}
                    </div>
                    <div style={{ fontWeight:700, fontSize:"0.95rem", color:T.heading, marginBottom:4, fontFamily:"'Lora',serif" }}>{m.name}</div>
                    <div style={{ fontSize:11, fontWeight:700, color:m.color, background:`${m.color}14`, borderRadius:20, padding:"3px 12px", display:"inline-block", marginBottom:10, letterSpacing:"0.04em" }}>{m.role}</div>
                    <p style={{ margin:0, fontSize:11.5, color:T.faint, lineHeight:1.6 }}>{m.thesis}</p>
                  </div>
                </Section>
              ))}
            </div>

            <Section style={{ marginTop:20 }}>
              <div style={{ ...card, padding:"1.5rem 2rem", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:T.heading }}>West Visayas State University</div>
                    <div style={{ fontSize:11, color:T.faint }}>College of ICT · La Paz, Iloilo City · BS Information Systems</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {["RA 11315", "EO 138", "RA 10173", "ISO/IEC 25010"].map(tag => (
                    <span key={tag} style={{ fontSize:10, fontWeight:600, color:"#3b82f6", background: dark ? "rgba(59,130,246,0.12)" : "#eff6ff", borderRadius:4, padding:"3px 8px", border:`1px solid ${dark ? "rgba(59,130,246,0.3)" : "#bfdbfe"}` }}>{tag}</span>
                  ))}
                </div>
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
