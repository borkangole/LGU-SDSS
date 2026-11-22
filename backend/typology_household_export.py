#!/usr/bin/env python
"""
typology_household_export.py

Household-level companion to typology_barangay_aggregate.py -- fits the
EXACT SAME model (same features, same KModes spec: Huang init, n_init=30,
random_state=42, matching aggregate_cluster_profiles()'s own defaults and
this project's existing barangay-level script), but keeps the per-household
cluster assignment instead of collapsing it into a barangay-level percentage.

Why this exists / why the earlier "no household-level export" rule changed
----------------------------------------------------------------------------
typology_barangay_aggregate.py's own docstring, and docs/METHOD_GUIDE.md,
stated that no household-level cluster assignment or coordinate would ever
be produced, citing sanmiguel_student.typology.aggregate_cluster_profiles()'s
docstring ("Return cluster-level summaries only; no household assignment
file") as if that were a limitation of the clustering method itself.

It isn't. aggregate_cluster_profiles() computes
`labels = model.fit_predict(X)` internally just like this script does -- it
simply chooses not to return that array. Sir Shem's own separate functions
file (vulnerability_functions.pdf, cluster_households()) confirms the
household-level assignment is the NORMAL output of his method: its
documented return value is `(household_df_with_cluster, cluster_profile_df,
chosen_k)` -- the household-level dataframe with a cluster column IS the
primary thing his function hands back, not something withheld by design.

Given that, and on the thesis author's explicit decision to align with
cluster_households() rather than the stricter aggregate-only rule that had
been assumed, this script exports the actual per-household assignment: each
household's real CBMS-geotagged coordinate plus its own cluster_id/label.
This is what powers the Typology view's household dot map on the frontend,
mirroring Sir Shem's own demo (which shows exactly this: one dot per
household, colored by k-modes cluster).

CLUSTER_LABELS below MUST stay identical to typology_barangay_aggregate.py's
mapping -- both scripts feed the same map (barangay choropleth + household
dot layer) and a mismatch would show different names/colors for the same
cluster_id between the two layers.

Run (from backend/):
    python typology_household_export.py

Reads:
    ../data/cbms_household_record.csv
    ../data/cbms_person_record.csv

Writes:
    ../data/domain_pipeline_results/typology_household_k5.csv
    (uuid, barangay, psgc_10d, latitude, longitude, cluster_id, cluster_label,
     + the 13 raw TYPOLOGY_FEATURES columns themselves -- overcrowding,
     food_insecure, no_internet, weak_roof, weak_wall, insecure_tenure,
     unimproved_sanitation, pwd_count_cat, senior_count_cat,
     solo_parent_count_cat, low_adult_education_hh, large_household,
     financially_excluded. Added so the app can show WHICH indicators drove
     a given household's typology, not just the final cluster label --
     previously these were computed here and then discarded.)
"""
from pathlib import Path
import pandas as pd

from sanmiguel_student.io import psgc10, _drop_unnamed
from sanmiguel_student.typology import build_typology_features
from sanmiguel_student.config import TYPOLOGY_FEATURES

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / ".." / "data"
OUT_DIR = DATA_DIR / "domain_pipeline_results"

K = 5
N_INIT = 30
RANDOM_STATE = 42

# PROVISIONAL best-fit match of our cluster_id -> Sir Shem's demo label
# names. NOT confirmed by Sir Shem. Must stay identical to
# typology_barangay_aggregate.py's CLUSTER_LABELS -- see module docstring.
#
# RE-DERIVED 2026-09 (second pass) after fixing food_insecure and
# unimproved_sanitation formula bugs in typology.py -- the first
# formula-fix run reshuffled every cluster, so all 5 id->label matches
# from the earlier pass were re-checked from scratch against the fresh
# cluster profiles (deviation of each cluster's mean from the overall base
# rate across all 13 TYPOLOGY_FEATURES), not just re-used:
#   0 (29.4%): the ONLY indicator clearly elevated is food_insecure
#      (100% vs 62% overall); everything else (weak_wall, senior,
#      financial exclusion, low education, large household) sits BELOW
#      the overall rate -> food-insecure but otherwise unremarkable =
#      Food-insecure, otherwise stable.
#   1 (31.9%): food_insecure is notably ABSENT (0% vs 62% overall) and
#      every other indicator is at or below the overall rate (lowest
#      weak_wall, lowest financial exclusion of any cluster) -> the
#      best-off group overall = Relatively stable.
#   2 (16.2%): senior_count and low_adult_education are both far above
#      every other cluster (senior count averages >1 per household vs
#      ~0.5 overall; low-adult-education 85% vs 26% overall), with
#      financial exclusion, lack of internet, and food insecurity also
#      elevated as a plausible consequence of being senior-headed (older,
#      fixed-income households are less likely to be banked/online and
#      more likely to report food worry) -> Senior-headed, education
#      gaps. This is the strongest, most distinctive pairing of any
#      cluster on any two features, which is why it -- not the
#      multi-indicator cluster 4 below -- gets this label.
#   3 (13.4%): weak_wall and financially_excluded are BOTH at 100%
#      (every single household), while senior presence is the lowest of
#      any cluster -> a distinct, younger, structurally-insecure/unbanked
#      group with no age signature = Financially excluded / structurally
#      insecure. Matches this named typology on profile, not just size.
#   4 (9.1%): large_household is the defining trait (100%, vs 20%
#      overall), stacked with elevated food insecurity, overcrowding
#      (highest of any cluster), and higher-than-average PWD/solo-parent
#      presence, while financial exclusion is the LOWEST of any cluster
#      (so this is not the "financially excluded" group) -> several
#      distinct stresses (household size, crowding, food, dependents)
#      compounding in the same household = Compounded deprivation. None
#      of Sir Shem's 5 descriptions name "large household" explicitly,
#      but "compounded deprivation" as a concept is exactly this: several
#      risk factors stacking together, here via household composition
#      rather than the socioeconomic-access stack in cluster 2.
# All 5 of Sir Shem's named typologies now have a distinct, profile-based
# match (none left as "unconfirmed") -- resolved from the indicator
# definitions in vulnerability_functions_1.pdf and the 5 typology names on
# his slide, without needing to ask him to break the tie.
CLUSTER_LABELS = {
    0: "Food-insecure, otherwise stable",
    1: "Relatively stable",
    2: "Senior-headed, education gaps",
    3: "Financially excluded / structurally insecure",
    4: "Compounded deprivation",
}


def main():
    hh = _drop_unnamed(pd.read_csv(DATA_DIR / "cbms_household_record.csv", low_memory=False))
    pp = _drop_unnamed(pd.read_csv(DATA_DIR / "cbms_person_record.csv", low_memory=False))
    hh["psgc_10d"] = psgc10(hh["barangay_geo_code"])
    pp["psgc_10d"] = psgc10(pp["barangay_geo_code"])

    hh_t = build_typology_features(hh, pp)
    print(f"Households: {len(hh_t)}")

    from kmodes.kmodes import KModes
    X = hh_t[TYPOLOGY_FEATURES].astype(int).astype(str)
    model = KModes(n_clusters=K, init="Huang", n_init=N_INIT, random_state=RANDOM_STATE, verbose=0)
    labels = model.fit_predict(X).astype(int)

    # Per-household export -- uuid, barangay, psgc_10d, real coordinates, and
    # this household's own cluster assignment. No aggregation step. These
    # columns are all original household_df columns preserved through
    # build_typology_features() (which only copies-and-appends, never drops).
    keep_cols = ["uuid", "barangay", "psgc_10d", "latitude", "longitude"]
    missing = [c for c in keep_cols if c not in hh_t.columns]
    if missing:
        raise KeyError(f"Expected columns missing from household data: {missing}")

    # Also keep the 13 raw indicator columns that fed the clustering, so a
    # household's own indicator values can be shown alongside its cluster
    # label (not just the label with no way to see why it was assigned).
    result = hh_t[keep_cols + TYPOLOGY_FEATURES].copy()
    result["cluster_id"] = labels
    result["cluster_label"] = result["cluster_id"].map(CLUSTER_LABELS)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "typology_household_k5.csv"
    result.to_csv(out_path, index=False)

    print("\n=== Cluster sizes (this run) ===")
    print(result["cluster_id"].value_counts().sort_index().to_string())
    print(f"\nWritten: {out_path} ({len(result)} households)")
    print("\nNOTE: cluster labels above are our own provisional best-fit guess,")
    print("NOT confirmed by Sir Shem -- must stay identical to")
    print("typology_barangay_aggregate.py's CLUSTER_LABELS mapping.")


if __name__ == "__main__":
    main()
