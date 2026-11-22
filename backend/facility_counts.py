"""Count the listed facilities (schools, evacuation centres) in each barangay.

Capacity = "resources per barangay, like evacuation center, school,
flashlight, ambulance" (Sir Shem). CBMS has no per-barangay count of schools
or evacuation centres, so they are counted from the facility locations the
map uses (facility_reference.json) by point-in-polygon against the barangay
boundaries. Shared by run_domain_pipeline.py and the /capacity route so both
use exactly the same numbers.
"""
import json
import os
import re
import unicodedata

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
FACILITY_FILE = os.path.join(HERE, "facility_reference.json")
BOUNDARIES = os.path.join(HERE, "..", "data", "geojson", "barangay_boundaries.geojson")
KINDS = {"schools": "facility_schools", "evacuation_centers": "facility_evacuation_centers"}


def brgy_key(name):
    """'Bgy. 13 Pob.' / 'Barangay 13' -> '13'; 'Sto Niño' / 'Santo Niño' -> 'santo nino'."""
    n = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    m = re.search(r"\d+", n)
    if m and ("bgy" in n or "barangay" in n or "brgy" in n):
        return m.group(0)
    n = re.sub(r"[^a-z ]", " ", n)
    return " ".join({"sta": "santa", "sto": "santo"}.get(w, w) for w in n.split())


def facilities_by_barangay():
    """{barangay key: {"schools": [...], "evacuation_centers": [...]}}"""
    from shapely.geometry import Point, shape
    with open(FACILITY_FILE, encoding="utf-8") as f:
        ref = json.load(f)
    with open(BOUNDARIES, encoding="utf-8") as f:
        polys = [(brgy_key(ft["properties"].get("Barangay_n")), shape(ft["geometry"]))
                 for ft in json.load(f)["features"]]
    out = {}
    for kind in KINDS:
        for fac in ref.get(kind, []):
            p = Point(fac["lng"], fac["lat"])
            for key, poly in polys:
                if poly.covers(p):
                    out.setdefault(key, {k: [] for k in KINDS})[kind].append(
                        {k: fac[k] for k in ("name", "level") if k in fac})
                    break
    return out


def add_facility_counts(barangay_record: pd.DataFrame) -> pd.DataFrame:
    """Return a copy with facility_schools / facility_evacuation_centers counts."""
    out = barangay_record.copy()
    fac = facilities_by_barangay()
    keys = out["barangay"].map(brgy_key)
    for kind, col in KINDS.items():
        out[col] = keys.map(lambda k: len(fac.get(k, {}).get(kind, []))).astype(int)
    return out
