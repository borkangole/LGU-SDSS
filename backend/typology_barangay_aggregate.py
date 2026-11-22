#!/usr/bin/env python
"""
typology_barangay_aggregate.py

DIAGNOSTIC / MAP-SUPPORT SCRIPT -- does not feed into vulnerability_scores.csv
or capacity_scores.csv, and does not change any ranking currently on the
dashboard. Kept and run separately from run_domain_pipeline.py, same pattern
as facility_capacity_2km_diagnostic.py.

Why this exists
----------------
Sir Shem's own reference code (sanmiguel_student/typology.py,
aggregate_cluster_profiles()) fits the k-modes household typology but
deliberately returns CLUSTER-level summaries only -- no household
assignment file -- per his own docstring, and per the explicit rule in
docs/METHOD_GUIDE.md:

    "No household-level assignment table, UUID table, coordinate table,
    or household point map is produced."

That rule is already enforced in backend/routes/domain_vulnerability_routes.py.

Sir Shem's own demo (shown on-screen, not sent as a file) displayed a
household-level point map colored by k=5 cluster. Plotting real household
coordinates would violate the rule above, so this script does NOT do that.
Instead it fits the exact same model (same features, same KModes spec:
Huang init, n_init=30, random_state=42, matching aggregate_cluster_profiles()'s
own defaults) and immediately collapses the per-household labels into a
BARANGAY-LEVEL percentage breakdown -- e.g. "38% of Barangay X's households
fall in cluster 2". No uuid, no coordinate, no per-household row is written
to the output file. Only the small in-memory array used to compute the
percentages ever holds a household-to-cluster mapping, and it is discarded
when the script exits.

IMPORTANT -- cluster labels are NOT confirmed
------------------------------------------------
Sir Shem's demo used 5 named clusters (shown in his legend), but he has not
sent us the household-to-cluster assignment or model seed that produced
those exact names. The CLUSTER_LABELS below are our own best-fit guess,
matching his 5 label names to whichever of OUR 5 clusters has the closest
profile (e.g. highest food-insecurity rate -> "Food-insecure..." label).
Cluster SIZES from this run do not exactly match the sizes implied by his
demo, most likely because k-modes with Huang init is sensitive to the
random seed/init draw and he has not shared his exact seed. Until he
confirms, treat these labels as provisional, and say so anywhere they are
shown on the dashboard.

Run (from backend/):
    python typology_barangay_aggregate.py

Reads:
    ../data/cbms_household_record.csv
    ../data/cbms_person_record.csv

Writes:
    ../data/domain_pipeline_results/typology_barangay_k5.csv
    (barangay-level percentages only -- no household uuid or coordinate)
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
# names, based on which of our 5 clusters' profiles looks closest to each
# label's apparent meaning. NOT confirmed by Sir Shem. cluster_id here is
# whatever KModes assigns on this run/seed -- filled in after the fit below
# prints its profile, so re-check this mapping if the feature set, k, seed,
# or kmodes library version ever changes.
#
# RE-DERIVED 2026-09 (second pass) after fixing food_insecure and
# unimproved_sanitation formula bugs in typology.py -- the fix reshuffled
# every cluster, so all 5 id->label matches were re-checked from scratch
# against the fresh cluster profiles (each cluster's mean vs. the overall
# base rate across all 13 TYPOLOGY_FEATURES, computed from
# typology_household_k5.csv), not just carried over from the first pass:
#   0 (29.4%): the ONLY indicator clearly elevated is food_insecure (100%
#      vs 62% overall); everything else (weak_wall, senior, financial
#      exclusion, low education, large household) sits below the overall
#      rate -> Food-insecure, otherwise stable.
#   1 (31.9%): food_insecure is notably absent (0% vs 62% overall) and
#      every other indicator is at or below the overall rate (lowest
#      weak_wall and lowest financial exclusion of any cluster) -> the
#      best-off group overall -> Relatively stable.
#   2 (16.2%): senior_count and low_adult_education are both far above
#      every other cluster (senior count averages >1/household vs ~0.5
#      overall; low-adult-education 85% vs 26% overall), with financial
#      exclusion/no-internet/food-insecurity also elevated as a plausible
#      consequence of being senior-headed -> Senior-headed, education
#      gaps. The strongest, most distinctive two-feature pairing of any
#      cluster, which is why this gets the label rather than cluster 4.
#   3 (13.4%): weak_wall and financially_excluded are BOTH at 100% (every
#      household), while senior presence is the lowest of any cluster ->
#      a distinct, younger, structurally-insecure/unbanked group with no
#      age signature -> Financially excluded / structurally insecure.
#      Matches on profile, not just size.
#   4 (9.1%): large_household is the defining trait (100% vs 20%
#      overall), stacked with elevated food insecurity, the highest
#      overcrowding of any cluster, and higher PWD/solo-parent presence,
#      while financial exclusion is the LOWEST of any cluster (so this is
#      not the "financially excluded" group) -> several distinct stresses
#      (household size, crowding, food, dependents) compounding in the
#      same household -> Compounded deprivation. None of Sir Shem's 5
#      descriptions name "large household" explicitly, but that is
#      exactly what "compounded deprivation" describes: several risk
#      factors stacking together -- here via household composition,
#      rather than the socioeconomic-access stack in cluster 2.
# All 5 of Sir Shem's named typologies now have a distinct, profile-based
# match (none left "unconfirmed") -- resolved from the indicator
# definitions in vulnerability_functions_1.pdf and the 5 typology names on
# his slide, without needing him to break the tie.
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

    sizes = pd.Series(labels).value_counts().sort_index()
    print("\n=== Cluster sizes (this run) ===")
    print(sizes.to_string())
    print("Expected shape per Sir Shem's PDF (order/labels may differ): 2042/1603/717/1328/1559")
    print("NOTE: sizes above will likely NOT match his exactly -- see module docstring.")

    # Collapse to barangay-level percentages ONLY. `work` below is the only
    # place a household-to-cluster mapping exists, and it never leaves this
    # function -- no uuid, no lat/lon column is included.
    work = hh_t[["barangay", "psgc_10d"]].copy()
    work["cluster_id"] = labels

    n_by_brgy = work.groupby(["psgc_10d", "barangay"]).size().rename("n_households")
    pct_by_brgy = (
        work.groupby(["psgc_10d", "barangay", "cluster_id"])
        .size()
        .unstack(fill_value=0)
    )
    pct_by_brgy = pct_by_brgy.div(pct_by_brgy.sum(axis=1), axis=0) * 100
    pct_by_brgy = pct_by_brgy.round(1)
    pct_by_brgy.columns = [f"pct_cluster_{c}" for c in pct_by_brgy.columns]

    result = pd.concat([n_by_brgy, pct_by_brgy], axis=1).reset_index()

    cluster_cols = [c for c in result.columns if c.startswith("pct_cluster_")]
    result["dominant_cluster_id"] = result[cluster_cols].idxmax(axis=1).str.replace("pct_cluster_", "").astype(int)
    result["dominant_cluster_pct"] = result[cluster_cols].max(axis=1)
    result["dominant_cluster_label"] = result["dominant_cluster_id"].map(CLUSTER_LABELS)

    # Rename pct_cluster_N columns to include the provisional label for
    # readability in the raw CSV too.
    rename_map = {f"pct_cluster_{cid}": f"pct_cluster_{cid}__{CLUSTER_LABELS.get(cid, 'unlabeled').replace(' ', '_').replace(',', '')}"
                  for cid in range(K)}
    result = result.rename(columns=rename_map)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "typology_barangay_k5.csv"
    result.sort_values("barangay").to_csv(out_path, index=False)

    print("\n=== Barangay-level cluster breakdown (first 10 rows) ===")
    print(result.sort_values("barangay").head(10).to_string(index=False))
    print(f"\nWritten: {out_path}")
    print("\nNOTE: this file contains barangay-level percentages ONLY. No")
    print("household uuid, coordinate, or per-household row is written --")
    print("compliant with docs/METHOD_GUIDE.md's 'no household-level")
    print("assignment/coordinate/point-map' rule. Cluster labels above are")
    print("our own provisional best-fit guess, NOT confirmed by Sir Shem.")


if __name__ == "__main__":
    main()
