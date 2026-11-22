"""
NLP-to-DB engine -- Sir Shem's second suggestion (NLP_TO_DB_INTEGRATION_
SKILL.md): a constrained natural-language query layer.

Architecture (matches the skill doc):
    Plain English -> Gemini query planner -> SQL validator ->
    read-only analytical views -> result table -> deterministic chart ->
    constrained explanation

The LLM is a translator/query planner/explainer. The database (a
dedicated, isolated SQLite file built by build_nlp_views.py from Sir
Shem's own domain-pipeline CSV outputs) is the source of truth. Gemini
NEVER executes SQL itself and NEVER sees raw household-level data --
see build_nlp_views.py's module docstring for why a separate DB file is
used instead of pointing this at the production Postgres database.

This module is deliberately framework-independent (no Flask imports) so
it can be called from any route/wrapper later, per the skill doc's
"Integration boundary" section. See routes/nlp_query_routes.py for the
Flask wrapper actually used by this app.
"""
import os
import re
import sqlite3
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp

from gemini_client import call_gemini
import nlp_questions
import nlp_households

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "nlp_analytics.sqlite")

# ── Defense-in-depth allowlist. Everything in nlp_analytics.sqlite is
# already an approved, aggregated, PII-free table by construction (see
# build_nlp_views.py) -- this second allowlist exists so a query is
# still rejected even if that file is ever extended later without this
# list being updated to match. ──
ALLOWED_TABLES = {
    "vw_barangay_vulnerability",
    "vw_barangay_capacity",
    "vw_hazard_exposure",
    "vw_household_typology",
    "vw_barangay_priority",
    "dim_semantic_dictionary",
}

ROW_LIMIT = 100
QUERY_TIMEOUT_SECONDS = 10

# Statement kinds never allowed, regardless of what sqlglot parses them as.
FORBIDDEN_KEYWORDS = {
    "insert", "update", "delete", "drop", "alter", "create", "replace",
    "attach", "detach", "pragma", "vacuum", "reindex", "truncate",
    "call", "exec", "execute", "copy", "grant", "revoke",
}


@dataclass
class NLPDatabaseConfig:
    db_path: str = DB_PATH
    allowed_tables: set = field(default_factory=lambda: set(ALLOWED_TABLES))
    row_limit: int = ROW_LIMIT

    @staticmethod
    def from_env():
        return NLPDatabaseConfig()


# ── 1. SchemaCatalog -- reads the curated DB's real structure + the
#    semantic dictionary, and renders both as compact text for the
#    Gemini prompt. Never hand-written/guessed -- read live from the
#    actual sqlite_master + dim_semantic_dictionary table each call. ──
class SchemaCatalog:
    def __init__(self, config: NLPDatabaseConfig):
        self.config = config

    def _connect_ro(self):
        return sqlite3.connect(f"file:{self.config.db_path}?mode=ro", uri=True)

    def describe(self):
        """Returns (schema_text, error). schema_text is None on error."""
        if not os.path.exists(self.config.db_path):
            return None, (
                "The analytical database hasn't been built yet -- run "
                "`python build_nlp_views.py` from backend/ first."
            )
        try:
            con = self._connect_ro()
            cur = con.cursor()
            lines = []
            for table in sorted(self.config.allowed_tables):
                cur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (table,)
                )
                if not cur.fetchone():
                    continue
                if table == "dim_semantic_dictionary":
                    continue  # described separately below, not as a queryable fact table
                cur.execute(f'PRAGMA table_info("{table}")')
                cols = cur.fetchall()
                col_list = ", ".join(f"{c[1]} ({c[2]})" for c in cols)
                lines.append(f"TABLE {table}: {col_list}")
                # exact values of short text columns, so filters use the
                # real spelling ('Low capacity', 'Bgy. 5 Pob.', ...)
                for c in cols:
                    if c[2].upper() != "TEXT" or c[1] in ("psgc_10d", "barangay"):
                        continue
                    cur.execute(f'SELECT DISTINCT "{c[1]}" FROM "{table}" WHERE "{c[1]}" IS NOT NULL LIMIT 31')
                    vals = [v[0] for v in cur.fetchall()]
                    if 0 < len(vals) <= 30:
                        lines.append(f"  {table}.{c[1]} values: " + ", ".join(repr(v) for v in vals))
                if table == "vw_household_typology":
                    cur.execute("SELECT DISTINCT cluster_id, cluster_label FROM vw_household_typology ORDER BY cluster_id")
                    lines.append("  cluster_id meaning: " + "; ".join(f"{a} = {b!r}" for a, b in cur.fetchall()))

            cur.execute("SELECT barangay FROM vw_barangay_vulnerability ORDER BY barangay")
            lines.append("\nBARANGAY NAMES (exact spelling, use these in WHERE): " + ", ".join(repr(r[0]) for r in cur.fetchall()))

            # Semantic dictionary, grouped by source_view, gives Gemini the
            # meaning/direction/denominator/caution for each field -- this
            # is what lets it write correct SQL and correct prose without
            # guessing what a rank direction or a percentage denominator means.
            cur.execute(
                "SELECT field_name, source_view, display_name, definition, unit, "
                "direction, denominator, interpretation, caution FROM dim_semantic_dictionary "
                "ORDER BY source_view, field_name"
            )
            dict_rows = cur.fetchall()
            con.close()

            lines.append("\nFIELD DEFINITIONS:")
            for r in dict_rows:
                field_name, source_view, display_name, definition, unit, direction, denom, interp, caution = r
                entry = f"- {source_view}.{field_name} ({display_name}): {definition}"
                if unit:
                    entry += f" [unit: {unit}]"
                if direction:
                    entry += f" [direction: {direction}]"
                if denom and denom != "n/a":
                    entry += f" [denominator: {denom}]"
                if caution:
                    entry += f" CAUTION: {caution}"
                lines.append(entry)

            return "\n".join(lines), None
        except Exception as e:
            return None, f"Failed to read analytical database schema: {e}"


    def labels(self, columns):
        """column name -> plain display name from the semantic dictionary."""
        try:
            con = self._connect_ro()
            rows = con.execute("SELECT field_name, display_name FROM dim_semantic_dictionary").fetchall()
            con.close()
        except Exception:
            rows = []
        names = {a: b for a, b in rows}
        return {c: names.get(c) for c in columns}


# ── 2. SQLValidator -- sqlglot-based, not regex-only, per the skill
#    doc's explicit requirement ("regex-only filtering is not
#    sufficient"). Rejects anything but a single read-only SELECT
#    against an allowlisted table. ──
class SQLValidationError(Exception):
    pass


class SQLValidator:
    def __init__(self, config: NLPDatabaseConfig):
        self.config = config

    def validate(self, sql: str) -> str:
        """Returns a safe-to-run SQL string (with LIMIT enforced), or
        raises SQLValidationError with a human-readable reason."""
        if not sql or not sql.strip():
            raise SQLValidationError("Gemini did not return a SQL query.")

        lowered = sql.lower()
        for kw in FORBIDDEN_KEYWORDS:
            # word-boundary match so e.g. "created_at" doesn't false-positive on "create"
            if re.search(rf"\b{kw}\b", lowered):
                raise SQLValidationError(f"Query contains a forbidden operation: {kw.upper()}.")

        try:
            statements = sqlglot.parse(sql, read="sqlite")
        except Exception as e:
            raise SQLValidationError(f"Query failed to parse as SQL: {e}")

        if len(statements) != 1:
            raise SQLValidationError("Only a single SQL statement is allowed.")

        stmt = statements[0]
        if stmt is None or not isinstance(stmt, (exp.Select, exp.Union)):
            raise SQLValidationError("Only a single read-only SELECT statement is allowed.")
        if isinstance(stmt, exp.Union) and not all(isinstance(x, (exp.Select, exp.Union)) for x in (stmt.left, stmt.right)):
            raise SQLValidationError("Only SELECT statements can be combined with UNION.")

        # Every referenced table must be on the allowlist (names defined by
        # a WITH clause inside this same query are fine).
        cte_names = {c.alias_or_name for c in stmt.find_all(exp.CTE)}
        referenced_tables = {t.name for t in stmt.find_all(exp.Table)} - cte_names
        disallowed = referenced_tables - self.config.allowed_tables
        if disallowed:
            raise SQLValidationError(
                f"Query references table(s) not in the approved analytical view list: {', '.join(disallowed)}."
            )
        if not referenced_tables:
            raise SQLValidationError("Query does not reference any approved table.")

        # No subqueries/CTEs referencing disallowed tables, no PRAGMA-style
        # functions, no ATTACH via functions -- sqlglot's Table extraction
        # above already covers CTEs and subqueries since find_all walks the
        # whole tree, not just the top level.

        # Enforce a row cap regardless of what Gemini wrote.
        existing_limit = stmt.args.get("limit")
        if existing_limit is None:
            stmt = stmt.limit(self.config.row_limit)
        else:
            try:
                requested = int(existing_limit.expression.this)
                if requested > self.config.row_limit:
                    stmt.set("limit", exp.Limit(expression=exp.Literal.number(self.config.row_limit)))
            except Exception:
                stmt.set("limit", exp.Limit(expression=exp.Literal.number(self.config.row_limit)))

        return stmt.sql(dialect="sqlite")


# ── 3. ReadOnlyDatabase -- opens the SQLite file in mode=ro (OS-level
#    read-only, not just "we promise not to write"), runs the already-
#    validated SQL, returns columns + rows. ──
class ReadOnlyDatabase:
    def __init__(self, config: NLPDatabaseConfig):
        self.config = config

    def run(self, sql: str, params=()):
        con = sqlite3.connect(
            f"file:{self.config.db_path}?mode=ro", uri=True, timeout=QUERY_TIMEOUT_SECONDS
        )
        try:
            cur = con.cursor()
            cur.execute(sql, params)
            columns = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall()
            data = [dict(zip(columns, row)) for row in rows]
            return columns, data
        finally:
            con.close()


# ── 4. ChartPlanner -- validates Gemini's suggested chart against what
#    was actually returned; degrades to table-only rather than ever
#    rendering something misleading (e.g. a line chart over unordered
#    barangay names). ──
class ChartPlanner:
    # No legitimate time/ordered axis exists anywhere in this dataset
    # (barangay is categorical, cluster_id is an arbitrary k-modes label) --
    # so unlike the skill doc's general guidance, "line" is never valid
    # here and is always downgraded to "bar". Documented here rather than
    # guessed per-question.
    ALLOWED_CHART_TYPES = {"bar", "table"}

    def plan(self, chart_type, x, y, columns, data):
        if not data:
            return {"type": "table"}
        if chart_type not in self.ALLOWED_CHART_TYPES:
            chart_type = "bar" if chart_type == "line" else "table"
        if chart_type == "table":
            return {"type": "table"}
        if x not in columns or y not in columns:
            return {"type": "table"}
        # y must actually be numeric in the returned data to chart it.
        sample = next((row[y] for row in data if row.get(y) is not None), None)
        if not isinstance(sample, (int, float)):
            return {"type": "table"}
        return {"type": "bar", "x": x, "y": y}


# ── Prompts ──────────────────────────────────────────────────────────
PLANNER_SYSTEM_INSTRUCTION = """You write ONE read-only SQLite SELECT query that answers a question about the 24 barangays of San Miguel, Iloilo, using ONLY the tables, columns and values in the schema you are given.

THE DATA
- vw_barangay_vulnerability: one row per barangay. Social Vulnerability Index (SVI): svi_score (0-1300), svi_rank (1 = MOST vulnerable), svi_tier ('High' = rank 1-6, 'Moderate-high' 7-12, 'Moderate-low' 13-18, 'Low' 19-24) and its 13 indicator percentages, plus counts (households, population, pwd_count, senior_count, solo_parent_count) and distance to the RHU / fire station (distance is part of SVI, NOT capacity).
- vw_barangay_capacity: one row per barangay. Barangay Capacity: capacity_score (0-100, HIGHER = BETTER equipped), capacity_rank (1 = BEST equipped, 24 = least equipped -- the OPPOSITE direction to svi_rank), capacity_tier, and each resource: yes/no items are 1/0 (has_disaster_committee, has_response_team, has_emergency_hotline, held_preparedness_seminar, has_drrm_plan, has_evacuation_map, has_hazard_map); count items are numbers (first_aid_kits, ambulances, generators, sirens, two_way_radios, emergency_lights, heavy_equipment, boats_vans_buses, amphibian_vehicles, schools, evacuation_centres); drrm_expenditure_php is pesos spent in 2023.
- vw_hazard_exposure: one row per barangay. Flood (flood_high_or_very_high_*) and landslide (landslide_moderate_or_high_*) household counts and % of all households. Flood and landslide are separate; never add them.
- vw_household_typology: FIVE rows per barangay (one per household profile, cluster_id 0-4) with n_households, pct (share of that barangay's households) and is_dominant_cluster (1 for the largest profile). Filter on cluster_id or is_dominant_cluster = 1 to get one row per barangay.
- vw_barangay_priority: one row per barangay. svi_flagged (svi_rank <= 12), capacity_flagged (capacity_rank >= 13), hazard_flagged (>= 25% of households in a high flood or landslide zone) and domains_flagged (0-3, a COUNT of flags, not a score).

RULES
1. One SELECT (WITH ... SELECT and UNION ALL are allowed). Never INSERT/UPDATE/DELETE/DROP/ATTACH/PRAGMA.
2. Use only real column names. Join views ON a.psgc_10d = b.psgc_10d and give every table an alias.
3. Always return the barangay column plus every column you filter, sort or compute on, so the reader can see why each row is there. Give computed columns a clear alias (e.g. AS average_svi_score).
4. Words to columns: "most vulnerable" -> ORDER BY svi_rank ASC; "least equipped", "weakest capacity", "biggest capacity gaps", "low capacity" -> ORDER BY capacity_score ASC; "best equipped" -> ORDER BY capacity_score DESC. "high SVI" = svi_rank <= 12; "low capacity" = capacity_rank >= 13; "highly exposed" = >= 25% in a high flood or landslide zone. "no X" / "without X" for a resource -> COALESCE(col, 0) = 0.
5. SVI, capacity and hazard are SEPARATE domains: show them as separate columns side by side; never add, average, multiply or weight them into one number. If the question asks for a combined or overall score, return an empty sql and say in title that the domains are kept separate.
6. Use the exact barangay spelling from BARANGAY NAMES ('Santo Angel', not 'Sto. Angel'; 'Bgy. 5 Pob.' for "barangay 5"). Use the exact text values listed for tier and label columns.
7. "Average"/"total" across the municipality: aggregate the 24 barangay rows (AVG/SUM) and say in title that each barangay counts once. For a municipality-wide percentage of households, compute SUM(count)/SUM(households)*100 instead of averaging percentages.
8. Add LIMIT only when the question asks for a number of rows ("top 5"); "which barangay has the highest" -> LIMIT 1 but keep ties by using WHERE col = (SELECT MAX(col) ...). Otherwise return all matching rows, ordered sensibly.
9. Round computed decimals with ROUND(x, 2).
10. The data is ONE survey (CBMS) -- there are no years, dates or trends except the 2023 DRRM spending. If the question needs data that is not in the schema (trends, money other than DRRM spending, individual names, anything outside San Miguel), return an empty sql and explain in title what is missing.
11. chart_type 'bar' only when there is one numeric column to compare across barangays (x = 'barangay'); otherwise 'table'. Never 'line'.

EXAMPLES
Q: Which barangays have a high SVI but low capacity?
SQL: SELECT v.barangay, v.svi_rank, v.svi_tier, c.capacity_rank, c.capacity_tier FROM vw_barangay_vulnerability v JOIN vw_barangay_capacity c ON c.psgc_10d = v.psgc_10d WHERE v.svi_rank <= 12 AND c.capacity_rank >= 13 ORDER BY v.svi_rank
Q: Which flood-exposed barangays have no evacuation map?
SQL: SELECT h.barangay, h.flood_high_or_very_high_pct_total, c.has_evacuation_map FROM vw_hazard_exposure h JOIN vw_barangay_capacity c ON c.psgc_10d = h.psgc_10d WHERE h.flood_high_or_very_high_pct_total >= 25 AND COALESCE(c.has_evacuation_map, 0) = 0 ORDER BY h.flood_high_or_very_high_pct_total DESC
Q: What share of all households in San Miguel are in a high flood zone?
SQL: SELECT ROUND(SUM(flood_high_or_very_high_households) * 100.0 / SUM(households), 2) AS pct_of_all_households, SUM(flood_high_or_very_high_households) AS households_in_high_flood_zones, SUM(households) AS total_households FROM vw_hazard_exposure
Q: Compare Santo Angel and San Jose.
SQL: SELECT v.barangay, v.svi_score, v.svi_rank, c.capacity_score, c.capacity_rank, h.flood_high_or_very_high_pct_total, h.landslide_moderate_or_high_pct_total FROM vw_barangay_vulnerability v JOIN vw_barangay_capacity c ON c.psgc_10d = v.psgc_10d JOIN vw_hazard_exposure h ON h.psgc_10d = v.psgc_10d WHERE v.barangay IN ('Santo Angel', 'San Jose')
Q: In which barangays is 'Compounded deprivation' the dominant profile?
SQL: SELECT barangay, cluster_label, pct FROM vw_household_typology WHERE is_dominant_cluster = 1 AND cluster_id = 4 ORDER BY pct DESC
"""

PLANNER_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "description": "one short phrase describing the question's intent"},
        "sql": {"type": "string", "description": "the SELECT query, or empty string if unanswerable"},
        "title": {"type": "string", "description": "a short human-readable title for the result"},
        "chart_type": {"type": "string", "enum": ["bar", "table"]},
        "x": {"type": "string", "description": "column name for the chart's category axis, or empty string"},
        "y": {"type": "string", "description": "column name for the chart's value axis, or empty string"},
    },
    "required": ["intent", "sql", "title", "chart_type", "x", "y"],
}

EXPLAINER_SYSTEM_INSTRUCTION = (
    "You explain the result of an already-executed, already-validated SQL "
    "query against a barangay vulnerability analytical database. You are "
    "given the original question and the returned rows (already correct, "
    "already computed -- you do not recompute anything). "
    "Rules: explain only what is directly supported by the given rows; do "
    "not invent values, causes, trends, thresholds, or recommendations not "
    "grounded in the data shown; do not silently recombine separate domains "
    "(SVI and Capacity stay separate even if both appear in the result); if "
    "the result is empty, say so plainly rather than guessing why; write at "
    "most 3 short sentences, plain paragraph, no markdown, no bullet points; "
    "write numbers rounded to at most 1 decimal place, write any column whose "
    "name contains 'pct' as a percentage with a % sign (2.18 -> 2.2%), and "
    "use plain words for column names (flood_high_or_very_high_pct_total -> "
    "'share of households in a High or Very High flood zone'); if the question "
    "asks about two measures and the rows answer only one of them, say which "
    "part the rows answer; "
    "never use the words 'flagged', 'priority' or 'at risk' unless a returned "
    "column is literally named that way, and never describe a barangay as "
    "vulnerable, safe or high-risk beyond what the returned columns state; "
    "remember capacity_rank 1 = BEST equipped while svi_rank 1 = MOST vulnerable; "
    "name every barangay that the rows contain when there are 8 or fewer, otherwise name "
    "the first few and give the count; never mention SQL, tables or column names."
)

REPAIR_HINT = (
    "Your previous query for this question did not work: {problem}\n"
    "Previous SQL: {sql}\n"
    "Write a corrected query that follows every rule. Use only columns listed in the schema."
)


def _round_rows(rows):
    """Tidy floats for display (the DB stores up to 4 decimals)."""
    out = []
    for r in rows:
        out.append({k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()})
    return out


class NLPDatabaseEngine:
    def __init__(self, config: NLPDatabaseConfig = None):
        self.config = config or NLPDatabaseConfig.from_env()
        self.catalog = SchemaCatalog(self.config)
        self.validator = SQLValidator(self.config)
        self.db = ReadOnlyDatabase(self.config)
        self.chart_planner = ChartPlanner()
        self.households = nlp_households.HouseholdData()

    def ask(self, question: str) -> dict:
        """Never raises. Always returns a structured result dict; failures
        show up as warnings/explanation text, not exceptions, so the route
        can always return 200 with something useful to display."""
        result = {
            "question": question, "intent": None, "title": None, "sql": None,
            "columns": [], "data": [], "chart": {"type": "table"}, "explanation": None,
            "warnings": [], "source": None, "sections": [], "suggestions": [],
        }

        if not question or not question.strip():
            result["warnings"].append("No question was provided.")
            return result

        self._ensure_current()

        schema_text, err = self.catalog.describe()
        if err:
            result["warnings"].append(err)
            return result

        # 0) Household / family-network questions -> production DB, read-only.
        #    Gemini never sees household data (see nlp_households.py).
        norm = nlp_questions.normalize(question)
        if norm not in nlp_questions._FIXED and nlp_households.is_household_question(norm):
            return self._answer_household(question, norm, result)

        # 1) Ready-made library: no Gemini, instant, works offline.
        barangays = self._barangay_names()
        plan, refusal = nlp_questions.plan_question(question, barangays)
        if refusal:
            result["title"] = ("Not available in this data" if refusal in (nlp_questions.TREND_REFUSAL, nlp_questions.WRITE_REFUSAL)
                               else "SVI, Capacity and Hazard stay separate")
            result["explanation"] = refusal
            result["source"] = "library"
            result["suggestions"] = nlp_questions.suggestions_for("flagged in domains")[:3]
            return result
        if plan:
            return self._answer_from_plan(question, plan, result)

        # 2) Free-typed question -> Gemini query planner, with one repair
        #    round: if the SQL is rejected, fails to run, or a name filter
        #    matches nothing, Gemini is told exactly why and tries again.
        prompt = f"DATABASE SCHEMA:\n{schema_text}\n\nQUESTION: {question}"
        plan, plan_err = self._plan(prompt)
        if plan_err:
            result["title"] = "Couldn't answer that one automatically"
            result["warnings"].append(
                f"The AI assistant is unavailable right now ({plan_err.rstrip('.')}). "
                "The ready-made questions still work without it."
            )
            result["suggestions"] = nlp_questions.suggestions_for(question)
            return result

        result["source"] = "gemini"
        attempt = 0
        while True:
            result["intent"] = plan.get("intent")
            result["title"] = plan.get("title") or question
            raw_sql = (plan.get("sql") or "").strip()
            if not raw_sql:
                result["warnings"].append(
                    plan.get("title") or "This question can't be answered from the approved analytical views."
                )
                result["suggestions"] = nlp_questions.suggestions_for(question)
                return result
            problem = None
            try:
                safe_sql = self.validator.validate(self._fix_literals(raw_sql, barangays))
                columns, data = self.db.run(safe_sql)
                if not data and self._has_text_filter(safe_sql):
                    problem = ("it returned no rows; check that every text value in WHERE is spelled exactly as in "
                               "BARANGAY NAMES or the listed column values")
            except SQLValidationError as e:
                problem = f"it was rejected by the safety check ({e})"
            except Exception as e:
                problem = f"it failed to run in SQLite ({e})"
            if problem is None or attempt >= 1:
                break
            attempt += 1
            fixed, err = self._plan(prompt + "\n\n" + REPAIR_HINT.format(problem=problem, sql=raw_sql))
            if err or not fixed:
                break
            plan = fixed
        if problem and not (problem.startswith("it returned no rows")):
            result["warnings"].append(f"The AI's query could not be used: {problem}. Try rephrasing, or pick a ready-made question.")
            result["suggestions"] = nlp_questions.suggestions_for(question)
            return result

        result["sql"] = safe_sql
        result["routed_by_ai"] = True
        if attempt:
            result["repaired"] = True

        data = _round_rows(data)
        result["columns"] = columns
        result["data"] = data
        result["chart"] = self.chart_planner.plan(
            plan.get("chart_type"), plan.get("x"), plan.get("y"), columns, data
        )
        result["column_labels"] = self.catalog.labels(columns)

        if not data:
            result["explanation"] = "No rows matched this question in the approved analytical views."
            return result

        # Second, separate Gemini call: explain only the returned rows.
        # Capped sample so a large result doesn't blow the prompt budget --
        # the row cap (ROW_LIMIT) already keeps results small regardless.
        sample_rows = data[:25]
        glossary = "; ".join(f"{c} = {l}" for c, l in result["column_labels"].items() if l)
        explanation, exp_err = call_gemini(
            EXPLAINER_SYSTEM_INSTRUCTION,
            f"QUESTION: {question}\n\nWHAT THE COLUMNS MEAN: {glossary or 'see names'}\n\n"
            f"FILTER AND ORDER USED: {self._where_order(safe_sql)}\n\n"
            f"RETURNED ROWS ({len(data)} total, showing up to 25):\n{sample_rows}",
            generation_config={"temperature": 0.1},
        )
        if exp_err or not (explanation or "").strip():
            result["explanation"] = self._plain_summary(data, result["column_labels"])
        else:
            result["explanation"] = explanation.strip()

        return result

    _checked = False

    def _ensure_current(self):
        """Rebuild data/nlp_analytics.sqlite once if it was made by an older
        version of build_nlp_views.py (no vw_barangay_capacity view), so an
        updated app answers from the current capacity model without anyone
        re-importing. Only reads the domain-pipeline CSVs; never fails a question."""
        if NLPDatabaseEngine._checked:
            return
        NLPDatabaseEngine._checked = True
        try:
            if os.path.exists(self.config.db_path):
                con = sqlite3.connect(f"file:{self.config.db_path}?mode=ro", uri=True)
                have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                con.close()
                if "vw_barangay_capacity" in have:
                    return
            import build_nlp_views
            if os.path.abspath(build_nlp_views.DB_PATH) != os.path.abspath(self.config.db_path):
                return
            build_nlp_views.build()
        except Exception as e:  # pragma: no cover
            print(f"[nlp] could not refresh the analytical views: {e}")

    # ── AI planner helpers ──────────────────────────────────────────────
    @staticmethod
    def _plan(prompt):
        plan, err = call_gemini(
            PLANNER_SYSTEM_INSTRUCTION, prompt,
            generation_config={"temperature": 0},
            response_schema=PLANNER_RESPONSE_SCHEMA,
        )
        if err:
            return None, err
        if not isinstance(plan, dict):
            return None, "the AI returned an unreadable plan"
        return plan, None

    _TEXT_COLS = {"barangay", "svi_tier", "capacity_tier", "cluster_label"}

    def _fix_literals(self, sql, barangays):
        """Snap text values to the database's exact spelling before running:
        'Sto. Angel' / 'barangay 5' -> the real barangay name, 'low capacity'
        -> 'Low capacity'. Only literals compared with a known text column are
        touched; nothing else in the query changes."""
        try:
            tree = sqlglot.parse_one(sql, read="sqlite")
        except Exception:
            return sql
        known = self._known_values()
        changed = False
        for lit in tree.find_all(exp.Literal):
            if not lit.is_string:
                continue
            parent = lit.parent
            while isinstance(parent, (exp.Tuple, exp.Paren)):
                parent = parent.parent
            col = parent.find(exp.Column) if isinstance(parent, (exp.EQ, exp.NEQ, exp.In, exp.Like, exp.ILike)) else None
            if col is None or col.name not in self._TEXT_COLS:
                continue
            val = lit.this
            if col.name == "barangay":
                if val in barangays:
                    continue
                hit = nlp_questions._find_barangay(val, barangays) or nlp_questions._find_barangay("barangay " + val, barangays)
            else:
                hit = next((k for k in known.get(col.name, []) if k.lower() == val.strip().lower()), None)
            if hit and hit != val:
                lit.replace(exp.Literal.string(hit))
                changed = True
        return tree.sql(dialect="sqlite") if changed else sql

    def _known_values(self):
        out = {}
        for col, table in (("svi_tier", "vw_barangay_vulnerability"), ("capacity_tier", "vw_barangay_capacity"),
                           ("cluster_label", "vw_household_typology")):
            try:
                _, rows = self.db.run(f"SELECT DISTINCT {col} AS v FROM {table}")
                out[col] = [r["v"] for r in rows if r["v"]]
            except Exception:
                out[col] = []
        return out

    @staticmethod
    def _has_text_filter(sql):
        try:
            tree = sqlglot.parse_one(sql, read="sqlite")
            where = tree.find(exp.Where)
            return bool(where and any(l.is_string for l in where.find_all(exp.Literal)))
        except Exception:
            return False

    @staticmethod
    def _where_order(sql):
        try:
            tree = sqlglot.parse_one(sql, read="sqlite")
            parts = []
            w = tree.find(exp.Where)
            if w:
                parts.append("WHERE " + w.this.sql(dialect="sqlite"))
            o = tree.find(exp.Order)
            if o:
                parts.append(o.sql(dialect="sqlite"))
            return " ".join(parts) or "none (all rows)"
        except Exception:
            return "unknown"

    @staticmethod
    def _plain_summary(data, labels):
        """Used when the AI explainer is unavailable: a factual line built
        from the rows only."""
        if not data:
            return "No rows matched this question."
        cols = list(data[0].keys())
        if "barangay" not in cols:
            r = data[0]
            return "Result: " + "; ".join(f"{labels.get(k) or k.replace('_', ' ')} = {nlp_questions._fmt(v)}" for k, v in r.items()) + "."
        names = [str(r["barangay"]) for r in data]
        shown = nlp_questions._join(names[:8]) + (f" and {len(names) - 8} more" if len(names) > 8 else "")
        return f"{len(names)} barangay{'s' if len(names) != 1 else ''} matched: {shown}.".replace("..", ".")

    # ── library helpers ─────────────────────────────────────────────────
    def _barangay_names(self):
        try:
            _, rows = self.db.run("SELECT barangay FROM vw_barangay_vulnerability ORDER BY barangay")
            return [r["barangay"] for r in rows]
        except Exception:
            return []

    @staticmethod
    def _display_sql(sql, params):
        """SQL shown in the 'Show query' box: bound values written in (they
        always come from the database's own list of barangay names)."""
        out = sql
        for p in params:
            out = out.replace("?", "'" + str(p).replace("'", "''") + "'", 1)
        return out

    def _answer_from_plan(self, question, plan, result):
        result["source"] = "library"
        result["intent"] = plan["kind"]
        result["title"] = plan["title"]
        try:
            if plan["kind"] == "profile":
                sections = []
                shown_sql = []
                for title, domain, sql, params in nlp_questions.profile_queries(plan["barangay"]):
                    cols, data = self.db.run(sql, params)
                    sections.append({"title": title, "domain": domain, "columns": cols, "data": _round_rows(data)})
                    shown_sql.append(self._display_sql(sql, params))
                result["sections"] = sections
                result["sql"] = ";\n\n".join(shown_sql) + ";"
                if not any(s["data"] for s in sections):
                    result["warnings"].append(f"No data found for {plan['barangay']}.")
                else:
                    result["explanation"] = nlp_questions.profile_summary(plan["barangay"], sections)
                return result

            params = plan.get("params", ())
            columns, data = self.db.run(plan["sql"], params)
        except Exception as e:
            result["warnings"].append(f"Query execution failed: {e}")
            return result

        result["sql"] = self._display_sql(plan["sql"], plan.get("params", ()))
        data = _round_rows(data)
        result["columns"] = columns
        result["data"] = data
        ctype, x, y = plan.get("chart", ("table", None, None))
        result["chart"] = self.chart_planner.plan(ctype, x, y, columns, data)
        result["explanation"] = nlp_questions.summarize(plan, data)
        return result

    # ── household questions ─────────────────────────────────────────────
    def household_examples(self):
        return nlp_households.household_examples(self.households)

    def _answer_household(self, question, norm, result):
        result["source"] = "household"
        create = nlp_households.CREATE_REQUEST.search(norm)
        names = nlp_households.NAME_REQUEST.search(norm)
        if create or names:
            result["title"] = "Can't create households" if create else "Names are not shown here"
            result["explanation"] = nlp_households.CREATE_MESSAGE if create else nlp_households.NAME_MESSAGE
            if create and names:
                result["explanation"] += " " + nlp_households.NAME_MESSAGE.split(". ")[0] + "."
            result["suggestions"] = ["Show household HH11 in Consolacion",
                                     "Which households in high hazard zones have senior or PWD members?",
                                     "Which seniors or PWD are living alone?"]
            return result
        try:
            data = self.households.get()
        except Exception as e:
            result["title"] = "Household records are unavailable"
            result["warnings"].append(f"Could not read household records from the database: {e}")
            return result

        barangay = nlp_questions._find_barangay(question, data["barangays"])
        norm_n = re.sub(r"\b(bgy|barangay)\s*\d+\b", " ", norm)
        template, params = nlp_households.match_template(norm_n)
        routed_by_ai = False
        if template is None:
            template, params, err = nlp_households.route_with_gemini(question, call_gemini)
            routed_by_ai = template is not None
            if template and not barangay and params.get("barangay_text"):
                barangay = nlp_questions._find_barangay(params["barangay_text"], data["barangays"])
            if template is None:
                result["title"] = "Couldn't match that to a household question"
                msg = ("Try one of the household questions below, or rephrase with words like "
                       "'households', 'flood', 'seniors', 'PWD', 'dependents' or a household code such as HH23.")
                if err:
                    msg = f"The AI assistant is unavailable right now ({err.rstrip('.')}). " + msg
                result["warnings"].append(msg)
                result["suggestions"] = self.household_examples()["questions"][:5]
                return result

        out = nlp_households.run_template(template, params, data, barangay)
        result["intent"] = template
        result["title"] = out["title"]
        result["columns"] = out["columns"]
        result["data"] = _round_rows(out["data"])
        result["sections"] = out["sections"]
        result["warnings"].extend(out["warnings"])
        result["explanation"] = out["explanation"]
        result["sql"] = nlp_households.HouseholdData.SOURCE_SQL
        result["routed_by_ai"] = routed_by_ai
        if not out["data"] and not out["sections"] and not out["warnings"]:
            result["explanation"] = out["explanation"] or "No household matched this question."
        return result
