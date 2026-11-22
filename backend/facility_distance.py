"""
SUPERSEDED -- see run_domain_pipeline.py + sanmiguel_student/ instead.

This script was built before we had Sir Shem's own reference implementation
and rests on approximate/guessed thresholds in places that turned out to
differ from his official definitions (see his
SanMiguel_CBMS_Student_Analysis_Reproducibility package). Kept here for
history only -- do not use these numbers for the defense.
"""

"""
facility_distance.py

Domain B, View 2 — Institutional Capacity + Facility Distance
Step 1 of the panel-directed pipeline (Sir Shem consultation, Recordings 1 & 2).

Replaces the CBMS "distance to hospital" field (invalid — no hospital exists in
San Miguel) with real haversine distance to:
  - the Rural Health Unit (RHU)
  - the Fire Station

Method (exact, from the panel's slide "Domain B, View 2 — Capacity + Distance"):
  1. Apply the haversine formula: household (lat, long) vs. fixed RHU and
     Fire Station coordinates.
  2. Flag beyond_2km = 1 if distance > 2 km (straight-line, not road network).
  3. Group by barangay: sum() -> raw count beyond 2km (reference only);
     mean() x 100 -> proportion beyond 2km (used in ranking).
  4. (Later step, not here) combine with the 4 institutional flags to get
     Domain B's 6 indicators, then percentile-rank + sum.

Run:
    python facility_distance.py cbms_household_record.csv

Output:
    household_distance.csv   - per-household distance_km + beyond_2km flags
    barangay_distance_summary.csv - per-barangay % and raw count beyond 2km
"""

import sys
import math
import pandas as pd

# Fixed facility coordinates, exactly as given by the panel.
RHU_COORDS = (10.7815, 122.4647)
FIRE_STATION_COORDS = (10.7869, 122.4683)
DISTANCE_THRESHOLD_KM = 2.0

EARTH_RADIUS_KM = 6371.0088  # mean Earth radius (IUGG)


def haversine_km(lat1, lon1, lat2, lon2):
    """
    Great-circle distance between two (lat, lon) points in kilometers.
    Standard haversine formula, matching the panel's specified method.
    """
    lat1_r, lon1_r, lat2_r, lon2_r = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2_r - lat1_r
    dlon = lon2_r - lon1_r
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(min(1.0, math.sqrt(a)))
    return EARTH_RADIUS_KM * c


def compute_household_distances(df: pd.DataFrame) -> pd.DataFrame:
    """
    Given a household-level dataframe with 'latitude' and 'longitude' columns,
    compute distance (km) to RHU and Fire Station, plus beyond_2km flags.
    """
    out = df.copy()

    out["dist_rhu_km"] = out.apply(
        lambda r: haversine_km(r["latitude"], r["longitude"], *RHU_COORDS), axis=1
    )
    out["dist_fire_km"] = out.apply(
        lambda r: haversine_km(r["latitude"], r["longitude"], *FIRE_STATION_COORDS), axis=1
    )

    out["beyond_2km_rhu"] = (out["dist_rhu_km"] > DISTANCE_THRESHOLD_KM).astype(int)
    out["beyond_2km_fire"] = (out["dist_fire_km"] > DISTANCE_THRESHOLD_KM).astype(int)

    return out


def summarize_by_barangay(household_dist: pd.DataFrame) -> pd.DataFrame:
    """
    Barangay-level summary: raw count beyond 2km (resource sizing) and
    proportion beyond 2km (used for percentile-rank scoring later).
    """
    grouped = household_dist.groupby("barangay").agg(
        total_households=("uuid", "count"),
        rhu_beyond_2km_count=("beyond_2km_rhu", "sum"),
        rhu_beyond_2km_pct=("beyond_2km_rhu", lambda s: round(s.mean() * 100, 2)),
        fire_beyond_2km_count=("beyond_2km_fire", "sum"),
        fire_beyond_2km_pct=("beyond_2km_fire", lambda s: round(s.mean() * 100, 2)),
    ).reset_index()

    return grouped.sort_values("rhu_beyond_2km_pct", ascending=False)


def main():
    if len(sys.argv) < 2:
        print("Usage: python facility_distance.py <household_csv_path>")
        sys.exit(1)

    path = sys.argv[1]
    df = pd.read_csv(path, low_memory=False)

    required = {"uuid", "barangay", "latitude", "longitude"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    n_before = len(df)
    df = df.dropna(subset=["latitude", "longitude"])
    n_after = len(df)
    if n_after < n_before:
        print(f"WARNING: dropped {n_before - n_after} households with missing coordinates")

    household_dist = compute_household_distances(df)
    barangay_summary = summarize_by_barangay(household_dist)

    household_dist[
        ["uuid", "barangay", "latitude", "longitude",
         "dist_rhu_km", "beyond_2km_rhu", "dist_fire_km", "beyond_2km_fire"]
    ].to_csv("household_distance.csv", index=False)

    barangay_summary.to_csv("barangay_distance_summary.csv", index=False)

    print(f"\nHouseholds processed: {n_after}")
    print(f"Barangays: {household_dist['barangay'].nunique()}")
    print("\n=== Barangay distance summary (top 10 by RHU % beyond 2km) ===")
    print(barangay_summary.head(10).to_string(index=False))
    print("\nWritten: household_distance.csv, barangay_distance_summary.csv")


if __name__ == "__main__":
    main()
