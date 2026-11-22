import psycopg2
import psycopg2.extras
from config import Config
from hazard_engine import detect_hazard_exposure

def get_conn():
    return psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor
    )


def generate_display_code(cur, barangay_id):
    """
    Atomically generates the next 'Brgy X - HHn' code for a barangay.
    Uses UPDATE ... RETURNING (not read-then-write) so two concurrent
    imports/creates can never hand out the same number -- the row lock
    on tbl_barangay_hh_counter serializes the increment.
    Must be called with an already-open cursor inside the SAME
    transaction as the household INSERT, so a rolled-back household
    creation doesn't burn a counter value it never used... actually it
    still burns one on rollback (Postgres doesn't un-consume the
    increment), which is fine -- codes are allowed to have gaps, they
    just can't collide or go backwards.
    """
    cur.execute("""
        INSERT INTO tbl_barangay_hh_counter (barangay_id, last_number)
        VALUES (%s, 0)
        ON CONFLICT (barangay_id) DO NOTHING
    """, (barangay_id,))

    cur.execute("""
        UPDATE tbl_barangay_hh_counter
        SET last_number = last_number + 1
        WHERE barangay_id = %s
        RETURNING last_number
    """, (barangay_id,))
    seq = cur.fetchone()["last_number"]

    cur.execute(
        "SELECT barangay_name FROM tbl_barangays WHERE barangay_id = %s",
        (barangay_id,)
    )
    barangay_name = cur.fetchone()["barangay_name"]

    return f"{barangay_name} - HH{seq}"

# CBMS 2024 raw indicator columns (same list used by ImportModal.jsx's
# NEW_HH_FIELDS). These already exist in tbl_households and are now SELECTed
# in both get_all_households() and get_household_by_id() below (the former
# was missing several of them — housing_roof/floor, fuel, service levels,
# hh_size, location codes — which is why those showed blank in the UI even
# though the data was in Postgres). They also need to be in the
# INSERT/UPDATE statements or values sent from the frontend get silently
# dropped instead of written.
NEW_HOUSEHOLD_FIELDS = [
    "region_code", "province_code", "city_mun_code", "barangay_code", "husn", "hsn",
    "longitude", "latitude", "hh_size", "housing_roof", "housing_floor",
    "o12_fuel_for_lighting", "o13_fuel_for_cooking", "water_service_level", "toilet_service_level",
    "household_estimated_income", "income_basis", "asset_premium_pct",
    "flood_exposure", "landslide_exposure", "hazard_exposure_score", "compound_hazard", "hazard_data_status",
    "is_4ps_beneficiary", "overcrowding_status", "food_insecurity_score",
    "has_formal_financial_account", "has_social_insurance", "knows_evacuation_location", "knows_emergency_hotline",
    "pwd_count", "senior_count", "solo_parent_count", "avg_education_level_adults",
    "employed_count", "working_age_count", "dependency_count", "dependency_ratio", "employment_rate_adults",
]

# ─── READ ALL ────────────────────────────────────────────────
def get_all_households(page=1, limit=20, barangay_id=None,
                       barangay_name=None, search=None, sort="default"):  # ✅ sort param
    offset  = (page - 1) * limit
    conn    = get_conn()
    cur     = conn.cursor()
    filters = []
    params  = []

    if barangay_id:
        filters.append("h.barangay_id = %s")
        params.append(barangay_id)
    if barangay_name:
        filters.append("b.barangay_name = %s")
        params.append(barangay_name)
    if search:
        # NOTE: search now matches the human-readable code. After the
        # column swap (see swap_household_columns.py), household_number
        # IS the friendly code — the raw UUID lives under uid_internal now.
        filters.append("h.household_number ILIKE %s")
        params.append(f"%{search}%")

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    # NOTE: household_number now holds the friendly code post-swap, so it
    # sorts as text ("HH10" < "HH2" alphabetically), not numerically --
    # fine for now since the default view groups by barangay and
    # household_id DESC / newest-first are the two sort options actually
    # used, but flag this if numeric-aware sorting is ever needed later.
    order = "h.household_id DESC" if sort == "newest" else "h.household_id ASC"

    cur.execute(f"""
        SELECT
            h.household_id,
            h.household_number,
            h.longitude,
            h.latitude,
            b.barangay_name,
            b.barangay_id,
            h.housing_material,
            h.tenure_status,
            h.has_electricity,
            h.water_source,
            h.toilet_type,
            h.surveyed_date,
            COUNT(i.person_id) AS member_count,
            v.vuln_score,
            v.vuln_category,
            v.resil_score,
            v.resil_category,

            -- NEW: hazard exposure
            h.flood_exposure,
            h.landslide_exposure,
            h.hazard_exposure_score,
            h.hazard_data_status,
            h.compound_hazard,

            -- NEW: household typology (Domain A, Level 2 -- Sir Shem's
            -- cluster_households(), backfilled once by
            -- backfill_typology_clusters.py against uid_internal)
            h.typology_cluster_id,
            h.typology_cluster_label,
            -- the 13 typology features (so the household list can show how
            -- close each household is to every profile, and filter by them)
            h.ti_overcrowding, h.ti_food_insecure, h.ti_no_internet,
            h.ti_weak_roof, h.ti_weak_wall, h.ti_insecure_tenure,
            h.ti_unimproved_sanitation, h.ti_pwd_count_cat, h.ti_senior_count_cat,
            h.ti_solo_parent_count_cat, h.ti_low_adult_education_hh,
            h.ti_large_household, h.ti_financially_excluded,

            -- NEW: income
            h.household_estimated_income,
            h.income_basis,
            h.asset_premium_pct,

            -- NEW: social program / composition
            h.is_4ps_beneficiary,
            h.overcrowding_status,
            h.food_insecurity_score,
            h.pwd_count,
            h.senior_count,
            h.solo_parent_count,
            h.avg_education_level_adults,
            h.employed_count,
            h.working_age_count,
            h.dependency_ratio,
            h.employment_rate_adults,

            -- NEW: adaptive capacity
            h.has_formal_financial_account,
            h.has_social_insurance,
            h.knows_evacuation_location,
            h.knows_emergency_hotline,

            -- NEW: housing detail / fuel (these were missing entirely — the
            -- cause of Housing Detail/Service Levels always showing blank)
            h.housing_roof,
            h.housing_floor,
            h.o12_fuel_for_lighting,
            h.o13_fuel_for_cooking,
            h.water_service_level,
            h.toilet_service_level,

            -- NEW: identity / location (also previously missing)
            h.hh_size,
            h.region_code,
            h.province_code,
            h.city_mun_code,
            h.barangay_code,
            h.husn,
            h.hsn
        FROM tbl_households h
        LEFT JOIN tbl_barangays        b ON h.barangay_id  = b.barangay_id
        LEFT JOIN tbl_individuals      i ON h.household_id = i.household_id
        LEFT JOIN tbl_vulnerability_index v ON h.household_id = v.household_id
        {where}
        GROUP BY h.household_id, b.barangay_name, b.barangay_id,
                 v.vuln_score, v.vuln_category, v.resil_score, v.resil_category
        ORDER BY {order}
        LIMIT %s OFFSET %s
    """, params + [limit, offset])
    rows = cur.fetchall()

    cur.execute(f"""
        SELECT COUNT(DISTINCT h.household_id)
        FROM tbl_households h
        LEFT JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
        {where}
    """, params)
    total = cur.fetchone()["count"]

    conn.close()
    return {
        "data":  [dict(r) for r in rows],
        "total": total,
        "page":  page,
        "limit": limit
    }

# ─── READ ONE ────────────────────────────────────────────────
def get_household_by_id(household_id):
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT h.*, b.barangay_name, b.barangay_code,
            (SELECT COUNT(*) FROM tbl_individuals i WHERE i.household_id = h.household_id) AS member_count
        FROM tbl_households h
        LEFT JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
        WHERE h.household_id = %s
    """, (household_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    result = dict(row)
    # Raw UUID never leaves this function in a normal response -- only
    # exposed through the password-gated /reveal-uid endpoint. After the
    # column swap, the raw UUID lives under uid_internal (household_number
    # is now the friendly code, safe to return as-is).
    result.pop("uid_internal", None)
    return result

# ─── CREATE ──────────────────────────────────────────────────
def create_household(data):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        barangay_id = data.get("barangay_id")
        if not barangay_id:
            return {"error": "barangay_id is required to generate a household code"}

        # household_number (the DB column) is ALWAYS server-generated --
        # never trust a frontend-supplied value for the household's public
        # identifier. uid_internal keeps whatever raw identifier the source
        # data had (e.g. the CBMS UUID, still passed in under the JSON key
        # "household_number" from the frontend/importer) purely for
        # internal/audit purposes; it is never sent back in normal API
        # responses (see get_all_households / get_household_by_id below)
        # -- only through the password-gated /reveal-uid endpoint.
        display_code = generate_display_code(cur, barangay_id)

        # ── Auto-compute hazard exposure from the pinned coordinates ──
        # Location pinning is required at creation (enforced by the
        # frontend's map picker), so longitude/latitude should always be
        # present here. These five fields are always DERIVED from
        # coordinates -- never trust a client-supplied value for them,
        # even if one happens to be sent; this overwrites anything the
        # caller sent for these keys.
        hazard = detect_hazard_exposure(data.get("longitude"), data.get("latitude"))
        data = {**data, **hazard}

        base_cols = ["uid_internal", "household_number", "barangay_id", "housing_material",
                     "tenure_status", "has_electricity", "water_source",
                     "toilet_type", "surveyed_date"]
        all_cols  = base_cols + NEW_HOUSEHOLD_FIELDS
        col_sql   = ", ".join(all_cols)
        ph_sql    = ", ".join(["%s"] * len(all_cols))
        values = [
            data["household_number"],   # raw incoming identifier -> uid_internal column
            display_code,                # server-generated friendly code -> household_number column
            barangay_id,
            data.get("housing_material"),
            data.get("tenure_status"),
            data.get("has_electricity", False),
            data.get("water_source"),
            data.get("toilet_type"),
            data.get("surveyed_date"),
        ] + [data.get(f) for f in NEW_HOUSEHOLD_FIELDS]

        cur.execute(f"""
            INSERT INTO tbl_households
                ({col_sql})
            VALUES ({ph_sql})
            RETURNING household_id
        """, values)
        new_id = cur.fetchone()["household_id"]
        conn.commit()
        return {"household_id": new_id, "display_code": display_code, "message": "Household created successfully"}
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        return {"error": f"Household identifier '{data['household_number']}' already exists"}
    finally:
        conn.close()

# ─── UPDATE ──────────────────────────────────────────────────
def update_household(household_id, data):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        # ── Auto-recompute hazard exposure if coordinates changed ──
        # Same rule as create: these five fields are always derived, never
        # manually editable. If only one of longitude/latitude was sent,
        # fall back to the household's existing stored value for the other
        # so a partial coordinate update doesn't compute against None.
        if "longitude" in data or "latitude" in data:
            lon = data.get("longitude")
            lat = data.get("latitude")
            if lon is None or lat is None:
                cur.execute(
                    "SELECT longitude, latitude FROM tbl_households WHERE household_id = %s",
                    (household_id,)
                )
                existing_coords = cur.fetchone()
                if existing_coords:
                    lon = lon if lon is not None else existing_coords["longitude"]
                    lat = lat if lat is not None else existing_coords["latitude"]
            hazard = detect_hazard_exposure(lon, lat)
            data = {**data, **hazard}

        base_cols = ["barangay_id", "housing_material", "tenure_status",
                     "has_electricity", "water_source", "toilet_type", "surveyed_date"]
        # Legacy fields are always written (preserves existing behavior — old
        # forms send these unconditionally, including intentional clears).
        # New CBMS fields are only written if the caller's payload actually
        # includes the key — otherwise a caller that doesn't know these fields
        # exist (e.g. HouseholdForm.jsx's manual edit form) would silently
        # NULL out real imported data on every save.
        present_new_fields = [f for f in NEW_HOUSEHOLD_FIELDS if f in data]
        all_cols = base_cols + present_new_fields
        set_sql  = ",\n                ".join([f"{c} = %s" for c in all_cols])
        values = [
            data.get("barangay_id"),
            data.get("housing_material"),
            data.get("tenure_status"),
            data.get("has_electricity", False),
            data.get("water_source"),
            data.get("toilet_type"),
            data.get("surveyed_date"),
        ] + [data.get(f) for f in present_new_fields] + [household_id]

        cur.execute(f"""
            UPDATE tbl_households SET
                {set_sql},
                updated_at = NOW()
            WHERE household_id = %s
            RETURNING household_id
        """, values)
        updated = cur.fetchone()
        conn.commit()
        if updated:
            return {"message": "Household updated successfully"}
        return {"error": "Household not found"}
    finally:
        conn.close()

# ─── REVEAL RAW UUID (password-gated, see household_routes.py) ──
def get_raw_household_number(household_id):
    conn = get_conn()
    cur  = conn.cursor()
    # Post-swap: uid_internal holds the raw UUID, household_number holds
    # the friendly code. Response keys kept as household_number/display_code
    # in the dict below so household_routes.py's API contract doesn't need
    # to change.
    cur.execute(
        "SELECT uid_internal, household_number FROM tbl_households WHERE household_id = %s",
        (household_id,)
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "household_number": row["uid_internal"],     # the raw UUID
        "display_code":     row["household_number"], # the friendly code
    }


def log_uid_reveal(household_id, user_id):
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute(
        "INSERT INTO tbl_uid_reveal_log (household_id, user_id) VALUES (%s, %s)",
        (household_id, user_id)
    )
    conn.commit()
    conn.close()


# ─── DELETE ──────────────────────────────────────────────────
def delete_household(household_id):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        # Cascade: remove members, vulnerability index, then household
        cur.execute(
            "DELETE FROM tbl_individuals WHERE household_id = %s",
            (household_id,)
        )
        cur.execute(
            "DELETE FROM tbl_vulnerability_index WHERE household_id = %s",
            (household_id,)
        )
        cur.execute(
            "DELETE FROM tbl_households WHERE household_id = %s RETURNING household_id",
            (household_id,)
        )
        deleted = cur.fetchone()
        conn.commit()
        if deleted:
            return {"message": "Household and all members deleted successfully"}
        return {"error": "Household not found"}
    except Exception as e:
        conn.rollback()
        return {"error": str(e)}
    finally:
        conn.close()