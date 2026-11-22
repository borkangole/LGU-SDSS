"""
SUPERSEDED -- see run_domain_pipeline.py + sanmiguel_student/ instead.

This script was built before we had Sir Shem's own reference implementation
and rests on approximate/guessed thresholds in places that turned out to
differ from his official definitions (see his
SanMiguel_CBMS_Student_Analysis_Reproducibility package). Kept here for
history only -- do not use these numbers for the defense.
"""

"""
capacity_distance_barangay.py

Domain B, View 2 — Institutional Capacity + Facility Distance
Panel method: same percentile-rank-and-sum method as Domain A, but over
6 indicators (4 institutional yes/no flags + 2 distance proportions).

Pipeline (exact steps from the panel's slide "Domain B, View 2"):
  1. Apply the haversine formula (done separately, see facility_distance.py).
  2. Flag beyond_2km = 1 if distance > 2 km (done in facility_distance.py).
  3. Group by barangay: sum() -> raw count (reference only);
     mean() x 100 -> proportion beyond 2km (used in ranking). (done)
  4. Combine the 4 institutional binary flags with the 2 distance
     proportions = 6 indicators.
  5. Percentile-rank each of the 6 indicators across the 24 barangays.
  6. Sum the 6 percentile ranks -> Capacity + Distance Score; rank descending.

Validation target (from the panel's own preliminary slide):
    Rank 1 (3-way tie): Santa Teresa, Santo Angel, San Antonio -- 431.2
    Rank 4: Consolacion -- 418.8
    Rank 5: San Jose -- 412.5 (largest raw affected population, reported
            alongside rank, not folded into it)

Depends on facility_distance.py having already produced
barangay_distance_summary.csv (rhu_beyond_2km_pct, fire_beyond_2km_pct).

Run:
    python capacity_distance_barangay.py cbms_barangay_record.csv barangay_distance_summary.csv
"""

import sys
import pandas as pd


def institutional_flags(barangay_df: pd.DataFrame) -> pd.DataFrame:
    """
    The 4 institutional capacity flags, already barangay-level (one row per
    barangay in the CBMS barangay profile). Coding: 1 = Yes/present,
    2 = No/absent (standard CBMS convention, confirmed against f09/f11
    distributions which show 1=has, 2=doesn't).
    """
    f = pd.DataFrame()
    f["barangay"] = barangay_df["barangay"]
    f["no_drrm_plan"] = (barangay_df["f01_disaster_plan"] == 2).astype(int)
    f["no_hotline"] = (barangay_df["f04_disaster_hotline_presence"] == 2).astype(int)
    f["no_evacuation_map"] = (barangay_df["f09_evacuation_map_presence"] == 2).astype(int)
    f["no_hazard_map"] = (barangay_df["f11_hazard_map_presence"] == 2).astype(int)
    return f


def compute_capacity_distance_score(barangay_record_path: str, distance_summary_path: str) -> pd.DataFrame:
    barangay_df = pd.read_csv(barangay_record_path, low_memory=False)
    distance_df = pd.read_csv(distance_summary_path)

    inst = institutional_flags(barangay_df)

    merged = inst.merge(
        distance_df[["barangay", "rhu_beyond_2km_pct", "fire_beyond_2km_pct",
                     "rhu_beyond_2km_count", "fire_beyond_2km_count"]],
        on="barangay", how="left"
    )

    # The 6 indicators: 4 institutional rates (already 0/1 per barangay, so
    # "mean" over 1 row = itself) + 2 distance proportions (already %).
    # To keep this uniform with the barangay-level percentile-rank method,
    # treat each institutional flag as its own barangay-level rate (0 or 1,
    # since each barangay's disaster committee either exists or doesn't --
    # there's no household aggregation step here, unlike Domain A).
    indicator_cols = [
        "no_drrm_plan", "no_hotline", "no_evacuation_map", "no_hazard_map",
        "rhu_beyond_2km_pct", "fire_beyond_2km_pct",
    ]
    assert len(indicator_cols) == 6, "must be exactly 6 indicators"

    rank_cols = []
    for col in indicator_cols:
        rcol = f"{col}_rank"
        merged[rcol] = merged[col].rank(pct=True) * 100
        rank_cols.append(rcol)

    merged["cd_score"] = merged[rank_cols].sum(axis=1)
    merged["cd_rank"] = merged["cd_score"].rank(ascending=False, method="min").astype(int)

    return merged.sort_values("cd_rank")


def main():
    if len(sys.argv) < 3:
        print("Usage: python capacity_distance_barangay.py <cbms_barangay_record_csv> <barangay_distance_summary_csv>")
        sys.exit(1)

    barangay_record_path, distance_summary_path = sys.argv[1], sys.argv[2]
    result = compute_capacity_distance_score(barangay_record_path, distance_summary_path)

    out_cols = ["barangay", "cd_rank", "cd_score",
                "no_drrm_plan", "no_hotline", "no_evacuation_map", "no_hazard_map",
                "rhu_beyond_2km_pct", "fire_beyond_2km_pct",
                "rhu_beyond_2km_count", "fire_beyond_2km_count"]
    result[out_cols].to_csv("barangay_capacity_distance.csv", index=False)

    print("=== Domain B, View 2 — Capacity + Distance Ranking ===\n")
    print(result[["barangay", "cd_rank", "cd_score",
                   "rhu_beyond_2km_count", "fire_beyond_2km_count"]].to_string(index=False))

    print("\n=== Validation against panel's preliminary numbers ===")
    print("Expected rank-1 3-way tie: Santa Teresa, Santo Angel, San Antonio -- 431.2")
    top = result[result["cd_rank"] == 1]
    print(top[["barangay", "cd_score"]].to_string(index=False))

    print("\nWritten: barangay_capacity_distance.csv")


if __name__ == "__main__":
    main()
