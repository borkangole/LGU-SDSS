"""
Import batches for the 7-file CBMS import.

Every CBMS import is recorded in tbl_import_batches (inside the same
transaction that writes the households) with the ids of the households it
ADDED. The Households page lists the batches and can delete one:

  * the households the batch added (and their members, families and every
    row that points to them) are removed;
  * if no household is left, the system goes back to its freshly-installed
    state: the saved CBMS files, the analysis inputs and every computed result
    are removed (the same files the launcher's reset removes), so the next
    import starts clean;
  * otherwise the scores are recalculated without those households.

Households a batch only UPDATED (already in the system before it) are not
touched -- deleting a batch never undoes an update.

An installation that imported its CBMS files before batches were recorded
gets one batch made from the CBMS households already on file (anything not
added by hand), so it can still be deleted.
"""
import shutil

import cbms_import as CI

DDL = """
CREATE TABLE IF NOT EXISTS tbl_import_batches (
    batch_id           serial PRIMARY KEY,
    source             varchar(40)  NOT NULL DEFAULT 'cbms',
    created_at         timestamp    NOT NULL DEFAULT now(),
    created_by         varchar(120),
    households_added   integer      NOT NULL DEFAULT 0,
    households_updated integer      NOT NULL DEFAULT 0,
    households_removed integer      NOT NULL DEFAULT 0,
    members            integer      NOT NULL DEFAULT 0,
    household_ids      integer[]    NOT NULL DEFAULT '{}',
    note               text
)"""

# Same list as the launcher's reset (deploy/installer/launcher/lgu_sdss.py GENERATED).
GENERATED = ["domain_pipeline_results", "cbms 2024", "imports", "manual",
             "cbms_household_record.csv", "cbms_person_record.csv", "cbms_barangay_record.csv",
             "nlp_analytics.sqlite", "nlp_analytics.sqlite-journal"]


def ensure_table(cur):
    cur.execute(DDL)


def record_batch(cur, *, added_ids, updated, removed, members, user=None, source="cbms", note=None):
    """Called inside write_to_database()'s transaction."""
    ensure_table(cur)
    cur.execute("""
        INSERT INTO tbl_import_batches
            (source, created_by, households_added, households_updated, households_removed,
             members, household_ids, note)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING batch_id
    """, (source, user, len(added_ids), int(updated), int(removed), int(members),
          [int(i) for i in added_ids], note))
    return cur.fetchone()[0]


def _manual_uids():
    try:
        if CI.MANUAL_HH.exists():
            return set(CI._read_text_csv(CI.MANUAL_HH)["uuid"])
    except Exception:  # noqa: BLE001
        pass
    return set()


def _backfill(conn):
    """One batch for CBMS households imported before batches were recorded."""
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM tbl_import_batches")
    if cur.fetchone()[0]:
        return
    cols = CI._columns(cur, "tbl_households")
    if "uid_internal" not in cols:
        return
    has_created = "created_at" in cols
    cur.execute(f"""SELECT household_id, uid_internal{', created_at' if has_created else ''}
                    FROM tbl_households WHERE uid_internal IS NOT NULL""")
    rows = cur.fetchall()
    manual = _manual_uids()
    rows = [r for r in rows if r[1] not in manual]
    if not rows:
        return
    when = min((r[2] for r in rows if has_created and r[2] is not None), default=None)
    ids = [r[0] for r in rows]
    cur.execute("SELECT count(*) FROM tbl_individuals WHERE household_id = ANY(%s)", (ids,))
    members = cur.fetchone()[0]
    cur.execute("""
        INSERT INTO tbl_import_batches (source, created_at, households_added, members, household_ids, note)
        VALUES ('cbms', COALESCE(%s, now()), %s, %s, %s,
                'Recorded from the CBMS households already in the system')
    """, (when, len(ids), members, ids))
    conn.commit()


def list_batches(conn, limit=20):
    cur = conn.cursor()
    ensure_table(cur)
    conn.commit()
    _backfill(conn)
    cur.execute("""
        SELECT b.batch_id, b.source,
               to_char((b.created_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               b.created_by, b.households_added,
               b.households_updated, b.households_removed, b.members, b.note,
               (SELECT count(*) FROM tbl_households h WHERE h.household_id = ANY(b.household_ids))
        FROM tbl_import_batches b ORDER BY b.created_at DESC, b.batch_id DESC LIMIT %s
    """, (limit,))
    out = []
    for r in cur.fetchall():
        out.append({"batch_id": r[0], "source": r[1], "created_at": r[2],
                    "created_by": r[3], "added": r[4], "updated": r[5], "removed": r[6],
                    "members": r[7], "note": r[8], "present": r[9]})
    return out


def batch_detail(conn, batch_id):
    """Households of the batch still in the system, per barangay."""
    cur = conn.cursor()
    ensure_table(cur)
    cur.execute("""
        SELECT COALESCE(br.barangay_name, '—'), count(*), COALESCE(sum(h.hh_size), 0)
        FROM tbl_import_batches b
        JOIN tbl_households h ON h.household_id = ANY(b.household_ids)
        LEFT JOIN tbl_barangays br ON br.barangay_id = h.barangay_id
        WHERE b.batch_id = %s GROUP BY 1 ORDER BY 1
    """, (batch_id,))
    import re
    key = lambda r: (0, int(m.group(1)), "") if (m := re.search(r"(\d+)", r[0])) else (1, 0, r[0])
    return [{"barangay": r[0], "households": r[1], "members": int(r[2] or 0)}
            for r in sorted(cur.fetchall(), key=key)]


def _import_running():
    return any(j.get("state") in ("running", "queued") for j in CI._JOBS.values())


def reset_generated_files(log=print):
    """Back to a freshly installed system: no CBMS files, no results."""
    removed = []
    for name in GENERATED:
        p = CI.DATA_DIR / name
        try:
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
                removed.append(name)
            elif p.exists():
                p.unlink()
                removed.append(name)
        except OSError as e:
            log(f"could not remove {p}: {e}")
    try:
        import nlp_households
        nlp_households.invalidate_cache()
    except Exception:  # noqa: BLE001
        pass
    return removed


def delete_batch(batch_id, conn_factory, user=None):
    if _import_running():
        raise RuntimeError("An import or recalculation is running -- wait for it to finish, then try again.")
    conn = conn_factory()
    try:
        cur = conn.cursor()
        ensure_table(cur)
        cur.execute("SELECT household_ids FROM tbl_import_batches WHERE batch_id = %s", (batch_id,))
        r = cur.fetchone()
        if not r:
            raise KeyError("Batch not found")
        ids = list(r[0] or [])
        cur.execute("""CREATE TEMP TABLE _hh_del ON COMMIT DROP AS
                       SELECT household_id AS id FROM tbl_households WHERE household_id = ANY(%s)""", (ids,))
        cur.execute("SELECT count(*) FROM _hh_del")
        n = cur.fetchone()[0]
        removed = {}
        if n:
            if CI._exists(cur, "tbl_families") and "family_id" in CI._columns(cur, "tbl_individuals"):
                cur.execute("""UPDATE tbl_individuals SET family_id = NULL
                               WHERE household_id IN (SELECT id FROM _hh_del) AND family_id IS NOT NULL""")
            cur.execute("""CREATE TEMP TABLE _ind_del ON COMMIT DROP AS
                           SELECT person_id AS id FROM tbl_individuals
                           WHERE household_id IN (SELECT id FROM _hh_del)""")
            CI._purge(cur, "tbl_individuals", "person_id", "_ind_del", removed)
            CI._purge(cur, "tbl_households", "household_id", "_hh_del", removed)
        cur.execute("DELETE FROM tbl_import_batches WHERE batch_id = %s", (batch_id,))
        cur.execute("SELECT count(*) FROM tbl_households")
        remaining = cur.fetchone()[0]
        if remaining == 0:
            # nothing left: household codes start again at HH1, other batches are moot
            if CI._exists(cur, "tbl_barangay_hh_counter"):
                cur.execute("UPDATE tbl_barangay_hh_counter SET last_number = 0")
            cur.execute("DELETE FROM tbl_import_batches")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    result = {"deleted_households": n, "remaining_households": remaining,
              "also_removed": {k: v for k, v in removed.items() if k != "tbl_households"},
              "reset": remaining == 0, "job_id": None}
    if remaining == 0:
        result["files_removed"] = reset_generated_files()
        try:
            import build_nlp_views
            build_nlp_views.build()
        except Exception:  # noqa: BLE001
            pass
    elif n:
        result["job_id"] = CI.start_recompute(conn_factory, f"Import batch #{batch_id} deleted", user=user)
    return result
