import re
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from models.barangay import get_conn

search_bp = Blueprint("search", __name__)

# Omni Search backend. Finds barangays, households (by household number) and
# residents (by name). Every word typed must appear somewhere in the field,
# in any order, so "perocho aubrey" finds "AUBREY GALE MANDAR PEROCHO".
# Pages, features and indicators are searched in the browser, not here.

_ALIASES = [("santo", "sto"), ("santa", "sta"), ("niño", "nino"), ("ñ", "n")]
_SKIP = {"brgy", "brgy.", "bgy", "barangay", "hh", "household"}


def _words(q):
    q = q.lower()
    for a, b in _ALIASES:
        q = q.replace(a, b)
    out = []
    for w in q.replace(",", " ").replace("-", " ").split():
        w = w.strip(".")
        if w and w not in _SKIP:
            out.append(w)
    return out[:6]


def _all_words(column, words):
    """SQL fragment + params: every word appears in `column` (case-insensitive)."""
    sql = " AND ".join(f"{column} ILIKE %s" for _ in words)
    return sql, [f"%{w}%" for w in words]


def _word_starts(column, words):
    """Every word must begin a word in `column`: "ig" finds "Igtambo", not "Ligutan"."""
    sql = " AND ".join(f"{column} ~* %s" for _ in words)
    return sql, ["\\m" + re.escape(w) for w in words]


def _clean_name(name):
    # CBMS fills empty name parts with "NA"; drop them for display.
    parts = [p for p in (name or "").split() if p.upper() not in ("NA", "N/A")]
    return " ".join(p.capitalize() if p.isupper() else p for p in parts)


@search_bp.route("/search", methods=["GET"])
@jwt_required()
def global_search():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify({"data": []})

    words = _words(q)
    conn = get_conn()
    cur = conn.cursor()
    try:
        results = []

        # Barangays: match on the name with the "Brgy" prefix ignored.
        if words:
            where, params = _word_starts("replace(b.barangay_name, 'ñ', 'n')", words)
            cur.execute(f"""
                SELECT b.barangay_id, b.barangay_name,
                       COUNT(DISTINCT h.household_id) AS households
                FROM tbl_barangays b
                LEFT JOIN tbl_households h ON h.barangay_id = b.barangay_id
                WHERE {where}
                GROUP BY b.barangay_id, b.barangay_name
                ORDER BY length(b.barangay_name), b.barangay_name
                LIMIT 6
            """, params)
            for r in cur.fetchall():
                results.append({
                    "type": "barangay", "id": str(r["barangay_id"]),
                    "title": r["barangay_name"],
                    "subtitle": f"{int(r['households'] or 0):,} households",
                    "barangay": r["barangay_name"],
                })

        # Households: by household number (e.g. "HH101", "san jose 101").
        hh_words = _words(q.replace("HH", " ").replace("hh", " ")) or words
        digits = [w for w in hh_words if any(c.isdigit() for c in w)]
        if digits:
            where, params = _all_words("lower(h.household_number)", hh_words)
            cur.execute(f"""
                SELECT h.household_id, h.household_number, b.barangay_name,
                       h.latitude, h.longitude,
                       COUNT(i.person_id) AS members
                FROM tbl_households h
                LEFT JOIN tbl_barangays   b ON h.barangay_id  = b.barangay_id
                LEFT JOIN tbl_individuals i ON h.household_id = i.household_id
                WHERE {where}
                GROUP BY h.household_id, h.household_number, b.barangay_name, h.latitude, h.longitude
                ORDER BY length(h.household_number), h.household_number
                LIMIT 6
            """, params)
            for r in cur.fetchall():
                results.append({
                    "type": "household", "id": str(r["household_id"]),
                    "title": r["household_number"],
                    "subtitle": f"{r['barangay_name'] or 'No barangay'} · {int(r['members'] or 0)} members",
                    "household_number": r["household_number"],
                    "barangay": r["barangay_name"],
                    "latitude": r["latitude"], "longitude": r["longitude"],
                })

        # Residents: by name, every word in any order.
        # Names use the words exactly as typed (no Santo->Sto aliasing).
        name_words = [w.strip(".,") for w in q.lower().split()]
        name_words = [w for w in name_words if len(w) >= 2 and not any(c.isdigit() for c in w)][:6]
        if name_words:
            where, params = _word_starts("i.full_name", name_words)
            cur.execute(f"""
                SELECT i.person_id, i.full_name, h.household_id, h.household_number,
                       h.latitude, h.longitude, b.barangay_name
                FROM tbl_individuals i
                JOIN tbl_households h     ON i.household_id = h.household_id
                LEFT JOIN tbl_barangays b ON h.barangay_id  = b.barangay_id
                WHERE {where}
                ORDER BY i.full_name
                LIMIT 8
            """, params)
            for r in cur.fetchall():
                results.append({
                    "type": "member", "id": str(r["household_id"]),
                    "person_id": r["person_id"],
                    "title": _clean_name(r["full_name"]),
                    "subtitle": r["household_number"],
                    "household_number": r["household_number"],
                    "barangay": r["barangay_name"],
                    "latitude": r["latitude"], "longitude": r["longitude"],
                })

        return jsonify({"data": results})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        cur.close()
        conn.close()
