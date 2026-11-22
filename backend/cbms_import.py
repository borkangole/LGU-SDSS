"""
cbms_import.py -- one-step import of the 7 CBMS 2024 files.

The user uploads the seven CSV files exactly as the PSA/CBMS export gives
them (any file names, any order):

    cbms_household_record.csv                one row per household
    cbms_person_record.csv                   one row per household member
    cbms_barangay_record.csv                 one row per barangay (Form 5)
    cbms_barangay_record_list.csv            puroks/sitios listed per barangay
    cbms_interview_record.csv                interview visits per household
    cbms_household_record_child_mortality.csv
    cbms_person_record_tvet.csv

What happens:

  1. detect_files()   -- each file is recognised by its columns, not its name.
  2. check_alignment() -- the files are lined up on their uuid keys
     (household uuid for the household-side files, barangay uuid / geo code
     for the barangay-side files) and every mismatch is counted.
  3. build_tables()   -- raw CBMS codes become the household and member rows
     the system stores (labels, counts, ratios, hazard
     exposure from the coordinates, household typology).
  4. write_to_database() -- one transaction. Households are matched on the
     CBMS uuid (tbl_households.uid_internal): a household already in the
     system keeps its ID and "Brgy X - HHn" code and gets its data updated,
     a new one gets the next code for its barangay, and (optionally) a
     household that is no longer in the files is removed.
  5. recompute()      -- every score is rebuilt from the new data: the domain
     pipeline (SVI, capacity, hazard by barangay), facility distance,
     Capacity + Distance, household typology files, family network, the
     legacy household index, and the Ask the Data views.

Only step 4 changes the database, and it rolls back completely on any error.
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import uuid as uuidlib
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import cbms_codebook as CB

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
RESULTS_DIR = DATA_DIR / "domain_pipeline_results"
GEOJSON_DIR = DATA_DIR / "geojson"
UPLOAD_ROOT = DATA_DIR / "imports"
TYPOLOGY_REF = BACKEND_DIR / "typology_reference_k5.json"

RHU_POINT = (10.7815, 122.4647)     # (lat, lon) -- same constants as the map page
FIRE_POINT = (10.7869, 122.4683)
HAZARD_BUFFER_METERS = 11.10        # hazard_engine.py
METRIC_CRS = "EPSG:32651"

# CBMS barangay name -> tbl_barangays.barangay_name (import_cbms2024_v2.py)
BARANGAY_NAME_MAP = {
    "Bgy. 1 Pob.": "Brgy 1", "Bgy. 2 Pob.": "Brgy 2", "Bgy. 3 Pob.": "Brgy 3",
    "Bgy. 4 Pob.": "Brgy 4", "Bgy. 5 Pob.": "Brgy 5", "Bgy. 6 Pob.": "Brgy 6",
    "Bgy. 7 Pob.": "Brgy 7", "Bgy. 8 Pob.": "Brgy 8", "Bgy. 9 Pob.": "Brgy 9",
    "Bgy. 10": "Brgy 10", "Bgy. 11 Pob.": "Brgy 11", "Bgy. 12 Pob.": "Brgy 12",
    "Bgy. 13 Pob.": "Brgy 13", "Bgy. 14 Pob.": "Brgy 14", "Bgy. 15 Pob.": "Brgy 15",
    "Bgy. 16 Pob.": "Brgy 16", "Consolacion": "Brgy Consolacion",
    "Igtambo": "Brgy Igtambo", "San Antonio": "Brgy San Antonio",
    "San Jose": "Brgy San Jose", "Santa Cruz": "Brgy Sta Cruz",
    "Santa Teresa": "Brgy Sta Teresa", "Santo Angel": "Brgy Sto Angel",
    "Santo Niño": "Brgy Sto Nino",
}

# ════════════════════════════════════════════════════════════════════
# 1. FILE DETECTION
# ════════════════════════════════════════════════════════════════════
# Checked in order; the first rule whose columns are all present wins.
FILE_KINDS = [
    # key, label, required columns, columns that must be absent
    ("tvet", "Person TVET courses", {"uuid", "line_number", "d09_tvet_course"}, set()),
    ("child_mortality", "Child mortality", {"uuid", "f08_age_of_child_died"}, set()),
    ("interview", "Interview visits", {"uuid", "visit_number", "result_of_visit"}, set()),
    ("barangay_list", "Barangay lists (puroks / sitios)",
     {"uuid", "barangay_geo_code", "line_number", "value", "type"}, set()),
    ("barangay", "Barangay profile", {"uuid", "barangay_geo_code", "f01_disaster_plan"}, set()),
    ("person", "Person record",
     {"uuid", "line_number", "a02_relation_to_hh_head", "a05_age"}, {"d09_tvet_course"}),
    ("household", "Household record",
     {"uuid", "barangay_geo_code", "hh_size", "o09_tenure", "latitude", "longitude"},
     {"line_number"}),
]
KIND_LABEL = {k: label for k, label, _, _ in FILE_KINDS}
REQUIRED_KINDS = ["household", "person", "barangay"]
ALL_KINDS = ["household", "person", "barangay", "barangay_list", "interview",
             "child_mortality", "tvet"]
STANDARD_NAME = {
    "household": "cbms_household_record.csv",
    "person": "cbms_person_record.csv",
    "barangay": "cbms_barangay_record.csv",
    "barangay_list": "cbms_barangay_record_list.csv",
    "interview": "cbms_interview_record.csv",
    "child_mortality": "cbms_household_record_child_mortality.csv",
    "tvet": "cbms_person_record_tvet.csv",
}


def read_table(path) -> pd.DataFrame:
    """Every value as text, blanks kept as '' (no NaN guessing)."""
    path = str(path)
    if path.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(path, dtype=str, keep_default_na=False)
    else:
        df = None
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding=enc)
                break
            except UnicodeDecodeError:
                continue
        if df is None:
            raise ValueError("could not read the file's text encoding")
    df = df.loc[:, [c for c in df.columns if c and not str(c).startswith("Unnamed")]]
    df.columns = [str(c).strip() for c in df.columns]
    return df


def classify(df: pd.DataFrame):
    cols = set(df.columns)
    for key, _label, need, forbid in FILE_KINDS:
        if need <= cols and not (forbid & cols):
            return key
    return None


def detect_files(paths: dict) -> dict:
    """paths: {original_name: saved_path}. Returns detection result with the
    parsed frames (kept server-side) and a JSON-safe summary."""
    frames, files, problems = {}, [], []
    for name, path in paths.items():
        try:
            df = read_table(path)
        except Exception as e:  # noqa: BLE001
            files.append({"name": name, "kind": None, "status": "unreadable", "detail": str(e)})
            problems.append(f"{name}: could not be read ({e}).")
            continue
        kind = classify(df)
        entry = {"name": name, "kind": kind, "label": KIND_LABEL.get(kind),
                 "rows": int(len(df)), "columns": int(len(df.columns))}
        if kind is None:
            entry["status"] = "unrecognised"
            problems.append(f"{name}: columns don't match any CBMS 2024 file.")
        elif kind in frames:
            entry["status"] = "duplicate"
            problems.append(f"{name}: a second {KIND_LABEL[kind]} file -- only one is used.")
        else:
            entry["status"] = "ok"
            frames[kind] = df
            paths_by_kind = frames.setdefault("_paths", {})
            paths_by_kind[kind] = path
        files.append(entry)
    missing = [k for k in ALL_KINDS if k not in frames]
    return {
        "frames": frames,
        "files": files,
        "missing_required": [KIND_LABEL[k] for k in REQUIRED_KINDS if k in missing],
        "missing_optional": [KIND_LABEL[k] for k in missing if k not in REQUIRED_KINDS],
        "problems": problems,
    }


# ════════════════════════════════════════════════════════════════════
# 2. ALIGNMENT CHECK
# ════════════════════════════════════════════════════════════════════
def _psgc(s: pd.Series) -> pd.Series:
    return s.astype(str).str.replace(r"\.0$", "", regex=True).str.strip().str.zfill(10)


def check_alignment(frames: dict) -> dict:
    hh, pp, br = frames["household"], frames["person"], frames["barangay"]
    hh_ids = set(hh["uuid"])
    checks = []

    def add(name, ok, detail, blocking=False):
        checks.append({"check": name, "ok": bool(ok), "detail": detail,
                       "blocking": bool(blocking and not ok)})

    dup = int(hh["uuid"].duplicated().sum())
    add("Household uuid is unique", dup == 0,
        f"{len(hh):,} households" + (f", {dup:,} duplicated uuid" if dup else ""), blocking=True)

    p_orphan = int((~pp["uuid"].isin(hh_ids)).sum())
    add("Every person belongs to a household", p_orphan == 0,
        f"{len(pp):,} people matched by uuid" if not p_orphan
        else f"{p_orphan:,} people have a uuid that is not in the household file", blocking=True)

    pkey_dup = int(pp.duplicated(["uuid", "line_number"]).sum())
    add("Person line numbers are unique per household", pkey_dup == 0,
        "uuid + line_number is unique" if not pkey_dup else f"{pkey_dup:,} repeated rows", blocking=True)

    no_members = int((~hh["uuid"].isin(set(pp["uuid"]))).sum())
    add("Every household has members", no_members == 0,
        "all households have at least one person" if not no_members
        else f"{no_members:,} households have no person rows")

    counts = pp.groupby("uuid").size()
    size = pd.to_numeric(hh.set_index("uuid")["hh_size"], errors="coerce")
    mism = int((size.reindex(counts.index).fillna(-1) != counts).sum())
    add("Household size matches member count", mism == 0,
        "hh_size equals the number of person rows" if not mism
        else f"{mism:,} households differ (member rows are used)")

    heads = pp[pp["a02_relation_to_hh_head"] == "1"].groupby("uuid").size()
    no_head = int((~hh["uuid"].isin(heads.index)).sum())
    add("Each household has a head", no_head == 0,
        "one head per household" if not no_head else f"{no_head:,} households without a head row")

    coords = hh[["latitude", "longitude"]].apply(pd.to_numeric, errors="coerce")
    no_xy = int(coords.isna().any(axis=1).sum())
    add("Households have coordinates", no_xy == 0,
        "all households are geotagged" if not no_xy
        else f"{no_xy:,} households have no coordinates (hazard & distance left blank)")

    br_codes = set(_psgc(br["barangay_geo_code"]))
    hh_codes = set(_psgc(hh["barangay_geo_code"]))
    add("24 barangays in the barangay profile", len(br_codes) == 24,
        f"{len(br_codes)} barangays", blocking=True)
    missing_b = sorted(hh_codes - br_codes)
    add("Household barangays exist in the barangay profile", not missing_b,
        f"{len(hh_codes)} barangay codes all matched" if not missing_b
        else f"{len(missing_b)} household barangay code(s) missing from the profile", blocking=True)
    unknown = sorted(set(hh["barangay"]) - set(BARANGAY_NAME_MAP))
    add("Barangay names are recognised", not unknown,
        "all names map to the system's barangay list" if not unknown
        else "unrecognised: " + ", ".join(unknown[:5]), blocking=bool(unknown))

    linked = {}
    for kind, key in (("interview", "uuid"), ("child_mortality", "uuid"), ("tvet", "uuid")):
        df = frames.get(kind)
        if df is None:
            continue
        orphan = int((~df[key].isin(hh_ids)).sum())
        linked[kind] = {"rows": int(len(df)), "matched": int(len(df) - orphan)}
        add(f"{KIND_LABEL[kind]} rows link to households", orphan == 0,
            f"{len(df):,} rows matched by uuid" if not orphan else f"{orphan:,} rows have no household")
    if frames.get("tvet") is not None:
        t = frames["tvet"]
        pk = set(zip(pp["uuid"], pd.to_numeric(pp["line_number"], errors="coerce")))
        tk = list(zip(t["uuid"], pd.to_numeric(t["line_number"], errors="coerce")))
        orphan = sum(1 for k in tk if k not in pk)
        add("TVET rows link to a person", orphan == 0,
            "uuid + line_number matched" if not orphan else f"{orphan:,} rows have no matching person")
    if frames.get("barangay_list") is not None:
        bl = frames["barangay_list"]
        orphan = int((~bl["uuid"].isin(set(br["uuid"]))).sum())
        add("Barangay list rows link to a barangay", orphan == 0,
            f"{len(bl):,} rows matched by barangay uuid" if not orphan else f"{orphan:,} rows unmatched")

    return {
        "households": int(len(hh)), "people": int(len(pp)), "barangays": int(len(br_codes)),
        "checks": checks,
        "blocking": [c["detail"] for c in checks if c["blocking"]],
        "warnings": [c["check"] + ": " + c["detail"] for c in checks if not c["ok"] and not c["blocking"]],
    }


# ════════════════════════════════════════════════════════════════════
# 3. BUILD HOUSEHOLD + MEMBER ROWS
# ════════════════════════════════════════════════════════════════════
def _num(s):
    return pd.to_numeric(s.replace({"NA": "", "N/A": ""}) if s.dtype == object else s, errors="coerce")


def _lab(series, mapping, blank_codes=("", "NA")):
    s = series.astype(str).str.strip().str.replace(r"\.0$", "", regex=True)
    out = s.map(mapping)
    raw = s.where(~s.isin(blank_codes))
    return out.fillna(raw)  # unknown code -> stored as its code; blank -> NaN


def _yes(series):
    return series.astype(str).str.strip().str.replace(r"\.0$", "", regex=True) == "1"


def compute_hazard(hh: pd.DataFrame) -> pd.DataFrame:
    """Vectorised version of hazard_engine.detect_hazard_exposure()."""
    import geopandas as gpd
    from shapely.ops import unary_union

    lon = _num(hh["longitude"])
    lat = _num(hh["latitude"])
    out = pd.DataFrame(index=hh.index, data={
        "flood_exposure": None, "landslide_exposure": None,
        "hazard_exposure_score": np.nan, "compound_hazard": False,
        "hazard_data_status": "No Data"})
    ok = lon.notna() & lat.notna()
    if not ok.any():
        return out
    pts = gpd.GeoDataFrame(index=hh.index[ok], geometry=gpd.points_from_xy(lon[ok], lat[ok]),
                           crs="EPSG:4326")
    flood = gpd.read_file(GEOJSON_DIR / "flood.geojson")
    slide = gpd.read_file(GEOJSON_DIR / "landslide.geojson")
    if pts.crs != flood.crs:
        pts = pts.to_crs(flood.crs)

    def first_match(layer, field):
        j = gpd.sjoin(pts, layer[[field, "geometry"]], how="left", predicate="within")
        j = j[~j.index.duplicated(keep="first")]
        return j[field].reindex(pts.index)

    fcode = first_match(flood, "FloodSusc")
    lcode = first_match(slide, "LndslideSu")
    fscore = fcode.map({"LF": 1, "MF": 2, "HF": 3, "VHF": 4}).fillna(0)
    lscore = lcode.map({"LL": 1, "ML": 2, "HL": 3}).fillna(0)
    score = np.maximum(fscore, lscore)
    status = pd.Series("Assessed", index=pts.index)
    zero = score == 0
    if zero.any():
        union = unary_union(list(flood.to_crs(METRIC_CRS).geometry) +
                            list(slide.to_crs(METRIC_CRS).geometry))
        dist = pts.loc[zero].to_crs(METRIC_CRS).geometry.distance(union)
        status.loc[zero] = np.where(dist <= HAZARD_BUFFER_METERS, "Assessed",
                                    "Outside mapped hazard area")
    idx = pts.index
    out.loc[idx, "flood_exposure"] = fcode.map(
        {"LF": "Low", "MF": "Moderate", "HF": "High", "VHF": "Very High"}).values
    out.loc[idx, "landslide_exposure"] = lcode.map(
        {"LL": "Low", "ML": "Moderate", "HL": "High"}).values
    out.loc[idx, "hazard_exposure_score"] = score.values
    out.loc[idx, "compound_hazard"] = ((fscore > 0) & (lscore > 0)).values
    out.loc[idx, "hazard_data_status"] = status.values
    return out


def _haversine_km(lat, lon, plat, plon):
    r = 6371.0088
    p1, p2 = np.radians(lat), np.radians(plat)
    dphi = p2 - p1
    dl = np.radians(plon - lon)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def build_typology(frames_numeric) -> pd.DataFrame:
    """Household typology features (sanmiguel_student) + nearest saved
    k-modes centre. Returns one row per household uuid."""
    from sanmiguel_student.typology import build_typology_features
    from sanmiguel_student.config import TYPOLOGY_FEATURES

    hh_n, pp_n = frames_numeric
    ref = json.loads(TYPOLOGY_REF.read_text(encoding="utf-8"))
    if ref["features"] != list(TYPOLOGY_FEATURES):
        raise ValueError("typology_reference_k5.json features don't match TYPOLOGY_FEATURES")
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ht = build_typology_features(hh_n, pp_n).copy()
    X = ht[TYPOLOGY_FEATURES].astype(int).to_numpy()
    ids = sorted(int(k) for k in ref["centroids"])
    C = np.array([ref["centroids"][str(k)] for k in ids])
    dist = (X[:, None, :] != C[None, :, :]).sum(axis=2)
    cid = np.array(ids)[dist.argmin(axis=1)]
    res = ht[["uuid", "barangay", "psgc_10d", "latitude", "longitude"] + list(TYPOLOGY_FEATURES)].copy()
    res["cluster_id"] = cid
    res["cluster_label"] = [ref["labels"][str(c)] for c in cid]
    return res


def build_tables(frames: dict, progress=lambda *_: None):
    """Returns (households_df, individuals_df, typology_df)."""
    hh = frames["household"].copy()
    pp = frames["person"].copy()
    pp["_ln"] = _num(pp["line_number"]).astype("Int64")
    pp = pp.sort_values(["uuid", "_ln"]).reset_index(drop=True)
    age = _num(pp["a05_age"])

    # ---- person-level derived values ----
    pp["_age"] = age
    pp["_pwd"] = _yes(pp["b10_pwd"])
    pp["_senior"] = age >= 60
    pp["_solo"] = _yes(pp["b05_solo_parent"])
    pp["_wa"] = (age >= 15) & (age <= 59)
    pp["_dep"] = (age < 15) | (age >= 60)
    pp["_emp"] = _yes(pp["e01_employment_status"])
    pp["_edu_adult"] = _num(pp["a11_hgc_level"]).where(age >= 18)

    g = pp.groupby("uuid")
    agg = pd.DataFrame({
        "pwd_count": g["_pwd"].sum(), "senior_count": g["_senior"].sum(),
        "solo_parent_count": g["_solo"].sum(), "working_age_count": g["_wa"].sum(),
        "dependency_count": g["_dep"].sum(), "employed_count": g["_emp"].sum(),
        "avg_education_level_adults": g["_edu_adult"].mean(),
        "members": g.size(),
    })
    wa = agg["working_age_count"].replace(0, np.nan)
    # no working-age member -> ratio undefined (left blank, as in the earlier import)
    agg["dependency_ratio"] = (agg["dependency_count"] / wa).round(2)
    agg["employment_rate_adults"] = (agg["employed_count"] / wa).round(2)

    # ---- household-level values ----
    progress("Building household records")
    hh = hh.set_index("uuid", drop=False)
    agg = agg.reindex(hh.index)
    gcols = ["g01_worried", "g02_not_eaten_healthy", "g03_ate_few_food", "g04_skipped_meal",
             "g05_ate_less", "g06_ran_out_of_food", "g07_hungry", "g08_not_eaten_whole_day"]
    food = sum(_yes(hh[c]).astype(int) for c in gcols).astype("Int64")
    food[(hh[gcols].apply(lambda s: s.str.strip()) == "").all(axis=1)] = pd.NA
    fin = pd.concat([_yes(hh[c]) for c in
                     ["i01_a_bank_account", "i01_b_digital_bank_account",
                      "i01_c_emoney_or_cash_card", "i01_d_nssla", "i01_e_account_with_coop",
                      "i01_f_microfinance", "i01_g_money_remittance"] if c in hh], axis=1).any(axis=1)
    ins = pd.concat([_yes(hh[c]) for c in
                     ["m01_a_sss", "m01_b_gsis", "m01_c_philhealth", "m01_d_health_insurance"]
                     if c in hh], axis=1).any(axis=1)
    yn = lambda c: _lab(hh[c], CB.YES_NO) if c in hh else None  # noqa: E731

    surveyed = pd.Series("2024-07-01", index=hh.index)
    iv = frames.get("interview")
    if iv is not None and "date_of_visit" in iv:
        iv = iv.assign(_done=iv["result_of_visit"].astype(str).str.strip() == "1",
                       _d=pd.to_datetime(iv["date_of_visit"], errors="coerce"))
        best = (iv.sort_values(["_done", "_d"]).dropna(subset=["_d"])
                  .drop_duplicates("uuid", keep="last").set_index("uuid")["_d"])
        surveyed = best.reindex(hh.index).dt.strftime("%Y-%m-%d").fillna(surveyed)

    size = _num(hh["hh_size"]).fillna(agg["members"])

    progress("Checking flood and landslide exposure")
    hz = compute_hazard(hh.reset_index(drop=True))
    hz.index = hh.index

    lat, lon = _num(hh["latitude"]), _num(hh["longitude"])

    households = pd.DataFrame({
        "uuid": hh["uuid"],
        "barangay_cbms": hh["barangay"],
        "barangay_name": hh["barangay"].map(BARANGAY_NAME_MAP),
        "region_code": hh.get("region_code"), "province_code": hh.get("province_code"),
        "city_mun_code": hh.get("city_mun_code"), "barangay_code": hh.get("barangay_code"),
        "husn": hh.get("husn"), "hsn": hh.get("hsn"),
        "longitude": lon, "latitude": lat, "hh_size": size.astype("Int64"),
        "housing_material": _lab(hh["o04_outer_walls"], CB.WALLS),
        "housing_roof": _lab(hh["o03_roof"], CB.ROOF),
        "housing_floor": _lab(hh["o06_floor"], CB.FLOOR),
        "tenure_status": _lab(hh["o09_tenure"], CB.TENURE),
        "has_electricity": _yes(hh["o11_electricity"]),
        "o12_fuel_for_lighting": _lab(hh["o12_fuel_for_lighting"], CB.LIGHTING),
        "o13_fuel_for_cooking": _lab(hh["o13_fuel_for_cooking"], CB.COOKING),
        "water_source": _lab(hh["n01_main_water"], CB.WATER),
        "water_service_level": _lab(hh["n03_service_level_drinking_water"], CB.WATER_SL),
        "toilet_type": _lab(hh["n08_toilet_facility"], CB.TOILET),
        "toilet_service_level": _lab(hh["n08_service_level_toilet_facility"], CB.TOILET_SL),
        "surveyed_date": surveyed,
        # Income is not collected in the CBMS files and is not part of any
        # score, so imported households carry no income figure (any old
        # estimate is cleared).
        "monthly_income": None, "household_estimated_income": None,
        "income_basis": None, "asset_premium_pct": None,
        "flood_exposure": hz["flood_exposure"], "landslide_exposure": hz["landslide_exposure"],
        "hazard_exposure_score": hz["hazard_exposure_score"],
        "compound_hazard": hz["compound_hazard"], "hazard_data_status": hz["hazard_data_status"],
        "is_4ps_beneficiary": yn("m05_a_4ps"),
        "overcrowding_status": yn("overcrowding_status"),
        "food_insecurity_score": food,
        "has_formal_financial_account": np.where(fin, "Yes", "No"),
        "has_social_insurance": np.where(ins, "Yes", "No"),
        "knows_evacuation_location": yn("j02_location_of_evacuation"),
        "knows_emergency_hotline": yn("j03_contact_hotline"),
        "pwd_count": agg["pwd_count"].fillna(0).astype(int),
        "senior_count": agg["senior_count"].fillna(0).astype(int),
        "solo_parent_count": agg["solo_parent_count"].fillna(0).astype(int),
        "avg_education_level_adults": agg["avg_education_level_adults"],
        "employed_count": agg["employed_count"].fillna(0).astype(int),
        "working_age_count": agg["working_age_count"].fillna(0).astype(int),
        "dependency_count": agg["dependency_count"].fillna(0).astype(int),
        "dependency_ratio": agg["dependency_ratio"],
        "employment_rate_adults": agg["employment_rate_adults"],
        "rhu_km": _haversine_km(lat, lon, *RHU_POINT).round(3),
        "fire_km": _haversine_km(lat, lon, *FIRE_POINT).round(3),
    }).reset_index(drop=True)

    # ---- typology (Sir Shem's feature builder + saved k=5 centres) ----
    progress("Assigning household typology")
    typ = build_typology(_numeric_frames(frames))
    tmap = typ.set_index("uuid")
    households["typology_cluster_id"] = households["uuid"].map(tmap["cluster_id"])
    households["typology_cluster_label"] = households["uuid"].map(tmap["cluster_label"])
    from sanmiguel_student.config import TYPOLOGY_FEATURES
    for f in TYPOLOGY_FEATURES:
        v = households["uuid"].map(tmap[f])
        households[f"ti_{f}"] = v.astype(bool) if f not in COUNT_FEATURES else v.astype("Int64")

    # ---- members ----
    progress("Building member records")
    grp = pp["e05_occupation_group"].replace("NA", "").astype(str)
    edu = pp["a11_hgc_level"].replace("NA", "").astype(str).str.replace(r"\.0$", "", regex=True)
    full = (pp["a01_first_name"] + " " + pp["a01_middle_name"] + " " + pp["a01_last_name"]
            + " " + pp["a01_suffix"]).str.replace(r"\s+", " ", regex=True).str.strip()
    fourps = pp["uuid"].map(households.set_index("uuid")["is_4ps_beneficiary"])
    rel = _lab(pp["a02_relation_to_hh_head"], CB.REL_HEAD)
    individuals = pd.DataFrame({
        "uuid": pp["uuid"],
        "person_code": pp["uuid"] + "-" + pp["_ln"].astype(str),
        "line_number": pp["_ln"].astype(str),
        "last_name": pp["a01_last_name"], "first_name": pp["a01_first_name"],
        "suffix": pp["a01_suffix"], "middle_name": pp["a01_middle_name"],
        "age": age.astype("Int64"),
        "birthday_month": pp["a04_birthday_month"], "birthday_day": pp["a04_birthday_day"],
        "birthday_year": pp["a04_birthday_year"],
        "age_group_five_years": _lab(pp["a05_age_group_five_years"], CB.AGE_GROUP),
        "civil_status": _lab(pp["a07_marital_status"], CB.MARITAL),
        "religion": _lab(pp["a08_religion"], CB.RELIGION, blank_codes=("", "NA", "0")),
        "nuclear_family": pp["b01_nuclear_family"],
        "relation_to_nuclear_family_head": pp["b02_relation_to_nuclear_family_head"],
        "with_pwd_id": _lab(pp["b11_with_pwd_id"], CB.YES_NO),
        "employment_status": _lab(pp["e01_employment_status"], CB.EMPLOY),
        "estimated_monthly_income": None,
        "occupation": grp.map(CB.OCCUPATION_GROUP),
        "monthly_income": None,
        "is_senior": pp["_senior"], "is_pwd": pp["_pwd"], "is_solo_parent": pp["_solo"],
        "is_4ps": fourps == "Yes",
        "relationship_to_hh": rel,
        "is_household_head": rel == "Head",
        "full_name": full,
        "gender": _lab(pp["a03_sex"], CB.SEX),
        "educational_attainment": edu.map(CB.EDUCATION_LEVEL),
    })
    return households, individuals, typ


COUNT_FEATURES = {"pwd_count_cat", "senior_count_cat", "solo_parent_count_cat"}


def _numeric_frames(frames):
    """The sanmiguel_student functions expect pandas' normal type inference."""
    from sanmiguel_student.io import psgc10
    p = frames.get("_paths", {})
    hh = read_numeric(p["household"]) if "household" in p else None
    pp = read_numeric(p["person"]) if "person" in p else None
    for f in (hh, pp):
        f["psgc_10d"] = psgc10(f["barangay_geo_code"])
    return hh, pp


def read_numeric(path):
    path = str(path)
    if path.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path, low_memory=False, encoding_errors="replace")
    return df.drop(columns=[c for c in df.columns if str(c).startswith("Unnamed")], errors="ignore")


# ════════════════════════════════════════════════════════════════════
# 4. DATABASE WRITE (one transaction)
# ════════════════════════════════════════════════════════════════════
def _columns(cur, table):
    cur.execute("""
        SELECT a.attname, format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
        WHERE a.attrelid = to_regclass(%s) AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
    """, (table,))
    return {r[0]: r[1] for r in _rows(cur)}


def _rows(cur):
    out = []
    for r in cur.fetchall():
        out.append(tuple(r.values()) if isinstance(r, dict) else tuple(r))
    return out


def _exists(cur, table):
    cur.execute("SELECT to_regclass(%s)", (table,))
    r = _rows(cur)[0][0]
    return r is not None


def _fk_children(cur, table, col):
    """Tables with a single-column foreign key pointing at table(col)."""
    cur.execute("""
        SELECT c.conrelid::regclass::text, a.attname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute p ON p.attrelid = c.confrelid AND p.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND c.confrelid = to_regclass(%s)
          AND array_length(c.conkey, 1) = 1 AND p.attname = %s
    """, (table, col))
    return _rows(cur)


def _pk(cur, table):
    cur.execute("""
        SELECT a.attname FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = to_regclass(%s) AND i.indisprimary
    """, (table,))
    r = _rows(cur)
    return r[0][0] if len(r) == 1 else None


_tmp_n = [0]


def _purge(cur, table, col, ids_table, removed, depth=0):
    """Delete rows of `table` whose `col` is in temp table ids_table(id),
    after first deleting (recursively) any rows that point at them."""
    if depth > 6:
        raise RuntimeError("foreign-key chain too deep while removing old rows")
    pk = _pk(cur, table)
    if pk:
        for child, ccol in _fk_children(cur, table, pk):
            if child == table:
                continue
            _tmp_n[0] += 1
            tmp = f"_rm_{_tmp_n[0]}"
            cur.execute(f"CREATE TEMP TABLE {tmp} ON COMMIT DROP AS "
                        f"SELECT {pk} AS id FROM {table} WHERE {col} IN (SELECT id FROM {ids_table})")
            _purge(cur, child, ccol, tmp, removed, depth + 1)
    cur.execute(f"DELETE FROM {table} WHERE {col} IN (SELECT id FROM {ids_table})")
    if cur.rowcount:
        removed[table] = removed.get(table, 0) + cur.rowcount


def _copy_stage(cur, name, df, cols):
    cur.execute(f"DROP TABLE IF EXISTS {name}")
    cur.execute(f"CREATE TEMP TABLE {name} (" + ", ".join(f'"{c}" text' for c in cols)
                + ") ON COMMIT DROP")
    buf = io.StringIO()
    out = df[cols].copy()
    for c in out.columns:
        if out[c].dtype == bool:
            out[c] = out[c].map({True: "true", False: "false"})
        elif str(out[c].dtype) == "boolean":
            out[c] = out[c].map({True: "true", False: "false"})
    out.to_csv(buf, index=False, header=False, na_rep="")
    buf.seek(0)
    cur.copy_expert(f"COPY {name} FROM STDIN WITH (FORMAT CSV, NULL '')", buf)


def _cast(col, typ):
    t = typ.lower()
    if t.startswith(("integer", "smallint", "bigint")):
        return f'NULLIF(s."{col}", \'\')::numeric::{typ}'
    if t.startswith(("character", "text")):
        return f's."{col}"::{typ}'
    return f'NULLIF(s."{col}", \'\')::{typ}'


def resolve_barangays(cur, names):
    cur.execute("SELECT barangay_id, barangay_name FROM tbl_barangays")
    rows = _rows(cur)
    norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower()  # noqa: E731
                            .replace("santo", "sto").replace("santa", "sta")
                            .replace("ñ", "n").replace("brgy", "").replace("bgy", "")
                            .replace("pob", ""))
    exact = {n: i for i, n in rows}
    loose = {norm(n): i for i, n in rows}
    out, missing = {}, []
    for n in names:
        bid = exact.get(n) or loose.get(norm(n))
        if bid is None:
            missing.append(n)
        out[n] = bid
    return out, missing


def database_diff(conn, households: pd.DataFrame):
    cur = conn.cursor()
    cur.execute("SELECT uid_internal FROM tbl_households")
    existing = {r[0] for r in _rows(cur)}
    incoming = set(households["uuid"])
    _map, missing = resolve_barangays(cur, sorted(households["barangay_name"].dropna().unique()))
    cur.execute("SELECT count(*) FROM tbl_individuals")
    people_now = _rows(cur)[0][0]
    return {
        "in_system": len(existing), "people_in_system": int(people_now),
        "to_update": len(incoming & existing), "to_add": len(incoming - existing),
        "not_in_files": len(existing - incoming),
        "unmatched_barangays": missing,
    }


def write_to_database(conn, households, individuals, remove_missing=True, log=print, user=None):
    """Single transaction. Returns a summary dict; raises (after rollback) on error."""
    cur = conn.cursor()
    try:
        hcols = _columns(cur, "tbl_households")
        icols = _columns(cur, "tbl_individuals")
        if "uid_internal" not in hcols:
            raise RuntimeError("tbl_households has no uid_internal column -- run swap_household_columns.py first")

        # typology columns are created on demand (same as backfill_typology_clusters.py)
        extra = {"typology_cluster_id": "integer", "typology_cluster_label": "varchar(100)"}
        from sanmiguel_student.config import TYPOLOGY_FEATURES
        for f in TYPOLOGY_FEATURES:
            extra[f"ti_{f}"] = "smallint" if f in COUNT_FEATURES else "boolean"
        for c, t in extra.items():
            if c not in hcols:
                cur.execute(f"ALTER TABLE tbl_households ADD COLUMN IF NOT EXISTS {c} {t}")
                hcols[c] = t

        # lookups used by this import and by the family-network rebuild after it
        # (without them, clearing ~8k families scans every member row each time)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_individuals_household_id ON tbl_individuals (household_id)")
        if "family_id" in icols:
            cur.execute("CREATE INDEX IF NOT EXISTS idx_individuals_family_id ON tbl_individuals (family_id)")

        bmap, missing = resolve_barangays(cur, sorted(households["barangay_name"].dropna().unique()))
        if missing or households["barangay_name"].isna().any():
            raise RuntimeError("barangays not found in the system: " + ", ".join(map(str, missing)))
        hh = households.copy()
        hh["barangay_id"] = hh["barangay_name"].map(bmap)

        skip = {"household_id", "household_number", "uid_internal", "created_at", "updated_at"}
        write_cols = [c for c in hh.columns if c in hcols and c not in skip]
        stage_cols = ["uuid"] + write_cols
        log(f"Staging {len(hh):,} households ({len(write_cols)} fields)")
        _copy_stage(cur, "_stg_hh", hh, stage_cols)

        # (the family network is rebuilt from the new members right after this
        # transaction, so its old rows are left for rebuild_network() to clear)

        cur.execute("""
            CREATE TEMP TABLE _hh_map ON COMMIT DROP AS
            SELECT DISTINCT ON (h.uid_internal) h.household_id AS id, h.uid_internal AS uuid
            FROM tbl_households h JOIN _stg_hh s ON s.uuid = h.uid_internal
            ORDER BY h.uid_internal, h.household_id
        """)
        removed = {}
        n_removed = 0
        if remove_missing:
            cur.execute("""
                CREATE TEMP TABLE _hh_gone ON COMMIT DROP AS
                SELECT household_id AS id FROM tbl_households
                WHERE household_id NOT IN (SELECT id FROM _hh_map)
            """)
            cur.execute("SELECT count(*) FROM _hh_gone")
            n_removed = _rows(cur)[0][0]
            if n_removed:
                log(f"Removing {n_removed:,} households that are not in the files")
                _purge(cur, "tbl_households", "household_id", "_hh_gone", removed)

        # -- update existing households
        set_sql = ", ".join(f'"{c}" = {_cast(c, hcols[c])}' for c in write_cols)
        if "updated_at" in hcols:
            set_sql += ", updated_at = NOW()"
        cur.execute(f"""
            UPDATE tbl_households h SET {set_sql}
            FROM _stg_hh s JOIN _hh_map m ON m.uuid = s.uuid
            WHERE h.household_id = m.id
        """)
        n_updated = cur.rowcount
        log(f"Updated {n_updated:,} existing households")

        # -- insert new households with the next "Brgy X - HHn" codes
        cur.execute("SELECT s.uuid FROM _stg_hh s WHERE s.uuid NOT IN (SELECT uuid FROM _hh_map)")
        new_ids = {r[0] for r in _rows(cur)}
        n_added = 0
        added_ids = []
        if new_ids:
            cur.execute(r"""
                SELECT barangay_id,
                       max(NULLIF(substring(household_number from ' - HH([0-9]+)$'), '')::int)
                FROM tbl_households GROUP BY barangay_id
            """)
            start = {r[0]: (r[1] or 0) for r in _rows(cur)}
            if _exists(cur, "tbl_barangay_hh_counter"):
                cur.execute("SELECT barangay_id, last_number FROM tbl_barangay_hh_counter")
                for bid, last in _rows(cur):
                    start[bid] = max(start.get(bid, 0), last or 0)
            cur.execute("SELECT barangay_id, barangay_name FROM tbl_barangays")
            name_of = {i: n for i, n in _rows(cur)}
            new = hh[hh["uuid"].isin(new_ids)].copy()
            new["_h"] = _num(new["husn"]).fillna(0) if "husn" in new else 0
            new["_s"] = _num(new["hsn"]).fillna(0) if "hsn" in new else 0
            new = new.sort_values(["barangay_id", "_h", "_s", "uuid"])
            codes = []
            for bid, grp in new.groupby("barangay_id", sort=False):
                n0 = start.get(bid, 0)
                codes += [f"{name_of[bid]} - HH{n0 + i + 1}" for i in range(len(grp))]
                start[bid] = n0 + len(grp)
            new["household_number"] = codes
            new["ord"] = range(len(new))
            _copy_stage(cur, "_stg_new", new, ["uuid", "household_number", "ord"])
            cols_sql = ", ".join(f'"{c}"' for c in write_cols)
            vals_sql = ", ".join(_cast(c, hcols[c]) for c in write_cols)
            cur.execute(f"""
                INSERT INTO tbl_households (uid_internal, household_number, {cols_sql})
                SELECT s.uuid, n.household_number, {vals_sql}
                FROM _stg_hh s JOIN _stg_new n ON n.uuid = s.uuid
                ORDER BY n.ord::int
            """)
            n_added = cur.rowcount
            log(f"Added {n_added:,} new households")
            cur.execute("SELECT h.household_id FROM tbl_households h JOIN _stg_new n ON n.uuid = h.uid_internal")
            added_ids = [r[0] for r in _rows(cur)]
            if _exists(cur, "tbl_barangay_hh_counter"):
                for bid, last in start.items():
                    cur.execute("""
                        INSERT INTO tbl_barangay_hh_counter (barangay_id, last_number)
                        VALUES (%s, %s)
                        ON CONFLICT (barangay_id) DO UPDATE
                        SET last_number = GREATEST(tbl_barangay_hh_counter.last_number, EXCLUDED.last_number)
                    """, (int(bid), int(last)))

        # -- replace members of every imported household
        cur.execute("""
            CREATE TEMP TABLE _hh_all ON COMMIT DROP AS
            SELECT h.household_id AS id, h.uid_internal AS uuid
            FROM tbl_households h JOIN _stg_hh s ON s.uuid = h.uid_internal
        """)
        cur.execute("""
            CREATE TEMP TABLE _ind_gone ON COMMIT DROP AS
            SELECT i.person_id AS id FROM tbl_individuals i
            WHERE i.household_id IN (SELECT id FROM _hh_all)
        """)
        _purge(cur, "tbl_individuals", "person_id", "_ind_gone", {})
        iw = [c for c in individuals.columns if c in icols and c not in ("person_id", "household_id")]
        _copy_stage(cur, "_stg_ind", individuals, ["uuid"] + iw)
        cols_sql = ", ".join(f'"{c}"' for c in iw)
        vals_sql = ", ".join(_cast(c, icols[c]) for c in iw)
        cur.execute(f"""
            INSERT INTO tbl_individuals (household_id, {cols_sql})
            SELECT m.id, {vals_sql} FROM _stg_ind s JOIN _hh_all m ON m.uuid = s.uuid
        """)
        n_people = cur.rowcount
        log(f"Saved {n_people:,} household members")

        cur.execute("SELECT count(*) FROM tbl_households")
        total_hh = _rows(cur)[0][0]
        if n_updated + n_added != len(hh):
            raise RuntimeError(f"expected {len(hh)} households written, got {n_updated + n_added}")
        if n_people != len(individuals):
            raise RuntimeError(f"expected {len(individuals)} members written, got {n_people}")
        # recorded in the same transaction, so the Households page can delete this batch
        import import_batches
        batch_id = import_batches.record_batch(cur, added_ids=added_ids, updated=n_updated,
                                               removed=n_removed, members=n_people, user=user)
        conn.commit()
        return {"batch_id": batch_id, "updated": n_updated, "added": n_added, "removed": n_removed,
                "members": n_people, "households_in_system": total_hh,
                "also_removed": {k: v for k, v in removed.items() if k != "tbl_households"}}
    except Exception:
        conn.rollback()
        raise


# ════════════════════════════════════════════════════════════════════
# 5. RECOMPUTE EVERYTHING
# ════════════════════════════════════════════════════════════════════
# Where the files live:
#   data/cbms 2024/cbms_*.csv   the CBMS census exactly as last imported
#   data/manual/*.csv           households added by hand, stored with the same
#                               CBMS columns and codes (manual_household.py)
#   data/cbms_*.csv             census + hand-added households together; this is
#                               what every analysis script reads
CENSUS_DIR = DATA_DIR / "cbms 2024"
MANUAL_DIR = DATA_DIR / "manual"
MANUAL_HH = MANUAL_DIR / "manual_household_record.csv"
MANUAL_PP = MANUAL_DIR / "manual_person_record.csv"


def install_source_files(frames, log=print):
    """Keep the uploaded files as the census copy in data/cbms 2024/ (the
    previous analysis inputs are kept in data/imports/previous/)."""
    paths = frames["_paths"]
    prev = UPLOAD_ROOT / "previous"
    prev.mkdir(parents=True, exist_ok=True)
    CENSUS_DIR.mkdir(parents=True, exist_ok=True)
    for kind in ("household", "person", "barangay"):
        dst = DATA_DIR / STANDARD_NAME[kind]
        if dst.exists():
            shutil.copy2(dst, prev / STANDARD_NAME[kind])
    for kind, src in paths.items():
        _save_as_csv(src, CENSUS_DIR / STANDARD_NAME[kind])
    log("Saved the uploaded files to data/cbms 2024/")


def _save_as_csv(src, dst):
    src = str(src)
    if src.lower().endswith((".xlsx", ".xls")):
        pd.read_excel(src, dtype=str, keep_default_na=False).to_csv(dst, index=False)
    elif os.path.abspath(src) != os.path.abspath(dst):
        shutil.copy2(src, dst)


def _read_text_csv(path):
    return pd.read_csv(path, dtype=str, keep_default_na=False, encoding_errors="replace")


def rebuild_analysis_inputs(conn_factory, log=print):
    """Write data/cbms_*.csv = the census rows + hand-added households, keeping
    only households that are still in the system (so a household deleted in
    the app also drops out of the scores). When nothing differs from the
    census, the census files are copied byte for byte."""
    conn = conn_factory()
    try:
        cur = conn.cursor()
        cur.execute("SELECT uid_internal FROM tbl_households WHERE uid_internal IS NOT NULL")
        live = {r[0] for r in _rows(cur)}
    finally:
        conn.close()
    manual = {"household": MANUAL_HH, "person": MANUAL_PP}
    added = dropped = 0
    for kind in ("household", "person", "barangay"):
        name = STANDARD_NAME[kind]
        census = CENSUS_DIR / name
        dst = DATA_DIR / name
        if not census.exists():
            continue   # older setups: data/cbms_*.csv is the census itself
        if kind == "barangay" or not live:
            if os.path.abspath(census) != os.path.abspath(dst):
                shutil.copy2(census, dst)
            continue
        base = _read_text_csv(census)
        base = base.loc[:, [c for c in base.columns if c and not c.startswith("Unnamed")]]
        mrows = None
        if manual[kind].exists():
            mrows = _read_text_csv(manual[kind])
            mrows = mrows[mrows["uuid"].isin(live)]
            base = base[~base["uuid"].isin(set(mrows["uuid"]))]
        keep = base["uuid"].isin(live)
        if kind == "household":
            dropped = int((~keep).sum())
            added = 0 if mrows is None else len(mrows)
        if keep.all() and (mrows is None or mrows.empty):
            shutil.copy2(census, dst)
            continue
        parts = [base[keep]] + ([mrows] if mrows is not None and not mrows.empty else [])
        pd.concat(parts, ignore_index=True, sort=False).fillna("").to_csv(dst, index=False)
    msg = f"Analysis files: CBMS census + {added:,} added by hand"
    if dropped:
        msg += f", {dropped:,} removed in the app left out"
    log(msg)


def write_typology_files(typ: pd.DataFrame, log=print):
    ref = json.loads(TYPOLOGY_REF.read_text(encoding="utf-8"))
    labels = {int(k): v for k, v in ref["labels"].items()}
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    typ.to_csv(RESULTS_DIR / "typology_household_k5.csv", index=False)
    work = typ[["barangay", "psgc_10d", "cluster_id"]]
    n = work.groupby(["psgc_10d", "barangay"]).size().rename("n_households")
    pct = work.groupby(["psgc_10d", "barangay", "cluster_id"]).size().unstack(fill_value=0)
    for k in labels:
        if k not in pct.columns:
            pct[k] = 0
    pct = pct[sorted(labels)]
    pct = (pct.div(pct.sum(axis=1), axis=0) * 100).round(1)
    pct.columns = [f"pct_cluster_{c}" for c in pct.columns]
    res = pd.concat([n, pct], axis=1).reset_index()
    cc = [c for c in res.columns if c.startswith("pct_cluster_")]
    res["dominant_cluster_id"] = res[cc].idxmax(axis=1).str.replace("pct_cluster_", "").astype(int)
    res["dominant_cluster_pct"] = res[cc].max(axis=1)
    res["dominant_cluster_label"] = res["dominant_cluster_id"].map(labels)
    res = res.rename(columns={f"pct_cluster_{k}": f"pct_cluster_{k}__" +
                              labels[k].replace(" ", "_").replace(",", "") for k in labels})
    res.sort_values("barangay").to_csv(RESULTS_DIR / "typology_barangay_k5.csv", index=False)
    log("Household typology files written")


def _run_script(args, log, timeout=1800):
    env = dict(os.environ, PYTHONIOENCODING="utf-8", MPLBACKEND="Agg")
    p = subprocess.run([sys.executable] + args, cwd=str(BACKEND_DIR), env=env,
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout)
    if p.returncode != 0:
        tail = (p.stderr or p.stdout or "").strip().splitlines()[-6:]
        raise RuntimeError(" | ".join(tail) or f"exit code {p.returncode}")
    return p.stdout


def recompute_steps(conn_factory):
    """(label, callable(log)) in order. Each step is independent enough that a
    failure is reported and the remaining steps still run."""
    def inputs(log):
        rebuild_analysis_inputs(conn_factory, log)

    def domain(log):
        _run_script(["run_domain_pipeline.py", "--skip-typology"], log)

    def facility(log):
        _run_script(["facility_access_score.py"], log)

    def capdist(log):
        _run_script(["capacity_distance_score.py"], log)

    def typology(log):
        paths = {"household": DATA_DIR / STANDARD_NAME["household"],
                 "person": DATA_DIR / STANDARD_NAME["person"]}
        write_typology_files(build_typology(_numeric_frames({"_paths": paths})), log)

    def network(log):
        sys.path.insert(0, str(DATA_DIR))
        try:
            import importlib
            ne = importlib.import_module("network_engine")
        finally:
            sys.path.remove(str(DATA_DIR))
        conn = conn_factory()
        try:
            r = ne.rebuild_network(conn, verbose=False)
            conn.commit()
            log(f"{r.get('families_created', 0):,} families, {r.get('edges_created', 0):,} links")
        finally:
            conn.close()

    def legacy(log):
        _run_script(["compute_vulnerability.py"], log)

    def views(log):
        import build_nlp_views
        build_nlp_views.build()
        try:
            import nlp_households
            nlp_households.invalidate_cache()
        except Exception:  # noqa: BLE001
            pass

    return [
        ("Prepare the analysis files", inputs),
        ("Social vulnerability, capacity and hazard (domain pipeline)", domain),
        ("Distance to RHU and fire station", facility),
        ("Capacity + Distance score", capdist),
        ("Household typology", typology),
        ("Family network", network),
        ("Household index used by the household pages", legacy),
        ("Ask the Data tables", views),
    ]


# ════════════════════════════════════════════════════════════════════
# 6. JOBS (preview -> commit -> background recompute)
# ════════════════════════════════════════════════════════════════════
_JOBS: dict = {}
_LOCK = threading.Lock()
_RUN_LOCK = threading.Lock()   # one recalculation at a time; later jobs wait their turn
_SESSIONS: dict = {}   # token -> {"frames", "households", "individuals", "typology", "at"}
SESSION_TTL = 3600


def _json_safe(o):
    if isinstance(o, dict):
        return {k: _json_safe(v) for k, v in o.items() if not str(k).startswith("_")}
    if isinstance(o, (list, tuple)):
        return [_json_safe(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    return o


def _cleanup_sessions():
    now = time.time()
    for tok in [t for t, s in _SESSIONS.items() if now - s["at"] > SESSION_TTL]:
        s = _SESSIONS.pop(tok, None)
        if s:
            shutil.rmtree(s["dir"], ignore_errors=True)


def preview(saved: dict, workdir: Path, conn):
    """saved: {original_name: path}. Parses, checks, builds, diffs. Nothing is written."""
    _cleanup_sessions()
    det = detect_files(saved)
    frames = det.pop("frames")
    result = {"files": det["files"], "missing_required": det["missing_required"],
              "missing_optional": det["missing_optional"], "problems": det["problems"],
              "ready": False}
    if det["missing_required"]:
        return _json_safe(result)
    align = check_alignment(frames)
    result["alignment"] = align
    if align["blocking"]:
        return _json_safe(result)

    households, individuals, typ = build_tables(frames)
    result["summary"] = _preview_summary(households, individuals)
    result["database"] = database_diff(conn, households)
    if result["database"]["unmatched_barangays"]:
        return _json_safe(result)
    token = uuidlib.uuid4().hex
    _SESSIONS[token] = {"frames": frames, "households": households, "individuals": individuals,
                        "typology": typ, "at": time.time(), "dir": str(workdir)}
    result["token"] = token
    result["ready"] = True
    return _json_safe(result)


def _preview_summary(h, i):
    haz = h["hazard_data_status"].value_counts().to_dict()
    flood_hi = int(h["flood_exposure"].isin(["High", "Very High"]).sum())
    slide_mh = int(h["landslide_exposure"].isin(["Moderate", "High"]).sum())
    per_brgy = (h.groupby("barangay_name").size().sort_index()
                  .reset_index().rename(columns={0: "households"}).to_dict("records"))
    return {
        "households": int(len(h)), "members": int(len(i)),
        "barangays": int(h["barangay_name"].nunique()),
        "geotagged": int(h["latitude"].notna().sum()),
        "flood_high_or_very_high": flood_hi, "landslide_moderate_or_high": slide_mh,
        "outside_hazard_area": int(haz.get("Outside mapped hazard area", 0)),
        "beyond_2km_rhu": int((h["rhu_km"] > 2).sum()),
        "beyond_2km_fire": int((h["fire_km"] > 2).sum()),
        "typology": {str(k): int(v) for k, v in
                     h["typology_cluster_label"].value_counts().items()},
        "per_barangay": per_brgy,
        "seniors": int(i["is_senior"].sum()), "pwd": int(i["is_pwd"].sum()),
        "solo_parents": int(i["is_solo_parent"].sum()),
        "fourps_households": int((h["is_4ps_beneficiary"] == "Yes").sum()),
    }


def _new_job(kind, first_steps, conn_factory, user=None, extra_last=None):
    steps = [{"label": lbl, "state": "pending", "detail": ""} for lbl in first_steps]
    steps += [{"label": lbl, "state": "pending", "detail": ""} for lbl, _ in recompute_steps(conn_factory)]
    if extra_last:
        steps.append({"label": extra_last, "state": "pending", "detail": ""})
    job = {"id": uuidlib.uuid4().hex[:12], "kind": kind, "state": "queued",
           "started": datetime.now().isoformat(timespec="seconds"), "finished": None,
           "steps": steps, "log": [], "result": None, "error": None, "user": user}
    _JOBS[job["id"]] = job
    return job


def start_commit(token, conn_factory, remove_missing=True, user=None):
    with _LOCK:
        if any(j["state"] in ("running", "queued") and j.get("kind") == "import" for j in _JOBS.values()):
            raise RuntimeError("An import is already running.")
        sess = _SESSIONS.pop(token, None)
        if not sess:
            raise KeyError("This preview has expired -- please upload the files again.")
        job = _new_job("import", ["Save households and members", "Keep a copy of the uploaded files"],
                       conn_factory, user)
    t = threading.Thread(target=_run_import_job, args=(job, sess, conn_factory, remove_missing), daemon=True)
    t.start()
    return job["id"]


def start_recompute(conn_factory, reason, user=None, result=None):
    """Recalculate everything after a change made outside the import (a
    household added or removed by hand). Returns the job id."""
    with _LOCK:
        job = _new_job("recompute", [], conn_factory, user)
        job["reason"] = reason
        job["result"] = result
    t = threading.Thread(target=_run_recompute_job, args=(job, conn_factory), daemon=True)
    t.start()
    return job["id"]


def _step_runner(job):
    def log(msg):
        job["log"].append(f"{datetime.now().strftime('%H:%M:%S')}  {msg}")

    def run_step(i, fn):
        st = job["steps"][i]
        st["state"] = "running"
        t0 = time.time()
        try:
            out = fn(lambda m: (log(m), st.__setitem__("detail", m)))
            st["state"] = "done"
            st["seconds"] = round(time.time() - t0, 1)
            return out if out is not None else True
        except Exception as e:  # noqa: BLE001
            st["state"] = "failed"
            st["detail"] = str(e)[:400]
            log(f"FAILED: {st['label']}: {e}")
            traceback.print_exc()
            return None
    return log, run_step


def _finish(job):
    failed = [s["label"] for s in job["steps"] if s["state"] == "failed"]
    job["state"] = "done_with_errors" if failed else "done"


def _run_recompute_job(job, conn_factory):
    log, run_step = _step_runner(job)
    with _RUN_LOCK:
        job["state"] = "running"
        try:
            for n, (_lbl, fn) in enumerate(recompute_steps(conn_factory)):
                run_step(n, fn)
            _finish(job)
        except Exception as e:  # noqa: BLE001
            job["state"] = "failed"
            job["error"] = str(e)
            traceback.print_exc()
        finally:
            job["finished"] = datetime.now().isoformat(timespec="seconds")


def _run_import_job(job, sess, conn_factory, remove_missing):
    log, run_step = _step_runner(job)
    with _RUN_LOCK:
        job["state"] = "running"
        try:
            # step 0: database (fatal if it fails)
            def db(lg):
                conn = conn_factory()
                try:
                    return write_to_database(conn, sess["households"], sess["individuals"],
                                             remove_missing=remove_missing, log=lg, user=job.get("user"))
                finally:
                    conn.close()
            summary = run_step(0, db)
            if summary is None:
                job["state"] = "failed"
                job["error"] = job["steps"][0]["detail"]
                for s in job["steps"][1:]:
                    s["state"] = "skipped"
                return
            job["result"] = summary
            run_step(1, lambda lg: install_source_files(sess["frames"], lg))
            for n, (_lbl, fn) in enumerate(recompute_steps(conn_factory), start=2):
                run_step(n, fn)
            _finish(job)
        except Exception as e:  # noqa: BLE001
            job["state"] = "failed"
            job["error"] = str(e)
            traceback.print_exc()
        finally:
            job["finished"] = datetime.now().isoformat(timespec="seconds")
            shutil.rmtree(sess.get("dir", ""), ignore_errors=True)


def job_status(job_id):
    j = _JOBS.get(job_id)
    if not j:
        return None
    return {k: v for k, v in j.items() if k != "user"}


def latest_job():
    if not _JOBS:
        return None
    return job_status(sorted(_JOBS.values(), key=lambda j: j["started"])[-1]["id"])
