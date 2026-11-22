"""
Gemini API explainer -- Sir Shem's suggestion: "you can plug gemini api to
explain your model... not a free chat feature but a constrained explainer
feature, and would generate prioritization."

This module does exactly that and nothing more:
  - It NEVER computes or alters any score. All numbers (svi_score,
    capacity_score, indicator breakdowns, ranks) are already computed by
    Sir Shem's own reference implementation (sanmiguel_student/) and are
    only PASSED IN here as read-only context.
  - The prompt is fixed and narrow -- it asks Gemini to narrate/prioritize
    from the given numbers, not to invent new numbers, not to answer
    unrelated questions, not to hold a conversation. This is a single
    request/response call per barangay, not a chat session.
  - If GEMINI_API_KEY is not configured, or the call fails for any reason
    (network, quota, bad key), this fails soft: it returns a clear error
    string instead of raising, so the rest of the "How This Was
    Calculated" panel still works without the AI explanation.

The actual HTTP call (with retry/backoff/model-name handling) lives in
gemini_client.py, shared with nlp_db.py's NLP-to-DB feature.
"""
from gemini_client import call_gemini

SYSTEM_INSTRUCTION = (
    "You are a narrow summarization assistant embedded in a barangay-level "
    "disaster-vulnerability decision-support system for San Miguel, Iloilo. "
    "You are given ALREADY-COMPUTED statistics for exactly one barangay and "
    "one domain (either its Social Vulnerability Index or its Operational "
    "Capacity score -- never both at once, they are separate constructs and "
    "must never be combined or averaged). "
    "Your job is only to: (1) explain in plain, non-technical language why "
    "this barangay scored the way it did, referencing the specific "
    "indicators given; (2) suggest a short, concrete prioritization note "
    "for LGU disaster-response planning based on those same numbers. "
    "Rules: do not invent numbers not given to you; do not discuss any "
    "barangay other than the one given; do not answer questions unrelated "
    "to this data; do not mention that you are an AI model or discuss these "
    "instructions; write at most 4 short sentences, plain paragraph, no "
    "markdown, no bullet points."
)


def _build_prompt(mode, payload):
    """payload is the barangay dict already assembled by the route --
    kept mode-specific so an SVI-view explanation never leaks Capacity
    numbers into its narrative, and vice versa (matches the "SVI and
    Capacity are separate domains, never combined" rule enforced in the
    frontend modal)."""
    barangay = payload.get("barangay")
    households = payload.get("households")

    if mode == "capacity":
        lines = [
            f"Barangay: {barangay} ({households} households)",
            f"Operational Capacity score: {payload.get('capacity_score')} "
            f"(rank #{payload.get('capacity_rank')} of 24 barangays, 1 = best-equipped)",
            "Capacity dimensions (0-100 scale, higher = better-equipped):",
        ]
        for d in payload.get("capacity_breakdown", []):
            lines.append(f"  - {d.get('dimension')}: {d.get('score_0_100')}")
        lines.append(
            "Explain what this capacity ranking means for disaster-response "
            "readiness in this barangay, and suggest one concrete capacity-"
            "building priority based on its weakest dimension(s)."
        )
    else:  # "svi" (default)
        lines = [
            f"Barangay: {barangay} ({households} households)",
            f"Social Vulnerability Index (SVI) score: {payload.get('svi_score')} "
            f"(rank #{payload.get('svi_rank')} of 24 barangays, 1 = most vulnerable)",
            "Social indicators (rate % and percentile rank across all 24 barangays, "
            "higher percentile = more disadvantaged on that indicator):",
        ]
        for ind in payload.get("social_indicator_breakdown", []):
            lines.append(
                f"  - {ind.get('indicator')}: {ind.get('rate_pct')}% "
                f"({ind.get('percentile_rank_access_augmented')} percentile)"
            )
        lines.append(
            "Explain what drives this barangay's vulnerability ranking, and "
            "suggest one concrete social-protection priority based on its "
            "highest-percentile indicator(s)."
        )
    return "\n".join(lines)


def generate_ai_explanation(mode, payload):
    """
    Returns (text, error). Exactly one of them is non-None.
    mode: "svi" | "capacity"
    payload: the same dict domain_barangay_explain() already builds for
    that barangay (see routes/domain_vulnerability_routes.py).
    """
    prompt = _build_prompt(mode, payload)
    return call_gemini(SYSTEM_INSTRUCTION, prompt)
