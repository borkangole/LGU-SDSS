import geopandas as gpd

for name in ["flood", "landslide"]:
    print(f"\n=== {name}.geojson ===")
    gdf = gpd.read_file(f"data/geojson/{name}.geojson")
    print("CRS:", gdf.crs)
    print("Columns:", list(gdf.columns))
    print("Sample rows (properties only):")
    print(gdf.drop(columns="geometry").head(10).to_string())
    print("Unique values per column:")
    for col in gdf.columns:
        if col == "geometry":
            continue
        vals = gdf[col].unique()
        if len(vals) <= 15:
            print(f"  {col}: {list(vals)}")
        else:
            print(f"  {col}: {len(vals)} unique values, e.g. {list(vals[:5])}")