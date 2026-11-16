// Leaflet map: plots reports as color-coded pins by severity, with
// severity filters, live counts and popups showing description + safety tips.

const SEVERITY_COLORS = {
  Minor: "#ffc800",
  Moderate: "#ff7a00",
  Severe: "#e60023",
  None: "#8a93a3",
  Fixed: "#00a651",
};
const SEVERITIES = ["Severe", "Moderate", "Minor", "None", "Fixed"];
const HEAT_WEIGHT = { Severe: 1, Moderate: 0.6, Minor: 0.3 };

// Default center: Cebu City, Philippines (adjust to your area if needed)
const map = L.map("map").setView([10.3157, 123.8854], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

// One layer group per severity so the checkboxes can toggle them.
const layers = {};
SEVERITIES.forEach((s) => {
  layers[s] = L.layerGroup();
});
const counts = { Severe: 0, Moderate: 0, Minor: 0, None: 0, Fixed: 0 };
const heatPoints = [];
let heatLayer = null;
let heatOn = false;

// Same escaping as UI.esc, kept here so the map page doesn't need ui.js.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function severityColor(severity) {
  return SEVERITY_COLORS[severity] || "#999999";
}

function guidanceHtml(rec) {
  if (!rec) return "";
  const tips = (rec.tips || []).map((t) => `<li>${esc(t)}</li>`).join("");
  return `
    <details class="popup-guidance">
      <summary>🛡️ ${esc(rec.headline)}</summary>
      <ul>${tips}</ul>
    </details>
  `;
}

function makeMarker(report) {
  const {
    location, detection, image, report_id, submitted_at,
    route_suggestion, description, recommendation, trust,
  } = report;
  if (!location) return null;

  const severity = detection ? detection.severity : "None";
  const isFixed = report.status === "fixed";
  const color = isFixed ? SEVERITY_COLORS.Fixed : severityColor(severity);

  // Strong, easy-to-spot pins: big solid dot, thick white ring, and a soft halo
  // (the halo of Severe damage pulses so it stands out from far away).
  const size = { Severe: 15, Moderate: 13, Minor: 11 }[severity] || 10;
  const unconfirmed = trust === "unconfirmed" && !isFixed;
  const marker = L.circleMarker([location.latitude, location.longitude], {
    radius: size,
    fillColor: color,
    color: "#ffffff",
    weight: 3,
    fillOpacity: unconfirmed ? 0.7 : 1,
    dashArray: unconfirmed ? "4 3" : null,
  });
  const halo = L.circleMarker([location.latitude, location.longitude], {
    radius: size + 11,
    stroke: false,
    fillColor: color,
    fillOpacity: 0.28,
    interactive: false,
    className: !isFixed && severity === "Severe" ? "pin-halo pin-halo-pulse" : "pin-halo",
  });

  const imageUrl = image
    ? `${API_BASE_URL.replace("/api", "")}/static/${image.file_path}`
    : null;

  const damageType = detection ? detection.damage_type : "Unknown";
  const confidence = detection ? Math.round(detection.confidence * 100) : "-";
  const date = submitted_at ? new Date(submitted_at).toLocaleDateString() : "";
  const trustTags = {
    verified: ' <span class="verified-tag">✔ Verified by admin</span>',
    likely: ' <span class="likely-tag">📍 Location matches photo</span>',
    unconfirmed: ' <span class="unconfirmed-tag">⚠ Unconfirmed</span>',
  };
  const verified = trustTags[trust] || "";

  const progressTag = report.status === "in_progress"
    ? ' <span class="progress-tag">🔧 Repair in progress</span>'
    : isFixed ? ' <span class="verified-tag">✅ Fixed</span>' : "";
  const afterUrl = report.after_image
    ? `${API_BASE_URL.replace("/api", "")}/static/${report.after_image}`
    : null;
  const afterHtml = isFixed
    ? `<div class="popup-after"><strong>After repair</strong>${report.repair_note ? ` &middot; ${esc(report.repair_note)}` : ""}
         ${afterUrl ? `<img src="${esc(afterUrl)}" alt="After repair" />` : ""}</div>`
    : "";

  const popupHtml = `
    <div class="popup-content">
      ${imageUrl ? `<img src="${esc(imageUrl)}" alt="Report photo" />` : ""}
      <strong>Report #${esc(report_id)}</strong>${verified}${progressTag}<br/>
      <span class="badge ${esc(severity.toLowerCase())}">${esc(severity === "None" ? "No damage" : severity)}</span>
      &nbsp;${esc(damageType)} &middot; ${esc(confidence)}% confidence<br/>
      <small>${esc(date)}</small>
      ${description ? `<div class="popup-desc">${esc(description)}</div>` : ""}
      ${afterHtml}
      ${isFixed ? "" : guidanceHtml(recommendation)}
      ${route_suggestion && !isFixed ? `<div style="margin-top:8px; padding:8px; background:#fdeaea; border-radius:6px; font-size:0.8rem;">⚠️ ${esc(route_suggestion.alternate_route)}</div>` : ""}
    </div>
  `;

  // On phones the filter bar sits at the top, so keep popups clear of it.
  marker.bindPopup(popupHtml, {
    maxWidth: 300,
    autoPanPaddingTopLeft: [10, window.innerWidth <= 720 ? 150 : 10],
    autoPanPaddingBottomRight: [10, window.innerWidth <= 720 ? 70 : 10],
  });
  return { marker, halo, severity, key: isFixed ? "Fixed" : severity, lat: location.latitude, lng: location.longitude, isFixed };
}

function updateCounts() {
  SEVERITIES.forEach((s) => {
    document.getElementById(`count-${s}`).textContent = counts[s];
  });
  const total = SEVERITIES.reduce((sum, s) => sum + counts[s], 0);
  document.getElementById("map-total").textContent =
    total === 0 ? "No reports yet" : `${total} report${total === 1 ? "" : "s"} on the map`;
}

function isChecked(sev) {
  const box = document.querySelector(`[data-sev="${sev}"]`);
  return !box || box.checked;
}

function visibleBounds() {
  const points = [];
  SEVERITIES.forEach((s) => {
    if (isChecked(s)) {
      layers[s].eachLayer((m) => points.push(m.getLatLng()));
    }
  });
  return points.length ? L.latLngBounds(points) : null;
}

function fitToReports() {
  const bounds = visibleBounds();
  if (bounds) map.fitBounds(bounds.pad(0.2), { maxZoom: 17 });
}

// Show the pins (per the checkboxes) or the hotspot heat layer, never both.
function applyView() {
  SEVERITIES.forEach((s) => {
    if (!heatOn && isChecked(s)) layers[s].addTo(map);
    else map.removeLayer(layers[s]);
  });
  if (heatLayer) {
    if (heatOn) heatLayer.addTo(map);
    else map.removeLayer(heatLayer);
  }
  document.getElementById("heat-legend").style.display = heatOn ? "block" : "none";
}

function wireControls() {
  document.querySelectorAll("[data-sev]").forEach((box) => {
    box.addEventListener("change", applyView);
  });

  const heatToggle = document.getElementById("heat-toggle");
  if (typeof L.heatLayer !== "function") {
    heatToggle.closest("label").style.display = "none"; // plugin couldn't load (offline)
  } else {
    heatToggle.addEventListener("change", () => {
      heatOn = heatToggle.checked;
      applyView();
    });
  }
  document.getElementById("fit-btn").addEventListener("click", fitToReports);
}

async function loadReports() {
  try {
    const response = await fetch(`${API_BASE_URL}/reports`);
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const data = await response.json();

    data.reports.forEach((report) => {
      const made = makeMarker(report);
      if (!made) return;
      const key = SEVERITIES.includes(made.key) ? made.key : "None";
      if (key !== "None") made.halo.addTo(layers[key]);
      made.marker.addTo(layers[key]);
      counts[key] += 1;
      if (!made.isFixed && HEAT_WEIGHT[made.severity]) {
        heatPoints.push([made.lat, made.lng, HEAT_WEIGHT[made.severity]]);
      }
    });

    if (typeof L.heatLayer === "function") {
      heatLayer = L.heatLayer(heatPoints, {
        radius: 32,
        blur: 24,
        maxZoom: 16,
        gradient: { 0.2: "#ffc800", 0.5: "#ff7a00", 0.8: "#e60023", 1.0: "#7a0010" },
      });
    }

    // "No damage" pins are hidden by default; the rest are shown.
    applyView();
    updateCounts();
    fitToReports();
  } catch (err) {
    console.error("Failed to load reports:", err);
    document.getElementById("map-total").textContent = "Couldn't load reports";
    const note = L.control({ position: "topright" });
    note.onAdd = () => {
      const div = L.DomUtil.create("div", "map-error");
      div.textContent = "Couldn't load reports. Is the backend running?";
      return div;
    };
    note.addTo(map);
  }
}

wireControls();
loadReports();