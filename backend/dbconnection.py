"""
Run this from your backend folder (same place as app.py):
    python check_db_connection.py

It uses the EXACT same Config class your Flask app uses, so whatever
it prints is exactly what Flask is actually talking to.
"""
from config import Config
import psycopg2
import psycopg2.extras

print("Resolved connection settings (after .env is loaded, if present):")
print(f"  DB_HOST = {Config.DB_HOST}")
print(f"  DB_PORT = {Config.DB_PORT}")
print(f"  DB_NAME = {Config.DB_NAME}")
print(f"  DB_USER = {Config.DB_USER}")
print()

conn = psycopg2.connect(Config.get_connection_string(), cursor_factory=psycopg2.extras.RealDictCursor)
cur = conn.cursor()

cur.execute("SELECT current_database(), inet_server_port(), version();")
row = cur.fetchone()
print("Actually connected to:")
print(f"  current_database() = {row['current_database']}")
print(f"  inet_server_port()  = {row['inet_server_port']}")
print(f"  version()           = {row['version'][:50]}...")
print()

cur.execute("SELECT count(*) AS n FROM tbl_households;")
print(f"tbl_households row count seen by Flask: {cur.fetchone()['n']}")

cur.execute("SELECT count(*) AS n FROM tbl_individuals;")
print(f"tbl_individuals row count seen by Flask: {cur.fetchone()['n']}")

cur.execute("SELECT household_id FROM tbl_individuals LIMIT 3;")
print(f"Sample household_ids in tbl_individuals: {[r['household_id'] for r in cur.fetchall()]}")

conn.close()