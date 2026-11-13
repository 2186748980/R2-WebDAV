// Per-item actions that open overlays: download, preview (image lightbox /
// video / audio / PDF / text), the details drawer, and the share dialog.
// Split out of files.js so the listing module only handles listing.

import { api, ApiError } from "./api.js";
import { icon } from "./icons.js";
import { el, fmtSize, fmtDate, toast, copyText } from "./ui.js";
import { showModal, closeModal, showDrawer } from "./dialogs.js";

// ---- Download ----------------------------------------------------------------

// Download with real feedback: fetch the object, report success or the exact
// failure, then hand the blob to the browser. Oversized files skip the blob
// (memory) and fall back to a plain navigation download.
const DOWNLOAD_BLOB_LIMIT = 512 * 1024 * 1024;

export async function downloadFile(item) {
  if (item.type !== "file") return;
  const url = api.downloadUrl(item.path);
  if (item.size > DOWNLOAD_BLOB_LIMIT) {
    toast(`“${item.name}” 较大，已交由浏览器直接下载`, "info");
    location.href = url;
    return;
  }
  toast(`开始下载 “${item.name}”`, "info");
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (response.status === 401) {
      toast("登录状态已失效，请重新登录后再下载", "error");
      return;
    }
    if (!response.ok) {
      const reason = { 403: "没有下载权限", 404: "文件可能已被删除或改名" }[response.status] || "HTTP " + response.status;
      throw new ApiError(reason, response.status);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = el("a");
    link.href = objectUrl;
    link.download = item.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    toast(`已下载 “${item.name}”`, "ok");
  } catch (error) {
    if (!error.isAuth) toast(`下载失败：${error.message || "网络错误"}`, "error");
  }
}

// ---- Type helpers --------------------------------------------------------------

export function isImageType(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"].includes(ext);
}

function isTextType(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ["txt", "md", "json", "xml", "csv", "yaml", "yml", "log", "js", "mjs", "css", "html", "htm", "toml", "ini", "conf", "sh", "py"].includes(ext);
}

// ---- Preview -------------------------------------------------------------------

// Preview dialog doubles as an image lightbox: with sibling images passed in,
// arrow buttons and ArrowLeft/ArrowRight step through them in place.
export function previewItem(item, siblings = null) {
  const list = siblings && siblings.length ? siblings : [item];
  let index = Math.max(0, list.findIndex((node) => node.path === item.path));
  // iPads report as Macintosh with touch; iPhones/iPads cannot render PDF
  // inside an iframe, so offer a download instead of a blank viewer.
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const modal = showModal({
    title: item.name,
    wide: true,
    actions: [{ label: "下载", kind: "primary", onClick: () => void downloadFile(item) }],
    onClose: () => document.removeEventListener("keydown", keyNav),
  });
  const body = modal.root.querySelector(".modal-body");
  body.innerHTML = "";
  const loading = el("div", "preview-loading");
  loading.innerHTML = '<span class="spinner"></span>';

  const goTo = (delta) => {
    index = (index + delta + list.length) % list.length;
    renderInto(list[index]);
  };
  const keyNav = (event) => {
    if (list.length < 2) return;
    if (event.key === "ArrowLeft") goTo(-1);
    if (event.key === "ArrowRight") goTo(1);
  };
  document.addEventListener("keydown", keyNav);

  if (list.length > 1) {
    const nav = el("div", "preview-nav");
    const prev = el("button", "icon-btn");
    prev.innerHTML = icon("chevron-left", 18);
    prev.title = "上一张";
    prev.setAttribute("aria-label", "上一张");
    prev.addEventListener("click", () => goTo(-1));
    const counter = el("span", "preview-counter");
    const next = el("button", "icon-btn");
    next.innerHTML = icon("chevron-right", 18);
    next.title = "下一张";
    next.setAttribute("aria-label", "下一张");
    next.addEventListener("click", () => goTo(1));
    nav.append(prev, counter, next);
    body.append(nav);
  }
  const stage = el("div", "preview-stage");
  body.append(stage);
  const counterNode = body.querySelector(".preview-counter");
  // Per-file meta line (size · modified) under the lightbox nav.
  const metaNode = el("div", "preview-meta hidden");
  body.append(metaNode);

  const renderInto = (target) => {
    modal.root.querySelector(".modal-head h3").textContent = target.name;
    if (counterNode) counterNode.textContent = `${index + 1} / ${list.length}`;
    metaNode.textContent = `${fmtSize(target.size)} · ${fmtDate(target.uploaded)}`;
    metaNode.classList.remove("hidden");
    stage.innerHTML = "";
    stage.append(loading);
    const url = api.fileUrl(target.path);
    const extension = target.name.slice(target.name.lastIndexOf(".") + 1).toLowerCase();

    if (isImageType(target.name)) {
      const imageNode = el("img", "preview-media");
      imageNode.alt = target.name;
      imageNode.onerror = () => {
        stage.innerHTML = "";
        // The dialog footer already carries the download action; keep the
        // body to a single friendly explanation.
        stage.append(el("p", "confirm-message", "图片加载失败：文件可能已被删除、改名或损坏，可尝试下载后查看。"));
      };
      imageNode.src = url;
      stage.innerHTML = "";
      stage.append(imageNode);
    } else if (["mp4", "webm", "mov", "m4v"].includes(extension)) {
      const videoNode = el("video", "preview-media");
      videoNode.src = url;
      videoNode.controls = true;
      videoNode.preload = "metadata";
      stage.innerHTML = "";
      stage.append(videoNode);
    } else if (["mp3", "wav", "ogg", "m4a", "flac"].includes(extension)) {
      const audioNode = el("audio", "preview-audio");
      audioNode.src = url;
      audioNode.controls = true;
      stage.innerHTML = "";
      stage.append(audioNode);
    } else if (extension === "pdf") {
      if (isIOS) {
        stage.innerHTML = "";
        stage.append(el("p", "confirm-message", "iOS 浏览器不支持在页面内预览 PDF，请点击下方“下载”后查看。"));
      } else {
        const frame = el("iframe", "preview-frame");
        frame.src = url;
        frame.title = target.name;
        stage.innerHTML = "";
        stage.append(frame);
      }
    } else if (isTextType(target.name)) {
      if (target.size > 2 * 1024 * 1024) {
        stage.innerHTML = "";
        stage.append(el("p", "confirm-message", "文本文件超过 2 MiB，建议直接下载查看。"));
      } else {
        fetch(url, { credentials: "same-origin" })
          .then(async (response) => {
            if (!response.ok) throw new ApiError("HTTP " + response.status, response.status);
            const text = await response.text();
            stage.innerHTML = "";
            const pre = el("pre", "preview-text");
            pre.textContent = text.length ? text : "（空文件）";
            stage.append(pre);
          })
          .catch((error) => {
            stage.innerHTML = "";
            stage.append(el("p", "confirm-message", "预览加载失败：" + (error.message || "网络错误")));
          });
      }
    } else {
      stage.innerHTML = "";
      stage.append(el("p", "confirm-message", "该类型暂不支持在线预览，可下载后查看。"));
    }
  };

  renderInto(list[index]);
}

// ---- Details drawer -------------------------------------------------------------

export function showDetails(item) {
  // Right-side drawer instead of a centered dialog: the list stays visible
  // beside the details per the design spec's dashboard interaction pattern.
  showDrawer({
    title: "详情",
    build: (container) => {
      const rows = [
        ["名称", item.name],
        ["类型", item.type === "directory" ? "文件夹" : "文件"],
        ["位置", "/" + (item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "")],
        ["大小", item.type === "directory" ? "—" : fmtSize(item.size)],
        ["修改时间", fmtDate(item.uploaded)],
      ];
      for (const [key, value] of rows) {
        const row = el("div", "kv");
        row.append(el("span", null, key));
        const code = el("code", null, String(value));
        code.title = String(value);
        row.append(code);
        container.append(row);
      }
      // Raw object metadata only matters when debugging; keep it collapsed.
      const advanced = el("details", "adv-details");
      advanced.append(el("summary", null, "高级信息"));
      const contentType = el("div", "kv");
      contentType.append(el("span", null, "Content-Type"));
      contentType.append(el("code", null, item.contentType || "未知"));
      const etag = el("div", "kv");
      etag.append(el("span", null, "ETag"));
      etag.append(el("code", null, item.etag || "—"));
      advanced.append(contentType, etag);
      container.append(advanced);
    },
    actions: item.type === "file"
      ? [
          { label: "生成分享链接", onClick: () => void shareItem(item) },
          { label: "下载", kind: "primary", onClick: () => void downloadFile(item) },
        ]
      : [],
  });
}

// ---- Share ----------------------------------------------------------------------

export async function shareItem(item) {
  let expiryChoice = "86400";
  showModal({
    title: "分享 “" + item.name + "”",
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
      link.setAttribute("aria-label", "分享链接");
      link.setAttribute("readonly", "");
      const copy = el("button", "btn ghost sm", "复制");
      copy.addEventListener("click", () => void copyText(link.value));
      result.append(link, copy);
      container.append(field, result);
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
}
