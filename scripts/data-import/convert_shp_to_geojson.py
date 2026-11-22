import geopandas as gpd
import os

# ── Paths ──────────────────────────────────────────────────
BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data")
GIS_DIR  = os.path.join(BASE_DIR, "gis")
OUT_DIR  = os.path.join(BASE_DIR, "geojson")
os.makedirs(OUT_DIR, exist_ok=True)

def convert(filename, outname):
    path = os.path.join(GIS_DIR, filename)
    print(f"\n📂 Reading: {filename}")
    gdf = gpd.read_file(path)

    print(f"   CRS      : {gdf.crs}")
    print(f"   Columns  : {gdf.columns.tolist()}")
    print(f"   Row count: {len(gdf)}")
    print(f"   Sample   :\n{gdf.head(3)}\n")

    # Reproject to WGS84 (required for Leaflet)
    gdf = gdf.to_crs(epsg=4326)

    # Save GeoJSON
    out_path = os.path.join(OUT_DIR, outname)
    gdf.to_file(out_path, driver="GeoJSON")
    print(f"   ✅ Saved : {out_path}")
    return gdf

# ── Convert all 3 shapefiles ───────────────────────────────
brgy  = convert("Brgy Boundary.shp",     "barangay_boundaries.geojson")
hh    = convert("Housing Unit (HH).shp", "housing_units.geojson")
roads = convert("Roads.shp",             "roads.geojson")

print("\n" + "="*55)
print("🎉 All files converted successfully!")
print("="*55)

print("\n📋 COLUMN NAMES SUMMARY:")
print(f"\n  Brgy Boundary columns    : {brgy.columns.tolist()}")
print(f"  Housing Unit columns     : {hh.columns.tolist()}")
print(f"  Roads columns            : {roads.columns.tolist()}")