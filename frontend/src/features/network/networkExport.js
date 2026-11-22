// Export helpers for the Family Network Analysis page.
//
// The graph is re-drawn as a plain SVG straight from the SAME layout the
// page's ReactFlow canvas uses (buildRelationshipLayout's rfNodes/rfEdges),
// instead of screenshotting the live canvas: screenshots of ReactFlow depend
// on the current zoom/pan, dark mode and whatever is off-screen, while this
// is deterministic, always framed on the whole household, always light
// theme for print, and crisp at any size.
import * as XLSX from "xlsx";
import { familyEdgePoints } from "./familyTreeLayout";
import { NETWORK_PALETTE, personTagLine } from "./networkPalette";

// Exports always use the light print palette (WCAG 2.1 AA, see networkPalette.js).
const PL = NETWORK_PALETTE.light;
const isTrue = (v) => v === true || v === 1 || (typeof v === "string" && ["true", "1", "yes"].includes(v.trim().toLowerCase()));

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLOR_RE = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/;

function wrapWords(text, maxChars, maxLines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(1, maxChars - 1)) + "…";
    return kept;
  }
  return lines;
}

// layout: { rfNodes, rfEdges, familyClusters } from buildRelationshipLayout
// (built with dark=false). graphNodes: the raw /graph API nodes.
// Returns { svg, width, height } or null when there is nothing to draw.
export function buildFamilyGraphSVG(layout, graphNodes, { headNodeId } = {}) {
  const { rfNodes = [], rfEdges = [], familyClusters = [], panels = [] } = layout || {};
  const raw = new Map((graphNodes || []).map((n) => [n.id, n]));
  const geo = new Map();
  rfNodes.forEach((n) => {
    const p = raw.get(n.id);
    if (!p || p.kind !== "person") return;
    const size = Number(n.style?.width) || 92;
    const ring = (String(n.style?.border || "").match(COLOR_RE) || ["#1565c0"])[0];
    geo.set(n.id, {
      p, size, ring,
      cx: n.position.x + size / 2,
      cy: n.position.y + size / 2,
      r: size / 2,
      strokeW: parseFloat(n.style?.border) || 1.5,
      isHead: n.id === headNodeId,
    });
  });
  if (!geo.size) return null;

  const captionNodes = familyClusters.map((fc) => ({
    fc, node: rfNodes.find((n) => n.id === `__label_fam_${fc.familyId}__`),
  })).filter((c) => c.node);
  const hhNode = rfNodes.find((n) => n.id.startsWith("household:"));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x1, y1, x2, y2) => { minX = Math.min(minX, x1); minY = Math.min(minY, y1); maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2); };
  geo.forEach((g) => grow(g.cx - g.r, g.cy - g.r, g.cx + g.r, g.cy + g.r));
  panels.forEach((pn) => grow(pn.minX, pn.minY, pn.maxX, pn.maxY));
  captionNodes.forEach(({ node }) => grow(node.position.x, node.position.y, node.position.x + 170, node.position.y + 40));
  if (hhNode) grow(hhNode.position.x, hhNode.position.y, hhNode.position.x + 160, hhNode.position.y + 36);
  const PAD = 30;
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const W = Math.round(maxX - minX), H = Math.round(maxY - minY);
  const X = (x) => (x - minX).toFixed(1), Y = (y) => (y - minY).toFixed(1);

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  // Tree view: one panel per nuclear family, caption inside its top-left.
  panels.forEach((pn) => {
    const accent = pn.isHeadFamily ? PL.headFamilyAccent : PL.otherFamilyAccent;
    s += `<rect x="${X(pn.minX)}" y="${Y(pn.minY)}" width="${(pn.maxX - pn.minX).toFixed(1)}" height="${(pn.maxY - pn.minY).toFixed(1)}" rx="16" fill="${accent}" fill-opacity="0.04" stroke="${accent}" stroke-opacity="0.3" stroke-width="0.8"/>`;
    s += `<text x="${X(pn.minX + 14)}" y="${Y(pn.minY + 20)}" font-size="11" font-weight="700" fill="${accent}">${esc(pn.label)}${!pn.isHeadFamily && pn.rootName ? `<tspan font-weight="400" font-size="10" fill-opacity="0.8">  ${esc(pn.rootName)}</tspan>` : ""}</text>`;
  });

  // Edges: straight line between the two circles' boundaries, label at the
  // midpoint -- or, in the tree view, the same down/across lines as the page.
  const labels = [];
  rfEdges.forEach((e) => {
    if (e.type === "familyPanel") return; // panels are drawn above from layout.panels
    const a = geo.get(e.source), b = geo.get(e.target);
    if (!a || !b) return;
    if (e.type === "family") {
      const color = e.style?.stroke || "#607d8b";
      const pt = e.data?.partner ? geo.get(e.data.partner) : null;
      const c = (g) => (g ? { x: g.cx, y: g.cy, r: g.r } : null);
      const { points, label } = familyEdgePoints(e.data?.kind === "asc" ? "desc" : (e.data?.kind || "desc"), c(a), c(b), c(pt));
      s += `<polyline points="${points.map((q) => `${X(q.x)},${Y(q.y)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
      if (e.label) labels.push({ x: label.x, y: label.y, text: e.label, color });
      return;
    }
    const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy) || 1;
    const x1 = a.cx + (dx / d) * a.r, y1 = a.cy + (dy / d) * a.r;
    const x2 = b.cx - (dx / d) * b.r, y2 = b.cy - (dy / d) * b.r;
    const color = e.style?.stroke || "#607d8b";
    s += `<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="${color}" stroke-width="1.6"/>`;
    if (e.label) labels.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, text: e.label, color });
  });
  labels.forEach((l) => {
    const w = l.text.length * 5.4 + 10;
    s += `<rect x="${X(l.x - w / 2)}" y="${Y(l.y - 8)}" width="${w.toFixed(1)}" height="16" rx="4" fill="#ffffff" fill-opacity="0.95"/>`;
    s += `<text x="${X(l.x)}" y="${Y(l.y + 3.5)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${l.color}">${esc(l.text)}</text>`;
  });

  // Nodes
  geo.forEach((g) => {
    const { p, cx, cy, r, ring } = g;
    const pwd = isTrue(p.is_pwd);
    if (pwd) s += `<circle cx="${X(cx)}" cy="${Y(cy)}" r="${(r + 4).toFixed(1)}" fill="none" stroke="${PL.person.pwd}" stroke-width="2.5"/>`;
    s += `<circle cx="${X(cx)}" cy="${Y(cy)}" r="${r.toFixed(1)}" fill="${PL.nodeBg}" stroke="${ring}" stroke-width="${g.strokeW}"/>`;
    const fs = g.isHead ? 12 : 10;
    const lines = wrapWords(p.label, Math.max(6, Math.floor((g.size - 14) / (fs * 0.62))), 3);
    const extra = g.isHead ? 18 : 0;
    const blockH = lines.length * (fs + 2) + 13 + extra;
    let ty = cy - blockH / 2 + fs;
    lines.forEach((ln) => {
      s += `<text x="${X(cx)}" y="${Y(ty)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${ring}">${esc(ln)}</text>`;
      ty += fs + 2;
    });
    s += `<text x="${X(cx)}" y="${Y(ty + 1)}" text-anchor="middle" font-size="10" fill="${PL.textSecondary}">${esc(personTagLine(p.age, pwd))}</text>`;
    if (g.isHead) {
      const t = `${p.gender ? p.gender + " · " : ""}Head`;
      const w = t.length * 5.2 + 14;
      s += `<rect x="${X(cx - w / 2)}" y="${Y(ty + 6)}" width="${w.toFixed(1)}" height="15" rx="7.5" fill="${ring}" fill-opacity="0.13" stroke="${ring}" stroke-opacity="0.4" stroke-width="0.6"/>`;
      s += `<text x="${X(cx)}" y="${Y(ty + 16.5)}" text-anchor="middle" font-size="9" fill="${ring}">${esc(t)}</text>`;
    }
  });

  // Other-family captions
  captionNodes.forEach(({ fc, node }) => {
    const x = node.position.x, y = node.position.y;
    s += `<rect x="${X(x)}" y="${Y(y)}" width="170" height="${fc.rootName ? 34 : 22}" rx="7" fill="#f59e0b" fill-opacity="0.1" stroke="#f59e0b" stroke-opacity="0.45" stroke-width="0.6"/>`;
    s += `<text x="${X(x + 85)}" y="${Y(y + 14)}" text-anchor="middle" font-size="10" font-weight="700" fill="${PL.otherFamilyAccent}">${esc(fc.label)}</text>`;
    if (fc.rootName) s += `<text x="${X(x + 85)}" y="${Y(y + 27)}" text-anchor="middle" font-size="9" fill="${PL.otherFamilyAccent}">${esc(fc.rootName)}</text>`;
  });

  if (hhNode) {
    const x = hhNode.position.x, y = hhNode.position.y;
    s += `<rect x="${X(x)}" y="${Y(y)}" width="160" height="32" rx="10" fill="#ffffff" stroke="#1565c0" stroke-opacity="0.35"/>`;
    s += `<text x="${X(x + 80)}" y="${Y(y + 20.5)}" text-anchor="middle" font-size="12" font-weight="700" fill="${PL.textPrimary}">${esc(hhNode.data?.label)}</text>`;
  }
  s += `</svg>`;
  return { svg: s, width: W, height: H };
}

// SVG string -> PNG data URL (for jsPDF and the "Export" image download).
export function svgToPngDataUrl({ svg, width, height }, scale = 2, maxPx = 3200) {
  return new Promise((resolve, reject) => {
    const k = Math.min(scale, maxPx / Math.max(width, height));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(width * k); c.height = Math.round(height * k);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve({ dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height });
    };
    img.onerror = () => reject(new Error("Could not render graph image"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// ── Excel export ────────────────────────────────────────────────────────
// households: rows already filtered the same way as the on-screen list
// (each row already carries its three-domain fields, see rowToExport).
// selected: optional { household, analysis, graph } for the open household.
export function exportNetworkWorkbook({ households, selected, filterNote, filename }) {
  const wb = XLSX.utils.book_new();
  const fit = (ws, rows) => {
    const keys = rows.length ? Object.keys(rows[0]) : [];
    ws["!cols"] = keys.map((k) => ({ wch: Math.min(48, Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)) + 2) }));
    return ws;
  };
  const addSheet = (name, rows) => {
    if (!rows || !rows.length) return;
    XLSX.utils.book_append_sheet(wb, fit(XLSX.utils.json_to_sheet(rows), rows), name.slice(0, 31));
  };

  addSheet("Households", households);

  if (selected?.analysis && !selected.analysis.empty) {
    const a = selected.analysis, hh = selected.household || {};
    const s = a.summary;
    addSheet("Selected household", [
      ["Household", hh.household_number], ["Barangay", hh.barangay_name],
      ["Members", s.members], ["Nuclear families", s.families],
      ["Working-age adults (18-59, non-PWD)", s.working_age_adults],
      ["Minors (0-17)", s.minors], ["Seniors (60+)", s.seniors], ["PWD", s.pwd],
      ["Dependents (minor/senior/PWD)", s.dependents],
      ["Dependency ratio (minors+seniors per working-age adult)", s.dependency_ratio ?? "—"],
      ["Dependents without a directly linked working-age adult", s.dependents_without_direct_adult],
      ["Largest caregiver load (dependents linked to one adult)", s.max_caregiver_load],
      ["Relationship links", s.links], ["  of which cross-family links", s.cross_family_links],
      ["Network density", s.density], ["Network diameter (links)", s.diameter],
      ["Max links from head", s.max_hops_from_head], ["Members with no recorded relationship", s.unlinked_members],
      ["Method", a.method],
    ].map(([Metric, Value]) => ({ Metric, Value })));
    addSheet("Members", a.members.map((m) => ({
      "Name": m.name, "Relationship to head": m.relationship ?? "", "Age": m.age ?? "", "Age group": m.age_group,
      "Gender": m.gender ?? "", "PWD": m.is_pwd ? "Yes" : "No", "Senior": m.is_senior ? "Yes" : "No",
      "Dependent": m.is_dependent ? "Yes" : "No", "Nuclear family ID": m.family_id ?? "",
      "Links (degree)": m.degree, "Links from head": m.hops_from_head ?? "not linked",
      "Betweenness centrality": m.betweenness, "Key connector": m.is_key_connector ? "Yes" : "No",
    })));
    addSheet("Dependents", a.dependents.map((d) => ({
      "Name": d.name, "Age": d.age ?? "", "Relationship": d.relationship ?? "", "Dependent type": d.dependent_type,
      "Nearest working-age adult": d.nearest_adult_name ?? "none in household",
      "Links to that adult": d.hops_to_adult ?? "", "Directly linked to an adult": d.directly_supported ? "Yes" : "No",
    })));
    addSheet("Caregivers", a.caregivers.map((c) => ({
      "Name": c.name, "Age": c.age ?? "", "Relationship": c.relationship ?? "",
      "Dependents directly linked": c.dependents_linked, "Dependents": c.dependent_names.join("; "),
    })));
    const nameOf = new Map((selected.graph?.nodes || []).map((n) => [n.id, n.label]));
    addSheet("Relationships", (selected.graph?.edges || []).map((e) => ({
      "From": nameOf.get(e.source) ?? e.source, "To": nameOf.get(e.target) ?? e.target, "Relationship": e.type,
    })));
  }

  addSheet("About", [
    { Item: "Generated", Value: new Date().toLocaleString("en-PH") },
    { Item: "Filters", Value: filterNote || "none" },
    { Item: "Domains", Value: "Social Vulnerability (typology), Operational Capacity (facility distance) and Hazard Exposure are separate domains and are never combined into one score." },
    { Item: "Source", Value: "LGU-SDSS · Family Network Analysis · Municipality of San Miguel, Iloilo" },
  ]);
  XLSX.writeFile(wb, filename);
}
