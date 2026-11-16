"""
Shows what the model sees in a photo, at several confidence levels.

Run from the backend folder (venv active):
    py tools\\test_detect.py path\\to\\photo.jpg
    py tools\\test_detect.py path\\to\\photo.jpg model\\roadsnap_yolov8.pt
"""
import sys
from ultralytics import YOLO

if len(sys.argv) < 2:
    sys.exit("Usage: py tools\\test_detect.py <photo> [model.pt]")

photo = sys.argv[1]
model_path = sys.argv[2] if len(sys.argv) > 2 else "model/roadsnap_yolov8.pt"
model = YOLO(model_path)
print("Model classes:", model.names)

for imgsz in (640, 960):
    for conf in (0.25, 0.10, 0.05):
        r = model.predict(source=photo, conf=conf, imgsz=imgsz, verbose=False)[0]
        found = sorted(
            ((float(b.conf[0]), model.names[int(b.cls[0])]) for b in r.boxes), reverse=True
        )
        top = ", ".join(f"{n} {c:.2f}" for c, n in found[:4]) or "nothing"
        print(f"imgsz={imgsz} conf>={conf:<4}: {len(found)} box(es) -> {top}")