"""
YOLOv8 detection wrapper.

Right now there's no trained RoadSnap model yet (that comes after you collect
and label images from RDD2022 + your own barangay photos). So this file does
two things:

1. If a real trained weights file exists at MODEL_PATH, it loads and uses it.
2. If not, it falls back to a clearly-labeled PLACEHOLDER result so the rest
   of the system (routes, database, frontend) can be built and tested now,
   without waiting for the model to be trained.

Once you have roadsnap_yolov8.pt trained, drop it in backend/model/ and the
real model path will be used automatically -- no other code needs to change.
"""

import os
import random
from flask import current_app

_model_cache = None


def _load_model():
    """Load the YOLOv8 model once and cache it (loading is slow)."""
    global _model_cache
    if _model_cache is not None:
        return _model_cache

    from ultralytics import YOLO

    model_path = current_app.config["MODEL_PATH"]
    _model_cache = YOLO(model_path)
    return _model_cache


def _severity_from_confidence(confidence):
    """
    Maps a confidence score to a severity bucket.
    Placeholder heuristic -- refine this once you have real labeled data
    on what confidence/box-size actually correlates with severity.
    """
    if confidence >= 0.75:
        return "Severe"
    elif confidence >= 0.5:
        return "Moderate"
    return "Minor"


def run_detection(image_path):
    """
    Runs damage detection on an uploaded image.
    Returns a dict: {damage_type, severity, confidence}
    """
    model_path = current_app.config["MODEL_PATH"]

    if os.path.exists(model_path):
        model = _load_model()
        results = model.predict(
            source=image_path,
            conf=current_app.config["DETECTION_CONFIDENCE_THRESHOLD"],
            verbose=False,
        )

        result = results[0]
        if len(result.boxes) == 0:
            return {"damage_type": "none", "severity": "None", "confidence": 0.0}

        best_box = max(result.boxes, key=lambda b: float(b.conf[0]))
        class_id = int(best_box.cls[0])
        damage_type = model.names[class_id]
        confidence = float(best_box.conf[0])

        return {
            "damage_type": damage_type,
            "severity": _severity_from_confidence(confidence),
            "confidence": round(confidence, 3),
        }

    else:
        damage_type = random.choice(["pothole", "crack", "surface wear"])
        confidence = round(random.uniform(0.45, 0.95), 3)
        return {
            "damage_type": damage_type,
            "severity": _severity_from_confidence(confidence),
            "confidence": confidence,
        }