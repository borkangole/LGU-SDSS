# data/

Runtime data folder. **Nothing in here is committed except this file and `network_engine.py`**
(it holds household-level data).

What the system expects here:

| Path | What | Where it comes from |
|---|---|---|
| `geojson/barangay_boundaries.geojson` | barangay boundaries | municipality / PSA boundary shapefile |
| `geojson/flood.geojson`, `geojson/landslide.geojson` | hazard susceptibility zones | MGB hazard shapefiles |
| `geojson/roads.geojson` | road network (map display) | municipal GIS |
| `imports/` | uploaded CBMS files (created by the app) | Households → Import CBMS |
| `domain_pipeline_results/` | computed SVI, capacity, hazard and typology results (created by the app) | run automatically after import |
| `nlp_analytics.sqlite` | read-only analytics store for *Ask the Data* (created by the app) | built after import |

To convert shapefiles to the GeoJSON layers above, see `scripts/data-import/`.
