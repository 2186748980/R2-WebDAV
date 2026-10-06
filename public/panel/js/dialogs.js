// Modal system: one overlay, one dialog at a time, Escape and backdrop
// close, focus lands on the first focusable element.

import { el } from "./ui.js";
import { icon } from "./icons.js";

const root = document.getElementById("modal");
let active = null;

export function showModal({ title, build, actions = [], danger = false, onClose }) {
  closeModal();
  const box = el("div", "modal-box" + (danger ? " danger" : ""));
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
  root.append(box);
  root.classList.remove("hidden");
  active = { onClose };

  closeButton.addEventListener("click", closeModal);
  root.onmousedown = (event) => { if (event.target === root) closeModal(); };
  document.addEventListener("keydown", escapeHandler);

  const firstField = box.querySelector("input, select, textarea, button.primary");
  if (firstField) firstField.focus();

  return { close: closeModal, root: box };
}

function escapeHandler(event) {
  if (event.key === "Escape") closeModal();
}

export function closeModal() {
  if (!active) return;
  root.classList.add("hidden");
  root.innerHTML = "";
  root.onmousedown = null;
  document.removeEventListener("keydown", escapeHandler);
  const handler = active.onClose;
  active = null;
  handler?.();
}

// Single-field prompt with live validation. Resolves with the trimmed value
// or null when cancelled — a drop-in replacement for window.prompt.
export function formDialog({ title, label, value = "", placeholder = "", hint, validate, submitLabel = "确定", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const errorLine = el("p", "form-error hidden");
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

    showModal({
      title,
      danger,
      build: (container) => {
        container.append(field, errorLine);
      },
      actions: [
        { label: "取消", onClick: () => { finish(null); closeModal(); } },
        {
          label: submitLabel,
          kind: danger ? "danger" : "primary",
          onClick: () => {
            const trimmed = input.value.trim();
            const problem = validate ? validate(trimmed) : (trimmed ? null : "请输入内容");
            if (problem) { setError(problem); input.focus(); return; }
            finish(trimmed);
            closeModal();
          },
        },
      ],
      onClose: () => finish(null),
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.dispatchEvent(new Event("input"));
        const trimmed = input.value.trim();
        const problem = validate ? validate(trimmed) : (trimmed ? null : "请输入内容");
        if (problem) { setError(problem); return; }
        finish(trimmed);
        closeModal();
      }
    });
  });
}

export function confirmDialog({ title, message, detail, confirmLabel = "删除", danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    showModal({
      title,
      danger,
      build: (container) => {
        if (message) container.append(el("p", "confirm-message", message));
        if (detail) container.append(el("p", "field-hint", detail));
      },
      actions: [
        { label: "取消", onClick: () => { finish(false); closeModal(); } },
        { label: confirmLabel, kind: danger ? "danger" : "primary", onClick: () => { finish(true); closeModal(); } },
      ],
      onClose: () => finish(false),
    });
  });
}
