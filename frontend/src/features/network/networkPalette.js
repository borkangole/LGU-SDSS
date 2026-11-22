// Family Network Analysis -- the ONE file that controls this page's colors.
//
// WCAG 2.1 AA targets (evaluator item T-05):
//   - normal text             >= 4.5 : 1   (SC 1.4.3)
//   - large text (>=18.66px bold / 24px) >= 3 : 1
//   - UI components & graphics (node rings, relationship lines, input
//     borders, focus outline)  >= 3 : 1   (SC 1.4.11)
// Every pair is measured by frontend/scripts/check-network-contrast.mjs,
// which writes docs/accessibility/network-contrast.md (hex values, ratio,
// pass/fail). Run it after changing anything here:
//     node frontend/scripts/check-network-contrast.mjs
//
// Color is never the only signal (SC 1.4.1): every person node also says
// its age group in words ("Minor", "Senior", "PWD"), a PWD member has a
// double outline, and every relationship line carries its name.

export const NETWORK_PALETTE = {
  light: {
    // surfaces
    pageBg: "#f0f2f8",
    cardBg: "#ffffff",
    sidebarBg: "#f8faff",
    statBg: "#f8faff",
    graphBg: "#f4f7ff",
    inputBg: "#ffffff",
    nodeBg: "#f8faff",
    labelBg: "#ffffff",
    // text
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#5b6577",
    // lines / UI
    border: "rgba(0,0,0,0.08)",          // decorative card edge only
    inputBorder: "#8a94a6",              // form fields: 3:1 against the field and the card
    focus: "#1d4ed8",
    track: "#cbd5e1",
    // semantic
    brand: "#1565c0",
    brandSoft: "rgba(21,101,192,0.07)",
    danger: "#b91c1c",
    dangerBg: "#fff5f5",
    dangerBorder: "#f19c9c",
    success: "#166534",
    warning: "#92400e",
    purple: "#6d28d9",
    neutral: "#4b5563",
    // people (ring, name and tag text)
    person: { adult: "#1d4ed8", minor: "#065f46", senior: "#92400e", unknown: "#1d4ed8", pwd: "#6d28d9" },
    nodeFill: { adult: "#f8faff", minor: "#f8faff", senior: "#f8faff", unknown: "#f8faff" },
    // families
    headFamilyAccent: "#1565c0",
    otherFamilyAccent: "#92400e",
    // relationship lines and their labels
    rel: {
      "Spouse": "#be185d",
      "Son/Daughter": "#1d4ed8",
      "Son/Daughter-in-Law": "#166534",
      "Grandchildren": "#854d0e",
      "Brother/Sister": "#7e22ce",
      "Parents": "#b91c1c",
      "Sister/Brother-in-Law": "#0e7490",
      "Other Relatives": "#475569",
    },
    // hazard badge text (on a light tint of itself)
    hazard: { compound: "#7f1d1d", high: "#b91c1c", moderate: "#9a3412", low: "#854d0e", none: "#4b5563" },
  },
  dark: {
    pageBg: "#0b0e17",
    cardBg: "#111520",
    sidebarBg: "#0e1219",
    statBg: "rgba(255,255,255,0.03)",
    graphBg: "#0b0e17",
    inputBg: "#0b0e17",
    nodeBg: "#141b2b",
    labelBg: "#161b26",
    textPrimary: "#e8eaf0",
    textSecondary: "#a0aec0",
    textMuted: "#8a94ad",
    border: "rgba(255,255,255,0.07)",
    inputBorder: "#5f6b85",
    focus: "#7cb4ff",
    track: "rgba(255,255,255,0.14)",
    brand: "#4e9bff",
    brandSoft: "rgba(78,155,255,0.12)",
    danger: "#f87171",
    dangerBg: "rgba(239,68,68,0.08)",
    dangerBorder: "rgba(239,68,68,0.45)",
    success: "#4ade80",
    warning: "#fbbf24",
    purple: "#c4b5fd",
    neutral: "#9ca3af",
    person: { adult: "#7cb4ff", minor: "#34d399", senior: "#fbbf24", unknown: "#7cb4ff", pwd: "#c4b5fd" },
    nodeFill: { adult: "#0f1e2e", minor: "#102018", senior: "#2a2010", unknown: "#252e42" },
    headFamilyAccent: "#7aa2ff",
    otherFamilyAccent: "#fbbf24",
    rel: {
      "Spouse": "#f9a8d4",
      "Son/Daughter": "#93c5fd",
      "Son/Daughter-in-Law": "#86efac",
      "Grandchildren": "#fcd34d",
      "Brother/Sister": "#d8b4fe",
      "Parents": "#fca5a5",
      "Sister/Brother-in-Law": "#67e8f9",
      "Other Relatives": "#cbd5e1",
    },
    hazard: { compound: "#fda4af", high: "#f87171", moderate: "#fb923c", low: "#facc15", none: "#9ca3af" },
  },
};

export const paletteFor = (dark) => (dark ? NETWORK_PALETTE.dark : NETWORK_PALETTE.light);

// Age group in words -- shown on every node so the ring color is never the
// only way to tell a minor, adult or senior apart.
export function ageGroupOf(age) {
  const a = Number(age);
  if (age == null || age === "" || !Number.isFinite(a)) return null;
  if (a >= 60) return "senior";
  if (a <= 17) return "minor";
  return "adult";
}
export const AGE_GROUP_LABEL = { minor: "Minor", adult: "Adult", senior: "Senior" };

// "12 · Minor · PWD" -- the text line under a person's name.
export function personTagLine(age, isPwd) {
  const g = ageGroupOf(age);
  return [age ?? "—", g ? AGE_GROUP_LABEL[g] : null, isPwd ? "PWD" : null].filter(Boolean).join(" · ");
}
