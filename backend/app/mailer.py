"""
Email notifications for new reports.

Configure in backend/.env (nothing is sent until MAIL_USER and MAIL_PASSWORD are set):

    MAIL_HOST=smtp.gmail.com
    MAIL_PORT=587
    MAIL_SECURITY=starttls        # starttls (port 587), ssl (port 465) or none
    MAIL_USER=yourname@gmail.com
    MAIL_PASSWORD=your-16-char-app-password
    MAIL_FROM=RoadSnap <yourname@gmail.com>     # optional
    ADMIN_NOTIFY_EMAIL=admin1@gmail.com,admin2@gmail.com

Emails are sent in a background thread, so a slow or broken mail server never
delays or breaks a report submission. Failures are printed in the server window.
"""
import html
import mimetypes
import os
import re
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import make_msgid

try:  # the app normally loads .env already; this just makes the helper script work too
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

EMAIL_RE = re.compile(r"^[^@\s<>\",;]+@[^@\s<>\",;]+\.[^@\s<>\",;]+$")
SEVERITY_COLORS = {"Severe": "#e60023", "Moderate": "#ff7a00", "Minor": "#ffc800", "None": "#8a93a3"}


def clean_email(value):
    value = (value or "").strip()
    return value if value and len(value) <= 120 and EMAIL_RE.match(value) else None


def _settings():
    return {
        "host": os.getenv("MAIL_HOST", "smtp.gmail.com"),
        "port": int(os.getenv("MAIL_PORT", "587")),
        "security": os.getenv("MAIL_SECURITY", "starttls").lower(),
        "user": os.getenv("MAIL_USER", ""),
        "password": os.getenv("MAIL_PASSWORD", ""),
        "sender": os.getenv("MAIL_FROM") or os.getenv("MAIL_USER", "roadsnap@localhost"),
        "admins": [e for e in (clean_email(x) for x in os.getenv("ADMIN_NOTIFY_EMAIL", "").split(",")) if e],
    }


def mail_configured():
    s = _settings()
    return bool(s["user"] and s["password"]) or s["security"] == "none"


def admin_recipients():
    return _settings()["admins"]


def send_message(msg):
    """Send one EmailMessage. Raises on failure (callers decide what to do)."""
    s = _settings()
    if s["security"] == "ssl":
        server = smtplib.SMTP_SSL(s["host"], s["port"], timeout=20, context=ssl.create_default_context())
    else:
        server = smtplib.SMTP(s["host"], s["port"], timeout=20)
    try:
        if s["security"] == "starttls":
            server.starttls(context=ssl.create_default_context())
        if s["user"] and s["password"]:
            server.login(s["user"], s["password"])
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass


def _build(subject, to, text, html_body, photo_path, sender):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg.set_content(text)

    cid = make_msgid(domain="roadsnap")
    msg.add_alternative(html_body.replace("{{CID}}", cid[1:-1]), subtype="html")
    if photo_path and os.path.exists(photo_path):
        ctype = mimetypes.guess_type(photo_path)[0] or "image/jpeg"
        maintype, subtype = ctype.split("/", 1)
        with open(photo_path, "rb") as fh:
            msg.get_payload()[1].add_related(fh.read(), maintype, subtype, cid=cid)
    return msg


def _facts(info):
    sev = info["severity"]
    damage = "no damage detected" if info["damage"] == "none" else info["damage"]
    conf = f"{round(info['confidence'] * 100)}%" if info["damage"] != "none" else "n/a"
    map_link = f"https://www.openstreetmap.org/?mlat={info['lat']}&mlon={info['lng']}#map=18/{info['lat']}/{info['lng']}"
    return sev, damage, conf, map_link


CHECK_TEXT = {
    "verified": "Location matches the photo's GPS data",
    "mismatch": "WARNING: the photo's GPS does not match the pin (held back from the public map)",
    "unverified": "No GPS data in the photo (location unconfirmed)",
}


def _admin_message(info, base_url, photo_path, to, sender):
    sev, damage, conf, map_link = _facts(info)
    dash = f"{base_url}/admin-dashboard.html"
    check = CHECK_TEXT.get(info["location_check"], "")
    text = (
        f"New road damage report #{info['id']}\n\n"
        f"Severity: {sev}\nDamage: {damage} ({conf} confidence)\n"
        f"Location: {info['lat']}, {info['lng']}\nMap: {map_link}\n"
        f"Location check: {check}\n"
        f"Description: {info['description'] or '(none)'}\n\n"
        f"Review it: {dash}\n"
    )
    color = SEVERITY_COLORS.get(sev, "#8a93a3")
    body = f"""
<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2433">
  <h2 style="margin:0 0 8px">New road damage report #{info['id']}</h2>
  <p style="margin:0 0 12px"><span style="background:{color};color:#fff;padding:4px 10px;border-radius:10px;font-weight:bold">{html.escape(sev)}</span>
     &nbsp;{html.escape(damage)} &middot; {html.escape(conf)} confidence</p>
  <img src="cid:{{{{CID}}}}" alt="Report photo" style="width:100%;max-height:320px;object-fit:cover;border-radius:10px" />
  <p><b>Location:</b> {info['lat']}, {info['lng']} &middot; <a href="{html.escape(map_link)}">open map</a></p>
  <p><b>Location check:</b> {html.escape(check)}</p>
  <p><b>Description:</b> {html.escape(info['description'] or '(none)')}</p>
  <p><a href="{html.escape(dash)}" style="background:#2f6fed;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Review in dashboard</a></p>
</div>"""
    return _build(f"[RoadSnap] New {sev} report #{info['id']}: {damage}", to, text, body, photo_path, sender)


def _reporter_message(info, base_url, photo_path, to, sender):
    sev, damage, conf, map_link = _facts(info)
    rec = info.get("recommendation") or {}
    tips = rec.get("tips") or []
    mine = f"{base_url}/my-reports.html"
    text = (
        f"Thank you! Your RoadSnap report #{info['id']} was received.\n\n"
        f"AI result: {sev} - {damage} ({conf} confidence)\n"
        f"Location: {info['lat']}, {info['lng']}  {map_link}\n"
        f"Status: waiting for admin review\n\n"
        + (f"{rec.get('headline', '')}\n" + "\n".join(f"- {t}" for t in tips) + "\n\n" if rec else "")
        + f"Track it on the same phone or browser: {mine}\n"
    )
    color = SEVERITY_COLORS.get(sev, "#8a93a3")
    tips_html = "".join(f"<li>{html.escape(t)}</li>" for t in tips)
    body = f"""
<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2433">
  <h2 style="margin:0 0 8px">Thank you for your report!</h2>
  <p>Your RoadSnap report <b>#{info['id']}</b> was received and is waiting for admin review.</p>
  <p><span style="background:{color};color:#fff;padding:4px 10px;border-radius:10px;font-weight:bold">{html.escape(sev)}</span>
     &nbsp;{html.escape(damage)} &middot; {html.escape(conf)} confidence</p>
  <img src="cid:{{{{CID}}}}" alt="Your photo" style="width:100%;max-height:320px;object-fit:cover;border-radius:10px" />
  <p><b>Location:</b> {info['lat']}, {info['lng']} &middot; <a href="{html.escape(map_link)}">open map</a></p>
  {f'<div style="background:#eaf3ff;border-left:4px solid #2f6fed;padding:10px 14px;border-radius:6px"><b>{html.escape(rec.get("headline", ""))}</b><ul>{tips_html}</ul></div>' if rec else ''}
  <p style="font-size:13px;color:#5c6779">Track your report on the same phone or browser: <a href="{html.escape(mine)}">My Reports</a>.
  We did not save your email address.</p>
</div>"""
    return _build(f"Your RoadSnap report #{info['id']} was received", to, text, body, photo_path, sender)


def _worker(info, base_url, photo_path, admins, reporter):
    s = _settings()
    jobs = [(_admin_message, a) for a in admins] + ([(_reporter_message, reporter)] if reporter else [])
    for builder, to in jobs:
        try:
            send_message(builder(info, base_url, photo_path, to, s["sender"]))
            print(f"[mail] sent report #{info['id']} email to {to}", flush=True)
        except Exception as exc:
            print(f"[mail] FAILED to send to {to}: {exc}", flush=True)


def queue_report_emails(info, base_url, photo_path, reporter_email=None):
    """
    Queue the admin notification (+ optional confirmation for the reporter).
    Returns {"admin": bool, "reporter": bool} = whether each email was queued.
    """
    if not mail_configured():
        return {"admin": False, "reporter": False}
    admins = admin_recipients()
    reporter = clean_email(reporter_email)
    if not admins and not reporter:
        return {"admin": False, "reporter": False}
    threading.Thread(
        target=_worker, args=(info, base_url, photo_path, admins, reporter), daemon=True
    ).start()
    return {"admin": bool(admins), "reporter": bool(reporter)}