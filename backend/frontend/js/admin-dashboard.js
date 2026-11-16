// Admin dashboard: stats, charts, search/filter/sort, moderation actions,
// description editing, permanent delete, photo viewer and CSV export.
// Uses UI (js/ui.js) for confirm dialogs and toasts.

const welcomeMsg = document.getElementById("welcome-msg");
const reportsContainer = document.getElementById("reports-container");
const logoutLink = document.getElementById("logout-link");
const refreshBtn = document.getElementById("refresh-btn");
const exportBtn = document.getElementById("export-btn");
const updatedAt = document.getElementById("updated-at");
const resultCount = document.getElementById("result-count");

const statsEl = document.getElementById("stats");
const severityChartEl = document.getElementById("severity-chart");
const typeChartEl = document.getElementById("type-chart");

const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");
const severityFilter = document.getElementById("severity-filter");
const locationFilter = document.getElementById("location-filter");
const sortSelect = document.getElementById("sort-select");

const SEVERITY_ORDER = ["Severe", "Moderate", "Minor", "None"];
const SEVERITY_RANK = { Severe: 3, Moderate: 2, Minor: 1, None: 0 };
const SEVERITY_COLORS = {
  Severe: "#e60023",
  Moderate: "#ff7a00",
  Minor: "#ffc800",
  None: "#8a93a3",
};

let allReports = [];

const STATUS_PROMPTS = {
  verified: {
    title: "Verify this report?",
    message: "It will be marked as verified and stay visible on the public map.",
    confirmText: "Verify",
    danger: false,
    done: "Report verified.",
  },
  flagged: {
    title: "Flag this report?",
    message: "Flag it as suspicious or needing a closer look. It stays visible until you remove it.",
    confirmText: "Flag",
    danger: false,
    done: "Report flagged.",
  },
  removed: {
    title: "Remove this report?",
    message: "It will be hidden from the public map. You can bring it back later by verifying it. To erase it for good, use Delete.",
    confirmText: "Remove",
    danger: true,
    done: "Report removed from the public map.",
  },
  in_progress: {
    title: "Mark repair as in progress?",
    message: "The public map and My Reports will show that repair work has started.",
    confirmText: "Mark in progress",
    danger: false,
    done: "Report marked as in progress.",
  },
  pending: {
    title: "Set back to pending?",
    message: "The report will go back to the review queue.",
    confirmText: "Set pending",
    danger: false,
    done: "Report set back to pending.",
  },
};

function goToLogin() {
  window.location.href = "admin-login.html";
}

// Fetch helper: always sends the session cookie, redirects on 401, throws on errors.
async function api(path, options = {}) {
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options,
  });

  if (resp.status === 401) {
    UI.toast("Your session expired. Please log in again.", "error");
    setTimeout(goToLogin, 1200);
    throw new Error("Not logged in");
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `Request failed (${resp.status})`);
  }
  return data;
}

// --- Check login, redirect if not authenticated ---
async function checkAuth() {
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/me`, { credentials: "include" });
    const data = await resp.json();

    if (!data.logged_in) {
      goToLogin();
      return false;
    }
    welcomeMsg.textContent = `Logged in as ${data.username}`;
    return true;
  } catch (err) {
    welcomeMsg.textContent = "Can't reach the server.";
    UI.toast(UI.errorMessage(err), "error", 6000);
    return false;
  }
}

// ------------------------------------------------------------------
// Data
// ------------------------------------------------------------------

async function loadReports() {
  try {
    const data = await api("/admin/reports");
    allReports = data.reports;
    updatedAt.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    renderAll();
  } catch (err) {
    if (err.message !== "Not logged in") {
      reportsContainer.textContent = "Couldn't load reports.";
      UI.toast(UI.errorMessage(err), "error", 6000);
    }
  }
}

function severityOf(r) {
  return r.detection ? r.detection.severity : "None";
}

function damageOf(r) {
  return r.detection ? r.detection.damage_type : "none";
}

function getFilteredReports() {
  const q = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const severity = severityFilter.value;
  const loc = locationFilter.value;

  let list = allReports.filter((r) => {
    if (status && r.status !== status) return false;
    if (severity && severityOf(r) !== severity) return false;
    if (loc === "manual" ? r.location_source !== "manual" : loc && r.location_check !== loc) return false;
    if (q) {
      const haystack = [
        `#${r.report_id}`,
        r.report_id,
        r.description || "",
        damageOf(r),
        r.route_suggestion ? r.route_suggestion.alternate_route : "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sort = sortSelect.value;
  list = list.slice().sort((a, b) => {
    if (sort === "oldest") return new Date(a.submitted_at) - new Date(b.submitted_at);
    if (sort === "severity") {
      const diff = SEVERITY_RANK[severityOf(b)] - SEVERITY_RANK[severityOf(a)];
      return diff !== 0 ? diff : new Date(b.submitted_at) - new Date(a.submitted_at);
    }
    return new Date(b.submitted_at) - new Date(a.submitted_at);
  });

  return list;
}

// ------------------------------------------------------------------
// Rendering: stats + charts
// ------------------------------------------------------------------

function count(list, fn) {
  const out = {};
  list.forEach((r) => {
    const key = fn(r);
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}

function renderStats() {
  const byStatus = count(allReports, (r) => r.status);
  const bySeverity = count(allReports, severityOf);

  const tiles = [
    { label: "Total reports", value: allReports.length, cls: "tile-total" },
    { label: "Pending review", value: byStatus.pending || 0, cls: "tile-pending" },
    { label: "Verified", value: byStatus.verified || 0, cls: "tile-verified" },
    { label: "Flagged", value: byStatus.flagged || 0, cls: "tile-flagged" },
    { label: "In progress", value: byStatus.in_progress || 0, cls: "tile-progress" },
    { label: "Fixed", value: byStatus.fixed || 0, cls: "tile-fixed" },
    { label: "Severe damage", value: bySeverity.Severe || 0, cls: "tile-severe" },
    { label: "Location mismatch", value: allReports.filter((r) => r.location_check === "mismatch").length, cls: "tile-mismatch" },
  ];

  statsEl.innerHTML = tiles
    .map(
      (t) => `
      <div class="stat-tile ${t.cls}">
        <div class="stat-value">${t.value}</div>
        <div class="stat-label">${UI.esc(t.label)}</div>
      </div>`
    )
    .join("");
}

function barRow(label, value, max, color) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `
    <div class="bar-row">
      <span class="bar-label">${UI.esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${color}"></span></span>
      <span class="bar-value">${value}</span>
    </div>`;
}

function renderCharts() {
  if (allReports.length === 0) {
    severityChartEl.innerHTML = '<p class="empty-note">No data yet.</p>';
    typeChartEl.innerHTML = '<p class="empty-note">No data yet.</p>';
    return;
  }

  const bySeverity = count(allReports, severityOf);
  const sevMax = Math.max(...SEVERITY_ORDER.map((s) => bySeverity[s] || 0));
  severityChartEl.innerHTML = SEVERITY_ORDER.map((s) =>
    barRow(s === "None" ? "No damage" : s, bySeverity[s] || 0, sevMax, SEVERITY_COLORS[s])
  ).join("");

  const byType = count(allReports, damageOf);
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const typeMax = entries.length ? entries[0][1] : 0;
  typeChartEl.innerHTML = entries
    .map(([type, n]) => barRow(type === "none" ? "no damage" : type, n, typeMax, "#2f6fed"))
    .join("");
}

// ------------------------------------------------------------------
// Rendering: report cards
// ------------------------------------------------------------------

function renderAll() {
  renderStats();
  renderCharts();
  renderList();
}

function renderList() {
  const list = getFilteredReports();
  resultCount.textContent = `Showing ${list.length} of ${allReports.length} report${allReports.length === 1 ? "" : "s"}`;

  if (list.length === 0) {
    reportsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗂️</div>
        <p>${allReports.length === 0 ? "No reports yet." : "No reports match your filters."}</p>
      </div>`;
    return;
  }

  reportsContainer.innerHTML = "";
  list.forEach((report) => reportsContainer.appendChild(renderReportCard(report)));
}

function renderReportCard(report) {
  const div = document.createElement("div");
  const severity = severityOf(report);
  div.className = `report-card sev-${severity.toLowerCase()}${report.location_check === "mismatch" ? " loc-mismatch" : ""}`;

  const imageUrl = report.image
    ? `${API_BASE_URL.replace("/api", "")}/static/${report.image.file_path}`
    : "";

  const detection = report.detection;
  const when = report.submitted_at ? new Date(report.submitted_at).toLocaleString() : "";
  const loc = report.location
    ? `${Number(report.location.latitude).toFixed(5)}, ${Number(report.location.longitude).toFixed(5)}`
    : "No location";
  const mapsLink = report.location
    ? `https://www.openstreetmap.org/?mlat=${report.location.latitude}&mlon=${report.location.longitude}#map=18/${report.location.latitude}/${report.location.longitude}`
    : "";

  div.innerHTML = `
    <div class="card-photo">
      ${
        imageUrl
          ? `<img src="${UI.esc(imageUrl)}" alt="Report photo" data-view-photo />`
          : '<div class="no-photo">No photo</div>'
      }
      <span class="photo-badge ${severity.toLowerCase()}">${UI.esc(severity === "None" ? "No damage" : severity)}</span>
    </div>

    <div class="card-body">
      <div class="card-top">
        <strong>Report #${UI.esc(report.report_id)}</strong>
        <span class="status-pill ${UI.esc(report.status)}">${UI.esc(report.status)}</span>
      </div>

      <div class="card-meta">
        ${
          detection
            ? `${UI.esc(detection.damage_type)} &middot; ${Math.round(detection.confidence * 100)}% confidence`
            : "No detection"
        }
      </div>
      <div class="card-meta">
        📍 ${UI.esc(loc)}
        ${mapsLink ? `&nbsp;<a href="${UI.esc(mapsLink)}" target="_blank" rel="noopener">view map</a>` : ""}
      </div>
      <div class="card-meta">🕒 ${UI.esc(when)}</div>
      ${
        report.status === "fixed"
          ? `<div class="fixed-box">✅ Fixed${report.fixed_at ? " on " + UI.esc(new Date(report.fixed_at + "Z").toLocaleDateString()) : ""}${report.repair_note ? " &middot; " + UI.esc(report.repair_note) : ""}
              ${report.after_image ? `<img src="${UI.esc(API_BASE_URL.replace("/api", "") + "/static/" + report.after_image)}" alt="After repair" data-view-after />` : ""}</div>`
          : ""
      }
      <div class="loc-chips">${locationChips(report)}</div>

      ${
        report.description
          ? `<div class="report-desc"><strong>Description:</strong> ${UI.esc(report.description)}</div>`
          : `<div class="report-desc muted"><em>No description provided.</em></div>`
      }

      ${
        report.route_suggestion
          ? `<div class="route-box">⚠️ ${UI.esc(report.route_suggestion.alternate_route)}</div>`
          : ""
      }

      ${
        report.recommendation
          ? `<details class="tips">
               <summary>🛡️ ${UI.esc(report.recommendation.headline)}</summary>
               <ul>${(report.recommendation.tips || []).map((t) => `<li>${UI.esc(t)}</li>`).join("")}</ul>
             </details>`
          : ""
      }

      <div class="actions">
        <button class="btn-verify" data-action="verified">✔ Verify</button>
        <button class="btn-flag" data-action="flagged">⚑ Flag</button>
        <button class="btn-progress" data-action="in_progress">🔧 In progress</button>
        <button class="btn-fixed" data-fixed>✅ Mark fixed</button>
        <button class="btn-remove" data-action="removed">✖ Remove</button>
        <button class="btn-edit" data-edit>✎ Edit</button>
        <button class="btn-delete" data-delete>🗑 Delete</button>
      </div>
    </div>
  `;

  const photo = div.querySelector("[data-view-photo]");
  if (photo) photo.addEventListener("click", () => viewPhoto(report, imageUrl));

  div.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => updateStatus(report, btn.dataset.action, div));
  });
  div.querySelector("[data-fixed]").addEventListener("click", () => markFixed(report, div));
  const afterImg = div.querySelector("[data-view-after]");
  if (afterImg) afterImg.addEventListener("click", () => viewPhoto(report, afterImg.src));
  div.querySelector("[data-edit]").addEventListener("click", () => editDescription(report, div));
  div.querySelector("[data-delete]").addEventListener("click", () => deleteReport(report, div));

  return div;
}

function locationChips(r) {
  const chips = [];
  chips.push(
    r.location_source === "camera"
      ? '<span class="chip chip-ok">📷 Live camera + GPS</span>'
      : r.location_source === "gps"
      ? '<span class="chip chip-ok">📡 Phone GPS</span>'
      : '<span class="chip chip-warn">⌨ Typed by hand</span>'
  );
  if (r.location_check === "verified") {
    chips.push(`<span class="chip chip-ok">✔ Photo GPS matches${r.gps_distance_m !== null ? ` (${r.gps_distance_m} m)` : ""}</span>`);
  } else if (r.location_check === "mismatch") {
    chips.push(`<span class="chip chip-bad">⚠ Photo GPS is ${r.gps_distance_m !== null ? fmtMeters(r.gps_distance_m) : "far"} from the pin</span>`);
  } else {
    chips.push('<span class="chip chip-warn">ℹ No GPS in photo</span>');
  }
  return chips.join("");
}

function fmtMeters(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function viewPhoto(report, imageUrl) {
  UI.notice({
    title: `Report #${report.report_id}`,
    html: `<img class="lightbox-img" src="${UI.esc(imageUrl)}" alt="Report photo" />`,
    buttonText: "Close",
  });
}

function setBusy(card, busy) {
  card.querySelectorAll(".actions button").forEach((b) => (b.disabled = busy));
}

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------

async function updateStatus(report, newStatus, card) {
  if (report.status === newStatus) {
    UI.toast(`Report #${report.report_id} is already ${newStatus}.`, "info");
    return;
  }

  const p = STATUS_PROMPTS[newStatus];
  const ok = await UI.confirm({
    title: `${p.title} (#${report.report_id})`,
    message: p.message,
    confirmText: p.confirmText,
    danger: p.danger,
  });
  if (!ok) return;

  setBusy(card, true);
  try {
    await api(`/admin/reports/${report.report_id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    UI.toast(p.done, "success");
    loadReports();
  } catch (err) {
    setBusy(card, false);
    if (err.message !== "Not logged in") {
      UI.toast(`Failed to update status: ${UI.errorMessage(err)}`, "error", 6000);
    }
  }
}

async function markFixed(report, card) {
  const result = await UI.dialog({
    title: `Mark report #${report.report_id} as fixed`,
    dismissValue: null,
    html: `
      <p>Add a photo of the repaired road so people can see the before and after. The photo is optional.</p>
      <label class="ui-label" for="fix-photo">After photo</label>
      <input type="file" id="fix-photo" accept="image/png, image/jpeg" />
      <label class="ui-label" for="fix-note">Note (optional)</label>
      <input type="text" id="fix-note" maxlength="255" placeholder="e.g. Patched by the barangay on Nov 4" />
    `,
    buttons: [
      { label: "Cancel", value: null, className: "btn-secondary" },
      {
        label: "Mark as fixed",
        className: "btn-primary",
        beforeClose: (box) => ({
          file: box.querySelector("#fix-photo").files[0] || null,
          note: box.querySelector("#fix-note").value.trim(),
        }),
      },
    ],
  });
  if (!result) return;

  setBusy(card, true);
  try {
    if (result.file) {
      const form = new FormData();
      form.append("image", result.file);
      form.append("note", result.note);
      await api(`/admin/reports/${report.report_id}/after-photo`, { method: "POST", body: form });
    } else {
      await api(`/admin/reports/${report.report_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "fixed" }),
      });
    }
    UI.toast("Report marked as fixed.", "success");
    loadReports();
  } catch (err) {
    setBusy(card, false);
    if (err.message !== "Not logged in") {
      UI.toast(`Failed to mark as fixed: ${UI.errorMessage(err)}`, "error", 6000);
    }
  }
}

async function editDescription(report, card) {
  const newText = await UI.promptText({
    title: `Edit description (#${report.report_id})`,
    label: "Description",
    value: report.description || "",
    placeholder: "Describe the damage...",
  });
  if (newText === null) return; // cancelled

  if (newText.trim() === (report.description || "")) {
    UI.toast("No changes to save.", "info");
    return;
  }

  setBusy(card, true);
  try {
    await api(`/admin/reports/${report.report_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: newText }),
    });
    UI.toast("Description updated.", "success");
    loadReports();
  } catch (err) {
    setBusy(card, false);
    if (err.message !== "Not logged in") {
      UI.toast(`Failed to update description: ${UI.errorMessage(err)}`, "error", 6000);
    }
  }
}

async function deleteReport(report, card) {
  const ok = await UI.confirm({
    title: `Delete report #${report.report_id} permanently?`,
    html: `
      <p>This will erase the report, its photo, location, detection result and route suggestion.</p>
      <p><strong>This cannot be undone.</strong> If you only want to hide it from the public map, use Remove instead.</p>
    `,
    confirmText: "Delete permanently",
    danger: true,
  });
  if (!ok) return;

  setBusy(card, true);
  try {
    const data = await api(`/admin/reports/${report.report_id}`, { method: "DELETE" });
    if (data.failed_files && data.failed_files.length > 0) {
      UI.toast(
        "Report deleted, but some photo files couldn't be removed from the uploads folder.",
        "error",
        7000
      );
    } else {
      UI.toast(`Report #${report.report_id} deleted.`, "success");
    }
    loadReports();
  } catch (err) {
    setBusy(card, false);
    if (err.message !== "Not logged in") {
      UI.toast(`Failed to delete: ${UI.errorMessage(err)}`, "error", 6000);
    }
  }
}

// ------------------------------------------------------------------
// Export CSV (exports whatever the current filters show)
// ------------------------------------------------------------------

function csvCell(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const list = getFilteredReports();
  if (list.length === 0) {
    UI.toast("Nothing to export.", "info");
    return;
  }

  const header = [
    "report_id", "status", "severity", "damage_type", "confidence",
    "latitude", "longitude", "submitted_at", "description", "alternate_route",
  ];
  const rows = list.map((r) => [
    r.report_id,
    r.status,
    severityOf(r),
    damageOf(r),
    r.detection ? r.detection.confidence : "",
    r.location ? r.location.latitude : "",
    r.location ? r.location.longitude : "",
    r.submitted_at,
    r.description || "",
    r.route_suggestion ? r.route_suggestion.alternate_route : "",
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roadsnap-reports-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  UI.toast(`Exported ${list.length} report${list.length === 1 ? "" : "s"}.`, "success");
}

// ------------------------------------------------------------------
// Events
// ------------------------------------------------------------------

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();

  const ok = await UI.confirm({
    title: "Log out?",
    message: "You will need to log in again to moderate reports.",
    confirmText: "Log out",
  });
  if (!ok) return;

  try {
    await fetch(`${API_BASE_URL}/admin/logout`, {
      method: "POST",
      credentials: "include",
    });
    UI.toast("Logged out.", "success", 1200);
    setTimeout(goToLogin, 800);
  } catch (err) {
    UI.toast(`Couldn't log out: ${UI.errorMessage(err)}`, "error", 6000);
  }
});

refreshBtn.addEventListener("click", async () => {
  await loadReports();
  UI.toast("Dashboard refreshed.", "info", 1800);
});
exportBtn.addEventListener("click", exportCsv);

[statusFilter, severityFilter, locationFilter, sortSelect].forEach((el) =>
  el.addEventListener("change", renderList)
);
searchInput.addEventListener("input", renderList);

// --- Init ---
checkAuth().then((loggedIn) => {
  if (loggedIn) loadReports();
});