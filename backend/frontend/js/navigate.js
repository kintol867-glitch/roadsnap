// Safe route finder + live navigation.
//  - Address search: OpenStreetMap Nominatim
//  - Routing: OSRM public demo server (driving, with alternatives)
//  - Road damage: reports from the RoadSnap API
// Not a full Waze: there is no live traffic data.

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OSRM = "https://router.project-osrm.org";

const SEV_COLORS = { Severe: "#e60023", Moderate: "#ff7a00", Minor: "#ffc800" };
const SEV_WEIGHT = { Severe: 5, Moderate: 2, Minor: 1 };

const NEAR_ROUTE_M = 30;   // a report this close to the route counts as "on" it
const ALERT_AHEAD_M = 250; // first warning (sign + voice) this far before a hazard
const ALERT_NEAR_M = 100;  // second, more urgent warning
const OFF_ROUTE_M = 70;    // farther than this from the route = off route
const REROUTE_COOLDOWN_MS = 15000;

const map = L.map("map").setView([10.3157, 123.8854], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

const hazardLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const pointLayer = L.layerGroup().addTo(map);

const el = (id) => document.getElementById(id);
const fromInput = el("from-input");
const toInput = el("to-input");

let hazards = [];      // {id, lat, lng, severity, damage, description}
let fromPoint = null;  // {lat, lng, label}
let toPoint = null;
let routes = [];
let selected = null;   // index into routes
let pickMode = false;

// Navigation state
let watchId = null;
let userMarker = null;
let nav = null;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const esc = UI.esc;

function haversine(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Distance (meters) from point p to segment a-b, plus how far along it (0..1).
function pointToSegment(p, a, b) {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const toXY = (q) => ({ x: (q.lng - p.lng) * 111320 * k, y: (q.lat - p.lat) * 110540 });
  const A = toXY(a);
  const B = toXY(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (-A.x * dx - A.y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = A.x + t * dx;
  const cy = A.y + t * dy;
  return { dist: Math.hypot(cx, cy), t };
}

function fmtDist(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function fmtTime(s) {
  const mins = Math.max(1, Math.round(s / 60));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function setMessage(text, type = "") {
  const box = el("route-message");
  box.textContent = text;
  box.className = `route-message ${type}`;
}

// ------------------------------------------------------------------
// Road damage reports
// ------------------------------------------------------------------

async function loadHazards() {
  try {
    const resp = await fetch(`${API_BASE_URL}/reports`);
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    const data = await resp.json();

    hazards = data.reports
      .filter((r) => r.location && r.detection && SEV_WEIGHT[r.detection.severity] && r.status !== "fixed")
      .map((r) => ({
        id: r.report_id,
        lat: Number(r.location.latitude),
        lng: Number(r.location.longitude),
        severity: r.detection.severity,
        damage: r.detection.damage_type,
        description: r.description || "",
        trust: r.trust || "unconfirmed",
      }));

    hazards.forEach((h) => {
      L.circleMarker([h.lat, h.lng], {
        radius: 11,
        fillColor: SEV_COLORS[h.severity],
        color: "#fff",
        weight: 3,
        fillOpacity: 1,
      })
        .bindPopup(
          `<strong>Report #${esc(h.id)}</strong><br/>${esc(h.severity)} &middot; ${esc(h.damage)}` +
            (h.trust === "unconfirmed" ? "<br/><small>⚠ Unconfirmed report</small>" : "") +
            (h.description ? `<br/><small>${esc(h.description)}</small>` : "")
        )
        .addTo(hazardLayer);
    });
  } catch (err) {
    console.error("Failed to load reports:", err);
    UI.toast("Couldn't load road damage reports. Is the backend running? Routes will show no damage.", "error", 6000);
  }
}

// ------------------------------------------------------------------
// Address search (Nominatim)
// ------------------------------------------------------------------

async function geocode(q) {
  const url =
    `${NOMINATIM}/search?format=jsonv2&limit=5&countrycodes=ph` +
    `&viewbox=123.60,10.70,124.10,10.00&q=${encodeURIComponent(q)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error("Address search failed");
  return resp.json();
}

function setupSearch(input, listEl, onPick) {
  let timer = null;
  let results = [];

  function hide() {
    listEl.innerHTML = "";
    listEl.style.display = "none";
  }

  function render() {
    if (results.length === 0) {
      listEl.innerHTML = '<li class="none">No places found</li>';
    } else {
      listEl.innerHTML = results
        .map((r, i) => `<li data-i="${i}">${esc(r.display_name)}</li>`)
        .join("");
    }
    listEl.style.display = "block";
  }

  function pick(r) {
    hide();
    const label = r.display_name.split(",").slice(0, 2).join(",");
    input.value = label;
    onPick({ lat: Number(r.lat), lng: Number(r.lon), label });
  }

  async function search() {
    const q = input.value.trim();
    if (q.length < 3) return hide();
    try {
      results = await geocode(q);
      render();
    } catch (err) {
      UI.toast(UI.errorMessage(err), "error");
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, 700); // be polite to the free service
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (results.length) pick(results[0]);
      else search();
    }
  });
  listEl.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) pick(results[Number(li.dataset.i)]);
  });
  document.addEventListener("click", (e) => {
    if (!listEl.contains(e.target) && e.target !== input) hide();
  });
}

function showPoints() {
  pointLayer.clearLayers();
  if (fromPoint) {
    L.circleMarker([fromPoint.lat, fromPoint.lng], {
      radius: 8, fillColor: "#2f6fed", color: "#fff", weight: 3, fillOpacity: 1,
    }).bindTooltip("Start").addTo(pointLayer);
  }
  if (toPoint) {
    L.marker([toPoint.lat, toPoint.lng]).bindTooltip("Destination").addTo(pointLayer);
  }
}

setupSearch(fromInput, el("from-list"), (p) => {
  fromPoint = p;
  showPoints();
});
setupSearch(toInput, el("to-list"), (p) => {
  toPoint = p;
  showPoints();
});

function getMyLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation isn't supported here."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "My location" }),
      () => reject(new Error("Couldn't get your location. Allow location access and try again.")),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

el("from-locate").addEventListener("click", async () => {
  try {
    fromPoint = await getMyLocation();
    fromInput.value = "My location";
    showPoints();
    map.setView([fromPoint.lat, fromPoint.lng], 15);
    UI.toast("Using your current location.", "success", 2000);
  } catch (err) {
    UI.toast(err.message, "error", 6000);
  }
});

el("to-pick").addEventListener("click", () => {
  pickMode = !pickMode;
  el("pick-hint").textContent = pickMode
    ? "Now tap the map to set your destination."
    : "Tip: tap 📌, then tap the map to set your destination.";
  map.getContainer().style.cursor = pickMode ? "crosshair" : "";
});

map.on("click", (e) => {
  if (!pickMode) return;
  pickMode = false;
  map.getContainer().style.cursor = "";
  toPoint = { lat: e.latlng.lat, lng: e.latlng.lng, label: "Dropped pin" };
  toInput.value = `Dropped pin (${toPoint.lat.toFixed(4)}, ${toPoint.lng.toFixed(4)})`;
  el("pick-hint").textContent = "Destination set. Tap Find routes.";
  showPoints();
});

// ------------------------------------------------------------------
// Routing (OSRM)
// ------------------------------------------------------------------

function buildInstruction(step) {
  const m = step.maneuver || {};
  const name = step.name ? step.name : "the road";
  const mod = m.modifier || "";
  switch (m.type) {
    case "depart":
      return `Start on ${name}`;
    case "arrive":
      return "You have arrived at your destination";
    case "turn":
      return mod === "straight" ? `Continue straight onto ${name}` : `Turn ${mod} onto ${name}`;
    case "end of road":
      return `At the end of the road, turn ${mod} onto ${name}`;
    case "roundabout":
    case "rotary":
      return m.exit ? `At the roundabout, take exit ${m.exit} onto ${name}` : `Enter the roundabout toward ${name}`;
    case "merge":
      return `Merge ${mod} onto ${name}`;
    case "fork":
      return `Keep ${mod} onto ${name}`;
    case "on ramp":
    case "off ramp":
      return `Take the ramp onto ${name}`;
    default:
      return `Continue on ${name}`;
  }
}

function buildRoute(osrmRoute) {
  const coords = osrmRoute.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  }

  // Hazards close to this route, ordered along it
  const onRoute = [];
  hazards.forEach((h) => {
    let best = { dist: Infinity, i: -1, t: 0 };
    for (let i = 0; i < coords.length - 1; i++) {
      const r = pointToSegment(h, coords[i], coords[i + 1]);
      if (r.dist < best.dist) best = { dist: r.dist, i, t: r.t };
    }
    if (best.dist <= NEAR_ROUTE_M) {
      const segLen = cum[best.i + 1] - cum[best.i];
      onRoute.push({ ...h, along: cum[best.i] + best.t * segLen });
    }
  });
  onRoute.sort((a, b) => a.along - b.along);

  // Unconfirmed reports count half, so a single prank pin can't easily force a detour.
  const score = onRoute.reduce(
    (sum, h) => sum + SEV_WEIGHT[h.severity] * (h.trust === "unconfirmed" ? 0.5 : 1),
    0
  );

  // Steps with how far along the route each maneuver is
  const steps = [];
  (osrmRoute.legs || []).forEach((leg) => {
    (leg.steps || []).forEach((s) => {
      const loc = { lat: s.maneuver.location[1], lng: s.maneuver.location[0] };
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = Math.abs(coords[i].lat - loc.lat) + Math.abs(coords[i].lng - loc.lng);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      steps.push({ text: buildInstruction(s), distance: s.distance, along: cum[bestI] });
    });
  });

  return {
    coords,
    cum,
    distance: osrmRoute.distance,
    duration: osrmRoute.duration,
    hazards: onRoute,
    score,
    steps,
  };
}

async function fetchRoutes(from, to) {
  const url =
    `${OSRM}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?alternatives=3&overview=full&geometries=geojson&steps=true`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("The routing service is busy. Please try again in a moment.");
  const data = await resp.json();
  if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
    throw new Error("No driving route found between those places.");
  }
  return data.routes.map(buildRoute);
}

function recommendedIndex() {
  let best = 0;
  routes.forEach((r, i) => {
    const b = routes[best];
    if (r.score < b.score || (r.score === b.score && r.duration < b.duration)) best = i;
  });
  return best;
}

async function findRoutes({ keepNav = false } = {}) {
  if (!fromPoint) {
    try {
      fromPoint = await getMyLocation();
      fromInput.value = "My location";
    } catch (err) {
      UI.toast("Choose a starting point first, or tap 📍 to use your location.", "error", 5000);
      return false;
    }
  }
  if (!toPoint) {
    UI.toast("Choose a destination first.", "error");
    return false;
  }

  const btn = el("find-btn");
  btn.disabled = true;
  btn.textContent = "Finding routes...";
  setMessage("");

  try {
    routes = await fetchRoutes(fromPoint, toPoint);
    selectRoute(recommendedIndex(), { fit: !keepNav });
    renderResults();
    return true;
  } catch (err) {
    setMessage(UI.errorMessage(err), "error");
    UI.toast(UI.errorMessage(err), "error", 6000);
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Find routes";
  }
}

function renderResults() {
  const rec = recommendedIndex();
  let fastest = 0;
  routes.forEach((r, i) => { if (r.duration < routes[fastest].duration) fastest = i; });

  el("route-results").innerHTML = routes
    .map((r, i) => {
      const tags = [];
      if (i === rec) tags.push('<span class="tag tag-safe">Safest</span>');
      if (i === fastest) tags.push('<span class="tag tag-fast">Fastest</span>');
      const sev = ["Severe", "Moderate", "Minor"]
        .map((s) => [s, r.hazards.filter((h) => h.severity === s).length])
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${n} ${s.toLowerCase()}`)
        .join(", ");
      const hz = r.hazards.length === 0
        ? '<span class="hz-none">✔ No reported damage</span>'
        : `<span class="hz-some">⚠ ${r.hazards.length} reported (${sev})</span>`;
      return `
        <button type="button" class="route-card ${i === selected ? "selected" : ""}" data-route="${i}">
          <div class="route-top"><strong>${fmtTime(r.duration)}</strong> <span>${fmtDist(r.distance)}</span> ${tags.join("")}</div>
          <div class="route-hz">${hz}</div>
        </button>`;
    })
    .join("");

  el("route-results").querySelectorAll("[data-route]").forEach((b) =>
    b.addEventListener("click", () => {
      selectRoute(Number(b.dataset.route));
      renderResults();
    })
  );
}

function selectRoute(index, { fit = true } = {}) {
  selected = index;
  routeLayer.clearLayers();

  routes.forEach((r, i) => {
    if (i === index) return;
    L.polyline(r.coords.map((c) => [c.lat, c.lng]), {
      color: "#9aa3b2", weight: 5, opacity: 0.8, dashArray: "8 8",
    })
      .on("click", () => { selectRoute(i); renderResults(); })
      .addTo(routeLayer);
  });

  const r = routes[index];
  const line = L.polyline(r.coords.map((c) => [c.lat, c.lng]), {
    color: "#2f6fed", weight: 7, opacity: 0.95,
  }).addTo(routeLayer);

  r.hazards.forEach((h) => {
    L.circleMarker([h.lat, h.lng], {
      radius: 13, color: SEV_COLORS[h.severity], weight: 3, fillOpacity: 0,
    }).addTo(routeLayer);
  });

  if (fit) map.fitBounds(line.getBounds().pad(0.15));
  renderDetail(r);
}

function renderDetail(r) {
  el("route-detail").hidden = false;

  el("hazard-list").innerHTML =
    r.hazards.length === 0
      ? '<li class="hz-clear">✔ No reported road damage on this route.</li>'
      : r.hazards
          .map(
            (h) => `
          <li>
            <span class="dot ${h.severity.toLowerCase()}"></span>
            <div>
              <strong>${esc(h.severity)}</strong> ${esc(h.damage)} &middot; ${fmtDist(h.along)} from start
              ${h.description ? `<div class="hz-desc">${esc(h.description)}</div>` : ""}
            </div>
          </li>`
          )
          .join("");

  el("steps-list").innerHTML = r.steps
    .map((s) => `<li>${esc(s.text)}${s.distance ? ` <small>(${fmtDist(s.distance)})</small>` : ""}</li>`)
    .join("");
}

el("find-btn").addEventListener("click", () => findRoutes());

// ------------------------------------------------------------------
// Live navigation
// ------------------------------------------------------------------

function speak(text) {
  if (!el("voice-toggle").checked || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch (e) { /* voice is optional */ }
}

function startNavigation() {
  if (selected === null) return;
  if (!navigator.geolocation) {
    UI.toast("Live location isn't supported on this device.", "error");
    return;
  }
  if (watchId !== null) stopNavigation(true);

  nav = { stage: new Map(), lastIdx: 0, lastReroute: 0, rerouting: false, startedAt: Date.now() };
  el("nav-hud").hidden = false;
  el("nav-panel").classList.add("collapsed");
  el("hud-instruction").textContent = "Finding your position...";
  el("hud-distance").textContent = "";
  el("hud-remaining").textContent = "--";

  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  });
  UI.toast("Navigation started. Drive safely!", "success", 2500);
  speak("Navigation started. Drive safely.");
}

function stopNavigation(silent = false) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  nav = null;
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
  el("nav-hud").hidden = true;
  el("hazard-alert").hidden = true;
  el("nav-panel").classList.remove("collapsed");
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (!silent) UI.toast("Navigation stopped.", "info", 2000);
}

let lastGpsWarn = 0;

function onPositionError(err) {
  // Permission denied: navigation can't work at all.
  if (err && err.code === 1) {
    UI.toast("Location permission was denied. Allow location access to use navigation.", "error", 7000);
    stopNavigation(true);
    return;
  }
  // Weak signal or timeout: keep going and warn only once in a while.
  if (nav) el("hud-instruction").textContent = "Searching for GPS signal...";
  const now = Date.now();
  if (now - lastGpsWarn > 20000) {
    lastGpsWarn = now;
    UI.toast("Weak GPS signal. Move to an open area.", "info", 4000);
  }
}

// Find the closest point on the route, searching near the last known spot first.
function locateOnRoute(route, p) {
  const n = route.coords.length - 1;
  const search = (from, to) => {
    let best = { dist: Infinity, i: 0, t: 0 };
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) {
      const r = pointToSegment(p, route.coords[i], route.coords[i + 1]);
      if (r.dist < best.dist) best = { dist: r.dist, i, t: r.t };
    }
    return best;
  };
  let best = search(nav.lastIdx - 3, nav.lastIdx + 250);
  if (best.dist > OFF_ROUTE_M) best = search(0, n); // maybe we jumped ahead
  return best;
}

function onPosition(pos) {
  if (!nav || selected === null) return;
  const route = routes[selected];
  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };

  if (!userMarker) {
    userMarker = L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: "me-icon", html: '<div class="me-dot"></div>', iconSize: [22, 22] }),
      zIndexOffset: 1000,
    }).addTo(map);
  } else {
    userMarker.setLatLng([p.lat, p.lng]);
  }
  map.panTo([p.lat, p.lng], { animate: true });

  const best = locateOnRoute(route, p);

  // Off route -> recalculate from here
  if (best.dist > OFF_ROUTE_M) {
    const now = Date.now();
    if (!nav.rerouting && now - nav.lastReroute > REROUTE_COOLDOWN_MS) {
      nav.rerouting = true;
      nav.lastReroute = now;
      UI.toast("You left the route. Recalculating...", "info", 3000);
      speak("Recalculating.");
      fromPoint = { lat: p.lat, lng: p.lng, label: "My location" };
      findRoutes({ keepNav: true }).then(() => {
        if (nav) { nav.lastIdx = 0; nav.stage = new Map(); nav.rerouting = false; }
      });
    }
    el("hud-instruction").textContent = "Off route";
    return;
  }

  nav.lastIdx = best.i;
  const segLen = route.cum[best.i + 1] - route.cum[best.i];
  const along = route.cum[best.i] + best.t * segLen;
  const remaining = Math.max(0, route.distance - along);

  // Arrived?
  if (remaining < 30) {
    UI.toast("You have arrived at your destination!", "success", 5000);
    speak("You have arrived at your destination.");
    stopNavigation(true);
    return;
  }

  // Next maneuver
  const next = route.steps.find((s) => s.along > along + 10) || route.steps[route.steps.length - 1];
  el("hud-instruction").textContent = next.text;
  el("hud-distance").textContent = `in ${fmtDist(Math.max(0, next.along - along))}`;
  const eta = (remaining / route.distance) * route.duration;
  el("hud-remaining").textContent = `${fmtDist(remaining)} · ${fmtTime(eta)}`;

  checkHazardsAhead(route, along);
}

// ------------------------------------------------------------------
// Road damage warnings: sign + voice + vibration
// ------------------------------------------------------------------

function roundTo10(m) {
  return Math.max(10, Math.round(m / 10) * 10);
}

function checkHazardsAhead(route, along) {
  // Hazards still ahead of us and within the warning distance, nearest first.
  const upcoming = route.hazards
    .map((h) => ({ h, ahead: h.along - along }))
    .filter((x) => x.ahead > -15 && x.ahead <= ALERT_AHEAD_M)
    .sort((a, b) => a.ahead - b.ahead);

  const sign = el("hazard-alert");
  if (upcoming.length === 0) {
    sign.hidden = true;
    return;
  }

  const { h, ahead } = upcoming[0];
  const urgent = h.severity !== "Minor";
  const damage = h.damage && h.damage !== "none" ? h.damage : "damage";

  // Keep the sign up to date on every GPS update
  sign.hidden = false;
  sign.className = `hazard-alert sev-${h.severity.toLowerCase()}`;
  el("ha-title").textContent = urgent ? "SLOW DOWN" : "CAUTION";
  el("ha-sub").textContent = `${h.severity} road ${damage} ahead`;
  el("ha-dist").textContent = ahead <= 15 ? "NOW" : fmtDist(ahead);

  // Voice + vibration, once per stage: 1 = first warning, 2 = urgent warning
  const stage = nav.stage.get(h.id) || 0;
  const wanted = ahead <= ALERT_NEAR_M ? 2 : 1;
  if (wanted > stage) {
    nav.stage.set(h.id, wanted);
    const how = urgent ? "Slow down." : "Be careful.";
    const text = wanted === 1
      ? `${h.severity} road damage ahead in ${roundTo10(ahead)} meters. ${how}`
      : `${how} ${h.severity} ${damage} just ahead.`;
    speak(text);
    if (navigator.vibrate) navigator.vibrate(wanted === 2 ? [300, 120, 300, 120, 300] : [250, 100, 250]);
  }
}

el("start-btn").addEventListener("click", startNavigation);
el("stop-btn").addEventListener("click", () => stopNavigation());

// --- Init ---
loadHazards();