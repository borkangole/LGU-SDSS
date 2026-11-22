"""
SUPERSEDED -- see run_domain_pipeline.py + sanmiguel_student/ instead.

This script was built before we had Sir Shem's own reference implementation
and rests on approximate/guessed thresholds in places that turned out to
differ from his official definitions (see his
SanMiguel_CBMS_Student_Analysis_Reproducibility package). Kept here for
history only -- do not use these numbers for the defense.
"""

"""
household_typology.py

Domain A, Level 2 (Household) — k-modes Typology
Panel method: categorical-data clustering, NOT a ranked score (Sir Shem
consultation).

Pipeline (exact steps from the panel's slide "Domain A -- Household-Level
Typology"):
  1. Build binary flags directly per household row -- no aggregation step.
  2. Join person-level flags (PWD/senior/solo-parent/low-educ-adult) via uuid.
  3. Assemble indicator matrix X (7,249 rows x 13 binary columns).
  4. Run k-modes for k = 2...8, record cost (sum of within-cluster
     mismatches) at each k.
  5. Identify the elbow (largest cost drop-off) -> select k.
     ALSO: validate with silhouette score and multiple random seeds, per
     the panel's own disclosed open item (the initial k=5 was read off a
     single elbow on one seed and needs this before being finalized).
  6. Fit final KModes(n_clusters=k, init='Huang', n_init=10) -> cluster
     label per household.
  7. groupby('cluster').mean() on all 13 indicators -> cluster-profile
     table, used to name/interpret each typology.

Validation target (panel's preliminary k=5 result):
    28% Compounded deprivation      (food-insecure, weak housing, no
                                      account, low education all co-occur)
    22% Food-insecure, otherwise stable
    10% Financially excluded, older (no account despite sound housing;
                                      highest senior presence)
    18% Senior-headed, education gaps (senior present in every household
                                        in this group; highest disability)
    22% Relatively stable            (lowest overcrowding; food-secure; banked)

Requires: pip install kmodes

Run:
    python household_typology.py cbms_household_record.csv cbms_person_record.csv household_indicator_flags.csv
    (household_indicator_flags.csv is the output of social_vulnerability_barangay.py,
     reused here so the 11 shared indicators are computed identically in both
     places -- avoids the two pipelines silently drifting apart.)
"""

import sys
import numpy as np
import pandas as pd
from kmodes.kmodes import KModes
from sklearn.metrics import silhouette_score


K_RANGE = range(2, 9)
N_INIT = 5
SEEDS = [0, 42, 2024]  # multiple seeds, per the panel's disclosed open item
SILHOUETTE_SAMPLE = 1500  # subsample for silhouette (O(n^2) metric) -- speed


def build_matrix(hh_path: str, person_path: str, household_flags_path: str) -> pd.DataFrame:
    """
    13-column binary matrix: the 11 indicators already computed per-household
    in household_indicator_flags.csv (reused so Domain A Level 1 and Level 2
    can't silently diverge), plus solo-parent present and large household (>=6).
    """
    base = pd.read_csv(household_flags_path)  # uuid, barangay, 11 indicator cols

    hh = pd.read_csv(hh_path, low_memory=False)[["uuid", "hh_size"]]
    person = pd.read_csv(person_path, low_memory=False)[["uuid", "b05_solo_parent"]]

    solo_parent = (
        person.assign(solo_parent=(person["b05_solo_parent"] == 1).astype(int))
        .groupby("uuid")["solo_parent"].max()
        .reset_index()
    )

    merged = base.merge(hh, on="uuid", how="left")
    merged = merged.merge(solo_parent, on="uuid", how="left")
    merged["solo_parent"] = merged["solo_parent"].fillna(0).astype(int)
    merged["large_household"] = (merged["hh_size"] >= 6).astype(int)

    indicator_cols = [
        "overcrowding", "food_insecurity", "no_internet", "weak_roof",
        "weak_walls", "insecure_tenure", "unimproved_toilet",
        "no_financial_account", "pwd_present", "senior_present",
        "low_adult_education", "solo_parent", "large_household",
    ]
    assert len(indicator_cols) == 13, "must be exactly 13 indicators"

    return merged, indicator_cols


def select_k(X: np.ndarray, k_range=K_RANGE, n_init=N_INIT, seed=0):
    """
    Run k-modes across k_range, recording cost at each k (for the elbow) and
    silhouette score (for a second, less subjective validation signal).
    Silhouette on pure categorical/Hamming data is computed via a matching-
    distance metric.
    """
    costs = {}
    silhouettes = {}
    labels_by_k = {}

    for k in k_range:
        km = KModes(n_clusters=k, init="Huang", n_init=n_init, random_state=seed, verbose=0)
        labels = km.fit_predict(X)
        costs[k] = km.cost_
        labels_by_k[k] = labels

        if k >= 2:
            # Hamming/matching distance for categorical silhouette.
            # Subsampled: silhouette is O(n^2) and n=7249 is too slow otherwise.
            try:
                sil = silhouette_score(
                    X, labels, metric="hamming",
                    sample_size=min(SILHOUETTE_SAMPLE, len(X)), random_state=seed,
                )
            except Exception:
                sil = np.nan
            silhouettes[k] = sil

    return costs, silhouettes, labels_by_k


def elbow_k(costs: dict) -> int:
    """Pick k at the largest cost drop-off (largest second-derivative point)."""
    ks = sorted(costs.keys())
    drops = [(ks[i], costs[ks[i - 1]] - costs[ks[i]]) for i in range(1, len(ks))]
    # elbow = point after the largest drop
    best = max(drops, key=lambda t: t[1])
    return best[0]


def main():
    if len(sys.argv) < 4:
        print("Usage: python household_typology.py <household_csv> <person_csv> <household_indicator_flags_csv>")
        sys.exit(1)

    hh_path, person_path, flags_path = sys.argv[1], sys.argv[2], sys.argv[3]
    merged, indicator_cols = build_matrix(hh_path, person_path, flags_path)
    X = merged[indicator_cols].values

    print(f"Matrix shape: {X.shape} (expect 7249 x 13)\n")

    print("=== Multi-seed k selection (elbow method, seeds:", SEEDS, ") ===")
    elbow_votes = {}
    all_costs_by_seed = {}
    for seed in SEEDS:
        costs, silhouettes, _ = select_k(X, seed=seed)
        k_star = elbow_k(costs)
        elbow_votes[k_star] = elbow_votes.get(k_star, 0) + 1
        all_costs_by_seed[seed] = costs
        print(f"  seed={seed}: costs={ {k: round(v) for k, v in costs.items()} }  -> elbow k={k_star}")

    print("\nElbow k votes across seeds:", elbow_votes)
    final_k = max(elbow_votes, key=elbow_votes.get)
    print(f"Selected k = {final_k} (majority vote across {len(SEEDS)} seeds)")

    # Also report silhouette at the chosen k, averaged across seeds, as a
    # second validation signal (not the sole selection criterion).
    sil_scores = []
    for seed in SEEDS:
        km = KModes(n_clusters=final_k, init="Huang", n_init=N_INIT, random_state=seed, verbose=0)
        labels = km.fit_predict(X)
        try:
            sil_scores.append(silhouette_score(
                X, labels, metric="hamming",
                sample_size=min(SILHOUETTE_SAMPLE, len(X)), random_state=seed,
            ))
        except Exception:
            pass
    if sil_scores:
        print(f"Silhouette score at k={final_k}: mean={np.mean(sil_scores):.3f} across {len(sil_scores)} seeds")

    # Final fit at the selected k, seed=42 for reproducibility.
    final_seed = 42
    km_final = KModes(n_clusters=final_k, init="Huang", n_init=N_INIT, random_state=final_seed, verbose=0)
    merged["cluster"] = km_final.fit_predict(X)

    print(f"\n=== Final typology (k={final_k}, seed={final_seed}) ===\n")
    profile = merged.groupby("cluster")[indicator_cols].mean().round(3)
    sizes = merged["cluster"].value_counts().sort_index()
    profile.insert(0, "n_households", sizes)
    profile.insert(1, "share_pct", (sizes / len(merged) * 100).round(1))
    print(profile.to_string())

    merged.to_csv("household_typology.csv", index=False)
    profile.to_csv("cluster_profile.csv")

    print("\nWritten: household_typology.csv, cluster_profile.csv")
    print("\nNOTE: name each cluster by inspecting cluster_profile.csv against")
    print("the panel's reference typologies (Compounded deprivation, etc.)")
    print("-- naming isn't automatic, it's an interpretation step.")


if __name__ == "__main__":
    main()
