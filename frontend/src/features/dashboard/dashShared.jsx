// Shared building blocks for the dashboard panels: one card shell, one
// header pattern and one segmented control, so every panel starts the same way.

// Shared card shell + header, so every panel on the page starts the same way.
export function DashCard({ D, children, style, className }) {
  return (
    <div className={className} style={{ background: D.cardBg, borderRadius: 12, border: `1px solid ${D.border}`,
      boxShadow: D.shadow, display: "flex", flexDirection: "column", minWidth: 0, ...style }}>
      {children}
    </div>
  );
}
export function DashCardHead({ D, title, sub, right, accent = "linear-gradient(180deg,#1565c0,#1a237e)" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
      flexWrap: "wrap", padding: "18px 20px 14px" }}>
      <div style={{ minWidth: 0, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ width: 3, height: 34, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: D.textPrimary, letterSpacing: -0.1 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: D.textMuted, marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>{right}</div>}
    </div>
  );
}
// Two-option segmented control (neutral; the active option lifts).
export function Segmented({ D, dark, value, onChange, options }) {
  return (
    <div role="tablist" style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 20,
      background: D.subBg, border: `1px solid ${D.border}` }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} role="tab" aria-selected={on} title={o.hint} onClick={() => onChange(o.id)}
            className="dash-seg"
            style={{ padding: "5px 12px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12,
              fontWeight: on ? 700 : 500, whiteSpace: "nowrap",
              background: on ? (dark ? "#2a4f9e" : "linear-gradient(135deg,#1565c0,#1a237e)") : "transparent",
              color: on ? "#ffffff" : D.textMuted,
              boxShadow: on ? "0 1px 4px rgba(21,101,192,0.35)" : "none",
              transition: "background .15s, color .15s" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

