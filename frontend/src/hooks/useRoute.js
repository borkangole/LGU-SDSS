// Keeps the current page and its main view in the address (after the #), so
// refreshing returns to exactly the same place and the browser's Back /
// Forward buttons move between pages.
//
//   #/vulnerability?brgy=Brgy%20Sto%20Angel
//   #/map?view=hazard
//   #/reports?report=custom
//
// Only plain view choices are stored here (page, barangay, report tab, map
// view, attribute, household search) -- never names of residents.
import { useEffect, useRef, useState } from "react";

export const PAGES = ["dashboard", "households", "map", "vulnerability", "attributes", "network",
  "planning", "reports", "nlp-query", "about"];

export function readRoute() {
  const raw = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const page = PAGES.includes(path) ? path : null;
  return { page, params: new URLSearchParams(qs) };
}

const build = (page, params) => {
  const qs = params.toString();
  return `#/${page || ""}${qs ? `?${qs}` : ""}`;
};

// A new page: adds a history entry (so Back works) and drops the old page's view.
export function pushPage(page, params = {}) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") p.set(k, v); });
  const url = build(page, p);
  if (url !== window.location.hash) window.history.pushState(null, "", url);
}

export function getParam(key) {
  return readRoute().params.get(key);
}

// Same page, different view: replaces the entry (no extra Back steps).
export function setParam(key, value) {
  const { page, params } = readRoute();
  if (!page) return;
  if (value == null || value === "") params.delete(key); else params.set(key, String(value));
  const url = build(page, params);
  if (url !== window.location.hash) window.history.replaceState(null, "", url);
}

// useState that is also kept in the address. `initial` (e.g. from Omni
// Search) wins over the address, which wins over the default.
export function useUrlParam(key, def, initial) {
  const [v, setV] = useState(() => initial ?? getParam(key) ?? def);
  const first = useRef(true);
  useEffect(() => {
    if (first.current && v === def && getParam(key) == null) { first.current = false; return; }
    first.current = false;
    setParam(key, v === def ? null : v);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, setV];
}

const PREF_KEY = "lgu_default_page";
export function getDefaultPage() {
  try { const p = localStorage.getItem(PREF_KEY); return PAGES.includes(p) ? p : "dashboard"; } catch { return "dashboard"; }
}
export function setDefaultPage(page) {
  try { localStorage.setItem(PREF_KEY, page); } catch { /* storage blocked: keep the default */ }
}
