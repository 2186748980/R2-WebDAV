// Files view: listing, breadcrumb, sorting/filter/search, selection and
// batch bar, the row action menu, and the preview / details / share dialogs.

import { api, ApiError } from "./api.js";
import { icon, iconForItem } from "./icons.js";
import { el, fmtSize, fmtDate, toast, copyText } from "./ui.js";
import { formDialog, confirmDialog, showModal, closeModal } from "./dialogs.js";
import { openUploadPicker } from "./uploads.js";

const state = {
  path: "",
  items: [],
  cursor: null,
  filter: "",
  sort: "name",
  view: localStorage.getItem("r2dav.view") || "list",
  global: false,
  loading: false,
  error: null,
  selected: new Set(),
  active: false,
};

const nodes = {};

export function initFiles() {
  nodes.list = document.getElementById("fileList");
  nodes.head = document.getElementById("listHead");
  nodes.state = document.getElementById("listState");
  nodes.crumbs = document.getElementById("breadcrumb");
  nodes.hint = document.getElementById("globalHint");
  nodes.batch = document.getElementById("batchBar");
  nodes.selCount = document.getElementById("selCount");
  nodes.loadMore = document.getElementById("loadMoreBtn");

  document.getElementById("uploadBtn").addEventListener("click", openUploadPicker);
  document.getElementById("newFolderBtn").addEventListener("click", () => void createFolder());
  document.getElementById("clearSel").addEventListener("click", () => { state.selected.clear(); render(); });

  document.getElementById("batchDelete").addEventListener("click", () => void batchDelete());
  document.getElementById("batchCopy").addEventListener("click", () => void batchTransfer("copy"));
  document.getElementById("batchMove").addEventListener("click", () => void batchTransfer("move"));

  const search = document.getElementById("searchInput");
  search.addEventListener("input", () => { state.filter = search.value; render(); });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void runGlobalSearch(search.value.trim());
    if (event.key === "Escape") clearSearch();
  });

  document.getElementById("sortSelect").value = state.sort;
  document.getElementById("sortSelect").addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  const toggle = document.getElementById("viewToggle");
  toggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    state.view = button.dataset.mode;
    localStorage.setItem("r2dav.view", state.view);
    render();
  });

  nodes.head.addEventListener("click", (event) => {
    const column = event.target.closest("[data-sort]");
    if (!column) return;
    state.sort = column.dataset.sort;
    document.getElementById("sortSelect").value = state.sort;
    render();
  });

  document.getElementById("selectAll").addEventListener("change", (event) => {
    const visible = visibleItems();
    if (event.target.checked) visible.forEach((item) => state.selected.add(item.path));
    else visible.forEach((item) => state.selected.delete(item.path));
    render();
  });

  nodes.loadMore.addEventListener("click", () => void openPath(state.path, { reset: false }));

  document.addEventListener("click", hideMenu);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideMenu(); });
  nodes.list.addEventListener("scroll", hideMenu);
}

export function currentPath() {
  return state.path;
}

// Names currently loaded for the open directory — used by the upload
// overwrite guard. Best-effort: reflects the last listing, not live R2.
export function currentDirItemNames() {
  return state.items.map((item) => item.name);
}

export function isActive() {
  return state.active;
}

export function setActive(active) {
  state.active = active;
  if (active && !state.items.length && !state.loading) void openPath(state.path, { reset: true });
}

export async function refreshIfCurrent() {
  if (state.active) await openPath(state.path, { reset: true });
}

async function openPath(path, { reset = true } = {}) {
  state.global = false;
  state.filter = "";
  nodes.hint.classList.add("hidden");
  document.getElementById("searchInput").value = "";

  if (reset) {
    state.items = [];
    state.cursor = null;
    state.selected.clear();
    state.loading = true;
    state.error = null;
    render();
  }

  try {
    const data = await api.list(path, reset ? null : state.cursor);
    state.path = data.path;
    state.cursor = data.truncated ? data.cursor : null;
    state.items = reset ? data.items : state.items.concat(data.items);
    state.loading = false;
    state.error = null;
    render();
  } catch (error) {
    state.loading = false;
    if (error.isAuth) return; // global handler takes over
    state.error = error.message;
    render();
  }
}

function visibleItems() {
  const needle = state.filter.toLowerCase();
  const filtered = needle ? state.items.filter((item) => item.name.toLowerCase().includes(needle)) : [...state.items];
  const direction = { name: (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }), size: (a, b) => (b.size || 0) - (a.size || 0), date: (a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0) }[state.sort];
  return filtered.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return direction(a, b);
  });
}

function render() {
  document.getElementById("viewToggle").querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.view);
  });
  renderBreadcrumb();
  nodes.list.className = "file-list " + state.view;
  nodes.list.innerHTML = "";
  renderHead();

  const shown = visibleItems();
  const allVisibleSelected = shown.length > 0 && shown.every((item) => state.selected.has(item.path));
  const selectAll = document.getElementById("selectAll");
  selectAll.checked = allVisibleSelected;
  selectAll.indeterminate = shown.some((item) => state.selected.has(item.path)) && !allVisibleSelected;

  if (state.loading) {
    renderSkeleton();
  } else if (state.error) {
    renderMessage("alert", "目录加载失败：" + state.error, [
      { label: "重试", kind: "primary", onClick: () => void openPath(state.path) },
    ]);
  } else if (!shown.length) {
    if (state.global) {
      renderMessage("search", "没有匹配 “" + state.filter + "” 的结果", [
        { label: "清除搜索", onClick: clearSearch },
      ]);
    } else if (state.filter) {
      renderMessage("search", "当前目录没有匹配项", [
        { label: "清除筛选", onClick: clearSearch },
      ]);
    } else {
      renderMessage("folder-plus", "此文件夹为空", [
        { label: "上传文件", kind: "primary", onClick: openUploadPicker },
        { label: "新建文件夹", onClick: () => void createFolder() },
      ]);
    }
  } else {
    for (const item of shown) {
      nodes.list.append(state.view === "grid" ? buildGridCard(item) : buildRow(item));
    }
  }

  nodes.loadMore.classList.toggle("hidden", !state.cursor || state.loading);
  nodes.batch.classList.toggle("hidden", state.selected.size === 0);
  nodes.selCount.textContent = "已选 " + state.selected.size + " 项";
}

function renderHead() {
  nodes.head.classList.toggle("hidden", state.view !== "list" || (!state.loading && state.items.length === 0 && !state.error));
  nodes.head.querySelectorAll("[data-sort]").forEach((column) => {
    column.classList.toggle("sorted", column.dataset.sort === state.sort);
  });
}

function renderSkeleton() {
  for (let index = 0; index < 8; index += 1) {
    nodes.list.append(el("div", "skeleton-row"));
  }
}

function renderMessage(glyph, text, actions = []) {
  const box = el("div", "list-message");
  const glyphNode = el("div", "message-icon");
  glyphNode.innerHTML = icon(glyph, 34);
  box.append(glyphNode, el("p", null, text));
  if (actions.length) {
    const row = el("div", "message-actions");
    for (const action of actions) {
      const button = el("button", "btn " + (action.kind || "ghost"), action.label);
      button.addEventListener("click", action.onClick);
      row.append(button);
    }
    box.append(row);
  }
  nodes.state.innerHTML = "";
  nodes.state.className = "list-state";
  nodes.state.append(box);
  nodes.state.classList.remove("hidden");
}

function buildRow(item) {
  const row = el("div", "file-row" + (state.selected.has(item.path) ? " selected" : ""));
  row.setAttribute("role", "listitem");

  const check = el("input");
  check.type = "checkbox";
  check.checked = state.selected.has(item.path);
  check.addEventListener("click", (event) => event.stopPropagation());
  check.addEventListener("change", () => {
    if (check.checked) state.selected.add(item.path);
    else state.selected.delete(item.path);
    row.classList.toggle("selected", check.checked);
    syncBatchBar();
  });
  const checkLabel = el("label", "cell-check");
  checkLabel.append(check);

  const glyph = el("span", "cell-icon" + (item.type === "directory" ? " dir" : ""));
  glyph.innerHTML = icon(iconForItem(item), 20);

  const name = el("div", "cell-name");
  name.textContent = item.name;
  name.title = item.path;
  if (state.global) {
    const sub = el("div", "cell-sub", "/" + item.path);
    name.append(sub);
  }

  const size = el("div", "cell-size", item.type === "directory" ? "文件夹" : fmtSize(item.size));
  const date = el("div", "cell-date", fmtDate(item.uploaded));

  const kebab = el("button", "icon-btn sm cell-actions");
  kebab.innerHTML = icon("more", 17);
  kebab.title = "更多操作";
  kebab.setAttribute("aria-label", item.name + " 的操作");
  kebab.addEventListener("click", (event) => {
    event.stopPropagation();
    showMenu(event.currentTarget, item);
  });

  name.addEventListener("click", () => openEntry(item));
  glyph.addEventListener("click", () => openEntry(item));
  row.append(checkLabel, glyph, name, size, date, kebab);
  return row;
}

function buildGridCard(item) {
  const card = el("div", "grid-card" + (state.selected.has(item.path) ? " selected" : ""));
  const glyph = el("div", "grid-icon" + (item.type === "directory" ? " dir" : ""));
  glyph.innerHTML = icon(iconForItem(item), 34);
  const name = el("div", "grid-name", item.name);
  name.title = item.path;
  const meta = el("div", "grid-meta", item.type === "directory" ? "文件夹" : fmtSize(item.size));
  card.append(glyph, name, meta);

  // Touch devices (iOS included) never fire contextmenu, so the card carries
  // an explicit menu button; on desktop it appears on hover like the row kebab.
  const kebab = el("button", "icon-btn sm grid-kebab");
  kebab.innerHTML = icon("more", 16);
  kebab.title = "更多操作";
  kebab.setAttribute("aria-label", item.name + " 的操作");
  kebab.addEventListener("click", (event) => {
    event.stopPropagation();
    showMenu(event.currentTarget, item);
  });
  card.append(kebab);

  card.addEventListener("click", () => openEntry(item));
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showMenu(event.currentTarget, item);
  });
  return card;
}

function openEntry(item) {
  if (item.type === "directory") void openPath(item.path);
  else void previewItem(item);
}

function renderBreadcrumb() {
  const crumbs = nodes.crumbs;
  crumbs.innerHTML = "";
  const root = el("button", "crumb" + (state.path ? "" : " current"));
  root.innerHTML = icon("home", 15);
  root.append(el("span", null, "根目录"));
  root.addEventListener("click", () => void openPath(""));
  crumbs.append(root);

  let built = "";
  state.path.split("/").filter(Boolean).forEach((segment) => {
    built += (built ? "/" : "") + segment;
    const target = built;
    const separator = el("span", "crumb-sep");
    separator.innerHTML = icon("chevron-right", 13);
    crumbs.append(separator);
    const crumb = el("button", "crumb" + (target === state.path ? " current" : ""));
    crumb.textContent = segment;
    crumb.addEventListener("click", () => void openPath(target));
    crumbs.append(crumb);
  });
  crumbs.scrollLeft = crumbs.scrollWidth;
}

function syncBatchBar() {
  nodes.batch.classList.toggle("hidden", state.selected.size === 0);
  nodes.selCount.textContent = "已选 " + state.selected.size + " 项";
}

function clearSearch() {
  state.filter = "";
  state.global = false;
  document.getElementById("searchInput").value = "";
  nodes.hint.classList.add("hidden");
  render();
}

async function runGlobalSearch(query) {
  if (!query) { clearSearch(); return; }
  try {
    const data = await api.search(state.path, query);
    state.global = true;
    state.filter = query;
    state.items = data.items;
    state.cursor = null;
    state.selected.clear();
    nodes.hint.classList.remove("hidden");
    nodes.hint.innerHTML = "";
    const text = el("span", null, `全局搜索 “${query}” · ${data.items.length} 个结果` + (data.truncated ? "（已截断）" : ""));
    const clear = el("button", "btn ghost sm", "清除");
    clear.addEventListener("click", () => void openPath(state.path));
    nodes.hint.append(text, clear);
    render();
  } catch (error) {
    if (!error.isAuth) toast("搜索失败：" + error.message, "error");
  }
}

// ---- Actions ---------------------------------------------------------------

function unsafePath(value) {
  return !value || value.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"));
}

async function createFolder() {
  const name = await formDialog({
    title: "新建文件夹",
    label: "文件夹名称",
    placeholder: "例如：备份",
    submitLabel: "创建",
    validate: (value) => unsafePath(value) ? "名称不能为空，且不能包含 / \\ 或 .." : null,
    submitAsync: async (value) => {
      const path = (state.path ? state.path + "/" : "") + value;
      await api.action({ action: "mkdir", path });
      await openPath(state.path);
    },
  });
  if (name === null) return;
  toast("文件夹已创建", "ok");
}

async function renameItem(item) {
  const name = await formDialog({
    title: "重命名",
    label: "新名称",
    value: item.name,
    submitLabel: "重命名",
    validate: (value) => unsafePath(value) ? "名称不能为空，且不能包含 / \\ 或 .." : null,
    submitAsync: async (value) => {
      const parent = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
      const destination = (parent ? parent + "/" : "") + value;
      await api.action({ action: "rename", source: item.path, destination });
      await openPath(state.path);
    },
  });
  if (name === null) return;
  toast("已重命名", "ok");
}

async function transferItem(item, action) {
  const target = await formDialog({
    title: action === "copy" ? "复制到" : "移动到",
    label: "目标路径",
    value: item.name,
    hint: "可包含目标文件夹，例如 backups/" + item.name,
    submitLabel: action === "copy" ? "复制" : "移动",
    validate: (value) => unsafePath(value) ? "目标路径不能为空，且不能包含 \\ 或 .." : null,
    submitAsync: async (value) => {
      const parent = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
      const destination = value.includes("/") ? value : (parent ? parent + "/" : "") + value;
      if (destination === item.path) throw new ApiError("目标与源相同，请换一个名称", 0);
      await api.action({ action, source: item.path, destination });
      await openPath(state.path);
    },
  });
  if (target === null) return;
  toast(action === "copy" ? "已复制" : "已移动", "ok");
}

async function deleteItem(item) {
  const confirmed = await confirmDialog({
    title: "删除 " + item.name,
    message: item.type === "directory"
      ? "文件夹 “" + item.name + "” 及其内部全部内容将被立即删除，此操作不可恢复。"
      : "文件 “" + item.name + "” 将被立即删除，此操作不可恢复。",
    confirmLabel: "删除",
    confirmAsync: async () => {
      await api.action({ action: "delete", source: item.path });
      state.selected.delete(item.path);
      await openPath(state.path);
    },
  });
  if (!confirmed) return;
  toast("已删除", "ok");
}

async function batchDelete() {
  if (!state.selected.size) return;
  const count = state.selected.size;
  const confirmed = await confirmDialog({
    title: "删除 " + count + " 项",
    message: count + " 个文件/文件夹（含内部内容）将被立即删除，此操作不可恢复。",
    confirmLabel: "全部删除",
    confirmAsync: async () => {
      let failed = 0;
      for (const path of [...state.selected]) {
        try {
          await api.action({ action: "delete", source: path });
          state.selected.delete(path);
        } catch {
          failed += 1;
        }
      }
      if (failed) throw new ApiError(`${failed} 项删除失败，其余已完成`, 0);
      await openPath(state.path);
    },
  });
  if (!confirmed) return;
  toast("批量删除完成", "ok");
}

async function batchTransfer(action) {
  if (!state.selected.size) return;
  const destinationRoot = await formDialog({
    title: action === "copy" ? "批量复制到" : "批量移动到",
    label: "目标文件夹",
    placeholder: "例如 backups/photos，留空表示根目录",
    submitLabel: action === "copy" ? "复制" : "移动",
    validate: (value) => value.split("/").filter(Boolean).some((segment) => segment === "." || segment === ".." || segment.includes("\\")) ? "路径不能包含 . .. 或 \\" : null,
    submitAsync: async (value) => {
      const prefix = value ? value.replace(/^\/+|\/+$/g, "") + "/" : "";
      let failed = 0;
      for (const path of [...state.selected]) {
        const name = path.split("/").pop();
        try {
          await api.action({ action, source: path, destination: prefix + name });
          state.selected.delete(path);
        } catch {
          failed += 1;
        }
      }
      if (failed) throw new ApiError(`${failed} 项失败，其余已完成`, 0);
      await openPath(state.path);
    },
  });
  if (destinationRoot === null) return;
  toast(action === "copy" ? "批量复制完成" : "批量移动完成", "ok");
}

// ---- Row menu ----------------------------------------------------------------

function showMenu(anchor, item) {
  const menu = document.getElementById("menu");
  menu.innerHTML = "";
  const add = (glyph, label, handler, kind = "") => {
    const entry = el("button", "menu-item" + (kind ? " " + kind : ""));
    entry.innerHTML = icon(glyph, 16);
    entry.append(el("span", null, label));
    entry.addEventListener("click", () => { hideMenu(); handler(); });
    menu.append(entry);
  };

  if (item.type === "directory") {
    add("folder", "打开", () => void openPath(item.path));
  } else {
    add("eye", "预览", () => void previewItem(item));
    add("download", "下载", () => { location.href = api.downloadUrl(item.path); });
  }
  add("info", "详情", () => void showDetails(item));
  if (item.type === "file") add("link", "生成分享链接", () => void shareItem(item));
  add("edit", "重命名", () => void renameItem(item));
  add("copy", "复制到…", () => void transferItem(item, "copy"));
  add("move", "移动到…", () => void transferItem(item, "move"));
  add("trash", "删除", () => void deleteItem(item), "danger");

  const mobile = window.matchMedia("(max-width: 640px)").matches;
  menu.classList.add(mobile ? "sheet" : "dropdown");
  menu.classList.remove("hidden");
  if (!mobile) {
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
    const top = rect.bottom + 6 + menuRect.height > window.innerHeight ? rect.top - menuRect.height - 6 : rect.bottom + 6;
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
  } else {
    menu.style.left = "";
    menu.style.top = "";
  }
}

function hideMenu(event) {
  const menu = document.getElementById("menu");
  if (menu.classList.contains("hidden")) return;
  if (event && event.target && event.target.closest && event.target.closest("#menu")) return;
  menu.classList.add("hidden");
  menu.classList.remove("dropdown", "sheet");
}

// ---- Preview / details / share -------------------------------------------------

function isTextType(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ["txt", "md", "json", "xml", "csv", "yaml", "yml", "log", "js", "mjs", "css", "html", "htm", "toml", "ini", "conf", "sh", "py"].includes(ext);
}

async function previewItem(item) {
  const url = api.fileUrl(item.path);
  const extension = item.name.slice(item.name.lastIndexOf(".") + 1).toLowerCase();
  const image = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"].includes(extension);
  const video = ["mp4", "webm", "mov", "m4v"].includes(extension);
  const audio = ["mp3", "wav", "ogg", "m4a", "flac"].includes(extension);

  const modal = showModal({
    title: item.name,
    wide: true,
    actions: [{ label: "下载", kind: "primary", onClick: () => { location.href = api.downloadUrl(item.path); } }],
  });
  const body = modal.root.querySelector(".modal-body");
  body.innerHTML = "";
  const loading = el("div", "preview-loading");
  loading.innerHTML = '<span class="spinner"></span>';
  body.append(loading);

  try {
    if (image) {
      body.innerHTML = "";
      const imageNode = el("img", "preview-media");
      imageNode.src = url;
      imageNode.alt = item.name;
      body.append(imageNode);
    } else if (video) {
      body.innerHTML = "";
      const videoNode = el("video", "preview-media");
      videoNode.src = url;
      videoNode.controls = true;
      videoNode.preload = "metadata";
      body.append(videoNode);
    } else if (audio) {
      body.innerHTML = "";
      const audioNode = el("audio", "preview-audio");
      audioNode.src = url;
      audioNode.controls = true;
      body.append(audioNode);
    } else if (extension === "pdf") {
      body.innerHTML = "";
      const frame = el("iframe", "preview-frame");
      frame.src = url;
      body.append(frame);
    } else if (isTextType(item.name)) {
      if (item.size > 2 * 1024 * 1024) {
        body.innerHTML = "";
        body.append(el("p", "confirm-message", "文本文件超过 2 MiB，建议直接下载查看。"));
      } else {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new ApiError("HTTP " + response.status, response.status);
        const text = await response.text();
        body.innerHTML = "";
        const pre = el("pre", "preview-text");
        pre.textContent = text.length ? text : "（空文件）";
        body.append(pre);
      }
    } else {
      body.innerHTML = "";
      body.append(el("p", "confirm-message", "该类型暂不支持在线预览，可下载后查看。"));
    }
  } catch (error) {
    body.innerHTML = "";
    body.append(el("p", "confirm-message", "预览加载失败：" + error.message));
  }
  void loading;
}

async function showDetails(item) {
  showModal({
    title: "详情",
    build: (container) => {
      const rows = [
        ["名称", item.name],
        ["类型", item.type === "directory" ? "文件夹" : (item.contentType || "未知")],
        ["位置", "/" + (item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "")],
        ["大小", item.type === "directory" ? "—" : fmtSize(item.size)],
        ["修改时间", fmtDate(item.uploaded)],
        ["ETag", item.etag || "—"],
      ];
      for (const [key, value] of rows) {
        const row = el("div", "kv");
        row.append(el("span", null, key));
        const code = el("code", null, String(value));
        code.title = String(value);
        row.append(code);
        container.append(row);
      }
    },
    actions: item.type === "file"
      ? [{ label: "下载", kind: "primary", onClick: () => { location.href = api.downloadUrl(item.path); } }]
      : [],
  });
}

async function shareItem(item) {
  let expiryChoice = "86400";
  const modal = showModal({
    title: "生成分享链接",
    build: (container) => {
      const field = el("label", "field");
      field.append(el("span", null, "有效期"));
      const select = el("select", "input");
      [["3600", "1 小时"], ["86400", "24 小时"], ["604800", "7 天"]].forEach(([value, label]) => {
        const option = el("option", null, label);
        option.value = value;
        if (value === expiryChoice) option.selected = true;
        select.append(option);
      });
      select.addEventListener("change", () => { expiryChoice = select.value; });
      field.append(select);
      const result = el("div", "share-result hidden");
      const link = el("input", "input");
      link.readOnly = true;
      const copy = el("button", "btn ghost sm", "复制");
      copy.addEventListener("click", () => void copyText(link.value));
      result.append(link, copy);
      container.append(field, result);
      container.dataset.result = "1";
    },
    actions: [
      { label: "取消", onClick: () => closeModal() },
      {
        label: "生成链接",
        kind: "primary",
        onClick: async (close, box) => {
          const generateButton = box.querySelector(".modal-foot .btn.primary");
          generateButton.disabled = true;
          generateButton.classList.add("busy");
          try {
            const data = await api.share(item.path, Number(expiryChoice));
            const link = box.querySelector(".share-result input");
            const resultBox = box.querySelector(".share-result");
            link.value = data.url;
            resultBox.classList.remove("hidden");
            box.querySelector(".modal-foot").remove();
            const note = el("p", "field-hint", "过期时间：" + fmtDate(data.expiresAt) + "。任何拿到链接的人都可以在此时间前访问该文件。");
            box.querySelector(".modal-body").append(note);
            await copyText(data.url);
          } catch (error) {
            generateButton.disabled = false;
            generateButton.classList.remove("busy");
            if (!error.isAuth) toast("生成失败：" + error.message, "error");
          }
        },
      },
    ],
  });
  void modal;
}
