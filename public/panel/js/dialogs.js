// Modal system: one overlay, one dialog at a time, Escape and backdrop
// close, focus lands on the first focusable element. Forms can opt out of
// backdrop dismissal so a stray click never throws away typed input.

import { el } from "./ui.js";
import { icon } from "./icons.js";

const root = document.getElementById("modal");
const drawerRoot = document.getElementById("drawer");
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

let active = null;
let pendingClose = null;
let drawerOpen = false;
let drawerReturnFocus = null;

export function showModal({ title, build, actions = [], danger = false, wide = false, compact = false, dismissOnBackdrop = true, onClose, ready }) {
  if (pendingClose) { clearTimeout(pendingClose); pendingClose = null; }
  closeModal(true);
  const box = el("div", "modal-box" + (wide ? " wide" : "") + (compact ? " compact" : "") + (danger ? " danger" : ""));
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", title);
  const head = el("div", "modal-head");
  head.append(el("h3", null, title));
  const closeButton = el("button", "icon-btn");
  closeButton.innerHTML = icon("x", 18);
  head.append(closeButton);
  box.append(head);

  const bodyNode = el("div", "modal-body");
  if (typeof build === "string") bodyNode.innerHTML = build;
  else if (build) build(bodyNode);
  box.append(bodyNode);

  let footer = null;
  if (actions.length) {
    footer = el("div", "modal-foot");
    for (const action of actions) {
      const button = el("button", "btn " + (action.kind || "ghost") + (action.block ? " block" : ""), action.label);
      button.type = "button";
      button.addEventListener("click", () => action.onClick?.(closeModal, box));
      footer.append(button);
    }
    box.append(footer);
  }

  root.innerHTML = "";
  root.classList.remove("hidden", "closing");
  root.append(box);
  active = { onClose };

  closeButton.addEventListener("click", () => closeModal());
  root.onmousedown = (event) => {
    if (event.target === root && dismissOnBackdrop) closeModal();
  };
  document.addEventListener("keydown", keyHandler);

  const firstField = box.querySelector("input, select, textarea, button.primary");
  if (firstField) firstField.focus();
  ready?.(box);

  return { close: () => closeModal(), root: box };
}

function keyHandler(event) {
  if (!active) return;
  if (event.key === "Escape") { closeModal(); return; }
  // Focus trap: keep Tab cycling inside the open dialog.
  if (event.key !== "Tab") return;
  const box = root.querySelector(".modal-box");
  if (!box) return;
  const focusable = [...box.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")]
    .filter((node) => !node.disabled && node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function finishClose() {
  pendingClose = null;
  root.classList.add("hidden");
  root.classList.remove("closing");
  root.innerHTML = "";
}

export function closeModal(immediate = false) {
  if (!active) return;
  const handler = active.onClose;
  active = null;
  root.onmousedown = null;
  document.removeEventListener("keydown", keyHandler);
  handler?.();

  if (pendingClose) { clearTimeout(pendingClose); pendingClose = null; }
  const box = root.querySelector(".modal-box");
  if (!immediate && box && !REDUCED.matches) {
    root.classList.add("closing");
    box.classList.add("closing");
    pendingClose = setTimeout(finishClose, 130);
  } else {
    finishClose();
  }
}

// ---- Right-side details drawer ------------------------------------------------
// Non-dimming panel per the design spec: the list stays visible while the
// drawer slides over it. Closing happens on Escape, the close button, a click
// outside the panel, or navigating to another view (hashchange).

export function showDrawer({ title, build, actions = [] }) {
  closeDrawer(true);
  // Focus management per the audit: move focus into the panel on open, keep
  // Tab cycling inside it, and hand focus back when it closes.
  drawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  drawerRoot.innerHTML = "";
  const panel = el("aside", "drawer");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", title);
  const head = el("div", "drawer-head");
  head.append(el("h3", null, title));
  const closeButton = el("button", "icon-btn");
  closeButton.innerHTML = icon("x", 18);
  closeButton.addEventListener("click", () => closeDrawer());
  head.append(closeButton);
  panel.append(head);

  const body = el("div", "drawer-body");
  if (typeof build === "string") body.innerHTML = build;
  else if (build) build(body);
  panel.append(body);

  if (actions.length) {
    const foot = el("div", "drawer-foot");
    for (const action of actions) {
      const button = el("button", "btn " + (action.kind || "ghost"), action.label);
      button.type = "button";
      button.addEventListener("click", action.onClick);
      foot.append(button);
    }
    panel.append(foot);
  }

  drawerRoot.append(panel);
  drawerRoot.classList.remove("hidden");
  // Force a layout between removing .hidden and adding .open so the slide-in
  // transition always runs — requestAnimationFrame is throttled or frozen in
  // background tabs, which would otherwise leave the drawer parked off-screen.
  void panel.offsetWidth;
  drawerRoot.classList.add("open");
  drawerOpen = true;
  closeButton.focus();
}

export function closeDrawer(immediate = false) {
  if (!drawerOpen) return;
  drawerOpen = false;
  const finish = () => {
    drawerRoot.classList.add("hidden");
    drawerRoot.classList.remove("open");
    drawerRoot.innerHTML = "";
    if (drawerReturnFocus) {
      drawerReturnFocus.focus();
      drawerReturnFocus = null;
    }
  };
  if (immediate || REDUCED.matches) {
    finish();
    return;
  }
  drawerRoot.classList.remove("open");
  setTimeout(() => {
    if (!drawerOpen) finish();
  }, 210);
}

drawerRoot.addEventListener("mousedown", (event) => {
  if (event.target === drawerRoot) closeDrawer();
});
document.addEventListener("keydown", (event) => {
  if (!drawerOpen) return;
  if (event.key === "Escape") { closeDrawer(); return; }
  // Focus trap: Tab stays inside the open drawer, mirroring the modal.
  if (event.key !== "Tab") return;
  const panel = drawerRoot.querySelector(".drawer");
  if (!panel) return;
  const focusable = [...panel.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")]
    .filter((node) => !node.disabled && node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
});
// Navigating to another view always retires the details drawer.
window.addEventListener("hashchange", () => closeDrawer(true));

// Single-field prompt with live validation. Resolves with the trimmed value
// or null when cancelled — a drop-in replacement for window.prompt.
// With submitAsync the dialog stays open (buttons disabled + busy spinner)
// until the promise settles; a rejection shows the error inline for retry.
// The backdrop never dismisses a form: typed input must not be lost to a
// stray click, so only 取消 / the close button / Escape end the form.
export function formDialog({ title, label, value = "", placeholder = "", hint, validate, submitLabel = "确定", danger = false, submitAsync }) {
  return new Promise((resolve) => {
    let settled = false;
    let busy = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const errorLine = el("p", "form-error hidden");
    errorLine.setAttribute("role", "alert");
    const progressLine = el("p", "progress-line hidden");
    const report = (text) => {
      progressLine.textContent = text;
      progressLine.classList.remove("hidden");
    };
    const input = el("input", "input");
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;

    const field = el("label", "field");
    if (label) field.append(el("span", null, label));
    field.append(input);
    if (hint) field.append(el("p", "field-hint", hint));

    const setError = (message) => {
      if (message) {
        errorLine.textContent = message;
        errorLine.classList.remove("hidden");
        input.classList.add("invalid");
      } else {
        errorLine.classList.add("hidden");
        input.classList.remove("invalid");
      }
    };

    input.addEventListener("input", () => setError(null));

    const submit = async () => {
      if (busy) return;
      const trimmed = input.value.trim();
      const problem = validate ? validate(trimmed) : (trimmed ? null : "请输入内容");
      if (problem) { setError(problem); return; }
      if (!submitAsync) { finish(trimmed); closeModal(); return; }
      busy = true;
      setModalBusy(true);
      try {
        await submitAsync(trimmed, report);
        finish(trimmed);
        closeModal();
      } catch (error) {
        busy = false;
        setModalBusy(false);
        setError(error.message || "操作失败，请重试");
        input.focus();
      }
    };

    let footer = null;
    showModal({
      title,
      danger,
      dismissOnBackdrop: false,
      build: (container) => {
        container.append(field, errorLine, progressLine);
      },
      actions: [
        { label: "取消", onClick: () => { finish(null); closeModal(); } },
        { label: submitLabel, kind: danger ? "danger" : "primary", onClick: () => void submit() },
      ],
      onClose: () => finish(null),
      ready: (box) => { footer = box.querySelector(".modal-foot"); },
    });

    function setModalBusy(state) {
      footer?.querySelectorAll(".btn").forEach((button) => {
        button.disabled = state;
        button.classList.toggle("busy", state && button.classList.contains("primary"));
      });
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    });
  });
}

export function confirmDialog({ title, message, detail, confirmLabel = "删除", danger = true, confirmAsync }) {
  return new Promise((resolve) => {
    let settled = false;
    let busy = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const errorLine = el("p", "form-error hidden");
    errorLine.setAttribute("role", "alert");
    const progressLine = el("p", "progress-line hidden");
    const report = (text) => {
      progressLine.textContent = text;
      progressLine.classList.remove("hidden");
    };
    let footer = null;

    const run = async () => {
      if (busy) return;
      if (!confirmAsync) { finish(true); closeModal(); return; }
      busy = true;
      footer?.querySelectorAll(".btn").forEach((button) => {
        button.disabled = true;
        button.classList.toggle("busy", button.classList.contains("danger") || button.classList.contains("primary"));
      });
      try {
        await confirmAsync(report);
        finish(true);
        closeModal();
      } catch (error) {
        busy = false;
        footer?.querySelectorAll(".btn").forEach((button) => { button.disabled = false; button.classList.remove("busy"); });
        errorLine.textContent = error.message || "操作失败，请重试";
        errorLine.classList.remove("hidden");
      }
    };

    showModal({
      title,
      danger,
      compact: true,
      build: (container) => {
        if (message) container.append(el("p", "confirm-message", message));
        if (detail) container.append(el("p", "field-hint", detail));
        container.append(errorLine, progressLine);
      },
      actions: [
        { label: "取消", onClick: () => { finish(false); closeModal(); } },
        { label: confirmLabel, kind: danger ? "danger" : "primary", onClick: () => void run() },
      ],
      onClose: () => finish(false),
      ready: (modalBox) => { footer = modalBox.querySelector(".modal-foot"); },
    });
  });
}
