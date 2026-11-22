import sys
import os

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
    SELECT h.household_id, h.longitude, h.latitude, h.hazard_data_status, b.barangay_name
    FROM tbl_households h
    JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
    WHERE h.hazard_exposure_score = 0
""")
rows = cur.fetchall()
conn.close()

flood = gpd.read_file("data/geojson/flood.geojson")
landslide = gpd.read_file("data/geojson/landslide.geojson")
hazard_coverage = unary_union([unary_union(flood.geometry), unary_union(landslide.geometry)])

# Degrees to meters is rough at this latitude but fine for relative comparison
DEG_TO_M = 111000

import statistics
by_status = {}
brgy_by_status = {}
for row in rows:
    lon, lat = row["longitude"], row["latitude"]
    if lon is None or lat is None:
        continue
    pt = Point(float(lon), float(lat))
    dist_deg = pt.distance(hazard_coverage)
    dist_m = dist_deg * DEG_TO_M
    status = row["hazard_data_status"]
    by_status.setdefault(status, []).append(dist_m)
    brgy_by_status.setdefault(status, {})
    brgy_by_status[status][row["barangay_name"]] = brgy_by_status[status].get(row["barangay_name"], 0) + 1

print("Distance to nearest hazard zone edge (meters), by status:")
for status, dists in by_status.items():
    print(f"  {status}: n={len(dists)}, min={min(dists):.1f}, max={max(dists):.1f}, "
          f"mean={statistics.mean(dists):.1f}, median={statistics.median(dists):.1f}")

print("\nBarangay breakdown by status:")
for status, brgy_counts in brgy_by_status.items():
    print(f"  {status}: {dict(sorted(brgy_counts.items(), key=lambda x: -x[1]))}")