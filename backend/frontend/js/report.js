// Handles: photo preview, geolocation capture, and submitting the report to the API.

const imageInput = document.getElementById("image-input");
const uploadBox = document.getElementById("upload-box");
const uploadPlaceholder = document.getElementById("upload-placeholder");
const previewImg = document.getElementById("preview-img");

const latInput = document.getElementById("lat-input");
const lngInput = document.getElementById("lng-input");
const locateBtn = document.getElementById("locate-btn");

const form = document.getElementById("report-form");
const submitBtn = document.getElementById("submit-btn");
const statusMsg = document.getElementById("status-msg");

let selectedFile = null;

// --- Photo preview ---
imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (!file) return;

  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewImg.style.display = "block";
    uploadPlaceholder.style.display = "none";
  };
  reader.readAsDataURL(file);

  updateSubmitState();
});

// --- Geolocation ---
locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showStatus("Geolocation isn't supported on this browser/device.", "error");
    return;
  }

  locateBtn.textContent = "Locating...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      latInput.value = position.coords.latitude.toFixed(7);
      lngInput.value = position.coords.longitude.toFixed(7);
      locateBtn.textContent = "📍 Location captured";
      updateSubmitState();
    },
    (error) => {
      locateBtn.textContent = "📍 Use my location";
      showStatus(
        "Couldn't get your location. Please allow location access and try again.",
        "error"
      );
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

function updateSubmitState() {
  const hasImage = !!selectedFile;
  const hasLocation = latInput.value && lngInput.value;
  submitBtn.disabled = !(hasImage && hasLocation);
}

function showStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = `status-msg ${type}`;
}

// --- Submit ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";
  statusMsg.className = "status-msg";

  const formData = new FormData();
  formData.append("image", selectedFile);
  formData.append("latitude", latInput.value);
  formData.append("longitude", lngInput.value);

  try {
    const response = await fetch(`${API_BASE_URL}/reports`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    showStatus(
      `Report submitted! Detected: ${data.detection.damage_type} (${data.detection.severity}). Thank you.`,
      "success"
    );

    form.reset();
    previewImg.style.display = "none";
    uploadPlaceholder.style.display = "block";
    selectedFile = null;
    latInput.value = "";
    lngInput.value = "";
    locateBtn.textContent = "📍 Use my location";
  } catch (err) {
    showStatus(`Failed to submit: ${err.message}`, "error");
  } finally {
    submitBtn.textContent = "Submit Report";
    updateSubmitState();
  }
});