import { useState, useEffect, Fragment } from "react";
import { getHouseholds, getBarangays, deleteHousehold, deleteHouseholdNoRecalc, recalculateAll, getHouseholdById, getStats, revealHouseholdUid, getImportBatches, getImportBatchDetail, deleteImportBatch } from '../../api/api';
import HouseholdForm from "./HouseholdForm";
import MemberList    from "./MemberList";
import { useTheme }  from "../../hooks/useTheme";
import ImportModal from "./ImportModal";
import { setParam } from "../../hooks/useRoute";

const IconMap      = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>;
const IconHome     = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
const IconUsers    = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconSearch   = ({ color = "#aaa" }) => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IconClock    = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const IconPin      = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconCalendar = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconPerson   = ({ color }) => <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;

// ── Password-gated UID reveal — lock icon + popover, per household row ──
// Re-uses the user's OWN login password (checked server-side via the same
// bcrypt logic as /api/auth/login), NOT a separate admin password. Every
// successful reveal is logged server-side (tbl_uid_reveal_log) for audit.
function RevealUidLock({ householdId, D }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState(null); // { household_number, display_code }

  const close = () => { setOpen(false); setPassword(""); setError(""); };

  const submit = async (e) => {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError("");
    try {
      const r = await revealHouseholdUid(householdId, password);
      setRevealed(r.data);
      setOpen(false);
      setPassword("");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to verify password.");
    } finally {
      setLoading(false);
    }
  };

  if (revealed) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 6 }}>
        <span style={{ fontFamily: "monospace", fontSize: 10.5, color: D.textMuted }}>
          {revealed.household_number}
        </span>
        <button
          type="button"
          title="Hide UID"
          onClick={() => setRevealed(null)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: D.textMuted }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
      </span>
    );
  }

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        title="Reveal internal UID (requires your password)"
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, marginLeft: 5, display: "flex", color: D.textMuted }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "absolute", top: "130%", left: 0, zIndex: 50,
              background: D.cardBg, border: `1px solid ${D.border}`, borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)", padding: 10, width: 210,
            }}
          >
            <form onSubmit={submit}>
              <div style={{ fontSize: 11, fontWeight: 600, color: D.textBody, marginBottom: 6 }}>
                Enter your password to reveal
              </div>
              <input
                type="password" autoFocus value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                style={{
                  width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 6,
                  border: `1px solid ${D.inputBorder}`, background: D.inputBg, color: D.textBody,
                  boxSizing: "border-box", marginBottom: 6,
                }}
              />
              {error && <div style={{ fontSize: 11, color: D.noColor, marginBottom: 6 }}>{error}</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button type="submit" disabled={loading}
                  style={{
                    flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 600, borderRadius: 6,
                    border: "none", background: "#1565c0", color: "#fff", cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.7 : 1,
                  }}>
                  {loading ? "Checking…" : "Confirm"}
                </button>
                <button type="button" onClick={close}
                  style={{
                    padding: "5px 10px", fontSize: 11, borderRadius: 6,
                    border: `1px solid ${D.inputBorder}`, background: "transparent", color: D.textMuted, cursor: "pointer",
                  }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </span>
  );
}

export default function HouseholdList({ initialSearch = "", onClearSearch, intent }) {
  const { dark } = useTheme();

  const D = {
    pageBg:        dark ? "#0d0f14" : "#f5f6fa",
    cardBg:        dark ? "#141720" : "#ffffff",
    subBg:         dark ? "#0f1117" : "#f8f9fc",
    inputBg:       dark ? "#0f1117" : "#ffffff",
    memberRowBg:   dark ? "#0d1120" : "#f0f4ff",
    paginBg:       dark ? "#0f1117" : "#fafbff",
    recentBg:      dark ? "#141720" : "#f8faff",
    border:        dark ? "#1e2235" : "#e3e8f0",
    inputBorder:   dark ? "#1e2235" : "#dddddd",
    divider:       dark ? "#181c2a" : "#f0f0f0",
    memberBorder:  dark ? "#1a2540" : "#bbdefb",
    recentBorder:  dark ? "#1a2540" : "#dbe6fb",
    textPrimary:   dark ? "#5b8dee" : "#1a237e",
    textBody:      dark ? "#8b95a9" : "#333333",
    textMuted:     dark ? "#3d4560" : "#999999",
    textCell:      dark ? "#6b7590" : "#555555",
    rowEven:       dark ? "#141720" : "#ffffff",
    rowOdd:        dark ? "#111420" : "#fafbff",
    rowSelected:   dark ? "#0f1d3d" : "#eef2ff",
    rowHover:      dark ? "#161b2e" : "#f0f4ff",
    stat1Bg:       dark ? "#0e1628" : "#e8f0fe",
    stat1Border:   dark ? "#162040" : "#c5d8fb",
    stat2Bg:       dark ? "#0b1c10" : "#e8f5e9",
    stat2Border:   dark ? "#102818" : "#c8e6c9",
    stat3Bg:       dark ? "#1a1005" : "#fff3e0",
    stat3Border:   dark ? "#281808" : "#ffe0b2",
    yesBg:         dark ? "#0b1c10" : "#e8f5e9",
    yesColor:      dark ? "#4caf7d" : "#2e7d32",
    noBg:          dark ? "#1a0b0b" : "#fce4ec",
    noColor:       dark ? "#e05555" : "#c62828",
    memberBadgeBg: dark ? "#0e1628" : "#e8f0fe",
    noMemberBg:    dark ? "#1a1005" : "#fff3e0",
    shadow:        dark ? "0 1px 8px rgba(0,0,0,0.5)" : "0 1px 3px rgba(0,0,0,0.05)",
  };

  const [households, setHouseholds] = useState([]);
  const [barangays,  setBarangays]  = useState([]);
  const [stats,      setStats]      = useState({ total_barangays:0, total_households:0, total_individuals:0 });
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState(initialSearch);
  const [barangayId, setBarangayId] = useState("");
  const [showForm,   setShowForm]   = useState(false);
  const [editHH,     setEditHH]     = useState(null);
  const [selectedHH, setSelectedHH] = useState(null);
  const [detailLoadingId, setDetailLoadingId] = useState(null);
  const [editLoadingId,   setEditLoadingId]   = useState(null);
  const [showImport, setShowImport] = useState(false);
  const LIMIT = 20;

  // ── Cascade delete: removes all members first, then the household ─────────
  // The server removes the members and everything linked to the household,
  // then recalculates the scores. For a batch, the scores are recalculated
  // once at the end instead of once per household.
  const cascadeDelete = (id, recalc = true) =>
    recalc ? deleteHousehold(id) : deleteHouseholdNoRecalc(id);

  // ── Full-record fetches ─────────────────────────────────────────────────
  // The paginated list row (from getHouseholds) only carries a subset of
  // columns. Detail/Edit need the complete household record, so both fetch
  // fresh via getHouseholdById instead of reusing the trimmed row — this is
  // what actually fixes fields showing blank even though the DB has data.
  const openDetail = async (h) => {
    if (selectedHH?.household_id === h.household_id) { setSelectedHH(null); return; }
    setSelectedHH(h); // show something immediately, then upgrade to the full record
    setDetailLoadingId(h.household_id);
    try {
      const res = await getHouseholdById(h.household_id);
      const full = res.data?.data || res.data || h;
      setSelectedHH(prev => (prev?.household_id === h.household_id ? full : prev));
    } catch {
      // keep the trimmed row if the full fetch fails
    } finally {
      setDetailLoadingId(null);
    }
  };

  const openEdit = async (h) => {
    setEditLoadingId(h.household_id);
    try {
      const res = await getHouseholdById(h.household_id);
      const full = res.data?.data || res.data || h;
      setEditHH(full);
    } catch {
      setEditHH(h); // fall back to the trimmed row rather than blocking the edit entirely
    } finally {
      setEditLoadingId(null);
      setShowForm(true);
    }
  };

  // ── Import batch history (persists across refresh via localStorage) ────────
  const BATCHES_KEY = "sdss_import_batches";

  const loadBatches = () => {
    try { return JSON.parse(localStorage.getItem(BATCHES_KEY) || "[]"); }
    catch { return []; }
  };
  const saveBatches = (batches) => {
    localStorage.setItem(BATCHES_KEY, JSON.stringify(batches));
  };

  const [localBatches, setImportBatches] = useState(() => loadBatches());
  // CBMS 7-file imports are recorded on the server (tbl_import_batches).
  const DISMISSED_KEY = "sdss_dismissed_cbms_batches";
  const loadDismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"); } catch { return []; } };
  const [dismissedServer, setDismissedServer] = useState(() => loadDismissed());
  const saveDismissed = (ids) => { setDismissedServer(ids); try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids)); } catch { /* ignore */ } };
  const [serverBatches, setServerBatches] = useState([]);
  const [batchBusy, setBatchBusy] = useState(null); // batchId being deleted
  const loadServerBatches = () => getImportBatches()
    .then(r => setServerBatches((r.data?.batches || []).map(b => ({
      batchId: `cbms-${b.batch_id}`, serverId: b.batch_id, source: "cbms", ids: [],
      count: b.added, present: b.present, updated: b.updated, removed: b.removed, members: b.members,
      note: b.note, by: b.created_by, importedAt: b.created_at,
    }))))
    .catch(() => setServerBatches([]));
  useEffect(() => { loadServerBatches(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const importBatches = [...serverBatches.filter(b => !dismissedServer.includes(b.serverId)), ...localBatches]
    .sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  const [expandedBatch, setExpandedBatch] = useState(null);   // batchId of open batch
  const [batchHHDetails, setBatchHHDetails] = useState({});   // { batchId: [household, ...] }

  const loadBatchDetails = async (batchId, ids, serverId) => {
    if (batchHHDetails[batchId]) return; // already loaded
    if (serverId) {
      try {
        const r = await getImportBatchDetail(serverId);
        setBatchHHDetails(prev => ({ ...prev, [batchId]: r.data?.per_barangay || [] }));
      } catch { setBatchHHDetails(prev => ({ ...prev, [batchId]: [] })); }
      return;
    }
    try {
      const results = await Promise.all(
        ids.map(id => getHouseholdById(id).then(r => r.data).catch(() => null))
      );
      setBatchHHDetails(prev => ({ ...prev, [batchId]: results.filter(Boolean) }));
    } catch { /* ignore */ }
  };

  const toggleBatchExpand = (batchId, ids, serverId) => {
    if (expandedBatch === batchId) {
      setExpandedBatch(null);
    } else {
      setExpandedBatch(batchId);
      loadBatchDetails(batchId, ids, serverId);
    }
  };

  const handleImported = (importedIds, source = "import") => {
    if (!importedIds.length) return;
    const batch = {
      batchId: Date.now(),
      ids: importedIds,
      count: importedIds.length,
      source, // "import" | "manual"
      importedAt: new Date().toISOString(),
    };
    const updated = [batch, ...loadBatches()].slice(0, 20); // keep last 20 batches
    saveBatches(updated);
    setImportBatches(updated);
    load(); loadStats();
  };

  const handleDeleteServerBatch = async (b) => {
    const n = b.present ?? b.count;
    const ok = window.confirm(
      `Delete this CBMS import batch?\n\n${n.toLocaleString()} household(s) it added, with all their members, will be permanently removed.` +
      (b.updated ? `\n(${b.updated.toLocaleString()} household(s) it only updated are kept as they are.)` : "") +
      `\n\nIf no households are left afterwards, the saved CBMS files and all computed scores are removed too, so you can import again from a clean system.`);
    if (!ok) return;
    setBatchBusy(b.batchId);
    try {
      const r = await deleteImportBatch(b.serverId);
      const d = r.data || {};
      setBatchHHDetails(prev => { const x = { ...prev }; delete x[b.batchId]; return x; });
      await loadServerBatches();
      load(); loadStats();
      alert(d.reset
        ? `Deleted ${d.deleted_households.toLocaleString()} households. No households are left, so the system is back to an empty installation — import the CBMS files again when ready.`
        : `Deleted ${d.deleted_households.toLocaleString()} households. ${d.remaining_households.toLocaleString()} remain; the scores are being recalculated.`);
    } catch (e) {
      alert(`Could not delete the batch: ${e.response?.data?.error || e.message}`);
    } finally { setBatchBusy(null); }
  };

  const handleDeleteBatch = async (batchId) => {
    const sb = serverBatches.find(b => b.batchId === batchId);
    if (sb) return handleDeleteServerBatch(sb);
    const batches = loadBatches();
    const batch = batches.find(b => b.batchId === batchId);
    if (!batch) return;
    const updated = batches.filter(b => b.batchId !== batchId);
    saveBatches(updated);
    setImportBatches(updated);
    let failed = 0;
    for (const id of batch.ids) {
      try { await cascadeDelete(id, false); }
      catch { failed++; }
    }
    try { await recalculateAll(); } catch { /* scores refresh on the next import or change */ }
    load(); loadStats();
    if (failed > 0) alert(`${failed} household(s) could not be deleted. They may have already been removed.`);
  };

  const handleDismissBatch = (batchId) => {
    const sb = serverBatches.find(b => b.batchId === batchId);
    if (sb) { saveDismissed([...dismissedServer, sb.serverId]); return; }
    const updated = loadBatches().filter(b => b.batchId !== batchId);
    saveBatches(updated);
    setImportBatches(updated);
  };

  const handleClearAllBatches = () => {
    saveDismissed(serverBatches.map(b => b.serverId));
    saveBatches([]);
    setImportBatches([]);
  };

  const load = (p=page, s=search, b=barangayId) => {
    getHouseholds({ page:p, limit:LIMIT, search:s||undefined, barangay_id:b||undefined })
      .then(r => { setHouseholds(r.data.data||[]); setTotal(r.data.total||0); })
      .catch(() => { setHouseholds([]); setTotal(0); });
  };
  const loadStats = () => getStats().then(r => setStats(r.data));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [page, barangayId]);
  useEffect(() => {
    getBarangays().then(r => setBarangays(r.data?.data||[]));
    loadStats();
  }, []);

  // Keep the household search in the address so a refresh shows the same list.
  useEffect(() => { setParam("q", search); }, [search]);

  // Omni Search quick actions: open the import or the add-household form.
  useEffect(() => {
    if (intent?.action === "import") setShowImport(true);
    else if (intent?.action === "add") { setEditHH(null); setShowForm(true); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.ts]);

  useEffect(() => {
    if (!initialSearch) return;
    getHouseholds({ page: 1, limit: LIMIT, search: initialSearch })
      .then(r => {
        const data = r.data.data || [];
        setSearch(initialSearch);
        setHouseholds(data);
        setTotal(r.data.total || 0);
        setPage(1);
        if (data.length > 0) setSelectedHH(data[0]);
      })
      .catch(() => { setHouseholds([]); setTotal(0); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearch]);

  const handleSearch   = (e) => { setSearch(e.target.value); setPage(1); load(1, e.target.value, barangayId); };
  const handleBarangay = (e) => { setBarangayId(e.target.value); setPage(1); };
  const handleClear    = () => {
    setSearch(""); setBarangayId(""); setPage(1);
    load(1, "", ""); onClearSearch?.();
  };
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this household and all its members? This cannot be undone.")) return;
    try { await cascadeDelete(id); load(); loadStats(); }
    catch (err) { alert(err.response?.data?.error || "Delete failed"); }
  };
  const handleSaved = (newId) => {
    setShowForm(false); setEditHH(null);
    if (newId && !editHH) handleImported([newId], "manual");
    else { load(); loadStats(); }
  };
  const totalPages = Math.ceil(total / LIMIT);

  const statCards = [
    { icon:<IconMap   color={dark?"#5b8dee":"#1565c0"}/>, value:stats.total_barangays,
      label:"Barangays",         bg:D.stat1Bg, border:D.stat1Border, color:dark?"#5b8dee":"#1565c0" },
    { icon:<IconHome  color={dark?"#4caf7d":"#2e7d32"}/>, value:stats.total_households?.toLocaleString(),
      label:"Total Households",  bg:D.stat2Bg, border:D.stat2Border, color:dark?"#4caf7d":"#2e7d32" },
    { icon:<IconUsers color={dark?"#d4845a":"#e65100"}/>, value:stats.total_individuals?.toLocaleString(),
      label:"Total Individuals", bg:D.stat3Bg, border:D.stat3Border, color:dark?"#d4845a":"#e65100" },
  ];

  const membersBtn = (isSelected) => ({
    padding:"3px 9px", fontSize:11, borderRadius:4,
    cursor:"pointer", fontWeight:500, whiteSpace:"nowrap",
    border: dark
      ? `1px solid ${isSelected ? "#5b8dee55" : "#1e2235"}`
      : `1px solid ${isSelected ? "#90caf9" : "#90caf9"}`,
    background: dark
      ? isSelected ? "#0e1d40" : "transparent"
      : isSelected ? "#1565c0" : "#e8f0fe",
    color: dark
      ? isSelected ? "#5b8dee" : "#4a5a7a"
      : isSelected ? "#fff"    : "#1565c0",
  });
  const editBtn = () => ({
    padding:"3px 9px", fontSize:11, borderRadius:4,
    cursor:"pointer", fontWeight:500, whiteSpace:"nowrap",
    border: dark ? "1px solid #1a2d1a" : "1px solid #a5d6a7",
    background: dark ? "transparent" : "#e8f5e9",
    color:      dark ? "#3d6644"      : "#2e7d32",
  });
  const deleteBtn = () => ({
    padding:"3px 9px", fontSize:11, borderRadius:4,
    cursor:"pointer", fontWeight:500, whiteSpace:"nowrap",
    border: dark ? "1px solid #2d1a1a" : "1px solid #ffcdd2",
    background: dark ? "transparent" : "#fce4ec",
    color:      dark ? "#7a3535"      : "#c62828",
  });
  const pgBtn = (disabled) => ({
    padding:"4px 10px", borderRadius:4, fontSize:11,
    border:`1px solid ${D.inputBorder}`,
    background: "transparent",
    color: disabled ? D.textMuted : D.textCell,
    cursor: disabled ? "not-allowed" : "pointer", whiteSpace:"nowrap",
  });

  return (
    <div style={{ padding:16, background:D.pageBg, minHeight:"100vh",
      fontFamily:"'Segoe UI', sans-serif", boxSizing:"border-box", width:"100%",
      transition:"background 0.25s ease" }}>

      {/* ── Page Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:D.textPrimary }}>
            Master Data Repository
          </h2>
          <div style={{ fontSize:11, color:D.textMuted, marginTop:2 }}>
            Households &amp; Family Records
          </div>
        </div>
        {/* ── Action Buttons ── */}
        <div style={{ display:"flex", gap:8 }}>
          <button
            onClick={() => setShowImport(true)}
            style={{
              padding:"7px 16px", background:"transparent", color:"#1565c0",
              border:"1px solid #1565c0", borderRadius:6, cursor:"pointer",
              fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:6,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="#1565c0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Import CSV / XLSX
          </button>
          <button onClick={() => { setEditHH(null); setShowForm(true); }} style={{
            padding:"7px 16px", background:"#1565c0", color:"#fff",
            border:"none", borderRadius:6, cursor:"pointer", fontWeight:600, fontSize:13,
            boxShadow:"0 2px 5px rgba(21,101,192,0.25)", display:"flex", alignItems:"center", gap:6,
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Household
          </button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div style={{ display:"flex", gap:12, marginBottom:14 }}>
        {statCards.map(s => (
          <div key={s.label} style={{
            flex:1, background:D.cardBg, borderRadius:10,
            padding:"14px 18px", border:`1px solid ${s.border}`,
            boxShadow:D.shadow, display:"flex", alignItems:"center", gap:14,
            transition:"background 0.25s ease",
          }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:s.bg,
              display:"flex", alignItems:"center", justifyContent:"center",
              flexShrink:0, boxShadow:`0 2px 8px ${s.border}` }}>
              {s.icon}
            </div>
            <div>
              <div style={{ fontSize:24, fontWeight:800, color:s.color, lineHeight:1 }}>{s.value}</div>
              <div style={{ fontSize:11, color:D.textMuted, marginTop:3 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Search Bar ── */}
      <div style={{ background:D.cardBg, borderRadius:8, border:`1px solid ${D.border}`,
        padding:"10px 14px", marginBottom:14, boxShadow:D.shadow,
        display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
        transition:"background 0.25s ease" }}>
        <div style={{ position:"relative", flex:1, minWidth:180 }}>
          <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)",
            pointerEvents:"none", display:"flex", alignItems:"center" }}>
            <IconSearch color={D.textMuted}/>
          </span>
          <input placeholder="Search Household No..." value={search} onChange={handleSearch}
            style={{ width:"100%", padding:"7px 10px 7px 30px",
              border:`1px solid ${D.inputBorder}`, borderRadius:6, fontSize:13,
              outline:"none", boxSizing:"border-box",
              background:D.inputBg, color:D.textBody,
              transition:"background 0.25s, color 0.25s" }} />
        </div>
        <select value={barangayId} onChange={handleBarangay} style={{
          padding:"7px 10px", border:`1px solid ${D.inputBorder}`,
          borderRadius:6, fontSize:13, color:D.textBody,
          background:D.inputBg, minWidth:140,
          transition:"background 0.25s, color 0.25s" }}>
          <option value="">All Barangays</option>
          {barangays.map(b => (
            <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>
          ))}
        </select>
        <button onClick={handleClear} style={{
          padding:"7px 14px", border:`1px solid ${D.inputBorder}`,
          borderRadius:6, fontSize:13, background:"transparent",
          cursor:"pointer", color:D.textCell }}>
          Clear
        </button>
        <div style={{ fontSize:11, color:D.textMuted, marginLeft:"auto", whiteSpace:"nowrap" }}>
          Showing {Math.min(households.length, LIMIT)} of {total.toLocaleString()} households
        </div>
      </div>

      {/* ── HouseholdForm Modal ── */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, zIndex:1000,
          background:"rgba(5,7,12,0.7)", backdropFilter:"blur(4px)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
          onClick={e => { if(e.target===e.currentTarget){ setShowForm(false); setEditHH(null); } }}>
          <HouseholdForm existing={editHH} onSaved={handleSaved}
            onCancel={() => { setShowForm(false); setEditHH(null); }} />
        </div>
      )}

      {/* ── Import Modal ── */}
      {showImport && (
        <ImportModal
          barangays={barangays}
          onClose={() => setShowImport(false)}
          onImported={(ids) => {
            setShowImport(false);
            // the CBMS 7-file import returns no id list -- it replaces the data set, so just reload
            if (ids?.length) handleImported(ids, "import"); else { load(); loadStats(); loadServerBatches(); }
          }}
        />
      )}

      {/* ── Table Card ── */}
      <div style={{ background:D.cardBg, borderRadius:10, border:`1px solid ${D.border}`,
        boxShadow:D.shadow, overflow:"hidden", transition:"background 0.25s ease" }}>

        {/* Table header bar */}
        <div style={{ padding:"10px 14px", borderBottom:`1px solid ${D.divider}`,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:700, fontSize:13, color:D.textBody }}>Household Records</span>
          <span style={{ fontSize:11, color:D.textMuted }}>Page {page} of {totalPages||1}</span>
        </div>

        {/* Table */}
        <div style={{ overflowX:"auto", width:"100%" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:D.subBg, borderBottom:`1px solid ${D.border}` }}>
                {["Household No.","Barangay","Housing Material","Tenure",
                  "Water Source","Toilet Type","Electricity","4Ps","Members","Actions"].map(h => (
                  <th key={h} style={{ padding:"9px 10px", textAlign:"left",
                    fontWeight:600, color:D.textMuted, fontSize:11, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {households.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign:"center", padding:32,
                    color:D.textMuted, fontSize:13 }}>No records found.</td>
                </tr>
              ) : households.map((h, idx) => (
                <Fragment key={h.household_id}>
                  <tr
                    style={{
                      background: selectedHH?.household_id===h.household_id
                        ? D.rowSelected
                        : idx%2===0 ? D.rowEven : D.rowOdd,
                      borderBottom:`1px solid ${D.divider}`,
                      transition:"background 0.15s",
                    }}
                    onMouseEnter={e => { if(selectedHH?.household_id!==h.household_id) e.currentTarget.style.background=D.rowHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = selectedHH?.household_id===h.household_id ? D.rowSelected : idx%2===0 ? D.rowEven : D.rowOdd; }}
                  >
                    <td style={{ padding:"9px 10px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center" }}>
                        <span style={{ fontWeight:600, color:D.textPrimary, fontSize:12 }}>
                          {h.household_number}
                        </span>
                        <RevealUidLock householdId={h.household_id} D={D} />
                      </span>
                    </td>
                    <td style={{ padding:"9px 10px", color:D.textCell }}>{h.barangay_name}</td>
                    <td style={{ padding:"9px 10px", color:D.textCell }}>{h.housing_material||"—"}</td>
                    <td style={{ padding:"9px 10px", color:D.textCell }}>{h.tenure_status||"—"}</td>
                    <td style={{ padding:"9px 10px", color:D.textCell }}>{h.water_source||"—"}</td>
                    <td style={{ padding:"9px 10px", color:D.textCell }}>{h.toilet_type||"—"}</td>
                    <td style={{ padding:"9px 10px", textAlign:"center" }}>
                      {h.has_electricity
                        ? <span style={{ background:D.yesBg, color:D.yesColor, borderRadius:4, padding:"2px 7px", fontSize:11 }}>✓ Yes</span>
                        : <span style={{ background:D.noBg,  color:D.noColor,  borderRadius:4, padding:"2px 7px", fontSize:11 }}>✗ No</span>}
                    </td>
                    <td style={{ padding:"9px 10px", textAlign:"center" }}>
                      {h.is_4ps_beneficiary === "Yes"
                        ? <span style={{ background:D.yesBg, color:D.yesColor, borderRadius:4, padding:"2px 7px", fontSize:11 }}>✓ Yes</span>
                        : <span style={{ fontSize:11, color:D.textMuted }}>—</span>}
                    </td>
                    <td style={{ padding:"9px 10px", textAlign:"center" }}>
                      <span style={{ background:D.memberBadgeBg, color:D.textPrimary,
                        borderRadius:10, padding:"2px 9px", fontWeight:700, fontSize:11 }}>
                        {h.member_count}
                      </span>
                    </td>
                    <td style={{ padding:"9px 10px" }}>
                      <div style={{ display:"flex", gap:4 }}>
                        <button
                          onClick={() => openDetail(h)}
                          style={membersBtn(selectedHH?.household_id===h.household_id)}>
                          {selectedHH?.household_id===h.household_id ? "Hide" : detailLoadingId===h.household_id ? "Loading…" : "Members"}
                        </button>
                        <button onClick={() => openEdit(h)} disabled={editLoadingId===h.household_id}
                          style={editBtn()}>{editLoadingId===h.household_id ? "…" : "Edit"}</button>
                        <button onClick={() => handleDelete(h.household_id)}
                          style={deleteBtn()}>Delete</button>
                      </div>
                    </td>
                  </tr>

                  {selectedHH?.household_id===h.household_id && (
                    <tr>
                      <td colSpan="10" style={{ padding:0, background:D.memberRowBg,
                        borderBottom:`1px solid ${D.memberBorder}` }}>
                        <div style={{ padding:"14px 16px" }}>
                          <div style={{ marginBottom:12, padding:"12px 14px", borderRadius:8,
                            background: dark ? "#0a0e1a" : "#fff", border:`1px solid ${D.memberBorder}`,
                            display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))", gap:10 }}>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Monthly Income</div>
                              <div style={{ fontSize:13, fontWeight:700, color:D.textPrimary }}>
                                {h.household_estimated_income ? `₱${Number(h.household_estimated_income).toLocaleString()}` : "—"}
                              </div>
                              <div style={{ fontSize:9, color:D.textMuted }}>{h.income_basis || ""}</div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Food Insecurity</div>
                              <div style={{ fontSize:13, fontWeight:700, color:D.textPrimary }}>
                                {h.food_insecurity_score != null ? `${h.food_insecurity_score} / 8` : "—"}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Vulnerable Members</div>
                              <div style={{ fontSize:13, fontWeight:700, color:D.textPrimary }}>
                                {h.pwd_count ?? 0} PWD · {h.senior_count ?? 0} Senior · {h.solo_parent_count ?? 0} Solo Parent
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Avg. Adult Education</div>
                              <div style={{ fontSize:13, fontWeight:700, color:D.textPrimary }}>
                                {h.avg_education_level_adults != null ? Number(h.avg_education_level_adults).toFixed(1) : "—"}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Employment Rate</div>
                              <div style={{ fontSize:13, fontWeight:700, color:D.textPrimary }}>
                                {h.employment_rate_adults != null ? `${Math.round(h.employment_rate_adults*100)}%` : "—"}
                                <span style={{ fontSize:10, color:D.textMuted, fontWeight:400 }}> ({h.employed_count ?? 0}/{h.working_age_count ?? 0})</span>
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Financial Access</div>
                              <div style={{ fontSize:12 }}>
                                {h.has_formal_financial_account === "Yes" ? "✓ Bank/e-money" : "✗ None"} ·{" "}
                                {h.has_social_insurance === "Yes" ? "✓ Insured" : "✗ Uninsured"}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Disaster Preparedness</div>
                              <div style={{ fontSize:12 }}>
                                {h.knows_evacuation_location === "Yes" ? "✓ Evac" : "✗ Evac"} ·{" "}
                                {h.knows_emergency_hotline === "Yes" ? "✓ Hotline" : "✗ Hotline"}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Overcrowded</div>
                              <div style={{ fontSize:12 }}>{h.overcrowding_status === "True" ? "Yes" : "No"}</div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Hazard Exposure</div>
                              <div style={{ fontSize:13, fontWeight:700, color:D.textPrimary }}>
                                {h.hazard_exposure_score != null ? Number(h.hazard_exposure_score).toFixed(1) : "—"}
                              </div>
                              <div style={{ fontSize:9, color:D.textMuted }}>
                                {h.flood_exposure || "—"} flood · {h.landslide_exposure || "—"} landslide
                                {h.compound_hazard === "Yes" && " · compound"}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Housing Detail</div>
                              <div style={{ fontSize:12 }}>
                                {h.housing_roof || "—"} roof · {h.housing_floor || "—"} floor
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Service Levels</div>
                              <div style={{ fontSize:12 }}>
                                Water: {h.water_service_level || "—"} · Toilet: {h.toilet_service_level || "—"}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Household Size</div>
                              <div style={{ fontSize:13, fontWeight:700, color:D.textPrimary }}>
                                {h.hh_size ?? "—"}
                              </div>
                              <div style={{ fontSize:9, color:D.textMuted }}>
                                {h.dependency_count != null ? `${h.dependency_count} dependents` : ""}
                                {h.dependency_ratio != null ? ` · ratio ${Number(h.dependency_ratio).toFixed(2)}` : ""}
                              </div>
                            </div>

                            <div style={{ gridColumn:"1 / -1" }}>
                              <div style={{ fontSize:10, color:D.textMuted, marginBottom:2 }}>Location / PSGC Codes</div>
                              <div style={{ fontSize:11, color:D.textCell, fontFamily:"monospace" }}>
                                Region {h.region_code || "—"} · Province {h.province_code || "—"} ·
                                {" "}City/Mun {h.city_mun_code || "—"} · Brgy {h.barangay_code || "—"}
                                {h.husn ? ` · HUSN ${h.husn}` : ""}{h.hsn ? ` · HSN ${h.hsn}` : ""}
                                {(h.longitude != null && h.latitude != null)
                                  ? ` · (${Number(h.longitude).toFixed(5)}, ${Number(h.latitude).toFixed(5)})`
                                  : ""}
                              </div>
                            </div>

                          </div>
                          <MemberList household={h} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div style={{ padding:"10px 14px", borderTop:`1px solid ${D.divider}`,
          display:"flex", justifyContent:"space-between", alignItems:"center",
          background:D.paginBg }}>
          <div style={{ fontSize:11, color:D.textMuted }}>
            {total>0
              ? `Showing ${((page-1)*LIMIT)+1}–${Math.min(page*LIMIT,total)} of ${total.toLocaleString()}`
              : "No records"}
          </div>
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            <button onClick={()=>setPage(1)} disabled={page===1} style={pgBtn(page===1)}>First</button>
            <button onClick={()=>setPage(p=>Math.max(p-1,1))} disabled={page===1} style={pgBtn(page===1)}>◀ Prev</button>
            {Array.from({length:Math.min(5,totalPages)},(_,i) => {
              const start = Math.max(1, Math.min(page-2, totalPages-4));
              const p = start+i;
              return p<=totalPages ? (
                <button key={p} onClick={()=>setPage(p)} style={{
                  padding:"4px 9px", borderRadius:4, fontSize:11, minWidth:28,
                  border:`1px solid ${p===page ? "#1565c0" : D.inputBorder}`,
                  background: p===page ? "#1565c0" : "transparent",
                  color:      p===page ? "#fff"    : D.textCell,
                  cursor:"pointer", fontWeight: p===page ? 700 : 400,
                }}>{p}</button>
              ) : null;
            })}
            <button onClick={()=>setPage(p=>Math.min(p+1,totalPages))} disabled={page>=totalPages} style={pgBtn(page>=totalPages)}>Next ▶</button>
            <button onClick={()=>setPage(totalPages)} disabled={page>=totalPages} style={pgBtn(page>=totalPages)}>Last</button>
          </div>
        </div>
      </div>

      {/* ── Import Batch History ── */}
      {importBatches.length > 0 && (
        <div style={{ background:D.cardBg, borderRadius:10, border:`1px solid ${D.border}`,
          padding:"12px 16px", marginTop:14, boxShadow:D.shadow,
          transition:"background 0.25s ease" }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11,
              fontWeight:700, color:D.textMuted, textTransform:"uppercase", letterSpacing:0.5 }}>
              <IconClock color={D.textPrimary}/> Recent Import Batches
              <span style={{ background:D.memberBadgeBg, color:D.textPrimary,
                borderRadius:8, padding:"1px 7px", fontSize:10, fontWeight:700 }}>
                {importBatches.length}
              </span>
            </div>
            <button onClick={handleClearAllBatches} style={{
              fontSize:10, padding:"3px 9px", borderRadius:5, cursor:"pointer",
              background:"transparent", border:`1px solid ${D.inputBorder}`,
              color:D.textMuted }}>
              Clear History
            </button>
          </div>

          {/* Batch list */}
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {importBatches.map((batch, i) => (
              <Fragment key={batch.batchId}>
              <div style={{
                display:"flex", alignItems:"center", justifyContent:"space-between",
                gap:12, padding:"9px 13px", borderRadius:8,
                background: i === 0
                  ? (dark ? "#0d1c10" : "#f0faf2")
                  : (dark ? D.recentBg : D.recentBg),
                border:`1px solid ${i === 0
                  ? (dark ? "#1a4022" : "#a5d6a7")
                  : D.recentBorder}`,
                animation: i === 0 ? "fadeIn 0.2s ease" : "none",
              }}>
                {/* Left — batch info */}
                <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", flex:1, minWidth:0 }}>
                  {/* Source badge */}
                  {batch.source === "cbms"
                    ? <span style={{ display:"flex", alignItems:"center", gap:4,
                        fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:4,
                        background: dark?"#0b1f1c":"#e0f2f1", color: dark?"#4db6ac":"#00695c",
                        border:`1px solid ${dark?"#164a44":"#80cbc4"}`, whiteSpace:"nowrap" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/>
                        </svg>
                        CBMS Import (7 files)
                      </span>
                    : batch.source === "import"
                    ? <span style={{ display:"flex", alignItems:"center", gap:4,
                        fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:4,
                        background: dark?"#0b1628":"#e8f0fe", color: dark?"#5b8dee":"#1565c0",
                        border:`1px solid ${dark?"#1a2d50":"#c5d8fb"}`, whiteSpace:"nowrap" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        CSV Import
                      </span>
                    : <span style={{ display:"flex", alignItems:"center", gap:4,
                        fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:4,
                        background: dark?"#100b1a":"#f3e8ff", color: dark?"#b07de8":"#7b1fa2",
                        border:`1px solid ${dark?"#2d1a50":"#ce93d8"}`, whiteSpace:"nowrap" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                        </svg>
                        Manual Add
                      </span>
                  }

                  {/* Count */}
                  <span style={{ fontWeight:700, fontSize:12,
                    color: i===0 ? (dark?"#4caf7d":"#2e7d32") : D.textPrimary }}>
                    {(batch.source === "cbms" ? (batch.present ?? batch.count) : batch.count).toLocaleString()} household{batch.count!==1?"s":""}{batch.source === "cbms" ? " added" : ""}
                  </span>
                  {batch.source === "cbms" && (
                    <span style={{ fontSize:11, color:D.textMuted }}>
                      {[batch.members ? `${batch.members.toLocaleString()} members` : null,
                        batch.updated ? `${batch.updated.toLocaleString()} updated` : null,
                        batch.removed ? `${batch.removed.toLocaleString()} removed` : null,
                        batch.by ? `by ${batch.by}` : null].filter(Boolean).join(" · ")}
                    </span>
                  )}

                  {/* Timestamp */}
                  <span style={{ fontSize:11, color:D.textMuted,
                    display:"flex", alignItems:"center", gap:3 }}>
                    <IconClock color={D.textMuted}/>
                    {new Date(batch.importedAt).toLocaleString()}
                  </span>

                  {/* Latest badge */}
                  {i === 0 && (
                    <span style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:4,
                      background: dark?"#0b1f0e":"#c8f0d2", color: dark?"#4caf7d":"#1b5e20",
                      border:`1px solid ${dark?"#1a4022":"#81c784"}` }}>
                      LATEST
                    </span>
                  )}
                </div>

                {/* Right — actions */}
                <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                  <button onClick={() => toggleBatchExpand(batch.batchId, batch.ids, batch.serverId)} style={{
                    padding:"5px 12px", borderRadius:5, fontSize:11, fontWeight:600,
                    cursor:"pointer", border:`1px solid ${dark?"#1a2d50":"#c5d8fb"}`,
                    background: dark?"#0b1628":"#e8f0fe", color: dark?"#5b8dee":"#1565c0",
                    display:"flex", alignItems:"center", gap:4,
                  }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {expandedBatch === batch.batchId
                        ? <><polyline points="18 15 12 9 6 15"/></>
                        : <><polyline points="6 9 12 15 18 9"/></>}
                    </svg>
                    {expandedBatch === batch.batchId ? "Hide" : "View"}
                  </button>
                  <button onClick={() => handleDeleteBatch(batch.batchId)}
                    disabled={!!batchBusy || (batch.source === "cbms" && !(batch.present ?? batch.count))}
                    title={batch.source === "cbms" && !(batch.present ?? batch.count) ? "This import added no households (it only updated existing ones)" : "Delete the households this batch added"}
                    style={{
                    padding:"5px 12px", borderRadius:5, fontSize:11, fontWeight:600,
                    cursor: batchBusy ? "wait" : "pointer", border:"none", background:"#c62828", color:"#fff",
                    opacity: (batchBusy && batchBusy !== batch.batchId) || (batch.source === "cbms" && !(batch.present ?? batch.count)) ? 0.5 : 1,
                    display:"flex", alignItems:"center", gap:4,
                  }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
                    </svg>
                    {batchBusy === batch.batchId ? "Deleting…" : "Delete Batch"}
                  </button>
                  <button onClick={() => handleDismissBatch(batch.batchId)} style={{
                    padding:"4px 9px", borderRadius:5, fontSize:11,
                    cursor:"pointer", background:"transparent",
                    border:`1px solid ${D.inputBorder}`, color:D.textMuted,
                  }}>✕</button>
                </div>
              </div>

              {/* ── Expanded household list ── */}
              {expandedBatch === batch.batchId && (
                <div style={{
                  marginTop:6, borderRadius:6, overflow:"hidden",
                  border:`1px solid ${dark?"#1a2540":"#dbe6fb"}`,
                }}>
                  {batch.source === "cbms" ? (
                    !batchHHDetails[batch.batchId] ? (
                      <div style={{ padding:"10px 14px", fontSize:11, color:D.textMuted }}>Loading...</div>
                    ) : batchHHDetails[batch.batchId].length === 0 ? (
                      <div style={{ padding:"10px 14px", fontSize:11, color:D.textMuted }}>None of this batch's households are in the system any more.</div>
                    ) : (
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                        <thead>
                          <tr style={{ background: dark?"#0b1420":"#eef2ff" }}>
                            {["Barangay","Households added","Members"].map(h => (
                              <th key={h} style={{ padding:"6px 10px", textAlign:"left", fontWeight:600,
                                color:D.textMuted, borderBottom:`1px solid ${dark?"#1a2540":"#dbe6fb"}` }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {batchHHDetails[batch.batchId].map((r, ri) => (
                            <tr key={r.barangay} style={{ background: ri%2===0 ? (dark?"#0d1120":"#fff") : (dark?"#0a0e1a":"#f8faff") }}>
                              <td style={{ padding:"6px 10px", fontWeight:600, color:D.textPrimary }}>{r.barangay}</td>
                              <td style={{ padding:"6px 10px", color:D.textCell }}>{r.households.toLocaleString()}</td>
                              <td style={{ padding:"6px 10px", color:D.textCell }}>{r.members.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : !batchHHDetails[batch.batchId] ? (
                    <div style={{ padding:"10px 14px", fontSize:11, color:D.textMuted }}>Loading...</div>
                  ) : batchHHDetails[batch.batchId].length === 0 ? (
                    <div style={{ padding:"10px 14px", fontSize:11, color:D.textMuted }}>No details found — households may have been deleted.</div>
                  ) : (
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                      <thead>
                        <tr style={{ background: dark?"#0b1420":"#eef2ff" }}>
                          {["Household No.","Barangay","Housing","Tenure","Water","Electricity","Members"].map(h => (
                            <th key={h} style={{ padding:"6px 10px", textAlign:"left", fontWeight:600,
                              color:D.textMuted, borderBottom:`1px solid ${dark?"#1a2540":"#dbe6fb"}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {batchHHDetails[batch.batchId].map((hh, hi) => (
                          <tr key={hh.household_id}
                            style={{ background: hi%2===0 ? (dark?"#0d1120":"#fff") : (dark?"#0a0e1a":"#f8faff"),
                              cursor:"pointer" }}
                            onClick={() => setSelectedHH(selectedHH?.household_id===hh.household_id ? null : hh)}>
                            <td style={{ padding:"6px 10px", fontWeight:600, color:D.textPrimary }}>{hh.household_number}</td>
                            <td style={{ padding:"6px 10px", color:D.textCell }}>{hh.barangay_name||"—"}</td>
                            <td style={{ padding:"6px 10px", color:D.textCell }}>{hh.housing_material||"—"}</td>
                            <td style={{ padding:"6px 10px", color:D.textCell }}>{hh.tenure_status||"—"}</td>
                            <td style={{ padding:"6px 10px", color:D.textCell }}>{hh.water_source||"—"}</td>
                            <td style={{ padding:"6px 10px", textAlign:"center" }}>
                              {hh.has_electricity
                                ? <span style={{ background:D.yesBg, color:D.yesColor, borderRadius:4, padding:"1px 6px" }}>✓ Yes</span>
                                : <span style={{ background:D.noBg,  color:D.noColor,  borderRadius:4, padding:"1px 6px" }}>✗ No</span>}
                            </td>
                            <td style={{ padding:"6px 10px", textAlign:"center" }}>
                              <span style={{ background:D.memberBadgeBg, color:D.textPrimary,
                                borderRadius:8, padding:"1px 7px", fontWeight:700 }}>
                                {hh.member_count ?? "—"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}