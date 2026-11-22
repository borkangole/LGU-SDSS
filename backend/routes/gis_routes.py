import json
import os
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

gis_bp = Blueprint("gis", __name__)

# ── Existing route — barangay boundaries ──────────────────
@gis_bp.route("/api/gis/barangays")
@jwt_required()
def get_barangays():
    path = os.path.join(
        os.path.dirname(__file__),
        "../../data/geojson/barangay_boundaries.geojson"
    )
    with open(path, "r", encoding="utf-8") as f:
        return jsonify(json.load(f))

# ✅ New route — roads ─────────────────────────────────────
@gis_bp.route("/api/gis/roads")
@jwt_required()
def get_roads():
    path = os.path.join(
        os.path.dirname(__file__),
        "../../data/geojson/roads.geojson"
    )
    with open(path, "r", encoding="utf-8") as f:
        return jsonify(json.load(f))