# ============================================================
# SAMPLE: Barangay Vulnerability Index (BVI) — NEW FORMULA
#
# Formula:  BVI = (E + S) / AC
#
# EXPOSURE (E) — avg of 4 binary indicators per household:
#   % Weak Housing   : Bamboo, Kamalig, Wood/Bamboo, PLYWOOD, Others, Not Stated
#   % Unsafe Water   : Level 1, Not Stated
#   % No Electricity : has_electricity = FALSE
#   % Unsafe Toilet  : No Facility/field, Communal (Shared), Public Toilet,
#                      Share, Water Sealed(Buhos) Open Pit,
#                      Water Sealed(FLUSH) Open Pit, Not Stated
#
# SENSITIVITY (S) — avg of 4 indicators per household:
#   % Low Income     : estimated_family_income_monthly <= 13,801 (PSA threshold)
#   % Senior         : is_senior = TRUE
#   % PWD            : is_pwd = TRUE
#   % Solo Parent    : is_solo_parent = TRUE
#
# ADAPTIVE CAPACITY (AC) — avg of 4 indicators per household:
#   % Educated       : avg education score of members (0–1 scale)
#   % Adequate Income: estimated_family_income_monthly > 13,801
#   % Secure Tenure  : Owned, Being Amortized
#   % Electricity    : has_electricity = TRUE
#
# BVI Interpretation:
#   0 – 1  : Low Vulnerability
#   1 – 2  : Moderate
#   2 – 3  : High
#   > 3    : Very High
# ============================================================

import psycopg2
import psycopg2.extras
import sys, os

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))   # backend modules
from config import Config

# ── Education Score Mapping (0–1 scale, PSA/DepEd ladder) ────
EDUCATION_SCORE = {
    "No Grade Completed":   0.00,
    "Pre-school":           0.07,
    "Elementary Level":     0.21,
    "Elementary Graduate":  0.35,
    "ALS":                  0.40,
    "ALS Graduate":         0.45,
    "High School Level":    0.50,
    "High School Graduate": 0.64,
    "Vocational/Technical": 0.71,
    "College Level":        0.79,
    "College Graduate":     0.93,
    "Masters/Doctoral":     1.00,
    "Not Stated":           0.50,   # neutral / unknown
}

# ── Classification Helpers ───────────────────────────────────
WEAK_HOUSING = {
    "Bamboo", "Kamalig", "Wood/Bamboo", "PLYWOOD", "Others", "Not Stated"
}

UNSAFE_WATER = {"Level 1", "Not Stated"}

UNSAFE_TOILET = {
    "No Facility/field",
    "Communal (Shared)",
    "Public Toilet",
    "Share",
    "Water Sealed(Buhos), Open Pit",
    "Water Sealed(FLUSH), Open Pit",
    "Not Stated",
}

SECURE_TENURE = {"Owned", "Being Amortized"}

LOW_INCOME_THRESHOLD = 13_801   # PSA poverty threshold (monthly)
EPSILON = 1e-6                  # avoid division by zero when AC = 0


# ── BVI Score Interpreter ────────────────────────────────────
def interpret_bvi(score: float) -> str:
    if score <= 1.0:
        return "Low Vulnerability"
    elif score <= 2.0:
        return "Moderate"
    elif score <= 3.0:
        return "High"
    else:
        return "Very High"


# ── Compute BVI for a single household ──────────────────────
def compute_bvi(household: dict, members: list[dict]) -> dict:
    hh = household
    total = len(members)

    # ── EXPOSURE ─────────────────────────────────────────────
    weak_housing    = 1 if hh.get("housing_material") in WEAK_HOUSING else 0
    unsafe_water    = 1 if hh.get("water_source")     in UNSAFE_WATER else 0
    no_electricity  = 0 if hh.get("has_electricity")  else 1
    unsafe_toilet   = 1 if hh.get("toilet_type")      in UNSAFE_TOILET else 0

    E = (weak_housing + unsafe_water + no_electricity + unsafe_toilet) / 4

    # ── SENSITIVITY ──────────────────────────────────────────
    low_income   = 1 if (hh.get("estimated_family_income_monthly") or 0) <= LOW_INCOME_THRESHOLD else 0

    if total > 0:
        pct_senior      = sum(1 for m in members if m.get("is_senior"))      / total
        pct_pwd         = sum(1 for m in members if m.get("is_pwd"))         / total
        pct_solo_parent = sum(1 for m in members if m.get("is_solo_parent")) / total
    else:
        pct_senior = pct_pwd = pct_solo_parent = 0.0

    S = (low_income + pct_senior + pct_pwd + pct_solo_parent) / 4

    # ── ADAPTIVE CAPACITY ────────────────────────────────────
    if total > 0:
        edu_scores  = [EDUCATION_SCORE.get(m.get("educational_attainment", "Not Stated"), 0.50)
                       for m in members]
        avg_edu     = sum(edu_scores) / total
    else:
        avg_edu = 0.50

    adequate_income = 1 if (hh.get("estimated_family_income_monthly") or 0) > LOW_INCOME_THRESHOLD else 0
    secure_tenure   = 1 if hh.get("tenure_status") in SECURE_TENURE else 0
    has_electricity = 1 if hh.get("has_electricity") else 0

    AC = (avg_edu + adequate_income + secure_tenure + has_electricity) / 4

    # ── BVI ──────────────────────────────────────────────────
    AC_safe = max(AC, EPSILON)          # prevent division by zero
    BVI     = (E + S) / AC_safe

    return {
        "exposure_score":          round(E,   4),
        "sensitivity_score":       round(S,   4),
        "adaptive_capacity_score": round(AC,  4),
        "bvi_score":               round(BVI, 4),
        "bvi_category":            interpret_bvi(BVI),
        "total_members":           total,
        "avg_edu_score":           round(avg_edu, 4),
    }


# ════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════
def main():
    conn = psycopg2.connect(Config.get_connection_string())
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    print("✅ Connected to database")

    # ── Drop & recreate sample output table ──────────────────
    print("🔄 Recreating sample BVI table...")
    cur.execute("DROP TABLE IF EXISTS tbl_sample_bvi CASCADE")
    cur.execute("""
        CREATE TABLE tbl_sample_bvi (
            bvi_id                    SERIAL PRIMARY KEY,
            household_id              INT UNIQUE REFERENCES tbl_households(household_id)
                                          ON DELETE CASCADE,
            barangay_id               INT REFERENCES tbl_barangays(barangay_id),
            exposure_score            DECIMAL(6,4),
            sensitivity_score         DECIMAL(6,4),
            adaptive_capacity_score   DECIMAL(6,4),
            bvi_score                 DECIMAL(8,4),
            bvi_category              VARCHAR(30),
            total_members             INT,
            avg_edu_score             DECIMAL(6,4),
            computed_at               TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.commit()
    print("✅ Table ready: tbl_sample_bvi")

    # ── Fetch all households ──────────────────────────────────
    cur.execute("SELECT * FROM tbl_households")
    households = cur.fetchall()
    print(f"🏠 Processing {len(households)} households...")

    done = errors = 0

    for hh in households:
        try:
            cur.execute("""
                SELECT * FROM tbl_individuals
                WHERE household_id = %s
            """, (hh["household_id"],))
            members = cur.fetchall()

            scores = compute_bvi(dict(hh), [dict(m) for m in members])

            cur.execute("""
                INSERT INTO tbl_sample_bvi (
                    household_id, barangay_id,
                    exposure_score, sensitivity_score, adaptive_capacity_score,
                    bvi_score, bvi_category,
                    total_members, avg_edu_score
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (household_id) DO UPDATE SET
                    exposure_score          = EXCLUDED.exposure_score,
                    sensitivity_score       = EXCLUDED.sensitivity_score,
                    adaptive_capacity_score = EXCLUDED.adaptive_capacity_score,
                    bvi_score               = EXCLUDED.bvi_score,
                    bvi_category            = EXCLUDED.bvi_category,
                    total_members           = EXCLUDED.total_members,
                    avg_edu_score           = EXCLUDED.avg_edu_score,
                    computed_at             = NOW()
            """, (
                hh["household_id"],           hh["barangay_id"],
                scores["exposure_score"],     scores["sensitivity_score"],
                scores["adaptive_capacity_score"],
                scores["bvi_score"],          scores["bvi_category"],
                scores["total_members"],      scores["avg_edu_score"],
            ))
            conn.commit()
            done += 1

            if done % 500 == 0:
                print(f"   ... {done} households processed")

        except Exception as e:
            conn.rollback()
            print(f"⚠️  Error HH {hh['household_id']}: {e}")
            errors += 1

    print(f"✅ Computed {done} households ({errors} errors)")

    # ── Barangay-level aggregation ────────────────────────────
    print("\n📊 Aggregating by barangay...")
    cur.execute("""
        SELECT
            b.barangay_name,
            COUNT(v.household_id)               AS total_hh,
            ROUND(AVG(v.bvi_score)::NUMERIC, 4) AS avg_bvi,
            ROUND(AVG(v.exposure_score)::NUMERIC, 4)          AS avg_e,
            ROUND(AVG(v.sensitivity_score)::NUMERIC, 4)       AS avg_s,
            ROUND(AVG(v.adaptive_capacity_score)::NUMERIC, 4) AS avg_ac,
            SUM(CASE WHEN v.bvi_category = 'Low Vulnerability' THEN 1 ELSE 0 END) AS low_count,
            SUM(CASE WHEN v.bvi_category = 'Moderate'          THEN 1 ELSE 0 END) AS mod_count,
            SUM(CASE WHEN v.bvi_category = 'High'              THEN 1 ELSE 0 END) AS high_count,
            SUM(CASE WHEN v.bvi_category = 'Very High'         THEN 1 ELSE 0 END) AS very_high_count
        FROM tbl_barangays b
        JOIN tbl_households h    ON b.barangay_id = h.barangay_id
        JOIN tbl_sample_bvi v   ON h.household_id = v.household_id
        GROUP BY b.barangay_name
        ORDER BY avg_bvi DESC
    """)
    rows = cur.fetchall()

    print(f"\n{'='*85}")
    print(f"{'Barangay':<25} {'HH':>5} {'BVI':>7} {'E':>7} {'S':>7} {'AC':>7}  "
          f"{'Low':>5} {'Mod':>5} {'Hi':>5} {'VHi':>5}")
    print("-" * 85)
    for r in rows:
        print(
            f"  {r['barangay_name']:<23} {r['total_hh']:>5} "
            f"{float(r['avg_bvi']):>7.4f} "
            f"{float(r['avg_e']):>7.4f} "
            f"{float(r['avg_s']):>7.4f} "
            f"{float(r['avg_ac']):>7.4f}  "
            f"{r['low_count']:>5} {r['mod_count']:>5} "
            f"{r['high_count']:>5} {r['very_high_count']:>5}"
        )

    # ── Household distribution ────────────────────────────────
    cur.execute("""
        SELECT bvi_category, COUNT(*) AS count,
               ROUND(COUNT(*)*100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
        FROM tbl_sample_bvi
        GROUP BY bvi_category
        ORDER BY count DESC
    """)
    dist = cur.fetchall()
    print(f"\n{'─'*45}")
    print("Household-level BVI distribution:")
    for d in dist:
        print(f"  {d['bvi_category']:<20} {d['count']:>6} HHs  ({d['pct']}%)")

    print(f"\n{'='*85}")
    print("🎉 BVI Computation Complete!")
    print("   Formula : BVI = (E + S) / AC")
    print("   Output  : tbl_sample_bvi")
    print(f"{'='*85}")

    conn.close()
    print("✅ Done!")


if __name__ == "__main__":
    main()