// WCAG 2.1 AA contrast audit for the Family Network Analysis page.
//
//   node frontend/scripts/check-network-contrast.mjs
//
// Reads every color from src/features/network/networkPalette.js, measures
// each foreground/background pair the page actually draws (light theme,
// dark theme, and the exported PNG/PDF), and writes
//   docs/accessibility/network-contrast.md   (table for the defense)
//   docs/accessibility/network-contrast.csv
// Semi-transparent colors are blended over the surface they sit on before
// measuring, the same way the browser paints them. Exits with code 1 if any
// pair fails, so it can guard future palette changes.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK_PALETTE } from "../src/features/network/networkPalette.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../docs/accessibility");

// ── color math (WCAG 2.1 relative luminance) ────────────────────────────
function parse(c) {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(",").map((s) => parseFloat(s));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  throw new Error(`Cannot parse color ${c}`);
}
// Paint a stack of layers bottom -> top (first item must be opaque).
function blend(...layers) {
  let out = parse(layers[0]);
  for (const l of layers.slice(1)) {
    const c = parse(l);
    out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a), a: 1 };
  }
  return out;
}
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const tint = (color, alphaHex) => color + alphaHex;   // "#b91c1c" + "22" = 13% tint, as the page writes it

const NEED = { text: 4.5, large: 3, ui: 3 };
const KIND_LABEL = { text: "Text", large: "Large text", ui: "UI / graphic" };

const rows = [];
function pair(theme, area, element, fg, bgLayers, kind = "text") {
  const f = blend(...(Array.isArray(fg) ? fg : [bgLayers[0], fg]));
  const b = blend(...bgLayers);
  const r = ratio(f, b);
  rows.push({ theme, area, element, kind, fg: hex(f), bg: hex(b), ratio: r, need: NEED[kind], pass: r >= NEED[kind] - 1e-9 });
}

for (const theme of ["light", "dark"]) {
  const P = NETWORK_PALETTE[theme];
  const T = theme === "light" ? "Light" : "Dark";
  const card = [P.cardBg], stat = [P.cardBg, P.statBg], side = [P.sidebarBg], graph = [P.graphBg], page = [P.pageBg];

  // Page text
  pair(T, "Page", "Title / primary text on card", P.textPrimary, card);
  pair(T, "Page", "Primary text on page background", P.textPrimary, page);
  pair(T, "Page", "Secondary text on card", P.textSecondary, card);
  pair(T, "Page", "Muted text (captions, KPI labels) on card", P.textMuted, card);
  pair(T, "Page", "Muted text on KPI tile", P.textMuted, stat);
  pair(T, "Page", "Muted text on page background", P.textMuted, page);
  pair(T, "Page", "Legend text on legend bar", P.textMuted, side);
  pair(T, "Page", "Brand link / selected ID", P.brand, card);
  pair(T, "Page", "Brand text on selected list row", P.brand, [P.cardBg, P.brandSoft]);
  pair(T, "Page", "Error message on error box", P.danger, [P.cardBg, P.dangerBg]);
  pair(T, "Page", "Secondary text on error box", P.textSecondary, [P.cardBg, P.dangerBg]);
  pair(T, "Page", "Success message", P.success, card);
  pair(T, "Page", "Search input text", P.textPrimary, [P.inputBg]);
  pair(T, "Page", "Button text (secondary)", P.textSecondary, stat);
  pair(T, "Page", "Button text (primary)", P.brand, [P.cardBg, P.brandSoft]);

  // KPI numbers (22px bold = large text, still held to 4.5 here)
  pair(T, "KPI cards", "Total households", P.brand, stat);
  pair(T, "KPI cards", "Multi-family", P.warning, stat);
  pair(T, "KPI cards", "With a senior or PWD", P.purple, stat);
  pair(T, "KPI cards", "PWD count (highlight)", P.danger, stat);

  // Graph nodes
  for (const g of ["adult", "minor", "senior", "unknown"]) {
    const fill = theme === "light" ? P.nodeBg : P.nodeFill[g];
    pair(T, "Graph nodes", `${g} name text on node`, P.person[g], [fill]);
    pair(T, "Graph nodes", `Age / tag line on ${g} node`, P.textSecondary, [fill]);
    pair(T, "Graph nodes", `"Head" tag on ${g} node`, P.person[g], [fill, tint(P.person[g], "22")]);
    pair(T, "Graph nodes", `${g} outline vs graph background`, P.person[g], graph, "ui");
  }
  pair(T, "Graph nodes", "PWD outer outline vs graph background", P.person.pwd, graph, "ui");
  pair(T, "Graph nodes", "Household label", P.textPrimary, [P.graphBg, theme === "light" ? "#ffffff" : "rgba(15,20,35,0.9)"]);

  // Relationship lines and labels
  for (const [rel, c] of Object.entries(P.rel)) {
    pair(T, "Relationships", `${rel} label`, c, [P.graphBg, P.labelBg]);
    pair(T, "Relationships", `${rel} line vs graph background`, c, graph, "ui");
    pair(T, "Relationships", `${rel} legend line vs legend bar`, c, side, "ui");
    pair(T, "Relationships", `${rel} chip in household list`, c, [P.cardBg, tint(c, "18")]);
  }

  // Family panels / captions
  pair(T, "Families", "Head's family caption", P.headFamilyAccent, [P.graphBg, theme === "light" ? "rgba(21,101,192,0.035)" : "rgba(91,141,238,0.05)"]);
  pair(T, "Families", "Other family caption (tree view)", P.otherFamilyAccent, [P.graphBg, theme === "light" ? "rgba(245,158,11,0.045)" : "rgba(245,158,11,0.05)"]);
  pair(T, "Families", "Other family caption (radial view)", P.otherFamilyAccent, [P.graphBg, theme === "light" ? "rgba(245,158,11,0.10)" : "rgba(245,158,11,0.12)"]);

  // Hazard badges and domain cards
  for (const [k, c] of Object.entries(P.hazard)) pair(T, "Hazard badge", `${k}`, c, [P.cardBg, tint(c, "22")]);
  for (const [name, c] of [["Typology", P.purple], ["Not assigned", P.neutral], ["Distance: beyond both", P.danger],
    ["Distance: beyond one", P.warning], ["Distance: within 2 km", P.success], ["Hazard: high", P.hazard.high], ["Hazard: none", P.hazard.none]]) {
    pair(T, "Domain cards", `${name} badge`, c, [P.cardBg, tint(c, "0c"), tint(c, "18")]);
  }
  pair(T, "Cluster match", "Match % text", P.purple, card);
  pair(T, "Cluster match", "Match ring vs track", P.purple, [P.cardBg, P.track], "ui");

  // Controls
  pair(T, "Controls", "Input / select border vs field", P.inputBorder, [P.inputBg], "ui");
  pair(T, "Controls", "Input / select border vs card", P.inputBorder, card, "ui");
  pair(T, "Controls", "Keyboard focus outline vs card", P.focus, card, "ui");
  pair(T, "Controls", "Keyboard focus outline vs graph", P.focus, graph, "ui");
}

// Exported PNG / PDF (always drawn in the light print theme on white)
{
  const P = NETWORK_PALETTE.light;
  for (const g of ["adult", "minor", "senior"]) pair("Export", "PNG / PDF graph", `${g} name and outline`, P.person[g], ["#f8faff"]);
  pair("Export", "PNG / PDF graph", "Age / tag line", P.textSecondary, ["#f8faff"]);
  for (const [rel, c] of Object.entries(P.rel)) pair("Export", "PNG / PDF graph", `${rel} label`, c, ["#ffffff"]);
  pair("Export", "PNG / PDF graph", "Other family caption", P.otherFamilyAccent, ["#ffffff", "rgba(245,158,11,0.10)"]);
  for (const [name, c] of [["Danger", P.danger], ["Success", P.success], ["Warning", P.warning], ["Purple", P.purple], ["Brand", P.brand], ["Info", "#0369a1"]])
    pair("Export", "PDF report text", name, c, ["#ffffff"]);
}

const NOTES = "## Color is not the only signal (SC 1.4.1)\n\n- Every person circle says its group in words under the name: \"34 \u00b7 Adult\", \"13 \u00b7 Minor\", \"67 \u00b7 Senior\".\n- A PWD member has a second (double) purple outline and the word \"PWD\".\n- Every relationship line carries its name (\"Son\", \"Spouse\", \"Brother/Sister\"), so the line color is a helper, not the only cue.\n- Hazard badges, distance badges and the typology badge all state their value in text.\n\n## Other checks\n\n- Keyboard focus: every button, field, filter and graph node shows a 2.5 px outline in the focus color (3:1 or better against the card and the graph).\n- Color-vision simulation: `screens/network-deuteranopia.png`, `screens/network-protanopia.png` and `screens/network-grayscale.png` show the same household; the groups are still readable from the words and the double outline.\n- Dark theme: `screens/network-dark.png`. Export (PNG/PDF): `screens/network-export.png`, which always uses the light print palette.\n\n## How to re-check\n\nChange colors only in `frontend/src/features/network/networkPalette.js`, then run:\n\n    node frontend/scripts/check-network-contrast.mjs\n\nIt rewrites this table and stops with an error if any pair falls below its WCAG 2.1 AA ratio.\n";

// ── write the table ─────────────────────────────────────────────────────
const failed = rows.filter((r) => !r.pass);
mkdirSync(OUT, { recursive: true });
const csv = ["theme,area,element,kind,foreground,background,ratio,required,result"]
  .concat(rows.map((r) => [r.theme, r.area, `"${r.element}"`, KIND_LABEL[r.kind], r.fg, r.bg, r.ratio.toFixed(2), r.need, r.pass ? "PASS" : "FAIL"].join(",")));
writeFileSync(resolve(OUT, "network-contrast.csv"), csv.join("\n") + "\n");

const md = [
  "# Family Network Analysis: WCAG 2.1 AA color contrast",
  "",
  `Generated by \`frontend/scripts/check-network-contrast.mjs\` from \`networkPalette.js\`, on ${new Date().toISOString().slice(0, 10)}.`,
  "",
  "Targets: 4.5:1 for normal text, 3:1 for large text, 3:1 for UI components and graphics (SC 1.4.3, 1.4.11).",
  "Semi-transparent colors are blended over the surface beneath them before measuring.",
  "",
  `**Result: ${rows.length - failed.length} of ${rows.length} pairs pass${failed.length ? `, ${failed.length} fail` : ""}.**`,
  "",
  "| Theme | Area | Element | Type | Foreground | Background | Ratio | Needs | Result |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.theme} | ${r.area} | ${r.element} | ${KIND_LABEL[r.kind]} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)}:1 | ${r.need}:1 | ${r.pass ? "Pass" : "**FAIL**"} |`),
  "",
  NOTES,
].join("\n");
writeFileSync(resolve(OUT, "network-contrast.md"), md);

console.log(`${rows.length - failed.length}/${rows.length} pairs pass`);
failed.forEach((r) => console.log(`FAIL ${r.theme} | ${r.area} | ${r.element}: ${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)} (needs ${r.need})`));
process.exit(failed.length ? 1 : 0);
