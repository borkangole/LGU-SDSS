from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required
from datetime import timedelta
import os
import json
import psycopg2
import psycopg2.extras

from config import Config
from routes.barangay_routes import barangay_bp
from routes.household_routes import household_bp
from routes.individual_routes import individual_bp
from routes.auth_routes import auth_bp
from routes.search_routes import search_bp  # ✅ add here
from routes.domain_vulnerability_routes import domain_vuln_bp  # Sir Shem's two-domain model (SVI + capacity + hazard)
from routes.nlp_query_routes import nlp_query_bp  # Sir Shem's NLP-to-DB constrained query layer
from routes.cbms_import_routes import cbms_import_bp  # one-step import of the 7 CBMS 2024 files
from models.individual import (
    get_individual_by_id,
    update_individual,
    delete_individual,
)
from validators.mdm_validator import validate_individual, validation_error_response




# ── App setup ─────────────────────────────────────────────────
app = Flask(__name__)
app.url_map.strict_slashes = False

CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
    supports_credentials=False,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        resp = app.make_default_options_response()
        h = resp.headers
        h["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
        h["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        h["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        return resp

# ── JWT Configuration ─────────────────────────────────────────
app.config["JWT_SECRET_KEY"] = os.environ.get(
    "JWT_SECRET_KEY", "lgu-mdm-super-secret-key-change-in-production-2024"
)
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=8)
app.config["JWT_TOKEN_LOCATION"] = ["headers"]
app.config["JWT_HEADER_NAME"] = "Authorization"
app.config["JWT_HEADER_TYPE"] = "Bearer"

jwt = JWTManager(app)

# ── JWT error handlers ────────────────────────────────────────
@jwt.unauthorized_loader
def unauthorized_callback(reason):
    return jsonify({"error": "Missing or invalid token.", "reason": reason}), 401


@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return jsonify({"error": "Session expired. Please log in again."}), 401


@jwt.invalid_token_loader
def invalid_token_callback(reason):
    return jsonify({"error": "Invalid token.", "reason": reason}), 401


# ── Register Blueprints ───────────────────────────────────────
app.register_blueprint(auth_bp, url_prefix="/api/auth")
app.register_blueprint(barangay_bp, url_prefix="/api/barangays")
app.register_blueprint(household_bp, url_prefix="/api/households")
app.register_blueprint(individual_bp, url_prefix="/api/households")
app.register_blueprint(search_bp,     url_prefix="/api")  # ✅ add here
app.register_blueprint(domain_vuln_bp, url_prefix="/api/domain-vulnerability")  # Sir Shem's two-domain model
from routes.population_routes import population_bp
app.register_blueprint(population_bp, url_prefix="/api/population")  # population summary + attributes catalogue
app.register_blueprint(nlp_query_bp, url_prefix="/api/nlp-query")  # Sir Shem's NLP-to-DB constrained query layer
app.register_blueprint(cbms_import_bp, url_prefix="/api/import/cbms")  # 7-file CBMS 2024 import
from routes.settings_routes import settings_bp
app.register_blueprint(settings_bp, url_prefix="/api/settings")  # Gemini API key from Account Settings

# ── Keep stored typology names in step with the cluster definitions ──
# tbl_households.typology_cluster_label is a stored copy of the name of each
# household's k-modes cluster. Older backfills wrote an earlier naming, so the
# stored names could disagree with the cluster ids (and with the maps, which
# read the analysis files). On start-up, re-derive every name from its
# cluster id using typology_reference_k5.json -- the same names the CBMS
# import writes. Only rows whose name differs are touched; safe to repeat.
def _sync_typology_labels():
    ref_path = os.path.join(os.path.dirname(__file__), "typology_reference_k5.json")
    try:
        with open(ref_path, encoding="utf-8") as f:
            labels = {int(k): v for k, v in json.load(f)["labels"].items()}
        conn = psycopg2.connect(Config.get_connection_string())
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'tbl_households' AND column_name = 'typology_cluster_label'"
                )
                if not cur.fetchone():
                    return
                fixed = 0
                for cid, label in labels.items():
                    cur.execute(
                        "UPDATE tbl_households SET typology_cluster_label = %s "
                        "WHERE typology_cluster_id = %s "
                        "AND typology_cluster_label IS DISTINCT FROM %s",
                        (label, cid, label),
                    )
                    fixed += cur.rowcount
            if fixed:
                print(f"[typology] corrected {fixed} stored cluster names to match the cluster ids")
        finally:
            conn.close()
    except Exception as e:  # never block start-up over this
        print(f"[typology] label check skipped: {e}")


_sync_typology_labels()

# ── GeoJSON folder path ───────────────────────────────────────
GEOJSON_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "geojson")

# The 13 k-modes typology indicators (sanmiguel_student/config.py's
# TYPOLOGY_FEATURES) -- hoisted to module level since both the Cluster
# Profile & Attribute Matching computation and the Household Similarity
# Network computation compare households on this same feature set.
TYPOLOGY_INDICATOR_KEYS = [
    "ti_overcrowding", "ti_food_insecure", "ti_no_internet", "ti_weak_roof",
    "ti_weak_wall", "ti_insecure_tenure", "ti_unimproved_sanitation",
    "ti_low_adult_education_hh", "ti_large_household", "ti_financially_excluded",
    "ti_pwd_count_cat", "ti_senior_count_cat", "ti_solo_parent_count_cat",
]


# ── Read the classification breakpoints stored by the last full
# compute_vulnerability.py run. Single-household code paths (this
# file) use these so a household classifies the SAME way whether
# it's looked up individually or shown as part of the batch-computed
# dashboard/map -- without this, single lookups would fall back to
# vulnerability_engine.py's fixed default thresholds, which don't
# match this dataset's real distribution and would silently disagree
# with what the batch run classified the same household as.
def get_classification_breaks():
    try:
        conn = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT low_max, moderate_max, high_max FROM tbl_vuln_classification_breaks WHERE id = 1"
        )
        row = cur.fetchone()
        conn.close()
        if row:
            return {
                "low_max": float(row["low_max"]),
                "moderate_max": float(row["moderate_max"]),
                "high_max": float(row["high_max"]),
            }
    except Exception:
        import traceback
        print("⚠️ Could not load classification breakpoints (falling back to defaults):")
        traceback.print_exc()
    return None  # vulnerability_engine.py's classify_bvi()/classify_resilience() fall back to their own defaults


# ── Auto-compute vulnerability for a single household ─────────
def compute_single_household(household_id):
    try:
        import sys

        engine_path = os.path.dirname(os.path.abspath(__file__))
        if engine_path not in sys.path:
            sys.path.insert(0, engine_path)

        from vulnerability_engine import compute_scores

        conn = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur = conn.cursor()
        cur.execute(
            """
            SELECT h.*, b.barangay_name
            FROM tbl_households h
            JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
            WHERE h.household_id = %s
            """,
            (household_id,),
        )
        hh = cur.fetchone()
        conn.close()
        if not hh:
            return

        # ── Hazard exposure detection (spatial, derived from coordinates) ──
        # Runs before compute_scores() so the vulnerability formula's
        # exposure component (which reads hazard_exposure_score) sees the
        # freshly-computed value, not a stale one from the CSV/prior state.
        try:
            from hazard_engine import detect_hazard_exposure
            hazard = detect_hazard_exposure(hh.get("longitude"), hh.get("latitude"))

            conn_hz = psycopg2.connect(Config.get_connection_string())
            cur_hz  = conn_hz.cursor()
            cur_hz.execute("""
                UPDATE tbl_households SET
                    flood_exposure        = %(flood_exposure)s,
                    landslide_exposure    = %(landslide_exposure)s,
                    hazard_exposure_score = %(hazard_exposure_score)s,
                    compound_hazard       = %(compound_hazard)s,
                    hazard_data_status    = %(hazard_data_status)s
                WHERE household_id = %(household_id)s
            """, {**hazard, "household_id": household_id})
            conn_hz.commit()
            conn_hz.close()

            hh = dict(hh)
            hh.update(hazard)
            print(f"🌊 Hazard exposure computed for HH {household_id}: "
                  f"score={hazard['hazard_exposure_score']}, status={hazard['hazard_data_status']}")
        except Exception:
            import traceback
            print(f"⚠️ Hazard detection FAILED for HH {household_id} (continuing with existing values):")
            traceback.print_exc()

        # NOTE: compute_scores() now takes only the household dict --
        # pwd_count/senior_count/solo_parent_count/etc. come pre-
        # aggregated on tbl_households, no per-member query needed.
        # breaks= keeps this household's category consistent with
        # the batch dashboard/map (see get_classification_breaks()).
        breaks = get_classification_breaks()
        scores = compute_scores(dict(hh), breaks)

        # ✅ FIX: was missing cur2 = conn2.cursor()
        conn2 = psycopg2.connect(Config.get_connection_string())
        cur2  = conn2.cursor()   # ← THIS LINE WAS MISSING
        cur2.execute("""
            INSERT INTO tbl_vulnerability_index (
                household_id,
                barangay_id,
                exposure_score,          sensitivity_score,
                adaptive_capacity_score,
                vuln_score,              vuln_category,
                resil_score,             resil_category,
                total_members,           pwd_count,
                senior_count,            solo_parent_count
            ) VALUES (
                %(household_id)s,
                %(barangay_id)s,
                %(exposure_score)s,      %(sensitivity_score)s,
                %(adaptive_capacity_score)s,
                %(vuln_score)s,          %(vuln_category)s,
                %(resil_score)s,         %(resil_category)s,
                %(total_members)s,       %(pwd_count)s,
                %(senior_count)s,        %(solo_parent_count)s
            )
            ON CONFLICT (household_id) DO UPDATE SET
                exposure_score          = EXCLUDED.exposure_score,
                sensitivity_score       = EXCLUDED.sensitivity_score,
                adaptive_capacity_score = EXCLUDED.adaptive_capacity_score,
                vuln_score              = EXCLUDED.vuln_score,
                vuln_category           = EXCLUDED.vuln_category,
                resil_score             = EXCLUDED.resil_score,
                resil_category          = EXCLUDED.resil_category,
                total_members           = EXCLUDED.total_members,
                pwd_count               = EXCLUDED.pwd_count,
                senior_count            = EXCLUDED.senior_count,
                solo_parent_count       = EXCLUDED.solo_parent_count
        """, {
            "household_id": household_id,
            "barangay_id":  hh.get("barangay_id"),
            **scores
        })
        conn2.commit()
        conn2.close()
        print(f"✅ Scores saved for household {household_id}")

    except Exception:
        import traceback
        print(f"❌ Auto-compute FAILED for HH {household_id}:")
        traceback.print_exc()


# ── Helper ────────────────────────────────────────────────────
def get_household_id_for_person(person_id):
    try:
        conn = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT household_id FROM tbl_individuals WHERE person_id = %s",
            (person_id,),
        )
        row = cur.fetchone()
        conn.close()
        return row["household_id"] if row else None
    except Exception:
        return None


# ── Individual standalone routes ──────────────────────────────
@app.route("/api/individuals/<int:person_id>", methods=["GET"])
@jwt_required()
def get_person(person_id):
    result = get_individual_by_id(person_id)
    if not result:
        return jsonify({"error": "Individual not found"}), 404
    return jsonify(result), 200


@app.route("/api/individuals/<int:person_id>", methods=["PUT"])
@jwt_required()
def edit_person(person_id):
    household_id = get_household_id_for_person(person_id)
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    is_valid, errors = validate_individual(data)
    if not is_valid:
        return jsonify(validation_error_response(errors)), 422
    result = update_individual(person_id, data)
    if "error" in result:
        return jsonify(result), 404
    if household_id:
        compute_single_household(household_id)
    return jsonify(result), 200


@app.route("/api/individuals/<int:person_id>", methods=["DELETE"])
@jwt_required()
def remove_person(person_id):
    household_id = get_household_id_for_person(person_id)
    result = delete_individual(person_id)
    if "error" in result:
        return jsonify(result), 404
    if household_id:
        compute_single_household(household_id)
    return jsonify(result), 200


# ── Stats ─────────────────────────────────────────────────────
@app.route("/api/stats", methods=["GET"])
@jwt_required()
def stats():
    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS total FROM tbl_barangays")
    barangays = cur.fetchone()["total"]
    cur.execute("SELECT COUNT(*) AS total FROM tbl_households")
    households = cur.fetchone()["total"]
    cur.execute("SELECT COUNT(*) AS total FROM tbl_individuals")
    individuals = cur.fetchone()["total"]
    conn.close()
    return (
        jsonify(
            {
                "total_barangays": barangays,
                "total_households": households,
                "total_individuals": individuals,
            }
        ),
        200,
    )


# ── GeoJSON Endpoints ─────────────────────────────────────────
@app.route("/api/gis/barangays", methods=["GET"])
@jwt_required()
def gis_barangays():
    path = os.path.join(GEOJSON_DIR, "barangay_boundaries.geojson")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data), 200


@app.route("/api/gis/housing-units", methods=["GET"])
@jwt_required()
def gis_housing_units():
    path = os.path.join(GEOJSON_DIR, "housing_units.geojson")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data), 200


@app.route("/api/gis/roads", methods=["GET"])
@jwt_required()
def gis_roads():
    path = os.path.join(GEOJSON_DIR, "roads.geojson")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data), 200

@app.route("/api/gis/flood", methods=["GET"])
@jwt_required()
def gis_flood():
    path = os.path.join(GEOJSON_DIR, "flood.geojson")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data), 200


@app.route("/api/gis/landslide", methods=["GET"])
@jwt_required()
def gis_landslide():
    path = os.path.join(GEOJSON_DIR, "landslide.geojson")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data), 200


# ── Hazard watch list (Map page -> "Hazard Watch List" export) ─────────
# Households in the highest hazard bands, grouped by barangay, with the
# members who need help first in an emergency (seniors, PWDs, children
# under 5, solo parents) and whether the household knows its evacuation
# site / emergency hotline. Flood and landslide levels are reported
# separately -- never added together.
# ?levels=flood:Very High,flood:High,landslide:High  (default: flood:Very High)
_WATCH_ALLOWED = {
    "flood": {"Very High", "High", "Moderate", "Low"},
    "landslide": {"High", "Moderate", "Low"},
}


# ── Planning report: households to look out for, per domain ───────────────
# One barangay, one domain. Built only from the household's own CBMS
# answers; the rules are written into "basis" so the PDF can print them.
# Contains household heads' names -> the report is marked confidential
# (RA 10173), same as the Hazard Watch List.
import re as _re
import math as _math
import unicodedata as _ud
from flask import request as _request

_RHU_PT = (10.7814615, 122.4647052)
_FIRE_PT = (10.78698, 122.46827)


def _brgy_key(name):
    t = _ud.normalize("NFKD", str(name or ""))
    t = "".join(c for c in t if not _ud.combining(c)).lower()
    t = _re.sub(r"\bb\.?r?gy\.?\s*|\bbarangay\s*|\bpob(lacion)?\.?\s*", "", t)
    t = _re.sub(r"\bsanto\b", "sto", t)
    t = _re.sub(r"\bsanta\b", "sta", t)
    t = _re.sub(r"[^a-z0-9 ]", "", t)
    return _re.sub(r"\s+", " ", t).strip()


def _km(lat, lng, pt):
    if lat is None or lng is None:
        return None
    p1, p2 = _math.radians(float(lat)), _math.radians(pt[0])
    dp, dl = p2 - p1, _math.radians(pt[1] - float(lng))
    a = _math.sin(dp / 2) ** 2 + _math.cos(p1) * _math.cos(p2) * _math.sin(dl / 2) ** 2
    return 6371.0 * 2 * _math.atan2(_math.sqrt(a), _math.sqrt(1 - a))


_SVI_FLAGS = [
    ("ti_food_insecure", "food insecure"), ("ti_overcrowding", "overcrowded"), ("ti_no_internet", "no internet"),
    ("ti_weak_roof", "weak roof"), ("ti_weak_wall", "weak walls"), ("ti_insecure_tenure", "insecure tenure"),
    ("ti_unimproved_sanitation", "unimproved toilet"), ("ti_low_adult_education_hh", "low adult schooling"),
]
WATCH_BASIS = {
    "svi": "Households with 5 or more of the 13 SVI conditions (food insecurity, overcrowding, no internet, weak roof, "
           "weak walls, insecure tenure, unimproved toilet, low adult schooling, a PWD, a senior, a solo parent, "
           "more than 2 km from the RHU, more than 2 km from the fire station). Most conditions first.",
    "capacity": "Households that do not know their evacuation location or the emergency hotline. Those with seniors, "
                "PWDs or children under 5, and those more than 2 km from the RHU or fire station, are listed first.",
    "hazard": "Households in a High or Very High flood zone or a Moderate or High landslide zone. Very High flood / "
              "High landslide first, then homes with seniors, PWDs or children under 5.",
}


@app.route("/api/planning/watch-households", methods=["GET"])
@jwt_required()
def planning_watch_households():
    domain = (_request.args.get("domain") or "hazard").lower()
    if domain not in WATCH_BASIS:
        return jsonify({"error": "domain must be svi, capacity or hazard"}), 400
    want = _brgy_key(_request.args.get("barangay"))
    if not want:
        return jsonify({"error": "barangay is required"}), 400
    con = psycopg2.connect(Config.get_connection_string(), cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur = con.cursor()
        cur.execute("SELECT barangay_id, barangay_name FROM tbl_barangays")
        ids = [r["barangay_id"] for r in cur.fetchall() if _brgy_key(r["barangay_name"]) == want]
        if not ids:
            return jsonify({"domain": domain, "total": 0, "matched": 0, "households": [], "basis": WATCH_BASIS[domain]}), 200
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'tbl_households'")
        hcols = {r["column_name"] for r in cur.fetchall()}
        flag_sql = ", ".join(f"BOOL_OR(h.{c}) AS {c}" if c in hcols else f"NULL::boolean AS {c}" for c, _ in _SVI_FLAGS)
        cur.execute(f"""
            SELECT h.household_id, h.household_number, h.flood_exposure, h.landslide_exposure,
                   h.latitude, h.longitude, h.knows_evacuation_location, h.knows_emergency_hotline,
                   h.typology_cluster_label, {flag_sql},
                   COUNT(i.person_id) AS members,
                   COUNT(*) FILTER (WHERE i.age >= 60 OR i.is_senior) AS seniors,
                   COUNT(*) FILTER (WHERE i.is_pwd) AS pwd,
                   COUNT(*) FILTER (WHERE i.age IS NOT NULL AND i.age < 5) AS under5,
                   COUNT(*) FILTER (WHERE i.is_solo_parent) AS solo_parents,
                   MAX(CASE WHEN i.is_household_head THEN
                         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', i.first_name, i.last_name)), ''), i.full_name) END) AS head_name
            FROM tbl_households h
            LEFT JOIN tbl_individuals i ON i.household_id = h.household_id
            WHERE h.barangay_id = ANY(%s)
            GROUP BY h.household_id
        """, (ids,))
        rows = cur.fetchall()
    finally:
        con.close()

    out = []
    for r in rows:
        people = []
        if r["seniors"]: people.append(f"{r['seniors']} senior{'s' if r['seniors'] > 1 else ''}")
        if r["pwd"]: people.append(f"{r['pwd']} PWD")
        if r["under5"]: people.append(f"{r['under5']} under 5")
        helpers = (r["seniors"] or 0) + (r["pwd"] or 0) + (r["under5"] or 0)
        rhu, fire = _km(r["latitude"], r["longitude"], _RHU_PT), _km(r["latitude"], r["longitude"], _FIRE_PT)
        far = [n for n, d in (("RHU", rhu), ("fire station", fire)) if d is not None and d > 2]
        no_evac = str(r["knows_evacuation_location"] or "").lower() == "no"
        no_hot = str(r["knows_emergency_hotline"] or "").lower() == "no"
        reasons, score = [], 0
        if domain == "hazard":
            f, l = r["flood_exposure"], r["landslide_exposure"]
            if f not in ("High", "Very High") and l not in ("Moderate", "High"):
                continue
            severe = f == "Very High" or l == "High"
            reasons.append(f"Flood {f}" if f in ("High", "Very High") else f"Landslide {l}")
            if no_evac: reasons.append("doesn't know evacuation site")
            score = (100 if severe else 0) + helpers * 5 + (3 if no_evac else 0)
            level = "Very High" if f == "Very High" else ("High" if f == "High" or l == "High" else "Moderate")
        elif domain == "svi":
            flags = [lbl for c, lbl in _SVI_FLAGS if r.get(c)]
            if r["pwd"]: flags.append("PWD")
            if r["seniors"]: flags.append("senior")
            if r["solo_parents"]: flags.append("solo parent")
            if rhu is not None and rhu > 2: flags.append(">2 km RHU")
            if fire is not None and fire > 2: flags.append(">2 km fire station")
            if len(flags) < 5:
                continue
            reasons = flags
            score = len(flags) * 10 + helpers
            level = f"{len(flags)} of 13"
        else:
            if not (no_evac or no_hot):
                continue
            # "Doesn't know" column says exactly what; "Why listed" adds distance
            reasons.append(("More than 2 km from the " + " and ".join(far)) if far else "Within 2 km of the RHU and fire station")
            score = (no_evac + no_hot) * 10 + helpers * 4 + len(far) * 2
            level = "Evac site + hotline" if no_evac and no_hot else ("Evac site" if no_evac else "Hotline")
        out.append({
            "household_number": r["household_number"], "head_name": r["head_name"], "members": r["members"],
            "people": ", ".join(people), "level": level, "reasons": reasons, "score": score,
            "typology": r["typology_cluster_label"],
        })
    out.sort(key=lambda h: (-h["score"], str(h["household_number"])))
    limit = max(1, min(int(_request.args.get("limit") or 60), 5000))
    return jsonify({"domain": domain, "total": len(rows), "matched": len(out), "households": out[:limit],
                    "basis": WATCH_BASIS[domain]}), 200


# ── Reports > High-Risk Households: hazard + household SVI conditions ─────
# Every household in a High/Very High flood zone or a Moderate/High landslide
# zone, OR with 5+ of the 13 SVI conditions; each with its own count of the 13 SVI conditions (same list as the
# Planning report) and who may need help. Hazard and SVI are shown side by
# side; nothing is added into a combined score. No names.
def _household_svi(r):
    rhu, fire = _km(r["latitude"], r["longitude"], _RHU_PT), _km(r["latitude"], r["longitude"], _FIRE_PT)
    flags = [lbl for c, lbl in _SVI_FLAGS if r.get(c)]
    if r["pwd"]: flags.append("PWD")
    if r["seniors"]: flags.append("senior")
    if r["solo_parents"]: flags.append("solo parent")
    if rhu is not None and rhu > 2: flags.append(">2 km RHU")
    if fire is not None and fire > 2: flags.append(">2 km fire station")
    return flags


@app.route("/api/reports/high-risk-households", methods=["GET"])
@jwt_required()
def reports_high_risk_households():
    con = psycopg2.connect(Config.get_connection_string(), cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur = con.cursor()
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'tbl_households'")
        hcols = {r["column_name"] for r in cur.fetchall()}
        flag_sql = ", ".join(f"BOOL_OR(h.{c}) AS {c}" if c in hcols else f"NULL::boolean AS {c}" for c, _ in _SVI_FLAGS)
        cur.execute(f"""
            SELECT h.household_id, h.household_number, b.barangay_name, h.flood_exposure, h.landslide_exposure,
                   h.latitude, h.longitude, h.knows_evacuation_location, h.knows_emergency_hotline, {flag_sql},
                   COUNT(i.person_id) AS members,
                   COUNT(*) FILTER (WHERE i.age >= 60 OR i.is_senior) AS seniors,
                   COUNT(*) FILTER (WHERE i.is_pwd) AS pwd,
                   COUNT(*) FILTER (WHERE i.age IS NOT NULL AND i.age < 5) AS under5,
                   COUNT(*) FILTER (WHERE i.is_solo_parent) AS solo_parents
            FROM tbl_households h
            LEFT JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
            LEFT JOIN tbl_individuals i ON i.household_id = h.household_id
            GROUP BY h.household_id, b.barangay_name
        """)
        rows = cur.fetchall()
    finally:
        con.close()
    out = []
    for r in rows:
        flags = _household_svi(r)
        in_hazard = r["flood_exposure"] in ("High", "Very High") or r["landslide_exposure"] in ("Moderate", "High")
        if not in_hazard and len(flags) < 5:
            continue   # listed only when in a high hazard zone or with 5+ SVI conditions
        out.append({
            "in_hazard": in_hazard,
            "knows_hotline": r["knows_emergency_hotline"],
            "household_number": r["household_number"], "barangay_name": r["barangay_name"],
            "flood_exposure": r["flood_exposure"], "landslide_exposure": r["landslide_exposure"],
            "svi_conditions": len(flags), "svi_flags": flags,
            "members": r["members"], "seniors": r["seniors"], "pwd": r["pwd"], "under5": r["under5"],
            "knows_evacuation": r["knows_evacuation_location"],
        })
    return jsonify({"households": out, "count": len(out)}), 200


@app.route("/api/gis/hazard-watchlist", methods=["GET"])
@jwt_required()
def hazard_watchlist():
    raw = request.args.get("levels") or "flood:Very High"
    flood_lv, slide_lv = [], []
    for part in raw.split(","):
        kind, _, level = part.strip().partition(":")
        kind, level = kind.strip().lower(), level.strip()
        if level in _WATCH_ALLOWED.get(kind, ()):
            (flood_lv if kind == "flood" else slide_lv).append(level)
    if not flood_lv and not slide_lv:
        return jsonify({"error": "Choose at least one hazard level."}), 400

    conn = psycopg2.connect(Config.get_connection_string(),
                            cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT h.household_id, h.household_number, b.barangay_name,
                   h.flood_exposure, h.landslide_exposure,
                   h.latitude, h.longitude, h.typology_cluster_label,
                   h.knows_evacuation_location, h.knows_emergency_hotline,
                   COUNT(i.person_id)                                   AS members,
                   COUNT(*) FILTER (WHERE i.age >= 60 OR i.is_senior)     AS seniors,
                   COUNT(*) FILTER (WHERE i.is_pwd)                      AS pwd,
                   COUNT(*) FILTER (WHERE i.age IS NOT NULL AND i.age < 5) AS under5,
                   COUNT(*) FILTER (WHERE i.is_solo_parent)              AS solo_parents,
                   COUNT(*) FILTER (WHERE i.age >= 60 OR i.is_senior OR i.is_pwd
                                      OR (i.age IS NOT NULL AND i.age < 5)) AS needing_help,
                   MAX(CASE WHEN i.is_household_head THEN
                         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', i.first_name, i.last_name)), ''), i.full_name)
                       END)                                              AS head_name
            FROM tbl_households h
            LEFT JOIN tbl_barangays b   ON b.barangay_id = h.barangay_id
            LEFT JOIN tbl_individuals i ON i.household_id = h.household_id
            WHERE h.flood_exposure = ANY(%s) OR h.landslide_exposure = ANY(%s)
            GROUP BY h.household_id, b.barangay_name
            """,
            (flood_lv, slide_lv),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    def yn(v):
        if v is None:
            return None
        return str(v).strip().lower() in ("true", "t", "yes", "y", "1")

    out = []
    for r in rows:
        at_risk = int(r["needing_help"] or 0)   # people, not flags: a senior PWD counts once
        out.append({
            "household_id": r["household_id"],
            "household_number": r["household_number"],
            "barangay": r["barangay_name"] or "Unassigned",
            "flood": r["flood_exposure"] or None,
            "landslide": r["landslide_exposure"] or None,
            "latitude": float(r["latitude"]) if r["latitude"] is not None else None,
            "longitude": float(r["longitude"]) if r["longitude"] is not None else None,
            "household_type": r["typology_cluster_label"],
            "knows_evacuation_site": yn(r["knows_evacuation_location"]),
            "knows_hotline": yn(r["knows_emergency_hotline"]),
            "head_name": r["head_name"],
            "members": int(r["members"] or 0),
            "seniors": int(r["seniors"] or 0),
            "pwd": int(r["pwd"] or 0),
            "under5": int(r["under5"] or 0),
            "solo_parents": int(r["solo_parents"] or 0),
            "members_needing_help": at_risk,
        })

    # Group by barangay (most watched households first); inside a barangay,
    # households with the most members needing help come first.
    flood_rank = {"Very High": 4, "High": 3, "Moderate": 2, "Low": 1}
    groups = {}
    for h in out:
        groups.setdefault(h["barangay"], []).append(h)
    barangays = []
    for name, hh in groups.items():
        hh.sort(key=lambda h: (-flood_rank.get(h["flood"], 0), -h["members_needing_help"],
                               h["knows_evacuation_site"] is not False, -h["members"],
                               str(h["household_number"])))
        barangays.append({
            "barangay": name,
            "households": len(hh),
            "people": sum(h["members"] for h in hh),
            "members_needing_help": sum(h["members_needing_help"] for h in hh),
            "no_evacuation_site": sum(1 for h in hh if h["knows_evacuation_site"] is False),
            "rows": hh,
        })
    barangays.sort(key=lambda g: (-g["households"], g["barangay"]))

    return jsonify({
        "levels": {"flood": flood_lv, "landslide": slide_lv},
        "total_households": len(out),
        "total_people": sum(h["members"] for h in out),
        "total_needing_help": sum(h["members_needing_help"] for h in out),
        "total_no_evacuation_site": sum(1 for h in out if h["knows_evacuation_site"] is False),
        "barangays": barangays,
    }), 200


# ── Health Check (public — no auth needed) ────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    return (
        jsonify(
            {
                "status": "ok",
                "module": "MDM Module — Objective 1",
                "version": "1.0.0",
            }
        ),
        200,
    )


# ── BVI Insight Generator (pure algorithm — no external API) ─────
def generate_bvi_insight(explain):
    """
    Generates a 3-sentence analytical insight from an explain_household()
    result (see vulnerability_engine.py, v3+). Indicator scores are on a
    1-4 scale now (not 0-1) -- >=3 flags a Sensitivity indicator as a
    real driver, <=2 flags an Adaptive Capacity indicator as a real
    protective factor. Exposure is no longer compared against S/AC here
    since it doesn't feed the Vulnerability formula anymore -- it's
    mentioned separately, as context.
    """
    vuln_cat = explain["vuln_category"]
    E  = explain["E"]["score"]
    S  = explain["S"]["score"]
    AC = explain["AC"]["score"]
    s_ind  = explain["S"]["indicators"]
    ac_ind = explain["AC"]["indicators"]

    cat_desc = {
        "Low": "low vulnerability", "Moderate": "moderate vulnerability",
        "High": "high vulnerability", "Very High": "very high vulnerability",
    }.get(vuln_cat, "vulnerability")

    sentences = []

    # ── Sentence 1: overall verdict + primary driver ──────────────
    top_s = sorted([i for i in s_ind if i["value"] >= 3.0], key=lambda i: i["value"], reverse=True)[:2]
    risk_str = " and ".join(i["label"].lower() for i in top_s) if top_s else "several sensitivity factors"
    sentences.append(
        f"This household is classified under {cat_desc} (Sensitivity {S:.1f}, Adaptive Capacity {AC:.1f} "
        f"on a 1-4 scale), largely driven by {risk_str}."
    )

    # ── Sentence 2: single most critical flagged indicator ────────
    all_flagged = sorted(
        [i for i in s_ind if i["value"] >= 3.0] + [i for i in ac_ind if i["value"] >= 3.0],
        key=lambda i: i.get("value", 0), reverse=True,
    )
    if all_flagged:
        sentences.append(
            f"The most notable contributing factor is {all_flagged[0]['label'].lower()} "
            f"({all_flagged[0]['detail']}), which should be prioritized in any intervention program."
        )
    else:
        sentences.append(
            "No single dominant risk factor was identified; the household's profile is broadly balanced "
            "across the measured indicators."
        )

    # ── Sentence 3: protective factors from Adaptive Capacity ─────
    # AC is inverted (lower score = more capacity), so <=2 is protective.
    protective = [i["label"].lower() for i in ac_ind if i["value"] <= 2.0]
    if protective and vuln_cat in ("Low", "Moderate"):
        sentences.append(
            f"The household's resilience is supported by {' and '.join(protective[:2])}, "
            f"which strengthen adaptive capacity and help buffer against rising vulnerability. "
            f"(Physical hazard exposure for this household is {E*100:.0f}% of the maximum scale.)"
        )
    elif protective and vuln_cat in ("High", "Very High"):
        sentences.append(
            f"Despite the high vulnerability rating, the household benefits from {' and '.join(protective[:2])} — "
            f"these existing protective factors should be preserved and built upon in targeted LGU assistance programs."
        )
    else:
        sentences.append(
            "This household currently has limited protective factors across all measured Adaptive Capacity "
            "indicators; multi-sectoral intervention is recommended."
        )

    return " ".join(sentences)


# ── Vulnerability Routes ──────────────────────────────────────
@app.route("/api/vulnerability/barangays", methods=["GET"])
@jwt_required()
def vuln_barangays():
    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()
    cur.execute(
        """
        SELECT * FROM tbl_barangay_vulnerability
        ORDER BY avg_vuln_score DESC
    """
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows]), 200


@app.route("/api/vulnerability/barangay-stage1/<int:barangay_id>/explain", methods=["GET"])
@jwt_required()
def vuln_barangay_stage1_explain(barangay_id):
    """
    Live per-indicator breakdown for ONE barangay's Stage 1 classification —
    powers the Map View "How was this calculated?" panel. Computes the same
    15 Sensitivity + 8 Adaptive Capacity population-percentage indicators
    barangay_stage1_vulnerability.py computes in its batch run (via the
    shared barangay_indicator_bins.compute_barangay_indicator_breakdown()),
    plus this barangay's stored quantile classification/rank from
    tbl_barangay_vulnerability_stage1 (the authoritative batch result).

    If the live recomputation doesn't match the stored batch value (e.g.
    household data changed since barangay_stage1_vulnerability.py last ran),
    `stale` is set true so the frontend can surface that honestly instead
    of silently showing numbers that don't agree with the choropleth.
    """
    from vulnerability_engine import _sensitivity_fractions, _ac_fractions
    from barangay_indicator_bins import compute_barangay_indicator_breakdown

    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()
    try:
        cur.execute("SELECT barangay_id, barangay_name FROM tbl_barangays WHERE barangay_id = %s", (barangay_id,))
        brgy = cur.fetchone()
        if not brgy:
            return jsonify({"error": "Barangay not found"}), 404

        cur.execute("SELECT * FROM tbl_households WHERE barangay_id = %s", (barangay_id,))
        households = [dict(r) for r in cur.fetchall()]

        breakdown = compute_barangay_indicator_breakdown(households, _sensitivity_fractions, _ac_fractions)
        if breakdown is None:
            return jsonify({"error": "No households found for this barangay"}), 404

        # Authoritative stored classification (quantile-ranked against all
        # 24 barangays by the batch script — this endpoint doesn't
        # re-rank live, that requires all 24 barangays' scores together).
        cur.execute("""
            SELECT vuln_score, vuln_category, flagged_for_stage2, computed_at
            FROM tbl_barangay_vulnerability_stage1
            WHERE barangay_id = %s
        """, (barangay_id,))
        stored = cur.fetchone()

        stale = (
            stored is not None
            and abs(float(stored["vuln_score"]) - breakdown["vuln_score"]) > 0.001
        )

        return jsonify({
            "barangay_id": brgy["barangay_id"],
            "barangay_name": brgy["barangay_name"],
            **breakdown,
            "stored_vuln_score": float(stored["vuln_score"]) if stored else None,
            "vuln_category": stored["vuln_category"] if stored else None,
            "flagged_for_stage2": stored["flagged_for_stage2"] if stored else None,
            "computed_at": stored["computed_at"].isoformat() if stored and stored["computed_at"] else None,
            "stale": stale,
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/vulnerability/barangay-stage1", methods=["GET"])
@jwt_required()
def vuln_barangay_stage1():
    """
    Stage 1 top-down barangay vulnerability (barangay_stage1_vulnerability.py).
    Drives the choropleth map — all 24 barangays, quantile-classified.
    Separate from tbl_barangay_vulnerability (naive bottom-up rollup, still
    used elsewhere e.g. household-distribution) and from
    tbl_barangay_vulnerability_factor (Stage 2, only the 10 flagged barangays).
    """
    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT
                barangay_id,
                barangay_name,
                total_households,
                ROUND(avg_sensitivity::numeric,        4) AS avg_sensitivity,
                ROUND(avg_adaptive_capacity::numeric,   4) AS avg_adaptive_capacity,
                ROUND(vuln_score::numeric,              4) AS vuln_score,
                vuln_category,
                flagged_for_stage2,
                computed_at
            FROM tbl_barangay_vulnerability_stage1
            ORDER BY vuln_score DESC NULLS LAST
        """)
        rows = cur.fetchall()
        return jsonify({"data": [dict(r) for r in rows]}), 200
    except Exception as e:
        return jsonify({"error": str(e), "data": []}), 500
    finally:
        conn.close()


@app.route("/api/vulnerability/barangay-summary", methods=["GET"])
@jwt_required()
def vuln_barangay_summary():
    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT
                bv.barangay_name,
                bv.total_households,
 
                bv.avg_vuln_score                           AS avg_vulnerability_score,
                bv.avg_resil_score                          AS avg_resilience_score,
                bv.avg_adaptive_capacity,
 
                -- Vulnerability counts (4 categories)
                bv.low_vuln_count,
                bv.medium_vuln_count,
                bv.high_vuln_count,
                bv.very_high_vuln_count,
 
                -- Combined "at-risk" = Moderate + High + Very High
                (bv.medium_vuln_count
                 + bv.high_vuln_count
                 + bv.very_high_vuln_count)                 AS vulnerable_count,
 
                -- Resilience counts
                bv.high_resil_count,
                bv.moderate_resil_count,
                bv.low_resil_count,
                bv.very_low_resil_count,
 
                bv.risk_level,
 
                COALESCE(vi.total_pwd,         0)           AS pwd_count,
                COALESCE(vi.total_senior,      0)           AS senior_count,
                COALESCE(vi.total_solo_parent, 0)           AS solo_parent_count,
                COALESCE(vi.total_4ps,         0)           AS fourps_count
 
            FROM tbl_barangay_vulnerability bv
            LEFT JOIN (
                SELECT
                    b.barangay_name,
                    SUM(v.pwd_count)         AS total_pwd,
                    SUM(v.senior_count)      AS total_senior,
                    SUM(v.solo_parent_count) AS total_solo_parent,
                    -- fourps_count no longer lives on tbl_vulnerability_index;
                    -- is_4ps_beneficiary now comes straight from tbl_households
                    SUM(CASE WHEN h.is_4ps_beneficiary = 'Yes' THEN 1 ELSE 0 END) AS total_4ps
                FROM tbl_vulnerability_index v
                JOIN tbl_households h ON h.household_id = v.household_id
                JOIN tbl_barangays b  ON b.barangay_id  = h.barangay_id
                GROUP BY b.barangay_name
            ) vi ON vi.barangay_name = bv.barangay_name
            ORDER BY bv.avg_vuln_score DESC NULLS LAST
        """)
        rows = cur.fetchall()
        return jsonify({"data": [dict(r) for r in rows]}), 200
    except Exception as e:
        return jsonify({"error": str(e), "data": []}), 500
    finally:
        conn.close()
 
 
@app.route("/api/vulnerability/component-breakdown", methods=["GET"])
@jwt_required()
def vuln_component_breakdown():
    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT
                barangay_name,
                total_households,
                ROUND(avg_vuln_score::numeric,        4) AS avg_vuln_score,
                ROUND(avg_exposure::numeric,           4) AS avg_exposure,
                ROUND(avg_sensitivity::numeric,        4) AS avg_sensitivity,
                ROUND(avg_adaptive_capacity::numeric,  4) AS avg_adaptive_capacity,
                low_vuln_count,
                medium_vuln_count,
                high_vuln_count,
                very_high_vuln_count,
                risk_level
            FROM tbl_barangay_vulnerability
            ORDER BY avg_vuln_score DESC NULLS LAST
        """)
        rows = cur.fetchall()
        return jsonify({"data": [dict(r) for r in rows]}), 200
    except Exception as e:
        return jsonify({"error": str(e), "data": []}), 500
    finally:
        conn.close()
 
 
@app.route("/api/vulnerability/household-distribution", methods=["GET"])
@jwt_required()
def household_distribution():
    try:
        conn = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur = conn.cursor()
 
        cur.execute("""
            SELECT tier, household_count
            FROM (
                SELECT 'Very High' AS tier,
                       SUM(very_high_vuln_count) AS household_count,
                       1 AS sort_order
                FROM tbl_barangay_vulnerability
 
                UNION ALL
 
                SELECT 'High' AS tier,
                       SUM(high_vuln_count) AS household_count,
                       2 AS sort_order
                FROM tbl_barangay_vulnerability
 
                UNION ALL
 
                SELECT 'Moderate' AS tier,
                       SUM(medium_vuln_count) AS household_count,
                       3 AS sort_order
                FROM tbl_barangay_vulnerability
 
                UNION ALL
 
                SELECT 'Low' AS tier,
                       SUM(low_vuln_count) AS household_count,
                       4 AS sort_order
                FROM tbl_barangay_vulnerability
            ) AS distribution
            ORDER BY sort_order
        """)
 
        rows      = cur.fetchall()
        data_list = [dict(row) for row in rows]
        total     = sum(int(row["household_count"] or 0) for row in data_list)
 
        cur.close()
        conn.close()
        return jsonify({"data": data_list, "total": total}), 200
 
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
 




@app.route("/api/vulnerability/household/<int:hh_id>", methods=["GET"])
@jwt_required()
def vuln_household(hh_id):
    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()

    cur.execute(
        """
        SELECT h.*, b.barangay_name
        FROM tbl_households h
        JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
        WHERE h.household_id = %s
    """,
        (hh_id,),
    )
    hh = cur.fetchone()
    if not hh:
        conn.close()
        return jsonify({"error": "Household not found"}), 404

    cur.execute(
        """
        SELECT COUNT(*) AS cnt FROM tbl_individuals WHERE household_id = %s
    """,
        (hh_id,),
    )
    member_count = cur.fetchone()["cnt"]
    if member_count == 0:
        conn.close()
        return jsonify({"error": "No members found for this household"}), 422

    cur.execute(
        """
        SELECT * FROM tbl_vulnerability_index WHERE household_id = %s
    """,
        (hh_id,),
    )
    scores = cur.fetchone()
    conn.close()

    if not scores:
        compute_single_household(hh_id)
        conn_retry = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur_retry = conn_retry.cursor()
        cur_retry.execute(
            """
            SELECT h.*, b.barangay_name
            FROM tbl_households h
            JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
            WHERE h.household_id = %s
        """,
            (hh_id,),
        )
        hh = cur_retry.fetchone()
        cur_retry.execute(
            """
            SELECT * FROM tbl_vulnerability_index WHERE household_id = %s
        """,
            (hh_id,),
        )
        scores = cur_retry.fetchone()
        conn_retry.close()
        if not scores:
            return jsonify({"error": "No members found for this household"}), 422

    conn2 = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur2 = conn2.cursor()
    cur2.execute(
        """
        SELECT
            i.*,
            COALESCE(i.full_name, i.person_code) AS display_name
        FROM tbl_individuals i
        WHERE i.household_id = %s
        ORDER BY i.age DESC NULLS LAST
    """,
        (hh_id,),
    )
    members = cur2.fetchall()
    cur2.execute(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN vuln_score > %s THEN 1 ELSE 0 END) AS higher
        FROM tbl_vulnerability_index
    """,
        (float(scores["vuln_score"]),),
    )
    rank = cur2.fetchone()
    conn2.close()

    percentile = 0
    if rank and rank["total"] and rank["total"] > 0:
        percentile = round((rank["higher"] / rank["total"]) * 100)

    # ── Cluster Profile & Attribute Matching (k-modes) ───────────────
    # For a household with a typology_cluster_id assigned, compare its 13
    # typology indicators (TYPOLOGY_INDICATOR_KEYS, module-level above)
    # against that CLUSTER's own mode value for each indicator (the most
    # common value among every household sharing the cluster) -- an honest
    # "how typical is this household of its cluster" measure. This is
    # never combined with SVI/hazard/capacity into one score; it's purely
    # about agreement with the cluster's own k-modes centroid.
    cluster_match = None
    cluster_id = hh.get("typology_cluster_id")
    if cluster_id is not None:
        mode_cols = ", ".join(
            f"MODE() WITHIN GROUP (ORDER BY {k}) AS {k}" for k in TYPOLOGY_INDICATOR_KEYS
        )
        conn3 = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur3 = conn3.cursor()
        cur3.execute(
            f"""
            SELECT {mode_cols}, COUNT(*) AS cluster_size
            FROM tbl_households
            WHERE typology_cluster_id = %s
            """,
            (cluster_id,),
        )
        mode_row = cur3.fetchone()
        conn3.close()

        if mode_row:
            attributes = []
            matched = 0
            for k in TYPOLOGY_INDICATOR_KEYS:
                hh_val = hh.get(k)
                mode_val = mode_row.get(k)
                is_match = hh_val is not None and mode_val is not None and hh_val == mode_val
                if is_match:
                    matched += 1
                attributes.append({
                    "key": k,
                    "household_value": hh_val,
                    "cluster_mode": mode_val,
                    "match": is_match,
                })
            total = len(TYPOLOGY_INDICATOR_KEYS)
            cluster_match = {
                "cluster_id": cluster_id,
                "cluster_label": hh.get("typology_cluster_label"),
                "cluster_size": int(mode_row.get("cluster_size") or 0),
                "total_indicators": total,
                "matched_count": matched,
                "match_pct": round((matched / total) * 100, 1) if total else None,
                "attributes": attributes,
            }

    return (
        jsonify(
            {
                "household": dict(hh),
                "scores": dict(scores),
                "members": [dict(m) for m in members],
                "percentile": percentile,
                "cluster_match": cluster_match,
            }
        ),
        200,
    )


# ── Household Similarity Network ──────────────────────────────
# A different kind of network than /api/network/*'s family-relationship
# graphs: nodes here are OTHER HOUSEHOLDS (not people), and an edge means
# two households look alike on the 13 k-modes typology indicators, not a
# blood/family tie. Built with networkx per Sir Shem's reference mockup
# ("Household Similarity Network (Cluster N)" -- edges show shared
# attributes, not social relationships), including a community-detection
# pass to surface tighter "Subgroup A/B/..." pockets within the cluster.
@app.route("/api/vulnerability/household/<int:hh_id>/similarity-network", methods=["GET"])
@jwt_required()
def household_similarity_network(hh_id):
    try:
        import networkx as nx
        from networkx.algorithms.community import greedy_modularity_communities
    except ImportError:
        return (
            jsonify({"error": "networkx is not installed on the server. Run: pip install networkx"}),
            500,
        )

    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()
    cur.execute(
        "SELECT household_id, household_number, typology_cluster_id, typology_cluster_label "
        "FROM tbl_households WHERE household_id = %s",
        (hh_id,),
    )
    center_row = cur.fetchone()
    if not center_row or center_row.get("typology_cluster_id") is None:
        conn.close()
        return jsonify({"error": "Household has no typology cluster assigned"}), 422
    cluster_id = center_row["typology_cluster_id"]

    cols = ", ".join(TYPOLOGY_INDICATOR_KEYS)
    cur.execute(
        f"""
        SELECT household_id, household_number, {cols}
        FROM tbl_households
        WHERE typology_cluster_id = %s
        """,
        (cluster_id,),
    )
    rows = cur.fetchall()
    conn.close()

    # Simple-matching similarity over the 13 indicators: fraction of
    # indicators BOTH households have a value for that also agree.
    # Indicators neither reports (still un-backfilled) are excluded from
    # the denominator rather than counted as a mismatch.
    def similarity(a, b):
        agree = compared = 0
        for k in TYPOLOGY_INDICATOR_KEYS:
            va, vb = a.get(k), b.get(k)
            if va is None or vb is None:
                continue
            compared += 1
            if va == vb:
                agree += 1
        return (agree / compared) if compared else 0.0

    by_id = {r["household_id"]: r for r in rows}
    center = by_id.get(hh_id)
    others = [r for r in rows if r["household_id"] != hh_id]

    # Cap to the households most similar to the one being viewed, so the
    # graph stays a clean, readable "peer neighborhood" (matching the
    # mockup's sparse look) instead of a dense hairball of every household
    # in a cluster that can run into the hundreds.
    MAX_NEIGHBORS = 20
    ranked = sorted(
        ((similarity(center, r), r) for r in others),
        key=lambda t: t[0],
        reverse=True,
    )[:MAX_NEIGHBORS]
    candidates = [center] + [r for _, r in ranked]

    # Edges: k-nearest-neighbor, not "every pair above a threshold". With
    # only 13 largely-binary indicators, most households in the same
    # cluster already agree on 60%+ of them by chance alone, so a plain
    # similarity cutoff draws almost every possible edge -- a dense
    # hairball, not the sparse "peer neighborhood" the mockup shows. Instead
    # each household keeps an edge only to its own few closest matches
    # (mutual-or-one-sided is fine -- the graph is undirected, so a pair is
    # linked as soon as either side picks the other), which keeps degree
    # low and the picture clean regardless of how tightly the cluster is
    # packed.
    EDGES_PER_NODE = 3
    MIN_EDGE_SIM = 0.50
    G = nx.Graph()
    for r in candidates:
        G.add_node(r["household_id"], label=r["household_number"])
    sim_cache = {}
    def sim_between(a, b):
        key = (a["household_id"], b["household_id"])
        if key not in sim_cache:
            s = similarity(a, b)
            sim_cache[key] = s
            sim_cache[(b["household_id"], a["household_id"])] = s
        return sim_cache[key]
    for i, a in enumerate(candidates):
        scored = sorted(
            (
                (sim_between(a, b), b)
                for j, b in enumerate(candidates)
                if j != i
            ),
            key=lambda t: t[0],
            reverse=True,
        )[:EDGES_PER_NODE]
        for s, b in scored:
            if s >= MIN_EDGE_SIM:
                G.add_edge(a["household_id"], b["household_id"], weight=s)

    # Community detection -- tighter pockets of resemblance WITHIN this
    # local similarity graph (the mockup's "Subgroup A"/"Subgroup B"),
    # distinct from the cluster assignment itself.
    communities = []
    if G.number_of_edges() > 0:
        try:
            communities = list(greedy_modularity_communities(G, weight="weight"))
        except Exception:
            communities = []
    if not communities:
        communities = [set(G.nodes())]

    community_of = {}
    for idx, comm in enumerate(communities):
        for node in comm:
            community_of[node] = idx
    center_comm = community_of.get(hh_id, 0)

    # Letter only the OTHER communities (Subgroup A, B, ...) -- the
    # center's own community reads as the plain "similar households"
    # bucket, matching the mockup's blue/orange/purple split.
    other_labels, next_letter = {}, 0
    for idx in range(len(communities)):
        if idx == center_comm:
            continue
        other_labels[idx] = chr(65 + next_letter)
        next_letter += 1

    # Layout: one spring_layout across the WHOLE graph pushed every
    # disconnected community far apart (global repulsion) while each
    # community's own springs pulled its members onto nearly the same
    # point -- multiple communities are the normal case once edges are
    # k-nearest-neighbor rather than "every pair above a cutoff", so that
    # collapsed almost every graph into unreadable dots. Instead, lay out
    # each community on its own (local spring_layout, or just its anchor if
    # it's a single node), then place that local layout at an anchor point:
    # the viewed household's own community anchored at the origin (with
    # the household itself pinned at (0,0) inside it), the other
    # communities ringed evenly around it. Both the ring radius and each
    # community's local spread are fixed, so pockets stay visually
    # distinct without either collapsing to a point or flying off-canvas.
    import math

    ANCHOR_RADIUS = 110
    other_comm_indices = [idx for idx in range(len(communities)) if idx != center_comm]
    anchor_of = {center_comm: (0.0, 0.0)}
    n_other = len(other_comm_indices)
    for i, idx in enumerate(other_comm_indices):
        angle = 2 * math.pi * i / n_other if n_other else 0.0
        anchor_of[idx] = (ANCHOR_RADIUS * math.cos(angle), ANCHOR_RADIUS * math.sin(angle))

    pos = {}
    for idx, comm in enumerate(communities):
        members = list(comm)
        ax, ay = anchor_of[idx]
        local_radius = 70 if idx == center_comm else 45
        if len(members) == 1:
            pos[members[0]] = (ax, ay)
            continue
        sub = G.subgraph(members)
        kwargs = dict(seed=42, k=1.3 / max(len(members) ** 0.5, 1), iterations=200)
        if idx == center_comm and hh_id in members:
            local_pos = nx.spring_layout(sub, pos={hh_id: (0.0, 0.0)}, fixed=[hh_id], **kwargs)
        else:
            local_pos = nx.spring_layout(sub, **kwargs)
        for node, (x, y) in local_pos.items():
            pos[node] = (ax + x * local_radius, ay + y * local_radius)

    nodes_out = []
    for r in candidates:
        nid = r["household_id"]
        x, y = pos[nid]
        comm_idx = community_of.get(nid, center_comm)
        nodes_out.append({
            "household_id": nid,
            "household_number": r["household_number"],
            "is_center": nid == hh_id,
            "x": round(x, 1),
            "y": round(y, 1),
            "community": comm_idx,
            "subgroup_label": None if comm_idx == center_comm else f"Subgroup {other_labels[comm_idx]}",
        })

    edges_out = [
        {"source": u, "target": v, "weight": round(G[u][v]["weight"], 3)}
        for u, v in G.edges()
    ]

    return (
        jsonify({
            "cluster_id": cluster_id,
            "cluster_label": center_row.get("typology_cluster_label"),
            "center_household_id": hh_id,
            "cluster_size": len(rows),
            "shown_count": len(candidates),
            "nodes": nodes_out,
            "edges": edges_out,
            "subgroup_count": max(len(communities) - 1, 0),
        }),
        200,
    )


# ── Vulnerability Computation Explain Route ───────────────────
@app.route("/api/vulnerability/household/<int:hh_id>/explain", methods=["GET"])
@jwt_required()
def vuln_explain(hh_id):
    """
    Returns the step-by-step BVI computation breakdown + a rule-based
    insight, using the SAME engine (vulnerability_engine.explain_household)
    that computes the stored scores -- no separate reimplementation of the
    formula here, so this can never drift out of sync with the real numbers.

    Response:
    {
      "computation": { E, S, AC indicator breakdowns, BVI, vuln_category, ... },
      "insight": "rule-based paragraph explaining why this household scored this way"
    }
    """
    from vulnerability_engine import explain_household

    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()

    # NOTE: household-level dataset -- tbl_households already has hh_size,
    # pwd_count, senior_count, etc. pre-aggregated. No tbl_individuals
    # join needed (that table doesn't even correspond 1:1 with households
    # under the current schema -- see earlier conversation).
    cur.execute(
        """
        SELECT h.*, b.barangay_name
        FROM tbl_households h
        JOIN tbl_barangays b ON h.barangay_id = b.barangay_id
        WHERE h.household_id = %s
        """,
        (hh_id,),
    )
    hh = cur.fetchone()
    conn.close()

    if not hh:
        return jsonify({"error": "Household not found"}), 404

    hh = dict(hh)
    breaks = get_classification_breaks()
    explain = explain_household(hh, breaks)

    computation = {
        **explain,
        "household_number": hh.get("household_number"),
        "barangay_name":    hh.get("barangay_name"),
        "member_count":     hh.get("hh_size"),
        "monthly_income":   hh.get("household_estimated_income") or hh.get("monthly_income") or 0,
        "housing_material": hh.get("housing_material"),
        "water_source":     hh.get("water_source"),
        "toilet_type":      hh.get("toilet_type"),
        "tenure_status":    hh.get("tenure_status"),
        "has_electricity":  bool(hh.get("has_electricity")),
    }

    insight = generate_bvi_insight(explain)

    return jsonify({"computation": computation, "insight": insight}), 200




# ── Network Routes ────────────────────────────────────────────
#
# /api/network/households returns ONE ROW PER NUCLEAR FAMILY, not per
# household. A household with more than one nuclear family (per
# network_engine.py's rebuild_network(), built from CBMS
# b01_nuclear_family) is represented as duplicated rows, one per family,
# each carrying:
#   - head_relationship: how that family's own head relates to the
#     HOUSEHOLD head (e.g. "Son/Daughter", "Grandchildren") -- null for
#     the head's own family.
#   - is_head_family: true for the household head's own family.
#   - has_solo_parent / has_senior / has_pwd / is_4ps_beneficiary: real
#     per-family aggregates from tbl_families (network_engine.py), not
#     estimated.
#   - members: scoped to that family only (not the whole household).
# vuln_score/vuln_category/etc. remain HOUSEHOLD-level -- there is no
# per-family vulnerability score anywhere in the pipeline -- and are
# repeated identically across a household's duplicated rows; the
# frontend labels this explicitly so it isn't mistaken for a per-family
# number.
#
# IMPORTANT: the household head is ALSO the source of the ordinary
# within-family edges to their OWN family (spouse, kids), not just the
# special cross-family edges to other families -- so "sourced by the
# household head" alone doesn't identify a cross-family edge.
# tgt.family_id <> src.family_id is what actually distinguishes them.
# (Verified against the real DB: without that filter every single-family
# household came back with a bogus head_relationship and
# is_head_family=false on every row.)
@app.route("/api/network/households", methods=["GET"])
@jwt_required()
def network_households():
    barangay = request.args.get("barangay")  # optional barangay_name
    q = request.args.get("q")  # optional search
    page = max(int(request.args.get("page", 1)), 1)
    per_page = min(int(request.args.get("per_page", request.args.get("limit", 200))), 2000)

    offset = (page - 1) * per_page

    conn = psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur = conn.cursor()

    filters = []
    params = []

    if barangay:
        filters.append("b.barangay_name = %s")
        params.append(barangay)

    if q:
        filters.append("h.household_number ILIKE %s")
        params.append(f"%{q}%")

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    # KPI totals over the FILTERED set (household-level; not paginated,
    # unaffected by the per-family row split below).
    # `compound_hazard_count` replaces the old BVI-based "masked
    # vulnerability" KPI (adviser decision: BVI is fully disregarded).
    # It mirrors the household-profile page's own "compound hazard" flag
    # (h.compound_hazard = a household sitting in BOTH a flood AND a
    # landslide zone, from hazard_engine.py) rather than any combined
    # score -- an honest, single-domain count, not restricted to
    # multi-family households the way the old masked-vulnerability count
    # was, since hazard exposure is about geography, not family structure.
    cur.execute(
        f"""
        SELECT
          COUNT(DISTINCT h.household_id) AS total_households,
          COUNT(DISTINCT h.household_id) FILTER (WHERE fam.n_families > 1) AS multi_family_count,
          COUNT(DISTINCT h.household_id) FILTER (
              -- compound_hazard is stored as TEXT ('True'/'False', Python's
              -- str(bool) repr from hazard_engine.py -- see
              -- data/aligned_data_FINAL.csv), not a real boolean column, so
              -- this can't be `= true`; LOWER(...) = 'true' matches it
              -- regardless of case.
              WHERE LOWER(h.compound_hazard) = 'true'
          ) AS compound_hazard_count,
          -- Households caring for a senior (60+) or a person with a
          -- disability: the dependents an evacuation or social-program
          -- plan has to reach first. Shown on the Network page in place
          -- of the compound-hazard count, which is 0 in San Miguel (no
          -- household sits in both a flood and a landslide zone).
          COUNT(DISTINCT h.household_id) FILTER (
              WHERE EXISTS (SELECT 1 FROM tbl_individuals i
                            WHERE i.household_id = h.household_id
                              AND (i.age >= 60 OR i.is_pwd))
          ) AS care_dependent_count
        FROM tbl_households h
        LEFT JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
        LEFT JOIN tbl_vulnerability_index v ON v.household_id = h.household_id
        LEFT JOIN (
            SELECT household_id, COUNT(*) AS n_families
            FROM tbl_families GROUP BY household_id
        ) fam ON fam.household_id = h.household_id
        {where}
    """,
        params,
    )
    kpi = cur.fetchone()

    total_households = int(kpi["total_households"] or 0)

    # Paginated household list -- ONE row per household (a multi-family
    # household is a single click/row now, showing every nuclear family in
    # one combined graph view, not a duplicated row per family). Each
    # family's own info (size, solo-parent flag, its relation to the
    # household head) is aggregated into a `families` array on the row so
    # the list can still show per-family badges.
    cur.execute(
        f"""
        WITH cross_family_edges AS (
            -- household head -> each other family's own head, labeled by
            -- that head's relation to the household head. Written once
            -- per multi-family household by network_engine.py's
            -- rebuild_network(). tgt.family_id <> src.family_id excludes
            -- the head's own ordinary within-family edges.
            SELECT tgt.family_id AS family_id, e.edge_type AS head_relationship
            FROM tbl_network_edges e
            JOIN tbl_individuals src ON ('person:' || src.person_id) = e.source_node
            JOIN tbl_individuals tgt ON ('person:' || tgt.person_id) = e.target_node
            WHERE src.is_household_head = true
              AND tgt.family_id <> src.family_id
        ),
        family_rows AS (
            SELECT
              f.household_id,
              f.family_id,
              f.family_size,
              f.has_solo_parent,
              f.has_senior,
              f.has_pwd,
              f.is_4ps_beneficiary,
              cfe.head_relationship,
              (cfe.head_relationship IS NULL) AS is_head_family
            FROM tbl_families f
            LEFT JOIN cross_family_edges cfe ON cfe.family_id = f.family_id
        ),
        family_agg AS (
            SELECT
              household_id,
              COUNT(*) AS n_families,
              bool_or(has_solo_parent) AS has_solo_parent,
              bool_or(has_senior) AS has_senior,
              bool_or(has_pwd) AS has_pwd,
              bool_or(is_4ps_beneficiary) AS is_4ps_beneficiary,
              json_agg(
                json_build_object(
                  'family_id', family_id,
                  'family_size', family_size,
                  'has_solo_parent', has_solo_parent,
                  'head_relationship', head_relationship,
                  'is_head_family', is_head_family
                ) ORDER BY is_head_family DESC, family_id
              ) AS families
            FROM family_rows
            GROUP BY household_id
        )
        SELECT
          h.household_id,
          h.household_number,
          b.barangay_name,
          COALESCE(fa.n_families, 1) AS n_families,
          COALESCE(fa.has_solo_parent, false) AS has_solo_parent,
          COALESCE(fa.has_senior, false) AS has_senior,
          COALESCE(fa.has_pwd, false) AS has_pwd,
          COALESCE(fa.is_4ps_beneficiary, false) AS is_4ps_beneficiary,
          fa.families,
          -- Legacy BVI/DESUD (E+S)/AC score -- kept selected only for
          -- backward compatibility with any other consumer; the network
          -- page itself no longer displays it (adviser decision: BVI is
          -- fully disregarded, replaced by the three-domain model below).
          v.vuln_score,
          v.vuln_category,
          v.resil_score,
          v.resil_category,
          -- Three-domain model (post-BVI), same fields VulnerabilityPage.jsx
          -- already reads off tbl_households -- kept separate, never
          -- combined into one score.
          h.latitude,
          h.longitude,
          h.typology_cluster_id,
          h.typology_cluster_label,
          h.ti_overcrowding,
          h.ti_food_insecure,
          h.ti_no_internet,
          h.ti_weak_roof,
          h.ti_weak_wall,
          h.ti_insecure_tenure,
          h.ti_unimproved_sanitation,
          h.ti_low_adult_education_hh,
          h.ti_large_household,
          h.ti_financially_excluded,
          h.ti_pwd_count_cat,
          h.ti_senior_count_cat,
          h.ti_solo_parent_count_cat,
          h.flood_exposure,
          h.landslide_exposure,
          h.hazard_exposure_score,
          h.compound_hazard,
          h.hazard_data_status
        FROM tbl_households h
        LEFT JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
        LEFT JOIN tbl_vulnerability_index v ON v.household_id = h.household_id
        LEFT JOIN family_agg fa ON fa.household_id = h.household_id
        {where}
        ORDER BY b.barangay_name ASC, h.household_number ASC
        LIMIT %s OFFSET %s
    """,
        params + [per_page, offset],
    )
    hh_rows = cur.fetchall()

    if hh_rows:
        household_ids = [r["household_id"] for r in hh_rows]
        cur.execute(
            """
            SELECT household_id, person_id, age, is_pwd, gender
            FROM tbl_individuals
            WHERE household_id = ANY(%s)
            """,
            (household_ids,),
        )
        members_by_household = {}
        for r in cur.fetchall():
            members_by_household.setdefault(r["household_id"], []).append(dict(r))
    else:
        members_by_household = {}

    conn.close()

    data = []
    for r in hh_rows:
        d = dict(r)
        d["members"] = members_by_household.get(r["household_id"], [])
        d["member_count"] = len(d["members"])
        d["family_size"] = d["member_count"]
        d["vuln_score_is_household_level"] = True
        data.append(d)

    return (
        jsonify(
            {
                "data": data,
                "total": total_households,
                "total_households": total_households,
                "multi_family_count": int(kpi["multi_family_count"] or 0),
                "compound_hazard_count": int(kpi["compound_hazard_count"] or 0),
                "care_dependent_count": int(kpi["care_dependent_count"] or 0),
                "page": page,
                "per_page": per_page,
            }
        ),
        200,
    )


@app.route("/api/network/households/<int:household_id>/graph", methods=["GET", "OPTIONS"])
@jwt_required()
def network_household_graph(household_id):
    # Always returns the WHOLE household in one combined tree -- every
    # nuclear family's members and edges together (within-family edges
    # plus the cross-family "head -> other family's head" edges
    # network_engine.py stores). Multiple nuclear families show up as
    # separate branches off the household head within this single view,
    # not as separate graphs.
    #
    # family_id is still accepted and echoed back in the response purely
    # so the frontend can highlight which row/family was clicked -- it no
    # longer filters which people/edges are included.
    family_id = request.args.get("family_id", type=int)

    try:
        conn = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur = conn.cursor()

        # Household info
        cur.execute("""
            SELECT h.household_id, h.household_number, b.barangay_name
            FROM tbl_households h
            LEFT JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
            WHERE h.household_id = %s
        """, (household_id,))
        hh = cur.fetchone()
        if not hh:
            conn.close()
            return jsonify({"error": "Household not found"}), 404

        # Individuals belong to this household directly -- no view needed.
        # nuclear_family / relation_to_nuclear_family_head / relationship_to_hh
        # are populated by import_cbms2024_v2.py; family_id and the edges
        # below are populated by network_engine.py.
        cur.execute("""
            SELECT person_id, household_id, full_name, last_name, first_name,
                   age, gender, is_pwd, is_senior, is_household_head,
                   relationship_to_hh, family_id
            FROM tbl_individuals
            WHERE household_id = %s
            ORDER BY person_id
        """, (household_id,))
        people = cur.fetchall()

        person_ids = [p["person_id"] for p in people]
        node_ids = [f"person:{pid}" for pid in person_ids]

        all_edges = []
        if node_ids:
            cur.execute("""
                SELECT source_node, target_node, edge_type
                FROM tbl_network_edges
                WHERE source_node = ANY(%s) AND target_node = ANY(%s)
            """, (node_ids, node_ids))
            all_edges = cur.fetchall()

        conn.close()

        def to_bool(v):
            if v is None: return False
            if isinstance(v, bool): return v
            if isinstance(v, (int, float)): return v != 0
            if isinstance(v, str): return v.strip().lower() in ("1", "true", "yes", "y")
            return False

        people_by_id = {p["person_id"]: p for p in people}
        household_head = next((p for p in people if p["is_household_head"]), None)

        # family_id (if given) is echoed back only -- it no longer filters
        # which people/edges are included below.
        if family_id is None:
            family_id = household_head["family_id"] if household_head else None
        is_head_family = (
            household_head is not None and household_head["family_id"] == family_id
        )

        # parent_id per person, derived from ALL edges (within-family plus
        # the cross-family "household head -> other family's head" edges)
        # -- this is what lets every family show up as its own branch off
        # the household head in one combined tree.
        parent_of = {}
        edge_type_of = {}
        for e in all_edges:
            target_pid = int(e["target_node"].split(":")[1])
            source_pid = int(e["source_node"].split(":")[1])
            parent_of[target_pid] = source_pid
            edge_type_of[target_pid] = e["edge_type"]

        head_id = household_head["person_id"] if household_head else (
            people[0]["person_id"] if people else None
        )
        head_node_id = f'person:{head_id}' if head_id else None

        hh_node_id = f"household:{household_id}"

        nodes = [{
            "id": hh_node_id,
            "kind": "household",
            "label": hh["household_number"],
            "barangay_name": hh.get("barangay_name"),
        }]

        for p in people:
            pid = p["person_id"]
            nodes.append({
                "id": f"person:{pid}",
                "kind": "person",
                "label": f'{p["last_name"]}, {p["first_name"]}' if p.get("last_name") else p.get("full_name"),
                "age": p.get("age"),
                "gender": p.get("gender"),
                "is_pwd": to_bool(p.get("is_pwd")),
                "is_senior": to_bool(p.get("is_senior")),
                "relationship_to_hh": (
                    edge_type_of.get(pid)
                    if pid in edge_type_of
                    else ("Head" if p.get("is_household_head") else p.get("relationship_to_hh"))
                ),
                "parent_id": f'person:{parent_of[pid]}' if pid in parent_of else None,
                "family_id": p.get("family_id"),
            })

        edges = [
            {"source": e["source_node"], "target": e["target_node"], "type": e["edge_type"]}
            for e in all_edges
        ]

        return jsonify({
            "household": dict(hh),
            "head_node_id": head_node_id,
            "nodes": nodes,
            "edges": edges,
            "family_id": family_id,
            "is_head_family": is_head_family,
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "graph_failed", "details": str(e)}), 500

# ── Family network analysis (networkx) ────────────────────────
# Structural analysis of ONE household's family network -- the same people
# and relationship edges the network graph endpoint above returns, run
# through networkx (see family_network_analysis.py): dependents and their
# nearest working-age adult, caregiver load, key connectors (articulation
# points / betweenness), and overall structure. Used by the Family Network
# Analysis page's PDF report and Excel export. Describes family structure
# only -- it is not a vulnerability score.
@app.route("/api/network/households/<int:household_id>/analysis", methods=["GET"])
@jwt_required()
def network_household_analysis(household_id):
    try:
        from family_network_analysis import analyze_household_network
    except ImportError:
        return jsonify({"error": "networkx is not installed on the server. Run: pip install networkx"}), 500

    try:
        conn = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur = conn.cursor()
        cur.execute("""
            SELECT h.household_id, h.household_number, b.barangay_name
            FROM tbl_households h
            LEFT JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
            WHERE h.household_id = %s
        """, (household_id,))
        hh = cur.fetchone()
        if not hh:
            conn.close()
            return jsonify({"error": "Household not found"}), 404

        cur.execute("""
            SELECT person_id, full_name, last_name, first_name, age, gender,
                   is_pwd, is_senior, is_household_head, relationship_to_hh, family_id
            FROM tbl_individuals
            WHERE household_id = %s
            ORDER BY person_id
        """, (household_id,))
        people = cur.fetchall()

        node_ids = [f"person:{p['person_id']}" for p in people]
        raw_edges = []
        if node_ids:
            cur.execute("""
                SELECT source_node, target_node, edge_type
                FROM tbl_network_edges
                WHERE source_node = ANY(%s) AND target_node = ANY(%s)
            """, (node_ids, node_ids))
            raw_edges = cur.fetchall()
        conn.close()

        # Same relationship labelling as the graph endpoint: a person's label
        # comes from the edge that points at them, else Head / their CBMS
        # relationship_to_hh.
        edge_type_of = {int(e["target_node"].split(":")[1]): e["edge_type"] for e in raw_edges}
        people_in = [{
            "person_id": p["person_id"],
            "name": f'{p["last_name"]}, {p["first_name"]}' if p.get("last_name") else p.get("full_name"),
            "age": p.get("age"),
            "gender": p.get("gender"),
            "is_pwd": p.get("is_pwd"),
            "is_senior": p.get("is_senior"),
            "is_household_head": p.get("is_household_head"),
            "relationship_to_hh": edge_type_of.get(p["person_id"])
                or ("Head" if p.get("is_household_head") else p.get("relationship_to_hh")),
            "family_id": p.get("family_id"),
        } for p in people]
        edges_in = [{
            "source_pid": int(e["source_node"].split(":")[1]),
            "target_pid": int(e["target_node"].split(":")[1]),
            "edge_type": e["edge_type"],
        } for e in raw_edges]
        head = next((p["person_id"] for p in people if p.get("is_household_head")), None)

        result = analyze_household_network(people_in, edges_in, head)
        result["household"] = dict(hh)
        return jsonify(result), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "analysis_failed", "details": str(e)}), 500


# ── Settings: Poverty Threshold ──────────────────────────────
POVERTY_THRESHOLD_DEFAULT = 13801.0

@app.route("/api/settings/poverty-threshold", methods=["GET"])
@jwt_required()
def get_poverty_threshold():
    try:
        conn = psycopg2.connect(
            Config.get_connection_string(),
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT value FROM tbl_system_settings WHERE key = 'poverty_threshold'"
        )
        row = cur.fetchone()
        conn.close()
        value = float(row["value"]) if row else POVERTY_THRESHOLD_DEFAULT
        return jsonify({"threshold": value}), 200
    except Exception:
        return jsonify({"threshold": POVERTY_THRESHOLD_DEFAULT}), 200


@app.route("/api/settings/poverty-threshold", methods=["PUT"])
@jwt_required()
def update_poverty_threshold():
    data = request.get_json()
    value = data.get("threshold") if data else None

    if value is None or not isinstance(value, (int, float)) or float(value) <= 0:
        return jsonify({"error": "Invalid threshold value."}), 400

    try:
        conn = psycopg2.connect(Config.get_connection_string())
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO tbl_system_settings (key, value)
            VALUES ('poverty_threshold', %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        """, (str(float(value)),))
        conn.commit()
        conn.close()
        return jsonify({"threshold": float(value), "message": "Threshold updated successfully."}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)