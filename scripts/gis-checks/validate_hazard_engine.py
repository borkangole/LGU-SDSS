import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

import psycopg2
import psycopg2.extras
from config import Config
from hazard_engine import detect_hazard_exposure

conn = psycopg2.connect(
    Config.get_connection_string(),
    cursor_factory=psycopg2.extras.RealDictCursor
)
cur = conn.cursor()

# Sample across all 4 flood levels + landslide + no-exposure cases, to
# exercise every branch of the rule, not just the common case.
cur.execute("""
    (SELECT household_id, longitude, latitude, flood_exposure, landslide_exposure,
            hazard_exposure_score, compound_hazard, hazard_data_status
     FROM tbl_households WHERE flood_exposure = 'Low' LIMIT 20)
    UNION ALL
    (SELECT household_id, longitude, latitude, flood_exposure, landslide_exposure,
            hazard_exposure_score, compound_hazard, hazard_data_status
     FROM tbl_households WHERE flood_exposure = 'Moderate' LIMIT 20)
    UNION ALL
    (SELECT household_id, longitude, latitude, flood_exposure, landslide_exposure,
            hazard_exposure_score, compound_hazard, hazard_data_status
     FROM tbl_households WHERE flood_exposure = 'High' LIMIT 20)
    UNION ALL
    (SELECT household_id, longitude, latitude, flood_exposure, landslide_exposure,
            hazard_exposure_score, compound_hazard, hazard_data_status
     FROM tbl_households WHERE flood_exposure = 'Very High' LIMIT 20)
    UNION ALL
    (SELECT household_id, longitude, latitude, flood_exposure, landslide_exposure,
            hazard_exposure_score, compound_hazard, hazard_data_status
     FROM tbl_households WHERE landslide_exposure IS NOT NULL LIMIT 20)
    UNION ALL
    (SELECT household_id, longitude, latitude, flood_exposure, landslide_exposure,
            hazard_exposure_score, compound_hazard, hazard_data_status
     FROM tbl_households WHERE hazard_data_status = 'Assessed' AND hazard_exposure_score = 0 LIMIT 20)
    UNION ALL
    (SELECT household_id, longitude, latitude, flood_exposure, landslide_exposure,
            hazard_exposure_score, compound_hazard, hazard_data_status
     FROM tbl_households WHERE hazard_data_status = 'Outside mapped hazard area' LIMIT 20)
""")
rows = cur.fetchall()
conn.close()

print(f"Validating against {len(rows)} known households...\n")

mismatches = []
for row in rows:
    result = detect_hazard_exposure(row["longitude"], row["latitude"])

    fields_to_check = ["flood_exposure", "landslide_exposure", "hazard_exposure_score",
                        "compound_hazard", "hazard_data_status"]
    diffs = {}
    for f in fields_to_check:
        old_val = row[f]
        new_val = result[f]
        # hazard_exposure_score comes back as numeric from DB (Decimal) vs int here
        if f == "hazard_exposure_score":
            old_val = int(old_val) if old_val is not None else None
        if str(old_val) != str(new_val):
            diffs[f] = (old_val, new_val)

    if diffs:
        mismatches.append((row["household_id"], diffs))

print(f"Matches: {len(rows) - len(mismatches)} / {len(rows)}")
if mismatches:
    print(f"\nMismatches ({len(mismatches)}):")
    for hh_id, diffs in mismatches[:30]:
        print(f"  household_id={hh_id}: {diffs}")
else:
    print("\n✅ Perfect match — the engine reproduces all known values exactly.")