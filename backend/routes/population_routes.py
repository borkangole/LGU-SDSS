"""
Population summaries and the "attributes" catalogue.

/api/population/summary      -- people and households per barangay: sex, age
                                groups, PWD, seniors, solo parents, 4Ps.
/api/population/attributes   -- every attribute that goes into a calculation
                                (or is listed beside one), with its value per
                                barangay, so a planner can see e.g. how many
                                minors each barangay has, or which barangays
                                have no ambulance.
/api/population/custom-options, /api/population/custom-count
                             -- the "Custom report" builder on the Reports page:
                                count the people who match any combination of
                                sex, age range, PWD / senior / solo parent / 4Ps,
                                civil status, employment and education, per
                                barangay, optionally split by sex or age group.
/api/population/typology-reference
                             -- the 5 household profiles (typical value of each
                                of the 13 features), so the app can show how
                                close a household is to EVERY profile, not only
                                the one it is assigned to.

Counts come straight from tbl_households / tbl_individuals (live data, so
they follow imports and manual additions). SVI rates and capacity come from
the domain pipeline outputs, the same numbers the rest of the app shows.
"""
import json
import os
import re
import unicodedata

import psycopg2
import psycopg2.extras
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from config import Config

population_bp = Blueprint("population", __name__)

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_RESULTS = os.path.join(_BACKEND, "..", "data", "domain_pipeline_results")


def _conn():
    return psycopg2.connect(Config.get_connection_string(), cursor_factory=psycopg2.extras.RealDictCursor)


def bkey(name):
    """'Brgy Sta Cruz' / 'Santa Cruz' -> 'santa cruz'; 'Bgy. 13 Pob.' / 'Brgy 13' -> '13'."""
    n = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    m = re.search(r"\d+", n)
    if m:
        return m.group(0)
    words = [w for w in re.sub(r"[^a-z ]", " ", n).split() if w not in ("brgy", "bgy", "barangay", "pob", "poblacion")]
    return " ".join({"sta": "santa", "sto": "santo"}.get(w, w) for w in words)


def _csv(name):
    import csv
    p = os.path.join(_RESULTS, name)
    if not os.path.exists(p):
        return []
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _f(v):
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


# ── live counts ─────────────────────────────────────────────────────────
POP_SQL = """
SELECT b.barangay_name AS barangay,
       COUNT(DISTINCT h.household_id)                                   AS households,
       COUNT(i.person_id)                                               AS population,
       COUNT(*) FILTER (WHERE LOWER(TRIM(i.gender)) IN ('male','m'))     AS male,
       COUNT(*) FILTER (WHERE LOWER(TRIM(i.gender)) IN ('female','f'))   AS female,
       COUNT(*) FILTER (WHERE i.age < 5)                                AS age_0_4,
       COUNT(*) FILTER (WHERE i.age BETWEEN 5 AND 17)                   AS age_5_17,
       COUNT(*) FILTER (WHERE i.age < 18)                               AS minors,
       COUNT(*) FILTER (WHERE i.age BETWEEN 18 AND 59)                  AS age_18_59,
       COUNT(*) FILTER (WHERE i.age >= 60)                              AS age_60_plus,
       COUNT(*) FILTER (WHERE i.is_pwd)                                 AS pwd,
       COUNT(*) FILTER (WHERE i.is_solo_parent)                         AS solo_parents,
       COUNT(*) FILTER (WHERE i.is_4ps)                                 AS fourps_members
FROM tbl_households h
JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
LEFT JOIN tbl_individuals i ON i.household_id = h.household_id
GROUP BY b.barangay_name
"""

HH_SQL = """
SELECT b.barangay_name AS barangay,
       COUNT(*)                                                         AS households,
       COUNT(*) FILTER (WHERE LOWER(h.is_4ps_beneficiary::text) IN ('yes','true','1','t')) AS fourps_households,
       COUNT(*) FILTER (WHERE h.ti_overcrowding)            AS ti_overcrowding,
       COUNT(*) FILTER (WHERE h.ti_food_insecure)           AS ti_food_insecure,
       COUNT(*) FILTER (WHERE h.ti_no_internet)             AS ti_no_internet,
       COUNT(*) FILTER (WHERE h.ti_weak_roof)               AS ti_weak_roof,
       COUNT(*) FILTER (WHERE h.ti_weak_wall)               AS ti_weak_wall,
       COUNT(*) FILTER (WHERE h.ti_insecure_tenure)         AS ti_insecure_tenure,
       COUNT(*) FILTER (WHERE h.ti_unimproved_sanitation)   AS ti_unimproved_sanitation,
       COUNT(*) FILTER (WHERE h.ti_low_adult_education_hh)  AS ti_low_adult_education_hh,
       COUNT(*) FILTER (WHERE h.ti_large_household)         AS ti_large_household,
       COUNT(*) FILTER (WHERE h.ti_financially_excluded)    AS ti_financially_excluded,
       COUNT(*) FILTER (WHERE COALESCE(h.ti_pwd_count_cat,0) > 0)         AS ti_pwd_count_cat,
       COUNT(*) FILTER (WHERE COALESCE(h.ti_senior_count_cat,0) > 0)      AS ti_senior_count_cat,
       COUNT(*) FILTER (WHERE COALESCE(h.ti_solo_parent_count_cat,0) > 0) AS ti_solo_parent_count_cat,
       COUNT(*) FILTER (WHERE h.flood_exposure = 'Low')       AS flood_low,
       COUNT(*) FILTER (WHERE h.flood_exposure = 'Moderate')  AS flood_moderate,
       COUNT(*) FILTER (WHERE h.flood_exposure = 'High')      AS flood_high,
       COUNT(*) FILTER (WHERE h.flood_exposure = 'Very High') AS flood_very_high,
       COUNT(*) FILTER (WHERE h.landslide_exposure = 'Low')      AS slide_low,
       COUNT(*) FILTER (WHERE h.landslide_exposure = 'Moderate') AS slide_moderate,
       COUNT(*) FILTER (WHERE h.landslide_exposure = 'High')     AS slide_high,
       COUNT(*) FILTER (WHERE LOWER(h.knows_evacuation_location::text) IN ('no','false','0','f')) AS not_know_evac,
       COUNT(*) FILTER (WHERE LOWER(h.knows_emergency_hotline::text) IN ('no','false','0','f')) AS not_know_hotline
FROM tbl_households h
JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
GROUP BY b.barangay_name
"""


def _live():
    with _conn() as c, c.cursor() as cur:
        cur.execute(POP_SQL)
        pop = {bkey(r["barangay"]): dict(r) for r in cur.fetchall()}
        cur.execute(HH_SQL)
        hh = {bkey(r["barangay"]): dict(r) for r in cur.fetchall()}
    return pop, hh


def _barangay_list():
    """Official barangay names / ids from the pipeline (same order everywhere)."""
    rows = _csv("vulnerability_scores.csv")
    if not rows:  # nothing imported yet: the 24 barangays, every value 0
        from routes.domain_vulnerability_routes import BARANGAY_REFERENCE
        rows = [{"psgc_10d": pid, "barangay": name} for pid, name in BARANGAY_REFERENCE]
    return [{"psgc_10d": str(r["psgc_10d"]).zfill(10), "barangay": r["barangay"], "key": bkey(r["barangay"])} for r in rows]


POP_FIELDS = ["households", "population", "male", "female", "age_0_4", "age_5_17", "minors",
              "age_18_59", "age_60_plus", "pwd", "solo_parents", "fourps_members"]


BANDS = [f"{a}–{a+4}" for a in range(0, 80, 5)] + ["80+"]   # 17 five-year bands

PYRAMID_SQL = """
SELECT b.barangay_name AS barangay, LEAST(i.age / 5, 16) AS band,
       CASE WHEN LOWER(TRIM(i.gender)) IN ('male','m') THEN 'm'
            WHEN LOWER(TRIM(i.gender)) IN ('female','f') THEN 'f' END AS sex,
       COUNT(*) AS n
FROM tbl_individuals i
JOIN tbl_households h ON h.household_id = i.household_id
JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
WHERE i.age IS NOT NULL AND i.age >= 0
GROUP BY 1, 2, 3
"""
MEDIAN_SQL = """
SELECT b.barangay_name AS barangay, percentile_cont(0.5) WITHIN GROUP (ORDER BY i.age) AS median_age
FROM tbl_individuals i
JOIN tbl_households h ON h.household_id = i.household_id
JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
WHERE i.age IS NOT NULL
GROUP BY ROLLUP (b.barangay_name)
"""


@population_bp.route("/summary", methods=["GET"])
def population_summary():
    pop, hh = _live()
    with _conn() as c, c.cursor() as cur:
        cur.execute(PYRAMID_SQL)
        pyr_rows = cur.fetchall()
        cur.execute(MEDIAN_SQL)
        med = {(bkey(r["barangay"]) if r["barangay"] else None): r["median_age"] for r in cur.fetchall()}
    pyr = {}
    for r in pyr_rows:
        if r["sex"] is None:
            continue
        k = bkey(r["barangay"])
        pyr.setdefault(k, {"m": [0] * len(BANDS), "f": [0] * len(BANDS)})[r["sex"]][int(r["band"])] += int(r["n"])
    out = []
    for b in _barangay_list():
        p = pop.get(b["key"], {})
        h = hh.get(b["key"], {})
        row = {"psgc_10d": b["psgc_10d"], "barangay": b["barangay"]}
        row.update({k: int(p.get(k) or 0) for k in POP_FIELDS})
        row["fourps_households"] = int(h.get("fourps_households") or 0)
        row["pyramid"] = pyr.get(b["key"], {"m": [0] * len(BANDS), "f": [0] * len(BANDS)})
        row["median_age"] = None if med.get(b["key"]) is None else round(float(med[b["key"]]), 1)
        out.append(row)
    total = {k: sum(r[k] for r in out) for k in POP_FIELDS + ["fourps_households"]}
    total["pyramid"] = {s_: [sum(r["pyramid"][s_][i] for r in out) for i in range(len(BANDS))] for s_ in ("m", "f")}
    total["median_age"] = None if med.get(None) is None else round(float(med[None]), 1)
    return jsonify({"data": out, "total": total, "bands": BANDS,
                    "age_groups": [["age_0_4", "0–4"], ["age_5_17", "5–17"], ["age_18_59", "18–59"], ["age_60_plus", "60+"]]}), 200


# ── attributes catalogue ────────────────────────────────────────────────
def _attr(key, label, group, used_in, unit, definition, source, values, base_label=None):
    vals = [v["value"] for v in values.values() if v.get("value") is not None]
    total = None
    if unit == "count" and vals:
        total = sum(vals)
    return {"key": key, "label": label, "group": group, "used_in": used_in, "unit": unit,
            "definition": definition, "source": source, "base_label": base_label,
            "values": values, "total": total}


@population_bp.route("/attributes", methods=["GET"])
def population_attributes():
    brgys = _barangay_list()
    pop, hh = _live()
    by_key = {b["key"]: b for b in brgys}
    attrs = []

    def counts(src, field, base_field, base_src=None):
        res = {}
        for b in brgys:
            r = src.get(b["key"], {})
            v = r.get(field)
            base = (base_src or src).get(b["key"], {}).get(base_field)
            if not src:  # no CBMS imported yet -> show 0, not a blank
                v, base = 0, 0
            v = None if v is None else int(v)
            base = None if base is None else int(base)
            res[b["psgc_10d"]] = {"value": v, "base": base,
                                  "pct": round(v / base * 100, 1) if v is not None and base else None}
        return res

    # Population (people)
    P = "Population"
    for f, label, d in [
        ("population", "Population", "All household members recorded in the CBMS."),
        ("male", "Male", "Members recorded as male."),
        ("female", "Female", "Members recorded as female."),
        ("age_0_4", "Infants and toddlers (0–4)", "Members aged 0 to 4."),
        ("age_5_17", "Children (5–17)", "Members aged 5 to 17."),
        ("minors", "Minors (under 18)", "Members younger than 18."),
        ("age_18_59", "Working age (18–59)", "Members aged 18 to 59."),
        ("age_60_plus", "Senior citizens (60+)", "Members aged 60 or older."),
        ("pwd", "Persons with disability", "Members flagged as PWD."),
        ("solo_parents", "Solo parents", "Members flagged as solo parents."),
        ("fourps_members", "4Ps members", "Members in a 4Ps beneficiary household record."),
    ]:
        attrs.append(_attr(f, label, P, "Population profile (context, not a score)", "count", d,
                           "CBMS member record (tbl_individuals)", counts(pop, f, "population"),
                           None if f == "population" else "% of population"))
    attrs.append(_attr("households", "Households", "Households", "Population profile", "count",
                       "Households recorded in the CBMS.", "CBMS household record (tbl_households)",
                       counts(hh, "households", "households")))
    attrs.append(_attr("fourps_households", "4Ps beneficiary households", "Households", "Population profile", "count",
                       "Households that are 4Ps beneficiaries.", "CBMS household record",
                       counts(hh, "fourps_households", "households"), "% of households"))

    # Social vulnerability (SVI) -- barangay rates from the pipeline
    vs = {str(r["psgc_10d"]).zfill(10): r for r in _csv("vulnerability_scores.csv")}
    svi_items = [
        ("overcrowding_prop", "Overcrowding", "Share of households with more members than the dwelling comfortably holds."),
        ("food_insecure_prop", "Food insecurity", "Share of households that worried about running out of food."),
        ("no_internet_prop", "No internet access", "Share of households without internet access."),
        ("weak_roof_prop", "Weak roof material", "Share of households with light or salvaged roof material."),
        ("weak_wall_prop", "Weak wall material", "Share of households with light or salvaged wall material."),
        ("insecure_tenure_prop", "Insecure tenure", "Share of households without secure tenure of the lot."),
        ("unimproved_sanitation_prop", "Unimproved sanitation", "Share of households with an unimproved toilet."),
        ("pwd_prop", "PWD population share", "Share of the population with a disability."),
        ("senior_prop", "Senior citizen share", "Share of the population aged 60 or older."),
        ("solo_parent_prop", "Solo-parent share", "Share of the population who are solo parents."),
        ("low_adult_education_prop", "Low adult education (25+)", "Share of adults 25+ with little or no schooling."),
    ]
    for f, label, d in svi_items:
        vals = {}
        for b in brgys:
            r = vs.get(b["psgc_10d"], {})
            v = _f(r.get(f))
            vals[b["psgc_10d"]] = {"value": None if v is None else round(v * 100, 1),
                                   "percentile": _f(r.get(f"rankpct__access_augmented__{f}"))}
            if not vs:
                vals[b["psgc_10d"]] = {"value": 0, "percentile": 0}
        attrs.append(_attr(f, label, "Social vulnerability (SVI)", "SVI score (1 of 13 parts)", "pct", d,
                           "CBMS household / member records, aggregated per barangay", vals))
    # Distance to help: the share of households more than 2 km (straight
    # line) from the RHU / fire station -- 2 of the 13 SVI parts.
    for f_n, f_p, label in [("rhu_n_beyond_2km", "rhu_pct_beyond_2km", "Households beyond 2 km of the RHU"),
                            ("fire_n_beyond_2km", "fire_pct_beyond_2km", "Households beyond 2 km of the fire station")]:
        vals = {}
        for b in brgys:
            r = vs.get(b["psgc_10d"], {})
            n, p_, base = _f(r.get(f_n)), _f(r.get(f_p)), _f(r.get("households"))
            vals[b["psgc_10d"]] = {"value": None if n is None else int(n), "base": None if base is None else int(base),
                                   "pct": p_, "percentile": _f(r.get(f"rankpct__access_augmented__{f_p}"))}
            if not vs:
                vals[b["psgc_10d"]] = {"value": 0, "base": 0, "pct": 0, "percentile": 0}
        attrs.append(_attr(f_n.replace("_2km", ""), label, "Social vulnerability (SVI)", "SVI score (1 of 13 parts)", "count",
                           "Straight-line distance from the household's location; 2 km threshold.", "Household GPS location", vals,
                           "% of households"))
    for f, label in [("rhu_median_km", "Median distance to the RHU"), ("fire_median_km", "Median distance to the fire station")]:
        vals = {b["psgc_10d"]: {"value": _f(vs.get(b["psgc_10d"], {}).get(f))} for b in brgys}
        attrs.append(_attr(f, label, "Distance to help", "Context (not added to a score)", "km",
                           "Median straight-line distance of the barangay's households.", "Household GPS location", vals))
    attrs.append(_attr("not_know_evac", "Households that do not know the evacuation site", "Distance to help",
                       "Listed with vulnerability", "count", "Survey answer: does not know where to evacuate.",
                       "CBMS household record", counts(hh, "not_know_evac", "households"), "% of households"))
    attrs.append(_attr("not_know_hotline", "Households that do not know the emergency hotline", "Distance to help",
                       "Listed with vulnerability", "count", "Survey answer: does not know the emergency hotline.",
                       "CBMS household record", counts(hh, "not_know_hotline", "households"), "% of households"))

    # Household typology features (households with each condition)
    for f, label in [("ti_overcrowding", "Overcrowding"), ("ti_food_insecure", "Food insecurity"),
                     ("ti_no_internet", "No internet access"), ("ti_weak_roof", "Weak roof material"),
                     ("ti_weak_wall", "Weak wall material"), ("ti_insecure_tenure", "Insecure tenure"),
                     ("ti_unimproved_sanitation", "Unimproved sanitation"), ("ti_pwd_count_cat", "Has a PWD member"),
                     ("ti_senior_count_cat", "Has a senior member"), ("ti_solo_parent_count_cat", "Has a solo-parent member"),
                     ("ti_low_adult_education_hh", "Low adult education"), ("ti_large_household", "Large household (6+)"),
                     ("ti_financially_excluded", "Financially excluded")]:
        attrs.append(_attr(f, label, "Household typology", "Household profile (k-modes, 1 of 13 features)", "count",
                           "Households where this condition is present.", "CBMS household / member records",
                           counts(hh, f, "households"), "% of households"))

    # Barangay capacity
    try:
        from routes.domain_vulnerability_routes import domain_capacity
        resp = domain_capacity()
        cap = (resp[0] if isinstance(resp, tuple) else resp).get_json().get("data", [])
    except Exception:
        cap = []
    capb = {r["psgc_10d"]: r for r in cap}
    if cap:
        for ind in cap[0]["indicators"]:
            vals = {}
            for b in brgys:
                r = capb.get(b["psgc_10d"])
                i = next((x for x in (r or {}).get("indicators", []) if x["key"] == ind["key"]), None)
                vals[b["psgc_10d"]] = {"value": None if not i else i["value"], "percentile": None if not i else i["percentile"]}
                if not vs:
                    vals[b["psgc_10d"]] = {"value": 0, "percentile": 0}
            unit = {"yes/no": "yesno", "pesos": "pesos"}.get(ind["kind"], "count")
            attrs.append(_attr(ind["key"], ind["label"], "Barangay capacity",
                               "Capacity score" + ("" if ind["included"] else " (same everywhere, not used)"),
                               unit, f"{ind['dimension']}.",
                               "Facility locations (point inside the barangay boundary)" if ind["key"].startswith("facility_")
                               else "CBMS barangay record", vals))

    # Hazard exposure
    for f, label, base in [("flood_low", "Flood zone — Low", "households"), ("flood_moderate", "Flood zone — Moderate", "households"),
                           ("flood_high", "Flood zone — High", "households"), ("flood_very_high", "Flood zone — Very High", "households"),
                           ("slide_low", "Landslide zone — Low", "households"), ("slide_moderate", "Landslide zone — Moderate", "households"),
                           ("slide_high", "Landslide zone — High", "households")]:
        attrs.append(_attr(f, label, "Hazard exposure", "Hazard exposure (flood and landslide kept separate)", "count",
                           "Households whose location falls inside this susceptibility zone.", "Household GPS location + hazard maps",
                           counts(hh, f, base), "% of households"))

    groups = []
    for a in attrs:
        if a["group"] not in groups:
            groups.append(a["group"])
    return jsonify({"barangays": [{"psgc_10d": b["psgc_10d"], "barangay": b["barangay"]} for b in brgys],
                    "groups": groups, "attributes": attrs}), 200


@population_bp.route("/typology-reference", methods=["GET"])
def typology_reference():
    with open(os.path.join(_BACKEND, "typology_reference_k5.json"), encoding="utf-8") as f:
        ref = json.load(f)
    return jsonify({"features": ref["features"], "labels": ref["labels"], "centroids": ref["centroids"]}), 200


# ── custom report builder ───────────────────────────────────────────────
# Every condition is turned into a fixed SQL fragment with bound parameters;
# nothing the user types is ever pasted into the query text.
_SEX_SQL = "CASE WHEN LOWER(TRIM(i.gender)) IN ('male','m') THEN 'Male' WHEN LOWER(TRIM(i.gender)) IN ('female','f') THEN 'Female' ELSE 'Not recorded' END"
_LIFE_SQL = "CASE WHEN i.age IS NULL THEN 'Age not recorded' WHEN i.age < 5 THEN '0–4' WHEN i.age < 18 THEN '5–17' WHEN i.age < 60 THEN '18–59' ELSE '60+' END"
_AGE5_SQL = "CASE WHEN i.age IS NULL THEN 'Age not recorded' WHEN i.age >= 80 THEN '80+' ELSE (i.age / 5 * 5)::text || '–' || (i.age / 5 * 5 + 4)::text END"
_TEXT_FIELDS = {"civil_status": "i.civil_status", "employment_status": "i.employment_status",
                "educational_attainment": "i.educational_attainment"}
_FLAG_FIELDS = {"pwd": "i.is_pwd", "senior": "i.is_senior", "solo_parent": "i.is_solo_parent", "fourps": "i.is_4ps"}
_SPLITS = {
    "none": None, "sex": _SEX_SQL, "lifestage": _LIFE_SQL, "age5": _AGE5_SQL,
    "civil_status": "COALESCE(NULLIF(TRIM(i.civil_status), ''), 'Not recorded')",
    "employment_status": "COALESCE(NULLIF(TRIM(i.employment_status), ''), 'Not recorded')",
    "educational_attainment": "COALESCE(NULLIF(TRIM(i.educational_attainment), ''), 'Not recorded')",
}
_SPLIT_ORDER = {
    "sex": ["Male", "Female", "Not recorded"],
    "lifestage": ["0–4", "5–17", "18–59", "60+", "Age not recorded"],
    "age5": [f"{a}–{a+4}" for a in range(0, 80, 5)] + ["80+", "Age not recorded"],
}
_FLAG_LABEL = {"pwd": "PWD", "senior": "senior citizen", "solo_parent": "solo parent", "fourps": "4Ps member"}
_FLAG_PLURAL = {"pwd": "PWDs", "senior": "Senior citizens", "solo_parent": "Solo parents", "fourps": "4Ps members"}


@population_bp.route("/custom-options", methods=["GET"])
def custom_options():
    """Choices for the custom report builder, with how many people have each."""
    out = {}
    with _conn() as c, c.cursor() as cur:
        for key, col in _TEXT_FIELDS.items():
            cur.execute(f"SELECT NULLIF(TRIM({col}), '') AS v, COUNT(*) AS n FROM tbl_individuals i GROUP BY 1 ORDER BY 2 DESC")
            out[key] = [{"value": r["v"], "count": int(r["n"])} for r in cur.fetchall() if r["v"]]
        cur.execute("SELECT MIN(age) AS lo, MAX(age) AS hi FROM tbl_individuals")
        r = cur.fetchone()
        out["age_range"] = [int(r["lo"] or 0), int(r["hi"] or 100)]
    out["barangays"] = [{"psgc_10d": b["psgc_10d"], "barangay": b["barangay"]} for b in _barangay_list()]
    return jsonify(out), 200


def _custom_where(cond):
    """(sql, params, plain-English description) for the chosen conditions.
    The description reads like "Senior citizens who are also PWD (female,
    aged 70+)" -- used as the report's default title."""
    where, params, desc = [], [], []
    who, also = None, []
    sexes = [x for x in (cond.get("sex") or []) if x in ("Male", "Female")]
    if sexes and len(sexes) < 2:
        where.append(f"{_SEX_SQL} = %s"); params.append(sexes[0]); desc.append(sexes[0].lower())
    lo, hi = cond.get("age_min"), cond.get("age_max")
    try:
        lo = None if lo in (None, "") else int(lo)
        hi = None if hi in (None, "") else int(hi)
    except (TypeError, ValueError):
        lo = hi = None
    if lo is not None:
        where.append("i.age >= %s"); params.append(lo)
    if hi is not None:
        where.append("i.age <= %s"); params.append(hi)
    if lo is not None and hi is not None:
        desc.append(f"aged {lo}–{hi}")
    elif lo is not None:
        desc.append(f"aged {lo}+")
    elif hi is not None:
        desc.append(f"aged {hi} and under")
    for key, col in _FLAG_FIELDS.items():
        v = cond.get(key)
        if v is True:
            where.append(f"COALESCE({col}, FALSE)")
            if who is None:
                who = _FLAG_PLURAL[key]
            else:
                also.append(_FLAG_LABEL[key])
        elif v is False:
            where.append(f"NOT COALESCE({col}, FALSE)"); desc.append(f"not {_FLAG_LABEL[key]}")
    if cond.get("pwd_id") in ("Yes", "No"):
        where.append("TRIM(i.with_pwd_id) = %s"); params.append(cond["pwd_id"])
        desc.append("with PWD ID" if cond["pwd_id"] == "Yes" else "without PWD ID")
    for key, col in _TEXT_FIELDS.items():
        vals = [str(x) for x in (cond.get(key) or []) if x]
        if vals:
            where.append(f"TRIM({col}) = ANY(%s)"); params.append(vals)
            desc.append(" or ".join(v.lower() for v in vals))
    text = (who or "Residents") + (f" who are also {' and '.join(also)}" if also else "")
    if desc:
        text += f" ({', '.join(desc)})"
    return (" AND ".join(where) or "TRUE"), params, text


@population_bp.route("/custom-count", methods=["POST"])
def custom_count():
    """Count the people matching the chosen conditions, per barangay.

    Body: {"conditions": {...}, "split_by": "none|sex|lifestage|age5|civil_status|
    employment_status|educational_attainment", "barangays": [psgc_10d, ...]}
    (an empty barangay list means all 24)."""
    body = request.get_json(silent=True) or {}
    cond = body.get("conditions") or {}
    split = body.get("split_by") or "none"
    if split not in _SPLITS:
        return jsonify({"error": "Unknown split"}), 400
    wanted = set(str(x).zfill(10) for x in (body.get("barangays") or []))
    where, params, desc = _custom_where(cond)
    split_sql = _SPLITS[split] or "'Total'"
    sql = f"""
        SELECT b.barangay_name AS barangay, {split_sql} AS grp, COUNT(*) AS n
        FROM tbl_individuals i
        JOIN tbl_households h ON h.household_id = i.household_id
        JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
        WHERE {where}
        GROUP BY 1, 2
    """
    with _conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.execute("""SELECT b.barangay_name AS barangay, COUNT(*) AS n FROM tbl_individuals i
                       JOIN tbl_households h ON h.household_id = i.household_id
                       JOIN tbl_barangays b ON b.barangay_id = h.barangay_id GROUP BY 1""")
        pop = {bkey(r["barangay"]): int(r["n"]) for r in cur.fetchall()}
    counts, groups = {}, set()
    for r in rows:
        counts.setdefault(bkey(r["barangay"]), {})[r["grp"]] = int(r["n"])
        groups.add(r["grp"])
    order = _SPLIT_ORDER.get(split)
    if split == "none":
        columns = ["Total"]
    elif order:
        columns = [g for g in order if g in groups]
        columns += sorted(g for g in groups if g not in columns)
    else:
        tot = {g: sum(cnt.get(g, 0) for cnt in counts.values()) for g in groups}
        columns = sorted(groups, key=lambda g: (g == "Not recorded", -tot[g]))
    out = []
    for b in _barangay_list():
        if wanted and b["psgc_10d"] not in wanted:
            continue
        cnt = counts.get(b["key"], {})
        total = sum(cnt.values())
        p = pop.get(b["key"], 0)
        out.append({"psgc_10d": b["psgc_10d"], "barangay": b["barangay"], "population": p,
                    "counts": {col: cnt.get(col, 0) for col in columns}, "total": total,
                    "pct": round(100.0 * total / p, 1) if p else 0.0})
    tot_counts = {col: sum(r["counts"][col] for r in out) for col in columns}
    tot_total = sum(r["total"] for r in out)
    tot_pop = sum(r["population"] for r in out)
    description = desc
    return jsonify({"columns": columns, "rows": out, "split_by": split, "description": description,
                    "total": {"counts": tot_counts, "total": tot_total, "population": tot_pop,
                              "pct": round(100.0 * tot_total / tot_pop, 1) if tot_pop else 0.0}}), 200


@population_bp.route("/custom-list", methods=["POST"])
@jwt_required()
def custom_list():
    """Names of the people matching the same conditions as /custom-count
    (personal data -- login required). Sorted by barangay, then surname."""
    body = request.get_json(silent=True) or {}
    cond = body.get("conditions") or {}
    wanted = set(str(x).zfill(10) for x in (body.get("barangays") or []))
    where, params, desc = _custom_where(cond)
    sql = f"""
        SELECT b.barangay_name AS barangay, h.household_number,
               NULLIF(TRIM(i.last_name), '') AS last_name, NULLIF(TRIM(i.first_name), '') AS first_name,
               NULLIF(TRIM(i.middle_name), '') AS middle_name, NULLIF(TRIM(i.suffix), '') AS suffix,
               i.full_name, {_SEX_SQL} AS sex, i.age, i.civil_status, i.relationship_to_hh,
               COALESCE(i.is_pwd, FALSE) AS pwd, NULLIF(TRIM(i.with_pwd_id), '') AS pwd_id,
               COALESCE(i.is_senior, FALSE) AS senior, COALESCE(i.is_solo_parent, FALSE) AS solo_parent,
               COALESCE(i.is_4ps, FALSE) AS fourps
        FROM tbl_individuals i
        JOIN tbl_households h ON h.household_id = i.household_id
        JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
        WHERE {where}
    """
    with _conn() as c, c.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    official = {b["key"]: b for b in _barangay_list()}
    blank = lambda v: None if v is None or str(v).strip().upper().strip(".") in ("", "NA", "N/A", "N A", "NONE", "-", "--") else str(v).strip()
    out = []
    for r in rows:
        b = official.get(bkey(r["barangay"]))
        if wanted and (not b or b["psgc_10d"] not in wanted):
            continue
        last, first = blank(r["last_name"]), blank(r["first_name"])
        if last or first:
            given = " ".join(x for x in (first, blank(r["middle_name"]), blank(r["suffix"])) if x)
            name = f"{(last or '').upper()}, {given}".strip(", ")
        else:
            name = " ".join(w for w in (r["full_name"] or "").split() if blank(w)) or "(no name recorded)"
        sectors = [lbl for k, lbl in (("pwd", "PWD"), ("senior", "Senior citizen"), ("solo_parent", "Solo parent"), ("fourps", "4Ps")) if r[k]]
        out.append({
            "barangay": b["barangay"] if b else r["barangay"],
            "household": (r["household_number"] or "").split(" - ")[-1],
            "name": name, "sort": (last or r["full_name"] or "").upper(), "sex": r["sex"], "age": r["age"],
            "civil_status": r["civil_status"], "relationship": r["relationship_to_hh"],
            "sectors": sectors, "pwd_id": r["pwd_id"] if r["pwd"] else None,
        })
    out.sort(key=lambda x: (x["barangay"], x["sort"], x["name"]))
    for x in out:
        x.pop("sort", None)
    return jsonify({"description": desc, "count": len(out), "rows": out}), 200
