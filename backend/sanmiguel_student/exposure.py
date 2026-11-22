"""Household hazard-exposure classification and aggregation.

This is the only student-analysis component in which the hazard shapefiles enter
the numerical classification itself.

Technique
---------
- household longitude/latitude -> point geometry;
- project to EPSG:32651;
- point-in-polygon inner spatial join to the ORIGINAL hazard polygons;
- aggregate classifications to barangay counts and percentages;
- households outside the supplied polygons remain "unmapped", not "safe".

Privacy
-------
Coordinates are used in memory only. This module returns aggregate barangay and
municipality tables, never household-level coordinates or identifiers.
"""
from pathlib import Path
import tempfile
import zipfile

import geopandas as gpd
import numpy as np
import pandas as pd

from .config import HAZARD_SPECS


def _slug(value):
    return (
        str(value).strip().lower().replace(" ", "_").replace("/", "_").replace("-", "_")
    )


def _hazard_directory(extracted: Path) -> Path:
    expected = {filename.casefold() for _, filename, _ in HAZARD_SPECS}
    for folder in sorted({p.parent for p in extracted.rglob("*.shp")}):
        found = {p.name.casefold() for p in folder.glob("*.shp")}
        if expected.issubset(found):
            return folder
    raise FileNotFoundError("Could not locate the four configured hazard shapefiles.")


def aggregate_household_exposure(
    households: pd.DataFrame,
    hazard_zip: str | Path,
    analysis_crs: str = "EPSG:32651",
):
    required = ["barangay_geo_code", "psgc_10d", "barangay", "longitude", "latitude"]
    missing = [c for c in required if c not in households.columns]
    if missing:
        raise KeyError(f"Missing household fields: {missing}")

    points = gpd.GeoDataFrame(
        households[required].copy(),
        geometry=gpd.points_from_xy(households["longitude"], households["latitude"]),
        crs="EPSG:4326",
    ).to_crs(analysis_crs)
    points["_household_row_id"] = np.arange(len(points), dtype=np.int64)

    keys = ["barangay_geo_code", "psgc_10d", "barangay"]
    by_barangay = points.groupby(keys).size().rename("households").reset_index()
    municipal_class_rows = []
    qa_rows = []

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        with zipfile.ZipFile(hazard_zip) as z:
            z.extractall(td)
        hazard_dir = _hazard_directory(td)

        for hazard_key, filename, class_field in HAZARD_SPECS:
            layer = gpd.read_file(hazard_dir / filename)
            if layer.crs is None:
                raise ValueError(f"{filename} has no CRS.")
            layer = layer.to_crs(analysis_crs)

            joined = gpd.sjoin(
                points[keys + ["_household_row_id", "geometry"]],
                layer[[class_field, "geometry"]],
                how="inner",
                predicate="within",
            )

            # A single point may intersect duplicate polygons of the same class,
            # but it must not be assigned to two distinct susceptibility classes.
            if len(joined):
                n_classes = joined.groupby("_household_row_id")[class_field].nunique(
                    dropna=False
                )
                conflicts = n_classes[n_classes > 1]
                if len(conflicts):
                    raise ValueError(
                        f"{len(conflicts)} household points intersect multiple "
                        f"{class_field} classes."
                    )
                joined = joined.drop_duplicates(["_household_row_id", class_field])

            mapped_n = (
                int(joined["_household_row_id"].nunique()) if len(joined) else 0
            )
            qa_rows.append(
                {
                    "hazard_layer": hazard_key,
                    "join_type": "inner",
                    "predicate": "within",
                    "households_total_n": len(points),
                    "households_mapped_n": mapped_n,
                    "households_unmapped_n": len(points) - mapped_n,
                    "households_mapped_pct": 100.0 * mapped_n / len(points),
                }
            )

            for hazard_class, n in joined[class_field].value_counts(dropna=False).items():
                municipal_class_rows.append(
                    {
                        "hazard_layer": hazard_key,
                        "class": str(hazard_class),
                        "households_n": int(n),
                        "households_pct_total": 100.0 * int(n) / len(points),
                        "households_pct_mapped": (
                            100.0 * int(n) / mapped_n if mapped_n else np.nan
                        ),
                    }
                )

            mapped = (
                joined.groupby(keys)["_household_row_id"]
                .nunique()
                .rename(f"{hazard_key}_mapped_households")
                .reset_index()
            )
            by_barangay = by_barangay.merge(
                mapped, on=keys, how="left", validate="one_to_one"
            )
            mapped_col = f"{hazard_key}_mapped_households"
            by_barangay[mapped_col] = by_barangay[mapped_col].fillna(0).astype(int)
            by_barangay[f"{hazard_key}_unmapped_households"] = (
                by_barangay["households"] - by_barangay[mapped_col]
            )

            if len(joined):
                table = joined.pivot_table(
                    index=keys,
                    columns=class_field,
                    values="_household_row_id",
                    aggfunc="nunique",
                    fill_value=0,
                )
                table.columns = [
                    f"{hazard_key}_{_slug(c)}_households" for c in table.columns
                ]
                table = table.reset_index()
                class_cols = [c for c in table.columns if c.endswith("_households")]
                by_barangay = by_barangay.merge(
                    table, on=keys, how="left", validate="one_to_one"
                )
                for col in class_cols:
                    by_barangay[col] = by_barangay[col].fillna(0).astype(int)
                    by_barangay[f"{col}_pct_total"] = (
                        100.0 * by_barangay[col] / by_barangay["households"]
                    )
                    by_barangay[f"{col}_pct_mapped"] = np.where(
                        by_barangay[mapped_col] > 0,
                        100.0 * by_barangay[col] / by_barangay[mapped_col],
                        np.nan,
                    )

    def add_grouped(stem, source_cols):
        present = [c for c in source_cols if c in by_barangay.columns]
        by_barangay[f"{stem}_households"] = (
            by_barangay[present].sum(axis=1).astype(int) if present else 0
        )
        by_barangay[f"{stem}_pct_total"] = (
            100.0 * by_barangay[f"{stem}_households"] / by_barangay["households"]
        )

    add_grouped(
        "flood_high_or_very_high",
        ["flood_hf_households", "flood_vhf_households"],
    )
    add_grouped(
        "landslide_moderate_or_high",
        ["landslide_ml_households", "landslide_hl_households"],
    )
    add_grouped(
        "eil_moderate_or_high",
        [
            "erosion_induced_landslide_moderate_susceptibility_households",
            "erosion_induced_landslide_high_susceptibility_households",
        ],
    )

    return (
        by_barangay,
        pd.DataFrame(municipal_class_rows),
        pd.DataFrame(qa_rows),
    )
