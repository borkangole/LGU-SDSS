import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".."))  # backend modules
import psycopg2
import psycopg2.extras
from config import Config

conn = psycopg2.connect(
    Config.get_connection_string(),
    cursor_factory=psycopg2.extras.RealDictCursor
)
cur = conn.cursor()

users = [
    {
        "username":      "mswdo",
        "full_name":     "MSWDO User",
        "password_hash": "$2b$12$fhZx1KHFZtj2aADBEY8D.Oe/03V2oGXsB8SB0PE7OnIY2Wz2JKg8S",
        "role":          "MSWDO",
    },
    {
        "username":      "lgu",
        "full_name":     "LGU Planning User",
        "password_hash": "$2b$12$XVDQXdkrbp5M2iRpk2x20.eYJDP.XDOHpvDcm7UIO7akGmm5kmn9a",
        "role":          "LGU Planning",
    },
]

for u in users:
    cur.execute("""
        INSERT INTO tbl_users (username, full_name, password_hash, role, is_active, failed_attempts)
        VALUES (%s, %s, %s, %s, TRUE, 0)
        ON CONFLICT (username) DO NOTHING
    """, (u["username"], u["full_name"], u["password_hash"], u["role"]))
    print(f"✅ Created user: {u['username']} ({u['role']})")

conn.commit()
conn.close()
print("Done!")