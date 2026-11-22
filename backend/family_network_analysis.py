"""
Family network analysis for ONE household, built with networkx.

Used by GET /api/network/households/<id>/analysis (app.py), which feeds the
Family Network Analysis page's PDF report and data export.

The graph is the same one the page draws: every household member is a
node, every relationship edge network_engine.py stored in
tbl_network_edges is a link. Edges between two different nuclear families
(household head -> another family's own head) are kept but flagged
`cross_family=True`, because the page does not draw them as kinship lines
(they come from CBMS nuclear-family grouping, not a verified blood tie).

What it measures, and why a planner would care:
  * dependents (minors 0-17, seniors 60+, PWD) and, for each one, the
    nearest working-age adult (18-59) in the network and how many links
    away they are -> who needs assisted evacuation and who is their most
    likely helper;
  * caregiver load -> working-age adults directly linked to several
    dependents at once;
  * key connectors -> articulation points (members whose absence splits the
    household network) and betweenness centrality;
  * structure -> families, links, density, diameter, hops from the head,
    and members with no recorded relationship at all.

Nothing here is a vulnerability score; it describes family structure only.
"""

import networkx as nx


def _to_bool(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "y")
    return False


def _age(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _age_group(age):
    if age is None:
        return "Unknown"
    if age <= 17:
        return "Minor (0-17)"
    if age >= 60:
        return "Senior (60+)"
    return "Adult (18-59)"


def analyze_household_network(people, edges, head_person_id=None):
    """
    people: list of dicts with person_id, name, age, gender, is_pwd,
            is_senior, is_household_head, relationship_to_hh, family_id
    edges:  list of dicts with source_pid, target_pid, edge_type
    Returns a JSON-serializable dict.
    """
    G = nx.Graph()
    for p in people:
        age = _age(p.get("age"))
        is_pwd = _to_bool(p.get("is_pwd"))
        is_senior = _to_bool(p.get("is_senior")) or (age is not None and age >= 60)
        is_minor = age is not None and age <= 17
        G.add_node(
            p["person_id"],
            name=p.get("name") or f"Person {p['person_id']}",
            age=age,
            gender=p.get("gender"),
            is_pwd=is_pwd,
            is_senior=is_senior,
            is_minor=is_minor,
            is_dependent=is_minor or is_senior or is_pwd,
            is_working_age=(age is not None and 18 <= age <= 59 and not is_pwd),
            is_head=_to_bool(p.get("is_household_head")),
            relationship=p.get("relationship_to_hh"),
            family_id=p.get("family_id"),
        )

    for e in edges:
        s, t = e["source_pid"], e["target_pid"]
        if s not in G or t not in G or s == t:
            continue
        cross = G.nodes[s]["family_id"] != G.nodes[t]["family_id"]
        G.add_edge(s, t, relationship=e.get("edge_type"), cross_family=cross)

    n = G.number_of_nodes()
    if n == 0:
        return {"empty": True}

    head = head_person_id if head_person_id in G else next(
        (v for v, d in G.nodes(data=True) if d["is_head"]), next(iter(G.nodes))
    )

    # ── Structure ────────────────────────────────────────────────────────
    components = list(nx.connected_components(G))
    head_component = next(c for c in components if head in c)
    unlinked = [v for v in G.nodes if v not in head_component]
    hops_from_head = nx.single_source_shortest_path_length(G, head)
    largest = G.subgraph(max(components, key=len))
    diameter = nx.diameter(largest) if largest.number_of_nodes() > 1 else 0
    families = sorted({d["family_id"] for _, d in G.nodes(data=True) if d["family_id"] is not None})

    betweenness = nx.betweenness_centrality(G, normalized=True) if n > 2 else {v: 0.0 for v in G}
    articulation = set(nx.articulation_points(G)) if n > 2 else set()

    # ── Dependents -> nearest working-age adult ──────────────────────────
    working = {v for v, d in G.nodes(data=True) if d["is_working_age"]}
    dependents_out = []
    for v, d in G.nodes(data=True):
        if not d["is_dependent"]:
            continue
        lengths = nx.single_source_shortest_path_length(G, v)
        candidates = sorted(
            ((dist, u) for u, dist in lengths.items() if u in working and u != v),
            # tie-break: same nuclear family first, then the better-connected adult
            key=lambda t: (t[0], G.nodes[t[1]]["family_id"] != d["family_id"], -G.degree(t[1])),
        )
        nearest = candidates[0] if candidates else None
        reasons = [r for r, flag in (("Minor", d["is_minor"]), ("Senior", d["is_senior"]), ("PWD", d["is_pwd"])) if flag]
        dependents_out.append({
            "person_id": v,
            "name": d["name"],
            "age": d["age"],
            "relationship": d["relationship"] or ("Head" if d["is_head"] else None),
            "dependent_type": " + ".join(reasons),
            "nearest_adult_id": nearest[1] if nearest else None,
            "nearest_adult_name": G.nodes[nearest[1]]["name"] if nearest else None,
            "nearest_adult_age": G.nodes[nearest[1]]["age"] if nearest else None,
            "hops_to_adult": nearest[0] if nearest else None,
            # Directly linked to a working-age adult = a likely helper during
            # evacuation; anything further (or none at all) needs follow-up.
            "directly_supported": bool(nearest and nearest[0] == 1),
        })
    dependents_out.sort(key=lambda r: (r["directly_supported"], -(r["hops_to_adult"] or 99), -(r["age"] or 0)))

    # ── Caregiver load: dependents directly linked to each working adult ─
    caregivers = []
    for v in working:
        dep_neighbors = [u for u in G.neighbors(v) if G.nodes[u]["is_dependent"]]
        if dep_neighbors:
            caregivers.append({
                "person_id": v,
                "name": G.nodes[v]["name"],
                "age": G.nodes[v]["age"],
                "relationship": G.nodes[v]["relationship"] or ("Head" if G.nodes[v]["is_head"] else None),
                "dependents_linked": len(dep_neighbors),
                "dependent_names": [G.nodes[u]["name"] for u in dep_neighbors],
            })
    caregivers.sort(key=lambda r: -r["dependents_linked"])

    # ── Members table with per-person network metrics ────────────────────
    members = []
    for v, d in G.nodes(data=True):
        members.append({
            "person_id": v,
            "name": d["name"],
            "age": d["age"],
            "age_group": _age_group(d["age"]),
            "gender": d["gender"],
            "relationship": d["relationship"] or ("Head" if d["is_head"] else None),
            "family_id": d["family_id"],
            "is_head": d["is_head"],
            "is_pwd": d["is_pwd"],
            "is_senior": d["is_senior"],
            "is_dependent": d["is_dependent"],
            "degree": G.degree(v),
            "betweenness": round(betweenness.get(v, 0.0), 3),
            "is_key_connector": v in articulation,
            "hops_from_head": hops_from_head.get(v),
        })
    members.sort(key=lambda m: (not m["is_head"], m["hops_from_head"] if m["hops_from_head"] is not None else 99, -(m["age"] or 0)))

    key_connectors = sorted(
        (m for m in members if m["is_key_connector"]),
        key=lambda m: -m["betweenness"],
    )

    n_minor = sum(1 for _, d in G.nodes(data=True) if d["is_minor"])
    n_senior = sum(1 for _, d in G.nodes(data=True) if d["is_senior"])
    n_pwd = sum(1 for _, d in G.nodes(data=True) if d["is_pwd"])
    n_working = len(working)
    n_dependents = sum(1 for _, d in G.nodes(data=True) if d["is_dependent"])

    return {
        "empty": False,
        "summary": {
            "members": n,
            "families": len(families),
            "links": G.number_of_edges(),
            "kinship_links": sum(1 for *_, d in G.edges(data=True) if not d["cross_family"]),
            "cross_family_links": sum(1 for *_, d in G.edges(data=True) if d["cross_family"]),
            "density": round(nx.density(G), 3) if n > 1 else 0.0,
            "diameter": diameter,
            "max_hops_from_head": max(hops_from_head.values()) if hops_from_head else 0,
            "components": len(components),
            "unlinked_members": len(unlinked),
            "minors": n_minor,
            "seniors": n_senior,
            "pwd": n_pwd,
            "working_age_adults": n_working,
            "dependents": n_dependents,
            # (minors + seniors) per working-age adult. PWD adults are
            # counted as dependents above but not added again here, so the
            # ratio stays comparable to the usual demographic definition.
            "dependency_ratio": round((n_minor + n_senior) / n_working, 2) if n_working else None,
            "dependents_without_direct_adult": sum(1 for r in dependents_out if not r["directly_supported"]),
            "max_caregiver_load": caregivers[0]["dependents_linked"] if caregivers else 0,
        },
        "head_person_id": head,
        "members": members,
        "dependents": dependents_out,
        "caregivers": caregivers,
        "key_connectors": key_connectors,
        "unlinked": [{"person_id": v, "name": G.nodes[v]["name"]} for v in unlinked],
        "method": (
            "networkx graph of household members (nodes) and recorded relationships "
            "(edges). Key connectors = articulation points; betweenness = normalized "
            "betweenness centrality; nearest adult = shortest path to a working-age "
            "(18-59, non-PWD) member."
        ),
    }
