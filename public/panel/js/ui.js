// Shared DOM helpers, formatting and the toast strip.
import { icon } from "./icons.js";

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function fmtSize(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  return (bytes / 1024 ** 3).toFixed(2) + " GB";
}

export function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制到剪贴板", "ok");
  } catch {
    toast("复制失败：浏览器未授权剪贴板", "error");
  }
}

const TOAST_ICONS = { info: "info", ok: "check", error: "alert" };

export function toast(message, kind = "info") {
  const container = document.getElementById("toasts");
  const item = el("div", "toast " + kind);
  item.innerHTML = `<span class="toast-icon">${TOAST_ICONS[kind] ? icon(TOAST_ICONS[kind], 16) : ""}</span>`;
  item.append(el("span", null, message));
  container.append(item);
  requestAnimationFrame(() => item.classList.add("show"));
  setTimeout(() => {
    item.classList.remove("show");
    setTimeout(() => item.remove(), 220);
  }, 2600);
  while (container.children.length > 4) container.firstElementChild.remove();
}
