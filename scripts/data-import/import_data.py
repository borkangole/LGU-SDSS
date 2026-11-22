# ============================================================
# FIXED import_data.py
# ============================================================
import pandas as pd
import psycopg2
import psycopg2.extras
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
from config import Config

# ── Load Excel ───────────────────────────────────────────────
EXCEL_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "GROUP 5 UNIFIED DATA.xlsx")
print(f"📂 Loading: {EXCEL_PATH}")
df = pd.read_excel(EXCEL_PATH)
print(f"✅ Loaded {len(df)} rows")

# ── Clean column names ───────────────────────────────────────
df.columns = df.columns.str.strip()

# ── Connect ──────────────────────────────────────────────────
conn = psycopg2.connect(Config.get_connection_string())
cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
print("✅ Connected to database")

# ── STEP 1: Clear existing data ──────────────────────────────
print("\n🗑️  Clearing existing data...")
# Must delete in correct order (child tables first!)
cur.execute("DELETE FROM tbl_vulnerability_index")
cur.execute("DELETE FROM tbl_barangay_vulnerability")
cur.execute("DELETE FROM tbl_individuals")
cur.execute("DELETE FROM tbl_households")
cur.execute("DELETE FROM tbl_barangays")

# Reset sequences so IDs start from 1
cur.execute("SELECT setval('tbl_barangays_barangay_id_seq',   1, false)")
cur.execute("SELECT setval('tbl_households_household_id_seq', 1, false)")
cur.execute("SELECT setval('tbl_individuals_person_id_seq',   1, false)")

conn.commit()
print("✅ Cleared and sequences reset!")

# ── STEP 2: Insert Barangays ─────────────────────────────────
print("\n📍 Inserting barangays...")
barangay_names = df["Barangay"].dropna().unique()
barangay_map   = {}

for i, name in enumerate(sorted(barangay_names), start=1):
    clean_name = str(name).strip()
    brgy_code  = f"BRGY-{str(i).zfill(3)}"   # BRGY-001, BRGY-002...

    cur.execute("""
        INSERT INTO tbl_barangays
            (barangay_code, barangay_name, municipality, province)
        VALUES (%s, %s, %s, %s)
        RETURNING barangay_id
    """, (brgy_code, clean_name, "San Miguel", "Iloilo"))
    barangay_map[clean_name] = cur.fetchone()["barangay_id"]

conn.commit()
print(f"✅ Inserted {len(barangay_map)} barangays:")
for name, bid in barangay_map.items():
    print(f"   [{bid}] {name}")

# ── STEP 3: Insert Households & Individuals ──────────────────
print("\n🏠 Inserting households and members...")

household_map = {}   # (barangay_name, household_id_excel) → db_hh_id
total_hh      = 0
total_members = 0

def clean(val, default=None):
    if pd.isna(val): return default
    return str(val).strip()

def clean_bool(val):
    if pd.isna(val): return False
    return str(val).strip().lower() in ("yes", "true", "1", "y")

def clean_int(val, default=None):
    try:
        if pd.isna(val): return default
        return int(float(val))
    except: return default

def clean_decimal(val, default=None):
    try:
        if pd.isna(val): return default
        return float(val)
    except: return default

for _, row in df.iterrows():
    barangay_name = clean(row.get("Barangay"))
    hh_id_excel   = clean(row.get("Household_ID"))

    if not barangay_name or not hh_id_excel:
        continue

    barangay_id = barangay_map.get(barangay_name)
    if not barangay_id:
        print(f"⚠️  Unknown barangay: {barangay_name}")
        continue

    # ── Unique key = Barangay + Household_ID ─────────────────
    key = (barangay_name, hh_id_excel)

    if key not in household_map:
        household_number = f"{barangay_name}-HH{hh_id_excel}"

        cur.execute("""
            INSERT INTO tbl_households
                (household_number, barangay_id, housing_material,
                 tenure_status, water_source, toilet_type, has_electricity)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING household_id
        """, (
            household_number,
            barangay_id,
            clean(row.get("Housing_Material")),
            clean(row.get("Tenure_Status")),
            clean(row.get("Water_Source")),
            clean(row.get("Toilet_Type")),
            clean_bool(row.get("Has_Electricity")),
        ))
        db_hh_id = cur.fetchone()["household_id"]
        household_map[key] = db_hh_id
        total_hh += 1
    else:
        db_hh_id = household_map[key]

    # ── Insert Individual ─────────────────────────────────────
    cur.execute("""
        INSERT INTO tbl_individuals
            (household_id, age, civil_status, occupation,
             monthly_income, is_senior, is_pwd,
             is_solo_parent, is_4ps)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        db_hh_id,
        clean_int(row.get("Age")),
        clean(row.get("Civil_Status")),
        clean(row.get("Occupation")),
        clean_decimal(row.get("Monthly_Income")),
        clean_bool(row.get("Is_Senior")),
        clean_bool(row.get("Is_PWD")),
        clean_bool(row.get("Is_SoloParent")),
        clean_bool(row.get("Is_4Ps")),
    ))
    total_members += 1

conn.commit()

# ── STEP 4: Summary ──────────────────────────────────────────
print(f"\n{'='*55}")
print(f"🎉 Import Complete!")
print(f"{'='*55}")
print(f"   Barangays  : {len(barangay_map)}")
print(f"   Households : {total_hh}")
print(f"   Members    : {total_members}")

print(f"\n📋 Households per Barangay:")
cur2 = conn.cursor()
cur2.execute("""
    SELECT b.barangay_name,
           COUNT(DISTINCT h.household_id) AS households,
           COUNT(i.person_id)             AS members
    FROM tbl_barangays b
    LEFT JOIN tbl_households h  ON b.barangay_id  = h.barangay_id
    LEFT JOIN tbl_individuals i ON h.household_id = i.household_id
    GROUP BY b.barangay_name
    ORDER BY b.barangay_name
""")
for r in cur2.fetchall():
    print(f"   {r[0]:<25} — {r[1]:>4} households, {r[2]:>5} members")

conn.close()
print(f"\n✅ Done!")