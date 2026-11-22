"""
System settings changed from the app.

    GET    /api/settings/gemini        which key is in use (masked), where it comes from
    PUT    /api/settings/gemini        {"api_key": "..."}  check it with Google, then save it
    DELETE /api/settings/gemini        remove the saved key (the startup key is used again)
    POST   /api/settings/gemini/test   {"api_key": optional} one tiny request: works / quota used up / invalid
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

import gemini_settings as gs
from config import Config

settings_bp = Blueprint("settings", __name__)


def _state():
    key = gs.api_key()
    return {
        "configured": bool(key),
        "source": gs.source(),               # "settings" | "startup" | None
        "masked": gs.mask(key),
        "startup_key": gs.mask(Config.GEMINI_API_KEY or ""),
    }


@settings_bp.route("/gemini", methods=["GET"])
@jwt_required()
def gemini_get():
    return jsonify(_state()), 200


@settings_bp.route("/gemini", methods=["PUT"])
@jwt_required()
def gemini_put():
    key = ((request.get_json(silent=True) or {}).get("api_key") or "").strip()
    if not key:
        return jsonify({"error": "Paste an API key first."}), 400
    if len(key) > 200 or any(c.isspace() for c in key):
        return jsonify({"error": "That does not look like a Gemini API key."}), 400
    ok, status, msg = gs.check_key(key, use_quota=False)
    if not ok and status != "offline":
        return jsonify({"error": msg, "status": status}), 400
    try:
        gs.save_key(key)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Could not save the key: {e}"}), 500
    note = "Saved. The AI features use this key from now on." if ok else \
        "Saved, but it could not be checked (no internet connection). It will be used when the connection is back."
    return jsonify({**_state(), "message": note, "status": status}), 200


@settings_bp.route("/gemini", methods=["DELETE"])
@jwt_required()
def gemini_delete():
    gs.save_key("")
    st = _state()
    msg = ("Removed. The key given at startup is used again." if st["configured"]
           else "Removed. The AI features are off until a key is added.")
    return jsonify({**st, "message": msg}), 200


@settings_bp.route("/gemini/test", methods=["POST"])
@jwt_required()
def gemini_test():
    key = ((request.get_json(silent=True) or {}).get("api_key") or "").strip() or gs.api_key()
    if not key:
        return jsonify({"ok": False, "status": "missing", "message": "No API key is set."}), 200
    ok, status, msg = gs.check_key(key, use_quota=True)
    return jsonify({"ok": ok, "status": status, "message": msg}), 200
