"""
Builds the curated, read-only analytical database the NLP-to-DB feature
queries -- backend/nlp_db.py never touches the production Postgres
database (tbl_households, tbl_individuals, etc.) at all.

Why a separate SQLite file instead of Postgres views on the real DB
(as the NLP_TO_DB_INTEGRATION_SKILL.md sketch assumed a single shared
database): the production DB holds household/person-level CBMS
microdata (names, coordinates, PWD/senior status...). Sir Shem's own
skill doc says to "hide household/person identifiers and coordinates"
from the LLM-facing layer. Rather than trust an allowlist + SQL
validator alone to keep those columns out of reach on a DB that also
contains them, this script copies ONLY the already-aggregated,
barangay-level outputs of the domain pipeline (data/domain_pipeline_
results/*.csv -- the same CSVs routes/domain_vulnerability_routes.py
already serves) into their own SQLite file. Structurally, there is no
PII in this file to leak, on top of the SQL-validator/allowlist
defenses in nlp_db.py -- defense in depth, not reliance on one layer.

Run this from backend/ after (re)running run_domain_pipeline.py,
facility_access_score.py and typology_barangay_aggregate.py, whenever
their output CSVs change:

    python build_nlp_views.py

Rebuilds data/nlp_analytics.sqlite from scratch every run (safe to
re-run any time; it's a derived artifact, never hand-edited).
"""
import csv
import os
import sqlite3

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "domain_pipeline_results")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "nlp_analytics.sqlite")


def _read_csv(name):
    path = os.path.join(RESULTS_DIR, name)
    if not os.path.exists(path):
        print(f"  (skipped {name} -- not found; run the script that generates it first)")
        return None
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 4)
    except (ValueError, TypeError):
        return v


def _pct(v):
    """proportion (0-1) -> percentage (0-100), rounded for readability."""
    n = _num(v)
    return round(n * 100, 1) if isinstance(n, (int, float)) else None


def _psgc(v):
    """Normalise PSGC codes to the 10-digit, zero-padded form. Some pipeline
    CSVs drop the leading zero (603041022 vs 0603041022)."""
    if v is None or str(v).strip() == "":
        return None
    return str(v).strip().split(".")[0].zfill(10)


def _tier(rank):
    """Equal 6-barangay quartiles by rank -- same convention as the
    Planning and Reports pages. Rank 1 = worst in the domain."""
    if rank is None or not isinstance(rank, (int, float)):
        return None
    if rank <= 6:
        return "High"
    if rank <= 12:
        return "Moderate-high"
    if rank <= 18:
        return "Moderate-low"
    return "Low"


# Barangay Capacity items: (column in the view, label in sanmiguel_student/config.py)
CAPACITY_ITEMS = [
    ("has_disaster_committee", "Disaster management committee"),
    ("has_response_team", "Emergency response team"),
    ("has_emergency_hotline", "Emergency hotline"),
    ("held_preparedness_seminar", "Preparedness seminar past 12 months"),
    ("has_drrm_plan", "Barangay DRRM plan"),
    ("has_evacuation_map", "Evacuation map"),
    ("has_hazard_map", "Hazard map"),
    ("first_aid_kits", "First-aid kits"),
    ("boats_vans_buses", "Boats/vans/buses"),
    ("ambulances", "Ambulances"),
    ("amphibian_vehicles", "Amphibian vehicles"),
    ("heavy_equipment", "Heavy equipment"),
    ("sirens", "Sirens"),
    ("two_way_radios", "Two-way radios/communications equipment"),
    ("generators", "Portable/solar generators"),
    ("emergency_lights", "Emergency lights"),
    ("drrm_expenditure_php", "2023 DRRM expenditures (PHP)"),
    ("schools", "Schools"),
    ("evacuation_centres", "Evacuation centres"),
]


def _capacity_tier(rank):
    if rank is None or not isinstance(rank, (int, float)):
        return None
    return "High capacity" if rank <= 6 else "Moderate-high" if rank <= 12 else "Moderate-low" if rank <= 18 else "Low capacity"


def _capacity_rows():
    """capacity_scores.csv + each item's value from the CBMS barangay record
    (schools / evacuation centres counted from their map locations), the
    same way routes/domain_vulnerability_routes.py /capacity builds them."""
    scores = _read_csv("capacity_scores.csv")
    if not scores:
        return []
    values = {}
    try:
        import pandas as pd
        from sanmiguel_student.config import PRIMARY_BINARY_CAPACITY, PRIMARY_COUNT_CAPACITY, FACILITY_COUNT_CAPACITY
        from sanmiguel_student.io import psgc10, _drop_unnamed
        from facility_counts import add_facility_counts
        rec_path = os.path.join(RESULTS_DIR, "..", "cbms_barangay_record.csv")
        br = add_facility_counts(_drop_unnamed(pd.read_csv(rec_path, low_memory=False)))
        br["psgc_10d"] = psgc10(br["barangay_geo_code"])
        field = {**PRIMARY_BINARY_CAPACITY, **PRIMARY_COUNT_CAPACITY, **FACILITY_COUNT_CAPACITY}
        binary = set(PRIMARY_BINARY_CAPACITY.values())
        for _, rec in br.iterrows():
            out = {}
            for col, label in CAPACITY_ITEMS:
                f = field.get(label)
                v = pd.to_numeric(rec.get(f), errors="coerce") if f else None
                if v is None or pd.isna(v):
                    out[col] = None
                elif f in binary:
                    out[col] = 1 if int(v) == 1 else 0
                else:
                    out[col] = float(v)
            values[str(rec["psgc_10d"]).zfill(10)] = out
    except Exception as e:  # pragma: no cover - logged, scores still built
        print(f"  (capacity item values skipped: {e})")
    hh = {_psgc(r.get("psgc_10d")): _num(r.get("households")) for r in (_read_csv("vulnerability_scores.csv") or [])}
    rows = []
    for r in scores:
        pid = _psgc(r.get("psgc_10d"))
        rank = _num(r.get("capacity_rank"))
        row = {"psgc_10d": pid, "barangay": r.get("barangay"), "households": hh.get(pid),
               "capacity_score": _num(r.get("capacity_score")), "capacity_rank": rank, "capacity_tier": _capacity_tier(rank)}
        row.update(values.get(pid, {}))
        rows.append(row)
    return rows


def build():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    tables_built = []

    # ── vw_barangay_vulnerability (Domain A: SVI) ──────────────────────
    rows = _read_csv("vulnerability_scores.csv")
    if rows:
        cur.execute("""
            CREATE TABLE vw_barangay_vulnerability (
                psgc_10d TEXT PRIMARY KEY,
                barangay TEXT,
                households INTEGER,
                population INTEGER,
                overcrowding_pct REAL,
                food_insecure_pct REAL,
                no_internet_pct REAL,
                weak_roof_pct REAL,
                weak_wall_pct REAL,
                insecure_tenure_pct REAL,
                unimproved_sanitation_pct REAL,
                pwd_pct REAL,
                senior_pct REAL,
                solo_parent_pct REAL,
                low_adult_education_pct REAL,
                rhu_median_km REAL,
                fire_median_km REAL,
                rhu_pct_beyond_2km REAL,
                fire_pct_beyond_2km REAL,
                svi_score REAL,
                svi_rank INTEGER,
                svi_tier TEXT,
                pwd_count INTEGER,
                senior_count INTEGER,
                solo_parent_count INTEGER,
                rhu_households_beyond_2km INTEGER,
                fire_households_beyond_2km INTEGER
            )
        """)
        for r in rows:
            cur.execute("""
                INSERT INTO vw_barangay_vulnerability VALUES
                (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                _psgc(r.get("psgc_10d")), r.get("barangay"), _num(r.get("households")), _num(r.get("population")),
                _pct(r.get("overcrowding_prop")), _pct(r.get("food_insecure_prop")), _pct(r.get("no_internet_prop")),
                _pct(r.get("weak_roof_prop")), _pct(r.get("weak_wall_prop")), _pct(r.get("insecure_tenure_prop")),
                _pct(r.get("unimproved_sanitation_prop")),
                _pct(r.get("pwd_prop")), _pct(r.get("senior_prop")), _pct(r.get("solo_parent_prop")),
                _pct(r.get("low_adult_education_prop")),
                _num(r.get("rhu_median_km")), _num(r.get("fire_median_km")),
                _num(r.get("rhu_pct_beyond_2km")), _num(r.get("fire_pct_beyond_2km")),
                _num(r.get("svi_score")), _num(r.get("svi_rank")), _tier(_num(r.get("svi_rank"))),
                _num(r.get("pwd_n")), _num(r.get("senior_n")), _num(r.get("solo_parent_n")),
                _num(r.get("rhu_n_beyond_2km")), _num(r.get("fire_n_beyond_2km")),
            ))
        tables_built.append(("vw_barangay_vulnerability", len(rows)))

    # ── vw_barangay_capacity (Barangay Capacity: resources and readiness) ─
    # The SAME 16-item model the Capacity page, the map and the reports use
    # (capacity_scores.csv), plus each item's raw value from the CBMS
    # barangay record so questions like "which barangays have no ambulance?"
    # can be answered. capacity_rank 1 = BEST equipped. Distance is not
    # part of capacity -- it is in vw_barangay_vulnerability (SVI).
    rows = _capacity_rows()
    if rows:
        cols = ["psgc_10d", "barangay", "households", "capacity_score", "capacity_rank", "capacity_tier"] + [c for c, _ in CAPACITY_ITEMS]
        types = ["TEXT PRIMARY KEY", "TEXT", "INTEGER", "REAL", "INTEGER", "TEXT"] + ["REAL" for _ in CAPACITY_ITEMS]
        cur.execute("CREATE TABLE vw_barangay_capacity (" + ", ".join(f"{c} {t}" for c, t in zip(cols, types)) + ")")
        cur.executemany(f"INSERT INTO vw_barangay_capacity VALUES ({','.join('?' * len(cols))})",
                        [tuple(r.get(c) for c in cols) for r in rows])
        tables_built.append(("vw_barangay_capacity", len(rows)))

    # ── vw_hazard_exposure (Domain B, real spatial join) ────────────────
    rows = _read_csv("hazard_exposure_by_barangay.csv")
    if rows:
        cur.execute("""
            CREATE TABLE vw_hazard_exposure (
                psgc_10d TEXT PRIMARY KEY,
                barangay TEXT,
                households INTEGER,
                flood_mapped_households INTEGER,
                flood_unmapped_households INTEGER,
                flood_high_or_very_high_households INTEGER,
                flood_high_or_very_high_pct_total REAL,
                landslide_mapped_households INTEGER,
                landslide_unmapped_households INTEGER,
                landslide_moderate_or_high_households INTEGER,
                landslide_moderate_or_high_pct_total REAL,
                eil_mapped_households INTEGER,
                eil_unmapped_households INTEGER,
                eil_moderate_or_high_households INTEGER,
                eil_moderate_or_high_pct_total REAL,
                liquefaction_mapped_households INTEGER,
                liquefaction_unmapped_households INTEGER
            )
        """)
        for r in rows:
            cur.execute("""
                INSERT INTO vw_hazard_exposure VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                r.get("psgc_10d"), r.get("barangay"), _num(r.get("households")),
                _num(r.get("flood_mapped_households")), _num(r.get("flood_unmapped_households")),
                _num(r.get("flood_high_or_very_high_households")), _num(r.get("flood_high_or_very_high_pct_total")),
                _num(r.get("landslide_mapped_households")), _num(r.get("landslide_unmapped_households")),
                _num(r.get("landslide_moderate_or_high_households")), _num(r.get("landslide_moderate_or_high_pct_total")),
                _num(r.get("erosion_induced_landslide_mapped_households")), _num(r.get("erosion_induced_landslide_unmapped_households")),
                _num(r.get("eil_moderate_or_high_households")), _num(r.get("eil_moderate_or_high_pct_total")),
                _num(r.get("liquefaction_mapped_households")), _num(r.get("liquefaction_unmapped_households")),
            ))
        tables_built.append(("vw_hazard_exposure", len(rows)))

    # ── vw_household_typology (long format: one row per barangay x cluster) ──
    # Deliberately barangay-level only -- household_typology_k5.csv has raw
    # coordinates/uuids and is NOT read by this script at all, matching
    # the skill doc's "do not expose household coordinates to the LLM"
    # and its guidance to prefer an aggregate view for hazard x profile
    # questions.
    rows = _read_csv("typology_barangay_k5.csv")
    if rows:
        cur.execute("""
            CREATE TABLE vw_household_typology (
                psgc_10d TEXT,
                barangay TEXT,
                n_households INTEGER,
                cluster_id INTEGER,
                cluster_label TEXT,
                pct REAL,
                is_dominant_cluster INTEGER
            )
        """)
        cluster_cols = [k for k in rows[0].keys() if k.startswith("pct_cluster_")]
        n_inserted = 0
        for r in rows:
            dominant_id = _num(r.get("dominant_cluster_id"))
            for col in cluster_cols:
                rest = col[len("pct_cluster_"):]
                cid_str, _, label_slug = rest.partition("__")
                cid = _num(cid_str)
                cur.execute("""
                    INSERT INTO vw_household_typology VALUES (?,?,?,?,?,?,?)
                """, (
                    r.get("psgc_10d"), r.get("barangay"), _num(r.get("n_households")),
                    cid, label_slug.replace("_", " "), _num(r.get(col)),
                    1 if dominant_id == cid else 0,
                ))
                n_inserted += 1
        tables_built.append(("vw_household_typology", n_inserted))

    # ── vw_barangay_priority (per-domain flags; the ONLY cross-domain view) ─
    # Mirrors the Planning page's verdict: each domain is flagged on its own
    # terms (SVI rank 1-12, i.e. High or Moderate-high tier; Barangay Capacity rank 13-24, the 12 least equipped; >=25% of households in
    # the flood High/Very-High or landslide Moderate/High band) and
    # domains_flagged simply COUNTS the flags. No combined score exists.
    if tables_built and {t for t, _ in tables_built} >= {
        "vw_barangay_vulnerability", "vw_barangay_capacity", "vw_hazard_exposure"
    }:
        cur.execute("""
            CREATE TABLE vw_barangay_priority AS
            SELECT v.psgc_10d AS psgc_10d, v.barangay AS barangay,
                   v.svi_rank AS svi_rank, c.capacity_rank AS capacity_rank,
                   h.flood_high_or_very_high_pct_total AS flood_pct,
                   h.landslide_moderate_or_high_pct_total AS landslide_pct,
                   CASE WHEN v.svi_rank <= 12 THEN 1 ELSE 0 END AS svi_flagged,
                   CASE WHEN c.capacity_rank >= 13 THEN 1 ELSE 0 END AS capacity_flagged,
                   CASE WHEN h.flood_high_or_very_high_pct_total >= 25
                          OR h.landslide_moderate_or_high_pct_total >= 25 THEN 1 ELSE 0 END AS hazard_flagged
            FROM vw_barangay_vulnerability v
            JOIN vw_barangay_capacity c ON c.psgc_10d = v.psgc_10d
            JOIN vw_hazard_exposure h ON h.barangay = v.barangay OR h.psgc_10d = v.psgc_10d
        """)
        cur.execute("ALTER TABLE vw_barangay_priority ADD COLUMN domains_flagged INTEGER")
        cur.execute("UPDATE vw_barangay_priority SET domains_flagged = svi_flagged + capacity_flagged + hazard_flagged")
        n = cur.execute("SELECT COUNT(*) FROM vw_barangay_priority").fetchone()[0]
        tables_built.append(("vw_barangay_priority", n))

    # ── dim_semantic_dictionary (Sec. 4 of the skill doc) ───────────────
    # Hand-authored, not guessed -- each row traces to the module/route
    # that actually computes that field (see comments), matching "Do not
    # assume names or meanings" / "Definitions must come from approved
    # system documentation, not guesses."
    cur.execute("""
        CREATE TABLE dim_semantic_dictionary (
            field_name TEXT,
            source_view TEXT,
            display_name TEXT,
            domain TEXT,
            definition TEXT,
            unit TEXT,
            direction TEXT,
            denominator TEXT,
            interpretation TEXT,
            caution TEXT
        )
    """)
    dictionary_rows = _semantic_dictionary_rows()
    cur.executemany(
        "INSERT INTO dim_semantic_dictionary VALUES (?,?,?,?,?,?,?,?,?,?)",
        dictionary_rows,
    )
    tables_built.append(("dim_semantic_dictionary", len(dictionary_rows)))

    con.commit()
    con.close()

    print(f"Built {DB_PATH}:")
    for name, n in tables_built:
        print(f"  {name}: {n} rows")
    if len(tables_built) < 6:
        print(
            "\nNote: some source CSVs were missing, so their table wasn't built. "
            "Re-run the relevant backend/*.py generator script, then re-run this."
        )


def _semantic_dictionary_rows():
    """(field_name, source_view, display_name, domain, definition, unit,
    direction, denominator, interpretation, caution)"""
    return [
        ("svi_score", "vw_barangay_vulnerability", "SVI Score", "social_vulnerability",
         "Access-augmented Social Vulnerability Index: equal-weight percentile-rank sum "
         "of 11 social indicators plus the % of households beyond 2 km of the RHU and of the fire station.", "percentile-rank sum (unbounded, higher = more vulnerable)",
         "higher = MORE vulnerable", "n/a",
         "Compare barangays by rank, not the raw score's magnitude.",
         "Never combine with capacity_score -- they are separate domains by design."),
        ("svi_rank", "vw_barangay_vulnerability", "SVI Rank", "social_vulnerability",
         "This barangay's rank among all 24 by svi_score.", "1-24",
         "lower number (rank 1) = MOST vulnerable", "n/a",
         "Rank 1 is the barangay of greatest concern for this domain.", None),
        ("overcrowding_pct", "vw_barangay_vulnerability", "Overcrowding rate", "social_vulnerability",
         "% of households classified as overcrowded.", "%", "higher = worse",
         "households in this barangay", None, None),
        ("food_insecure_pct", "vw_barangay_vulnerability", "Food insecurity rate", "social_vulnerability",
         "% of households flagged food-insecure.", "%", "higher = worse",
         "households in this barangay", None, None),
        ("no_internet_pct", "vw_barangay_vulnerability", "No internet access rate", "social_vulnerability",
         "% of households without internet access.", "%", "higher = worse",
         "households in this barangay", None, None),
        ("weak_roof_pct", "vw_barangay_vulnerability", "Weak roof material rate", "social_vulnerability",
         "% of households with weak/light roof material.", "%", "higher = worse",
         "households in this barangay", None, None),
        ("weak_wall_pct", "vw_barangay_vulnerability", "Weak wall material rate", "social_vulnerability",
         "% of households with weak/light outer wall material.", "%", "higher = worse",
         "households in this barangay", None, None),
        ("insecure_tenure_pct", "vw_barangay_vulnerability", "Insecure tenure rate", "social_vulnerability",
         "% of households without secure land/housing tenure.", "%", "higher = worse",
         "households in this barangay", None, None),
        ("unimproved_sanitation_pct", "vw_barangay_vulnerability", "Unimproved sanitation rate", "social_vulnerability",
         "% of households with an unimproved toilet facility.", "%", "higher = worse",
         "households in this barangay", None, None),
        ("pwd_pct", "vw_barangay_vulnerability", "PWD population share", "social_vulnerability",
         "% of the total population who are persons with disability.", "%", "higher = worse",
         "population in this barangay", None, None),
        ("senior_pct", "vw_barangay_vulnerability", "Senior citizen population share", "social_vulnerability",
         "% of the total population who are senior citizens (60+).", "%", "higher = worse",
         "population in this barangay", None, None),
        ("solo_parent_pct", "vw_barangay_vulnerability", "Solo-parent population share", "social_vulnerability",
         "% of the total population who are solo parents.", "%", "higher = worse",
         "population in this barangay", None, None),
        ("low_adult_education_pct", "vw_barangay_vulnerability", "Low adult education rate (adults 25+)", "social_vulnerability",
         "% of the adult (25+) population with less than high-school completion.", "%", "higher = worse",
         "adults 25+ in this barangay", None, None),
        ("rhu_pct_beyond_2km", "vw_barangay_vulnerability", "% of households beyond 2 km of RHU (SVI part)", "social_vulnerability",
         "% of this barangay's households more than 2 km (straight-line) from the Rural Health Unit. One of the 13 SVI parts.", "%",
         "higher = worse (farther)", "households in this barangay", None, None),
        ("fire_pct_beyond_2km", "vw_barangay_vulnerability", "% of households beyond 2 km of fire station (SVI part)", "social_vulnerability",
         "% of this barangay's households more than 2 km (straight-line) from the fire station. One of the 13 SVI parts.", "%",
         "higher = worse (farther)", "households in this barangay", None, None),
        ("rhu_median_km", "vw_barangay_vulnerability", "Median distance to RHU", "social_vulnerability",
         "Median straight-line household distance to the Rural Health Unit (context only, not in the SVI).", "km", "higher = worse (farther)",
         "n/a", None, None),
        ("fire_median_km", "vw_barangay_vulnerability", "Median distance to fire station", "social_vulnerability",
         "Median straight-line household distance to the fire station.", "km", "higher = worse (farther)",
         "n/a", None, None),

        ("svi_tier", "vw_barangay_vulnerability", "SVI Tier", "social_vulnerability",
         "Tier from svi_rank: equal 6-barangay quartiles (High = rank 1-6, Moderate-high = 7-12, "
         "Moderate-low = 13-18, Low = 19-24).", "category", "High = MOST vulnerable", "n/a",
         "Tiers are rank positions, not fixed score cutoffs.", None),

        ("capacity_score", "vw_barangay_capacity", "Barangay Capacity score", "capacity",
         "Average of 0-100 percentiles of 16 scored resource items across the 24 barangays (organisation, plans and maps, "
         "schools and evacuation centres, first aid, rescue vehicles, sirens, radios, generators, lights, DRRM budget).",
         "0-100", "higher = BETTER equipped", "n/a",
         "Compare barangays by rank.", "A separate domain from svi_score and hazard -- never add or average them. Distance is NOT part of capacity."),
        ("capacity_rank", "vw_barangay_capacity", "Barangay Capacity rank", "capacity",
         "Rank among all 24 by capacity_score. Tied barangays share a rank.", "1-24",
         "rank 1 = BEST equipped (OPPOSITE direction to svi_rank); rank 24 = least equipped", "n/a",
         "For 'least equipped' or 'weakest capacity' order by capacity_rank DESC.", None),
        ("capacity_tier", "vw_barangay_capacity", "Barangay Capacity tier", "capacity",
         "'High capacity' = rank 1-6, 'Moderate-high' = 7-12, 'Moderate-low' = 13-18, 'Low capacity' = 19-24.",
         "category", "'Low capacity' = least equipped", "n/a", None, None),
        ("has_disaster_committee", "vw_barangay_capacity", "Has a disaster management committee", "capacity", "1 = yes, 0 = no (CBMS barangay record).", "0/1", "1 = has it", "n/a", None, None),
        ("has_response_team", "vw_barangay_capacity", "Has an emergency response team", "capacity", "1 = yes, 0 = no.", "0/1", "1 = has it", "n/a", None, None),
        ("has_emergency_hotline", "vw_barangay_capacity", "Has an emergency hotline", "capacity", "1 = yes, 0 = no.", "0/1", "1 = has it", "n/a", None, None),
        ("held_preparedness_seminar", "vw_barangay_capacity", "Conducted a disaster preparedness seminar", "capacity", "1 = yes, 0 = no (CBMS question F13).", "0/1", "1 = has it", "n/a", None, None),
        ("has_drrm_plan", "vw_barangay_capacity", "Has a barangay DRRM plan", "capacity", "1 = yes, 0 = no.", "0/1", "1 = has it", "n/a", None, "Every barangay has one, so it is not scored."),
        ("has_evacuation_map", "vw_barangay_capacity", "Has an evacuation map", "capacity", "1 = yes, 0 = no.", "0/1", "1 = has it", "n/a", None, None),
        ("has_hazard_map", "vw_barangay_capacity", "Has a hazard map", "capacity", "1 = yes, 0 = no.", "0/1", "1 = has it", "n/a", None, None),
        ("first_aid_kits", "vw_barangay_capacity", "First-aid kits", "capacity", "Number of first-aid kits.", "count", "higher = better", "n/a", None, None),
        ("boats_vans_buses", "vw_barangay_capacity", "Boats, vans and buses", "capacity", "Number of boats/vans/buses for evacuation.", "count", "higher = better", "n/a", None, "Same in every barangay, not scored."),
        ("ambulances", "vw_barangay_capacity", "Ambulances", "capacity", "Number of ambulances.", "count", "higher = better", "n/a", None, None),
        ("amphibian_vehicles", "vw_barangay_capacity", "Amphibian vehicles", "capacity", "Number of amphibian vehicles.", "count", "higher = better", "n/a", None, "Same in every barangay, not scored."),
        ("heavy_equipment", "vw_barangay_capacity", "Heavy equipment", "capacity", "Number of heavy equipment units.", "count", "higher = better", "n/a", None, None),
        ("sirens", "vw_barangay_capacity", "Sirens", "capacity", "Number of sirens.", "count", "higher = better", "n/a", None, None),
        ("two_way_radios", "vw_barangay_capacity", "Two-way radios", "capacity", "Number of two-way radios / communication equipment.", "count", "higher = better", "n/a", None, None),
        ("generators", "vw_barangay_capacity", "Generators", "capacity", "Number of portable/solar generators.", "count", "higher = better", "n/a", None, None),
        ("emergency_lights", "vw_barangay_capacity", "Emergency lights", "capacity", "Number of emergency lights.", "count", "higher = better", "n/a", None, None),
        ("drrm_expenditure_php", "vw_barangay_capacity", "2023 DRRM spending", "capacity", "Barangay DRRM expenditure in 2023.", "PHP", "higher = better", "n/a", None, None),
        ("schools", "vw_barangay_capacity", "Schools", "capacity", "Number of schools inside the barangay boundary.", "count", "higher = better", "n/a", None, None),
        ("evacuation_centres", "vw_barangay_capacity", "Evacuation centres", "capacity", "Number of evacuation centres inside the barangay boundary.", "count", "higher = better", "n/a", None, None),
        ("pwd_count", "vw_barangay_vulnerability", "Persons with disability (count)", "social_vulnerability", "Number of persons with disability.", "people", "higher = more", "n/a", None, None),
        ("senior_count", "vw_barangay_vulnerability", "Senior citizens 60+ (count)", "social_vulnerability", "Number of people aged 60 or older.", "people", "higher = more", "n/a", None, None),
        ("solo_parent_count", "vw_barangay_vulnerability", "Solo parents (count)", "social_vulnerability", "Number of solo parents.", "people", "higher = more", "n/a", None, None),
        ("rhu_households_beyond_2km", "vw_barangay_vulnerability", "Households beyond 2 km of the RHU (count)", "social_vulnerability", "Number of households more than 2 km from the RHU.", "households", "higher = worse", "n/a", None, None),
        ("fire_households_beyond_2km", "vw_barangay_vulnerability", "Households beyond 2 km of the fire station (count)", "social_vulnerability", "Number of households more than 2 km from the fire station.", "households", "higher = worse", "n/a", None, None),

        ("flood_high_or_very_high_households", "vw_hazard_exposure", "Households in high/very-high flood zones", "hazard_exposure",
         "Count of households whose coordinates fall in a High or Very High flood-susceptibility polygon "
         "(real point-in-polygon spatial join).", "count", "higher = worse", "n/a",
         None, "Households outside any mapped polygon are 'unmapped', never assumed safe -- see *_unmapped_households."),
        ("flood_high_or_very_high_pct_total", "vw_hazard_exposure", "% of households in high/very-high flood zones", "hazard_exposure",
         "flood_high_or_very_high_households as % of this barangay's total households.", "%", "higher = worse",
         "all households in this barangay (including unmapped)", None, None),
        ("flood_unmapped_households", "vw_hazard_exposure", "Households outside mapped flood zones", "hazard_exposure",
         "Households whose coordinates fall outside every polygon in the flood hazard layer.", "count",
         "n/a -- NOT the same as 'safe'", "n/a", None,
         "A high unmapped count means the hazard layer has limited coverage here, not that the barangay is safe from flooding."),
        ("landslide_moderate_or_high_households", "vw_hazard_exposure", "Households in moderate/high landslide zones", "hazard_exposure",
         "Count of households in a Moderate or High landslide-susceptibility polygon.", "count", "higher = worse", "n/a", None, None),
        ("landslide_moderate_or_high_pct_total", "vw_hazard_exposure", "% of households in moderate/high landslide zones", "hazard_exposure",
         "landslide_moderate_or_high_households as % of total households.", "%", "higher = worse",
         "all households in this barangay", None, None),
        ("eil_moderate_or_high_households", "vw_hazard_exposure", "Households in erosion-induced-landslide zones", "hazard_exposure",
         "Count of households in a moderate/depositional-zone EIL polygon.", "count", "higher = worse", "n/a", None, None),
        ("liquefaction_mapped_households", "vw_hazard_exposure", "Households in mapped liquefaction zones", "hazard_exposure",
         "Count of households falling inside the liquefaction hazard layer's polygons.", "count", "n/a", "n/a", None, None),

        ("domains_flagged", "vw_barangay_priority", "Domains flagged", "cross_domain",
         "Count (0-3) of domains in which this barangay is flagged: SVI (rank 1-12, High or Moderate-high tier), "
         "Barangay Capacity (rank 13-24, the 12 least equipped), Hazard (>=25% of households in the flood High/Very-High or landslide Moderate/High band). "
         "3 = Top Priority, 2 = High Priority.", "count 0-3", "higher = more domains flagged", "n/a",
         "This is a COUNT of flags, not a combined score. Always read the three flags separately.",
         "Never turn this into a weighted or summed score."),
        ("svi_flagged", "vw_barangay_priority", "SVI flagged", "cross_domain",
         "1 if svi_rank <= 12 (High or Moderate-high SVI tier).", "0/1", "1 = flagged", "n/a", None, None),
        ("capacity_flagged", "vw_barangay_priority", "Capacity flagged", "cross_domain",
         "1 if capacity_rank >= 13 (Moderate-low or Low capacity: the 12 least equipped barangays).", "0/1", "1 = flagged", "n/a", None, None),
        ("capacity_rank", "vw_barangay_priority", "Barangay Capacity rank", "cross_domain",
         "Copy of vw_barangay_capacity.capacity_rank (1 = best equipped).", "1-24", "rank 1 = BEST", "n/a", None, None),
        ("hazard_flagged", "vw_barangay_priority", "Hazard flagged", "cross_domain",
         "1 if flood (High/Very-High) or landslide (Moderate/High) exposure is >= 25% of households.",
         "0/1", "1 = flagged", "n/a", None, None),

        ("cluster_label", "vw_household_typology", "Household typology cluster", "household_typology",
         "One of 5 k-modes household-profile clusters (provisional labels, pending adviser confirmation).",
         "categorical", "n/a -- descriptive, not a severity scale", "n/a",
         "Cluster identity is descriptive of a household PROFILE, not automatically a ranking of vulnerability.",
         "Labels are provisional best-fit names pending adviser confirmation -- flag as provisional if asked."),
        ("pct", "vw_household_typology", "% of barangay's households in this cluster", "household_typology",
         "% of the barangay's households assigned to this cluster.", "%", "n/a",
         "households in this barangay", None, None),
        ("is_dominant_cluster", "vw_household_typology", "Is this the barangay's dominant cluster", "household_typology",
         "1 if this cluster has the largest share of households in this barangay, else 0.", "boolean (0/1)",
         "n/a", "n/a", None, None),
    ]


if __name__ == "__main__":
    build()
