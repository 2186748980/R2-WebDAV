// Panel entry point: boot, authentication, navigation, theme, and the
// overview / WebDAV / settings views. Files and uploads live in their own
// modules; everything here only orchestrates.

import { api, ApiError, hasSession, markSession, clearSession, onUnauthorized, rememberPassword, forgetPassword, getRememberedPassword } from "./js/api.js";
import { icon } from "./js/icons.js";
import { toast, copyText, fmtSize } from "./js/ui.js";
import { initFiles, currentPath, currentDirItemNames, isActive, refreshIfCurrent, setActive } from "./js/files.js";
import { initUploads } from "./js/uploads.js";

// ---- Icon hydration for static markup -------------------------------------

document.querySelectorAll("[data-icon]").forEach((node) => {
  node.innerHTML = icon(node.dataset.icon, 18);
});

// ---- Theme -----------------------------------------------------------------

const THEME_KEY = "r2dav.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolvedTheme() {
  const setting = localStorage.getItem(THEME_KEY) || "auto";
  if (setting === "auto") return media.matches ? "dark" : "light";
  return setting;
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.getElementById("themeBtn").innerHTML = icon(resolvedTheme() === "dark" ? "sun" : "moon", 18);
  document.querySelectorAll("#themeSeg [data-theme-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeMode === (localStorage.getItem(THEME_KEY) || "auto"));
  });
}

function setThemeSetting(value) {
  localStorage.setItem(THEME_KEY, value);
  applyTheme();
}

media.addEventListener("change", () => {
  if ((localStorage.getItem(THEME_KEY) || "auto") === "auto") applyTheme();
});
document.getElementById("themeBtn").addEventListener("click", () => {
  setThemeSetting(resolvedTheme() === "dark" ? "light" : "dark");
});
document.getElementById("themeSeg").addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-mode]");
  if (button) setThemeSetting(button.dataset.themeMode);
});
applyTheme();

// ---- Authentication --------------------------------------------------------

const loginSection = document.getElementById("login");
const appSection = document.getElementById("app");
let booting = false;

function showLogin(message) {
  appSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
  const error = document.getElementById("loginError");
  if (message) {
    error.textContent = message;
    error.classList.remove("hidden");
  } else {
    error.classList.add("hidden");
  }
  clearSession();
  document.getElementById("loginUser").focus();
}

function showApp() {
  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
}

onUnauthorized(() => {
  clearSession();
  forgetPassword();
  if (!loginSection.classList.contains("hidden")) return;
  showLogin("会话已失效，请重新登录");
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (booting) return;
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;
  const error = document.getElementById("loginError");
  const submit = document.getElementById("loginSubmit");
  if (!username || !password) {
    error.textContent = "请输入用户名和密码";
    error.classList.remove("hidden");
    return;
  }
  submit.disabled = true;
  submit.textContent = "登录中…";
  try {
    await api.login(username, password);
    rememberPassword(password);
    markSession();
    error.classList.add("hidden");
    document.getElementById("loginPass").value = "";
    await enterApp();
  } catch (err) {
    error.textContent = err.status === 401 ? "用户名或密码错误" : (err.message || "登录失败");
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "登 录";
  }
});

async function logout() {
  try { await api.logout(); } catch { /* the cookie disappears regardless */ }
  clearSession();
  forgetPassword();
  passwordVisible = false;
  showLogin();
}

document.getElementById("logoutBtn").addEventListener("click", () => void logout());
document.getElementById("logoutBtn2").addEventListener("click", () => void logout());

// ---- Navigation ------------------------------------------------------------

const VIEWS = {
  overview: { title: "概览", eyebrow: "OVERVIEW" },
  files: { title: "文件", eyebrow: "FILES" },
  webdav: { title: "WebDAV", eyebrow: "WEBDAV" },
  settings: { title: "设置", eyebrow: "SETTINGS" },
};

function setView(name) {
  const view = VIEWS[name] ? name : "overview";
  document.querySelectorAll(".view").forEach((node) => node.classList.add("hidden"));
  document.getElementById("view-" + view).classList.remove("hidden");
  document.getElementById("pageTitle").textContent = VIEWS[view].title;
  document.getElementById("pageEyebrow").textContent = VIEWS[view].eyebrow;
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.nav === view));
  closeSidebar();
  if (view === "files") {
    setActiveFiles();
  } else if (view === "overview") {
    void loadOverview();
  } else if (view === "webdav") {
    void loadWebdav();
  } else if (view === "settings") {
    if (!configCache) void loadOverview();
    else {
      document.getElementById("sessionUser").textContent = configCache.username;
      document.getElementById("credUsername").textContent = configCache.username;
    }
    renderCredentials();
  }
}

function setActiveFiles() {
  setActive(true);
}

window.addEventListener("hashchange", () => setView(location.hash.slice(1) || "overview"));

document.querySelector(".nav").addEventListener("click", (event) => {
  const item = event.target.closest("[data-nav]");
  if (!item) return;
  location.hash = item.dataset.nav;
});

document.addEventListener("click", (event) => {
  const goto = event.target.closest("[data-goto]");
  if (goto) location.hash = goto.dataset.goto;
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    const source = document.getElementById(copy.dataset.copy);
    if (source) void copyText(source.textContent);
  }
});

// ---- Sidebar (mobile drawer) -------------------------------------------------

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("backdrop").classList.remove("show");
}

document.getElementById("menuBtn").addEventListener("click", () => {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("backdrop").classList.add("show");
});
document.getElementById("backdrop").addEventListener("click", closeSidebar);

// ---- Data views ---------------------------------------------------------------

let configCache = null;

async function loadOverview() {
  const tasks = await Promise.allSettled([api.config(), api.stats(), api.health()]);
  const [configResult, statsResult, healthResult] = tasks;

  if (configResult.status === "fulfilled") {
    configCache = configResult.value;
    document.getElementById("serverUrl").textContent = configCache.serverUrl;
    document.getElementById("username").textContent = configCache.username;
    document.getElementById("sessionUser").textContent = configCache.username;
    document.getElementById("credUsername").textContent = configCache.username;
    document.getElementById("settingsUrl").textContent = configCache.serverUrl;
    document.getElementById("statFiles").textContent = configCache.stats?.files ?? "—";
    document.getElementById("statFolders").textContent = configCache.stats?.folders ?? "—";
  }

  if (statsResult.status === "fulfilled") {
    const stats = statsResult.value;
    document.getElementById("statBytes").textContent = fmtSize(stats.bytes) + (stats.truncated ? "+" : "");
    document.getElementById("statFiles").textContent = stats.files + (stats.truncated ? "+" : "");
    document.getElementById("statFolders").textContent = stats.folders + (stats.truncated ? "+" : "");
    document.getElementById("statsNote").textContent = stats.truncated ? "统计扫描了前 5000 个对象" : "已统计整个存储桶";
  } else {
    document.getElementById("statsNote").textContent = "存储统计暂时不可用";
  }

  const health = healthResult.status === "fulfilled" ? healthResult.value : null;
  const dot = document.getElementById("healthDot");
  const text = document.getElementById("healthText");
  const badge = document.getElementById("r2Badge");
  const r2Status = document.getElementById("r2Status");
  if (health?.ok) {
    dot.className = "dot ok";
    text.textContent = "服务运行中";
    badge.textContent = "R2 正常 · " + health.latencyMs + " ms";
    badge.className = "badge ok";
    r2Status.textContent = "已连接";
  } else {
    dot.className = "dot bad";
    text.textContent = "R2 检查失败";
    badge.textContent = "R2 异常";
    badge.className = "badge bad";
    r2Status.textContent = "连接异常";
  }
}

async function loadWebdav() {
  if (!configCache) {
    try { configCache = await api.config(); } catch { /* 401 handled globally */ }
  }
  document.getElementById("davUrl").textContent = configCache?.serverUrl || location.origin + "/";
  document.getElementById("panelUrl").textContent = location.origin + "/panel/";
  document.getElementById("username2").textContent = configCache?.username || "—";
}

document.getElementById("copyConfigBtn").addEventListener("click", () => {
  void copyText(`WebDAV 地址：${document.getElementById("davUrl").textContent}\n用户名：${document.getElementById("username2").textContent}\n密码：（保存在 Worker Secret 中）`);
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  if (location.hash.slice(1) === "files" || isActive()) void refreshIfCurrent();
  else void loadOverview();
});

// ---- Credentials display (settings) ---------------------------------------

let passwordVisible = false;

function renderCredentials() {
  const remembered = getRememberedPassword();
  const code = document.getElementById("credPassword");
  const toggle = document.getElementById("togglePasswordBtn");
  const copyButton = document.getElementById("copyPasswordBtn");
  if (!remembered) {
    code.textContent = "未持有（重新登录后可显示）";
    toggle.classList.add("hidden");
    copyButton.classList.add("hidden");
    return;
  }
  toggle.classList.remove("hidden");
  copyButton.classList.remove("hidden");
  code.textContent = passwordVisible ? remembered : "••••••••";
  toggle.innerHTML = icon(passwordVisible ? "eye-off" : "eye", 15) + (passwordVisible ? "隐藏" : "显示");
}

document.getElementById("togglePasswordBtn").addEventListener("click", () => {
  passwordVisible = !passwordVisible;
  renderCredentials();
});
document.getElementById("copyPasswordBtn").addEventListener("click", () => {
  const remembered = getRememberedPassword();
  if (remembered) void copyText(remembered);
});

// ---- Boot ----------------------------------------------------------------------

async function enterApp() {
  showApp();
  if (!booting) {
    booting = true;
    initFiles();
    initUploads({
      currentPathProvider: currentPath,
      existingNamesProvider: currentDirItemNames,
      onDone: () => { if (location.hash.slice(1) === "files" || isActive()) void refreshIfCurrent(); },
    });
  }
  const hash = location.hash.slice(1);
  setView(VIEWS[hash] ? hash : "overview");
  if (!location.hash) location.hash = "overview";
}

if (hasSession()) {
  // Cookie may still be valid; if not, the first API call flips to login.
  void enterApp().catch((error) => {
    if (error instanceof ApiError && error.isAuth) showLogin();
    else showLogin("无法连接服务器，请稍后重试");
  });
} else {
  showLogin();
}
