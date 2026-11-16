// Dataset management (admin only): choose photos + classes for the next retraining round.

const $ = (id) => document.getElementById(id);
const esc = (v) => UI.esc(v);
const FILES = API_BASE_URL.replace("/api", "");
const ACCEPTED = ["verified", "in_progress", "fixed"];

let items = [];
let classes = [];

function goToLogin() { window.location.href = "admin-login.html"; }

async function api(path, options = {}) {
  const resp = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", ...options });
  if (resp.status === 401) { goToLogin(); throw new Error("Not logged in"); }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

async function checkAuth() {
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/me`, { credentials: "include" });
    const data = await resp.json();
    if (!data.logged_in) { goToLogin(); return false; }
    $("welcome-msg").textContent = `Logged in as ${data.username}`;
    return true;
  } catch (err) {
    $("welcome-msg").textContent = "Can't reach the server.";
    return false;
  }
}

function renderSummary(s) {
  const perClass = Object.entries(s.per_class).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none yet";
  const tiles = [
    ["Selected for training", s.selected, "tile-total"],
    ["Ready to export", s.ready_to_export, "tile-verified"],
    ["Need boxes drawn", s.need_boxes, "tile-flagged"],
  ];
  $("summary").innerHTML =
    tiles.map(([l, v, c]) => `<div class="stat-tile ${c}"><div class="stat-value">${v}</div><div class="stat-label">${esc(l)}</div></div>`).join("") +
    `<div class="stat-tile tile-total wide"><div class="stat-label">Per class</div><div class="stat-small">${esc(perClass)}</div></div>`;
}

function renderRetraining(r) {
  const fmt = (d) => (d ? new Date(d + "Z").toLocaleDateString() : "never");
  const state = r.due
    ? `<div class="retrain-state due">⏰ Retraining recommended: ${esc(r.due_reason)}</div>`
    : '<div class="retrain-state ok">✅ Up to date. No retraining needed yet.</div>';
  const history = (r.history || []).length
    ? `<ul class="retrain-history">${r.history.map((e) => `<li><strong>${esc(new Date(e.date + "Z").toLocaleDateString())}</strong> ${
        e.type === "export"
          ? `Exported ${e.ready} ready photos${e.to_label ? ` (+${e.to_label} to label)` : ""}`
          : `Model retrained${e.map50 !== undefined ? ` (mAP50 ${Math.round(e.map50 * 100)}%)` : ""}${e.note ? ": " + esc(e.note) : ""}`
      }</li>`).join("")}</ul>`
    : '<p class="muted-note">No exports or retraining logged yet.</p>';

  $("retrain").innerHTML = `
    <h3>Retraining schedule</h3>
    ${state}
    <p class="muted-note">
      Last export: <strong>${esc(fmt(r.last_export))}</strong> &middot;
      last retrained: <strong>${esc(fmt(r.last_retrained))}</strong> &middot;
      new photos since the last export: <strong>${r.new_selected}</strong> (target ${r.threshold}) &middot;
      review every ${r.every_days} days
    </p>
    <ol class="retrain-steps">
      <li>Choose photos and classes below, then <strong>Export training set</strong>.</li>
      <li>Fix any wrong boxes in Roboflow, then retrain in Colab and compare mAP with the old model.</li>
      <li>If the new model is better, replace <code>backend/model/roadsnap_yolov8.pt</code>, restart the server, and press the button below.</li>
    </ol>
    <button type="button" class="btn-secondary" id="retrained-btn">📝 Log: I retrained the model</button>
    ${history}`;
  $("retrained-btn").addEventListener("click", logRetrained);
}

async function logRetrained() {
  const note = await UI.promptText({
    title: "Log retraining",
    label: "Note (optional): what changed? You can add the new mAP50 like 'mAP50 0.58'",
    value: "",
    placeholder: "e.g. Added 120 local pothole photos",
    confirmText: "Save",
  });
  if (note === null) return;
  const m = note.match(/map50\s*[:=]?\s*(0?\.\d+|1(?:\.0+)?)/i);
  try {
    await api("/admin/dataset/retrained", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, map50: m ? m[1] : null }),
    });
    UI.toast("Retraining logged.", "success");
    load();
  } catch (err) {
    UI.toast(UI.errorMessage(err), "error", 5000);
  }
}

function visibleItems() {
  const v = $("view-filter").value;
  return items.filter((i) => {
    if (v === "missed") return i.missed;
    if (v === "accepted") return ACCEPTED.includes(i.status);
    if (v === "selected") return i.training_use;
    if (v === "unselected") return !i.training_use;
    return true;
  });
}

function card(i) {
  const det = i.detection || {};
  const hasDamage = det.damage_type && det.damage_type !== "none";
  const img = i.image ? `${FILES}/static/${i.image.file_path}` : "";
  const current = i.training_class || i.suggested_class || "";
  const options = ['<option value="">Choose class...</option>']
    .concat(classes.map((c) => `<option value="${esc(c)}" ${c === current ? "selected" : ""}>${esc(c === "background" ? "background (clean road)" : c)}</option>`))
    .join("");

  const div = document.createElement("div");
  div.className = `report-card ds-card ${i.training_use ? "ds-selected" : ""}`;
  div.innerHTML = `
    <div class="card-photo">${img ? `<img src="${esc(img)}" alt="Report ${esc(i.report_id)}" />` : '<div class="no-photo">No photo</div>'}</div>
    <div class="card-body">
      <div class="card-top"><strong>#${esc(i.report_id)}</strong>
        <span class="status-pill ${esc(i.status)}">${esc(i.status)}</span></div>
      <div class="card-meta">AI: ${hasDamage ? `${esc(det.damage_type)} · ${Math.round((det.confidence || 0) * 100)}%` : "<strong>no damage detected</strong>"}</div>
      ${i.missed ? '<div class="loc-note loc-warn">Admin accepted this report but the AI saw nothing. Great training example. Draw the box in Roboflow after export.</div>' : ""}
      ${i.description ? `<div class="report-desc">${esc(i.description)}</div>` : ""}
      <label class="ui-label">Correct class</label>
      <select data-class>${options}</select>
      <label class="ds-check"><input type="checkbox" data-use ${i.training_use ? "checked" : ""} /> Use for training</label>
      <div class="card-meta">${i.has_box ? "✔ AI box available" : "⚠ no box (will go to the to_label folder)"}</div>
    </div>`;

  div.querySelector("[data-class]").addEventListener("change", (e) => save(i, { training_class: e.target.value || null }));
  div.querySelector("[data-use]").addEventListener("change", (e) => {
    const cls = div.querySelector("[data-class]").value;
    if (e.target.checked && !cls) {
      e.target.checked = false;
      UI.toast("Choose the correct class first.", "error");
      return;
    }
    save(i, { training_class: cls || null, training_use: e.target.checked });
  });
  return div;
}

async function save(item, body) {
  try {
    const res = await api(`/admin/dataset/${item.report_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    item.training_use = res.training_use;
    item.training_class = res.training_class;
    UI.toast("Saved.", "success", 1200);
    load();
  } catch (err) {
    UI.toast(UI.errorMessage(err), "error", 5000);
    load();
  }
}

function renderList() {
  const list = visibleItems();
  $("result-count").textContent = `Showing ${list.length} of ${items.length}`;
  const box = $("items");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂️</div><p>Nothing here yet.</p></div>';
    return;
  }
  list.forEach((i) => box.appendChild(card(i)));
}

async function load() {
  try {
    const data = await api("/admin/dataset");
    items = data.items;
    classes = data.classes;
    renderSummary(data.summary);
    renderRetraining(data.retraining);
    renderList();
  } catch (err) {
    if (err.message !== "Not logged in") UI.toast(UI.errorMessage(err), "error", 6000);
  }
}

async function exportZip() {
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/dataset/export`, { credentials: "include" });
    if (resp.status === 401) { goToLogin(); return; }
    if (!resp.ok) throw new Error(`Export failed (${resp.status})`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roadsnap_dataset_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    UI.toast("Dataset exported. Open README.txt inside the ZIP.", "success", 5000);
    load();
  } catch (err) {
    UI.toast(UI.errorMessage(err), "error", 6000);
  }
}

$("view-filter").addEventListener("change", renderList);
$("refresh-btn").addEventListener("click", load);
$("export-btn").addEventListener("click", exportZip);
$("logout-link").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch(`${API_BASE_URL}/admin/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  goToLogin();
});

checkAuth().then((ok) => { if (ok) load(); });