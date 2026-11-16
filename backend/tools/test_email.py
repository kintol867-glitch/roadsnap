"""
Checks your email settings by sending a sample report email right now.

Run from the backend folder (venv active):
    py tools\test_email.py you@example.com
Leave out the address to send only to ADMIN_NOTIFY_EMAIL.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import mailer  # noqa: E402

if not mailer.mail_configured():
    sys.exit("MAIL_USER / MAIL_PASSWORD are not set in .env yet.")

info = {
    "id": 0, "severity": "Severe", "damage": "pothole", "confidence": 0.87,
    "lat": 10.3157, "lng": 123.8854, "description": "Test email from RoadSnap",
    "location_check": "verified",
    "recommendation": {"headline": "High risk: avoid this stretch if you can.", "tips": ["Slow down.", "Use another route."]},
}
s = mailer._settings()
targets = [(mailer._admin_message, a) for a in s["admins"]]
if len(sys.argv) > 1:
    targets.append((mailer._reporter_message, sys.argv[1]))
if not targets:
    sys.exit("Nothing to send to. Set ADMIN_NOTIFY_EMAIL in .env or pass an address.")

for builder, to in targets:
    try:
        mailer.send_message(builder(info, "http://127.0.0.1:5000", None, to, s["sender"]))
        print("sent to", to)
    except Exception as exc:
        print("FAILED for", to, "->", exc)