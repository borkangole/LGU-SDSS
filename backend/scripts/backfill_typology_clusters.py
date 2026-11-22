# ============================================================
# ONE-TIME MIGRATION + BACKFILL: household typology cluster
# ============================================================
# Adds typology_cluster_id / typology_cluster_label columns to
# tbl_households and backfills them from
# ../data/domain_pipeline_results/typology_household_k5.csv
# (produced by typology_household_export.py), matched via the
# hidden uid_internal column (the raw CBMS uuid -- see
# swap_household_columns.py for why the raw uuid lives there).
#
# WHY THIS EXISTS
# ----------------
# Sir Shem's cluster_households() function (Domain A, Level 2) is
# the one function in his own reference PDF that is genuinely
# per-household by construction -- it assigns each household a
# k-modes typology cluster, not a ranked score. Unlike SVI (which
# is a barangay percentile rank and has no household-level
# equivalent), this typology CAN legitimately be shown per
# household, so the thesis author decided to surface it in the
# Vulnerability page's household detail view alongside the other
# two per-household-computable domains (hazard exposure, facility
# distance -- both already computable live from columns/constants
# already on tbl_households, no backfill needed for those).
#
# Same backfill-once, read-forever pattern as backfill_display_codes.py
# and the existing hazard fields -- computed once here, then just
# SELECTed like any other column from then on. No live CSV read on
# every household page view.
#
# ALSO backfills the 13 raw TYPOLOGY_FEATURES indicator values (not just
# the final cluster label), one column per indicator, prefixed `ti_`
# (typology indicator) to avoid any collision with existing columns --
# so the UI can show WHICH indicators drove a household's typology, not
# just the label. These come from typology_household_export.py's CSV,
# which now keeps them (previously it computed and discarded them).
#
# Run this ONCE (from backend/), after typology_household_export.py
# has already been run and
# ../data/domain_pipeline_results/typology_household_k5.csv exists:
#     python backfill_typology_clusters.py
#
# Safe to re-run: matches are re-applied idempotently (an UPDATE to
# the same values), and any household with no CSV match keeps
# typology_cluster_id/label as NULL rather than guessing.
#
# NOTE ON CLUSTER LABELS: cluster_label values here are OUR OWN
# provisional best-fit match to Sir Shem's demo label names (see
# typology_household_export.py's CLUSTER_LABELS), NOT yet confirmed
# by him. If he later gives corrected labels, only
# typology_household_export.py's CLUSTER_LABELS + this backfill need
# to be re-run -- nothing else in the app hardcodes these names.
# ============================================================

import csv
import os
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".."))  # backend modules
import psycopg2
import psycopg2.extras
from config import Config

CSV_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "domain_pipeline_results",
    "typology_household_k5.csv",
)

# Boolean indicators (stored as Postgres BOOLEAN) vs capped-count indicators
# (stored as SMALLINT 0-3) -- must match sanmiguel_student/config.py's
# TYPOLOGY_FEATURES exactly, both in name and in kind.
BOOL_INDICATORS = [
    "overcrowding", "food_insecure", "no_internet", "weak_roof", "weak_wall",
    "insecure_tenure", "unimproved_sanitation", "low_adult_education_hh",
    "large_household", "financially_excluded",
]
COUNT_INDICATORS = ["pwd_count_cat", "senior_count_cat", "solo_parent_count_cat"]
ALL_INDICATORS = BOOL_INDICATORS + COUNT_INDICATORS


def _parse_bool(v):
    if v is None or v == "":
        return None
    return str(v).strip().lower() in ("true", "1", "t", "yes")


def _parse_int(v):
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def run():
    if not os.path.exists(CSV_PATH):
        print(f"❌ Not found: {CSV_PATH}")
        print("   Run `python typology_household_export.py` from backend/ first.")
        return

    print(f"🔍 Reading typology assignments from {CSV_PATH} ...")
    by_uuid = {}
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        has_indicators = all(c in (reader.fieldnames or []) for c in ALL_INDICATORS)
        for row in reader:
            uid = row.get("uuid")
            if not uid:
                continue
            indicators = {}
            if has_indicators:
                for c in BOOL_INDICATORS:
                    indicators[c] = _parse_bool(row.get(c))
                for c in COUNT_INDICATORS:
                    indicators[c] = _parse_int(row.get(c))
            by_uuid[uid] = (row.get("cluster_id"), row.get("cluster_label"), indicators)
    print(f"   Loaded {len(by_uuid)} household typology assignments.")
    if not has_indicators:
        print("   ⚠️  CSV doesn't have the 13 indicator columns yet (old export) --")
        print("      only cluster_id/cluster_label will be backfilled. Re-run")
        print("      `python typology_household_export.py` (updated version) and")
        print("      then this script again to also get the indicator breakdown.")

    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()

    print("🔧 Step 1/2 — Adding typology columns (if not present)...")
    cur.execute("""
        ALTER TABLE tbl_households
        ADD COLUMN IF NOT EXISTS typology_cluster_id INT,
        ADD COLUMN IF NOT EXISTS typology_cluster_label VARCHAR(100)
    """)
    for c in BOOL_INDICATORS:
        cur.execute(f"ALTER TABLE tbl_households ADD COLUMN IF NOT EXISTS ti_{c} BOOLEAN")
    for c in COUNT_INDICATORS:
        cur.execute(f"ALTER TABLE tbl_households ADD COLUMN IF NOT EXISTS ti_{c} SMALLINT")
    conn.commit()

    print("🔧 Step 2/2 — Matching households by uid_internal and backfilling...")
    cur.execute("SELECT household_id, uid_internal FROM tbl_households")
    households = cur.fetchall()

    indicator_cols_sql = ", ".join(f"ti_{c} = %s" for c in ALL_INDICATORS)

    matched = 0
    unmatched = 0
    for hh in households:
        uid = hh["uid_internal"]
        hit = by_uuid.get(uid)
        if not hit:
            unmatched += 1
            continue
        cluster_id, cluster_label, indicators = hit
        values = [indicators.get(c) for c in ALL_INDICATORS]
        cur.execute(f"""
            UPDATE tbl_households
            SET typology_cluster_id = %s, typology_cluster_label = %s, {indicator_cols_sql}
            WHERE household_id = %s
        """, [cluster_id, cluster_label] + values + [hh["household_id"]])
        matched += 1

    conn.commit()
    conn.close()

    print(f"✅ Done — matched {matched} of {len(households)} households "
          f"({unmatched} unmatched, left NULL).")
    if unmatched:
        print("   Unmatched households will show 'Typology: not available' in the UI "
              "rather than a guessed value.")


if __name__ == "__main__":
    run()
