"""
Production entry point used inside Docker (replaces `python app.py`).

Serves the Flask API (all /api/* routes from app.py) AND the built React
frontend from one address, using waitress (a production WSGI server)
instead of Flask's development server.
"""
import os
from flask import send_from_directory, abort

from app import app  # the existing Flask app, unchanged

DIST = os.environ.get("FRONTEND_DIST", "/app/frontend_dist")


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def frontend(path):
    if path.startswith("api/"):
        abort(404)
    full = os.path.join(DIST, path)
    if path and os.path.isfile(full):
        return send_from_directory(DIST, path)
    # React Router: every other path loads the app shell
    return send_from_directory(DIST, "index.html")


if __name__ == "__main__":
    from waitress import serve
    port = int(os.environ.get("PORT", "5000"))
    print(f"LGU-SDSS running on http://{os.environ.get('HOST', '0.0.0.0')}:{port}")
    serve(app, host=os.environ.get("HOST", "0.0.0.0"), port=port, threads=8)
