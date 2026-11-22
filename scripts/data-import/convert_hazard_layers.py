"""
One-time converter: data/gis/Flood.shp + Landslide.shp  ->  data/geojson/flood.geojson + landslide.geojson

Run from your backend folder (or anywhere, just fix BASE below):
    pip install geopandas --break-system-packages   # if not already installed
    python convert_hazard_layers.py

It will:
  1. Print all column names + a sample row for each shapefile (so you can confirm the severity field).
  2. Auto-detect a likely severity/hazard column by name.
  3. Reproject to EPSG:4326 (lat/lng, required for Leaflet) if needed.
  4. Write flood.geojson / landslide.geojson into data/geojson/, with a normalized
     "severity" property added (Low/Medium/High) alongside the original columns.
"""

import os
import geopandas as gpd

# ── Adjust these two paths if your folder layout differs ──────────
GIS_DIR = os.path.join("..", "data", "gis")
OUT_DIR = os.path.join("..", "data", "geojson")

os.makedirs(OUT_DIR, exist_ok=True)

LAYERS = {
    "flood": os.path.join(GIS_DIR, "Flood.shp"),
    "landslide": os.path.join(GIS_DIR, "Landslide.shp"),
}

# Candidate column names we'll auto-match (case-insensitive, substring match)
SEVERITY_CANDIDATES = [
    "severity", "hazard_lvl", "hazard_lev", "hazardlvl", "hazard",
    "risk_lvl", "risklevel", "risk", "susceptibi", "suscept",
    "level", "class", "flood_lvl", "flood_lev", "landslide_",
]


def detect_severity_field(columns):
    cols_lower = {c.lower(): c for c in columns}
    for cand in SEVERITY_CANDIDATES:
        for lower_col, original in cols_lower.items():
            if cand in lower_col:
                return original
    return None


def normalize_severity(value):
    if value is None:
        return "Unknown"
    v = str(value).strip().lower()
    if v in ("h", "high", "3"):
        return "High"
    if v in ("m", "med", "medium", "moderate", "2"):
        return "Medium"
    if v in ("l", "low", "1"):
        return "Low"
    return str(value).strip().title() or "Unknown"


for name, shp_path in LAYERS.items():
    if not os.path.exists(shp_path):
        print(f"⚠️  {shp_path} not found — skipping {name}")
        continue

    gdf = gpd.read_file(shp_path)

    print(f"\n=== {name.upper()} ({shp_path}) ===")
    print("Columns:", list(gdf.columns))
    print("Sample row:\n", gdf.iloc[0].to_dict() if len(gdf) else "EMPTY")
    print("CRS:", gdf.crs)

    # Reproject to WGS84 lat/lng for Leaflet
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
        print("Reprojected to EPSG:4326")

    field = detect_severity_field(gdf.columns)
    if field:
        print(f"✅ Detected severity field: '{field}'")
        gdf["severity"] = gdf[field].apply(normalize_severity)
    else:
        print("⚠️  Could not auto-detect a severity field. "
              "Set SEVERITY_FIELD_OVERRIDE below and re-run, or edit manually.")
        gdf["severity"] = "Unknown"

    out_path = os.path.join(OUT_DIR, f"{name}.geojson")
    gdf.to_file(out_path, driver="GeoJSON")
    print(f"→ wrote {out_path} ({len(gdf)} features)")

print("\nDone. If a severity field wasn't auto-detected for a layer, "
      "open that shapefile's printed columns above, hardcode "
      "SEVERITY_FIELD_OVERRIDE = {'flood': 'YOUR_COLUMN', 'landslide': 'YOUR_COLUMN'} "
      "near the top of this script, and re-run.")