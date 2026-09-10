from datetime import datetime
from app import db


class Report(db.Model):
    __tablename__ = "Reports"

    ReportID = db.Column(db.Integer, primary_key=True)
    SubmittedAt = db.Column(db.TIMESTAMP, nullable=False, default=datetime.utcnow)
    Status = db.Column(db.String(20), nullable=False, default="pending")

    images = db.relationship("Image", backref="report", cascade="all, delete-orphan")
    detection_results = db.relationship(
        "DetectionResult", backref="report", cascade="all, delete-orphan"
    )
    locations = db.relationship(
        "Location", backref="report", cascade="all, delete-orphan"
    )
    comments = db.relationship(
        "Comment", backref="report", cascade="all, delete-orphan"
    )
    postings = db.relationship(
        "Posting", backref="report", cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "report_id": self.ReportID,
            "submitted_at": self.SubmittedAt.isoformat() if self.SubmittedAt else None,
            "status": self.Status,
        }


class Image(db.Model):
    __tablename__ = "Images"

    ImageID = db.Column(db.Integer, primary_key=True)
    ReportID = db.Column(db.Integer, db.ForeignKey("Reports.ReportID"), nullable=False)
    FilePath = db.Column(db.Text, nullable=False)

    def to_dict(self):
        return {"image_id": self.ImageID, "file_path": self.FilePath}


class DetectionResult(db.Model):
    __tablename__ = "DetectionResults"

    DetectionID = db.Column(db.Integer, primary_key=True)
    ReportID = db.Column(db.Integer, db.ForeignKey("Reports.ReportID"), nullable=False)
    DamageType = db.Column(db.String(50), nullable=False)
    Severity = db.Column(db.String(20), nullable=False)
    Confidence = db.Column(db.Numeric(4, 3), nullable=False)

    def to_dict(self):
        return {
            "detection_id": self.DetectionID,
            "damage_type": self.DamageType,
            "severity": self.Severity,
            "confidence": float(self.Confidence) if self.Confidence is not None else None,
        }


class Location(db.Model):
    __tablename__ = "Locations"

    LocationID = db.Column(db.Integer, primary_key=True)
    ReportID = db.Column(db.Integer, db.ForeignKey("Reports.ReportID"), nullable=False)
    Latitude = db.Column(db.Numeric(10, 7), nullable=False)
    Longitude = db.Column(db.Numeric(10, 7), nullable=False)

    route_suggestions = db.relationship(
        "RouteSuggestion", backref="location", cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "location_id": self.LocationID,
            "latitude": float(self.Latitude),
            "longitude": float(self.Longitude),
        }


class RouteSuggestion(db.Model):
    __tablename__ = "RouteSuggestions"

    SuggestionID = db.Column(db.Integer, primary_key=True)
    LocationID = db.Column(
        db.Integer, db.ForeignKey("Locations.LocationID"), nullable=False
    )
    AlternateRoute = db.Column(db.Text, nullable=False)

    def to_dict(self):
        return {
            "suggestion_id": self.SuggestionID,
            "alternate_route": self.AlternateRoute,
        }


class Admin(db.Model):
    __tablename__ = "Admin"

    AdminID = db.Column(db.Integer, primary_key=True)
    Username = db.Column(db.String(50), nullable=False, unique=True)
    Password = db.Column(db.String(255), nullable=False)

    postings = db.relationship("Posting", backref="admin", cascade="all, delete-orphan")

    def to_dict(self):
        return {"admin_id": self.AdminID, "username": self.Username}


class Comment(db.Model):
    __tablename__ = "Comments"

    CommentID = db.Column(db.Integer, primary_key=True)
    ReportID = db.Column(db.Integer, db.ForeignKey("Reports.ReportID"), nullable=False)
    CommentText = db.Column(db.Text, nullable=False)
    CreatedAt = db.Column(db.TIMESTAMP, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "comment_id": self.CommentID,
            "comment_text": self.CommentText,
            "created_at": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }


class Posting(db.Model):
    __tablename__ = "Posting"

    PostingID = db.Column(db.Integer, primary_key=True)
    AdminID = db.Column(db.Integer, db.ForeignKey("Admin.AdminID"), nullable=False)
    ReportID = db.Column(db.Integer, db.ForeignKey("Reports.ReportID"), nullable=False)
    Content = db.Column(db.Text, nullable=False)
    PostedAt = db.Column(db.TIMESTAMP, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "posting_id": self.PostingID,
            "content": self.Content,
            "posted_at": self.PostedAt.isoformat() if self.PostedAt else None,
        }