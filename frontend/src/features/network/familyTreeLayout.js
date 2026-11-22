// Family tree layout for the Network page's "Tree" view.
//
// One rule set for every household, whatever its mix of families:
//
//  * Generation rows. Every person sits on the row of their generation,
//    worked out from the relationship on each link (Parents = one row up,
//    Son/Daughter and in-laws = one row down, Grandchildren = two rows
//    down, Spouse / Brother-Sister / Sister-Brother-in-law = same row,
//    Other Relatives = inferred from the age gap). The rows are shared by
//    the whole household, so the same generation is always at the same
//    height, in every family.
//  * Couples sit side by side, joined by a short line; their children hang
//    below the middle of the couple from one shared line (the usual family-
//    tree look). Brothers/sisters and other same-row relatives sit to the
//    right; a parent who lives in the family sits above.
//  * Every nuclear family is its own panel, laid out on its own, then the
//    panels are placed left to right: the household head's family first,
//    then the others (older generation first). No line is drawn between
//    two families (a cross-family link is a CBMS grouping, not a verified
//    kinship line), so the panel caption names the relationship instead.
//  * Lines only run straight down/across, and every horizontal run sits in
//    the gap between rows, so no line passes through a person.
//
// Pure functions (no React) so the same code can be checked against every
// household in the database.

export const TREE = {
  LEVEL: 200,        // distance between generation rows (centre to centre)
  ROW_HALF: 62,      // half of the tallest circle (the head)
  COUPLE_GAP: 56,    // space between two spouses' circles
  SIB_GAP: 40,       // space between neighbouring people / sub-trees
  LATERAL_GAP: 64,   // space before a brother/sister/in-law's group
  FAMILY_GAP: 90,    // space between two family panels
  PANEL_PAD: 30,     // panel padding around its people
  CAPTION_H: 30,     // room for the panel caption
  BUS_DROP: 30,      // parent->child shared line: this far above the row's tallest circle
  LATERAL_RISE: 12,  // brother/sister bracket: this far above the row's tallest circle
};

const relKey = (rel) => (rel || "").trim().toLowerCase();

// Rows a link moves a person relative to whoever they're attached to.
export function genDelta(rel, fromAge, toAge) {
  const key = relKey(rel);
  if (key === "parents") return -1;
  if (key === "son/daughter" || key === "son/daughter-in-law") return 1;
  if (key === "grandchildren") return 2;
  if (key === "spouse" || key === "brother/sister" || key === "sister/brother-in-law") return 0;
  const a = Number(fromAge), b = Number(toAge);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const gap = b - a;
    if (gap <= -30) return 2;
    if (gap <= -13) return 1;
    if (gap >= 30) return -2;
    if (gap >= 13) return -1;
  }
  return 0;
}

const byAgeThenName = (a, b) => {
  const d = (Number(b.age) || 0) - (Number(a.age) || 0);
  return d !== 0 ? d : (a.label || "").localeCompare(b.label || "");
};

// ── Blocks: positioned people + how wide each generation row is ──────────
function newBlock() { return { x: {}, rows: {} }; }
function addToRow(block, g, lo, hi) {
  const r = block.rows[g];
  if (!r) block.rows[g] = [lo, hi];
  else { r[0] = Math.min(r[0], lo); r[1] = Math.max(r[1], hi); }
}
function place(block, id, x, g, half) { block.x[id] = x; addToRow(block, g, x - half, x + half); }
function shift(block, dx) {
  if (!dx) return block;
  Object.keys(block.x).forEach((id) => { block.x[id] += dx; });
  Object.values(block.rows).forEach((r) => { r[0] += dx; r[1] += dx; });
  return block;
}
function merge(into, from) {
  Object.assign(into.x, from.x);
  Object.entries(from.rows).forEach(([g, [lo, hi]]) => addToRow(into, g, lo, hi));
  return into;
}
function extent(block) {
  let lo = Infinity, hi = -Infinity;
  Object.values(block.rows).forEach((r) => { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); });
  return Number.isFinite(lo) ? [lo, hi] : [0, 0];
}
// How far `right` must move so that, on every row both use, it starts at
// least `gap` after `left` ends. (No shared row -> put it after left's full width.)
function packOffset(left, right, gap) {
  let need = -Infinity;
  Object.keys(right.rows).forEach((g) => {
    if (left.rows[g]) need = Math.max(need, left.rows[g][1] + gap - right.rows[g][0]);
  });
  if (need === -Infinity) need = extent(left)[1] + gap - extent(right)[0];
  return need;
}
// Smallest move to the right that removes any overlap with `base` on shared rows.
function clearRight(base, add, gap) {
  let need = 0;
  Object.keys(add.rows).forEach((g) => {
    const b = base.rows[g]; if (!b) return;
    const a = add.rows[g];
    if (a[0] < b[1] + gap && a[1] > b[0] - gap) need = Math.max(need, b[1] + gap - a[0]);
  });
  return need;
}
// Smallest move to the left that removes any overlap with `base` on shared rows.
function clearLeft(base, add, gap) {
  let need = 0;
  Object.keys(add.rows).forEach((g) => {
    const b = base.rows[g]; if (!b) return;
    const a = add.rows[g];
    if (a[0] < b[1] + gap && a[1] > b[0] - gap) need = Math.min(need, b[0] - gap - a[1]);
  });
  return need;
}

/**
 * people:   person nodes ({id, age, label, parent_id, relationship_to_hh, family_id})
 * headId:   the household head's node id
 * sizeOf:   id -> circle diameter
 * returns   { pos: {id: {x, y}} (circle centres), gen: {id: row}, edges: [...],
 *             panels: [{familyId, isHeadFamily, rootId, label, rootName, minX, maxX, minY, maxY}] }
 */
export function computeFamilyTree(people, headId, sizeOf) {
  const T = TREE;
  const byId = {};
  people.forEach((p) => { byId[p.id] = p; });
  const head = byId[headId] || people[0];
  if (!head) return { pos: {}, gen: {}, edges: [], panels: [] };
  const half = (id) => (sizeOf(id) || 92) / 2;
  const relOf = (p) => p.relationship_to_hh || p.hh_m || "";

  // Parent of each person: the backend's parent_id when it points at someone
  // in this household, otherwise the head (same fallback as the radial view).
  const parentOf = {};
  const kidsOf = {};
  people.forEach((p) => {
    if (p.id === head.id) return;
    const par = (p.parent_id && byId[p.parent_id] && p.parent_id !== p.id) ? p.parent_id : head.id;
    parentOf[p.id] = par;
    (kidsOf[par] ??= []).push(p);
  });
  Object.values(kidsOf).forEach((list) => list.sort(byAgeThenName));

  // Generation of everyone, walked from the head (cross-family links count
  // too, so a "Parents' family" really sits a row above the head).
  const gen = { [head.id]: 0 };
  const seen = new Set([head.id]);
  const stack = [head];
  while (stack.length) {
    const u = stack.pop();
    (kidsOf[u.id] || []).forEach((k) => {
      if (seen.has(k.id)) return;
      seen.add(k.id);
      gen[k.id] = gen[u.id] + genDelta(relOf(k), u.age, k.age);
      stack.push(k);
    });
  }
  people.forEach((p) => { if (gen[p.id] === undefined) gen[p.id] = 0; });

  const famOf = (p) => (p.family_id ?? "none");
  const sameFamKids = (u) => (kidsOf[u.id] || []).filter((k) => famOf(k) === famOf(u));
  const kind = (u, k) => {
    const d = gen[k.id] - gen[u.id];
    if (relKey(relOf(k)) === "spouse" && d === 0) return "spouse";
    if (d > 0) return "desc";
    if (d < 0) return "asc";
    return "lateral";
  };

  const edges = [];
  const partnerOf = {}; // person -> spouse whose couple midpoint children hang from

  // Lay out one person together with everyone hanging off them (same family).
  const build = (u) => {
    const block = newBlock();
    const g = gen[u.id];
    place(block, u.id, 0, g, half(u.id));

    // Couple row: spouse(s) to the right. A spouse's own links are treated
    // as the couple's.
    const own = sameFamKids(u);
    const spouses = own.filter((k) => kind(u, k) === "spouse");
    let rightEdge = half(u.id);
    const pool = [];
    own.forEach((k) => { if (!spouses.includes(k)) pool.push({ from: u, k }); });
    spouses.forEach((s) => {
      const x = rightEdge + T.COUPLE_GAP + half(s.id);
      place(block, s.id, x, g, half(s.id));
      rightEdge = x + half(s.id);
      edges.push({ source: u.id, target: s.id, kind: "spouse", rel: relOf(s) });
      sameFamKids(s).forEach((k) => pool.push({ from: s, k }));
    });
    if (spouses.length) partnerOf[u.id] = spouses[0].id;
    const coupleMid = spouses.length ? block.x[spouses[0].id] / 2 : 0;

    const desc = pool.filter((e) => gen[e.k.id] > g);
    const lateral = pool.filter((e) => gen[e.k.id] === g);
    const asc = pool.filter((e) => gen[e.k.id] < g);

    // Children: their sub-trees side by side, centred under the couple.
    if (desc.length) {
      let group = null;
      const anchors = [];
      desc.sort((a, b) => byAgeThenName(a.k, b.k)).forEach(({ from, k }) => {
        const sub = build(k);
        // A two-row drop (grandchild linked straight to a grandparent):
        // keep the row in between clear where its line passes.
        for (let r = g + 1; r < gen[k.id]; r++) addToRow(sub, r, sub.x[k.id] - 8, sub.x[k.id] + 8);
        if (!group) group = sub;
        else merge(group, shift(sub, packOffset(group, sub, T.SIB_GAP)));
        anchors.push(group.x[k.id]);
        edges.push({ source: from.id, target: k.id, kind: "desc", rel: relOf(k), partner: from.id === u.id ? (spouses[0]?.id ?? null) : u.id });
      });
      const mid = (Math.min(...anchors) + Math.max(...anchors)) / 2;
      shift(group, coupleMid - mid);
      shift(group, clearRight(block, group, T.SIB_GAP));
      merge(block, group);
    }

    // Brothers/sisters, in-laws and other same-row relatives: to the right.
    lateral.sort((a, b) => byAgeThenName(a.k, b.k)).forEach(({ from, k }) => {
      const sub = build(k);
      shift(sub, packOffset(block, sub, T.LATERAL_GAP));
      merge(block, sub);
      edges.push({ source: from.id, target: k.id, kind: "lateral", rel: relOf(k) });
    });

    // Parent(s) living in this family: side by side above the person they
    // belong to, centred over them if there's room, otherwise moved left
    // until nothing overlaps. Both lines meet in one drop with one label.
    const ascByTarget = {};
    asc.forEach((e) => { (ascByTarget[e.from.id] ??= []).push(e); });
    Object.values(ascByTarget).forEach((list) => {
      const from = list[0].from;
      let group = null;
      const anchors = [];
      list.sort((a, b) => byAgeThenName(a.k, b.k)).forEach(({ k }, i) => {
        const sub = build(k);
        if (!group) group = sub;
        else merge(group, shift(sub, packOffset(group, sub, T.COUPLE_GAP)));
        anchors.push(group.x[k.id]);
        edges.push({ source: k.id, target: from.id, kind: "asc", rel: relOf(k), hideLabel: i > 0 });
      });
      shift(group, block.x[from.id] - (Math.min(...anchors) + Math.max(...anchors)) / 2);
      shift(group, clearLeft(block, group, T.SIB_GAP));
      merge(block, group);
    });
    return block;
  };

  // One panel per nuclear family. Its root(s): members whose parent is
  // outside the family (or who have none).
  const families = {};
  people.forEach((p) => { (families[famOf(p)] ??= []).push(p); });
  const headFam = famOf(head);
  const famOrder = Object.keys(families).sort((a, b) => {
    if (a === String(headFam)) return -1;
    if (b === String(headFam)) return 1;
    const ra = families[a].find((p) => !parentOf[p.id] || famOf(byId[parentOf[p.id]]) !== famOf(p)) || families[a][0];
    const rb = families[b].find((p) => !parentOf[p.id] || famOf(byId[parentOf[p.id]]) !== famOf(p)) || families[b][0];
    return (gen[ra.id] - gen[rb.id]) || byAgeThenName(ra, rb);
  });

  const pos = {};
  const panels = [];
  let cursor = null;
  const labelSeen = {};
  famOrder.forEach((fid) => {
    const members = families[fid];
    const roots = members
      .filter((p) => p.id === head.id || !parentOf[p.id] || famOf(byId[parentOf[p.id]]) !== famOf(p))
      .sort((a, b) => (a.id === head.id ? -1 : b.id === head.id ? 1 : byAgeThenName(a, b)));
    let fam = null;
    roots.forEach((r) => {
      const sub = build(r);
      if (!fam) fam = sub;
      else merge(fam, shift(sub, packOffset(fam, sub, T.LATERAL_GAP)));
    });
    // Anyone the walk above didn't reach (inconsistent data): a plain row.
    members.forEach((p) => {
      if (fam.x[p.id] === undefined) {
        const sub = newBlock();
        place(sub, p.id, 0, gen[p.id], half(p.id));
        merge(fam, shift(sub, packOffset(fam, sub, T.SIB_GAP)));
      }
    });
    const [lo, hi] = extent(fam);
    const dx = cursor === null ? -lo : cursor - lo;
    shift(fam, dx);
    cursor = hi + dx + T.PANEL_PAD * 2 + T.FAMILY_GAP;

    let minY = Infinity, maxY = -Infinity;
    members.forEach((p) => {
      const y = gen[p.id] * T.LEVEL;
      pos[p.id] = { x: fam.x[p.id], y };
      minY = Math.min(minY, y - half(p.id)); maxY = Math.max(maxY, y + half(p.id));
    });
    const root = roots[0];
    const isHeadFamily = fid === String(headFam);
    let label = "Household head's family";
    if (!isHeadFamily) {
      const rel = relOf(root);
      const base = rel && rel !== "Head" ? (/s$/i.test(rel) ? `${rel}' family` : `${rel}'s family`) : "Other family";
      labelSeen[base] = (labelSeen[base] || 0) + 1;
      label = labelSeen[base] > 1 ? `${base} #${labelSeen[base]}` : base;
    }
    panels.push({
      familyId: fid, isHeadFamily, rootId: root.id, label, rootName: root.label,
      minX: lo + dx - T.PANEL_PAD, maxX: hi + dx + T.PANEL_PAD,
      minY: minY - T.PANEL_PAD - T.CAPTION_H, maxY: maxY + T.PANEL_PAD,
    });
  });

  // Centre the whole picture on the head.
  const ox = pos[head.id]?.x || 0;
  Object.values(pos).forEach((p) => { p.x -= ox; });
  panels.forEach((p) => { p.minX -= ox; p.maxX -= ox; });
  // Panels share one top/bottom line so the rows read straight across.
  const top = Math.min(...panels.map((p) => p.minY));
  const bottom = Math.max(...panels.map((p) => p.maxY));
  panels.forEach((p) => { p.minY = top; p.maxY = bottom; });

  edges.forEach((e) => { e.partner = e.kind === "desc" ? (e.partner ?? partnerOf[e.source] ?? null) : null; });
  return { pos, gen, edges, panels };
}

// ── Line geometry (shared by the page and the checks) ───────────────────
// s, t, partner: { x, y, r } circle centres/radii. Returns the orthogonal
// polyline points and where the relationship label goes.
export function familyEdgePoints(kind, s, t, partner) {
  const T = TREE;
  const rowTop = (y) => y - T.ROW_HALF;
  if (kind === "spouse") {
    const dir = t.x >= s.x ? 1 : -1;
    const a = { x: s.x + dir * s.r, y: s.y }, b = { x: t.x - dir * t.r, y: t.y };
    return { points: [a, b], label: { x: (a.x + b.x) / 2, y: s.y } };
  }
  if (kind === "lateral") {
    const yLine = rowTop(Math.min(s.y, t.y)) - T.LATERAL_RISE;
    const pts = [{ x: s.x, y: s.y - s.r }, { x: s.x, y: yLine }, { x: t.x, y: yLine }, { x: t.x, y: t.y - t.r }];
    // Label sits where the line turns down to this relative, so several
    // relatives joined to the same person each keep their own label.
    return { points: pts, label: { x: t.x, y: yLine } };
  }
  // desc: parent s above child t (asc is drawn the same way, parent -> child).
  // The shared line runs in the gap just below the parent's row; a child two
  // rows down continues straight down from there through the space kept
  // clear for it in the row in between.
  const busY = rowTop(s.y + T.LEVEL) - T.BUS_DROP;
  const start = partner && Math.abs(partner.y - s.y) < 1
    ? { x: (s.x + partner.x) / 2, y: s.y }
    : { x: s.x, y: s.y + s.r };
  const pts = [start, { x: start.x, y: busY }, { x: t.x, y: busY }, { x: t.x, y: t.y - t.r }];
  return { points: pts, label: { x: t.x, y: t.y - t.r - 22 } };
}
