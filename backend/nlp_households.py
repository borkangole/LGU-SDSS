"""
Household and family-network questions for "Ask the Data".

Privacy design (Data Privacy Act)
---------------------------------
Household answers read the production PostgreSQL database (tbl_households,
tbl_individuals, tbl_network_edges) through a READ-ONLY session and are only
served to logged-in users (the /ask route is JWT-protected).

Gemini NEVER receives household or person data. For a free-typed household
question it may be asked ONE thing: which of the fixed question templates
below the text matches, plus simple parameters (barangay, how many, hazard
type...). Only the question text is sent. The query then runs locally and
the summary is written by this module from the returned rows.

Answers identify households ONLY by their household ID (display code, e.g.
"Brgy San Jose - HH23"). No head or member names are ever returned.

Same rules as the rest of the app: flood and landslide exposure are always
shown separately (never added together), and nothing here is a combined
vulnerability score.
"""
import math
import re
import time

import psycopg2
import psycopg2.extras

from config import Config

CACHE_SECONDS = 600
_INSTANCES = []   # every HouseholdData, so a data import can drop their caches


def invalidate_cache():
    """Called after a CBMS import so the next question reads the new data."""
    for inst in _INSTANCES:
        inst._data = None
        inst._at = 0.0
MAX_ROWS = 100
DEFAULT_ROWS = 10

FLOOD_LEVEL = {"Very High": 4, "High": 3, "Moderate": 2, "Low": 1}
LANDSLIDE_LEVEL = {"High": 3, "Moderate": 2, "Low": 1}

CLUSTER_WORDS = [
    (("compounded", "deprivation"), 4),
    (("financially", "excluded"), 3), (("structurally", "insecure"), 3),
    (("senior headed",), 2), (("education gap",), 2),
    (("food insecure otherwise",), 0), (("food insecure profile",), 0),
    (("relatively stable",), 1),
]

CLUSTER_NAMES = {0: "Food-insecure otherwise stable", 1: "Relatively stable", 2: "Senior-headed education gaps",
                 3: "Financially excluded / structurally insecure", 4: "Compounded deprivation"}

# Same facility points and haversine formula as facility_distance.py (the
# pipeline behind the Capacity + Distance domain).
RHU_COORDS = (10.7815, 122.4647)
FIRE_STATION_COORDS = (10.7869, 122.4683)


def _km(lat, lon, target):
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    r = 6371.0088
    la1, lo1, la2, lo2 = map(math.radians, [lat, lon, target[0], target[1]])
    a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _no(v):
    return str(v or "").strip().lower() in ("no", "false", "0", "f", "n")


HOUSEHOLD_GROUP_TITLE = "Households & Family Networks"


# ── helpers ──────────────────────────────────────────────────────────────
def _b(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    return str(v).strip().lower() in ("1", "true", "yes", "y", "t")


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _join(names):
    names = list(names)
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def _flood_high(h):
    return FLOOD_LEVEL.get(h["flood"] or "", 0) >= 3


def _landslide_high(h):
    return LANDSLIDE_LEVEL.get(h["landslide"] or "", 0) >= 2


def _in_high_hazard(h, hz="any"):
    if hz == "flood":
        return _flood_high(h)
    if hz == "landslide":
        return _landslide_high(h)
    return _flood_high(h) or _landslide_high(h)


HZ_ZONE = {"flood": "a High/Very-High flood zone", "landslide": "a Moderate/High landslide zone",
           "any": "a High/Very-High flood zone or a Moderate/High landslide zone"}


def _pl(n, word, plural=None):
    return f"{n:,} {word if n == 1 else (plural or word + 's')}"


# ── data loading (read-only, cached) ─────────────────────────────────────
class HouseholdData:
    """Loads households, members and family-network links once and keeps
    them in memory for CACHE_SECONDS. ~7k households / ~29k people is small,
    and every template then filters in Python, so no SQL is ever built from
    user text."""

    SOURCE_SQL = (
        "-- Household questions are answered from these read-only queries;\n"
        "-- the filtering for each question is done in code, not with SQL built from the question.\n"
        "SELECT h.household_id, COALESCE(h.display_code, h.household_number) AS code, b.barangay_name,\n"
        "       h.flood_exposure, h.landslide_exposure, h.hazard_data_status,\n"
        "       h.typology_cluster_id, h.typology_cluster_label, h.knows_evacuation_location,\n"
        "       h.knows_emergency_hotline, h.is_4ps_beneficiary, h.latitude, h.longitude\n"
        "FROM tbl_households h LEFT JOIN tbl_barangays b ON b.barangay_id = h.barangay_id;\n\n"
        "SELECT person_id, household_id, age, is_pwd, is_senior,   -- no names are read\n"
        "       is_solo_parent, is_household_head, relationship_to_hh, family_id\n"
        "FROM tbl_individuals;\n\n"
        "SELECT source_node, target_node, edge_type FROM tbl_network_edges;"
    )

    def __init__(self, loader=None):
        self._loader = loader or self._load_from_postgres
        self._at = 0.0
        self._data = None
        _INSTANCES.append(self)

    def get(self):
        now = time.time()
        if self._data is None or now - self._at > CACHE_SECONDS:
            self._data = self._build(*self._loader())
            self._at = now
        return self._data

    # Postgres loader -------------------------------------------------------
    @staticmethod
    def _load_from_postgres():
        conn = psycopg2.connect(Config.get_connection_string(), cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            conn.set_session(readonly=True, autocommit=True)
            cur = conn.cursor()

            def cols(table):
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
                return {r["column_name"] for r in cur.fetchall()}

            hcols = cols("tbl_households")
            icols = cols("tbl_individuals")

            def opt(c, table_cols, prefix="h."):
                return f"{prefix}{c}" if c in table_cols else f"NULL AS {c}"

            code = "COALESCE(h.display_code, h.household_number)" if "display_code" in hcols else "h.household_number"
            cur.execute(f"""
                SELECT h.household_id, {code} AS code, b.barangay_name,
                       {opt('flood_exposure', hcols)}, {opt('landslide_exposure', hcols)},
                       {opt('hazard_data_status', hcols)},
                       {opt('typology_cluster_id', hcols)}, {opt('typology_cluster_label', hcols)},
                       {opt('knows_evacuation_location', hcols)}, {opt('knows_emergency_hotline', hcols)},
                       {opt('is_4ps_beneficiary', hcols)}, {opt('latitude', hcols)}, {opt('longitude', hcols)}
                FROM tbl_households h
                LEFT JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
            """)
            households = [dict(r) for r in cur.fetchall()]

            cur.execute(f"""
                SELECT person_id, household_id, age, {opt('is_pwd', icols, '')}, {opt('is_senior', icols, '')},
                       {opt('is_solo_parent', icols, '')}, {opt('is_household_head', icols, '')},
                       {opt('relationship_to_hh', icols, '')}, {opt('family_id', icols, '')}
                FROM tbl_individuals
            """)
            people = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT source_node, target_node, edge_type FROM tbl_network_edges")
            edges = [dict(r) for r in cur.fetchall()]
            return households, people, edges
        finally:
            conn.close()

    # Build per-household facts --------------------------------------------
    @staticmethod
    def _build(households, people, edges):
        by_hh = {}
        for h in households:
            by_hh[h["household_id"]] = {
                "household_id": h["household_id"],
                "code": str(h.get("code") or h["household_id"]),
                "barangay": h.get("barangay_name") or "",
                "flood": h.get("flood_exposure") or None,
                "landslide": h.get("landslide_exposure") or None,
                "hazard_status": h.get("hazard_data_status"),
                "cluster_id": _int(h.get("typology_cluster_id")),
                "cluster": h.get("typology_cluster_label"),
                "knows_evac": h.get("knows_evacuation_location"),
                "knows_hotline": h.get("knows_emergency_hotline"),
                "rhu_km": _km(h.get("latitude"), h.get("longitude"), RHU_COORDS),
                "fire_km": _km(h.get("latitude"), h.get("longitude"), FIRE_STATION_COORDS),
                "is_4ps": _b(h.get("is_4ps_beneficiary")),
                "people": [],
            }

        person_hh = {}
        for p in people:
            h = by_hh.get(p["household_id"])
            if h is None:
                continue
            age = _int(p.get("age"))
            is_pwd = _b(p.get("is_pwd"))
            is_senior = _b(p.get("is_senior")) or (age is not None and age >= 60)
            is_minor = age is not None and age <= 17
            name = f"Person {p['person_id']}"  # names are never loaded
            h["people"].append({
                "person_id": p["person_id"], "name": name, "age": age,
                "is_pwd": is_pwd, "is_senior": is_senior, "is_minor": is_minor,
                "is_solo_parent": _b(p.get("is_solo_parent")),
                "is_head": _b(p.get("is_household_head")),
                "is_dependent": is_minor or is_senior or is_pwd,
                "is_working": age is not None and 18 <= age <= 59 and not is_pwd,
                "relationship": p.get("relationship_to_hh"),
                "family_id": p.get("family_id"),
            })
            person_hh[p["person_id"]] = p["household_id"]

        adj = {}
        edges_by_hh = {}
        for e in edges:
            try:
                s = int(str(e["source_node"]).split(":")[1])
                t = int(str(e["target_node"]).split(":")[1])
            except (IndexError, ValueError):
                continue
            hs, ht = person_hh.get(s), person_hh.get(t)
            if hs is None or hs != ht or s == t:
                continue
            adj.setdefault(s, set()).add(t)
            adj.setdefault(t, set()).add(s)
            edges_by_hh.setdefault(hs, []).append({"source_pid": s, "target_pid": t, "edge_type": e.get("edge_type")})

        for h in by_hh.values():
            ppl = h["people"]
            working_ids = {p["person_id"] for p in ppl if p["is_working"]}
            h["members"] = len(ppl)
            h["minors"] = sum(p["is_minor"] for p in ppl)
            h["seniors"] = sum(p["is_senior"] for p in ppl)
            h["pwd"] = sum(p["is_pwd"] for p in ppl)
            h["solo_parents"] = sum(p["is_solo_parent"] for p in ppl)
            h["working"] = len(working_ids)
            h["dependents"] = sum(p["is_dependent"] for p in ppl)
            h["dependency_ratio"] = round((h["minors"] + h["seniors"]) / h["working"], 2) if h["working"] else None
            unsupported = [p for p in ppl if p["is_dependent"] and not (adj.get(p["person_id"], set()) & working_ids)]
            h["unsupported"] = len(unsupported)
            h["edges"] = edges_by_hh.get(h["household_id"], [])

        barangays = sorted({h["barangay"] for h in by_hh.values() if h["barangay"]})
        return {"households": by_hh, "barangays": barangays}


# ── templates ────────────────────────────────────────────────────────────
TEMPLATES = {
    "hazard_top": "Households most exposed to flood or landslide (optionally only flood or only landslide)",
    "hazard_vulnerable": "Households in a high flood or landslide zone that have senior or PWD members",
    "hazard_no_evac": "Households in a high flood or landslide zone that do not know their evacuation location",
    "no_working_adult": "Households with dependents (minors, seniors, PWD) but no working-age adult (18-59, non-PWD)",
    "unsupported_dependents": "Households where a dependent is not directly linked to any working-age adult in the family network",
    "living_alone": "Seniors or persons with disability living alone (one-member households)",
    "capacity_distance": "Households farthest from help: beyond 2 km of the RHU / fire station, or not knowing the evacuation location or emergency hotline",
    "dependency": "Households with the highest dependency ratio (minors + seniors per working-age adult)",
    "with_members": "Households that have a given type of member (senior, PWD, solo parent) or are 4Ps beneficiaries",
    "count_with": "How many households have a given type of member, or are 4Ps beneficiaries",
    "largest": "Households with the most members",
    "profile": "Households in a given household profile (typology cluster)",
    "household_detail": "Counts for ONE specific household (needs a household code like HH23)",
}


# Names, contact details and made-up records are never produced here.
NAME_REQUEST = re.compile(r"\b(name|names|named|full name|who is|who are|contact|phone|number of (?:the )?head|address|birthday|birth date)\b")
CREATE_REQUEST = re.compile(r"\b(generate|create|make|add|insert|fake|invent|new|sample|dummy|random)\b[^?]*\b(household|households|hh|record|records|person|people|member|members)\b")

NAME_MESSAGE = (
    "Ask the Data never shows names or contact details of household members (Data Privacy Act of 2012). "
    "It answers with household codes and counts only. To see who lives in a household, open it on the "
    "Households page or the Network page, where access is limited to logged-in staff."
)
CREATE_MESSAGE = (
    "Ask the Data only reads the CBMS records; it cannot generate, add or invent households. "
    "To look at a real household, ask for its code and barangay, for example \"Show household HH11 in Consolacion\". "
    "New records are added through Import Data."
)


def household_examples(data):
    """Example chips; the family-network one uses a real household code."""
    qs = [
        "Which 10 households are most exposed to flood or landslide?",
        "Which households in high hazard zones have senior or PWD members?",
        "Which households in high hazard zones don't know their evacuation location?",
        "Which households have dependents but no working-age adult?",
        "Which households have dependents not linked to any working-age adult in their family network?",
        "Which seniors or PWD are living alone?",
        "Which households are farthest from help?",
        "Show household HH11 in Consolacion",
        "Which households have the highest dependency ratio?",
        "How many households have a PWD member?",
    ]
    return {"key": "household", "title": HOUSEHOLD_GROUP_TITLE, "questions": qs}


_HH_WORDS = re.compile(r"\b(household|households|hh|famil(y|ies)|dependents?|caregivers?|members?|living alone|lives alone|live alone|4ps)\b")
_BGY_SUBJECT = re.compile(r"\b(which|what|list|show|rank|top|compare)\b[^?]*\bbarangays\b|\b(each|per|every|by) barangay\b")
_CODE = re.compile(r"\bhh\s*[-#]?\s*(\d{1,5})\b")


_AGG_SUBJECT = re.compile(r"\b(percent|percentage|share|proportion|rate|average|in total|altogether|san miguel|municipality|whole town)\b")
_LIST_HH = re.compile(r"\b(which|list|show|find|name|top|who)\b[^?]*\bhouseholds?\b")


def is_household_question(norm):
    if _CODE.search(norm):
        return True
    # municipality-wide totals / shares are barangay-view questions
    if _AGG_SUBJECT.search(norm) and not _LIST_HH.search(norm):
        return False
    return bool(_HH_WORDS.search(norm)) and not _BGY_SUBJECT.search(norm)


def _count_n(norm, default=DEFAULT_ROWS):
    m = re.search(r"\b(?:top|only|first|list|show|limit)?\s*(\d{1,3})\b(?!\s*%)", norm)
    words = {"five": 5, "ten": 10, "fifteen": 15, "twenty": 20, "three": 3}
    n = int(m.group(1)) if m else next((v for w, v in words.items() if re.search(rf"\b{w}\b", norm)), default)
    return max(1, min(n, MAX_ROWS))


def _member_type(norm):
    has_pwd = re.search(r"\b(pwd|disab)", norm)
    has_sen = re.search(r"\b(senior|elderly|older)", norm)
    if has_pwd and has_sen:
        return "senior_or_pwd"
    if has_pwd:
        return "pwd"
    if re.search(r"\b(senior|elderly|older)", norm):
        return "senior"
    if re.search(r"\bsolo parent", norm):
        return "solo_parent"
    if re.search(r"\b4ps\b", norm):
        return "4ps"
    return None


def _hazard_type(norm):
    f, l = "flood" in norm, "landslide" in norm
    if f and not l:
        return "flood"
    if l and not f:
        return "landslide"
    return "any"


def _cluster(norm):
    for words, cid in CLUSTER_WORDS:
        if all(w in norm for w in words):
            return cid
    return None


def match_template(norm):
    """Keyword routing. Returns (template, params) or (None, {})."""
    p = {"n": _count_n(norm), "member": _member_type(norm), "hazard": _hazard_type(norm), "cluster": _cluster(norm)}
    code = _CODE.search(norm)
    if code:
        return "household_detail", dict(p, code_num=code.group(1))
    hazard = re.search(r"\b(hazard|flood|landslide|exposed|exposure|risk|risky|danger)", norm)
    if re.search(r"evacuat", norm) and re.search(r"\b(know|knows|location|where|aware)\b", norm):
        return "hazard_no_evac", p
    if re.search(r"evacuat|rescue|assist", norm):
        return "hazard_vulnerable", p
    if re.search(r"(living|lives|live) alone|alone", norm):
        return "living_alone", p
    if re.search(r"\b(no|without|lack|zero) (a |any )?(working|adult)", norm):
        return "no_working_adult", p
    if re.search(r"not (directly )?linked|no (direct )?link|unsupported|no caregiver|without (a )?caregiver|not connected", norm):
        return "unsupported_dependents", p
    if re.search(r"capacity|distance|far from|farthest|furthest|nearest|closest|\brhu\b|health unit|fire station|hotline|2 ?km", norm):
        focus = None
        if re.search(r"far|near|close|distance to|km", norm) and not re.search(r"capacity", norm):
            focus = "fire" if "fire" in norm and not re.search(r"\brhu\b|health", norm) else "rhu" if re.search(r"\brhu\b|health", norm) else None
        return "capacity_distance", dict(p, focus=focus)
    if hazard and (p["member"] in ("senior", "pwd", "senior_or_pwd") or "vulnerable member" in norm):
        return "hazard_vulnerable", p
    if hazard:
        return "hazard_top", p
    if "dependen" in norm and "ratio" in norm or "most dependents" in norm:
        return "dependency", p
    if p["cluster"] is not None or re.search(r"\b(profile|cluster|typology)\b", norm):
        return "profile", p
    if re.search(r"\bhow many\b|\bcount\b|\bnumber of\b", norm) and p["member"]:
        return "count_with", p
    if p["member"]:
        return "with_members", p
    if re.search(r"\b(largest|biggest|most members|largest families|big famil)", norm):
        return "largest", p
    return None, {}


ROUTER_SCHEMA = {
    "type": "object",
    "properties": {
        "template": {"type": "string", "enum": list(TEMPLATES) + ["none"]},
        "n": {"type": "integer"},
        "barangay": {"type": "string", "description": "barangay name mentioned in the question, or empty"},
        "hazard": {"type": "string", "enum": ["any", "flood", "landslide"]},
        "member": {"type": "string", "enum": ["none", "senior", "pwd", "solo_parent", "4ps"]},
        "household_code_number": {"type": "string", "description": "digits after HH in a household code, or empty"},
    },
    "required": ["template", "n", "barangay", "hazard", "member", "household_code_number"],
}

ROUTER_INSTRUCTION = (
    "You route a question from a municipal disaster-planning officer to ONE fixed household-level "
    "question template. You never see or produce any data. Pick the template that best matches, or "
    "'none' if nothing fits. Extract only simple parameters from the question text. Templates:\n"
    + "\n".join(f"- {k}: {v}" for k, v in TEMPLATES.items())
)


def route_with_gemini(question, call_gemini):
    plan, err = call_gemini(ROUTER_INSTRUCTION, f"QUESTION: {question}",
                            generation_config={"temperature": 0.0}, response_schema=ROUTER_SCHEMA)
    if err or not plan or plan.get("template") in (None, "none"):
        return None, {}, err
    p = {
        "n": max(1, min(_int(plan.get("n")) or DEFAULT_ROWS, MAX_ROWS)),
        "member": None if plan.get("member") in (None, "none") else plan["member"],
        "hazard": plan.get("hazard") or "any",
        "cluster": None,
        "barangay_text": plan.get("barangay") or "",
    }
    if plan.get("household_code_number"):
        p["code_num"] = re.sub(r"\D", "", plan["household_code_number"])
    return plan["template"], p, None


# ── execution ────────────────────────────────────────────────────────────
MEMBER_LABEL = {"senior": "senior citizen", "pwd": "person with disability (PWD)", "solo_parent": "solo parent", "4ps": "4Ps"}


def _member_count(h, member):
    return {"senior": h["seniors"], "pwd": h["pwd"], "solo_parent": h["solo_parents"],
            "4ps": 1 if h["is_4ps"] else 0}.get(member, 0)


def _cap_gaps(h):
    """Household-level Capacity + Distance gaps (count 0-4, same domain only):
    beyond 2km of the RHU, beyond 2km of the fire station, does not know the
    evacuation location, does not know the emergency hotline."""
    return sum([
        (h["rhu_km"] or 0) > 2, (h["fire_km"] or 0) > 2, _no(h["knows_evac"]), _no(h["knows_hotline"]),
    ])


def _row(h, *extra):
    base = {"household_id": h["code"], "barangay": h["barangay"]}
    for k in extra:
        base[k] = {
            "members": h["members"], "seniors": h["seniors"], "pwd": h["pwd"], "minors": h["minors"],
            "working_age": h["working"], "dependents": h["dependents"],
            "flood": h["flood"] or "Not in mapped zone", "landslide": h["landslide"] or "Not in mapped zone",
            "dependency_ratio": h["dependency_ratio"] if h["dependency_ratio"] is not None else "no working adult",
            "dependents_not_linked": h["unsupported"], "profile": h["cluster"] or "-",
            "knows_evacuation": h["knows_evac"] or "-", "solo_parents": h["solo_parents"],
            "is_4ps": "Yes" if h["is_4ps"] else "No",
            "rhu_km": round(h["rhu_km"], 2) if h["rhu_km"] is not None else "-",
            "fire_km": round(h["fire_km"], 2) if h["fire_km"] is not None else "-",
            "knows_hotline": h["knows_hotline"] or "-",
            "gaps": _cap_gaps(h),
        }[k]
    return base


def _where(bgy):
    return f" in {bgy}" if bgy else ""


def run_template(template, params, data, barangay=None):
    """Returns dict(title, columns, data, explanation, sections, warnings)."""
    hhs = [h for h in data["households"].values() if not barangay or h["barangay"] == barangay]
    n = params.get("n") or DEFAULT_ROWS
    out = {"title": None, "columns": [], "data": [], "explanation": None, "sections": [], "warnings": []}
    w = _where(barangay)

    def finish(title, rows, expl):
        out["title"] = title
        out["data"] = rows
        out["columns"] = list(rows[0].keys()) if rows else []
        out["explanation"] = expl
        return out

    if template == "hazard_top":
        hz = params.get("hazard", "any")
        def key(h):
            f, l = FLOOD_LEVEL.get(h["flood"] or "", 0), LANDSLIDE_LEVEL.get(h["landslide"] or "", 0)
            if hz == "flood":
                return (f, h["dependents"], h["members"])
            if hz == "landslide":
                return (l, h["dependents"], h["members"])
            # "any": level relative to each scale's own top band, never added together
            return (max(f / 4, l / 3), min(f / 4, l / 3), h["dependents"], h["members"])
        pool = [h for h in hhs if (FLOOD_LEVEL.get(h["flood"] or "", 0) if hz == "flood" else
                                   LANDSLIDE_LEVEL.get(h["landslide"] or "", 0) if hz == "landslide" else
                                   FLOOD_LEVEL.get(h["flood"] or "", 0) + LANDSLIDE_LEVEL.get(h["landslide"] or "", 0)) > 0]
        top = sorted(pool, key=key, reverse=True)[:n]
        rows = [_row(h, "flood", "landslide", "members", "dependents") for h in top]
        which = {"flood": "flood", "landslide": "landslide", "any": "flood or landslide"}[hz]
        high = sum(1 for h in hhs if (_flood_high(h) if hz == "flood" else _landslide_high(h) if hz == "landslide" else _in_high_hazard(h)))
        expl = (f"{high:,} households{w} are in a High/Very-High flood zone" if hz == "flood" else
                f"{high:,} households{w} are in a Moderate/High landslide zone" if hz == "landslide" else
                f"{high:,} households{w} are in a High/Very-High flood zone or a Moderate/High landslide zone")
        expl += (f". The {len(rows)} shown are the most exposed, with households that have more dependents listed first "
                 "when exposure is equal. Flood and landslide are shown separately and never added together.")
        return finish(f"Top {len(rows)} households{w} by {which} exposure", rows, expl)

    if template == "hazard_vulnerable":
        m = params.get("member")
        hz = params.get("hazard", "any")
        def cnt(h):
            return h["seniors"] if m == "senior" else h["pwd"] if m == "pwd" else h["seniors"] + h["pwd"]
        pool = [h for h in hhs if _in_high_hazard(h, hz) and cnt(h) > 0]
        pool.sort(key=lambda h: (cnt(h), h["members"]), reverse=True)
        rows = [_row(h, "flood", "landslide", "seniors", "pwd", "members") for h in pool[:n]]
        who = {"senior": "senior", "pwd": "PWD"}.get(m, "senior or PWD")
        expl = (f"{_pl(len(pool), 'household')}{w} {'is' if len(pool) == 1 else 'are'} in {HZ_ZONE[hz]} and have at least one "
                f"{who} member, so they are likely to need assisted evacuation. Showing {len(rows)}, most {who} members first.")
        return finish(f"High-hazard households{w} with {who} members", rows, expl)

    if template == "hazard_no_evac":
        hz = params.get("hazard", "any")
        pool = [h for h in hhs if _in_high_hazard(h, hz) and str(h["knows_evac"] or "").strip().lower() in ("no", "false", "0")]
        pool.sort(key=lambda h: (h["dependents"], h["members"]), reverse=True)
        rows = [_row(h, "flood", "landslide", "members", "dependents") for h in pool[:n]]
        expl = (f"{_pl(len(pool), 'household')}{w} in {HZ_ZONE[hz]} said they do not know where to evacuate. "
                f"Showing {len(rows)}, most dependents first. These are a direct target for evacuation-route information drives.")
        return finish(f"High-hazard households{w} that don't know their evacuation location", rows, expl)

    if template == "no_working_adult":
        pool = [h for h in hhs if h["dependents"] > 0 and h["working"] == 0 and h["members"] > 1]
        pool.sort(key=lambda h: (h["dependents"], h["members"]), reverse=True)
        rows = [_row(h, "members", "minors", "seniors", "pwd", "flood", "landslide") for h in pool[:n]]
        in_hz = sum(1 for h in pool if _in_high_hazard(h))
        expl = (f"{len(pool):,} multi-member households{w} have dependents but no working-age adult (18-59, non-PWD); "
                f"{in_hz:,} of them are also in a high flood or landslide zone. Single-member households are covered by "
                f"'living alone'. Showing {len(rows)}.")
        return finish(f"Households{w} with dependents but no working-age adult", rows, expl)

    if template == "unsupported_dependents":
        pool = [h for h in hhs if h["unsupported"] > 0 and h["members"] > 1]
        pool.sort(key=lambda h: (h["unsupported"], h["dependents"]), reverse=True)
        rows = []
        for h in pool[:n]:
            rows.append(_row(h, "dependents_not_linked", "members", "working_age", "flood", "landslide"))
        expl = (f"{len(pool):,} households{w} have at least one minor, senior or PWD who is not directly linked to a "
                "working-age adult in the recorded family network, so no obvious helper during evacuation. "
                f"Showing {len(rows)}. Open the household on the Network page to see its full family graph.")
        return finish(f"Households{w} with dependents not linked to a working-age adult", rows, expl)

    if template == "living_alone":
        m = params.get("member")
        pool = [h for h in hhs if h["members"] == 1 and (h["seniors"] if m == "senior" else h["pwd"] if m == "pwd" else h["seniors"] + h["pwd"]) > 0]
        m = m if m in ("senior", "pwd") else None
        pool.sort(key=lambda h: (_in_high_hazard(h), h["people"][0]["age"] or 0), reverse=True)
        rows = []
        for h in pool[:n]:
            r = _row(h, "flood", "landslide")
            r["age"] = h["people"][0]["age"]
            r["pwd"] = "Yes" if h["pwd"] else "No"
            rows.append(r)
        in_hz = sum(1 for h in pool if _in_high_hazard(h))
        who = {"senior": "seniors", "pwd": "persons with disability"}.get(m, "seniors or persons with disability")
        expl = (f"{len(pool):,} {who}{w} live alone; {in_hz:,} of them are in a high flood or landslide zone and are "
                f"listed first. Showing {len(rows)}.")
        return finish(f"{who[0].upper() + who[1:]}{w} living alone", rows, expl)

    if template == "capacity_distance":
        pool = [h for h in hhs if h["rhu_km"] is not None or h["knows_evac"] or h["knows_hotline"]]
        focus = params.get("focus")
        if focus in ("rhu", "fire"):
            key = "rhu_km" if focus == "rhu" else "fire_km"
            pool.sort(key=lambda h: h[key] or 0, reverse=True)
            rows = [_row(h, key, "gaps", "knows_evacuation", "knows_hotline", "members") for h in pool[:n]]
            place = "the RHU" if focus == "rhu" else "the fire station"
            far = sum(1 for h in hhs if (h[key] or 0) > 2)
            return finish(f"Top {len(rows)} households{w} farthest from {place}", rows,
                          f"{far:,} households{w} are more than 2km (straight-line) from {place}. "
                          f"Showing the {len(rows)} farthest, with their other access gaps.")
        pool.sort(key=lambda h: (_cap_gaps(h), max(h["rhu_km"] or 0, h["fire_km"] or 0)), reverse=True)
        rows = [_row(h, "gaps", "rhu_km", "fire_km", "knows_evacuation", "knows_hotline", "members") for h in pool[:n]]
        beyond = sum(1 for h in hhs if (h["rhu_km"] or 0) > 2 or (h["fire_km"] or 0) > 2)
        expl = (f"Households{w} are ranked by four access gaps: "
                "beyond 2km of the RHU, beyond 2km of the fire station, not knowing the evacuation location, and not knowing "
                f"the emergency hotline (0-4 gaps; farther households first on ties). {beyond:,} households{w} are beyond 2km "
                "of the RHU or the fire station. Distances are straight-line, same method as the SVI distance indicators. "
                "This is a household view; Barangay Capacity itself is scored per barangay from its resources.")
        return finish(f"Top {len(rows)} households{w} farthest from help", rows, expl)

    if template == "dependency":
        pool = [h for h in hhs if h["working"] > 0 and h["minors"] + h["seniors"] > 0]
        pool.sort(key=lambda h: (h["dependency_ratio"], h["dependents"]), reverse=True)
        rows = [_row(h, "dependency_ratio", "minors", "seniors", "working_age", "members") for h in pool[:n]]
        none_adult = sum(1 for h in hhs if h["working"] == 0 and h["dependents"] > 0)
        expl = (f"Dependency ratio = (minors + seniors) per working-age adult. {rows[0]['household_id'] if rows else '-'} is highest"
                f"{' at ' + str(rows[0]['dependency_ratio']) if rows else ''}. {none_adult:,} more households{w} have no working-age "
                "adult at all (ask 'households with dependents but no working-age adult').")
        return finish(f"Households{w} with the highest dependency ratio", rows, expl)

    if template in ("with_members", "count_with"):
        m = params.get("member") or "senior"
        if m == "senior_or_pwd":
            m = "senior"
        pool = [h for h in hhs if _member_count(h, m) > 0]
        label = MEMBER_LABEL[m]
        if template == "count_with":
            by_bgy = {}
            for h in pool:
                by_bgy[h["barangay"]] = by_bgy.get(h["barangay"], 0) + 1
            rows = [{"barangay": b, "households": c, "share_of_households_pct": round(100 * c / max(1, sum(1 for h in hhs if h["barangay"] == b)), 1)}
                    for b, c in sorted(by_bgy.items(), key=lambda kv: -kv[1])]
            what = "are 4Ps beneficiaries" if m == "4ps" else f"have at least one {label} member"
            expl = f"{len(pool):,} of {len(hhs):,} households{w} {what}."
            return finish(f"Households{w} that {what}", rows, expl)
        pool.sort(key=lambda h: (_member_count(h, m), _in_high_hazard(h), h["members"]), reverse=True)
        extra = {"senior": "seniors", "pwd": "pwd", "solo_parent": "solo_parents", "4ps": "is_4ps"}[m]
        rows = [_row(h, extra, "members", "flood", "landslide") for h in pool[:n]]
        what = "4Ps beneficiary households" if m == "4ps" else f"households with {label} members"
        expl = f"{len(pool):,} {what}{w}. Showing {len(rows)}, most such members first (high-hazard households first on ties)."
        return finish(f"{what[0].upper() + what[1:]}{w}", rows, expl)

    if template == "largest":
        pool = sorted(hhs, key=lambda h: (h["members"], h["dependents"]), reverse=True)
        rows = [_row(h, "members", "minors", "seniors", "pwd", "working_age") for h in pool[:n]]
        expl = f"The largest household{w} has {rows[0]['members']} members." if rows else None
        return finish(f"Largest households{w}", rows, expl)

    if template == "profile":
        cid = params.get("cluster")
        if cid is None:
            counts = {}
            for h in hhs:
                counts[h["cluster"] or "Not assigned"] = counts.get(h["cluster"] or "Not assigned", 0) + 1
            rows = [{"profile": k, "households": v, "share_pct": round(100 * v / max(1, len(hhs)), 1)}
                    for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]
            return finish(f"Household profiles{w}", rows,
                          "Household profiles are descriptive groupings from k-modes clustering, not a severity ranking.")
        pool = [h for h in hhs if h["cluster_id"] == cid]
        pool.sort(key=lambda h: (_in_high_hazard(h), h["dependents"]), reverse=True)
        rows = [_row(h, "profile", "members", "dependents", "flood", "landslide") for h in pool[:n]]
        name = (pool[0]["cluster"] if pool and pool[0]["cluster"] else CLUSTER_NAMES.get(cid, "this profile"))
        expl = (f"{len(pool):,} households{w} are in the '{name}' profile. Showing {len(rows)}, high-hazard households first. "
                "A profile is a descriptive grouping, not a score.")
        return finish(f"Households{w} in the '{name}' profile", rows, expl)

    if template == "household_detail":
        return _household_detail(params, data, barangay, out)

    out["warnings"].append("That household question type isn't supported yet.")
    return out


def _household_detail(params, data, barangay, out):
    num = params.get("code_num")
    cands = [h for h in data["households"].values()
             if num and re.search(rf"hh\s*-?\s*0*{int(num)}$", h["code"].lower())
             and (not barangay or h["barangay"] == barangay)]
    if not cands:
        out["title"] = "Household not found"
        out["warnings"].append(f"No household with code HH{num}{_where(barangay)} was found. Copy the code exactly as it appears on the Households page.")
        return out
    if len(cands) > 1:
        out["title"] = f"{len(cands)} households have the code HH{num}"
        out["warnings"].append("Household numbers restart in each barangay, so please include the barangay, e.g. "
                               f"\"Show the family network of household HH{num} in {cands[0]['barangay']}\".")
        rows = [_row(h, "members") for h in cands[:MAX_ROWS]]
        out["data"], out["columns"] = rows, list(rows[0].keys())
        return out

    h = cands[0]
    # Counts only -- no member or head names are returned (Data Privacy Act).
    # Staff open the household on the Households / Network page for names.
    row = _row(h, "members", "minors", "seniors", "pwd", "working_age", "dependents",
               "dependents_not_linked", "flood", "landslide", "profile", "knows_evacuation")
    out["title"] = f"Household {h['code']}"
    out["data"], out["columns"] = [row], list(row.keys())
    parts = [f"{_pl(h['members'], 'member')}", f"{_pl(h['dependents'], 'dependent')} and {_pl(h['working'], 'working-age adult')}"]
    if h["unsupported"]:
        parts.append(f"{_pl(h['unsupported'], 'dependent')} not directly linked to a working-age adult in the family network")
    out["explanation"] = ("; ".join(parts) + f". Flood: {h['flood'] or 'not in a mapped zone'}; landslide: "
                          f"{h['landslide'] or 'not in a mapped zone'}. Open this household on the Network page for the full family graph.")
    return out
