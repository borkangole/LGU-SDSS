--
-- PostgreSQL database dump
--

\restrict eyIlPlEriMs8tlfdsMQ8qYXwqdjA87X5p0323Nl18g2BZ5OKuKV4ft5WnvkqgGs

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: update_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: stg_cbms2024_households; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stg_cbms2024_households (
    household_uuid text,
    household_number text,
    barangay_name text,
    region_code text,
    province_code text,
    city_mun_code text,
    barangay_code text,
    husn text,
    hsn text,
    longitude numeric,
    latitude numeric,
    hh_size integer,
    housing_material text,
    housing_roof text,
    housing_floor text,
    tenure_status text,
    has_electricity boolean,
    o12_fuel_for_lighting text,
    o13_fuel_for_cooking text,
    water_source text,
    water_service_level text,
    toilet_type text,
    toilet_service_level text,
    surveyed_date date,
    monthly_income numeric,
    household_estimated_income numeric,
    income_basis text,
    asset_premium_pct numeric,
    flood_exposure text,
    landslide_exposure text,
    hazard_exposure_score numeric,
    compound_hazard text,
    hazard_data_status text,
    is_4ps_beneficiary text,
    overcrowding_status text,
    food_insecurity_score numeric,
    has_formal_financial_account text,
    has_social_insurance text,
    knows_evacuation_location text,
    knows_emergency_hotline text,
    pwd_count integer,
    senior_count integer,
    solo_parent_count integer,
    avg_education_level_adults numeric,
    employed_count integer,
    working_age_count integer,
    dependency_count integer,
    dependency_ratio numeric,
    employment_rate_adults numeric
);


--
-- Name: stg_cbms2024_individuals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stg_cbms2024_individuals (
    household_uuid text,
    person_code text,
    line_number text,
    last_name text,
    first_name text,
    suffix text,
    middle_name text,
    age integer,
    birthday_month text,
    birthday_day text,
    birthday_year text,
    age_group_five_years text,
    civil_status text,
    religion text,
    nuclear_family text,
    relation_to_nuclear_family_head text,
    with_pwd_id text,
    employment_status text,
    estimated_monthly_income numeric,
    occupation text,
    monthly_income numeric,
    is_senior boolean,
    is_pwd boolean,
    is_solo_parent boolean,
    is_4ps boolean,
    relationship_to_hh text,
    is_household_head boolean,
    full_name text,
    gender text,
    educational_attainment text
);


--
-- Name: stg_cbms2024_vulnerability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stg_cbms2024_vulnerability (
    household_uuid text,
    barangay_name text,
    exposure_score numeric,
    sensitivity_score numeric,
    adaptive_capacity_score numeric,
    vuln_score numeric,
    vuln_category text,
    resil_score numeric,
    resil_category text,
    normalized_income_score numeric,
    total_members integer,
    pwd_count integer,
    senior_count integer,
    solo_parent_count integer,
    fourps_count integer
);


--
-- Name: stg_new_cleaned; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stg_new_cleaned (
    barangay text,
    node_id text,
    hh_no text,
    hh_m text,
    household_members text,
    relationship_to_hh text,
    relationship_category text,
    gender text,
    age integer,
    civil_status text,
    occupation text,
    educational_attainment text,
    estimated_family_income_monthly numeric(12,2),
    is_senior boolean,
    is_pwd boolean,
    is_solo_parent boolean,
    water_source text,
    has_electricity boolean,
    toilet_type text,
    housing_material text,
    tenure_status text,
    network_source text,
    network_target text,
    edge_type text,
    is_4ps boolean,
    unique_hh_id text
);


--
-- Name: tbl_barangay_hh_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_barangay_hh_counter (
    barangay_id integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);


--
-- Name: tbl_barangay_vulnerability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_barangay_vulnerability (
    brgy_vuln_id integer NOT NULL,
    barangay_id integer,
    barangay_name character varying(100),
    total_households integer,
    avg_vuln_score numeric(8,4),
    avg_resil_score numeric(6,4),
    avg_exposure numeric(6,4),
    avg_sensitivity numeric(6,4),
    avg_adaptive_capacity numeric(6,4),
    low_vuln_count integer,
    medium_vuln_count integer,
    high_vuln_count integer,
    very_high_vuln_count integer,
    high_resil_count integer,
    moderate_resil_count integer,
    low_resil_count integer,
    very_low_resil_count integer,
    risk_level character varying(20),
    computed_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_barangay_vulnerability_brgy_vuln_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_barangay_vulnerability_brgy_vuln_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_barangay_vulnerability_brgy_vuln_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_barangay_vulnerability_brgy_vuln_id_seq OWNED BY public.tbl_barangay_vulnerability.brgy_vuln_id;


--
-- Name: tbl_barangay_vulnerability_factor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_barangay_vulnerability_factor (
    barangay_id integer NOT NULL,
    barangay_name character varying(100),
    total_households integer,
    avg_vuln_score_factor numeric(6,4),
    avg_vuln_score_factor_pct numeric(6,2),
    low_count integer,
    moderate_count integer,
    high_count integer,
    very_high_count integer,
    vuln_category_factor character varying(20),
    computed_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_barangay_vulnerability_stage1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_barangay_vulnerability_stage1 (
    barangay_id integer NOT NULL,
    barangay_name character varying(100),
    total_households integer,
    avg_sensitivity numeric(6,4),
    avg_adaptive_capacity numeric(6,4),
    vuln_score numeric(6,4),
    vuln_category character varying(20),
    flagged_for_stage2 boolean,
    computed_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_barangays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_barangays (
    barangay_id integer NOT NULL,
    barangay_code character varying(20) NOT NULL,
    barangay_name character varying(100) NOT NULL,
    municipality character varying(100) DEFAULT 'San Miguel'::character varying,
    province character varying(100) DEFAULT 'Iloilo'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_barangays_barangay_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_barangays_barangay_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_barangays_barangay_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_barangays_barangay_id_seq OWNED BY public.tbl_barangays.barangay_id;


--
-- Name: tbl_families; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_families (
    family_id integer NOT NULL,
    household_id integer NOT NULL,
    family_size integer DEFAULT 0,
    num_children_0_5 integer DEFAULT 0,
    num_children_6_17 integer DEFAULT 0,
    num_working_age_18_59 integer DEFAULT 0,
    num_elderly_60_plus integer DEFAULT 0,
    num_pwd integer DEFAULT 0,
    total_family_income numeric(10,2) DEFAULT 0,
    per_capita_income numeric(10,2) DEFAULT 0,
    num_employed_members integer DEFAULT 0,
    has_senior boolean DEFAULT false,
    has_pwd boolean DEFAULT false,
    has_solo_parent boolean DEFAULT false,
    is_4ps_beneficiary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE tbl_families; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tbl_families IS 'Family units aggregated from individuals (Phase 2 - Network Analysis)';


--
-- Name: tbl_families_family_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_families_family_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_families_family_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_families_family_id_seq OWNED BY public.tbl_families.family_id;


--
-- Name: tbl_family_indexes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_family_indexes (
    index_id integer NOT NULL,
    family_id integer NOT NULL,
    economic_vulnerability numeric(4,3),
    health_vulnerability numeric(4,3),
    infrastructure_vulnerability numeric(4,3),
    demographic_vulnerability numeric(4,3),
    economic_resilience numeric(4,3),
    infrastructure_resilience numeric(4,3),
    health_resilience numeric(4,3),
    vulnerability_index numeric(5,2),
    vulnerability_level character varying(50),
    resilience_index numeric(5,2),
    resilience_level character varying(50),
    calculated_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE tbl_family_indexes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tbl_family_indexes IS 'Calculated vulnerability/resilience scores (Objective 3)';


--
-- Name: tbl_family_indexes_index_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_family_indexes_index_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_family_indexes_index_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_family_indexes_index_id_seq OWNED BY public.tbl_family_indexes.index_id;


--
-- Name: tbl_households; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_households (
    household_id integer NOT NULL,
    uid_internal character varying(50) NOT NULL,
    barangay_id integer,
    housing_material character varying(100),
    tenure_status character varying(100),
    has_electricity boolean DEFAULT false,
    water_source character varying(100),
    toilet_type character varying(100),
    surveyed_date date,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    monthly_income numeric(12,2) DEFAULT 0,
    flood_exposure text,
    landslide_exposure text,
    region_code text,
    province_code text,
    city_mun_code text,
    barangay_code text,
    husn text,
    hsn text,
    longitude numeric,
    latitude numeric,
    hh_size integer,
    housing_roof text,
    housing_floor text,
    o12_fuel_for_lighting text,
    o13_fuel_for_cooking text,
    water_service_level text,
    toilet_service_level text,
    hazard_exposure_score numeric,
    compound_hazard text,
    hazard_data_status text,
    income_basis text,
    household_estimated_income numeric,
    asset_premium_pct numeric,
    is_4ps_beneficiary text,
    overcrowding_status text,
    food_insecurity_score numeric,
    has_formal_financial_account text,
    has_social_insurance text,
    knows_evacuation_location text,
    knows_emergency_hotline text,
    pwd_count integer,
    senior_count integer,
    solo_parent_count integer,
    avg_education_level_adults numeric,
    employed_count integer,
    working_age_count integer,
    dependency_count integer,
    dependency_ratio numeric,
    employment_rate_adults numeric,
    household_number character varying(80),
    typology_cluster_id integer,
    typology_cluster_label character varying(100),
    ti_overcrowding boolean,
    ti_food_insecure boolean,
    ti_no_internet boolean,
    ti_weak_roof boolean,
    ti_weak_wall boolean,
    ti_insecure_tenure boolean,
    ti_unimproved_sanitation boolean,
    ti_low_adult_education_hh boolean,
    ti_large_household boolean,
    ti_financially_excluded boolean,
    ti_pwd_count_cat smallint,
    ti_senior_count_cat smallint,
    ti_solo_parent_count_cat smallint
);


--
-- Name: TABLE tbl_households; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tbl_households IS 'Housing units with infrastructure data from Excel import';


--
-- Name: COLUMN tbl_households.uid_internal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tbl_households.uid_internal IS 'Original Household_ID from Excel (e.g., HH00001)';


--
-- Name: tbl_households_household_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_households_household_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_households_household_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_households_household_id_seq OWNED BY public.tbl_households.household_id;


--
-- Name: tbl_individuals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_individuals (
    person_id integer NOT NULL,
    household_id integer NOT NULL,
    person_code character varying(50),
    age integer,
    civil_status character varying(50),
    occupation character varying(200),
    monthly_income numeric(10,2) DEFAULT NULL::numeric,
    is_senior boolean DEFAULT false,
    is_pwd boolean DEFAULT false,
    is_solo_parent boolean DEFAULT false,
    is_4ps boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    relationship_to_hh character varying(100),
    is_household_head boolean DEFAULT false,
    full_name character varying(200),
    gender character varying(20),
    educational_attainment character varying(100),
    line_number text,
    last_name text,
    first_name text,
    suffix text,
    middle_name text,
    birthday_month text,
    birthday_day text,
    birthday_year text,
    age_group_five_years text,
    religion text,
    nuclear_family text,
    relation_to_nuclear_family_head text,
    with_pwd_id text,
    employment_status text,
    estimated_monthly_income numeric,
    family_id integer
);


--
-- Name: TABLE tbl_individuals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tbl_individuals IS 'Individual household members (~28K records from Excel)';


--
-- Name: COLUMN tbl_individuals.person_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tbl_individuals.person_code IS 'Anonymous identifier: HH{household}_P{person_num}';


--
-- Name: COLUMN tbl_individuals.monthly_income; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tbl_individuals.monthly_income IS 'Some values may be NULL (blank in Excel)';


--
-- Name: tbl_individuals_person_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_individuals_person_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_individuals_person_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_individuals_person_id_seq OWNED BY public.tbl_individuals.person_id;


--
-- Name: tbl_network_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_network_edges (
    edge_id bigint NOT NULL,
    source_node text NOT NULL,
    target_node text NOT NULL,
    edge_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tbl_network_edges_edge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_network_edges_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_network_edges_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_network_edges_edge_id_seq OWNED BY public.tbl_network_edges.edge_id;


--
-- Name: tbl_sample_bvi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_sample_bvi (
    bvi_id integer NOT NULL,
    household_id integer,
    barangay_id integer,
    exposure_score numeric(6,4),
    sensitivity_score numeric(6,4),
    adaptive_capacity_score numeric(6,4),
    bvi_score numeric(8,4),
    bvi_category character varying(30),
    total_members integer,
    avg_edu_score numeric(6,4),
    computed_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_sample_bvi_bvi_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_sample_bvi_bvi_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_sample_bvi_bvi_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_sample_bvi_bvi_id_seq OWNED BY public.tbl_sample_bvi.bvi_id;


--
-- Name: tbl_system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_system_settings (
    key character varying(100) NOT NULL,
    value character varying(255) NOT NULL
);


--
-- Name: tbl_uid_reveal_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_uid_reveal_log (
    log_id integer NOT NULL,
    household_id integer NOT NULL,
    user_id integer NOT NULL,
    revealed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tbl_uid_reveal_log_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_uid_reveal_log_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_uid_reveal_log_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_uid_reveal_log_log_id_seq OWNED BY public.tbl_uid_reveal_log.log_id;


--
-- Name: tbl_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_users (
    user_id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(100),
    role character varying(20) DEFAULT 'admin'::character varying,
    is_active boolean DEFAULT true,
    failed_attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_users_user_id_seq OWNED BY public.tbl_users.user_id;


--
-- Name: tbl_vuln_classification_breaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_vuln_classification_breaks (
    id integer DEFAULT 1 NOT NULL,
    low_max numeric(6,4),
    moderate_max numeric(6,4),
    high_max numeric(6,4),
    computed_at timestamp without time zone DEFAULT now(),
    CONSTRAINT single_row CHECK ((id = 1))
);


--
-- Name: tbl_vulnerability_index; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_vulnerability_index (
    index_id integer NOT NULL,
    household_id integer,
    barangay_id integer,
    exposure_score numeric(6,4),
    sensitivity_score numeric(6,4),
    adaptive_capacity_score numeric(6,4),
    vuln_score numeric(8,4),
    vuln_category character varying(20),
    resil_score numeric(6,4),
    resil_category character varying(20),
    total_members integer,
    pwd_count integer,
    senior_count integer,
    solo_parent_count integer,
    computed_at timestamp without time zone DEFAULT now()
);


--
-- Name: tbl_vulnerability_index_factor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tbl_vulnerability_index_factor (
    household_id integer NOT NULL,
    sensitivity_factor_raw numeric(10,4),
    ac_factor_raw numeric(10,4),
    sensitivity_factor numeric(6,4),
    ac_factor numeric(6,4),
    vuln_score_factor numeric(6,4),
    vuln_category_factor character varying(20),
    computed_at timestamp without time zone DEFAULT now(),
    vuln_score_factor_pct numeric(6,2)
);


--
-- Name: tbl_vulnerability_index_index_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tbl_vulnerability_index_index_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tbl_vulnerability_index_index_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tbl_vulnerability_index_index_id_seq OWNED BY public.tbl_vulnerability_index.index_id;


--
-- Name: vw_barangay_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_barangay_stats AS
 SELECT b.barangay_id,
    b.barangay_name,
    count(DISTINCT h.household_id) AS num_households,
    count(i.person_id) AS num_individuals,
    COALESCE(avg(i.monthly_income), (0)::numeric) AS avg_income,
    sum(
        CASE
            WHEN i.is_senior THEN 1
            ELSE 0
        END) AS num_seniors,
    sum(
        CASE
            WHEN i.is_pwd THEN 1
            ELSE 0
        END) AS num_pwd,
    sum(
        CASE
            WHEN i.is_4ps THEN 1
            ELSE 0
        END) AS num_4ps
   FROM ((public.tbl_barangays b
     LEFT JOIN public.tbl_households h ON ((b.barangay_id = h.barangay_id)))
     LEFT JOIN public.tbl_individuals i ON ((h.household_id = i.household_id)))
  GROUP BY b.barangay_id, b.barangay_name
  ORDER BY b.barangay_name;


--
-- Name: vw_household_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_household_summary AS
SELECT
    NULL::integer AS household_id,
    NULL::character varying(50) AS household_number,
    NULL::character varying(100) AS barangay_name,
    NULL::character varying(100) AS housing_material,
    NULL::character varying(100) AS tenure_status,
    NULL::boolean AS has_electricity,
    NULL::character varying(100) AS water_source,
    NULL::character varying(100) AS toilet_type,
    NULL::bigint AS num_members,
    NULL::numeric AS total_income,
    NULL::numeric AS avg_income,
    NULL::bigint AS num_seniors,
    NULL::bigint AS num_pwd,
    NULL::bigint AS num_solo_parents,
    NULL::boolean AS is_4ps_household,
    NULL::timestamp without time zone AS created_at;


--
-- Name: vw_individuals_full; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_individuals_full AS
 SELECT i.person_id,
    i.person_code,
    i.age,
    i.civil_status,
    i.occupation,
    i.monthly_income,
    i.is_senior,
    i.is_pwd,
    i.is_solo_parent,
    i.is_4ps,
    h.uid_internal AS household_number,
    h.housing_material,
    h.has_electricity,
    h.water_source,
    h.toilet_type,
    b.barangay_name
   FROM ((public.tbl_individuals i
     JOIN public.tbl_households h ON ((i.household_id = h.household_id)))
     JOIN public.tbl_barangays b ON ((h.barangay_id = b.barangay_id)));


--
-- Name: vw_network_people; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_network_people AS
 SELECT ('NODE_'::text || s.node_id) AS node_id,
    s.unique_hh_id,
    s.barangay,
    s.household_members AS display_name,
    s.age,
    s.gender,
    COALESCE(s.is_pwd, false) AS is_pwd,
    COALESCE(s.is_senior, false) AS is_senior,
    s.hh_m,
    s.relationship_to_hh,
    s.relationship_category
   FROM public.stg_new_cleaned s
UNION ALL
 SELECT i.person_code AS node_id,
    hh.uid_internal AS unique_hh_id,
    b.barangay_name AS barangay,
    COALESCE(i.full_name, i.person_code) AS display_name,
    i.age,
    i.gender,
    COALESCE(i.is_pwd, false) AS is_pwd,
    COALESCE(i.is_senior, false) AS is_senior,
    i.relationship_to_hh AS hh_m,
    i.relationship_to_hh,
    NULL::text AS relationship_category
   FROM ((public.tbl_individuals i
     JOIN public.tbl_households hh ON ((hh.household_id = i.household_id)))
     JOIN public.tbl_barangays b ON ((b.barangay_id = hh.barangay_id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.stg_new_cleaned s
          WHERE (s.unique_hh_id = (hh.uid_internal)::text))));


--
-- Name: tbl_barangay_vulnerability brgy_vuln_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability ALTER COLUMN brgy_vuln_id SET DEFAULT nextval('public.tbl_barangay_vulnerability_brgy_vuln_id_seq'::regclass);


--
-- Name: tbl_barangays barangay_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangays ALTER COLUMN barangay_id SET DEFAULT nextval('public.tbl_barangays_barangay_id_seq'::regclass);


--
-- Name: tbl_families family_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_families ALTER COLUMN family_id SET DEFAULT nextval('public.tbl_families_family_id_seq'::regclass);


--
-- Name: tbl_family_indexes index_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_family_indexes ALTER COLUMN index_id SET DEFAULT nextval('public.tbl_family_indexes_index_id_seq'::regclass);


--
-- Name: tbl_households household_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_households ALTER COLUMN household_id SET DEFAULT nextval('public.tbl_households_household_id_seq'::regclass);


--
-- Name: tbl_individuals person_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_individuals ALTER COLUMN person_id SET DEFAULT nextval('public.tbl_individuals_person_id_seq'::regclass);


--
-- Name: tbl_network_edges edge_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_network_edges ALTER COLUMN edge_id SET DEFAULT nextval('public.tbl_network_edges_edge_id_seq'::regclass);


--
-- Name: tbl_sample_bvi bvi_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_sample_bvi ALTER COLUMN bvi_id SET DEFAULT nextval('public.tbl_sample_bvi_bvi_id_seq'::regclass);


--
-- Name: tbl_uid_reveal_log log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_uid_reveal_log ALTER COLUMN log_id SET DEFAULT nextval('public.tbl_uid_reveal_log_log_id_seq'::regclass);


--
-- Name: tbl_users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_users ALTER COLUMN user_id SET DEFAULT nextval('public.tbl_users_user_id_seq'::regclass);


--
-- Name: tbl_vulnerability_index index_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vulnerability_index ALTER COLUMN index_id SET DEFAULT nextval('public.tbl_vulnerability_index_index_id_seq'::regclass);


--
-- Name: tbl_barangay_hh_counter tbl_barangay_hh_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_hh_counter
    ADD CONSTRAINT tbl_barangay_hh_counter_pkey PRIMARY KEY (barangay_id);


--
-- Name: tbl_barangay_vulnerability tbl_barangay_vulnerability_barangay_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability
    ADD CONSTRAINT tbl_barangay_vulnerability_barangay_id_key UNIQUE (barangay_id);


--
-- Name: tbl_barangay_vulnerability_factor tbl_barangay_vulnerability_factor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability_factor
    ADD CONSTRAINT tbl_barangay_vulnerability_factor_pkey PRIMARY KEY (barangay_id);


--
-- Name: tbl_barangay_vulnerability tbl_barangay_vulnerability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability
    ADD CONSTRAINT tbl_barangay_vulnerability_pkey PRIMARY KEY (brgy_vuln_id);


--
-- Name: tbl_barangay_vulnerability_stage1 tbl_barangay_vulnerability_stage1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability_stage1
    ADD CONSTRAINT tbl_barangay_vulnerability_stage1_pkey PRIMARY KEY (barangay_id);


--
-- Name: tbl_barangays tbl_barangays_barangay_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangays
    ADD CONSTRAINT tbl_barangays_barangay_code_key UNIQUE (barangay_code);


--
-- Name: tbl_barangays tbl_barangays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangays
    ADD CONSTRAINT tbl_barangays_pkey PRIMARY KEY (barangay_id);


--
-- Name: tbl_families tbl_families_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_families
    ADD CONSTRAINT tbl_families_pkey PRIMARY KEY (family_id);


--
-- Name: tbl_family_indexes tbl_family_indexes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_family_indexes
    ADD CONSTRAINT tbl_family_indexes_pkey PRIMARY KEY (index_id);


--
-- Name: tbl_households tbl_households_display_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_households
    ADD CONSTRAINT tbl_households_display_code_key UNIQUE (household_number);


--
-- Name: tbl_households tbl_households_household_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_households
    ADD CONSTRAINT tbl_households_household_number_key UNIQUE (uid_internal);


--
-- Name: tbl_households tbl_households_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_households
    ADD CONSTRAINT tbl_households_pkey PRIMARY KEY (household_id);


--
-- Name: tbl_individuals tbl_individuals_person_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_individuals
    ADD CONSTRAINT tbl_individuals_person_code_key UNIQUE (person_code);


--
-- Name: tbl_individuals tbl_individuals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_individuals
    ADD CONSTRAINT tbl_individuals_pkey PRIMARY KEY (person_id);


--
-- Name: tbl_network_edges tbl_network_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_network_edges
    ADD CONSTRAINT tbl_network_edges_pkey PRIMARY KEY (edge_id);


--
-- Name: tbl_network_edges tbl_network_edges_source_node_target_node_edge_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_network_edges
    ADD CONSTRAINT tbl_network_edges_source_node_target_node_edge_type_key UNIQUE (source_node, target_node, edge_type);


--
-- Name: tbl_sample_bvi tbl_sample_bvi_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_sample_bvi
    ADD CONSTRAINT tbl_sample_bvi_household_id_key UNIQUE (household_id);


--
-- Name: tbl_sample_bvi tbl_sample_bvi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_sample_bvi
    ADD CONSTRAINT tbl_sample_bvi_pkey PRIMARY KEY (bvi_id);


--
-- Name: tbl_system_settings tbl_system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_system_settings
    ADD CONSTRAINT tbl_system_settings_pkey PRIMARY KEY (key);


--
-- Name: tbl_uid_reveal_log tbl_uid_reveal_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_uid_reveal_log
    ADD CONSTRAINT tbl_uid_reveal_log_pkey PRIMARY KEY (log_id);


--
-- Name: tbl_users tbl_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_users
    ADD CONSTRAINT tbl_users_pkey PRIMARY KEY (user_id);


--
-- Name: tbl_users tbl_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_users
    ADD CONSTRAINT tbl_users_username_key UNIQUE (username);


--
-- Name: tbl_vuln_classification_breaks tbl_vuln_classification_breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vuln_classification_breaks
    ADD CONSTRAINT tbl_vuln_classification_breaks_pkey PRIMARY KEY (id);


--
-- Name: tbl_vulnerability_index_factor tbl_vulnerability_index_factor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vulnerability_index_factor
    ADD CONSTRAINT tbl_vulnerability_index_factor_pkey PRIMARY KEY (household_id);


--
-- Name: tbl_vulnerability_index tbl_vulnerability_index_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vulnerability_index
    ADD CONSTRAINT tbl_vulnerability_index_household_id_key UNIQUE (household_id);


--
-- Name: tbl_vulnerability_index tbl_vulnerability_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vulnerability_index
    ADD CONSTRAINT tbl_vulnerability_index_pkey PRIMARY KEY (index_id);


--
-- Name: idx_families_household_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_families_household_id ON public.tbl_families USING btree (household_id);


--
-- Name: idx_family_household; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_family_household ON public.tbl_families USING btree (household_id);


--
-- Name: idx_household_barangay; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_household_barangay ON public.tbl_households USING btree (barangay_id);


--
-- Name: idx_household_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_household_number ON public.tbl_households USING btree (uid_internal);


--
-- Name: idx_index_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_index_family ON public.tbl_family_indexes USING btree (family_id);


--
-- Name: idx_individual_age; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_individual_age ON public.tbl_individuals USING btree (age);


--
-- Name: idx_individual_household; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_individual_household ON public.tbl_individuals USING btree (household_id);


--
-- Name: idx_individual_is_4ps; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_individual_is_4ps ON public.tbl_individuals USING btree (is_4ps);


--
-- Name: idx_individual_is_pwd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_individual_is_pwd ON public.tbl_individuals USING btree (is_pwd);


--
-- Name: idx_individual_is_senior; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_individual_is_senior ON public.tbl_individuals USING btree (is_senior);


--
-- Name: idx_individuals_family_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_individuals_family_id ON public.tbl_individuals USING btree (family_id);


--
-- Name: idx_individuals_household_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_individuals_household_id ON public.tbl_individuals USING btree (household_id);


--
-- Name: idx_network_edges_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_network_edges_source ON public.tbl_network_edges USING btree (source_node);


--
-- Name: idx_network_edges_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_network_edges_target ON public.tbl_network_edges USING btree (target_node);


--
-- Name: vw_household_summary _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_household_summary AS
 SELECT h.household_id,
    h.uid_internal AS household_number,
    b.barangay_name,
    h.housing_material,
    h.tenure_status,
    h.has_electricity,
    h.water_source,
    h.toilet_type,
    count(i.person_id) AS num_members,
    COALESCE(sum(i.monthly_income), (0)::numeric) AS total_income,
    COALESCE(avg(i.monthly_income), (0)::numeric) AS avg_income,
    sum(
        CASE
            WHEN i.is_senior THEN 1
            ELSE 0
        END) AS num_seniors,
    sum(
        CASE
            WHEN i.is_pwd THEN 1
            ELSE 0
        END) AS num_pwd,
    sum(
        CASE
            WHEN i.is_solo_parent THEN 1
            ELSE 0
        END) AS num_solo_parents,
    bool_or(i.is_4ps) AS is_4ps_household,
    h.created_at
   FROM ((public.tbl_households h
     LEFT JOIN public.tbl_barangays b ON ((h.barangay_id = b.barangay_id)))
     LEFT JOIN public.tbl_individuals i ON ((h.household_id = i.household_id)))
  GROUP BY h.household_id, b.barangay_name;


--
-- Name: tbl_families trg_family_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_family_update BEFORE UPDATE ON public.tbl_families FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: tbl_households trg_household_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_household_update BEFORE UPDATE ON public.tbl_households FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: tbl_individuals trg_individual_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_individual_update BEFORE UPDATE ON public.tbl_individuals FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: tbl_barangay_hh_counter tbl_barangay_hh_counter_barangay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_hh_counter
    ADD CONSTRAINT tbl_barangay_hh_counter_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES public.tbl_barangays(barangay_id);


--
-- Name: tbl_barangay_vulnerability tbl_barangay_vulnerability_barangay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability
    ADD CONSTRAINT tbl_barangay_vulnerability_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES public.tbl_barangays(barangay_id);


--
-- Name: tbl_barangay_vulnerability_factor tbl_barangay_vulnerability_factor_barangay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability_factor
    ADD CONSTRAINT tbl_barangay_vulnerability_factor_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES public.tbl_barangays(barangay_id);


--
-- Name: tbl_barangay_vulnerability_stage1 tbl_barangay_vulnerability_stage1_barangay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_barangay_vulnerability_stage1
    ADD CONSTRAINT tbl_barangay_vulnerability_stage1_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES public.tbl_barangays(barangay_id);


--
-- Name: tbl_families tbl_families_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_families
    ADD CONSTRAINT tbl_families_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.tbl_households(household_id) ON DELETE CASCADE;


--
-- Name: tbl_family_indexes tbl_family_indexes_family_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_family_indexes
    ADD CONSTRAINT tbl_family_indexes_family_id_fkey FOREIGN KEY (family_id) REFERENCES public.tbl_families(family_id) ON DELETE CASCADE;


--
-- Name: tbl_households tbl_households_barangay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_households
    ADD CONSTRAINT tbl_households_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES public.tbl_barangays(barangay_id) ON DELETE CASCADE;


--
-- Name: tbl_individuals tbl_individuals_family_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_individuals
    ADD CONSTRAINT tbl_individuals_family_id_fkey FOREIGN KEY (family_id) REFERENCES public.tbl_families(family_id);


--
-- Name: tbl_individuals tbl_individuals_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_individuals
    ADD CONSTRAINT tbl_individuals_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.tbl_households(household_id) ON DELETE CASCADE;


--
-- Name: tbl_sample_bvi tbl_sample_bvi_barangay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_sample_bvi
    ADD CONSTRAINT tbl_sample_bvi_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES public.tbl_barangays(barangay_id);


--
-- Name: tbl_sample_bvi tbl_sample_bvi_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_sample_bvi
    ADD CONSTRAINT tbl_sample_bvi_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.tbl_households(household_id) ON DELETE CASCADE;


--
-- Name: tbl_uid_reveal_log tbl_uid_reveal_log_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_uid_reveal_log
    ADD CONSTRAINT tbl_uid_reveal_log_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.tbl_households(household_id);


--
-- Name: tbl_uid_reveal_log tbl_uid_reveal_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_uid_reveal_log
    ADD CONSTRAINT tbl_uid_reveal_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tbl_users(user_id);


--
-- Name: tbl_vulnerability_index tbl_vulnerability_index_barangay_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vulnerability_index
    ADD CONSTRAINT tbl_vulnerability_index_barangay_id_fkey FOREIGN KEY (barangay_id) REFERENCES public.tbl_barangays(barangay_id);


--
-- Name: tbl_vulnerability_index_factor tbl_vulnerability_index_factor_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vulnerability_index_factor
    ADD CONSTRAINT tbl_vulnerability_index_factor_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.tbl_households(household_id) ON DELETE CASCADE;


--
-- Name: tbl_vulnerability_index tbl_vulnerability_index_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tbl_vulnerability_index
    ADD CONSTRAINT tbl_vulnerability_index_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.tbl_households(household_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict eyIlPlEriMs8tlfdsMQ8qYXwqdjA87X5p0323Nl18g2BZ5OKuKV4ft5WnvkqgGs

--
-- PostgreSQL database dump
--

\restrict 0Vn833ZAQWjd0SOGx5JQAQLy3bWOt2MCGNFdcIziYJVVFuBiw5177TH3gETOf40

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: tbl_barangays; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tbl_barangays (barangay_id, barangay_code, barangay_name, municipality, province, created_at, updated_at) FROM stdin;
14	BRGY-014	Brgy 7	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
15	BRGY-015	Brgy 8	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
16	BRGY-016	Brgy 9	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
17	BRGY-017	Brgy Consolacion	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
18	BRGY-018	Brgy Igtambo	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
19	BRGY-019	Brgy San Antonio	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
20	BRGY-020	Brgy San Jose	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
21	BRGY-021	Brgy Sta Cruz	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
22	BRGY-022	Brgy Sta Teresa	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
23	BRGY-023	Brgy Sto Angel	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
24	BRGY-024	Brgy Sto Nino	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
1	BRGY-001	Brgy 1	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
2	BRGY-002	Brgy 10	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
3	BRGY-003	Brgy 11	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
4	BRGY-004	Brgy 12	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
5	BRGY-005	Brgy 13	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
6	BRGY-006	Brgy 14	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
7	BRGY-007	Brgy 15	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
8	BRGY-008	Brgy 16	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
9	BRGY-009	Brgy 2	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
10	BRGY-010	Brgy 3	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
11	BRGY-011	Brgy 4	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
12	BRGY-012	Brgy 5	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
13	BRGY-013	Brgy 6	San Miguel	Iloilo	2026-02-22 02:17:31.466988	2026-02-22 02:17:31.466988
\.


--
-- Data for Name: tbl_system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tbl_system_settings (key, value) FROM stdin;
poverty_threshold	13801.0
\.


--
-- Data for Name: tbl_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tbl_users (user_id, username, password_hash, full_name, role, is_active, failed_attempts, locked_until, last_login, created_at) FROM stdin;
4	lgu	$2b$12$XVDQXdkrbp5M2iRpk2x20.eYJDP.XDOHpvDcm7UIO7akGmm5kmn9a	LGU Planning User	LGU Planning	t	0	\N	2026-05-19 12:52:30.742291	2026-05-18 20:19:16.417744
3	mswdo	$2b$12$fhZx1KHFZtj2aADBEY8D.Oe/03V2oGXsB8SB0PE7OnIY2Wz2JKg8S	MSWDO User	MSWDO	t	0	\N	2026-05-21 00:30:04.139342	2026-05-18 20:19:16.417744
2	admin	$2b$12$E2j41VxjncR2ql1DdZ0qfuHsa8Vka4Ikal.NqS7ncyUxSi1cBAQ2C	System Administrator	admin	t	0	\N	2026-09-30 18:58:12.7635	2026-03-04 17:38:31.466452
\.


--
-- Name: tbl_barangays_barangay_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tbl_barangays_barangay_id_seq', 24, true);


--
-- Name: tbl_users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tbl_users_user_id_seq', 37, true);


--
-- PostgreSQL database dump complete
--

\unrestrict 0Vn833ZAQWjd0SOGx5JQAQLy3bWOt2MCGNFdcIziYJVVFuBiw5177TH3gETOf40


UPDATE public.tbl_users SET failed_attempts = 0, locked_until = NULL, last_login = NULL;

DELETE FROM public.tbl_system_settings WHERE key = 'gemini_api_key';
