import jsPDF from "jspdf";

const INK = [30, 41, 59];        // slate-800, main text
const MUTED = [100, 116, 139];   // slate-500, secondary text
const RULE = [203, 213, 225];    // slate-300, hairlines
const NAVY = [17, 40, 79];       // header bar
const NAVY_LIGHT = [235, 240, 248];

/**
 * Exports a formal, government-report style PDF: letterhead header, a
 * framed/captioned map figure, and — when comparing two barangays — a
 * native jsPDF comparison table (not a screenshot of the dark in-app UI).
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.mapCanvas - pre-rendered map image (see renderBoundaryCanvas)
 * @param {Object|null} [opts.comparison] - { a, b } barangay stat rows, same shape as
 *   the app's `compareA`/`compareB` state, or null if not comparing.
 * @param {string} [opts.filename]
 * @param {string} [opts.orgName]
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 */
export async function exportMapToPdf({
  mapCanvas,
  comparison = null,
  single = null,
  filename = "spatial-vulnerability-map.pdf",
  orgName = "LGU Spatial Decision Support System",
  title = "Spatial Vulnerability Map",
  subtitle = "Municipality of San Miguel · Iloilo, Philippines",
}) {
  if (!mapCanvas) throw new Error("exportMapToPdf: mapCanvas is required");

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 42;
  const contentW = pageW - margin * 2;

  const generatedAt = new Date().toLocaleString("en-PH", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const drawHeader = () => {
    pdf.setFillColor(...NAVY);
    pdf.rect(0, 0, pageW, 6, "F");

    pdf.setFontSize(9);
    pdf.setFont(undefined, "bold");
    pdf.setTextColor(...MUTED);
    pdf.text(orgName.toUpperCase(), margin, 34);

    pdf.setFontSize(18);
    pdf.setFont(undefined, "bold");
    pdf.setTextColor(...INK);
    pdf.text(title, margin, 56);

    pdf.setFontSize(10.5);
    pdf.setFont(undefined, "normal");
    pdf.setTextColor(...MUTED);
    pdf.text(subtitle, margin, 72);

    pdf.setDrawColor(...RULE);
    pdf.setLineWidth(0.75);
    pdf.line(margin, 84, pageW - margin, 84);

    return 84;
  };

  const drawFooter = (pageNum, pageCount) => {
    const y = pageH - 28;
    pdf.setDrawColor(...RULE);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageW - margin, y);

    pdf.setFontSize(8);
    pdf.setFont(undefined, "normal");
    pdf.setTextColor(...MUTED);
    pdf.text(`Generated ${generatedAt}`, margin, y + 14);
    pdf.text(`Page ${pageNum} of ${pageCount}`, pageW - margin, y + 14, { align: "right" });
  };

  // ── Page 1: map figure ──────────────────────────────────────
  let cursorY = drawHeader() + 26;

  const mapAspect = mapCanvas.height / mapCanvas.width;
  let mapW = contentW;
  let mapH = mapW * mapAspect;
  const maxMapH = pageH - cursorY - margin - 60; // leave room for caption + footer
  if (mapH > maxMapH) {
    mapH = maxMapH;
    mapW = mapH / mapAspect;
  }
  const mapX = margin + (contentW - mapW) / 2;

  // Framed figure
  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(1);
  pdf.rect(mapX - 1, cursorY - 1, mapW + 2, mapH + 2);
  pdf.addImage(mapCanvas.toDataURL("image/png"), "PNG", mapX, cursorY, mapW, mapH);
  cursorY += mapH + 14;

  pdf.setFontSize(9);
  pdf.setFont(undefined, "italic");
  pdf.setTextColor(...MUTED);
  const caption = comparison
    ? `Figure 1. Barangay Vulnerability Index comparison — ${comparison.a.barangay_name} vs. ${comparison.b.barangay_name}.`
    : single
    ? `Figure 1. Barangay Vulnerability Index (BVI) classification — ${single.barangay_name} highlighted.`
    : "Figure 1. Barangay Vulnerability Index (BVI) classification by barangay.";
  pdf.text(caption, margin, cursorY);

  // ── Page 2: comparison or single-barangay detail table ─────
  if (comparison) {
    pdf.addPage();
    const y = drawHeader() + 20;
    drawComparisonSection(pdf, comparison, { margin, contentW, y });
  } else if (single) {
    pdf.addPage();
    const y = drawHeader() + 20;
    drawSingleBarangaySection(pdf, single, { margin, contentW, y });
  }

  // ── Footers on every page ───────────────────────────────────
  const pageCount = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    drawFooter(i, pageCount);
  }

  pdf.save(filename);
}

/**
 * Draws a formal side-by-side comparison table for two barangays directly
 * with jsPDF primitives (rects/text) — a proper report table, not a
 * screenshot of the app's dark-themed comparison card.
 */
function drawComparisonSection(pdf, { a, b }, { margin, contentW, y }) {
  const sA = parseFloat(a.avg_vulnerability_score) || 0;
  const sB = parseFloat(b.avg_vulnerability_score) || 0;
  const hhA = parseInt(a.total_households || 0, 10);
  const hhB = parseInt(b.total_households || 0, 10);
  const labelOf = (s) => (!s ? "No Data" : s > 3 ? "Very High" : s > 2 ? "High" : s > 1 ? "Moderate" : "Low");
  const colorOf = (s) => (!s ? [107, 114, 128] : s > 3 ? [123, 31, 162] : s > 2 ? [239, 68, 68] : s > 1 ? [245, 158, 11] : [34, 197, 94]);

  pdf.setFontSize(13);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...INK);
  pdf.text("Barangay Comparison Summary", margin, y);
  y += 22;

  // ── Header score cards ──
  const colW = (contentW - 16) / 2;
  const cardH = 64;
  [{ stat: a, score: sA, hh: hhA, x: margin }, { stat: b, score: sB, hh: hhB, x: margin + colW + 16 }].forEach(
    ({ stat, score, hh, x }) => {
      const c = colorOf(score);
      pdf.setDrawColor(...RULE);
      pdf.setLineWidth(0.75);
      pdf.rect(x, y, colW, cardH);
      pdf.setFillColor(...c);
      pdf.rect(x, y, 4, cardH, "F");

      pdf.setFontSize(11);
      pdf.setFont(undefined, "bold");
      pdf.setTextColor(...INK);
      pdf.text(stat.barangay_name, x + 14, y + 18);

      pdf.setFontSize(18);
      pdf.setFont(undefined, "bold");
      pdf.setTextColor(...c);
      pdf.text(score ? score.toFixed(4) : "N/A", x + 14, y + 38);

      pdf.setFontSize(9);
      pdf.setFont(undefined, "bold");
      pdf.text(labelOf(score).toUpperCase(), x + 14, y + 52);

      pdf.setFont(undefined, "normal");
      pdf.setTextColor(...MUTED);
      pdf.text(`${hh.toLocaleString()} households`, x + colW - 14, y + 52, { align: "right" });
    }
  );
  y += cardH + 24;

  // ── Breakdown tables ──
  const vulnRows = [
    ["Very High", a.very_high_vuln_count, b.very_high_vuln_count],
    ["High", a.high_vuln_count, b.high_vuln_count],
    ["Moderate", a.medium_vuln_count, b.medium_vuln_count],
    ["Low", a.low_vuln_count, b.low_vuln_count],
  ];
  const resilRows = [
    ["High", a.high_resil_count, b.high_resil_count],
    ["Moderate", a.moderate_resil_count, b.moderate_resil_count],
    ["Low", a.low_resil_count, b.low_resil_count],
    ["Very Low", a.very_low_resil_count, b.very_low_resil_count],
  ];

  y = drawBreakdownTable(pdf, "Vulnerability Breakdown", vulnRows, a.barangay_name, b.barangay_name, hhA, hhB, {
    margin,
    contentW,
    y,
  });
  y += 20;
  y = drawBreakdownTable(pdf, "Resilience Breakdown", resilRows, a.barangay_name, b.barangay_name, hhA, hhB, {
    margin,
    contentW,
    y,
  });

  return y;
}

function drawBreakdownTable(pdf, heading, rows, nameA, nameB, hhA, hhB, { margin, contentW, y }) {
  pdf.setFontSize(11);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...INK);
  pdf.text(heading, margin, y);
  y += 10;

  const rowH = 20;
  const labelW = 90;
  const colW = (contentW - labelW) / 2;
  const headerH = 18;

  // Header row
  pdf.setFillColor(...NAVY_LIGHT);
  pdf.rect(margin, y, contentW, headerH, "F");
  pdf.setFontSize(8.5);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...MUTED);
  pdf.text("CATEGORY", margin + 6, y + 12);
  pdf.text(nameA, margin + labelW + colW / 2, y + 12, { align: "center" });
  pdf.text(nameB, margin + labelW + colW + colW / 2, y + 12, { align: "center" });
  y += headerH;

  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.5);

  rows.forEach(([label, valA, valB], i) => {
    const nA = parseInt(valA || 0, 10);
    const nB = parseInt(valB || 0, 10);
    const pctA = hhA ? Math.round((nA / hhA) * 100) : 0;
    const pctB = hhB ? Math.round((nB / hhB) * 100) : 0;

    if (i % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, contentW, rowH, "F");
    }

    pdf.setFontSize(9);
    pdf.setFont(undefined, "normal");
    pdf.setTextColor(...INK);
    pdf.text(label, margin + 6, y + 13);

    pdf.text(`${nA.toLocaleString()} (${pctA}%)`, margin + labelW + colW / 2, y + 13, { align: "center" });
    pdf.text(`${nB.toLocaleString()} (${pctB}%)`, margin + labelW + colW + colW / 2, y + 13, { align: "center" });

    y += rowH;
  });

  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.75);
  pdf.rect(margin, y - rows.length * rowH - headerH, contentW, rows.length * rowH + headerH);
  // vertical dividers
  pdf.line(margin + labelW, y - rows.length * rowH - headerH, margin + labelW, y);
  pdf.line(margin + labelW + colW, y - rows.length * rowH - headerH, margin + labelW + colW, y);

  return y;
}

/**
 * Draws a single-barangay detail section: score card + single-column
 * vulnerability/resilience breakdown tables. Mirrors the app's right-hand
 * detail panel, but as a proper report layout.
 */
function drawSingleBarangaySection(pdf, stat, { margin, contentW, y }) {
  const score = parseFloat(stat.avg_vulnerability_score) || 0;
  const hh = parseInt(stat.total_households || 0, 10);
  const labelOf = (s) => (!s ? "No Data" : s > 3 ? "Very High" : s > 2 ? "High" : s > 1 ? "Moderate" : "Low");
  const colorOf = (s) => (!s ? [107, 114, 128] : s > 3 ? [123, 31, 162] : s > 2 ? [239, 68, 68] : s > 1 ? [245, 158, 11] : [34, 197, 94]);
  const c = colorOf(score);

  pdf.setFontSize(13);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...INK);
  pdf.text("Barangay Detail Summary", margin, y);
  y += 22;

  // Score card
  const cardH = 64;
  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.75);
  pdf.rect(margin, y, contentW, cardH);
  pdf.setFillColor(...c);
  pdf.rect(margin, y, 4, cardH, "F");

  pdf.setFontSize(12);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...INK);
  pdf.text(stat.barangay_name, margin + 16, y + 20);

  pdf.setFontSize(20);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...c);
  pdf.text(score ? score.toFixed(4) : "N/A", margin + 16, y + 42);

  pdf.setFontSize(9);
  pdf.setFont(undefined, "bold");
  pdf.text(labelOf(score).toUpperCase(), margin + 16, y + 56);

  pdf.setFont(undefined, "normal");
  pdf.setTextColor(...MUTED);
  pdf.text(`${hh.toLocaleString()} households`, margin + contentW - 16, y + 56, { align: "right" });

  y += cardH + 24;

  const vulnRows = [
    ["Very High", stat.very_high_vuln_count],
    ["High", stat.high_vuln_count],
    ["Moderate", stat.medium_vuln_count],
    ["Low", stat.low_vuln_count],
  ];
  const resilRows = [
    ["High", stat.high_resil_count],
    ["Moderate", stat.moderate_resil_count],
    ["Low", stat.low_resil_count],
    ["Very Low", stat.very_low_resil_count],
  ];

  y = drawSingleBreakdownTable(pdf, "Vulnerability Breakdown", vulnRows, hh, { margin, contentW, y });
  y += 20;
  y = drawSingleBreakdownTable(pdf, "Resilience Breakdown", resilRows, hh, { margin, contentW, y });

  return y;
}

function drawSingleBreakdownTable(pdf, heading, rows, hh, { margin, contentW, y }) {
  pdf.setFontSize(11);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...INK);
  pdf.text(heading, margin, y);
  y += 10;

  const rowH = 20;
  const labelW = 140;
  const valW = contentW - labelW;
  const headerH = 18;

  pdf.setFillColor(...NAVY_LIGHT);
  pdf.rect(margin, y, contentW, headerH, "F");
  pdf.setFontSize(8.5);
  pdf.setFont(undefined, "bold");
  pdf.setTextColor(...MUTED);
  pdf.text("CATEGORY", margin + 6, y + 12);
  pdf.text("HOUSEHOLDS", margin + labelW + valW / 2, y + 12, { align: "center" });
  y += headerH;

  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.5);

  rows.forEach(([label, val], i) => {
    const n = parseInt(val || 0, 10);
    const pct = hh ? Math.round((n / hh) * 100) : 0;

    if (i % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, contentW, rowH, "F");
    }

    pdf.setFontSize(9);
    pdf.setFont(undefined, "normal");
    pdf.setTextColor(...INK);
    pdf.text(label, margin + 6, y + 13);
    pdf.text(`${n.toLocaleString()} (${pct}%)`, margin + labelW + valW / 2, y + 13, { align: "center" });

    y += rowH;
  });

  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.75);
  pdf.rect(margin, y - rows.length * rowH - headerH, contentW, rows.length * rowH + headerH);
  pdf.line(margin + labelW, y - rows.length * rowH - headerH, margin + labelW, y);

  return y;
}