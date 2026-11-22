"""Study constants and attribute definitions.

This file is intentionally explicit so students can see which CBMS attributes
enter each calculation and how they are grouped.
"""

FOOD_SECURITY_COLUMNS = [
    "g01_worried",
    "g02_not_eaten_healthy",
    "g03_ate_few_food",
    "g04_skipped_meal",
    "g05_ate_less",
    "g06_ran_out_of_food",
    "g07_hungry",
    "g08_not_eaten_whole_day",
]

FINANCIAL_ACCOUNT_COLUMNS = [
    "i01_a_bank_account",
    "i01_b_digital_bank_account",
    "i01_c_emoney_or_cash_card",
    "i01_d_nssla",
    "i01_e_account_with_coop",
    "i01_f_microfinance",
]

# n08_toilet_facility codes treated as "unimproved". Per
# vulnerability_functions_1.pdf's exact delivered social_config (verified
# against sovi_indicators.csv/domainA_social_vulnerability.csv and
# re-verified end-to-end against the exact expected barangay scores):
# isin([14, 15, 23, 95]) -- an earlier version of this codebase used
# [14, 23, 95] (missing 15), a bug predating any of the recent Domain A
# corrections, now fixed to match the PDF exactly.
UNIMPROVED_TOILET_CODES = [14, 15, 23, 95]

# Order and membership match vulnerability_functions_1.pdf's ACTUAL
# delivered `social_config` dict verbatim (page ~28), NOT the "Domain A --
# Barangay-Level Scoring" slide screenshot, which an earlier pass here
# misread as including "no financial account". The PDF is Sir Shem's own
# source code, verified against his CSVs and presentation deck end-to-end,
# and it EXPLICITLY says (his comment, kept for the record):
#   "no_financial_account is intentionally NOT included in Domain A -- it
#   was used only in the household-level typology (see below), never in
#   the barangay-level Domain A score. Adding it here would silently
#   diverge from the already-delivered workbook and presentation deck
#   results."
# Indicator #10 is solo-parent (person_rate = % of the POPULATION who are
# solo parents), not financial exclusion. See vulnerability.py's module
# docstring for the full person_rate vs person_household distinction this
# PDF draws out, which also drove a second correction there.
CORE_SOCIAL_INDICATORS = [
    "overcrowding_prop",
    "food_insecure_prop",
    "no_internet_prop",
    "weak_roof_prop",
    "weak_wall_prop",
    "insecure_tenure_prop",
    "unimproved_sanitation_prop",
    "pwd_prop",
    "senior_prop",
    "solo_parent_prop",
    "low_adult_education_prop",
]

# Distance to help, as household vulnerability (Sir Shem, Domain B View 2
# slides + his follow-up: "the distance of the household is vulnerability of
# the household"; "proportion beyond 2km ... part of vulnerability"): the
# share of the barangay's households more than 2 km (straight line) from the
# RHU / fire station. The median distance in km is still computed and saved
# (rhu_median_km, fire_median_km) as a sensitivity check.
DISTANCE_THRESHOLD_KM = 2.0
ACCESS_INDICATORS = ["rhu_pct_beyond_2km", "fire_pct_beyond_2km"]
ACCESS_INDICATORS_MEDIAN = ["rhu_median_km", "fire_median_km"]

TYPOLOGY_FEATURES = [
    "overcrowding",
    "food_insecure",
    "no_internet",
    "weak_roof",
    "weak_wall",
    "insecure_tenure",
    "unimproved_sanitation",
    "pwd_count_cat",
    "senior_count_cat",
    "solo_parent_count_cat",
    "low_adult_education_hh",
    "large_household",
    "financially_excluded",
]

PRIMARY_BINARY_CAPACITY = {
    "Disaster management committee": "f02_disaster_committee",
    "Emergency response team": "f03_disaster_response",
    "Emergency hotline": "f04_disaster_hotline_presence",
    "Preparedness seminar past 12 months": "f13_conduct_seminars",
    # Readiness plans and maps (Sir Shem's Domain B slides; capacity =
    # "what the barangay has ... readiness of the barangay"). An item every
    # barangay has (the DRRM plan) is dropped automatically as zero-variance.
    "Barangay DRRM plan": "f01_disaster_plan",
    "Evacuation map": "f09_evacuation_map_presence",
    "Hazard map": "f11_hazard_map_presence",
}

# Facilities in the barangay (Sir Shem: capacity = "resources per barangay,
# like evacuation center, school, flashlight, ambulance"). Counted from the
# facility locations on the map (backend/facility_reference.json) by point-in-
# polygon against the barangay boundaries -- see facility_counts.py.
FACILITY_COUNT_CAPACITY = {
    "Schools": "facility_schools",
    "Evacuation centres": "facility_evacuation_centers",
}

PRIMARY_COUNT_CAPACITY = {
    "First-aid kits": "f16_a_first_aid_kits",
    "Boats/vans/buses": "f16_b_boats",
    "Ambulances": "f16_c_ambulance",
    "Amphibian vehicles": "f16_d_amphibian",
    "Heavy equipment": "f16_e_backhoe",
    "Sirens": "f16_f_siren",
    "Two-way radios/communications equipment": "f16_g_radio",
    "Portable/solar generators": "f16_h_generator",
    "Emergency lights": "f16_i_emergency_lights",
    "2023 DRRM expenditures (PHP)": "f17_drrm_expenditures",
}

CAPACITY_DIMENSIONS = {
    "organizational_response": (
        "f02_disaster_committee",
        "f03_disaster_response",
        "f04_disaster_hotline_presence",
        "f13_conduct_seminars",
    ),
    "plans_and_facilities": (
        "f01_disaster_plan",
        "f09_evacuation_map_presence",
        "f11_hazard_map_presence",
        "facility_schools",
        "facility_evacuation_centers",
    ),
    "medical_and_relief": ("f16_a_first_aid_kits",),
    "mobility_and_rescue": (
        "f16_b_boats",
        "f16_c_ambulance",
        "f16_d_amphibian",
        "f16_e_backhoe",
    ),
    "communications_and_power": (
        "f16_f_siren",
        "f16_g_radio",
        "f16_h_generator",
        "f16_i_emergency_lights",
    ),
    "fiscal_capacity": ("f17_drrm_expenditures",),
}

# Facility coordinates used in the current analysis.
RHU_LAT = 10.78155
RHU_LON = 122.46470
FIRE_LAT = 10.78698
FIRE_LON = 122.46827
EARTH_RADIUS_KM = 6371.0088

HAZARD_SPECS = [
    ("flood", "Flood.shp", "FloodSusc"),
    ("landslide", "Landslide.shp", "LndslideSu"),
    ("erosion_induced_landslide", "EIL.shp", "eildescrip"),
    ("liquefaction", "Liquifaction.shp", "d_lccode"),
]
