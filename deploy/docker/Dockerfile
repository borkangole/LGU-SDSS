# ─────────────────────────────────────────────────────────────
# LGU-SDSS — one image: builds the React frontend, then serves it
# together with the Flask API from a production server (waitress).
# Staff open ONE address (http://<pc>:8080); no npm run dev / python app.py.
# ─────────────────────────────────────────────────────────────

# 1) Build the frontend  (Vite 7 needs Node 20.19+ / 22)
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY frontend/ ./
# The source calls the API at http://127.0.0.1:5000 / localhost:5000 during
# development. In the container the API is served from the same address as
# the site, so make every such URL relative before building.
RUN grep -rlE "https?://(127\.0\.0\.1|localhost):5000" src | xargs -r sed -i -E "s#https?://(127\.0\.0\.1|localhost):5000##g" \
 && npm run build

# 2) Backend + built frontend
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg TZ=Asia/Manila
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
COPY deploy/docker/requirements-docker.txt ./
RUN pip install --no-cache-dir -r backend/requirements.txt -r requirements-docker.txt
COPY backend/ backend/
COPY data/ data/
COPY deploy/serve.py backend/serve.py
COPY --from=web /web/dist /app/frontend_dist
WORKDIR /app/backend
EXPOSE 5000
CMD ["python", "serve.py"]
