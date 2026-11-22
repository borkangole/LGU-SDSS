import pandas as pd
df = pd.read_csv("aligned_data_FINAL.csv", dtype=str)
for col in ["housing_roof", "housing_floor", "o12_fuel_for_lighting", "o13_fuel_for_cooking",
            "o09_tenure", "water_source", "toilet_type"]:
    print(col, "->", sorted(df[col].dropna().unique()))