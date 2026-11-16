from functools import wraps
from flask import session, jsonify
from werkzeug.security import generate_password_hash, check_password_hash


def hash_password(plain_password):
    """Turn a plaintext password into a secure hash for storage."""
    return generate_password_hash(plain_password)


def verify_password(plain_password, hashed_password):
    """Check a login attempt's password against the stored hash."""
    return check_password_hash(hashed_password, plain_password)


def admin_required(view_func):
    """
    Decorator that protects a route so only a logged-in admin can access it.
    Relies on Flask's server-side session (set at /api/admin/login).
    """
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("admin_id"):
            return jsonify({"error": "Admin login required"}), 401
        return view_func(*args, **kwargs)
    return wrapper