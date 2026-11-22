"""
print_results_for_shem.py
Place in: backend/ (same folder as run_domain_pipeline.py)
Run:      python print_results_for_shem.py

Reads the already-computed pipeline output in ../data/domain_pipeline_results/
and prints a clean, plain-text terminal table of all 24 barangays --
SVI score/rank, capacity score/rank, flood %, landslide % -- for sharing
directly from the terminal (no dashboard screenshot needed).

Does not recompute anything; it only reads and formats the CSVs already
produced by run_domain_pipeline.py, so it reflects exactly what's on disk.
"""
import os
import csv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(BASE_DIR, "..", "..", "data", "domain_pipeline_results")


def read_csv(name):
    path = os.path.join(RESULTS_DIR, name)
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def tier(rank):
    rank = int(rank)
    if rank <= 6:
        return "High"
    if rank <= 12:
        return "Moderate-high"
    if rank <= 18:
        return "Moderate-low"
    return "Low"


def main():
    svi_rows = {r["psgc_10d"]: r for r in read_csv("vulnerability_scores.csv")}
    cap_rows = {r["psgc_10d"]: r for r in read_csv("capacity_scores.csv")}
    hz_rows = {r["psgc_10d"]: r for r in read_csv("hazard_exposure_by_barangay.csv")}

    merged = []
    for psgc, s in svi_rows.items():
        c = cap_rows.get(psgc, {})
        h = hz_rows.get(psgc, {})
        merged.append({
            "barangay": s["barangay"],
            "svi_score": float(s["svi_score"]),
            "svi_rank": int(float(s["svi_rank"])),
            "capacity_score": float(c.get("capacity_score", 0) or 0),
            "capacity_rank": int(float(c.get("capacity_rank", 0) or 0)),
            "flood_pct": float(h.get("flood_high_or_very_high_pct_total", 0) or 0),
            "landslide_pct": float(h.get("landslide_moderate_or_high_pct_total", 0) or 0),
        })

    merged.sort(key=lambda r: r["svi_rank"])

    cols = [
        ("#", 3), ("Barangay", 16), ("SVI Score", 10), ("SVI Rank", 15),
        ("Cap. Score", 11), ("Cap. Rank", 10), ("Flood %", 9), ("Landslide %", 12),
    ]
    header = "".join(f"{name:<{w}}" for name, w in cols)
    print(header)
    print("-" * len(header))

    for i, r in enumerate(merged, start=1):
        cap_flag = " !" if r["capacity_rank"] >= 18 else ""
        row = (
            f"{i:<3}"
            f"{r['barangay']:<16}"
            f"{r['svi_score']:<10.1f}"
            f"{tier(r['svi_rank']):<15}"
            f"{r['capacity_score']:<11.1f}"
            f"{('#' + str(r['capacity_rank']) + cap_flag):<10}"
            f"{r['flood_pct']:<9.1f}"
            f"{r['landslide_pct']:<12.1f}"
        )
        print(row)

    print("-" * len(header))
    print(f"{len(merged)} barangays. Tiers: High=rank1-6, Moderate-high=7-12, "
          f"Moderate-low=13-18, Low=19-24. '!' = capacity bottom quartile (rank>=18).")


if __name__ == "__main__":
    main()
