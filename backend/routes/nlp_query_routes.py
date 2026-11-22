"""
NLP-to-DB Query routes -- Sir Shem's second suggestion
(NLP_TO_DB_INTEGRATION_SKILL.md): a constrained natural-language query
layer over the isolated analytical database (data/nlp_analytics.sqlite),
NOT a free chat feature.

Thin Flask wrapper around nlp_db.NLPDatabaseEngine -- all the actual
planning/validation/execution/explanation logic lives there (framework-
independent, per the skill doc's "integration boundary" guidance). This
file only turns HTTP requests into .ask(question) calls and JSON
responses.

Two endpoints:
  POST /api/nlp-query/ask        {"question": "..."} -> engine result
  GET  /api/nlp-query/examples   -> ~12 example questions grounded in
                                     the real schema, for the frontend's
                                     example chips

Both fail soft (200 with warnings, not 500) whenever possible, matching
the rest of this app's AI-feature pattern (gemini_explainer.py) -- a
misconfigured API key or an unbuildable database should degrade to a
clear message, not break the page.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from nlp_db import NLPDatabaseEngine
import nlp_questions

nlp_query_bp = Blueprint("nlp_query", __name__)

_engine = NLPDatabaseEngine()

# The example questions live in nlp_questions.EXAMPLE_GROUPS (grouped by
# domain: SVI / Barangay Capacity / Hazard / Household profiles / Priority).
# Every one of them is answered by the ready-made library WITHOUT Gemini, so
# they keep working offline or when Gemini is busy or out of free quota.
EXAMPLE_QUESTIONS = [q for g in nlp_questions.EXAMPLE_GROUPS for q in g["questions"]]


@nlp_query_bp.route("/ask", methods=["POST"])
@jwt_required()  # household answers include names -- logged-in users only
def nlp_query_ask():
    body = request.get_json(silent=True) or {}
    question = (body.get("question") or "").strip()
    result = _engine.ask(question)
    return jsonify(result), 200


@nlp_query_bp.route("/examples", methods=["GET"])
@jwt_required()
def nlp_query_examples():
    groups = list(nlp_questions.EXAMPLE_GROUPS)
    try:
        groups.append(_engine.household_examples())
    except Exception:
        pass  # database unavailable -> barangay questions still work
    examples = [q for g in groups for q in g["questions"]]
    return jsonify({"examples": examples, "groups": groups}), 200


# ── Accuracy check: questions with known correct answers, asked through
#    the real pipeline one at a time so the page can show progress. ──
import nlp_benchmark  # noqa: E402


@nlp_query_bp.route("/accuracy-check", methods=["GET"])
@jwt_required()
def nlp_accuracy_items():
    return jsonify({"items": [{"index": i, "question": q, "path": p}
                              for i, (q, _, p) in enumerate(nlp_benchmark.ITEMS)]}), 200


@nlp_query_bp.route("/accuracy-check/<int:index>", methods=["POST"])
@jwt_required()
def nlp_accuracy_run(index):
    if index < 0 or index >= len(nlp_benchmark.ITEMS):
        return jsonify({"error": "No such check."}), 404
    try:
        return jsonify(nlp_benchmark.run_item(_engine, index)), 200
    except Exception as e:
        return jsonify({"index": index, "passed": False, "skipped": False, "reason": f"Check failed to run: {e}"}), 200
