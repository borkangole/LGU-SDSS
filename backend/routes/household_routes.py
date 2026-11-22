from flask import Blueprint, request, jsonify
import psycopg2
import psycopg2.extras
import bcrypt
from flask_jwt_extended import jwt_required, get_jwt_identity
from config import Config
from models.household import (
    get_all_households, get_household_by_id,
    create_household, update_household, delete_household,
    get_raw_household_number, log_uid_reveal,
)
from hazard_engine import detect_hazard_exposure
import manual_household
from validators.mdm_validator import validate_household, validation_error_response

household_bp = Blueprint("households", __name__)


def get_conn():
    return psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor
    )


# ── GET /api/households ───────────────────────────────────────────────────────
@household_bp.route("/", methods=["GET"])
def list_households():
    page          = int(request.args.get("page", 1))
    limit         = min(int(request.args.get("per_page",
                    request.args.get("limit", 20))), 9999)
    barangay_id   = request.args.get("barangay_id",  None)
    barangay_name = request.args.get("barangay",     None)
    search        = request.args.get("search",       None)
    sort          = request.args.get("sort",         "default")

    return jsonify(
        get_all_households(page, limit, barangay_id, barangay_name, search, sort)
    ), 200


# ── GET /api/households/hazard-preview?longitude=..&latitude=.. ──────────────
# Live preview ONLY — does not write to the database. Lets the Add/Edit
# form show flood/landslide exposure immediately after the user pins a
# location on the map, before they submit. The actual save
# (create_household/update_household in models/household.py) recomputes
# and persists these fields independently, so this endpoint being called
# or not has no effect on what actually gets saved.
@household_bp.route("/hazard-preview", methods=["GET"])
def hazard_preview():
    longitude = request.args.get("longitude")
    latitude  = request.args.get("latitude")
    if longitude is None or latitude is None:
        return jsonify({"error": "longitude and latitude are required"}), 400
    try:
        result = detect_hazard_exposure(longitude, latitude)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── GET /api/households/next-number?barangay_id=1 ────────────────────────────
# SUPERSEDED — display_code is now generated automatically and atomically
# inside create_household() (see models/household.py:generate_display_code).
# Left in place only in case another part of the app still calls it; no
# longer used to determine the actual code a new household receives.
@household_bp.route("/next-number", methods=["GET"])
def next_household_number():
    barangay_id = request.args.get("barangay_id")
    if not barangay_id:
        return jsonify({"error": "barangay_id is required"}), 400

    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute(
            "SELECT barangay_name FROM tbl_barangays WHERE barangay_id = %s",
            (barangay_id,)
        )
        brgy = cur.fetchone()
        if not brgy:
            return jsonify({"error": "Barangay not found"}), 404

        brgy_name = brgy["barangay_name"]          # e.g. "Brgy 1"
        prefix    = brgy_name.replace(" ", "")     # → "Brgy1"

        # Count existing households in this barangay
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM tbl_households WHERE barangay_id = %s",
            (barangay_id,)
        )
        next_seq  = int(cur.fetchone()["cnt"]) + 1
        candidate = f"{prefix}-{next_seq}"

        # Safety loop — skip if number already taken
        while True:
            cur.execute(
                "SELECT 1 FROM tbl_households WHERE household_number = %s",
                (candidate,)
            )
            if not cur.fetchone():
                break
            next_seq += 1
            candidate = f"{prefix}-{next_seq}"

        return jsonify({"household_number": candidate, "barangay_name": brgy_name}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


# ── GET /api/households/<id> ──────────────────────────────────────────────────
@household_bp.route("/<int:household_id>", methods=["GET"])
def get_household(household_id):
    result = get_household_by_id(household_id)
    if not result:
        return jsonify({"error": "Household not found"}), 404
    return jsonify(result), 200


# ── POST /api/households ──────────────────────────────────────────────────────
@household_bp.route("/", methods=["POST"])
def add_household():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    is_valid, errors = validate_household(data, is_update=False)
    if not is_valid:
        return jsonify(validation_error_response(errors)), 422
    result = create_household(data)
    if "error" in result:
        return jsonify(result), 409

    try:
        from app import compute_single_household
        compute_single_household(result["household_id"])
    except Exception as e:
        print(f"⚠️ Auto-compute skipped: {e}")

    return jsonify(result), 201


# ── PUT /api/households/<id> ──────────────────────────────────────────────────
@household_bp.route("/<int:household_id>", methods=["PUT"])
def edit_household(household_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    is_valid, errors = validate_household(data, is_update=True)
    if not is_valid:
        return jsonify(validation_error_response(errors)), 422
    result = update_household(household_id, data)
    if "error" in result:
        return jsonify(result), 404

    try:
        from app import compute_single_household
        compute_single_household(household_id)
    except Exception as e:
        print(f"⚠️ Auto-compute skipped: {e}")

    return jsonify(result), 200


# ── DELETE /api/households/<id> ───────────────────────────────────────────────
# Removes the household, its members and every row pointing to it, then
# recalculates the scores in the background (manual_household.py).
@household_bp.route("/<int:household_id>", methods=["DELETE"])
def remove_household(household_id):
    try:
        result = manual_household.delete_household(
            household_id, lambda: psycopg2.connect(Config.get_connection_string()),
            recalc=request.args.get("recalc", "1") != "0")
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 400
    if "error" in result:
        return jsonify(result), 404
    return jsonify(result), 200


# Recalculate every score once (used after deleting several households with
# ?recalc=0, so the pipeline runs one time instead of once per household).
@household_bp.route("/recalculate", methods=["POST"])
@jwt_required()
def recalculate_all():
    import cbms_import
    job_id = cbms_import.start_recompute(
        lambda: psycopg2.connect(Config.get_connection_string()), "Households changed",
        user=get_jwt_identity())
    return jsonify({"job_id": job_id}), 202


# ── Manual "Add household" (CBMS questionnaire codes) ─────────────────────────
@household_bp.route("/form-options", methods=["GET"])
@jwt_required()
def household_form_options():
    return jsonify(manual_household.form_options()), 200


@household_bp.route("/manual", methods=["POST"])
@jwt_required()
def add_household_manual():
    payload = request.get_json(silent=True) or {}
    try:
        result = manual_household.save_household(
            payload, lambda: psycopg2.connect(Config.get_connection_string()),
            user=get_jwt_identity())
    except ValueError as e:
        return jsonify({"errors": [str(e)]}), 400
    except Exception as e:  # noqa: BLE001
        return jsonify({"errors": [f"Could not save the household: {e}"]}), 500
    if result.get("errors"):
        return jsonify(result), 422
    return jsonify(result), 201


# ── POST /api/households/<id>/reveal-uid ──────────────────────────────────────
# Password-gated reveal of the raw household UUID. Requires the CURRENTLY
# LOGGED-IN user to re-enter their own password (not a separate admin
# password) -- same idea as GitHub/sudo re-auth prompts. Every successful
# reveal is logged to tbl_uid_reveal_log (who, which household, when) so
# there's an audit trail of who has looked at raw UUIDs.
@household_bp.route("/<int:household_id>/reveal-uid", methods=["POST"])
@jwt_required()
def reveal_household_uid(household_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    password = (data.get("password") or "").strip()

    if not password:
        return jsonify({"error": "Password is required."}), 400

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tbl_users WHERE user_id = %s", (user_id,))
        user = cur.fetchone()
        if not user:
            return jsonify({"error": "User not found."}), 404

        # Same bcrypt check as login/change-password in auth_routes.py --
        # deliberately not importing that module to avoid a circular
        # import (auth_routes doesn't import household_routes, but
        # keeping this self-contained avoids relying on that staying true).
        pw_match = bcrypt.checkpw(
            password.encode("utf-8"),
            user["password_hash"].encode("utf-8")
        )
        if not pw_match:
            return jsonify({"error": "Incorrect password."}), 401

        record = get_raw_household_number(household_id)
        if not record:
            return jsonify({"error": "Household not found."}), 404

        log_uid_reveal(household_id, user_id)

        return jsonify({
            "household_number": record["household_number"],
            "display_code":     record["display_code"],
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


# ── PATCH /api/households/<id>/sync-income ────────────────────────────────────
@household_bp.route("/<int:household_id>/sync-income", methods=["PATCH"])
def sync_household_income(household_id):
    """Sum all members' monthly_income and save to tbl_households.monthly_income."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            SELECT COALESCE(SUM(monthly_income), 0) AS total
            FROM tbl_individuals
            WHERE household_id = %s
            """,
            (household_id,)
        )
        total = float(cur.fetchone()["total"])

        cur.execute(
            """
            UPDATE tbl_households
            SET monthly_income = %s, updated_at = NOW()
            WHERE household_id = %s
            """,
            (total, household_id)
        )
        conn.commit()
        return jsonify({"monthly_income": total, "message": "Income synced"}), 200

    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()