import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

import psycopg2
import psycopg2.extras
from config import Config
from hazard_engine import _load_layers, METRIC_CRS
from shapely.geometry import Point
from shapely.ops import unary_union
import pyproj

conn = psycopg2.connect(
    Config.get_connection_string(),
    cursor_factory=psycopg2.extras.RealDictCursor
)
cur = conn.cursor()
cur.execute("""
    SELECT household_id, longitude, latitude, hazard_data_status
    FROM tbl_households
    WHERE hazard_exposure_score = 0
      AND longitude IS NOT NULL AND latitude IS NOT NULL
""")
rows = cur.fetchall()
conn.close()

layers = _load_layers()
combined_union_m = unary_union([layers["flood_union_m"], layers["landslide_union_m"]])
transformer = pyproj.Transformer.from_crs("EPSG:4326", METRIC_CRS, always_xy=True)

assessed_dists = []
outside_dists = []
other_statuses = {}

for row in rows:
    x_m, y_m = transformer.transform(float(row["longitude"]), float(row["latitude"]))
    dist = Point(x_m, y_m).distance(combined_union_m)
    status = row["hazard_data_status"]
    if status == "Assessed":
        assessed_dists.append((dist, row["household_id"]))
    elif status == "Outside mapped hazard area":
        outside_dists.append((dist, row["household_id"]))
    else:
        other_statuses.setdefault(status, []).append(row["household_id"])

assessed_dists.sort(reverse=True)
outside_dists.sort()

print(f"Total score=0 households checked: {len(rows)}")
print(f"  Assessed: {len(assessed_dists)}")
print(f"  Outside mapped hazard area: {len(outside_dists)}")
if other_statuses:
    print(f"  Other statuses found (unexpected): { {k: len(v) for k, v in other_statuses.items()} }")

print(f"\nTop 5 largest distances among 'Assessed' (the upper edge of the buffer):")
for dist, hh_id in assessed_dists[:5]:
    print(f"  household_id={hh_id}: {dist:.3f}m")

print(f"\nTop 5 smallest distances among 'Outside mapped hazard area' (the lower edge):")
for dist, hh_id in outside_dists[:5]:
    print(f"  household_id={hh_id}: {dist:.3f}m")

if assessed_dists and outside_dists:
    max_assessed = assessed_dists[0][0]
    min_outside = outside_dists[0][0]
    print(f"\nExact boundary: max 'Assessed' distance = {max_assessed:.3f}m, "
          f"min 'Outside' distance = {min_outside:.3f}m")
    if max_assessed < min_outside:
        suggested = (max_assessed + min_outside) / 2
        print(f"Clean separation confirmed. Suggested buffer threshold: {suggested:.2f}m "
              f"(any value between {max_assessed:.3f} and {min_outside:.3f} works)")
    else:
        print("⚠️ Overlap detected — the two groups aren't cleanly separated by distance alone.")