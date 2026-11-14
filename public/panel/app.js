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
  const dark = resolvedTheme() === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // Address-bar / status-bar tint follows the active theme.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1116" : "#f4f6f8");
  document.getElementById("themeBtn").innerHTML = icon(dark ? "sun" : "moon", 18);
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

// Login password reveal — same pattern as the credentials card.
const loginPassInput = document.getElementById("loginPass");
const revealButton = document.getElementById("revealPass");
revealButton.addEventListener("click", () => {
  const reveal = loginPassInput.type === "password";
  loginPassInput.type = reveal ? "text" : "password";
  revealButton.setAttribute("aria-pressed", String(reveal));
  revealButton.setAttribute("aria-label", reveal ? "隐藏密码" : "显示密码");
  revealButton.innerHTML = icon(reveal ? "eye-off" : "eye", 18);
});

// Per-field inline validation slots (P1-5): mark the exact empty field
// instead of one generic message; .input.invalid adds the shake + red border.
function loginFieldError(input, message) {
  const slot = input.closest(".field")?.querySelector(".field-error");
  if (!slot) return;
  if (message) {
    slot.textContent = message;
    slot.classList.remove("hidden");
    input.classList.add("invalid");
  } else {
    slot.classList.add("hidden");
    input.classList.remove("invalid");
  }
}

// enterkeyhint="next" only changes the key label — the jump is ours to do.
document.getElementById("loginUser").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loginPassInput.focus();
  }
});

// Soft keyboards park the submit button off-screen on small phones; pull it
// back into view whenever a login field gains focus (P0-5).
document.getElementById("loginForm").addEventListener("focusin", () => {
  document.getElementById("loginSubmit").scrollIntoView({ block: "nearest" });
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  // No `booting` guard here: that flag only marks one-time module init and
  // stays true after logout, which would silently swallow every subsequent
  // login submit. Double-submit is already covered by disabling the button.
  const userInput = document.getElementById("loginUser");
  const username = userInput.value.trim();
  const password = loginPassInput.value;
  const error = document.getElementById("loginError");
  const submit = document.getElementById("loginSubmit");
  loginFieldError(userInput, null);
  loginFieldError(loginPassInput, null);
  if (!username && !password) {
    error.textContent = "请输入用户名和密码";
    error.classList.remove("hidden");
    return;
  }
  if (!username) { loginFieldError(userInput, "请输入用户名"); return; }
  if (!password) { loginFieldError(loginPassInput, "请输入密码"); return; }
  error.classList.add("hidden");
  submit.disabled = true;
  submit.classList.add("busy");
  submit.textContent = "登录中…";
  try {
    await api.login(username, password);
    rememberPassword(password);
    markSession();
    error.classList.add("hidden");
    loginPassInput.value = "";
    loginPassInput.type = "password";
    revealButton.setAttribute("aria-pressed", "false");
    revealButton.setAttribute("aria-label", "显示密码");
    revealButton.innerHTML = icon("eye", 18);
    await enterApp();
  } catch (err) {
    error.textContent = err.status === 401 ? "用户名或密码错误" : (err.message || "登录失败");
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.classList.remove("busy");
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
  overview: { title: "概览" },
  files: { title: "文件" },
  webdav: { title: "WebDAV" },
  settings: { title: "设置" },
};

function setView(name) {
  const view = VIEWS[name] ? name : "overview";
  document.querySelectorAll(".view").forEach((node) => node.classList.add("hidden"));
  document.getElementById("view-" + view).classList.remove("hidden");
  document.getElementById("pageTitle").textContent = VIEWS[view].title;
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
  // Close the mobile drawer even when the hash does not change — re-tapping
  // the active nav item fires no hashchange, and the drawer must not stick.
  closeSidebar();
  if (location.hash.slice(1) !== item.dataset.nav) location.hash = item.dataset.nav;
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
    // Free-tier capacity band. R2 exposes no quota API on this plan, so the
    // bar is informational and clamps at 100% past 10 GB.
    document.getElementById("statsScope").textContent = stats.truncated ? "部分统计（前 5000 个对象）" : "已统计整个存储桶";
    document.getElementById("statsScope").className = "badge" + (stats.truncated ? " warn" : "");
    const fill = document.getElementById("storageFill");
    if (fill) fill.style.width = Math.min(100, (stats.bytes / (10 * 1024 ** 3)) * 100).toFixed(2) + "%";
    const notes = [];
    if (stats.truncated) notes.push("对象较多，仅统计了前 5000 个");
    if (stats.bytes >= 10 * 1024 ** 3) notes.push("已超出 10 GB 展示额度，进度条按 100% 封顶");
    document.getElementById("statsNote").textContent = notes.join("；");
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
  // Refresh means the current view: files list when files is open, otherwise
  // the view's own data (overview stats / WebDAV config) — never a no-op.
  const view = location.hash.slice(1) || "overview";
  if (view === "files" || isActive()) void refreshIfCurrent();
  else if (view === "webdav") void loadWebdav();
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
