// Household typology explainer (panel compliance item 2: "each type tied to
// its defining factors and reference").
//
// WRITERS: the `reference` text of each type below is the only part meant to
// be edited by hand. It is shown word for word in the system. Defining
// factors are the shares of each group's households that have the condition,
// from the CBMS 2024 import (7,249 households, k-modes k = 5).
import { useState } from "react";
import { TYPOLOGY_COLORS, TYPOLOGY_LABELS } from "./domainColors";

export const TYPOLOGY_METHOD_NOTE =
  "Households are grouped by k-modes clustering (Huang, 1998) of 13 CBMS indicators; k = 5 was the most stable grouping. " +
  "A profile describes the kind of need, not a score.";

export const TYPOLOGY_INFO = {
  1: {
    summary: "Few of the 13 conditions; the most secure households and the reference group.",
    factors: ["Typical pattern: none of the 13 conditions", "Food insecure: 0%", "Weak walls: 9%", "No bank / formal account: 18%"],
    avgConditions: 1.19,
    reference: "Serves as the non-deprived reference group, as in typologies of vulnerability that separate a non-vulnerable class (Whelan & Maître, 2004).",
  },
  0: {
    summary: "Mainly food insecurity; housing, tenure and sanitation otherwise adequate.",
    factors: ["Food insecure: 100%", "Weak walls: 19%", "No bank / formal account: 25%", "Insecure tenure, unimproved toilet: about 0%"],
    avgConditions: 2.01,
    reference: "Food insecurity measured by worry about not having enough food, the first item of FAO's Food Insecurity Experience Scale (FAO); 58% of Filipino households are food insecure to some degree (Semeniano et al., 2025).",
  },
  2: {
    summary: "Households with older members and low adult education.",
    factors: ["Has a senior member: 90%", "Low adult education: 85%", "Food insecure: 84%", "No bank / formal account: 80%"],
    avgConditions: 4.37,
    reference: "Older Filipinos have relatively low education (Abalos, 2020); elderly-headed households form a distinct poverty group (Mapa et al., 2011), and older household heads have higher odds of food insecurity (Semeniano et al., 2025).",
  },
  3: {
    summary: "No formal financial account and weak housing structure.",
    factors: ["No bank / formal account: 100%", "Weak (light or salvaged) walls: 100%", "Food insecure: 73%"],
    avgConditions: 3.66,
    reference: "Financial exclusion limits saving, credit and insurance when shocks hit (Demirgüç-Kunt et al., 2022); 44% of Filipino adults had no account in 2021 (BSP Financial Inclusion Survey). A non-durable dwelling is one of the five deprivations of inadequate housing under SDG indicator 11.1.1 (UN Statistics Division).",
  },
  4: {
    summary: "Large, food-insecure households where deprivations reinforce each other.",
    factors: ["Large household (6+ members): 100%", "Food insecure: 100%", "Overcrowded: 16% (highest of the five)"],
    avgConditions: 3.31,
    reference: "Larger family size raises poverty and vulnerability in the Philippines (Orbeta, 2005), and larger households have higher odds of food insecurity (Semeniano et al., 2025); overlapping deprivations follow Alkire & Foster (2011).",
  },
};

/**
 * One type's explainer. `share` (0-100) and `households` come from the page
 * that shows it, so they always match the data on screen.
 */
export function TypologyInfoCard({ clusterId, share, households, D, compact = false }) {
  const info = TYPOLOGY_INFO[clusterId];
  if (!info) return null;
  const color = TYPOLOGY_COLORS[clusterId];
  const muted = D?.textMuted || "#6b7280", body = D?.textBody || "#333", strong = D?.textPrimary || "#1a237e";
  return (
    <div style={{ borderLeft: `3px solid ${color}`, background: color + "10", borderRadius: 8, padding: compact ? "8px 10px" : "10px 12px",
      fontSize: compact ? 11 : 12, color: body, lineHeight: 1.5, textAlign: "left" }}>
      <div style={{ fontWeight: 800, color: strong, fontSize: compact ? 11.5 : 12.5 }}>{TYPOLOGY_LABELS[clusterId]}</div>
      {(share != null || households != null) && (
        <div style={{ color: muted, marginTop: 1 }}>
          {share != null && <b style={{ color }}>{Number(share).toFixed(1)}%</b>}
          {share != null && households != null && " · "}
          {households != null && `${Number(households).toLocaleString()} households`}
          {` · avg. ${info.avgConditions.toFixed(1)} of 13 conditions`}
        </div>
      )}
      <div style={{ marginTop: 4 }}>{info.summary}</div>
      <div style={{ fontWeight: 700, color: strong, marginTop: 6, fontSize: compact ? 10.5 : 11 }}>Defining factors (share of this group)</div>
      <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
        {info.factors.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <div style={{ fontWeight: 700, color: strong, marginTop: 6, fontSize: compact ? 10.5 : 11 }}>Reference</div>
      <div style={{ color: muted }}>{info.reference}</div>
    </div>
  );
}

/** A small "i" toggle that shows TypologyInfoCard below its row. */
export function useTypologyInfoToggle() {
  const [open, setOpen] = useState(null);
  const toggle = (id) => setOpen((o) => (o === id ? null : id));
  return [open, toggle];
}

export function InfoToggleButton({ open, onClick, color, label = "About this type" }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-expanded={open} title={label} aria-label={label}
      style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "50%", border: `1px solid ${color}`, background: open ? color : "transparent",
        color: open ? "#fff" : color, fontSize: 11, fontWeight: 800, lineHeight: "16px", padding: 0, cursor: "pointer", fontFamily: "Georgia, serif" }}>
      i
    </button>
  );
}
