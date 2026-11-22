import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import axios from "axios";
import CbmsImport from "./CbmsImport";

// ─────────────────────────────────────────────────────────────────────────────
// SVG ICONS — no emojis
// ─────────────────────────────────────────────────────────────────────────────
const IcoUpload   = () => <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const IcoCheck    = ({ size=14, color="#2e7d32" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcoWarn     = ({ size=14, color="#f57f17" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IcoX        = ({ size=14, color="#c62828" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcoSkip     = ({ size=14, color="#9e9e9e" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>;
const IcoWrench   = ({ size=14, color="#1565c0" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
const IcoFile     = ({ size=32, color="#1565c0" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
const IcoLoader   = () => <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" style={{animation:"spin 1s linear infinite", transformOrigin:"center", display:"block"}}/><style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style></svg>;
const IcoSuccess  = ({ size=40 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
const IcoAlert    = ({ size=40 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f57f17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const IcoArrow    = ({ dir="left" }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{dir==="left"?<><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>:<><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>}</svg>;
const IcoDatabase = ({ size=11, color="#1565c0" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
const IcoUser     = ({ size=11, color="#6b7590" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;

// ─────────────────────────────────────────────────────────────────────────────
// DATA CLEANING ENGINE — 5-Algorithm Pipeline (mirrors Python ALGO.py)
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve a mapped DB field back to the raw CSV column key */
function getCol(fieldToCol, field) {
  return fieldToCol[field] ?? null;
}
/**
 * Runs all 5 cleaning algorithms against the raw rows array.
 * Returns { cleanedRows, report } where report is an array of
 * { algoId, title, fixes: [{ row, field, before, after, rule }] }
 */
function runCleaningPipeline(rows, mapping) {
  // Build fieldToCol lookup  { dbField -> csvColumnName }
  const fieldToCol = {};
  Object.entries(mapping).forEach(([csvCol, { dbField }]) => {
    if (dbField) fieldToCol[dbField] = csvCol;
  });

  // Deep-clone rows so we never mutate originals
  let data = rows.map(r => ({ ...r }));

  const report = [];

  // ── Algorithm 1: Schema Alignment & Value Standardization ────────────────
  // Checks required fields are mapped, injects null placeholders for missing
  // columns, AND normalizes categorical field values to match DB VALID_ lists.
  const REQUIRED_FIELDS = [
    "barangay_name","household_number","relationship_to_hh","gender","age",
    "civil_status","occupation","educational_attainment","monthly_income",
    "is_senior","is_pwd","is_solo_parent","is_4ps","water_source",
    "has_electricity","toilet_type","housing_material","tenure_status",
  ];
  const missingFields = REQUIRED_FIELDS.filter(f => !fieldToCol[f]);
  const presentFields = REQUIRED_FIELDS.filter(f =>  fieldToCol[f]);

  // Value standardization — keyword-based classifiers, not exact-string
  // lookups. Real CBMS survey answers are full free-text sentences
  // ("Own house, rent-free lot with consent of owner", "Piped into
  // yard/plot", "Flush to pit latrine") that will basically never match a
  // short exact key. Each classifier below returns one of the ACTUAL valid
  // enum values from backend/validators/mdm_validator.py — checked directly
  // against that file, not guessed — and falls back to "Others" (a valid
  // value in every one of these enums) rather than passing through raw text
  // that the backend would just reject anyway.
  const classifyWaterSource = (raw) => {
    const s = raw.toLowerCase();
    if (!s || s === "not stated" || s === "n/a" || s === "none") return "Not Stated";
    if (s.includes("bottled")) return "Bottled Water";
    if (s.includes("rain")) return "Rain";
    if (s.includes("river")) return "River";
    if (s.includes("spring")) return "Spring";
    if (s.includes("open well")) return "Open Well";
    if (s.includes("well") || s.includes("pump")) return "Level 1";
    if (s.includes("communal") || s.includes("shared") || s.includes("faucet")) return "Level 2";
    if (s.includes("pipe")) return "Level 3"; // covers "piped water", "piped into yard/plot", etc.
    if (["level 1","level i"].includes(s)) return "Level 1";
    if (["level 2","level ii"].includes(s)) return "Level 2";
    if (["level 3","level iii"].includes(s)) return "Level 3";
    return "Others";
  };

  const classifyToiletType = (raw) => {
    const s = raw.toLowerCase();
    if (!s || s === "not stated" || s === "n/a") return "Not Stated";
    if (s.includes("no facility") || s.includes("no toilet")) return "No Facility/field";
    if (s.includes("open defecation") || (s.includes("none") && !s.includes("no facility"))) return "None/Open Defecation";
    if (s.includes("communal")) return "Communal (Shared)";
    if (s.includes("public")) return "Public Toilet";
    if (s.includes("shared toilet")) return "Shared Toilet";
    if (s.includes("share")) return "Share";
    if (s.includes("septic")) return "Water Sealed - Septic Tank";
    const hasFlush = s.includes("flush") || s.includes("water seal");
    const hasBuhos = s.includes("buhos");
    const hasOpenPit = s.includes("open pit");
    const hasClosedOrPitLatrine = s.includes("closed pit") || s.includes("pit latrine") || s.includes("pit toilet") || (s.includes("pit") && !hasOpenPit);
    if (hasFlush && hasOpenPit) return "Water Sealed(FLUSH), Open Pit";
    if (hasFlush && hasClosedOrPitLatrine) return "Water Sealed(FLUSH) , Closed Pit";
    if (hasBuhos && hasOpenPit) return "Water Sealed(Buhos), Open Pit";
    if (hasBuhos && hasClosedOrPitLatrine) return "Water Sealed(Buhos), Closed Pit";
    if (hasOpenPit) return "Open Pit";
    if (hasClosedOrPitLatrine) return "Closed Pit";
    return "Others";
  };

  const classifyHousingMaterial = (raw) => {
    const s = raw.toLowerCase();
    if (!s || s === "not stated" || s === "n/a") return "Not Stated";
    if (s.includes("semi") && s.includes("concrete")) return "Concrete/Wood";
    if (s.includes("full concrete") || s === "concrete") return "Full Concrete";
    if (s.includes("concrete") && (s.includes("wood") || s.includes("bamboo"))) return "Concrete/Wood";
    if (s.includes("concrete")) return "Full Concrete";
    if (s.includes("light material")) return "Light Material";
    if (s.includes("mixed material")) return "Mixed Material";
    if (s.includes("wood") || s.includes("bamboo")) return "Wood/Bamboo";
    return "Others";
  };

  const classifyTenureStatus = (raw) => {
    const s = raw.toLowerCase();
    if (!s || s === "not stated" || s === "n/a") return "Not Stated";
    if (s.includes("informal")) return "Informal Settler";
    if (s.includes("amortiz")) return "Being Amortized";
    if (s.includes("lease")) return "Rented/Lease";
    // Check consent-of-owner phrasing BEFORE generic "own"/"rent" keywords —
    // this is the exact case that was wrong before: real answers like "Own
    // house, rent-free lot with consent of owner" mention both "own" and
    // "consent", and the tenure status being tracked here is about the
    // LAND/lot, not the structure, so "consent of owner" should win.
    if (s.includes("without consent") || s.includes("no consent")) return "Being occupied without consent of owner";
    if (s.includes("consent") && s.includes("owner")) return "Being occupied with consent of owner";
    if (s.includes("rent-free") || s.includes("rent free")) return "Being occupied for free";
    if (s.includes("rent") || s.includes("renter")) return "Rented";
    if (s.includes("own")) return "Owned";
    return "Others";
  };

  // civil_status — built from the actual VALID_CIVIL_STATUS enum in
  // mdm_validator.py: ['Single','Married','Widowed','Divorced','Separated',
  // 'Live-in','Not Stated']. Real CBMS answers are phrases like "Single/never
  // married" or "Widow/er" — these previously passed through completely raw
  // (the only existing handling was an age<18-only "force to Single" rule),
  // so any adult with a phrase-style answer failed backend validation.
  // NOTE: "single" is checked before "married" deliberately — "Single/never
  // married" contains the substring "married" too, so checking married first
  // would misclassify it.
  const classifyCivilStatus = (raw) => {
    const s = raw.toLowerCase();
    if (!s || s === "not stated" || s === "n/a") return "Not Stated";
    if (s.includes("widow")) return "Widowed";
    if (s.includes("divorc")) return "Divorced";
    if (s.includes("separat")) return "Separated";
    if (s.includes("live-in") || s.includes("live in") || s.includes("cohabit")) return "Live-in";
    if (s.includes("single") || s.includes("never married") || s.includes("unmarried")) return "Single";
    if (s.includes("married")) return "Married";
    return "Not Stated"; // no "Others" option exists in this enum — Not Stated is the safe fallback
  };

  const A1_FIELDS = [
    { dbField: "water_source",     classify: classifyWaterSource,     label: "Water source"     },
    { dbField: "toilet_type",      classify: classifyToiletType,      label: "Toilet type"      },
    { dbField: "housing_material", classify: classifyHousingMaterial, label: "Housing material" },
    { dbField: "tenure_status",    classify: classifyTenureStatus,    label: "Tenure status"    },
    { dbField: "civil_status",     classify: classifyCivilStatus,     label: "Civil status"     },
  ];

  const algo1Fixes = [
    ...missingFields.map(f => ({
      row: "all", field: f, before: "—", after: "null (placeholder)",
      rule: "Missing from CSV — will import as null",
    })),
  ];

  // Run value standardization on every row
  data.forEach((row, idx) => {
    A1_FIELDS.forEach(({ dbField, classify, label }) => {
      const col = getCol(fieldToCol, dbField);
      if (!col || !row[col] || row[col] === "") return;
      const raw = row[col].toString().trim();
      const normalized = classify(raw);
      if (normalized && normalized !== raw) {
        algo1Fixes.push({
          row: idx + 1, field: dbField,
          before: raw, after: normalized,
          rule: normalized === "Others"
            ? `${label}: no confident match for this value — defaulted to "Others", review recommended`
            : `${label} value standardized to match DB enum`,
        });
        row[col] = normalized;
      }
    });
  });


  report.push({
    algoId: 1,
    title: "Schema Alignment & Standardization",
    description: "Verifies all required DB fields are mapped, injects null placeholders for unmapped columns, and standardizes categorical values (water source, toilet type, housing material, tenure status) to match database enumerations.",
    fixes: algo1Fixes,
    summary: `${presentFields.length} fields mapped · ${missingFields.length} null-padded · ${algo1Fixes.filter(f=>f.row!=="all").length} values standardized`,
    severity: missingFields.length > 0 ? "warn" : algo1Fixes.length > 0 ? "fixed" : "ok",
  });

  // ── Algorithm 2: Demographic Cross-Validation ───────────────────────────
  const algo2Fixes = [];
  const ageCol        = getCol(fieldToCol, "age");
  const civilCol      = getCol(fieldToCol, "civil_status");
  const seniorCol     = getCol(fieldToCol, "is_senior");

  data.forEach((row, idx) => {
    const rawAge = row[ageCol];
    const ageNum = parseFloat(rawAge);

    // Coerce non-numeric age
    if (rawAge !== undefined && rawAge !== "" && isNaN(ageNum)) {
      algo2Fixes.push({ row: idx + 1, field: "age", before: rawAge, after: "null", rule: "Non-numeric age → null" });
      if (ageCol) row[ageCol] = "";
    }

    const age = isNaN(ageNum) ? null : ageNum;

    // Implausible age (>100 or ≤0)
    if (age !== null && (age > 100 || age < 0)) {
      algo2Fixes.push({ row: idx + 1, field: "age", before: age, after: "null", rule: "Implausible age (>100 or <0) → null" });
      if (ageCol) row[ageCol] = "";
    }

    const validAge = age !== null && age > 0 && age <= 100 ? age : null;

    // Recompute Senior Citizen
    if (seniorCol) {
      const expectedSenior = validAge !== null ? (validAge >= 60 ? "1" : "0") : "0";
      const rawSenior = String(row[seniorCol] ?? "0").trim();
      const normSenior = rawSenior === "1" || rawSenior === "true" || rawSenior === "yes" ? "1" : "0";
      if (normSenior !== expectedSenior) {
        algo2Fixes.push({ row: idx + 1, field: "is_senior", before: rawSenior, after: expectedSenior, rule: "Senior Citizen re-synced from Age" });
        row[seniorCol] = expectedSenior;
      }
    }

    // Minor civil status fix
    if (civilCol && validAge !== null && validAge < 18) {
      const civil = String(row[civilCol] ?? "").toLowerCase().trim();
      if (civil && civil !== "single") {
        algo2Fixes.push({ row: idx + 1, field: "civil_status", before: row[civilCol], after: "Single", rule: "Minor (<18) non-single status → Single" });
        row[civilCol] = "Single";
      }
    }
  });
  report.push({
    algoId: 2,
    title: "Demographic Cross-Validation",
    description: "Coerces Age to numeric, flags implausible ages, re-syncs Senior Citizen flag, resets married/non-single minors to Single.",
    fixes: algo2Fixes,
    summary: `${algo2Fixes.length} demographic inconsistencies corrected`,
    severity: algo2Fixes.length > 0 ? "fixed" : "ok",
  });

  // ── Algorithm 3: Occupational Integrity ────────────────────────────────
  const algo3Fixes = [];
  const occCol    = getCol(fieldToCol, "occupation");
  const incomeCol = getCol(fieldToCol, "monthly_income");

  data.forEach((row, idx) => {
    const age = parseFloat(row[ageCol]);
    const validAge = isNaN(age) ? null : age;

    // Remove occupation for confirmed under-15s only (ILO standard)
    // Unknown age (null) is NOT cleared — thesis targets confirmed minors only
    if (occCol && row[occCol] && row[occCol] !== "") {
      if (validAge !== null && validAge < 15) {
        algo3Fixes.push({ row: idx + 1, field: "occupation", before: row[occCol], after: "null", rule: "Under 15 (ILO standard) — occupation cleared" });
        row[occCol] = "";
      }
    }

    // Suspicious zero income: has a job title but income = 0
    if (incomeCol && occCol && row[occCol] && row[occCol] !== "") {
      const income = parseFloat(row[incomeCol]);
      if (!isNaN(income) && income === 0) {
        algo3Fixes.push({ row: idx + 1, field: "monthly_income", before: "0", after: "null", rule: "Active occupation with ₱0 income flagged as suspicious" });
        row[incomeCol] = "";
      }
    }
  });
  report.push({
    algoId: 3,
    title: "Occupational Integrity & Role Validation",
    description: "Clears occupations for children under 15 (ILO standard). Flags suspicious ₱0 income for employed individuals.",
    fixes: algo3Fixes,
    summary: `${algo3Fixes.length} occupational artifacts removed`,
    severity: algo3Fixes.length > 0 ? "fixed" : "ok",
  });

  // ── Algorithm 4: Household Head Proxy Imputation ────────────────────────
  const algo4Fixes = [];
  const relCol  = getCol(fieldToCol, "relationship_to_hh");
  const elecCol = getCol(fieldToCol, "has_electricity");
  const fps4Col = getCol(fieldToCol, "is_4ps");
  const brgyCol = getCol(fieldToCol, "barangay_name");
  const hhNumCol= getCol(fieldToCol, "household_number");

  // Group rows by household key
  const hhGroups = {};
  data.forEach((row, idx) => {
    const key = `${row[brgyCol] ?? "?"}_${row[hhNumCol] ?? idx}`;
    if (!hhGroups[key]) hhGroups[key] = [];
    hhGroups[key].push({ row, idx });
  });

  Object.values(hhGroups).forEach(members => {
    const headEntry = members.find(({ row }) => {
      const rel = String(row[relCol] ?? "").toLowerCase().trim();
      return rel === "hh" || rel === "household head" || rel === "head";
    }) ?? members[0];
    const headRow = headEntry.row;

    const headElec = headRow[elecCol] !== undefined && headRow[elecCol] !== "" ? headRow[elecCol] : null;
    const headFps  = headRow[fps4Col]  !== undefined && headRow[fps4Col]  !== "" ? headRow[fps4Col]  : null;

    members.forEach(({ row, idx }) => {
      if (row === headRow) return;

      if (elecCol && headElec !== null && (row[elecCol] === "" || row[elecCol] === undefined)) {
        algo4Fixes.push({ row: idx + 1, field: "has_electricity", before: "—", after: headElec, rule: "Inherited from Household Head" });
        row[elecCol] = headElec;
      }
      if (fps4Col && headFps !== null && (row[fps4Col] === "" || row[fps4Col] === undefined)) {
        algo4Fixes.push({ row: idx + 1, field: "is_4ps", before: "—", after: headFps, rule: "Inherited from Household Head" });
        row[fps4Col] = headFps;
      }
    });
  });
  report.push({
    algoId: 4,
    title: "Head-of-Household Proxy Imputation",
    description: "Propagates household-level attributes (Electricity, 4Ps status) from the Household Head to all dependent members.",
    fixes: algo4Fixes,
    summary: `${algo4Fixes.length} member fields inherited from household heads`,
    severity: algo4Fixes.length > 0 ? "fixed" : "ok",
  });

  // ── Algorithm 5: Log-Transformed Min-Max Normalization ─────────────────
  // Income is a household-level attribute observed only on the HH Head.
  // Step 1 — collect HH Head incomes only and compute clean stats
  // Step 2 — apply log1p transformation
  // Step 3 — Min-Max scale to [0,1] across all households
  // Step 4 — propagate the normalized score to all household members
  const algo5Fixes = [];
  if (incomeCol) {
    // Step 1: gather HH Head income observations only
    const headIncomes = [];
    Object.values(hhGroups).forEach(members => {
      const headEntry = members.find(({ row }) => {
        const rel = String(row[relCol] ?? "").toLowerCase().trim();
        return rel === "hh" || rel === "household head" || rel === "head";
      }) ?? members[0];
      const raw = parseFloat(headEntry.row[incomeCol]);
      if (!isNaN(raw) && raw > 0) headIncomes.push({ entry: headEntry, income: raw });
    });

    // Step 2: compute outlier threshold from HH Head incomes only
    const rawVals = headIncomes.map(h => h.income);
    const mean   = rawVals.length ? rawVals.reduce((s,v)=>s+v,0)/rawVals.length : 0;
    const stdDev = rawVals.length ? Math.sqrt(rawVals.map(v=>(v-mean)**2).reduce((s,v)=>s+v,0)/rawVals.length) : 0;
    const outlierThreshold = mean + 3 * stdDev;
    // Median from clean (non-outlier) HH Head incomes for imputation
    const cleanVals = rawVals.filter(v => v <= outlierThreshold);
    const median = cleanVals.length ? [...cleanVals].sort((a,b)=>a-b)[Math.floor(cleanVals.length/2)] : 0;

    // Step 3: replace outlier incomes on HH Head rows with median
    headIncomes.forEach(({ entry, income }) => {
      if (income > outlierThreshold) {
        algo5Fixes.push({ row: entry.idx + 1, field: "monthly_income",
          before: `₱${income.toLocaleString()}`,
          after:  `₱${Math.round(median).toLocaleString()} (median sub)`,
          rule: `HH Head outlier (>3σ = ₱${Math.round(outlierThreshold).toLocaleString()}) — capped at clean median` });
        entry.row[incomeCol] = String(median);
      }
    });

    // Step 4: log1p transform then Min-Max normalize across HH Heads
    const logVals = Object.values(hhGroups).map(members => {
      const headEntry = members.find(({ row }) => {
        const rel = String(row[relCol] ?? "").toLowerCase().trim();
        return rel === "hh" || rel === "household head" || rel === "head";
      }) ?? members[0];
      const raw = parseFloat(headEntry.row[incomeCol]);
      const income = (!isNaN(raw) && raw > 0) ? raw : (median > 0 ? median : 0);
      return { members, headEntry, logVal: Math.log1p(income), rawIncome: income };
    });
    const logMin = Math.min(...logVals.map(h => h.logVal));
    const logMax = Math.max(...logVals.map(h => h.logVal));
    const logRange = logMax - logMin || 1;

    logVals.forEach(({ members, headEntry, logVal, rawIncome }) => {
      const normalized = parseFloat(((logVal - logMin) / logRange).toFixed(4));
      // Flag missing HH Head income — median used for normalization ONLY, not written to DB
      const rawHead = parseFloat(headEntry.row[incomeCol]);
      if (isNaN(rawHead) || rawHead <= 0) {
        algo5Fixes.push({ row: headEntry.idx + 1, field: "normalized_income_score",
          before: "null income",
          after:  `score=${normalized.toFixed(4)} (median ₱${Math.round(median).toLocaleString()} used for log-normalization only)`,
          rule: `Missing HH Head income — median ₱${Math.round(median).toLocaleString()} used for normalization calc only, not saved to DB` });
        // Do NOT write median to row — income stays null in DB
      }
      // Propagate normalized score to all members of this household
      members.forEach(({ row, idx }) => {
        const isHead = row === headEntry.row;
        if (!isHead) {
          algo5Fixes.push({ row: idx + 1, field: "normalized_income_score",
            before: "—",
            after:  normalized.toFixed(4),
            rule: `Propagated from HH Head (raw ₱${Math.round(rawIncome).toLocaleString()} → log1p=${Math.log1p(rawIncome).toFixed(4)} → scaled=${normalized.toFixed(4)})` });
        } else {
          algo5Fixes.push({ row: idx + 1, field: "normalized_income_score",
            before: `₱${Math.round(rawIncome).toLocaleString()}`,
            after:  normalized.toFixed(4),
            rule: `log1p(₱${Math.round(rawIncome).toLocaleString()}) = ${Math.log1p(rawIncome).toFixed(4)} → Min-Max scaled to ${normalized.toFixed(4)}` });
        }
      });
    });

    const outlierCount = algo5Fixes.filter(f => f.rule.includes('outlier')).length;
    const imputedCount = algo5Fixes.filter(f => f.rule.includes('median imputed')).length;
    const normalizedCount = logVals.length;
    report.push({
      algoId: 5,
      title: "Log-Transformed Min-Max Normalization",
      description: `Income observed on HH Head only. Clean median ₱${Math.round(median).toLocaleString()} · Outlier threshold ₱${Math.round(outlierThreshold).toLocaleString()} (μ+3σ) · log₁p range [${logMin.toFixed(3)}, ${logMax.toFixed(3)}] → scaled to [0, 1] then propagated to all members.`,
      fixes: algo5Fixes,
      summary: `${normalizedCount} households normalized · ${outlierCount} outliers capped · ${imputedCount} incomes imputed`,
      severity: algo5Fixes.length > 0 ? "fixed" : "ok",
    });
  } else {
    report.push({
      algoId: 5, title: "Log-Transformed Min-Max Normalization",
      description: "Income column not mapped — normalization skipped.",
      fixes: [], summary: "Income column not mapped", severity: "warn",
    });
  }

  return { cleanedRows: data, report };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB FIELD REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
const DB_FIELDS = {
  household_number:       { label: "Household No.",          table: "household" },
  barangay_name:          { label: "Barangay",               table: "household" },
  housing_material:       { label: "Housing Material",       table: "household" },
  tenure_status:          { label: "Tenure Status",          table: "household" },
  water_source:           { label: "Water Source",           table: "household" },
  toilet_type:            { label: "Toilet Type",            table: "household" },
  has_electricity:        { label: "Has Electricity",        table: "household" },
  surveyed_date:          { label: "Surveyed Date",          table: "household" },
  full_name:              { label: "Full Name",              table: "member" },
  relationship_to_hh:     { label: "Relationship to HH",    table: "member" },
  gender:                 { label: "Gender",                 table: "member" },
  age:                    { label: "Age",                    table: "member" },
  civil_status:           { label: "Civil Status",           table: "member" },
  occupation:             { label: "Occupation",             table: "member" },
  educational_attainment: { label: "Educational Attainment",table: "member" },
  monthly_income:         { label: "Monthly Income",         table: "member" },
  is_senior:              { label: "Senior Citizen",         table: "member" },
  is_pwd:                 { label: "PWD",                    table: "member" },
  is_solo_parent:         { label: "Solo Parent",            table: "member" },
  is_4ps:                 { label: "4Ps Beneficiary",        table: "member" },

  // ── CBMS 2024 raw indicators (added by import_cbms2024_v2.py / ALTER TABLE) ──
  // Household-level
  region_code:                  { label: "Region Code",                    table: "household" },
  province_code:                { label: "Province Code",                  table: "household" },
  city_mun_code:                { label: "City/Municipality Code",         table: "household" },
  barangay_code:                { label: "Barangay Code",                  table: "household" },
  husn:                         { label: "House Unit Serial No.",          table: "household" },
  hsn:                          { label: "Household Serial No.",           table: "household" },
  longitude:                    { label: "Longitude",                      table: "household" },
  latitude:                     { label: "Latitude",                       table: "household" },
  hh_size:                      { label: "Household Size",                 table: "household" },
  housing_roof:                 { label: "Housing Roof Material",          table: "household" },
  housing_floor:                { label: "Housing Floor Material",         table: "household" },
  o12_fuel_for_lighting:        { label: "Fuel for Lighting",              table: "household" },
  o13_fuel_for_cooking:         { label: "Fuel for Cooking",               table: "household" },
  water_service_level:          { label: "Water Service Level",            table: "household" },
  toilet_service_level:         { label: "Toilet Service Level",           table: "household" },
  household_estimated_income:   { label: "HH Estimated Income (raw)",      table: "household" },
  income_basis:                 { label: "Income Basis",                   table: "household" },
  asset_premium_pct:            { label: "Asset Premium %",                table: "household" },
  flood_exposure:               { label: "Flood Exposure",                 table: "household" },
  landslide_exposure:           { label: "Landslide Exposure",             table: "household" },
  hazard_exposure_score:        { label: "Hazard Exposure Score",          table: "household" },
  compound_hazard:              { label: "Compound Hazard",                table: "household" },
  hazard_data_status:           { label: "Hazard Data Status",             table: "household" },
  is_4ps_beneficiary:           { label: "4Ps Beneficiary (HH)",           table: "household" },
  overcrowding_status:          { label: "Overcrowding Status",            table: "household" },
  food_insecurity_score:        { label: "Food Insecurity Score",          table: "household" },
  has_formal_financial_account: { label: "Has Financial Account",          table: "household" },
  has_social_insurance:         { label: "Has Social Insurance",           table: "household" },
  knows_evacuation_location:    { label: "Knows Evacuation Location",      table: "household" },
  knows_emergency_hotline:      { label: "Knows Emergency Hotline",        table: "household" },
  pwd_count:                    { label: "PWD Count",                      table: "household" },
  senior_count:                 { label: "Senior Count",                   table: "household" },
  solo_parent_count:            { label: "Solo Parent Count",              table: "household" },
  avg_education_level_adults:   { label: "Avg Education Level (Adults)",   table: "household" },
  employed_count:               { label: "Employed Count",                 table: "household" },
  working_age_count:            { label: "Working-Age Count",              table: "household" },
  dependency_count:             { label: "Dependency Count",               table: "household" },
  dependency_ratio:             { label: "Dependency Ratio",               table: "household" },
  employment_rate_adults:       { label: "Employment Rate (Adults)",       table: "household" },

  // Member-level
  person_code:                     { label: "Person Code",                        table: "member" },
  line_number:                     { label: "Line Number",                        table: "member" },
  last_name:                       { label: "Last Name",                          table: "member" },
  first_name:                      { label: "First Name",                         table: "member" },
  suffix:                          { label: "Suffix",                             table: "member" },
  middle_name:                     { label: "Middle Name",                        table: "member" },
  birthday_month:                  { label: "Birthday Month",                     table: "member" },
  birthday_day:                    { label: "Birthday Day",                       table: "member" },
  birthday_year:                   { label: "Birthday Year",                      table: "member" },
  age_group_five_years:            { label: "Age Group (5-yr)",                   table: "member" },
  religion:                        { label: "Religion",                           table: "member" },
  nuclear_family:                  { label: "Nuclear Family",                     table: "member" },
  relation_to_nuclear_family_head: { label: "Relation to Nuclear Family Head",    table: "member" },
  with_pwd_id:                     { label: "With PWD ID",                        table: "member" },
  employment_status:               { label: "Employment Status",                  table: "member" },
  estimated_monthly_income:        { label: "Estimated Monthly Income (raw)",     table: "member" },
};

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY COLUMN MATCHER
// ─────────────────────────────────────────────────────────────────────────────
const ALIAS_MAP = {
  household_number:       ["hh_no","hhno","hh_number","household_no","householdnumber","household_number","hhnumber","hhnum"],
  barangay_name:          ["barangay","brgy","barangay_name","location","brgyname","barangayname"],
  housing_material:       ["housing_material","housingmaterial","housing_type","housingtype","house_material","housing_walls","housingwalls"],
  tenure_status:          ["tenure_status","tenurestatus","tenure","ownership_status","o09_tenure","o09tenure"],
  water_source:           ["water_source","watersource","water","water_supply"],
  toilet_type:            ["toilet_type","toilettype","toilet","sanitation"],
  has_electricity:        ["has_electricity","haselectricity","electricity","electric","power","o11_electricity","o11electricity"],
  surveyed_date:          ["surveyed_date","surveyeddate","survey_date","date_surveyed","surveydate"],
  full_name:              ["household_members","full_name","fullname","name","member_name","membername","complete_name"],
  relationship_to_hh:     ["relationship_to_hh","relationship","rel","relation","rel_to_hh","reltohead"],
  gender:                 ["gender","sex"],
  age:                    ["age","years_old"],
  civil_status:           ["civil_status","civilstatus","marital_status","maritalstatus"],
  occupation:             ["occupation","job","work","livelihood","job_title","jobtitle"],
  educational_attainment: ["educational_attainment","educational_level","educ","education","edlevel","educ_attain"],
  monthly_income:         ["estimated_family_income_monthly","monthly_income","income","family_income","monthlyincome","fam_income","estimated_income"],
  is_senior:              ["is_senior","senior","senior_citizen","issenior","elderly"],
  is_pwd:                 ["is_pwd","pwd","disability","disabled","ispwd","b10_pwd","b10pwd"],
  is_solo_parent:         ["is_solo_parent","solo_parent","soloparent","issoloparent","b05_solo_parent","b05soloparent"],
  is_4ps:                 ["is_4ps","4ps","fourps","pantawid","beneficiary","is4ps"],

  // ── CBMS 2024 raw indicators ──
  region_code:                  ["region_code","regioncode"],
  province_code:                ["province_code","provincecode"],
  city_mun_code:                ["city_mun_code","citymuncode","citymunicipalitycode"],
  barangay_code:                ["barangay_code","barangaycode","brgycode"],
  husn:                         ["husn"],
  hsn:                          ["hsn"],
  longitude:                    ["longitude","long","lng"],
  latitude:                     ["latitude","lat"],
  hh_size:                      ["hh_size","hhsize","household_size","householdsize"],
  housing_roof:                 ["housing_roof","housingroof","roof_material","roofmaterial"],
  housing_floor:                ["housing_floor","housingfloor","floor_material","floormaterial"],
  o12_fuel_for_lighting:        ["o12_fuel_for_lighting","o12fuelforlighting","fuel_for_lighting","fuelforlighting"],
  o13_fuel_for_cooking:         ["o13_fuel_for_cooking","o13fuelforcooking","fuel_for_cooking","fuelforcooking"],
  water_service_level:          ["water_service_level","waterservicelevel"],
  toilet_service_level:         ["toilet_service_level","toiletservicelevel"],
  household_estimated_income:   ["household_estimated_income","householdestimatedincome"],
  income_basis:                 ["income_basis","incomebasis"],
  asset_premium_pct:            ["asset_premium_pct","assetpremiumpct","asset_premium"],
  flood_exposure:               ["flood_exposure","floodexposure"],
  landslide_exposure:           ["landslide_exposure","landslideexposure"],
  hazard_exposure_score:        ["hazard_exposure_score","hazardexposurescore"],
  compound_hazard:              ["compound_hazard","compoundhazard"],
  hazard_data_status:           ["hazard_data_status","hazarddatastatus"],
  is_4ps_beneficiary:           ["is_4ps_beneficiary","is4psbeneficiary","4ps_beneficiary"],
  overcrowding_status:          ["overcrowding_status","overcrowdingstatus"],
  food_insecurity_score:        ["food_insecurity_score","foodinsecurityscore"],
  has_formal_financial_account: ["has_formal_financial_account","hasformalfinancialaccount","financial_account"],
  has_social_insurance:         ["has_social_insurance","hassocialinsurance","social_insurance"],
  knows_evacuation_location:    ["knows_evacuation_location","knowsevacuationlocation"],
  knows_emergency_hotline:      ["knows_emergency_hotline","knowsemergencyhotline"],
  pwd_count:                    ["pwd_count","pwdcount"],
  senior_count:                 ["senior_count","seniorcount"],
  solo_parent_count:            ["solo_parent_count","soloparentcount"],
  avg_education_level_adults:   ["avg_education_level_adults","avgeducationleveladults"],
  employed_count:               ["employed_count","employedcount"],
  working_age_count:            ["working_age_count","workingagecount"],
  dependency_count:             ["dependency_count","dependencycount"],
  dependency_ratio:             ["dependency_ratio","dependencyratio"],
  employment_rate_adults:       ["employment_rate_adults","employmentrateadults"],

  person_code:                     ["person_code","personcode"],
  line_number:                     ["line_number","linenumber"],
  last_name:                       ["a01_last_name","a01lastname","last_name","lastname","surname"],
  first_name:                      ["a01_first_name","a01firstname","first_name","firstname","givenname"],
  suffix:                          ["a01_suffix","a01suffix","suffix"],
  middle_name:                     ["a01_middle_name","a01middlename","middle_name","middlename"],
  birthday_month:                  ["a04_birthday_month","a04birthdaymonth","birthday_month","birthmonth"],
  birthday_day:                    ["a04_birthday_day","a04birthdayday","birthday_day"],
  birthday_year:                   ["a04_birthday_year","a04birthdayyear","birthday_year","birthyear"],
  age_group_five_years:            ["a05_age_group_five_years","a05agegroupfiveyears","age_group_five_years","agegroup"],
  religion:                        ["a08_religion","a08religion","religion"],
  nuclear_family:                  ["b01_nuclear_family","b01nuclearfamily","nuclear_family"],
  relation_to_nuclear_family_head: ["b02_relation_to_nuclear_family_head","b02relationtonuclearfamilyhead","relation_to_nuclear_family_head"],
  with_pwd_id:                     ["b11_with_pwd_id","b11withpwdid","with_pwd_id","pwdid"],
  employment_status:               ["e01_employment_status","e01employmentstatus","employment_status","employmentstatus"],
  estimated_monthly_income:        ["estimated_monthly_income","estimatedmonthlyincome"],
};

function normalize(str) {
  // Strip every non-alphanumeric character (any punctuation, symbols, unicode
  // dashes, parentheses, slashes, etc.) — not just a fixed set — so headers
  // like "Barangay (Name)!!" or "b10-pwd/status" normalize the same as
  // "barangay_name" / "b10_pwd_status".
  //
  // Defensive coercion: some parsed cell values come through as numbers
  // (e.g. a PSGC code column like "063041011" gets auto-typed to a JS
  // number), and calling .toLowerCase() directly on a number throws and
  // silently kills the whole import loop mid-promise. Coercing to String()
  // first makes this safe no matter what's actually in the cell — the real
  // fix is correcting the column mapping, but this prevents a bad mapping
  // from crashing the entire import instead of just producing a wrong/no match.
  return String(str ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Barangay-name-specific normalizer, used ONLY for matching a CSV's barangay
 * value against tbl_barangays.barangay_name — never for column-header
 * detection (that stays on the generic normalize() above).
 *
 * Real CBMS exports use inconsistent abbreviation conventions for the same
 * barangay — "Brgy 6", "Bgy. 6", "Barangay 6", sometimes with a trailing
 * "Pob." (Poblacion) suffix the DB copy doesn't carry (e.g. CSV "Bgy. 6
 * Pob." vs DB "Brgy 6" — same barangay, different label). Plain normalize()
 * only strips punctuation, so "bgy6pob" never equals "brgy6" and the
 * barangay lookup fails even though the two clearly refer to the same
 * barangay. This strips the common prefix/suffix conventions first, then
 * falls back to alphanumeric-only comparison for whatever's left (usually
 * just the barangay's number or core name).
 */
function normalizeBarangayName(raw) {
  let s = String(raw ?? "").toLowerCase();
  s = s.replace(/^\s*(barangay|brgy|bgy)\.?\s*/i, "");
  s = s.replace(/\s*(poblacion|pob)\.?\s*$/i, "");
  return s.replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Optimal String Alignment distance (Levenshtein + adjacent transpositions).
 * Catches the most common real-world typos: a missing/extra/swapped letter
 * (e.g. "barangy" ~ "barangay", "hh_szie" ~ "hh_size").
 */
function osaDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost); // transposition
      }
    }
  }
  return dp[m][n];
}
// Similarity ratio 0..1 (1 = identical). Guards against short-string false
// positives — "age" vs "ape" shouldn't casually match unrelated fields.
function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - osaDistance(a, b) / maxLen;
}
const TYPO_MATCH_THRESHOLD = 0.72;
const TYPO_MIN_LENGTH = 4; // skip fuzzy-typo matching on very short strings

function detectColumns(csvColumns) {
  const result = {};
  const used = new Set();
  const norms = {};
  csvColumns.forEach(col => { norms[col] = normalize(col); result[col] = { dbField: null, confidence: "unmatched" }; });

  // PASS 1 — exact alias matches, across ALL columns first. An exact match
  // always wins its field, no matter what order columns appear in the file.
  // (Previously this ran per-column interleaved with fuzzy tiers, so an
  // early fuzzy/substring guess on one column — e.g. "barangay_geo_code"
  // loosely matching "barangay" — could claim a field before a later
  // column's real exact match ("barangay") got a chance, permanently
  // blocking the correct mapping. Splitting into full passes fixes that.)
  csvColumns.forEach(col => {
    const norm = norms[col];
    for (const [dbField, aliases] of Object.entries(ALIAS_MAP)) {
      if (used.has(dbField)) continue;
      if (aliases.includes(norm)) { used.add(dbField); result[col] = { dbField, confidence: "auto" }; break; }
    }
  });

  // PASS 2 — substring fuzzy matches, only for columns still unmatched
  // and fields not already claimed by an exact match in Pass 1.
  csvColumns.forEach(col => {
    if (result[col].dbField) return; // already exact-matched
    const norm = norms[col];
    for (const [dbField, aliases] of Object.entries(ALIAS_MAP)) {
      if (used.has(dbField)) continue;
      let matched = false;
      for (const alias of aliases) {
        if (norm.includes(alias) || alias.includes(norm)) { matched = true; break; }
      }
      if (matched) { used.add(dbField); result[col] = { dbField, confidence: "fuzzy" }; break; }
    }
  });

  // PASS 3 — typo-tolerant (OSA distance) matches, only for whatever's
  // still left unmatched after exact + substring passes.
  csvColumns.forEach(col => {
    if (result[col].dbField) return;
    const norm = norms[col];
    if (norm.length < TYPO_MIN_LENGTH) return;
    let bestField = null, bestScore = 0;
    for (const [dbField, aliases] of Object.entries(ALIAS_MAP)) {
      if (used.has(dbField)) continue;
      for (const alias of aliases) {
        if (alias.length < TYPO_MIN_LENGTH) continue;
        const score = similarity(norm, alias);
        if (score > bestScore) { bestScore = score; bestField = dbField; }
      }
    }
    if (bestField && bestScore >= TYPO_MATCH_THRESHOLD) { used.add(bestField); result[col] = { dbField: bestField, confidence: "fuzzy" }; }
  });

  return result;
}

const REL_MAP = {
  "hh":"Household Head","household head":"Household Head","head":"Household Head",
  "spouse":"Spouse","husband":"Spouse","wife":"Spouse",
  "son/daughter":"Son/Daughter","son/daugther":"Son/Daughter","son":"Son/Daughter","daughter":"Son/Daughter",
  "son/daughter-in-law":"Son/Daughter-in-Law","son/daugther-in-law":"Son/Daughter-in-Law",
  "grandchildren":"Grandchildren","grandchild":"Grandchildren","apo":"Grandchildren",
  "brother/sister":"Brother/Sister","sibling":"Brother/Sister",
  "sister/brother in law":"Sister/Brother-in-Law","sister/brother-in-law":"Sister/Brother-in-Law",
  "parents":"Parents","parent":"Parents","mother":"Parents","father":"Parents",
  "other relatives":"Other Relatives","other realtives":"Other Relatives","relative":"Other Relatives",
  "housemaid/boy":"Other Relatives","niece-in-law":"Other Relatives",
  "mother-in-law":"Other Relatives","step son":"Other Relatives","step daughter":"Other Relatives",
};
function normalizeRelationship(val) {
  if (!val) return null;
  return REL_MAP[val.toString().toLowerCase().trim()] || val;
}

// ─────────────────────────────────────────────────────────────────────────────
// CBMS 2024 NEW-INDICATOR FIELD LISTS & VALUE COERCION
// Mirrors the dtypes used in import_cbms2024_v2.py (numeric()/boolean checks)
// so values sent through the web importer land in the DB with the right type.
// ─────────────────────────────────────────────────────────────────────────────
const NEW_HH_FIELDS = [
  "region_code","province_code","city_mun_code","barangay_code","husn","hsn",
  "longitude","latitude","hh_size","housing_roof","housing_floor",
  "o12_fuel_for_lighting","o13_fuel_for_cooking","water_service_level","toilet_service_level",
  "household_estimated_income","income_basis","asset_premium_pct",
  "flood_exposure","landslide_exposure","hazard_exposure_score","compound_hazard","hazard_data_status",
  "is_4ps_beneficiary","overcrowding_status","food_insecurity_score",
  "has_formal_financial_account","has_social_insurance","knows_evacuation_location","knows_emergency_hotline",
  "pwd_count","senior_count","solo_parent_count","avg_education_level_adults",
  "employed_count","working_age_count","dependency_count","dependency_ratio","employment_rate_adults",
];
const NEW_MEMBER_FIELDS = [
  "person_code","line_number","last_name","first_name","suffix","middle_name",
  "birthday_month","birthday_day","birthday_year","age_group_five_years","religion",
  "nuclear_family","relation_to_nuclear_family_head","with_pwd_id","employment_status",
  "estimated_monthly_income",
];
const NUMERIC_FIELDS = new Set([
  "longitude","latitude","hh_size","household_estimated_income","asset_premium_pct",
  "hazard_exposure_score","food_insecurity_score","pwd_count","senior_count","solo_parent_count",
  "avg_education_level_adults","employed_count","working_age_count","dependency_count",
  "dependency_ratio","employment_rate_adults","line_number","birthday_day","birthday_year",
  "estimated_monthly_income",
]);
// "Yes"/"No" style raw CBMS booleans
// Confirmed against live schema (information_schema.columns) on 2026-07:
// is_4ps_beneficiary, overcrowding_status, has_formal_financial_account,
// has_social_insurance, knows_evacuation_location, knows_emergency_hotline
// are all `text` columns in tbl_households — NOT boolean. Pass through as-is.
// with_pwd_id (member-level) not yet confirmed — treated as text until checked.
const YES_NO_BOOLEAN_FIELDS = new Set([]);
const TRUE_FALSE_BOOLEAN_FIELDS = new Set([]);

function coerceValue(field, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (NUMERIC_FIELDS.has(field)) { const n = parseFloat(raw); return isNaN(n) ? null : n; }
  if (YES_NO_BOOLEAN_FIELDS.has(field)) return String(raw).trim().toLowerCase() === "yes";
  if (TRUE_FALSE_BOOLEAN_FIELDS.has(field)) return String(raw).trim().toLowerCase() === "true";
  return raw;
}
// Recognizes "1", "yes", "true" (any case) as true — legacy boolean fields
// (has_electricity, is_senior, is_pwd, is_solo_parent, is_4ps) were originally
// written assuming CSVs only ever used "1"/"0", but raw CBMS-style exports use
// "Yes"/"No" text instead, so plain Number(x)===1 silently mis-reads them as false.
function isTruthyFlag(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "1" || s === "yes" || s === "true";
}

function getAuthHeaders() {
  const token = localStorage.getItem("access_token") || localStorage.getItem("token") ||
    sessionStorage.getItem("access_token") || sessionStorage.getItem("token") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: "" }));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE BADGE — icon-only, clean
// ─────────────────────────────────────────────────────────────────────────────
function ConfidenceBadge({ confidence }) {
  const cfg = {
    auto:      { bg: "#e8f5e9", border: "#a5d6a7", color: "#2e7d32", label: "Auto-matched", Icon: () => <IcoCheck size={11} color="#2e7d32"/> },
    fuzzy:     { bg: "#fff8e1", border: "#ffe082", color: "#f57f17", label: "Review",        Icon: () => <IcoWarn  size={11} color="#f57f17"/> },
    unmatched: { bg: "#fce4ec", border: "#f48fb1", color: "#c62828", label: "Unrecognized",  Icon: () => <IcoX     size={11} color="#c62828"/> },
    manual:    { bg: "#e3f2fd", border: "#90caf9", color: "#1565c0", label: "Manual",        Icon: () => <IcoWrench size={11} color="#1565c0"/> },
    skip:      { bg: "#f5f5f5", border: "#e0e0e0", color: "#9e9e9e", label: "Skipped",       Icon: () => <IcoSkip  size={11} color="#9e9e9e"/> },
  };
  const c = cfg[confidence] || cfg.unmatched;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4,
      background:c.bg, border:`1px solid ${c.border}`, color:c.color,
      fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:20,
      whiteSpace:"nowrap", letterSpacing:0.2 }}>
      <c.Icon />{c.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP INDICATOR
// ─────────────────────────────────────────────────────────────────────────────
function StepIndicator({ step }) {
  const steps = ["Upload", "Map Columns", "Clean Data", "Import", "Complete"];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:0 }}>
      {steps.map((label, i) => {
        const idx = i + 1;
        const done   = step > idx;
        const active = step === idx;
        return (
          <div key={label} style={{ display:"flex", alignItems:"center" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
              <div style={{
                width:26, height:26, borderRadius:"50%",
                background: done ? "#4caf50" : active ? "#fff" : "rgba(255,255,255,0.15)",
                border: `2px solid ${done ? "#4caf50" : active ? "#fff" : "rgba(255,255,255,0.3)"}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                transition:"all 0.2s",
              }}>
                {done
                  ? <IcoCheck size={12} color="#fff"/>
                  : <span style={{ fontSize:11, fontWeight:700, color: active ? "#1565c0" : "rgba(255,255,255,0.5)" }}>{idx}</span>
                }
              </div>
              <span style={{ fontSize:9, fontWeight: active ? 700 : 400, color: active || done ? "#fff" : "rgba(255,255,255,0.4)", whiteSpace:"nowrap", letterSpacing:0.3 }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width:22, height:1, background: done ? "rgba(76,175,80,0.6)" : "rgba(255,255,255,0.2)", margin:"0 3px", marginBottom:16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ImportModal({ onClose, onImported, barangays = [] }) {
  const [step,          setStep]          = useState(1);
  const [mode,          setMode]          = useState("cbms"); // "cbms" = the 7 CBMS 2024 files, "single" = one spreadsheet
  const [cbmsStage,     setCbmsStage]     = useState("pick"); // pick | checking | preview | running | finished
  const [, setFile]                       = useState(null);
  const [rows,          setRows]          = useState([]);
  const [cleanedRows,   setCleanedRows]   = useState([]);
  const [cleanReport,   setCleanReport]   = useState([]);
  const [mapping,       setMapping]       = useState({});
  const [dragging,      setDragging]      = useState(false);
  const [parseError,    setParseError]    = useState("");
  const [progress,      setProgress]      = useState({ done:0, total:0, errors:[], skipped:0 });
  const [, setImporting]                  = useState(false);
  const [duplicateMode, setDuplicateMode] = useState("skip");
  const fileRef = useRef();

  const handleFile = useCallback(async (f) => {
    setParseError("");
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["csv","xlsx","xls"].includes(ext)) { setParseError("Only .csv, .xlsx, or .xls files are supported."); return; }
    try {
      const parsed = await parseFile(f);
      if (!parsed.length) { setParseError("The file appears to be empty."); return; }
      setFile(f);
      setRows(parsed);
      setMapping(detectColumns(Object.keys(parsed[0])));
      setStep(2);
    } catch (err) { setParseError("Could not parse file: " + err.message); }
  }, []);

  const onDrop = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };
  const updateMapping = (csvCol, dbField) => {
    setMapping(m => ({ ...m, [csvCol]: { dbField: dbField||null, confidence: dbField ? "manual" : "skip" } }));
  };

  const getMappedCount = () => Object.values(mapping).filter(v => v.dbField).length;
  const getAutoCount   = () => Object.values(mapping).filter(v => v.confidence === "auto").length;
  const previewRows    = rows.slice(0, 3);

  const runImport = async () => {
    setStep(4); setImporting(true);
    const fieldToCol = {};
    Object.entries(mapping).forEach(([csvCol, { dbField }]) => { if (dbField) fieldToCol[dbField] = csvCol; });
    const get = (row, field) => { const col = fieldToCol[field]; if (!col) return undefined; const v = row[col]; return v === "" ? undefined : v; };
    const brgyLookup = {};
    barangays.forEach(b => { brgyLookup[normalizeBarangayName(b.barangay_name)] = b.barangay_id; });

    // Use cleaned rows from Algorithm pipeline
    const sourceRows = cleanedRows.length > 0 ? cleanedRows : rows;

    let groups = {};
    let autoGroupIdx = 0;
    // Track the current group key as we scan rows top-to-bottom.
    // A new household starts when we see a Household Head row — this handles
    // CSVs with no hh_no column where members are just listed sequentially.
    let currentGroupKey = null;
    sourceRows.forEach((row) => {
      const hhNoVal = get(row,"household_number") || row["hh_no"] || "";
      const brgyVal = get(row,"barangay_name") || "";
      const relVal  = String(row[fieldToCol["relationship_to_hh"]] || "").toLowerCase().trim();
      const isHead  = relVal === "hh" || relVal === "household head" || relVal === "head";

      let key;
      if (row["unique_hh_id"]) {
        // Explicit unique ID in CSV — highest priority
        key = row["unique_hh_id"];
      } else if (hhNoVal && String(hhNoVal).trim() !== "") {
        // HH number present — group by barangay + hh number
        key = `${brgyVal}_${hhNoVal}`;
      } else {
        // No HH number — group by proximity: new group starts on each HH Head row
        if (isHead || currentGroupKey === null) {
          currentGroupKey = `auto_${brgyVal}_${autoGroupIdx++}`;
        }
        key = currentGroupKey;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });

    const keys = Object.keys(groups);
    let done = 0, skipped = 0;
    const errors = [];
    const importedIds = [];
    setProgress({ done:0, total:keys.length, errors:[], skipped:0 });

    for (const key of keys) {
      const hhRows = groups[key];
      let headRow = hhRows.find(r => {
        const rel = r[fieldToCol["relationship_to_hh"]] || "";
        return r["hh_m"] === "hh" || normalize(rel) === "hh" || normalize(rel) === "householdhead";
      }) || hhRows[0];

      const brgyRaw = get(headRow,"barangay_name") || "";
      const brgyId  = brgyLookup[normalizeBarangayName(brgyRaw)];
      if (!brgyId) {
        errors.push({ key, reason: `Barangay not found: "${brgyRaw}"` });
        done++; setProgress(p => ({ ...p, done, errors:[...errors], skipped })); continue;
      }

      // If no household number in CSV, fetch auto-generated one from backend
      let hhNumRaw = get(headRow,"household_number") || headRow["hh_no"] || "";
      let hhNumber = "";
      let existingId = null;

      if (!hhNumRaw || String(hhNumRaw).trim() === "") {
        // Auto-generate household number via backend next-number endpoint
        try {
          const numRes = await axios.get(`/api/households/next-number?barangay_id=${brgyId}`, { headers: getAuthHeaders() });
          hhNumber = numRes.data?.household_number || (brgyRaw.replace(/\s+/g,"_") + "_auto_" + Date.now());
        } catch {
          hhNumber = brgyRaw.replace(/\s+/g,"_") + "_auto_" + Date.now();
        }
      } else {
        hhNumber = brgyRaw.replace(/\s+/g,"_") + "_" + hhNumRaw;
        // Duplicate check only when HH number is provided in CSV
        try {
          const check = await axios.get(`/api/households?search=${encodeURIComponent(hhNumber)}`, { headers: getAuthHeaders() });
          const allResults = check.data?.data || [];
          const found = allResults.find(h => h.household_number?.trim() === hhNumber.trim());
          console.log(`[Import] HH key: "${hhNumber}" | API returned ${allResults.length} result(s) | exact match: ${found ? found.household_id : 'none'}`);
          if (found) {
            if (duplicateMode === "skip") { skipped++; done++; setProgress(p => ({ ...p, done, errors:[...errors], skipped })); continue; }
            existingId = found.household_id;
          }
        } catch (checkErr) { void checkErr; }
      }

      const hhPayload = {
        household_number: hhNumber, barangay_id: parseInt(brgyId),
        housing_material: get(headRow,"housing_material")||null,
        tenure_status:    get(headRow,"tenure_status")||null,
        water_source:     get(headRow,"water_source")||null,
        toilet_type:      get(headRow,"toilet_type")||null,
        has_electricity:  isTruthyFlag(get(headRow,"has_electricity")),
        surveyed_date:    get(headRow,"surveyed_date")||null, monthly_income: null,
      };
      // Carry through the new CBMS 2024 household-level indicators (previously dropped)
      NEW_HH_FIELDS.forEach(f => { hhPayload[f] = coerceValue(f, get(headRow, f)); });

      let hhId;
      try {
        if (existingId) { await axios.put(`/api/households/${existingId}`, hhPayload, { headers: getAuthHeaders() }); hhId = existingId; }
        else { const res = await axios.post("/api/households", hhPayload, { headers: getAuthHeaders() }); hhId = res.data.household_id; }
      } catch (err) {
        const errBody = err.response?.data;
        console.error("[Import] 422 payload sent:", JSON.stringify(hhPayload));
        console.error("[Import] 422 response body:", JSON.stringify(errBody));
        const reason = typeof errBody === "string"
          ? errBody
          : errBody?.detail
            ? (Array.isArray(errBody.detail)
                ? errBody.detail.map(d => `${d.loc?.join(".")}: ${d.msg}`).join(" | ")
                : String(errBody.detail))
            : errBody?.error || errBody?.message || err.message;
        errors.push({ key, reason });
        done++; setProgress(p => ({ ...p, done, errors:[...errors], skipped })); continue;
      }

      if (!existingId) importedIds.push(hhId); // only track newly created, not updated
      let memberErrors = 0;
      let unnamedSkipped = 0;
      for (const row of hhRows) {
        let fullName = get(row,"full_name") || row["household_members"] || null;
        if (!fullName) {
          // No combined name column — CBMS raw format splits it instead.
          // Reconstruct it the same way import_cbms2024_v2.py does:
          // first + middle + last + suffix, collapsed whitespace.
          const parts = [
            get(row,"first_name"), get(row,"middle_name"),
            get(row,"last_name"), get(row,"suffix"),
          ].map(p => (p == null ? "" : String(p).trim())).filter(Boolean);
          if (parts.length) fullName = parts.join(" ").replace(/\s+/g, " ").trim();
        }
        if (!fullName) { unnamedSkipped++; continue; }
        const relNorm = normalizeRelationship(get(row,"relationship_to_hh") || "");
        const ageVal  = parseInt(get(row,"age"));
        const memberPayload = {
          full_name: fullName, relationship_to_hh: relNorm,
          is_household_head: relNorm === "Household Head",
          gender: get(row,"gender")||null, age: isNaN(ageVal)?null:ageVal,
          civil_status: get(row,"civil_status")||null, occupation: get(row,"occupation")||null,
          educational_attainment: get(row,"educational_attainment")||null,
          monthly_income: (()=>{
            const direct = parseFloat(get(row,"monthly_income"));
            if (!isNaN(direct) && direct > 0) return direct;
            // Fall back to the raw CBMS field when the legacy column isn't present
            const est = parseFloat(get(row,"estimated_monthly_income"));
            return (!isNaN(est) && est > 0) ? est : null;
          })(),
          is_senior: get(row,"is_senior") !== undefined
            ? isTruthyFlag(get(row,"is_senior"))
            : (!isNaN(ageVal) && ageVal >= 60),
          is_pwd: isTruthyFlag(get(row,"is_pwd")),
          is_solo_parent: isTruthyFlag(get(row,"is_solo_parent")),
          is_4ps: get(row,"is_4ps") !== undefined
            ? isTruthyFlag(get(row,"is_4ps"))
            : isTruthyFlag(get(headRow,"is_4ps_beneficiary")), // household-level flag applies to all members
        };
        // Carry through the new CBMS 2024 member-level indicators (previously dropped)
        NEW_MEMBER_FIELDS.forEach(f => { memberPayload[f] = coerceValue(f, get(row, f)); });
        try {
          await axios.post(`/api/households/${hhId}/members`, memberPayload, { headers: getAuthHeaders() });
        } catch (memberErr) {
          const errBody = memberErr.response?.data;
          console.error(`[Import] Member creation FAILED for "${fullName}" (HH ${hhId}):`);
          console.error("[Import] member payload sent:", JSON.stringify(memberPayload));
          console.error("[Import] member error response:", JSON.stringify(errBody) || memberErr.message);
          memberErrors++;
        }
      }
      try { await axios.patch(`/api/households/${hhId}/sync-income`,{},{ headers: getAuthHeaders() }); } catch (syncErr) { void syncErr; }
      if (memberErrors > 0) errors.push({ key, reason: `${memberErrors} member(s) failed to save` });
      if (unnamedSkipped > 0) errors.push({ key, reason: `${unnamedSkipped} member(s) skipped — no name data found (check full_name / first_name+last_name mapping)` });
      done++; setProgress(p => ({ ...p, done, errors:[...errors], skipped }));
    }
    setImporting(false); setStep(5);
    setProgress({ done, total:keys.length, errors, skipped });
    if (importedIds.length > 0) onImported?.(importedIds);
  };

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const successCount = progress.done - progress.errors.length - progress.skipped;

  // ── Shared style tokens ──────────────────────────────────────────────────
  const T = {
    headerBg:   "linear-gradient(135deg, #0d1b3e 0%, #1a3a6e 50%, #1565c0 100%)",
    bodyBg:     "#ffffff",
    border:     "#e3e8f4",
    subBg:      "#f8faff",
    inputBg:    "#f8faff",
    text:       "#1a237e",
    textSub:    "#455a90",
    textMuted:  "#8892a8",
    textCell:   "#4a5568",
    btnPrimary: "linear-gradient(135deg, #1a237e, #1565c0)",
    shadow:     "0 24px 60px rgba(13,27,62,0.18)",
  };

  const btnSecondary = {
    padding:"9px 20px", borderRadius:7, fontSize:12, fontWeight:600,
    border:"1px solid #dce3f0", background:"#fff", color:T.textSub,
    cursor:"pointer", display:"flex", alignItems:"center", gap:6,
    transition:"background 0.15s",
  };
  const btnPrimary = {
    padding:"9px 24px", borderRadius:7, fontSize:12, fontWeight:700,
    border:"none", background:T.btnPrimary, color:"#fff",
    cursor:"pointer", display:"flex", alignItems:"center", gap:6,
    boxShadow:"0 4px 14px rgba(21,101,192,0.35)", transition:"opacity 0.15s",
  };

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:1100,
        background:"rgba(8,15,35,0.72)", backdropFilter:"blur(6px)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => { if(e.target===e.currentTarget && cbmsStage !== "running") onClose(); }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        .imp-modal * { font-family: 'DM Sans', 'Segoe UI', sans-serif; box-sizing: border-box; }
        .imp-modal { animation: impIn 0.22s cubic-bezier(0.34,1.1,0.64,1); }
        @keyframes impIn { from{opacity:0;transform:translateY(-16px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        .imp-dropzone:hover { border-color:#1565c0 !important; background:#eef3ff !important; }
        .imp-row:hover td { background:#f5f8ff !important; }
        .imp-btn-sec:hover { background:#f0f4ff !important; }
        .imp-btn-pri:hover { opacity:0.9; }
        .imp-tag { display:inline-flex; align-items:center; gap:3px; background:#eef2ff; border:1px solid #c7d7fb; color:#3451b2; font-size:10px; font-weight:600; padding:2px 8px; border-radius:4px; font-family:monospace; letter-spacing:0.2px; }
      `}</style>

      <div className="imp-modal" style={{
        background:T.bodyBg, borderRadius:16, width:"100%", maxWidth: step===2 ? 960 : (step===1 && mode==="cbms") ? 820 : 780,
        maxHeight:"92vh", display:"flex", flexDirection:"column",
        boxShadow:T.shadow, overflow:"hidden",
      }}>

        {/* ── HEADER ── */}
        <div style={{ background:T.headerBg, padding:"18px 24px",
          display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          <div>
            <div style={{ color:"#fff", fontWeight:700, fontSize:15, letterSpacing:0.2 }}>
              Import Households
            </div>
            <div style={{ color:"rgba(255,255,255,0.55)", fontSize:11, marginTop:2 }}>
              {step===1 && mode==="cbms" && "Upload the 7 CBMS 2024 files — they are matched on their uuid and every score is recalculated"}
              {step===1 && mode==="single" && "Upload a CSV or XLSX file — columns are auto-detected"}
              {step===2 && `${rows.length.toLocaleString()} rows · ${getMappedCount()} columns mapped (${getAutoCount()} auto-detected)`}
              {step===3 && `${rows.length.toLocaleString()} rows — reviewing data quality rules`}
              {step===4 && `Processing ${progress.total.toLocaleString()} households...`}
              {step===5 && "Import operation complete"}
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            {!(step===1 && mode==="cbms") && <StepIndicator step={step} />}
            <button onClick={onClose} style={{
              background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)",
              color:"#fff", width:30, height:30, borderRadius:"50%",
              cursor:"pointer", fontSize:15, fontWeight:700,
              display:"flex", alignItems:"center", justifyContent:"center",
              transition:"background 0.15s",
            }}>
              <IcoX size={14} color="#fff"/>
            </button>
          </div>
        </div>

        {/* ── SOURCE: 7 CBMS files or one spreadsheet ── */}
        {step === 1 && (mode === "single" || ["pick","checking","preview"].includes(cbmsStage)) && (
          <div style={{ display:"flex", gap:4, padding:"12px 24px 0", flexShrink:0 }}>
            {[
              { v:"cbms",   label:"CBMS 2024 files (7)", hint:"Recommended" },
              { v:"single", label:"Single spreadsheet",  hint:"" },
            ].map(o => (
              <button key={o.v} onClick={() => setMode(o.v)} style={{
                padding:"7px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer",
                border:`1px solid ${mode===o.v ? "#1565c0" : T.border}`,
                background: mode===o.v ? "#eef3ff" : "#fff", color: mode===o.v ? "#1565c0" : T.textSub,
              }}>
                {o.label}{o.hint && <span style={{ marginLeft:6, fontSize:10, color:"#2e7d32", fontWeight:700 }}>{o.hint}</span>}
              </button>
            ))}
          </div>
        )}

        {step === 1 && mode === "cbms" && (
          <CbmsImport onClose={onClose} onDone={() => onImported([])} onStageChange={setCbmsStage} />
        )}

        {/* ── STEP 1: UPLOAD ── */}
        {step === 1 && mode === "single" && (
          <div style={{ overflowY:"auto", flex:1, padding:"24px" }}>

            {/* Drop zone */}
            <div
              className="imp-dropzone"
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border:`2px dashed ${dragging ? "#1565c0" : "#c7d7fb"}`,
                borderRadius:12, padding:"44px 24px", textAlign:"center",
                background: dragging ? "#e8efff" : T.subBg,
                cursor:"pointer", transition:"all 0.2s",
              }}
            >
              <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}>
                <div style={{ width:64, height:64, borderRadius:16, background:"#e8f0fe",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  boxShadow:"0 4px 16px rgba(21,101,192,0.15)" }}>
                  <IcoUpload />
                </div>
              </div>
              <div style={{ fontWeight:700, fontSize:14, color:T.text, marginBottom:4 }}>
                Drop your file here to import
              </div>
              <div style={{ fontSize:12, color:T.textMuted, marginBottom:18 }}>
                Supports .csv · .xlsx · .xls
              </div>
              <div style={{ display:"inline-block", padding:"8px 22px",
                background:T.btnPrimary, color:"#fff", borderRadius:8,
                fontSize:12, fontWeight:600, boxShadow:"0 3px 10px rgba(21,101,192,0.3)" }}>
                Browse File
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
                style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
            </div>

            {parseError && (
              <div style={{ marginTop:12, background:"#fff5f5", border:"1px solid #feb2b2",
                borderRadius:8, padding:"10px 14px", color:"#c53030", fontSize:12,
                display:"flex", alignItems:"center", gap:8 }}>
                <IcoX size={13} color="#c53030"/> {parseError}
              </div>
            )}

            {/* Supported columns */}
            <div style={{ marginTop:20, background:T.subBg, borderRadius:10,
              border:`1px solid ${T.border}`, padding:"14px 18px" }}>
              <div style={{ fontSize:11, fontWeight:700, color:T.textSub, marginBottom:10,
                textTransform:"uppercase", letterSpacing:0.5, display:"flex", alignItems:"center", gap:6 }}>
                <IcoDatabase size={12} color={T.textSub}/> Recognized Column Names
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {["barangay","hh_no","household_members","relationship_to_hh","gender","age",
                  "civil_status","occupation","educational_attainment",
                  "estimated_family_income_monthly","is_senior","is_pwd","is_solo_parent",
                  "is_4ps","water_source","has_electricity","toilet_type",
                  "housing_material","tenure_status"].map(col => (
                  <span key={col} className="imp-tag">{col}</span>
                ))}
              </div>
              <div style={{ marginTop:12, fontSize:10, fontWeight:700, color:T.textSub,
                textTransform:"uppercase", letterSpacing:0.5 }}>
                CBMS 2024 Indicators
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:6 }}>
                {[...NEW_HH_FIELDS, ...NEW_MEMBER_FIELDS].map(col => (
                  <span key={col} className="imp-tag">{col}</span>
                ))}
              </div>
              <div style={{ marginTop:10, fontSize:11, color:T.textMuted }}>
                Other column names are automatically matched using fuzzy detection.
              </div>
            </div>

            {/* Duplicate policy */}
            <div style={{ marginTop:14, padding:"12px 16px",
              background:T.subBg, border:`1px solid ${T.border}`, borderRadius:10,
              display:"flex", alignItems:"center", gap:16 }}>
              <span style={{ fontSize:12, fontWeight:600, color:T.textSub, whiteSpace:"nowrap" }}>
                If household already exists:
              </span>
              {[
                { value:"skip",   label:"Skip — do not overwrite" },
                { value:"update", label:"Update / overwrite" },
              ].map(opt => (
                <label key={opt.value} style={{ display:"flex", alignItems:"center", gap:6,
                  cursor:"pointer", fontSize:12, color:T.textCell }}>
                  <input type="radio" name="dupMode" value={opt.value}
                    checked={duplicateMode===opt.value}
                    onChange={() => setDuplicateMode(opt.value)}
                    style={{ accentColor:"#1565c0", width:14, height:14 }} />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: COLUMN MAPPING ── */}
        {step === 2 && (
          <>
            <div style={{ overflowY:"auto", flex:1, padding:"20px 24px" }}>

              {/* Summary chips */}
              <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
                {[
                  { label:"Auto-matched", count: Object.values(mapping).filter(v=>v.confidence==="auto").length,   color:"#2e7d32", bg:"#e8f5e9", border:"#a5d6a7", Icon:() => <IcoCheck size={11} color="#2e7d32"/> },
                  { label:"Needs review", count: Object.values(mapping).filter(v=>v.confidence==="fuzzy").length,  color:"#f57f17", bg:"#fff8e1", border:"#ffe082", Icon:() => <IcoWarn  size={11} color="#f57f17"/> },
                  { label:"Unrecognized", count: Object.values(mapping).filter(v=>v.confidence==="unmatched").length, color:"#c62828", bg:"#fce4ec", border:"#f48fb1", Icon:() => <IcoX size={11} color="#c62828"/> },
                  { label:"Manual",       count: Object.values(mapping).filter(v=>v.confidence==="manual").length, color:"#1565c0", bg:"#e3f2fd", border:"#90caf9", Icon:() => <IcoWrench size={11} color="#1565c0"/> },
                ].map(s => (
                  <div key={s.label} style={{ background:s.bg, border:`1px solid ${s.border}`,
                    borderRadius:8, padding:"8px 14px", display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:20, fontWeight:800, color:s.color, lineHeight:1 }}>{s.count}</span>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}><s.Icon/></div>
                      <div style={{ fontSize:10, color:s.color, fontWeight:600, marginTop:1 }}>{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Mapping table */}
              <div style={{ border:`1px solid ${T.border}`, borderRadius:10, overflowX:"auto", overflowY:"hidden" }}>
                <table style={{ width:"100%", minWidth:640, borderCollapse:"collapse", fontSize:12 }}>
                  <thead>
                    <tr style={{ background:"#f0f4ff", borderBottom:`1px solid ${T.border}` }}>
                      {["CSV Column","Sample Data","Maps To DB Field"].map(h => (
                        <th key={h} style={{ padding:"9px 12px", textAlign:"left",
                          fontWeight:600, color:T.textSub, fontSize:10,
                          textTransform:"uppercase", letterSpacing:0.4 }}>{h}</th>
                      ))}
                      <th style={{ padding:"9px 12px", textAlign:"left",
                        fontWeight:600, color:T.textSub, fontSize:10,
                        textTransform:"uppercase", letterSpacing:0.4,
                        position:"sticky", right:0, background:"#f0f4ff",
                        boxShadow:"-4px 0 6px -4px rgba(13,27,62,0.15)" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(mapping).map(([csvCol, { dbField, confidence }], idx) => {
                      const samples = [...new Set(previewRows.map(r => r[csvCol]).filter(Boolean))].slice(0,2);
                      const isHH = dbField && DB_FIELDS[dbField]?.table === "household";
                      return (
                        <tr key={csvCol} className="imp-row"
                          style={{ borderBottom:`1px solid ${T.border}`, background: idx%2===0 ? "#fff" : T.subBg }}>
                          <td style={{ padding:"9px 12px" }}>
                            <span style={{ fontFamily:"monospace", color:T.text, fontWeight:700, fontSize:11,
                              background:"#eef2ff", padding:"2px 7px", borderRadius:4 }}>{csvCol}</span>
                          </td>
                          <td style={{ padding:"9px 12px" }}>
                            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                              {samples.map((s, i) => (
                                <span key={i} style={{ background:"#f5f5f5", border:"1px solid #e8e8e8",
                                  borderRadius:4, padding:"1px 6px", fontSize:10,
                                  color:T.textCell, maxWidth:110, overflow:"hidden",
                                  textOverflow:"ellipsis", whiteSpace:"nowrap", display:"inline-block" }}>
                                  {String(s).substring(0,18)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding:"9px 12px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              {dbField && (
                                <span style={{ display:"inline-flex", alignItems:"center", gap:3,
                                  fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:3,
                                  background: isHH ? "#e8f0fe" : "#f3e5f5",
                                  color: isHH ? "#1565c0" : "#7b1fa2",
                                  border: `1px solid ${isHH ? "#c5d8fb" : "#ce93d8"}` }}>
                                  {isHH ? <IcoDatabase size={9} color="#1565c0"/> : <IcoUser size={9} color="#7b1fa2"/>}
                                  {isHH ? "HH" : "MBR"}
                                </span>
                              )}
                              <select
                                value={dbField || ""}
                                onChange={e => updateMapping(csvCol, e.target.value)}
                                style={{ padding:"5px 8px", border:`1px solid ${T.border}`,
                                  borderRadius:6, fontSize:11, background:"#fff",
                                  color:T.textCell, minWidth:175, outline:"none" }}>
                                <option value="">— Skip this column —</option>
                                <optgroup label="Household Fields">
                                  {Object.entries(DB_FIELDS).filter(([,v])=>v.table==="household").map(([key,{label}])=>(
                                    <option key={key} value={key}>{label}</option>
                                  ))}
                                </optgroup>
                                <optgroup label="Member Fields">
                                  {Object.entries(DB_FIELDS).filter(([,v])=>v.table==="member").map(([key,{label}])=>(
                                    <option key={key} value={key}>{label}</option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                          </td>
                          <td style={{ padding:"9px 12px", position:"sticky", right:0,
                            background: idx%2===0 ? "#fff" : T.subBg,
                            boxShadow:"-4px 0 6px -4px rgba(13,27,62,0.15)" }}>
                            <ConfidenceBadge confidence={dbField ? confidence : "skip"} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Data preview */}
              <div style={{ marginTop:16 }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.textMuted, marginBottom:8,
                  textTransform:"uppercase", letterSpacing:0.5 }}>
                  Data Preview — First 3 Rows
                </div>
                <div style={{ overflowX:"auto", border:`1px solid ${T.border}`, borderRadius:8 }}>
                  <table style={{ borderCollapse:"collapse", fontSize:11, whiteSpace:"nowrap" }}>
                    <thead>
                      <tr style={{ background:"#f0f4ff" }}>
                        {Object.keys(mapping).map(col => (
                          <th key={col} style={{ padding:"6px 10px", textAlign:"left",
                            fontWeight:600, color:T.textSub, borderBottom:`1px solid ${T.border}`,
                            fontFamily:"monospace", fontSize:10 }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} style={{ borderBottom:`1px solid ${T.border}` }}>
                          {Object.keys(mapping).map(col => (
                            <td key={col} style={{ padding:"5px 10px", color:T.textCell, maxWidth:120,
                              overflow:"hidden", textOverflow:"ellipsis" }}>
                              {String(row[col]??"").substring(0,22) || <span style={{color:"#ccc"}}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.border}`,
              background:T.subBg, display:"flex", justifyContent:"space-between",
              alignItems:"center", flexShrink:0 }}>
              <button className="imp-btn-sec" onClick={() => setStep(1)} style={btnSecondary}>
                <IcoArrow dir="left"/> Back
              </button>
              <span style={{ fontSize:11, color:T.textMuted }}>
                {getMappedCount()} columns · {rows.length.toLocaleString()} rows
              </span>
              <button className="imp-btn-pri" onClick={() => {
                const { cleanedRows: cr, report } = runCleaningPipeline(rows, mapping);
                setCleanedRows(cr);
                setCleanReport(report);
                setStep(3);
              }} style={btnPrimary}>
                Review & Clean <IcoArrow dir="right"/>
              </button>
            </div>
          </>
        )}

        {/* ── STEP 3: DATA CLEANING REPORT ── */}
        {step === 3 && (() => {
          const totalFixes = cleanReport.reduce((s,a) => s + a.fixes.length, 0);
          const severityColor = { ok:"#2e7d32", fixed:"#1565c0", warn:"#f57f17" };
          const severityBg    = { ok:"#e8f5e9", fixed:"#e3f2fd", warn:"#fff8e1" };
          const severityBorder= { ok:"#a5d6a7", fixed:"#90caf9", warn:"#ffe082" };
          const severityLabel = { ok:"Clean", fixed:"Auto-fixed", warn:"Advisory" };
          return (
            <>
              <div style={{ overflowY:"auto", flex:1, padding:"20px 24px" }}>

                {/* Summary banner */}
                <div style={{
                  display:"flex", alignItems:"center", gap:14, marginBottom:18,
                  padding:"14px 18px", borderRadius:10,
                  background: totalFixes === 0 ? "#e8f5e9" : "#e3f2fd",
                  border:`1px solid ${totalFixes === 0 ? "#a5d6a7" : "#90caf9"}`,
                }}>
                  <div style={{ flexShrink:0 }}>
                    {totalFixes === 0 ? <IcoCheck size={22} color="#2e7d32"/> : <IcoWrench size={22} color="#1565c0"/>}
                  </div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:13, color: totalFixes===0 ? "#2e7d32":"#1565c0" }}>
                      {totalFixes === 0
                        ? "Dataset is clean — no corrections needed"
                        : `${totalFixes} data inconsistencies automatically corrected across 5 algorithms`}
                    </div>
                    <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>
                      {rows.length.toLocaleString()} rows scanned · Cleaned data will be used for import
                    </div>
                  </div>
                  <div style={{ marginLeft:"auto", textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontSize:22, fontWeight:800, color: totalFixes===0?"#2e7d32":"#1565c0" }}>{totalFixes}</div>
                    <div style={{ fontSize:10, color:T.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.4 }}>Fixes Applied</div>
                  </div>
                </div>

                {/* Per-algorithm cards */}
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {cleanReport.map((algo) => {
                    const sev = algo.severity ?? "ok";
                    const fixCount = algo.fixes.length;
                    return (
                      <div key={algo.algoId} style={{
                        border:`1px solid ${severityBorder[sev]}`,
                        borderRadius:10, overflow:"hidden",
                        background:"#fff",
                      }}>
                        {/* Card header */}
                        <div style={{
                          display:"flex", alignItems:"center", gap:10,
                          padding:"11px 16px",
                          background: severityBg[sev],
                          borderBottom: fixCount > 0 ? `1px solid ${severityBorder[sev]}` : "none",
                        }}>
                          <div style={{
                            width:22, height:22, borderRadius:6, flexShrink:0,
                            background: severityColor[sev], display:"flex",
                            alignItems:"center", justifyContent:"center",
                          }}>
                            <span style={{ color:"#fff", fontSize:10, fontWeight:800 }}>A{algo.algoId}</span>
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:700, fontSize:12, color:T.text }}>{algo.title}</div>
                            <div style={{ fontSize:10, color:T.textMuted, marginTop:1, lineHeight:1.4 }}>{algo.description}</div>
                          </div>
                          <div style={{ flexShrink:0, textAlign:"right" }}>
                            <span style={{
                              display:"inline-flex", alignItems:"center", gap:4,
                              background:"#fff", border:`1px solid ${severityBorder[sev]}`,
                              borderRadius:20, padding:"2px 10px",
                              fontSize:10, fontWeight:700, color:severityColor[sev],
                            }}>
                              {sev === "ok"    && <IcoCheck size={10} color={severityColor[sev]}/>}
                              {sev === "fixed" && <IcoWrench size={10} color={severityColor[sev]}/>}
                              {sev === "warn"  && <IcoWarn size={10} color={severityColor[sev]}/>}
                              {severityLabel[sev]} · {algo.summary}
                            </span>
                          </div>
                        </div>

                        {/* Fixes table — show only first 8 per algo */}
                        {fixCount > 0 && (
                          <div style={{ overflowX:"auto" }}>
                            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                              <thead>
                                <tr style={{ background:"#fafbff" }}>
                                  {["Row","Field","Before","After","Rule Applied"].map(h => (
                                    <th key={h} style={{ padding:"6px 12px", textAlign:"left",
                                      fontWeight:600, color:T.textSub, fontSize:10,
                                      textTransform:"uppercase", letterSpacing:0.3,
                                      borderBottom:`1px solid ${T.border}` }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {algo.fixes.slice(0, 8).map((fix, i) => (
                                  <tr key={i} style={{
                                    borderBottom:`1px solid ${T.border}`,
                                    background: i%2===0 ? "#fff" : T.subBg,
                                  }}>
                                    <td style={{ padding:"6px 12px", color:T.textMuted, fontFamily:"monospace" }}>
                                      {fix.row === "all" ? <span style={{fontStyle:"italic"}}>all rows</span> : `#${fix.row}`}
                                    </td>
                                    <td style={{ padding:"6px 12px" }}>
                                      <span style={{ fontFamily:"monospace", fontSize:10, background:"#eef2ff",
                                        color:T.text, padding:"1px 5px", borderRadius:3 }}>{fix.field}</span>
                                    </td>
                                    <td style={{ padding:"6px 12px", color:"#c62828", maxWidth:100,
                                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                      {String(fix.before).substring(0,24) || <span style={{color:"#ccc"}}>—</span>}
                                    </td>
                                    <td style={{ padding:"6px 12px", color:"#2e7d32", maxWidth:120,
                                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                      {String(fix.after).substring(0,28)}
                                    </td>
                                    <td style={{ padding:"6px 12px", color:T.textSub, fontSize:10 }}>{fix.rule}</td>
                                  </tr>
                                ))}
                                {fixCount > 8 && (
                                  <tr>
                                    <td colSpan={5} style={{ padding:"7px 12px", textAlign:"center",
                                      fontSize:10, color:T.textMuted, fontStyle:"italic",
                                      background:severityBg[sev] }}>
                                      + {fixCount - 8} more corrections not shown
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.border}`,
                background:T.subBg, display:"flex", justifyContent:"space-between",
                alignItems:"center", flexShrink:0 }}>
                <button className="imp-btn-sec" onClick={() => setStep(2)} style={btnSecondary}>
                  <IcoArrow dir="left"/> Back
                </button>
                <span style={{ fontSize:11, color:T.textMuted }}>
                  {totalFixes} corrections applied · {rows.length.toLocaleString()} rows ready
                </span>
                <button className="imp-btn-pri" onClick={runImport} style={btnPrimary}>
                  Start Import <IcoArrow dir="right"/>
                </button>
              </div>
            </>
          );
        })()}

        {/* ── STEP 4: IMPORTING ── */}
        {step === 4 && (
          <div style={{ flex:1, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", padding:"48px 24px", textAlign:"center" }}>
            <div style={{ marginBottom:20 }}><IcoLoader /></div>
            <div style={{ fontWeight:700, fontSize:15, color:T.text, marginBottom:6 }}>
              Importing Records
            </div>
            <div style={{ fontSize:12, color:T.textMuted, marginBottom:28 }}>
              {progress.done.toLocaleString()} of {progress.total.toLocaleString()} households processed
            </div>
            {/* Progress bar */}
            <div style={{ width:"100%", maxWidth:460, height:6,
              background:"#e3e8f0", borderRadius:6, overflow:"hidden", marginBottom:8 }}>
              <div style={{ height:"100%", width:`${percent}%`,
                background:"linear-gradient(90deg,#1a237e,#1565c0,#42a5f5)",
                borderRadius:6, transition:"width 0.4s ease" }} />
            </div>
            <div style={{ fontSize:12, fontWeight:700, color:"#1565c0", marginBottom:20 }}>{percent}%</div>
            {progress.errors.length > 0 && (
              <div style={{ maxHeight:110, overflowY:"auto", width:"100%", maxWidth:460,
                background:"#fff5f5", border:"1px solid #fed7d7", borderRadius:8,
                padding:"10px 14px", textAlign:"left" }}>
                {progress.errors.slice(-5).map((e, i) => (
                  <div key={i} style={{ fontSize:11, color:"#c53030", marginBottom:2,
                    display:"flex", alignItems:"flex-start", gap:6 }}>
                    <IcoX size={11} color="#c53030"/> {e.key}: {e.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5: DONE ── */}
        {step === 5 && (
          <div style={{ flex:1, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", padding:"40px 24px", textAlign:"center" }}>
            <div style={{ marginBottom:16 }}>
              {progress.errors.length === 0 ? <IcoSuccess size={48}/> : <IcoAlert size={48}/>}
            </div>
            <div style={{ fontWeight:800, fontSize:16, color:T.text, marginBottom:4 }}>
              {progress.errors.length === 0 ? "Import Successful" : "Import Completed with Warnings"}
            </div>
            <div style={{ fontSize:12, color:T.textMuted, marginBottom:24 }}>
              Operation finished · {progress.total.toLocaleString()} households processed
            </div>

            {/* Result stat cards */}
            <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:24 }}>
              {[
                { label:"Imported",  value:successCount,            color:"#2e7d32", bg:"#e8f5e9", border:"#a5d6a7", Icon:() => <IcoCheck size={16} color="#2e7d32"/> },
                { label:"Skipped",   value:progress.skipped,        color:"#f57f17", bg:"#fff8e1", border:"#ffe082", Icon:() => <IcoSkip  size={16} color="#f57f17"/> },
                { label:"Errors",    value:progress.errors.length,  color:"#c62828", bg:"#fce4ec", border:"#f48fb1", Icon:() => <IcoX     size={16} color="#c62828"/> },
              ].map(c => (
                <div key={c.label} style={{ background:c.bg, border:`1px solid ${c.border}`,
                  borderRadius:12, padding:"18px 32px", minWidth:110 }}>
                  <div style={{ display:"flex", justifyContent:"center", marginBottom:6 }}><c.Icon/></div>
                  <div style={{ fontSize:28, fontWeight:800, color:c.color, lineHeight:1 }}>{c.value}</div>
                  <div style={{ fontSize:11, color:c.color, marginTop:4, fontWeight:600 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {progress.errors.length > 0 && (
              <div style={{ maxHeight:160, overflowY:"auto", width:"100%", maxWidth:520,
                background:"#fff5f5", border:"1px solid #fed7d7", borderRadius:10,
                padding:"12px 16px", textAlign:"left", marginBottom:20 }}>
                <div style={{ fontWeight:700, fontSize:11, color:"#c53030", marginBottom:8,
                  textTransform:"uppercase", letterSpacing:0.4 }}>Error Details</div>
                {progress.errors.map((e, i) => (
                  <div key={i} style={{ fontSize:11, color:"#c53030", marginBottom:4,
                    display:"flex", alignItems:"flex-start", gap:6 }}>
                    <span style={{ flexShrink:0, marginTop:1 }}><IcoX size={11} color="#c53030"/></span>
                    <span style={{ fontFamily:"monospace", background:"#ffebee",
                      padding:"0 5px", borderRadius:3, flexShrink:0 }}>{e.key}</span>
                    <span style={{ color:"#9b2c2c" }}>{e.reason}</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={() => { onImported?.(); onClose(); }}
              className="imp-btn-pri" style={btnPrimary}>
              Return to Households <IcoArrow dir="right"/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}