// Barangay Planning report (PDF): one barangay, one or all three domains.
//
// Each domain section: the domain's own score / tier, what drives it, the
// recommendations (all of them, not the 4 shown on screen) and the
// households to look out for, read from /api/planning/watch-households
// with the rule printed above the table. The three domains are printed as
// separate sections and never combined. The household table includes
// heads' names, so every page is marked confidential (RA 10173), like the
// Hazard Watch List.
import { getPlanningWatchHouseholds, getGISBarangays } from "../../api/api";

const A4 = { w: 210, h: 297 };
const M = 14;
const INK = [26, 35, 51], MUTED = [100, 110, 125], LINE = [222, 226, 234], BRAND = [21, 101, 192];

// jsPDF's built-in font is WinAnsi: swap characters it cannot draw.
const clean = (s) => String(s ?? "")
  .replace(/[✓✔]/g, "Yes").replace(/[✕✗]/g, "No").replace(/≥/g, ">=").replace(/≤/g, "<=")
  .replace(/[→]/g, "->").replace(/[←]/g, "<-").replace(/[‑–]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[^\x00-\xFF—·•…]/g, "");
const hex = (h) => { const x = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };

function normName(name) {
  return String(name || "").toLowerCase()
    .replace(/\bb\.?r?gy\.?\s*/gi, "").replace(/\bbarangay\s*/gi, "").replace(/\bpob(lacion)?\.?\s*/gi, "")
    .replace(/ñ/g, "n").replace(/\bsanto\b/g, "sto").replace(/\bsanta\b/g, "sta")
    .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// Boundary outline in the domain colours. One domain: a solid line in that
// domain's colour (same as the overlay map). All three: the outline is cut
// into equal repeating segments -- SVI, Capacity, Hazard, SVI, ... -- each
// in that domain's own tier colour. The colours sit side by side and are
// never blended, just as the scores are never combined.
function strokeDomains(ctx, path, packs, width) {
  const seg = Math.max(28, width * 5);
  ctx.lineJoin = "round"; ctx.lineCap = "butt";
  path(); ctx.setLineDash([]); ctx.lineWidth = width + 4; ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.stroke();
  if (packs.length === 1) {
    path(); ctx.lineWidth = width; ctx.strokeStyle = packs[0].color; ctx.stroke();
    return;
  }
  packs.forEach((p, i) => {
    path(); ctx.setLineDash([seg, seg * (packs.length - 1)]); ctx.lineDashOffset = -i * seg;
    ctx.lineWidth = width; ctx.strokeStyle = p.color; ctx.stroke();
  });
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
}
function fillFor(packs, sat) {
  return packs.length === 1 ? packs[0].color + (sat ? "33" : "40") : (sat ? "rgba(255,255,255,0.14)" : "rgba(148,163,184,0.18)");
}
// small key in the map corner (all-three map only)
function drawKey(ctx, packs, H) {
  if (packs.length === 1) return;
  const rows = packs.map((p) => `${p.short} · ${p.badge}`);
  ctx.font = "bold 18px Helvetica";
  const w = Math.max(...rows.map((r) => ctx.measureText(r).width)) + 46, h = rows.length * 22 + 14;
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillRect(10, H - h - 10, w, h);
  rows.forEach((r, i) => {
    const yy = H - h - 10 + 18 + i * 22;
    ctx.fillStyle = packs[i].color; ctx.fillRect(20, yy - 9, 18, 6);
    ctx.fillStyle = "#1f2937"; ctx.textAlign = "left"; ctx.fillText(r, 44, yy);
  });
}

// Boundary drawn straight from the GeoJSON (no map tiles, so it always prints).
function boundaryImage(feature, packs, px = 900) {
  if (!feature) return null;
  const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polys.forEach((p) => p[0].forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const w = (maxX - minX) * kx, h = maxY - minY;
  const ratio = w / h;
  const W = ratio >= 1 ? px : Math.round(px * ratio), H = ratio >= 1 ? Math.round(px / ratio) : px;
  const pad = 30;
  const c = document.createElement("canvas");
  c.width = W + pad * 2; c.height = H + pad * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f6fa"; ctx.fillRect(0, 0, c.width, c.height);
  const X = (x) => pad + ((x - minX) * kx / w) * W, Y = (y) => pad + ((maxY - y) / h) * H;
  const path = () => {
    ctx.beginPath();
    polys.forEach((p) => p.forEach((ring) => ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))))));
  };
  path(); ctx.fillStyle = fillFor(packs, false); ctx.fill("evenodd");
  strokeDomains(ctx, path, packs, 6);
  drawKey(ctx, packs, c.height);
  // north arrow
  ctx.fillStyle = "#334155"; ctx.font = "bold 22px Helvetica"; ctx.textAlign = "center";
  ctx.fillText("N", c.width - 26, 30); ctx.beginPath(); ctx.moveTo(c.width - 26, 38); ctx.lineTo(c.width - 34, 58); ctx.lineTo(c.width - 18, 58); ctx.closePath(); ctx.fill();
  return { url: c.toDataURL("image/png"), ratio: c.width / c.height };
}

// Satellite version: Esri World Imagery tiles (same imagery as the app's
// maps) stitched on a canvas in Web Mercator, with the boundary drawn on
// top. Needs internet; if any step fails (offline, blocked, CORS) the
// caller falls back to boundaryImage() above.
const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const merc = (lng, lat, z) => {
  const n = 256 * 2 ** z, s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};
const loadTile = (url) => new Promise((resolve, reject) => {
  const im = new Image();
  im.crossOrigin = "anonymous";
  const t = setTimeout(() => reject(new Error("timeout")), 9000);
  im.onload = () => { clearTimeout(t); resolve(im); };
  im.onerror = () => { clearTimeout(t); reject(new Error("tile")); };
  im.src = url;
});

async function satelliteImage(feature, packs, maxPx = 1100) {
  if (!feature) return null;
  const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polys.forEach((p) => p[0].forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
  const padX = (maxX - minX) * 0.18, padY = (maxY - minY) * 0.18;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  let z = 18, a, b2;
  for (; z > 10; z--) {
    a = merc(minX, maxY, z); b2 = merc(maxX, minY, z);
    if (b2[0] - a[0] <= maxPx && b2[1] - a[1] <= maxPx) break;
  }
  const W = Math.round(b2[0] - a[0]), H = Math.round(b2[1] - a[1]);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1f2937"; ctx.fillRect(0, 0, W, H);
  const jobs = [];
  for (let tx = Math.floor(a[0] / 256); tx <= Math.floor(b2[0] / 256); tx++) {
    for (let ty = Math.floor(a[1] / 256); ty <= Math.floor(b2[1] / 256); ty++) {
      jobs.push(loadTile(`${TILE}/${z}/${ty}/${tx}`).then((im) => ctx.drawImage(im, tx * 256 - a[0], ty * 256 - a[1])));
    }
  }
  const res = await Promise.allSettled(jobs);
  if (res.filter((r) => r.status === "fulfilled").length < jobs.length * 0.7) throw new Error("imagery unavailable");
  // place-name labels on top, like the app's satellite map (optional)
  const REF = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile";
  const refJobs = [];
  for (let tx = Math.floor(a[0] / 256); tx <= Math.floor(b2[0] / 256); tx++) {
    for (let ty = Math.floor(a[1] / 256); ty <= Math.floor(b2[1] / 256); ty++) {
      refJobs.push(loadTile(`${REF}/${z}/${ty}/${tx}`).then((im) => ctx.drawImage(im, tx * 256 - a[0], ty * 256 - a[1])));
    }
  }
  await Promise.allSettled(refJobs);
  const P = ([x, y]) => { const m = merc(x, y, z); return [m[0] - a[0], m[1] - a[1]]; };
  const path = () => {
    ctx.beginPath();
    polys.forEach((p) => p.forEach((ring) => ring.forEach((pt, i) => { const [X, Y] = P(pt); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); })));
  };
  path(); ctx.fillStyle = fillFor(packs, true); ctx.fill("evenodd");
  strokeDomains(ctx, path, packs, 6);
  drawKey(ctx, packs, H);
  // north arrow + credit
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(W - 30, 34, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1f2937"; ctx.font = "bold 16px Helvetica"; ctx.textAlign = "center"; ctx.fillText("N", W - 30, 30);
  ctx.beginPath(); ctx.moveTo(W - 30, 34); ctx.lineTo(W - 36, 48); ctx.lineTo(W - 24, 48); ctx.closePath(); ctx.fill();
  ctx.font = "13px Helvetica"; ctx.textAlign = "right";
  const credit = "Imagery © Esri, Maxar, Earthstar Geographics";
  const tw = ctx.measureText(credit).width;
  ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fillRect(W - tw - 14, H - 22, tw + 14, 22);
  ctx.fillStyle = "#1f2937"; ctx.fillText(credit, W - 7, H - 7);
  return { url: c.toDataURL("image/jpeg", 0.88), ratio: W / H, type: "JPEG", satellite: true }; // throws if CORS-tainted
}

// limit: households per domain table (60 on the Planning page; "all" from
// Reports, which lists every matching household of the barangay).
export async function buildPlanningReport({ b, packs, verdict, priority, onProgress, limit = 60 }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const today = new Date();
  const dateTxt = today.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });

  let feature = null;
  try {
    const geo = (await getGISBarangays()).data;
    feature = geo?.features?.find((f) => {
      const p = f.properties || {};
      return normName(p.Barangay_n || p.NAME_3 || p.name || p.BARANGAY) === normName(b.barangay_name);
    }) || null;
  } catch { /* report still builds without the map */ }

  let y = 0;
  const setText = (size, style = "normal", color = INK) => { pdf.setFont("helvetica", style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  const ensure = (need) => { if (y + need > A4.h - 18) { pdf.addPage(); y = 18; } };
  const para = (text, size = 9.5, color = INK, style = "normal", indent = 0, gap = 1.6) => {
    setText(size, style, color);
    const lines = pdf.splitTextToSize(clean(text), A4.w - M * 2 - indent);
    lines.forEach((ln) => { ensure(size * 0.45); pdf.text(ln, M + indent, y); y += size * 0.42; });
    y += gap;
  };
  const heading = (text, color = BRAND) => {
    ensure(12); y += 2;
    setText(11.5, "bold", color); pdf.text(clean(text), M, y); y += 2;
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.3); pdf.line(M, y, A4.w - M, y); y += 5;
  };

  // ── Cover header ────────────────────────────────────────────────────
  pdf.setFillColor(26, 35, 126); pdf.rect(0, 0, A4.w, 34, "F");
  setText(8.5, "bold", [190, 205, 255]); pdf.text("LGU-SDSS · BARANGAY PLANNING REPORT", M, 11);
  setText(19, "bold", [255, 255, 255]); pdf.text(clean(b.barangay_name), M, 21);
  setText(9.5, "normal", [220, 228, 255]);
  pdf.text(clean(`${Number(b.total_households || 0).toLocaleString()} households · Municipality of San Miguel, Iloilo · ${dateTxt}`), M, 28);
  setText(8.5, "bold", [255, 255, 255]);
  pdf.text(clean(packs.length === 3 ? "All three domains" : packs[0].title), A4.w - M, 11, { align: "right" });
  y = 42;

  // priority summary (full width), then the map below it

  onProgress?.("Loading satellite map…");
  let img = null;
  try { img = await satelliteImage(feature, packs); } catch { img = null; }
  if (!img) { const plain = boundaryImage(feature, packs); img = plain && { ...plain, type: "PNG", satellite: false }; }
  const textW = A4.w - M * 2;
  const pc = hex(priority.color);
  pdf.setFillColor(...pc); pdf.roundedRect(M, y - 4.5, pdf.getTextWidth(clean(priority.label)) * 1.25 + 8, 6.5, 1.5, 1.5, "F");
  setText(9, "bold", [255, 255, 255]); pdf.text(clean(priority.label), M + 3, y);
  y += 7;
  setText(9.5, "normal", INK);
  pdf.splitTextToSize(clean(verdict), textW).forEach((ln) => { pdf.text(ln, M, y); y += 4.2; });
  y += 2;
  packs.forEach((p) => {
    const c = hex(p.color);
    pdf.setFillColor(...c); pdf.circle(M + 1.5, y - 1.2, 1.4, "F");
    setText(9.5, "bold", INK); pdf.text(clean(p.title), M + 5, y);
    const tw = pdf.getTextWidth(clean(p.title));
    setText(9.5, "normal", MUTED); pdf.text(clean(`${p.headline} · ${p.badge}`), M + 5 + tw + 2.5, y);
    y += 5.2;
  });
  setText(8, "italic", MUTED);
  pdf.splitTextToSize("The three domains are reported separately and are never added or averaged into one score.", textW)
    .forEach((ln) => { pdf.text(ln, M, y); y += 3.6; });
  if (img) {
    y += 3;
    let mapW = A4.w - M * 2, mapH = mapW / img.ratio;
    if (mapH > 105) { mapH = 105; mapW = mapH * img.ratio; }
    const mx = (A4.w - mapW) / 2;
    pdf.addImage(img.url, img.type, mx, y, mapW, mapH);
    pdf.setDrawColor(...LINE); pdf.rect(mx, y, mapW, mapH);
    setText(7.2, "normal", MUTED);
    const cap = (img.satellite ? "Barangay boundary (LGU) on satellite imagery" : "Barangay boundary (LGU) — satellite imagery needs an internet connection")
      + (packs.length > 1 ? ". The outline repeats the SVI, Capacity and Hazard status colours side by side (see the key); the domains are not combined." : ".");
    const capLines = pdf.splitTextToSize(clean(cap), A4.w - M * 2);
    capLines.forEach((ln, i) => pdf.text(ln, M, y + mapH + 3.8 + i * 3.2));
    y += mapH + 6 + capLines.length * 3.2;
  }
  y += 4;

  // ── One section per domain ─────────────────────────────────────────
  for (let k = 0; k < packs.length; k++) {
    const p = packs[k];
    onProgress?.(`Loading households for ${p.title}…`);
    let watch = { households: [], matched: 0, total: 0, basis: "" };
    try { watch = (await getPlanningWatchHouseholds(b.barangay_name, p.key, limit === "all" ? 5000 : limit)).data; } catch { watch.error = true; }

    if (k > 0) { pdf.addPage(); y = 18; }
    const c = hex(p.color);
    ensure(30);
    pdf.setFillColor(...c); pdf.rect(M, y - 5, 2.2, 13, "F");
    setText(14, "bold", INK); pdf.text(clean(p.title), M + 5, y);
    setText(9.5, "normal", MUTED); pdf.text(clean(`${p.headline} · ${p.sub}`), M + 5, y + 5.5);
    setText(9, "bold", c); pdf.text(clean(p.badge), A4.w - M, y, { align: "right" });
    y += 14;

    // details
    heading(p.detailsTitle, c);
    p.details.forEach(([label, value, bad]) => {
      ensure(5.5);
      setText(9.5, "normal", INK); pdf.text(clean(label), M + 2, y);
      setText(9.5, "bold", bad ? [185, 28, 28] : INK); pdf.text(clean(value), A4.w - M - 2, y, { align: "right" });
      pdf.setDrawColor(240, 242, 246); pdf.line(M + 2, y + 1.6, A4.w - M - 2, y + 1.6);
      y += 5.6;
    });
    if (p.note) { y += 1; para(p.note, 8.5, MUTED, "italic"); }

    // recommendations
    heading("Recommendations", c);
    setText(10, "bold", INK); para(p.action, 10, INK, "bold", 0, 2);
    p.recs.forEach((r, i) => {
      ensure(14);
      setText(9.8, "bold", INK); pdf.text(`${i + 1}.`, M + 1, y);
      const tl = pdf.splitTextToSize(clean(r.title), A4.w - M * 2 - 8); tl.forEach((ln) => { pdf.text(ln, M + 7, y); y += 4.3; });
      if (r.text) para(r.text, 9, INK, "normal", 7, 0.6);
      para(`Basis: ${r.reason}${r.office ? `   ·   Lead: ${r.office}` : ""}`, 8.3, c, "normal", 7, 2.4);
    });

    // households to look out for
    heading("Households to look out for", c);
    para(watch.basis || "", 8.5, MUTED, "normal", 0, 1.5);
    if (watch.error) { para("Household records could not be loaded for this report.", 9.5, [185, 28, 28]); continue; }
    const shown = watch.households || [];
    para(`${(watch.matched || 0).toLocaleString()} of ${(watch.total || 0).toLocaleString()} households match` +
      (watch.matched > shown.length ? ` — the first ${shown.length} by priority are listed below.` : "."), 9.5, INK, "bold", 0, 2);
    if (!shown.length) continue;

    const cols = [["#", 10], ["Household", 23], ["Household head", 38], ["Mem.", 10], ["Needs help", 27], [p.levelCol, 31], ["Why listed", 43]];
    const drawHead = () => {
      pdf.setFillColor(240, 243, 249); pdf.rect(M, y - 4, A4.w - M * 2, 6, "F");
      setText(7.8, "bold", MUTED);
      let x = M + 1.5; cols.forEach(([t, w]) => { pdf.text(t, x, y); x += w; });
      y += 4;
    };
    ensure(14); drawHead();
    shown.forEach((h, i) => {
      const why = (h.reasons || []).join(", ");
      const cells = [String(i + 1), String(h.household_number || "").replace(/^.*?-\s*/, ""), h.head_name || "—", String(h.members ?? ""), h.people || "—", h.level || "", why];
      setText(8, "normal", INK);
      const wrapped = cells.map((t, j) => pdf.splitTextToSize(clean(t), cols[j][1] - 2.5));
      const rowH = Math.max(...wrapped.map((w) => w.length)) * 3.4 + 2;
      if (y + rowH > A4.h - 18) { pdf.addPage(); y = 18; drawHead(); }
      if (i % 2) { pdf.setFillColor(250, 251, 253); pdf.rect(M, y - 1.2, A4.w - M * 2, rowH, "F"); }
      let x = M + 1.5;
      wrapped.forEach((w, j) => {
        setText(8, j === 5 ? "bold" : "normal", INK);
        w.forEach((ln, li) => pdf.text(ln, x, y + 2 + li * 3.4));
        x += cols[j][1];
      });
      y += rowH;
    });
    y += 3;
    para("Household numbers restart in each barangay. Open a household on the Households page to see its members.", 8, MUTED, "italic");
  }

  // ── Footer on every page ───────────────────────────────────────────
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(...LINE); pdf.line(M, A4.h - 13, A4.w - M, A4.h - 13);
    setText(7.2, "normal", MUTED);
    pdf.text(clean(`LGU-SDSS · ${b.barangay_name} · ${dateTxt}`), M, A4.h - 9);
    pdf.text(`Page ${i} of ${n}`, A4.w - M, A4.h - 9, { align: "right" });
    setText(7, "bold", [185, 28, 28]);
    pdf.text("CONFIDENTIAL — contains household heads' names. For LGU use only (RA 10173).", M, A4.h - 5.5);
  }

  const slug = normName(b.barangay_name).replace(/\s+/g, "_") || "barangay";
  const dom = packs.length === 3 ? "all_domains" : packs[0].key;
  pdf.save(`planning_${slug}_${dom}_${today.toISOString().slice(0, 10)}.pdf`);
}
