// PDF report for one household on the Family Network Analysis page.
//
// Structure (executive summary -> KPIs -> graph -> detailed analysis ->
// recommendations -> roster -> method):
//   1. Title band + household at a glance (KPI boxes)
//   2. Key findings (plain language, generated from the networkx analysis)
//   3. Family network graph (same layout as the page, re-drawn as an image)
//   4. Care & dependency analysis: dependents -> nearest working-age adult,
//      caregiver load, key connectors, structure metrics
//   5. Three domains (typology / facility distance / hazard) -- shown side
//      by side, never combined into one score
//   6. Cluster profile match
//   7. Recommendations
//   8. Member roster + methodology
import jsPDF from "jspdf";
import { NETWORK_PALETTE } from "./networkPalette";
// Text colors are the WCAG 2.1 AA print palette (networkPalette.js, light theme).

const NAVY = [26, 35, 126], BLUE = [21, 101, 192], GREY = [100, 116, 139], INK = [15, 23, 42];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// The page may pass its dark-theme colors; the PDF is always printed on
// white, so swap each dark palette color for its light (AA on white) twin.
const PRINT_TWIN = (() => {
  const m = {};
  const walk = (d, l) => Object.keys(d).forEach((k) => {
    if (typeof d[k] === "string" && typeof l?.[k] === "string") m[d[k].toLowerCase()] = l[k];
    else if (d[k] && typeof d[k] === "object") walk(d[k], l?.[k]);
  });
  walk(NETWORK_PALETTE.dark, NETWORK_PALETTE.light);
  return m;
})();
const printColor = (c) => (c && PRINT_TWIN[String(c).toLowerCase()]) || c;
// jsPDF's built-in fonts are Latin-1 only.
const ascii = (s) => String(s ?? "").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[①]/g, "1.").replace(/[②]/g, "2.").replace(/[③]/g, "3.").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

// "Landslide" -> "a landslide zone"; "Compound: Flood + Landslide" ->
// "both flood and landslide zones".
function hazardZonePhrase(label) {
  const compound = /^compound/i.test(label);
  const parts = label.replace(/^compound:\s*/i, "").split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length > 1) return `${compound ? "both " : ""}${parts.join(" and ")} zones`;
  return `a ${parts[0] || label.toLowerCase()} zone`;
}

export function buildNetworkFindings({ analysis, domains, household }) {
  const f = [];
  if (!analysis || analysis.empty) return f;
  const s = analysis.summary;
  const list = (arr, max = 3) => {
    const a = arr.slice(0, max);
    const more = arr.length - a.length;
    return a.join(", ") + (more > 0 ? ` and ${more} other${more > 1 ? "s" : ""}` : "");
  };
  f.push({
    tag: "CARE",
    color: "#6d28d9",
    text: s.dependents
      ? `${s.dependents} of ${s.members} members are dependents (${s.minors} minor${s.minors === 1 ? "" : "s"}, ${s.seniors} senior${s.seniors === 1 ? "" : "s"}, ${s.pwd} PWD) supported by ${s.working_age_adults} working-age adult${s.working_age_adults === 1 ? "" : "s"}${s.dependency_ratio != null ? ` — ${s.dependency_ratio} minors/seniors per working-age adult` : ""}.`
      : `No dependents (minors, seniors or PWD) are recorded in this household.`,
  });
  const unsupported = analysis.dependents.filter((d) => !d.directly_supported);
  if (s.dependents) {
    f.push({
      tag: "LINKS",
      color: unsupported.length ? "#b91c1c" : "#166534",
      text: unsupported.length
        ? `${unsupported.length} dependent${unsupported.length > 1 ? "s have" : " has"} no working-age adult directly linked in the family network: ${list(unsupported.map((d) => `${d.name} (${d.dependent_type.toLowerCase()}${d.nearest_adult_name ? `, nearest adult ${d.hops_to_adult} links away` : ", no adult in household"})`))}.`
        : `Every dependent is directly linked to at least one working-age adult.`,
    });
  }
  const top = analysis.caregivers[0];
  if (top) {
    f.push({
      tag: "LOAD",
      color: top.dependents_linked >= 3 ? "#92400e" : "#0369a1",
      text: `${top.name} is directly linked to ${top.dependents_linked} dependent${top.dependents_linked > 1 ? "s" : ""} — the household's main caregiver link${top.dependents_linked >= 3 ? " and a likely single point of strain during an emergency" : ""}.`,
    });
  }
  if (analysis.key_connectors.length) {
    f.push({
      tag: "CONNECT",
      color: "#1565c0",
      text: `${list(analysis.key_connectors.map((k) => k.name), 2)} ${analysis.key_connectors.length > 1 ? "hold" : "holds"} the household network together — without ${analysis.key_connectors.length > 1 ? "them" : "this member"}, part of the family would no longer be linked.`,
    });
  }
  if (s.families > 1) {
    f.push({ tag: "FAMILIES", color: "#92400e", text: `${s.families} nuclear families share this household (${s.cross_family_links} cross-family link${s.cross_family_links === 1 ? "" : "s"} recorded).` });
  }
  if (domains?.hazard?.label) {
    const zone = hazardZonePhrase(domains.hazard.label);
    f.push({
      tag: "HAZARD",
      color: "#b91c1c",
      text: `The household is in ${zone}${s.dependents ? ` with ${s.dependents} dependent${s.dependents > 1 ? "s" : ""} — include them in assisted-evacuation planning` : ""}.`,
    });
  }
  if (s.unlinked_members) {
    f.push({ tag: "DATA", color: "#64748b", text: `${s.unlinked_members} member${s.unlinked_members > 1 ? "s have" : " has"} no recorded relationship to the rest of the household — verify in the CBMS roster.` });
  }
  return f;
}

export function buildNetworkRecommendations({ analysis, domains }) {
  const r = [];
  if (!analysis || analysis.empty) return r;
  const s = analysis.summary;
  const unsupported = analysis.dependents.filter((d) => !d.directly_supported);
  const priorityDeps = analysis.dependents.filter((d) => /Senior|PWD/.test(d.dependent_type));
  if (domains?.hazard?.label && s.dependents) {
    r.push(`Add this household to the barangay assisted-evacuation list for ${domains.hazard.label.replace(/^compound:\s*/i, "").toLowerCase().replace(" + ", " and ")} events${priorityDeps.length ? `, prioritising ${priorityDeps.map((d) => d.name).slice(0, 4).join(", ")}` : ""}.`);
  } else if (s.dependents) {
    r.push(`Record the household's ${s.dependents} dependent${s.dependents > 1 ? "s" : ""} in the barangay dependents registry so they are covered if hazard conditions change.`);
  }
  if (unsupported.length) r.push(`Assign a designated helper (neighbour, BHW or tanod) for ${unsupported.map((d) => d.name).slice(0, 4).join(", ")}, who ${unsupported.length > 1 ? "have" : "has"} no working-age adult directly linked.`);
  const heavy = analysis.caregivers.filter((c) => c.dependents_linked >= 3);
  if (heavy.length) r.push(`${heavy[0].name} carries ${heavy[0].dependents_linked} dependents — consider caregiver support (4Ps/DSWD referral, day-care, senior/PWD assistance).`);
  if (domains?.capacity?.hasCoords && domains.capacity.beyondCount > 0) r.push(`The household is more than 2 km from ${domains.capacity.beyondCount === 2 ? "both the RHU and the Fire Station" : "one key facility"} — pre-arrange transport for dependents during evacuation or medical emergencies.`);
  if (domains?.typology?.hasCluster) r.push(`Social profile: "${domains.typology.label}" — align social-protection programs with this typology group.`);
  if (s.unlinked_members) r.push(`Update the CBMS relationship records for ${s.unlinked_members} member${s.unlinked_members > 1 ? "s" : ""} with no recorded relationship.`);
  return r;
}

export async function generateNetworkReportPDF({ household, analysis, graphImg, domains, clusterMatch, indicatorLabels, formatIndicator }) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 14, CW = W - 2 * M;
  let y = 0;
  const now = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  const hhNo = household?.household_number || analysis?.household?.household_number || "—";
  const brgy = household?.barangay_name || analysis?.household?.barangay_name || "—";

  const txt = (t, x, yy, o = {}) => pdf.text(Array.isArray(t) ? t.map(ascii) : ascii(t), x, yy, o);
  const font = (size, style = "normal", color = INK) => { pdf.setFontSize(size); pdf.setFont("helvetica", style); pdf.setTextColor(...color); };
  const ensure = (need) => { if (y + need > H - 16) { pdf.addPage(); y = M + 2; } };
  const section = (title, sub) => {
    ensure(18);
    pdf.setFillColor(...BLUE); pdf.rect(M, y, 1.4, 6, "F");
    font(12, "bold", NAVY); txt(title, M + 4, y + 4.6);
    y += 8;
    if (sub) { font(8, "normal", GREY); const ls = pdf.splitTextToSize(ascii(sub), CW - 4); txt(ls, M + 4, y); y += ls.length * 3.4 + 1.5; }
    y += 1;
  };
  // Simple paginated table. cols: [{ label, w, align }], rows: arrays of
  // { t, color, bold } or strings.
  const table = (cols, rows, { head = NAVY, fs = 7.5 } = {}) => {
    const scale = CW / cols.reduce((a, c) => a + c.w, 0);
    const ws = cols.map((c) => c.w * scale);
    const drawHead = () => {
      pdf.setFillColor(...head); pdf.rect(M, y, CW, 6.5, "F");
      font(6.8, "bold", [255, 255, 255]);
      let x = M; cols.forEach((c, i) => { txt(pdf.splitTextToSize(ascii(c.label.toUpperCase()), ws[i] - 3)[0], x + 2, y + 4.4); x += ws[i]; });
      y += 6.5;
    };
    ensure(14); drawHead();
    rows.forEach((row, ri) => {
      font(fs);
      const cells = row.map((c) => (typeof c === "object" && c !== null ? c : { t: c }));
      const lines = cells.map((c, i) => pdf.splitTextToSize(ascii(c.t ?? "—"), ws[i] - 4));
      const rh = Math.max(6, 2.6 + Math.max(...lines.map((l) => l.length)) * (fs * 0.42));
      if (y + rh > H - 16) { pdf.addPage(); y = M + 2; drawHead(); }
      if (ri % 2 === 0) { pdf.setFillColor(248, 249, 252); pdf.rect(M, y, CW, rh, "F"); }
      let x = M;
      cells.forEach((c, i) => {
        font(fs, c.bold ? "bold" : "normal", c.color ? hex(c.color) : [51, 51, 51]);
        txt(lines[i], x + 2, y + 4);
        x += ws[i];
      });
      y += rh;
    });
    y += 4;
  };
  const kpiRow = (items) => {
    ensure(20);
    const gap = 3, bw = (CW - gap * (items.length - 1)) / items.length;
    items.forEach((k, i) => {
      const x = M + i * (bw + gap);
      pdf.setFillColor(248, 249, 252); pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.3);
      pdf.roundedRect(x, y, bw, 17, 2, 2, "FD");
      pdf.setFillColor(...hex(k.color || "#1a237e")); pdf.rect(x, y, bw, 0.9, "F");
      font(14, "bold", hex(k.color || "#1a237e")); txt(String(k.value), x + bw / 2, y + 9, { align: "center" });
      font(6.6, "normal", GREY); txt(pdf.splitTextToSize(ascii(k.label), bw - 3), x + bw / 2, y + 13.3, { align: "center" });
    });
    y += 21;
  };
  const image = (img, maxH) => {
    if (!img) return;
    const ratio = img.height / img.width;
    let w = CW, h = CW * ratio;
    if (h > maxH) { h = maxH; w = h / ratio; }
    ensure(h + 4);
    pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.3); pdf.roundedRect(M, y, CW, h + 4, 2, 2, "S");
    pdf.addImage(img.dataUrl, "PNG", M + (CW - w) / 2, y + 2, w, h);
    y += h + 7;
  };
  const para = (t, { size = 8.5, color = [51, 51, 51], indent = 0 } = {}) => {
    font(size, "normal", color);
    const ls = pdf.splitTextToSize(ascii(t), CW - indent);
    ensure(ls.length * size * 0.42 + 2);
    txt(ls, M + indent, y + 3);
    y += ls.length * size * 0.42 + 2;
  };

  // ── Title band ───────────────────────────────────────────────────────
  pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 30, "F");
  pdf.setFillColor(...BLUE); pdf.rect(0, 30, W, 1.2, "F");
  font(7, "normal", [197, 208, 250]); txt("REPUBLIC OF THE PHILIPPINES · MUNICIPALITY OF SAN MIGUEL, ILOILO · LGU-SDSS", M, 8);
  font(17, "bold", [255, 255, 255]); txt("Family Network Analysis Report", M, 17);
  font(9.5, "normal", [220, 228, 255]); txt(`Household ${hhNo}  ·  ${brgy}`, M, 24);
  font(8, "normal", [197, 208, 250]); txt(`Generated ${now}`, W - M, 24, { align: "right" });
  y = 38;

  const s = analysis && !analysis.empty ? analysis.summary : null;
  if (s) {
    kpiRow([
      { label: "Members", value: s.members },
      { label: "Nuclear families", value: s.families, color: "#92400e" },
      { label: "Working-age adults", value: s.working_age_adults, color: "#1565c0" },
      { label: "Dependents (minor/senior/PWD)", value: s.dependents, color: "#6d28d9" },
      { label: "Minors+seniors per adult", value: s.dependency_ratio ?? "—", color: "#92400e" },
      { label: "Dependents not directly linked to an adult", value: s.dependents_without_direct_adult, color: s.dependents_without_direct_adult ? "#b91c1c" : "#166534" },
    ]);
  }

  // ── Key findings ─────────────────────────────────────────────────────
  const findings = buildNetworkFindings({ analysis, domains, household });
  if (findings.length) {
    section("Key Findings", "Generated from the household's family network (networkx) and its three separate vulnerability domains.");
    findings.forEach((f) => {
      font(8.5, "normal", [51, 51, 51]);
      const ls = pdf.splitTextToSize(ascii(f.text), CW - 24);
      ensure(ls.length * 3.6 + 3);
      pdf.setFillColor(...hex(f.color)); pdf.roundedRect(M, y + 0.4, 19, 4.6, 1, 1, "F");
      font(6.3, "bold", [255, 255, 255]); txt(f.tag, M + 9.5, y + 3.6, { align: "center" });
      font(8.5, "normal", [51, 51, 51]); txt(ls, M + 23, y + 3.6);
      y += ls.length * 3.6 + 2.6;
    });
    y += 2;
  }

  // ── Graph ────────────────────────────────────────────────────────────
  section("Family Network Graph", "Each circle is a household member; lines are recorded relationships. Other nuclear families are shown as separate labelled clusters (their link to the head is a CBMS family grouping, not drawn as a kinship line).");
  if (graphImg) {
    image(graphImg, 118);
    font(7, "normal", GREY);
    const leg = pdf.splitTextToSize(ascii("Node border: blue = adult 18-59 · green = minor 0-17 · amber = senior 60+ · purple = PWD · amber border on a cluster root = another nuclear family's head. Line colour = relationship type."), CW);
    txt(leg, M, y - 2);
    y += leg.length * 3 + 1;
  } else {
    para("The graph could not be rendered for this household.", { color: GREY });
  }

  if (s) {
    // ── Care & dependency analysis ────────────────────────────────────
    pdf.addPage(); y = M + 2;
    section("Care & Dependency Analysis", "For each dependent, the nearest working-age adult (18-59, non-PWD) in the family network and how many relationship links away they are. 1 link = directly related.");
    if (analysis.dependents.length) {
      table(
        [{ label: "Dependent", w: 42 }, { label: "Type", w: 22 }, { label: "Age", w: 10 }, { label: "Relationship", w: 26 }, { label: "Nearest working-age adult", w: 46 }, { label: "Links", w: 12 }, { label: "Status", w: 24 }],
        analysis.dependents.map((d) => [
          { t: d.name, bold: true }, d.dependent_type, d.age ?? "—", d.relationship ?? "—",
          d.nearest_adult_name ? `${d.nearest_adult_name}${d.nearest_adult_age != null ? ` (${d.nearest_adult_age})` : ""}` : "None in household",
          d.hops_to_adult ?? "—",
          d.directly_supported ? { t: "Directly linked", color: "#166534", bold: true } : { t: "Needs follow-up", color: "#b91c1c", bold: true },
        ]),
      );
    } else {
      para("No dependents recorded.", { color: GREY });
    }

    if (analysis.caregivers.length) {
      section("Caregiver Load", "Working-age adults and the dependents directly linked to them.");
      table(
        [{ label: "Adult", w: 45 }, { label: "Age", w: 10 }, { label: "Relationship", w: 28 }, { label: "Dependents linked", w: 20 }, { label: "Dependents", w: 79 }],
        analysis.caregivers.map((c) => [{ t: c.name, bold: true }, c.age ?? "—", c.relationship ?? "—", { t: String(c.dependents_linked), bold: true, color: c.dependents_linked >= 3 ? "#92400e" : "#333333" }, c.dependent_names.join(", ")]),
      );
    }

    section("Network Structure", "Key connectors are articulation points: removing them splits the household network. Betweenness = share of shortest paths between other members that pass through this person.");
    const kc = analysis.key_connectors;
    table(
      [{ label: "Measure", w: 70 }, { label: "Value", w: 30 }, { label: "What it means", w: 82 }],
      [
        ["Relationship links", `${s.links} (${s.cross_family_links} cross-family)`, "Recorded relationships between members."],
        ["Network density", String(s.density), "Share of all possible member pairs that are directly linked."],
        ["Diameter", `${s.diameter} links`, "Longest shortest-path between two members."],
        ["Max links from household head", String(s.max_hops_from_head), "How far the most distant member is from the head."],
        ["Members with no recorded relationship", String(s.unlinked_members), s.unlinked_members ? "Check CBMS relationship data." : "All members are linked."],
        ["Key connectors", kc.length ? kc.map((k) => `${k.name} (${k.betweenness})`).join(", ") : "None", kc.length ? "Members the rest of the family depends on to stay linked." : "No single member holds the network together."],
      ],
    );
  }

  // ── Three domains ─────────────────────────────────────────────────────
  if (domains) {
    section("Vulnerability — Three Separate Domains", "Social Vulnerability, Operational Capacity and Hazard Exposure are reported separately and never combined into one score.");
    ensure(34);
    const cards = [
      { title: "1. Social Vulnerability (typology)", color: domains.typology.hasCluster ? "#6d28d9" : "#4b5563", badge: domains.typology.label,
        detail: domains.typology.missing ? "Typology indicators not yet backfilled" : `${domains.typology.presentIndicatorCount}/${domains.typology.totalIndicators} indicators present` },
      { title: "2. Distance to help (household vulnerability)", color: domains.capacity.hasCoords ? printColor(domains.capacity.color) : "#4b5563",
        badge: domains.capacity.hasCoords ? `${domains.capacity.beyondCount}/2 facilities beyond 2 km` : "No coordinates",
        detail: domains.capacity.hasCoords ? `RHU ${domains.capacity.rhuKm.toFixed(2)} km · Fire Station ${domains.capacity.fireKm.toFixed(2)} km` : "" },
      { title: "3. Hazard Exposure", color: printColor(domains.hazard.color), badge: domains.hazard.label || "None detected",
        detail: domains.hazard.score != null ? `Exposure score ${domains.hazard.score.toFixed(2)}${domains.hazard.status ? ` · ${domains.hazard.status}` : ""}` : (domains.hazard.status || "") },
    ];
    const gap = 3, bw = (CW - 2 * gap) / 3;
    cards.forEach((c, i) => {
      const x = M + i * (bw + gap), col = hex(c.color);
      pdf.setFillColor(...col.map((v) => Math.round(v + (255 - v) * 0.93))); pdf.setDrawColor(...col.map((v) => Math.round(v + (255 - v) * 0.6)));
      pdf.setLineWidth(0.3); pdf.roundedRect(x, y, bw, 30, 2, 2, "FD");
      font(6.8, "bold", GREY); txt(pdf.splitTextToSize(ascii(c.title.toUpperCase()), bw - 5), x + 3, y + 5);
      font(9, "bold", col); txt(pdf.splitTextToSize(ascii(c.badge), bw - 6).slice(0, 2), x + 3, y + 14);
      font(7, "normal", [71, 85, 105]); txt(pdf.splitTextToSize(ascii(c.detail), bw - 6).slice(0, 2), x + 3, y + 24);
    });
    y += 35;
  }

  // ── Cluster match ─────────────────────────────────────────────────────
  if (clusterMatch) {
    ensure(26 + (clusterMatch.attributes || []).filter((a) => !a.match).length * 6.5);
    section("Cluster Profile Match", `How typical this household is of its k-modes typology cluster (Cluster ${clusterMatch.cluster_id}, ${clusterMatch.cluster_size} households): ${clusterMatch.matched_count} of ${clusterMatch.total_indicators} indicators match the cluster's most common value (${Number(clusterMatch.match_pct).toFixed(1)}%).`);
    const differing = (clusterMatch.attributes || []).filter((a) => !a.match);
    if (differing.length) {
      table(
        [{ label: "Indicator that differs", w: 90 }, { label: "This household", w: 45 }, { label: "Cluster mode", w: 45 }],
        differing.map((a) => [indicatorLabels?.[a.key] || a.key, formatIndicator ? formatIndicator(a.key, a.household_value) : String(a.household_value), formatIndicator ? formatIndicator(a.key, a.cluster_mode) : String(a.cluster_mode)]),
      );
    } else {
      para("Matches the cluster mode on every indicator.", { color: [22, 163, 74] });
    }
  }

  // ── Recommendations ───────────────────────────────────────────────────
  const recs = buildNetworkRecommendations({ analysis, domains });
  if (recs.length) {
    section("Recommendations", "Suggested actions for the barangay / MDRRMO, based on the findings above.");
    recs.forEach((r, i) => {
      font(8.5, "normal", [51, 51, 51]);
      const ls = pdf.splitTextToSize(ascii(r), CW - 9);
      ensure(ls.length * 3.6 + 2);
      pdf.setFillColor(...BLUE); pdf.circle(M + 2.5, y + 2.4, 2.3, "F");
      font(7, "bold", [255, 255, 255]); txt(String(i + 1), M + 2.5, y + 3.4, { align: "center" });
      font(8.5, "normal", [51, 51, 51]); txt(ls, M + 7, y + 3.4);
      y += ls.length * 3.6 + 2.4;
    });
    y += 2;
  }

  // ── Member roster ─────────────────────────────────────────────────────
  if (s) {
    // Keep a roster that fits on one page together instead of spilling a
    // single row onto the next page.
    const rosterNeed = 34 + analysis.members.length * 6.2;
    if (rosterNeed < H - 40) ensure(rosterNeed);
    section("Member Roster", "All household members with their network position.");
    table(
      [{ label: "Name", w: 40 }, { label: "Relationship", w: 26 }, { label: "Age", w: 9 }, { label: "Group", w: 21 }, { label: "Sex", w: 13 }, { label: "PWD", w: 9 }, { label: "Family", w: 12 }, { label: "Links", w: 11 }, { label: "Hops", w: 11 }, { label: "Connector", w: 18 }],
      analysis.members.map((m) => [
        { t: m.name, bold: m.is_head }, m.relationship ?? "—", m.age ?? "—", m.age_group, m.gender ?? "—",
        m.is_pwd ? { t: "Yes", color: "#6d28d9", bold: true } : "No", m.family_id ?? "—", m.degree,
        m.hops_from_head ?? "n/a", m.is_key_connector ? { t: "Yes", color: "#1565c0", bold: true } : "No",
      ]),
      { fs: 7 },
    );
    para(`Links = recorded relationships; Hops = links from the household head; Connector = key connector (articulation point). Method: ${analysis.method} Dependents = minors (0-17), seniors (60+) and PWD. This analysis describes family structure only; it is not a vulnerability score.`, { size: 7, color: GREY });
  }

  // ── Footer on every page ──────────────────────────────────────────────
  const pages = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.3); pdf.line(M, H - 10, W - M, H - 10);
    font(7, "normal", [160, 160, 160]);
    txt(`LGU-SDSS · Family Network Analysis · Household ${hhNo}`, M, H - 6);
    txt(`Generated ${now} · Page ${p} of ${pages}`, W - M, H - 6, { align: "right" });
  }
  pdf.save(`Family_Network_Report_${String(hhNo).replace(/[^A-Za-z0-9]+/g, "_")}_${Date.now()}.pdf`);
}
