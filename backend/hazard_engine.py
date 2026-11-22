# ============================================================
# HAZARD EXPOSURE DETECTION ENGINE
#
# Determines a household's flood/landslide exposure from its
# coordinates alone, by spatially checking against the flood.geojson
# and landslide.geojson hazard layers (same files served by
# /api/gis/flood and /api/gis/landslide).
#
# Rule derived empirically from the existing 7,249-household dataset
# (see conversation history — two geometric theories were tested and
# ruled out before this one was confirmed with a clean split):
#   1. Point-in-polygon match against flood/landslide zones, if any.
#   2. If no direct match, check distance to nearest zone edge:
#      <= HAZARD_BUFFER_METERS -> still "Assessed" (GPS/digitizing
#      tolerance), > buffer -> "Outside mapped hazard area".
#   3. hazard_exposure_score = max(flood_score, landslide_score, 0)
#   4. compound_hazard = both flood AND landslide zones matched
#
# NOTE ON compound_hazard: in the real dataset, flood and landslide
# zones never overlap (compound_hazard is 100% False), so this branch
# is currently unreachable in practice — kept for correctness in case
# your hazard layers are ever updated to include overlapping zones.
#
# BUFFER CALIBRATION (calibrate_buffer.py, full ~7,249-household run):
#   max "Assessed" distance   = 10.825m (household 20497)
#   min "Outside" distance    = 11.370m (household 15730)
#   -> clean gap, buffer set to 11.10m (midpoint, any value in the
#      gap works identically against the current dataset)
# ============================================================

import os
import geopandas as gpd
import pyproj
from shapely.geometry import Point
from shapely.ops import unary_union

GEOJSON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "geojson")

# Empirically confirmed buffer tolerance (see module docstring).
HAZARD_BUFFER_METERS = 11.10

# A projected CRS appropriate for the Philippines, for accurate metric
# distance calculations (EPSG:4326 lon/lat can't measure meters directly).
METRIC_CRS = "EPSG:32651"  # UTM Zone 51N — covers the Philippines

FLOOD_LABELS = {"LF": "Low", "MF": "Moderate", "HF": "High", "VHF": "Very High"}
FLOOD_SCORES = {"LF": 1, "MF": 2, "HF": 3, "VHF": 4}
LANDSLIDE_LABELS = {"LL": "Low", "ML": "Moderate", "HL": "High"}
LANDSLIDE_SCORES = {"LL": 1, "ML": 2, "HL": 3}

_cache = {}


def _load_layers():
    """Load and reproject the hazard layers once; cache for reuse across
    the life of the Flask process (these files don't change at runtime)."""
    if _cache:
        return _cache

    flood = gpd.read_file(os.path.join(GEOJSON_DIR, "flood.geojson"))
    landslide = gpd.read_file(os.path.join(GEOJSON_DIR, "landslide.geojson"))

    flood_m = flood.to_crs(METRIC_CRS)
    landslide_m = landslide.to_crs(METRIC_CRS)

    _cache["flood"] = flood            # kept in original lon/lat CRS for point-in-polygon
    _cache["landslide"] = landslide
    _cache["flood_union_m"] = unary_union(flood_m.geometry)       # metric CRS, for distance
    _cache["landslide_union_m"] = unary_union(landslide_m.geometry)
    return _cache


def detect_hazard_exposure(longitude, latitude):
    """
    Given a household's coordinates, returns:
        {
            "flood_exposure": "Low"|"Moderate"|"High"|"Very High"|None,
            "landslide_exposure": "Low"|"Moderate"|"High"|None,
            "hazard_exposure_score": int (0-4),
            "compound_hazard": bool,
            "hazard_data_status": "Assessed"|"Outside mapped hazard area"|"No Data",
        }
    Returns hazard_data_status="No Data" if coordinates are missing/invalid —
    this is distinct from "Outside mapped hazard area" (valid coordinates,
    confidently outside any hazard zone).
    """
    if longitude is None or latitude is None:
        return {
            "flood_exposure": None, "landslide_exposure": None,
            "hazard_exposure_score": None, "compound_hazard": False,
            "hazard_data_status": "No Data",
        }

    layers = _load_layers()
    pt = Point(float(longitude), float(latitude))

    # ── Point-in-polygon check (in the layers' native lon/lat CRS) ──
    flood_match = layers["flood"][layers["flood"].contains(pt)]
    landslide_match = layers["landslide"][layers["landslide"].contains(pt)]

    flood_exposure = None
    flood_score = 0
    if not flood_match.empty:
        code = flood_match.iloc[0]["FloodSusc"]
        flood_exposure = FLOOD_LABELS.get(code)
        flood_score = FLOOD_SCORES.get(code, 0)

    landslide_exposure = None
    landslide_score = 0
    if not landslide_match.empty:
        code = landslide_match.iloc[0]["LndslideSu"]
        landslide_exposure = LANDSLIDE_LABELS.get(code)
        landslide_score = LANDSLIDE_SCORES.get(code, 0)

    hazard_exposure_score = max(flood_score, landslide_score, 0)
    compound_hazard = flood_score > 0 and landslide_score > 0

    if hazard_exposure_score > 0:
        hazard_data_status = "Assessed"
    else:
        # Not inside any zone — check the buffer tolerance using a
        # proper metric CRS (not a rough degrees-to-meters approximation).
        transformer = pyproj.Transformer.from_crs("EPSG:4326", METRIC_CRS, always_xy=True)
        x_m, y_m = transformer.transform(float(longitude), float(latitude))
        pt_m = Point(x_m, y_m)
        combined_union_m = unary_union([layers["flood_union_m"], layers["landslide_union_m"]])
        dist_m = pt_m.distance(combined_union_m)
        hazard_data_status = "Assessed" if dist_m <= HAZARD_BUFFER_METERS else "Outside mapped hazard area"

    return {
        "flood_exposure": flood_exposure,
        "landslide_exposure": landslide_exposure,
        "hazard_exposure_score": hazard_exposure_score,
        "compound_hazard": compound_hazard,
        "hazard_data_status": hazard_data_status,
    }