"""
Ready-made question library for "Ask the Data".

Why this exists
---------------
Every question used to need TWO Gemini calls (plan the SQL, then explain the
rows). That breaks in three situations that all happen in a real LGU
deployment: Gemini is overloaded (503), the free-tier daily quota is used
up (429), or the office has no internet. This module answers the
questions the LGU is actually going to ask WITHOUT Gemini:

    question text -> matched to a fixed / templated, read-only SELECT ->
    run against data/nlp_analytics.sqlite (opened read-only) ->
    deterministic plain-language summary built from the returned rows.

Gemini (nlp_db.py) is now only the fallback for free-typed questions that
match nothing here.

Rules baked in (same as the rest of the app -- Sir Shem's model)
----------------------------------------------------------------
* SVI, Barangay Capacity and Hazard Exposure are three separate
  domains. No question here adds, averages or weights them together.
  The single cross-domain view (vw_barangay_priority) only COUNTS how
  many domains flag a barangay, exactly like the Planning page verdict.
* SVI rank 1 = MOST vulnerable. Capacity rank 1 = BEST equipped (the
  opposite direction, same as the Capacity page). Distance to the RHU and
  fire station belongs to SVI, not capacity.
* A question is only answered here when it has a clear shape (a ranking,
  a threshold, a yes/no item, one barangay's value, an average or total).
  Anything else goes to the AI planner instead of being forced into the
  nearest ranking -- a wrong instant answer is worse than a slower right one.
* No SQL is built from user text. Barangay names are matched against the
  24 real names in the database and passed as bound parameters; metrics
  come from the fixed METRICS table below.
"""
import difflib
import re
import unicodedata

# ── Example chips shown in the UI, grouped by domain ────────────────────
EXAMPLE_GROUPS = [
    {
        "key": "svi", "title": "Social Vulnerability (SVI)",
        "questions": [
            "Which 5 barangays have the highest SVI score?",
            "List barangays ranked by SVI score from most to least vulnerable.",
            "Which barangays are in the High SVI tier?",
            "Which barangays have the highest food insecurity rate?",
            "Which barangays have the highest percentage of weak-roof housing?",
            "Which barangays have the highest percentage of senior citizens?",
            "Which barangays have the highest percentage of PWD?",
            "Which barangays have more than 50% of households beyond 2km of the RHU?",
            "Which barangays have more than 50% of households beyond 2km of the fire station?",
        ],
    },
    {
        "key": "capacity", "title": "Barangay Capacity",
        "questions": [
            "Which barangays have the lowest capacity score?",
            "Which barangays are in the Low capacity tier?",
            "Which barangays have no evacuation map?",
            "Which barangays have no hazard map?",
            "Which barangays have no ambulance?",
            "Which barangays have no generator?",
            "Which barangays spent the most on DRRM in 2023?",
        ],
    },
    {
        "key": "hazard", "title": "Hazard Exposure",
        "questions": [
            "Which barangays are most exposed to flood hazard?",
            "Which barangays are most exposed to landslide hazard?",
            "Which barangays have at least 25% of households in a high flood or landslide zone?",
            "How many households are in high flood and landslide zones?",
        ],
    },
    {
        "key": "typology", "title": "Household Profiles",
        "questions": [
            "What is the dominant household profile in each barangay?",
            "Which barangays have the highest share of compounded deprivation households?",
            "How many households are in each barangay?",
        ],
    },
    {
        "key": "priority", "title": "Priority (flags per domain)",
        "questions": [
            "Which barangays are flagged in all three domains?",
            "Which barangays are flagged in two or more domains?",
            "Show each barangay's flag in the three domains.",
            "Show the three-domain profile of Santo Angel.",
        ],
    },
]

# ── Metric table: the ONLY columns a templated ranking can use ──────────
# (view, value column, label, unit suffix, extra columns to show, domain)
_SVI = "vw_barangay_vulnerability"
_CAP = "vw_barangay_capacity"
_HAZ = "vw_hazard_exposure"
_SVI_X = ["svi_rank", "svi_tier"]
_CAP_X = ["capacity_rank", "capacity_tier"]

METRICS = {
    "svi_score":       (_SVI, "svi_score", "SVI score", "", _SVI_X, "svi"),
    "food":            (_SVI, "food_insecure_pct", "food insecurity rate", "%", _SVI_X, "svi"),
    "overcrowding":    (_SVI, "overcrowding_pct", "overcrowding rate", "%", _SVI_X, "svi"),
    "internet":        (_SVI, "no_internet_pct", "share of households without internet", "%", _SVI_X, "svi"),
    "roof":            (_SVI, "weak_roof_pct", "share of weak-roof housing", "%", _SVI_X, "svi"),
    "wall":            (_SVI, "weak_wall_pct", "share of weak-wall housing", "%", _SVI_X, "svi"),
    "tenure":          (_SVI, "insecure_tenure_pct", "insecure-tenure rate", "%", _SVI_X, "svi"),
    "sanitation":      (_SVI, "unimproved_sanitation_pct", "unimproved-sanitation rate", "%", _SVI_X, "svi"),
    "pwd":             (_SVI, "pwd_pct", "PWD share of the population", "%", _SVI_X, "svi"),
    "senior":          (_SVI, "senior_pct", "senior-citizen share of the population", "%", _SVI_X, "svi"),
    "solo":            (_SVI, "solo_parent_pct", "solo-parent share of the population", "%", _SVI_X, "svi"),
    "education":       (_SVI, "low_adult_education_pct", "low adult education rate", "%", _SVI_X, "svi"),
    "rhu_km":          (_SVI, "rhu_median_km", "median distance to the RHU", " km", _SVI_X, "svi"),
    "fire_km":         (_SVI, "fire_median_km", "median distance to the fire station", " km", _SVI_X, "svi"),
    "cap_score":       (_CAP, "capacity_score", "Barangay Capacity score", "", _CAP_X, "capacity"),
    "rhu_beyond":      (_SVI, "rhu_pct_beyond_2km", "share of households beyond 2km of the RHU", "%", _SVI_X, "svi"),
    "fire_beyond":     (_SVI, "fire_pct_beyond_2km", "share of households beyond 2km of the fire station", "%", _SVI_X, "svi"),
    "flood":           (_HAZ, "flood_high_or_very_high_pct_total", "share of households in High/Very-High flood zones", "%", ["flood_high_or_very_high_households"], "hazard"),
    "landslide":       (_HAZ, "landslide_moderate_or_high_pct_total", "share of households in Moderate/High landslide zones", "%", ["landslide_moderate_or_high_households"], "hazard"),
    "households":      (_SVI, "households", "number of households", "", [], "svi"),
    "population":      (_SVI, "population", "population", "", [], "svi"),
    "pwd_n":           (_SVI, "pwd_count", "number of persons with disability", "", ["pwd_pct"], "svi"),
    "senior_n":        (_SVI, "senior_count", "number of senior citizens", "", ["senior_pct"], "svi"),
    "solo_n":          (_SVI, "solo_parent_count", "number of solo parents", "", ["solo_parent_pct"], "svi"),
    "rhu_beyond_n":    (_SVI, "rhu_households_beyond_2km", "number of households beyond 2km of the RHU", "", ["rhu_pct_beyond_2km"], "svi"),
    "fire_beyond_n":   (_SVI, "fire_households_beyond_2km", "number of households beyond 2km of the fire station", "", ["fire_pct_beyond_2km"], "svi"),
    "flood_n":         (_HAZ, "flood_high_or_very_high_households", "number of households in High/Very-High flood zones", "", ["flood_high_or_very_high_pct_total"], "hazard"),
    "landslide_n":     (_HAZ, "landslide_moderate_or_high_households", "number of households in Moderate/High landslide zones", "", ["landslide_moderate_or_high_pct_total"], "hazard"),
}

# Barangay Capacity resource items (all in vw_barangay_capacity).
# key -> (column, label, kind)   kind: "yesno" (1/0) or "count" / "php"
CAPACITY_ITEMS = {
    "committee":  ("has_disaster_committee", "a disaster management committee", "yesno"),
    "team":       ("has_response_team", "an emergency response team", "yesno"),
    "hotline":    ("has_emergency_hotline", "an emergency hotline", "yesno"),
    "seminar":    ("held_preparedness_seminar", "a disaster preparedness seminar", "yesno"),
    "drrm_plan":  ("has_drrm_plan", "a barangay DRRM plan", "yesno"),
    "evac_map":   ("has_evacuation_map", "an evacuation map", "yesno"),
    "hazard_map": ("has_hazard_map", "a hazard map", "yesno"),
    "first_aid":  ("first_aid_kits", "first-aid kits", "count"),
    "vehicles":   ("boats_vans_buses", "boats, vans or buses", "count"),
    "ambulance":  ("ambulances", "ambulances", "count"),
    "amphibian":  ("amphibian_vehicles", "amphibian vehicles", "count"),
    "heavy":      ("heavy_equipment", "heavy equipment", "count"),
    "siren":      ("sirens", "sirens", "count"),
    "radio":      ("two_way_radios", "two-way radios", "count"),
    "generator":  ("generators", "generators", "count"),
    "lights":     ("emergency_lights", "emergency lights", "count"),
    "budget":     ("drrm_expenditure_php", "2023 DRRM spending", "php"),
    "schools":    ("schools", "schools", "count"),
    "evac_centre": ("evacuation_centres", "evacuation centres", "count"),
}
for _k, (_c, _l, _kind) in CAPACITY_ITEMS.items():
    METRICS["item_" + _k] = (_CAP, _c, _l, " PHP" if _kind == "php" else "", _CAP_X, "capacity")

# Metrics where a LOWER value is the worse one: "biggest gaps", "weakest",
# "least equipped" mean the LOWEST capacity score.
_GAP_WORDS = r"\b(gap|gaps|weak|weakest|least equipped|poorly equipped|under equipped|lacking|lack|lowest capacity|low capacity)\b"

# keyword -> metric key. Longest phrase wins, so "beyond ... rhu" is tested
# before plain "rhu".
_SYNONYMS = [
    (("beyond", "rhu"), "rhu_beyond"), (("beyond", "health"), "rhu_beyond"),
    (("beyond", "fire"), "fire_beyond"), (("far from", "rhu"), "rhu_beyond"), (("far from", "fire"), "fire_beyond"),
    (("capacity",), "cap_score"), (("equipped",), "cap_score"), (("preparedness score",), "cap_score"),
    (("gaps",), "cap_score"), (("gap",), "cap_score"),
    (("committee",), "item_committee"), (("response team",), "item_team"), (("rescue team",), "item_team"),
    (("hotline",), "item_hotline"), (("seminar",), "item_seminar"), (("training",), "item_seminar"),
    (("drrm plan",), "item_drrm_plan"), (("disaster plan",), "item_drrm_plan"),
    (("evacuation map",), "item_evac_map"), (("evac map",), "item_evac_map"),
    (("hazard map",), "item_hazard_map"), (("first aid",), "item_first_aid"),
    (("boat",), "item_vehicles"), (("van",), "item_vehicles"), (("bus",), "item_vehicles"),
    (("ambulance",), "item_ambulance"), (("amphibian",), "item_amphibian"),
    (("heavy equipment",), "item_heavy"), (("backhoe",), "item_heavy"),
    (("siren",), "item_siren"), (("radio",), "item_radio"), (("generator",), "item_generator"),
    (("emergency light",), "item_lights"), (("flashlight",), "item_lights"),
    (("drrm spending",), "item_budget"), (("drrm budget",), "item_budget"), (("drrm expenditure",), "item_budget"),
    (("spent",), "item_budget"), (("spend",), "item_budget"), (("budget",), "item_budget"), (("expenditure",), "item_budget"),
    (("school",), "item_schools"), (("evacuation cent",), "item_evac_centre"), (("evac cent",), "item_evac_centre"),
    (("number of households",), "households"), (("household count",), "households"),
    (("population",), "population"), (("how many people",), "population"),
    (("number of pwd",), "pwd_n"), (("how many pwd",), "pwd_n"),
    (("number of senior",), "senior_n"), (("how many senior",), "senior_n"),
    (("number of solo",), "solo_n"), (("how many solo",), "solo_n"),
    (("how many households", "flood"), "flood_n"), (("number of households", "flood"), "flood_n"),
    (("most households", "flood"), "flood_n"), (("most households", "landslide"), "landslide_n"),
    (("how many households", "landslide"), "landslide_n"), (("number of households", "landslide"), "landslide_n"),
    (("how many households", "beyond", "rhu"), "rhu_beyond_n"), (("how many households", "beyond", "fire"), "fire_beyond_n"),
    (("svi",), "svi_score"), (("social vulnerability",), "svi_score"),
    (("vulnerab",), "svi_score"),
    (("food",), "food"), (("overcrowd",), "overcrowding"), (("internet",), "internet"),
    (("roof",), "roof"), (("wall",), "wall"), (("tenure",), "tenure"),
    (("sanitation",), "sanitation"), (("toilet",), "sanitation"),
    (("pwd",), "pwd"), (("disabilit",), "pwd"),
    (("senior",), "senior"), (("elderly",), "senior"),
    (("solo",), "solo"), (("education",), "education"),
    (("rhu",), "rhu_km"), (("health unit",), "rhu_km"), (("fire station",), "fire_km"), (("fire",), "fire_km"),
    (("flood",), "flood"), (("landslide",), "landslide"),
]


_DESC_WORDS = ("highest", "most", "top", "worst", "greatest", "largest", "biggest", "farthest", "furthest", "longest", "higher")
_ASC_WORDS = ("lowest", "least", "smallest", "fewest", "best", "closest", "nearest", "shortest", "lower")
_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                 "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "twenty": 20}
_MIX_WORDS = ("combined", "combine", "overall score", "total score", "average of", "sum of", "weighted",
              "add svi", "svi plus", "svi and capacity score", "single score", "one score")

_NEG = r"\b(no|not|never|without|lack|lacks|lacking|missing|did not|didn t|didnt|has not|have not|hasn t|haven t|dont have|don t have|do not have|does not have|doesn t have|doesnt have|zero|none)\b"
_TREND = r"\b(trend|trends|over time|over the years|historical|history|last year|previous year|increase|increased|decrease|decreased|grow|growth|improv\w*|worsen\w*|forecast|predict\w*|next year|since (?:19|20)\d\d|in (?:19|20)(?!23)\d\d)\b"
_WRITE = r"\b(drop|delete|insert|update|alter|truncate|create table|attach|pragma|generate|create|make up|invent|fake)\b"
_RANK_CUE = r"\b(highest|lowest|most|least|top|bottom|worst|best|rank|ranked|ranking|order|sort|sorted|list|show|which|what barangay|greatest|largest|smallest|biggest|fewest|farthest|furthest|closest|nearest|more|fewer|higher|lower)\b"
_RANK_STRICT = r"\b(highest|lowest|most|least|top|bottom|worst|best|rank|ranked|ranking|greatest|largest|smallest|biggest|fewest|farthest|furthest|closest|nearest)\b"
_AGG = r"\b(average|mean|median|total|overall|sum|altogether|in total|whole municipality|municipality wide|all barangays combined|how many)\b"
_EXTRA_LOGIC = r"\b(and also|as well as|but|while|whereas|compared|compare|versus|vs|correlat\w*|relationship|between .* and|both|either|neither|ratio of|difference)\b"

TREND_REFUSAL = (
    "This system holds one CBMS survey snapshot, so it cannot show trends, changes over time or forecasts. "
    "It can rank, filter and compare the 24 barangays as they are in this survey."
)
WRITE_REFUSAL = (
    "Ask the Data is read-only: it can look things up but it can never change, add or delete records. "
    "Data changes are made through Import Data."
)

# ── Fixed questions: normalized text -> plan ────────────────────────────
# Each plan: title, sql, chart (type, x, y), kind (summary style)
_FIXED_RAW = [
    ("List barangays ranked by SVI score from most to least vulnerable.", dict(
        title="All barangays ranked by SVI score",
        sql="SELECT barangay, svi_score, svi_rank, svi_tier FROM vw_barangay_vulnerability ORDER BY svi_rank, barangay",
        chart=("bar", "barangay", "svi_score"), kind="rank", metric="svi_score", direction="desc")),
    ("Which barangays are in the High SVI tier?", dict(
        title="Barangays in the High SVI tier (rank 1-6)",
        sql="SELECT barangay, svi_score, svi_rank, svi_tier FROM vw_barangay_vulnerability WHERE svi_tier = 'High' ORDER BY svi_rank, barangay",
        chart=("bar", "barangay", "svi_score"), kind="list", noun="are in the High SVI tier",
        note="High tier = SVI rank 1-6, the most socially vulnerable quarter of the 24 barangays.")),
    ("Which barangays are in the Low capacity tier?", dict(
        title="Barangays in the Low capacity tier (rank 19-24)",
        sql="SELECT barangay, capacity_score, capacity_rank, capacity_tier FROM vw_barangay_capacity WHERE capacity_tier = 'Low capacity' ORDER BY capacity_rank DESC, barangay",
        chart=("bar", "barangay", "capacity_score"), kind="list", noun="are in the Low capacity tier",
        note="Low capacity = capacity rank 19-24, the six least-equipped barangays (rank 1 is the best equipped).")),
    ("Which barangays are in the High capacity tier?", dict(
        title="Barangays in the High capacity tier (rank 1-6)",
        sql="SELECT barangay, capacity_score, capacity_rank, capacity_tier FROM vw_barangay_capacity WHERE capacity_tier = 'High capacity' ORDER BY capacity_rank, barangay",
        chart=("bar", "barangay", "capacity_score"), kind="list", noun="are in the High capacity tier",
        note="High capacity = capacity rank 1-6, the six best-equipped barangays.")),
    ("Which barangays have more than 50% of households beyond 2km of the RHU?", dict(
        title="Barangays where more than half of households are beyond 2km of the RHU",
        sql="SELECT barangay, rhu_pct_beyond_2km, rhu_households_beyond_2km, svi_rank FROM vw_barangay_vulnerability WHERE rhu_pct_beyond_2km > 50 ORDER BY rhu_pct_beyond_2km DESC, barangay",
        chart=("bar", "barangay", "rhu_pct_beyond_2km"), kind="list", noun="have over 50% of households beyond 2km of the RHU",
        note="Distance is straight-line from each household to the Rural Health Unit. It is one of the 13 SVI indicators.")),
    ("Which barangays have more than 50% of households beyond 2km of the fire station?", dict(
        title="Barangays where more than half of households are beyond 2km of the fire station",
        sql="SELECT barangay, fire_pct_beyond_2km, fire_households_beyond_2km, svi_rank FROM vw_barangay_vulnerability WHERE fire_pct_beyond_2km > 50 ORDER BY fire_pct_beyond_2km DESC, barangay",
        chart=("bar", "barangay", "fire_pct_beyond_2km"), kind="list", noun="have over 50% of households beyond 2km of the fire station",
        note="Distance is straight-line from each household to the fire station. It is one of the 13 SVI indicators.")),
    ("Which barangays have at least 25% of households in a high flood or landslide zone?", dict(
        title="Barangays with significant hazard exposure (25% or more of households)",
        sql="SELECT barangay, flood_high_or_very_high_pct_total AS flood_pct, landslide_moderate_or_high_pct_total AS landslide_pct FROM vw_hazard_exposure WHERE flood_high_or_very_high_pct_total >= 25 OR landslide_moderate_or_high_pct_total >= 25 ORDER BY MAX(flood_high_or_very_high_pct_total, landslide_moderate_or_high_pct_total) DESC, barangay",
        chart=("table", None, None), kind="list", noun="have 25% or more of households in a High/Very-High flood zone or a Moderate/High landslide zone",
        note="Flood and landslide are shown separately and never added together. 25% is the same 'significant exposure' line the Planning page uses.")),
    ("How many households are in high flood and landslide zones?", dict(
        title="Households in high-hazard zones (whole municipality)",
        sql="SELECT SUM(flood_high_or_very_high_households) AS households_in_high_flood_zones, SUM(landslide_moderate_or_high_households) AS households_in_high_landslide_zones, SUM(households) AS total_households FROM vw_hazard_exposure",
        chart=("table", None, None), kind="hazard_total")),
    ("What is the dominant household profile in each barangay?", dict(
        title="Dominant household profile per barangay",
        sql="SELECT barangay, cluster_label AS dominant_profile, pct AS share_of_households_pct FROM vw_household_typology WHERE is_dominant_cluster = 1 ORDER BY barangay",
        chart=("table", None, None), kind="typology",
        note="Household profiles are descriptive groupings from k-modes clustering, not a severity ranking.")),
    ("Which barangays have the highest share of compounded deprivation households?", dict(
        title="Share of households in the 'Compounded deprivation' profile",
        sql="SELECT barangay, pct AS compounded_deprivation_pct FROM vw_household_typology WHERE cluster_id = 4 ORDER BY pct DESC, barangay LIMIT 10",
        chart=("bar", "barangay", "compounded_deprivation_pct"), kind="rank_simple", label="share of households in the Compounded deprivation profile", unit="%", col="compounded_deprivation_pct",
        note="A household profile describes a mix of characteristics. It is not a score and is separate from the three domains.")),
    ("How many households are in each barangay?", dict(
        title="Households per barangay",
        sql="SELECT barangay, households FROM vw_barangay_vulnerability ORDER BY households DESC, barangay",
        chart=("bar", "barangay", "households"), kind="households")),
    ("Which barangays are flagged in all three domains?", dict(
        title="Barangays flagged in all three domains (Top Priority)",
        sql="SELECT barangay, svi_rank, capacity_rank, flood_pct, landslide_pct FROM vw_barangay_priority WHERE domains_flagged = 3 ORDER BY svi_rank, barangay",
        chart=("table", None, None), kind="priority", min_flags=3)),
    ("Which barangays are flagged in two or more domains?", dict(
        title="Barangays flagged in two or more domains (High Priority or above)",
        sql="SELECT barangay, domains_flagged, CASE WHEN svi_flagged = 1 THEN 'Flagged' ELSE '-' END AS svi, CASE WHEN capacity_flagged = 1 THEN 'Flagged' ELSE '-' END AS capacity, CASE WHEN hazard_flagged = 1 THEN 'Flagged' ELSE '-' END AS hazard FROM vw_barangay_priority WHERE domains_flagged >= 2 ORDER BY domains_flagged DESC, svi_rank, barangay",
        chart=("table", None, None), kind="priority", min_flags=2)),
    ("Show each barangay's flag in the three domains.", dict(
        title="Each barangay's flag in the three domains",
        sql="SELECT barangay, domains_flagged, CASE WHEN svi_flagged = 1 THEN 'Flagged' ELSE '-' END AS svi, CASE WHEN capacity_flagged = 1 THEN 'Flagged' ELSE '-' END AS capacity, CASE WHEN hazard_flagged = 1 THEN 'Flagged' ELSE '-' END AS hazard FROM vw_barangay_priority ORDER BY domains_flagged DESC, svi_rank, barangay",
        chart=("table", None, None), kind="priority_all")),
]

PRIORITY_NOTE = (
    "A barangay is flagged in SVI when its SVI rank is 1-12 (High or Moderate-high tier), in Capacity when its "
    "capacity rank is 13-24 (the 12 least equipped), and in Hazard "
    "when 25% or more of its households are in a High/Very-High flood or Moderate/High landslide zone. "
    "The count of flags is not a combined score."
)


# ── text helpers ────────────────────────────────────────────────────────
def normalize(text):
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = t.replace("brgy", "bgy").replace("barangay ", "barangay ")
    t = re.sub(r"[^a-z0-9%+ ]+", " ", t)
    # common abbreviations of barangay names: "Sto. Angel", "Sta. Cruz", "Pob."
    t = re.sub(r"\bsto\b", "santo", t)
    t = re.sub(r"\bsta\b", "santa", t)
    t = re.sub(r"\bsn\b", "san", t)
    return re.sub(r"\s+", " ", t).strip()


def _fmt(v):
    if v is None:
        return "n/a"
    if isinstance(v, float):
        if v.is_integer() and abs(v) < 1e7:
            return f"{int(v):,}"
        return f"{v:,.1f}" if abs(v) < 1000 else f"{v:,.0f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def _join(names):
    names = list(names)
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


_FIXED = {normalize(q): plan for q, plan in _FIXED_RAW}
ALL_QUESTION_TEXTS = [q for g in EXAMPLE_GROUPS for q in g["questions"]]


def suggestions_for(question, limit=4):
    norm = normalize(question)
    pool = {normalize(t): t for t in ALL_QUESTION_TEXTS}
    close = difflib.get_close_matches(norm, list(pool), n=limit, cutoff=0.1)
    return [pool[c] for c in close]


# ── barangay-name detection (against the DB's real names) ───────────────
def _find_barangay(question, barangays):
    """The one barangay a question names, matched on its core name so every
    spelling works: "Bgy. 5 Pob." / "Brgy 5" / "barangay 5" / "poblacion 5",
    "Santo Angel" / "Sto Angel" / "Brgy Sto Angel". None if 0 or 2+ match."""
    q = normalize(question).replace("poblacion", "pob")
    hits = []
    for name in barangays:
        core = normalize(name).replace("poblacion", "pob")
        core = re.sub(r"^(?:bgy|barangay)\s+", "", core)
        core = re.sub(r"\s+pob$", "", core).strip()
        if not core:
            continue
        if core.isdigit():
            if re.search(rf"\b(?:bgy|barangay|pob)\s*{core}\b", q):
                hits.append(name)
        elif re.search(rf"\b{re.escape(core)}\b", q):
            hits.append(name)
    return hits[0] if len(hits) == 1 else None


def _hits(norm):
    """[(score, key)] for every synonym found. Words are matched at a word
    start so "van" does not hit "relevant" and "bus" not "business". A hit
    inside a longer phrase that belongs to another metric is dropped."""
    out = []
    for words, key in _SYNONYMS:
        if all(re.search(rf"\b{re.escape(w)}", norm) for w in words):
            out.append((sum(len(w) for w in words) + 100 * (len(words) - 1), key))
    keys = {k for _, k in out}
    drop = set()
    if "item_hazard_map" in keys:
        drop |= {"flood", "landslide"} if "hazard map" in norm and not re.search(r"\b(flood|landslide) (zone|hazard|exposure|prone|risk)", norm) else set()
    if "item_evac_map" in keys or "item_evac_centre" in keys:
        drop.add("item_lights")
    if "rhu_beyond" in keys or "rhu_beyond_n" in keys:
        drop.add("rhu_km")
    if "fire_beyond" in keys or "fire_beyond_n" in keys:
        drop.add("fire_km")
    if "rhu_beyond_n" in keys:
        drop.add("rhu_beyond")
    if "fire_beyond_n" in keys:
        drop.add("fire_beyond")
    if "flood_n" in keys:
        drop.add("flood")
    if "landslide_n" in keys:
        drop.add("landslide")
    if keys & {k for k in keys if k.startswith("item_")}:
        drop |= {"cap_score"} if not re.search(r"\bcapacity (score|rank|tier)\b", norm) else set()
    if "item_budget" in keys:
        drop |= {"item_drrm_plan"}
    for k in ("pwd_n", "senior_n", "solo_n"):
        if k in keys:
            drop.add(k[:-2] if k != "solo_n" else "solo")
    if "pwd_n" in keys:
        drop.add("pwd")
    if "senior_n" in keys:
        drop.add("senior")
    return [(sc, k) for sc, k in out if k not in drop]


def _find_metric(norm):
    hits = _hits(norm)
    return max(hits)[1] if hits else None


def _matched_keys(norm):
    return {k for _, k in _hits(norm)}


def _distinct_domains(norm):
    return {METRICS[k][5] for k in _matched_keys(norm)}


# ── planning: question -> plan dict (or None) ───────────────────────────
def plan_question(question, barangays):
    """Returns (plan, refusal). plan is None when nothing here can answer it
    (the caller then falls back to Gemini). refusal is a plain-language
    message when the question asks to merge the separate domains, asks for a
    trend the one-survey data cannot show, or asks to change data."""
    norm = normalize(question)
    if not norm:
        return None, None

    if re.search(_WRITE, norm) and re.search(r"\b(table|record|records|row|rows|data|database|household|households|barangay)\b", norm):
        return None, WRITE_REFUSAL
    if re.search(_TREND, norm) and "2023" not in norm:
        return None, TREND_REFUSAL

    mix_verb = re.search(r"\b(average|averaged|averaging|combine|combined|combining|merge|merged|sum|add|adding|plus|weighted|composite|blend|together)\b", norm)
    mix_score = re.search(r"\b(overall|total|combined|single|one|composite) score\b", norm)
    if (mix_verb and len(_distinct_domains(norm)) >= 2) or mix_score:
        return None, (
            "SVI, Barangay Capacity and Hazard Exposure are three separate domains in this system, so they are "
            "never added, averaged or weighted into one score. To see where they overlap, ask "
            "\"Which barangays are flagged in all three domains?\" -- it counts the domains each barangay is flagged in "
            "without merging them."
        )

    if norm in _FIXED:
        return dict(_FIXED[norm], source_text=question), None

    # close paraphrase of a fixed question (typos, small wording changes)
    close = difflib.get_close_matches(norm, list(_FIXED), n=1, cutoff=0.86)
    if close:
        return dict(_FIXED[close[0]], source_text=question), None

    bgy = _find_barangay(question, barangays)

    # "households per barangay" style paraphrases of the household-count question
    if "households" in norm and re.search(r"\b(each|per|every|by)\b", norm) and not _matched_keys(norm):
        return dict(_FIXED[normalize("How many households are in each barangay?")], source_text=question), None

    # more than one domain in a single question -> let the AI planner build
    # separate per-domain columns rather than silently answering only one
    if not bgy and len(_distinct_domains(norm)) >= 2:
        return None, None

    # extra logic the library can't express (two conditions, comparisons,
    # "why") -> the AI planner, which can write a WHERE with AND/OR
    if re.search(_EXTRA_LOGIC, norm) or len(_matched_keys(norm)) >= 2:
        if not (bgy and re.search(r"\b(profile|tell me about|overview|summary|all domains|three domains)\b", norm)):
            return None, None
    if re.search(r"^(why|how come|explain)\b", norm):
        return None, None

    # three-domain profile of one barangay
    if bgy and (re.search(r"\b(profile|tell me about|overview|summary|all domains|three domains)\b", norm)
                or (_find_metric(norm) is None and len(norm.split()) <= 6)):
        return {"kind": "profile", "barangay": bgy, "title": f"Three-domain profile: {bgy}"}, None

    metric = _find_metric(norm)
    if metric is None:
        return None, None
    view, col, label, unit, extra, domain = METRICS[metric]
    item = next((v for k, v in CAPACITY_ITEMS.items() if metric == "item_" + k), None)

    # Barangay Capacity resource item: "which barangays have no ambulance?",
    # "which barangays have a hazard map?", "how many barangays have sirens?"
    if item and not bgy:
        icol, ilabel, ikind = item
        if not re.search(_RANK_CUE, norm) and not re.search(_AGG, norm):
            return None, None
        ranked = re.search(r"\b(most|least|highest|lowest|top|fewest|largest|biggest|smallest|rank|ranked|more than|less than|at least)\b", norm)
        if re.search(_NEG, norm) and not ranked:
            return {
                "kind": "list", "title": f"Barangays with no {ilabel.replace('a ', '', 1).replace('an ', '', 1)}",
                "sql": f"SELECT barangay, {icol}, capacity_score, capacity_rank FROM vw_barangay_capacity WHERE COALESCE({icol}, 0) = 0 ORDER BY capacity_rank DESC, barangay",
                "chart": ("table", None, None),
                "noun": f"have no {ilabel.replace('a ', '', 1).replace('an ', '', 1)} on record",
                "empty": f"All 24 barangays have {ilabel} on record.",
                "note": "From the CBMS barangay record. Capacity rank 1 = best equipped.",
            }, None
        if ikind == "yesno" or (not ranked and re.search(r"\b(which|what|how many) barangays? (has|have|with|got)\b", norm)):
            return {
                "kind": "list", "title": f"Barangays with {ilabel}",
                "sql": f"SELECT barangay, {icol}, capacity_score, capacity_rank FROM vw_barangay_capacity WHERE {icol} > 0 ORDER BY {icol} DESC, capacity_rank, barangay",
                "chart": ("table", None, None) if ikind == "yesno" else ("bar", "barangay", icol),
                "noun": f"have {ilabel} on record",
                "empty": f"No barangay has {ilabel} on record.",
                "note": "From the CBMS barangay record.",
            }, None
        if re.search(r"\b(total|altogether|in total|whole municipality|all barangays|how many) \b", norm + " ") and not ranked and ikind != "yesno":
            return {
                "kind": "aggregate", "title": f"Total {ilabel} across the 24 barangays",
                "sql": f"SELECT SUM({icol}) AS total_{icol}, COUNT(*) AS barangays, SUM(CASE WHEN {icol} > 0 THEN 1 ELSE 0 END) AS barangays_with_any FROM vw_barangay_capacity",
                "chart": ("table", None, None), "agg": "sum", "label": ilabel, "unit": unit, "col": f"total_{icol}",
            }, None

    # average / total across the municipality: "What is the average SVI score?"
    agg = re.search(_AGG, norm)
    if agg and not bgy and not re.search(r"\b(which|what) barangays?\b(?! has the)", norm) and not re.search(_RANK_STRICT, norm):
        word = agg.group(1)
        is_avg = word in ("average", "mean", "median")
        fn = "AVG" if is_avg else "SUM"
        if fn == "SUM" and (unit in ("%", " km") or col in ("svi_score", "capacity_score")):
            fn = "AVG"   # a total of percentages / scores is meaningless
        if word == "how many" and unit != "" and unit != " PHP":
            return None, None
        out_col = ("average_" if fn == "AVG" else "total_") + col
        return {
            "kind": "aggregate", "title": f"{'Average' if fn == 'AVG' else 'Total'} {label} across the 24 barangays",
            "sql": f"SELECT ROUND({fn}({col}), 2) AS {out_col}, MIN({col}) AS lowest, MAX({col}) AS highest, COUNT(*) AS barangays FROM {view}",
            "chart": ("table", None, None), "agg": fn.lower(), "label": label, "unit": unit, "col": out_col,
            "note": ("This is the plain average of the 24 barangay values (each barangay counts once)." if fn == "AVG" else ""),
        }, None

    # nothing that says rank / list / which -> don't guess a ranking
    if not bgy and not re.search(_RANK_CUE, norm):
        return None, None

    # single barangay value lookup: "What is the SVI score of Santo Nino?"
    if bgy:
        cols = list(dict.fromkeys(["barangay", col] + extra))
        return {
            "kind": "lookup", "metric": metric, "barangay": bgy,
            "title": f"{bgy}: {label}",
            "sql": f"SELECT {', '.join(cols)} FROM {view} WHERE barangay = ?",
            "params": (bgy,), "chart": ("table", None, None),
        }, None

    # threshold filter: "more than 40% ...", "at least 25% ...", "below 5% ..."
    m = re.search(r"\b(more than|over|above|greater than|at least|less than|below|under|at most)\s*(\d+(?:\.\d+)?)\s*(?:%|percent)", norm)
    if m and unit == "%":
        phrase, value = m.group(1), float(m.group(2))
        op = {"more than": ">", "over": ">", "above": ">", "greater than": ">", "at least": ">=",
              "less than": "<", "below": "<", "under": "<", "at most": "<="}[phrase]
        order = "DESC" if op in (">", ">=") else "ASC"
        cols = ["barangay", col] + extra
        val_txt = f"{value:g}"
        return {
            "kind": "list", "title": f"Barangays with {label} {phrase} {val_txt}%",
            "sql": f"SELECT {', '.join(cols)} FROM {view} WHERE {col} {op} {value:g} ORDER BY {col} {order}, barangay",
            "chart": ("bar", "barangay", col),
            "noun": f"have a {label} {phrase} {val_txt}%",
            "note": _domain_caveat(metric),
        }, None

    # ranking ("top N by ...")
    has_asc = any(re.search(rf"\b{w}\b", norm) for w in _ASC_WORDS)
    has_desc = any(re.search(rf"\b{w}\b", norm) for w in _DESC_WORDS)
    direction = "asc" if (has_asc and not has_desc) else "desc"
    # capacity: "biggest gaps" / "weakest" / "least equipped" = LOWEST score
    if metric == "cap_score" and re.search(_GAP_WORDS, norm):
        direction = "desc" if re.search(r"\b(smallest|fewest|least) gaps?\b", norm) else "asc"
    if metric == "cap_score" and re.search(r"\b(best|well|most) equipped\b", norm):
        direction = "desc"

    n = None
    m = re.search(r"\b(\d{1,2})\b", norm)
    if m:
        n = int(m.group(1))
    else:
        for w, v in _NUMBER_WORDS.items():
            if re.search(rf"\b{w}\b", norm):
                n = v
                break
    if n is None:
        if re.search(r"\b(every|all|each|list|ranked|rank)\b", norm):
            n = 24
        elif re.search(r"\bwhich barangay (?:has|is|have)\b", norm):
            n = 1
        else:
            n = 5
    n = max(1, min(n, 24))

    cols = ["barangay", col] + extra
    order = "DESC" if direction == "desc" else "ASC"
    sql = f"SELECT {', '.join(dict.fromkeys(cols))} FROM {view} ORDER BY {col} {order}, barangay LIMIT {n}"
    word = "Highest" if direction == "desc" else "Lowest"
    if n >= 24:
        title = f"All barangays by {label}"
    elif n == 1:
        title = f"{word} barangay by {label}"
    else:
        title = f"{word} {n} barangays by {label}"
    return {
        "kind": "rank", "metric": metric, "direction": direction, "n": n,
        "title": title, "sql": sql, "chart": ("bar", "barangay", col),
    }, None


# ── summaries: deterministic, built only from the returned rows ─────────
def _domain_caveat(metric):
    if metric.startswith("item_"):
        return "Resource counts come from the CBMS barangay record."
    dom = METRICS[metric][5]
    if dom == "svi":
        return "In the SVI domain, rank 1 is the most socially vulnerable barangay."
    if dom == "capacity":
        return "In Barangay Capacity, a higher score means better equipped and rank 1 is the best-equipped barangay (the opposite direction to SVI)."
    return "Flood and landslide exposure are reported separately and are not added together."


def summarize(plan, data):
    out = _summarize(plan, data)
    return out.replace("..", ".") if out else out


def _summarize(plan, data):
    kind = plan["kind"]
    if kind == "profile":
        return None  # profile builds its own per-domain summaries

    if not data:
        if kind in ("list", "priority"):
            if plan.get("empty"):
                return plan["empty"]
            pred = plan.get("noun", "is flagged in that many domains")
            pred = re.sub(r"^are ", "is ", re.sub(r"^have ", "has ", pred))
            return f"No barangay {pred}."
        return "No rows matched this question in the approved analytical views."

    if kind == "rank":
        metric = plan["metric"]
        _, col, label, unit, _, _ = METRICS[metric]
        word = "highest" if plan["direction"] == "desc" else "lowest"
        first = data[0]
        tied = [r["barangay"] for r in data if r[col] == first[col]]
        if len(tied) == len(data) and len(data) > 1:
            s = f"The {len(data)} barangays shown all have the same {label} ({_fmt(first[col])}{unit}), so they tie: {_join(tied)}"
        elif len(tied) > 1:
            s = f"{_join(tied)} tie for the {word} {label} ({_fmt(first[col])}{unit})"
            rest = [r for r in data if r[col] != first[col]][:2]
            if rest:
                s += ", then " + _join(f"{r['barangay']} ({_fmt(r[col])}{unit})" for r in rest)
        else:
            s = f"{first['barangay']} has the {word} {label} ({_fmt(first[col])}{unit})"
            rest = data[1:3]
            if rest:
                s += ", followed by " + _join(f"{r['barangay']} ({_fmt(r[col])}{unit})" for r in rest)
        s += ". " + _domain_caveat(metric)
        return s

    if kind == "lookup":
        r = data[0]
        metric = plan["metric"]
        _, col, label, unit, _, _ = METRICS[metric]
        item = CAPACITY_ITEMS.get(metric[5:]) if metric.startswith("item_") else None
        if item and item[2] == "yesno":
            s = f"{r['barangay']} {'has' if r[col] else 'has no'} {item[1].replace('a ', '', 1).replace('an ', '', 1) if not r[col] else item[1]} on record."
        elif item:
            s = f"{r['barangay']} has {_fmt(r[col] or 0)} {item[1][:-1] if (r[col] or 0) == 1 and item[1].endswith('s') else item[1]} on record." if item[2] != "php" else f"{r['barangay']}'s {item[1]} was {_fmt(r[col])} PHP."
        else:
            s = f"{r['barangay']}'s {label} is {_fmt(r[col])}{unit}."
        if r.get("svi_rank") is not None:
            s += f" It ranks {r['svi_rank']} of 24 in SVI ({r['svi_tier']} tier)."
        if r.get("capacity_rank") is not None:
            s += f" Its capacity rank is {r['capacity_rank']} of 24 ({r['capacity_tier']}; rank 1 = best equipped)."
        return s + " " + _domain_caveat(metric)

    if kind == "list":
        names = [r["barangay"] for r in data]
        pred = plan["noun"]
        if len(names) == 1:
            pred = re.sub(r"^are ", "is ", re.sub(r"^have ", "has ", pred))
        s = f"{len(names)} barangay{'s' if len(names) != 1 else ''} {pred}: {_join(names)}."
        if plan.get("note"):
            s += " " + plan["note"]
        return s

    if kind == "rank_simple":
        col = plan["col"]
        first, rest = data[0], data[1:3]
        s = f"{first['barangay']} has the highest {plan['label']} ({_fmt(first[col])}{plan['unit']})"
        if rest:
            s += ", followed by " + _join(f"{r['barangay']} ({_fmt(r[col])}{plan['unit']})" for r in rest)
        return s + ". " + plan.get("note", "")

    if kind == "aggregate":
        r = data[0]
        v = r.get(plan["col"])
        if plan["agg"] in ("avg",):
            s = f"The average {plan['label']} across the {_fmt(r.get('barangays'))} barangays is {_fmt(v)}{plan['unit']}"
            if r.get("lowest") is not None:
                s += f" (lowest {_fmt(r['lowest'])}{plan['unit']}, highest {_fmt(r['highest'])}{plan['unit']})"
            s += "."
        else:
            s = f"The total {plan['label']} across the {_fmt(r.get('barangays'))} barangays is {_fmt(v)}{plan['unit']}."
            if r.get("barangays_with_any") is not None:
                s += f" {_fmt(r['barangays_with_any'])} barangay(s) have at least one."
        return s + (" " + plan["note"] if plan.get("note") else "")

    if kind == "hazard_total":
        r = data[0]
        return (f"{_fmt(r['households_in_high_flood_zones'])} households sit in High/Very-High flood zones and "
                f"{_fmt(r['households_in_high_landslide_zones'])} in Moderate/High landslide zones, out of "
                f"{_fmt(r['total_households'])} households. The two hazards are counted separately, so a household in both "
                "is counted once under each.")

    if kind == "typology":
        counts = {}
        for r in data:
            counts[r["dominant_profile"]] = counts.get(r["dominant_profile"], 0) + 1
        top = sorted(counts.items(), key=lambda kv: -kv[1])
        s = "; ".join(f"{k}: {v} barangay{'s' if v != 1 else ''}" for k, v in top)
        return f"Dominant profile across the {len(data)} barangays -- {s}. " + plan.get("note", "")

    if kind == "households":
        total = sum(r["households"] or 0 for r in data)
        first = data[0]
        return (f"There are {_fmt(total)} households across {len(data)} barangays. "
                f"{first['barangay']} has the most ({_fmt(first['households'])}).")

    if kind in ("priority", "priority_all"):
        if kind == "priority_all":
            top = [r["barangay"] for r in data if r["domains_flagged"] == 3]
            two = [r["barangay"] for r in data if r["domains_flagged"] == 2]
            s = f"{len(top)} barangay{'s are' if len(top) != 1 else ' is'} flagged in all three domains"
            s += f" ({_join(top)})" if top else ""
            s += f" and {len(two)} in two" + (f" ({_join(two)})" if two else "") + ". "
            return s + PRIORITY_NOTE
        names = [r["barangay"] for r in data]
        label = "all three domains" if plan["min_flags"] == 3 else "two or more domains"
        return f"{len(names)} barangay{'s are' if len(names) != 1 else ' is'} flagged in {label}: {_join(names)}. " + PRIORITY_NOTE

    return None


# ── per-barangay profile: three separate sections ───────────────────────
def profile_queries(barangay):
    """(section title, domain key, sql, params) -- one query per domain, never merged."""
    return [
        ("Social Vulnerability (SVI)", "svi",
         "SELECT svi_score, svi_rank, svi_tier, food_insecure_pct AS food_insecure, senior_pct AS senior, pwd_pct AS pwd, "
         "weak_roof_pct AS weak_roof, overcrowding_pct AS overcrowding, rhu_pct_beyond_2km AS rhu_beyond_2km, fire_pct_beyond_2km AS fire_beyond_2km "
         "FROM vw_barangay_vulnerability WHERE barangay = ?", (barangay,)),
        ("Barangay Capacity", "capacity",
         "SELECT capacity_score AS score, capacity_rank AS rank, capacity_tier AS tier, has_disaster_committee, "
         "has_response_team, has_emergency_hotline, held_preparedness_seminar, has_evacuation_map, has_hazard_map, "
         "ambulances, generators, sirens, two_way_radios, first_aid_kits, schools, evacuation_centres, drrm_expenditure_php "
         "FROM vw_barangay_capacity WHERE barangay = ?", (barangay,)),
        ("Hazard Exposure", "hazard",
         "SELECT households, flood_high_or_very_high_households AS flood_hh, flood_high_or_very_high_pct_total AS flood_pct, "
         "landslide_moderate_or_high_households AS landslide_hh, landslide_moderate_or_high_pct_total AS landslide_pct "
         "FROM vw_hazard_exposure WHERE barangay = ?", (barangay,)),
        ("Household Profile (descriptive)", "typology",
         "SELECT cluster_label AS dominant_profile, pct AS share_of_households_pct FROM vw_household_typology "
         "WHERE barangay = ? AND is_dominant_cluster = 1", (barangay,)),
    ]


def profile_summary(barangay, sections):
    by = {s["domain"]: (s["data"][0] if s["data"] else None) for s in sections}
    parts = []
    v = by.get("svi")
    if v:
        parts.append(f"SVI: rank {v['svi_rank']} of 24 ({v['svi_tier']} tier).")
    c = by.get("capacity")
    if c:
        gaps = [lbl for lbl, k in (("disaster committee", "has_disaster_committee"), ("response team", "has_response_team"),
                                   ("hotline", "has_emergency_hotline"), ("preparedness seminar", "held_preparedness_seminar"),
                                   ("evacuation map", "has_evacuation_map"), ("hazard map", "has_hazard_map"),
                                   ("ambulance", "ambulances"), ("generator", "generators"), ("siren", "sirens"),
                                   ("evacuation centre", "evacuation_centres")) if c.get(k) in (0, 0.0)]
        gap_txt = ("no " + _join(gaps) + " on record") if gaps else "every listed item on record"
        parts.append(f"Capacity: rank {c['rank']} of 24 ({c['tier']}; rank 1 = best equipped), {gap_txt}.")
    h = by.get("hazard")
    if h:
        parts.append(f"Hazard: {_fmt(h['flood_pct'])}% of households in High/Very-High flood zones and "
                     f"{_fmt(h['landslide_pct'])}% in Moderate/High landslide zones.")
    return f"{barangay} -- " + " ".join(parts) + " The three domains are shown separately and are never combined."
