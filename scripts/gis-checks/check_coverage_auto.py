import sys
import os

# Run this from the "Thesis System" root — this adds backend/ to the path
# so we can reuse your existing Config class instead of hardcoding credentials.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

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

print(f"Found {len(assessed_group)} 'Assessed' rows and {len(outside_group)} 'Outside mapped hazard area' rows.\n")

flood = gpd.read_file("data/geojson/flood.geojson")
landslide = gpd.read_file("data/geojson/landslide.geojson")
flood_coverage = unary_union(flood.geometry)
landslide_coverage = unary_union(landslide.geometry)
combined_coverage = unary_union([flood_coverage, landslide_coverage])

def check(label, rows):
    print(f"--- {label} ---")
    if not rows:
        print("  (no rows found — check the status label spelling matches your DB exactly)")
        return
    for row in rows:
        lon, lat = row["longitude"], row["latitude"]
        if lon is None or lat is None:
            print(f"  household_id={row['household_id']}: NO COORDINATES (null lon/lat)")
            continue
        pt = Point(float(lon), float(lat))
        print(f"  household_id={row['household_id']} ({lon}, {lat}): "
              f"in_flood_layer={flood_coverage.contains(pt)}, "
              f"in_landslide_layer={landslide_coverage.contains(pt)}, "
              f"in_combined_coverage={combined_coverage.contains(pt)}")

check("Assessed (score=0)", assessed_group)
print()
check("Outside mapped hazard area (score=0)", outside_group)