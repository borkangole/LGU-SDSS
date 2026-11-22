# LGU-SDSS — Spatial Decision Support System for Local Government Units

A GIS-based decision support system that helps Philippine municipalities find **which barangays
and households need help first, and what kind of help**, using their own PSA-CBMS records and
hazard maps. Piloted in the Municipality of San Miguel, Iloilo.

Each barangay is read through three separate lenses that are never merged into one score:

- **Social vulnerability** – 13 CBMS household conditions, ranked across barangays
- **Barangay capacity** – DRRM plans, equipment and facilities
- **Hazard exposure** – households checked against flood and landslide susceptibility zones

Households are also grouped into **five need profiles** (k-modes typology) so programs can be
matched to the kind of help a household needs.

## Features

- Interactive map: barangay choropleths, hazard layers, facilities, household points
- CBMS batch import with undo, household records management
- Dashboard, Data Attributes explorer with charts and per-barangay maps
- Household typology and family network graphs
- Barangay planning briefs, hazard watchlists, PDF / Excel reports
- *Ask the Data*: natural-language questions answered from computed results (Gemini API, optional)
- Role-based access (Admin, MPDO, MSWDO, LGU Planning)
- Windows installer that bundles PostgreSQL, Python and the app — runs fully offline

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React, Vite, Leaflet / React-Leaflet, Recharts, React Flow, Axios, jsPDF, SheetJS |
| API | Python, Flask, Flask-JWT-Extended, Flask-CORS, bcrypt |
| Analytics | pandas, GeoPandas, Shapely, kmodes, NetworkX, Google Gemini API |
| Data | PostgreSQL (psycopg2), SQLite analytics store, GeoJSON layers |

## Project structure

```
backend/            Flask API: app.py, routes/, models/, analysis engines
  scripts/          one-off maintenance and analysis tools (run from backend/)
frontend/           React app (src/features/… one folder per page)
data/               runtime data folder — empty in the repo, see data/README.md
deploy/
  installer/        Windows installer (BUILD-INSTALLER.bat → LGU-SDSS-Setup.exe)
  docker/           Docker setup (start.bat, docker-compose.yml)
  no-docker/        plain Python + PostgreSQL setup
  serve.py          production server used by all three
scripts/
  data-import/      original CBMS / shapefile import and conversion scripts
  gis-checks/       hazard-layer coverage and calibration checks
docs/               accessibility test results
```

## Running it for development

Requirements: Python 3.10–3.13, Node.js 20.19+, PostgreSQL 16+.

```bash
# 1. backend
cd backend
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
#    create backend/.env with:  DB_PASSWORD=...  (and optionally GEMINI_API_KEY=...)
#    create the database from deploy/installer/empty_db.sql:
#      createdb -U postgres lgu_masterdata && psql -U postgres -d lgu_masterdata -f ../deploy/installer/empty_db.sql
python app.py                                        # API on http://localhost:5000

# 2. frontend (new terminal)
cd frontend
npm install
npm run dev                                          # http://localhost:5173
```

Then sign in, open **Households → Import CBMS**, and load your municipality's CBMS files.
The map also needs your barangay boundary and hazard layers in `data/` (see `data/README.md`).

> The empty database ships with default accounts (`admin`, `mswdo`, `lgu`).
> Change their passwords before using the system with real data.

## Deployment

- **Windows installer (recommended):** run `deploy/installer/BUILD-INSTALLER.bat`
- **Docker:** see `deploy/docker/README.md`
- **Without Docker:** see `deploy/no-docker/README.txt`

## Data privacy

This repository contains **source code only**. CBMS household records, GIS layers, analysis
outputs and database dumps are excluded by `.gitignore` and must never be committed.

## Team

Mhel Bustamante · Miguel Jacob Artillero · Anton Gerald Anes · Ebenzer Danilla
West Visayas State University
