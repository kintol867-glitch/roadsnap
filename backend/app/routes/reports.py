from flask import Blueprint, request, jsonify, current_app
import os
import re

from app import db
from app.models.models import Report, Image, DetectionResult, Location, RouteSuggestion
from app.utils import allowed_file, save_upload
from app.detection import run_detection
from app.routing import suggest_alternate_route
from app.guidance import recommendation_for
from app.mailer import queue_report_emails
from app.safety import (
    within_bounds, client_ip, rate_limit_check, record_hit, check_location,
)

reports_bp = Blueprint("reports", __name__)

MAX_DESCRIPTION_LENGTH = 1000
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9-]{16,64}$")


def _clean_device_id(value):
    value = (value or "").strip()
    return value if DEVICE_ID_RE.match(value) else None


def _report_with_details(r):
    location = r.locations[0].to_dict() if r.locations else None
    detection = r.detection_results[0].to_dict() if r.detection_results else None
    image = r.images[0].to_dict() if r.images else None
    route_suggestion = None
    if r.locations and r.locations[0].route_suggestions:
        route_suggestion = r.locations[0].route_suggestions[0].to_dict()
    return {
        **r.to_dict(),
        "location": location,
        "detection": detection,
        "image": image,
        "route_suggestion": route_suggestion,
        "recommendation": recommendation_for(detection),
    }


@reports_bp.route("/ping")
def ping():
    return {"blueprint": "reports", "status": "ok"}


@reports_bp.route("", methods=["POST"])
def submit_report():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No image selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed (use png/jpg/jpeg)"}), 400

    try:
        latitude = float(request.form.get("latitude"))
        longitude = float(request.form.get("longitude"))
    except (TypeError, ValueError):
        return jsonify({"error": "latitude and longitude are required numbers"}), 400

    if not within_bounds(latitude, longitude):
        return jsonify(
            {"error": "That location is outside the area RoadSnap covers. Check the coordinates."}
        ), 400

    ip = client_ip()
    allowed, retry_after = rate_limit_check(ip)
    if not allowed:
        minutes = max(1, retry_after // 60)
        return jsonify(
            {"error": f"Too many reports from this device. Please try again in about {minutes} minute(s)."}
        ), 429

    # "camera" = taken with the in-app camera while GPS was read at the same moment
    raw_source = request.form.get("location_source")
    location_source = raw_source if raw_source in ("camera", "gps") else "manual"

    description = (request.form.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return jsonify(
            {"error": f"Description is too long (max {MAX_DESCRIPTION_LENGTH} characters)"}
        ), 400

    relative_path = save_upload(file)
    full_path = f"{current_app.config['UPLOAD_FOLDER']}/{relative_path.split('/')[-1]}"

    location_check, gps_distance = check_location(full_path, latitude, longitude)
    if location_source == "camera" and location_check == "unverified":
        # Live capture strips EXIF, but the GPS fix was taken at the moment of the shot.
        location_check = "verified"

    report = Report(
        Status="pending",
        Description=description or None,
        LocationSource=location_source,
        LocationCheck=location_check,
        GpsDistanceM=gps_distance,
        DeviceId=_clean_device_id(request.form.get("device_id")),
    )
    db.session.add(report)
    db.session.flush()

    image = Image(ReportID=report.ReportID, FilePath=relative_path)
    location = Location(ReportID=report.ReportID, Latitude=latitude, Longitude=longitude)
    db.session.add_all([image, location])
    db.session.flush()

    detection_result = run_detection(full_path)
    report.AiBox = detection_result.get("box")
    detection = DetectionResult(
        ReportID=report.ReportID,
        DamageType=detection_result["damage_type"],
        Severity=detection_result["severity"],
        Confidence=detection_result["confidence"],
    )
    db.session.add(detection)
    db.session.flush()

    route_suggestion = None
    if detection_result["severity"] == "Severe":
        alternate_route_text = suggest_alternate_route(latitude, longitude)
        suggestion = RouteSuggestion(
            LocationID=location.LocationID,
            AlternateRoute=alternate_route_text,
        )
        db.session.add(suggestion)
        db.session.flush()
        route_suggestion = suggestion.to_dict()

    db.session.commit()
    record_hit(ip)

    detection_dict = detection.to_dict()
    recommendation = recommendation_for(detection_dict)

    # Email the admin(s) and, if the person typed an address, send them a copy.
    # Runs in a background thread; it can never slow down or break the submission.
    base_url = f"{request.headers.get('X-Forwarded-Proto', request.scheme)}://{request.host}"
    emails = queue_report_emails(
        {
            "id": report.ReportID,
            "severity": detection_dict["severity"],
            "damage": detection_dict["damage_type"],
            "confidence": float(detection_dict["confidence"]),
            "lat": latitude,
            "lng": longitude,
            "description": description,
            "location_check": location_check,
            "recommendation": recommendation,
        },
        base_url,
        full_path,
        request.form.get("email"),
    )
    return jsonify(
        {
            "report": report.to_dict(),
            "image": image.to_dict(),
            "location": location.to_dict(),
            "detection": detection_dict,
            "route_suggestion": route_suggestion,
            "recommendation": recommendation,
            "email": {"admin_notified": emails["admin"], "confirmation_queued": emails["reporter"]},
            "public": detection_dict["damage_type"] != "none",
        }
    ), 201


@reports_bp.route("", methods=["GET"])
def list_reports():
    status_filter = request.args.get("status")

    query = Report.query
    if status_filter:
        query = query.filter_by(Status=status_filter)
    else:
        query = query.filter(Report.Status != "removed")

    # Reports whose photo GPS contradicts the pin stay hidden from the public
    # until an admin verifies them.
    query = query.filter(
        db.not_(db.and_(Report.LocationCheck == "mismatch", Report.Status != "verified"))
    )

    # Photos where the AI found no damage (a selfie, a face, a random object) are
    # hidden from the public automatically. An admin can still make one public
    # by marking it verified (for example when the AI missed real damage).
    no_damage_ids = db.session.query(DetectionResult.ReportID).filter(
        DetectionResult.DamageType == "none"
    )
    query = query.filter(
        db.not_(db.and_(Report.Status != "verified", Report.ReportID.in_(no_damage_ids)))
    )

    reports = query.order_by(Report.SubmittedAt.desc()).all()

    results = []
    for r in reports:
        location = r.locations[0].to_dict() if r.locations else None
        detection = r.detection_results[0].to_dict() if r.detection_results else None
        image = r.images[0].to_dict() if r.images else None

        route_suggestion = None
        if r.locations and r.locations[0].route_suggestions:
            route_suggestion = r.locations[0].route_suggestions[0].to_dict()

        results.append(
            {
                **r.to_dict(),
                "location": location,
                "detection": detection,
                "image": image,
                "route_suggestion": route_suggestion,
                "recommendation": recommendation_for(detection),
            }
        )

    return jsonify({"count": len(results), "reports": results})


def _my_report_or_error(report_id):
    """The report, but only if it belongs to the device named in X-Device-Id."""
    device_id = _clean_device_id(request.headers.get("X-Device-Id"))
    report = Report.query.get(report_id)
    if not device_id or not report or report.DeviceId != device_id:
        return None, (jsonify({"error": "Report not found on this device"}), 404)
    return report, None


@reports_bp.route("/mine", methods=["GET"])
def my_reports():
    """Reports submitted from this browser/device (no account needed)."""
    device_id = _clean_device_id(request.headers.get("X-Device-Id"))
    if not device_id:
        return jsonify({"count": 0, "reports": []})

    reports = (
        Report.query.filter_by(DeviceId=device_id)
        .order_by(Report.SubmittedAt.desc())
        .all()
    )
    results = [_report_with_details(r) for r in reports]
    return jsonify({"count": len(results), "reports": results})


@reports_bp.route("/mine/<int:report_id>", methods=["PATCH"])
def edit_my_report(report_id):
    report, error = _my_report_or_error(report_id)
    if error:
        return error
    if report.Status == "removed":
        return jsonify({"error": "This report was removed by an admin."}), 400

    data = request.get_json(silent=True) or {}
    if "description" not in data:
        return jsonify({"error": "description is required"}), 400
    description = (data.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return jsonify(
            {"error": f"Description is too long (max {MAX_DESCRIPTION_LENGTH} characters)"}
        ), 400

    report.Description = description or None
    db.session.commit()
    return jsonify({"message": "Report updated", "report": report.to_dict()})


@reports_bp.route("/mine/<int:report_id>", methods=["DELETE"])
def delete_my_report(report_id):
    report, error = _my_report_or_error(report_id)
    if error:
        return error
    if report.Status != "pending":
        return jsonify(
            {"error": "Only reports that are still pending can be deleted. Ask an admin to remove others."}
        ), 400

    upload_folder = current_app.config["UPLOAD_FOLDER"]
    for image in report.images:
        path = os.path.join(upload_folder, os.path.basename(image.FilePath))
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            pass

    db.session.delete(report)
    db.session.commit()
    return jsonify({"message": "Report deleted", "report_id": report_id})


@reports_bp.route("/<int:report_id>", methods=["GET"])
def get_report(report_id):
    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    detections = [d.to_dict() for d in report.detection_results]
    return jsonify(
        {
            **report.to_dict(),
            "images": [i.to_dict() for i in report.images],
            "locations": [l.to_dict() for l in report.locations],
            "detections": detections,
            "comments": [c.to_dict() for c in report.comments],
            "recommendation": recommendation_for(detections[0]) if detections else None,
        }
    )