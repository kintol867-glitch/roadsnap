import os
import uuid
from werkzeug.utils import secure_filename
from flask import current_app


def allowed_file(filename):
    """Check the file extension is one we accept (png/jpg/jpeg)."""
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in current_app.config["ALLOWED_EXTENSIONS"]
    )


def save_upload(file_storage):
    """
    Save an uploaded image with a unique filename so two people
    uploading 'photo.jpg' at the same time don't overwrite each other.
    Returns the relative path stored in the DB (e.g. 'uploads/abc123.jpg').
    """
    original_name = secure_filename(file_storage.filename)
    ext = original_name.rsplit(".", 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"

    upload_folder = current_app.config["UPLOAD_FOLDER"]
    full_path = os.path.join(upload_folder, unique_name)
    file_storage.save(full_path)

    return os.path.join("uploads", unique_name).replace("\\", "/")