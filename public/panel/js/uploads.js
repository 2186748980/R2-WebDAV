// Upload manager: a global drop target plus a tray that lives outside the
// view stack, so uploads survive navigation. Large files (≥20 MiB) use R2
// multipart in 10 MiB parts; pause/resume takes effect between parts and
// between attempts (an in-flight part cannot be paused mid-stream).

import { api, ApiError } from "./api.js";
import { icon, iconForName } from "./icons.js";
import { el, fmtSize, toast } from "./ui.js";

const PART_SIZE = 10 * 1024 * 1024;
const MULTIPART_THRESHOLD = 20 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

const uploads = new Map();
let trayList = null;
let trayBadge = null;
let getCurrentPath = () => "";
let onUploadDone = null;

export function initUploads({ currentPathProvider, onDone }) {
  getCurrentPath = currentPathProvider;
  onUploadDone = onDone;

  trayList = document.getElementById("trayList");
  trayBadge = document.getElementById("trayBadge");
  document.getElementById("trayClose").addEventListener("click", () => toggleTray(false));
  document.getElementById("trayBtn").addEventListener("click", () => toggleTray());

  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", () => {
    enqueueFiles(fileInput.files);
    fileInput.value = "";
  });

  wireDragAndDrop();
}

export function toggleTray(force) {
  const tray = document.getElementById("tray");
  const show = force !== undefined ? force : tray.classList.contains("hidden");
  tray.classList.toggle("hidden", !show);
}

export function openUploadPicker() {
  const input = document.getElementById("fileInput");
  input.click();
}

export function enqueueFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const directory = getCurrentPath();
  for (const file of files) startUpload(file, directory);
  updateBadge();
  toggleTray(true);
  if (files.length > 1) toast(`开始上传 ${files.length} 个文件到 ${directory ? "/" + directory : "根目录"}`);
}

function startUpload(file, directory) {
  const record = {
    id: crypto.randomUUID(),
    file,
    target: (directory ? directory + "/" : "") + file.name,
    status: "uploading", // uploading | paused | done | failed | cancelled
    paused: false,
    cancelled: false,
    running: false,
    xhr: null,
    uploadId: null,
    loadedBase: 0,
    partLabel: "",
    node: null,
    bar: null,
    statusText: null,
    actions: null,
  };
  uploads.set(record.id, record);
  record.node = renderTrayItem(record);
  trayList.prepend(record.node);
  updateBadge();
  void run(record);
}

function renderTrayItem(record) {
  const node = el("div", "tray-item");
  const glyph = el("span", "tray-icon");
  glyph.innerHTML = icon(iconForName(record.file.name), 18);

  const main = el("div", "tray-main");
  const name = el("div", "tray-name", record.file.name);
  name.title = "目标：/" + record.target;
  const bar = el("div", "tray-bar");
  const fill = el("i");
  bar.append(fill);
  const status = el("div", "tray-status", "准备中…");
  main.append(name, bar, status);

  const actions = el("div", "tray-actions");
  node.append(glyph, main, actions);

  record.bar = fill;
  record.statusText = status;
  record.actions = actions;
  renderActions(record);
  return node;
}

// Tray buttons change with status; rebuild on every transition.
function renderActions(record) {
  const actions = record.actions;
  actions.innerHTML = "";
  const add = (glyph, title, handler) => {
    const node = el("button", "icon-btn sm");
    node.innerHTML = icon(glyph, 15);
    node.title = title;
    node.addEventListener("click", handler);
    actions.append(node);
  };

  if (record.status === "uploading") {
    add("clock", "暂停", () => { record.paused = true; });
    add("x", "取消", () => cancelUpload(record));
  } else if (record.status === "paused") {
    add("upload", "继续", () => { record.paused = false; });
    add("x", "取消", () => cancelUpload(record));
  } else if (record.status === "failed" || record.status === "cancelled") {
    add("refresh", "重试", () => void retryUpload(record));
    add("x", "移除", () => removeRecord(record));
  } else if (record.status === "done") {
    add("check", "完成", () => removeRecord(record));
  }
}

function setTrayStatus(record, text, percent) {
  record.statusText.textContent = text;
  if (percent !== undefined) record.bar.style.width = Math.min(100, Math.max(0, percent)) + "%";
}

async function waitIfPaused(record) {
  while (record.paused && !record.cancelled) {
    record.status = "paused";
    renderActions(record);
    setTrayStatus(record, "已暂停", undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (record.cancelled) throw Object.assign(new ApiError("已取消", 0), { cancelled: true });
}

async function run(record) {
  if (record.running) return;
  record.running = true;
  record.status = "uploading";
  renderActions(record);
  try {
    if (record.file.size >= MULTIPART_THRESHOLD) await multipartUpload(record);
    else await simpleUpload(record);
    record.status = "done";
    record.running = false;
    renderActions(record);
    setTrayStatus(record, "完成 · " + fmtSize(record.file.size), 100);
    updateBadge();
    onUploadDone?.();
    setTimeout(() => removeRecord(record), 8000);
  } catch (error) {
    record.running = false;
    if (error.cancelled || record.cancelled) {
      record.status = "cancelled";
      setTrayStatus(record, "已取消", 0);
    } else {
      record.status = "failed";
      setTrayStatus(record, "失败：" + error.message, undefined);
    }
    renderActions(record);
    updateBadge();
  }
}

async function simpleUpload(record) {
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS) {
    await waitIfPaused(record);
    try {
      await xhrUpload(
        api.uploadUrl(record.target),
        "PUT",
        record.file,
        { "Content-Type": record.file.type || "application/octet-stream" },
        (loaded) => setTrayStatus(record, `${fmtSize(loaded)} / ${fmtSize(record.file.size)}`, (loaded / record.file.size) * 100),
        record,
      );
      return;
    } catch (error) {
      if (error.cancelled) throw error;
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) throw error;
      record.status = "retrying";
      setTrayStatus(record, `失败，重试 ${attempts}/${MAX_ATTEMPTS - 1}…`, undefined);
      await new Promise((resolve) => setTimeout(resolve, 600 * attempts));
    }
  }
}

async function multipartUpload(record) {
  const partCount = Math.ceil(record.file.size / PART_SIZE);
  if (record.uploadId) {
    // A failed earlier attempt must not leave orphaned parts behind.
    api.multipartAbort(record.target, record.uploadId).catch(() => {});
    record.uploadId = null;
  }

  const created = await api.multipartCreate(record.target, record.file.type || "application/octet-stream");
  record.uploadId = created.uploadId;

  const parts = [];
  let completedBytes = 0;
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    await waitIfPaused(record);
    const start = (partNumber - 1) * PART_SIZE;
    const end = Math.min(start + PART_SIZE, record.file.size);
    let attempt = 0;
    let part = null;
    while (attempt < MAX_ATTEMPTS && !part) {
      await waitIfPaused(record);
      try {
        part = await xhrUpload(
          api.multipartPartUrl(record.target, record.uploadId, partNumber),
          "PUT",
          record.file.slice(start, end),
          { "Content-Type": "application/octet-stream" },
          (loaded) => {
            const overall = ((completedBytes + loaded) / record.file.size) * 100;
            setTrayStatus(record, `第 ${partNumber}/${partCount} 片 · ${fmtSize(completedBytes + loaded)} / ${fmtSize(record.file.size)}`, overall);
          },
          record,
        );
      } catch (error) {
        if (error.cancelled) throw error;
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) throw error;
        setTrayStatus(record, `第 ${partNumber} 片重试 ${attempt}/${MAX_ATTEMPTS - 1}…`, undefined);
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
    }
    parts.push({ partNumber: part.partNumber, etag: part.etag });
    completedBytes = end;
  }

  setTrayStatus(record, "合并分片…", 100);
  await waitIfPaused(record);
  await api.multipartComplete(record.target, record.uploadId, parts);
  record.uploadId = null;
}

function cancelUpload(record) {
  record.cancelled = true;
  record.paused = false;
  record.xhr?.abort();
  if (record.uploadId) {
    api.multipartAbort(record.target, record.uploadId).catch(() => {});
    record.uploadId = null;
  }
  if (!record.running) {
    record.status = "cancelled";
    renderActions(record);
    setTrayStatus(record, "已取消", 0);
    updateBadge();
  }
}

async function retryUpload(record) {
  if (record.running) return;
  record.cancelled = false;
  record.loadedBase = 0;
  record.partLabel = "";
  record.bar.style.width = "0%";
  await run(record);
}

function removeRecord(record) {
  uploads.delete(record.id);
  record.node?.remove();
  updateBadge();
}

function updateBadge() {
  if (!trayBadge) return;
  const active = [...uploads.values()].filter((item) => ["uploading", "paused", "retrying"].includes(item.status)).length;
  trayBadge.textContent = String(active);
  trayBadge.classList.toggle("hidden", active === 0);
}

function wireDragAndDrop() {
  const overlay = document.getElementById("dropOverlay");
  let depth = 0;
  const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes("Files");

  document.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    depth += 1;
    overlay.classList.remove("hidden");
  });
  document.addEventListener("dragover", (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  document.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.add("hidden");
  });
  document.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.classList.add("hidden");
    enqueueFiles(event.dataTransfer.files);
  });
}

// ---- XHR plumbing: progress + abort, unlike fetch ---------------------------

function xhrUpload(url, method, body, headers, onProgress, record) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    record.xhr = xhr;
    xhr.open(method, url);
    Object.entries(headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      record.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { /* non-JSON */ }
        resolve(data);
      } else {
        reject(new ApiError("HTTP " + xhr.status, xhr.status, xhr.status === 401));
      }
    };
    xhr.onerror = () => { record.xhr = null; reject(new ApiError("网络错误", 0)); };
    xhr.onabort = () => { record.xhr = null; reject(Object.assign(new ApiError("已取消", 0), { cancelled: true })); };
    xhr.send(body);
  });
}
