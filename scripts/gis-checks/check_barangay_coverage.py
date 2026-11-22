import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

import psycopg2
import psycopg2.extras
import geopandas as gpd
from shapely.ops import unary_union
from config import Config

conn = psycopg2.connect(
    Config.get_connection_string(),
    cursor_factory=psycopg2.extras.RealDictCursor
)
cur = conn.cursor()

cur.execute("""
    SELECT h.household_id, h.hazard_data_status, b.barangay_name
    FROM tbl_households h
    JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
    WHERE h.hazard_exposure_score = 0
""")
rows = cur.fetchall()
conn.close()

barangays = gpd.read_file("data/geojson/barangay_boundaries.geojson")
flood = gpd.read_file("data/geojson/flood.geojson")
landslide = gpd.read_file("data/geojson/landslide.geojson")
hazard_coverage = unary_union([unary_union(flood.geometry), unary_union(landslide.geometry)])

# For each barangay in the boundary layer, does its territory overlap the
# hazard layers AT ALL (anywhere in that barangay, not just this household)?
import re
def normalize_brgy(name):
    if not name:
        return ""
    # Strip "Barangay"/"Brgy"/"Brgy." prefix and whitespace/punctuation,
    # so "Brgy 4" and "Barangay 4" both normalize to "4", and
    # "Sto Angel" / "Sto. Angel" both normalize to "stoangel".
    s = re.sub(r'(?i)^(barangay|brgy\.?|bgy\.?)\s*', '', name.strip())
    s = re.sub(r'[^a-z0-9]', '', s.lower())
    return s

barangay_has_coverage = {}
for _, brgy_row in barangays.iterrows():
    name = brgy_row["Barangay_n"]
    barangay_has_coverage[normalize_brgy(name)] = brgy_row.geometry.intersects(hazard_coverage)

print("Barangay-level hazard coverage:")
for name, has_cov in sorted(barangay_has_coverage.items()):
    print(f"  {name}: {'HAS coverage' if has_cov else 'no coverage'}")

print("\nCross-tab: household's hazard_data_status vs. whether their barangay has ANY hazard coverage")
from collections import Counter
tally = Counter()
unmatched_names = set()
for row in rows:
    brgy_name = row["barangay_name"]
    key = normalize_brgy(brgy_name)
    has_cov = barangay_has_coverage.get(key)
    if has_cov is None:
        unmatched_names.add(brgy_name)
    tally[(row["hazard_data_status"], has_cov)] += 1

for (status, has_cov), count in sorted(tally.items(), key=lambda x: -x[1]):
    print(f"  status='{status}', barangay_has_coverage={has_cov}: {count} households")

if unmatched_names:
    print(f"\nStill unmatched barangay names from DB: {unmatched_names}")