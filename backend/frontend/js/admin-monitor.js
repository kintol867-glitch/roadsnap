// System & model monitoring page (admin only).

const $ = (id) => document.getElementById(id);
const esc = (v) => UI.esc(v);
const FILES = API_BASE_URL.replace("/api", "");

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

function bars(rows, color = "#2f6fed") {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows.map((r) => `
    <div class="bar-row">
      <span class="bar-label">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((r.value / max) * 100)}%;background:${r.color || color}"></span></span>
      <span class="bar-value">${r.value}</span>
    </div>`).join("");
}

const pct = (v) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);

function render(m) {
  // --- health ---
  const model = m.health.model;
  const ok = (good, text) => `<span class="health-dot ${good ? "ok" : "bad"}"></span> ${esc(text)}`;
  $("health").innerHTML = `
    <div class="health-card"><div class="health-title">Server</div><div class="health-state">${ok(true, "Running")}</div><div class="health-sub">API is responding</div></div>
    <div class="health-card"><div class="health-title">Database</div><div class="health-state">${ok(m.health.database, m.health.database ? "Connected" : "Not responding")}</div><div class="health-sub">MySQL</div></div>
    <div class="health-card"><div class="health-title">AI model</div><div class="health-state">${ok(model.present, model.present ? "Loaded file found" : "Model file missing")}</div>
      <div class="health-sub">${model.present ? `${esc(model.name)} &middot; ${model.size_mb} MB &middot; updated ${esc(new Date(model.modified + "Z").toLocaleDateString())}` : "The app is using random demo results until a .pt model is placed in backend/model."}</div></div>
    <div class="health-card"><div class="health-title">Photo storage</div><div class="health-state">${ok(true, `${m.health.uploads.files} files`)}</div><div class="health-sub">${m.health.uploads.size_mb} MB used</div></div>`;

  // --- retraining reminder in the model card area ---
  const rt = m.retraining;
  if (rt) {
    const fmt = (d) => (d ? new Date(d + "Z").toLocaleDateString() : "never");
    const note = document.createElement("div");
    note.className = `health-card retrain-card ${rt.due ? "due" : ""}`;
    note.innerHTML = `<div class="health-title">Retraining</div>
      <div class="health-state"><span class="health-dot ${rt.due ? "bad" : "ok"}"></span> ${rt.due ? "Recommended" : "Up to date"}</div>
      <div class="health-sub">Last retrained: ${esc(fmt(rt.last_retrained))}${rt.due_reason ? " &middot; " + esc(rt.due_reason) : ""}. <a href="admin-dataset.html">Open dataset</a></div>`;
    $("health").appendChild(note);
  }

  // --- totals ---
  const t = m.totals, fb = m.feedback, d = m.detection;
  const tiles = [
    ["Total reports", t.reports, "tile-total"],
    ["Fixed", t.fixed, "tile-fixed"],
    ["AI accepted by admin", pct(fb.approval_rate), "tile-verified"],
    ["Average AI confidence", pct(d.avg_confidence), "tile-total"],
    ["\"No damage\" results", pct(d.no_damage_rate), "tile-flagged"],
    ["Location mismatches", (t.by_location_check || {}).mismatch || 0, "tile-mismatch"],
  ];
  $("totals").innerHTML = tiles.map(([label, value, cls]) => `
    <div class="stat-tile ${cls}"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`).join("");

  // --- charts ---
  $("activity-chart").innerHTML = `<div class="spark">${m.activity.map((a) => {
    const max = Math.max(1, ...m.activity.map((x) => x.count));
    return `<div class="spark-col" title="${esc(a.date)}: ${a.count}"><div class="spark-bar" style="height:${Math.round((a.count / max) * 100)}%"></div><div class="spark-label">${esc(a.date.slice(5))}</div></div>`;
  }).join("")}</div>`;

  const SEV = [["Severe", "#e60023"], ["Moderate", "#ff7a00"], ["Minor", "#ffc800"], ["None", "#8a93a3"]];
  $("severity-chart").innerHTML = bars(SEV.map(([s, c]) => ({ label: s === "None" ? "No damage" : s, value: d.by_severity[s] || 0, color: c })));
  const types = Object.entries(d.by_type).sort((a, b) => b[1] - a[1]);
  $("type-chart").innerHTML = types.length ? bars(types.map(([k, v]) => ({ label: k === "none" ? "no damage" : k, value: v }))) : '<p class="empty-note">No data yet.</p>';
  $("conf-chart").innerHTML = bars(d.confidence_buckets.map((v, i) => ({ label: `${i * 10}-${i * 10 + 10}%`, value: v })), "#6b7cff");

  // --- feedback ---
  const rows = Object.entries(fb.by_type).sort((a, b) => (b[1].accepted + b[1].rejected) - (a[1].accepted + a[1].rejected));
  $("feedback").innerHTML = rows.length ? `
    <p><strong>${fb.reviewed}</strong> reviewed &middot; <strong>${fb.accepted}</strong> accepted &middot; <strong>${fb.rejected}</strong> rejected &middot; acceptance rate <strong>${pct(fb.approval_rate)}</strong></p>
    <table class="mini-table"><thead><tr><th>AI result</th><th>Accepted</th><th>Rejected</th><th>Waiting</th><th>Agreement</th></tr></thead><tbody>
    ${rows.map(([k, v]) => {
      const done = v.accepted + v.rejected;
      return `<tr><td>${esc(k === "none" ? "no damage" : k)}</td><td>${v.accepted}</td><td>${v.rejected}</td><td>${v.waiting}</td><td>${done ? pct(v.accepted / done) : "n/a"}</td></tr>`;
    }).join("")}</tbody></table>` : '<p class="empty-note">No reviewed reports yet. Verify, flag or remove some reports first.</p>';

  // --- training metrics ---
  const tm = m.training_metrics;
  if (tm) {
    const cls = tm.classes || {};
    $("metrics").innerHTML = `
      <p>${esc(tm.model_name || "Model")} ${tm.trained_on ? "&middot; trained on " + esc(tm.trained_on) : ""}</p>
      <div class="stat-grid">
        ${[["mAP50", tm.map50], ["Precision", tm.precision], ["Recall", tm.recall]].map(([l, v]) =>
          `<div class="stat-tile tile-total"><div class="stat-value">${pct(v)}</div><div class="stat-label">${l}</div></div>`).join("")}
      </div>
      ${Object.keys(cls).length ? `<table class="mini-table"><thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>mAP50</th></tr></thead><tbody>
        ${Object.entries(cls).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${pct(v.precision)}</td><td>${pct(v.recall)}</td><td>${pct(v.map50)}</td></tr>`).join("")}</tbody></table>` : ""}`;
  } else {
    $("metrics").innerHTML = `<p class="empty-note">No training metrics found. Copy the numbers from your Colab validation into <code>backend/model/metrics.json</code> and they will show here. Example:</p>
<pre class="code-sample">{
  "model_name": "roadsnap_yolov8",
  "trained_on": "RDD2022 + local photos",
  "map50": 0.55, "precision": 0.62, "recall": 0.5,
  "classes": {
    "D00": {"precision": 0.6, "recall": 0.5, "map50": 0.52},
    "D40": {"precision": 0.5, "recall": 0.4, "map50": 0.41}
  }
}</pre>`;
  }

  // --- missed ---
  $("missed").innerHTML = m.missed_detections.length
    ? `<div class="missed-grid">${m.missed_detections.map((x) => `
        <div class="missed-item">
          ${x.image ? `<img src="${esc(FILES + "/static/" + x.image)}" alt="Report ${esc(x.report_id)}" />` : ""}
          <div><strong>#${esc(x.report_id)}</strong> <span class="status-pill ${esc(x.status)}">${esc(x.status)}</span></div>
          ${x.description ? `<small>${esc(x.description)}</small>` : ""}
        </div>`).join("")}</div>
       <a class="side-link" href="admin-dataset.html">Add them to the training dataset →</a>`
    : '<p class="empty-note">None yet. Good, or not enough reviewed reports.</p>';
}

async function load() {
  try {
    const m = await api("/admin/monitor");
    $("updated-at").textContent = `Updated ${new Date().toLocaleTimeString()}`;
    render(m);
  } catch (err) {
    if (err.message !== "Not logged in") UI.toast(UI.errorMessage(err), "error", 6000);
  }
}

$("refresh-btn").addEventListener("click", load);
$("logout-link").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch(`${API_BASE_URL}/admin/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  goToLogin();
});

checkAuth().then((ok) => { if (ok) load(); });