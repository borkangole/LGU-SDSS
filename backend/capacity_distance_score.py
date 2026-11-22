#!/usr/bin/env python
"""
capacity_distance_score.py

Domain B, View 2 -- "Institutional Capacity + Facility Distance", per Sir
Shem's own slide ("Domain B - View 2 - Identified Attributes" /
"Calculation Strategy - Domain B, View 2 - Capacity + Distance") and the
haversine/2km-threshold convention already verified in vulnerability_
functions_1.pdf's calculate_facility_capacity_2km().

Why this exists
-----------------
The slide specifies exactly 6 indicators combined into ONE percentile-rank
score, the same method as Domain A's SVI:
    1. No DRRM plan             (f01_disaster_plan == 2)
    2. No emergency hotline     (f04_disaster_hotline_presence == 2)
    3. No evacuation map        (f09_evacuation_map_presence == 2)
    4. No hazard map            (f11_hazard_map_presence == 2)
    5. % of households beyond 2km of the RHU
    6. % of households beyond 2km of the Fire Station

Neither existing capacity-related score in this codebase is this:
  - sanmiguel_student/capacity.py's capacity_score (the dashboard's main
    "Operational Capacity" card) is a DIFFERENT, 14-indicator score
    (disaster committee/response team/hotline/seminars + tangible resource
    counts + DRRM expenditure). It shares only "hotline" with the slide's 4
    flags, and does not include evacuation-map, hazard-map, or any distance
    component at all.
  - facility_access_score.py's facility_access_score has the 2 distance
    indicators, but ALONE -- not combined with the 4 institutional flags.

This script builds the slide's actual 6-indicator "Capacity + Distance
Score" for the first time, as its own additional score (per the thesis
author's decision) -- it does not replace capacity_score or
facility_access_score, both of which stay as they are.

An earlier, pre-PDF draft of this same idea (capacity_distance_barangay.py,
now marked superseded) used this exact method and field mapping, and even
carried the panel's own preliminary validation numbers in its docstring:
    Rank 1 (3-way tie): Santa Teresa, Santo Angel, San Antonio -- 431.2
    Rank 4: Consolacion -- 418.8
    Rank 5: San Jose -- 412.5
That script was superseded only because, at the time, its distance inputs
came from facility_distance.py (a separate, then-unverified script) rather
than the PDF-verified calculate_facility_capacity_2km(). This script
instead reuses facility_access_scores.csv, which already computes the RHU/
Fire distances with the PDF-transcribed function and real coordinates (see
facility_access_score.py) -- so the distance half is the already-verified
one, and only the institutional-flag half and the final combine/rank step
are added here.

f01_disaster_plan has ZERO VARIANCE in the actual CBMS data (all 24
barangays report having a plan), exactly matching the slide's own footnote
("Zero variance in this dataset"). It is still included in the ranking for
fidelity to the slide's method -- a constant column simply contributes the
same percentile rank (50.0, mid-point of an all-tied rank(pct=True)) to
every barangay, so it cannot change which barangay ranks where; it is not
silently dropped the way sanmiguel_student/capacity.py drops zero-variance
columns, because doing so here would be deviating from the slide's stated
6-indicator recipe rather than following it.

Run (from backend/), after facility_access_score.py has already been run:
    python capacity_distance_score.py

Reads:
    ../data/cbms_barangay_record.csv
    ../data/domain_pipeline_results/facility_access_scores.csv

Writes:
    ../data/domain_pipeline_results/capacity_distance_scores.csv
    (psgc_10d, barangay, no_drrm_plan, no_hotline, no_evacuation_map,
     no_hazard_map, rhu_pct_beyond, fire_pct_beyond, capacity_distance_score,
     capacity_distance_rank)
"""
from pathlib import Path
import pandas as pd

from sanmiguel_student.io import psgc10, _drop_unnamed

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / ".." / "data"
OUT_DIR = DATA_DIR / "domain_pipeline_results"

# CBMS convention confirmed against these fields' own distributions:
# 1 = Yes/present, 2 = No/absent.
INSTITUTIONAL_FIELDS = {
    "no_drrm_plan": "f01_disaster_plan",
    "no_hotline": "f04_disaster_hotline_presence",
    "no_evacuation_map": "f09_evacuation_map_presence",
    "no_hazard_map": "f11_hazard_map_presence",
}


def institutional_flags(barangay_df: pd.DataFrame) -> pd.DataFrame:
    """The 4 institutional capacity flags, already barangay-level (one row
    per barangay in the CBMS barangay profile) -- no household aggregation
    step needed, unlike Domain A.
    """
    out = pd.DataFrame({"barangay": barangay_df["barangay"]})
    for flag_name, field in INSTITUTIONAL_FIELDS.items():
        out[flag_name] = (barangay_df[field] == 2).astype(int)
    return out


def main():
    barangay_path = DATA_DIR / "cbms_barangay_record.csv"
    facility_path = OUT_DIR / "facility_access_scores.csv"
    if not facility_path.exists():
        raise FileNotFoundError(
            f"{facility_path} not found -- run facility_access_score.py first "
            "(this script reuses its already-verified RHU/Fire distance columns)."
        )

    barangay_df = _drop_unnamed(pd.read_csv(barangay_path, low_memory=False))
    barangay_df["psgc_10d"] = psgc10(barangay_df["barangay_geo_code"])
    facility_df = pd.read_csv(facility_path)

    inst = institutional_flags(barangay_df)
    merged = inst.merge(
        facility_df[["barangay", "psgc_10d", "rhu_pct_beyond", "fire_pct_beyond"]],
        on="barangay", how="left",
    )
    if merged["rhu_pct_beyond"].isna().any() or merged["fire_pct_beyond"].isna().any():
        missing = merged.loc[
            merged["rhu_pct_beyond"].isna() | merged["fire_pct_beyond"].isna(), "barangay"
        ].tolist()
        raise ValueError(f"Missing facility-distance data for barangay(s): {missing}")

    # The 6 indicators: 4 institutional flags (0/1 per barangay) + 2 distance
    # proportions (already %). Percentile-rank each across the 24 barangays,
    # sum -> Capacity + Distance Score, same method as Domain A's SVI. Higher
    # score = more flags absent + farther from facilities = worse capacity.
    indicator_cols = [
        "no_drrm_plan", "no_hotline", "no_evacuation_map", "no_hazard_map",
        "rhu_pct_beyond", "fire_pct_beyond",
    ]
    assert len(indicator_cols) == 6, "must be exactly 6 indicators per the slide"

    rank_cols = []
    for col in indicator_cols:
        rcol = f"{col}_pctile"
        merged[rcol] = merged[col].rank(pct=True) * 100.0
        rank_cols.append(rcol)

    merged["capacity_distance_score"] = merged[rank_cols].sum(axis=1)
    merged["capacity_distance_rank"] = (
        merged["capacity_distance_score"].rank(ascending=False, method="min").astype(int)
    )

    out_cols = ["psgc_10d", "barangay"] + indicator_cols + [
        "capacity_distance_score", "capacity_distance_rank",
    ]
    result = merged[out_cols].sort_values("capacity_distance_rank")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "capacity_distance_scores.csv"
    result.to_csv(out_path, index=False)

    print("=== Domain B, View 2 -- Capacity + Distance Score ===\n")
    print(result.to_string(index=False))

    print("\n=== Check against the panel's own preliminary numbers ===")
    print("Expected rank-1 3-way tie: Santa Teresa, Santo Angel, San Antonio -- 431.2")
    top = result[result["capacity_distance_rank"] == 1]
    print(top[["barangay", "capacity_distance_score"]].to_string(index=False))

    print(f"\nWritten: {out_path}")


if __name__ == "__main__":
    main()
