"""Publication-safe barangay maps.

This module maps only barangay aggregate tables.
It never accepts or plots household coordinates.
No Moran's I, LISA, Queen/Rook weights, or adjacency diagnostics are present.
"""
from pathlib import Path
import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap


BLUE_ORANGE = LinearSegmentedColormap.from_list(
    "blue_orange",
    ["#deebf7", "#9ecae1", "#f7f7f7", "#fdd0a2", "#ff7f0e"],
    N=256,
)


def legacy_to_psgc10(value):
    digits = str(value).replace("PH", "").strip()
    if len(digits) == 9 and digits.isdigit():
        return digits[:2] + "0" + digits[2:]
    if len(digits) == 10 and digits.isdigit():
        return digits
    raise ValueError(f"Unexpected ADM4_PCODE: {value!r}")


def load_boundaries(boundary_zip):
    """Load exact 24-barangay San Miguel boundary package."""
    gdf = gpd.read_file(boundary_zip)
    if {"ADM3_EN", "ADM2_EN"}.issubset(gdf.columns):
        gdf = gdf.loc[
            (gdf["ADM3_EN"] == "San Miguel") & (gdf["ADM2_EN"] == "Iloilo")
        ].copy()
    if len(gdf) != 24:
        raise ValueError(f"Expected 24 boundary polygons; found {len(gdf)}.")
    if gdf.crs is None:
        raise ValueError("Boundary layer has no CRS.")
    if "psgc_10d" not in gdf.columns:
        gdf["psgc_10d"] = gdf["ADM4_PCODE"].map(legacy_to_psgc10)
    else:
        gdf["psgc_10d"] = gdf["psgc_10d"].astype(str).str.zfill(10)
    return gdf


def join_aggregate(boundaries, table, value_col):
    frame = table.copy()
    frame["psgc_10d"] = frame["psgc_10d"].astype(str).str.zfill(10)
    gdf = boundaries.merge(frame, on="psgc_10d", how="left", validate="one_to_one")
    if gdf[value_col].isna().any():
        missing = gdf.loc[gdf[value_col].isna(), "psgc_10d"].tolist()
        raise ValueError(f"Missing aggregate values after map join: {missing}")
    return gdf


def render_choropleth(
    gdf,
    value_col,
    title,
    legend_label,
    output_path,
    label_col="barangay",
    fmt=".1f",
):
    """Render one aggregate choropleth with no household point layer."""
    projected = gdf.to_crs("EPSG:32651")
    fig, ax = plt.subplots(figsize=(9.5, 8.0))
    vmax = float(projected[value_col].max())
    if vmax <= 0:
        vmax = 1.0

    projected.plot(
        column=value_col,
        cmap=BLUE_ORANGE,
        vmin=0,
        vmax=vmax,
        linewidth=0.8,
        edgecolor="white",
        legend=True,
        legend_kwds={"label": legend_label, "shrink": 0.7},
        ax=ax,
    )
    projected.boundary.plot(ax=ax, linewidth=0.5, color="#263238")

    # Label peripheral barangays only on the full map to avoid central overlap.
    codes = projected["psgc_10d"].str[-4:].astype(int)
    label_frame = projected.loc[codes.between(1017, 1024)]
    pts = label_frame.geometry.representative_point()
    for (_, row), pt in zip(label_frame.iterrows(), pts):
        name = row.get(label_col, row.get("ADM4_EN", row["psgc_10d"]))
        value = format(float(row[value_col]), fmt)
        ax.text(pt.x, pt.y, f"{name}\n{value}", ha="center", va="center", fontsize=7)

    ax.set_title(title, loc="left", fontsize=14, fontweight="bold", pad=12)
    ax.set_axis_off()
    fig.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return output_path


def render_all_maps(boundary_zip, vulnerability, capacity, exposure, output_dir):
    """Generate the student-facing aggregate map set."""
    boundaries = load_boundaries(boundary_zip)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = {}

    vg = join_aggregate(boundaries, vulnerability, "svi_score")
    paths["vulnerability_score"] = render_choropleth(
        vg,
        "svi_score",
        "Access-Augmented Social Vulnerability — San Miguel, Iloilo",
        "Vulnerability score",
        output_dir / "vulnerability_score.png",
    )

    cg = join_aggregate(boundaries, capacity, "capacity_score")
    paths["capacity_score"] = render_choropleth(
        cg,
        "capacity_score",
        "Operational Capacity — San Miguel, Iloilo",
        "Capacity score",
        output_dir / "capacity_score.png",
    )

    exposure_specs = [
        (
            "flood_high_or_very_high_households",
            "Flood Exposure: High or Very High Susceptibility — Household Count",
            "Exposed households",
            "flood_high_very_high_count.png",
            ".0f",
        ),
        (
            "flood_high_or_very_high_pct_total",
            "Flood Exposure: High or Very High Susceptibility — Household Share",
            "Exposed households (%)",
            "flood_high_very_high_pct.png",
            ".1f",
        ),
        (
            "landslide_moderate_or_high_households",
            "Landslide Exposure: Moderate or High Susceptibility — Household Count",
            "Exposed households",
            "landslide_moderate_high_count.png",
            ".0f",
        ),
        (
            "landslide_moderate_or_high_pct_total",
            "Landslide Exposure: Moderate or High Susceptibility — Household Share",
            "Exposed households (%)",
            "landslide_moderate_high_pct.png",
            ".1f",
        ),
    ]

    for col, title, legend, filename, fmt in exposure_specs:
        if col not in exposure.columns:
            continue
        eg = join_aggregate(boundaries, exposure, col)
        paths[col] = render_choropleth(
            eg, col, title, legend, output_dir / filename, fmt=fmt
        )
    return paths
