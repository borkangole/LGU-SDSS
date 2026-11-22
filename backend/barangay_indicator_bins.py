# ============================================================
# SHARED BARANGAY INDICATOR BINNING
#
# The population-percentage -> 1-4 bin rubric from the Excel's Scoring
# tab, used by barangay_stage1_vulnerability.py (batch computation,
# writes tbl_barangay_vulnerability_stage1) and by the live
# /api/vulnerability/barangay-stage1/<id>/explain endpoint (on-demand
# per-indicator breakdown for the "How was this calculated?" panel).
# Factored out here so both call sites can't silently drift apart the
# way barangay_stage1_vulnerability.py's percentile ranking once did
# (see quantile_utils.py's docstring for that history).
# ============================================================

INDICATOR_PRESENCE_THRESHOLD = 0.5  # a household counts as "condition present"
                                     # if its own fraction >= this (see
                                     # barangay_stage1_vulnerability.py's
                                     # module docstring for why)

# Human-readable labels for the indicator keys returned by
# vulnerability_engine._sensitivity_fractions() / _ac_fractions(), for
# display in the "How was this calculated?" breakdown.
SENSITIVITY_LABELS = {
    "weak_roof":            "Weak roof material",
    "weak_walls":           "Weak wall material",
    "weak_floor":           "Weak floor material",
    "insecure_tenure":      "Insecure tenure",
    "pct_pwd":               "PWD members",
    "pct_senior":            "Senior members",
    "pct_solo_parent":       "Solo parent members",
    "pct_young_dependents":  "Young dependents",
    "below_poverty":         "Below poverty threshold",
    "malnourished":          "Food insecurity",
    "high_dependency":       "High dependency ratio",
    "overcrowded":           "Overcrowded housing",
    "no_electricity":        "No electricity access",
    "unsafe_water":          "Unsafe water source",
    "unsafe_toilet":         "Unsafe toilet/sanitation",
}

AC_LABELS = {
    "infra_proximity":      "Infrastructure proximity (to MDRRMO)",
    "retrofit_capacity":    "Retrofit capacity (income proxy)",
    "financial_assistance": "Financial assistance access (4Ps / bank account)",
    "information_access":   "Information access (evacuation site / hotline)",
    "education":            "Average education level",
    "employment":           "Employment rate",
    "social_insurance":     "Social insurance coverage",
    "gov_investment":       "Government CCA-DRR investment (barangay-level, placeholder)",
}


def sensitivity_bin(pct):
    """pct is 0-100 (% of barangay households with the condition present)."""
    if pct <= 5: return 1
    if pct <= 10: return 2
    if pct < 16: return 3
    return 4


def ac_bin(pct):  # inverted — more capacity coverage = lower (better) score
    if pct <= 5: return 4
    if pct <= 10: return 3
    if pct < 16: return 2
    return 1


def compute_barangay_indicator_breakdown(households, sensitivity_fractions_fn, ac_fractions_fn):
    """
    Given a list of household dicts (all belonging to ONE barangay) and the
    live vulnerability_engine fraction functions, returns the full
    per-indicator breakdown: population %, bin score, and label, for both
    Sensitivity and Adaptive Capacity — plus the averaged dimension scores
    and combined vuln_score. This is the same computation
    barangay_stage1_vulnerability.py does in its batch loop, factored out
    so a live single-barangay "explain" endpoint can call it on demand
    without re-running the whole 24-barangay batch script.
    """
    n = len(households)
    if n == 0:
        return None

    s_fracs = [sensitivity_fractions_fn(h) for h in households]
    ac_fracs = [ac_fractions_fn(h) for h in households]
    s_keys = list(s_fracs[0].keys())
    ac_keys = list(ac_fracs[0].keys())

    sensitivity_indicators = []
    s_scores = []
    for k in s_keys:
        present = sum(1 for f in s_fracs if f[k] >= INDICATOR_PRESENCE_THRESHOLD)
        pct = 100.0 * present / n
        bin_score = sensitivity_bin(pct)
        s_scores.append(bin_score)
        sensitivity_indicators.append({
            "key": k,
            "label": SENSITIVITY_LABELS.get(k, k),
            "households_present": present,
            "pct": round(pct, 2),
            "bin_score": bin_score,
        })

    ac_indicators = []
    ac_scores = []
    for k in ac_keys:
        present = sum(1 for f in ac_fracs if f[k] >= INDICATOR_PRESENCE_THRESHOLD)
        pct = 100.0 * present / n
        bin_score = ac_bin(pct)
        ac_scores.append(bin_score)
        ac_indicators.append({
            "key": k,
            "label": AC_LABELS.get(k, k),
            "households_present": present,
            "pct": round(pct, 2),
            "bin_score": bin_score,
        })

    avg_s = sum(s_scores) / len(s_scores)
    avg_ac = sum(ac_scores) / len(ac_scores)
    vuln_score = (avg_s + avg_ac) / 2.0

    return {
        "total_households": n,
        "sensitivity_indicators": sensitivity_indicators,
        "ac_indicators": ac_indicators,
        "avg_sensitivity": round(avg_s, 4),
        "avg_adaptive_capacity": round(avg_ac, 4),
        "vuln_score": round(vuln_score, 4),
    }