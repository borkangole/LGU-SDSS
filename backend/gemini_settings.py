"""
Which Gemini API key the AI features use, and changing it from the app.

The key can come from two places:
  1. Settings page (Account Settings > AI / Gemini key): saved in the
     database, table tbl_system_settings, key 'gemini_api_key'. Wins when set.
  2. Startup: GEMINI_API_KEY from backend/.env, or the key typed in the
     desktop launcher window. Used when no key is saved in the settings.

So when the free daily quota of one key runs out, a user can paste another
key in the settings and the AI features use it straight away, with no
restart. The full key is never sent back to the browser (only the last 4
characters).
"""
import threading
import time

import psycopg2
import requests

from config import Config

SETTING = "gemini_api_key"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
_CACHE = {"at": 0.0, "key": None}
_TTL = 30          # seconds; a key saved here is picked up immediately (cache cleared)
_LOCK = threading.Lock()


def _conn():
    return psycopg2.connect(Config.get_connection_string())


def saved_key():
    """The key saved in the settings page, or None."""
    with _LOCK:
        if time.time() - _CACHE["at"] < _TTL:
            return _CACHE["key"]
    key = None
    try:
        conn = _conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM tbl_system_settings WHERE key = %s", (SETTING,))
            row = cur.fetchone()
            key = (row[0] or "").strip() or None if row else None
        finally:
            conn.close()
    except Exception:  # noqa: BLE001 -- database down: fall back to the startup key
        key = None
    with _LOCK:
        _CACHE.update(at=time.time(), key=key)
    return key


def api_key():
    """The key the AI features should use right now ('' when none)."""
    return saved_key() or (Config.GEMINI_API_KEY or "")


def source():
    if saved_key():
        return "settings"
    if Config.GEMINI_API_KEY:
        return "startup"
    return None


def mask(key):
    return f"…{key[-4:]}" if key else None


def save_key(key):
    key = (key or "").strip()
    conn = _conn()
    try:
        cur = conn.cursor()
        if key:
            cur.execute("""
                INSERT INTO tbl_system_settings (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (SETTING, key))
        else:
            cur.execute("DELETE FROM tbl_system_settings WHERE key = %s", (SETTING,))
        conn.commit()
    finally:
        conn.close()
    with _LOCK:
        _CACHE.update(at=time.time(), key=key or None)


def check_key(key, use_quota=False):
    """Ask Google whether a key works. Returns (ok, status, message).

    use_quota=False lists the models (does not use any of the daily quota):
    tells whether the key is valid. use_quota=True also sends one tiny
    request, so it also tells whether the daily quota is used up.
    """
    key = (key or "").strip()
    if not key:
        return False, "missing", "No API key."
    headers = {"x-goog-api-key": key}
    try:
        r = requests.get(f"{GEMINI_BASE}/models", headers=headers, params={"pageSize": 50}, timeout=12)
    except requests.exceptions.ConnectionError:
        return False, "offline", "No internet connection to Google's Gemini service."
    except requests.exceptions.Timeout:
        return False, "offline", "Google's Gemini service did not answer in time."
    if r.status_code in (400, 401, 403):
        return False, "invalid", "Google did not accept this API key. Check that it was copied completely."
    if r.status_code != 200:
        return False, "error", f"Gemini answered with an error ({r.status_code})."
    if not use_quota:
        return True, "valid", "The key is valid."

    from gemini_client import _model_chain  # same model order the AI features use
    last = None
    for model in _model_chain(key):
        try:
            g = requests.post(
                f"{GEMINI_BASE}/models/{model}:generateContent", headers=headers, timeout=20,
                json={"contents": [{"role": "user", "parts": [{"text": "Reply with OK."}]}],
                      "generationConfig": {"maxOutputTokens": 5, "thinkingConfig": {"thinkingBudget": 0}}},
            )
        except requests.exceptions.RequestException:
            return False, "offline", "No internet connection to Google's Gemini service."
        if g.status_code == 200:
            return True, "working", f"The key works ({model} answered)."
        if g.status_code == 400 and "thinking" in g.text.lower():
            g = requests.post(
                f"{GEMINI_BASE}/models/{model}:generateContent", headers=headers, timeout=20,
                json={"contents": [{"role": "user", "parts": [{"text": "Reply with OK."}]}],
                      "generationConfig": {"maxOutputTokens": 5}},
            )
            if g.status_code == 200:
                return True, "working", f"The key works ({model} answered)."
        last = g.status_code
        if g.status_code in (401, 403):
            return False, "invalid", "Google did not accept this API key."
        # 429 (quota used up for this model), 404 (retired), 503 (busy): try the next model
    if last == 429:
        return False, "quota", ("The daily free quota of this key is used up on every model. "
                                "Paste a different key below, or try again tomorrow.")
    return False, "error", f"No Gemini model answered (last status {last}). Try again in a moment."
