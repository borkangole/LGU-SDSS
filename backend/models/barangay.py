import psycopg2
import psycopg2.extras
from config import Config

def get_conn():
    return psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor
    )

def get_all_barangays():
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT
            b.barangay_id,
            b.barangay_code,
            b.barangay_name,
            COUNT(DISTINCT h.household_id) AS total_households,
            COUNT(i.person_id)             AS total_individuals
        FROM tbl_barangays b
        LEFT JOIN tbl_households  h ON b.barangay_id  = h.barangay_id
        LEFT JOIN tbl_individuals i ON h.household_id = i.household_id
        GROUP BY b.barangay_id, b.barangay_code, b.barangay_name
        ORDER BY b.barangay_name
    """)
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_barangay_by_id(barangay_id):
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT
            b.barangay_id,
            b.barangay_code,
            b.barangay_name,
            COUNT(DISTINCT h.household_id) AS total_households,
            COUNT(i.person_id)             AS total_individuals
        FROM tbl_barangays b
        LEFT JOIN tbl_households  h ON b.barangay_id  = h.barangay_id
        LEFT JOIN tbl_individuals i ON h.household_id = i.household_id
        WHERE b.barangay_id = %s
        GROUP BY b.barangay_id, b.barangay_code, b.barangay_name
    """, (barangay_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None