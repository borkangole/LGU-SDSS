import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

import psycopg2
import psycopg2.extras
from config import Config
from hazard_engine import detect_hazard_exposure, HAZARD_BUFFER_METERS, METRIC_CRS
from shapely.geometry import Point
import pyproj

conn = psycopg2.connect(
    Config.get_connection_string(),
    cursor_factory=psycopg2.extras.RealDictCursor
)
cur = conn.cursor()

for hh_id in [21751, 20438]:
    cur.execute("""
        SELECT household_id, household_number, longitude, latitude,
               flood_exposure, landslide_exposure, hazard_exposure_score,
               compound_hazard, hazard_data_status, created_at
        FROM tbl_households WHERE household_id = %s
    """, (hh_id,))
    row = cur.fetchone()
    print(f"--- household_id={hh_id} ---")
    print(dict(row))

conn.close()

# For 20438 specifically: how close to the 10m buffer threshold is it really?
cur = psycopg2.connect(Config.get_connection_string(), cursor_factory=psycopg2.extras.RealDictCursor).cursor()
cur.execute("SELECT longitude, latitude FROM tbl_households WHERE household_id = 20438")
row = cur.fetchone()
lon, lat = row["longitude"], row["latitude"]

from hazard_engine import _load_layers
from shapely.ops import unary_union
layers = _load_layers()
transformer = pyproj.Transformer.from_crs("EPSG:4326", METRIC_CRS, always_xy=True)
x_m, y_m = transformer.transform(float(lon), float(lat))
pt_m = Point(x_m, y_m)
combined_union_m = unary_union([layers["flood_union_m"], layers["landslide_union_m"]])
dist_m = pt_m.distance(combined_union_m)
print(f"\nhousehold_id=20438 distance to nearest hazard zone edge: {dist_m:.2f}m "
      f"(buffer threshold is {HAZARD_BUFFER_METERS}m)")