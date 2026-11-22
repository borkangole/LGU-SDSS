import psycopg2
import psycopg2.extras
from config import Config

def get_conn():
    return psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor
    )

# CBMS 2024 raw indicator columns (mirrors ImportModal.jsx's NEW_MEMBER_FIELDS).
# person_code is deliberately excluded here — it's server-generated below,
# not accepted from client data.
NEW_MEMBER_FIELDS = [
    "line_number", "last_name", "first_name", "suffix", "middle_name",
    "birthday_month", "birthday_day", "birthday_year", "age_group_five_years",
    "religion", "nuclear_family", "relation_to_nuclear_family_head",
    "with_pwd_id", "employment_status", "estimated_monthly_income",
]

# ─── READ ALL (by household) ─────────────────────────────────
def get_individuals_by_household(household_id):
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT
            i.*,
            COALESCE(i.full_name, i.person_code) AS display_name
        FROM tbl_individuals i
        WHERE i.household_id = %s
        ORDER BY i.person_id
    """, (household_id,))
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ─── READ ONE ────────────────────────────────────────────────
def get_individual_by_id(person_id):
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT
            i.*,
            h.household_number,
            b.barangay_name
        FROM tbl_individuals i
        JOIN tbl_households h ON i.household_id = h.household_id
        JOIN tbl_barangays  b ON h.barangay_id  = b.barangay_id
        WHERE i.person_id = %s
    """, (person_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None

# ─── CREATE ──────────────────────────────────────────────────
def create_individual(household_id, data):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM tbl_individuals WHERE household_id = %s",
            (household_id,)
        )
        count = cur.fetchone()["cnt"]

        cur.execute(
            "SELECT household_number FROM tbl_households WHERE household_id = %s",
            (household_id,)
        )
        hh = cur.fetchone()
        if not hh:
            return {"error": "Household not found"}

        # person_code is capped at varchar(50) in the DB. household_number
        # is meant to be short, but nothing enforces that upstream — if it
        # ever ends up unexpectedly long (a bad import mapping, messy CSV
        # data, anything), the naive f"{household_number}_P{n:03d}" blows
        # through the limit and crashes the INSERT for every member of that
        # household. Truncate defensively so a bad household_number can
        # never take down member creation — this doesn't fix why
        # household_number got long in the first place, it just stops that
        # problem from cascading into a total member-creation failure.
        suffix = f"_P{count + 1:03d}"
        max_hh_number_len = 50 - len(suffix)
        person_code = f"{hh['household_number'][:max_hh_number_len]}{suffix}"

        base_cols = ["household_id", "person_code", "full_name", "gender",
                     "age", "civil_status", "occupation", "educational_attainment",
                     "monthly_income", "relationship_to_hh",
                     "is_senior", "is_pwd", "is_solo_parent", "is_4ps"]
        all_cols  = base_cols + NEW_MEMBER_FIELDS
        col_sql   = ", ".join(all_cols)
        ph_sql    = ", ".join(["%s"] * len(all_cols))
        values = [
            household_id,
            person_code,
            data.get("full_name"),
            data.get("gender"),
            data.get("age"),
            data.get("civil_status"),
            data.get("occupation"),
            data.get("educational_attainment"),
            data.get("monthly_income"),
            data.get("relationship_to_hh"),
            data.get("is_senior",      False),
            data.get("is_pwd",         False),
            data.get("is_solo_parent", False),
            data.get("is_4ps",         False),
        ] + [data.get(f) for f in NEW_MEMBER_FIELDS]

        cur.execute(f"""
            INSERT INTO tbl_individuals
                ({col_sql})
            VALUES ({ph_sql})
            RETURNING person_id
        """, values)
        new_id = cur.fetchone()["person_id"]
        conn.commit()
        return {
            "person_id":   new_id,
            "person_code": person_code,
            "message":     "Individual created successfully"
        }
    finally:
        conn.close()

# ─── UPDATE ──────────────────────────────────────────────────
def update_individual(person_id, data):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        base_cols = ["full_name", "gender", "age", "civil_status", "occupation",
                     "educational_attainment", "monthly_income", "relationship_to_hh",
                     "is_senior", "is_pwd", "is_solo_parent", "is_4ps"]
        # See update_household() for why new fields are conditional: MemberList.jsx's
        # manual edit form doesn't know about these fields, so it never sends them —
        # writing them unconditionally would NULL out real imported data on every edit.
        present_new_fields = [f for f in NEW_MEMBER_FIELDS if f in data]
        all_cols = base_cols + present_new_fields
        set_sql  = ",\n                ".join([f"{c} = %s" for c in all_cols])
        values = [
            data.get("full_name"),
            data.get("gender"),
            data.get("age"),
            data.get("civil_status"),
            data.get("occupation"),
            data.get("educational_attainment"),
            data.get("monthly_income"),
            data.get("relationship_to_hh"),
            data.get("is_senior",      False),
            data.get("is_pwd",         False),
            data.get("is_solo_parent", False),
            data.get("is_4ps",         False),
        ] + [data.get(f) for f in present_new_fields] + [person_id]

        cur.execute(f"""
            UPDATE tbl_individuals SET
                {set_sql},
                updated_at = NOW()
            WHERE person_id = %s
            RETURNING person_id
        """, values)
        updated = cur.fetchone()
        conn.commit()
        if updated:
            return {"message": "Individual updated successfully"}
        return {"error": "Individual not found"}
    finally:
        conn.close()

# ─── DELETE ──────────────────────────────────────────────────
def delete_individual(person_id):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute(
            "DELETE FROM tbl_individuals WHERE person_id = %s RETURNING person_id",
            (person_id,)
        )
        deleted = cur.fetchone()
        conn.commit()
        if deleted:
            return {"message": "Individual deleted successfully"}
        return {"error": "Individual not found"}
    finally:
        conn.close()