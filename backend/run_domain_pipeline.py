#!/usr/bin/env python
"""
run_domain_pipeline.py

Runs Sir Shem's official reference pipeline (Domain A social vulnerability,
Domain B operational capacity, hazard exposure, household k-modes typology)
against our live CBMS data, following his own methodology (in
sanmiguel_student/) rather than a hand-reimplementation.

NOTE (2026-09, superseded): an earlier version of this note said
vulnerability.py had been corrected to match the "Domain A -- Barangay-
Level Scoring" SLIDE (indicator #8 = "no financial account", PWD/senior/
low-education = household-max() rates). That correction was itself wrong
-- it was based on a slide screenshot, not the source. Once
vulnerability_functions_1.pdf (his actual delivered function code,
verified against his own CSVs and presentation deck) was checked
directly, it explicitly says "no_financial_account is intentionally NOT
included in Domain A" and that PWD/senior/solo-parent must be
person_rate (% of population), not household-max. vulnerability.py now
matches the PDF exactly, which also caught two further, older bugs
(food_insecure's formula, unimproved_sanitation's toilet code list) that
predate any of this correction work. See vulnerability.py's module
docstring for the full, current account. This file is otherwise no
longer literally "unmodified" from any original delivered script -- it
is our best-effort match to his documented, PDF-verified methodology.

This REPLACES the earlier standalone scripts (social_vulnerability_barangay.py,
capacity_distance_barangay.py, facility_distance.py, household_typology.py) --
those were built on guessed/approximate thresholds before we had Sir Shem's
own code and are now superseded. They're left in place for reference but
should not be used for anything going into the defense.

Usage (from the backend/ folder):
    python run_domain_pipeline.py

Reads from ../data/:
    cbms_household_record.csv
    cbms_person_record.csv
    cbms_barangay_record.csv
    spatial/San_Miguel_Hazard_Shapefiles.zip
    spatial/San_Miguel_Iloilo_Barangays.zip

Writes to ./domain_pipeline_outputs/:
    vulnerability_scores.csv
    capacity_scores.csv, capacity_indicator_diagnostics.csv
    hazard_exposure_by_barangay.csv, hazard_exposure_class_counts.csv,
        hazard_exposure_join_qa.csv
    kmodes_validation_full.csv, kmodes_validation_subsample_k3_k5_k6.csv
    kmodes_cluster_profiles_kX.csv   (only if --profile-k is given)
    maps/*.png

The k-modes full validation (k=2..8, 10 seeds, n_init=20 each) is the slow
part -- can take 20-40+ minutes on this dataset. Use --skip-typology to skip
it if you only need the vulnerability/capacity/exposure/maps refreshed.
"""
from pathlib import Path
import argparse

from sanmiguel_student.io_local import load_cbms_local
from sanmiguel_student.vulnerability import (
    aggregate_barangays, build_household_flags, build_person_flags, score_vulnerability,
)
from sanmiguel_student.capacity import score_capacity
from sanmiguel_student.exposure import aggregate_household_exposure
from sanmiguel_student.maps import render_all_maps
from sanmiguel_student.typology import (
    aggregate_cluster_profiles, build_typology_features, validate_k, validate_subsample_stability,
)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data-dir", default="../data")
    # NOTE: previously defaulted to "domain_pipeline_outputs" (a folder
    # inside backend/) which is NOT where domain_vulnerability_routes.py /
    # build_nlp_views.py read from (../data/domain_pipeline_results) --
    # every run silently produced numbers the app never picked up unless
    # someone manually copied the CSVs over. Fixed to write straight to
    # the folder the app actually reads, matching where the other
    # standalone scripts (typology_household_export.py,
    # typology_barangay_aggregate.py, facility_access_score.py) already
    # write. Pass --output-dir explicitly to override.
    p.add_argument("--output-dir", default="../data/domain_pipeline_results")
    p.add_argument("--k-values", default="2,3,4,5,6,7,8")
    p.add_argument("--profile-k", type=int, default=None)
    p.add_argument("--skip-typology", action="store_true")
    p.add_argument("--seeds", type=int, default=10, help="Random seeds for k validation (Sir Shem's default: 10)")
    p.add_argument("--n-init", type=int, default=20, help="KModes n_init (Sir Shem's default: 20)")
    args = p.parse_args()

    data_dir = Path(args.data_dir)
    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    hh, pp, br = load_cbms_local(
        data_dir / "cbms_household_record.csv",
        data_dir / "cbms_person_record.csv",
        data_dir / "cbms_barangay_record.csv",
    )
    print(f"Loaded: {len(hh)} households, {len(pp)} persons, {len(br)} barangays")

    # ---------------- VULNERABILITY (Domain A) ----------------
    hh_v = build_household_flags(hh)
    pp_v = build_person_flags(pp)
    vulnerability = score_vulnerability(aggregate_barangays(hh_v, pp_v))
    vulnerability.to_csv(outdir / "vulnerability_scores.csv", index=False)
    print("\nVulnerability rank 1:", vulnerability.iloc[0]["barangay"])

    # ---------------- CAPACITY (Domain B, part 1) ----------------
    from facility_counts import add_facility_counts
    capacity, capacity_diag = score_capacity(add_facility_counts(br))
    capacity.to_csv(outdir / "capacity_scores.csv", index=False)
    capacity_diag.to_csv(outdir / "capacity_indicator_diagnostics.csv", index=False)
    print("Capacity rank 1:", capacity.sort_values("capacity_rank").iloc[0]["barangay"])

    # ---------------- HAZARD EXPOSURE (Domain B, part 2) ----------------
    exposure, exposure_classes, exposure_qa = aggregate_household_exposure(
        hh, data_dir / "spatial" / "San_Miguel_Hazard_Shapefiles.zip"
    )
    exposure.to_csv(outdir / "hazard_exposure_by_barangay.csv", index=False)
    exposure_classes.to_csv(outdir / "hazard_exposure_class_counts.csv", index=False)
    exposure_qa.to_csv(outdir / "hazard_exposure_join_qa.csv", index=False)
    print("Flood high+very-high households:", int(exposure["flood_high_or_very_high_households"].sum()))
    print("Landslide moderate+high households:", int(exposure["landslide_moderate_or_high_households"].sum()))

    # ---------------- MAPS ----------------
    render_all_maps(
        data_dir / "spatial" / "San_Miguel_Iloilo_Barangays.zip",
        vulnerability, capacity, exposure, outdir / "maps",
    )
    print("Maps written to", outdir / "maps")

    # ---------------- HOUSEHOLD TYPOLOGY (k-modes) ----------------
    if not args.skip_typology:
        hh_t = build_typology_features(hh, pp)
        ks = [int(v.strip()) for v in args.k_values.split(",") if v.strip()]
        print(f"\nRunning k validation (k={ks}, {args.seeds} seeds, n_init={args.n_init})... this is the slow part.")
        validate_k(
            hh_t, k_values=ks, seeds=range(args.seeds), n_init=args.n_init,
        ).to_csv(outdir / "kmodes_validation_full.csv", index=False)
        validate_subsample_stability(
            hh_t, k_values=tuple(k for k in (3, 5, 6) if k in ks)
        ).to_csv(outdir / "kmodes_validation_subsample_k3_k5_k6.csv", index=False)

        if args.profile_k is not None:
            aggregate_cluster_profiles(hh_t, args.profile_k).to_csv(
                outdir / f"kmodes_cluster_profiles_k{args.profile_k}.csv", index=False,
            )

    print(f"\nComplete. Outputs: {outdir.resolve()}")


if __name__ == "__main__":
    main()
