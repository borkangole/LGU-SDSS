"""
Accuracy check for "Ask the Data".

Each item is a question with a hand-written "gold" SQL query whose result is
the correct answer. The check asks the question through the real pipeline
(ready-made library, or the AI planner for free-typed questions) and compares
the answer with the gold result:

* when both results list barangays -> the SET of barangays must match
  (order and extra columns don't matter);
* otherwise -> the gold result's first number must appear in the answer's
  first row (within 1%).

Run it from the Ask the Data page ("Check accuracy") or from a shell:
    python nlp_benchmark.py            # library items only (offline)
    python nlp_benchmark.py --ai       # also the AI items (needs internet + key)
The AI items use about 2-3 Gemini calls each, so the full check uses ~35
calls of the free daily quota.
"""
import re
import sys
import time

V, C, H, T, P = ("vw_barangay_vulnerability", "vw_barangay_capacity", "vw_hazard_exposure",
                 "vw_household_typology", "vw_barangay_priority")

# (question, gold sql, path) -- path "library" = answered without AI, "ai" = free-typed.
ITEMS = [
    ("Which 5 barangays have the highest SVI score?", f"SELECT barangay FROM {V} ORDER BY svi_score DESC LIMIT 5", "library"),
    ("Which barangays are in the High SVI tier?", f"SELECT barangay FROM {V} WHERE svi_rank <= 6", "library"),
    ("Which barangays have the highest food insecurity rate?", f"SELECT barangay FROM {V} ORDER BY food_insecure_pct DESC LIMIT 5", "library"),
    ("Which barangay is farthest from the RHU?", f"SELECT barangay FROM {V} ORDER BY rhu_median_km DESC LIMIT 1", "library"),
    ("Which barangays have more than 50% of households beyond 2km of the RHU?", f"SELECT barangay FROM {V} WHERE rhu_pct_beyond_2km > 50", "library"),
    ("Which barangays have the lowest capacity score?", f"SELECT barangay FROM {C} ORDER BY capacity_score ASC LIMIT 5", "library"),
    ("Which barangays are best equipped?", f"SELECT barangay FROM {C} ORDER BY capacity_score DESC LIMIT 5", "library"),
    ("Which barangays are in the Low capacity tier?", f"SELECT barangay FROM {C} WHERE capacity_rank >= 19", "library"),
    ("Which barangays have no evacuation map?", f"SELECT barangay FROM {C} WHERE COALESCE(has_evacuation_map,0) = 0", "library"),
    ("Which barangays have no ambulance?", f"SELECT barangay FROM {C} WHERE COALESCE(ambulances,0) = 0", "library"),
    ("Which barangays did not hold a preparedness seminar?", f"SELECT barangay FROM {C} WHERE COALESCE(held_preparedness_seminar,0) = 0", "library"),
    ("How many ambulances are there in total?", f"SELECT SUM(ambulances) FROM {C}", "library"),
    ("What is the average SVI score?", f"SELECT ROUND(AVG(svi_score),2) FROM {V}", "library"),
    ("Which barangays are most exposed to flood hazard?", f"SELECT barangay FROM {H} ORDER BY flood_high_or_very_high_pct_total DESC LIMIT 5", "library"),
    ("Which barangays have the most households in flood zones?", f"SELECT barangay FROM {H} ORDER BY flood_high_or_very_high_households DESC LIMIT 5", "library"),
    ("Which barangays are flagged in all three domains?", f"SELECT barangay FROM {P} WHERE domains_flagged = 3", "library"),
    ("Which barangays are flagged in two or more domains?", f"SELECT barangay FROM {P} WHERE domains_flagged >= 2", "library"),
    ("What is the capacity score of San Jose?", f"SELECT capacity_score FROM {C} WHERE barangay = 'San Jose'", "library"),
    # free-typed -> AI planner
    ("Which barangays have a high SVI but low capacity?",
     f"SELECT v.barangay FROM {V} v JOIN {C} c ON c.psgc_10d = v.psgc_10d WHERE v.svi_rank <= 12 AND c.capacity_rank >= 13", "ai"),
    ("Which flood-exposed barangays have no evacuation map?",
     f"SELECT h.barangay FROM {H} h JOIN {C} c ON c.psgc_10d = h.psgc_10d WHERE h.flood_high_or_very_high_pct_total >= 25 AND COALESCE(c.has_evacuation_map,0) = 0", "ai"),
    ("Which barangays have more than 30% food insecurity and no hazard map?",
     f"SELECT v.barangay FROM {V} v JOIN {C} c ON c.psgc_10d = v.psgc_10d WHERE v.food_insecure_pct > 30 AND COALESCE(c.has_hazard_map,0) = 0", "ai"),
    ("What percentage of all households in San Miguel are in a high flood zone?",
     f"SELECT ROUND(SUM(flood_high_or_very_high_households)*100.0/SUM(households),2) FROM {H}", "ai"),
    ("Which barangays in the top 6 SVI did not conduct a preparedness seminar?",
     f"SELECT v.barangay FROM {V} v JOIN {C} c ON c.psgc_10d = v.psgc_10d WHERE v.svi_rank <= 6 AND COALESCE(c.held_preparedness_seminar,0) = 0", "ai"),
    ("Compare the SVI rank of Sto. Angel and San Jose",
     f"SELECT barangay FROM {V} WHERE barangay IN ('Santo Angel','San Jose')", "ai"),
    ("In which barangays is Compounded deprivation the most common household profile?",
     f"SELECT barangay FROM {T} WHERE is_dominant_cluster = 1 AND cluster_id = 4", "ai"),
    ("Which barangays have both a hazard map and an evacuation map?",
     f"SELECT barangay FROM {C} WHERE has_hazard_map = 1 AND has_evacuation_map = 1", "ai"),
    ("How many seniors live in barangays with a High SVI tier?",
     f"SELECT SUM(senior_count) FROM {V} WHERE svi_rank <= 6", "ai"),
    ("Which barangays have at least 20% of households in a moderate or high landslide zone and low capacity?",
     f"SELECT h.barangay FROM {H} h JOIN {C} c ON c.psgc_10d = h.psgc_10d WHERE h.landslide_moderate_or_high_pct_total >= 20 AND c.capacity_rank >= 13", "ai"),
    ("List barangays where weak roof housing is above 10% and the fire station is more than 2 km away for most households",
     f"SELECT barangay FROM {V} WHERE weak_roof_pct > 10 AND fire_pct_beyond_2km > 50", "ai"),
    ("Which barangays have no generator and no ambulance?",
     f"SELECT barangay FROM {C} WHERE COALESCE(generators,0) = 0 AND COALESCE(ambulances,0) = 0", "ai"),
]


def _first_number(row):
    for v in (row or {}).values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return None


def _norm(name):
    return re.sub(r"\s+", " ", str(name or "")).strip().lower()


def compare(answer, gold_cols, gold_rows):
    """(passed, reason) for one answer dict from NLPDatabaseEngine.ask."""
    data = answer.get("data") or []
    if answer.get("sections"):            # profile answers have no single table
        data = (answer["sections"][0].get("data") or [])
    if gold_cols and gold_cols[0] == "barangay" or (gold_cols and gold_cols[0].endswith(".barangay")):
        want = {_norm(r[gold_cols[0]]) for r in gold_rows}
        if not data or "barangay" not in data[0]:
            return False, "the answer did not list barangays"
        got = {_norm(r["barangay"]) for r in data}
        if got == want:
            return True, f"same {len(want)} barangay(s)"
        missing, extra = sorted(want - got), sorted(got - want)
        why = []
        if missing:
            why.append("missing " + ", ".join(missing[:5]))
        if extra:
            why.append("extra " + ", ".join(extra[:5]))
        return False, "; ".join(why)
    want = _first_number(gold_rows[0] if gold_rows else None)
    if want is None:
        return False, "the reference query returned nothing"
    nums = [v for v in (data[0].values() if data else []) if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if any(abs(v - want) <= max(0.01 * abs(want), 0.05) for v in nums):
        return True, f"value {want:g} matches"
    return False, f"expected {want:g}, got {', '.join(f'{v:g}' for v in nums) or 'no number'}"


def run_item(engine, index):
    q, gold_sql, path = ITEMS[index]
    t0 = time.time()
    cols, rows = engine.db.run(gold_sql)
    cols = ["barangay" if c.endswith("barangay") else c for c in cols]
    rows = [{("barangay" if k.endswith("barangay") else k): v for k, v in r.items()} for r in rows]
    answer = engine.ask(q)
    ok, reason = compare(answer, cols, rows)
    unavailable = bool(answer.get("warnings")) and answer.get("source") is None and not answer.get("data")
    return {
        "index": index, "question": q, "expected_path": path,
        "answered_by": answer.get("source"), "passed": ok and not unavailable,
        "skipped": unavailable, "reason": ("AI unavailable: " + answer["warnings"][0]) if unavailable else reason,
        "sql": answer.get("sql"), "seconds": round(time.time() - t0, 2),
    }


if __name__ == "__main__":
    from nlp_db import NLPDatabaseEngine
    eng = NLPDatabaseEngine()
    use_ai = "--ai" in sys.argv
    passed = total = 0
    for i, (q, _, path) in enumerate(ITEMS):
        if path == "ai" and not use_ai:
            continue
        r = run_item(eng, i)
        total += 0 if r["skipped"] else 1
        passed += 1 if r["passed"] else 0
        print(("PASS " if r["passed"] else "SKIP " if r["skipped"] else "FAIL ") + f"[{r['answered_by']}] {q}  -- {r['reason']}")
        if path == "ai":
            time.sleep(4)   # stay under the free tier's requests-per-minute
    print(f"\n{passed}/{total} correct")
