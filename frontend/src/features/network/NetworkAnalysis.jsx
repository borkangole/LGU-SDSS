import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background, Controls, ReactFlowProvider,
  useStore, getStraightPath, BaseEdge, EdgeLabelRenderer,
} from "reactflow";
import "reactflow/dist/style.css";

const NODE_TYPES = {};

import { useTheme } from "../../hooks/useTheme";
import { useUrlParam, getParam, setParam } from "../../hooks/useRoute";
import { computeFamilyTree, familyEdgePoints } from "./familyTreeLayout";
import {
  getBarangays,
  getNetworkHouseholds,
  getNetworkGraph,
  getVulnHousehold,
  getNetworkAnalysis,
} from '../../api/api';
import { buildFamilyGraphSVG, svgToPngDataUrl, downloadDataUrl, exportNetworkWorkbook } from "./networkExport";
import { generateNetworkReportPDF } from "./networkReport";
import { NETWORK_PALETTE, paletteFor, ageGroupOf, personTagLine } from "./networkPalette";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toBool(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string")
    return v.trim().toLowerCase() === "true" || v === "1" || v === "yes";
  return false;
}

// Node colors come from networkPalette.js (WCAG 2.1 AA checked).
function personColor(p, dark) {
  const P = paletteFor(dark);
  const g = ageGroupOf(p?.age) || "unknown";
  return { fill: P.nodeFill[g], stroke: P.person[g], glow: P.person[g] };
}

// ── Three-domain model (post-BVI/DESUD) ─────────────────────────────────────
// Per the adviser's decision (already implemented this way in
// VulnerabilityPage.jsx), the old single combined BVI = (E+S)/AC score is
// fully disregarded. A household is instead described by THREE separate,
// NEVER-combined domains: (1) Social Vulnerability = its k-modes typology
// cluster (a category, not a rank), (2) Operational Capacity = straight-
// line distance to key facilities, (3) Hazard Exposure = the server-
// computed flood/landslide exposure. Mirrored here field-for-field so this
// page agrees with the household profile page.
const RHU_COORDS  = { lat: 10.7815, lng: 122.4647 };
const FIRE_COORDS = { lat: 10.7869, lng: 122.4683 };
const CAPACITY_THRESHOLD_KM = 2.0;

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getFacilityDistances(hh) {
  const lat = hh?.latitude != null ? parseFloat(hh.latitude) : null;
  const lng = hh?.longitude != null ? parseFloat(hh.longitude) : null;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { hasCoords: false, rhuKm: null, fireKm: null, beyondRHU: false, beyondFire: false };
  }
  const rhuKm  = haversineKm(lat, lng, RHU_COORDS.lat, RHU_COORDS.lng);
  const fireKm = haversineKm(lat, lng, FIRE_COORDS.lat, FIRE_COORDS.lng);
  return {
    hasCoords: true, rhuKm, fireKm,
    beyondRHU:  rhuKm  > CAPACITY_THRESHOLD_KM,
    beyondFire: fireKm > CAPACITY_THRESHOLD_KM,
  };
}

// Hazard exposure -> a display color, based on the compound/exposure fields
// already computed server-side by hazard_engine.py (0-4 scale).
// NOTE: compound_hazard comes back from the API as the TEXT string "True"/
// "False" (Python's str(bool) repr, per hazard_engine.py's write -- see
// backend/app.py), not a real boolean -- a plain `if (hh?.compound_hazard)`
// is truthy for the string "False" too, so it MUST go through toBool().
function hazardColor(hh, dark = false) {
  const H = paletteFor(dark).hazard;
  if (toBool(hh?.compound_hazard)) return H.compound;
  const score = Number(hh?.hazard_exposure_score) || 0;
  if (score >= 0.66) return H.high;
  if (score >= 0.33) return H.moderate;
  if (score > 0)     return H.low;
  return H.none;
}

function hazardLabel(hh) {
  const parts = [];
  if (hh?.flood_exposure)     parts.push("Flood");
  if (hh?.landslide_exposure) parts.push("Landslide");
  if (parts.length === 0) return null;
  return (toBool(hh?.compound_hazard) ? "Compound: " : "") + parts.join(" + ");
}

// The 13 raw ti_* columns behind the k-modes typology_cluster_label, per
// sanmiguel_student/config.py's TYPOLOGY_FEATURES -- same list
// VulnerabilityPage.jsx uses for its "indicator load" count.
const TYPOLOGY_BOOL_INDICATORS = [
  "ti_overcrowding", "ti_food_insecure", "ti_no_internet", "ti_weak_roof",
  "ti_weak_wall", "ti_insecure_tenure", "ti_unimproved_sanitation",
  "ti_low_adult_education_hh", "ti_large_household", "ti_financially_excluded",
];
const TYPOLOGY_COUNT_INDICATORS = ["ti_pwd_count_cat", "ti_senior_count_cat", "ti_solo_parent_count_cat"];

// Same labels/formatting VulnerabilityPage.jsx uses for these 13
// indicators, so the Cluster Profile & Attribute Matching card reads
// identically on both pages.
const TYPOLOGY_INDICATOR_LABELS = {
  ti_overcrowding: "Overcrowding",
  ti_food_insecure: "Food insecurity",
  ti_no_internet: "No internet access",
  ti_weak_roof: "Weak roof material",
  ti_weak_wall: "Weak wall material",
  ti_insecure_tenure: "Insecure land tenure",
  ti_unimproved_sanitation: "Unimproved sanitation",
  ti_low_adult_education_hh: "Low adult education present",
  ti_large_household: "Large household (6+ members)",
  ti_financially_excluded: "Financially excluded (no bank/digital account)",
  ti_pwd_count_cat: "PWD members",
  ti_senior_count_cat: "Senior members",
  ti_solo_parent_count_cat: "Solo-parent members",
};
const TYPOLOGY_COUNT_KEYS = new Set(TYPOLOGY_COUNT_INDICATORS);
function formatTypologyValue(key, val) {
  if (val == null) return "—";
  if (TYPOLOGY_COUNT_KEYS.has(key)) {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? (n >= 3 ? "3+" : String(n)) : "—";
  }
  return val === true ? "Yes" : val === false ? "No" : String(val);
}

function typologyIndicatorsMissing(hh) {
  if (!hh) return true;
  return [...TYPOLOGY_BOOL_INDICATORS, ...TYPOLOGY_COUNT_INDICATORS].every((k) => hh[k] == null);
}

// Relationship line + label colors, from networkPalette.js.
const REL_COLOR = Object.fromEntries(Object.keys(NETWORK_PALETTE.light.rel).map((k) => [
  k, { light: NETWORK_PALETTE.light.rel[k], dark: NETWORK_PALETTE.dark.rel[k] },
]));

// CBMS also writes the single-person forms ("Son", "Grandson", "Mother"...);
// map them to the legend's groups so the line color matches the legend.
const REL_ALIAS = {
  "son": "Son/Daughter", "daughter": "Son/Daughter", "stepson": "Son/Daughter", "stepdaughter": "Son/Daughter",
  "husband": "Spouse", "wife": "Spouse", "partner": "Spouse",
  "grandson": "Grandchildren", "granddaughter": "Grandchildren", "grandchild": "Grandchildren",
  "son-in-law": "Son/Daughter-in-Law", "daughter-in-law": "Son/Daughter-in-Law",
  "brother": "Brother/Sister", "sister": "Brother/Sister",
  "mother": "Parents", "father": "Parents", "parent": "Parents",
  "brother-in-law": "Sister/Brother-in-Law", "sister-in-law": "Sister/Brother-in-Law",
};

function getRelColor(rel, dark) {
  const r = (rel || "").trim().toLowerCase();
  const key = Object.keys(REL_COLOR).find((k) => r === k.toLowerCase()) || REL_ALIAS[r];
  if (!key) return paletteFor(dark).rel["Other Relatives"];
  return dark ? REL_COLOR[key].dark : REL_COLOR[key].light;
}

// ── Floating edge ───────────────────────────────────────────────────────
// ReactFlow's default edges anchor to a fixed Handle position (top/bottom)
// on each node. For a radial/tree layout where a node can sit at any angle
// relative to its neighbor, that bunches every non-vertical connection
// through the same single point on the circle, producing crossed/pinched
// lines. This edge instead reads each node's REAL measured center + radius
// (via useStore) and draws a straight line between the two circles'
// boundaries -- always a clean spoke, regardless of angle.
function getCircleBoundaryPoint(from, to) {
  const w  = from.width  ?? 92;
  const h  = from.height ?? w;
  const fx = (from.positionAbsolute?.x ?? from.position?.x ?? 0) + w / 2;
  const fy = (from.positionAbsolute?.y ?? from.position?.y ?? 0) + h / 2;
  const tw = to.width  ?? 92;
  const th = to.height ?? tw;
  const tx = (to.positionAbsolute?.x ?? to.position?.x ?? 0) + tw / 2;
  const ty = (to.positionAbsolute?.y ?? to.position?.y ?? 0) + th / 2;
  const dx = tx - fx, dy = ty - fy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const r = w / 2;
  return { x: fx + (dx / dist) * r, y: fy + (dy / dist) * r };
}

function FloatingEdge({ id, source, target, style, label, labelStyle, labelBgStyle, labelBgPadding }) {
  const sourceNode = useStore(useCallback((s) => s.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((s) => s.nodeInternals.get(target), [target]));
  if (!sourceNode || !targetNode) return null;

  const sp = getCircleBoundaryPoint(sourceNode, targetNode);
  const tp = getCircleBoundaryPoint(targetNode, sourceNode);
  const [path, labelX, labelY] = getStraightPath({
    sourceX: sp.x, sourceY: sp.y, targetX: tp.x, targetY: tp.y,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              whiteSpace: "nowrap",
              ...labelBgStyle,
              ...(labelBgPadding ? { padding: `${labelBgPadding[0]}px ${labelBgPadding[1]}px` } : null),
              ...labelStyle,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ── Family-tree edge (Tree view) ─────────────────────────────────────────
// Straight down / across lines with rounded corners, read from each circle's
// live position (see familyTreeLayout.js for the routing rules). A child's
// line starts from the middle of the couple line when the parent has a
// spouse, so siblings share one bar like a normal family tree.
function roundedPath(points, radius = 10) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) { d += ` L ${p1.x} ${p1.y}`; continue; }
    const a = { x: p1.x - ((p1.x - p0.x) / l1) * r, y: p1.y - ((p1.y - p0.y) / l1) * r };
    const b = { x: p1.x + ((p2.x - p1.x) / l2) * r, y: p1.y + ((p2.y - p1.y) / l2) * r };
    d += ` L ${a.x} ${a.y} Q ${p1.x} ${p1.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return d + ` L ${last.x} ${last.y}`;
}

function circleOf(n) {
  const w = n.width ?? 92;
  return {
    x: (n.positionAbsolute?.x ?? n.position?.x ?? 0) + w / 2,
    y: (n.positionAbsolute?.y ?? n.position?.y ?? 0) + w / 2,
    r: w / 2,
  };
}

function FamilyEdge({ id, source, target, style, data, label, labelStyle, labelBgStyle }) {
  const partnerId = data?.partner || null;
  const sourceNode  = useStore(useCallback((s) => s.nodeInternals.get(source), [source]));
  const targetNode  = useStore(useCallback((s) => s.nodeInternals.get(target), [target]));
  const partnerNode = useStore(useCallback((s) => (partnerId ? s.nodeInternals.get(partnerId) : null), [partnerId]));
  if (!sourceNode || !targetNode) return null;
  const kind = data?.kind === "asc" ? "desc" : (data?.kind || "desc");
  const { points, label: at } = familyEdgePoints(kind, circleOf(sourceNode), circleOf(targetNode), partnerNode ? circleOf(partnerNode) : null);
  return (
    <>
      <BaseEdge id={id} path={roundedPath(points)} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan" style={{
            position: "absolute", transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`,
            pointerEvents: "none", whiteSpace: "nowrap", padding: "2px 6px", borderRadius: 999,
            ...labelBgStyle, ...labelStyle,
          }}>{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// Family panel for the Tree view. Drawn in the lines' own layer (as the first
// "edge") so it sits behind every line and label instead of tinting them.
function FamilyPanelEdge({ id, data }) {
  const pn = data?.panel;
  if (!pn) return null;
  return (
    <>
      <rect x={pn.minX} y={pn.minY} width={pn.maxX - pn.minX} height={pn.maxY - pn.minY} rx={18}
        style={{ fill: data.fill, stroke: data.stroke, strokeWidth: 1 }} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan" style={{
          position: "absolute", transform: `translate(${pn.minX + 14}px, ${pn.minY + 10}px)`,
          maxWidth: pn.maxX - pn.minX - 28, pointerEvents: "none", display: "flex", alignItems: "baseline", gap: 8,
          overflow: "hidden", whiteSpace: "nowrap", lineHeight: 1.2,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: data.accent }}>{pn.label}</span>
          {!pn.isHeadFamily && pn.rootName && (
            <span style={{ fontSize: 10, color: data.accent, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis" }}>{pn.rootName}</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { floating: FloatingEdge, family: FamilyEdge, familyPanel: FamilyPanelEdge };

function getSymmetricAngles(n) {
  if (n === 0) return [];
  if (n === 1) return [0];
  if (n === 2) return [-Math.PI / 2, Math.PI / 2];
  return Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n - Math.PI / 2);
}

// ── Angular-gap placement (for other-family clusters around the head) ──
// Treats every one of the head's OWN family members as blocking a small
// arc around the head (as seen FROM the head), sized by how big the node
// looks at its distance -- a near node blocks a wide arc, a far one a
// narrow one. Placing a cluster's straight connecting line anywhere
// inside a free arc guarantees it can't cut through an own-family node.
function normalizeAngle(a) {
  let x = a % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x;
}
function circularDist(a, b) {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(d, 2 * Math.PI - d);
}
// Merges a set of [start,end] arcs (radians, may extend outside [0,2π))
// into a minimal covering set, handling wraparound by tripling each arc
// at -2π/0/+2π offsets before merging on the real line.
function mergeCircularIntervals(intervals) {
  if (!intervals.length) return [];
  const expanded = [];
  intervals.forEach((iv) => {
    [-1, 0, 1].forEach((k) => expanded.push({ start: iv.start + k * 2 * Math.PI, end: iv.end + k * 2 * Math.PI }));
  });
  expanded.sort((a, b) => a.start - b.start);
  const merged = [expanded[0]];
  for (let i = 1; i < expanded.length; i++) {
    const last = merged[merged.length - 1];
    if (expanded[i].start <= last.end) last.end = Math.max(last.end, expanded[i].end);
    else merged.push({ ...expanded[i] });
  }
  return merged;
}
// The free arcs within [0, 2π) once the blocked arcs above are removed.
function findFreeGaps(blockedIntervals) {
  const merged = mergeCircularIntervals(blockedIntervals).filter((iv) => iv.end > 0 && iv.start < 2 * Math.PI);
  merged.sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;
  merged.forEach((iv) => {
    if (iv.start > cursor) gaps.push({ start: cursor, end: Math.min(iv.start, 2 * Math.PI) });
    cursor = Math.max(cursor, iv.end);
  });
  if (cursor < 2 * Math.PI) gaps.push({ start: cursor, end: 2 * Math.PI });
  return gaps.filter((g) => g.end - g.start > 0.001);
}

// ── Radial layout (original, untouched) -- head at center, direct
// relatives fanned around it, each sub-family fanning out from its own
// spot at increasing radius per level. ──
function computeRadialPositions(head, childrenOf) {
  const positionMap = {};
  const directMembers = childrenOf[head.id] || [];
  const R_inner = Math.max(170, 140 + directMembers.length * 15);
  const LEVEL_STEP = 170;

  positionMap[head.id] = { x: 0, y: 0 };

  const angles = getSymmetricAngles(directMembers.length);
  const queue = [];
  directMembers.forEach((p, i) => {
    const a = angles[i];
    positionMap[p.id] = { x: Math.round(R_inner * Math.cos(a)), y: Math.round(R_inner * Math.sin(a)) };
    queue.push({ node: p, level: 1, angle: a });
  });

  while (queue.length) {
    const { node, level, angle } = queue.shift();
    const kids = childrenOf[node.id] || [];
    if (!kids.length) continue;
    const radius     = R_inner + level * LEVEL_STEP;
    const fanSpread   = Math.PI / 6;
    const totalSpread = fanSpread * (kids.length - 1);
    const startAngle  = angle - totalSpread / 2;
    kids.forEach((p, i) => {
      const a = startAngle + i * fanSpread;
      positionMap[p.id] = { x: Math.round(radius * Math.cos(a)), y: Math.round(radius * Math.sin(a)) };
      queue.push({ node: p, level: level + 1, angle: a });
    });
  }
  return positionMap;
}

function relKey(rel) { return (rel || "").trim().toLowerCase(); }

// How many rows a relationship moves a node, relative to whoever it's
// attached to. Parents/Son-Daughter/Grandchildren are explicit and always
// trusted. Spouse and same-generation labels (siblings, in-laws) are
// always level, by definition, regardless of age gap. "Other Relatives" is
// genuinely ambiguous, so it's inferred from the real age gap instead of
// being pinned to the same row as whoever it's attached to.
function getGenDelta(rel, fromAge, toAge) {
  const key = relKey(rel);
  if (key === "parents") return -1;
  if (key === "son/daughter" || key === "son/daughter-in-law") return 1;
  if (key === "grandchildren") return 2;
  if (key === "spouse" || key === "brother/sister" || key === "sister/brother-in-law") return 0;
  const a = Number(fromAge), b = Number(toAge);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const gap = b - a; // negative = attached node is younger
    if (gap <= -30) return 2;
    if (gap <= -13) return 1;
    if (gap >= 30)  return -2;
    if (gap >= 13)  return -1;
  }
  return 0;
}

// ── Tree layout -- generation rows (parents above, children below,
// spouses/siblings level), with descendant subtrees centered under their
// parent and lateral attachments (spouse/parents/siblings/in-laws) placed
// beside their anchor instead of stealing centering space from real
// children. Collision pass at the end guarantees no overlaps. ──
function computeTreePositions(head, members, childrenOfRaw, memberSize, headSize) {
  const LEVEL_STEP = 170;
  const SIB_GAP    = memberSize + 100;
  const SPOUSE_GAP = 140;
  const MIN_GAP    = memberSize + 48;

  // Deterministic sibling order (age desc, then name) -- a local sorted
  // copy, so this doesn't affect the radial mode's original ordering.
  const childrenOf = {};
  Object.keys(childrenOfRaw).forEach((k) => {
    childrenOf[k] = childrenOfRaw[k].slice().sort((a, b) => {
      const ageA = Number(a.age) || 0, ageB = Number(b.age) || 0;
      if (ageB !== ageA) return ageB - ageA;
      return (a.label || "").localeCompare(b.label || "");
    });
  });

  const generationOf = { [head.id]: 0 };
  const descendantChildrenOf = {};
  const lateralChildrenOf = {};
  const walkGeneration = (parent) => {
    (childrenOf[parent.id] || []).forEach((p) => {
      const rel = p.relationship_to_hh || p.hh_m || "";
      const delta = getGenDelta(rel, parent.age, p.age);
      generationOf[p.id] = generationOf[parent.id] + delta;
      if (delta > 0) (descendantChildrenOf[parent.id] ??= []).push(p);
      else (lateralChildrenOf[parent.id] ??= []).push(p);
      walkGeneration(p);
    });
  };
  walkGeneration(head);

  const xOf = {};
  let cursor = 0;
  const centerDescendants = (node) => {
    const kids = descendantChildrenOf[node.id] || [];
    if (!kids.length) return undefined;
    const kidXs = kids.map((k) => {
      let x = centerDescendants(k);
      if (x === undefined) { x = cursor * SIB_GAP; cursor += 1; }
      xOf[k.id] = x;
      return x;
    });
    return (Math.min(...kidXs) + Math.max(...kidXs)) / 2;
  };
  const headCenter = centerDescendants(head);
  xOf[head.id] = headCenter !== undefined ? headCenter : 0;

  const shiftSubtree = (node, delta) => {
    (descendantChildrenOf[node.id] || []).forEach((k) => { xOf[k.id] += delta; shiftSubtree(k, delta); });
    (lateralChildrenOf[node.id] || []).forEach((k) => {
      if (xOf[k.id] !== undefined) { xOf[k.id] += delta; shiftSubtree(k, delta); }
    });
  };

  const queue = [head];
  while (queue.length) {
    const parent = queue.shift();
    (lateralChildrenOf[parent.id] || []).forEach((p, i) => {
      let x;
      if (relKey(p.relationship_to_hh || p.hh_m) === "spouse") {
        x = xOf[parent.id] + SPOUSE_GAP;
      } else {
        const n = Math.floor(i / 2) + 1;
        const side = (i % 2 === 0) ? -1 : 1;
        x = xOf[parent.id] + side * n * SIB_GAP;
      }
      xOf[p.id] = x;
      const center = centerDescendants(p);
      if (center !== undefined) shiftSubtree(p, x - center);
      queue.push(p);
    });
    (descendantChildrenOf[parent.id] || []).forEach((k) => queue.push(k));
  }

  // Collision safety net: within each generation row, push anything too
  // close further out.
  const rows = {};
  [head, ...members].forEach((p) => { (rows[generationOf[p.id] ?? 0] ??= []).push(p); });
  Object.values(rows).forEach((row) => {
    row.sort((a, b) => xOf[a.id] - xOf[b.id]);
    for (let i = 1; i < row.length; i++) {
      const minX = xOf[row[i - 1].id] + MIN_GAP;
      if (xOf[row[i].id] < minX) xOf[row[i].id] = minX;
    }
  });

  const offsetX = xOf[head.id] || 0;
  const positionMap = {};
  // Pure CENTER coordinates -- ReactFlow positions nodes by their top-left
  // corner, not center, and different nodes here have different diameters
  // (head vs. member), so the center-to-corner conversion has to happen
  // once, per-node, where the real size is known (in makeNode below) --
  // not here, and not partially (this used to subtract headSize/2 from y
  // only, never from x, which is what made tree mode and radial mode
  // place nodes inconsistently).
  [head, ...members].forEach((p) => {
    const rowCenterY = (generationOf[p.id] ?? 0) * LEVEL_STEP;
    positionMap[p.id] = {
      x: Math.round((xOf[p.id] ?? 0) - offsetX),
      y: Math.round(rowCenterY),
    };
  });
  return positionMap;
}

// ── Tree view: generation rows, one panel per nuclear family ─────────────
// Positions come from computeFamilyTree (familyTreeLayout.js), which was
// checked against every household in the database: no circles overlap, no
// line passes through a person, no two labels collide, and every family's
// panel is separate. Lines between two different families are never drawn
// (same rule as the radial view); the panel caption names the relationship.
function buildTreeView({ people, head, household, nodeById, dark, makeNode, headSize, rootSize, memberSize }) {
  const resolvedParent = (p) => (p.parent_id && nodeById[p.parent_id] && p.parent_id !== p.id ? p.parent_id : head.id);
  const isRoot = (p) => p.id !== head.id && nodeById[resolvedParent(p)]?.family_id !== p.family_id;
  const sizeOf = (id) => (id === head.id ? headSize : (isRoot(nodeById[id]) ? rootSize : memberSize));
  const { pos, edges, panels } = computeFamilyTree(people, head.id, sizeOf);

  const rfNodes = [];
  const rfEdges = [];

  // Family panels (behind every line), each with its caption inside.
  panels.forEach((pn) => {
    rfEdges.push({
      id: `__panel_${pn.familyId}__`,
      source: head.id,
      target: pn.rootId,
      type: "familyPanel",
      selectable: false, focusable: false,
      data: {
        panel: pn,
        accent: pn.isHeadFamily ? paletteFor(dark).headFamilyAccent : paletteFor(dark).otherFamilyAccent,
        fill: pn.isHeadFamily
          ? (dark ? "rgba(91,141,238,0.05)" : "rgba(21,101,192,0.035)")
          : (dark ? "rgba(245,158,11,0.05)" : "rgba(245,158,11,0.045)"),
        stroke: pn.isHeadFamily ? (dark ? "rgba(91,141,238,0.25)" : "rgba(21,101,192,0.18)") : "rgba(245,158,11,0.35)",
      },
    });
  });

  people.forEach((p) => {
    const c = pos[p.id];
    if (!c) return;
    rfNodes.push(makeNode(p, { big: p.id === head.id, isRoot: isRoot(p), x: c.x, y: c.y }));
  });

  edges.forEach((e) => {
    const color = getRelColor(e.rel, dark);
    rfEdges.push({
      id: `t-${e.kind}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "family",
      data: { kind: e.kind, partner: e.partner, rel: e.rel, hideLabel: !!e.hideLabel },
      style: { stroke: color, strokeWidth: 1.6 },
      // A couple's short pink line needs no word on it (the legend says
      // pink = spouse); every other line names the relationship once.
      label: e.hideLabel || e.kind === "spouse" ? undefined : (e.rel || undefined),
      labelStyle: { fontSize: 9, color, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" },
      labelBgStyle: { background: paletteFor(dark).labelBg, border: `0.5px solid ${color}55` },
    });
  });

  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  panels.forEach((pn) => { minX = Math.min(minX, pn.minX); maxX = Math.max(maxX, pn.maxX); maxY = Math.max(maxY, pn.maxY); });
  if (household && Number.isFinite(minX)) {
    rfNodes.push({
      id: household.id,
      position: { x: (minX + maxX) / 2 - 80, y: maxY + 28 },
      data: { label: household.label || household.id },
      draggable: false, selectable: false,
      style: {
        padding: "8px 20px", borderRadius: 12, minWidth: 160, textAlign: "center",
        border: dark ? "1px solid rgba(78,155,255,0.3)" : "1px solid rgba(21,101,192,0.3)",
        background: dark ? "rgba(15,20,35,0.9)" : "#ffffff",
        color: paletteFor(dark).textPrimary, fontWeight: 700, fontSize: 12, letterSpacing: "0.02em",
        boxShadow: dark ? "0 4px 16px rgba(0,0,0,0.4)" : "0 4px 14px rgba(0,0,0,0.08)",
      },
    });
  }

  const familyClusters = panels.filter((pn) => !pn.isHeadFamily).map((pn) => ({
    familyId: pn.familyId, rootId: pn.rootId, label: pn.label, rootName: pn.rootName,
    bounds: { minX: pn.minX, maxX: pn.maxX, minY: pn.minY, maxY: pn.maxY },
  }));
  return { rfNodes, rfEdges, familyClusters, panels };
}

function buildRelationshipLayout(nodes, dark, headNodeId, layoutMode = "radial") {
  const household = nodes.find((n) => n.kind === "household");
  const people    = nodes.filter((n) => n.kind === "person");
  const head      = people.find((p) => p.id === headNodeId) || people[0];
  if (!head) return { rfNodes: [], rfEdges: [], familyClusters: [] };

  const rfNodes = [];
  const rfEdges = [];
  const headSize   = 124;
  const memberSize = 92;
  const rootSize   = 100; // another nuclear family's own head, within this same view

  const makeNode = (p, { big = false, isRoot = false, x, y } = {}) => {
    // Outline = age group (blue adult, green minor, amber senior), and the
    // same group is written under the name, so color is never the only cue.
    // A PWD member gets a second, purple outline plus the word "PWD".
    const P    = paletteFor(dark);
    const c    = personColor(p, dark);
    const isPwd = toBool(p.is_pwd);
    const ring = c.stroke;
    const size = big ? headSize : (isRoot ? rootSize : memberSize);
    // positionMap gives CENTER coordinates (radial and tree layouts both
    // treat the head at the geometric center of its ring/row); ReactFlow
    // places a node by its top-left corner, so convert here, once, using
    // this node's own real size -- head/root/member differ, so this can't
    // be a single global offset.
    return {
      id: p.id,
      position: { x: x - size / 2, y: y - size / 2 },
      data: {
        label: (
          <div style={{ lineHeight: 1.15, userSelect: "none" }}>
            <div style={{
              fontWeight: 700,
              fontSize: big ? 12 : 10,
              color: ring,
              letterSpacing: "0.01em",
            }}>
              {p.label}
            </div>
            <div style={{ fontSize: 10, color: P.textSecondary, marginTop: 2 }}>
              {personTagLine(p.age, isPwd)}
            </div>
            {/* Per Sir Shem: an other-family root has no title at all --
                not "head", not "representative", nothing. CBMS records
                exactly one head per household (tbl_households); every
                other-family root is just the reference point
                network_engine.py used to build that nuclear family's
                sub-tree, so it gets no status pill, only its name/age
                like any other member. Only the true head keeps "Head". */}
            {big && (
              <div style={{
                fontSize: 9,
                marginTop: 4,
                padding: "2px 7px",
                borderRadius: 100,
                background: `${ring}22`,
                border: `0.5px solid ${ring}55`,
                color: ring,
                display: "inline-block",
              }}>
                {p.gender ? `${p.gender} · ` : ""}Head
              </div>
            )}
          </div>
        ),
      },
      style: {
        width:          size,
        height:         size,
        borderRadius:   999,
        border:         `${big || isRoot ? 2.5 : 2}px solid ${ring}`,
        background:     dark ? c.fill : P.nodeBg,
        color:          P.textPrimary,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        textAlign:      "center",
        boxShadow: [
          isPwd ? `0 0 0 3px ${dark ? P.graphBg : P.nodeBg}, 0 0 0 5.5px ${P.person.pwd}` : null,
          dark ? `0 0 24px ${ring}33, 0 8px 24px rgba(0,0,0,0.5)` : `0 0 16px ${ring}22, 0 4px 14px rgba(0,0,0,0.10)`,
        ].filter(Boolean).join(", "),
        outline: "none",
        cursor: "pointer",
      },
    };
  };

  const members = people.filter((p) => p.id !== head.id);
  const nodeById = {};
  people.forEach((p) => { nodeById[p.id] = p; });

  if (layoutMode === "tree") {
    return buildTreeView({ people, head, household, nodeById, dark, makeNode, headSize, rootSize, memberSize });
  }

  // Build a parent -> children map using the backend's real parent_id
  // (derived from actual B01/B02 CBMS relationship data). Any node whose
  // parent_id is missing, or points to a node not in this graph, falls
  // back to attaching directly to the household head -- this covers the
  // head's own direct relatives (spouse, children, siblings, etc.) and
  // acts as a safety net for incomplete data.
  const childrenOf = {};
  members.forEach((p) => {
    const parentId = (p.parent_id && nodeById[p.parent_id] && p.parent_id !== p.id)
      ? p.parent_id
      : head.id;
    if (!childrenOf[parentId]) childrenOf[parentId] = [];
    childrenOf[parentId].push(p);
  });

  const headFamilyId = head.family_id;

  // Multi-family households: the household head's direct children include
  // BOTH their own nuclear family's relatives AND the "head" of every
  // other nuclear family sharing this household (linked by the single
  // cross-family edge network_engine.py stores). Splitting those out here
  // is what turns "everyone squeezed onto one row" into separated family
  // branches -- each other-family root gets its OWN independently laid
  // out subtree, then the whole subtree is shifted sideways as one block.
  const headDirectAll    = childrenOf[head.id] || [];
  const ownDirectKids     = headDirectAll.filter((p) => p.family_id === headFamilyId);
  const otherFamilyRoots  = headDirectAll.filter((p) => p.family_id !== headFamilyId);
  const ownChildrenOf     = { ...childrenOf, [head.id]: ownDirectKids };
  const ownMembers        = members.filter((p) => p.family_id === headFamilyId);

  const positionMap = layoutMode === "tree"
    ? computeTreePositions(head, ownMembers, ownChildrenOf, memberSize, headSize)
    : computeRadialPositions(head, ownChildrenOf);

  const boundsOf = (posMap, ids, sizeOf) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    ids.forEach((id) => {
      const pos = posMap[id];
      if (!pos) return;
      const r = sizeOf(id) / 2;
      minX = Math.min(minX, pos.x - r); maxX = Math.max(maxX, pos.x + r);
      minY = Math.min(minY, pos.y - r); maxY = Math.max(maxY, pos.y + r);
    });
    if (!Number.isFinite(minX)) return { minX: -memberSize / 2, maxX: memberSize / 2, minY: -memberSize / 2, maxY: memberSize / 2 };
    return { minX, maxX, minY, maxY };
  };

  const ownIds = [head.id, ...ownMembers.map((p) => p.id)];
  const ownBounds = boundsOf(positionMap, ownIds, (id) => (id === head.id ? headSize : memberSize));

  // Lay out every OTHER nuclear family as its own independent subtree
  // (rooted at that family's own head), then place each one out to the
  // SIDE of the head's own family along a direction genuinely free of the
  // head's own relatives -- never blindly right/left/below, since with
  // enough own-family members any single fixed direction can land a
  // cluster's one straight connecting line right on top of one of them.
  //
  // Method: treat every one of the head's own members as blocking a small
  // arc around the head (wider if the member sits close, narrower if far
  // -- literally "how much of the horizon it covers" from the head's
  // point of view). The gaps left between those arcs are the directions a
  // straight line out of the head can travel without crossing anyone.
  // Each other family gets placed in the widest gap nearest to the
  // preferred order right -> left -> bottom -> top, and clusters are kept
  // an angular minimum apart from each other too.
  const CLUSTER_GAP = 100;
  const familyClusters = [];
  const relLabelSeen = {};

  // First pass: lay out each other family independently (root at its own
  // local origin) so its true footprint is known before deciding where
  // around the head it goes.
  const otherFamilyLayouts = otherFamilyRoots.map((root) => {
    const fid = root.family_id;
    const famMembers = members.filter((p) => p.family_id === fid && p.id !== root.id);
    const famChildrenOf = {};
    [root, ...famMembers].forEach((p) => {
      const kids = (childrenOf[p.id] || []).filter((k) => k.family_id === fid);
      if (kids.length) famChildrenOf[p.id] = kids;
    });
    const localMap = layoutMode === "tree"
      ? computeTreePositions(root, famMembers, famChildrenOf, memberSize, rootSize)
      : computeRadialPositions(root, famChildrenOf);
    const localIds = [root.id, ...famMembers.map((p) => p.id)];
    const localBounds = boundsOf(localMap, localIds, (id) => (id === root.id ? rootSize : memberSize));
    // How far the cluster reaches from ITS OWN root in any direction --
    // used so the cluster's near edge, not just its root point, clears
    // the head's own family with a real gap.
    const reach = Math.max(
      rootSize / 2,
      -localBounds.minX, localBounds.maxX,
      -localBounds.minY, localBounds.maxY
    );
    return { root, fid, localMap, localIds, localBounds, reach };
  });

  // The arcs, around the head, that the head's OWN family already
  // occupies (as seen from the head) -- every straight edge out to
  // another family must avoid these.
  const ownRadius = ownMembers.reduce((max, p) => {
    const pos = positionMap[p.id];
    if (!pos) return max;
    return Math.max(max, Math.sqrt(pos.x * pos.x + pos.y * pos.y) + memberSize / 2);
  }, headSize / 2);
  const OWN_CLEARANCE = 46; // ~ half a member circle, so a blocked arc has real breathing room
  const blockedByOwnFamily = ownMembers.map((p) => {
    const pos = positionMap[p.id];
    const dist = pos ? Math.max(Math.sqrt(pos.x * pos.x + pos.y * pos.y), memberSize / 2 + 1) : headSize;
    const angle = pos ? normalizeAngle(Math.atan2(pos.y, pos.x)) : 0;
    const half = Math.atan2(memberSize / 2 + OWN_CLEARANCE, dist);
    return { start: angle - half, end: angle + half };
  });
  const freeGaps = findFreeGaps(blockedByOwnFamily);

  // Preferred directions, in order: right, left, bottom, top (screen y
  // grows downward, so "bottom" is +90°/π/2).
  const PREFERRED_ANGLES = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
  const MIN_CLUSTER_SEPARATION = (35 * Math.PI) / 180;
  const claimedAngles = [];

  const gapContaining = (angle) => freeGaps.find((g) => angle >= g.start && angle <= g.end);
  const widestGap = () => freeGaps.reduce((best, g) => ((g.end - g.start) > (best ? best.end - best.start : -1) ? g : best), null);

  otherFamilyLayouts.forEach(({ root, fid, localMap, localIds, localBounds, reach }) => {
    // Pick a placement angle: the first preferred direction that (a)
    // falls inside a real gap and (b) isn't already claimed by an
    // earlier cluster; otherwise the center of the single widest
    // remaining gap (still avoiding the head's own family), spaced away
    // from whatever's already claimed when possible.
    let angle = null;
    for (const pref of PREFERRED_ANGLES) {
      const gap = gapContaining(pref);
      if (gap && claimedAngles.every((a) => circularDist(a, pref) >= MIN_CLUSTER_SEPARATION)) {
        angle = pref;
        break;
      }
    }
    if (angle == null) {
      const candidates = freeGaps
        .map((g) => ({ g, center: (g.start + g.end) / 2, width: g.end - g.start }))
        .filter((c) => claimedAngles.every((a) => circularDist(a, c.center) >= MIN_CLUSTER_SEPARATION))
        .sort((a, b) => b.width - a.width);
      if (candidates.length) {
        angle = candidates[0].center;
      } else {
        // Every gap center is already too close to a claimed angle (e.g. a
        // 3rd/4th other-family cluster in a busy household) -- rather than
        // repeatedly falling back to the SAME widest-gap center (which
        // stacks two clusters, and their captions, exactly on top of each
        // other), sample several points across every free gap and take
        // whichever maximizes the minimum distance to what's already
        // claimed. This spreads extra clusters across the available space
        // instead of piling them on one spot.
        const SAMPLES_PER_GAP = 7;
        let best = null;
        freeGaps.forEach((g) => {
          for (let i = 1; i <= SAMPLES_PER_GAP; i++) {
            const t = i / (SAMPLES_PER_GAP + 1);
            const cand = g.start + (g.end - g.start) * t;
            const minDist = claimedAngles.length
              ? Math.min(...claimedAngles.map((a) => circularDist(a, cand)))
              : Infinity;
            if (!best || minDist > best.minDist) best = { angle: cand, minDist };
          }
        });
        angle = best ? best.angle : (widestGap() ? (widestGap().start + widestGap().end) / 2 : Math.PI / 2);
      }
    }
    claimedAngles.push(angle);

    const distance = ownRadius + CLUSTER_GAP + reach;
    const targetX = Math.round(distance * Math.cos(angle));
    const targetY = Math.round(distance * Math.sin(angle));

    const dx = targetX - (localMap[root.id]?.x ?? 0);
    const dy = targetY - (localMap[root.id]?.y ?? 0);

    localIds.forEach((id) => {
      const pos = localMap[id];
      if (!pos) return;
      positionMap[id] = { x: Math.round(pos.x + dx), y: Math.round(pos.y + dy) };
    });

    // Two other-family roots can share the exact same relationship to the
    // head (e.g. two of the head's children each now head their own
    // family within this household) -- when that happens, "Son/
    // Daughter's family" alone can't tell the two clusters apart, so a
    // repeat gets a running count appended.
    const baseLabel = root.relationship_to_hh ? `${root.relationship_to_hh}'s family` : "Other family";
    relLabelSeen[baseLabel] = (relLabelSeen[baseLabel] || 0) + 1;
    const label = relLabelSeen[baseLabel] > 1 ? `${baseLabel} #${relLabelSeen[baseLabel]}` : baseLabel;

    familyClusters.push({
      familyId: fid,
      rootId: root.id,
      label,
      // The cluster's own root name, shown as a second caption line so
      // two clusters with the same relationship label (see above) are
      // still trivially tellable apart at a glance, not just by number.
      rootName: root.label,
      bounds: {
        minX: localBounds.minX + dx, maxX: localBounds.maxX + dx,
        minY: localBounds.minY + dy, maxY: localBounds.maxY + dy,
      },
    });
  });

  const isOtherRoot = (id) => otherFamilyRoots.some((r) => r.id === id);

  rfNodes.push(makeNode(head, { big: true, x: positionMap[head.id].x, y: positionMap[head.id].y }));
  members.forEach((p) => {
    if (!positionMap[p.id]) return;
    rfNodes.push(makeNode(p, { isRoot: isOtherRoot(p.id), x: positionMap[p.id].x, y: positionMap[p.id].y }));
  });

  const drawEdge = (parentId, p) => {
    const rel = p.relationship_to_hh || p.hh_m || "";
    const edgeColor = getRelColor(rel, dark);
    // The one link per other family that crosses from the household head
    // to that family's own root.
    const isCrossFamily = parentId === head.id && p.family_id !== headFamilyId;
    // Per Sir Shem's review: a direct line between two circles should mean
    // an actual blood relationship. A cross-family link isn't one -- CBMS
    // households are isolated records (one head = one household), so
    // "this family relates to the head as Other Relatives/etc." is an
    // assumption drawn from the shared b01/b02 nuclear-family grouping,
    // not a verified kinship edge. So it's never drawn as a line at all;
    // the relationship only appears as a label on that family's own
    // cluster caption (see familyClusters below), never on a line joining
    // two people.
    if (isCrossFamily) return;
    rfEdges.push({
      id: `e-${parentId}-${p.id}`,
      source: parentId,
      target: p.id,
      // "floating": a plain straight line between the two circles' real
      // boundaries (see FloatingEdge above) instead of RF's fixed
      // top/bottom handle anchors -- keeps every spoke clean regardless
      // of angle. Only real within-family edges reach here now (cross-
      // family links return above), so no more dashed/cross styling.
      type: "floating",
      style: {
        stroke: edgeColor,
        strokeWidth: 1.6,
      },
      label: rel || undefined,
      labelStyle: {
        fontSize: 9,
        color: edgeColor,
        fontWeight: 600,
        fontFamily: "'DM Sans', sans-serif",
      },
      labelBgStyle: {
        background: paletteFor(dark).labelBg,
        borderRadius: 4,
      },
      labelBgPadding: [3, 5],
    });
  };

  // Draw edges by walking the same parent_id tree used for positioning, so
  // every rendered connection matches exactly -- identical in both layout
  // modes, since only the (x, y) math differs between them. This walks the
  // FULL (unsplit) childrenOf map, so it naturally includes each head ->
  // other-family-root cross edge plus that family's own internal edges.
  const drawTreeEdges = (parent) => {
    (childrenOf[parent.id] || []).forEach((p) => {
      drawEdge(parent.id, p);
      drawTreeEdges(p);
    });
  };
  drawTreeEdges(head);

  // Overall bounding box across the head's own cluster AND every other
  // family's cluster, so the halo/household-label span the whole view.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const growBounds = (cx, cy, r) => {
    minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r);
    minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r);
  };
  [head, ...members].forEach((p) => {
    const pos = positionMap[p.id];
    if (!pos) return;
    const size = p.id === head.id ? headSize : (isOtherRoot(p.id) ? rootSize : memberSize);
    growBounds(pos.x, pos.y, size / 2);
  });

  const pad = 55;

  // Halo background
  rfNodes.unshift({
    id: "__halo__",
    position: { x: minX - pad, y: minY - pad },
    data: { label: "" },
    draggable: false,
    selectable: false,
    style: {
      width:         maxX - minX + pad * 2,
      height:        maxY - minY + pad * 2,
      borderRadius:  999,
      background:    dark
        ? "radial-gradient(ellipse at center, rgba(78,155,255,0.04) 0%, transparent 70%)"
        : "radial-gradient(ellipse at center, rgba(21,101,192,0.04) 0%, transparent 70%)",
      border:        dark ? "0.5px solid rgba(78,155,255,0.08)" : "0.5px solid rgba(21,101,192,0.07)",
      zIndex:        -10,
      pointerEvents: "none",
    },
  });

  // Per-family halo + caption around each OTHER family's cluster, so it
  // visually reads as its own separated branch of the same view.
  familyClusters.forEach((fc) => {
    const pad2 = 40;
    rfNodes.unshift({
      id: `__halo_fam_${fc.familyId}__`,
      position: { x: fc.bounds.minX - pad2, y: fc.bounds.minY - pad2 },
      data: { label: "" },
      draggable: false,
      selectable: false,
      style: {
        width:        fc.bounds.maxX - fc.bounds.minX + pad2 * 2,
        height:       fc.bounds.maxY - fc.bounds.minY + pad2 * 2,
        borderRadius: 28,
        background:   "transparent",
        border:       "none",
        zIndex:       -9,
        pointerEvents:"none",
      },
    });
    // Clusters can now land above the head (a rare fallback direction),
    // not just below/beside it -- put the caption on whichever side of
    // the cluster faces AWAY from the head, so it never sits between the
    // cluster and the head where the connecting line runs.
    const clusterCenterY = (fc.bounds.minY + fc.bounds.maxY) / 2;
    const captionAbove = clusterCenterY < 0;
    rfNodes.push({
      id: `__label_fam_${fc.familyId}__`,
      position: {
        x: (fc.bounds.minX + fc.bounds.maxX) / 2 - 85,
        y: captionAbove ? fc.bounds.minY - pad2 - 46 : fc.bounds.maxY + pad2 + 10,
      },
      data: {
        label: (
          <div style={{ lineHeight: 1.25 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: paletteFor(dark).otherFamilyAccent,
              whiteSpace: "nowrap",
            }}>
              {fc.label}
            </div>
            {/* The relationship label alone can repeat across clusters
                (two of the head's children can each head their own family
                here) -- the root's own name always disambiguates them. */}
            {fc.rootName && (
              <div style={{ fontSize: 9, color: paletteFor(dark).otherFamilyAccent, whiteSpace: "nowrap", marginTop: 1 }}>
                {fc.rootName}
              </div>
            )}
          </div>
        ),
      },
      draggable: false,
      selectable: false,
      style: {
        width: 170,
        textAlign: "center",
        padding: "3px 10px",
        background: dark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.10)",
        border: "0.5px solid rgba(245,158,11,0.4)",
        borderRadius: 8,
        pointerEvents: "none",
      },
    });
  });

  if (household) {
    // Centered under the TRUE bounding box (minX..maxX), not a fixed
    // magic-number offset -- the old hardcoded x:-80 only looked right
    // for one specific tree width and threw the label sideways for every
    // other household (most visibly a single-person household, where it
    // landed nowhere near the one node above it).
    const householdCenterX = (minX + maxX) / 2;
    rfNodes.push({
      id: household.id,
      position: { x: householdCenterX - 80, y: maxY + 60 },
      data: { label: household.label || household.id },
      style: {
        padding: "8px 20px",
        borderRadius: 12,
        border: dark ? "1px solid rgba(78,155,255,0.3)" : "1px solid rgba(21,101,192,0.3)",
        background: dark ? "rgba(15,20,35,0.9)" : "#ffffff",
        color: paletteFor(dark).textPrimary,
        fontWeight: 700,
        fontSize: 12,
        minWidth: 160,
        textAlign: "center",
        boxShadow: dark ? "0 4px 16px rgba(0,0,0,0.4)" : "0 4px 14px rgba(0,0,0,0.08)",
        backdropFilter: "blur(8px)",
        letterSpacing: "0.02em",
      },
    });
  }

  return { rfNodes, rfEdges, familyClusters };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Replaces the old BVI-score badge. There's no combined vulnerability
// score anymore (adviser decision), so this shows the one honest,
// single-domain flag available at a glance in the list: hazard exposure,
// via the SAME hazardColor()/hazardLabel() helpers used on the household
// profile page and this page's own detail panel, so all three agree.
function HazardBadge({ hh, dark }) {
  const label = hazardLabel(hh);
  const color = hazardColor(hh, dark);
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      padding: "2px 8px",
      borderRadius: 100,
      background: `${color}22`,
      color,
      border: `0.5px solid ${color}55`,
      letterSpacing: "0.03em",
      whiteSpace: "nowrap",
    }}>
      {label || "No hazard mapped"}
    </span>
  );
}

function StatCard({ value, label, color, D }) {
  return (
    <div style={{
      borderRadius: 10,
      padding: "10px 12px",
      background: D.statBg,
      border: `0.5px solid ${D.border}`,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: D.textMuted, marginTop: 4, letterSpacing: "0.02em" }}>{label}</div>
    </div>
  );
}

function CompBox({ label, value, highlight, D }) {
  return (
    <div style={{
      border: `0.5px solid ${D.border}`,
      borderRadius: 10,
      padding: "10px 12px",
      background: D.statBg,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight || D.textPrimary, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: D.textMuted, marginTop: 4, letterSpacing: "0.02em" }}>{label}</div>
    </div>
  );
}

// Percentage ring for the Cluster Profile & Attribute Matching card --
// same component as VulnerabilityPage.jsx's MatchRing, duplicated here so
// this page doesn't depend on importing across features. Reads "X.X%
// match" rather than a /10 score, since it's a share of matching
// attributes, not a ranked vulnerability measure.
function MatchRing({ pct, color, track = "#cbd5e1", muted = "#5b6577" }) {
  const radius = 45;
  const circ   = 2 * Math.PI * radius;
  const p      = Math.max(0, Math.min(100, pct));
  const dash   = (p / 100) * circ;
  const gap    = circ - dash;
  return (
    <div style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
      <svg width="96" height="96" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="48" cy="48" r={radius * 0.87} fill="none" stroke={track} strokeWidth="7" />
        <circle cx="48" cy="48" r={radius * 0.87} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${dash * 0.87} ${gap * 0.87}`} strokeLinecap="round" />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 18, fontWeight: 800, color }}>{p.toFixed(1)}%</span>
        <span style={{ fontSize: 9, color: muted }}>match</span>
      </div>
    </div>
  );
}

// One row of the three never-combined domains (Typology / Facility
// Distance / Hazard Exposure) -- a badge + one line of detail, colored per
// that domain's own honest measure, never rolled into a shared score.
function DomainCard({ title, color, badge, detail, D }) {
  return (
    <div style={{
      border: `0.5px solid ${color}33`,
      background: `${color}0c`,
      borderRadius: 10,
      padding: "9px 11px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: D.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>
        {title}
      </div>
      <div style={{
        display: "inline-block",
        fontSize: 11.5, fontWeight: 700, color,
        background: `${color}18`, border: `0.5px solid ${color}55`,
        borderRadius: 100, padding: "2px 9px", marginBottom: detail ? 5 : 0,
      }}>
        {badge}
      </div>
      {detail && (
        <div style={{ fontSize: 10.5, color: D.textSecondary, lineHeight: 1.5 }}>{detail}</div>
      )}
    </div>
  );
}

function SectionLabel({ children, D }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      color: D.textMuted,
      textTransform: "uppercase",
      letterSpacing: "0.07em",
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

// Line icons (same stroke style as the Reports page).
const svgIcon = (children) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>{children}</svg>
);
const ICONS = {
  // table / spreadsheet download
  exportData: svgIcon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/></>),
  // document with lines (PDF report)
  report: svgIcon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></>),
  // picture download
  image: svgIcon(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>),
  radial: svgIcon(<><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="20" cy="15" r="1.5"/><circle cx="4" cy="15" r="1.5"/><line x1="12" y1="9.5" x2="12" y2="5"/><line x1="14.2" y1="13.2" x2="18.6" y2="14.6"/><line x1="9.8" y1="13.2" x2="5.4" y2="14.6"/></>),
  tree: svgIcon(<><rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-3h14v3"/></>),
};

function IconBtn({ icon, label, primary, D, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: primary
          ? `1px solid ${D.brand}`
          : `1px solid ${D.inputBorder}`,
        background: primary
          ? D.brandSoft
          : D.statBg,
        color: primary ? D.brand : D.textSecondary,
        cursor: "pointer",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "inherit",
        transition: "opacity 0.15s",
      }}
    >
      <span style={{ display: "flex", alignItems: "center" }}>{icon}</span>
      {label && <span>{label}</span>}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function NetworkAnalysis() {
  const { dark } = useTheme();

  // Every color on this page comes from networkPalette.js (WCAG 2.1 AA).
  const D = {
    ...paletteFor(dark),
    borderAccent: dark ? "rgba(78,155,255,0.25)" : "rgba(21,101,192,0.2)",
    shadow:       dark ? "0 2px 20px rgba(0,0,0,0.6)" : "0 2px 12px rgba(0,0,0,0.06)",
    dotColor:     dark ? "rgba(78,155,255,0.12)" : "rgba(21,101,192,0.07)",
  };

  const PER_PAGE = 200;
  const [kpi,              setKpi]              = useState({ total: 0, multiFamily: 0, care: 0 });
  const [q,                setQ]                = useState("");
  const [barangays,        setBarangays]        = useState([]);
  const [selectedBarangay, setSelectedBarangay] = useUrlParam("brgy", "");
  const [filterVuln,       setFilterVuln]       = useState("");
  const [filterMember,     setFilterMember]     = useState("");
  const [filterType,       setFilterType]       = useState("");
  const [page,             setPage]             = useState(1);
  const [hhList,           setHhList]           = useState([]);
  const [selectedHH,       setSelectedHH]       = useState(null);
  // Re-open the household that was open before a refresh (kept in the
  // address as #/network?hh=<id>) once it appears in the loaded list.
  const hhRestoreRef = useRef(getParam("hh"));
  useEffect(() => {
    if (!hhRestoreRef.current || !hhList.length) return;
    const hit = hhList.find((h) => String(h.household_id) === hhRestoreRef.current);
    if (hit) { hhRestoreRef.current = null; setSelectedHH(hit); }
  }, [hhList]);
  useEffect(() => {
    if (selectedHH || !hhRestoreRef.current) setParam("hh", selectedHH?.household_id ?? null);
  }, [selectedHH]);
  const [graphData,        setGraphData]        = useState({ householdId: null, nodes: [], edges: [], household: null, head_node_id: null });
  const [rawSelectedNode,  setRawSelectedNode]  = useState(null);
  const [clusterMatchData, setClusterMatchData] = useState({ householdId: null, clusterMatch: null });

  useEffect(() => {
    getBarangays()
      .then((r) => { const arr = r.data?.data || r.data || []; setBarangays(Array.isArray(arr) ? arr : []); })
      .catch(() => setBarangays([]));
  }, []);

  useEffect(() => {
    getNetworkHouseholds({ q, barangay: selectedBarangay || undefined, page, per_page: PER_PAGE })
      .then((r) => {
        const data           = r.data?.data || [];
        const total          = r.data?.total ?? data.length;
        const multiFamily    = r.data?.multi_family_count ?? 0;
        const care           = r.data?.care_dependent_count ?? 0;
        setKpi({ total, multiFamily, care });
        if (page === 1) setHhList(data);
        else setHhList((prev) => [...prev, ...data]);
      })
      .catch(() => { setHhList([]); setKpi({ total: 0, multiFamily: 0, care: 0 }); });
  }, [q, selectedBarangay, page]);

  // Only ever set state INSIDE the async .then/.catch callbacks below --
  // never synchronously in the effect body itself. The "reset when
  // household changes" behavior that used to be an explicit setState at
  // the top is instead handled by the derived values right after this
  // effect: if the stored data's householdId doesn't match the currently
  // selected household, render treats it as empty/loading without the
  // effect needing to clear anything.
  useEffect(() => {
    const householdId = selectedHH?.household_id;
    if (!householdId) return;
    // One row per household now (see getNetworkHouseholds) -- the graph
    // endpoint always returns the WHOLE household (every nuclear family
    // together), so fetching only needs to key off household_id.
    let cancelled = false;

    getNetworkGraph(householdId)
      .then((r) => {
        if (cancelled) return;
        setGraphData({ householdId, ...(r.data || { nodes: [], edges: [], household: null, head_node_id: null }) });
      })
      .catch(() => {
        if (cancelled) return;
        setGraphData({ householdId, nodes: [], edges: [], household: null, head_node_id: null });
      });

    return () => { cancelled = true; };
  }, [selectedHH]);

  // Cluster Profile & Attribute Matching -- reuses the same
  // /api/vulnerability/household/<id> endpoint VulnerabilityPage.jsx
  // calls, which computes the household's agreement with its k-modes
  // cluster's own mode value on each of the 13 typology indicators
  // server-side. Fetched lazily per selected household, same pattern as
  // the graph fetch above, rather than duplicated into the (paginated)
  // household-list endpoint.
  useEffect(() => {
    const householdId = selectedHH?.household_id;
    if (!householdId) return;
    let cancelled = false;

    getVulnHousehold(householdId)
      .then((r) => {
        if (cancelled) return;
        setClusterMatchData({ householdId, clusterMatch: r.data?.cluster_match ?? null });
      })
      .catch(() => {
        if (cancelled) return;
        setClusterMatchData({ householdId, clusterMatch: null });
      });

    return () => { cancelled = true; };
  }, [selectedHH]);

  const currentHouseholdId = selectedHH?.household_id ?? null;

  // Derived render state -- computed fresh every render instead of stored
  // and synced via setState. If the fetched data doesn't belong to the
  // currently selected household (nothing selected yet, or still in
  // flight), it's simply not used, rather than needing to be cleared.
  const graph = graphData.householdId === currentHouseholdId
    ? graphData
    : { nodes: [], edges: [], household: null, head_node_id: null };
  // A selected node only stays "selected" while it still belongs to the
  // graph currently on screen -- switching households automatically drops
  // a stale selection without any effect needing to reset it.
  const selectedNode = rawSelectedNode && (graph.nodes || []).some((n) => n.id === rawSelectedNode.id)
    ? rawSelectedNode
    : null;
  const clusterMatch = clusterMatchData.householdId === currentHouseholdId
    ? clusterMatchData.clusterMatch
    : null;


  // Same predicate for the on-screen list AND the Excel export, so "Export
  // Data" always exports exactly what the filters on the left describe.
  const passesFilters = useCallback((h) => {
      // Hazard exposure filter -- replaces the old BVI-score filter (the
      // adviser's three-domain model has no single combined vulnerability
      // score to filter by, so this filters on the one continuous,
      // per-household axis that's left: server-computed flood/landslide
      // exposure).
      if (filterVuln === "compound" && !toBool(h.compound_hazard))                      return false;
      if (filterVuln === "flood"    && !h.flood_exposure)                               return false;
      if (filterVuln === "landslide" && !h.landslide_exposure)                          return false;
      if (filterVuln === "none"     && (h.flood_exposure || h.landslide_exposure))      return false;
      const people = h.members || [];
      if (filterMember === "care"    && !people.some((p) => Number(p.age) >= 60 || toBool(p.is_pwd))) return false;
      if (filterMember === "seniors" && !people.some((p) => Number(p.age) >= 60))   return false;
      if (filterMember === "pwd"     && !people.some((p) => toBool(p.is_pwd)))       return false;
      if (filterMember === "minors"  && !people.some((p) => Number(p.age) <= 17))   return false;
      const nFamilies = Number(h.n_families ?? 1);
      if (filterType === "multi"  && !(nFamilies > 1)) return false;
      if (filterType === "single" && !(nFamilies <= 1)) return false;
      return true;
  }, [filterVuln, filterMember, filterType]);

  const filteredList = useMemo(() => hhList.filter(passesFilters), [hhList, passesFilters]);

  const [layoutMode, setLayoutMode] = useState("radial"); // "radial" | "tree"

  const { rfNodes, rfEdges } = useMemo(
    () => buildRelationshipLayout(graph.nodes || [], dark, graph.head_node_id, layoutMode),
    [graph.nodes, graph.head_node_id, dark, layoutMode]
  );

  const selectedHHLabel = selectedHH?.household_number || "—";
  const rightHousehold  = graph.household?.household_number || selectedHHLabel;

  const composition = useMemo(() => {
    const people = (graph.nodes || []).filter((n) => n.kind === "person");
    return {
      total:    people.length,
      adults:   people.filter((p) => Number(p.age) >= 18 && Number(p.age) <= 59).length,
      children: people.filter((p) => Number(p.age) <= 17).length,
      pwd:      people.filter((p) => toBool(p.is_pwd)).length,
      seniors:  people.filter((p) => Number(p.age) >= 60).length,
    };
  }, [graph.nodes]);

  // The three never-combined domains for the selected household -- same
  // fields/logic as VulnerabilityPage.jsx's household profile, so this
  // panel agrees with it rather than showing the disregarded BVI.
  const domains = useMemo(() => {
    const hh = selectedHH || {};
    const typologyMissing = typologyIndicatorsMissing(hh);
    const presentIndicatorCount = typologyMissing ? null : (
      TYPOLOGY_BOOL_INDICATORS.filter((k) => hh[k] === true).length +
      TYPOLOGY_COUNT_INDICATORS.filter((k) => parseInt(hh[k], 10) > 0).length
    );
    const totalIndicators = TYPOLOGY_BOOL_INDICATORS.length + TYPOLOGY_COUNT_INDICATORS.length; // 13

    const fd = getFacilityDistances(hh);
    const beyondCount = (fd.beyondRHU ? 1 : 0) + (fd.beyondFire ? 1 : 0);

    const hazardScore = hh.hazard_exposure_score != null ? Number(hh.hazard_exposure_score) : null;

    return {
      typology: {
        label: hh.typology_cluster_label || "Not yet assigned",
        hasCluster: hh.typology_cluster_id != null || !!hh.typology_cluster_label,
        missing: typologyMissing,
        presentIndicatorCount,
        totalIndicators,
      },
      capacity: {
        hasCoords: fd.hasCoords,
        rhuKm: fd.rhuKm, fireKm: fd.fireKm,
        beyondCount,
        color: beyondCount >= 2 ? D.danger : beyondCount === 1 ? D.warning : D.success,
      },
      hazard: {
        label: hazardLabel(hh),
        score: hazardScore,
        color: hazardColor(hh, dark),
        compound: toBool(hh.compound_hazard),
        status: hh.hazard_data_status || null,
      },
    };
  }, [selectedHH, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Export Data / Generate Report / graph image ───────────────────────
  const [busy,   setBusy]   = useState(null);   // "export" | "report" | "image" | null
  const [notice, setNotice] = useState(null);   // { type: "error" | "info", text }
  const flash = (type, text) => { setNotice({ type, text }); setTimeout(() => setNotice(null), 5000); };

  // The family graph re-drawn from the same layout as the canvas, in the
  // light print theme (see networkExport.js for why not a screenshot).
  const renderGraphImage = async () => {
    if (!graph.nodes?.length) return null;
    const layout = buildRelationshipLayout(graph.nodes, false, graph.head_node_id, layoutMode);
    const svg = buildFamilyGraphSVG(layout, graph.nodes, { headNodeId: graph.head_node_id });
    return svg ? svgToPngDataUrl(svg, 2.5) : null;
  };

  const handleExportImage = async () => {
    if (!selectedHH) { flash("info", "Select a household first."); return; }
    setBusy("image");
    try {
      const img = await renderGraphImage();
      if (!img) throw new Error("Nothing to export yet — wait for the graph to load.");
      downloadDataUrl(img.dataUrl, `Family_Network_${String(selectedHH.household_number).replace(/[^A-Za-z0-9]+/g, "_")}.png`);
    } catch (e) { flash("error", e.message || "Could not export the graph image."); }
    finally { setBusy(null); }
  };

  const exportRow = (h) => {
    const fd = getFacilityDistances(h);
    const people = h.members || [];
    const missing = typologyIndicatorsMissing(h);
    const present = TYPOLOGY_BOOL_INDICATORS.filter((k) => h[k] === true).length +
      TYPOLOGY_COUNT_INDICATORS.filter((k) => parseInt(h[k], 10) > 0).length;
    const round2 = (v) => (v == null ? "" : Number(v.toFixed(2)));
    return {
      "Household No.": h.household_number,
      "Barangay": h.barangay_name,
      "Nuclear families": Number(h.n_families ?? 1),
      "Members": h.member_count ?? people.length,
      "Minors (0-17)": people.filter((p) => Number(p.age) <= 17).length,
      "Seniors (60+)": people.filter((p) => Number(p.age) >= 60).length,
      "PWD": people.filter((p) => toBool(p.is_pwd)).length,
      "Has solo parent": toBool(h.has_solo_parent) ? "Yes" : "No",
      "4Ps beneficiary": toBool(h.is_4ps_beneficiary) ? "Yes" : "No",
      "Social vulnerability: typology cluster": h.typology_cluster_label || "Not assigned",
      "Typology indicators present (of 13)": missing ? "" : present,
      "Capacity: RHU distance (km)": fd.hasCoords ? round2(fd.rhuKm) : "",
      "Capacity: Fire Station distance (km)": fd.hasCoords ? round2(fd.fireKm) : "",
      "Capacity: facilities beyond 2 km": fd.hasCoords ? (fd.beyondRHU ? 1 : 0) + (fd.beyondFire ? 1 : 0) : "",
      "Hazard: flood exposure": h.flood_exposure || "None",
      "Hazard: landslide exposure": h.landslide_exposure || "None",
      "Hazard: compound (flood + landslide)": toBool(h.compound_hazard) ? "Yes" : "No",
      "Hazard: exposure score": h.hazard_exposure_score != null ? Number(h.hazard_exposure_score) : "",
    };
  };

  const handleExportData = async () => {
    setBusy("export");
    try {
      // Fetch EVERY household matching the search/barangay filters (the
      // list on screen only holds the pages loaded so far), then apply
      // the same client-side filters as the list.
      const all = [];
      const PAGE = 2000;
      for (let p = 1; p <= 50; p++) {
        const r = await getNetworkHouseholds({ q, barangay: selectedBarangay || undefined, page: p, per_page: PAGE });
        const rows = r.data?.data || [];
        all.push(...rows);
        const total = r.data?.total ?? rows.length;
        if (rows.length < PAGE || all.length >= total) break;
      }
      const rows = all.filter(passesFilters).map(exportRow);

      let selected = null;
      if (selectedHH) {
        const a = await getNetworkAnalysis(selectedHH.household_id).then((r) => r.data).catch(() => null);
        if (a) selected = { household: { household_number: selectedHH.household_number, barangay_name: selectedHH.barangay_name }, analysis: a, graph };
      }
      const filterNote = [
        q && `search "${q}"`, selectedBarangay && `barangay ${selectedBarangay}`,
        filterVuln && `hazard: ${filterVuln}`, filterMember && `members: ${filterMember}`, filterType && `type: ${filterType}`,
      ].filter(Boolean).join(" · ");
      const stamp = new Date().toISOString().slice(0, 10);
      exportNetworkWorkbook({
        households: rows, selected, filterNote,
        filename: `Family_Network_Data_${(selectedBarangay || "All").replace(/[^A-Za-z0-9]+/g, "_")}_${stamp}.xlsx`,
      });
      flash("info", `Exported ${rows.length.toLocaleString()} households${selected ? ` + details for ${selectedHH.household_number}` : ""}.`);
    } catch (e) { flash("error", e.message || "Export failed."); }
    finally { setBusy(null); }
  };

  const handleGenerateReport = async () => {
    if (!selectedHH) { flash("info", "Select a household in the list first — the report covers one household."); return; }
    if (!graph.nodes?.length) { flash("info", "The graph is still loading — try again in a moment."); return; }
    setBusy("report");
    try {
      const [analysis, graphImg] = await Promise.all([
        getNetworkAnalysis(selectedHH.household_id).then((r) => r.data),
        renderGraphImage(),
      ]);
      await generateNetworkReportPDF({
        household: { household_number: selectedHH.household_number, barangay_name: selectedHH.barangay_name },
        analysis, graphImg, domains, clusterMatch,
        indicatorLabels: TYPOLOGY_INDICATOR_LABELS, formatIndicator: formatTypologyValue,
      });
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      flash("error", `Report failed: ${msg || "unknown error"}`);
    } finally { setBusy(null); }
  };

  const legendItems = [
    { label: "Spouse",         color: REL_COLOR["Spouse"] },
    { label: "Son/Daughter",   color: REL_COLOR["Son/Daughter"] },
    { label: "In-Law",         color: REL_COLOR["Son/Daughter-in-Law"] },
    { label: "Grandchildren",  color: REL_COLOR["Grandchildren"] },
    { label: "Brother/Sister", color: REL_COLOR["Brother/Sister"] },
    { label: "Parents",        color: REL_COLOR["Parents"] },
    { label: "Other",          color: REL_COLOR["Other Relatives"] },
  ];

  // Shared input/select style
  const inputStyle = {
    width: "100%",
    padding: "7px 10px",
    borderRadius: 8,
    border: `1px solid ${D.inputBorder}`,
    background: D.inputBg,
    color: D.textPrimary,
    fontSize: 12,
    fontFamily: "inherit",
    appearance: "none",
    WebkitAppearance: "none",
    transition: "border-color 0.15s",
  };

  return (
    <div className="na-page" style={{
      background: D.pageBg,
      height: "100vh",
      overflow: "hidden",
      padding: "14px 16px",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      color: D.textPrimary,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>

      {/* Visible keyboard focus on every control and graph node (WCAG 2.4.7). */}
      <style>{`
        .na-page button:focus-visible, .na-page input:focus-visible, .na-page select:focus-visible,
        .na-page [tabindex]:focus-visible, .na-page .react-flow__node:focus-visible {
          outline: 2.5px solid ${D.focus} !important; outline-offset: 2px !important;
        }
        .na-page input::placeholder { color: ${D.textMuted}; opacity: 1; }
        .na-page .react-flow__controls-button { background: ${D.cardBg}; border-bottom: 1px solid ${D.inputBorder}; fill: ${D.textPrimary}; color: ${D.textPrimary}; }
        .na-page .react-flow__controls-button svg { fill: ${D.textPrimary}; }
        .na-page .react-flow__attribution { background: transparent !important; }
        .na-page .react-flow__attribution a { color: ${D.textMuted} !important; }
      `}</style>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>
            Family Network Analysis
          </div>
          <div style={{ fontSize: 11, color: D.textMuted, marginTop: 1 }}>
            Intra-household family structure &amp; vulnerability mapping
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
          {notice && (
            <div style={{
              alignSelf: "center", fontSize: 11, padding: "5px 10px", borderRadius: 8,
              color: notice.type === "error" ? D.danger : D.brand,
              background: notice.type === "error" ? D.dangerBg : D.brandSoft,
              border: `0.5px solid ${notice.type === "error" ? D.dangerBorder : D.borderAccent}`,
            }}>{notice.text}</div>
          )}
          <IconBtn icon={ICONS.exportData} label={busy === "export" ? "Exporting…" : "Export Data"} D={D} onClick={busy ? undefined : handleExportData} />
          <IconBtn icon={ICONS.report} label={busy === "report" ? "Building PDF…" : "Generate Report"} primary D={D} onClick={busy ? undefined : handleGenerateReport} />
        </div>
      </div>

      {/* ── 3-column layout ─────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr 280px",
        gap: 12,
        flex: 1,
        minHeight: 0,
      }}>

        {/* ═══════════════ LEFT PANEL ═══════════════ */}
        <div style={{
          background: D.cardBg,
          border: `0.5px solid ${D.border}`,
          borderRadius: 14,
          boxShadow: D.shadow,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}>

          {/* KPI strip */}
          <div style={{ padding: "12px 14px 10px", borderBottom: `0.5px solid ${D.border}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 7 }}>
              <StatCard value={kpi.total.toLocaleString()} label="Total households" color={D.brand} D={D} />
              <StatCard
                value={kpi.multiFamily.toLocaleString()}
                label={`Multi-family (${kpi.total ? ((kpi.multiFamily/kpi.total)*100).toFixed(1) : 0}%)`}
                color={D.warning}
                D={D}
              />
            </div>
            <StatCard
              value={kpi.care.toLocaleString()}
              label={`With a senior or PWD (${kpi.total ? ((kpi.care/kpi.total)*100).toFixed(1) : 0}%)`}
              color={D.purple}
              D={D}
            />
          </div>

          {/* Search + Filters */}
          <div style={{ padding: "10px 12px", borderBottom: `0.5px solid ${D.border}`, display: "flex", flexDirection: "column", gap: 7 }}>
            {/* Search */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: D.textMuted, fontSize: 13, pointerEvents: "none" }}>
              </span>
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Search by household ID, name, address…"
                style={{ ...inputStyle, paddingLeft: 28 }}
              />
            </div>
            {/* Filter row 1 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              <select value={selectedBarangay} onChange={(e) => { setSelectedBarangay(e.target.value); setPage(1); }} style={inputStyle}>
                <option value="">All barangays</option>
                {barangays.map((b) => {
                  const name = b?.barangay_name ?? b?.name ?? b;
                  const key  = b?.barangay_id ?? name;
                  return <option key={key} value={name}>{name}</option>;
                })}
              </select>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={inputStyle}>
                <option value="">All types</option>
                <option value="single">Single family</option>
                <option value="multi">Multi-family</option>
              </select>
            </div>
            {/* Filter row 2 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              <select value={filterVuln} onChange={(e) => setFilterVuln(e.target.value)} style={inputStyle}>
                <option value="">All hazard exposure</option>
                <option value="flood">Flood zone</option>
                <option value="landslide">Landslide zone</option>
                <option value="none">No hazard mapped</option>
              </select>
              <select value={filterMember} onChange={(e) => setFilterMember(e.target.value)} style={inputStyle}>
                <option value="">All members</option>
                <option value="care">With a senior or PWD</option>
                <option value="seniors">With seniors</option>
                <option value="pwd">With PWD</option>
                <option value="minors">With minors</option>
              </select>
            </div>
          </div>

          {/* Household list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 0" }}>
            {filteredList.length === 0 && (
              <div style={{ color: D.textMuted, fontSize: 12, textAlign: "center", padding: "24px 0" }}>
                No households found
              </div>
            )}
            {filteredList.map((h) => {
              // One row per HOUSEHOLD (see getNetworkHouseholds) -- a
              // multi-family household is a single click/row, with every
              // nuclear family it contains listed in h.families for the
              // badges below, and shown together in one combined graph.
              const active     = selectedHH?.household_id === h.household_id;
              const typologyLabel = h.typology_cluster_label || "Not yet assigned";
              const nFamilies  = Number(h.n_families ?? 1);
              const isMulti    = nFamilies > 1;
              const families   = Array.isArray(h.families) ? h.families : [];
              return (
                <button
                  key={h.household_id}
                  onClick={() => setSelectedHH(h)}
                  style={{
                    textAlign: "left",
                    borderRadius: 10,
                    padding: "9px 11px",
                    width: "100%",
                    border: `0.5px solid ${active ? D.brand : D.border}`,
                    background: active ? D.brandSoft : "transparent",
                    color: D.textPrimary,
                    cursor: "pointer",
                    marginBottom: 5,
                    display: "block",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: D.brand, fontSize: 12 }}>
                      {h.household_number}
                    </span>
                    <HazardBadge hh={h} dark={dark} />
                    <span style={{ marginLeft: "auto", fontSize: 10, color: D.textMuted }}>
                      {h.member_count ?? h.family_size ?? "—"} members
                    </span>
                  </div>
                  {isMulti && (() => {
                    // Same disambiguation as the graph's cluster captions:
                    // two families can share the exact same relationship
                    // to the head (e.g. two of the head's children each
                    // now head their own family here), so a repeated label
                    // gets a running count appended -- otherwise the list
                    // shows two identical-looking badges with no way to
                    // tell which is which.
                    const seen = {};
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
                        {families.map((fam) => {
                          const relLabel = !fam.is_head_family ? fam.head_relationship : null;
                          const relColor = relLabel ? getRelColor(relLabel, dark) : D.brand;
                          const base = relLabel ? `${relLabel}'s family` : "Head's family";
                          seen[base] = (seen[base] || 0) + 1;
                          const text = seen[base] > 1 ? `${base} #${seen[base]}` : base;
                          return (
                            <span
                              key={fam.family_id}
                              style={{
                                fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 100,
                                color: relLabel ? relColor : D.brand,
                                background: relLabel ? `${relColor}18` : D.brandSoft,
                                border: `0.5px solid ${relLabel ? relColor : D.brand}55`,
                              }}
                            >
                              {text}
                              {fam.has_solo_parent ? " · solo-parent" : ""}
                            </span>
                          );
                        })}
                        <span style={{ fontSize: 9, color: D.textMuted }}>
                          {nFamilies} families in this household
                        </span>
                      </div>
                    );
                  })()}
                  {h.address && (
                    <div style={{ fontSize: 10, color: D.textMuted, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {h.address}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: D.textMuted }}>{h.barangay_name || h.barangay}</div>
                  {/* Replaces the old combined "V-Index" line -- per the
                      adviser's three-domain model there's no single score
                      to show, so this surfaces the household's Typology
                      category (Social Vulnerability domain) alongside the
                      HazardBadge above, same fields the detail panel and
                      household profile page use. */}
                  <div style={{ fontSize: 11, marginTop: 4, color: D.textMuted }}>
                    Typology:{" "}
                    <span style={{ color: h.typology_cluster_label ? D.textPrimary : D.textMuted, fontWeight: 700 }}>
                      {typologyLabel}
                    </span>
                    {isMulti && (
                      <span style={{ fontSize: 9, color: D.textMuted, marginLeft: 6 }}>
                        (household-level, shared across {nFamilies} families)
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {hhList.length < kpi.total && (
              <div style={{ padding: "8px 0 12px" }}>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  style={{
                    ...inputStyle,
                    fontWeight: 700,
                    cursor: "pointer",
                    textAlign: "center",
                    background: D.statBg,
                    padding: "8px",
                  }}
                >
                  Load more households
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════ CENTER PANEL ═══════════════ */}
        <div style={{
          background: D.cardBg,
          border: `0.5px solid ${D.border}`,
          borderRadius: 14,
          boxShadow: D.shadow,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}>

          {/* Graph header */}
          <div style={{
            flexShrink: 0,
            padding: "10px 14px",
            borderBottom: `0.5px solid ${D.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-0.01em" }}>
                Network graph —{" "}
                <span style={{ color: D.brand }}>
                  {selectedHH ? selectedHH.household_number : "Select a household"}
                </span>
              </div>
              {selectedHH && (
                <div style={{ fontSize: 10, color: D.textMuted, marginTop: 1 }}>
                  {selectedHH.barangay_name}
                  {selectedHH.address ? ` · ${selectedHH.address}` : ""}
                </div>
              )}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <IconBtn
                icon={layoutMode === "tree" ? ICONS.tree : ICONS.radial}
                label={layoutMode === "tree" ? "Layout: Tree" : "Layout: Radial"}
                primary={layoutMode === "tree"}
                D={D}
                onClick={() => setLayoutMode((m) => (m === "tree" ? "radial" : "tree"))}
              />
              <IconBtn icon={ICONS.image} label={busy === "image" ? "Exporting…" : "Export PNG"} primary D={D} onClick={busy ? undefined : handleExportImage} />
            </div>
          </div>

          {/* ReactFlow canvas */}
          <div style={{ flex: 1, minHeight: 0, position: "relative", background: D.graphBg }}>
            {/* Dot-grid background */}
            <div style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `radial-gradient(circle, ${D.dotColor} 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
              pointerEvents: "none",
              zIndex: 0,
            }} />

            {/* Nodes no longer route edges through RF's default handles
                (see FloatingEdge, which draws straight to each circle's
                real boundary) -- the small handle dots ReactFlow renders
                by default are now pure visual clutter, so hide them. */}
            <style>{`.react-flow__handle { opacity: 0; pointer-events: none; }`}</style>

            <ReactFlowProvider>
              <ReactFlow
                key={`${selectedHH?.household_id || "none"}-${layoutMode}`}
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.22, maxZoom: 1.1 }}
                minZoom={0.08}
                maxZoom={2.5}
                nodesDraggable={false}
                nodesConnectable={false}
                style={{ width: "100%", height: "100%", background: "transparent" }}
                onNodeClick={(evt, node) => {
                  const raw = (graph.nodes || []).find((n) => n.id === node.id);
                  setRawSelectedNode(raw || null);
                }}
              >
                <Background variant="none" />
                <Controls
                  style={{
                    background: D.cardBg,
                    border: `0.5px solid ${D.border}`,
                    borderRadius: 10,
                    boxShadow: D.shadow,
                  }}
                />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          {/* Legend bar */}
          <div style={{
            flexShrink: 0,
            padding: "8px 14px",
            borderTop: `0.5px solid ${D.border}`,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            fontSize: 10,
            color: D.textMuted,
            alignItems: "center",
            background: D.sidebarBg,
          }}>
            {legendItems.map(({ label, color }) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  display: "inline-block",
                  width: 18,
                  height: 2.5,
                  borderRadius: 2,
                  background: dark ? color.dark : color.light,
                }} />
                {label}
              </span>
            ))}
            <span style={{
              marginLeft: 6,
              borderLeft: `0.5px solid ${D.border}`,
              paddingLeft: 10,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}>
              Node:{" "}
              <b style={{ color: D.person.adult }}>Adult (18–59)</b>
              {" · "}
              <b style={{ color: D.person.minor }}>Minor (0–17)</b>
              {" · "}
              <b style={{ color: D.person.senior }}>Senior (60+)</b>
              {" · "}
              <b style={{ color: D.person.pwd }}>Purple ring = PWD</b>
              <span>(each circle also says its group)</span>
            </span>
          </div>

        </div>

        {/* ═══════════════ RIGHT PANEL ═══════════════ */}
        <div style={{
          background: D.cardBg,
          border: `0.5px solid ${D.border}`,
          borderRadius: 14,
          boxShadow: D.shadow,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}>

          {/* Header */}
          <div style={{ padding: "12px 14px 10px", borderBottom: `0.5px solid ${D.border}` }}>
            <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-0.01em" }}>Household summary</div>
            <div style={{ color: D.textMuted, fontSize: 11, marginTop: 3 }}>
              Household:{" "}
              <span style={{ color: D.brand, fontWeight: 700 }}>{rightHousehold}</span>
            </div>
          </div>

          {/* Compound hazard alert -- replaces the old BVI-based "masked
              vulnerability" alert with an honest, single-domain flag:
              this household's own hazard exposure, not a combined score. */}
          {selectedHH && domains.hazard.compound && (
            <div style={{
              margin: "10px 12px 0",
              border: `0.5px solid ${D.dangerBorder}`,
              background: D.dangerBg,
              borderRadius: 10,
              padding: "10px 12px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 700, fontSize: 12, color: D.danger, marginBottom: 4 }}>
                ⚠ Compound hazard exposure
              </div>
              <div style={{ fontSize: 11, color: D.textSecondary, lineHeight: 1.55 }}>
                This household sits in both a flood AND a landslide zone ({domains.hazard.label}).
              </div>
            </div>
          )}

          {/* Family composition */}
          <div style={{ padding: "12px 12px 0" }}>
            <SectionLabel D={D}>Family composition</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              <CompBox label="Total members"   value={composition.total}    D={D} />
              <CompBox label="Adults (18–59)"  value={composition.adults}   D={D} />
              <CompBox label="Children (0–17)" value={composition.children} D={D} />
              <CompBox label="Seniors (60+)"   value={composition.seniors}  D={D} />
              <div style={{ gridColumn: "1/-1" }}>
                <CompBox
                  label="PWD"
                  value={composition.pwd}
                  highlight={composition.pwd > 0 ? D.danger : undefined}
                  D={D}
                />
              </div>
            </div>
          </div>

          {/* Three-domain vulnerability block -- replaces the old combined
              BVI = (E+S)/AC display. Per the adviser's decision (already
              in effect on the household profile page), Social
              Vulnerability, Operational Capacity and Hazard Exposure are
              three separate, honest measures, never merged into one
              score or one badge. */}
          {selectedHH && (
            <div style={{ padding: "12px 12px 0" }}>
              <SectionLabel D={D}>Vulnerability — three domains</SectionLabel>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <DomainCard
                  D={D}
                  title="① Social Vulnerability (Typology)"
                  color={domains.typology.hasCluster ? D.purple : D.neutral}
                  badge={domains.typology.label}
                  detail={
                    domains.typology.missing
                      ? "Typology indicators not yet backfilled"
                      : `${domains.typology.presentIndicatorCount}/${domains.typology.totalIndicators} indicators present`
                  }
                />

                <DomainCard
                  D={D}
                  title="② Distance to help (vulnerability)"
                  color={domains.capacity.hasCoords ? domains.capacity.color : D.neutral}
                  badge={
                    domains.capacity.hasCoords
                      ? `${domains.capacity.beyondCount}/2 facilities beyond 2km`
                      : "No coordinates"
                  }
                  detail={
                    domains.capacity.hasCoords
                      ? `RHU ${domains.capacity.rhuKm.toFixed(2)}km · Fire ${domains.capacity.fireKm.toFixed(2)}km`
                      : null
                  }
                />
                <DomainCard
                  D={D}
                  title="③ Hazard Exposure"
                  color={domains.hazard.color}
                  badge={domains.hazard.label || "None detected"}
                  detail={
                    domains.hazard.score != null
                      ? `Exposure score ${domains.hazard.score.toFixed(2)}${domains.hazard.status ? ` · ${domains.hazard.status}` : ""}`
                      : (domains.hazard.status || null)
                  }
                />
              </div>

              <div style={{ fontSize: 10, color: D.textMuted, fontStyle: "italic", marginTop: 8, textAlign: "right", letterSpacing: "0.01em" }}>
                BVI (E+S)/AC is disregarded — these three domains are never combined into one score.
              </div>
            </div>
          )}

          {/* Member details */}
          <div style={{
            padding: "12px",
            marginTop: "auto",
            borderTop: `0.5px solid ${D.border}`,
          }}>
            <SectionLabel D={D}>Member details</SectionLabel>
            {!selectedNode ? (
              <div style={{ color: D.textMuted, fontSize: 11, fontStyle: "italic" }}>
                Click a node in the graph to inspect.
              </div>
            ) : (
              <div style={{
                background: D.statBg,
                border: `0.5px solid ${D.borderAccent}`,
                borderLeft: `3px solid ${D.brand}`,
                borderRadius: "0 10px 10px 0",
                padding: "10px 12px",
                display: "grid",
                gap: 6,
              }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: D.textPrimary, marginBottom: 2 }}>
                  {selectedNode.label}
                </div>
                <div style={{ fontSize: 11, color: getRelColor(selectedNode.relationship_to_hh, dark), fontWeight: 600 }}>
                  {selectedNode.relationship_to_hh ?? "Household Head"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginTop: 4 }}>
                  {[
                    ["Age",    selectedNode.age ?? "—"],
                    ["Gender", selectedNode.gender ?? "—"],
                    ["PWD",    toBool(selectedNode.is_pwd)    ? "Yes" : "No"],
                    ["Senior", toBool(selectedNode.is_senior) ? "Yes" : "No"],
                  ].map(([lbl, val]) => (
                    <div key={lbl}>
                      <div style={{ fontSize: 9, color: D.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{lbl}</div>
                      <div style={{ fontSize: 12, color: D.textPrimary, fontWeight: 600, marginTop: 1 }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Cluster Profile & Attribute Matching -- how typical this
              household is of the k-modes cluster it's assigned to. Lives in
              the right panel (which scrolls on its own, D.cardBg's
              overflow:"auto") rather than below the graph canvas: the
              canvas + right panel share one fixed-height grid row, so
              mounting this card inside the CENTER column once its async
              fetch resolves was shrinking the ReactFlow flex:1 area on
              every household click -- a visible ~1s reflow/glitch as
              fitView recalculated. The right panel's own height doesn't
              feed back into the graph's, so growing content here never
              touches it. Only renders once cluster_match comes back. */}
          {clusterMatch && (
            <div style={{ padding: "12px", borderTop: `0.5px solid ${D.border}` }}>
              <SectionLabel D={D}>Cluster Profile and Attribute Matching</SectionLabel>
              <div style={{
                border: `0.5px solid ${D.border}`,
                background: D.cardBg,
                borderRadius: 10,
                padding: "10px 12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <MatchRing pct={clusterMatch.match_pct} color={D.purple} track={D.track} muted={D.textMuted} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: D.textSecondary, lineHeight: 1.4 }}>
                      <strong style={{ color: D.textPrimary }}>{clusterMatch.matched_count} of {clusterMatch.total_indicators}</strong>{" "}
                      attributes match the cluster mode
                    </div>
                    <div style={{ height: 6, borderRadius: 4, background: D.track, marginTop: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${clusterMatch.match_pct}%`, background: D.purple, borderRadius: 4 }} />
                    </div>
                  </div>
                </div>
                {(() => {
                  const differing = clusterMatch.attributes.filter((a) => !a.match);
                  return differing.length > 0 ? (
                    <div style={{
                      background: D.dangerBg, border: `0.5px solid ${D.dangerBorder}`,
                      borderRadius: 8, padding: "7px 9px", marginBottom: 6,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: D.danger, marginBottom: 4 }}>
                        Attributes that differ
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 15, fontSize: 10, color: D.textSecondary, lineHeight: 1.7 }}>
                        {differing.map((a) => (
                          <li key={a.key}>
                            {TYPOLOGY_INDICATOR_LABELS[a.key] || a.key}{" "}
                            <span style={{ color: D.textMuted }}>
                              (household: {formatTypologyValue(a.key, a.household_value)},{" "}
                              cluster: {formatTypologyValue(a.key, a.cluster_mode)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div style={{ fontSize: 10.5, color: D.success, fontWeight: 600, marginBottom: 6 }}>
                      Matches the cluster mode on every indicator.
                    </div>
                  );
                })()}
                <div style={{ fontSize: 9.5, color: D.textMuted, fontStyle: "italic", lineHeight: 1.5 }}>
                  Based on all {clusterMatch.total_indicators} attributes, not just the differences above.
                  Compared against {clusterMatch.cluster_size} household{clusterMatch.cluster_size === 1 ? "" : "s"} in Cluster {clusterMatch.cluster_id}.
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}