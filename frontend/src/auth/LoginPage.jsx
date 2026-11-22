import { useState } from "react";
import lguIcon from "../assets/logo.png";

export default function LoginPage({ onLogin }) {
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [attempts,  setAttempts]  = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAttempts(a => a + 1);
        setError(data.error || "Login failed.");
        setLoading(false);
        return;
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user",  JSON.stringify(data.user));
      onLogin(data.user, data.token);

    } catch {
      setError("Cannot connect to server. Make sure backend is running.");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", width: "100vw",
      background: "linear-gradient(135deg, #1a237e 0%, #1565c0 50%, #0288d1 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', sans-serif",
    }}>

      {/* Background pattern */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.05,
        backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
        backgroundSize: "30px 30px",
      }} />

      <div style={{
        background: "#fff", borderRadius: 16,
        padding: "40px 36px", width: 380, maxWidth: "90vw",
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        position: "relative", zIndex: 1,
      }}>

        {/* Logo / Title */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ margin: "0 auto 14px", width: 72, height: 72 }}>
            <img
              src={lguIcon}
              alt="LGU-SDSS"
              style={{
                width: 72, height: 72,
                borderRadius: 16,
                objectFit: "contain",
                boxShadow: "0 4px 16px rgba(21,101,192,0.4)",
              }}
            />
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1a237e" }}>
            LGU-SDSS
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#888" }}>
           
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            background: "#fff3f3", border: "1px solid #ffcdd2",
            borderRadius: 8, padding: "10px 14px", marginBottom: 20,
            fontSize: 13, color: "#c62828",
            display: "flex", alignItems: "flex-start", gap: 8,
          }}>
            {/* Warning SVG */}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
              viewBox="0 0 24 24" fill="none" stroke="#c62828"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>

          {/* Username */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "#555", marginBottom: 6,
            }}>USERNAME</label>
            <div style={{ position: "relative" }}>

              {/* ✅ SVG user icon */}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                viewBox="0 0 24 24" fill="none" stroke="#aaa"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  position: "absolute", left: 12, top: "50%",
                  transform: "translateY(-50%)", pointerEvents: "none",
                }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>

              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                required
                style={{
                  width: "100%", padding: "11px 12px 11px 38px",
                  border: "1.5px solid #e0e0e0", borderRadius: 8,
                  fontSize: 14, outline: "none", boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = "#1565c0"}
                onBlur={e  => e.target.style.borderColor = "#e0e0e0"}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "#555", marginBottom: 6,
            }}>PASSWORD</label>
            <div style={{ position: "relative" }}>

              {/* ✅ SVG lock icon */}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                viewBox="0 0 24 24" fill="none" stroke="#aaa"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  position: "absolute", left: 12, top: "50%",
                  transform: "translateY(-50%)", pointerEvents: "none",
                }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>

              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                style={{
                  width: "100%", padding: "11px 44px 11px 38px",
                  border: "1.5px solid #e0e0e0", borderRadius: 8,
                  fontSize: 14, outline: "none", boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = "#1565c0"}
                onBlur={e  => e.target.style.borderColor = "#e0e0e0"}
              />

              {/* ✅ SVG eye toggle */}
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                tabIndex={-1}
                aria-label={showPw ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 12, top: "50%",
                  transform: "translateY(-50%)",
                  background: "none", border: "none",
                  cursor: "pointer", padding: 4,
                  color: "#9ca3af",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 4, transition: "color 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.color = "#1565c0"}
                onMouseLeave={e => e.currentTarget.style.color = "#9ca3af"}
              >
                {showPw ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "12px",
              background: loading
                ? "#90caf9"
                : "linear-gradient(135deg, #1a237e, #1565c0)",
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 15, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: loading ? "none" : "0 4px 14px rgba(21,101,192,0.4)",
              transition: "all 0.2s",
              display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8,
            }}
          >
            {loading ? (
              <>
                {/* Spinner */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  style={{ animation: "spin 0.8s linear infinite" }}>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                Signing in...
              </>
            ) : "Sign In"}
          </button>
        </form>

        {/* Footer */}
        <div style={{
          marginTop: 24, textAlign: "center",
          fontSize: 11, color: "#bbb",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        }}>
          {/* Lock SVG */}
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11"
            viewBox="0 0 24 24" fill="none" stroke="#bbb"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Secure Admin Portal · Unauthorized access is prohibited
        </div>

        {/* Failed attempts warning */}
        {attempts >= 3 && (
          <div style={{
            marginTop: 12, textAlign: "center",
            fontSize: 11, color: "#e65100",
          }}>
            ⚠️ Account will be locked after {5 - attempts} more failed attempt(s)
          </div>
        )}
      </div>
    </div>
  );
}