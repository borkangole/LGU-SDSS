"""
Low-level, shared Gemini REST caller -- the retry/backoff/error-handling
logic used by BOTH AI features in this app:
  - gemini_explainer.py  (barangay "How This Was Calculated" AI summary)
  - nlp_db.py             (NLP-to-DB query planner + result explainer)

Kept as its own module (not duplicated in each feature) so the fix that
was needed here once (thinkingBudget: 0, retry-on-503/429, model-name
constant) never has to be found and re-applied twice.

Uses the plain REST endpoint via `requests` -- no google-genai SDK
dependency. See gemini_explainer.py's module docstring for why: this
pattern was already tested working end-to-end in this project (model
name, thinking-budget fix, retry behaviour all verified against the
real API), and swapping to a new SDK now would mean re-verifying all of
that from scratch with no benefit for what this app needs (single
request/response calls, never a multi-turn chat).
"""
import os
import time
import requests
from config import Config

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")  # first choice; override in backend/.env
# NOTE: Google retires/renames Gemini model IDs over time (gemini-2.5-flash
# was retired for new users as of testing this in Sep 2026). If the first
# choice is overloaded (503), retired (404) or out of free quota (429), the
# client now moves on to the next model automatically -- see _model_chain().
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_URL = f"{GEMINI_BASE}/models/{GEMINI_MODEL}:generateContent"  # kept for backwards compatibility

# Models are discovered once per hour via the ListModels endpoint (only
# ones that support generateContent), so the fallback chain never contains
# a hard-coded name Google has since retired.
_MODEL_CACHE = {"at": 0.0, "models": []}
_MODEL_CACHE_SECONDS = 3600
_SKIP_WORDS = ("image", "tts", "audio", "live", "embedding", "embed", "aqa", "veo", "imagen", "robotics", "computer-use", "learnlm", "gemma")


def _discover_models(api_key):
    """Flash-family models this key can call, newest name first."""
    now = time.time()
    if _MODEL_CACHE["models"] and now - _MODEL_CACHE["at"] < _MODEL_CACHE_SECONDS:
        return _MODEL_CACHE["models"]
    found = []
    try:
        resp = requests.get(
            f"{GEMINI_BASE}/models", headers={"x-goog-api-key": api_key},
            params={"pageSize": 200}, timeout=10,
        )
        resp.raise_for_status()
        for m in resp.json().get("models", []):
            name = (m.get("name") or "").replace("models/", "")
            if "generateContent" not in (m.get("supportedGenerationMethods") or []):
                continue
            if "flash" not in name or any(w in name for w in _SKIP_WORDS):
                continue
            found.append(name)
    except Exception:
        found = []
    # stable names before -preview/-exp/dated ones, then newest version first
    found.sort(key=lambda n: (any(t in n for t in ("preview", "exp")), tuple(-ord(c) for c in n)))
    if found:
        _MODEL_CACHE.update(at=now, models=found)
    return found


def _model_chain(api_key):
    chain = [GEMINI_MODEL]
    for name in _discover_models(api_key)[:4]:
        if name not in chain:
            chain.append(name)
    return chain


# Free-tier Flash models occasionally return 503 "currently experiencing
# high demand" -- transient, usually clears within seconds, so that one
# is worth a couple of short-backoff retries.
#
# 429 is NOT retried (as of the free-tier quota test on 2026-09-18): the
# free tier's generate_content_free_tier_requests limit is a per-day
# quota (currently 20 requests/day for gemini-3.6-flash), not a
# per-minute rate limit -- a 1-3s backoff can never clear it, so retrying
# only adds several seconds of dead wait before the same 429 comes back.
# Failing fast on 429 keeps the UI responsive; see the quota-aware
# message built below for what the person actually sees.
RETRYABLE_STATUS = {503}
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = [1, 3]  # delay before attempt 2, then attempt 3


def _error_message(resp):
    try:
        return (resp.json().get("error", {}) or {}).get("message", "") or ""
    except Exception:
        return (getattr(resp, "text", "") or "")[:200]


def _schema_as_text(schema):
    """The JSON shape written out in words, for a model that rejects responseSchema."""
    props = (schema or {}).get("properties", {})
    keys = []
    for k, v in props.items():
        extra = f" (one of: {', '.join(v['enum'])})" if v.get("enum") else ""
        desc = f" -- {v['description']}" if v.get("description") else ""
        keys.append(f'"{k}": {v.get("type", "string")}{extra}{desc}')
    return ("Reply with ONLY one JSON object, no markdown, with exactly these keys:\n" + "\n".join(keys))


def _strip_fences(text):
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip()


def call_gemini(system_instruction, user_text, generation_config=None, response_schema=None):
    """
    One request/response call to Gemini. Never raises -- returns (data, error)
    where exactly one is None. On success, `data` is the parsed JSON response
    body's first candidate's text (a string), UNLESS response_schema was
    given, in which case Gemini is asked to return JSON matching that schema
    and `data` is the already-json.loads()'d dict/list.

    generation_config: dict merged into the request's generationConfig
    (temperature, maxOutputTokens, etc.) -- thinkingConfig.thinkingBudget=0
    is always applied underneath unless the caller's config overrides it,
    since every current use of this app is a single narrow structured task,
    never open-ended reasoning that benefits from Gemini's "thinking" pass.
    """
    from gemini_settings import api_key as _current_key
    api_key = _current_key()   # settings page key first, then the startup key
    if not api_key:
        return None, (
            "The AI feature has no Gemini API key yet. Add one in Account Settings "
            "> Gemini API key (free from https://aistudio.google.com/apikey)."
        )

    gen_config = {"temperature": 0.3, "maxOutputTokens": 1024, "thinkingConfig": {"thinkingBudget": 0}}
    if generation_config:
        gen_config.update(generation_config)
    if response_schema:
        gen_config["responseMimeType"] = "application/json"
        gen_config["responseSchema"] = response_schema

    body = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
        "generationConfig": gen_config,
    }

    # Try each model in turn. 503 (overloaded) is retried briefly on the
    # same model; 404 (retired), 429 (this model's free quota is used up) and
    # a still-overloaded 503 fall through to the NEXT model, since free-tier
    # quotas and demand are tracked per model.
    #
    # 400 "Request contains an invalid argument": some models reject one of
    # the optional request features (the no-thinking setting, or the JSON
    # response schema) with this generic message. Instead of giving up, the
    # same model is asked again in a simpler form -- first without the
    # thinking setting, then without the schema (the keys are written into
    # the instructions instead) -- and only then the next model is tried.
    last_error = None
    quota_hit = False
    headers = {"x-goog-api-key": api_key}
    for model in _model_chain(api_key):
        url = f"{GEMINI_BASE}/models/{model}:generateContent"
        cfg = dict(gen_config)
        sys_text = system_instruction
        busy_tries = 0
        simplify_tries = 0
        while True:
            try:
                payload = dict(body, generationConfig=cfg,
                               system_instruction={"parts": [{"text": sys_text}]})
                resp = requests.post(url, headers=headers, json=payload, timeout=25)
                if resp.status_code == 400:
                    msg = _error_message(resp)
                    if "api key" in msg.lower():
                        return None, f"Gemini rejected the API key: {msg} Change it in Account Settings > Gemini API key."
                    if "thinkingConfig" in cfg and simplify_tries < 2:
                        cfg = {k: v for k, v in cfg.items() if k != "thinkingConfig"}
                        simplify_tries += 1
                        continue
                    if "responseSchema" in cfg and simplify_tries < 2:
                        schema = cfg.pop("responseSchema")
                        cfg = dict(cfg)
                        sys_text = system_instruction + "\n\n" + _schema_as_text(schema)
                        simplify_tries += 1
                        continue
                    last_error = f"Gemini model {model} rejected the request (400: {msg or 'invalid argument'})."
                    break  # next model
                if resp.status_code == 503:
                    last_error = f"Gemini is busy right now ({model}, 503)."
                    busy_tries += 1
                    if busy_tries < MAX_ATTEMPTS:
                        time.sleep(BACKOFF_SECONDS[min(busy_tries, len(BACKOFF_SECONDS)) - 1])
                        continue
                    break  # next model
                if resp.status_code == 404:
                    last_error = f"Gemini model {model} is no longer available."
                    break
                if resp.status_code == 429:
                    quota_hit = True
                    last_error = "Gemini's free daily quota for this API key has been used up."
                    break
                resp.raise_for_status()
                data = resp.json()
                candidates = data.get("candidates") or []
                if not candidates:
                    return None, "Gemini returned no candidates (the request may have been blocked by a safety filter)."
                parts = candidates[0].get("content", {}).get("parts", [])
                text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                if not text:
                    finish_reason = candidates[0].get("finishReason", "unknown")
                    return None, f"Gemini returned an empty response (finishReason: {finish_reason})."
                if response_schema:
                    import json
                    try:
                        return json.loads(_strip_fences(text)), None
                    except json.JSONDecodeError as e:
                        last_error = f"Gemini returned malformed JSON: {e}"
                        break
                return text, None
            except requests.exceptions.Timeout:
                last_error = "Gemini API request timed out."
                busy_tries += 1
                if busy_tries < MAX_ATTEMPTS:
                    continue
                break
            except requests.exceptions.ConnectionError:
                return None, "No internet connection to Google's Gemini service."
            except requests.exceptions.HTTPError as e:
                detail = _error_message(e.response)
                if e.response.status_code in (401, 403):
                    return None, f"Gemini rejected the API key ({e.response.status_code}): {detail or 'check the key'}. Change it in Account Settings > Gemini API key."
                return None, f"Gemini API error ({e.response.status_code}): {detail or str(e)}"
            except Exception as e:
                return None, f"Gemini API call failed: {e}"

    if quota_hit and not last_error.startswith("Gemini is busy"):
        return None, (
            "Gemini's free daily quota for this API key has been used up on every "
            "available model. This is a limit from Google, not a bug -- it resets "
            "on its own. To continue now, paste another key in Account Settings > "
            "Gemini API key."
        )
    return None, (last_error or "Gemini API call failed") + " Please try again in a moment."
