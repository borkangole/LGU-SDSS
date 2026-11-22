VALID_CIVIL_STATUS = [
    'Single', 'Married', 'Widowed',
    'Divorced', 'Separated', 'Live-in', 'Not Stated'
]

# ✅ Real CBMS values (from aligned_data_FINAL.csv, confirmed 2026-07-27) +
# legacy values kept so records saved under the old whitelist still validate.
VALID_HOUSING_MATERIAL = [
    # Real CBMS values (match compute_scores()'s wall_risk map)
    'Concrete/brick/stone', 'Fiber cement board',
    'Half concrete/brick/stone and half wood', 'Metal sheet',
    'Wood/bamboo', 'Sawali/cogon/nipa', 'Asbestos',
    'Makeshift/salvaged/improvised', 'Glass', 'Others', 'Not Stated',
    # Legacy / keep for backwards compat
    'Full Concrete', 'Concrete/Wood', 'Wood/Bamboo',
    'Concrete', 'Semi-Concrete', 'Wood', 'Bamboo',
    'Light Material', 'Mixed Material'
]

VALID_HOUSING_ROOF = [
    'Concrete/clay/slate tile', 'Half galvanized iron and half concrete',
    'Metal roofing sheets', 'Sod/thatch', 'Wood/bamboo', 'Not Stated',
]

VALID_HOUSING_FLOOR = [
    'Bamboo', 'Coconut lumber', 'Concrete', 'Earth/sand/mud',
    'Makeshift/salvaged/improvised', 'Wood', 'Not Stated',
]

VALID_LIGHTING_FUEL = [
    'Candle', 'Electricity', 'Kerosene (Gaas)', 'Solar Panel/Solar Lamp', 'Not Stated',
]

VALID_COOKING_FUEL = [
    'Charcoal', 'Electricity', 'Liquefied Petroleum Gas (LPG)', 'Wood', 'Not Stated',
]

VALID_TENURE_STATUS = [
    # Real CBMS values (o09_tenure)
    'Own house, rent lot',
    'Own house, rent-free lot with consent of owner',
    'Own house, rent-free lot without consent of owner',
    'Own or owner-like possession of the house and lot',
    'Rent house / room, including lot',
    'Rent-free house and lot with consent of owner',
    'Rent-free house and lot without consent of owner',
    'Not Stated',
    # Legacy
    'Owned', 'Being occupied for free',
    'Being occupied with consent of owner', 'Rented',
    'Owner', 'Renter', 'Rent-free with consent',
    'Rent-free without consent', 'Informal Settler', 'Others',
    'Rented/Lease', 'Being Amortized',
    'Being occupied without consent of owner',
]

VALID_WATER_SOURCE = [
    # Real CBMS values
    'Piped into dwelling', 'Piped into yard/plot', 'Protected spring',
    'Protected well/tube well/borehole', 'Public tap/standpipe', 'Rainwater',
    'Surface water', 'Tanker truck/peddler/neighbor', 'Unprotected open dug well',
    'Unprotected spring', 'Not Stated',
    # Legacy
    'Level 1', 'Level 2', 'Level 3',
    'Piped Water (Level 3)', 'Shared Faucet (Level 2)',
    'Open Well', 'Spring', 'River', 'Rain',
    'Bottled Water', 'Others'
]

VALID_TOILET_TYPE = [
    # Real CBMS values
    'Flush to open drain', 'Flush to pit latrine', 'Flush to septic tank',
    'Flush, unknown destination', 'Open defecation', 'Pit latrine with slab',
    'Pit latrine without slab/open pit', 'Ventilated improved latrine', 'Not Stated',
    # Legacy
    'Water Sealed(FLUSH) , Closed Pit', 'Water Sealed(FLUSH), Open Pit',
    'Water Sealed(Buhos), Closed Pit',  'Water Sealed(Buhos), Open Pit',
    'Communal (Shared)', 'Public Toilet', 'Share', 'No Facility/field',
    'Water Sealed - Septic Tank', 'Water Sealed - Others',
    'Closed Pit', 'Open Pit',
    'None/Open Defecation', 'Shared Toilet', 'Others'
]


def validate_household(data, is_update=False):
    errors = []

    if not is_update:
        if not data.get("household_number"):
            errors.append("household_number is required.")
        elif len(str(data["household_number"]).strip()) < 1:
            errors.append("household_number must not be empty.")

    if not data.get("barangay_id"):
        errors.append("barangay_id is required.")
    else:
        try:
            int(data["barangay_id"])
        except (ValueError, TypeError):
            errors.append("barangay_id must be a valid integer.")

    if data.get("housing_material") not in (None, "", "null"):
        if data["housing_material"] not in VALID_HOUSING_MATERIAL:
            errors.append(
                f"housing_material '{data['housing_material']}' is invalid. "
                f"Valid: {VALID_HOUSING_MATERIAL}"
            )

    if data.get("tenure_status") not in (None, "", "null"):
        if data["tenure_status"] not in VALID_TENURE_STATUS:
            errors.append(
                f"tenure_status '{data['tenure_status']}' is invalid. "
                f"Valid: {VALID_TENURE_STATUS}"
            )

    if data.get("water_source") not in (None, "", "null"):
        if data["water_source"] not in VALID_WATER_SOURCE:
            errors.append(
                f"water_source '{data['water_source']}' is invalid. "
                f"Valid: {VALID_WATER_SOURCE}"
            )

    if data.get("toilet_type") not in (None, "", "null"):
        if data["toilet_type"] not in VALID_TOILET_TYPE:
            errors.append(
                f"toilet_type '{data['toilet_type']}' is invalid. "
                f"Valid: {VALID_TOILET_TYPE}"
            )

    if data.get("housing_roof") not in (None, "", "null"):
        if data["housing_roof"] not in VALID_HOUSING_ROOF:
            errors.append(
                f"housing_roof '{data['housing_roof']}' is invalid. "
                f"Valid: {VALID_HOUSING_ROOF}"
            )

    if data.get("housing_floor") not in (None, "", "null"):
        if data["housing_floor"] not in VALID_HOUSING_FLOOR:
            errors.append(
                f"housing_floor '{data['housing_floor']}' is invalid. "
                f"Valid: {VALID_HOUSING_FLOOR}"
            )

    if data.get("o12_fuel_for_lighting") not in (None, "", "null"):
        if data["o12_fuel_for_lighting"] not in VALID_LIGHTING_FUEL:
            errors.append(
                f"o12_fuel_for_lighting '{data['o12_fuel_for_lighting']}' is invalid. "
                f"Valid: {VALID_LIGHTING_FUEL}"
            )

    if data.get("o13_fuel_for_cooking") not in (None, "", "null"):
        if data["o13_fuel_for_cooking"] not in VALID_COOKING_FUEL:
            errors.append(
                f"o13_fuel_for_cooking '{data['o13_fuel_for_cooking']}' is invalid. "
                f"Valid: {VALID_COOKING_FUEL}"
            )

    if "has_electricity" in data and data["has_electricity"] is not None:
        if not isinstance(data["has_electricity"], bool):
            errors.append("has_electricity must be true or false.")

    if data.get("monthly_income") is not None:
        try:
            income = float(data["monthly_income"])
            if income < 0:
                errors.append("monthly_income cannot be negative.")
        except (ValueError, TypeError):
            errors.append("monthly_income must be a valid number.")

    return len(errors) == 0, errors


def validate_individual(data, is_update=False):
    errors = []

    if data.get("age") is not None:
        try:
            age = int(data["age"])
            if age < 0 or age > 120:
                errors.append("age must be between 0 and 120.")
        except (ValueError, TypeError):
            errors.append("age must be a valid integer.")

    if data.get("civil_status") not in (None, "", "null"):
        if data["civil_status"] not in VALID_CIVIL_STATUS:
            errors.append(
                f"civil_status '{data['civil_status']}' is invalid. "
                f"Valid: {VALID_CIVIL_STATUS}"
            )

    if data.get("monthly_income") is not None:
        try:
            income = float(data["monthly_income"])
            if income < 0:
                errors.append("monthly_income cannot be negative.")
        except (ValueError, TypeError):
            errors.append("monthly_income must be a valid number.")

    if data.get("occupation"):
        if len(str(data["occupation"]).strip()) > 200:
            errors.append("occupation must not exceed 200 characters.")

    for field in ["is_senior", "is_pwd", "is_solo_parent", "is_4ps"]:
        if field in data and data[field] is not None:
            if not isinstance(data[field], bool):
                errors.append(f"{field} must be true or false.")

    if data.get("is_senior") is True and data.get("age") is not None:
        try:
            if int(data["age"]) < 60:
                errors.append(
                    "is_senior is True but age is less than 60. "
                    "PSA-CBMS defines senior as 60+."
                )
        except (ValueError, TypeError):
            pass

    return len(errors) == 0, errors


def validation_error_response(errors):
    return {
        "error":   "Validation failed",
        "details": errors,
        "count":   len(errors)
    }