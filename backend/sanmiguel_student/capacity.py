"""Operational-capacity scoring.

Technique
---------
Capacity remains a separate construct from vulnerability.

1. Recode organizational yes/no items as 1/0.
2. Retain tangible resource counts and DRRM expenditure as absolute values.
3. Convert each discriminating variable to an average-tie 0--100 percentile.
4. Exclude constant/all-missing variables because they cannot discriminate among
   the 24 barangays.
5. Produce:
   - equal-indicator score (primary),
   - equal-dimension score (weighting sensitivity).

No spatial autocorrelation or adjacency analysis is included in this student package.
"""
import numpy as np
import pandas as pd
from .config import (
    CAPACITY_DIMENSIONS,
    FACILITY_COUNT_CAPACITY,
    PRIMARY_BINARY_CAPACITY,
    PRIMARY_COUNT_CAPACITY,
)


def percentile_0_100(values: pd.Series) -> pd.Series:
    """Average-tie percentile with endpoints mapped to 0 and 100."""
    s = pd.to_numeric(values, errors="coerce")
    valid = s.dropna()
    out = pd.Series(np.nan, index=s.index, dtype=float)
    if valid.empty or valid.nunique() <= 1:
        return out
    r = valid.rank(method="average")
    out.loc[valid.index] = (r - 1.0) / (len(valid) - 1.0) * 100.0
    return out


def score_capacity(barangay_record: pd.DataFrame):
    transformed = {}
    diagnostics = []

    for label, field in PRIMARY_BINARY_CAPACITY.items():
        raw = pd.to_numeric(barangay_record[field], errors="coerce")
        value = raw.map({1: 1.0, 2: 0.0})
        transformed[field] = value
        diagnostics.append(
            {
                "indicator": label,
                "source_field": field,
                "kind": "binary",
                "transformation": "CBMS 1=Yes -> 1; 2=No -> 0",
                "n_unique": int(value.nunique(dropna=True)),
            }
        )

    for label, field in PRIMARY_COUNT_CAPACITY.items():
        value = pd.to_numeric(barangay_record[field], errors="coerce")
        transformed[field] = value
        diagnostics.append(
            {
                "indicator": label,
                "source_field": field,
                "kind": "count_or_value",
                "transformation": "absolute inventory/value",
                "n_unique": int(value.nunique(dropna=True)),
            }
        )

    # Facility counts (schools, evacuation centres) -- columns added to the
    # barangay record by facility_counts.add_facility_counts(); a facility
    # absent from a barangay is 0.
    for label, field in FACILITY_COUNT_CAPACITY.items():
        if field not in barangay_record.columns:
            continue
        value = pd.to_numeric(barangay_record[field], errors="coerce").fillna(0)
        transformed[field] = value
        diagnostics.append(
            {
                "indicator": label,
                "source_field": field,
                "kind": "count_or_value",
                "transformation": "facilities located in the barangay (map points)",
                "n_unique": int(value.nunique(dropna=True)),
            }
        )
    values = pd.DataFrame(transformed, index=barangay_record.index)
    if values.isna().any().any():
        bad = values.columns[values.isna().any()].tolist()
        raise ValueError(f"Missing/unrecognized capacity values: {bad}")

    pct = values.apply(percentile_0_100)
    active = [c for c in pct.columns if pct[c].notna().any()]
    if not active:
        raise ValueError("No capacity indicator varies across barangays.")

    out = barangay_record[["psgc_10d", "barangay"]].copy()

    # Dimension scores are means of the active variables in each dimension.
    dimension_cols = []
    for dimension, fields in CAPACITY_DIMENSIONS.items():
        use = [f for f in fields if f in active]
        col = f"{dimension}_score"
        out[col] = pct[use].mean(axis=1) if use else np.nan
        if use:
            dimension_cols.append(col)

    out["capacity_score_equal_indicator"] = pct[active].mean(axis=1)
    out["capacity_rank_equal_indicator"] = (
        out["capacity_score_equal_indicator"]
        .rank(ascending=False, method="min")
        .astype("Int64")
    )

    out["capacity_score_equal_dimension"] = out[dimension_cols].mean(axis=1)
    out["capacity_rank_equal_dimension"] = (
        out["capacity_score_equal_dimension"]
        .rank(ascending=False, method="min")
        .astype("Int64")
    )

    out["capacity_rank_shift_dimension_minus_indicator"] = (
        out["capacity_rank_equal_dimension"] - out["capacity_rank_equal_indicator"]
    )

    # Primary aliases.
    out["capacity_score"] = out["capacity_score_equal_indicator"]
    out["capacity_rank"] = out["capacity_rank_equal_indicator"]

    diag = pd.DataFrame(diagnostics)
    diag["included_in_primary_score"] = diag["source_field"].isin(active)
    diag["excluded_reason"] = np.where(
        diag["included_in_primary_score"], "", "zero variance or all missing"
    )
    return out, diag
