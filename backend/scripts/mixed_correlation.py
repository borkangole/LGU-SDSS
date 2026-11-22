# ============================================================
# MIXED (HETEROGENEOUS) CORRELATION MATRIX
#
# Our indicator set is genuinely mixed: some are binary (weak_roof),
# some are 3-level ordinal (weak_walls: 0/0.5/1, financial_assistance,
# information_access), and some are continuous proportions (pct_pwd,
# education, employment, infra_proximity, etc). A single Pearson
# matrix across all of them is what the earlier factor-analysis run
# used -- this module replaces that with the mathematically correct
# per-pair method, matching the panel's specified methodology:
#   - both variables ordinal  -> POLYCHORIC correlation (ML estimate)
#   - one ordinal, one continuous -> POLYSERIAL correlation
#   - both continuous -> Pearson correlation
#
# No mainstream, actively-maintained Python package implements this
# combination cleanly (unlike R's polycor::hetcor) -- implemented
# here directly using scipy's bivariate normal CDF for the ML
# polychoric estimation, and the standard closed-form polyserial
# estimator (Olsson, Drasgow & Dorans 1982).
# ============================================================

import numpy as np
from scipy.stats import norm, multivariate_normal
from scipy.optimize import minimize_scalar

ORDINAL_MAX_LEVELS = 4  # <=4 unique values => treated as ordinal (covers binary and 0/0.5/1 3-level indicators)


def filter_sparse_ordinal(X, col_names, min_category_count=30):
    """Drops ordinal columns whose rarest category has fewer than
    min_category_count observations. Polychoric ML estimation needs
    reasonably filled contingency-table cells to be numerically stable;
    a handful of positive cases produces wildly unstable correlation
    estimates (near +-1, dominating their own spurious factor) rather
    than a genuine null result. This is standard EFA practice, not a
    workaround -- confirmed necessary against this project's real data
    (unsafe_water, ~10 cases out of 7,252, produced a -0.98 loading on
    its own factor and collapsed Sensitivity's KMO from 0.503 to 0.100).
    Continuous columns are never dropped by this check."""
    col_types = classify_columns(X)
    keep_mask = np.ones(X.shape[1], dtype=bool)
    dropped = []
    for j in range(X.shape[1]):
        if col_types[j] != "ordinal":
            continue
        values, counts = np.unique(X[:, j], return_counts=True)
        if counts.min() < min_category_count:
            keep_mask[j] = False
            dropped.append((col_names[j], int(counts.min())))
    return keep_mask, dropped


def classify_columns(X):
    """Returns a list of 'ordinal' or 'continuous' per column."""
    types = []
    for j in range(X.shape[1]):
        n_unique = len(np.unique(X[:, j]))
        types.append("ordinal" if n_unique <= ORDINAL_MAX_LEVELS else "continuous")
    return types


def _thresholds_from_proportions(codes):
    """Estimate normal-distribution thresholds from an ordinal
    variable's observed category proportions (standard approach:
    cumulative proportions -> inverse normal CDF)."""
    categories = np.unique(codes)
    n = len(codes)
    cum_props = []
    running = 0
    for c in categories[:-1]:
        running += np.sum(codes == c)
        cum_props.append(running / n)
    # thresholds at -inf and +inf bound the outermost categories
    thresholds = [-np.inf] + [norm.ppf(p) for p in cum_props] + [np.inf]
    return thresholds


def polychoric_corr(x, y):
    """ML-estimated polychoric correlation between two ordinal variables
    (works for binary-binary = tetrachoric as a special case)."""
    tx = _thresholds_from_proportions(x)
    ty = _thresholds_from_proportions(y)
    x_cats = np.unique(x)
    y_cats = np.unique(y)

    # contingency table
    table = np.zeros((len(x_cats), len(y_cats)))
    for i, xc in enumerate(x_cats):
        for j, yc in enumerate(y_cats):
            table[i, j] = np.sum((x == xc) & (y == yc))

    def neg_log_likelihood(rho):
        rho = np.clip(rho, -0.999, 0.999)
        cov = [[1, rho], [rho, 1]]
        ll = 0.0
        for i in range(len(x_cats)):
            for j in range(len(y_cats)):
                if table[i, j] == 0:
                    continue
                lo_x, hi_x = tx[i], tx[i + 1]
                lo_y, hi_y = ty[j], ty[j + 1]
                p = _rect_bivariate_normal_prob(lo_x, hi_x, lo_y, hi_y, rho)
                p = max(p, 1e-12)
                ll += table[i, j] * np.log(p)
        return -ll

    result = minimize_scalar(neg_log_likelihood, bounds=(-0.95, 0.95), method="bounded")
    return float(result.x)


def _rect_bivariate_normal_prob(lo_x, hi_x, lo_y, hi_y, rho):
    """P(lo_x < X <= hi_x, lo_y < Y <= hi_y) for standard bivariate normal
    with correlation rho, via the CDF difference method."""
    mvn = multivariate_normal(mean=[0, 0], cov=[[1, rho], [rho, 1]])
    def cdf(a, b):
        if a == -np.inf or b == -np.inf:
            return 0.0
        if a == np.inf:
            a = 8.0
        if b == np.inf:
            b = 8.0
        return mvn.cdf([a, b])
    return cdf(hi_x, hi_y) - cdf(lo_x, hi_y) - cdf(hi_x, lo_y) + cdf(lo_x, lo_y)


def polyserial_corr(x_cont, y_ord):
    """Closed-form polyserial correlation estimate (Olsson, Drasgow &
    Dorans 1982): continuous variable x, ordinal variable y."""
    thresholds = _thresholds_from_proportions(y_ord)
    inner_thresholds = thresholds[1:-1]  # drop the -inf/+inf bounds
    if len(inner_thresholds) == 0:
        return 0.0  # y_ord is constant, no correlation definable

    r_pearson = np.corrcoef(x_cont, y_ord)[0, 1]
    if np.isnan(r_pearson):
        return 0.0

    sd_y = np.std(y_ord, ddof=1)
    phi_sum = np.sum(norm.pdf(inner_thresholds))
    if phi_sum < 1e-10:
        return r_pearson  # degenerate, fall back to Pearson

    rho = r_pearson * sd_y / phi_sum
    return float(np.clip(rho, -0.95, 0.95))


def kmo_from_corr(corr):
    """KMO measure of sampling adequacy computed directly from a
    correlation matrix (not raw data) -- needed so this reflects the
    polychoric/polyserial matrix, not factor_analyzer's built-in
    calculate_kmo() which always recomputes its own Pearson matrix
    internally regardless of what's passed to FactorAnalyzer.fit()."""
    inv_corr = np.linalg.inv(corr)
    d = np.sqrt(np.diag(inv_corr))
    partial = -inv_corr / np.outer(d, d)
    np.fill_diagonal(partial, 0)
    r_offdiag = corr.copy()
    np.fill_diagonal(r_offdiag, 0)
    sum_r2 = np.sum(r_offdiag ** 2)
    sum_partial2 = np.sum(partial ** 2)
    return sum_r2 / (sum_r2 + sum_partial2)


def bartlett_from_corr(corr, n):
    """Bartlett's test of sphericity computed directly from a
    correlation matrix + sample size, same reasoning as kmo_from_corr()."""
    from scipy.stats import chi2 as chi2_dist
    p = corr.shape[0]
    sign, logdet = np.linalg.slogdet(corr)
    if sign <= 0:
        return np.nan, np.nan  # degenerate matrix
    stat = -(n - 1 - (2 * p + 5) / 6) * logdet
    df = p * (p - 1) / 2
    p_value = 1 - chi2_dist.cdf(stat, df)
    return stat, p_value


def _shrink_toward_identity(corr, shrinkage=0.1):
    """Light shrinkage toward the identity matrix (simplified Ledoit-Wolf
    style regularization). Needed because a matrix assembled from
    separately-estimated pairwise polychoric/polyserial correlations can
    have one or two near-deterministic pairs (e.g. a rare indicator that
    happens to co-occur almost perfectly with another in a given sample)
    that destabilize the whole matrix's eigenstructure -- shrinking
    pulls every off-diagonal correlation slightly toward zero, which
    disproportionately tames the most extreme (least reliable) estimates
    without meaningfully changing well-estimated moderate correlations."""
    p = corr.shape[0]
    return (1 - shrinkage) * corr + shrinkage * np.eye(p)


def _nearest_psd(corr, epsilon=1e-6):
    """Project a symmetric matrix onto the nearest positive-semidefinite
    correlation matrix (eigenvalue clipping + renormalization). Needed
    because a matrix assembled from separately-estimated pairwise
    polychoric/polyserial/Pearson correlations isn't guaranteed PSD."""
    eigvals, eigvecs = np.linalg.eigh(corr)
    eigvals_clipped = np.clip(eigvals, epsilon, None)
    fixed = eigvecs @ np.diag(eigvals_clipped) @ eigvecs.T
    # renormalize to unit diagonal (still a valid correlation matrix)
    d = np.sqrt(np.diag(fixed))
    fixed = fixed / np.outer(d, d)
    np.fill_diagonal(fixed, 1.0)
    return fixed


def mixed_correlation_matrix(X, verbose=True):
    """Builds a full correlation matrix using polychoric/polyserial/
    Pearson as appropriate per pair, then PSD-corrects the result."""
    n_vars = X.shape[1]
    col_types = classify_columns(X)
    if verbose:
        n_ord = col_types.count("ordinal")
        print(f"    Column types: {n_ord} ordinal, {n_vars - n_ord} continuous")

    corr = np.eye(n_vars)
    method_counts = {"polychoric": 0, "polyserial": 0, "pearson": 0}
    for i in range(n_vars):
        for j in range(i + 1, n_vars):
            xi, xj = X[:, i], X[:, j]
            if np.std(xi) < 1e-10 or np.std(xj) < 1e-10:
                rho = 0.0  # zero-variance column, no meaningful correlation
            elif col_types[i] == "ordinal" and col_types[j] == "ordinal":
                rho = polychoric_corr(xi, xj)
                method_counts["polychoric"] += 1
            elif col_types[i] == "ordinal" and col_types[j] == "continuous":
                rho = polyserial_corr(xj, xi)
                method_counts["polyserial"] += 1
            elif col_types[i] == "continuous" and col_types[j] == "ordinal":
                rho = polyserial_corr(xi, xj)
                method_counts["polyserial"] += 1
            else:
                rho = np.corrcoef(xi, xj)[0, 1]
                method_counts["pearson"] += 1
            corr[i, j] = corr[j, i] = 0.0 if np.isnan(rho) else rho

    if verbose:
        print(f"    Correlation pairs: {method_counts}")

    corr_shrunk = _shrink_toward_identity(corr, shrinkage=0.1)
    corr_psd = _nearest_psd(corr_shrunk)
    return corr_psd, col_types