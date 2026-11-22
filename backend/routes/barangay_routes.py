from flask import Blueprint, jsonify
from models.barangay import get_all_barangays, get_barangay_by_id

barangay_bp = Blueprint("barangays", __name__)

# GET /api/barangays
@barangay_bp.route("/", methods=["GET"])
def list_barangays():
    result = get_all_barangays()
    return jsonify({"data": result, "total": len(result)}), 200

# GET /api/barangays/<id>
@barangay_bp.route("/<int:barangay_id>", methods=["GET"])
def get_barangay(barangay_id):
    result = get_barangay_by_id(barangay_id)
    if not result:
        return jsonify({"error": "Barangay not found"}), 404
    return jsonify(result), 200