// Recommended actions for the Planning panel, one list per domain.
//
// Every recommendation is triggered by this barangay's OWN numbers in that
// ONE domain (never by another domain, never by a combined score), and each
// one shows the number that triggered it so a planner can check it.
//
//   SVI       -> an indicator where the barangay is in the top third of the
//                24 barangays (rank 1-8), plus distance to the RHU / fire
//                station when half or more of its households are beyond 2 km.
//   Capacity  -> each resource or readiness item the barangay profile says it
//                does not have, plus a general item when the capacity tier is
//                low.
//   Hazard    -> flood and landslide shares of households in mapped zones.
//
// Offices named are the usual lead offices in a municipality; the LGU can
// assign them differently.

const TOP_THIRD = 8;          // rank 1-8 of 24
const FAR_PCT = 50;           // % of households beyond 2 km
const HAZARD_SIG = 25;        // same significance line used everywhere else
const HAZARD_WATCH = 10;

const pct = (v) => `${(Number(v) * 100).toFixed(0)}%`;
const n0 = (v) => Number(v) || 0;

// What each SVI indicator means and what to do about it.
const SVI_ACTIONS = {
  food_insecure_prop: {
    title: "Target food assistance",
    text: "Include the barangay in supplementary feeding and food-pack distribution, and support backyard or community gardens.",
    office: "MSWDO", base: "of households worried about food",
  },
  overcrowding_prop: {
    title: "Address overcrowding",
    text: "Refer crowded households to housing assistance and include them in the local shelter plan.",
    office: "MPDO", base: "of households overcrowded",
  },
  weak_roof_prop: {
    title: "Repair weak roofs before typhoon season",
    text: "Prioritize these households for shelter-repair materials and roof tie-down or retrofitting.",
    office: "MSWDO · MDRRMO", base: "of households with weak roofs",
  },
  weak_wall_prop: {
    title: "Strengthen weak walls",
    text: "Prioritize these households for shelter-repair assistance and pre-emptive evacuation during strong typhoons.",
    office: "MSWDO · MDRRMO", base: "of households with weak walls",
  },
  insecure_tenure_prop: {
    title: "Help secure land tenure",
    text: "Assist households without secure tenure with documents and flag them for the local housing program.",
    office: "MPDO", base: "of households with insecure tenure",
  },
  unimproved_sanitation_prop: {
    title: "Improve sanitation",
    text: "Prioritize for sanitary-toilet assistance and hygiene (WASH) education.",
    office: "RHU", base: "of households with unimproved toilets",
  },
  no_internet_prop: {
    title: "Send warnings offline too",
    text: "Deliver alerts by SMS, radio, sirens and barangay tanods, not only online.",
    office: "MDRRMO · Barangay", base: "of households without internet",
  },
  low_adult_education_prop: {
    title: "Use plain-language briefings",
    text: "Explain warnings and programs face to face in simple terms, and refer adults to the Alternative Learning System.",
    office: "Barangay · DepEd ALS", base: "of adults 25+ with little or no schooling",
  },
  pwd_prop: {
    title: "Plan assisted evacuation for PWDs",
    text: "Update the PWD list, assign evacuation helpers, and check PWD ID coverage.",
    office: "MSWDO", base: "of residents are PWDs",
  },
  senior_prop: {
    title: "Prioritize senior citizens",
    text: "Update the senior list for priority evacuation, regular health checks and social pension coverage.",
    office: "MSWDO · OSCA", base: "of residents are seniors",
  },
  solo_parent_prop: {
    title: "Support solo parents",
    text: "Check Solo Parent ID coverage and link families to benefits under the Expanded Solo Parents Welfare Act.",
    office: "MSWDO", base: "of residents are solo parents",
  },
};

function rankAmong(all, key, value) {
  const vals = all.map((x) => x.social_indicators?.[key]).filter((v) => v != null);
  if (value == null || !vals.length) return null;
  return 1 + vals.filter((v) => v > value).length;
}

export function sviRecommendations(b, all) {
  const recs = [];
  Object.entries(b.social_indicators || {}).forEach(([key, value]) => {
    const meta = SVI_ACTIONS[key];
    if (!meta || value == null) return;
    const rank = rankAmong(all, key, value);
    if (rank != null && rank <= TOP_THIRD && value > 0) {
      recs.push({ ...meta, reason: `${pct(value)} ${meta.base} · rank ${rank} of 24`, sort: rank });
    }
  });
  if (n0(b.rhu_pct_beyond) >= FAR_PCT) recs.push({
    title: "Bring health services closer",
    text: "Schedule mobile clinics or barangay health station visits for households far from the RHU.",
    office: "RHU", reason: `${n0(b.rhu_pct_beyond).toFixed(0)}% of households beyond 2 km of the RHU`, sort: 0,
  });
  if (n0(b.fire_pct_beyond) >= FAR_PCT) recs.push({
    title: "Strengthen fire readiness",
    text: "Pre-position fire extinguishers and agree on response routes with the fire station.",
    office: "BFP · MDRRMO", reason: `${n0(b.fire_pct_beyond).toFixed(0)}% of households beyond 2 km of the fire station`, sort: 0,
  });
  recs.sort((a, c) => a.sort - c.sort);
  if (!recs.length) recs.push({
    title: "Keep regular social programs",
    text: "No social indicator is in the top third of the municipality. Keep the barangay in regular MSWDO programs and recheck after the next CBMS update.",
    office: "MSWDO", reason: "No indicator ranks 1–8 of 24",
  });
  return recs;
}

const CAP_OFFICE = {
  no_drrm_plan: "BDRRMC · MDRRMO", no_hotline: "Barangay", no_response_team: "BDRRMC",
  no_evacuation_map: "BDRRMC · MDRRMO", no_hazard_map: "MDRRMO · MPDO", no_seminar: "MDRRMO",
  no_ambulance: "MDRRMO · RHU", no_first_aid: "BDRRMC · RHU", no_radio: "MDRRMO",
  no_generator: "MDRRMO", no_lights: "BDRRMC", no_drrm_budget: "Barangay Council",
};

export function capacityRecommendations(b, items, capBad) {
  const missing = items.filter((g) => b[g.key]);
  const recs = missing.map((g) => ({
    title: g.action.charAt(0).toUpperCase() + g.action.slice(1),
    office: CAP_OFFICE[g.key] || "MDRRMO",
    reason: "Not in the barangay profile",
  }));
  if (n0(b.evac_centers_count) === 0) recs.push({
    title: "Identify an evacuation centre",
    text: "No evacuation centre is listed for the barangay. Agree on a safe building and its capacity before the rainy season.",
    office: "BDRRMC · MDRRMO", reason: "0 evacuation centres listed",
  });
  if (capBad) recs.unshift({
    title: "Prioritize in the DRRM investment plan",
    text: "Capacity ranks in the lower half of the municipality. Include this barangay's gaps in the next municipal DRRM fund allocation.",
    office: "MDRRMO · MPDO", reason: `Capacity rank ${b.capacity_rank ?? "—"} of 24`,
  });
  if (!recs.length) recs.push({
    title: "Keep resources ready",
    text: "All scored resources are in place. Inventory and test radios, generators and lights before typhoon season, and hold a yearly drill.",
    office: "BDRRMC", reason: "No gaps recorded",
  });
  return recs;
}

export function hazardRecommendations(b) {
  const flood = n0(b.flood_pct), slide = n0(b.landslide_pct);
  const fhh = n0(b.flood_hh), lhh = n0(b.landslide_hh);
  const recs = [];
  if (flood >= HAZARD_SIG) recs.push({
    title: "Plan pre-emptive evacuation for flood zones",
    text: "Set the rainfall or river-level trigger, the routes and the evacuation site for households in high-flood zones.",
    office: "MDRRMO · BDRRMC", reason: `${flood.toFixed(1)}% of households (${fhh.toLocaleString()}) in high or very high flood zones`,
  });
  if (flood >= HAZARD_WATCH) recs.push({
    title: "Set up a community flood warning",
    text: "Assign river and rain watchers and agree on siren or bell signals so warnings reach every exposed household.",
    office: "BDRRMC", reason: `${flood.toFixed(1)}% flood-exposed`,
  });
  if (fhh > 0) recs.push({
    title: "Check exposed households first",
    text: "Use the Hazard Watch List on the Map page: visit flood-exposed homes with seniors, PWDs or young children first.",
    office: "Barangay · MSWDO", reason: `${fhh.toLocaleString()} flood-exposed households`,
  });
  if (slide >= HAZARD_SIG) recs.push({
    title: "Assess landslide-prone households for relocation",
    text: "Have slopes inspected and evacuate pre-emptively when heavy rain is forecast; consider relocation for the most exposed homes.",
    office: "MDRRMO · MPDO", reason: `${slide.toFixed(1)}% of households (${lhh.toLocaleString()}) in moderate or high landslide zones`,
  });
  else if (lhh > 0) recs.push({
    title: "Watch slopes after heavy rain",
    text: "Check for cracks and soil movement near exposed homes after continuous rain, and evacuate early if found.",
    office: "BDRRMC", reason: `${lhh.toLocaleString()} landslide-exposed households`,
  });
  if (flood >= HAZARD_WATCH || slide >= HAZARD_WATCH) recs.push({
    title: "Avoid new building in hazard zones",
    text: "Reflect the mapped flood and landslide zones in zoning and building permits so exposure does not grow.",
    office: "MPDO", reason: `${flood.toFixed(1)}% flood · ${slide.toFixed(1)}% landslide (10% or more)`,
  });
  if (!recs.length) recs.push({
    title: "Maintain routine hazard monitoring",
    text: "No households fall in mapped high-hazard zones. Areas outside the hazard maps are not assessed, so keep watching local conditions.",
    office: "MDRRMO", reason: `${flood.toFixed(1)}% flood · ${slide.toFixed(1)}% landslide`,
  });
  return recs;
}
