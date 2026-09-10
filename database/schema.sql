-- ============================================================
-- RoadSnap Database Schema
-- Matches the Data Dictionary in Chapter III (Design & Methodology)
-- Target: MySQL 8.0+
-- ============================================================

CREATE DATABASE IF NOT EXISTS roadsnap_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE roadsnap_db;

-- ------------------------------------------------------------
-- Reports: one row per user-submitted road damage report
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Reports (
    ReportID    INT AUTO_INCREMENT PRIMARY KEY,
    SubmittedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Status      VARCHAR(20) NOT NULL DEFAULT 'pending'
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Images: the photo(s) attached to a report
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Images (
    ImageID   INT AUTO_INCREMENT PRIMARY KEY,
    ReportID  INT NOT NULL,
    FilePath  TEXT NOT NULL,
    CONSTRAINT fk_images_report
        FOREIGN KEY (ReportID) REFERENCES Reports(ReportID)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- DetectionResults: YOLOv8 output for a report's image
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS DetectionResults (
    DetectionID INT AUTO_INCREMENT PRIMARY KEY,
    ReportID    INT NOT NULL,
    DamageType  VARCHAR(50) NOT NULL,
    Severity    VARCHAR(20) NOT NULL,
    Confidence  DECIMAL(4,3) NOT NULL,
    CONSTRAINT fk_detection_report
        FOREIGN KEY (ReportID) REFERENCES Reports(ReportID)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Locations: geotag captured with each report
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Locations (
    LocationID INT AUTO_INCREMENT PRIMARY KEY,
    ReportID   INT NOT NULL,
    Latitude   DECIMAL(10,7) NOT NULL,
    Longitude  DECIMAL(10,7) NOT NULL,
    CONSTRAINT fk_locations_report
        FOREIGN KEY (ReportID) REFERENCES Reports(ReportID)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- RouteSuggestions: alternate route triggered for severe damage
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS RouteSuggestions (
    SuggestionID   INT AUTO_INCREMENT PRIMARY KEY,
    LocationID     INT NOT NULL,
    AlternateRoute TEXT NOT NULL,
    CONSTRAINT fk_suggestion_location
        FOREIGN KEY (LocationID) REFERENCES Locations(LocationID)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Admin: system administrators (moderation + dataset management)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Admin (
    AdminID  INT AUTO_INCREMENT PRIMARY KEY,
    Username VARCHAR(50) NOT NULL UNIQUE,
    Password VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Comments: public feedback on a report (account-free, per scope)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Comments (
    CommentID   INT AUTO_INCREMENT PRIMARY KEY,
    ReportID    INT NOT NULL,
    CommentText TEXT NOT NULL,
    CreatedAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comments_report
        FOREIGN KEY (ReportID) REFERENCES Reports(ReportID)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Posting: admin announcements tied to a specific report
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Posting (
    PostingID INT AUTO_INCREMENT PRIMARY KEY,
    AdminID   INT NOT NULL,
    ReportID  INT NOT NULL,
    Content   TEXT NOT NULL,
    PostedAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_posting_admin
        FOREIGN KEY (AdminID) REFERENCES Admin(AdminID)
        ON DELETE CASCADE,
    CONSTRAINT fk_posting_report
        FOREIGN KEY (ReportID) REFERENCES Reports(ReportID)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Helpful indexes for common queries (map display, moderation)
-- ------------------------------------------------------------
CREATE INDEX idx_reports_status ON Reports(Status);
CREATE INDEX idx_detection_severity ON DetectionResults(Severity);
CREATE INDEX idx_locations_lat_long ON Locations(Latitude, Longitude);