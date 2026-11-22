from flask          import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token, jwt_required, get_jwt_identity
)
import bcrypt
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta
from config   import Config

auth_bp = Blueprint("auth", __name__)

def get_conn():
    return psycopg2.connect(
        Config.get_connection_string(),
        cursor_factory=psycopg2.extras.RealDictCursor
    )

# ── POST /api/auth/login ──────────────────────────────────────
@auth_bp.route("/login", methods=["POST"])
def login():
    data     = request.get_json()
    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM tbl_users WHERE username = %s", (username,)
        )
        user = cur.fetchone()

        # ── User not found ────────────────────────────────────
        if not user:
            return jsonify({"error": "Invalid username or password."}), 401

        # ── Account inactive ──────────────────────────────────
        if not user["is_active"]:
            return jsonify({"error": "Account is disabled. Contact administrator."}), 403

        # ── Account locked ────────────────────────────────────
        if user["locked_until"] and user["locked_until"] > datetime.now():
            remaining = int((user["locked_until"] - datetime.now()).total_seconds() / 60)
            return jsonify({
                "error": f"Account locked. Try again in {remaining} minute(s)."
            }), 423

        # ── Wrong password ────────────────────────────────────
        pw_match = bcrypt.checkpw(
            password.encode("utf-8"),
            user["password_hash"].encode("utf-8")
        )

        if not pw_match:
            attempts = user["failed_attempts"] + 1
            lock_until = None

            # Lock after 5 failed attempts for 15 minutes
            if attempts >= 5:
                lock_until = datetime.now() + timedelta(minutes=15)
                cur.execute("""
                    UPDATE tbl_users
                    SET failed_attempts = %s, locked_until = %s
                    WHERE user_id = %s
                """, (attempts, lock_until, user["user_id"]))
                conn.commit()
                return jsonify({
                    "error": "Too many failed attempts. Account locked for 15 minutes."
                }), 423
            else:
                cur.execute("""
                    UPDATE tbl_users
                    SET failed_attempts = %s
                    WHERE user_id = %s
                """, (attempts, user["user_id"]))
                conn.commit()
                return jsonify({
                    "error": f"Invalid username or password. {5 - attempts} attempt(s) remaining."
                }), 401

        # ── Success ───────────────────────────────────────────
        # Reset failed attempts + update last login
        cur.execute("""
            UPDATE tbl_users
            SET failed_attempts = 0,
                locked_until    = NULL,
                last_login      = NOW()
            WHERE user_id = %s
        """, (user["user_id"],))
        conn.commit()

        # Create JWT token (expires in 8 hours)
        token = create_access_token(
            identity=str(user["user_id"]),
            additional_claims={
                "username":  user["username"],
                "full_name": user["full_name"],
                "role":      user["role"],
            },
            expires_delta=timedelta(hours=8)
        )

        return jsonify({
            "token":     token,
            "user": {
                "user_id":   user["user_id"],
                "username":  user["username"],
                "full_name": user["full_name"],
                "role":      user["role"],
            }
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

# ── GET /api/auth/me ──────────────────────────────────────────
@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    from flask_jwt_extended import get_jwt
    claims = get_jwt()
    return jsonify({
        "user_id":   get_jwt_identity(),
        "username":  claims.get("username"),
        "full_name": claims.get("full_name"),
        "role":      claims.get("role"),
    }), 200

# ── POST /api/auth/logout ─────────────────────────────────────
@auth_bp.route("/logout", methods=["POST"])
@jwt_required()
def logout():
    # JWT is stateless — client just deletes token
    return jsonify({"message": "Logged out successfully."}), 200

# ── POST /api/auth/change-password ───────────────────────────
@auth_bp.route("/change-password", methods=["POST"])
@jwt_required()
def change_password():
    user_id  = get_jwt_identity()
    data     = request.get_json()
    old_pw   = (data.get("old_password") or "").strip()
    new_pw   = (data.get("new_password") or "").strip()

    if not old_pw or not new_pw:
        return jsonify({"error": "Both old and new password are required."}), 400

    if len(new_pw) < 8:
        return jsonify({"error": "New password must be at least 8 characters."}), 400

    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT * FROM tbl_users WHERE user_id = %s", (user_id,))
        user = cur.fetchone()

        if not bcrypt.checkpw(old_pw.encode(), user["password_hash"].encode()):
            return jsonify({"error": "Current password is incorrect."}), 401

        new_hash = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt(12)).decode()
        cur.execute(
            "UPDATE tbl_users SET password_hash = %s WHERE user_id = %s",
            (new_hash, user_id)
        )
        conn.commit()
        return jsonify({"message": "Password changed successfully."}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()