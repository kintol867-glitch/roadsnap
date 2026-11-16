"""
Anti-prank checks for submitted reports:
  - area limit (reports outside the allowed area are rejected)
  - photo GPS check (EXIF location in the photo vs. the submitted pin)
  - simple per-device rate limit

Settings can be overridden in .env:
  ROADSNAP_BOUNDS=min_lat,min_lng,max_lat,max_lng   (default: Cebu province)
  ROADSNAP_RATE_LIMIT=10          (reports allowed per window, per device)
  ROADSNAP_RATE_WINDOW=3600       (window in seconds)
  ROADSNAP_MATCH_RADIUS_M=150     (photo GPS must be within this many meters of the pin)
"""
import math
import os
import time
from collections import defaultdict, deque

from flask import request
from PIL import Image

DEFAULT_BOUNDS = (9.30, 123.20, 11.35, 124.10)  # Cebu province, roughly

_hits = defaultdict(deque)


def _bounds():
    raw = os.environ.get("ROADSNAP_BOUNDS")
    if raw:
        try:
            parts = [float(x) for x in raw.split(",")]
            if len(parts) == 4:
                return tuple(parts)
        except ValueError:
            pass
    return DEFAULT_BOUNDS


def _int_env(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def within_bounds(lat, lng):
    min_lat, min_lng, max_lat, max_lng = _bounds()
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


def client_ip():
    """Best guess of the real visitor address (works behind a Cloudflare tunnel)."""
    cf = request.headers.get("CF-Connecting-IP")
    if cf:
        return cf.strip()
    fwd = request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "unknown"


def rate_limit_check(ip):
    """Returns (allowed, retry_after_seconds). Call record_hit() after accepting a report."""
    limit = _int_env("ROADSNAP_RATE_LIMIT", 10)
    window = _int_env("ROADSNAP_RATE_WINDOW", 3600)
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return False, int(window - (now - q[0])) + 1
    return True, 0


def record_hit(ip):
    _hits[ip].append(time.time())


def distance_m(lat1, lng1, lat2, lng2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = p2 - p1
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _to_degrees(value, ref):
    try:
        d, m, s = (float(x) for x in value)
    except (TypeError, ValueError):
        return None
    deg = d + m / 60.0 + s / 3600.0
    if str(ref).upper() in ("S", "W"):
        deg = -deg
    return deg


def photo_gps(path):
    """Return (lat, lng) stored inside the photo, or None if the photo has no GPS data."""
    try:
        with Image.open(path) as img:
            gps = img.getexif().get_ifd(0x8825)
        if not gps or 2 not in gps or 4 not in gps:
            return None
        lat = _to_degrees(gps[2], gps.get(1, "N"))
        lng = _to_degrees(gps[4], gps.get(3, "E"))
        if lat is None or lng is None:
            return None
        return lat, lng
    except Exception:
        return None


def check_location(photo_path, lat, lng):
    """
    Compare the photo's own GPS with the submitted pin.
    Returns (check, distance_m):
      "verified"   - photo GPS is within the match radius
      "mismatch"   - photo GPS is somewhere else
      "unverified" - the photo has no GPS data
    """
    found = photo_gps(photo_path)
    if not found:
        return "unverified", None
    dist = int(round(distance_m(lat, lng, found[0], found[1])))
    radius = _int_env("ROADSNAP_MATCH_RADIUS_M", 150)
    return ("verified" if dist <= radius else "mismatch"), dist