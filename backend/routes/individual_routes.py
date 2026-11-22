from flask import Blueprint, request, jsonify
from models.individual import (
    get_individuals_by_household, get_individual_by_id,
    create_individual, update_individual, delete_individual
)
from validators.mdm_validator import validate_individual, validation_error_response

individual_bp = Blueprint("individuals", __name__)

# GET /api/households/<id>/members
@individual_bp.route("/<int:household_id>/members", methods=["GET"])
def list_members(household_id):
    result = get_individuals_by_household(household_id)
    return jsonify({"data": result, "total": len(result)}), 200

# GET /api/individuals/<id>
@individual_bp.route("/<int:person_id>", methods=["GET"])
def get_person(person_id):
    result = get_individual_by_id(person_id)
    if not result:
        return jsonify({"error": "Individual not found"}), 404
    return jsonify(result), 200

# Find your POST members route and add compute trigger:
@individual_bp.route("/<int:household_id>/members", methods=["POST"])
def add_member(household_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    is_valid, errors = validate_individual(data)
    if not is_valid:
        return jsonify(validation_error_response(errors)), 422

    result = create_individual(household_id, data)
    if "error" in result:
        return jsonify(result), 409

    # ✅ Re-compute vulnerability after member is added
    try:
        from app import compute_single_household
        compute_single_household(household_id)
    except Exception as e:
        print(f"⚠️ Auto-compute skipped: {e}")

    return jsonify(result), 201

# PUT /api/individuals/<id>
@individual_bp.route("/<int:person_id>", methods=["PUT"])
def edit_person(person_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    is_valid, errors = validate_individual(data)
    if not is_valid:
        return jsonify(validation_error_response(errors)), 422
    result = update_individual(person_id, data)
    if "error" in result:
        return jsonify(result), 404
    return jsonify(result), 200

# DELETE /api/individuals/<id>
@individual_bp.route("/<int:person_id>", methods=["DELETE"])
def remove_person(person_id):
    result = delete_individual(person_id)
    if "error" in result:
        return jsonify(result), 404
    return jsonify(result), 200