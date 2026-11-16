import os

from flask import send_from_directory

from app import create_app

app = create_app()

# The website pages live in backend/frontend. Serving them from Flask means the
# pages and the API share one address, so one link works on a phone too.
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")


@app.route("/")
def home():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def frontend_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


if __name__ == "__main__":
    # debug=False on purpose: with a public tunnel, Flask's debug mode would
    # expose a remote code console. Restart the server after changing Python files.
    app.run(host="0.0.0.0", port=5000, debug=False)