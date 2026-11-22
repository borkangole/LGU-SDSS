/* eslint-disable react-hooks/exhaustive-deps */
// Omni Search -- one search for the whole system, reachable from every page
// (the sidebar field, or Ctrl+K / "/" anywhere). It finds:
//   - barangays, households and residents   (server: /api/search)
//   - pages, features and quick actions     (local list below)
//   - data attributes / indicators          (local, from /population/attributes)
// and always offers "Ask the Data" with what was typed as the last row.
// Picking a result calls onNavigate(intent); App.jsx switches to the page and
// the page applies the intent (open a barangay, fly the map to a household,
// open a report tab, ...). Nothing here computes or changes any score.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { globalSearch, getAttributes } from "../api/api";

/* ── Icons (stroke, 24px grid) ─────────────────────────────────────── */
const P = {
  search: <><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/></>,
  barangay: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></>,
  household: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/></>,
  member: <><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></>,
  page: <><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9h16"/></>,
  action: <><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></>,
  attr: <><line x1="9" y1="6.5" x2="20" y2="6.5"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17.5" x2="20" y2="17.5"/><circle cx="4.8" cy="6.5" r="1"/><circle cx="4.8" cy="12" r="1"/><circle cx="4.8" cy="17.5" r="1"/></>,
  ask: <><path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/></>,
  enter: <><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></>,
};
const Icon = ({ name, size = 16, color = "currentColor", sw = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
);

/* ── What can be found without the server ─────────────────────────── */
const PAGES = [
  { tab: "dashboard",     title: "Dashboard",        sub: "Overview of all 24 barangays", kw: "home overview kpi summary population pyramid" },
  { tab: "households",    title: "Households",       sub: "Household and resident records", kw: "records list members residents edit delete" },
  { tab: "map",           title: "Map View",         sub: "Hazard, SVI, capacity and typology maps", kw: "gis flood landslide dots location" },
  { tab: "vulnerability", title: "Vulnerability",    sub: "How each score is calculated", kw: "svi score computation indicators breakdown" },
  { tab: "attributes",    title: "Data Attributes",  sub: "Every attribute and its value per barangay", kw: "dictionary indicators variables data" },
  { tab: "network",       title: "Network",          sub: "Families inside each household", kw: "family tree relationships kinship nuclear" },
  { tab: "planning",      title: "Planning",         sub: "Priority and recommendations per barangay", kw: "priority recommendation insights drrm" },
  { tab: "reports",       title: "Reports & Export", sub: "PDF, Excel and CSV reports", kw: "export print pdf excel csv download" },
  { tab: "nlp-query",     title: "Ask the Data",     sub: "Ask a question in plain language", kw: "nlp question ai gemini query" },
  { tab: "about",         title: "About the system", sub: "Model, modules and objectives", kw: "about help information" },
];
const ACTIONS = [
  { title: "Import CBMS files",          sub: "Households", intent: { tab: "households", action: "import" }, kw: "upload csv xlsx census load" },
  { title: "Add a household",            sub: "Households", intent: { tab: "households", action: "add" },    kw: "new create manual entry" },
  { title: "Hazard Watch List",          sub: "Map View · households in flood zones", intent: { tab: "map", mode: "hazard", watchlist: true }, kw: "flood evacuation drrm list priority" },
  { title: "Hazard map",                 sub: "Map View", intent: { tab: "map", mode: "hazard" },   kw: "flood landslide exposure" },
  { title: "SVI map",                    sub: "Map View", intent: { tab: "map", mode: "svi" },      kw: "social vulnerability choropleth" },
  { title: "Barangay Capacity map",      sub: "Map View", intent: { tab: "map", mode: "capacity" }, kw: "capacity resources" },
  { title: "Household typology map",     sub: "Map View", intent: { tab: "map", mode: "typology" }, kw: "k-modes cluster types profile" },
  { title: "Custom Report",              sub: "Reports · count or list people per barangay", intent: { tab: "reports", report: "custom" }, kw: "pwd senior solo parent names list count export" },
  { title: "Barangay Vulnerability report", sub: "Reports", intent: { tab: "reports", report: "barangay" }, kw: "svi report" },
  { title: "High-Risk Households report",   sub: "Reports", intent: { tab: "reports", report: "highrisk" }, kw: "hazard flood landslide list" },
  { title: "Population Profile report",     sub: "Reports", intent: { tab: "reports", report: "population" }, kw: "pwd senior solo parent 4ps" },
  { title: "Planning Recommendations report", sub: "Reports", intent: { tab: "reports", report: "planning" }, kw: "priority" },
  { title: "Vulnerability Heat Map report", sub: "Reports", intent: { tab: "reports", report: "heatmap" }, kw: "maps" },
  { title: "Overall Report",             sub: "Reports", intent: { tab: "reports", report: "overall" }, kw: "complete full summary" },
  { title: "Change password",            sub: "Account Settings", intent: { action: "account", accountTab: "security" }, kw: "security password" },
  { title: "Account Settings",           sub: "Profile and preferences", intent: { action: "account", accountTab: "profile" }, kw: "profile user preferences" },
  { title: "Gemini API key",             sub: "Account Settings · change the AI key", intent: { action: "account", accountTab: "gemini" }, kw: "gemini api key ai quota limit credits ask the data" },
  { title: "Switch light / dark mode",   sub: "Appearance", intent: { action: "theme" }, kw: "theme dark light night appearance" },
];

const BARANGAY_ACTIONS = [
  { label: "Vulnerability", intent: (r) => ({ tab: "vulnerability", barangay: r.title }) },
  { label: "Map",           intent: (r) => ({ tab: "map", focus: r }) },
  { label: "Planning",      intent: (r) => ({ tab: "planning", barangay: r.title }) },
];
const HOUSEHOLD_ACTIONS = [
  { label: "Record", intent: (r) => ({ tab: "households", household: r.household_number || r.title }) },
  { label: "Map",    intent: (r) => ({ tab: "map", focus: r }) },
];

const SECTION_ORDER = ["barangay", "household", "member", "action", "page", "attr", "ask"];
const SECTION_LABEL = {
  barangay: "Barangays", household: "Households", member: "Residents",
  page: "Pages", action: "Features", attr: "Data attributes", ask: "Ask the Data",
};

/* ── Matching ───────────────────────────────────────────────────────── */
const esc = (w) => w.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
const fold = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function score(q, title, extra) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const t = fold(title), all = `${t} ${fold(extra)}`;
  if (!words.every((w) => all.includes(w))) return 0;
  let s = 1;
  if (t.startsWith(words[0])) s += 3;
  if (words.every((w) => new RegExp("(^|\\s|[(/&-])" + esc(w)).test(t))) s += 2;
  if (words.every((w) => t.includes(w))) s += 1;
  return s;
}
function Highlight({ text, q, color }) {
  const words = fold(q).split(/\s+/).filter((w) => w.length > 0);
  if (!words.length || !text) return text || null;
  const f = fold(text);
  const marks = new Array(text.length).fill(false);
  words.forEach((w) => { let i = f.indexOf(w); while (i >= 0) { for (let k = i; k < i + w.length; k++) marks[k] = true; i = f.indexOf(w, i + w.length); } });
  const out = []; let i = 0;
  while (i < text.length) {
    let j = i; while (j < text.length && marks[j] === marks[i]) j++;
    const part = text.slice(i, j);
    out.push(marks[i] ? <span key={i} style={{ color, fontWeight: 700 }}>{part}</span> : <span key={i}>{part}</span>);
    i = j;
  }
  return out;
}

/* ── Theme tokens ───────────────────────────────────────────────────── */
function tokens(dark) {
  return dark ? {
    panel: "#0f1629", border: "rgba(148,163,184,0.16)", divider: "rgba(148,163,184,0.10)",
    text: "#e6ecf8", sub: "#8a97b4", faint: "#5d6a88", accent: "#7aa2ff",
    rowActive: "rgba(122,162,255,0.12)", tile: "#18223d", tileActive: "#22305a",
    chip: "rgba(148,163,184,0.10)", chipActive: "#3b6fe0", kbd: "rgba(148,163,184,0.14)",
    backdrop: "rgba(3,6,16,0.62)", shadow: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(148,163,184,0.10)",
  } : {
    panel: "#ffffff", border: "#e3e8f2", divider: "#eef1f6",
    text: "#111a33", sub: "#64708a", faint: "#9aa3b8", accent: "#1d4ed8",
    rowActive: "#eef3ff", tile: "#f3f5fa", tileActive: "#dfe8ff",
    chip: "#f1f4f9", chipActive: "#1d4ed8", kbd: "#f1f4f9",
    backdrop: "rgba(15,23,42,0.38)", shadow: "0 24px 64px rgba(15,23,42,0.22), 0 0 0 1px rgba(15,23,42,0.06)",
  };
}
const TYPE_TINT = { barangay: "#0ea5e9", household: "#16a34a", member: "#7c3aed", page: "#475569", action: "#d97706", attr: "#db2777", ask: "#0891b2" };

const Kbd = ({ children, T }) => (
  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18,
    padding: "0 5px", borderRadius: 4, background: T.kbd, color: T.sub, fontSize: 10.5, fontWeight: 600,
    fontFamily: "inherit", lineHeight: 1 }}>{children}</span>
);

/* ── Sidebar trigger ────────────────────────────────────────────────── */
export function OmniSearchTrigger({ onOpen }) {
  const [hover, setHover] = useState(false);
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || "");
  return (
    <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      aria-label="Search the system (Ctrl+K)"
      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", height: 38, padding: "0 10px 0 12px",
        borderRadius: 8, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
        background: hover ? "rgba(91,141,238,0.14)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${hover ? "rgba(122,162,255,0.42)" : "rgba(91,141,238,0.22)"}`,
        color: "rgba(214,224,245,0.72)", transition: "background .15s, border-color .15s" }}>
      <Icon name="search" size={15} />
      <span style={{ flex: 1, fontSize: 13 }}>Search…</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(214,224,245,0.55)", padding: "2px 6px",
        borderRadius: 4, border: "1px solid rgba(214,224,245,0.18)" }}>{mac ? "⌘K" : "Ctrl K"}</span>
    </button>
  );
}

/* ── Palette ────────────────────────────────────────────────────────── */
export default function OmniSearch({ open, onClose, onNavigate, dark, allowedTabs }) {
  const T = tokens(dark);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [attrs, setAttrs] = useState(null);
  const [active, setActive] = useState(0);
  const [actionIdx, setActionIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const seq = useRef(0);

  // Reset each time it opens; load the attribute list once.
  useEffect(() => {
    if (!open) return;
    setQ(""); setRemote([]); setActive(0); setActionIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!attrs) getAttributes().then((r) => setAttrs(r.data?.attributes || [])).catch(() => setAttrs([]));
  }, [open]);

  // Server search (barangays, households, residents), debounced.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setRemote([]); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      globalSearch(term)
        .then((r) => { if (my === seq.current) setRemote(r.data?.data || []); })
        .catch(() => { if (my === seq.current) setRemote([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const can = (tab) => !tab || !allowedTabs || tab === "about" || allowedTabs.includes(tab);

  const items = useMemo(() => {
    const term = q.trim();
    const out = [];
    if (!term) {
      ACTIONS.filter((a) => ["import", "add"].includes(a.intent.action) || a.intent.watchlist || a.intent.report === "custom")
        .filter((a) => can(a.intent.tab))
        .forEach((a) => out.push({ kind: "action", title: a.title, subtitle: a.sub, intent: a.intent }));
      PAGES.filter((p) => can(p.tab) && p.tab !== "about")
        .forEach((p) => out.push({ kind: "page", title: p.title, subtitle: p.sub, intent: { tab: p.tab } }));
      return out;
    }
    remote.forEach((r) => {
      if (r.type === "barangay" && (can("vulnerability") || can("map") || can("planning")))
        out.push({ kind: "barangay", title: r.title, subtitle: r.subtitle, raw: r,
          actions: BARANGAY_ACTIONS.filter((a) => can(a.intent(r).tab)) });
      else if ((r.type === "household" || r.type === "member") && (can("households") || can("map")))
        out.push({ kind: r.type, title: r.title, subtitle: r.subtitle, raw: r,
          actions: HOUSEHOLD_ACTIONS.filter((a) => can(a.intent(r).tab)) });
    });
    const local = [];
    ACTIONS.forEach((a) => { const s = score(term, a.title, `${a.sub} ${a.kw}`); if (s && can(a.intent.tab)) local.push({ s, kind: "action", title: a.title, subtitle: a.sub, intent: a.intent }); });
    PAGES.forEach((p) => { const s = score(term, p.title, `${p.sub} ${p.kw}`); if (s && can(p.tab)) local.push({ s, kind: "page", title: p.title, subtitle: p.sub, intent: { tab: p.tab } }); });
    local.sort((a, b) => b.s - a.s);
    out.push(...local.filter((x) => x.kind === "action").slice(0, 5), ...local.filter((x) => x.kind === "page").slice(0, 4));
    if (attrs && can("attributes")) {
      attrs.map((a) => ({ a, s: score(term, a.label, `${a.group} ${a.used_in || ""} ${a.key}`) }))
        .filter((x) => x.s).sort((x, y) => y.s - x.s).slice(0, 5)
        .forEach(({ a }) => out.push({ kind: "attr", title: a.label, subtitle: [a.group, a.used_in].filter(Boolean).join(" · "),
          intent: { tab: "attributes", attr: a.key } }));
    }
    if (term.length >= 3 && can("nlp-query"))
      out.push({ kind: "ask", title: `“${term}”`, subtitle: "Ask this question in plain language", intent: { tab: "nlp-query", question: term } });
    return out.sort((a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind));
  }, [q, remote, attrs, allowedTabs]);

  useEffect(() => { setActive(0); setActionIdx(0); }, [q, remote.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item, aIdx = 0) => {
    if (!item) return;
    const intent = item.actions ? item.actions[Math.min(aIdx, item.actions.length - 1)].intent(item.raw) : item.intent;
    onClose();
    onNavigate(intent);
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); setActionIdx(0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); setActionIdx(0); }
    else if (e.key === "Tab" || ((e.key === "ArrowRight" || e.key === "ArrowLeft") && items[active]?.actions && (q === "" || e.currentTarget.selectionStart === q.length))) {
      const acts = items[active]?.actions;
      if (!acts) { if (e.key === "Tab") e.preventDefault(); return; }
      e.preventDefault();
      const dir = e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
      setActionIdx((i) => (i + dir + acts.length) % acts.length);
    }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[active], actionIdx); }
  };

  if (!open) return null;

  let lastKind = null;
  const term = q.trim();
  const showEmpty = term.length >= 2 && !loading && items.filter((i) => i.kind !== "ask").length === 0;

  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: T.backdrop, backdropFilter: "blur(2px)",
        display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "11vh",
        animation: "omniFade .12s ease-out", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <style>{`
        @keyframes omniFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes omniRise { from { opacity: 0; transform: translateY(-6px) scale(.985) } to { opacity: 1; transform: none } }
        @keyframes omniSpin { to { transform: rotate(360deg) } }
        .omni-list::-webkit-scrollbar { width: 8px } .omni-list::-webkit-scrollbar-thumb { background: ${T.divider}; border-radius: 8px }
      `}</style>
      <div role="dialog" aria-modal="true" aria-label="Search"
        style={{ width: "min(680px, calc(100vw - 32px))", background: T.panel, borderRadius: 12, boxShadow: T.shadow,
          overflow: "hidden", animation: "omniRise .16s ease-out", display: "flex", flexDirection: "column", maxHeight: "74vh" }}>

        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: 56, borderBottom: `1px solid ${T.divider}` }}>
          {loading
            ? <span style={{ width: 17, height: 17, borderRadius: "50%", border: `2px solid ${T.divider}`, borderTopColor: T.accent, animation: "omniSpin .7s linear infinite", flexShrink: 0 }} />
            : <Icon name="search" size={18} color={T.sub} />}
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search barangays, households, residents, pages, reports…"
            aria-label="Search" spellCheck={false} autoComplete="off"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: T.text,
              fontSize: 15.5, fontFamily: "inherit", height: "100%" }} />
          {q && (
            <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear"
              style={{ border: "none", background: "transparent", color: T.faint, cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 4 }}>
              Clear
            </button>
          )}
          <Kbd T={T}>Esc</Kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="omni-list" style={{ overflowY: "auto", padding: "6px 0 8px" }}>
          {!term && (
            <div style={{ padding: "8px 18px 2px", fontSize: 12, color: T.sub }}>
              Type a barangay, household number, resident's name, page, report or indicator.
            </div>
          )}
          {term.length === 1 && (
            <div style={{ padding: "8px 18px 2px", fontSize: 12, color: T.sub }}>Keep typing…</div>
          )}
          {showEmpty && (
            <div style={{ padding: "14px 18px 2px", fontSize: 12.5, color: T.sub }}>
              No barangay, household, resident or page matches “{term}”.
            </div>
          )}
          {items.map((it, idx) => {
            const head = it.kind !== lastKind
              ? (!term && it.kind === "action" ? "Quick actions" : !term && it.kind === "page" ? "Go to" : SECTION_LABEL[it.kind])
              : null;
            lastKind = it.kind;
            const on = idx === active;
            const tint = TYPE_TINT[it.kind];
            return (
              <div key={`${it.kind}-${it.raw?.id || it.raw?.person_id || it.title}-${idx}`}>
                {head && (
                  <div style={{ padding: "12px 18px 5px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em",
                    textTransform: "uppercase", color: T.faint }}>{head}</div>
                )}
                <div data-idx={idx} role="option" aria-selected={on}
                  onMouseMove={() => { if (active !== idx) { setActive(idx); setActionIdx(0); } }}
                  onClick={() => choose(it, on ? actionIdx : 0)}
                  style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 8px", padding: "8px 10px",
                    borderRadius: 8, cursor: "pointer", background: on ? T.rowActive : "transparent" }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", background: on ? T.tileActive : T.tile, color: tint }}>
                    <Icon name={it.kind === "ask" ? "ask" : it.kind} size={16} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: T.text,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {it.kind === "ask" ? it.title : <Highlight text={it.title} q={term} color={T.accent} />}
                    </span>
                    {it.subtitle && (
                      <span style={{ display: "block", fontSize: 11.5, color: T.sub, marginTop: 1,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.subtitle}</span>
                    )}
                  </span>
                  {it.actions && it.actions.length > 0 && (on ? (
                    <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {it.actions.map((a, ai) => (
                        <button key={a.label} type="button"
                          onClick={(e) => { e.stopPropagation(); choose(it, ai); }}
                          onMouseEnter={() => setActionIdx(ai)}
                          style={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600,
                            padding: "4px 9px", borderRadius: 6,
                            background: ai === actionIdx ? T.chipActive : T.chip,
                            color: ai === actionIdx ? "#fff" : T.sub }}>{a.label}</button>
                      ))}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: T.faint, flexShrink: 0 }}>{it.actions[0].label}</span>
                  ))}
                  {!it.actions && on && (
                    <span style={{ color: T.faint, flexShrink: 0, display: "flex" }}><Icon name="enter" size={14} /></span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 16px", height: 38,
          borderTop: `1px solid ${T.divider}`, fontSize: 11.5, color: T.sub, flexShrink: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Kbd T={T}>↑</Kbd><Kbd T={T}>↓</Kbd> Move</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Kbd T={T}>Tab</Kbd> Switch action</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Kbd T={T}>↵</Kbd> Open</span>
          <span style={{ marginLeft: "auto", color: T.faint }}>Ctrl K opens search from any page</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
