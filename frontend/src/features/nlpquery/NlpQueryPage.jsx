/* eslint-disable react-hooks/exhaustive-deps */
/*
 * NLP-to-DB query page -- Sir Shem's second suggestion
 * (NLP_TO_DB_INTEGRATION_SKILL.md). A constrained, single-question-in /
 * single-answer-out query box over the isolated analytical database --
 * NOT a free chat feature. Every answer is grounded in an actual SQL
 * query the person can inspect (expandable "Show query" section), run
 * against a read-only, PII-free, barangay-level database, with a
 * deterministic chart/table render and a narrow, non-inventive
 * explanation of only the rows actually returned.
 *
 * Styling follows the same visual language as Dashboard.jsx / MapView.jsx
 * (radial page gradient, card shadow + hairline border, colored left-bar
 * section headers, #5b8dee accent) so this page doesn't look bolted on.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { askNlpQuery, getNlpQueryExamples, getNlpAccuracyItems, runNlpAccuracyItem } from "../../api/api";
import { useTheme } from "../../hooks/useTheme";

// ── Icons (inline, stroke = currentColor via prop) ─────────────────────
const IconAsk = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);
const IconSearch = ({ size = 15, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconAlert = ({ size = 14, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IconSparkle = ({ size = 14, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
);
const IconChevron = ({ size = 11, color, open }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const IconHistory = ({ size = 13, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

// ── Small three-dot "thinking" indicator ────────────────────────────────
function ThinkingDots({ color }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: "50%", background: color,
          animation: `nlpDotPulse 1.1s ${i * 0.15}s infinite ease-in-out`,
        }} />
      ))}
      <style>{`@keyframes nlpDotPulse { 0%,80%,100%{opacity:.25; transform:scale(0.85)} 40%{opacity:1; transform:scale(1)} }`}</style>
    </span>
  );
}

// Domain identity colours (same family the Planning / Reports pages use)
const DOMAIN_COLOR = { svi: "#7c3aed", capacity: "#ea580c", hazard: "#0891b2", typology: "#64748b", priority: "#dc2626", household: "#0f766e" };
const SOURCE_BADGE = {
  library:   { label: "Ready-made answer", tone: "accent" },
  household: { label: "Household records · not sent to AI", tone: "teal" },
  gemini:    { label: "AI-planned query", tone: "warn" },
};

export default function NlpQueryPage({ intent } = {}) {
  const { dark } = useTheme();
  const inputRef = useRef(null);

  const D = {
    pageBg: dark
      ? "radial-gradient(ellipse at 20% 0%, #0d1b35 0%, #0a1020 45%, #080b14 100%)"
      : "radial-gradient(ellipse at 20% 0%, #dce8ff 0%, #eaf0ff 45%, #f5f6fa 100%)",
    cardBg: dark
      ? "linear-gradient(145deg, #141c2e 0%, #111520 100%)"
      : "#ffffff",
    cardBorder:  dark ? "#1a2540" : "#e8eaf0",
    shadow: dark
      ? "0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(91,141,238,0.06)"
      : "0 2px 10px rgba(20,30,60,0.06)",
    textPrimary: dark ? "#eef3ff" : "#1a2233",
    textBody:    dark ? "#b7c1dc" : "#3a4150",
    textMuted:   dark ? "#7686ad" : "#7a8296",
    inputBg:     dark ? "#0c1120" : "#f7f9fd",
    inputBorder: dark ? "#1e2d4a" : "#dde3f5",
    accent:      "#5b8dee",
    accentDeep:  dark ? "#8fb4ff" : "#1565c0",
    accentSoft:  dark ? "rgba(91,141,238,0.12)" : "rgba(91,141,238,0.08)",
    accentBorder:dark ? "rgba(91,141,238,0.28)" : "rgba(91,141,238,0.22)",
    warnBg:      dark ? "rgba(245,124,0,0.12)" : "#fff4e5",
    warnBorder:  dark ? "rgba(245,124,0,0.3)" : "#ffd9a8",
    warnText:    dark ? "#ffb74d" : "#a85400",
    rowEven:     dark ? "#121a2c" : "#ffffff",
    rowOdd:      dark ? "#0f1526" : "#fafbfd",
    chartGrid:   dark ? "#1a2235" : "#eef1f8",
    tooltipBg:   dark ? "#151e30" : "#ffffff",
    codeBg:      dark ? "#0a0e1a" : "#f3f5fb",
    codeText:    dark ? "#9db4e0" : "#3d4a6b",
  };

  const [examples, setExamples] = useState([]);
  const [groups, setGroups]     = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [showSql, setShowSql]   = useState(false);
  const [history, setHistory]   = useState([]); // most-recent-first, this session only
  const [focused, setFocused]   = useState(false);
  // Suggestions: one topic at a time; folded away once an answer is showing.
  const [topic, setTopic]       = useState(null);
  const [showSuggest, setShowSuggest] = useState(true);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [showCheck, setShowCheck] = useState(false);

  const allQuestions = groups.length ? groups.flatMap((g) => g.questions.map((q) => ({ q, key: g.key }))) : examples.map((q) => ({ q, key: null }));
  // As-you-type: ready-made questions containing every typed word.
  const words = question.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const matches = words.length && focused && !loading
    ? allQuestions.filter(({ q }) => words.every((w) => q.toLowerCase().includes(w)) && q.toLowerCase() !== question.trim().toLowerCase()).slice(0, 6)
    : [];
  const activeGroup = groups.find((g) => g.key === topic) || groups[0];

  useEffect(() => {
    getNlpQueryExamples()
      .then((r) => {
        setExamples(r.data?.examples || []);
        setGroups(r.data?.groups || []);
      })
      .catch(() => { setExamples([]); setGroups([]); });
  }, []);

  const runQuestion = useCallback((q) => {
    const text = (q ?? question).trim();
    if (!text || loading) return;
    setLoading(true);
    setShowSql(false);
    askNlpQuery(text)
      .then((r) => {
        setResult(r.data);
        setShowSuggest(false);
        setHistory((h) => [r.data, ...h.filter((p) => p.question !== r.data.question)].slice(0, 8));
        setLoading(false);
      })
      .catch((e) => {
        setResult({
          question: text,
          warnings: [e.response?.data?.error || e.message || "Request failed."],
          columns: [], data: [], chart: { type: "table" }, explanation: null, sql: null,
        });
        setLoading(false);
      });
  }, [question, loading]);

  const handleChipClick = (q) => {
    setQuestion(q);
    setActiveMatch(-1);
    runQuestion(q);
  };

  // Omni Search "Ask the Data" row: put the typed question in the box and run it.
  useEffect(() => {
    if (intent?.question) { setQuestion(intent.question); runQuestion(intent.question); }
  }, [intent?.ts]);

  return (
    <div style={{ padding: "24px 24px 0", minHeight: "100%", background: D.pageBg, display: "flex", flexDirection: "column" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", flex: 1 }}>

        {/* ── Header ───────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            background: "linear-gradient(135deg, #5b8dee 0%, #1a237e 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 3px 10px rgba(91,141,238,0.35)",
          }}>
            <IconAsk size={17} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: D.textPrimary, margin: 0 }}>
            Ask the Data
          </h1>
        </div>
        <p style={{ fontSize: 13, color: D.textMuted, margin: "0 0 16px", lineHeight: 1.55, maxWidth: 680 }}>
          Ask about vulnerability (SVI), capacity, hazard exposure, household profiles or individual households.
          Every answer runs a read-only query you can inspect, and the three domains are never combined into one score.
        </p>

        {/* ── Question card ───────────────────────────────────── */}
        <div style={{
          background: D.cardBg, border: `1px solid ${D.cardBorder}`, borderRadius: 14,
          padding: 16, marginBottom: 18, boxShadow: D.shadow,
        }}>
          <div style={{ position: "relative" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: D.inputBg,
            border: `1.5px solid ${focused ? D.accent : D.inputBorder}`,
            borderRadius: 10, padding: "4px 6px 4px 12px",
            transition: "border-color 0.15s",
            boxShadow: focused ? `0 0 0 3px ${D.accentSoft}` : "none",
          }}>
            <IconSearch color={D.textMuted} />
            <input
              ref={inputRef}
              value={question}
              onChange={(e) => { setQuestion(e.target.value); setActiveMatch(-1); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); setActiveMatch((i) => Math.min(i + 1, matches.length - 1)); }
                else if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); setActiveMatch((i) => Math.max(i - 1, -1)); }
                else if (e.key === "Escape") { setActiveMatch(-1); inputRef.current?.blur(); }
                else if (e.key === "Enter") {
                  if (activeMatch >= 0 && matches[activeMatch]) handleChipClick(matches[activeMatch].q);
                  else runQuestion();
                }
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => { setFocused(false); setActiveMatch(-1); }, 120)}
              aria-label="Your question"
              aria-autocomplete="list"
              aria-expanded={matches.length > 0}
              placeholder="e.g. Which 5 barangays have the highest SVI score?"
              style={{
                flex: 1, padding: "9px 0", border: "none", background: "transparent",
                color: D.textPrimary, fontSize: 13.5, outline: "none",
              }}
            />
            <button
              onClick={() => runQuestion()}
              disabled={loading || !question.trim()}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: loading || !question.trim()
                  ? D.accentSoft
                  : "linear-gradient(135deg, #5b8dee 0%, #3f6fd6 100%)",
                color: loading || !question.trim() ? D.textMuted : "#fff",
                fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                cursor: loading || !question.trim() ? "default" : "pointer",
                boxShadow: loading || !question.trim() ? "none" : "0 2px 8px rgba(91,141,238,0.4)",
                transition: "all 0.15s",
              }}
            >
              {loading ? <><ThinkingDots color={D.textMuted} /> Thinking</> : "Ask"}
            </button>
          </div>
          {matches.length > 0 && (
            <div role="listbox" style={{
              position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 20,
              background: dark ? "#141c2e" : "#ffffff", border: `1px solid ${D.cardBorder}`, borderRadius: 10,
              boxShadow: dark ? "0 10px 30px rgba(0,0,0,0.6)" : "0 10px 30px rgba(20,30,60,0.14)", overflow: "hidden",
            }}>
              <div style={{ padding: "7px 12px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: D.textMuted }}>
                Ready-made questions · instant, work offline
              </div>
              {matches.map((m, i) => (
                <button key={m.q} role="option" aria-selected={i === activeMatch}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => handleChipClick(m.q)} onMouseEnter={() => setActiveMatch(i)}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "8px 12px", border: "none",
                    background: i === activeMatch ? D.accentSoft : "transparent", color: D.textPrimary, fontSize: 13, cursor: "pointer" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: DOMAIN_COLOR[m.key] || D.accent }} />
                  {m.q}
                </button>
              ))}
              <div style={{ padding: "6px 12px 8px", fontSize: 11, color: D.textMuted, borderTop: `1px solid ${D.cardBorder}` }}>
                Press Enter to ask your own words instead (uses the AI, needs internet).
              </div>
            </div>
          )}
          </div>

          {/* Suggestions: topic tabs, one topic's questions at a time. Folded
              to a single link once an answer is on screen, so the answer
              sits right under the question box. */}
          {(groups.length > 0 || examples.length > 0) && (showSuggest ? (
            <div style={{ marginTop: 12 }}>
              {groups.length > 0 && (
                <div role="tablist" aria-label="Question topics" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                  {groups.map((g) => {
                    const on = g.key === activeGroup?.key;
                    return (
                      <button key={g.key} role="tab" aria-selected={on} onClick={() => setTopic(g.key)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 8, fontSize: 12, fontWeight: on ? 700 : 500, cursor: "pointer",
                          border: `1px solid ${on ? (DOMAIN_COLOR[g.key] || D.accent) : "transparent"}`,
                          background: on ? D.accentSoft : "transparent", color: on ? D.textPrimary : D.textMuted }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: DOMAIN_COLOR[g.key] || D.accent }} />
                        {g.title.replace(/ \(.*\)$/, "")}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(activeGroup ? activeGroup.questions : examples).map((ex) => (
                  <ExampleChip key={ex} text={ex} loading={loading} D={D} onClick={() => handleChipClick(ex)} />
                ))}
              </div>
              {result && (
                <button onClick={() => setShowSuggest(false)} style={{ marginTop: 8, background: "none", border: "none", padding: 0, color: D.accentDeep, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Hide suggestions
                </button>
              )}
            </div>
          ) : (
            <button onClick={() => setShowSuggest(true)} style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 10, background: "none", border: "none", padding: 0, color: D.accentDeep, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <IconChevron color={D.accentDeep} open={false} /> Suggested questions ({allQuestions.length})
            </button>
          ))}
        </div>

        {/* ── Recent questions (session-only) ─────────────────── */}
        {history.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: D.textMuted, fontWeight: 600 }}>
              <IconHistory color={D.textMuted} /> Recent:
            </span>
            {history.slice(1, 6).map((h, i) => (
              <button
                key={i}
                onClick={() => { setQuestion(h.question); setResult(h); setShowSql(false); }}
                disabled={loading}
                style={{
                  fontSize: 11, padding: "3px 10px", borderRadius: 12,
                  border: `1px solid ${D.cardBorder}`, background: "transparent",
                  color: D.textBody, cursor: loading ? "default" : "pointer",
                }}
              >
                {h.question.length > 42 ? h.question.slice(0, 40) + "…" : h.question}
              </button>
            ))}
          </div>
        )}

        {/* ── Result ───────────────────────────────────────────── */}
        {loading && !result && <ResultSkeleton D={D} />}

        {result && (
          <div style={{
            background: D.cardBg, border: `1px solid ${D.cardBorder}`, borderRadius: 14,
            padding: 18, boxShadow: D.shadow, opacity: loading ? 0.55 : 1, transition: "opacity 0.15s",
          }}>
            <div style={{ fontSize: 11.5, color: D.textMuted, marginBottom: 5, fontStyle: "italic" }}>
              “{result.question}”
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: D.textPrimary }}>
                {result.title || "Result"}
              </div>
              {result.source && SOURCE_BADGE[result.source] && (() => {
                const b = SOURCE_BADGE[result.source];
                const c = b.tone === "warn"
                  ? { bg: D.warnBg, fg: D.warnText, bd: D.warnBorder }
                  : b.tone === "teal"
                    ? { bg: dark ? "rgba(15,118,110,0.18)" : "#e6f6f4", fg: dark ? "#5eead4" : "#0f766e", bd: dark ? "rgba(94,234,212,0.3)" : "#99d8cf" }
                    : { bg: D.accentSoft, fg: D.accentDeep, bd: D.accentBorder };
                return (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase",
                    padding: "2px 8px", borderRadius: 10, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`,
                  }}>
                    {b.label}
                  </span>
                );
              })()}
            </div>

            {(result.warnings || []).map((w, i) => (
              <div key={i} style={{
                display: "flex", gap: 9, alignItems: "flex-start",
                background: D.warnBg, border: `1px solid ${D.warnBorder}`, color: D.warnText,
                borderRadius: 9, padding: "10px 13px", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5,
              }}>
                <span style={{ marginTop: 1, flexShrink: 0 }}><IconAlert color={D.warnText} /></span>
                <span style={{ flex: 1 }}>{w}</span>
                {/gemini api key|quota|api key/i.test(w) && (
                  <button onClick={() => window.dispatchEvent(new CustomEvent("lgu:open-settings", { detail: "gemini" }))}
                    style={{ flexShrink: 0, padding: "5px 11px", borderRadius: 7, border: `1px solid ${D.warnBorder}`,
                      background: "transparent", color: D.warnText, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Change Gemini key
                  </button>
                )}
              </div>
            ))}

            {result.data && result.data.length > 0 && (
              <>
                {result.chart?.type === "bar" && (
                  <div style={{
                    background: dark ? "rgba(255,255,255,0.02)" : "#fbfcfe",
                    border: `1px solid ${D.cardBorder}`, borderRadius: 10,
                    padding: "14px 10px 4px", marginBottom: 16,
                  }}>
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <BarChart data={result.data} margin={{ top: 4, right: 12, left: 0, bottom: 44 }} barCategoryGap="28%">
                          <CartesianGrid strokeDasharray="3 3" stroke={D.chartGrid} vertical={false} />
                          <XAxis
                            dataKey={result.chart.x}
                            tick={{ fontSize: 10.5, fill: D.textMuted }}
                            angle={-32} textAnchor="end" interval={0} height={64}
                            axisLine={{ stroke: D.chartGrid }} tickLine={false}
                          />
                          <YAxis tick={{ fontSize: 10.5, fill: D.textMuted }} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            cursor={{ fill: D.accentSoft }}
                            contentStyle={{
                              background: D.tooltipBg, border: `1px solid ${D.cardBorder}`,
                              borderRadius: 8, fontSize: 12, boxShadow: D.shadow,
                            }}
                            labelStyle={{ color: D.textPrimary, fontWeight: 600, marginBottom: 2 }}
                            itemStyle={{ color: D.accentDeep }}
                          />
                          <Bar dataKey={result.chart.y} radius={[5, 5, 0, 0]} maxBarSize={52}>
                            {result.data.map((_, i) => (
                              <Cell key={i} fill={D.accent} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                <div style={{
                  border: `1px solid ${D.cardBorder}`, borderRadius: 10, overflow: "hidden", marginBottom: 14,
                }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ background: dark ? "rgba(91,141,238,0.08)" : "#f0f4ff" }}>
                          {result.columns.map((c) => (
                            <th key={c} title={result.column_labels?.[c] || undefined} style={{
                              textAlign: "left", padding: "9px 12px", color: D.textMuted,
                              fontWeight: 700, fontSize: 10.5, letterSpacing: 0.3, textTransform: "uppercase",
                              borderBottom: `1px solid ${D.cardBorder}`, whiteSpace: "nowrap",
                            }}>
                              {c.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? D.rowEven : D.rowOdd }}>
                            {result.columns.map((c) => (
                              <td key={c} style={{
                                padding: "8px 12px", color: D.textBody,
                                borderBottom: i === result.data.length - 1 ? "none" : `1px solid ${D.cardBorder}`,
                              }}>
                                {typeof row[c] === "number" ? row[c].toLocaleString() : String(row[c] ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {(result.suggestions || []).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: D.textMuted, marginBottom: 7 }}>
                  Try one of these instead
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {result.suggestions.map((ex) => (
                    <ExampleChip key={ex} text={ex} loading={loading} D={D} onClick={() => handleChipClick(ex)} />
                  ))}
                </div>
              </div>
            )}

            {(result.sections || []).map((sec) => (
              <div key={sec.domain} style={{ marginBottom: 14 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
                  borderLeft: `4px solid ${DOMAIN_COLOR[sec.domain] || D.accent}`, paddingLeft: 9,
                }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: D.textPrimary }}>{sec.title}</span>
                </div>
                {sec.data.length === 0 ? (
                  <div style={{ fontSize: 12, color: D.textMuted, paddingLeft: 13 }}>No data for this domain.</div>
                ) : (
                  <div style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ background: dark ? "rgba(91,141,238,0.08)" : "#f0f4ff" }}>
                            {sec.columns.map((c) => (
                              <th key={c} style={{
                                textAlign: "left", padding: "8px 12px", color: D.textMuted, fontWeight: 700,
                                fontSize: 10.5, letterSpacing: 0.3, textTransform: "uppercase",
                                borderBottom: `1px solid ${D.cardBorder}`, whiteSpace: "nowrap",
                              }}>{c.replace(/_/g, " ")}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sec.data.map((row, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? D.rowEven : D.rowOdd }}>
                              {sec.columns.map((c) => (
                                <td key={c} style={{ padding: "8px 12px", color: D.textBody }}>
                                  {typeof row[c] === "number" ? row[c].toLocaleString() : String(row[c] ?? "—")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {result.explanation && (
              <div style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                background: D.accentSoft, border: `1px solid ${D.accentBorder}`,
                borderRadius: 10, padding: "12px 14px", marginBottom: 14,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 7, flexShrink: 0, marginTop: 1,
                  background: "linear-gradient(135deg, #5b8dee 0%, #1a237e 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <IconSparkle size={13} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: D.accentDeep, marginBottom: 3 }}>
                    {result.source === "gemini" ? "AI Summary" : "Summary"}
                  </div>
                  <div style={{ fontSize: 13, color: D.textBody, lineHeight: 1.55 }}>
                    {result.explanation}
                  </div>
                </div>
              </div>
            )}

            {result.sql && (
              <div>
                <button
                  onClick={() => setShowSql((s) => !s)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "none", border: "none", color: D.accentDeep,
                    fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 0,
                  }}
                >
                  <IconChevron color={D.accentDeep} open={showSql} />
                  {showSql ? "Hide query" : "Show query"}
                </button>
                {showSql && (
                  <pre style={{
                    background: D.codeBg, color: D.codeText, borderRadius: 8,
                    padding: 12, fontSize: 11.5, marginTop: 8, overflowX: "auto",
                    border: `1px solid ${D.cardBorder}`, lineHeight: 1.6,
                    fontFamily: "'SF Mono', Monaco, Consolas, monospace",
                  }}>
                    {result.sql}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {!result && !loading && (
          <div style={{
            textAlign: "center", padding: "48px 20px", color: D.textMuted,
            border: `1.5px dashed ${D.cardBorder}`, borderRadius: 14,
          }}>
            <div style={{ marginBottom: 8, opacity: 0.6 }}>
              <IconAsk size={26} color={D.textMuted} />
            </div>
            <div style={{ fontSize: 13 }}>Ask a question above or pick one of the examples to get started.</div>
          </div>
        )}
      </div>

      {showCheck && <AccuracyCheck D={D} dark={dark} onClose={() => setShowCheck(false)} />}

      {/* Standing notice, always visible at the bottom of the page. */}
      <div role="note" style={{
        position: "sticky", bottom: 0, marginTop: 20, marginLeft: -24, marginRight: -24, padding: "10px 24px",
        background: dark ? "rgba(10,14,26,0.94)" : "rgba(255,255,255,0.94)", borderTop: `1px solid ${D.cardBorder}`,
        backdropFilter: "blur(6px)",
      }}>
        <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12, color: D.textBody, lineHeight: 1.5 }}>
          <span style={{ marginTop: 2, flexShrink: 0 }}><IconAlert color={D.warnText} /></span>
          <span>
            <strong style={{ color: D.textPrimary }}>AI can be wrong sometimes.</strong> Check the numbers and the query (Show query) before using an answer.
            {" "}Free-typed questions use the AI assistant and <strong style={{ color: D.textPrimary }}>need an internet connection</strong>;
            {" "}ready-made questions answer instantly and work offline. Household records are never sent to the AI.
            {" "}<button onClick={() => setShowCheck((v) => !v)} style={{
              border: "none", background: "none", padding: 0, color: D.accentDeep, fontWeight: 700,
              fontSize: 12, cursor: "pointer", textDecoration: "underline",
            }}>{showCheck ? "Hide accuracy check" : "Check accuracy"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Accuracy check ──────────────────────────────────────────────────────
// Asks questions whose correct answer is known (a hand-written reference
// query) through the real pipeline and compares the barangays / number that
// come back. Ready-made ones run offline; AI ones need internet and use the
// Gemini quota, so they are opt-in and paced to the free tier's limit.
function AccuracyCheck({ D, dark, onClose }) {
  const [items, setItems] = useState([]);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [withAi, setWithAi] = useState(false);
  const [openIdx, setOpenIdx] = useState(null);
  const stopRef = useRef(false);

  useEffect(() => {
    getNlpAccuracyItems().then((r) => setItems(r.data?.items || [])).catch(() => setItems([]));
    return () => { stopRef.current = true; };
  }, []);

  const chosen = items.filter((it) => withAi || it.path === "library");
  const done = chosen.filter((it) => results[it.index]);
  const scored = done.filter((it) => !results[it.index].skipped);
  const passed = scored.filter((it) => results[it.index].passed);
  const byPath = (p) => {
    const s = scored.filter((it) => it.path === p);
    return { n: s.length, ok: s.filter((it) => results[it.index].passed).length };
  };

  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    setResults({});
    for (const it of chosen) {
      if (stopRef.current) break;
      try {
        const r = await runNlpAccuracyItem(it.index);
        setResults((prev) => ({ ...prev, [it.index]: r.data }));
      } catch (e) {
        setResults((prev) => ({ ...prev, [it.index]: { passed: false, skipped: true, reason: e.message } }));
      }
      if (it.path === "ai") await new Promise((res) => setTimeout(res, 4000)); // free-tier pace
    }
    setRunning(false);
  };

  const pct = scored.length ? Math.round((passed.length / scored.length) * 100) : null;
  const lib = byPath("library"), ai = byPath("ai");
  const okC = dark ? "#4ade80" : "#166534", badC = dark ? "#f87171" : "#b91c1c";

  return (
    <div style={{ maxWidth: 880, margin: "18px auto 0", width: "100%", background: D.cardBg, border: `1px solid ${D.cardBorder}`,
      borderRadius: 14, padding: 16, boxShadow: D.shadow }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: D.textPrimary, flex: 1 }}>Accuracy check</div>
        <label style={{ fontSize: 12, color: D.textBody, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={withAi} disabled={running} onChange={(e) => setWithAi(e.target.checked)} />
          Include free-typed (AI) questions
        </label>
        <button onClick={running ? () => { stopRef.current = true; } : run} disabled={!items.length} style={{
          padding: "7px 14px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
          background: running ? D.warnBg : "#1565c0", color: running ? D.warnText : "#fff",
        }}>{running ? "Stop" : done.length ? "Run again" : "Run check"}</button>
        <button onClick={onClose} aria-label="Close accuracy check" style={{ border: "none", background: "none", color: D.textMuted, cursor: "pointer", fontSize: 16 }}>×</button>
      </div>
      <p style={{ fontSize: 12, color: D.textMuted, margin: "6px 0 12px", lineHeight: 1.5 }}>
        Each question has a reference answer written by hand. The check asks it the normal way and compares the barangays (or the number)
        that come back. {withAi ? `AI questions need internet and use about ${chosen.filter((i) => i.path === "ai").length * 3} AI requests of the daily quota; they run about 5 seconds apart.` : "Ready-made questions run offline in a few seconds."}
      </p>

      {pct !== null && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {[["Overall", passed.length, scored.length], ["Ready-made", lib.ok, lib.n], ...(withAi ? [["Free-typed (AI)", ai.ok, ai.n]] : [])].map(([lbl, ok, n]) => (
            <div key={lbl} style={{ flex: "1 1 140px", padding: "10px 12px", borderRadius: 10, background: D.inputBg, border: `1px solid ${D.inputBorder}` }}>
              <div style={{ fontSize: 11, color: D.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{lbl}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: D.textPrimary }}>{n ? `${ok}/${n}` : "—"}
                <span style={{ fontSize: 12, fontWeight: 600, color: D.textMuted, marginLeft: 6 }}>{n ? `${Math.round((ok / n) * 100)}%` : ""}</span></div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 340, overflowY: "auto" }}>
        {chosen.map((it) => {
          const r = results[it.index];
          const mark = !r ? (running ? "…" : "·") : r.skipped ? "–" : r.passed ? "✓" : "✗";
          const color = !r || r.skipped ? D.textMuted : r.passed ? okC : badC;
          return (
            <div key={it.index}>
              <button onClick={() => setOpenIdx(openIdx === it.index ? null : it.index)} style={{
                width: "100%", textAlign: "left", display: "flex", gap: 8, alignItems: "baseline", padding: "6px 8px",
                border: "none", borderRadius: 6, background: openIdx === it.index ? D.accentSoft : "transparent", cursor: "pointer",
              }}>
                <span style={{ width: 14, fontWeight: 800, color }}>{mark}</span>
                <span style={{ flex: 1, fontSize: 12.5, color: D.textBody }}>{it.question}</span>
                <span style={{ fontSize: 10.5, color: D.textMuted, whiteSpace: "nowrap" }}>{it.path === "ai" ? "AI" : "Ready-made"}</span>
              </button>
              {openIdx === it.index && r && (
                <div style={{ margin: "2px 0 6px 30px", fontSize: 11.5, color: D.textMuted, lineHeight: 1.5 }}>
                  <div><strong style={{ color }}>{r.skipped ? "Not scored" : r.passed ? "Correct" : "Wrong"}</strong> — {r.reason}{r.answered_by ? ` · answered by ${r.answered_by === "gemini" ? "AI planner" : r.answered_by}` : ""}{r.seconds != null ? ` · ${r.seconds}s` : ""}</div>
                  {r.sql && <code style={{ display: "block", marginTop: 4, padding: 8, borderRadius: 6, background: D.codeBg, color: D.codeText, whiteSpace: "pre-wrap", fontSize: 11 }}>{r.sql}</code>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Example question chip, with its own hover state ────────────────────
function ExampleChip({ text, loading, D, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "6px 12px", borderRadius: 16, fontSize: 11.5,
        border: `1px solid ${hover ? D.accentBorder : D.inputBorder}`,
        background: hover ? D.accentSoft : D.inputBg,
        color: hover ? D.accentDeep : D.textBody,
        cursor: loading ? "default" : "pointer",
        transition: "all 0.12s",
      }}
    >
      {text}
    </button>
  );
}

// ── Loading skeleton shown while the first result is still in flight ──
function ResultSkeleton({ D }) {
  const shimmer = {
    background: `linear-gradient(90deg, ${D.inputBg} 25%, ${D.accentSoft} 50%, ${D.inputBg} 75%)`,
    backgroundSize: "200% 100%", animation: "nlpShimmer 1.4s infinite",
    borderRadius: 6,
  };
  return (
    <div style={{
      background: D.cardBg, border: `1px solid ${D.cardBorder}`, borderRadius: 14,
      padding: 18, boxShadow: D.shadow,
    }}>
      <style>{`@keyframes nlpShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      <div style={{ ...shimmer, width: "35%", height: 12, marginBottom: 10 }} />
      <div style={{ ...shimmer, width: "55%", height: 18, marginBottom: 18 }} />
      <div style={{ ...shimmer, width: "100%", height: 200, marginBottom: 16 }} />
      <div style={{ ...shimmer, width: "100%", height: 14, marginBottom: 8 }} />
      <div style={{ ...shimmer, width: "90%", height: 14, marginBottom: 8 }} />
      <div style={{ ...shimmer, width: "70%", height: 14 }} />
    </div>
  );
}
