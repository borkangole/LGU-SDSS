"""
CBMS 2024 multi-file import -- see cbms_import.py for what each step does.

    POST /api/import/cbms/preview        multipart, field "files" (the 7 CSVs)
    POST /api/import/cbms/commit         {"token": ..., "remove_missing": true}
    GET  /api/import/cbms/status/<id>    progress of the save + recompute
    GET  /api/import/cbms/latest         the most recent import job, if any
"""
import os
import shutil
import uuid

import psycopg2
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required
from werkzeug.utils import secure_filename

import cbms_import
from config import Config

cbms_import_bp = Blueprint("cbms_import", __name__)

MAX_FILES = 12
ALLOWED = (".csv", ".xlsx", ".xls")


def _conn():
    return psycopg2.connect(Config.get_connection_string())


@cbms_import_bp.route("/preview", methods=["POST"])
@jwt_required()
def preview():
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        return jsonify({"error": "No files were uploaded."}), 400
    if len(files) > MAX_FILES:
        return jsonify({"error": f"Upload at most {MAX_FILES} files."}), 400

    workdir = cbms_import.UPLOAD_ROOT / uuid.uuid4().hex
    workdir.mkdir(parents=True, exist_ok=True)
    saved = {}
    try:
        for i, f in enumerate(files):
            name = f.filename.replace("\\", "/").split("/")[-1]
            if not name.lower().endswith(ALLOWED):
                shutil.rmtree(workdir, ignore_errors=True)
                return jsonify({"error": f"{name}: only .csv, .xlsx or .xls files are accepted."}), 400
            path = workdir / f"{i:02d}_{secure_filename(name) or 'file.csv'}"
            f.save(path)
            saved[name] = str(path)
        conn = _conn()
        try:
            result = cbms_import.preview(saved, workdir, conn)
        finally:
            conn.close()
        if not result.get("ready"):
            shutil.rmtree(workdir, ignore_errors=True)
        return jsonify(result), 200
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(workdir, ignore_errors=True)
        return jsonify({"error": f"Could not read the files: {e}"}), 500


@cbms_import_bp.route("/commit", methods=["POST"])
@jwt_required()
def commit():
    body = request.get_json(silent=True) or {}
    token = body.get("token")
    if not token:
        return jsonify({"error": "Missing preview token."}), 400
    claims = get_jwt() or {}
    try:
        job_id = cbms_import.start_commit(
            token, _conn, remove_missing=bool(body.get("remove_missing", True)),
            user=claims.get("username") or claims.get("sub"),
        )
    except KeyError as e:
        return jsonify({"error": str(e).strip("'\"")}), 410
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 409
    return jsonify({"job_id": job_id}), 202


@cbms_import_bp.route("/status/<job_id>", methods=["GET"])
@jwt_required()
def status(job_id):
    job = cbms_import.job_status(job_id)
    if not job:
        return jsonify({"error": "Unknown import job."}), 404
    return jsonify(job), 200


@cbms_import_bp.route("/latest", methods=["GET"])
@jwt_required()
def latest():
    return jsonify(cbms_import.latest_job() or {}), 200


# ── Import batches (Households page: "Recent Import Batches") ──────────────
@cbms_import_bp.route("/batches", methods=["GET"])
@jwt_required()
def batches():
    import import_batches
    conn = _conn()
    try:
        return jsonify({"batches": import_batches.list_batches(conn)}), 200
    finally:
        conn.close()


@cbms_import_bp.route("/batches/<int:batch_id>", methods=["GET"])
@jwt_required()
def batch_detail(batch_id):
    import import_batches
    conn = _conn()
    try:
        return jsonify({"per_barangay": import_batches.batch_detail(conn, batch_id)}), 200
    finally:
        conn.close()


@cbms_import_bp.route("/batches/<int:batch_id>", methods=["DELETE"])
@jwt_required()
def delete_batch(batch_id):
    import import_batches
    claims = get_jwt() or {}
    try:
        res = import_batches.delete_batch(batch_id, _conn, user=claims.get("username") or claims.get("sub"))
    except KeyError as e:
        return jsonify({"error": str(e).strip("'\"")}), 404
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 409
    return jsonify(res), 200


@cbms_import_bp.route("/data-status", methods=["GET"])
@jwt_required()
def data_status():
    """What the app has to show: households on file, whether the scores have
    been computed, and the import / recalculation running now (if any).
    Used by the banner that guides a fresh installation to the CBMS import."""
    households = None
    try:
        conn = _conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT count(*) FROM tbl_households")
            households = cur.fetchone()[0]
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        pass
    job = cbms_import.latest_job() or {}
    steps = job.get("steps") or []
    running = job.get("state") in ("queued", "running")
    current = next((s for s in steps if s.get("state") == "running"), None)
    return jsonify({
        "households": households,
        "results_ready": (cbms_import.RESULTS_DIR / "vulnerability_scores.csv").exists(),
        "job": {
            "id": job.get("id"), "kind": job.get("kind"), "state": job.get("state"),
            "running": running, "finished": job.get("finished"), "error": job.get("error"),
            "done_steps": sum(1 for s in steps if s.get("state") in ("done", "failed", "skipped")),
            "total_steps": len(steps),
            "current": current.get("label") if current else None,
        } if job else None,
    }), 200
