// Handles: photo preview, geolocation capture, and submitting the report to the API.
// Uses UI (js/ui.js) for confirm dialogs, toasts and the result dialog.

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

const imageInput = document.getElementById("image-input");
const uploadPlaceholder = document.getElementById("camera-placeholder");
const video = document.getElementById("camera-video");
const openBtn = document.getElementById("camera-open-btn");
const captureBtn = document.getElementById("camera-capture-btn");
const retakeBtn = document.getElementById("camera-retake-btn");
let cameraStream = null;
const previewImg = document.getElementById("preview-img");

const latInput = document.getElementById("lat-input");
const lngInput = document.getElementById("lng-input");
const locateBtn = document.getElementById("locate-btn");

const descInput = document.getElementById("description-input");
const emailInput = document.getElementById("email-input");
const descCount = document.getElementById("desc-count");

const form = document.getElementById("report-form");
const submitBtn = document.getElementById("submit-btn");
const statusMsg = document.getElementById("status-msg");

let selectedFile = null;
let locationSource = "manual"; // "gps" when the device GPS filled the pin
let capturedLive = false; // true when the photo came from the in-app camera

function onCoordinateTyped() {
  locationSource = "manual";
  updateSubmitState();
}

latInput.addEventListener("input", onCoordinateTyped);
lngInput.addEventListener("input", onCoordinateTyped);
descInput.addEventListener("input", () => {
  descCount.textContent = descInput.value.length;
});

// --- Live camera ---
function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  video.srcObject = null;
  video.style.display = "none";
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    UI.toast("Live camera needs https or localhost. Use 'Upload a photo instead' below.", "error", 6000);
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = cameraStream;
    video.style.display = "block";
    previewImg.style.display = "none";
    uploadPlaceholder.style.display = "none";
    openBtn.style.display = "none";
    retakeBtn.style.display = "none";
    captureBtn.style.display = "inline-block";
    // Start finding the location now so it is ready when the photo is taken
    requestLocation(true);
  } catch (err) {
    UI.toast("Couldn't open the camera. Allow camera access, or use 'Upload a photo instead'.", "error", 6000);
  }
}

function capturePhoto() {
  if (!video.videoWidth) {
    UI.toast("Camera is still starting. Try again in a second.", "info", 2000);
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(
    (blob) => {
      if (!blob) {
        UI.toast("Couldn't capture the photo. Please try again.", "error");
        return;
      }
      selectedFile = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      capturedLive = true;
      previewImg.src = URL.createObjectURL(blob);
      previewImg.style.display = "block";
      stopCamera();
      captureBtn.style.display = "none";
      retakeBtn.style.display = "inline-block";
      UI.toast("Photo captured.", "success", 2000);

      // Refresh the location at the moment of the shot
      requestLocation(true);
      updateSubmitState();
    },
    "image/jpeg",
    0.9
  );
}

openBtn.addEventListener("click", openCamera);
captureBtn.addEventListener("click", capturePhoto);
retakeBtn.addEventListener("click", () => {
  selectedFile = null;
  capturedLive = false;
  updateSubmitState();
  openCamera();
});

// --- Photo preview (upload fallback) ---
imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (!file) return;

  if (file.size > MAX_IMAGE_BYTES) {
    UI.toast("That photo is larger than 10MB. Please choose a smaller one.", "error");
    imageInput.value = "";
    return;
  }

  selectedFile = file;
  capturedLive = false;
  stopCamera();
  captureBtn.style.display = "none";
  openBtn.style.display = "none";
  retakeBtn.style.display = "inline-block";
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewImg.style.display = "block";
    uploadPlaceholder.style.display = "none";
  };
  reader.readAsDataURL(file);

  UI.toast("Photo added.", "info", 2000);
  updateSubmitState();
});

// --- Geolocation ---
locateBtn.addEventListener("click", () => requestLocation(false));

function requestLocation(quiet) {
  if (!navigator.geolocation) {
    if (!quiet) UI.toast("Geolocation isn't supported on this browser/device.", "error");
    return;
  }

  locateBtn.textContent = "Locating...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      latInput.value = position.coords.latitude.toFixed(7);
      lngInput.value = position.coords.longitude.toFixed(7);
      locationSource = "gps";
      locateBtn.textContent = "📍 Location captured";
      if (!quiet) UI.toast("Location captured.", "success", 2500);
      updateSubmitState();
    },
    () => {
      locateBtn.textContent = "📍 Use my location";
      if (!quiet) {
        UI.toast(
          "Couldn't get your location. Allow location access, or type the latitude and longitude yourself.",
          "error",
          6000
        );
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

function updateSubmitState() {
  const hasImage = !!selectedFile;
  const hasLocation = latInput.value && lngInput.value;
  submitBtn.disabled = !(hasImage && hasLocation);
}

function showStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = `status-msg ${type}`;
}

function resetForm() {
  form.reset();
  previewImg.style.display = "none";
  uploadPlaceholder.style.display = "block";
  selectedFile = null;
  capturedLive = false;
  stopCamera();
  captureBtn.style.display = "none";
  retakeBtn.style.display = "none";
  openBtn.style.display = "inline-block";
  latInput.value = "";
  lngInput.value = "";
  descCount.textContent = "0";
  locationSource = "manual";
  locateBtn.textContent = "📍 Use my location";
}

function resultDialogHtml(data) {
  const d = data.detection;
  const hasDamage = d.damage_type !== "none";
  const severityClass = d.severity.toLowerCase();

  const summary = hasDamage
    ? `<p><span class="badge ${UI.esc(severityClass)}">${UI.esc(d.severity)}</span>
       &nbsp;${UI.esc(d.damage_type)} &middot; ${Math.round(d.confidence * 100)}% confidence</p>`
    : `<p><span class="badge none">No damage detected</span></p>`;

  const description = data.report.description
    ? `<p class="result-desc"><strong>Your description:</strong><br/>${UI.esc(data.report.description)}</p>`
    : "";

  const route = data.route_suggestion
    ? `<div class="route-box">⚠️ ${UI.esc(data.route_suggestion.alternate_route)}</div>`
    : "";

  const checks = {
    verified: '<div class="loc-note loc-ok">✔ Location matches the GPS data in your photo.</div>',
    mismatch: '<div class="loc-note loc-bad">⚠ The GPS data in your photo does not match the location you entered. Your report is on hold until an admin reviews it.</div>',
    unverified: '<div class="loc-note loc-warn">ℹ Your photo has no GPS data, so the location is marked unconfirmed until an admin verifies it. Tip: turn on location for your camera.</div>',
  };
  const locationNote = checks[data.report.location_check] || "";
  const emailNote = data.email && data.email.confirmation_queued
    ? '<div class="loc-note loc-ok">✉ A copy of your report is being emailed to you.</div>'
    : "";

  return `
    <p>Your report <strong>#${data.report.report_id}</strong> was saved. Thank you for helping keep the roads safe!</p>
    ${locationNote}
    ${emailNote}
    ${summary}
    ${description}
    ${UI.recommendationHtml(data.recommendation)}
    ${route}
    <p class="muted-note">An admin will review your report before it is verified.</p>
  `;
}

// --- Submit ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusMsg.className = "status-msg";

  const lat = parseFloat(latInput.value);
  const lng = parseFloat(lngInput.value);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    UI.toast("Latitude must be between -90 and 90, and longitude between -180 and 180.", "error", 6000);
    return;
  }

  const description = descInput.value.trim();

  // Prompt 1: confirm before sending
  const ok = await UI.confirm({
    title: "Submit this report?",
    confirmText: "Yes, submit",
    cancelText: "Go back",
    html: `
      <p>Please check your details:</p>
      <ul class="confirm-list">
        <li><strong>Location:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}</li>
        <li><strong>Location source:</strong> ${capturedLive && locationSource === "gps" ? "Live camera + GPS" : locationSource === "gps" ? "Phone GPS" : "Typed by hand (shown as unconfirmed)"}</li>
        <li><strong>Description:</strong> ${description ? UI.esc(description) : "<em>none</em>"}</li>
        ${emailInput.value.trim() ? `<li><strong>Email a copy to:</strong> ${UI.esc(emailInput.value.trim())}</li>` : ""}
      </ul>
      <p class="muted-note">The photo will be scanned by our AI to detect the type and severity of damage. Please only report damage at the pinned spot; reports are checked against your photo's GPS data.</p>
    `,
  });
  if (!ok) {
    UI.toast("Submission cancelled.", "info", 2500);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  const formData = new FormData();
  formData.append("image", selectedFile);
  formData.append("latitude", latInput.value);
  formData.append("longitude", lngInput.value);
  formData.append("description", description);
  const email = emailInput.value.trim();
  if (email) formData.append("email", email);
  formData.append("device_id", getDeviceId());
  formData.append("location_source", capturedLive && locationSource === "gps" ? "camera" : locationSource);

  try {
    const response = await fetch(`${API_BASE_URL}/reports`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    // Green success message: toast + a banner that stays on the page
    UI.toast("Report submitted successfully!", "success");
    showStatus(
      `✅ Success! Report #${data.report.report_id} was submitted. Thank you for helping keep the roads safe!`,
      "success"
    );
    statusMsg.scrollIntoView({ behavior: "smooth", block: "center" });
    submitBtn.textContent = "Submit Report";
    resetForm();

    // Let the person see the green banner for a moment before the details dialog
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Prompt 2: show the result with safety guidance
    await UI.notice({
      title: "Report submitted",
      html: resultDialogHtml(data),
      buttonText: "Done",
    });
  } catch (err) {
    const message = UI.errorMessage(err);
    showStatus(`Failed to submit: ${message}`, "error");
    UI.toast(`Failed to submit: ${message}`, "error", 6000);
  } finally {
    submitBtn.textContent = "Submit Report";
    updateSubmitState();
  }
});