// A thin bar above every page that guides a fresh installation:
//   no households yet          -> "Import the CBMS files" (opens the import)
//   import / recalculation on  -> live progress, checked every few seconds
//   recalculation just ended   -> "Show the new results" (reloads the page)
// Hidden when the system has data and nothing is running.
import { useEffect, useRef, useState } from "react";
import { getDataStatus } from "../api/api";

export default function DataStatusBanner({ tab, onImport, dark }) {
  const [st, setSt] = useState(null);
  const [justDone, setJustDone] = useState(false);
  const wasRunning = useRef(false);

  useEffect(() => {
    let alive = true, timer = null;
    const check = () => getDataStatus().then((r) => {
      if (!alive) return;
      const d = r.data || {};
      const running = !!d.job?.running;
      if (wasRunning.current && !running) setJustDone(true);
      wasRunning.current = running;
      setSt(d);
      // keep watching while an import runs, and while the system is empty
      // (so an import started from the Households page shows up here too)
      if (running || d.households === 0 || (d.households > 0 && !d.results_ready)) timer = setTimeout(check, 3000);
    }).catch(() => {});
    check();
    return () => { alive = false; clearTimeout(timer); };
  }, [tab]);

  if (!st) return null;
  const job = st.job;
  const running = job?.running;
  const empty = st.households === 0;
  const missing = !empty && !st.results_ready && !running;
  if (!running && !justDone && !empty && !missing) return null;

  const tone = running ? { bg: dark ? "#0f1e3d" : "#eff6ff", bd: dark ? "#1e3a8a" : "#bfdbfe", fg: dark ? "#bfdbfe" : "#1e3a8a", ac: "#2563eb" }
    : justDone ? { bg: dark ? "#0b2a1a" : "#f0fdf4", bd: dark ? "#166534" : "#bbf7d0", fg: dark ? "#bbf7d0" : "#14532d", ac: "#16a34a" }
    : { bg: dark ? "#2a1f08" : "#fffbeb", bd: dark ? "#854d0e" : "#fde68a", fg: dark ? "#fde68a" : "#78350f", ac: "#d97706" };
  const pct = job?.total_steps ? Math.round((job.done_steps / job.total_steps) * 100) : 0;

  const btn = (label, onClick) => (
    <button onClick={onClick} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: tone.ac, color: "#fff",
      fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>
  );

  return (
    <div role="status" style={{ margin: "12px 20px 0", padding: "11px 16px", borderRadius: 10, background: tone.bg,
      border: `1px solid ${tone.bd}`, color: tone.fg, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        {running ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 800 }}>
              {job.kind === "import" ? "Importing the CBMS files and recalculating" : "Recalculating the scores"} — step {Math.min(job.done_steps + 1, job.total_steps)} of {job.total_steps}
            </div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>{job.current || "Starting …"} · you can keep using the system; the pages fill in when it finishes.</div>
            <div style={{ height: 5, borderRadius: 3, background: dark ? "#1e293b" : "#dbeafe", marginTop: 7, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: tone.ac, transition: "width 0.6s" }} />
            </div>
          </>
        ) : justDone ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{job?.state === "done" ? "The recalculation has finished." : "The recalculation finished with some problems."}</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>
              {job?.state === "done" ? "Reload to show the new scores on this page." : (job?.error || "Open Households → Import CBMS files to see which step failed.")}
            </div>
          </>
        ) : empty ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 800 }}>No CBMS data has been imported yet</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>
              Import the CBMS 2024 files (household, person and barangay records — CSV or Excel). The system then computes every score; the pages fill in when it finishes.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 800 }}>The scores have not been calculated yet</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>Import the CBMS files again to run the calculation.</div>
          </>
        )}
      </div>
      {!running && justDone && btn("Show the new results", () => window.location.reload())}
      {!running && !justDone && btn("Import CBMS files", onImport)}
    </div>
  );
}
