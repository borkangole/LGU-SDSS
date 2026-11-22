import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

import psycopg2
import psycopg2.extras
import geopandas as gpd
from shapely.geometry import Point
from shapely.ops import unary_union
from config import Config

conn = psycopg2.connect(
    Config.get_connection_string(),
    cursor_factory=psycopg2.extras.RealDictCursor
)
cur = conn.cursor()

cur.execute("""
    SELECT household_id, longitude, latitude
    FROM tbl_households
    WHERE hazard_exposure_score = 0 AND hazard_data_status = 'Assessed'
    LIMIT 10
""")
assessed_group = cur.fetchall()

cur.execute("""
    SELECT household_id, longitude, latitude
    FROM tbl_households
    WHERE hazard_exposure_score = 0 AND hazard_data_status = 'Outside mapped hazard area'
    LIMIT 10
""")
outside_group = cur.fetchall()

conn.close()

barangays = gpd.read_file("data/geojson/barangay_boundaries.geojson")
print("Barangay layer columns:", list(barangays.columns))
barangay_coverage = unary_union(barangays.geometry)

def check(label, rows):
    print(f"--- {label} ---")
    for row in rows:
        lon, lat = row["longitude"], row["latitude"]
        if lon is None or lat is None:
            print(f"  household_id={row['household_id']}: NO COORDINATES")
            continue
        pt = Point(float(lon), float(lat))
        print(f"  household_id={row['household_id']} ({lon}, {lat}): "
              f"in_barangay_boundary={barangay_coverage.contains(pt)}")

check("Assessed (score=0)", assessed_group)
print()
check("Outside mapped hazard area (score=0)", outside_group)