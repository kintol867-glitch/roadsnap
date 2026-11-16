// "My Reports": reports submitted from this browser, found by an anonymous device id.

const listEl = document.getElementById("my-list");
const FILES_BASE = API_BASE_URL.replace("/api", "");
const headers = () => ({ "X-Device-Id": getDeviceId() });

const STATUS_TEXT = {
  pending: "⏳ Waiting for admin review",
  verified: "✔ Verified by admin",
  flagged: "⚑ Flagged for another look",
  in_progress: "🔧 Repair in progress",
  fixed: "✅ Fixed",
  removed: "✖ Removed by admin",
};

// Progress tracker: Reported, Verified, In progress, Fixed
const STEPS = [
  ["pending", "Reported"],
  ["verified", "Verified"],
  ["in_progress", "In progress"],
  ["fixed", "Fixed"],
];

function trackerHtml(status) {
  if (status === "removed" || status === "flagged") return "";
  const at = Math.max(0, STEPS.findIndex(([key]) => key === status));
  return `<div class="tracker">${STEPS.map(
    ([, label], i) => `<span class="step-dot ${i <= at ? "done" : ""}">${i <= at ? "●" : "○"} ${label}</span>`
  ).join("")}</div>`;
}

function fixedHtml(r) {
  const after = r.after_image ? `${FILES_BASE}/static/${r.after_image}` : "";
  const date = r.fixed_at ? new Date(r.fixed_at + "Z").toLocaleDateString() : "";
  return `<div class="fixed-box">✅ Repaired${date ? " on " + UI.esc(date) : ""}${r.repair_note ? " &middot; " + UI.esc(r.repair_note) : ""}
    ${after ? `<div class="after-label">After repair</div><img src="${UI.esc(after)}" alt="After repair" />` : ""}</div>`;
}

function renderCard(r) {
  const det = r.detection || {};
  const severity = det.severity || "None";
  const hasDamage = det.damage_type && det.damage_type !== "none";
  const imageUrl = r.image ? `${FILES_BASE}/static/${r.image.file_path}` : "";
  const when = r.submitted_at ? new Date(r.submitted_at + "Z").toLocaleString() : "";
  const loc = r.location ? `${Number(r.location.latitude).toFixed(5)}, ${Number(r.location.longitude).toFixed(5)}` : "";

  const hiddenNote = r.location_check === "mismatch" && r.status !== "verified"
    ? '<div class="loc-note loc-bad">⚠ The GPS in your photo did not match your pin, so this report is hidden from the public map until an admin reviews it.</div>'
    : "";

  const card = document.createElement("div");
  card.className = `report-card sev-${severity.toLowerCase()}`;
  card.innerHTML = `
    ${imageUrl ? `<img src="${UI.esc(imageUrl)}" alt="Report photo" />` : ""}
    <div class="info">
      <h3>Report #${UI.esc(r.report_id)}
        <span class="status-pill ${UI.esc(r.status)}">${UI.esc(r.status)}</span></h3>
      <div class="card-meta">${UI.esc(STATUS_TEXT[r.status] || r.status)}</div>
      ${trackerHtml(r.status)}
      ${r.status === "fixed" ? fixedHtml(r) : ""}
      <p>${hasDamage
        ? `<span class="badge ${UI.esc(severity.toLowerCase())}">${UI.esc(severity)}</span> ${UI.esc(det.damage_type)} &middot; ${Math.round((det.confidence || 0) * 100)}% confidence`
        : '<span class="badge none">No damage detected</span>'}</p>
      <div class="card-meta">🕒 ${UI.esc(when)}${loc ? ` &middot; 📍 ${UI.esc(loc)}` : ""}</div>
      <p class="result-desc">${r.description ? UI.esc(r.description) : "<em>No description</em>"}</p>
      ${hiddenNote}
      ${r.status === "fixed" ? "" : UI.recommendationHtml(r.recommendation)}
      <div class="actions">
        ${r.status !== "removed" ? '<button class="btn-secondary" data-edit>✏ Edit description</button>' : ""}
        ${r.status === "pending" ? '<button class="btn-danger" data-delete>🗑 Delete</button>' : ""}
      </div>
    </div>`;

  const editBtn = card.querySelector("[data-edit]");
  if (editBtn) editBtn.addEventListener("click", () => editReport(r));
  const delBtn = card.querySelector("[data-delete]");
  if (delBtn) delBtn.addEventListener("click", () => deleteReport(r));
  return card;
}

async function load() {
  try {
    const res = await fetch(`${API_BASE_URL}/reports/mine`, { headers: headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't load your reports.");

    listEl.innerHTML = "";
    if (!data.reports.length) {
      listEl.innerHTML = '<div class="card"><p>You haven\'t sent any reports from this device yet.</p><a class="side-link" href="index.html">Report road damage →</a></div>';
      return;
    }
    const grid = document.createElement("div");
    grid.className = "report-grid";
    data.reports.forEach((r) => grid.appendChild(renderCard(r)));
    listEl.appendChild(grid);
  } catch (err) {
    listEl.innerHTML = `<p class="status-msg error">${UI.esc(UI.errorMessage(err))}</p>`;
  }
}

async function editReport(r) {
  const text = await UI.promptText({
    title: `Edit description (Report #${r.report_id})`,
    label: "Description",
    value: r.description || "",
    confirmText: "Save",
    multiline: true,
  });
  if (text === null) return;

  try {
    const res = await fetch(`${API_BASE_URL}/reports/mine/${r.report_id}`, {
      method: "PATCH",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ description: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't save.");
    UI.toast("Description updated.", "success");
    load();
  } catch (err) {
    UI.toast(UI.errorMessage(err), "error", 6000);
  }
}

async function deleteReport(r) {
  const ok = await UI.confirm({
    title: `Delete report #${r.report_id}?`,
    message: "This removes the report and its photo. It cannot be undone.",
    confirmText: "Yes, delete",
    cancelText: "Keep it",
    danger: true,
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API_BASE_URL}/reports/mine/${r.report_id}`, {
      method: "DELETE",
      headers: headers(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't delete.");
    UI.toast("Report deleted.", "success");
    load();
  } catch (err) {
    UI.toast(UI.errorMessage(err), "error", 6000);
  }
}

load();