"""Household typology and validation of the number of k-modes clusters.

This is selection of the cluster count k; it is NOT k-fold cross-validation.

The code evaluates:
- k-modes cost / cost reduction;
- ARI and NMI across random initializations;
- Hamming-distance silhouette;
- smallest/largest cluster size;
- pairwise Hamming separation of cluster modes;
- repeated 80% subsample stability.

No single diagnostic automatically selects k. The analyst should compare
parsimony, stability, separation, cluster size, and substantive interpretability.
"""
import itertools
import numpy as np
import pandas as pd

from .config import FINANCIAL_ACCOUNT_COLUMNS, TYPOLOGY_FEATURES, UNIMPROVED_TOILET_CODES


def build_typology_features(households, persons):
    """Create the 13 categorical household attributes used for k-modes."""
    out = households.copy()

    # These flags duplicate the study definitions, kept here explicitly so the
    # typology can be reproduced without depending on the vulnerability module.
    # food_insecure and unimproved_sanitation corrected 2026-09 to match
    # vulnerability_functions_1.pdf's exact delivered formulas -- see
    # vulnerability.py's module docstring for the full account. This was a
    # real bug (food_insecure used any of 8 columns instead of just
    # g01_worried; unimproved_sanitation's toilet code list was missing
    # code 15), not just a relabeling, and it changes the household
    # typology's cluster assignments -- re-run typology_household_export.py
    # / typology_barangay_aggregate.py / backfill_typology_clusters.py
    # after this fix, and re-check cluster-to-label mapping since it will
    # likely shift.
    out["overcrowding"] = out["overcrowding_status"].eq(1)
    out["food_insecure"] = out["g01_worried"].eq(1)
    out["no_internet"] = out["k01_internet_access"].eq(2)
    out["weak_roof"] = out["o03_roof"].isin([4, 5])
    out["weak_wall"] = out["o04_outer_walls"].isin([5, 6, 8])
    out["insecure_tenure"] = out["o09_tenure"].isin([4, 5, 7])
    out["unimproved_sanitation"] = out["n08_toilet_facility"].isin(UNIMPROVED_TOILET_CODES)
    out["large_household"] = out["hh_size"].ge(6)
    out["financially_excluded"] = ~out[FINANCIAL_ACCOUNT_COLUMNS].eq(1).any(axis=1)

    p = persons.copy()
    p["pwd"] = p["b10_pwd"].eq(1)
    p["senior"] = p["a05_age"].ge(60)
    p["solo_parent"] = p["b05_solo_parent"].eq(1)
    p["low_adult_education"] = p["a05_age"].ge(25) & p["a11_hgc_level"].isin([0, 1])

    counts = p.groupby("uuid", as_index=False).agg(
        pwd_count=("pwd", "sum"),
        senior_count=("senior", "sum"),
        solo_parent_count=("solo_parent", "sum"),
        low_adult_education_count=("low_adult_education", "sum"),
    )
    out = out.merge(counts, on="uuid", how="left", validate="one_to_one")

    # Counts are categorical and capped at 3 to avoid sparse high-count categories.
    for col in ("pwd_count", "senior_count", "solo_parent_count"):
        out[f"{col}_cat"] = np.minimum(out[col].fillna(0).astype(int), 3).astype(int)
    out["low_adult_education_hh"] = (
        out["low_adult_education_count"].fillna(0).gt(0)
    )
    return out


def _partition_agreement(label_sets):
    from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score

    aris, nmis = [], []
    for a, b in itertools.combinations(label_sets, 2):
        aris.append(adjusted_rand_score(a, b))
        nmis.append(normalized_mutual_info_score(a, b))
    return {
        "mean_ari": float(np.mean(aris)) if aris else np.nan,
        "median_ari": float(np.median(aris)) if aris else np.nan,
        "mean_nmi": float(np.mean(nmis)) if nmis else np.nan,
        "median_nmi": float(np.median(nmis)) if nmis else np.nan,
    }


def validate_k(
    household_features: pd.DataFrame,
    k_values=range(2, 9),
    seeds=range(10),
    n_init=20,
    silhouette_sample=2000,
    silhouette_seed=20260916,
):
    """Full-data cluster-count diagnostics over k=2..8 by default."""
    from kmodes.kmodes import KModes
    from sklearn.metrics import silhouette_score

    X = household_features[TYPOLOGY_FEATURES].astype(int).astype(str)
    X_int = household_features[TYPOLOGY_FEATURES].astype(int).to_numpy()
    rng = np.random.default_rng(silhouette_seed)
    sample_idx = rng.choice(
        len(X_int),
        size=min(int(silhouette_sample), len(X_int)),
        replace=False,
    )

    rows = []
    for k in k_values:
        fits = []
        for seed in seeds:
            model = KModes(
                n_clusters=int(k),
                init="Huang",
                n_init=int(n_init),
                random_state=int(seed),
                verbose=0,
            )
            labels = model.fit_predict(X).astype(int)
            fits.append((float(model.cost_), labels, model))

        agreement = _partition_agreement([labels for _, labels, _ in fits])
        best_cost, best_labels, best_model = min(fits, key=lambda x: x[0])

        silhouette = silhouette_score(
            X_int[sample_idx], best_labels[sample_idx], metric="hamming"
        )
        counts = pd.Series(best_labels).value_counts()
        modes = np.asarray(best_model.cluster_centroids_)
        mode_distances = [
            np.mean(modes[i] != modes[j])
            for i in range(len(modes))
            for j in range(i + 1, len(modes))
        ]

        rows.append(
            {
                "k": int(k),
                "best_cost": best_cost,
                **agreement,
                "hamming_silhouette": float(silhouette),
                "min_cluster_n": int(counts.min()),
                "min_cluster_pct": float(counts.min() / len(X)),
                "max_cluster_pct": float(counts.max() / len(X)),
                "min_mode_hamming": float(np.min(mode_distances)),
                "mean_mode_hamming": float(np.mean(mode_distances)),
            }
        )

    result = pd.DataFrame(rows).sort_values("k").reset_index(drop=True)
    result["cost_drop"] = result["best_cost"].shift(1) - result["best_cost"]
    result["cost_drop_pct"] = result["cost_drop"] / result["best_cost"].shift(1)
    return result


def validate_subsample_stability(
    household_features,
    k_values=(3, 5, 6),
    repeats=20,
    sample_fraction=0.80,
    n_init=10,
    seed=20260916,
):
    """Test sensitivity of each k to changing the observed household sample."""
    from kmodes.kmodes import KModes
    from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score

    X = household_features[TYPOLOGY_FEATURES].astype(int).astype(str)
    n = len(X)
    rows = []

    for k in k_values:
        rng = np.random.default_rng(seed + int(k))
        fits = []
        for repeat in range(int(repeats)):
            idx = np.sort(
                rng.choice(
                    n,
                    size=int(round(sample_fraction * n)),
                    replace=False,
                )
            )
            model = KModes(
                n_clusters=int(k),
                init="Huang",
                n_init=int(n_init),
                random_state=seed + repeat,
                verbose=0,
            )
            labels = model.fit_predict(X.iloc[idx]).astype(int)
            fits.append((idx, labels, float(model.cost_)))

        aris, nmis = [], []
        for (ia, la, _), (ib, lb, _) in itertools.combinations(fits, 2):
            common, pos_a, pos_b = np.intersect1d(
                ia, ib, assume_unique=True, return_indices=True
            )
            if len(common) >= 2:
                aris.append(adjusted_rand_score(la[pos_a], lb[pos_b]))
                nmis.append(normalized_mutual_info_score(la[pos_a], lb[pos_b]))

        rows.append(
            {
                "k": int(k),
                "repeats": int(repeats),
                "sample_fraction": float(sample_fraction),
                "mean_subsample_ari": float(np.mean(aris)),
                "median_subsample_ari": float(np.median(aris)),
                "mean_subsample_nmi": float(np.mean(nmis)),
                "median_subsample_nmi": float(np.median(nmis)),
                "mean_cost_per_household": float(
                    np.mean([cost / len(idx) for idx, _, cost in fits])
                ),
            }
        )

    return pd.DataFrame(rows)


def aggregate_cluster_profiles(
    household_features,
    k,
    n_init=30,
    random_state=42,
):
    """Return cluster-level summaries only; no household assignment file."""
    from kmodes.kmodes import KModes

    X = household_features[TYPOLOGY_FEATURES].astype(int).astype(str)
    model = KModes(
        n_clusters=int(k),
        init="Huang",
        n_init=int(n_init),
        random_state=int(random_state),
        verbose=0,
    )
    labels = model.fit_predict(X).astype(int)

    work = household_features[TYPOLOGY_FEATURES].astype(int).copy()
    work["cluster_id"] = labels
    profile = work.groupby("cluster_id")[TYPOLOGY_FEATURES].mean()
    sizes = pd.Series(labels).value_counts().sort_index()
    profile.insert(0, "n", sizes)
    profile.insert(1, "pct", profile["n"] / len(work))

    modes = pd.DataFrame(
        np.asarray(model.cluster_centroids_).astype(int),
        columns=[f"mode__{c}" for c in TYPOLOGY_FEATURES],
    )
    modes.insert(0, "cluster_id", range(int(k)))
    return profile.reset_index().merge(modes, on="cluster_id")
