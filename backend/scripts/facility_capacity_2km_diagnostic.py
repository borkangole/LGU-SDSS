#!/usr/bin/env python
"""
facility_capacity_2km_diagnostic.py

DIAGNOSTIC ONLY -- does not feed into vulnerability_scores.csv or
capacity_scores.csv, and does not change any ranking currently on the
dashboard. Kept and run separately from run_domain_pipeline.py on purpose.

Why this exists
----------------
Sir Shem's reference PDF ("San Miguel, Iloilo -- Vulnerability Assessment:
Core Calculation Functions") describes calculate_facility_capacity_2km() as
a Domain B (Operational Capacity) indicator: the proportion of a barangay's
households beyond 2km (straight-line/haversine) from a fixed municipal
facility (RHU, Fire Station).

But his OFFICIALLY DELIVERED sanmiguel_student/vulnerability.py already
computes that exact same RHU/fire-station distance and folds it into the
"access_augmented" score, which IS the live svi_score/svi_rank (Domain A) --
see score_vulnerability() in sanmiguel_student/vulnerability.py.

Those two treatments disagree on which domain this distance measurement
belongs to. Rather than guess, this script implements his PDF's function
faithfully as a STANDALONE diagnostic so we have real numbers to show him
and ask directly: does this replace/supplement the access-augmented
distance already inside SVI, or does it belong in Capacity as its own
indicator? Nothing about the current SVI or Capacity scores changes until
he answers that.

Implementation
--------------
calculate_facility_capacity_2km() is transcribed from his PDF exactly
(same threshold default, same output column names: {facility}_pct_beyond,
{facility}_n_beyond). It reuses his own haversine_km() and the real
RHU/Fire Station coordinates already defined in sanmiguel_student/config.py
(RHU_LAT/RHU_LON, FIRE_LAT/FIRE_LON) -- not re-typed or approximated.

Run (from backend/):
    python facility_capacity_2km_diagnostic.py

Reads:
    ../data/cbms_household_record.csv   (needs uuid, barangay, barangay_geo_code,
                                          latitude, longitude)

Writes:
    ../data/domain_pipeline_results/facility_capacity_2km_diagnostic.csv
"""
from pathlib import Path
import pandas as pd

from sanmiguel_student.io import psgc10, _drop_unnamed
from sanmiguel_student.vulnerability import haversine_km
from sanmiguel_student.config import RHU_LAT, RHU_LON, FIRE_LAT, FIRE_LON

BASE_DIR = Path(__file__).resolve().parent.parent   # backend/
import sys; sys.path.insert(0, str(BASE_DIR))
DATA_DIR = BASE_DIR / ".." / "data"
OUT_DIR = DATA_DIR / "domain_pipeline_results"

# Real San Miguel, Iloilo facility coordinates, same source as the
# access-augmented indicator already live in vulnerability.py -- not
# re-guessed or approximated.
FACILITY_COORDS = {
    "rhu": (RHU_LAT, RHU_LON),
    "fire": (FIRE_LAT, FIRE_LON),
}


def calculate_facility_capacity_2km(
    household_df: pd.DataFrame,
    facility_coords: dict,
    threshold_km: float = 2.0,
    lat_col: str = "latitude",
    lon_col: str = "longitude",
    barangay_col: str = "barangay",
    hh_id_col: str = "uuid",
) -> pd.DataFrame:
    """Transcribed from Sir Shem's reference PDF, unmodified in logic.

    Parameters
    ----------
    household_df : pd.DataFrame
        Must contain lat_col, lon_col, barangay_col, hh_id_col.
    facility_coords : dict
        {facility_name: (lat, lon)} -- one or more fixed-location facilities,
        e.g. {"rhu": (10.7815, 122.4647), "fire": (10.7869, 122.4683)}.
    threshold_km : float
        Distance threshold in kilometers (default 2.0, matching the CBMS
        barangay questionnaire's own <=2km/>2km convention).
    lat_col, lon_col, barangay_col, hh_id_col : column names in household_df.

    Returns
    -------
    pd.DataFrame, one row per barangay, with per facility:
        {facility}_pct_beyond, {facility}_n_beyond (reference only)
    """
    hh = household_df.copy()

    for name, (flat, flon) in facility_coords.items():
        hh[f"_dist_{name}"] = haversine_km(hh[lat_col], hh[lon_col], flat, flon)
        hh[f"_beyond_{name}"] = (hh[f"_dist_{name}"] > threshold_km).astype(int)

    agg_dict = {"n_hh": (hh_id_col, "count")}
    for name in facility_coords:
        agg_dict[f"{name}_n_beyond"] = (f"_beyond_{name}", "sum")
        agg_dict[f"{name}_pct_beyond"] = (f"_beyond_{name}", "mean")

    brgy = hh.groupby(barangay_col).agg(**agg_dict).reset_index()
    for name in facility_coords:
        brgy[f"{name}_pct_beyond"] = (brgy[f"{name}_pct_beyond"] * 100).round(1)

    return brgy


def main():
    hh_path = DATA_DIR / "cbms_household_record.csv"
    hh = _drop_unnamed(pd.read_csv(hh_path, low_memory=False))
    hh["psgc_10d"] = psgc10(hh["barangay_geo_code"])

    n_before = len(hh)
    hh = hh.dropna(subset=["latitude", "longitude"])
    n_after = len(hh)
    if n_after < n_before:
        print(f"WARNING: dropped {n_before - n_after} households with missing coordinates")

    result = calculate_facility_capacity_2km(hh, FACILITY_COORDS, threshold_km=2.0)

    # Carry psgc_10d through for joining with the other pipeline outputs later,
    # if he confirms this should feed into anything.
    psgc_lookup = hh[["barangay", "psgc_10d"]].drop_duplicates()
    result = result.merge(psgc_lookup, on="barangay", how="left")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "facility_capacity_2km_diagnostic.csv"
    result.sort_values("rhu_pct_beyond", ascending=False).to_csv(out_path, index=False)

    print(f"Households processed: {n_after}")
    print(f"Barangays: {result['barangay'].nunique()}")
    print(f"Threshold: 2.0 km (straight-line/haversine)")
    print()
    print("=== Barangays at 100% beyond RHU 2km threshold ===")
    print(result[result["rhu_pct_beyond"] == 100.0][["barangay", "rhu_pct_beyond", "fire_pct_beyond"]]
          .to_string(index=False))
    print()
    print("=== Full table, sorted by RHU % beyond 2km ===")
    print(result.sort_values("rhu_pct_beyond", ascending=False)
          [["barangay", "n_hh", "rhu_n_beyond", "rhu_pct_beyond", "fire_n_beyond", "fire_pct_beyond"]]
          .to_string(index=False))
    print()
    print(f"Written: {out_path}")
    print()
    print("NOTE: this is a diagnostic-only run. These numbers are NOT folded")
    print("into svi_score/svi_rank or capacity_score/capacity_rank. The")
    print("access-augmented RHU/fire distance already inside svi_score (Domain A)")
    print("is unaffected. Ask Sir Shem whether this should replace/supplement")
    print("that, or live as its own Domain B indicator, before wiring it in.")


if __name__ == "__main__":
    main()
