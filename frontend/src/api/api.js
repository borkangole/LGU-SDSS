import axios from "axios";

const BASE_URL = "http://127.0.0.1:5000/api";

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// ✅ Interceptor — automatically adds JWT token to EVERY request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ Interceptor — auto logout if token expired (401 response)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.reload(); // sends back to login page
    }
    return Promise.reject(error);
  }
);

// ── BARANGAYS ─────────────────────────────────────────────
export const getBarangays = () =>
  api.get("/barangays");

// ── HOUSEHOLDS ────────────────────────────────────────────
// ✅ FIXED — accepts params object
export const getHouseholds = (params = {}) =>
  api.get("/households", { params });

export const getHouseholdById = (id) =>
  api.get(`/households/${id}`);

export const createHousehold = (data) =>
  api.post("/households", data);

export const updateHousehold = (id, data) =>
  api.put(`/households/${id}`, data);

export const deleteHousehold = (id) =>
  api.delete(`/households/${id}`);

export const revealHouseholdUid = (id, password) =>
  api.post(`/households/${id}/reveal-uid`, { password });

// ── INDIVIDUALS ───────────────────────────────────────────
export const getMembers = (household_id) =>
  api.get(`/households/${household_id}/members`);

export const createIndividual = (household_id, data) =>
  api.post(`/households/${household_id}/members`, data);

export const updateIndividual = (person_id, data) =>
  api.put(`/individuals/${person_id}`, data);

export const deleteIndividual = (person_id) =>
  api.delete(`/individuals/${person_id}`);

// ── STATS ─────────────────────────────────────────────────
export const getStats = () =>
  api.get("/stats");

// ── GIS ───────────────────────────────────────────────────
export const getGISBarangays    = () => api.get("/gis/barangays");
// Planning report: households to look out for in one barangay, per domain
// (includes household heads' names -- logged-in staff only).
// Reports > High-Risk Households: households in high hazard zones with their
// own count of the 13 SVI conditions (no names).
export const getHighRiskHouseholds = () => api.get("/reports/high-risk-households");

export const getPlanningWatchHouseholds = (barangay, domain, limit = 60) =>
  api.get("/planning/watch-households", { params: { barangay, domain, limit } });
export const getGISHousingUnits = () => api.get("/gis/housing-units");
export const getGISRoads        = () => api.get("/gis/roads");
export const getGISFlood        = () => api.get("/gis/flood");
export const getGISLandslide    = () => api.get("/gis/landslide");
export const getHazardWatchlist = (levels) => api.get("/gis/hazard-watchlist", { params: { levels } });

// ── VULNERABILITY ─────────────────────────────────────────
export const getVulnBarangays = ()       => api.get("/vulnerability/barangays");
export const getVulnHousehold = (hh_id) => api.get(`/vulnerability/household/${hh_id}`);
// Household Similarity Network -- k-modes cluster-mates graph (networkx-computed
// similarity edges + community subgroups + spring-layout coordinates), server-side.
export const getHouseholdSimilarityNetwork = (hh_id) => api.get(`/vulnerability/household/${hh_id}/similarity-network`);
export const getVulnBarangaySummary = () => api.get("/vulnerability/barangay-summary");
// Stage 1 top-down barangay vulnerability — drives the choropleth map (all 24 barangays,
// quantile-classified). Distinct from getVulnBarangaySummary (naive bottom-up rollup).
export const getVulnBarangayStage1 = () => api.get("/vulnerability/barangay-stage1");
// Live per-indicator breakdown for one barangay's Stage 1 classification —
// powers the Map View "How was this calculated?" panel.
export const getVulnBarangayStage1Explain = (barangayId) =>
  api.get(`/vulnerability/barangay-stage1/${barangayId}/explain`);
export const getVulnComponentBreakdown = () => 
  api.get("/vulnerability/component-breakdown");

export const getVulnExplain = (hh_id) =>
  api.get(`/vulnerability/household/${hh_id}/explain`);

// ✅ ADD THESE TWO FUNCTIONS
export const getHouseholdDistribution = () =>
  api.get("/vulnerability/household-distribution");

// ── DOMAIN VULNERABILITY (Sir Shem's two-domain model) ─────
// Social Vulnerability Index + Operational Capacity + real hazard
// exposure, read from data/domain_pipeline_results/*.csv (regenerated
// by running `python run_domain_pipeline.py` from backend/). Separate
// from the legacy single-BVI /vulnerability/* endpoints above.
export const getDomainBarangays = () =>
  api.get("/domain-vulnerability/barangays");

export const getDomainBarangayExplain = (psgc10d) =>
  api.get(`/domain-vulnerability/barangays/${psgc10d}/explain`);

// Sir Shem's suggestion: constrained Gemini-API explainer, on-demand only
// (called from a button, not automatically) -- mode must be "svi" or
// "capacity" and should match whichever view the modal is open in, so the
// AI narrative only ever discusses one domain's numbers.
export const getDomainBarangayAiExplain = (psgc10d, mode) =>
  api.get(`/domain-vulnerability/barangays/${psgc10d}/ai-explain`, { params: { mode } });

export const getDomainMeta = () =>
  api.get("/domain-vulnerability/meta");

// Sir Shem's second suggestion: NLP-to-DB constrained query layer.
// Plain-English question in, {columns, data, chart, explanation, sql,
// warnings} out -- never a free chat, one question/answer per call.
export const askNlpQuery = (question) =>
  api.post("/nlp-query/ask", { question });

export const getNlpQueryExamples = () =>
  api.get("/nlp-query/examples");

// Accuracy check: list of questions with known answers, then run one at a time.
export const getNlpAccuracyItems = () =>
  api.get("/nlp-query/accuracy-check");
export const runNlpAccuracyItem = (index) =>
  api.post(`/nlp-query/accuracy-check/${index}`, {}, { timeout: 120000 });

// Barangay-level household-typology breakdown (k=5 k-modes clusters).
// Percentages only -- see getDomainTypologyHousehold() below for the
// per-household assignment. Cluster labels returned are
// provisional/best-fit, not yet confirmed by Sir Shem -- see the "note"
// field on the response.
export const getDomainTypologyBarangay = () =>
  api.get("/domain-vulnerability/typology-barangay");

// Household-level typology assignment: one row per real household (its
// actual CBMS-geotagged coordinate) plus its own cluster_id/label --
// matches Sir Shem's own cluster_households() output and his demo's
// household dot map. Same provisional k=5 labels as the barangay version.
export const getDomainTypologyHousehold = () =>
  api.get("/domain-vulnerability/typology-household");

// RHU/Fire Station facility distance only (Sir Shem's
// calculate_facility_capacity_2km()): real straight-line distance, 2km
// threshold, percentile-ranked into facility_access_score/
// facility_access_rank. NOT the full Domain B, View 2 score -- these are 2
// of its 6 indicators, kept here as their own lightweight overlay for the
// Hazard map. See getDomainCapacityDistance() below for the complete
// 6-indicator View 2 score. See backend/facility_access_score.py.
export const getDomainFacilityAccess = () =>
  api.get("/domain-vulnerability/facility-access");

// Domain B, View 2 -- "Institutional Capacity + Facility Distance", the
// slide's actual 6-indicator score (4 institutional flags + the 2 RHU/Fire
// distance proportions above, percentile-ranked and summed). This is what
// the map's "Capacity + Distance" view shows -- a different construct from
// capacity_score (Operational Capacity, still used elsewhere in the app,
// e.g. the household popup and dashboard card) and from facility_access
// above (distance only). See backend/capacity_distance_score.py.
// Barangay Capacity (resources and readiness): resource score + the items
// listed beside it (DRRM plan, evacuation/hazard map, evacuation centres, schools).
export const getDomainCapacity = () =>
  api.get("/domain-vulnerability/capacity");

export const getDomainCapacityDistance = () =>
  api.get("/domain-vulnerability/capacity-distance");

// ── POPULATION / ATTRIBUTES ──────────────────────────────
export const getPopulationSummary = () => api.get("/population/summary");
export const getAttributes = () => api.get("/population/attributes");
export const getCustomOptions = () => api.get("/population/custom-options");
export const postCustomCount = (body) => api.post("/population/custom-count", body);
export const postCustomList = (body) => api.post("/population/custom-list", body);
export const getTypologyReference = () => api.get("/population/typology-reference");

// ── NETWORK ───────────────────────────────────────────────
export const getNetworkHouseholds = (params = {}) =>
  api.get("/network/households", { params });

// familyId is optional -- omit it for a single-family household; pass it
// to scope the tree to one nuclear family within a multi-family household
// (see NetworkAnalysis.jsx's duplicated per-family list rows).
export const getNetworkGraph = (householdId, familyId) =>
  api.get(`/network/households/${householdId}/graph`, {
    params: familyId != null ? { family_id: familyId } : {},
  });

// networkx structural analysis of one household's family network
// (dependents -> nearest working-age adult, caregiver load, key connectors,
// structure metrics). Feeds the Network page's PDF report and Excel export.
export const getNetworkAnalysis = (householdId) =>
  api.get(`/network/households/${householdId}/analysis`);

export const globalSearch = (query) =>
  api.get("/search", { params: { q: query } });
// ── SETTINGS ──────────────────────────────────────────────
export const getPovertyThreshold = () =>
  api.get("/settings/poverty-threshold");

export const updatePovertyThreshold = (value) =>
  api.put("/settings/poverty-threshold", { threshold: value });
// ── CBMS 2024 IMPORT (the 7 files) ────────────────────────
export const cbmsImportPreview = (formData) =>
  api.post("/import/cbms/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 300000,
  });
export const cbmsImportCommit = (token, removeMissing = true) =>
  api.post("/import/cbms/commit", { token, remove_missing: removeMissing });
export const cbmsImportStatus = (jobId) =>
  api.get(`/import/cbms/status/${jobId}`);

// ── MANUAL "ADD HOUSEHOLD" (CBMS questionnaire codes) ─────
export const getHouseholdFormOptions = () => api.get("/households/form-options");
export const createHouseholdManual = (payload) => api.post("/households/manual", payload);
export const deleteHouseholdNoRecalc = (id) => api.delete(`/households/${id}?recalc=0`);
export const recalculateAll = () => api.post("/households/recalculate");

// Households on file, whether scores exist, and the running import (if any).
export const getDataStatus = () => api.get("/import/cbms/data-status");
// CBMS import batches (recorded by every 7-file import; delete removes the
// households that batch added, or resets the system if none are left).
export const getImportBatches = () => api.get("/import/cbms/batches");
export const getImportBatchDetail = (id) => api.get(`/import/cbms/batches/${id}`);
export const deleteImportBatch = (id) => api.delete(`/import/cbms/batches/${id}`, { timeout: 600000 });
