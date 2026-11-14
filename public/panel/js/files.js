// Files view: listing, breadcrumb, sorting/filter/search, selection and
// batch bar, the row action menu, and the preview / details / share dialogs.

import { api, ApiError, friendlyMessage } from "./api.js";
import { icon, iconForItem } from "./icons.js";
import { el, fmtSize, fmtDate, fmtShortDate, toast, copyText } from "./ui.js";
import { formDialog, confirmDialog, showDrawer } from "./dialogs.js";
import { downloadFile, previewItem, showDetails, shareItem, isImageType } from "./item-actions.js";
import { openUploadPicker } from "./uploads.js";

const state = {
  path: "",
  items: [],
  cursor: null,
  filter: "",
  sort: "name",
  sortDir: 1,
  view: localStorage.getItem("r2dav.view") || "list",
  global: false,
  loading: false,
  searching: false,
  error: null,
  selected: new Set(),
  active: false,
};

const SORT_DEFAULT_DIR = { name: 1, size: -1, date: -1 };

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
    state.sortDir = SORT_DEFAULT_DIR[state.sort];
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
    if (state.sort === column.dataset.sort) state.sortDir *= -1;
    else {
      state.sort = column.dataset.sort;
      state.sortDir = SORT_DEFAULT_DIR[state.sort];
      document.getElementById("sortSelect").value = state.sort;
    }
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

  // Ctrl/Cmd+A selects everything currently visible — but never steal the
  // shortcut while the user is typing in a field or a dialog is open.
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== "a") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!state.active || document.getElementById("modal")?.querySelector(".modal-box")) return;
    if (!visibleItems().length) return;
    event.preventDefault();
    visibleItems().forEach((item) => state.selected.add(item.path));
    render();
  });
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
  state.searching = false;
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
  } else {
    nodes.loadMore.disabled = true;
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
  } finally {
    nodes.loadMore.disabled = false;
  }
}

function visibleItems() {
  const needle = state.filter.toLowerCase();
  const filtered = needle ? state.items.filter((item) => item.name.toLowerCase().includes(needle)) : [...state.items];
  const base = {
    name: (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    date: (a, b) => new Date(a.uploaded || 0) - new Date(b.uploaded || 0),
  }[state.sort];
  return filtered.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return base(a, b) * state.sortDir;
  });
}

function render() {
  document.getElementById("viewToggle").querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.view);
  });
  renderBreadcrumb();
  // The state container only ever shows one message: hide it on every pass
  // and let renderMessage bring it back, so stale empty/error states never
  // linger next to a populated list.
  nodes.state.classList.add("hidden");
  const shown = visibleItems();
  document.getElementById("itemSummary").textContent = state.loading || state.searching
    ? ""
    : state.filter && !state.global
      ? `匹配 ${shown.length} / 已加载 ${state.items.length} 项${state.cursor ? "（还有更多）" : ""}`
      : `已加载 ${state.items.length} 项${state.cursor ? "（还有更多）" : ""}${state.global ? " · 全局搜索" : ""}`;
  nodes.list.className = "file-list " + state.view;
  nodes.list.innerHTML = "";
  renderHead();

  const allVisibleSelected = shown.length > 0 && shown.every((item) => state.selected.has(item.path));
  const selectAll = document.getElementById("selectAll");
  selectAll.checked = allVisibleSelected;
  selectAll.indeterminate = shown.some((item) => state.selected.has(item.path)) && !allVisibleSelected;

  if (state.loading || state.searching) {
    renderSkeleton();
  } else if (state.error) {
    renderMessage("alert", "目录加载失败：" + state.error, [
      { label: "重试", kind: "primary", onClick: () => void openPath(state.path) },
    ]);
  } else if (!shown.length) {
    if (state.global) {
      renderMessage("search", "没有匹配 “" + state.filter + "” 的结果", [
        { label: "清除搜索", onClick: clearSearch },
      ], "搜索范围是当前目录及其子目录，可尝试更短的关键词");
    } else if (state.filter) {
      renderMessage("search", "当前目录没有匹配项", [
        { label: "清除筛选", onClick: clearSearch },
      ], "检查筛选词是否有拼写差异，或清除筛选查看全部");
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
    const sorted = column.dataset.sort === state.sort;
    column.classList.toggle("sorted", sorted);
    column.querySelector(".sort-ind").textContent = sorted ? (state.sortDir === 1 ? "↑" : "↓") : "";
  });
}

function renderSkeleton() {
  for (let index = 0; index < 8; index += 1) {
    nodes.list.append(el("div", "skeleton-row"));
  }
}

function renderMessage(glyph, text, actions = [], hint = "") {
  const box = el("div", "list-message");
  const glyphNode = el("div", "message-icon");
  glyphNode.innerHTML = icon(glyph, 34);
  box.append(glyphNode, el("p", null, text));
  if (hint) box.append(el("p", "message-hint", hint));
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
  check.setAttribute("aria-label", "选择 " + item.name);
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
  name.title = item.path + (item.uploaded ? " · 修改于 " + fmtDate(item.uploaded) : "");
  const meta = el("div", "grid-meta", item.type === "directory" ? "文件夹" : fmtSize(item.size));
  card.append(glyph, name, meta);
  if (item.type === "file") {
    card.append(el("div", "grid-date", fmtShortDate(item.uploaded)));
  }

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
  else void previewItem(item, imageSiblings(item));
}

// Sibling images in the current listing, for lightbox prev/next navigation.
function imageSiblings(item) {
  if (item.type !== "file" || !isImageType(item.name)) return null;
  const images = visibleItems().filter((node) => node.type === "file" && isImageType(node.name));
  return images.length > 1 ? images : null;
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
  // A global search REPLACES state.items with its results, so clearing it
  // must reload the real directory — re-rendering would present stale search
  // results (or an empty set) as the listing ("已加载 0 项" on a full folder).
  // A plain per-directory filter only narrows the loaded items: re-render.
  if (state.global) {
    void openPath(state.path);
    return;
  }
  state.filter = "";
  document.getElementById("searchInput").value = "";
  nodes.hint.classList.add("hidden");
  render();
}

async function runGlobalSearch(query) {
  if (!query) { clearSearch(); return; }
  state.searching = true;
  state.error = null;
  render();
  nodes.hint.classList.remove("hidden");
  nodes.hint.innerHTML = "";
  nodes.hint.append(el("span", null, `正在全局搜索 “${query}”…`));
  try {
    const data = await api.search(state.path, query);
    state.searching = false;
    state.global = true;
    state.filter = query;
    state.items = data.items;
    state.cursor = null;
    state.selected.clear();
    nodes.hint.innerHTML = "";
    const text = el("span", null, `全局搜索 “${query}” · ${data.items.length} 个结果` + (data.truncated ? "（已截断）" : ""));
    const clear = el("button", "btn ghost sm", "清除");
    clear.addEventListener("click", () => void openPath(state.path));
    nodes.hint.append(text, clear);
    render();
  } catch (error) {
    state.searching = false;
    nodes.hint.classList.add("hidden");
    if (!error.isAuth) {
      toast("搜索失败：" + friendlyMessage(error.message), "error", {
        action: { label: "重试", onClick: () => void runGlobalSearch(query) },
      });
    }
    render();
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

// Single files up to this size keep a local copy for the undo window; larger
// files and directories cannot be restored client-side, so they keep the
// explicit confirmation dialog instead of undo.
const UNDO_CACHE_LIMIT = 25 * 1024 * 1024;
const UNDO_WINDOW_MS = 5000;

async function deleteItem(item) {
  if (item.type === "file" && (item.size || 0) <= UNDO_CACHE_LIMIT) {
    await deleteFileWithUndo(item);
    return;
  }
  const confirmed = await confirmDialog({
    title: "删除 " + item.name,
    message: item.type === "directory"
      ? "文件夹 “" + item.name + "” 及其内部全部内容将被立即删除，此操作不可恢复。"
      : "文件 “" + item.name + "” 较大，删除后无法在页面内撤销，此操作不可恢复。",
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

// Delete with a 5-second undo toast instead of a second confirmation: the
// content is cached before the DELETE, and undo PUTs it back byte-for-byte.
// Restore re-stamps the upload time (R2 stores no original mtime) — the
// object name, content and content type all come back unchanged.
async function deleteFileWithUndo(item) {
  let cached = null;
  try {
    const response = await fetch(api.fileUrl(item.path), { credentials: "same-origin" });
    if (response.ok) {
      cached = {
        blob: await response.blob(),
        type: response.headers.get("Content-Type") || item.contentType || "application/octet-stream",
      };
    }
  } catch { /* cache is best-effort; deletion proceeds without undo */ }

  try {
    await api.action({ action: "delete", source: item.path });
  } catch (error) {
    if (!error.isAuth) toast(`删除失败：${error.message}`, "error");
    return;
  }
  state.selected.delete(item.path);
  await openPath(state.path);

  const undo = async () => {
    try {
      const response = await fetch(api.uploadUrl(item.path), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": cached.type },
        body: cached.blob,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      toast(`已恢复 “${item.name}”`, "ok");
      await openPath(state.path);
    } catch {
      toast("恢复失败：网络错误或同名文件已存在", "error");
    }
  };
  if (cached) {
    toast(`已删除 “${item.name}”`, "ok", { action: { label: "撤销", onClick: () => void undo() }, duration: UNDO_WINDOW_MS });
  } else {
    toast(`已删除 “${item.name}”`, "ok");
  }
}

function setBatchBarBusy(busy) {
  nodes.batch.querySelectorAll(".btn").forEach((button) => { button.disabled = busy; });
}

async function batchDelete() {
  if (!state.selected.size) return;
  const count = state.selected.size;
  const paths = [...state.selected];
  // Delete confirmation carries the actual targets: folder names expand to
  // everything inside them, so the dialog states the real blast radius.
  const preview = paths.slice(0, 3).map((p) => "“" + p.split("/").pop() + "”").join("、");
  const confirmed = await confirmDialog({
    title: "删除 " + count + " 项",
    message: count + " 个文件/文件夹（含内部内容）将被立即删除，此操作不可恢复。",
    detail: "将删除：" + preview + (count > 3 ? " 等 " + count + " 项" : ""),
    confirmLabel: "全部删除",
    confirmAsync: async (report) => {
      setBatchBarBusy(true);
      try {
        let failed = 0;
        let index = 0;
        for (const path of paths) {
          index += 1;
          report(`处理中 ${index}/${paths.length}`);
          try {
            await api.action({ action: "delete", source: path });
            state.selected.delete(path);
          } catch {
            failed += 1;
          }
        }
        if (failed) throw new ApiError(`${failed} 项删除失败，其余已完成`, 0);
        await openPath(state.path);
      } finally {
        setBatchBarBusy(false);
      }
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
    submitAsync: async (value, report) => {
      setBatchBarBusy(true);
      try {
        const prefix = value ? value.replace(/^\/+|\/+$/g, "") + "/" : "";
        const paths = [...state.selected];
        let failed = 0;
        let index = 0;
        for (const path of paths) {
          index += 1;
          report(`处理中 ${index}/${paths.length}`);
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
      } finally {
        setBatchBarBusy(false);
      }
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
    entry.setAttribute("role", "menuitem");
    entry.innerHTML = icon(glyph, 16);
    entry.append(el("span", null, label));
    entry.addEventListener("click", () => { hideMenu(); handler(); });
    menu.append(entry);
  };

  if (item.type === "directory") {
    add("folder", "打开", () => void openPath(item.path));
  } else {
    add("eye", "预览", () => void previewItem(item, imageSiblings(item)));
    add("download", "下载", () => void downloadFile(item));
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

