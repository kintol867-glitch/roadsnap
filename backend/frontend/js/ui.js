// Shared UI helpers: toasts, confirm/notice/prompt dialogs, safe-HTML helpers.
// Loaded on every page BEFORE the page's own script.

const UI = (() => {
  // Escape user-provided text before putting it into innerHTML.
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  // ---------- Toasts ----------
  let toastWrap = null;

  function toast(message, type = "info", duration = 4000) {
    if (!toastWrap) {
      toastWrap = document.createElement("div");
      toastWrap.className = "toast-wrap";
      document.body.appendChild(toastWrap);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.textContent = message;
    toastWrap.appendChild(el);

    const remove = () => {
      el.classList.add("toast-hide");
      setTimeout(() => el.remove(), 250);
    };
    el.addEventListener("click", remove);
    setTimeout(remove, duration);
  }

  // ---------- Generic dialog ----------
  // buttons: [{ label, value, className }]; resolves with the clicked button's value
  // (or `dismissValue` when closed with Esc / clicking outside).
  function dialog({ title, html, buttons, dismissValue = null, onOpen }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ui-overlay";

      const box = document.createElement("div");
      box.className = "ui-dialog";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.innerHTML = `
        <h3 class="ui-title">${esc(title)}</h3>
        <div class="ui-body">${html}</div>
        <div class="ui-footer"></div>
      `;
      const footer = box.querySelector(".ui-footer");
      overlay.appendChild(box);

      function close(value) {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(value);
      }

      function onKey(e) {
        if (e.key === "Escape") close(dismissValue);
      }

      buttons.forEach((b) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = b.label;
        btn.className = b.className || "btn-secondary";
        btn.addEventListener("click", () => {
          if (typeof b.beforeClose === "function") {
            const result = b.beforeClose(box);
            if (result === false) return; // keep the dialog open
            close(result !== undefined ? result : b.value);
          } else {
            close(b.value);
          }
        });
        footer.appendChild(btn);
      });

      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) close(dismissValue);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);

      if (onOpen) onOpen(box);
      const focusTarget =
        box.querySelector("textarea, input") || footer.lastElementChild;
      if (focusTarget) focusTarget.focus();
    });
  }

  // ---------- Confirm ----------
  function confirm({
    title = "Are you sure?",
    message = "",
    confirmText = "Confirm",
    cancelText = "Cancel",
    danger = false,
    html = null,
  } = {}) {
    return dialog({
      title,
      html: html || `<p>${esc(message)}</p>`,
      dismissValue: false,
      buttons: [
        { label: cancelText, value: false, className: "btn-secondary" },
        {
          label: confirmText,
          value: true,
          className: danger ? "btn-danger" : "btn-primary",
        },
      ],
    });
  }

  // ---------- Notice (single OK button) ----------
  function notice({ title, html, buttonText = "OK" }) {
    return dialog({
      title,
      html,
      dismissValue: true,
      buttons: [{ label: buttonText, value: true, className: "btn-primary" }],
    });
  }

  // ---------- Prompt for text (resolves with string, or null if cancelled) ----------
  function promptText({
    title,
    label = "",
    value = "",
    maxLength = 1000,
    confirmText = "Save",
    placeholder = "",
  }) {
    return dialog({
      title,
      dismissValue: null,
      html: `
        ${label ? `<label class="ui-label" for="ui-prompt-input">${esc(label)}</label>` : ""}
        <textarea id="ui-prompt-input" rows="5" maxlength="${maxLength}"
          placeholder="${esc(placeholder)}">${esc(value)}</textarea>
        <div class="char-count"><span id="ui-prompt-count">${value.length}</span>/${maxLength}</div>
      `,
      onOpen: (box) => {
        const ta = box.querySelector("#ui-prompt-input");
        const count = box.querySelector("#ui-prompt-count");
        ta.addEventListener("input", () => {
          count.textContent = ta.value.length;
        });
      },
      buttons: [
        { label: "Cancel", value: null, className: "btn-secondary" },
        {
          label: confirmText,
          className: "btn-primary",
          beforeClose: (box) => box.querySelector("#ui-prompt-input").value,
        },
      ],
    });
  }

  // ---------- Safety-guidance block ----------
  function recommendationHtml(rec) {
    if (!rec) return "";
    const tips = (rec.tips || []).map((t) => `<li>${esc(t)}</li>`).join("");
    return `
      <div class="guidance">
        <div class="guidance-headline">🛡️ ${esc(rec.headline)}</div>
        <ul>${tips}</ul>
      </div>
    `;
  }

  // Turn fetch() failures into friendly text.
  function errorMessage(err) {
    if (err instanceof TypeError) {
      return "Can't reach the server. Check that the backend is running and try again.";
    }
    return err.message || "Something went wrong.";
  }

  return { esc, toast, dialog, confirm, notice, promptText, recommendationHtml, errorMessage };
})();