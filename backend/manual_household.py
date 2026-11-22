"""
manual_household.py -- adding (and removing) a household by hand.

A hand-entered household is recorded with the same questions and codes as the
CBMS 2024 household questionnaire, so it goes through exactly the same steps
as an imported one:

  * its answers are turned into household + member rows by
    cbms_import.build_tables() (labels, counts, ratios, hazard exposure from
    the pinned location, household typology);
  * the raw answers are kept in data/manual/*.csv (CBMS columns), and the
    analysis files data/cbms_*.csv are rebuilt as census + hand-added
    households;
  * everything is then recalculated in the background (SVI, Capacity +
    Distance, hazard by barangay, typology, family network, Ask the Data).
"""
from __future__ import annotations

import re
import shutil
import uuid as uuidlib
from datetime import date

import pandas as pd

import cbms_codebook as CB
import cbms_import as CI

HOUSEHOLD_YES_NO = [
    "o11_electricity", "k01_internet_access", "overcrowding_status",
    "g01_worried", "g02_not_eaten_healthy", "g03_ate_few_food", "g04_skipped_meal",
    "g05_ate_less", "g06_ran_out_of_food", "g07_hungry", "g08_not_eaten_whole_day",
    "i01_a_bank_account", "i01_b_digital_bank_account", "i01_c_emoney_or_cash_card",
    "i01_d_nssla", "i01_e_account_with_coop", "i01_f_microfinance", "i01_g_money_remittance",
    "m01_a_sss", "m01_b_gsis", "m01_c_philhealth", "m01_d_health_insurance",
    "m05_a_4ps", "j02_location_of_evacuation", "j03_contact_hotline",
]
HOUSEHOLD_CODED = [
    "o03_roof", "o04_outer_walls", "o06_floor", "o09_tenure", "o12_fuel_for_lighting",
    "o13_fuel_for_cooking", "n01_main_water", "n08_toilet_facility",
]


def form_options():
    return {"options": CB.FORM_OPTIONS}


def _yn(v):
    """True/False/'1'/'2'/'yes' -> '1' (yes) or '2' (no)."""
    if isinstance(v, bool):
        return "1" if v else "2"
    s = str(v or "").strip().lower()
    return "1" if s in ("1", "yes", "true", "y") else "2"


def _clean(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()


def validate(payload):
    errors = []
    a = payload.get("answers") or {}
    members = payload.get("members") or []
    if not payload.get("barangay_id"):
        errors.append("Select the barangay.")
    try:
        lat, lon = float(payload.get("latitude")), float(payload.get("longitude"))
        if not (10.0 < lat < 11.5 and 121.5 < lon < 123.5):
            errors.append("The pinned location is outside San Miguel -- pin the house on the map.")
    except (TypeError, ValueError):
        errors.append("Pin the household's location on the map.")
    for f in HOUSEHOLD_CODED:
        if not str(a.get(f) or "").strip():
            errors.append(f"Answer: {LABELS.get(f, f)}.")
    if not members:
        errors.append("Add at least one household member.")
    heads = [m for m in members if str(m.get("a02_relation_to_hh_head")) == "1"]
    if members and len(heads) != 1:
        errors.append("Exactly one member must be the household head.")
    for n, m in enumerate(members, start=1):
        if not _clean(m.get("first_name")) or not _clean(m.get("last_name")):
            errors.append(f"Member {n}: first and last name are required.")
        try:
            age = int(m.get("age"))
            if not 0 <= age <= 120:
                raise ValueError
        except (TypeError, ValueError):
            errors.append(f"Member {n}: enter an age from 0 to 120.")
        if not str(m.get("a02_relation_to_hh_head") or "").strip():
            errors.append(f"Member {n}: choose the relationship to the household head.")
        if not str(m.get("a03_sex") or "").strip():
            errors.append(f"Member {n}: choose the sex.")
    return errors


LABELS = {
    "o03_roof": "roof material", "o04_outer_walls": "outer walls", "o06_floor": "floor",
    "o09_tenure": "tenure", "o12_fuel_for_lighting": "fuel for lighting",
    "o13_fuel_for_cooking": "fuel for cooking", "n01_main_water": "main source of water",
    "n08_toilet_facility": "toilet facility",
}


def _barangay_codes(cur, barangay_id):
    """tbl_barangays id -> (CBMS barangay name, geo code, location code row)."""
    cur.execute("SELECT barangay_name FROM tbl_barangays WHERE barangay_id = %s", (barangay_id,))
    r = CI._rows(cur)
    if not r:
        raise ValueError("Unknown barangay.")
    sys_name = r[0][0]
    reverse = {v: k for k, v in CI.BARANGAY_NAME_MAP.items()}
    cbms_name = reverse.get(sys_name)
    census = CI.CENSUS_DIR / CI.STANDARD_NAME["household"]
    if not census.exists():
        census = CI.DATA_DIR / CI.STANDARD_NAME["household"]
    cols = ["barangay", "barangay_geo_code", "city_mun_geo_code", "city_mun", "region_code",
            "province_code", "city_mun_code", "barangay_code"]
    ref = pd.read_csv(census, dtype=str, keep_default_na=False, usecols=lambda c: c in cols)
    if cbms_name is None:   # fall back to a loose name match
        norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower().replace("santo", "sto")  # noqa: E731
                                .replace("santa", "sta").replace("ñ", "n")
                                .replace("brgy", "").replace("bgy", "").replace("pob", ""))
        hit = [b for b in ref["barangay"].unique() if norm(b) == norm(sys_name)]
        cbms_name = hit[0] if hit else None
    rows = ref[ref["barangay"] == cbms_name]
    if cbms_name is None or rows.empty:
        raise ValueError(f"Could not find {sys_name} in the CBMS census files.")
    return sys_name, rows.iloc[0].to_dict()


def build_raw_rows(payload, loc, uid):
    """The household's answers as CBMS household + person rows."""
    a = payload.get("answers") or {}
    members = payload.get("members") or []
    water = str(a.get("n01_main_water"))
    toilet = str(a.get("n08_toilet_facility"))
    shared = _yn(a.get("n10_share_toilet")) == "1"
    far = bool(a.get("water_over_30min"))

    if water in CB.IMPROVED_WATER:
        water_sl = "2" if far else "1"
    elif water == "10":
        water_sl = "4"
    else:
        water_sl = "3"
    if toilet == "95":
        toilet_sl = "4"
    elif toilet in CB.IMPROVED_TOILET:
        toilet_sl = "2" if shared else "1"
    else:
        toilet_sl = "3"

    hh = {k: loc.get(k, "") for k in ("city_mun_geo_code", "barangay_geo_code", "city_mun",
                                       "barangay", "region_code", "province_code",
                                       "city_mun_code", "barangay_code")}
    hh.update({
        "uuid": uid, "husn": "", "hsn": "",
        "latitude": f"{float(payload['latitude']):.8f}",
        "longitude": f"{float(payload['longitude']):.8f}",
        "hh_size": str(len(members)),
        "n03_service_level_drinking_water": water_sl,
        "n08_service_level_toilet_facility": toilet_sl,
        "n10_share_toilet": "1" if shared else "2",
        "record_source": "manual",
        "surveyed_date": payload.get("surveyed_date") or date.today().isoformat(),
    })
    for f in HOUSEHOLD_CODED:
        hh[f] = str(a.get(f) or "")
    for f in HOUSEHOLD_YES_NO:
        hh[f] = _yn(a.get(f))

    # nuclear family: code + relation to that family's head (CBMS B01/B02)
    fam_first = {}
    rel_map_family1 = {"1": "1", "2": "2", "3": "4", "4": "5", "5": "4", "6": "5",
                       "11": "8", "12": "9", "15": "6", "16": "7"}
    persons = []
    for n, m in enumerate(members, start=1):
        age = int(m.get("age"))
        fam = str(m.get("nuclear_family") or "1").strip() or "1"
        a02 = str(m.get("a02_relation_to_hh_head"))
        if len(members) == 1:
            b02 = "0"
        elif fam == "1":
            b02 = rel_map_family1.get(a02, "10")
        else:
            b02 = "1" if fam not in fam_first else "10"
        fam_first.setdefault(fam, n)
        employed = m.get("employed")
        persons.append({
            "uuid": uid, "barangay_geo_code": loc.get("barangay_geo_code", ""),
            "barangay": loc.get("barangay", ""), "line_number": str(n),
            "a01_last_name": _clean(m.get("last_name")),
            "a01_first_name": _clean(m.get("first_name")),
            "a01_middle_name": _clean(m.get("middle_name")),
            "a01_suffix": _clean(m.get("suffix")),
            "a02_relation_to_hh_head": a02,
            "a03_sex": str(m.get("a03_sex") or ""),
            "a04_birthday_month": "", "a04_birthday_day": "", "a04_birthday_year": "",
            "a05_age": str(age),
            "a05_age_group_five_years": str(min(21, age // 5 + 1)),
            "a07_marital_status": str(m.get("a07_marital_status") or ""),
            "a08_religion": "",
            "a11_hgc_level": str(m.get("a11_hgc_level") if m.get("a11_hgc_level") not in (None, "") else "NA"),
            "b01_nuclear_family": fam,
            "b02_relation_to_nuclear_family_head": b02,
            "b05_solo_parent": _yn(m.get("solo_parent")) if age >= 10 else "NA",
            "b10_pwd": _yn(m.get("pwd")),
            "b11_with_pwd_id": "",
            "c02_ofi": "1" if m.get("ofw") else "6",
            "d01_currently_attending_school": _yn(m.get("in_school")) if age >= 3 else "NA",
            "e01_employment_status": ("NA" if age < 15 else ("1" if employed else "2")),
            "e05_occupation_group": (str(m.get("e05_occupation_group") or "NA")
                                     if (employed and age >= 15) else "NA"),
            "e05_psoc": "NA", "e08_class_of_worker": "NA",
        })
    return hh, persons


def save_household(payload, conn_factory, user=None):
    """Validate, write to the database, keep the raw answers, and start the
    recalculation. Returns {"household_id", "household_number", "job_id"}."""
    errors = validate(payload)
    if errors:
        return {"errors": errors}

    uid = str(uuidlib.uuid4())
    conn = conn_factory()
    try:
        cur = conn.cursor()
        _sys_name, loc = _barangay_codes(cur, int(payload["barangay_id"]))
    finally:
        conn.close()
    hh_row, person_rows = build_raw_rows(payload, loc, uid)

    work = CI.UPLOAD_ROOT / f"manual_{uid}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        hh_df = pd.DataFrame([hh_row])
        pp_df = pd.DataFrame(person_rows)
        hp, pp = work / "household.csv", work / "person.csv"
        hh_df.to_csv(hp, index=False)
        pp_df.to_csv(pp, index=False)
        frames = {"household": hh_df, "person": pp_df,
                  "_paths": {"household": str(hp), "person": str(pp)}}
        households, individuals, _typ = CI.build_tables(frames)
        households["surveyed_date"] = hh_row["surveyed_date"]

        conn = conn_factory()
        try:
            CI.write_to_database(conn, households, individuals, remove_missing=False, log=lambda *_: None)
            cur = conn.cursor()
            cur.execute("SELECT household_id, household_number FROM tbl_households WHERE uid_internal = %s",
                        (uid,))
            hid, code = CI._rows(cur)[0]
        finally:
            conn.close()

        _append_manual(hh_df, pp_df)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    h = households.iloc[0].map(lambda v: None if (not isinstance(v, str) and pd.isna(v)) else v)
    summary = {
        "household_id": int(hid), "household_number": code, "members": len(person_rows),
        "flood_exposure": h["flood_exposure"], "landslide_exposure": h["landslide_exposure"],
        "hazard_data_status": h["hazard_data_status"],
        "typology_cluster_label": h["typology_cluster_label"],
        "rhu_km": float(h["rhu_km"]), "fire_km": float(h["fire_km"]),
    }
    job_id = CI.start_recompute(conn_factory, f"Household {code} added", user=user, result=summary)
    return {**summary, "job_id": job_id}


def _append_manual(hh_df, pp_df):
    CI.MANUAL_DIR.mkdir(parents=True, exist_ok=True)
    for path, df in ((CI.MANUAL_HH, hh_df), (CI.MANUAL_PP, pp_df)):
        if path.exists():
            old = pd.read_csv(path, dtype=str, keep_default_na=False)
            old = old[~old["uuid"].isin(set(df["uuid"]))]
            df = pd.concat([old, df], ignore_index=True, sort=False).fillna("")
        df.to_csv(path, index=False)


def _drop_manual(uid):
    for path in (CI.MANUAL_HH, CI.MANUAL_PP):
        if path.exists():
            old = pd.read_csv(path, dtype=str, keep_default_na=False)
            old[old["uuid"] != uid].to_csv(path, index=False)


def delete_household(household_id, conn_factory, user=None, recalc=True):
    """Remove a household with its members and every row that points to it,
    then recalculate so the scores no longer count it."""
    conn = conn_factory()
    try:
        cur = conn.cursor()
        cur.execute("SELECT uid_internal, household_number FROM tbl_households WHERE household_id = %s",
                    (household_id,))
        r = CI._rows(cur)
        if not r:
            return {"error": "Household not found"}
        uid, code = r[0]
        cur.execute("CREATE TEMP TABLE _hh_del ON COMMIT DROP AS SELECT %s::int AS id", (household_id,))
        # the family network is rebuilt afterwards; clear links for this household's families first
        if CI._exists(cur, "tbl_families") and "family_id" in CI._columns(cur, "tbl_individuals"):
            cur.execute("""UPDATE tbl_individuals SET family_id = NULL
                           WHERE household_id = %s AND family_id IS NOT NULL""", (household_id,))
        removed = {}
        cur.execute("CREATE TEMP TABLE _ind_del ON COMMIT DROP AS "
                    "SELECT person_id AS id FROM tbl_individuals WHERE household_id = %s", (household_id,))
        CI._purge(cur, "tbl_individuals", "person_id", "_ind_del", removed)
        CI._purge(cur, "tbl_households", "household_id", "_hh_del", removed)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    if uid:
        _drop_manual(uid)
    job_id = CI.start_recompute(conn_factory, f"Household {code} removed", user=user) if recalc else None
    return {"message": "Household and all members deleted successfully", "job_id": job_id}
