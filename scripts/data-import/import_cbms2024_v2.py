"""
CBMS 2024 -> Postgres import (v3)
==================================
Same connection + COPY pattern as v2, but now carries ALL raw CSV headers
through into tbl_households and tbl_individuals (not just the curated
subset used for score computation). Vulnerability scoring still lives in
a separate script/table (tbl_vulnerability_index) as before.

SETUP (run once):
    pip install psycopg2-binary pandas

FILES NEEDED in the data folder:
    - aligned_data_FINAL.csv          (already there)
    - cbms_person_record.csv          (optional but recommended -- add it
                                        to the data folder so occupation
                                        and educational_attainment aren't
                                        left blank)

BEFORE RUNNING:
    Make sure you've already run the ALTER TABLE statements to add the
    new raw columns to tbl_households and tbl_individuals.

RUN:
    python import_cbms2024_v3.py
"""

import io
import os
import pandas as pd
import numpy as np
import psycopg2

# ============================================================
# 1) CONFIG
# ============================================================
DATA_DIR = r"C:\Users\mhelb\OneDrive\Desktop\Thesis System\data"
CSV_PATH = os.path.join(DATA_DIR, "aligned_data_FINAL.csv")
PERSON_RAW_PATH = os.path.join(DATA_DIR, "cbms_person_record.csv")

DB = {
    "host": "localhost",
    "port": 5432,
    "dbname": "lgu_masterdata",
    "user": "postgres",
    "password": __import__("os").getenv("DB_PASSWORD", ""),  # <-- fill in locally, don't commit this file with it filled in
}

POVERTY_LINE = 13801

# Barangay name crosswalk: our data's naming convention -> tbl_barangays' naming convention
BARANGAY_NAME_MAP = {
    "Bgy. 1 Pob.": "Brgy 1",
    "Bgy. 10": "Brgy 10",
    "Bgy. 11 Pob.": "Brgy 11",
    "Bgy. 12 Pob.": "Brgy 12",
    "Bgy. 13 Pob.": "Brgy 13",
    "Bgy. 14 Pob.": "Brgy 14",
    "Bgy. 15 Pob.": "Brgy 15",
    "Bgy. 16 Pob.": "Brgy 16",
    "Bgy. 2 Pob.": "Brgy 2",
    "Bgy. 3 Pob.": "Brgy 3",
    "Bgy. 4 Pob.": "Brgy 4",
    "Bgy. 5 Pob.": "Brgy 5",
    "Bgy. 6 Pob.": "Brgy 6",
    "Bgy. 7 Pob.": "Brgy 7",
    "Bgy. 8 Pob.": "Brgy 8",
    "Bgy. 9 Pob.": "Brgy 9",
    "Consolacion": "Brgy Consolacion",
    "Igtambo": "Brgy Igtambo",
    "San Antonio": "Brgy San Antonio",
    "San Jose": "Brgy San Jose",
    "Santa Cruz": "Brgy Sta Cruz",
    "Santa Teresa": "Brgy Sta Teresa",
    "Santo Angel": "Brgy Sto Angel",
    "Santo Niño": "Brgy Sto Nino",
}


# ============================================================
# 2) SCORE COMPUTATION (same formula as before -- unchanged)
# ============================================================
def compute_scores(df):
    hh = df.drop_duplicates(subset="uuid").copy()

    def num(s):
        return pd.to_numeric(s, errors="coerce")

    hazard_e = num(hh["hazard_exposure_score"]).fillna(0) / 4
    wall_risk = {
        "Concrete/brick/stone": 0.0, "Fiber cement board": 0.0,
        "Half concrete/brick/stone and half wood": 0.33, "Metal sheet": 0.33,
        "Wood/bamboo": 0.67, "Sawali/cogon/nipa": 0.67, "Asbestos": 0.67,
        "Makeshift/salvaged/improvised": 1.0, "Glass": 1.0, "Others": 0.5,
    }
    housing_e = hh["housing_walls"].map(wall_risk).fillna(0.5)
    service_risk = {"Basic": 0.0, "Limited": 0.33, "Unimproved": 0.67,
                     "Surface water/Open defecation": 1.0}
    water_e = hh["water_service_level"].map(service_risk).fillna(0.5)
    toilet_e = hh["toilet_service_level"].map(service_risk).fillna(0.5)
    E = (hazard_e + housing_e + water_e + toilet_e) / 4

    dep_s = (num(hh["dependency_ratio"]).fillna(0) / 2).clip(upper=1)
    hh_size = num(hh["hh_size"]).replace(0, np.nan)
    vuln_members = (num(hh["pwd_count"]).fillna(0) + num(hh["senior_count"]).fillna(0)
                     + num(hh["solo_parent_count"]).fillna(0))
    vuln_member_s = (vuln_members / hh_size).clip(upper=1).fillna(0)
    food_s = (num(hh["food_insecurity_score"]).fillna(0) / 8).clip(upper=1)
    overcrowd_s = (hh["overcrowding_status"] == "True").astype(float)
    income = num(hh["household_estimated_income"]).fillna(0)
    normalized_income_score = (income / POVERTY_LINE).clip(upper=2)
    poverty_s = (1 - normalized_income_score.clip(upper=1)).clip(lower=0)
    fourps_s = (hh["is_4ps_beneficiary"] == "Yes").astype(float)
    S = (dep_s + vuln_member_s + food_s + overcrowd_s + poverty_s + fourps_s) / 6

    income_ac = (normalized_income_score / 2).clip(upper=1)
    edu_ac = (num(hh["avg_education_level_adults"]).fillna(0) / 8).clip(upper=1)
    employ_ac = num(hh["employment_rate_adults"]).fillna(0).clip(upper=1)
    tenure_own = hh["o09_tenure"].astype(str).str.contains("Own", na=False)
    tenure_ac = tenure_own.astype(float) * 1.0 + (~tenure_own).astype(float) * 0.3
    finance_ac = (hh["has_formal_financial_account"] == "Yes").astype(float)
    insurance_ac = (hh["has_social_insurance"] == "Yes").astype(float)
    evac_ac = (hh["knows_evacuation_location"] == "Yes").astype(float)
    hotline_ac = (hh["knows_emergency_hotline"] == "Yes").astype(float)
    disaster_prep_ac = (evac_ac + hotline_ac) / 2
    electricity_ac = (hh["o11_electricity"] == "Yes").astype(float)
    AC = (income_ac + edu_ac + employ_ac + tenure_ac + finance_ac + insurance_ac
          + disaster_prep_ac + electricity_ac) / 8
    AC_safe = AC.clip(lower=0.05)

    BVI_raw = (E + S) / AC_safe
    vuln_score = (BVI_raw * 2.5).clip(upper=10)

    def vuln_cat(x):
        if x <= 1: return "Low"
        elif x <= 2: return "Moderate"
        elif x <= 3: return "High"
        return "Very High"

    vuln_category = BVI_raw.apply(vuln_cat)
    resil_frac = (1 - BVI_raw / 4).clip(lower=0)
    resil_score = (resil_frac * 10).clip(upper=10)

    def resil_cat(x):
        if x >= 0.75: return "High"
        elif x >= 0.50: return "Moderate"
        elif x >= 0.25: return "Low"
        return "Very Low"

    resil_category = resil_frac.apply(resil_cat)

    return pd.DataFrame({
        "household_uuid": hh["uuid"], "barangay_name": hh["barangay"],
        "exposure_score": E.round(4), "sensitivity_score": S.round(4),
        "adaptive_capacity_score": AC.round(4), "vuln_score": vuln_score.round(2),
        "vuln_category": vuln_category, "resil_score": resil_score.round(2),
        "resil_category": resil_category,
        "normalized_income_score": normalized_income_score.round(4),
        "total_members": num(hh["hh_size"]).astype("Int64"),
        "pwd_count": num(hh["pwd_count"]).astype("Int64"),
        "senior_count": num(hh["senior_count"]).astype("Int64"),
        "solo_parent_count": num(hh["solo_parent_count"]).astype("Int64"),
        "fourps_count": fourps_s.astype(int),
    })


# ============================================================
# 3) HOUSEHOLDS -- now carries ALL raw CSV headers through
# ============================================================
def build_households(df):
    hh = df.drop_duplicates(subset="uuid").copy()

    def num(s):
        return pd.to_numeric(s, errors="coerce")

    return pd.DataFrame({
        # ---- identity / location ----
        "household_uuid": hh["uuid"],
        "household_number": hh["uuid"],  # husn-hsn isn't reliably unique across barangays; uuid is
        "barangay_name": hh["barangay"],
        "region_code": hh["region_code"],
        "province_code": hh["province_code"],
        "city_mun_code": hh["city_mun_code"],
        "barangay_code": hh["barangay_code"],
        "husn": hh["husn"],
        "hsn": hh["hsn"],
        "longitude": num(hh["longitude"]),
        "latitude": num(hh["latitude"]),
        "hh_size": num(hh["hh_size"]).astype("Int64"),

        # ---- housing ----
        "housing_material": hh["housing_walls"],
        "housing_roof": hh["housing_roof"],
        "housing_floor": hh["housing_floor"],
        "tenure_status": hh["o09_tenure"],
        "has_electricity": (hh["o11_electricity"] == "Yes"),
        "o12_fuel_for_lighting": hh["o12_fuel_for_lighting"],
        "o13_fuel_for_cooking": hh["o13_fuel_for_cooking"],
        "water_source": hh["water_source"],
        "water_service_level": hh["water_service_level"],
        "toilet_type": hh["toilet_type"],
        "toilet_service_level": hh["toilet_service_level"],
        "surveyed_date": "2024-07-01",

        # ---- income ----
        "monthly_income": num(hh["household_estimated_income"]).round(2),
        "household_estimated_income": num(hh["household_estimated_income"]).round(2),
        "income_basis": hh["income_basis"],
        "asset_premium_pct": num(hh["asset_premium_pct"]),

        # ---- hazard ----
        "flood_exposure": hh["flood_exposure"],
        "landslide_exposure": hh["landslide_exposure"],
        "hazard_exposure_score": num(hh["hazard_exposure_score"]),
        "compound_hazard": hh["compound_hazard"],
        "hazard_data_status": hh["hazard_data_status"],

        # ---- social program / vulnerability composition ----
        "is_4ps_beneficiary": hh["is_4ps_beneficiary"],
        "overcrowding_status": hh["overcrowding_status"],
        "food_insecurity_score": num(hh["food_insecurity_score"]),
        "has_formal_financial_account": hh["has_formal_financial_account"],
        "has_social_insurance": hh["has_social_insurance"],
        "knows_evacuation_location": hh["knows_evacuation_location"],
        "knows_emergency_hotline": hh["knows_emergency_hotline"],
        "pwd_count": num(hh["pwd_count"]).astype("Int64"),
        "senior_count": num(hh["senior_count"]).astype("Int64"),
        "solo_parent_count": num(hh["solo_parent_count"]).astype("Int64"),
        "avg_education_level_adults": num(hh["avg_education_level_adults"]),
        "employed_count": num(hh["employed_count"]).astype("Int64"),
        "working_age_count": num(hh["working_age_count"]).astype("Int64"),
        "dependency_count": num(hh["dependency_count"]).astype("Int64"),
        "dependency_ratio": num(hh["dependency_ratio"]),
        "employment_rate_adults": num(hh["employment_rate_adults"]),
    })


HOUSEHOLD_COLUMNS = [
    "household_uuid", "household_number", "barangay_name",
    "region_code", "province_code", "city_mun_code", "barangay_code",
    "husn", "hsn", "longitude", "latitude", "hh_size",
    "housing_material", "housing_roof", "housing_floor", "tenure_status",
    "has_electricity", "o12_fuel_for_lighting", "o13_fuel_for_cooking",
    "water_source", "water_service_level", "toilet_type", "toilet_service_level",
    "surveyed_date", "monthly_income", "household_estimated_income", "income_basis",
    "asset_premium_pct", "flood_exposure", "landslide_exposure", "hazard_exposure_score",
    "compound_hazard", "hazard_data_status", "is_4ps_beneficiary", "overcrowding_status",
    "food_insecurity_score", "has_formal_financial_account", "has_social_insurance",
    "knows_evacuation_location", "knows_emergency_hotline", "pwd_count", "senior_count",
    "solo_parent_count", "avg_education_level_adults", "employed_count",
    "working_age_count", "dependency_count", "dependency_ratio", "employment_rate_adults",
]

# columns NOT included in the household_uuid (used for household_id_map join, not
# inserted directly): household_uuid is used to map back to household_id
HOUSEHOLD_INSERT_COLUMNS = [c for c in HOUSEHOLD_COLUMNS if c != "household_uuid"]


# ============================================================
# 4) INDIVIDUALS -- now carries ALL raw CSV headers through
# ============================================================
def build_individuals(df, person_raw_path=None):
    occ_map = {"0": "Armed Forces", "1": "Managers", "2": "Professionals",
               "3": "Technicians/Associate Professionals", "4": "Clerical Support Workers",
               "5": "Service and Sales Workers", "6": "Skilled Agricultural/Forestry/Fishery",
               "7": "Craft and Related Trades Workers", "8": "Plant/Machine Operators",
               "9": "Elementary Occupations"}
    edu_map = {"0": "Early childhood", "1": "Elementary", "2": "Junior high school",
               "3": "Senior high school", "4": "Post-secondary non-tertiary",
               "5": "Short-cycle tertiary", "6": "College", "7": "Masteral", "8": "Doctoral"}

    def num(s):
        return pd.to_numeric(s, errors="coerce")

    full_name = (df["a01_first_name"].fillna("") + " " + df["a01_middle_name"].fillna("") + " "
                 + df["a01_last_name"].fillna("") + " " + df["a01_suffix"].fillna(""))
    full_name = full_name.str.replace(r"\s+", " ", regex=True).str.strip()

    occupation_label = pd.Series([None] * len(df), index=df.index)
    education_label = pd.Series([None] * len(df), index=df.index)
    if person_raw_path and os.path.exists(person_raw_path):
        praw = pd.read_csv(person_raw_path, dtype=str)
        praw["line_number_n"] = praw["line_number"].astype(int)
        df2 = df.copy()
        df2["line_number_n"] = df2["line_number"].astype(int)
        lookup = praw[["uuid", "line_number_n", "e05_occupation_group", "a11_hgc_level"]].copy()
        lookup["occupation_label"] = lookup["e05_occupation_group"].map(occ_map)
        lookup["education_label"] = lookup["a11_hgc_level"].map(edu_map)
        merged = df2.merge(lookup[["uuid", "line_number_n", "occupation_label", "education_label"]],
                            on=["uuid", "line_number_n"], how="left")
        occupation_label = merged["occupation_label"]
        education_label = merged["education_label"]
        print(f"  Occupation/education merged: {occupation_label.notna().sum()} / "
              f"{education_label.notna().sum()} populated")
    else:
        print(f"  WARNING: {person_raw_path} not found — occupation/educational_attainment "
              f"will be NULL. Drop cbms_person_record.csv into the data folder to fix this.")

    return pd.DataFrame({
        "household_uuid": df["uuid"],
        "person_code": df["uuid"] + "-" + df["line_number"],
        "line_number": df["line_number"],
        "last_name": df["a01_last_name"],
        "first_name": df["a01_first_name"],
        "suffix": df["a01_suffix"],
        "middle_name": df["a01_middle_name"],
        "age": num(df["a05_age"]).astype("Int64"),
        "birthday_month": df["a04_birthday_month"],
        "birthday_day": df["a04_birthday_day"],
        "birthday_year": df["a04_birthday_year"],
        "age_group_five_years": df["a05_age_group_five_years"],
        "civil_status": df["a07_marital_status"],
        "religion": df["a08_religion"],
        "nuclear_family": df["b01_nuclear_family"],
        "relation_to_nuclear_family_head": df["b02_relation_to_nuclear_family_head"],
        "with_pwd_id": df["b11_with_pwd_id"],
        "employment_status": df["e01_employment_status"],
        "estimated_monthly_income": num(df["estimated_monthly_income"]).round(2),
        "occupation": occupation_label,
        "monthly_income": num(df["estimated_monthly_income"]).round(2),
        "is_senior": num(df["a05_age"]) >= 60,
        "is_pwd": df["b10_pwd"] == "Yes",
        "is_solo_parent": df["b05_solo_parent"] == "Yes",
        "is_4ps": df["is_4ps_beneficiary"] == "Yes",
        "relationship_to_hh": df["a02_relation_to_hh_head"],
        "is_household_head": df["a02_relation_to_hh_head"] == "Head",
        "full_name": full_name,
        "gender": df["a03_sex"],
        "educational_attainment": education_label,
    })


INDIVIDUAL_COLUMNS = [
    "household_uuid", "person_code", "line_number", "last_name", "first_name",
    "suffix", "middle_name", "age", "birthday_month", "birthday_day", "birthday_year",
    "age_group_five_years", "civil_status", "religion", "nuclear_family",
    "relation_to_nuclear_family_head", "with_pwd_id", "employment_status",
    "estimated_monthly_income", "occupation", "monthly_income", "is_senior", "is_pwd",
    "is_solo_parent", "is_4ps", "relationship_to_hh", "is_household_head", "full_name",
    "gender", "educational_attainment",
]

INDIVIDUAL_INSERT_COLUMNS = [c for c in INDIVIDUAL_COLUMNS if c != "household_uuid"]


def bulk_copy(cur, df, table_name, columns):
    """Same pattern as before: TRUNCATE then COPY via in-memory CSV buffer."""
    cur.execute(f"TRUNCATE {table_name};")
    buf = io.StringIO()
    df[columns].to_csv(buf, index=False, header=False)
    buf.seek(0)
    col_list = ",".join(columns)
    cur.copy_expert(f"COPY {table_name} ({col_list}) FROM STDIN WITH (FORMAT CSV)", buf)


# ============================================================
# 5) LOAD & COMPUTE
# ============================================================
def main():
    print("Loading CSV...")
    df = pd.read_csv(CSV_PATH, dtype=str)

    print("Applying barangay name crosswalk...")
    unmapped = set(df["barangay"].unique()) - set(BARANGAY_NAME_MAP.keys())
    if unmapped:
        raise ValueError(f"These barangay names have no crosswalk entry: {unmapped}")
    df["barangay"] = df["barangay"].map(BARANGAY_NAME_MAP)
    print(f"  Mapped {df['barangay'].nunique()} barangay names successfully.")

    print("Computing vulnerability scores...")
    vuln_df = compute_scores(df)

    print("Building households table...")
    households_df = build_households(df)

    print("Building individuals table...")
    individuals_df = build_individuals(df, person_raw_path=PERSON_RAW_PATH)

    print(f"Ready: {len(households_df)} households, {len(individuals_df)} individuals, "
          f"{len(vuln_df)} vulnerability records")

    conn = psycopg2.connect(**DB)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            # ---- staging tables ----
            print("\nCreating staging tables...")
            household_stg_cols_sql = ",\n                    ".join(
                f'"{c}" text' if c not in (
                    "longitude", "latitude", "asset_premium_pct", "hazard_exposure_score",
                    "food_insecurity_score", "avg_education_level_adults",
                    "dependency_ratio", "employment_rate_adults", "household_estimated_income",
                    "monthly_income"
                ) and c not in ("hh_size", "pwd_count", "senior_count", "solo_parent_count",
                                 "employed_count", "working_age_count", "dependency_count")
                and c != "has_electricity" and c != "surveyed_date"
                else (
                    f'"{c}" numeric' if c in (
                        "longitude", "latitude", "asset_premium_pct", "hazard_exposure_score",
                        "food_insecurity_score", "avg_education_level_adults",
                        "dependency_ratio", "employment_rate_adults",
                        "household_estimated_income", "monthly_income"
                    ) else (
                        f'"{c}" integer' if c in (
                            "hh_size", "pwd_count", "senior_count", "solo_parent_count",
                            "employed_count", "working_age_count", "dependency_count"
                        ) else (
                            f'"{c}" boolean' if c == "has_electricity" else f'"{c}" date'
                        )
                    )
                )
                for c in HOUSEHOLD_COLUMNS
            )

            individual_stg_cols_sql = ",\n                    ".join(
                f'"{c}" integer' if c in ("age",) else
                f'"{c}" numeric' if c in ("estimated_monthly_income", "monthly_income") else
                f'"{c}" boolean' if c in ("is_senior", "is_pwd", "is_solo_parent", "is_4ps",
                                          "is_household_head") else
                f'"{c}" text'
                for c in INDIVIDUAL_COLUMNS
            )

            cur.execute(f"""
                DROP TABLE IF EXISTS stg_cbms2024_households;
                CREATE TABLE stg_cbms2024_households (
                    {household_stg_cols_sql}
                );
                DROP TABLE IF EXISTS stg_cbms2024_individuals;
                CREATE TABLE stg_cbms2024_individuals (
                    {individual_stg_cols_sql}
                );
                DROP TABLE IF EXISTS stg_cbms2024_vulnerability;
                CREATE TABLE stg_cbms2024_vulnerability (
                    household_uuid text, barangay_name text, exposure_score numeric,
                    sensitivity_score numeric, adaptive_capacity_score numeric,
                    vuln_score numeric, vuln_category text, resil_score numeric,
                    resil_category text, normalized_income_score numeric,
                    total_members integer, pwd_count integer, senior_count integer,
                    solo_parent_count integer, fourps_count integer
                );
            """)

            # ---- bulk load via the proven COPY pattern ----
            print("Bulk-loading households into staging...")
            bulk_copy(cur, households_df, "stg_cbms2024_households", HOUSEHOLD_COLUMNS)

            print("Bulk-loading individuals into staging...")
            bulk_copy(cur, individuals_df, "stg_cbms2024_individuals", INDIVIDUAL_COLUMNS)

            print("Bulk-loading vulnerability index into staging...")
            bulk_copy(cur, vuln_df, "stg_cbms2024_vulnerability",
                      ["household_uuid", "barangay_name", "exposure_score", "sensitivity_score",
                       "adaptive_capacity_score", "vuln_score", "vuln_category", "resil_score",
                       "resil_category", "normalized_income_score", "total_members", "pwd_count",
                       "senior_count", "solo_parent_count", "fourps_count"])

            # ---- verify staging landed correctly ----
            cur.execute("SELECT count(*) FROM stg_cbms2024_households;")
            n1 = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM stg_cbms2024_individuals;")
            n2 = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM stg_cbms2024_vulnerability;")
            n3 = cur.fetchone()[0]
            print(f"Staging loaded: households={n1}, individuals={n2}, vulnerability={n3}")

            # ---- barangay name check ----
            print("Checking barangay names match tbl_barangays...")
            cur.execute("""
                SELECT DISTINCT s.barangay_name
                FROM stg_cbms2024_households s
                LEFT JOIN tbl_barangays b ON b.barangay_name = s.barangay_name
                WHERE b.barangay_id IS NULL;
            """)
            mismatches = cur.fetchall()
            if mismatches:
                raise ValueError(f"Barangay name mismatches found: {mismatches}")
            print("  All barangay names matched.")

            # ---- the actual replace ----
            print("\nTruncating live tables...")
            cur.execute("""
                TRUNCATE tbl_households, tbl_individuals, tbl_vulnerability_index,
                         tbl_barangay_vulnerability CASCADE;
            """)

            print("Inserting households (resolving barangay_id)...")
            household_select_cols = ",\n                           ".join(
                f"s.{c}" if c != "barangay_name" else "b.barangay_id"
                for c in HOUSEHOLD_INSERT_COLUMNS
            )
            # barangay_id replaces barangay_name in the actual insert target list
            household_target_cols = [
                "barangay_id" if c == "barangay_name" else c
                for c in HOUSEHOLD_INSERT_COLUMNS
            ]
            cur.execute(f"""
                CREATE TEMP TABLE household_id_map AS
                WITH inserted AS (
                    INSERT INTO tbl_households (
                        {", ".join(household_target_cols)}
                    )
                    SELECT {household_select_cols}
                    FROM stg_cbms2024_households s
                    JOIN tbl_barangays b ON b.barangay_name = s.barangay_name
                    RETURNING household_id, household_number
                )
                SELECT i.household_id, s.household_uuid
                FROM inserted i
                JOIN stg_cbms2024_households s ON s.household_number = i.household_number;
            """)

            print("Inserting individuals...")
            individual_select_cols = ", ".join(f"s.{c}" for c in INDIVIDUAL_INSERT_COLUMNS)
            cur.execute(f"""
                INSERT INTO tbl_individuals (
                    household_id, {", ".join(INDIVIDUAL_INSERT_COLUMNS)}
                )
                SELECT m.household_id, {individual_select_cols}
                FROM stg_cbms2024_individuals s
                JOIN household_id_map m ON m.household_uuid = s.household_uuid;
            """)

            print("Inserting vulnerability index...")
            cur.execute("""
                INSERT INTO tbl_vulnerability_index (
                    household_id, barangay_id, exposure_score, sensitivity_score,
                    adaptive_capacity_score, vuln_score, vuln_category, resil_score,
                    resil_category, normalized_income_score, total_members, pwd_count,
                    senior_count, solo_parent_count, fourps_count, computed_at
                )
                SELECT m.household_id, b.barangay_id, v.exposure_score, v.sensitivity_score,
                       v.adaptive_capacity_score, v.vuln_score, v.vuln_category, v.resil_score,
                       v.resil_category, v.normalized_income_score, v.total_members, v.pwd_count,
                       v.senior_count, v.solo_parent_count, v.fourps_count, now()
                FROM stg_cbms2024_vulnerability v
                JOIN household_id_map m ON m.household_uuid = v.household_uuid
                JOIN tbl_barangays b ON b.barangay_name = v.barangay_name;
            """)

            print("Recomputing barangay-level rollup...")
            cur.execute("""
                INSERT INTO tbl_barangay_vulnerability (
                    barangay_id, barangay_name, total_households, avg_vuln_score, avg_resil_score,
                    avg_exposure, avg_sensitivity, avg_adaptive_capacity,
                    low_vuln_count, medium_vuln_count, high_vuln_count, very_high_vuln_count,
                    high_resil_count, moderate_resil_count, low_resil_count, very_low_resil_count,
                    risk_level, computed_at
                )
                SELECT b.barangay_id, b.barangay_name, count(*),
                       round(avg(vi.vuln_score),2), round(avg(vi.resil_score),2),
                       round(avg(vi.exposure_score),4), round(avg(vi.sensitivity_score),4),
                       round(avg(vi.adaptive_capacity_score),4),
                       count(*) FILTER (WHERE vi.vuln_category='Low'),
                       count(*) FILTER (WHERE vi.vuln_category='Moderate'),
                       count(*) FILTER (WHERE vi.vuln_category='High'),
                       count(*) FILTER (WHERE vi.vuln_category='Very High'),
                       count(*) FILTER (WHERE vi.resil_category='High'),
                       count(*) FILTER (WHERE vi.resil_category='Moderate'),
                       count(*) FILTER (WHERE vi.resil_category='Low'),
                       count(*) FILTER (WHERE vi.resil_category='Very Low'),
                       CASE WHEN avg(vi.vuln_score)<=2.5 THEN 'Low'
                            WHEN avg(vi.vuln_score)<=5.0 THEN 'Moderate'
                            WHEN avg(vi.vuln_score)<=7.5 THEN 'High'
                            ELSE 'Very High' END,
                       now()
                FROM tbl_vulnerability_index vi
                JOIN tbl_barangays b ON b.barangay_id = vi.barangay_id
                GROUP BY b.barangay_id, b.barangay_name;
            """)

            # ---- verify before commit ----
            cur.execute("SELECT count(*) FROM tbl_households;")
            n_hh = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM tbl_individuals;")
            n_ind = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM tbl_vulnerability_index;")
            n_vi = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM tbl_barangay_vulnerability;")
            n_bv = cur.fetchone()[0]

            print(f"\nFinal counts: households={n_hh}, individuals={n_ind}, "
                  f"vulnerability_index={n_vi}, barangay_vulnerability={n_bv}")
            print("Expected:      households=7249, individuals=28866, "
                  "vulnerability_index=7249, barangay_vulnerability=24")

            if n_hh == 7249 and n_ind == 28866 and n_vi == 7249 and n_bv == 24:
                conn.commit()
                print("\n*** SUCCESS — committed. ***")
            else:
                conn.rollback()
                print("\n*** Counts didn't match — rolled back, nothing changed. ***")

    except Exception as e:
        conn.rollback()
        print(f"\n*** ERROR — rolled back, nothing changed. ***\n{e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()