import csv
import io
import json
import os
import zipfile
from collections import Counter
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, session, current_app, send_file

from app import db
from app.models.models import Admin, Report, Posting
from app.utils import allowed_file, save_upload
from app.guidance import DAMAGE_LABELS
from app.auth import hash_password, verify_password, admin_required
from app.guidance import recommendation_for

admin_bp = Blueprint("admin", __name__)

MAX_DESCRIPTION_LENGTH = 1000


@admin_bp.route("/ping")
def ping():
    return {"blueprint": "admin", "status": "ok"}


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------

@admin_bp.route("/login", methods=["POST"])
def login():
    """Log in with username + password. Sets a server-side session on success."""
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "username and password are required"}), 400

    admin = Admin.query.filter_by(Username=username).first()
    if not admin or not verify_password(password, admin.Password):
        return jsonify({"error": "Invalid username or password"}), 401

    session["admin_id"] = admin.AdminID
    session["admin_username"] = admin.Username

    return jsonify({"message": "Login successful", "admin": admin.to_dict()})


@admin_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})


@admin_bp.route("/me", methods=["GET"])
def me():
    """Check whether the current browser session is logged in as an admin."""
    if not session.get("admin_id"):
        return jsonify({"logged_in": False})
    return jsonify(
        {
            "logged_in": True,
            "admin_id": session["admin_id"],
            "username": session["admin_username"],
        }
    )


# ------------------------------------------------------------------
# Moderation (all routes below require admin login)
# ------------------------------------------------------------------

@admin_bp.route("/reports", methods=["GET"])
@admin_required
def list_all_reports():
    """
    List ALL reports regardless of status, for moderation.
    Optional query param: ?status=pending
    """
    status_filter = request.args.get("status")

    query = Report.query
    if status_filter:
        query = query.filter_by(Status=status_filter)

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


@admin_bp.route("/reports/<int:report_id>/status", methods=["PATCH"])
@admin_required
def update_report_status(report_id):
    """
    Moderate a report: set its status to one of
    pending / verified / flagged / in_progress / fixed / removed.
    """
    data = request.get_json(silent=True) or {}
    new_status = data.get("status")

    allowed = {"pending", "verified", "flagged", "in_progress", "fixed", "removed"}
    if new_status not in allowed:
        return jsonify({"error": f"status must be one of {sorted(allowed)}"}), 400

    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    report.Status = new_status
    if new_status == "fixed":
        report.FixedAt = report.FixedAt or datetime.utcnow()
    else:
        report.FixedAt = None
    db.session.commit()

    return jsonify({"message": "Status updated", "report": report.to_dict()})


@admin_bp.route("/reports/<int:report_id>", methods=["PATCH"])
@admin_required
def update_report(report_id):
    """Edit a report's description (the Update in CRUD)."""
    data = request.get_json(silent=True) or {}
    if "description" not in data:
        return jsonify({"error": "description is required"}), 400

    description = (data.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return jsonify(
            {"error": f"Description is too long (max {MAX_DESCRIPTION_LENGTH} characters)"}
        ), 400

    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    report.Description = description or None
    db.session.commit()

    return jsonify({"message": "Report updated", "report": report.to_dict()})


@admin_bp.route("/reports/<int:report_id>", methods=["DELETE"])
@admin_required
def delete_report(report_id):
    """
    Permanently delete a report: its photo files, image, location, detection,
    route suggestion, comments and postings. This cannot be undone
    (use status 'removed' to just hide a report).
    """
    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    upload_folder = current_app.config["UPLOAD_FOLDER"]
    deleted_files = []
    failed_files = []
    file_paths = [image.FilePath for image in report.images]
    if report.AfterImagePath:
        file_paths.append(report.AfterImagePath)
    for file_path in file_paths:
        filename = os.path.basename(file_path)
        full_path = os.path.join(upload_folder, filename)
        try:
            if os.path.exists(full_path):
                os.remove(full_path)
                deleted_files.append(filename)
        except OSError:
            failed_files.append(filename)

    db.session.delete(report)
    db.session.commit()

    return jsonify(
        {
            "message": "Report deleted",
            "report_id": report_id,
            "deleted_files": deleted_files,
            "failed_files": failed_files,
        }
    )


@admin_bp.route("/reports/<int:report_id>/posting", methods=["POST"])
@admin_required
def add_posting(report_id):
    """Admin adds a public announcement/update tied to a specific report."""
    data = request.get_json(silent=True) or {}
    content = data.get("content")

    if not content:
        return jsonify({"error": "content is required"}), 400

    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    posting = Posting(
        AdminID=session["admin_id"],
        ReportID=report_id,
        Content=content,
    )
    db.session.add(posting)
    db.session.commit()

    return jsonify({"message": "Posting added", "posting": posting.to_dict()}), 201



# ------------------------------------------------------------------
# Repair tracking: mark damage as fixed, with an optional "after" photo
# ------------------------------------------------------------------

def _remove_upload(relative_path):
    if not relative_path:
        return
    path = os.path.join(current_app.config["UPLOAD_FOLDER"], os.path.basename(relative_path))
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


@admin_bp.route("/reports/<int:report_id>/after-photo", methods=["POST"])
@admin_required
def add_after_photo(report_id):
    """Mark a report as fixed and attach a photo of the repaired road."""
    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    file = request.files.get("image")
    if not file or file.filename == "":
        return jsonify({"error": "Choose a photo of the repaired road"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed (use png/jpg/jpeg)"}), 400

    note = (request.form.get("note") or "").strip()[:255]

    _remove_upload(report.AfterImagePath)
    report.AfterImagePath = save_upload(file)
    report.RepairNote = note or None
    report.Status = "fixed"
    report.FixedAt = datetime.utcnow()
    db.session.commit()

    return jsonify({"message": "Marked as fixed", "report": report.to_dict()})


# ------------------------------------------------------------------
# System and model monitoring
# ------------------------------------------------------------------

ACCEPTED = {"verified", "in_progress", "fixed"}   # admin agreed the damage is real
REJECTED = {"flagged", "removed"}                 # admin doubted it or took it down


def _model_path():
    return current_app.config.get("MODEL_PATH") or ""


def _folder_stats(folder):
    count, size = 0, 0
    try:
        for name in os.listdir(folder):
            full = os.path.join(folder, name)
            if os.path.isfile(full):
                count += 1
                size += os.path.getsize(full)
    except OSError:
        pass
    return count, size


@admin_bp.route("/monitor", methods=["GET"])
@admin_required
def monitor():
    reports = Report.query.order_by(Report.SubmittedAt.asc()).all()

    # --- system health ---
    try:
        db.session.execute(db.text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    model_path = _model_path()
    model_exists = bool(model_path) and os.path.exists(model_path)
    model_info = {"present": model_exists, "name": os.path.basename(model_path) if model_path else None}
    if model_exists:
        stat = os.stat(model_path)
        model_info["size_mb"] = round(stat.st_size / (1024 * 1024), 1)
        model_info["modified"] = datetime.utcfromtimestamp(stat.st_mtime).isoformat()

    metrics = None
    metrics_path = os.path.join(os.path.dirname(model_path), "metrics.json") if model_path else ""
    if metrics_path and os.path.exists(metrics_path):
        try:
            with open(metrics_path, encoding="utf-8") as fh:
                metrics = json.load(fh)
        except (OSError, ValueError):
            metrics = None

    files, size = _folder_stats(current_app.config["UPLOAD_FOLDER"])

    # --- activity ---
    today = datetime.utcnow().date()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    per_day = Counter(r.SubmittedAt.date() for r in reports if r.SubmittedAt)
    activity = [{"date": d.isoformat(), "count": per_day.get(d, 0)} for d in days]

    by_status = Counter(r.Status for r in reports)
    by_source = Counter(r.LocationSource for r in reports)
    by_check = Counter(r.LocationCheck for r in reports)

    # --- detection quality ---
    by_severity, by_type = Counter(), Counter()
    confidences, buckets = [], Counter()
    feedback = {}
    missed, no_damage = [], 0
    for r in reports:
        det = r.detection_results[0] if r.detection_results else None
        if not det:
            continue
        by_severity[det.Severity] += 1
        by_type[det.DamageType] += 1
        has_damage = det.DamageType != "none"
        if has_damage:
            conf = float(det.Confidence)
            confidences.append(conf)
            buckets[min(int(conf * 10), 9)] += 1
        else:
            no_damage += 1

        fb = feedback.setdefault(det.DamageType, {"accepted": 0, "rejected": 0, "waiting": 0})
        if r.Status in ACCEPTED:
            fb["accepted"] += 1
        elif r.Status in REJECTED:
            fb["rejected"] += 1
        else:
            fb["waiting"] += 1

        if not has_damage and r.Status in ACCEPTED:
            missed.append(
                {
                    "report_id": r.ReportID,
                    "image": r.images[0].FilePath if r.images else None,
                    "description": r.Description,
                    "status": r.Status,
                }
            )

    accepted = sum(v["accepted"] for v in feedback.values())
    rejected = sum(v["rejected"] for v in feedback.values())
    reviewed = accepted + rejected

    return jsonify(
        {
            "generated_at": datetime.utcnow().isoformat(),
            "health": {
                "database": db_ok,
                "model": model_info,
                "uploads": {"files": files, "size_mb": round(size / (1024 * 1024), 1)},
            },
            "totals": {
                "reports": len(reports),
                "by_status": dict(by_status),
                "by_source": dict(by_source),
                "by_location_check": dict(by_check),
                "fixed": by_status.get("fixed", 0),
            },
            "activity": activity,
            "detection": {
                "by_severity": dict(by_severity),
                "by_type": dict(by_type),
                "no_damage": no_damage,
                "no_damage_rate": round(no_damage / len(reports), 3) if reports else 0,
                "avg_confidence": round(sum(confidences) / len(confidences), 3) if confidences else None,
                "confidence_buckets": [buckets.get(i, 0) for i in range(10)],
            },
            "feedback": {
                "accepted": accepted,
                "rejected": rejected,
                "reviewed": reviewed,
                "approval_rate": round(accepted / reviewed, 3) if reviewed else None,
                "by_type": feedback,
            },
            "missed_detections": missed,
            "training_metrics": metrics,
            "retraining": _retraining_status(
                [r.ReportID for r in reports if r.TrainingUse]
            ),
        }
    )


# ------------------------------------------------------------------
# Dataset management: choose photos for the next retraining round
# ------------------------------------------------------------------

# ---- retraining schedule: a small JSON log next to the model file (no database change) ----

def _log_path():
    base = os.path.dirname(_model_path()) or "model"
    return os.path.join(base, "retrain_log.json")


def _read_log():
    try:
        with open(_log_path(), encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _append_log(event):
    log = _read_log()
    log.append(event)
    path = _log_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(log[-200:], fh, indent=2)
    except OSError:
        pass


def _retraining_status(selected_ids):
    """How the training set stands compared with the last export / retraining."""
    log = _read_log()
    exports = [e for e in log if e.get("type") == "export"]
    retrained = [e for e in log if e.get("type") == "retrained"]
    last_export = exports[-1] if exports else None
    last_retrained = retrained[-1] if retrained else None

    already = set(last_export.get("report_ids", [])) if last_export else set()
    new_selected = len([i for i in selected_ids if i not in already])

    threshold = int(os.getenv("ROADSNAP_RETRAIN_AT", "50"))
    every_days = int(os.getenv("ROADSNAP_RETRAIN_DAYS", "30"))
    days_since = None
    if last_retrained:
        try:
            days_since = (datetime.utcnow() - datetime.fromisoformat(last_retrained["date"])).days
        except (ValueError, KeyError):
            days_since = None

    due_reason = None
    if new_selected >= threshold:
        due_reason = f"{new_selected} new photos are selected (target: {threshold})"
    elif selected_ids and (days_since is None or days_since >= every_days):
        due_reason = (
            "the model was never retrained from this dataset"
            if days_since is None
            else f"{days_since} days since the last retraining (every {every_days} days)"
        )

    return {
        "threshold": threshold,
        "every_days": every_days,
        "new_selected": new_selected,
        "last_export": last_export.get("date") if last_export else None,
        "last_retrained": last_retrained.get("date") if last_retrained else None,
        "days_since_retrained": days_since,
        "due": bool(due_reason),
        "due_reason": due_reason,
        "history": [
            {k: v for k, v in e.items() if k != "report_ids"} for e in reversed(log[-8:])
        ],
    }


def _class_order():
    raw = os.getenv("ROADSNAP_CLASS_ORDER", "D00,D10,D20,D40")
    return [c.strip() for c in raw.split(",") if c.strip()]


def _suggested_class(damage_type):
    wanted = (damage_type or "").strip().lower()
    for code, label in DAMAGE_LABELS.items():
        if label.lower() == wanted or code.lower() == wanted:
            return code
    return None


@admin_bp.route("/dataset", methods=["GET"])
@admin_required
def dataset_list():
    classes = _class_order()
    reports = Report.query.filter(Report.Status != "removed").order_by(Report.SubmittedAt.desc()).all()

    items = []
    for r in reports:
        det = r.detection_results[0] if r.detection_results else None
        item = {
            **r.to_dict(),
            "image": r.images[0].to_dict() if r.images else None,
            "detection": det.to_dict() if det else None,
            "training_use": bool(r.TrainingUse),
            "training_class": r.TrainingClass,
            "has_box": bool(r.AiBox),
            "suggested_class": _suggested_class(det.DamageType) if det else None,
            "missed": bool(det and det.DamageType == "none" and r.Status in ACCEPTED),
        }
        items.append(item)

    selected = [i for i in items if i["training_use"]]
    per_class = Counter(i["training_class"] for i in selected if i["training_class"])
    ready = sum(1 for i in selected if i["training_class"] == "background" or (i["training_class"] and i["has_box"]))

    return jsonify(
        {
            "classes": classes + ["background"],
            "items": items,
            "summary": {
                "selected": len(selected),
                "ready_to_export": ready,
                "need_boxes": len(selected) - ready,
                "per_class": dict(per_class),
            },
            "retraining": _retraining_status([i["report_id"] for i in selected]),
        }
    )


@admin_bp.route("/dataset/<int:report_id>", methods=["PATCH"])
@admin_required
def dataset_update(report_id):
    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    data = request.get_json(silent=True) or {}
    valid = set(_class_order() + ["background"])

    if "training_class" in data:
        value = data["training_class"] or None
        if value is not None and value not in valid:
            return jsonify({"error": f"training_class must be one of {sorted(valid)}"}), 400
        report.TrainingClass = value

    if "training_use" in data:
        use = bool(data["training_use"])
        if use and not report.TrainingClass:
            return jsonify({"error": "Choose the correct damage class first"}), 400
        report.TrainingUse = use

    db.session.commit()
    return jsonify(
        {"message": "Dataset updated", "training_use": bool(report.TrainingUse), "training_class": report.TrainingClass}
    )


@admin_bp.route("/dataset/export", methods=["GET"])
@admin_required
def dataset_export():
    classes = _class_order()
    reports = Report.query.filter_by(TrainingUse=True).order_by(Report.ReportID.asc()).all()
    upload_folder = current_app.config["UPLOAD_FOLDER"]

    buffer = io.BytesIO()
    manifest = [["report_id", "file", "class", "split", "label_source", "status"]]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        ready = []
        for r in reports:
            if not r.images or not r.TrainingClass:
                continue
            src = os.path.join(upload_folder, os.path.basename(r.images[0].FilePath))
            if not os.path.exists(src):
                continue
            ready.append((r, src))

        usable = [(r, s) for r, s in ready if r.TrainingClass == "background" or r.AiBox]
        for index, (r, src) in enumerate(ready):
            ext = os.path.splitext(src)[1].lower() or ".jpg"
            name = f"report_{r.ReportID}"
            if r.TrainingClass == "background" or r.AiBox:
                split = "val" if (len(usable) >= 5 and usable.index((r, src)) % 5 == 4) else "train"
                zf.write(src, f"images/{split}/{name}{ext}")
                if r.TrainingClass == "background":
                    label = ""
                    source = "background (empty label)"
                else:
                    cls_id = classes.index(r.TrainingClass) if r.TrainingClass in classes else 0
                    label = f"{cls_id} {r.AiBox}\n"
                    source = "AI box (check it!)"
                zf.writestr(f"labels/{split}/{name}.txt", label)
                manifest.append([r.ReportID, f"{name}{ext}", r.TrainingClass, split, source, r.Status])
            else:
                zf.write(src, f"to_label/{name}{ext}")
                manifest.append([r.ReportID, f"{name}{ext}", r.TrainingClass, "to_label", "needs a box drawn by hand", r.Status])

        # YOLO needs a validation folder; reuse one photo if there are too few images.
        if usable and len(usable) < 5:
            r, src = usable[0]
            ext = os.path.splitext(src)[1].lower() or ".jpg"
            zf.write(src, f"images/val/report_{r.ReportID}{ext}")
            zf.writestr(f"labels/val/report_{r.ReportID}.txt",
                        "" if r.TrainingClass == "background" else f"{classes.index(r.TrainingClass)} {r.AiBox}\n")

        out = io.StringIO()
        csv.writer(out).writerows(manifest)
        zf.writestr("manifest.csv", out.getvalue())
        zf.writestr(
            "data.yaml",
            "path: .\ntrain: images/train\nval: images/val\nnc: %d\nnames: [%s]\n"
            % (len(classes), ", ".join(classes)),
        )
        zf.writestr(
            "README.txt",
            "RoadSnap dataset export\n"
            "=======================\n"
            "images/ + labels/  : ready for YOLO training (labels use the AI's box; open them in Roboflow\n"
            "                     or CVAT and fix any box that is wrong before training).\n"
            "to_label/          : photos the AI could not box (for example missed damage). Draw the boxes\n"
            "                     yourself, then add them to images/ and labels/.\n"
            "Class order        : " + ", ".join(f"{i}={c}" for i, c in enumerate(classes)) + "\n"
            "This MUST match your model's class order (print model.names). Change it with the\n"
            "ROADSNAP_CLASS_ORDER setting in .env if they differ.\n"
            "Always keep a test set of photos the model never trains on.\n",
        )

    _append_log(
        {
            "type": "export",
            "date": datetime.utcnow().isoformat(timespec="seconds"),
            "images": len([m for m in manifest[1:]]),
            "ready": len([m for m in manifest[1:] if m[3] != "to_label"]),
            "to_label": len([m for m in manifest[1:] if m[3] == "to_label"]),
            "report_ids": [m[0] for m in manifest[1:]],
        }
    )

    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"roadsnap_dataset_{datetime.utcnow():%Y%m%d}.zip",
    )


@admin_bp.route("/dataset/retrained", methods=["POST"])
@admin_required
def dataset_mark_retrained():
    """Log that the model was retrained (and optionally its new test score)."""
    data = request.get_json(silent=True) or {}
    event = {
        "type": "retrained",
        "date": datetime.utcnow().isoformat(timespec="seconds"),
        "note": (data.get("note") or "").strip()[:200],
    }
    try:
        if data.get("map50") not in (None, ""):
            event["map50"] = round(float(data["map50"]), 3)
    except (TypeError, ValueError):
        return jsonify({"error": "map50 must be a number like 0.55"}), 400
    _append_log(event)
    return jsonify({"message": "Retraining logged", "event": event})