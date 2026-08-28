from flask import Blueprint

reports_bp = Blueprint("reports", __name__)


@reports_bp.route("/ping")
def ping():
    return {"blueprint": "reports", "status": "ok"}