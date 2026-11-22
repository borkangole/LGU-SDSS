#!/usr/bin/env python
"""
facility_access_score.py

Promotes facility_capacity_2km_diagnostic.py's numbers from a standalone
diagnostic into an actual Domain B (Exposure & Capacity) score, per Sir
Shem's own reference PDF ("San Miguel, Iloilo -- Vulnerability Assessment:
Core Calculation Functions").

Why this exists / what changed
-------------------------------
His PDF defines Domain B as exactly two views:
    View 1: calculate_hazard_exposure()             -- flood/landslide exposure
    View 2: calculate_facility_capacity_2km()        -- municipal facilities (RHU, Fire), 2km
            + calculate_evacuation_access_500m()     -- per-barangay facility, 500m

View 1 is already live (hazard_exposure in the domain pipeline). View 2 was
only ever run as a diagnostic (facility_capacity_2km_diagnostic.py), never
turned into an actual score, because of an unresolved conflict: the
officially delivered sanmiguel_student/vulnerability.py already folds this
same RHU/fire distance into the SVI score (Domain A), not Capacity (Domain
B) -- see that script's own docstring for the full explanation.

The thesis author has decided (after reviewing this conflict) to build Sir
Shem's View 2 as its own score ALONGSIDE the existing Domain A wiring and
the existing capacity_score (organizational/fiscal/mobility indicators,
sanmiguel_student/capacity.py) -- not replacing either. This script is that
addition: it takes calculate_facility_capacity_2km()'s pct_beyond values
(the same real RHU/Fire Station coordinates, threshold 2.0 km) and, for the
first time, actually turns them into a percentile-ranked score, following
the exact same pattern calculate_barangay_social_vulnerability() uses for
Domain A (percentile-rank each proportion with pandas .rank(pct=True), sum
across indicators, rank barangays descending -- higher score = more
isolated / worse facility access).

What is intentionally NOT implemented here
--------------------------------------------
calculate_evacuation_access_500m() -- Sir Shem's second View 2 function --
requires ONE evacuation-center/barangay-hall coordinate PER BARANGAY
(`barangay_facility_coords: {barangay_name: (lat, lon)}` for all 24
barangays). Only one municipality-wide evacuation-center coordinate is
known right now (provided directly by the thesis author, used for the map's
"Evac 500m" reference ring). Computing this function faithfully needs the
other 23 barangays' facility coordinates, which have not been collected.
Until that list exists, this indicator is left out of facility_access_score
entirely rather than approximated with a single shared point, which would
misrepresent per-barangay walking access.

Run (from backend/):
    python facility_access_score.py

Reads:
    ../data/cbms_household_record.csv

Writes:
    ../data/domain_pipeline_results/facility_access_scores.csv
    (psgc_10d, barangay, n_hh, rhu_pct_beyond, rhu_n_beyond, fire_pct_beyond,
     fire_n_beyond, rhu_pctile, fire_pctile, facility_access_score,
     facility_access_rank)
"""
from pathlib import Path
import pandas as pd

from sanmiguel_student.io import psgc10, _drop_unnamed
from sanmiguel_student.vulnerability import haversine_km
from sanmiguel_student.config import RHU_LAT, RHU_LON, FIRE_LAT, FIRE_LON

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / ".." / "data"
OUT_DIR = DATA_DIR / "domain_pipeline_results"

# Real San Miguel, Iloilo facility coordinates -- same source as
# facility_capacity_2km_diagnostic.py and the access-augmented indicator
# already live in vulnerability.py. Not re-guessed or approximated.
FACILITY_COORDS = {
    "rhu": (RHU_LAT, RHU_LON),
    "fire": (FIRE_LAT, FIRE_LON),
}
THRESHOLD_KM = 2.0


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
    Identical to the version in facility_capacity_2km_diagnostic.py -- kept
    duplicated here (rather than imported) so this script stays runnable on
    its own, same convention as the other domain_pipeline_results scripts.
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

    result = calculate_facility_capacity_2km(hh, FACILITY_COORDS, threshold_km=THRESHOLD_KM)

    psgc_lookup = hh[["barangay", "psgc_10d"]].drop_duplicates()
    result = result.merge(psgc_lookup, on="barangay", how="left")

    # --- percentile-rank each facility's pct_beyond, sum into a score ---
    # Same method calculate_barangay_social_vulnerability() uses for Domain
    # A: pandas .rank(pct=True) averages ties correctly (unlike Excel's
    # plain RANK()), then indicators are summed into one score per barangay.
    # Higher facility_access_score = more households beyond 2km of BOTH
    # facilities = worse access = higher (worse) rank.
    for name in FACILITY_COORDS:
        result[f"{name}_pctile"] = result[f"{name}_pct_beyond"].rank(pct=True) * 100

    pctile_cols = [f"{name}_pctile" for name in FACILITY_COORDS]
    result["facility_access_score"] = result[pctile_cols].sum(axis=1)
    result["facility_access_rank"] = result["facility_access_score"].rank(
        ascending=False, method="min"
    ).astype(int)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "facility_access_scores.csv"
    result.sort_values("facility_access_rank").to_csv(out_path, index=False)

    print(f"Households processed: {n_after}")
    print(f"Barangays: {result['barangay'].nunique()}")
    print(f"Threshold: {THRESHOLD_KM} km (straight-line/haversine)")
    print()
    print("=== Facility Access ranking (worst access first) ===")
    print(result.sort_values("facility_access_rank")
          [["barangay", "n_hh", "rhu_pct_beyond", "fire_pct_beyond", "facility_access_score", "facility_access_rank"]]
          .to_string(index=False))
    print()
    print(f"Written: {out_path}")
    print()
    print("NOTE: this is Sir Shem's Domain B, View 2 (calculate_facility_capacity_2km),")
    print("built as its OWN score alongside -- not replacing -- the existing")
    print("capacity_score (organizational/fiscal/mobility indicators) or the")
    print("access-augmented distance already folded into svi_score (Domain A).")
    print("calculate_evacuation_access_500m() (the other half of View 2) is NOT")
    print("included -- it needs one evacuation-center coordinate per barangay,")
    print("and only one municipality-wide coordinate is known so far.")


if __name__ == "__main__":
    main()
