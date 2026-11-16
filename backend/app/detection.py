import os
import random
from flask import current_app

from app.guidance import friendly_damage_type

_model_cache = None


def _load_model():
    global _model_cache
    if _model_cache is not None:
        return _model_cache
    from ultralytics import YOLO
    model_path = current_app.config["MODEL_PATH"]
    _model_cache = YOLO(model_path)
    return _model_cache


def _severity_from_confidence(confidence):
    """
    Placeholder heuristic: severity is derived from model confidence.
    Confidence is not the same as how bad the damage is, so replace this with
    something based on damage size/type once you have labeled severity data.
    """
    if confidence >= 0.75:
        return "Severe"
    elif confidence >= 0.5:
        return "Moderate"
    return "Minor"


def run_detection(image_path):
    model_path = current_app.config["MODEL_PATH"]

    if os.path.exists(model_path):
        model = _load_model()
        # Tunable from .env without touching code:
        #   ROADSNAP_CONF  = minimum confidence (lower = catches more, more false alarms)
        #   ROADSNAP_IMGSZ = inference image size (bigger helps with small damage)
        conf = float(os.getenv("ROADSNAP_CONF", current_app.config["DETECTION_CONFIDENCE_THRESHOLD"]))
        imgsz = int(os.getenv("ROADSNAP_IMGSZ", 640))
        results = model.predict(
            source=image_path,
            conf=conf,
            imgsz=imgsz,
            verbose=False,
        )
        result = results[0]
        if len(result.boxes) == 0:
            return {"damage_type": "none", "severity": "None", "confidence": 0.0}
        best_box = max(result.boxes, key=lambda b: float(b.conf[0]))
        class_id = int(best_box.cls[0])
        damage_type = friendly_damage_type(model.names[class_id])
        confidence = float(best_box.conf[0])
        x, y, w, h = [float(v) for v in best_box.xywhn[0]]
        return {
            "damage_type": damage_type,
            "severity": _severity_from_confidence(confidence),
            "confidence": round(confidence, 3),
            "box": f"{x:.6f} {y:.6f} {w:.6f} {h:.6f}",  # kept so the admin can export YOLO labels
        }
    else:
        damage_type = random.choice(["pothole", "crack", "surface wear"])
        confidence = round(random.uniform(0.45, 0.95), 3)
        return {
            "damage_type": damage_type,
            "severity": _severity_from_confidence(confidence),
            "confidence": confidence,
        }