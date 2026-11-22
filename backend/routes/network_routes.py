"""
Flask routes for the Family Network Analysis dashboard.

Matches the API contract already used by NetworkAnalysis.jsx:
    getBarangays()                          -> GET /network/barangays
    getNetworkHouseholds({q, barangay,
                           page, per_page})  -> GET /network/households
    getNetworkGraph(household_id)           -> GET /network/graph/<id>

Register in your app:

    from network_routes import network_bp
    app.register_blueprint(network_bp, url_prefix="/api")

Adjust url_prefix to match whatever your frontend's api.js base URL is.
"""

from flask import Blueprint, jsonify, request
from network_engine import b02_to_category, a02_to_category  # noqa: F401 (category maps reused if needed)
import psycopg2
import psycopg2.extras

network_bp = Blueprint("network", __name__)

# ── reuse your app's existing DB connection helper if you have one; ───────
# ── this is a minimal standalone version for drop-in use ──────────────────
from config import Config

# Same database settings as the rest of the app (backend/.env / environment).
DB = {
    "host": Config.DB_HOST,
    "port": int(Config.DB_PORT),
    "dbname": Config.DB_NAME,
    "user": Config.DB_USER,
    "password": Config.DB_PASSWORD,
}


def get_conn():
    return psycopg2.connect(**DB, cursor_factory=psycopg2.extras.RealDictCursor)


# ═══════════════════════════════════════════════════════════════════════
# GET /network/barangays
# ═══════════════════════════════════════════════════════════════════════
@network_bp.route("/network/barangays", methods=["GET"])
def get_barangays():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT barangay_id, barangay_name
                FROM tbl_barangays
                ORDER BY barangay_name;
            """)
            rows = cur.fetchall()
        return jsonify({"data": rows})
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════
# GET /network/households?q=&barangay=&page=&per_page=
#
# Returns ONE ROW PER NUCLEAR FAMILY, not per household. A household with
# more than one nuclear family (per network_engine.py's rebuild_network(),
# built from CBMS b01_nuclear_family) is represented as one duplicated row
# per family, each carrying:
#   - head_relationship: how that family's own head relates to the
#     HOUSEHOLD head (e.g. "Son/Daughter", "Grandchildren") -- null for
#     the head's own family.
#   - is_head_family: true for the row that is the household head's own
#     family.
#   - has_solo_parent / has_senior / has_pwd / is_4ps_beneficiary: real
#     per-family aggregates from tbl_families (network_engine.py), not
#     estimated.
#   - members: scoped to that family only (not the whole household).
# vuln_score/vuln_category/etc. remain HOUSEHOLD-level (there is no
# per-family vulnerability score anywhere in the pipeline) and are
# repeated identically across a household's duplicated rows -- the
# frontend labels this explicitly so it isn't mistaken for a per-family
# number.
# ═══════════════════════════════════════════════════════════════════════
@network_bp.route("/network/households", methods=["GET"])
def get_network_households():
    q = request.args.get("q", "").strip()
    barangay = request.args.get("barangay", "").strip()
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 200))
    offset = (page - 1) * per_page

    where = ["1=1"]
    params = []

    if barangay:
        where.append("b.barangay_name = %s")
        params.append(barangay)

    if q:
        where.append("""
            (h.household_number ILIKE %s
             OR EXISTS (
                 SELECT 1 FROM tbl_individuals i
                 WHERE i.household_id = h.household_id
                   AND i.full_name ILIKE %s
             ))
        """)
        params.extend([f"%{q}%", f"%{q}%"])

    where_sql = " AND ".join(where)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # ---- KPI aggregates over the FILTERED set (household-level;
            # not paginated, unaffected by the per-family row split below) ----
            cur.execute(f"""
                SELECT
                    COUNT(DISTINCT h.household_id) AS total_households,
                    COUNT(DISTINCT f.household_id) FILTER (WHERE f.n_families > 1) AS multi_family_count,
                    COUNT(DISTINCT h.household_id) FILTER (
                        WHERE vi.vuln_category IN ('High', 'Very High')
                          AND COALESCE(f.n_families, 1) > 1
                    ) AS masked_vuln_count
                FROM tbl_households h
                JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
                LEFT JOIN tbl_vulnerability_index vi ON vi.household_id = h.household_id
                LEFT JOIN (
                    SELECT household_id, COUNT(*) AS n_families
                    FROM tbl_families GROUP BY household_id
                ) f ON f.household_id = h.household_id
                WHERE {where_sql};
            """, params)
            kpi = cur.fetchone()

            # ---- total FAMILY rows matching the filter (for pagination) ----
            cur.execute(f"""
                SELECT COUNT(*) AS total
                FROM tbl_households h
                JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
                JOIN tbl_families f ON f.household_id = h.household_id
                WHERE {where_sql};
            """, params)
            total_family_rows = cur.fetchone()["total"] or 0

            # ---- paginated family list (one row per nuclear family) ----
            cur.execute(f"""
                WITH fam_counts AS (
                    SELECT household_id, COUNT(*) AS n_families
                    FROM tbl_families GROUP BY household_id
                ),
                cross_family_edges AS (
                    -- household head -> each other family's own head,
                    -- labeled by that head's relation to the household
                    -- head. Written once per multi-family household by
                    -- network_engine.py's rebuild_network().
                    --
                    -- The household head is ALSO the source of ordinary
                    -- within-family edges to their OWN family (spouse,
                    -- kids), so "sourced by the household head" alone
                    -- isn't enough to identify a cross-family link --
                    -- tgt.family_id <> src.family_id is what actually
                    -- distinguishes a real cross-family edge from the
                    -- head's own family edges (caught by manually running
                    -- this query against the real DB: without this, every
                    -- single-family household came back with a bogus
                    -- head_relationship and is_head_family=false on every
                    -- row).
                    SELECT tgt.family_id AS family_id, e.edge_type AS head_relationship
                    FROM tbl_network_edges e
                    JOIN tbl_individuals src ON ('person:' || src.person_id) = e.source_node
                    JOIN tbl_individuals tgt ON ('person:' || tgt.person_id) = e.target_node
                    WHERE src.is_household_head = true
                      AND tgt.family_id <> src.family_id
                )
                SELECT
                    h.household_id,
                    h.household_number,
                    b.barangay_name AS barangay,
                    h.hh_size,
                    f.family_id,
                    f.family_size,
                    f.has_solo_parent,
                    f.has_senior,
                    f.has_pwd,
                    f.is_4ps_beneficiary,
                    COALESCE(fc.n_families, 1) AS n_families,
                    cfe.head_relationship,
                    (cfe.head_relationship IS NULL) AS is_head_family,
                    vi.vuln_score, vi.vuln_category,
                    vi.resil_score, vi.resil_category,
                    vi.exposure_score, vi.sensitivity_score, vi.adaptive_capacity_score
                FROM tbl_households h
                JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
                JOIN tbl_families f ON f.household_id = h.household_id
                LEFT JOIN fam_counts fc ON fc.household_id = h.household_id
                LEFT JOIN cross_family_edges cfe ON cfe.family_id = f.family_id
                LEFT JOIN tbl_vulnerability_index vi ON vi.household_id = h.household_id
                WHERE {where_sql}
                ORDER BY h.household_id, is_head_family DESC, f.family_id
                LIMIT %s OFFSET %s;
            """, params + [per_page, offset])
            fam_rows = cur.fetchall()

            if fam_rows:
                family_ids = [r["family_id"] for r in fam_rows]
                cur.execute("""
                    SELECT family_id, person_id, age, is_pwd, gender
                    FROM tbl_individuals
                    WHERE family_id = ANY(%s);
                """, (family_ids,))
                members_by_family = {}
                for r in cur.fetchall():
                    members_by_family.setdefault(r["family_id"], []).append(r)
            else:
                members_by_family = {}

            data = []
            for r in fam_rows:
                d = dict(r)
                d["members"] = members_by_family.get(r["family_id"], [])
                # Vulnerability figures are household-level, shared across
                # every duplicated row for this household -- flagged so
                # the UI doesn't present it as a per-family number.
                d["vuln_score_is_household_level"] = True
                data.append(d)

        return jsonify({
            "data": data,
            "total": total_family_rows,
            "total_households": kpi["total_households"] or 0,
            "multi_family_count": kpi["multi_family_count"] or 0,
            "masked_vuln_count": kpi["masked_vuln_count"] or 0,
        })
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════
# GET /network/households/<household_id>/graph?family_id=
#
# Without family_id: unchanged behavior for a single-family household
# (the whole household in one tree).
#
# With family_id: the tree is scoped to just that nuclear family's own
# members and within-family edges. If that family is NOT the household's
# own head family, the household head is added back as one extra
# "connector" node (kind: "connector") linked by the single cross-family
# edge network_engine.py already stores (household head -> this family's
# head, labeled by that head's relation to the household head) -- the
# frontend renders this one edge/node dimmer, as a link to the rest of
# the household rather than part of this family's own tree.
# ═══════════════════════════════════════════════════════════════════════
@network_bp.route("/network/households/<int:household_id>/graph", methods=["GET"])
def get_network_graph(household_id):
    family_id = request.args.get("family_id", type=int)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT h.household_id, h.household_number, b.barangay_name
                FROM tbl_households h
                JOIN tbl_barangays b ON b.barangay_id = h.barangay_id
                WHERE h.household_id = %s;
            """, (household_id,))
            hh = cur.fetchone()
            if not hh:
                return jsonify({"error": "household not found"}), 404

            cur.execute("""
                SELECT person_id, full_name, last_name, first_name, age, gender,
                       is_pwd, is_senior, is_household_head, relationship_to_hh,
                       family_id
                FROM tbl_individuals
                WHERE household_id = %s
                ORDER BY person_id;
            """, (household_id,))
            people = cur.fetchall()
            person_ids = [p["person_id"] for p in people]
            node_ids = [f'person:{pid}' for pid in person_ids]

            cur.execute("""
                SELECT source_node, target_node, edge_type
                FROM tbl_network_edges
                WHERE source_node = ANY(%s) AND target_node = ANY(%s);
            """, (node_ids, node_ids))
            all_edges = cur.fetchall()

        people_by_id = {p["person_id"]: p for p in people}
        household_head = next((p for p in people if p["is_household_head"]), None)

        # No family_id given -> whole-household view (unchanged default),
        # anchored on the household head's own family.
        if family_id is None:
            family_id = household_head["family_id"] if household_head else None

        is_head_family = (
            household_head is not None and household_head["family_id"] == family_id
        )

        within_edges = []
        connector_edge = None
        for e in all_edges:
            src_pid = int(e["source_node"].split(":")[1])
            tgt_pid = int(e["target_node"].split(":")[1])
            src_p = people_by_id.get(src_pid)
            tgt_p = people_by_id.get(tgt_pid)
            if not src_p or not tgt_p:
                continue
            if src_p["family_id"] == family_id and tgt_p["family_id"] == family_id:
                within_edges.append(e)
            elif (
                not is_head_family
                and household_head is not None
                and src_pid == household_head["person_id"]
                and tgt_p["family_id"] == family_id
            ):
                connector_edge = e

        family_members = [p for p in people if p["family_id"] == family_id]

        # parent_id per person, derived from within-family edges only
        # (source = parent)
        parent_of = {}
        edge_type_of = {}
        for e in within_edges:
            target_pid = int(e["target_node"].split(":")[1])
            source_pid = int(e["source_node"].split(":")[1])
            parent_of[target_pid] = source_pid
            edge_type_of[target_pid] = e["edge_type"]

        if is_head_family:
            family_head_id = household_head["person_id"] if household_head else (
                family_members[0]["person_id"] if family_members else None
            )
        else:
            family_head_id = (
                int(connector_edge["target_node"].split(":")[1]) if connector_edge
                else (family_members[0]["person_id"] if family_members else None)
            )
        head_node_id = f'person:{family_head_id}' if family_head_id else None

        # For a non-head family, its own head node has no parent WITHIN the
        # family (it's the root of this family's tree), so edge_type_of
        # wouldn't otherwise carry a relationship label for it. Fill it in
        # from the connector edge, so this node's relationship_to_hh is
        # "how this family's head relates to the household head" (e.g.
        # "Son/Daughter") -- the frontend uses this to label the dashed
        # connector edge without needing separate edge lookups.
        if connector_edge and family_head_id is not None:
            edge_type_of[family_head_id] = connector_edge["edge_type"]

        nodes = []
        for p in family_members:
            pid = p["person_id"]
            nodes.append({
                "id": f"person:{pid}",
                "kind": "person",
                "label": f'{p["last_name"]}, {p["first_name"]}',
                "age": p["age"],
                "gender": p["gender"],
                "is_pwd": p["is_pwd"],
                "is_senior": p["is_senior"],
                "relationship_to_hh": (
                    edge_type_of.get(pid) if pid in edge_type_of
                    else ("Head" if p["is_household_head"] else None)
                ),
                "parent_id": (
                    f'person:{parent_of[pid]}' if pid in parent_of else None
                ),
                "family_id": p["family_id"],
            })

        edges_out = [
            {"source": e["source_node"], "target": e["target_node"], "type": e["edge_type"]}
            for e in within_edges
        ]

        # Non-head family: add the household head back as a dimmer
        # "connector" node, linked by the one cross-family edge -- this is
        # the "lighter connector to the rest of the household," not part
        # of this family's own tree.
        if not is_head_family and connector_edge and household_head:
            hh_head_id = household_head["person_id"]
            nodes.append({
                "id": f"person:{hh_head_id}",
                "kind": "connector",
                "label": f'{household_head["last_name"]}, {household_head["first_name"]}',
                "age": household_head["age"],
                "gender": household_head["gender"],
                "is_pwd": household_head["is_pwd"],
                "is_senior": household_head["is_senior"],
                "relationship_to_hh": "Head",
                "parent_id": None,
                "family_id": household_head["family_id"],
            })
            edges_out.append({
                "source": connector_edge["source_node"],
                "target": connector_edge["target_node"],
                "type": connector_edge["edge_type"],
                "is_connector": True,
            })

        nodes.append({
            "id": f"household:{household_id}",
            "kind": "household",
            "label": hh["household_number"],
        })

        return jsonify({
            "nodes": nodes,
            "edges": edges_out,
            "household": {"household_number": hh["household_number"], "barangay": hh["barangay_name"]},
            "head_node_id": head_node_id,
            "family_id": family_id,
            "is_head_family": is_head_family,
        })
    finally:
        conn.close()