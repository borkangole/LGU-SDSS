import { useEffect, useRef, useState } from "react";
import { cbmsImportCommit, cbmsImportPreview, cbmsImportStatus } from "../../api/api";

// One-step import of the 7 CBMS 2024 files. The server recognises each file
// by its columns, lines them up on their uuid, shows what will change, and
// after confirmation saves everything and recalculates every score.

const EXPECTED = [
  { kind: "household",       label: "Household record",           file: "cbms_household_record.csv",               required: true },
  { kind: "person",          label: "Person record",              file: "cbms_person_record.csv",                  required: true },
  { kind: "barangay",        label: "Barangay profile",           file: "cbms_barangay_record.csv",                required: true },
  { kind: "barangay_list",   label: "Barangay lists (puroks / sitios)", file: "cbms_barangay_record_list.csv" },
  { kind: "interview",       label: "Interview visits",           file: "cbms_interview_record.csv" },
  { kind: "child_mortality", label: "Child mortality",            file: "cbms_household_record_child_mortality.csv" },
  { kind: "tvet",            label: "Person TVET courses",        file: "cbms_person_record_tvet.csv" },
];

const C = {
  text: "#1a237e", sub: "#455a90", muted: "#8892a8", border: "#e3e8f4", soft: "#f8faff",
  blue: "#1565c0", green: "#2e7d32", greenBg: "#e8f5e9", amber: "#b26a00", amberBg: "#fff8e1",
  red: "#c62828", redBg: "#fdecea",
};

const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString());
const kb = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Dot({ state }) {
  const map = {
    ok: [C.green, "✓"], done: [C.green, "✓"], warn: [C.amber, "!"], failed: [C.red, "✕"],
    missing: [C.muted, "–"], pending: ["#b0b8cc", ""], skipped: [C.muted, "–"], running: [C.blue, ""],
  };
  const [color, ch] = map[state] || map.pending;
  if (state === "running") {
    return <span className="cbi-spin" style={{ width: 14, height: 14, borderRadius: "50%",
      border: `2px solid ${C.blue}33`, borderTopColor: C.blue, display: "inline-block", flexShrink: 0 }} />;
  }
  return (
    <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, display: "inline-flex",
      alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff",
      background: state === "pending" ? "transparent" : color,
      border: state === "pending" ? `1.5px solid ${color}` : "none" }}>{ch}</span>
  );
}

function Stat({ value, label, tone }) {
  return (
    <div style={{ flex: "1 1 120px", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px",
      background: "#fff" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: tone || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

const btn = (primary, disabled) => ({
  padding: "9px 20px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: disabled ? "default" : "pointer",
  border: primary ? "none" : "1px solid #dce3f0", opacity: disabled ? 0.5 : 1,
  background: primary ? "linear-gradient(135deg, #1a237e, #1565c0)" : "#fff",
  color: primary ? "#fff" : C.sub,
});

export default function CbmsImport({ onClose, onDone, onStageChange }) {
  const [files, setFiles] = useState([]);           // File objects
  const [stage, setStage] = useState("pick");       // pick | checking | preview | running | finished
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [removeMissing, setRemoveMissing] = useState(true);
  const [job, setJob] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearTimeout(pollRef.current), []);
  useEffect(() => { onStageChange?.(stage); }, [stage, onStageChange]);

  const addFiles = (list) => {
    const incoming = Array.from(list || []).filter((f) => /\.(csv|xlsx|xls)$/i.test(f.name));
    if (!incoming.length) return;
    const byName = new Map(files.map((f) => [f.name, f]));
    incoming.forEach((f) => byName.set(f.name, f));
    const next = Array.from(byName.values());
    setFiles(next);
    check(next);
  };

  const removeFile = (name) => {
    const next = files.filter((f) => f.name !== name);
    setFiles(next);
    setPreview(null);
    if (next.length) check(next); else setStage("pick");
  };

  async function check(list) {
    setError("");
    setStage("checking");
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f, f.name));
    try {
      const res = await cbmsImportPreview(fd);
      setPreview(res.data);
      setStage("preview");
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Could not check the files.");
      setStage("pick");
    }
  }

  async function commit() {
    setError("");
    try {
      const res = await cbmsImportCommit(preview.token, removeMissing);
      setStage("running");
      poll(res.data.job_id);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Could not start the import.");
    }
  }

  function poll(id) {
    cbmsImportStatus(id)
      .then((res) => {
        setJob(res.data);
        if (["running", "queued"].includes(res.data.state)) pollRef.current = setTimeout(() => poll(id), 1500);
        else setStage("finished");
      })
      .catch(() => { pollRef.current = setTimeout(() => poll(id), 3000); });
  }

  // ── derived ────────────────────────────────────────────────────────────
  const detected = {};
  (preview?.files || []).forEach((f) => { if (f.status === "ok") detected[f.kind] = f; });
  const extras = (preview?.files || []).filter((f) => f.status !== "ok");
  const checks = preview?.alignment?.checks || [];
  const blocking = preview?.alignment?.blocking || [];
  const db = preview?.database;
  const sum = preview?.summary;
  const canImport = stage === "preview" && preview?.ready && !error;
  const unmatched = db?.unmatched_barangays || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <style>{`.cbi-spin{animation:cbiSpin .8s linear infinite}@keyframes cbiSpin{to{transform:rotate(360deg)}}
        .cbi-row:hover{background:#f5f8ff}`}</style>

      <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px" }}>
        {(stage === "pick" || stage === "checking" || stage === "preview") && (
          <>
            {/* drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              style={{ border: `2px dashed ${drag ? C.blue : "#c7d7fb"}`, borderRadius: 12,
                padding: files.length ? "16px" : "34px 20px", textAlign: "center", cursor: "pointer",
                background: drag ? "#e8efff" : C.soft, transition: "all .15s" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                {files.length ? "Add or replace files" : "Drop the 7 CBMS 2024 files here"}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                Select them all at once — any order, any file names. Each file is recognised by its columns.
              </div>
              <input ref={inputRef} type="file" multiple accept=".csv,.xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>

            {error && (
              <div style={{ marginTop: 12, background: C.redBg, border: "1px solid #f5c2c0", borderRadius: 8,
                padding: "10px 14px", color: C.red, fontSize: 12 }}>{error}</div>
            )}

            {/* the 7 expected files */}
            <div style={{ marginTop: 16, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: C.soft, fontSize: 11, fontWeight: 700, color: C.sub,
                textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
                <span>CBMS files</span>
                {stage === "checking" && <span style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "none", fontWeight: 600 }}>
                  <Dot state="running" /> Checking…</span>}
              </div>
              {EXPECTED.map((e) => {
                const d = detected[e.kind];
                const local = d ? files.find((f) => f.name === d.name) : null;
                const state = d ? "ok" : preview ? (e.required ? "failed" : "missing") : "pending";
                return (
                  <div key={e.kind} className="cbi-row" style={{ display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 14px", borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
                    <Dot state={state} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: C.text }}>
                        {e.label}{e.required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d ? `${d.name} · ${fmt(d.rows)} rows${local ? ` · ${kb(local.size)}` : ""}` : e.file}
                      </div>
                    </div>
                    {d && (
                      <button onClick={(ev) => { ev.stopPropagation(); removeFile(d.name); }} title="Remove"
                        style={{ border: "none", background: "none", color: C.muted, cursor: "pointer", fontSize: 14 }}>×</button>
                    )}
                  </div>
                );
              })}
              {extras.map((f) => (
                <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                  borderTop: `1px solid ${C.border}`, fontSize: 12, background: "#fffaf5" }}>
                  <Dot state="warn" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: C.text }}>{f.name}</div>
                    <div style={{ fontSize: 11, color: C.amber }}>
                      {f.status === "duplicate" ? `Second ${f.label} file — not used`
                        : f.status === "unreadable" ? "Could not be read" : "Not a CBMS 2024 file — ignored"}
                    </div>
                  </div>
                  <button onClick={() => removeFile(f.name)} style={{ border: "none", background: "none", color: C.muted, cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
              ))}
            </div>

            {preview?.missing_required?.length > 0 && (
              <Note tone="red">Still needed: {preview.missing_required.join(", ")}.</Note>
            )}

            {/* alignment */}
            {checks.length > 0 && (
              <Section title="Lined up by uuid">
                {checks.map((c) => (
                  <div key={c.check} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 12, alignItems: "flex-start" }}>
                    <Dot state={c.ok ? "ok" : c.blocking ? "failed" : "warn"} />
                    <div style={{ flex: 1 }}>
                      <span style={{ color: C.text, fontWeight: 600 }}>{c.check}</span>
                      <span style={{ color: c.ok ? C.muted : c.blocking ? C.red : C.amber }}> — {c.detail}</span>
                    </div>
                  </div>
                ))}
              </Section>
            )}
            {blocking.length > 0 && (
              <Note tone="red">These files can't be imported until the problems marked ✕ are fixed.</Note>
            )}
            {unmatched.length > 0 && (
              <Note tone="red">These barangays are not in the system: {unmatched.join(", ")}.</Note>
            )}

            {/* what will be imported */}
            {sum && (
              <Section title="What will be imported">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Stat value={fmt(sum.households)} label="households" />
                  <Stat value={fmt(sum.members)} label="household members" />
                  <Stat value={fmt(sum.barangays)} label="barangays" />
                  <Stat value={fmt(sum.flood_high_or_very_high)} label="in high / very high flood zones" tone="#1565c0" />
                  <Stat value={fmt(sum.landslide_moderate_or_high)} label="in moderate / high landslide zones" tone="#8d6e63" />
                  <Stat value={fmt(sum.beyond_2km_rhu)} label="more than 2 km from the RHU" tone="#c2410c" />
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
                  Hazard exposure is read from each household's coordinates and the typology from the saved
                  k-modes clusters. Income is not in the CBMS files, so no income figure is stored.
                </div>
              </Section>
            )}

            {/* database changes */}
            {db && (
              <Section title="Changes to the system">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Stat value={fmt(db.to_update)} label="households updated (same ID and code)" />
                  <Stat value={fmt(db.to_add)} label="new households (next code in their barangay)" tone={C.green} />
                  <Stat value={fmt(db.not_in_files)} label="households in the system but not in these files"
                    tone={db.not_in_files ? C.amber : C.muted} />
                </div>
                {db.not_in_files > 0 && (
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 12,
                    color: C.text, cursor: "pointer" }}>
                    <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)}
                      style={{ accentColor: C.blue, marginTop: 2 }} />
                    <span>
                      Remove the {fmt(db.not_in_files)} household{db.not_in_files === 1 ? "" : "s"} that {db.not_in_files === 1 ? "is" : "are"} not in these files
                      <span style={{ display: "block", color: C.muted, fontSize: 11 }}>
                        Keep this on when the files are the full census for San Miguel. Turn it off to keep
                        households that were added by hand.
                      </span>
                    </span>
                  </label>
                )}
                <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
                  Member lists of every imported household are replaced with the ones in the files. After saving,
                  SVI, Barangay Capacity, hazard, typology, the family network and Ask the Data are all recalculated.
                  Nothing in these files is sent to Gemini.
                </div>
              </Section>
            )}
          </>
        )}

        {(stage === "running" || stage === "finished") && job && (
          <>
            <Section title={stage === "running" ? "Importing and recalculating…" : job.state === "failed" ? "Import failed" : "Import complete"}>
              {job.steps.map((s) => (
                <div key={s.label} style={{ display: "flex", gap: 10, padding: "7px 0", fontSize: 12, alignItems: "flex-start",
                  borderBottom: `1px solid ${C.border}` }}>
                  <Dot state={s.state} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: s.state === "pending" ? C.muted : C.text, fontWeight: 600 }}>{s.label}</div>
                    {s.detail && (
                      <div style={{ fontSize: 11, color: s.state === "failed" ? C.red : C.muted }}>{s.detail}</div>
                    )}
                  </div>
                  {s.seconds != null && <span style={{ fontSize: 11, color: C.muted }}>{s.seconds}s</span>}
                </div>
              ))}
            </Section>
            {stage === "finished" && job.result && (
              <Section title="Result">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Stat value={fmt(job.result.households_in_system)} label="households in the system" />
                  <Stat value={fmt(job.result.updated)} label="updated" />
                  <Stat value={fmt(job.result.added)} label="added" tone={C.green} />
                  <Stat value={fmt(job.result.removed)} label="removed" tone={job.result.removed ? C.amber : C.muted} />
                  <Stat value={fmt(job.result.members)} label="members saved" />
                </div>
                {job.state === "done_with_errors" && (
                  <Note tone="amber">The data was saved, but some scores could not be recalculated (marked ✕ above).
                    The pages keep showing the previous values for those until the step is re-run.</Note>
                )}
              </Section>
            )}
            {stage === "finished" && job.state === "failed" && (
              <Note tone="red">Nothing was changed: {job.error}</Note>
            )}
          </>
        )}
      </div>

      {/* footer */}
      <div style={{ padding: "12px 24px", borderTop: `1px solid ${C.border}`, display: "flex",
        justifyContent: "space-between", alignItems: "center", background: "#fff", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: C.muted }}>
          {stage === "running" ? "You can keep this window open — it updates by itself."
            : stage === "preview" && canImport ? "Nothing has been changed yet." : ""}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {stage !== "running" && stage !== "finished" && (
            <button style={btn(false)} onClick={onClose}>Cancel</button>
          )}
          {(stage === "pick" || stage === "checking" || stage === "preview") && (
            <button style={btn(true, !canImport)} disabled={!canImport} onClick={commit}>
              Import and recalculate
            </button>
          )}
          {stage === "finished" && (
            <button style={btn(true)} onClick={() => onDone?.(job)}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5,
        marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Note({ tone, children }) {
  const t = { red: [C.red, C.redBg, "#f5c2c0"], amber: [C.amber, C.amberBg, "#ffe08a"] }[tone] || [C.sub, C.soft, C.border];
  return (
    <div style={{ marginTop: 12, color: t[0], background: t[1], border: `1px solid ${t[2]}`, borderRadius: 8,
      padding: "9px 13px", fontSize: 12, lineHeight: 1.5 }}>{children}</div>
  );
}
