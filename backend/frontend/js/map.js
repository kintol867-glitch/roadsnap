// Initializes the Leaflet map and plots all reports as color-coded pins by severity.

const SEVERITY_COLORS = {
  Minor: "#f4b400",
  Moderate: "#ff8c1a",
  Severe: "#e03131",
};

// Default center: Cebu City, Philippines (adjust to your area if needed)
const map = L.map("map").setView([10.3157, 123.8854], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

function severityColor(severity) {
  return SEVERITY_COLORS[severity] || "#999999";
}

function makeMarker(report) {
  const { location, detection, image, report_id, submitted_at } = report;
  if (!location) return null;

  const color = severityColor(detection ? detection.severity : null);

  const marker = L.circleMarker([location.latitude, location.longitude], {
    radius: 9,
    fillColor: color,
    color: "#ffffff",
    weight: 2,
    fillOpacity: 0.9,
  });

  const imageUrl = image
    ? `${API_BASE_URL.replace("/api", "")}/static/${image.file_path}`
    : null;

  const damageType = detection ? detection.damage_type : "Unknown";
  const severity = detection ? detection.severity : "Unknown";
  const confidence = detection ? Math.round(detection.confidence * 100) : "-";
  const date = submitted_at ? new Date(submitted_at).toLocaleDateString() : "";

  const popupHtml = `
    <div class="popup-content">
      ${imageUrl ? `<img src="${imageUrl}" alt="Report photo" />` : ""}
      <strong>Report #${report_id}</strong><br/>
      <span class="badge ${severity.toLowerCase()}">${severity}</span>
      &nbsp;${damageType} &middot; ${confidence}% confidence<br/>
      <small>${date}</small>
    </div>
  `;

  marker.bindPopup(popupHtml);
  return marker;
}

async function loadReports() {
  try {
    const response = await fetch(`${API_BASE_URL}/reports`);
    const data = await response.json();

    data.reports.forEach((report) => {
      const marker = makeMarker(report);
      if (marker) marker.addTo(map);
    });
  } catch (err) {
    console.error("Failed to load reports:", err);
  }
}

loadReports();