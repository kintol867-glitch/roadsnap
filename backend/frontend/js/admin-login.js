const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const loginBtn = document.getElementById("login-btn");
const statusMsg = document.getElementById("status-msg");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";
  statusMsg.className = "status-msg";

  try {
    const response = await fetch(`${API_BASE_URL}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // important: sends/receives the session cookie
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Login failed");
    }

    // Success — go to the dashboard
    window.location.href = "admin-dashboard.html";
  } catch (err) {
    statusMsg.textContent = err.message;
    statusMsg.className = "status-msg error";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log In";
  }
});