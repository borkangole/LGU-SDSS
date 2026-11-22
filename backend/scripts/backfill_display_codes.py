# ============================================================
# ONE-TIME MIGRATION + BACKFILL: household display codes
# ============================================================
# Adds a human-readable, non-sensitive household code
# (e.g. "Brgy San Jose - HH23") that replaces the raw UUID
# everywhere in the UI. The real UUID (household_number) stays
# in the DB for internal use / audit trail, but is never shown
# in normal views again -- only via the password-gated
# /reveal-uid endpoint.
#
# Run this ONCE, after deploying the updated household.py /
# household_routes.py, and BEFORE relying on display_code
# anywhere in the frontend.
#
# Safe to re-run: existing display_codes are left untouched
# (WHERE display_code IS NULL), so re-running only backfills
# any household that somehow doesn't have one yet.
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

    print("🔧 Step 1/3 — Adding display_code column (if not present)...")
    cur.execute("""
        ALTER TABLE tbl_households
        ADD COLUMN IF NOT EXISTS display_code VARCHAR(80) UNIQUE
    """)

    print("🔧 Step 2/3 — Creating per-barangay counter table...")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tbl_barangay_hh_counter (
            barangay_id  INT PRIMARY KEY REFERENCES tbl_barangays(barangay_id),
            last_number  INT NOT NULL DEFAULT 0
        )
    """)

    # Audit table for the reveal-uid feature (who looked at a raw UUID, when)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tbl_uid_reveal_log (
            log_id        SERIAL PRIMARY KEY,
            household_id  INT NOT NULL REFERENCES tbl_households(household_id),
            user_id       INT NOT NULL REFERENCES tbl_users(user_id),
            revealed_at   TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)
    conn.commit()

    print("🔧 Step 3/3 — Backfilling display_code for existing households...")
    cur.execute("SELECT barangay_id, barangay_name FROM tbl_barangays ORDER BY barangay_id")
    barangays = cur.fetchall()

    total_assigned = 0
    for brgy in barangays:
        barangay_id = brgy["barangay_id"]
        barangay_name = brgy["barangay_name"]

        # Only households that don't already have a code, ordered by
        # created_at per your instruction (order added to DB).
        cur.execute("""
            SELECT household_id
            FROM tbl_households
            WHERE barangay_id = %s AND display_code IS NULL
            ORDER BY created_at ASC, household_id ASC
        """, (barangay_id,))
        households = cur.fetchall()
        if not households:
            continue

        # Make sure a counter row exists for this barangay
        cur.execute("""
            INSERT INTO tbl_barangay_hh_counter (barangay_id, last_number)
            VALUES (%s, 0)
            ON CONFLICT (barangay_id) DO NOTHING
        """, (barangay_id,))

        for hh in households:
            cur.execute("""
                UPDATE tbl_barangay_hh_counter
                SET last_number = last_number + 1
                WHERE barangay_id = %s
                RETURNING last_number
            """, (barangay_id,))
            seq = cur.fetchone()["last_number"]
            code = f"{barangay_name} - HH{seq}"

            cur.execute("""
                UPDATE tbl_households
                SET display_code = %s
                WHERE household_id = %s
            """, (code, hh["household_id"]))
            total_assigned += 1

        conn.commit()
        print(f"   {barangay_name}: {len(households)} households assigned")

    print(f"✅ Done — {total_assigned} households backfilled with display_code.")
    conn.close()


if __name__ == "__main__":
    run()