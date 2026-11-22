import io
import pandas as pd
import psycopg2

# 1) Update this to the exact file path
XLSX_PATH = r"C:\Users\mhelb\OneDrive\Desktop\Thesis System\data\NEW CLEANED DATA_V2.xlsx"
SHEET_NAME = 0  # change if needed (e.g., "Sheet1")

# 2) Update DB connection settings
DB = {
    "host": "localhost",
    "port": 5432,
    "dbname": "lgu_masterdata",
    "user": "postgres",
    "password": __import__("os").getenv("DB_PASSWORD", "")  # <-- put your real password here locally (don’t share it)
}

def norm_bool(x):
    """Convert YES/NO-ish values to True/False/None."""
    if pd.isna(x):
        return None
    v = str(x).strip().lower()
    if v in ("yes", "y", "true", "1"):
        return True
    if v in ("no", "n", "false", "0"):
        return False
    return None

def norm_text(x):
    if pd.isna(x):
        return None
    s = str(x).strip()
    return s if s != "" else None

def norm_income(x):
    """Convert income to numeric; handles commas like 10,000."""
    if pd.isna(x):
        return None
    s = str(x).strip().replace(",", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None

def main():
    df = pd.read_excel(XLSX_PATH, sheet_name=SHEET_NAME, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]

    print("Excel columns found:")
    for c in df.columns:
        print(" -", c)

    # Excel headers -> staging column names
    rename = {
        "Barangay": "barangay",
        "Node_ID": "node_id",
        "HH No.": "hh_no",
        "Unique_HH_ID": "unique_hh_id",
        "HH/M": "hh_m",
        "Household Members": "household_members",
        "Relationship to HH": "relationship_to_hh",
        "Relationship_Category": "relationship_category",
        "Gender": "gender",
        "Age": "age",
        "Civil Status": "civil_status",
        "Occupation": "occupation",
        "Educational Attainment": "educational_attainment",
        "Estimated Family Income (Monthly)": "estimated_family_income_monthly",
        "Senior Citizen": "is_senior",
        "PWD": "is_pwd",
        "Solo Parent": "is_solo_parent",
        "Water Source": "water_source",
        "Electricity": "has_electricity",
        "Type of Toilet": "toilet_type",
        "Type of Building Materials": "housing_material",
        "Tenure Status": "tenure_status",
        "Network_Source": "network_source",
        "Network_Target": "network_target",
        "Edge_Type": "edge_type",
        "4 P's Member (yes-no)": "is_4ps",
    }

    # Apply rename only for columns that exist
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})

    # Explicit required order (matches COPY order exactly)
    required = [
        "barangay",
        "node_id",
        "hh_no",
        "unique_hh_id",
        "hh_m",
        "household_members",
        "relationship_to_hh",
        "relationship_category",
        "gender",
        "age",
        "civil_status",
        "occupation",
        "educational_attainment",
        "estimated_family_income_monthly",
        "is_senior",
        "is_pwd",
        "is_solo_parent",
        "water_source",
        "has_electricity",
        "toilet_type",
        "housing_material",
        "tenure_status",
        "network_source",
        "network_target",
        "edge_type",
        "is_4ps",
    ]

    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(
            f"Missing columns after rename: {missing}\n"
            f"Available columns: {list(df.columns)}\n"
            "Fix: adjust the 'rename' mapping to match your exact Excel headers."
        )

    df = df[required].copy()

    # Clean text columns (IMPORTANT: include unique_hh_id)
    text_cols = [
        "barangay", "node_id", "hh_no", "unique_hh_id", "hh_m", "household_members",
        "relationship_to_hh", "relationship_category", "gender", "civil_status",
        "occupation", "educational_attainment", "water_source", "toilet_type",
        "housing_material", "tenure_status", "network_source", "network_target",
        "edge_type"
    ]
    for col in text_cols:
        df[col] = df[col].apply(norm_text)

    # Ensure Unique_HH_ID exists for all rows (fail early if not)
    bad_unique = df["unique_hh_id"].isna().sum()
    if bad_unique > 0:
        raise ValueError(f"unique_hh_id has {bad_unique} blank/null rows. Fix the Excel column Unique_HH_ID.")

    df["age"] = pd.to_numeric(df["age"], errors="coerce").astype("Int64")
    df["estimated_family_income_monthly"] = df["estimated_family_income_monthly"].apply(norm_income)

    for col in ["is_senior", "is_pwd", "is_solo_parent", "has_electricity", "is_4ps"]:
        df[col] = df[col].apply(norm_bool)

    # Connect and COPY into staging
    conn = psycopg2.connect(**DB)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE stg_new_cleaned;")

            buf = io.StringIO()
            df.to_csv(buf, index=False, header=False)
            buf.seek(0)

            cur.copy_expert("""
                COPY stg_new_cleaned (
                  barangay,node_id,hh_no,unique_hh_id,hh_m,household_members,relationship_to_hh,relationship_category,
                  gender,age,civil_status,occupation,educational_attainment,estimated_family_income_monthly,
                  is_senior,is_pwd,is_solo_parent,water_source,has_electricity,toilet_type,housing_material,
                  tenure_status,network_source,network_target,edge_type,is_4ps
                )
                FROM STDIN WITH (FORMAT CSV)
            """, buf)

        conn.commit()
        print("OK: Imported into stg_new_cleaned successfully.")
        print(f"Rows imported: {len(df)}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()