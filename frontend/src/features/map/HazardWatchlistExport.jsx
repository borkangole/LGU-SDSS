// ============================================================
// HazardWatchlistExport.jsx -- "Hazard Watch List" on the Map page.
//
// Lists every household in the chosen hazard bands (default: Very High
// flood), grouped by barangay, so DRRM / barangay staff know which homes to
// check first before and during a flood. Inside each barangay, households
// with the most members who need help (seniors, PWDs, children under 5)
// come first, then those that don't know their evacuation site.
//
// Flood and landslide levels are listed separately, never added together.
// Output: PDF (printable, one section per barangay) or Excel (sortable).
// Contains names of household heads -> marked confidential (RA 10173).
// ============================================================
import { useEffect, useRef, useState } from "react";
import { getHazardWatchlist } from "../../api/api";

const OPTIONS = [
  { key: "flood:Very High", label: "Flood — Very High", hint: "highest flood band", def: true },
  { key: "flood:High", label: "Flood — High", hint: "next band down", def: false },
  { key: "landslide:High", label: "Landslide — High", hint: "highest landslide band", def: false },
];

const today = () => new Date().toISOString().slice(0, 10);
const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : "—");
const coords = (h) => (h.latitude != null && h.longitude != null ? `${h.latitude.toFixed(5)}, ${h.longitude.toFixed(5)}` : "—");
const hazardText = (h) => [h.flood && `Flood ${h.flood}`, h.landslide && `Landslide ${h.landslide}`].filter(Boolean).join(" · ") || "—";
const levelText = (levels) => [...levels.flood.map((l) => `Flood ${l}`), ...levels.landslide.map((l) => `Landslide ${l}`)].join(", ");
const needs = (h) => [h.seniors && `${h.seniors} senior${h.seniors > 1 ? "s" : ""}`, h.pwd && `${h.pwd} PWD`,
  h.under5 && `${h.under5} child${h.under5 > 1 ? "ren" : ""} <5`, h.solo_parents && `${h.solo_parents} solo parent${h.solo_parents > 1 ? "s" : ""}`]
  .filter(Boolean).join(", ") || "—";

// ── PDF ──────────────────────────────────────────────────────────────────
async function buildPdf(data) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 12, CW = W - 2 * M;
  const date = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  const levels = levelText(data.levels);
  let page = 1;
  const txt = (c) => pdf.setTextColor(c[0], c[1], c[2]);

  const header = () => {
    pdf.setFillColor(127, 29, 29); pdf.rect(0, 0, W, 3.5, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); txt([120, 130, 150]);
    pdf.text("LGU-SDSS · MUNICIPALITY OF SAN MIGUEL, ILOILO · HAZARD WATCH LIST", M, 9.5);
    pdf.text("CONFIDENTIAL — contains personal data (RA 10173)", W - M, 9.5, { align: "right" });
  };
  const footer = () => {
    pdf.setDrawColor(214, 222, 232); pdf.setLineWidth(0.2); pdf.line(M, H - 10, W - M, H - 10);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); txt([148, 163, 184]);
    pdf.text(`Generated ${date} · Source: CBMS 2024 household locations against the LGU flood/landslide hazard maps · Levels: ${levels}`, M, H - 6);
    pdf.text(`Page ${page}`, W - M, H - 6, { align: "right" });
  };
  const newPage = () => { footer(); pdf.addPage(); page += 1; header(); return 16; };

  // ── Page 1: summary ──
  header();
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); txt([15, 23, 42]);
  pdf.text("Hazard Watch List", M, 20);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); txt([71, 85, 105]);
  pdf.text(`Households in: ${levels}. Grouped by barangay; within each barangay, households with the most members who need help come first.`, M, 26, { maxWidth: CW });

  const kpis = [
    [data.total_households.toLocaleString(), "households to watch"],
    [data.total_people.toLocaleString(), "people living in them"],
    [data.total_needing_help.toLocaleString(), "seniors, PWDs and children under 5"],
    [data.total_no_evacuation_site.toLocaleString(), "households that don't know their evacuation site"],
  ];
  const kw = (CW - 9) / 4;
  kpis.forEach(([v, l], i) => {
    const x = M + i * (kw + 3);
    pdf.setFillColor(254, 242, 242); pdf.setDrawColor(254, 202, 202); pdf.roundedRect(x, 31, kw, 17, 1.5, 1.5, "FD");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); txt([153, 27, 27]); pdf.text(v, x + 4, 40);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); txt([100, 116, 139]); pdf.text(l, x + 4, 45, { maxWidth: kw - 6 });
  });

  // summary table
  let y = 58;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); txt([15, 23, 42]); pdf.text("Summary by barangay", M, y); y += 4;
  const sCols = [["#", 8], ["Barangay", 60], ["Households", 26], ["People", 22], ["Seniors / PWDs / children <5", 48], ["Don't know evacuation site", 46]];
  const sTot = sCols.reduce((s, c) => s + c[1], 0); const sW = sCols.map((c) => c[1] / sTot * (CW * 0.78));
  const sHead = () => {
    pdf.setFillColor(127, 29, 29); pdf.rect(M, y, sW.reduce((a, b) => a + b, 0), 6.5, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); pdf.setTextColor(255, 255, 255);
    let x = M; sCols.forEach((c, i) => { pdf.text(c[0], x + 1.5, y + 4.3); x += sW[i]; }); y += 6.5;
  };
  sHead();
  data.barangays.forEach((g, i) => {
    if (y > H - 18) { y = newPage(); sHead(); }
    if (i % 2) { pdf.setFillColor(248, 250, 252); pdf.rect(M, y, sW.reduce((a, b) => a + b, 0), 5.5, "F"); }
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); txt([31, 41, 55]);
    const cells = [i + 1, g.barangay, g.households, g.people, g.members_needing_help, g.no_evacuation_site];
    let x = M; cells.forEach((c, ci) => { pdf.text(String(c), x + 1.5, y + 3.9); x += sW[ci]; });
    y += 5.5;
  });

  // ── One section per barangay ──
  const cols = [["#", 6], ["Household ID", 30], ["Household head", 38], ["Hazard level", 30], ["Members", 13],
    ["Needs help first", 50], ["Evac. site?", 17], ["Hotline?", 14], ["Household type", 38], ["GPS location", 30]];
  const tot = cols.reduce((s, c) => s + c[1], 0); const cw = cols.map((c) => c[1] / tot * CW);
  const tHead = () => {
    pdf.setFillColor(30, 41, 59); pdf.rect(M, y, CW, 6.5, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.3); pdf.setTextColor(255, 255, 255);
    let x = M; cols.forEach((c, i) => { pdf.text(c[0], x + 1.3, y + 4.3); x += cw[i]; }); y += 6.5;
  };
  data.barangays.forEach((g) => {
    y = newPage();
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); txt([15, 23, 42]); pdf.text(g.barangay, M, y + 4);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); txt([100, 116, 139]);
    pdf.text(`${g.households} households · ${g.people} people · ${g.members_needing_help} seniors/PWDs/children under 5 · ${g.no_evacuation_site} don't know their evacuation site`, M, y + 9.5);
    y += 13; tHead();
    g.rows.forEach((h, i) => {
      const cells = [i + 1, h.household_number, h.head_name || "—", hazardText(h), h.members, needs(h),
        yesNo(h.knows_evacuation_site), yesNo(h.knows_hotline), h.household_type || "—", coords(h)]
        .map((v, ci) => pdf.splitTextToSize(String(v ?? "—"), cw[ci] - 2.6));
      const rh = Math.max(...cells.map((c) => c.length)) * 3.4 + 2.4;
      if (y + rh > H - 13) { y = newPage(); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); txt([15, 23, 42]); pdf.text(`${g.barangay} (continued)`, M, y + 2); y += 5; tHead(); }
      if (i % 2) { pdf.setFillColor(248, 250, 252); pdf.rect(M, y, CW, rh, "F"); }
      let x = M;
      cells.forEach((lines, ci) => {
        pdf.setFont("helvetica", ci === 1 ? "bold" : "normal"); pdf.setFontSize(7.6);
        const warn = (ci === 6 && h.knows_evacuation_site === false) || (ci === 5 && h.members_needing_help > 0);
        txt(warn ? [185, 28, 28] : [31, 41, 55]);
        pdf.text(lines, x + 1.3, y + 3.6); x += cw[ci];
      });
      y += rh;
    });
  });
  footer();
  pdf.save(`hazard_watch_list_${today()}.pdf`);
}

// ── Excel ────────────────────────────────────────────────────────────────
async function buildExcel(data) {
  const XLSX = await import("xlsx");
  const rows = [];
  data.barangays.forEach((g) => g.rows.forEach((h, i) => rows.push({
    "Barangay": g.barangay, "Order in barangay": i + 1, "Household ID": h.household_number, "Household head": h.head_name || "",
    "Flood level": h.flood || "", "Landslide level": h.landslide || "", "Members": h.members,
    "Seniors (60+)": h.seniors, "PWDs": h.pwd, "Children under 5": h.under5, "Solo parents": h.solo_parents,
    "Members needing help first": h.members_needing_help,
    "Knows evacuation site": yesNo(h.knows_evacuation_site), "Knows emergency hotline": yesNo(h.knows_hotline),
    "Household type": h.household_type || "", "Latitude": h.latitude, "Longitude": h.longitude,
  })));
  const summary = data.barangays.map((g, i) => ({
    "#": i + 1, "Barangay": g.barangay, "Households": g.households, "People": g.people,
    "Seniors / PWDs / children under 5": g.members_needing_help, "Don't know evacuation site": g.no_evacuation_site,
  }));
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.sheet_add_aoa(ws1, [[], [`Levels: ${levelText(data.levels)}`], ["CONFIDENTIAL — contains personal data (RA 10173)"]], { origin: -1 });
  ws1["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 11 }, { wch: 9 }, { wch: 30 }, { wch: 26 }];
  const ws2 = XLSX.utils.json_to_sheet(rows);
  ws2["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 24 }, { wch: 26 }, { wch: 11 }, { wch: 13 }, { wch: 9 }, { wch: 11 }, { wch: 7 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 11 }, { wch: 11 }];
  ws2["!autofilter"] = { ref: ws2["!ref"] };
  XLSX.utils.book_append_sheet(wb, ws1, "By barangay");
  XLSX.utils.book_append_sheet(wb, ws2, "Watch list");
  XLSX.writeFile(wb, `hazard_watch_list_${today()}.xlsx`);
}

// ── Button + menu ────────────────────────────────────────────────────────
export default function HazardWatchlistExport({ dark = false, autoOpenKey = null }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set(OPTIONS.filter((o) => o.def).map((o) => o.key)));
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);

  // Opened from Omni Search ("Hazard Watch List"): open the menu once the
  // button is on screen.
  useEffect(() => {
    if (!autoOpenKey) return;
    const t = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) { setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) }); setOpen(true); }
    }, 350);
    return () => clearTimeout(t);
  }, [autoOpenKey]);

  useEffect(() => {
    const close = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const run = async (kind) => {
    if (!picked.size) { setMsg("Pick at least one hazard level."); return; }
    setBusy(kind); setMsg(null);
    try {
      const { data } = await getHazardWatchlist([...picked].join(","));
      if (!data.total_households) { setMsg("No households are in the selected hazard levels."); return; }
      if (kind === "pdf") await buildPdf(data); else await buildExcel(data);
      setOpen(false);
    } catch (e) {
      setMsg(`Export failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const panel = dark ? { bg: "#111827", border: "#1f2937", text: "#e5e7eb", muted: "#9ca3af" } : { bg: "#fff", border: "#e5e7eb", text: "#111827", muted: "#6b7280" };
  const btn = (primary) => ({
    flex: 1, padding: "8px 10px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer",
    border: primary ? "none" : `1px solid ${panel.border}`, background: primary ? "#b91c1c" : "transparent", color: primary ? "#fff" : panel.text,
  });

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => {
          // The map header clips overflowing children, so the menu is drawn
          // with position:fixed right under the button instead.
          const r = ref.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          setOpen((o) => !o);
        }} title="Households in the highest hazard bands, grouped by barangay"
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
          border: "0.5px solid rgba(220,38,38,0.35)", background: "rgba(220,38,38,0.10)", color: "#dc2626", cursor: "pointer",
        }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" />
        </svg>
        Hazard Watch List
      </button>
      {open && pos && (
        <div ref={menuRef} style={{
          position: "fixed", right: pos.right, top: pos.top, zIndex: 5000, width: 300, padding: 14, borderRadius: 10,
          background: panel.bg, border: `1px solid ${panel.border}`, boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: panel.text, marginBottom: 3 }}>Hazard Watch List</div>
          <div style={{ fontSize: 11, color: panel.muted, lineHeight: 1.5, marginBottom: 10 }}>
            Households to check first, grouped by barangay — those with seniors, PWDs or small children listed first.
          </div>
          {OPTIONS.map((o) => (
            <label key={o.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer", fontSize: 12, color: panel.text }}>
              <input type="checkbox" checked={picked.has(o.key)} onChange={() => setPicked((s) => {
                const n = new Set(s); if (n.has(o.key)) n.delete(o.key); else n.add(o.key); return n;
              })} />
              <span style={{ fontWeight: 600 }}>{o.label}</span>
              <span style={{ color: panel.muted, fontSize: 10.5 }}>{o.hint}</span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={btn(true)} disabled={!!busy} onClick={() => run("pdf")}>{busy === "pdf" ? "Preparing…" : "Download PDF"}</button>
            <button style={btn(false)} disabled={!!busy} onClick={() => run("xlsx")}>{busy === "xlsx" ? "Preparing…" : "Excel"}</button>
          </div>
          {msg && <div style={{ marginTop: 8, fontSize: 11, color: "#b91c1c" }}>{msg}</div>}
          <div style={{ marginTop: 10, fontSize: 10, color: panel.muted, lineHeight: 1.45 }}>
            Includes household heads' names — confidential, for LGU use only (RA 10173).
          </div>
        </div>
      )}
    </div>
  );
}
