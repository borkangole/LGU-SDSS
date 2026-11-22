# ============================================================
# ONE-TIME MIGRATION: swap household_number <-> display_code
# ============================================================
# Run this ONCE, after backfill_display_codes.py has already
# successfully run (confirmed: 7,251 households backfilled).
#
# WHY: every existing frontend page already reads `household_number`
# from the API response to display "Household No." Rather than
# hunting down and editing every one of those pages individually,
# this just renames the columns so the SAME key (household_number)
# now holds the friendly code, and the raw UUID moves to a new
# column name (uid_internal) that nothing in the frontend reads by
# default.
#
# This is a metadata-only operation in Postgres (RENAME COLUMN does
# NOT copy/rewrite data), so it's instant regardless of table size,
# and any UNIQUE constraints on either column follow the rename
# automatically (they stay attached to the same underlying column,
# just under a new name).
#
# ORDER MATTERS: household_number must be renamed out of the way
# FIRST, since you can't have two columns with the same name even
# momentarily.
# ============================================================

import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".."))  # backend modules
import psycopg2
import psycopg2.extras
from config import Config


def run():
    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()

    print("🔍 Checking current column state...")
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tbl_households'
        AND column_name IN ('household_number', 'display_code', 'uid_internal')
    """)
    existing = {r["column_name"] for r in cur.fetchall()}
    print(f"   Found: {existing}")

    if "uid_internal" in existing:
        print("⚠️  uid_internal already exists — migration may have already run. Aborting to avoid overwriting.")
        conn.close()
        return

    if "household_number" not in existing or "display_code" not in existing:
        print("❌ Expected both household_number and display_code to exist. Aborting.")
        conn.close()
        return

    print("🔧 Step 1/2 — Renaming household_number → uid_internal (raw UUID moves here)...")
    cur.execute("ALTER TABLE tbl_households RENAME COLUMN household_number TO uid_internal")

    print("🔧 Step 2/2 — Renaming display_code → household_number (friendly code takes over the name)...")
    cur.execute("ALTER TABLE tbl_households RENAME COLUMN display_code TO household_number")

    conn.commit()

    # Sanity check
    cur.execute("SELECT household_number, uid_internal FROM tbl_households LIMIT 3")
    sample = cur.fetchall()
    print("✅ Migration complete. Sample rows:")
    for row in sample:
        print(f"   household_number = {row['household_number']!r}   uid_internal = {row['uid_internal']!r}")

    conn.close()


if __name__ == "__main__":
    run()