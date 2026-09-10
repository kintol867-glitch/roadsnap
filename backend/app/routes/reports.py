from flask import Blueprint, request, jsonify, current_app

from app import db
from app.models.models import Report, Image, DetectionResult, Location, RouteSuggestion
from app.utils import allowed_file, save_upload
from app.detection import run_detection

reports_bp = Blueprint("reports", __name__)


@reports_bp.route("/ping")
def ping():
    return {"blueprint": "reports", "status": "ok"}


@reports_bp.route("", methods=["POST"])
def submit_report():
    """
    Submit a new road damage report.
    Expects multipart/form-data with:
      - image: the photo file
      - latitude: float
      - longitude: float
    """
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

    relative_path = save_upload(file)
    full_path = f"{current_app.config['UPLOAD_FOLDER']}/{relative_path.split('/')[-1]}"

    report = Report(Status="pending")
    db.session.add(report)
    db.session.flush()

    image = Image(ReportID=report.ReportID, FilePath=relative_path)
    location = Location(ReportID=report.ReportID, Latitude=latitude, Longitude=longitude)
    db.session.add_all([image, location])
    db.session.flush()

    detection_result = run_detection(full_path)
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
        suggestion = RouteSuggestion(
            LocationID=location.LocationID,
            AlternateRoute="Alternate route suggestion pending — routing logic not yet built (see Step 9).",
        )
        db.session.add(suggestion)
        db.session.flush()
        route_suggestion = suggestion.to_dict()

    db.session.commit()

    return jsonify(
        {
            "report": report.to_dict(),
            "image": image.to_dict(),
            "location": location.to_dict(),
            "detection": detection.to_dict(),
            "route_suggestion": route_suggestion,
        }
    ), 201


@reports_bp.route("", methods=["GET"])
def list_reports():
    """
    List reports for the public map.
    Optional query param: ?status=verified (defaults to showing all non-removed)
    """
    status_filter = request.args.get("status")

    query = Report.query
    if status_filter:
        query = query.filter_by(Status=status_filter)
    else:
        query = query.filter(Report.Status != "removed")

    reports = query.order_by(Report.SubmittedAt.desc()).all()

    results = []
    for r in reports:
        location = r.locations[0].to_dict() if r.locations else None
        detection = r.detection_results[0].to_dict() if r.detection_results else None
        image = r.images[0].to_dict() if r.images else None
        results.append(
            {
                **r.to_dict(),
                "location": location,
                "detection": detection,
                "image": image,
            }
        )

    return jsonify({"count": len(results), "reports": results})


@reports_bp.route("/<int:report_id>", methods=["GET"])
def get_report(report_id):
    """Full detail view of a single report."""
    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    return jsonify(
        {
            **report.to_dict(),
            "images": [i.to_dict() for i in report.images],
            "locations": [l.to_dict() for l in report.locations],
            "detections": [d.to_dict() for d in report.detection_results],
            "comments": [c.to_dict() for c in report.comments],
        }
    )