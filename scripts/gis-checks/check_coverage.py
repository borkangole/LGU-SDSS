import geopandas as gpd
from shapely.geometry import Point
from shapely.ops import unary_union

flood = gpd.read_file("data/geojson/flood.geojson")
landslide = gpd.read_file("data/geojson/landslide.geojson")

# The combined "footprint" of everywhere your hazard layers have ANY data
# (regardless of risk level) — a point outside this has literally never
# been assessed, vs. a point inside it that just didn't match a specific
# zone (which would be a genuine "not exposed" result).
flood_coverage = unary_union(flood.geometry)
landslide_coverage = unary_union(landslide.geometry)
combined_coverage = unary_union([flood_coverage, landslide_coverage])

# ── Paste in coordinates from each group below ──
assessed_group = [
    # (longitude, latitude),  # from the "Assessed" + score=0 query
]
outside_group = [
    # (longitude, latitude),  # from the "Outside mapped hazard area" query
]

def check(label, coords):
    print(f"\n--- {label} ---")
    for lon, lat in coords:
        pt = Point(lon, lat)
        in_flood_zone = flood_coverage.contains(pt)
        in_landslide_zone = landslide_coverage.contains(pt)
        in_combined = combined_coverage.contains(pt)
        print(f"({lon}, {lat}): in_flood_layer={in_flood_zone}, "
              f"in_landslide_layer={in_landslide_zone}, in_combined_coverage={in_combined}")

check("Assessed group", assessed_group)
check("Outside mapped hazard area group", outside_group)