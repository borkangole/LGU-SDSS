"""Input loading and identifier normalization.

No raw CBMS data are included in this package. The student supplies the CBMS ZIP
locally. The loader validates the three expected CBMS tables and normalizes
barangay codes to 10-digit PSGC strings.
"""
from pathlib import Path
import zipfile
import pandas as pd


def psgc10(series: pd.Series) -> pd.Series:
    return (
        series.astype("string")
        .str.replace(r"\.0$", "", regex=True)
        .str.strip()
        .str.zfill(10)
    )


def _drop_unnamed(df: pd.DataFrame) -> pd.DataFrame:
    return df.drop(
        columns=[c for c in df.columns if c.startswith("Unnamed:")],
        errors="ignore",
    )


def load_cbms_zip(cbms_zip: str | Path):
    cbms_zip = Path(cbms_zip)
    with zipfile.ZipFile(cbms_zip) as z:
        names = z.namelist()

        def locate(name: str) -> str:
            matches = [p for p in names if p == name or p.endswith("/" + name)]
            if len(matches) != 1:
                raise FileNotFoundError(
                    f"Expected exactly one {name} in {cbms_zip}; found {matches}"
                )
            return matches[0]

        hh = _drop_unnamed(
            pd.read_csv(z.open(locate("cbms_household_record.csv")), low_memory=False)
        )
        pp = _drop_unnamed(
            pd.read_csv(z.open(locate("cbms_person_record.csv")), low_memory=False)
        )
        br = _drop_unnamed(
            pd.read_csv(z.open(locate("cbms_barangay_record.csv")), low_memory=False)
        )

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
