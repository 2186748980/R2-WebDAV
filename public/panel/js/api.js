// API layer. All panel requests ride the session cookie set by
// POST /panel/api/session; the password itself is only ever sent once,
// inside the login call, and is never stored by the frontend.

const BASE = "/panel/api";
const SESSION_FLAG = "r2dav.session";

export class ApiError extends Error {
  constructor(message, status = 0, isAuth = false) {
    super(message);
    this.status = status;
    this.isAuth = isAuth;
  }
}

let unauthorizedHandler = null;
export function onUnauthorized(handler) { unauthorizedHandler = handler; }

export function hasSession() { return sessionStorage.getItem(SESSION_FLAG) === "1"; }
export function markSession() { sessionStorage.setItem(SESSION_FLAG, "1"); }
export function clearSession() { sessionStorage.removeItem(SESSION_FLAG); }

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function parseError(response) {
  let message = "HTTP " + response.status;
  try {
    const data = await response.json();
    if (data && data.error) message = data.error;
  } catch { /* plain-text body */ }
  return message;
}

async function request(path, { method = "GET", body, headers = {}, auth, json } = {}) {
  const finalHeaders = { ...headers };
  if (json !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  if (auth) finalHeaders.Authorization = auth;

  let response;
  try {
    response = await fetch(BASE + path, { method, headers: finalHeaders, body, credentials: "same-origin" });
  } catch {
    throw new ApiError("网络错误：无法连接服务器", 0);
  }

  if (response.status === 401) {
    // The login call surfaces its own 401 inline; every other 401 means the
    // session died (e.g. the password was changed) → back to the login view.
    const error = new ApiError(await parseError(response), 401, true);
    if (path !== "/session" && unauthorizedHandler) unauthorizedHandler(error);
    throw error;
  }
  if (!response.ok) throw new ApiError(await parseError(response), response.status);

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  return "?" + search.toString();
}

export const api = {
  login: (username, password) =>
    request("/session", { method: "POST", auth: "Basic " + base64Utf8(username + ":" + password) }),
  logout: () => request("/session", { method: "DELETE" }),
  sessionInfo: () => request("/session"),
  config: () => request("/config"),
  stats: () => request("/stats"),
  health: () => request("/health"),
  list: (path, cursor) => request("/list" + query({ path, limit: 200, cursor })),
  search: (path, q) => request("/search" + query({ path, q })),
  action: (payload) => request("/action", { method: "POST", json: payload }),
  share: (path, expiresIn) => request("/share", { method: "POST", json: { path, expiresIn } }),
  fileUrl: (path) => BASE + "/file" + query({ path }),
  downloadUrl: (path) => BASE + "/download" + query({ path }),
  uploadUrl: (path) => BASE + "/upload" + query({ path }),
  multipartCreate: (path, contentType) =>
    request("/upload/multipart", { method: "POST", json: { path, contentType } }),
  multipartAbort: (path, uploadId) =>
    request("/upload/multipart" + query({ path, uploadId }), { method: "DELETE" }),
  multipartPartUrl: (path, uploadId, partNumber) =>
    BASE + "/upload/multipart/part" + query({ path, uploadId, partNumber }),
  multipartComplete: (path, uploadId, parts) =>
    request("/upload/multipart/complete" + query({ path, uploadId }), { method: "POST", json: { parts } }),
};
