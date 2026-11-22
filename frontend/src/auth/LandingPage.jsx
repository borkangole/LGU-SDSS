import { useState, useEffect, useRef } from "react";
import psaLogo from "../assets/psa.png";
import dilgLogo from "../assets/dilg.png";
import sanMiguelSeal from "../assets/san_miguel.png";
import systemLogo from "../assets/logo.png";

// Shown on the sign-in panel. Will come from the municipality profile once
// the setup wizard exists; generic until then.
const LGU_LABEL = "Local Government Unit";

/* ── Fonts & texture: bundled with the app, so the page looks the same offline ── */
import "../assets/fonts/fonts.css";
import contoursUrl from "../assets/contours.svg";

const MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace";
const DISPLAY = "'Syne', 'DM Sans', sans-serif";
const INK = "#0b1530";

/* Topographic contour lines: the page's GIS signature. */
function Contours({ opacity = 0.08, drift = true, style }) {
  return (
    <div aria-hidden="true" className={drift ? "lp-contour-drift" : undefined}
      style={{ position: "absolute", inset: "-4%", backgroundImage: `url(${contoursUrl})`, backgroundSize: "cover",
        backgroundPosition: "center", opacity, pointerEvents: "none", ...style }} />
  );
}

/* Section label: a small map-legend style tag. */
function Eyebrow({ children, dark = false, index, center = false }) {
  const rule = <span style={{ width: 34, height: 1, background: dark ? "rgba(147,197,253,0.4)" : "#93c5fd" }} />;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 18,
      fontFamily: MONO, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
      color: dark ? "rgba(191,219,254,0.85)" : "#1a56db" }}>
      {index && !center && <span style={{ padding: "3px 7px", borderRadius: 5, border: `1px solid ${dark ? "rgba(147,197,253,0.35)" : "#bfdbfe"}`,
        color: dark ? "#93c5fd" : "#1a56db", background: dark ? "rgba(59,130,246,0.1)" : "#eff6ff" }}>{index}</span>}
      {center && rule}
      <span>{children}</span>
      {rule}
    </div>
  );
}

const NAV_LINKS = ["Features", "About", "How It Works", "Partners"];

const TEAM = [
  { name: "Mhel Bustamante", initials: "MB", role: "Full Stack Developer", color: "#1a56db" },
  { name: "Miguel Jacob Artillero", initials: "MJA", role: "GIS & Backend Dev", color: "#0e9f6e" },
  { name: "Anton Gerald Anes", initials: "AGA", role: "Frontend Developer", color: "#7e3af2" },
  { name: "Ebenzer Danilla", initials: "ED", role: "Database Engineer", color: "#d97706" },
];

const TECH = [
  {
    name: "Python", version: "3.10+",
    color: "#3776AB",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><path fill="#3776AB" d="M24.003 5C13.515 5 14.182 9.695 14.182 9.695l.012 4.861h9.99v1.46H10.54S5 14.392 5 25.005c0 10.613 5.876 10.237 5.876 10.237h3.509v-4.924s-.189-5.876 5.78-5.876h9.957s5.59.09 5.59-5.404V10.764S36.625 5 24.003 5zm-5.537 3.196a1.811 1.811 0 1 1 0 3.622 1.811 1.811 0 0 1 0-3.622z"/><path fill="#FFD43B" d="M24.003 43c10.488 0 9.821-4.695 9.821-4.695l-.012-4.861h-9.99v-1.46h13.644S43 33.608 43 22.995c0-10.613-5.876-10.237-5.876-10.237h-3.509v4.924s.189 5.876-5.78 5.876h-9.957s-5.59-.09-5.59 5.404v9.274S11.375 43 24.003 43zm5.537-3.196a1.811 1.811 0 1 1 0-3.622 1.811 1.811 0 0 1 0 3.622z"/></svg>
  },
  {
    name: "Flask", version: "2.x",
    color: "#000000",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><path fill="#010101" d="M24 6c-1.5 0-3.1.2-4.6.7-5.4 1.7-9.4 6.3-10.2 11.9-.4 2.8 0 5.5 1 8 .8 1.9 1.9 3.6 3.3 5.1l.3.3c1 1 2.1 1.9 3.3 2.6.5.3 1 .6 1.5.8l.5.2c.8.3 1.6.6 2.4.7.5.1 1 .1 1.5.2v4.3l-2 .2v1h7.6v-1l-2-.2v-4.3c.5 0 1-.1 1.5-.2.8-.2 1.6-.4 2.4-.7l.5-.2c.5-.2 1-.5 1.5-.8 1.2-.7 2.3-1.6 3.3-2.6l.3-.3c1.4-1.5 2.5-3.2 3.3-5.1 1-2.5 1.4-5.2 1-8-.8-5.6-4.8-10.2-10.2-11.9C27.1 6.2 25.5 6 24 6z"/><path fill="#fff" d="M17.5 26.5c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zm13 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5z"/></svg>
  },
  {
    name: "React", version: "18",
    color: "#61DAFB",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><circle cx="24" cy="24" r="4.5" fill="#61DAFB"/><ellipse cx="24" cy="24" rx="20" ry="7.5" fill="none" stroke="#61DAFB" strokeWidth="2"/><ellipse cx="24" cy="24" rx="20" ry="7.5" fill="none" stroke="#61DAFB" strokeWidth="2" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="20" ry="7.5" fill="none" stroke="#61DAFB" strokeWidth="2" transform="rotate(120 24 24)"/></svg>
  },
  {
    name: "Vite", version: "5.x",
    color: "#646CFF",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><path fill="#646CFF" d="M44 8L24.5 43 17 29.5 34 8z"/><path fill="#FF9533" d="M4 8l20 35L17 29.5 30 8z" opacity=".8"/></svg>
  },
  {
    name: "PostgreSQL", version: "15",
    color: "#336791",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><ellipse cx="24" cy="12" rx="14" ry="6" fill="#336791"/><path fill="#336791" d="M10 12v16c0 3.3 6.3 6 14 6s14-2.7 14-6V12"/><ellipse cx="24" cy="28" rx="14" ry="6" fill="#4a90d9"/><ellipse cx="24" cy="20" rx="14" ry="6" fill="#4a90d9"/><ellipse cx="24" cy="12" rx="14" ry="6" fill="#5ba3e0"/></svg>
  },
  {
    name: "PostGIS", version: "3.x",
    color: "#4169E1",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><circle cx="24" cy="24" r="16" fill="none" stroke="#4169E1" strokeWidth="2.5"/><path fill="#4169E1" d="M24 8 L28 20 L40 20 L30 28 L34 40 L24 32 L14 40 L18 28 L8 20 L20 20 Z"/></svg>
  },
  {
    name: "Leaflet", version: "1.9",
    color: "#199900",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><path fill="#199900" d="M24 6C17 6 12 13 12 20c0 10 12 22 12 22s12-12 12-22c0-7-5-14-12-14z"/><circle cx="24" cy="20" r="5" fill="#fff"/></svg>
  },
  {
    name: "Node.js", version: "18+",
    color: "#339933",
    logo: <svg viewBox="0 0 48 48" width="28" height="28"><path fill="#339933" d="M24 4L6 14v20l18 10 18-10V14L24 4z"/><path fill="#fff" d="M24 10l12 6.7V30L24 36.7 12 30V16.7L24 10z" opacity=".15"/><text x="24" y="28" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="sans-serif">JS</text></svg>
  },
];

/* ── Fade-in hook ── */
function useFadeIn(threshold = 0.15) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

/* ── Login Modal ── */
function LoginModal({ onLogin, onClose, inline }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [focused, setFocused] = useState(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleNext = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAttempts(a => a + 1);
        setError(data.error || "Invalid credentials. Access denied.");
        setLoading(false);
        return;
      }
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onLogin(data.user, data.token);
    } catch {
      setError("Cannot connect to server. Make sure the backend is running.");
      setLoading(false);
    }
  };

  const modalContent = (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes stepSlide {
          from { opacity:0; transform:translateX(20px); }
          to   { opacity:1; transform:translateX(0); }
        }
        @keyframes onlinePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.85)} }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        .gov-input {
          width: 100%;
          padding: 13px 16px 13px 44px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          font-size: 14px;
          color: #fff;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
          font-family: inherit;
          letter-spacing: 0.01em;
        }
        .gov-input::placeholder { color: rgba(255,255,255,0.22); }
        .gov-input:focus {
          border-color: rgba(59,130,246,0.7) !important;
          background: rgba(59,130,246,0.07) !important;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.12) !important;
        }
        .gov-btn {
          width: 100%; padding: 14px;
          background: linear-gradient(135deg, #1a56db 0%, #2563eb 50%, #1d4ed8 100%);
          background-size: 200% auto;
          color: #fff; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 700; cursor: pointer;
          letter-spacing: 0.04em; text-transform: uppercase;
          box-shadow: 0 4px 24px rgba(26,86,219,0.45);
          transition: box-shadow 0.25s, transform 0.2s, background-position 0.5s;
          font-family: inherit;
          display: flex; align-items: center; justify-content: center; gap: 9px;
        }
        .gov-btn:hover:not(:disabled) {
          background-position: right center;
          box-shadow: 0 6px 32px rgba(26,86,219,0.6);
          transform: translateY(-1px);
        }
        .gov-btn:active:not(:disabled) { transform: translateY(0); }
        .gov-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .step-slide { animation: stepSlide 0.3s cubic-bezier(0.4,0,0.2,1) both; }
      `}</style>

      <div style={{ position:"relative", width:"100%" }}>

        {/* Subtle outer border glow */}
        <div style={{
          position:"absolute", inset:-1, borderRadius:16,
          background:"linear-gradient(135deg,rgba(59,130,246,0.35),rgba(99,102,241,0.15),rgba(26,86,219,0.25))",
          zIndex:-1,
        }}/>

        {/* Main panel */}
        <div style={{
          background:"linear-gradient(170deg,#0c1a38 0%,#07101f 100%)",
          borderRadius:16, overflow:"hidden",
          border:"1px solid rgba(59,130,246,0.15)",
          boxShadow:"0 32px 80px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.03)",
        }}>

          {/* ── TOP HEADER BAND — seal + system name ── */}
          <div style={{
            background:"linear-gradient(135deg,rgba(26,86,219,0.2) 0%,rgba(15,36,96,0.4) 100%)",
            borderBottom:"1px solid rgba(59,130,246,0.12)",
            padding:"20px 28px 18px",
            display:"flex", alignItems:"center", gap:16, position:"relative",
          }}>
            {/* Municipal seal */}
            <div style={{
              width:58, height:58, borderRadius:13, flexShrink:0,
              background:"transparent",
              padding:0,
              boxShadow:"0 0 0 1px rgba(59,130,246,0.3), 0 4px 16px rgba(0,0,0,0.4)",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <img src={systemLogo} alt="LGU-SDSS" style={{ width:58, height:58, objectFit:"contain", borderRadius:13 }}/>
            </div>

            {/* System title */}
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, fontWeight:600, color:"rgba(147,197,253,0.7)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:3 }}>
                {LGU_LABEL}
              </div>
              <div style={{ fontSize:19, fontWeight:800, color:"#fff", fontFamily:"'Syne',sans-serif", letterSpacing:"-0.3px", lineHeight:1.1 }}>
                LGU-SDSS
              </div>
              <div style={{ fontSize:10.5, color:"rgba(255,255,255,0.38)", marginTop:2 }}>
                Spatial Decision Support Information System
              </div>
            </div>

            {/* Close button */}
            <button onClick={onClose} style={{
              position:"absolute", top:14, right:14,
              background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:"50%", width:28, height:28, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              color:"rgba(255,255,255,0.4)", fontSize:15, transition:"all 0.2s",
              lineHeight:1,
            }}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.13)";e.currentTarget.style.color="#fff";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.07)";e.currentTarget.style.color="rgba(255,255,255,0.4)";}}>
              ×
            </button>
          </div>

          {/* ── NOTICE BAND ── */}
          <div style={{
            background:"rgba(245,158,11,0.07)",
            borderBottom:"1px solid rgba(245,158,11,0.12)",
            padding:"7px 28px",
            display:"flex", alignItems:"center", gap:8,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span style={{ fontSize:10, color:"rgba(251,191,36,0.8)", fontWeight:600, letterSpacing:"0.07em" }}>
              AUTHORIZED PERSONNEL ONLY · RA 10173 DATA PRIVACY ACT PROTECTED
            </span>
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", display:"inline-block", animation:"onlinePulse 2s ease infinite" }}/>
              <span style={{ fontSize:9, color:"rgba(74,222,128,0.85)", fontWeight:700, letterSpacing:"0.08em" }}>SYSTEM ONLINE</span>
            </div>
          </div>

          {/* ── FORM AREA ── */}
          <div style={{ padding:"24px 28px 8px" }}>

            {/* Step progress bar */}
            <div style={{ marginBottom:22 }}>
              <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:8 }}>
                {["Identity Verification", "Authentication"].map((label, i) => {
                  const s = i + 1;
                  const active = step === s;
                  const done = step > s;
                  return (
                    <div key={s} style={{ display:"flex", alignItems:"center", flex: s < 2 ? 1 : "none" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                        <div style={{
                          width:24, height:24, borderRadius:"50%", flexShrink:0,
                          background: done ? "#22c55e" : active ? "#1a56db" : "rgba(255,255,255,0.07)",
                          border: `1.5px solid ${done ? "#22c55e" : active ? "#3b82f6" : "rgba(255,255,255,0.12)"}`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:10, fontWeight:700,
                          color: done || active ? "#fff" : "rgba(255,255,255,0.3)",
                          transition:"all 0.35s",
                        }}>
                          {done ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          ) : s}
                        </div>
                        <span style={{
                          fontSize:11, fontWeight: active ? 600 : 400,
                          color: active ? "rgba(255,255,255,0.85)" : done ? "rgba(34,197,94,0.8)" : "rgba(255,255,255,0.28)",
                          transition:"color 0.3s", whiteSpace:"nowrap",
                        }}>{label}</span>
                      </div>
                      {s < 2 && (
                        <div style={{
                          flex:1, height:1, margin:"0 10px",
                          background: done ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)",
                          transition:"background 0.4s",
                        }}/>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Animated progress bar */}
              <div style={{ height:2, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden" }}>
                <div style={{
                  height:"100%", borderRadius:2,
                  background:"linear-gradient(90deg,#1a56db,#6366f1)",
                  width: step === 1 ? "50%" : "100%",
                  transition:"width 0.5s cubic-bezier(0.4,0,0.2,1)",
                }}/>
              </div>
            </div>

            {/* Error alert */}
            {error && (
              <div style={{
                background:"rgba(239,68,68,0.07)",
                border:"1px solid rgba(239,68,68,0.2)",
                borderLeft:"3px solid #ef4444",
                borderRadius:8, padding:"10px 14px", marginBottom:18,
                fontSize:12, color:"#fca5a5",
                display:"flex", alignItems:"flex-start", gap:9,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:1 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Step 1: Username */}
            {step === 1 && (
              <div className="step-slide">
                <label style={{ display:"block", fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.45)", marginBottom:7, letterSpacing:"0.1em", textTransform:"uppercase" }}>
                  Username / Employee ID
                </label>
                <form onSubmit={handleNext}>
                  <div style={{ position:"relative", marginBottom:6 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                      stroke={focused==="user" ? "#60a5fa" : "rgba(255,255,255,0.28)"}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", transition:"stroke 0.2s" }}>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                    <input className="gov-input" type="text" value={username}
                      onChange={e => setUsername(e.target.value)}
                      onFocus={() => setFocused("user")} onBlur={() => setFocused(null)}
                      placeholder="Enter your username or employee ID"
                      autoComplete="username" required autoFocus
                    />
                  </div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginBottom:20 }}>
                    Use your assigned government system credentials
                  </div>
                  <button type="submit" className="gov-btn">
                    Continue
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </button>
                </form>
              </div>
            )}

            {/* Step 2: Password */}
            {step === 2 && (
              <div className="step-slide">
                {/* Verified user chip */}
                <div style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"9px 13px",
                  background:"rgba(34,197,94,0.06)",
                  border:"1px solid rgba(34,197,94,0.18)",
                  borderRadius:8, marginBottom:18,
                }}>
                  <div style={{ width:28, height:28, borderRadius:"50%", background:"linear-gradient(135deg,#1a56db,#6366f1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:"#fff" }}>{username}</div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.32)" }}>{LGU_LABEL} · LGU-SDSS</div>
                  </div>
                  <button type="button" onClick={() => { setStep(1); setError(null); }}
                    style={{ background:"none", border:"none", cursor:"pointer", fontSize:10, color:"rgba(99,102,241,0.8)", fontWeight:600, padding:0, fontFamily:"inherit", transition:"color 0.2s" }}
                    onMouseEnter={e=>e.currentTarget.style.color="#818cf8"}
                    onMouseLeave={e=>e.currentTarget.style.color="rgba(99,102,241,0.8)"}>
                    Change
                  </button>
                </div>

                <form onSubmit={handleSubmit}>
                  <label style={{ display:"block", fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.45)", marginBottom:7, letterSpacing:"0.1em", textTransform:"uppercase" }}>
                    Password
                  </label>
                  <div style={{ position:"relative", marginBottom:20 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                      stroke={focused==="pw" ? "#60a5fa" : "rgba(255,255,255,0.28)"}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", transition:"stroke 0.2s" }}>
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <input className="gov-input" type={showPw ? "text" : "password"} value={password}
                      onChange={e => setPassword(e.target.value)}
                      onFocus={() => setFocused("pw")} onBlur={() => setFocused(null)}
                      placeholder="Enter your password"
                      autoComplete="current-password" required autoFocus
                      style={{ paddingRight:44 }}
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)} tabIndex={-1}
                      style={{ position:"absolute", right:13, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.3)", display:"flex", padding:4, transition:"color 0.2s" }}
                      onMouseEnter={e=>e.currentTarget.style.color="#fff"}
                      onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.3)"}>
                      {showPw ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>

                  <button type="submit" className="gov-btn" disabled={loading}>
                    {loading ? (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation:"spin 0.8s linear infinite" }}>
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                        </svg>
                        Authenticating…
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        Sign In to System
                      </>
                    )}
                  </button>
                </form>

                {/* Failed attempts warning */}
                {attempts >= 2 && (
                  <div style={{ marginTop:14, padding:"9px 13px", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.18)", borderRadius:8, display:"flex", alignItems:"center", gap:8 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span style={{ fontSize:10, color:"rgba(248,113,113,0.85)", fontWeight:500 }}>
                      {5 - attempts} attempt{5 - attempts !== 1 ? "s" : ""} remaining before lockout
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── FOOTER STATUS BAR ── */}
          <div style={{
            borderTop:"1px solid rgba(255,255,255,0.05)",
            padding:"10px 28px",
            display:"flex", alignItems:"center", justifyContent:"space-between",
            background:"rgba(0,0,0,0.18)",
            marginTop:16,
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(74,222,128,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span style={{ fontSize:9.5, color:"rgba(255,255,255,0.28)", letterSpacing:"0.03em" }}>TLS 1.3 Encrypted · Session expires in 8h</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)" }}>v2.1.0</span>
              <span style={{ color:"rgba(255,255,255,0.1)" }}>·</span>
              <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)" }}>{LGU_LABEL}</span>
            </div>
          </div>

        </div>
      </div>
    </>
  );

  return inline ? modalContent : (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"rgba(2,6,18,0.88)",
      display:"flex", alignItems:"center", justifyContent:"center",
      backdropFilter:"blur(12px)",
    }}>
      {modalContent}
    </div>
  );
}

/* ── Animated stat card ── */
function StatCard({ value, label }) {
  const [ref, visible] = useFadeIn(0.2);
  return (
    <div ref={ref} style={{ transition: "opacity 0.6s, transform 0.6s", opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(16px)" }}>
      <div style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", fontFamily: "'Syne', sans-serif", letterSpacing: "-1px" }}>{value}</div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

/* ── Hero Mockup — Accurate Boundary Map ── */
// Fictional sample municipality for the landing-page preview (generated
// shapes, not a real LGU), so the page fits any municipality that installs
// the system. Tiers follow the SVI rank quarters used inside the system.
const DEMO_BARANGAYS = [{"id": 0, "name": "Barangay 1", "rank": 7, "tier": "Moderate-high", "color": "#f97316", "c": [206.3, 189.7], "a": 823, "path": "M234.1,181.9 L230.0,180.3 L220.0,177.9 L213.7,175.2 L208.2,175.9 L199.4,179.4 L199.8,182.3 L190.9,183.9 L187.1,186.3 L181.6,189.9 L178.7,194.3 L186.6,197.9 L190.3,200.1 L190.7,199.5 L194.4,202.2 L203.4,204.2 L212.5,201.0 L219.0,203.6 L221.8,193.3 L227.8,186.2 L228.1,183.3 Z"}, {"id": 1, "name": "Barangay 2", "rank": 14, "tier": "Moderate-low", "color": "#facc15", "c": [198.8, 164.4], "a": 1818, "path": "M181.6,189.9 L187.1,186.3 L190.9,183.9 L199.8,182.3 L199.4,179.4 L208.2,175.9 L213.7,175.2 L220.0,177.9 L230.0,180.3 L225.1,171.2 L222.2,169.3 L220.6,160.6 L219.0,155.3 L216.8,146.7 L213.5,137.8 L209.6,133.5 L205.2,125.0 L203.1,131.6 L196.9,139.9 L194.0,147.5 L191.3,152.3 L182.6,155.3 L181.2,158.3 L178.1,163.2 L170.8,169.7 L168.8,176.5 L163.0,181.3 L174.0,185.1 Z"}, {"id": 2, "name": "Barangay 3", "rank": 19, "tier": "Low", "color": "#22c55e", "c": [200.6, 205.5], "a": 389, "path": "M219.0,203.6 L212.5,201.0 L203.5,204.2 L194.5,202.4 L190.8,199.7 L190.5,200.1 L186.8,198.2 L178.7,194.6 L182.8,201.6 L186.3,201.0 L191.1,209.2 L196.9,211.5 L203.2,217.0 L209.0,219.1 L211.8,217.5 L216.7,212.3 Z"}, {"id": 3, "name": "Barangay 4", "rank": 20, "tier": "Low", "color": "#22c55e", "c": [162.4, 148.1], "a": 2890, "path": "M139.9,178.9 L142.9,177.8 L149.9,181.1 L155.8,183.4 L163.0,181.3 L168.8,176.5 L170.8,169.7 L178.0,163.1 L181.2,158.3 L182.6,155.3 L191.3,152.3 L193.9,147.3 L196.9,139.9 L203.1,131.6 L205.2,125.0 L201.9,121.9 L194.0,119.6 L190.8,118.8 L182.6,122.8 L177.3,127.9 L177.5,128.1 L169.5,125.9 L162.7,126.4 L159.9,128.8 L148.9,127.5 L140.1,123.2 L135.6,121.9 L127.9,124.5 L126.7,130.5 L127.7,139.6 L131.4,149.1 L135.7,152.4 L137.9,162.7 L137.8,164.4 L137.4,168.6 L138.4,174.9 Z"}, {"id": 4, "name": "Barangay 5", "rank": 13, "tier": "Moderate-low", "color": "#facc15", "c": [174.6, 224.6], "a": 1894, "path": "M151.9,248.0 L152.5,243.7 L160.8,242.4 L163.7,243.8 L166.6,245.3 L177.1,244.6 L179.6,241.0 L188.0,236.1 L197.9,232.0 L201.0,230.1 L207.7,221.6 L209.0,219.1 L203.1,217.0 L196.8,211.5 L190.6,208.9 L186.2,200.9 L182.9,201.4 L178.7,194.3 L174.8,197.3 L173.0,201.8 L167.1,209.0 L164.8,217.3 L160.0,224.4 L156.0,228.3 L154.2,229.7 L146.9,230.9 L145.5,234.8 L142.5,242.1 Z"}, {"id": 5, "name": "Barangay 6", "rank": 11, "tier": "Moderate-low", "color": "#facc15", "c": [146.8, 208.2], "a": 2082, "path": "M118.1,239.1 L129.1,242.4 L142.5,242.1 L145.5,234.8 L146.9,230.9 L154.2,229.7 L156.0,228.3 L160.0,224.4 L164.8,217.3 L167.1,209.0 L173.0,201.8 L174.8,197.3 L178.7,194.3 L181.6,189.9 L174.0,185.1 L163.0,181.3 L155.8,183.4 L149.9,181.1 L142.9,177.8 L139.9,178.9 L137.8,185.1 L130.8,195.5 L132.1,205.0 L128.9,209.3 L122.4,211.7 L124.3,217.3 L120.5,225.2 L115.0,232.2 Z"}, {"id": 6, "name": "Barangay 7", "rank": 8, "tier": "Moderate-high", "color": "#f97316", "c": [243.5, 221.6], "a": 4484, "path": "M234.1,181.9 L228.2,183.2 L227.9,185.8 L222.4,192.6 L219.2,202.3 L217.0,211.7 L212.2,217.3 L209.0,219.1 L207.7,221.6 L201.0,230.1 L207.3,235.3 L211.9,237.9 L214.8,246.7 L217.4,247.7 L222.1,254.3 L229.2,256.0 L237.9,262.6 L243.2,260.9 L249.9,258.3 L257.8,256.4 L260.5,257.7 L264.5,261.0 L269.0,254.1 L270.2,247.3 L271.1,239.5 L274.7,229.9 L276.5,223.3 L276.6,221.0 L279.1,217.6 L280.6,210.4 L279.7,203.9 L281.0,197.9 L283.3,188.3 L271.8,186.4 L263.3,187.2 L260.4,187.9 L257.5,186.1 L251.6,186.4 L246.6,186.6 L242.4,183.4 Z"}, {"id": 7, "name": "Barangay 8", "rank": 3, "tier": "High", "color": "#dc2626", "c": [252.0, 137.2], "a": 6647, "path": "M205.2,125.0 L209.6,133.5 L213.5,137.8 L216.8,146.7 L219.0,155.3 L220.6,160.6 L222.2,169.3 L225.1,171.2 L230.0,180.3 L234.1,181.9 L242.4,183.4 L246.6,186.6 L251.9,186.0 L257.8,186.0 L260.5,188.0 L263.6,186.6 L272.4,186.0 L283.8,188.4 L282.4,178.5 L283.4,174.7 L286.5,174.9 L285.9,170.5 L286.0,160.1 L289.9,150.6 L290.6,145.1 L290.1,139.4 L294.2,132.6 L296.9,128.4 L295.6,127.9 L288.2,121.6 L285.8,120.0 L289.7,113.4 L287.1,103.0 L280.4,102.8 L277.4,98.8 L271.3,95.7 L262.3,98.6 L257.1,98.9 L255.0,93.4 L247.8,92.0 L239.4,91.2 L234.3,87.3 L225.9,87.9 L214.3,93.0 L216.5,100.0 L209.5,106.8 L208.4,113.0 L206.3,117.9 L201.9,121.9 Z"}, {"id": 8, "name": "Barangay 9", "rank": 15, "tier": "Moderate-low", "color": "#facc15", "c": [104.2, 169.2], "a": 5271, "path": "M63.5,128.8 L64.2,133.9 L63.1,143.8 L57.7,151.2 L64.6,159.8 L77.0,162.6 L69.6,167.7 L64.7,169.9 L72.2,176.2 L77.4,178.0 L80.2,186.6 L81.5,188.4 L83.5,194.5 L87.3,198.2 L93.3,200.6 L100.3,207.8 L106.4,209.4 L110.4,218.2 L112.3,221.3 L113.1,227.0 L115.0,232.2 L120.5,225.2 L124.3,217.3 L122.4,211.7 L128.9,209.3 L132.1,205.0 L130.8,195.5 L137.8,185.1 L139.9,178.9 L138.4,174.9 L137.4,168.6 L137.8,164.4 L137.9,162.7 L135.7,152.4 L131.4,149.1 L127.7,139.6 L126.7,130.5 L127.9,124.5 L126.9,123.3 L118.9,122.8 L119.1,124.8 L113.1,130.1 L105.0,133.8 L102.4,132.5 L92.6,129.0 L83.7,128.2 L77.5,129.7 L71.2,129.8 Z"}, {"id": 9, "name": "Barangay 10", "rank": 6, "tier": "Moderate-high", "color": "#f97316", "c": [192.9, 270.8], "a": 4226, "path": "M151.9,248.0 L153.0,254.9 L153.2,262.6 L153.9,267.4 L156.4,278.7 L160.5,281.6 L165.2,288.5 L169.0,291.5 L171.2,296.9 L172.1,303.8 L177.6,303.2 L184.9,308.9 L193.8,307.2 L211.3,313.4 L218.0,302.9 L219.6,303.4 L226.1,295.6 L224.0,288.5 L227.5,284.3 L231.3,282.5 L231.8,280.0 L232.8,273.2 L237.9,262.6 L229.2,256.0 L222.1,254.3 L217.4,247.7 L214.8,246.7 L211.9,237.9 L207.3,235.3 L201.0,230.1 L197.9,232.0 L188.0,236.1 L179.6,241.0 L177.1,244.6 L166.6,245.3 L163.7,243.8 L160.8,242.4 L152.5,243.7 Z"}, {"id": 10, "name": "Barangay 11", "rank": 12, "tier": "Moderate-low", "color": "#facc15", "c": [166.0, 85.3], "a": 6238, "path": "M127.9,124.5 L135.6,121.9 L140.1,123.2 L148.9,127.5 L159.9,128.8 L162.7,126.4 L169.5,125.9 L177.5,128.1 L177.3,127.9 L182.6,122.8 L190.8,118.8 L194.0,119.6 L201.9,121.9 L206.3,117.9 L208.4,113.0 L209.5,106.8 L216.5,100.0 L214.3,93.0 L209.8,86.0 L207.5,81.2 L206.5,77.4 L205.3,69.4 L202.6,68.0 L197.7,60.5 L191.1,58.1 L184.6,54.2 L179.4,48.9 L176.3,48.1 L174.8,40.7 L173.6,39.4 L171.0,33.4 L166.2,28.7 L154.9,30.2 L150.3,33.2 L143.1,38.0 L136.3,43.5 L129.9,41.2 L128.0,51.1 L126.0,54.6 L127.4,57.5 L130.4,62.2 L131.3,69.0 L130.7,73.3 L132.0,81.2 L134.3,93.3 L133.5,96.5 L129.7,103.1 L127.2,110.4 L128.4,110.6 L129.3,115.8 L126.9,123.3 Z"}, {"id": 11, "name": "Barangay 12", "rank": 18, "tier": "Low", "color": "#22c55e", "c": [252.3, 281.7], "a": 1997, "path": "M264.5,261.0 L260.5,257.7 L257.8,256.4 L249.9,258.3 L243.2,260.9 L237.9,262.6 L232.8,273.2 L231.8,280.0 L231.3,282.5 L227.5,284.3 L224.0,288.5 L226.1,295.6 L219.6,303.4 L231.0,300.7 L236.4,298.5 L243.1,303.4 L246.6,301.8 L253.7,297.2 L261.7,299.7 L267.9,301.8 L280.4,288.5 L283.8,282.4 L294.2,284.6 L288.8,277.0 L281.7,274.4 L273.7,267.8 L267.7,264.0 Z"}, {"id": 12, "name": "Barangay 13", "rank": 1, "tier": "High", "color": "#dc2626", "c": [122.4, 278.3], "a": 4102, "path": "M151.9,248.0 L142.5,242.1 L129.1,242.4 L118.1,239.1 L114.9,244.9 L107.1,248.2 L105.7,249.4 L99.6,251.0 L95.0,254.8 L93.4,261.0 L86.0,267.9 L84.7,279.3 L83.2,284.1 L78.8,285.8 L79.3,292.1 L79.6,299.5 L74.6,306.2 L85.5,305.6 L93.1,308.0 L100.1,305.3 L109.9,303.5 L111.6,303.6 L120.5,311.0 L126.9,308.3 L129.3,305.8 L140.3,303.8 L145.6,301.4 L152.8,295.7 L161.0,292.8 L170.1,300.0 L172.1,303.8 L171.2,296.9 L169.0,291.5 L165.2,288.5 L160.5,281.6 L156.4,278.7 L153.9,267.4 L153.2,262.6 L153.0,254.9 Z"}, {"id": 13, "name": "Barangay 14", "rank": 5, "tier": "High", "color": "#dc2626", "c": [254.2, 69.9], "a": 2097, "path": "M225.9,87.9 L234.3,87.3 L239.4,91.2 L247.8,92.0 L255.0,93.4 L257.1,98.9 L262.3,98.6 L271.3,95.7 L277.4,98.8 L272.6,87.6 L271.7,81.3 L273.7,71.2 L275.7,65.7 L274.0,60.7 L271.3,54.4 L269.8,50.0 L256.9,46.1 L251.5,38.2 L247.0,35.9 L246.6,36.8 L240.1,37.2 L238.6,40.4 L239.4,48.3 L234.5,57.2 L232.7,63.7 L232.1,68.4 L230.8,74.0 L225.7,80.3 L227.4,85.2 Z"}, {"id": 14, "name": "Barangay 15", "rank": 16, "tier": "Low", "color": "#22c55e", "c": [70.2, 227.3], "a": 5137, "path": "M86.0,267.9 L93.4,261.0 L95.0,254.8 L99.6,251.0 L105.7,249.4 L107.1,248.2 L114.9,244.9 L118.1,239.1 L115.0,232.2 L113.1,227.0 L112.3,221.3 L110.4,218.2 L106.4,209.4 L100.3,207.8 L93.3,200.6 L87.3,198.2 L83.5,194.5 L81.5,188.4 L80.2,186.6 L77.4,178.0 L72.2,176.2 L64.7,169.9 L70.3,177.9 L64.2,184.6 L55.7,191.6 L44.7,195.4 L46.9,201.5 L40.2,202.9 L39.8,206.1 L35.1,211.0 L26.1,218.1 L23.8,225.0 L18.8,232.9 L15.7,237.3 L17.6,240.1 L24.5,238.8 L30.0,245.6 L36.2,247.4 L42.2,249.1 L46.2,255.6 L48.9,254.6 L54.1,259.8 L63.7,262.1 L74.0,263.1 L80.8,266.7 L83.4,268.9 Z"}, {"id": 15, "name": "Barangay 16", "rank": 10, "tier": "Moderate-high", "color": "#f97316", "c": [97.5, 90.8], "a": 5071, "path": "M126.9,123.3 L129.3,115.8 L128.4,110.6 L127.2,110.4 L129.7,103.1 L133.5,96.5 L134.3,93.3 L132.0,81.2 L130.7,73.3 L131.3,69.0 L130.4,62.2 L127.4,57.5 L126.0,54.6 L128.0,51.1 L129.9,41.2 L122.2,42.9 L116.9,47.0 L108.7,46.4 L105.4,44.3 L95.3,55.9 L88.3,55.7 L78.4,59.9 L74.2,63.5 L72.8,65.4 L71.1,69.3 L65.6,75.9 L61.6,88.1 L61.0,95.6 L62.5,101.9 L62.6,111.6 L62.8,111.1 L61.9,120.4 L63.5,128.8 L71.2,129.8 L77.5,129.7 L83.7,128.2 L92.6,129.0 L102.4,132.5 L105.0,133.8 L113.1,130.1 L119.1,124.8 L118.9,122.8 Z"}, {"id": 16, "name": "Barangay 17", "rank": 9, "tier": "Moderate-high", "color": "#f97316", "c": [208.5, 48.4], "a": 3348, "path": "M214.3,93.0 L225.9,87.9 L227.4,85.2 L225.7,80.3 L230.8,74.0 L232.1,68.4 L232.7,63.7 L234.5,57.2 L239.4,48.3 L238.6,40.4 L240.1,37.2 L246.6,36.8 L238.1,35.2 L233.4,31.7 L232.0,28.9 L225.6,20.0 L221.8,20.0 L208.4,21.4 L203.4,22.8 L195.4,23.5 L188.9,20.5 L185.4,17.8 L182.2,20.8 L175.9,24.4 L170.2,27.5 L166.2,28.7 L171.0,33.4 L173.6,39.4 L174.8,40.7 L176.3,48.1 L179.4,48.9 L184.6,54.2 L191.1,58.1 L197.7,60.5 L202.6,68.0 L205.3,69.4 L206.5,77.4 L207.5,81.2 L209.8,86.0 Z"}, {"id": 17, "name": "Barangay 18", "rank": 17, "tier": "Low", "color": "#22c55e", "c": [317.5, 235.3], "a": 6603, "path": "M283.8,188.4 L281.7,197.7 L280.0,203.4 L280.9,210.2 L279.4,217.7 L276.8,221.2 L276.6,223.1 L274.9,229.7 L271.2,239.4 L270.2,247.3 L269.0,254.1 L264.5,261.0 L267.7,264.0 L273.7,267.8 L281.7,274.4 L288.8,277.0 L294.2,284.6 L297.8,283.0 L304.5,280.5 L309.7,275.6 L315.3,270.2 L322.2,262.9 L327.6,264.4 L335.9,265.2 L340.7,263.7 L354.2,260.9 L360.1,260.2 L362.5,251.4 L371.0,244.3 L372.1,240.0 L375.1,238.0 L382.8,236.7 L386.2,231.1 L393.5,219.4 L387.6,219.3 L377.5,215.9 L368.6,217.8 L363.3,217.0 L358.6,212.8 L352.4,216.0 L346.7,211.5 L343.3,208.5 L338.8,210.3 L330.0,203.4 L319.7,202.4 L313.5,201.3 L310.6,195.3 L306.8,194.9 L300.8,192.9 L295.5,189.4 L291.1,188.4 Z"}, {"id": 18, "name": "Barangay 19", "rank": 2, "tier": "High", "color": "#dc2626", "c": [339.4, 177.5], "a": 6212, "path": "M283.8,188.4 L291.1,188.4 L295.5,189.4 L300.8,192.9 L306.8,194.9 L310.6,195.3 L313.5,201.3 L319.7,202.4 L330.0,203.4 L338.9,210.4 L343.3,208.5 L346.7,211.5 L352.4,216.0 L358.6,212.8 L363.3,217.0 L368.6,217.8 L377.5,215.9 L387.6,219.3 L393.5,219.4 L394.8,211.5 L400.1,205.2 L399.4,200.4 L399.0,199.8 L393.0,190.5 L387.7,184.1 L385.0,177.0 L384.3,169.5 L380.9,164.7 L377.0,156.3 L369.6,159.0 L363.6,152.8 L355.7,154.7 L345.9,149.1 L337.9,148.1 L335.1,147.7 L333.7,143.3 L327.1,144.8 L312.2,137.5 L300.4,133.1 L296.9,128.4 L294.2,132.6 L290.1,139.4 L290.6,145.1 L289.9,150.6 L286.0,160.1 L285.9,170.5 L286.5,174.9 L283.4,174.7 L282.4,178.5 Z"}, {"id": 19, "name": "Barangay 20", "rank": 4, "tier": "High", "color": "#dc2626", "c": [47.9, 277.1], "a": 3465, "path": "M86.0,267.9 L83.4,268.9 L80.8,266.7 L74.0,263.1 L63.7,262.1 L54.1,259.8 L48.9,254.6 L46.2,255.6 L42.2,249.1 L36.2,247.4 L30.0,245.6 L24.5,238.8 L17.6,240.1 L12.4,246.3 L15.9,259.0 L19.1,264.7 L15.6,273.0 L14.0,282.3 L15.4,284.3 L16.6,292.2 L23.2,291.7 L33.6,299.8 L38.4,302.7 L42.6,307.2 L52.8,310.3 L55.7,308.8 L61.6,307.9 L67.3,310.8 L74.6,306.2 L79.6,299.5 L79.3,292.1 L78.8,285.8 L83.2,284.1 L84.7,279.3 Z"}];
const BARANGAYS = DEMO_BARANGAYS.map((b) => ({ ...b, hh: Math.round(b.a / 4) }));
const BRGY_CENTERS = DEMO_BARANGAYS.map((b) => b.c);
const BY_RANK = [...DEMO_BARANGAYS].sort((a, b) => a.rank - b.rank);
const TOP_IDX = BY_RANK.slice(0, 2).map((b) => b.id);
const SVI_TIERS = [
  { color: "#dc2626", label: "High", range: "top ¼" },
  { color: "#f97316", label: "Moderate-high", range: "2nd ¼" },
  { color: "#facc15", label: "Moderate-low", range: "3rd ¼" },
  { color: "#22c55e", label: "Low", range: "bottom ¼" },
];

const MAP_DOTS = (() => {
  const all = [];
  BARANGAYS.forEach((b, bi) => {
    const [cx, cy] = BRGY_CENTERS[bi];
    const count = Math.max(3, Math.min(14, Math.floor(b.hh / 160)));
    let s = bi * 137 + 99;
    const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 3 + rand() * 14;
      all.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r, color: b.color, bi });
    }
  });
  return all;
})();

function HeroMockup() {
  const [dotsVisible, setDotsVisible] = useState(false);
  const [scanPos, setScanPos] = useState(0);
  const [scanAngle, setScanAngle] = useState(0);
  const [pulseRing, setPulseRing] = useState(0);

  const barangays = BARANGAYS;
  const centers = BRGY_CENTERS;
  const dots = MAP_DOTS;

  useEffect(() => {
    const t = setTimeout(() => setDotsVisible(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Radar sweep
  useEffect(() => {
    let a = 0;
    const t = setInterval(() => {
      a = (a + 1.2) % 360;
      setScanAngle(a);
    }, 16);
    return () => clearInterval(t);
  }, []);

  // Horizontal scan line
  useEffect(() => {
    let pos = 0;
    const t = setInterval(() => {
      pos = (pos + 0.6) % 420;
      setScanPos(pos);
    }, 16);
    return () => clearInterval(t);
  }, []);

  // Pulse rings
  useEffect(() => {
    let r = 0;
    const t = setInterval(() => { r = (r + 1) % 60; setPulseRing(r); }, 40);
    return () => clearInterval(t);
  }, []);

  // Radar sweep
  const rad = (scanAngle * Math.PI) / 180;
  const sweepX = 190 + Math.cos(rad) * 300;
  const sweepY = 160 + Math.sin(rad) * 300;

  return (
    <div className="hero-visual" style={{ flex: "0 0 580px", position: "relative", zIndex: 1, paddingTop: "0" }}>
      <style>{`
        @keyframes panelIn { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes dotFadeIn { from{opacity:0;transform:scale(0)} to{opacity:0.8;transform:scale(1)} }
        @keyframes radarGlow { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes ringExpand { from{r:4;opacity:0.8} to{r:22;opacity:0} }
        @keyframes alertBlink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .brgy-poly { cursor:pointer; transition: filter 0.15s; }
        .brgy-poly:hover { filter: brightness(1.4) drop-shadow(0 0 6px currentColor); }
      `}</style>

      <div style={{ background: "rgba(4,8,20,0.96)", border: "1px solid rgba(59,130,246,0.22)", borderRadius: 18, overflow: "hidden", boxShadow: "0 40px 120px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(59,130,246,0.1)" }}>

        {/* Title bar */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 14px", background:"rgba(6,10,24,0.98)", borderBottom:"1px solid rgba(59,130,246,0.1)" }}>
          <div style={{ display:"flex", gap:5 }}>
            {["#ff5f57","#febc2e","#28c840"].map(c=><div key={c} style={{width:9,height:9,borderRadius:"50%",background:c}}/>)}
          </div>
          <div style={{ flex:1, background:"rgba(255,255,255,0.05)", borderRadius:5, padding:"3px 10px", display:"flex", alignItems:"center", gap:6 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10"/></svg>
            <span style={{ fontSize:9.5, color:"rgba(255,255,255,0.28)", fontFamily:MONO }}>lgu-sdss · Social Vulnerability Map · Sample municipality</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", display:"inline-block", animation:"radarGlow 2s infinite" }}/>
            <span style={{ fontSize:9, color:"#4ade80", fontWeight:700 }}>Live</span>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px", background:"rgba(6,10,24,0.95)", borderBottom:"1px solid rgba(59,130,246,0.08)" }}>
          <span style={{ fontSize:8.5, color:"rgba(255,255,255,0.3)", marginRight:4, fontWeight:600 }}>LAYER</span>
          {[["Choropleth",true],["Boundaries",false],["Dot Map",false]].map(([t,a])=>(
            <div key={t} style={{ fontSize:8.5, padding:"2px 9px", borderRadius:4, background:a?"rgba(37,99,235,0.25)":"transparent", border:`0.5px solid ${a?"#3b82f6":"rgba(255,255,255,0.1)"}`, color:a?"#93c5fd":"rgba(255,255,255,0.3)", cursor:"default" }}>{t}</div>
          ))}
          <div style={{ marginLeft:6, width:"1px", height:12, background:"rgba(255,255,255,0.08)" }}/>
          <span style={{ fontSize:8.5, color:"rgba(255,255,255,0.3)", fontWeight:600 }}>OVERLAY</span>
          {["Flood","Landslide","Facilities"].map(t=>(
            <div key={t} style={{ fontSize:8, padding:"2px 8px", borderRadius:4, border:"0.5px solid rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.25)", cursor:"default" }}>{t}</div>
          ))}
          <div style={{ marginLeft:"auto", fontSize:8, color:"rgba(59,130,246,0.5)", fontFamily:MONO, whiteSpace:"nowrap" }}>SAMPLE</div>
        </div>

        <div style={{ display:"flex", flex:1 }}>
          {/* MAP */}
          <div style={{ position:"relative", flex:1, overflow:"hidden", height:"420px", background:"#040a04" }}>
            <svg width="100%" height="100%" viewBox="-15 -25 415 420" preserveAspectRatio="xMidYMid meet" style={{ display:"block" }}>
              {/* Satellite-like dark terrain bg */}
              <defs>
                <radialGradient id="terrainGrad" cx="50%" cy="50%" r="70%">
                  <stop offset="0%" stopColor="#0d1f0d"/>
                  <stop offset="60%" stopColor="#091508"/>
                  <stop offset="100%" stopColor="#040a04"/>
                </radialGradient>
                <radialGradient id="radarSweep" cx="50%" cy="52%" r="80%" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="rgba(59,130,246,0.08)"/>
                  <stop offset="100%" stopColor="rgba(59,130,246,0)"/>
                </radialGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <filter id="softGlow">
                  <feGaussianBlur stdDeviation="3.5" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <clipPath id="mapClip"><rect x="-15" y="-25" width="415" height="420"/></clipPath>
              </defs>

              <rect x="-15" y="-25" width="415" height="420" fill="url(#terrainGrad)"/>

              {/* Terrain texture dots */}
              {[...Array(100)].map((_,i)=>{
                let s=i*997+13; const r=()=>{s=(s*1664525+1013904223)&0xffffffff;return(s>>>0)/0xffffffff;};
                return <circle key={i} cx={-15+r()*415} cy={-25+r()*420} r={r()*1.8} fill={`rgba(${20+r()*30|0},${35+r()*30|0},${20+r()*20|0},${0.4+r()*0.5})`}/>;
              })}

              {/* Grid */}
              {[0,50,100,150,200,250,300,350,400].map(v=>(
                <g key={v}>
                  <line x1={v-15} y1="-25" x2={v-15} y2="395" stroke="rgba(59,130,246,0.05)" strokeWidth="0.5"/>
                  <line x1="-15" y1={v-25} x2="400" y2={v-25} stroke="rgba(59,130,246,0.05)" strokeWidth="0.5"/>
                </g>
              ))}

              {/* Radar sweep — rotating cone */}
              <g clipPath="url(#mapClip)">
                <polygon
                  points={`190,155 ${sweepX},${sweepY} ${190+Math.cos(rad-0.35)*300},${155+Math.sin(rad-0.35)*300}`}
                  fill="rgba(59,130,246,0.06)"
                />
                <line x1="190" y1="155" x2={sweepX} y2={sweepY}
                  stroke="rgba(99,179,237,0.3)" strokeWidth="1.5"
                  style={{ animation:"radarGlow 0.1s linear" }}
                />
              </g>

              {/* Horizontal scan line */}
              <line x1="-15" y1={scanPos - 25} x2="400" y2={scanPos - 25}
                stroke="rgba(59,130,246,0.18)" strokeWidth="1.2"
                strokeDasharray="4,8"
              />
              <line x1="-15" y1={scanPos - 26} x2="400" y2={scanPos - 26}
                stroke="rgba(147,197,253,0.08)" strokeWidth="3"
              />

              {/* Barangay polygons — display only */}
              {barangays.map((b) => (
                <g key={b.id}>
                  <path d={b.path} fill={b.color} opacity={0.12} filter="url(#softGlow)"/>
                  <path
                    d={b.path}
                    fill={b.color}
                    fillOpacity={0.38}
                    stroke={b.color}
                    strokeWidth={0.8}
                    style={{ animation:`brgyPulse ${2.5 + b.id * 0.15}s ease-in-out infinite`, animationDelay:`${b.id * 0.2}s` }}
                  />
                </g>
              ))}

              {/* Household dots */}
              {dotsVisible && dots.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r="1.6"
                  fill={d.color} opacity={0.7}
                  style={{ animation:`dotFadeIn 0.4s ${i*12}ms both` }}
                />
              ))}

              {/* Pulse rings on the two highest-ranked barangays */}
              {TOP_IDX.map(bi => (
                <g key={bi}>
                  <circle cx={centers[bi][0]} cy={centers[bi][1]}
                    r={4 + (pulseRing % 30) * 0.7} fill="none"
                    stroke={barangays[bi].color} strokeWidth="1.2"
                    opacity={Math.max(0, 0.7 - (pulseRing % 30) / 30 * 0.7)}
                  />
                  <circle cx={centers[bi][0]} cy={centers[bi][1]}
                    r={4 + ((pulseRing + 15) % 30) * 0.7} fill="none"
                    stroke={barangays[bi].color} strokeWidth="0.7"
                    opacity={Math.max(0, 0.4 - ((pulseRing + 15) % 30) / 30 * 0.4)}
                  />
                </g>
              ))}

              {/* Barangay name labels — only show named ones to avoid clutter */}
              {BY_RANK.slice(0, 5).map(({ id: i }) => {
                const b = barangays[i];
                const [cx, cy] = centers[i];
                return (
                  <g key={b.id} style={{ pointerEvents:"none" }}>
                    <text x={cx} y={cy-1} textAnchor="middle" fontSize="7" fontWeight="700"
                      fill="rgba(255,255,255,0.82)">
                      {b.name.replace("Barangay", "Brgy")}
                    </text>
                    <text x={cx} y={cy+9} textAnchor="middle" fontSize="6" fontWeight="600"
                      fill={b.color} opacity={0.9}>
                      #{b.rank}
                    </text>
                  </g>
                );
              })}

              {/* Coordinate readout */}
              <text x="-10" y="388" fontSize="7" fill="rgba(59,130,246,0.45)" fontFamily="monospace">Sample municipality · not real data</text>

              {/* Scale */}
              <g transform="translate(300,385)">
                <line x1="0" y1="0" x2="64" y2="0" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
                <line x1="0" y1="-3" x2="0" y2="3" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
                <line x1="64" y1="-3" x2="64" y2="3" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
                <text x="32" y="-5" textAnchor="middle" fontSize="6.5" fill="rgba(255,255,255,0.35)">5 km</text>
              </g>
            </svg>

            {/* Zoom controls */}
            <div style={{ position:"absolute", bottom:24, right:8, display:"flex", flexDirection:"column", gap:1 }}>
              {["+","−"].map(s=>(
                <div key={s} style={{ width:18, height:18, background:"rgba(6,10,24,0.9)", border:"0.5px solid rgba(59,130,246,0.2)", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"rgba(255,255,255,0.5)", cursor:"default", fontWeight:300 }}>{s}</div>
              ))}
            </div>
          </div>

          {/* Side panel */}
          <div style={{ width:165, background:"rgba(4,8,20,0.98)", borderLeft:"1px solid rgba(59,130,246,0.1)", display:"flex", flexDirection:"column", fontSize:9 }}>

            {/* SVI rank legend */}
            <div style={{ padding:"10px 10px 8px", borderBottom:"1px solid rgba(59,130,246,0.08)" }}>
              <div style={{ fontSize:7.5, fontWeight:700, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>SVI rank</div>
              {SVI_TIERS.map(l=>(
                <div key={l.label} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:5 }}>
                  <div style={{ width:10, height:4, borderRadius:1, background:l.color, flexShrink:0 }}/>
                  <span style={{ flex:1, color:"rgba(255,255,255,0.55)" }}>{l.label}</span>
                  <span style={{ color:"rgba(255,255,255,0.25)", fontFamily:MONO, fontSize:7 }}>{l.range}</span>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div style={{ padding:"8px 10px", borderBottom:"1px solid rgba(59,130,246,0.08)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                <div style={{ fontSize:7.5, fontWeight:700, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", textTransform:"uppercase" }}>Summary</div>
                <div style={{ fontSize:7, color:"rgba(255,255,255,0.25)" }}>{BARANGAYS.length} barangays</div>
              </div>
              {[
                { label:"Households", val:"5,812", color:"#60a5fa" },
                { label:"High-risk HH", val:"641", color:"#ef4444" },
                { label:"Hazard-exposed", val:"1,930", color:"#38bdf8" },
              ].map(s=>(
                <div key={s.label} style={{ display:"flex", justifyContent:"space-between", marginBottom:5, alignItems:"center" }}>
                  <span style={{ color:"rgba(255,255,255,0.38)" }}>{s.label}</span>
                  <span style={{ fontWeight:700, color:s.color, fontFamily:MONO, fontSize:10 }}>{s.val}</span>
                </div>
              ))}
            </div>

            {/* Top barangays by SVI rank */}
            <div style={{ padding:"8px 10px", flex:1 }}>
              <div style={{ fontSize:7.5, fontWeight:700, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Most vulnerable</div>
              {BY_RANK.slice(0, 5).map((b, i) => (
                <div key={b.name} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <span style={{ fontSize:7, color:"rgba(255,255,255,0.25)", fontFamily:MONO, minWidth:10 }}>{i+1}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:8, fontWeight:700, color:"rgba(255,255,255,0.7)", marginBottom:2 }}>{b.name}</div>
                    <div style={{ height:3, borderRadius:2, background:"rgba(255,255,255,0.06)", overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${100 - i * 14}%`, background:b.color, borderRadius:2 }}/>
                    </div>
                  </div>
                  <span style={{ fontSize:8, fontWeight:700, color:b.color, fontFamily:MONO }}>#{b.rank}</span>
                </div>
              ))}
            </div>

            {/* Bottom status */}
            <div style={{ padding:"6px 10px", borderTop:"1px solid rgba(59,130,246,0.08)", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", flexShrink:0, animation:"radarGlow 2s infinite" }}/>
              <span style={{ fontSize:7.5, color:"rgba(255,255,255,0.3)" }}>System Operational</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ── Features: bento grid ───────────────────────────────────────────── */
function useReveal(threshold = 0.12) {
  const [ref, visible] = useFadeIn(threshold);
  return [ref, visible];
}

function BentoCard({ i, span = "", dark = false, children, style }) {
  const [ref, visible] = useReveal(0.08);
  return (
    <div ref={ref} className={`lp-bento-card ${span} ${dark ? "is-dark" : ""}`}
      style={{ transitionDelay: `${i * 70}ms`, opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(22px)", ...style }}>
      {children}
    </div>
  );
}

function CardHead({ n, title, dark, accent = "#1a56db", icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
        background: dark ? "rgba(255,255,255,0.07)" : accent + "12", color: dark ? "#93c5fd" : accent,
        border: `1px solid ${dark ? "rgba(255,255,255,0.1)" : accent + "26"}`, flexShrink: 0 }}>{icon}</div>
      <h3 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 700, fontSize: "1.08rem", letterSpacing: "-0.2px", color: dark ? "#fff" : INK }}>{title}</h3>
      <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 11, color: dark ? "rgba(147,197,253,0.6)" : "#94a3b8" }}>{n}</span>
    </div>
  );
}

const ICON = {
  map: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  lens: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="9" r="5"/><circle cx="16" cy="9" r="5"/><circle cx="12" cy="16" r="5"/></svg>,
  dash: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>,
  upload: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  people: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  doc: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  file: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
};

const TYPOLOGY_DEMO = [
  { label: "Relatively stable", pct: 31, color: "#0d9488" },
  { label: "Food-insecure, otherwise stable", pct: 24, color: "#0ea5e9" },
  { label: "Financially excluded", pct: 19, color: "#4f46e5" },
  { label: "Compounded deprivation", pct: 15, color: "#db2777" },
  { label: "Senior-headed, education gaps", pct: 11, color: "#9333ea" },
];

function MiniMap() {
  const [hover, setHover] = useState(null);
  const b = hover != null ? DEMO_BARANGAYS[hover] : null;
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 230, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg viewBox="0 10 410 315" width="100%" style={{ maxHeight: 330, display: "block" }} aria-label="Sample barangay map">
        {DEMO_BARANGAYS.map((d) => (
          <path key={d.id} d={d.path} fill={d.color} fillOpacity={hover === d.id ? 0.85 : 0.5}
            stroke={hover === d.id ? "#fff" : "rgba(4,10,30,0.9)"} strokeWidth={hover === d.id ? 1.6 : 1}
            onMouseEnter={() => setHover(d.id)} onMouseLeave={() => setHover(null)} style={{ transition: "fill-opacity .2s", cursor: "default" }} />
        ))}
      </svg>
      <div style={{ position: "absolute", left: 0, bottom: 0, fontFamily: MONO, fontSize: 11, color: "rgba(191,219,254,0.75)",
        background: "rgba(4,10,30,0.7)", border: "1px solid rgba(147,197,253,0.2)", borderRadius: 8, padding: "6px 10px", minWidth: 170 }}>
        {b ? <>{b.name} · <span style={{ color: b.color }}>SVI #{b.rank}</span> · {b.tier}</> : "Point at a barangay"}
      </div>
    </div>
  );
}

function FeaturesBento() {
  return (
    <div className="lp-bento">
      {/* Map: the hero card */}
      <BentoCard i={0} span="lp-span-map" dark>
        <Contours opacity={0.06} drift={false} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
          <CardHead n="01" title="Spatial Map View" dark icon={ICON.map} />
          <p className="lp-card-p" style={{ color: "rgba(226,232,240,0.7)" }}>
            Your own barangay boundaries, flood and landslide zones, and facilities, with every barangay ranked and
            every household placed on the map.
          </p>
          <MiniMap />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            {SVI_TIERS.map((t) => (
              <span key={t.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "rgba(226,232,240,0.7)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color }} />{t.label}
              </span>
            ))}
          </div>
        </div>
      </BentoCard>

      {/* Three lenses */}
      <BentoCard i={1} span="lp-span-2">
        <CardHead n="02" title="Three lenses, never merged" icon={ICON.lens} accent="#7c3aed" />
        <p className="lp-card-p">Each barangay is read three ways, so a planner sees why it needs help, not just a single score.</p>
        <div className="lp-lenses">
          {[
            { k: "Social vulnerability", d: "13 CBMS household conditions", c: "#7c3aed" },
            { k: "Barangay capacity", d: "Plans, equipment, facilities", c: "#059669" },
            { k: "Hazard exposure", d: "From your own hazard maps", c: "#0284c7" },
          ].map((l) => (
            <div key={l.k} style={{ borderRadius: 12, padding: "12px 12px 11px", background: l.c + "0d", border: `1px solid ${l.c}2b` }}>
              <div style={{ width: 22, height: 4, borderRadius: 2, background: l.c, marginBottom: 9 }} />
              <div style={{ fontWeight: 700, fontSize: 13.5, color: INK, marginBottom: 2 }}>{l.k}</div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>{l.d}</div>
            </div>
          ))}
        </div>
      </BentoCard>

      <BentoCard i={2}>
        <CardHead n="03" title="Dashboard" icon={ICON.dash} accent="#1a56db" />
        <p className="lp-card-p">Population, households and priority barangays at a glance, ready for the next council meeting.</p>
      </BentoCard>

      <BentoCard i={3}>
        <CardHead n="04" title="CBMS Import" icon={ICON.upload} accent="#d97706" />
        <p className="lp-card-p">Load PSA-CBMS household, member and barangay records in batches. Undo a batch anytime.</p>
      </BentoCard>

      {/* Typology */}
      <BentoCard i={4} span="lp-span-2">
        <CardHead n="05" title="Household Typology & Family Network" icon={ICON.people} accent="#db2777" />
        <p className="lp-card-p">Every household is matched to one of five standard need profiles, the same in every municipality, so programs can be matched to the kind of help needed.</p>
        <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", margin: "4px 0 10px" }}>
          {TYPOLOGY_DEMO.map((t) => <div key={t.label} title={`${t.label}: ${t.pct}%`} style={{ width: `${t.pct}%`, background: t.color }} />)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: "4px 14px" }}>
          {TYPOLOGY_DEMO.map((t) => (
            <span key={t.label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#475569" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />{t.label}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: "#94a3b8" }}>Sample shares shown</div>
      </BentoCard>

      <BentoCard i={5} span="lp-span-2">
        <CardHead n="06" title="Planning Tools & Reports" icon={ICON.doc} accent="#057a55" />
        <p className="lp-card-p">Barangay planning briefs with recommended actions, hazard watchlists, and printable PDF reports for social protection targeting and DRRM planning.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Planning brief", "Hazard watchlist", "Typology report", "Custom population report"].map((t) => (
            <span key={t} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 20, background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#334155" }}>{t}</span>
          ))}
        </div>
      </BentoCard>
    </div>
  );
}

/* ── How it works: what an LGU brings, what it gets back ───────────────── */
const WORKFLOW = [
  { n: "01", title: "Set up your municipality", desc: "Upload your barangay boundaries and hazard maps, then pin your health, fire and evacuation facilities.",
    tag: "You bring", items: ["barangays.zip", "flood.zip", "landslide.zip"], file: true },
  { n: "02", title: "Import CBMS records", desc: "Load your PSA-CBMS records. Each household is placed on the map and checked against your hazard zones.",
    tag: "You bring", items: ["household.csv", "member.csv", "barangay.csv"], file: true },
  { n: "03", title: "Automatic analysis", desc: "Barangays are ranked by social vulnerability and capacity, hazard exposure is measured, and households are typed.",
    tag: "System computes", items: ["SVI rank", "Capacity rank", "Hazard %", "Typology"] },
  { n: "04", title: "Decide & act", desc: "Planners use the map, dashboards and reports to target programs and allocate resources where they are needed.",
    tag: "You get", items: ["Map view", "PDF reports", "Planning briefs"] },
];

function Workflow() {
  const [ref, visible] = useReveal(0.12);
  return (
    <div ref={ref} className="lp-flow">
      <div className="lp-flow-line" aria-hidden="true" />
      {WORKFLOW.map((w, i) => (
        <div key={w.n} className="lp-flow-step" style={{ transitionDelay: `${i * 110}ms`, opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(22px)" }}>
          <div className="lp-flow-node">{w.n}</div>
          <h3 style={{ margin: "0 0 8px", fontFamily: DISPLAY, fontWeight: 700, fontSize: "1.05rem", color: INK, letterSpacing: "-0.2px" }}>{w.title}</h3>
          <p style={{ margin: "0 0 14px", fontSize: 14, color: "#64748b", lineHeight: 1.65 }}>{w.desc}</p>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 7 }}>{w.tag}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {w.items.map((it) => (
              <span key={it} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: w.file ? MONO : "inherit", fontSize: w.file ? 11.5 : 12,
                padding: "4px 9px", borderRadius: 6, background: w.file ? "#0b1530" : "#eff6ff",
                color: w.file ? "#bfdbfe" : "#1a56db", border: w.file ? "1px solid #1e3a8a" : "1px solid #bfdbfe" }}>
                {w.file && ICON.file}{it}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Tech Stack ── */
function TechStack() {
  const [ref, visible] = useFadeIn(0.15);
  const [hovered, setHovered] = useState(null);

  return (
    <section ref={ref} style={{ padding: "4rem 2rem", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
      <style>{`
        @keyframes techPop {
          0%   { opacity: 0; transform: translateY(16px) scale(0.92); }
          60%  { transform: translateY(-3px) scale(1.03); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <p style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 28, textAlign: "center" }}>Built With</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", maxWidth: 900, margin: "0 auto" }}>
        {TECH.map((t, i) => (
          <div
            key={t.name}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              background: hovered === i ? "#fff" : "#fff",
              border: `1.5px solid ${hovered === i ? t.color + "55" : "#e8edf5"}`,
              borderRadius: 14, padding: "10px 18px 10px 12px",
              cursor: "default",
              boxShadow: hovered === i ? `0 6px 20px ${t.color}22` : "0 1px 4px rgba(0,0,0,0.05)",
              transform: hovered === i ? "translateY(-3px)" : "translateY(0)",
              transition: "all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
              animation: visible ? `techPop 0.5s ${i * 60}ms cubic-bezier(0.34,1.56,0.64,1) both` : "none",
              opacity: visible ? 1 : 0,
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: hovered === i ? t.color + "18" : t.color + "0e",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.25s", flexShrink: 0,
            }}>{t.logo}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: hovered === i ? t.color : "#0f172a", lineHeight: 1.2, transition: "color 0.2s" }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginTop: 1 }}>{t.version}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Main page ── */
export default function LandingPage({ onLogin }) {
  const [scrolled, setScrolled] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginVisible, setLoginVisible] = useState(false); // drives the split animation
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Open: mount first, then trigger CSS transition on next frame
  const openLogin = () => {
    setShowLogin(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setLoginVisible(true)));
  };

  // Close: reverse transition, then unmount after it finishes
  const closeLogin = () => {
    setLoginVisible(false);
    setTimeout(() => setShowLogin(false), 620);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close login on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape" && showLogin) closeLogin(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showLogin]);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileMenuOpen(false);
  };

  const [heroRef] = useFadeIn(0.05);
  const [featRef, featVisible] = useFadeIn(0.1);
  const [stepsRef, stepsVisible] = useFadeIn(0.1);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#1e293b", background: "#f8fafc", minHeight: "100vh" }}>
      <style>{`
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeSlideUp { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
        @keyframes gridDraw { from{opacity:0} to{opacity:1} }
        @keyframes loginSlideIn { from{opacity:0;transform:translateY(40px) scale(0.93)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes glowPulse2 { 0%,100%{opacity:0.5} 50%{opacity:1} }
        .nav-link:hover { color: #1a56db !important; }
        .cta-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(0,0,0,0.18) !important; }
        .cta-secondary:hover { background: rgba(255,255,255,0.15) !important; }
        .tech-tag:hover { background: #eff6ff !important; border-color: #bfdbfe !important; color: #1a56db !important; }
        .team-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.09) !important; }
        /* Hero split animation */
        .hero-left-panel {
          transition: transform 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.6s cubic-bezier(0.4,0,0.2,1);
          will-change: transform, opacity;
        }
        .hero-left-panel.login-open {
          transform: translateX(-60px) !important;
          opacity: 0.25 !important;
        }
        .hero-right-panel {
          transition: transform 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.6s cubic-bezier(0.4,0,0.2,1);
          will-change: transform, opacity;
        }
        .hero-right-panel.login-open {
          transform: translateX(60px) !important;
          opacity: 0.18 !important;
        }
        .hero-login-panel {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) translateY(40px) scale(0.93);
          opacity: 0;
          transition: opacity 0.55s cubic-bezier(0.34,1.2,0.64,1), transform 0.55s cubic-bezier(0.34,1.2,0.64,1);
          pointer-events: none;
          z-index: 20;
          width: 460px;
          max-width: 90vw;
          will-change: transform, opacity;
        }
        .hero-login-panel.login-open {
          opacity: 1;
          transform: translate(-50%, -50%) translateY(0) scale(1);
          pointer-events: auto;
        }
        /* ── polish layer ── */
        html { scroll-behavior: smooth; }
        @keyframes contourDrift { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(-1.5%,1%,0) scale(1.03); } }
        .lp-contour-drift { animation: contourDrift 38s ease-in-out infinite; }
        @keyframes flowDash { to { background-position: 40px 0; } }
        .lp-h2 { font-family: ${DISPLAY}; font-weight: 700; font-size: clamp(1.75rem, 3vw, 2.5rem); line-height: 1.1; letter-spacing: -0.6px; margin: 0; text-wrap: balance; }
        .lp-lead { font-size: 1.02rem; line-height: 1.75; margin: 0; max-width: 430px; }
        .lp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 2rem 4rem; flex-wrap: wrap; margin-bottom: 2.75rem; }
        .lp-head > div { max-width: 620px; }
        .lp-bento { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 16px; }
        .lp-bento-card { position: relative; overflow: hidden; background: #fff; border: 1px solid #e6ebf3; border-radius: 18px; padding: 22px 22px 20px;
          box-shadow: 0 1px 2px rgba(15,23,42,0.04); transition: opacity .7s ease, transform .7s ease, box-shadow .25s ease, border-color .25s ease; }
        .lp-bento-card:hover { box-shadow: 0 14px 40px rgba(15,23,42,0.09); border-color: #cbd5e1; }
        .lp-bento-card.is-dark { background: linear-gradient(160deg, #0b1838 0%, #0a1430 60%, #071027 100%); border-color: #1e3a8a; color: #fff; }
        .lp-bento-card.is-dark:hover { border-color: #3b82f6; box-shadow: 0 18px 50px rgba(30,64,175,0.35); }
        .lp-span-map { grid-column: span 2; grid-row: span 2; display: flex; flex-direction: column; }
        .lp-span-2 { grid-column: span 2; }
        .lp-card-p { margin: 0 0 14px; font-size: 14px; line-height: 1.65; color: #64748b; }
        .lp-lenses { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
        .lp-flow { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 28px; }
        .lp-flow-line { position: absolute; top: 22px; left: 22px; right: 12%; height: 2px;
          background-image: linear-gradient(90deg, #3b82f6 50%, transparent 50%); background-size: 14px 2px; opacity: .55; animation: flowDash 1.6s linear infinite; }
        .lp-flow-step { position: relative; transition: opacity .7s ease, transform .7s ease; }
        .lp-flow-node { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 18px;
          background: ${INK}; color: #bfdbfe; font-family: ${MONO}; font-weight: 600; font-size: 14px; position: relative;
          box-shadow: 0 0 0 6px #fff, 0 8px 22px rgba(11,21,48,0.25); }
        .gov-btn:focus-visible, .cta-primary:focus-visible, .cta-secondary:focus-visible, .nav-link:focus-visible { outline: 2px solid #93c5fd; outline-offset: 3px; }
        @media (max-width: 1240px) {
          .hero-right-panel { grid-template-columns: 1fr !important; }
          .hero-right-panel > div:first-child, .hero-right-panel > div:last-child { display: none !important; }
        }
        @media (max-width: 1000px) {
          .lp-bento { grid-template-columns: repeat(2, minmax(0,1fr)); }
          .lp-span-map { grid-row: span 1; }
          .lp-flow { grid-template-columns: repeat(2, minmax(0,1fr)); row-gap: 40px; }
          .lp-flow-line { display: none; }
        }
        @media (max-width: 640px) {
          .lp-bento { grid-template-columns: 1fr; }
          .lp-span-map, .lp-span-2 { grid-column: span 1; }
          .lp-lenses { grid-template-columns: 1fr; }
          .lp-flow { grid-template-columns: 1fr; }
          .lp-flow-step { padding-left: 64px; }
          .lp-flow-node { position: absolute; left: 0; top: 0; }
          .lp-flow-step:not(:last-child)::after { content: ""; position: absolute; left: 22px; top: 56px; bottom: -34px; width: 2px; background: repeating-linear-gradient(#93c5fd 0 6px, transparent 6px 12px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-contour-drift, .lp-flow-line { animation: none !important; }
        }
        @media (max-width: 900px) {
          .hero-right-panel { display: none !important; }
          .hero-left-panel { max-width: 100% !important; }
          .desktop-nav { display: none !important; }
          .mobile-toggle { display: flex !important; }
          .hero-content { padding-top: 7rem !important; }
          .hero-visual { display: none !important; }
          .hero-float { display: none !important; }
          .hero-login-panel { position: fixed !important; top: 50% !important; left: 50% !important; }
        }
        @media (min-width: 901px) {
          .mobile-toggle { display: none !important; }
          .mobile-menu { display: none !important; }
        }
      `}</style>

      {/* Login modal is now embedded inline in the hero section below */}

      {/* ── Navbar ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        background: scrolled ? "rgba(255,255,255,0.97)" : "transparent",
        borderBottom: scrolled ? "1px solid #e8edf4" : "none",
        transition: "all 0.3s ease",
        backdropFilter: scrolled ? "blur(12px)" : "none",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 2rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={systemLogo} alt="LGU-SDSS" style={{ width: 36, height: 36, borderRadius: 9, objectFit: "contain" }} />
            <span style={{ fontWeight: 800, fontSize: 17, color: scrolled ? "#0f172a" : "#fff", fontFamily: "'Syne', sans-serif", letterSpacing: "-0.3px" }}>LGU-SDSS</span>
          </div>

          {/* Desktop nav */}
          <div className="desktop-nav" style={{ display: "flex", gap: 28, alignItems: "center" }}>
            {NAV_LINKS.map(l => (
              <button key={l} className="nav-link" onClick={() => scrollTo(l.toLowerCase().replace(/ /g, "-"))}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, color: scrolled ? "#475569" : "rgba(255,255,255,0.85)", padding: 0, transition: "color 0.2s", fontFamily: "inherit" }}>
                {l}
              </button>
            ))}
            <button onClick={() => openLogin()} style={{ background: scrolled ? "#1a56db" : "rgba(255,255,255,0.15)", color: "#fff", border: scrolled ? "none" : "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "8px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", backdropFilter: "blur(4px)", fontFamily: "inherit" }}>
              Sign In
            </button>
          </div>

          {/* Mobile toggle */}
          <button className="mobile-toggle" onClick={() => setMobileMenuOpen(o => !o)}
            style={{ background: "none", border: "none", cursor: "pointer", color: scrolled ? "#0f172a" : "#fff", padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ display: "block", width: 22, height: 2, background: "currentColor", borderRadius: 2 }} />
            <span style={{ display: "block", width: 16, height: 2, background: "currentColor", borderRadius: 2 }} />
            <span style={{ display: "block", width: 22, height: 2, background: "currentColor", borderRadius: 2 }} />
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="mobile-menu" style={{ background: "#fff", borderTop: "1px solid #e2e8f0", padding: "1rem 2rem" }}>
            {NAV_LINKS.map(l => (
              <button key={l} onClick={() => scrollTo(l.toLowerCase().replace(/ /g, "-"))}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 0", fontSize: 15, fontWeight: 500, color: "#475569", cursor: "pointer", fontFamily: "inherit", borderBottom: "1px solid #f1f5f9" }}>
                {l}
              </button>
            ))}
            <button onClick={() => { openLogin(); setMobileMenuOpen(false); }}
              style={{ marginTop: 12, width: "100%", background: "#1a56db", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Sign In
            </button>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section style={{ minHeight: "92vh", display: "flex", alignItems: "center", background: "linear-gradient(130deg, #0a1628 0%, #0f2460 40%, #1a56db 100%)", position: "relative", overflow: "hidden", paddingBottom: "3rem" }}>
        {/* Grid texture */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 20% 50%, rgba(6,14,36,0.45) 0%, transparent 60%)", pointerEvents: "none" }} />
        {/* Radial glow */}
        <div style={{ position: "absolute", top: "20%", right: "10%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(26,86,219,0.35) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-10%", left: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(147,197,253,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 2rem", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2rem", position: "relative" }}>
          {/* Left: text */}
          <div ref={heroRef} className={`hero-content hero-left-panel${loginVisible ? " login-open" : ""}`} style={{ maxWidth: 480, paddingTop: "5rem", paddingBottom: "4rem", position: "relative", zIndex: 1, flexShrink: 0 }}>
            {/* Status badge */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 100, padding: "6px 16px", marginBottom: 32, animation: "fadeSlideUp 0.6s ease both" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", display: "inline-block", animation: "pulse 2s ease infinite" }} />
              <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 600, fontFamily: MONO, letterSpacing: "0.06em" }}>FOR PHILIPPINE LGUs · PSA-CBMS READY</span>
            </div>

            <h1 className="lp-hero-h1" style={{ fontSize: "clamp(2.3rem,4.6vw,3.7rem)", fontWeight: 800, color: "#fff", lineHeight: 1.04, margin: "0 0 1.5rem", letterSpacing: "-1.5px", fontFamily: DISPLAY, animation: "fadeSlideUp 0.7s 0.1s ease both", opacity: 0, animationFillMode: "forwards" }}>
              Spatial Decision<br />
              <span style={{ background: "linear-gradient(90deg,#93c5fd,#bfdbfe 60%,#e0f2fe)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Support System</span>
            </h1>

            <p style={{ fontSize: "1.05rem", color: "rgba(255,255,255,0.7)", lineHeight: 1.75, maxWidth: 460, margin: "0 0 2.5rem", animation: "fadeSlideUp 0.7s 0.2s ease both", opacity: 0, animationFillMode: "forwards" }}>
              Upload your municipality's barangay boundaries, hazard maps and CBMS data, and see which barangays and households need help first, and what kind of help.
            </p>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", animation: "fadeSlideUp 0.7s 0.3s ease both", opacity: 0, animationFillMode: "forwards" }}>
              <button className="cta-primary" onClick={() => openLogin()} style={{ background: "#fff", color: "#1a56db", border: "none", borderRadius: 10, padding: "13px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontFamily: "inherit" }}>
                Access System →
              </button>
              <button className="cta-secondary" onClick={() => scrollTo("features")} style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 10, padding: "13px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit" }}>
                View Features
              </button>
            </div>

            <div style={{ marginTop: "2.4rem", animation: "fadeSlideUp 0.7s 0.45s ease both", opacity: 0, animationFillMode: "forwards" }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.14em", color: "rgba(191,219,254,0.55)", marginBottom: 10 }}>WORKS WITH THE FILES YOUR LGU ALREADY HAS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[["SHP", "Barangay boundaries"], ["SHP", "Flood & landslide maps"], ["CSV", "PSA-CBMS records"]].map(([ext, label]) => (
                  <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 10px 6px 6px", borderRadius: 8,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.82)", fontSize: 12.5 }}>
                    <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, padding: "2px 5px", borderRadius: 4, background: ext === "CSV" ? "rgba(52,211,153,0.18)" : "rgba(96,165,250,0.2)", color: ext === "CSV" ? "#6ee7b7" : "#93c5fd" }}>{ext}</span>
                    {label}
                  </span>
                ))}
              </div>
            </div>

           
          </div>

          {/* Inline Login Panel — animates in between left text and right mockup */}
          {showLogin && (
            <div className={`hero-login-panel${loginVisible ? " login-open" : ""}`}>
              {/* Outer glow ring */}
              <div style={{ position:"absolute", inset:-1, borderRadius:22, background:"linear-gradient(135deg,rgba(59,130,246,0.4),rgba(99,102,241,0.2),rgba(59,130,246,0.1))", zIndex:-1, animation:"glowPulse2 3s ease infinite" }}/>
              <LoginModal onLogin={onLogin} onClose={closeLogin} inline />
            </div>
          )}

          {/* Right: 3-col grid — [left cards] [map] [right cards] */}
          <div className={`hero-right-panel${loginVisible ? " login-open" : ""}`} style={{ flex: 1, display: "grid", gridTemplateColumns: "190px 1fr 155px", gap: 12, alignItems: "center", zIndex: 1, minWidth: 0 }}>

            {/* ── LEFT COLUMN: stacked cards ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Vulnerability Score Card */}
              <div style={{
                background: "rgba(6,10,24,0.92)",
                border: "1px solid rgba(168,85,247,0.3)",
                borderRadius: 14, padding: "14px 12px 12px",
                backdropFilter: "blur(16px)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)",
                animation: "float 6s ease-in-out infinite",
              }}>
                <style>{`@keyframes scoreRingAnim { from { stroke-dashoffset: 138; } to { stroke-dashoffset: 74; } }`}</style>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9 }}>
                  <span style={{ fontSize:8.5, fontWeight:700, color:"rgba(255,255,255,0.45)", letterSpacing:"0.08em", textTransform:"uppercase" }}>Household</span>
                  <span style={{ fontSize:7, background:"rgba(239,68,68,0.15)", color:"#f87171", border:"0.5px solid rgba(239,68,68,0.3)", borderRadius:20, padding:"2px 7px", fontWeight:700 }}>HIGH-RISK LIST</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <svg width="50" height="50" viewBox="0 0 56 56" style={{ flexShrink:0 }}>
                    <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(168,85,247,0.12)" strokeWidth="5"/>
                    <circle cx="28" cy="28" r="22" fill="none" stroke="#a855f7" strokeWidth="5"
                      strokeLinecap="round" strokeDasharray="138" strokeDashoffset="74"
                      transform="rotate(-90 28 28)"
                      style={{ animation:"scoreRingAnim 1.8s 0.3s cubic-bezier(0.4,0,0.2,1) both" }}
                    />
                    <text x="28" y="32" textAnchor="middle" fontSize="12" fontWeight="800" fill="#a855f7" fontFamily="monospace">6</text>
                  </svg>
                  <div>
                    <div style={{ fontSize:17, fontWeight:900, color:"#a855f7", fontFamily:"'Syne',sans-serif", lineHeight:1 }}>6 of 13</div>
                    <div style={{ fontSize:7.5, color:"rgba(255,255,255,0.4)", marginTop:2 }}>SVI conditions present</div>
                  </div>
                </div>
                {[
                  { label:"Social vulnerability", val:"6 / 13", color:"#a855f7" },
                  { label:"Barangay capacity", val:"Low", color:"#f59e0b" },
                  { label:"Flood zone", val:"High", color:"#38bdf8" },
                ].map(c => (
                  <div key={c.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:"0.5px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ fontSize:7.5, color:"rgba(255,255,255,0.45)" }}>{c.label}</span>
                    <span style={{ fontSize:7.5, fontWeight:700, color:c.color, fontFamily:MONO }}>{c.val}</span>
                  </div>
                ))}
                <div style={{ marginTop:7, paddingTop:2, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:7.5, color:"rgba(255,255,255,0.3)" }}>Typology</span>
                  <span style={{ fontSize:8, fontWeight:800, color:"#f472b6" }}>Compounded deprivation</span>
                </div>
                <div style={{ marginTop:5, paddingTop:5, borderTop:"0.5px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize:7.5, color:"rgba(255,255,255,0.22)", marginBottom:4 }}>HH-████ · 7 members · Brgy 4</div>
                  <div style={{ display:"flex", gap:3 }}>
                    {["Food insecure","Large HH","No account"].map(t => (
                      <span key={t} style={{ fontSize:6.5, background:"rgba(255,255,255,0.06)", color:"rgba(255,255,255,0.35)", borderRadius:3, padding:"1px 5px" }}>{t}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Network Graph Card */}
              <div style={{
                background: "rgba(6,10,24,0.92)",
                border: "1px solid rgba(59,130,246,0.25)",
                borderRadius: 14, padding: "11px",
                backdropFilter: "blur(16px)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)",
                animation: "float 7s 1.2s ease-in-out infinite",
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                  <span style={{ fontSize:8.5, fontWeight:700, color:"rgba(255,255,255,0.45)", letterSpacing:"0.08em", textTransform:"uppercase" }}>Network Graph</span>
                  <span style={{ fontSize:7, color:"rgba(59,130,246,0.7)", background:"rgba(59,130,246,0.1)", border:"0.5px solid rgba(59,130,246,0.2)", borderRadius:10, padding:"1px 7px", fontWeight:600 }}>HH-████</span>
                </div>
                <svg width="100%" height="120" viewBox="0 0 166 120">
                  <rect width="166" height="120" rx="5" fill="rgba(255,255,255,0.015)"/>
                  {/* Edges */}
                  <line x1="83" y1="28" x2="83" y2="50" stroke="rgba(233,30,99,0.55)" strokeWidth="1.2" strokeDasharray="3,2"/>
                  <line x1="83" y1="73" x2="38" y2="104" stroke="rgba(59,130,246,0.5)" strokeWidth="1.1"/>
                  <line x1="83" y1="73" x2="128" y2="104" stroke="rgba(59,130,246,0.5)" strokeWidth="1.1"/>
                  {/* Spouse label */}
                  <rect x="56" y="32" width="30" height="10" rx="3" fill="rgba(233,30,99,0.12)"/>
                  <text x="71" y="39.5" textAnchor="middle" fontSize="5" fill="rgba(233,30,99,0.85)" fontWeight="700">Spouse</text>
                  {/* Son labels */}
                  <text x="43" y="88" fontSize="4.5" fill="rgba(59,130,246,0.65)" textAnchor="middle">Son/Daughter</text>
                  <text x="121" y="88" fontSize="4.5" fill="rgba(59,130,246,0.65)" textAnchor="middle">Son/Daughter</text>
                  {/* Head node */}
                  <circle cx="83" cy="63" r="17" fill="rgba(12,24,44,0.98)" stroke="#4e9bff" strokeWidth="1.8"/>
                  <circle cx="83" cy="63" r="21" fill="none" stroke="rgba(78,155,255,0.1)" strokeWidth="1"/>
                  <text x="83" y="59" textAnchor="middle" fontSize="5.5" fill="#93c5fd" fontWeight="700">████ ████</text>
                  <text x="83" y="67" textAnchor="middle" fontSize="4.5" fill="rgba(255,255,255,0.4)">37</text>
                  <rect x="63" y="70" width="40" height="7" rx="3.5" fill="rgba(78,155,255,0.1)"/>
                  <text x="83" y="76" textAnchor="middle" fontSize="4.5" fill="#60a5fa" fontWeight="600">Female · Head</text>
                  {/* Spouse node */}
                  <circle cx="83" cy="18" r="12" fill="rgba(12,24,44,0.98)" stroke="#4e9bff" strokeWidth="1.3"/>
                  <text x="83" y="15" textAnchor="middle" fontSize="5" fill="#93c5fd" fontWeight="700">████ ████</text>
                  <text x="83" y="23" textAnchor="middle" fontSize="4" fill="rgba(255,255,255,0.35)">40</text>
                  {/* Child nodes */}
                  <circle cx="38" cy="107" r="11" fill="rgba(8,24,16,0.98)" stroke="#22d3a5" strokeWidth="1.2"/>
                  <text x="38" y="104" textAnchor="middle" fontSize="4.5" fill="#6ee7b7" fontWeight="700">████</text>
                  <text x="38" y="112" textAnchor="middle" fontSize="4" fill="rgba(255,255,255,0.3)">8</text>
                  <circle cx="128" cy="107" r="11" fill="rgba(8,24,16,0.98)" stroke="#22d3a5" strokeWidth="1.2"/>
                  <text x="128" y="104" textAnchor="middle" fontSize="4.5" fill="#6ee7b7" fontWeight="700">████</text>
                  <text x="128" y="112" textAnchor="middle" fontSize="4" fill="rgba(255,255,255,0.3)">15</text>
                  {/* Connector dots */}
                  {[[83,28],[83,50],[83,73],[38,95],[128,95]].map(([x,y],i)=>(
                    <circle key={i} cx={x} cy={y} r="2" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" strokeWidth="0.6"/>
                  ))}
                </svg>
                <div style={{ display:"flex", gap:7, marginTop:5 }}>
                  {[["#f472b6","Spouse"],["#60a5fa","Adult"],["#6ee7b7","Minor"]].map(([c,l])=>(
                    <div key={l} style={{ display:"flex", alignItems:"center", gap:3 }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", background:c }}/>
                      <span style={{ fontSize:6.5, color:"rgba(255,255,255,0.3)" }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── CENTER: Map mockup ── */}
            <div style={{ minWidth: 0 }}>
              <HeroMockup />
            </div>

            {/* ── RIGHT COLUMN: stacked cards ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Live pill */}
              <div style={{
                background: "rgba(6,10,24,0.9)",
                border: "1px solid rgba(34,197,94,0.3)",
                borderRadius: 30, padding: "6px 12px",
                display: "flex", alignItems: "center", gap: 6,
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                animation: "float 5s 0.5s ease-in-out infinite",
                alignSelf: "flex-start",
              }}>
                <span style={{ width:6, height:6, borderRadius:"50%", background:"#4ade80", flexShrink:0, animation:"pulse 1.5s infinite" }}/>
                <span style={{ fontSize:9, fontWeight:600, color:"rgba(255,255,255,0.8)", whiteSpace:"nowrap" }}>Any municipality</span>
              </div>

              {/* Barangay Alert */}
              <div style={{
                background: "rgba(6,10,24,0.92)",
                border: "1px solid rgba(239,68,68,0.22)",
                borderRadius: 12, padding: "10px 10px",
                backdropFilter: "blur(16px)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                animation: "float 8s 2s ease-in-out infinite",
              }}>
                <div style={{ fontSize:7.5, fontWeight:700, color:"rgba(255,255,255,0.38)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:7 }}>Priority barangays</div>
                {BY_RANK.slice(0, 2).map((b)=>({ name:b.name, bvi:`#${b.rank}`, color:"#ef4444" })).map(a=>(
                  <div key={a.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5, padding:"4px 6px", background:a.color+"10", border:`0.5px solid ${a.color}28`, borderRadius:6 }}>
                    <div>
                      <div style={{ fontSize:8, fontWeight:700, color:"rgba(255,255,255,0.8)" }}>{a.name}</div>
                      <div style={{ fontSize:6.5, color:"rgba(255,255,255,0.28)" }}>SVI rank</div>
                    </div>
                    <div style={{ fontSize:12, fontWeight:800, color:a.color, fontFamily:MONO }}>{a.bvi}</div>
                  </div>
                ))}
                <div style={{ marginTop:5, fontSize:6.5, color:"rgba(255,255,255,0.22)", textAlign:"center" }}>Most socially vulnerable</div>
              </div>

              {/* Mini stat card */}
              <div style={{
                background: "rgba(6,10,24,0.9)",
                border: "1px solid rgba(59,130,246,0.18)",
                borderRadius: 12, padding: "10px 10px",
                backdropFilter: "blur(16px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                animation: "float 6.5s 3s ease-in-out infinite",
              }}>
                <div style={{ fontSize:7.5, fontWeight:700, color:"rgba(255,255,255,0.38)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:7 }}>Household typology</div>
                {[
                  { label:"Relatively stable", val:"31%", color:"#0d9488" },
                  { label:"Food-insecure",     val:"24%", color:"#0ea5e9" },
                  { label:"Financially excl.", val:"19%", color:"#6366f1" },
                  { label:"Compounded",        val:"15%", color:"#db2777" },
                  { label:"Senior-headed",     val:"11%", color:"#9333ea" },
                ].map(r=>(
                  <div key={r.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <div style={{ width:5, height:5, borderRadius:1, background:r.color, flexShrink:0 }}/>
                      <span style={{ fontSize:7.5, color:"rgba(255,255,255,0.45)" }}>{r.label}</span>
                    </div>
                    <span style={{ fontSize:8, fontWeight:700, color:r.color, fontFamily:MONO }}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* Scroll cue */}
        <div style={{ position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, animation: "pulse 2s ease infinite" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Scroll</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ padding: "6rem 2rem 5.5rem", background: "#f6f8fc", position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          <div ref={featRef} className="lp-head" style={{ transition: "opacity 0.7s, transform 0.7s", opacity: featVisible ? 1 : 0, transform: featVisible ? "translateY(0)" : "translateY(24px)" }}>
            <div>
              <Eyebrow index="01">System modules</Eyebrow>
              <h2 className="lp-h2" style={{ color: INK }}>Everything a municipality needs to target help</h2>
            </div>
            <p className="lp-lead" style={{ color: "#64748b" }}>Six connected modules that turn CBMS records and hazard maps into a clear picture of who needs help, where, and what kind.</p>
          </div>
          <FeaturesBento />
        </div>
      </section>

      {/* ── About ── */}
      <section id="about" style={{ padding: "6rem 2rem", background: "linear-gradient(130deg, #071027 0%, #0f2460 55%, #1a3a8a 100%)", position: "relative", overflow: "hidden" }}>
        <Contours opacity={0.07} />
        <div className="lp-about-grid" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "4.5rem", alignItems: "center", position: "relative" }}>
          <div>
            <Eyebrow index="02" dark>About the system</Eyebrow>
            <h2 className="lp-h2" style={{ color: "#fff", margin: "0 0 1.5rem" }}>Built in one municipality, made for every LGU</h2>
            <p style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.8, fontSize: "0.98rem", margin: "0 0 1.25rem" }}>LGU-SDSS helps a municipality identify and target vulnerable households through evidence-based planning. Any LGU can set it up with its own barangay boundaries, hazard maps and PSA-CBMS records. It was developed as a thesis study and piloted in the Municipality of San Miguel, Iloilo.</p>
            <p style={{ color: "rgba(255,255,255,0.55)", lineHeight: 1.8, fontSize: "0.95rem", margin: 0 }}>It serves municipal planning (MPDO), social welfare (MSWDO) and disaster risk reduction (MDRRMO) staff with role-based access to vulnerability data, spatial maps and planning dashboards.</p>
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            {[
              { num: "01", title: "Works for any municipality", desc: "Set up with your own boundaries, hazard maps and facilities" },
              { num: "02", title: "PSA-CBMS data import", desc: "Household, member and barangay records, imported in batches" },
              { num: "03", title: "Three separate lenses", desc: "Social vulnerability, barangay capacity and hazard exposure" },
              { num: "04", title: "Household typology", desc: "Five standard need profiles, the same in every municipality" },
            ].map((o) => (
              <div key={o.num} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "1.1rem 1.25rem", display: "flex", gap: 16, alignItems: "flex-start", transition: "background 0.2s" }}>
                <span style={{ color: "#60a5fa", fontSize: 12, fontWeight: 600, lineHeight: "20px", minWidth: 28, fontFamily: MONO }}>{o.num}</span>
                <div>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: "0.93rem", marginBottom: 3 }}>{o.title}</div>
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.83rem", lineHeight: 1.5 }}>{o.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" style={{ padding: "6rem 2rem", background: "#fff", position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div ref={stepsRef} className="lp-head" style={{ transition: "opacity 0.7s, transform 0.7s", opacity: stepsVisible ? 1 : 0, transform: stepsVisible ? "none" : "translateY(24px)" }}>
            <div>
              <Eyebrow index="03">How it works</Eyebrow>
              <h2 className="lp-h2" style={{ color: INK }}>From your files to a planning map in four steps</h2>
            </div>
            <p className="lp-lead" style={{ color: "#64748b" }}>No new survey needed. The system works with the boundary and hazard files your LGU already has and the CBMS data PSA already collects.</p>
          </div>
          <Workflow />
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <TechStack />

      {/* ── Team ── */}
      {/* ── Partner Institutions ── */}
      <section id="partners" style={{ background: "linear-gradient(170deg, #060d1c 0%, #0a1628 60%, #0d1f3c 100%)", padding: "5rem 2rem", position: "relative", overflow: "hidden" }}>
        {/* Subtle grid overlay */}
        <Contours opacity={0.05} drift={false} />
        {/* Radial glow top-center */}
        <div style={{ position:"absolute", top:"-20%", left:"50%", transform:"translateX(-50%)", width:700, height:400, borderRadius:"50%", background:"radial-gradient(ellipse,rgba(26,86,219,0.18) 0%,transparent 70%)", pointerEvents:"none" }}/>

        <div style={{ maxWidth:1100, margin:"0 auto", position:"relative", zIndex:1 }}>

          {/* Header */}
          <div style={{ textAlign:"center", marginBottom:"3.5rem" }}>
            <Eyebrow dark center>Partners & standards</Eyebrow>
            <h2 className="lp-h2" style={{ color:"#fff", margin:"0 0 0.75rem" }}>Piloted locally, built on national standards</h2>
            <p style={{ color:"rgba(255,255,255,0.45)", fontSize:"1rem", maxWidth:520, margin:"0 auto", lineHeight:1.7 }}>
              Developed with the Municipality of San Miguel, Iloilo, and aligned with PSA and DILG standards so any LGU's planning and welfare offices can adopt it.
            </p>
          </div>

          {/* Divider line with ornament */}
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:"3rem" }}>
            <div style={{ flex:1, height:"1px", background:"linear-gradient(90deg,transparent,rgba(59,130,246,0.3))" }}/>
            <div style={{ display:"flex", gap:5 }}>
              {[0,1,2].map(i=><div key={i} style={{ width:4, height:4, borderRadius:"50%", background: i===1?"#3b82f6":"rgba(59,130,246,0.3)" }}/>)}
            </div>
            <div style={{ flex:1, height:"1px", background:"linear-gradient(90deg,rgba(59,130,246,0.3),transparent)" }}/>
          </div>

          {/* Main partner cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:16, marginBottom:24 }}>
            {[
              {
                acronym:"PILOT",
                full:"Municipality of San Miguel",
                role:"Pilot Municipality",
                dept:"Iloilo, Philippines",
                color:"#1a56db",
                logoUrl: sanMiguelSeal,
                logoBg:"#ffffff",
              },
              {
                acronym:"MPDO",
                full:"Municipal Planning & Development Office",
                role:"Planning & Data Standards",
                dept:"In any adopting LGU",
                color:"#0e9f6e",
                logoUrl: null,
                logoBg:"#ffffff",
              },
              {
                acronym:"MSWDO",
                full:"Municipal Social Welfare & Development Office",
                role:"Social Protection Targeting",
                dept:"In any adopting LGU",
                color:"#7e3af2",
                logoUrl: null,
                logoBg:"#ffffff",
              },
              {
                acronym:"PSA",
                full:"Philippine Statistics Authority",
                role:"CBMS Data Standards",
                dept:"Community-Based Monitoring",
                color:"#d97706",
                logoUrl: psaLogo,
                logoBg:"#ffffff",
              },
              {
                acronym:"DILG",
                full:"Dept. of Interior & Local Government",
                role:"Governance Framework",
                dept:"Local Government Unit Policy",
                color:"#e02424",
                logoUrl: dilgLogo,
                logoBg:"#ffffff",
              },
            ].map((p, i) => (
              <div key={p.acronym} style={{
                background:"rgba(255,255,255,0.03)",
                border:`1px solid ${p.color}22`,
                borderTop:`2px solid ${p.color}`,
                borderRadius:16,
                padding:"1.5rem 1.25rem 1.4rem",
                transition:"all 0.3s",
                cursor:"default",
                animation:`fadeSlideUp 0.6s ${i*80}ms ease both`,
              }}
              onMouseEnter={e=>{e.currentTarget.style.background=`${p.color}0a`;e.currentTarget.style.transform="translateY(-4px)";e.currentTarget.style.boxShadow=`0 12px 36px ${p.color}18`;}}
              onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.03)";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}
              >
                {/* Logo + acronym */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                  <div style={{
                    width:52, height:52, borderRadius:12,
                    background: p.logoBg,
                    border:`1px solid ${p.color}30`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    padding:5,
                    boxShadow:`0 2px 12px ${p.color}20`,
                    flexShrink:0,
                  }}>
                    {p.logoUrl ? <img
                      src={p.logoUrl}
                      alt={p.acronym}
                      style={{ width:40, height:40, objectFit:"contain", display:"block" }}
                      onError={e => {
                        // Fallback to acronym text if image fails to load
                        e.currentTarget.style.display = "none";
                        e.currentTarget.parentNode.innerHTML = `<span style="font-size:11px;font-weight:800;color:${p.color};font-family:'Syne',sans-serif">${p.acronym}</span>`;
                      }}
                    /> : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={p.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label={p.acronym}>
                      <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M3 10l9-6.5L21 10"/></svg>}
                  </div>
                  <div style={{ background:p.color+"18", border:`0.5px solid ${p.color}40`, borderRadius:8, padding:"4px 10px" }}>
                    <span style={{ fontSize:12, fontWeight:800, color:p.color, fontFamily:"'Syne',sans-serif", letterSpacing:"0.04em" }}>{p.acronym}</span>
                  </div>
                </div>

                {/* Name */}
                <div style={{ fontSize:13, fontWeight:700, color:"#fff", lineHeight:1.35, marginBottom:6 }}>{p.full}</div>

                {/* Role badge */}
                <div style={{ display:"inline-block", background:p.color+"14", borderRadius:20, padding:"3px 10px", marginBottom:8 }}>
                  <span style={{ fontSize:10, fontWeight:600, color:p.color }}>{p.role}</span>
                </div>

                {/* Dept */}
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>{p.dept}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom compliance strip */}
          <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"1.25rem 2rem", display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"center", gap:"2rem" }}>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase" }}>Compliant With</span>
            {[
              { label:"PSA-CBMS Schema", color:"#d97706" },
              { label:"RA 10173 · Data Privacy Act", color:"#7e3af2" },
              { label:"DICT Standards", color:"#1a56db" },
              { label:"DILG LGU Guidelines", color:"#e02424" },
              { label:"PhilGIS Framework", color:"#0e9f6e" },
            ].map(c=>(
              <div key={c.label} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:c.color }}/>
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.55)", fontWeight:500 }}>{c.label}</span>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: "6.5rem 2rem", background: "linear-gradient(130deg, #071027, #0f2460 50%, #1a56db)", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <Contours opacity={0.1} />
        <div style={{ maxWidth: 640, margin: "0 auto", position: "relative" }}>
          <Eyebrow dark center>Authorized personnel</Eyebrow>
          <h2 className="lp-h2" style={{ color: "#fff", margin: "0 0 1rem" }}>Ready to open your municipality's map?</h2>
          <p style={{ color: "rgba(255,255,255,0.68)", marginBottom: "2.5rem", fontSize: "1.05rem", lineHeight: 1.75 }}>Sign in with the account your LGU administrator gave you to access household data, vulnerability maps and planning tools.</p>
          <button onClick={() => openLogin()} style={{ background: "#fff", color: "#1a56db", border: "none", borderRadius: 12, padding: "15px 40px", fontSize: 16, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 8px 30px rgba(0,0,0,0.2)", fontFamily: "inherit" }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,0.25)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.2)"; }}>
            Sign In to LGU-SDSS →
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: "#060d1c", padding: "2.5rem 2rem", textAlign: "center" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 }}>
            <img src={systemLogo} alt="LGU-SDSS" style={{ width: 30, height: 30, borderRadius: 7, objectFit: "contain" }} />
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 15, fontFamily: "'Syne', sans-serif" }}>LGU-SDSS</span>
          </div>
          <p style={{ color: "#334155", fontSize: 13, margin: "0 0 4px" }}>Spatial Decision Support System for Local Government Units · Piloted in San Miguel, Iloilo</p>
          <p style={{ color: "#1e293b", fontSize: 12, margin: 0 }}>© 2026 Bustamante · Artillero · Anes · Danilla · All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}