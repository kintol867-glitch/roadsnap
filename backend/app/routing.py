"""
Route suggestion logic.

When a report comes back "Severe", we try to suggest an alternate route
using free OpenStreetMap services:

1. Nominatim (reverse geocoding) -- finds the road name at the damage point.
2. Overpass API -- finds other named roads nearby to suggest as an alternative.

Both are free public OSM services (same ecosystem as the Leaflet map you're
already using), no API key needed. Since they're public/shared servers,
requests are rate-limited and can occasionally time out -- this code always
falls back to a still-useful generic message rather than failing the report
submission if that happens.
"""

import requests

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Nominatim's usage policy requires a descriptive User-Agent identifying the app
HEADERS = {"User-Agent": "RoadSnap-Capstone-Project/1.0"}

REQUEST_TIMEOUT = 6  # seconds -- fail fast rather than hang the report submission


def _get_road_name(latitude, longitude):
    """Reverse-geocode a point to find the name of the road it's on."""
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"lat": latitude, "lon": longitude, "format": "json"},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("address", {}).get("road")
    except (requests.RequestException, ValueError):
        return None


def _get_nearby_roads(latitude, longitude, exclude_name, radius_m=400):
    """
    Query Overpass for named roads within radius_m of the point,
    excluding the damaged road itself.
    """
    query = f"""
    [out:json][timeout:5];
    way(around:{radius_m},{latitude},{longitude})["highway"]["name"];
    out tags;
    """
    try:
        resp = requests.post(
            OVERPASS_URL,
            data={"data": query},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        elements = resp.json().get("elements", [])

        names = []
        for el in elements:
            name = el.get("tags", {}).get("name")
            if name and name != exclude_name and name not in names:
                names.append(name)

        return names[:3]  # a few candidates is enough
    except (requests.RequestException, ValueError):
        return []


def suggest_alternate_route(latitude, longitude):
    """
    Returns a human-readable alternate route suggestion string for a
    severe damage report at the given coordinates.
    """
    damaged_road = _get_road_name(latitude, longitude)

    if not damaged_road:
        return (
            "A severe road hazard was reported at this location. "
            "Please proceed with caution or use a different route if possible."
        )

    nearby_roads = _get_nearby_roads(latitude, longitude, exclude_name=damaged_road)

    if nearby_roads:
        alternatives = " or ".join(nearby_roads)
        return f"Severe damage reported on {damaged_road}. Consider taking {alternatives} instead."
    else:
        return (
            f"Severe damage reported on {damaged_road}. "
            "No nearby alternate roads found in OpenStreetMap data — proceed with caution."
        )