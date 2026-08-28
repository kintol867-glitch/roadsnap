import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_NAME = os.getenv("DB_NAME", "roadsnap_db")

    SQLALCHEMY_DATABASE_URI = (
        f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-key-change-me")

    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "app/static/uploads")
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH_MB", 10)) * 1024 * 1024
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}

    MODEL_PATH = os.getenv("MODEL_PATH", "model/roadsnap_yolov8.pt")
    DETECTION_CONFIDENCE_THRESHOLD = float(
        os.getenv("DETECTION_CONFIDENCE_THRESHOLD", 0.4)
    )