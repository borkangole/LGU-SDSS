"""Load the three CBMS tables from loose CSV files instead of a zip.

Sir Shem's original io.py (kept alongside this file, unmodified) expects a
single zip containing cbms_household_record.csv, cbms_person_record.csv,
cbms_barangay_record.csv. Our data folder already has these as separate
files, so this adapter does the same validation/normalization without
requiring them to be zipped first. Nothing about the analysis logic
changes -- this only changes how the three tables get loaded in.
"""
from pathlib import Path
import pandas as pd

from .io import psgc10, _drop_unnamed


def load_cbms_local(household_csv, person_csv, barangay_csv):
    hh = _drop_unnamed(pd.read_csv(household_csv, low_memory=False))
    pp = _drop_unnamed(pd.read_csv(person_csv, low_memory=False))
    br = _drop_unnamed(pd.read_csv(barangay_csv, low_memory=False))

    for frame in (hh, pp, br):
        frame["psgc_10d"] = psgc10(frame["barangay_geo_code"])

    if hh["uuid"].nunique() != len(hh):
        raise ValueError("Household UUID is not unique.")
    missing = set(pp["uuid"].dropna()) - set(hh["uuid"].dropna())
    if missing:
        raise ValueError(
            f"Person table has {len(missing)} household UUID(s) absent from household table."
        )
    if hh["psgc_10d"].nunique() != 24:
        raise ValueError(
            f"Expected 24 San Miguel barangays; found {hh['psgc_10d'].nunique()}."
        )
    return hh, pp, br
