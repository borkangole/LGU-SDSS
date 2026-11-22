# ============================================================
# SHARED QUANTILE-RANKING HELPER
#
# Exists because barangay_stage1_vulnerability.py previously reimplemented
# percentile ranking by hand in Python:
#
#     def percentile_rank(score):
#         below = sum(1 for s in scores_sorted if s < score)
#         return below / len(scores_sorted)          # <-- BUG: divides by N
#
# ...while compute_vulnerability.py classifies households and the naive
# barangay rollup (tbl_barangay_vulnerability.risk_level) using PostgreSQL's
# standard PERCENT_RANK() OVER (ORDER BY ...), whose definition is:
#
#     PERCENT_RANK(x) = (rank(x) - 1) / (N - 1)
#
# where rank(x) is the 1-based RANK() of x (ties share the same rank,
# rank(x) = 1 + count(values strictly less than x)). Substituting:
#
#     PERCENT_RANK(x) = count(values < x) / (N - 1)
#
# The hand-rolled version divided by N instead of N-1 -- not just a
# tie-handling difference, an off-by-one in the denominator -- which is
# what produced the uneven 5/5/6/8 barangay split instead of a clean
# ~6/6/6/6 equal-quartile split. This module is the single implementation
# both scripts should call so they can't silently diverge again.
# ============================================================


def percent_rank(value, sorted_values):
    """
    Python equivalent of PostgreSQL's PERCENT_RANK() OVER (ORDER BY ...)
    for a single value against a fully-sorted population.

    sorted_values must already be sorted ascending (callers typically
    compute this once per batch, not per row, for O(n log n) instead of
    O(n^2) — see percent_ranks_for_all below for the batch-safe version).
    """
    n = len(sorted_values)
    if n <= 1:
        return 0.0
    below = sum(1 for v in sorted_values if v < value)
    return below / (n - 1)


def percent_ranks_for_all(values):
    """
    Batch version: given an unordered list of values, return a dict mapping
    each distinct value to its PERCENT_RANK, computed once in O(n log n)
    rather than recomputing the "count below" scan per row (O(n^2)) like
    the original barangay_stage1_vulnerability.py implementation did.
    Ties (equal values) correctly receive the identical percent_rank, same
    as PostgreSQL's PERCENT_RANK() -- distinct from ROW_NUMBER()-style
    ranking, which would break ties arbitrarily.
    """
    n = len(values)
    if n <= 1:
        return {v: 0.0 for v in values}

    sorted_values = sorted(values)
    ranks = {}
    for v in set(values):
        below = sum(1 for s in sorted_values if s < v)
        ranks[v] = below / (n - 1)
    return ranks


def classify_by_quartile(pct_rank):
    """
    Equal-quartile classification (Low/Moderate/High/Very High), matching
    the CASE expression compute_vulnerability.py already uses for
    tbl_barangay_vulnerability.risk_level (n=24 barangays -- "top 5%" isn't
    meaningful at this sample size, so plain quartiles are used instead of
    the household-level top-5%/75-95th/25-75th/bottom-25% scheme).
    Boundaries use strict ">" to match that existing SQL exactly.
    """
    if pct_rank > 0.75:
        return "Very High"
    if pct_rank > 0.50:
        return "High"
    if pct_rank > 0.25:
        return "Moderate"
    return "Low"