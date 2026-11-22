"""
CBMS 2024 code books used by cbms_import.py.

Every code -> label map below was read off the project's own earlier import
(aligned_data_FINAL.csv) by joining it back to the raw CBMS files on uuid +
line_number, so a fresh import stores exactly the same labels the rest of the
system already expects. A code that is not listed here is stored as its raw
code rather than guessed.
"""

ROOF = {
    '1': 'Metal roofing sheets',
    '2': 'Concrete/clay/slate tile',
    '3': 'Half galvanized iron and half concrete',
    '4': 'Wood/bamboo',
    '5': 'Sod/thatch',
}

WALLS = {
    '1': 'Concrete/brick/stone',
    '2': 'Metal sheet',
    '3': 'Half concrete/brick/stone and half wood',
    '5': 'Wood/bamboo',
    '6': 'Sawali/cogon/nipa',
    '7': 'Asbestos',
    '8': 'Makeshift/salvaged/improvised',
    '9': 'Fiber cement board',
}

FLOOR = {
    '1': 'Concrete',
    '2': 'Earth/sand/mud',
    '3': 'Wood',
    '4': 'Coconut lumber',
    '5': 'Bamboo',
    '6': 'Makeshift/salvaged/improvised',
}

TENURE = {
    '1': 'Own or owner-like possession of the house and lot',
    '2': 'Own house, rent lot',
    '3': 'Own house, rent-free lot with consent of owner',
    '4': 'Own house, rent-free lot without consent of owner',
    '5': 'Rent house / room, including lot',
    '6': 'Rent-free house and lot with consent of owner',
    '7': 'Rent-free house and lot without consent of owner',
}

LIGHTING = {
    '1': 'Electricity',
    '2': 'Kerosene (Gaas)',
    '5': 'Solar Panel/Solar Lamp',
    '6': 'Candle',
    '8': 'None',
}

COOKING = {
    '1': 'Electricity',
    '3': 'Liquefied Petroleum Gas (LPG)',
    '4': 'Charcoal',
    '5': 'Wood',
}

WATER = {
    '1': 'Piped into dwelling',
    '2': 'Piped into yard/plot',
    '3': 'Public tap/standpipe',
    '4': 'Protected well/tube well/borehole',
    '5': 'Protected spring',
    '6': 'Rainwater',
    '7': 'Tanker truck/peddler/neighbor',
    '8': 'Unprotected open dug well',
    '9': 'Unprotected spring',
    '10': 'Surface water',
}

WATER_SL = {
    '1': 'Basic',
    '2': 'Limited',
    '3': 'Unimproved',
    '4': 'Surface water/Open defecation',
}

TOILET = {
    '12': 'Flush to septic tank',
    '13': 'Flush to pit latrine',
    '14': 'Flush to open drain',
    '15': 'Flush, unknown destination',
    '21': 'Ventilated improved latrine',
    '22': 'Pit latrine with slab',
    '23': 'Pit latrine without slab/open pit',
    '95': 'Open defecation',
}

TOILET_SL = {
    '1': 'Basic',
    '2': 'Limited',
    '3': 'Unimproved',
    '4': 'Surface water/Open defecation',
}

REL_HEAD = {
    '1': 'Head',
    '2': 'Spouse',
    '3': 'Son',
    '4': 'Daughter',
    '5': 'Stepson',
    '6': 'Stepdaughter',
    '7': 'Son-in-law',
    '8': 'Daughter-in-law',
    '9': 'Grandson',
    '10': 'Granddaughter',
    '11': 'Father',
    '12': 'Mother',
    '13': 'Father-in-law',
    '14': 'Mother-in-law',
    '15': 'Brother',
    '16': 'Sister',
    '17': 'Brother-in-law',
    '18': 'Sister-in-law',
    '19': 'Uncle',
    '20': 'Aunt',
    '21': 'Nephew',
    '22': 'Niece',
    '23': 'Other relative',
    '24': 'Boarder',
    '25': 'Domestic helper',
    '26': 'Nonrelative',
}

SEX = {
    '1': 'Male',
    '2': 'Female',
}

MARITAL = {
    '1': 'Single/never married',
    '2': 'Married',
    '3': 'Common law/live-in',
    '4': 'Widowed',
    '5': 'Divorced',
    '6': 'Separated',
    '7': 'Annulled',
    '8': 'Not reported',
}

RELIGION = {
    '1': 'Aglipay',
    '2': 'Alliance of Bible Christian Communities of the Philippines',
    '5': 'Apostolic Catholic Church, Incorporated',
    '6': 'Asia Evangelistic Fellowship Philippines, Incorporated',
    '7': 'Assemblies of God',
    '8': 'Association of Baptist Churches in Luzon, Visayas, and Mindanao',
    '9': 'Association of Fundamental Baptist Churches in the Philippines',
    '10': 'Baptist Conference of the Philippines',
    '11': 'Bethany Church of the Philippines',
    '12': 'Bible Baptist Church',
    '13': 'Bible Centered Fellowship',
    '14': 'Bread of Life Ministries',
    '15': 'Buddhist',
    '17': 'Catholic Charismatic',
    '18': 'Charismatic Full Gospel Ministries',
    '20': 'Christ, the Living Stone Fellowship',
    '21': 'Christ to the Philippines, Incorporated',
    '22': 'Christ`s Commission Fellowship',
    '23': 'Christian and Missionary Alliance Church of the Philippines',
    '24': 'Christian Brethren International Pilipinas, Incorporated',
    '25': 'Christian Missions in the Philippines',
    '26': 'Christian Reformed Church in the Philippines, Incorporated',
    '27': 'Church Body of Christ Filipinista',
    '28': 'Church of Christ',
    '30': 'Church of Jesus Christ of the Latter Day Saints',
    '32': 'Church of the Nazarene',
    '33': 'Conservative Baptist Association in the Philippines',
    '34': 'Convention of the Philippine Baptist Church',
    '35': 'Crusaders of the Divine Church of Christ, Incorporated',
    '39': 'Evangelical Christian Outreach Foundation',
    '40': 'Evangelical Free Church of the Philippines',
    '41': 'Evangelical Presbyterian Church',
    '43': 'Faith Baptist Church',
    '45': 'Islam',
    '47': 'Filipino Assemblies of the First Born, Incorporated',
    '49': 'Free Methodist Church',
    '50': 'Fundamental Grace Gospel Church of Christ in the Philippines, Incorporated',
    '52': 'Good News Christian Churches',
    '59': 'Iglesia Filipina Independiente',
    '60': 'Iglesia ni Cristo',
    '61': 'Iglesia sa Dios Espiritu Santo, Incorporated',
    '62': 'Independent Baptist Churches of the Philippines',
    '65': 'Jehovah’s Witness',
    '67': 'Jesus First Christian Ministries, Incorporated',
    '72': 'Jesus the Anointed One Church',
    '73': 'Jireh-Evangel Church Planting Philippines, Incorporated',
    '77': 'Lord of the Nations, Incorporated',
    '83': 'Missionary Baptist Churches of the Philippines',
    '84': 'Most Holy Church of God in Christ Jesus',
    '85': 'National Council of Christian Community Churches (NCCCC), Incorporated',
    '87': 'Pentecostal Church of God Asia Mission',
    '89': 'Philippine Ecumenical Christian Church',
    '90': 'Philippine Evangelical Holiness Church',
    '91': 'Philippine Evangelical Mission',
    '93': 'Philippine Independent Catholic Church',
    '95': 'Philippine Pentecostal Holiness Church',
    '98': 'Presbyterian Church in the Philippines',
    '100': 'Roman Catholic, Excluding Catholic Charismatic',
    '102': 'Seventh Day Adventist',
    '103': 'Southern Baptist Church',
    '106': 'Tribal Religion',
    '108': 'Union Espiritista Cristiana De Filipinas, Incorporated',
    '109': 'United Church of Christ in the Philippines',
    '110': 'United Evangelical Church of the Philippines (Chinese)',
    '112': 'United Pentecostal Church (Philippines), Incorporated',
    '113': 'Universal Pentecostal Church',
    '115': 'Victory Christian Fellowship of the Philippines, Incorporated',
    '116': 'Way of Salvation',
    '120': 'World Missionary Evangelism',
    '121': 'Worldwide Church of God',
    '122': 'Zion Christian Community Church',
    '124': 'Other Evangelical Churches',
    '127': 'Other religious affiliation',
}

AGE_GROUP = {
    '1': '< 5 years old',
    '2': '5-9 years old',
    '3': '10-14 years old',
    '4': '15-19 years old',
    '5': '20-24 years old',
    '6': '25-29 years old',
    '7': '30-34 years old',
    '8': '35-39 years old',
    '9': '40-44 years old',
    '10': '45-49 years old',
    '11': '50-54 years old',
    '12': '55-59 years old',
    '13': '60-64 years old',
    '14': '65-69 years old',
    '15': '70-74 years old',
    '16': '75-79 years old',
    '17': '80-84 years old',
    '18': '85-89 years old',
    '19': '90-94 years old',
    '20': '95-99 years old',
    '21': '100+ years old',
}

EMPLOY = {
    '1': 'Employed',
    '2': 'Unemployed',
}

YES_NO = {'1': 'Yes', '2': 'No', '8': "Don't know"}

OCCUPATION_GROUP = {
    '0': 'Armed Forces', '1': 'Managers', '2': 'Professionals',
    '3': 'Technicians/Associate Professionals', '4': 'Clerical Support Workers',
    '5': 'Service and Sales Workers', '6': 'Skilled Agricultural/Forestry/Fishery',
    '7': 'Craft and Related Trades Workers', '8': 'Plant/Machine Operators',
    '9': 'Elementary Occupations',
}

EDUCATION_LEVEL = {
    '0': 'Early childhood', '1': 'Elementary', '2': 'Junior high school',
    '3': 'Senior high school', '4': 'Post-secondary non-tertiary',
    '5': 'Short-cycle tertiary', '6': 'College', '7': 'Masteral', '8': 'Doctoral',
}


# ── Codes that exist in the CBMS 2024 value sets (dataset metadata) but did
# not occur in San Miguel's 2024 data. Added so a future import or a manually
# added household never ends up with a bare code. Labels follow the style above.
ROOF.update({'6': 'Asbestos', '7': 'Makeshift/salvaged/improvised', '9': 'Others'})
WALLS.update({'4': 'Glass', '99': 'Others'})
FLOOR.update({'7': 'Fiber cement board', '8': 'Not observed', '9': 'Others'})
LIGHTING.update({'3': 'Liquefied Petroleum Gas (LPG)', '4': 'Oil (vegetable, animal, and others)',
                 '7': 'Battery', '9': 'Others'})
COOKING.update({'2': 'Kerosene (Gaas)', '9': 'Others'})
WATER.update({'99': 'Other main source of water'})
TOILET.update({'11': 'Flush to piped sewer system', '31': 'Composting toilet',
               '41': 'Bucket/pail system', '51': 'Hanging toilet/hanging latrine',
               '71': 'Public toilet', '99': 'Others'})
EDUCATION_LEVEL_FULL = {
    '0': 'Early childhood education', '1': 'Elementary level', '2': 'Junior high school level',
    '3': 'Senior high school level', '4': 'Post-secondary non-tertiary level',
    '5': 'Short-cycle tertiary level', '6': 'College level', '7': 'Masteral level',
    '8': 'Doctoral level',
}
NUCLEAR_RELATION = {
    '0': 'One-person household', '1': 'Family head', '2': 'Spouse', '3': 'Partner', '4': 'Son',
    '5': 'Daughter', '6': 'Brother', '7': 'Sister', '8': 'Father', '9': 'Mother',
    '10': 'Other family member',
}

# Toilet codes the CBMS counts as improved (service level Basic, or Limited
# when shared); 95 = open defecation; the rest are unimproved.
IMPROVED_TOILET = {'11', '12', '13', '21', '22', '31'}
IMPROVED_WATER = {'1', '2', '3', '4', '5', '6', '7'}


def _opts(mapping):
    return [{"code": k, "label": v} for k, v in sorted(mapping.items(), key=lambda kv: int(kv[0]))]


# Dropdown choices for the manual "Add household" form -- the same codes the
# CBMS questionnaire uses, so a hand-entered household is scored exactly like
# an imported one.
FORM_OPTIONS = {
    "o03_roof": _opts(ROOF),
    "o04_outer_walls": _opts(WALLS),
    "o06_floor": _opts(FLOOR),
    "o09_tenure": _opts(TENURE),
    "o12_fuel_for_lighting": _opts(LIGHTING),
    "o13_fuel_for_cooking": _opts(COOKING),
    "n01_main_water": _opts(WATER),
    "n08_toilet_facility": _opts(TOILET),
    "a02_relation_to_hh_head": _opts(REL_HEAD),
    "a03_sex": _opts(SEX),
    "a07_marital_status": _opts(MARITAL),
    "a11_hgc_level": _opts(EDUCATION_LEVEL_FULL),
    "e05_occupation_group": _opts(OCCUPATION_GROUP),
}
