import { useState, useEffect, useRef } from "react";
import { globalSearch } from "../api/api";

const TYPE_META = {
  barangay: { label: "Barangay", color: "#1565c0", icon: "pin"    },
  household: { label: "Household", color: "#2e7d32", icon: "house" },
  member:    { label: "Member",    color: "#6a1b9a", icon: "person"},
};

function TypeIcon({ type, color }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill={color}>
      {type === "pin" && (
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      )}
      {type === "house" && (
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
      )}
      {type === "person" && (
        <>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </>
      )}
    </svg>
  );
}

export default function SearchBar({ D, dark, onSelect }) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [active,  setActive]  = useState(-1);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  // Debounced search — fires 300ms after user stops typing
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await globalSearch(query.trim());
        setResults(res.data.data || []);
        setOpen(true);
        setActive(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleKey = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(a => Math.min(a + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    }
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
    if (e.key === "Enter" && active >= 0) {
      handleSelect(results[active]);
    }
  };

  const handleSelect = (item) => {
    setQuery(item.title);
    setOpen(false);
    onSelect?.(item);
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  // Group results by type
  const grouped = results.reduce((acc, r) => {
    (acc[r.type] = acc[r.type] || []).push(r);
    return acc;
  }, {});

  const totalCount = results.length;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: 280 }}>

      {/* ── Input ── */}
      <div style={{ position: "relative" }}>
        {/* Search / spinner icon */}
        <span style={{
          position: "absolute", left: 10, top: "50%",
          transform: "translateY(-50%)", pointerEvents: "none", zIndex: 1,
        }}>
          {loading ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
              stroke={D.textMuted} strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                <animateTransform attributeName="transform" type="rotate"
                  from="0 12 12" to="360 12 12" dur="0.75s" repeatCount="indefinite"/>
              </path>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
              viewBox="0 0 24 24" fill="none" stroke={D.textMuted}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          )}
        </span>

        <input
          ref={inputRef}
          placeholder="Search barangays, households, members..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => results.length > 0 && setOpen(true)}
          style={{
            width: "100%", padding: "8px 28px 8px 32px",
            background: D.inputBg,
            border: `1px solid ${open ? "#5b8dee" : D.inputBorder}`,
            borderRadius: 8, fontSize: 13, color: D.textBody,
            outline: "none", boxSizing: "border-box", transition: "border 0.15s, box-shadow 0.15s",
            boxShadow: open
              ? `0 0 0 3px ${dark ? "rgba(91,141,238,0.15)" : "rgba(21,101,192,0.1)"}`
              : "none",
          }}
        />

        {/* Clear button */}
        {query && (
          <button
            onClick={clearSearch}
            style={{
              position: "absolute", right: 8, top: "50%",
              transform: "translateY(-50%)", background: "none",
              border: "none", cursor: "pointer", color: D.textMuted,
              display: "flex", alignItems: "center", padding: 2,
              lineHeight: 1, borderRadius: 4,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.color = D.textBody}
            onMouseLeave={e => e.currentTarget.style.color = D.textMuted}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Dropdown ── */}
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          background: D.dropdownBg,
          border: `1px solid ${D.dropdownBorder}`,
          borderRadius: 10,
          boxShadow: dark
            ? "0 8px 32px rgba(0,0,0,0.6)"
            : "0 8px 24px rgba(0,0,0,0.12)",
          zIndex: 10000, overflow: "hidden",
          maxHeight: 380, overflowY: "auto",
          animation: "searchFadeDown 0.15s ease",
        }}>
          <style>{`
            @keyframes searchFadeDown {
              from { opacity: 0; transform: translateY(-6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {Object.entries(grouped).map(([type, items]) => {
            const meta = TYPE_META[type] || { label: type, color: "#888", icon: "person" };
            return (
              <div key={type}>
                {/* Group label */}
                <div style={{
                  padding: "7px 14px 5px",
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.9,
                  color: meta.color, textTransform: "uppercase",
                  background: dark ? meta.color + "11" : meta.color + "09",
                  borderBottom: `1px solid ${D.dropdownBorder}`,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <TypeIcon type={meta.icon} color={meta.color}/>
                  {meta.label}s
                  <span style={{
                    marginLeft: "auto",
                    background: meta.color + (dark ? "22" : "18"),
                    border: `1px solid ${meta.color}${dark ? "44" : "33"}`,
                    borderRadius: 8, padding: "1px 7px",
                    fontSize: 10, fontWeight: 700,
                  }}>
                    {items.length}
                  </span>
                </div>

                {items.map((item) => {
                  const globalIdx = results.indexOf(item);
                  const isActive  = active === globalIdx;
                  return (
                    <div
                      key={`${type}-${item.id}`}
                      onMouseEnter={() => setActive(globalIdx)}
                      onMouseLeave={() => setActive(-1)}
                      onClick={() => handleSelect(item)}
                      style={{
                        padding: "10px 14px",
                        display: "flex", alignItems: "center", gap: 10,
                        cursor: "pointer", transition: "background 0.1s",
                        background: isActive
                          ? (dark ? "#1a2540" : "#f0f4ff")
                          : "transparent",
                        borderBottom: `1px solid ${D.dropdownBorder}`,
                      }}
                    >
                      {/* Icon badge */}
                      <div style={{
                        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                        background: meta.color + (dark ? "22" : "18"),
                        border: `1px solid ${meta.color}${dark ? "44" : "33"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.1s",
                      }}>
                        <TypeIcon type={meta.icon} color={meta.color}/>
                      </div>

                      {/* Text */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 600,
                          color: isActive ? meta.color : D.textBody,
                          whiteSpace: "nowrap", overflow: "hidden",
                          textOverflow: "ellipsis",
                          transition: "color 0.1s",
                        }}>
                          {item.title}
                        </div>
                        <div style={{
                          fontSize: 11, color: D.textMuted, marginTop: 1,
                          whiteSpace: "nowrap", overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {item.subtitle}
                          {item.detail ? (
                            <span style={{ color: dark ? "#3d4560" : "#bbb" }}> · {item.detail}</span>
                          ) : null}
                        </div>
                      </div>

                      {/* Arrow */}
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
                        stroke={isActive ? meta.color : D.textMuted}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ flexShrink: 0, transition: "stroke 0.1s" }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Footer */}
          <div style={{
            padding: "8px 14px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            borderTop: `1px solid ${D.dropdownBorder}`,
          }}>
            <span style={{ fontSize: 11, color: D.textMuted }}>
              {totalCount} result{totalCount !== 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 11, color: D.textMuted }}>
              ↑↓ navigate · Enter select · Esc close
            </span>
          </div>
        </div>
      )}

      {/* ── No results state ── */}
      {open && query.trim().length >= 2 && results.length === 0 && !loading && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          background: D.dropdownBg,
          border: `1px solid ${D.dropdownBorder}`,
          borderRadius: 10, padding: "20px 14px", textAlign: "center",
          boxShadow: dark
            ? "0 8px 32px rgba(0,0,0,0.6)"
            : "0 8px 24px rgba(0,0,0,0.12)",
          zIndex: 10000,
          animation: "searchFadeDown 0.15s ease",
        }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>🔍</div>
          <div style={{ fontSize: 13, color: D.textBody, fontWeight: 600, marginBottom: 3 }}>
            No results found
          </div>
          <div style={{ fontSize: 11, color: D.textMuted }}>
            No matches for <strong>"{query}"</strong>
          </div>
        </div>
      )}
    </div>
  );
}