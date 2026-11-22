"""
Network Analysis Engine — core logic
======================================
Reads tbl_individuals (already loaded by import_cbms2024_v2.py) and:

  1. Splits each household into its real nuclear families using
     nuclear_family (CBMS field B01) instead of guessing from names.
  2. Writes one row per nuclear family into tbl_families, with real
     computed demographics (not placeholders).
  3. Links each person to their family via tbl_individuals.family_id.
  4. Builds typed relationship edges into tbl_network_edges using
     relation_to_nuclear_family_head (CBMS field B02), decoded via
     the official PSA-CBMS codebook, with relationship_to_hh (A02)
     used only to disambiguate B02's "10 - Other family member" code.
  5. For households with more than one nuclear family, adds a
     connecting edge between the household head and each other
     family's head, labeled with that head's own relationship to the
     household head (e.g. "Son/Daughter" -> that family is the
     married son's family living in his parents' household).

This module is DB-connection-agnostic: pass in a psycopg2 connection.
Safe to re-run (it truncates tbl_families / tbl_network_edges and
resets tbl_individuals.family_id before rebuilding).
"""

from collections import defaultdict

# ── PSA-CBMS B02 codebook (relation to nuclear family head) ────────────────
B02_CODEBOOK = {
    "0":  "One Member HH",
    "1":  "Family Head",
    "2":  "Spouse",
    "3":  "Partner",
    "4":  "Son",
    "5":  "Daughter",
    "6":  "Brother",
    "7":  "Sister",
    "8":  "Father",
    "9":  "Mother",
    "10": "Other Family Member",
}

# ── Maps a raw relation string (from B02 decode or A02 field) to the ───────
# ── category labels the existing frontend (NetworkAnalysis.jsx) expects ───
FRONTEND_CATEGORY_MAP = {
    "spouse": "Spouse",
    "partner": "Spouse",
    "son": "Son/Daughter",
    "daughter": "Son/Daughter",
    "brother": "Brother/Sister",
    "sister": "Brother/Sister",
    "father": "Parents",
    "mother": "Parents",
    "son-in-law": "Son/Daughter-in-Law",
    "daughter-in-law": "Son/Daughter-in-Law",
    "grandson": "Grandchildren",
    "granddaughter": "Grandchildren",
    "brother-in-law": "Sister/Brother-in-Law",
    "sister-in-law": "Sister/Brother-in-Law",
    "father-in-law": "Parents",
    "mother-in-law": "Parents",
    "stepson": "Son/Daughter",
    "stepdaughter": "Son/Daughter",
    "nephew": "Other Relatives",
    "niece": "Other Relatives",
    "aunt": "Other Relatives",
    "uncle": "Other Relatives",
    "boarder": "Other Relatives",
    "domestic helper": "Other Relatives",
    "nonrelative": "Other Relatives",
    "other relative": "Other Relatives",
}


def a02_to_category(a02_value):
    """Map relationship_to_hh (A02) string to a frontend category label."""
    if not a02_value:
        return "Other Relatives"
    return FRONTEND_CATEGORY_MAP.get(a02_value.strip().lower(), "Other Relatives")


def b02_to_category(b02_code, a02_fallback=None):
    """
    Decode a B02 numeric code into the frontend category label.
    Code '10' (Other family member) is ambiguous on its own, so we
    fall back to the person's A02 (relationship to household head)
    to disambiguate -- this is the same approach we validated against
    the real dataset (grandchildren/in-laws/nephews mostly hide behind
    code 10).
    """
    code = (b02_code or "").strip()
    label = B02_CODEBOOK.get(code)

    if label in ("Spouse", "Partner"):
        return "Spouse"
    if label in ("Son", "Daughter"):
        return "Son/Daughter"
    if label in ("Brother", "Sister"):
        return "Brother/Sister"
    if label in ("Father", "Mother"):
        return "Parents"
    # code 10 ("Other Family Member") or missing/unrecognized code
    return a02_to_category(a02_fallback)


def age_bucket_counts(members):
    c0_5 = sum(1 for m in members if m["age"] is not None and 0 <= m["age"] <= 5)
    c6_17 = sum(1 for m in members if m["age"] is not None and 6 <= m["age"] <= 17)
    c18_59 = sum(1 for m in members if m["age"] is not None and 18 <= m["age"] <= 59)
    c60p = sum(1 for m in members if m["age"] is not None and m["age"] >= 60)
    return c0_5, c6_17, c18_59, c60p


def pick_family_head(members):
    """
    Choose the anchor/head person for a nuclear family group.
    Priority: B02 code '1' (Family Head) or '0' (One-member HH) ->
    fallback to is_household_head flag -> fallback to oldest member.
    """
    for m in members:
        if (m["relation_to_nuclear_family_head"] or "").strip() in ("1", "0"):
            return m
    for m in members:
        if m["is_household_head"]:
            return m
    return max(members, key=lambda m: (m["age"] or 0))


def build_family_aggregates(members):
    c0_5, c6_17, c18_59, c60p = age_bucket_counts(members)
    total_income = sum((m["monthly_income"] or 0) for m in members)
    family_size = len(members)
    employed = sum(
        1 for m in members
        if (m["employment_status"] or "").strip().lower().startswith("employed")
    )
    return {
        "family_size": family_size,
        "num_children_0_5": c0_5,
        "num_children_6_17": c6_17,
        "num_working_age_18_59": c18_59,
        "num_elderly_60_plus": c60p,
        "num_pwd": sum(1 for m in members if m["is_pwd"]),
        "total_family_income": round(float(total_income), 2),
        "per_capita_income": round(float(total_income) / family_size, 2) if family_size else 0,
        "num_employed_members": employed,
        "has_senior": c60p > 0,
        "has_pwd": any(m["is_pwd"] for m in members),
        "has_solo_parent": any(m["is_solo_parent"] for m in members),
        "is_4ps_beneficiary": any(m["is_4ps"] for m in members),
    }


def fetch_all_individuals(cur):
    cur.execute("""
        SELECT person_id, household_id, full_name, last_name, first_name,
               age, gender, is_pwd, is_senior, is_solo_parent, is_4ps,
               is_household_head, relationship_to_hh, nuclear_family,
               relation_to_nuclear_family_head, monthly_income,
               employment_status
        FROM tbl_individuals
        ORDER BY household_id, person_id;
    """)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def rebuild_network(conn, verbose=True):
    """
    Main entry point. Wipes and rebuilds tbl_families, tbl_individuals
    .family_id, and tbl_network_edges from tbl_individuals's raw
    nuclear_family / relation_to_nuclear_family_head / relationship_to_hh
    fields.
    """
    warnings = []

    with conn.cursor() as cur:
        if verbose:
            print("Loading individuals...")
        people = fetch_all_individuals(cur)

        # group by household, then by nuclear_family code within household
        by_household = defaultdict(list)
        for p in people:
            by_household[p["household_id"]].append(p)

        if verbose:
            print(f"  {len(people)} individuals across {len(by_household)} households")

        # ---- reset target tables ----
        # IMPORTANT: tbl_individuals.family_id is a FOREIGN KEY into
        # tbl_families. TRUNCATE ... CASCADE on tbl_families would cascade
        # into truncating tbl_individuals entirely (not just clearing the
        # reference) -- so we must clear the FK references first, then
        # truncate tbl_families WITHOUT cascade.
        if verbose:
            print("Resetting tbl_families / tbl_network_edges / family_id...")
        cur.execute("TRUNCATE tbl_network_edges RESTART IDENTITY;")
        cur.execute("UPDATE tbl_individuals SET family_id = NULL;")
        cur.execute("TRUNCATE tbl_family_indexes RESTART IDENTITY;")
        cur.execute("DELETE FROM tbl_families;")
        cur.execute("ALTER SEQUENCE tbl_families_family_id_seq RESTART WITH 1;")

        family_insert_sql = """
            INSERT INTO tbl_families (
                household_id, family_size, num_children_0_5, num_children_6_17,
                num_working_age_18_59, num_elderly_60_plus, num_pwd,
                total_family_income, per_capita_income, num_employed_members,
                has_senior, has_pwd, has_solo_parent, is_4ps_beneficiary
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING family_id;
        """
        edge_insert_sql = """
            INSERT INTO tbl_network_edges (source_node, target_node, edge_type)
            VALUES (%s, %s, %s);
        """

        multi_family_household_count = 0
        total_family_count = 0
        total_edge_count = 0

        for household_id, members in by_household.items():
            # group members by their nuclear_family code (B01)
            fam_groups = defaultdict(list)
            for m in members:
                nf_code = (m["nuclear_family"] or "1").strip() or "1"
                fam_groups[nf_code].append(m)

            if len(fam_groups) > 1:
                multi_family_household_count += 1

            household_head = next((m for m in members if m["is_household_head"]), None)

            family_id_by_nf_code = {}
            head_person_by_nf_code = {}

            # ---- create each nuclear family row + within-family edges ----
            for nf_code, fam_members in fam_groups.items():
                agg = build_family_aggregates(fam_members)
                cur.execute(family_insert_sql, (
                    household_id, agg["family_size"], agg["num_children_0_5"],
                    agg["num_children_6_17"], agg["num_working_age_18_59"],
                    agg["num_elderly_60_plus"], agg["num_pwd"],
                    agg["total_family_income"], agg["per_capita_income"],
                    agg["num_employed_members"], agg["has_senior"], agg["has_pwd"],
                    agg["has_solo_parent"], agg["is_4ps_beneficiary"],
                ))
                family_id = cur.fetchone()[0]
                total_family_count += 1
                family_id_by_nf_code[nf_code] = family_id

                person_ids = [m["person_id"] for m in fam_members]
                cur.execute(
                    "UPDATE tbl_individuals SET family_id = %s WHERE person_id = ANY(%s);",
                    (family_id, person_ids),
                )

                fam_head = pick_family_head(fam_members)
                head_person_by_nf_code[nf_code] = fam_head

                for m in fam_members:
                    if m["person_id"] == fam_head["person_id"]:
                        continue
                    category = b02_to_category(
                        m["relation_to_nuclear_family_head"],
                        a02_fallback=m["relationship_to_hh"],
                    )
                    cur.execute(edge_insert_sql, (
                        f'person:{fam_head["person_id"]}',
                        f'person:{m["person_id"]}',
                        category,
                    ))
                    total_edge_count += 1

            # ---- cross-family edges (multi-family households) ----
            if len(fam_groups) > 1 and household_head is not None:
                head_nf_code = (household_head["nuclear_family"] or "1").strip() or "1"
                for nf_code, fam_head in head_person_by_nf_code.items():
                    if nf_code == head_nf_code:
                        continue
                    category = a02_to_category(fam_head["relationship_to_hh"])
                    cur.execute(edge_insert_sql, (
                        f'person:{household_head["person_id"]}',
                        f'person:{fam_head["person_id"]}',
                        category,
                    ))
                    total_edge_count += 1
            elif len(fam_groups) > 1 and household_head is None:
                warnings.append(
                    f"household_id={household_id}: {len(fam_groups)} families but no "
                    f"is_household_head=True row found -- cross-family edges skipped."
                )

        conn.commit()

    if verbose:
        print(f"\nDone.")
        print(f"  Families created:            {total_family_count}")
        print(f"  Multi-family households:     {multi_family_household_count} / {len(by_household)}")
        print(f"  Edges created:                {total_edge_count}")
        if warnings:
            print(f"  Warnings: {len(warnings)}")
            for w in warnings[:10]:
                print(f"    - {w}")

    return {
        "families_created": total_family_count,
        "multi_family_households": multi_family_household_count,
        "total_households": len(by_household),
        "edges_created": total_edge_count,
        "warnings": warnings,
    }


if __name__ == "__main__":
    import psycopg2

    import os
    DB = {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "dbname": os.getenv("DB_NAME", "lgu_masterdata"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", ""),
    }
    conn = psycopg2.connect(**DB)
    try:
        rebuild_network(conn, verbose=True)
    finally:
        conn.close()