// Live Server (port 5500) talks to Flask on 5000; when Flask serves the pages itself, use a relative path.
const API_BASE_URL = window.location.port === "5500" ? "http://127.0.0.1:5000/api" : "/api";

// Anonymous per-browser id so a person can see their own reports without an account.
function getDeviceId() {
  try {
    let id = localStorage.getItem("roadsnap_device_id");
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "dev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
      localStorage.setItem("roadsnap_device_id", id);
    }
    return id;
  } catch (e) {
    window.__roadsnapTempId = window.__roadsnapTempId || ("tmp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 14) + "0000");
    return window.__roadsnapTempId;
  }
}