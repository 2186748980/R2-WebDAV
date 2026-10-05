import worker from "../src/worker.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const encoder = new TextEncoder();
const PANEL_DIR = fileURLToPath(new URL("../public/panel/", import.meta.url));
const TEST_PASSWORD = "test-only-password";

class MemoryR2 {
  constructor() {
    this.objects = new Map();
    this.uploads = new Map();
    this.sequence = 0;
    this.uploadSequence = 0;
  }

  async put(key, value, options = {}) {
    const bytes = await toBytes(value);
    this.sequence += 1;
    this.objects.set(key, {
      bytes,
      etag: `etag-${this.sequence}`,
      uploaded: new Date("2026-08-22T00:00:00.000Z"),
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    });
    return this.head(key);
  }

  async head(key) {
    const stored = this.objects.get(key);
    return stored ? metadata(key, stored) : null;
  }

  async get(key, options = {}) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    let bytes = stored.bytes;
    if (options.range) {
      const { offset = 0, length } = options.range;
      bytes = bytes.slice(offset, length === undefined ? undefined : offset + length);
    }
    return { ...metadata(key, stored), body: new Response(bytes).body };
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async createMultipartUpload(key, options = {}) {
    const uploadId = "upload-" + (++this.uploadSequence);
    this.uploads.set(uploadId, { key, options, parts: new Map() });
    return { key, uploadId };
  }

  resumeMultipartUpload(key, uploadId) {
    const owner = this;
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new Error("invalid upload");
    return {
      key,
      uploadId,
      async uploadPart(partNumber, value) {
        const bytes = await toBytes(value);
        upload.parts.set(partNumber, bytes);
        return { partNumber, etag: "part-" + partNumber };
      },
      async complete(parts) {
        const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
        const bytes = concatBytes(ordered.map(part => upload.parts.get(part.partNumber)));
        const result = await thisPut(key, bytes, upload.options);
        return { key, httpEtag: result.httpEtag };
      },
      async abort() { owner.uploads.delete(uploadId); },
    };
  }

  async list({ prefix = "", delimiter, cursor, limit = 1000 } = {}) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const objects = [];
    const prefixes = new Set();
    for (const key of keys) {
      const remaining = key.slice(prefix.length);
      if (delimiter && remaining.includes(delimiter)) {
        prefixes.add(`${prefix}${remaining.slice(0, remaining.indexOf(delimiter) + 1)}`);
      } else {
        objects.push(metadata(key, this.objects.get(key)));
      }
    }
    // Real R2 pages objects and common prefixes together in lexicographic
    // order. The mock encodes its opaque cursor as an offset into that stream.
    const entries = [
      ...objects.map((object) => ({ kind: "object", key: object.key, object })),
      ...[...prefixes].sort().map((prefixKey) => ({ kind: "prefix", key: prefixKey })),
    ].sort((a, b) => a.key.localeCompare(b.key));
    const start = cursor ? Number(cursor) : 0;
    const pageEntries = entries.slice(start, start + limit);
    const truncated = start + limit < entries.length;
    return {
      objects: pageEntries.filter((entry) => entry.kind === "object").map((entry) => entry.object),
      delimitedPrefixes: pageEntries.filter((entry) => entry.kind === "prefix").map((entry) => entry.key).sort(),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
    };
  }
}

function concatBytes(chunks) {
  const total = chunks.reduce((n, chunk) => n + chunk.byteLength, 0);
  const out = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

let activeBucket;
async function thisPut(key, bytes, options) {
  await activeBucket.put(key, bytes, options);
  return await activeBucket.head(key);
}

function metadata(key, stored) {
  return {
    key,
    size: stored.bytes.byteLength,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    uploaded: stored.uploaded,
    httpMetadata: stored.httpMetadata,
    customMetadata: stored.customMetadata,
    writeHttpMetadata(headers) {
      if (stored.httpMetadata.contentType) headers.set("Content-Type", stored.httpMetadata.contentType);
    },
  };
}

async function toBytes(value) {
  if (value == null) return new Uint8Array();
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(await new Response(value).arrayBuffer());
}

// Mimics the production Workers Static Assets pipeline with
// html_handling = "none": exact file paths return 200 directly, everything
// else 404, and no canonicalization redirects are ever produced.
class PanelAssets {
  constructor() {
    const types = { "index.html": "text/html; charset=utf-8", "style.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8" };
    this.files = new Map();
    for (const [name, type] of Object.entries(types)) {
      this.files.set(`/panel/${name}`, { body: readFileSync(PANEL_DIR + name, "utf8"), type });
    }
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const file = this.files.get(path);
    if (!file) return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response(file.body, { status: 200, headers: { "Content-Type": file.type } });
  }
}

const bucket = new MemoryR2();
const env = {
  R2_BUCKET: bucket,
  WEBDAV_USERNAME: "backup-user",
  WEBDAV_PASSWORD: TEST_PASSWORD,
  ASSETS: new PanelAssets(),
};
activeBucket = bucket;
const authorization = `Basic ${Buffer.from(`${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`).toString("base64")}`;

async function dav(method, path, { headers = {}, body, authenticated = true } = {}) {
  const requestHeaders = new Headers(headers);
  if (authenticated) requestHeaders.set("Authorization", authorization);
  const request = new Request(`https://dav.example${path}`, { method, headers: requestHeaders, body });
  return worker.fetch(request, env);
}

async function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}: ${await response.text()}`);
  }
}

async function signShare(payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TEST_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64Url(value) {
  return btoa(String.fromCharCode(...encoder.encode(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

let checks = 0;
function ok(condition, label) {
  if (!condition) throw new Error(`assertion failed: ${label}`);
  checks += 1;
}

async function run() {
  // ============================================================
  // Panel entry points — regression for ERR_TOO_MANY_REDIRECTS.
  // /panel, /panel/ and /panel/index.html must all answer 200 with the
  // panel HTML, without any Location redirect, when authenticated.
  // ============================================================
  const panelHtml = env.ASSETS.files.get("/panel/index.html").body;
  for (const entry of ["/panel", "/panel/", "/panel/index.html"]) {
    const response = await dav("GET", entry);
    await expectStatus(response, 200, `panel entry ${entry}`);
    ok(!response.headers.has("Location"), `panel entry ${entry} must not redirect`);
    ok((response.headers.get("Content-Type") || "").includes("text/html"), `panel entry ${entry} content type`);
    ok(response.headers.get("Cache-Control") === "no-store", `panel entry ${entry} no-store`);
    ok((await response.text()) === panelHtml, `panel entry ${entry} serves the real panel HTML`);
  }

  for (const entry of ["/panel", "/panel/", "/panel/index.html"]) {
    const response = await dav("GET", entry, { authenticated: false });
    await expectStatus(response, 401, `anonymous panel entry ${entry}`);
    ok((response.headers.get("WWW-Authenticate") || "").includes("Basic"), `anonymous panel entry ${entry} challenges Basic Auth`);
  }

  let response = await dav("GET", "/panel/style.css");
  await expectStatus(response, 200, "panel stylesheet");
  ok((response.headers.get("Content-Type") || "").includes("text/css"), "panel stylesheet content type");
  ok((await response.text()) === env.ASSETS.files.get("/panel/style.css").body, "panel stylesheet body");

  response = await dav("GET", "/panel/app.js");
  await expectStatus(response, 200, "panel script");
  ok((response.headers.get("Content-Type") || "").includes("javascript"), "panel script content type");
  ok((await response.text()).includes("/panel/api/"), "panel script body");

  response = await dav("GET", "/panel/missing-asset.css");
  await expectStatus(response, 404, "missing panel asset stays 404");

  // ============================================================
  // Panel API
  // ============================================================
  response = await dav("GET", "/panel/api/config");
  await expectStatus(response, 200, "panel config API");
  const panelConfig = await response.json();
  ok(panelConfig.serverUrl === "https://dav.example/", "panel config serverUrl");
  ok(panelConfig.panelUrl === "https://dav.example/panel/", "panel config panelUrl");
  ok(panelConfig.username === env.WEBDAV_USERNAME, "panel config exposes username");
  ok(!JSON.stringify(panelConfig).includes(TEST_PASSWORD), "panel config must never contain the password");
  ok(typeof panelConfig.stats?.files === "number", "panel config stats.files");

  response = await dav("GET", "/panel/api/health");
  await expectStatus(response, 200, "panel health API");
  ok((await response.json()).ok === true, "panel health ok");

  response = await dav("GET", "/panel/api/stats");
  await expectStatus(response, 200, "panel stats API");
  const stats = await response.json();
  ok(typeof stats.files === "number" && typeof stats.bytes === "number", "panel stats shape");

  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mkdir", path: "panel-test" }),
  });
  await expectStatus(response, 201, "panel create directory");

  response = await dav("PUT", "/panel/api/upload?path=panel-test/hello.txt", {
    headers: { "Content-Type": "text/plain" },
    body: "hello panel",
  });
  await expectStatus(response, 201, "panel upload");
  response = await dav("PUT", "/panel/api/upload?path=panel-test/hello.txt", {
    headers: { "Content-Type": "text/plain" },
    body: "hello panel v2",
  });
  await expectStatus(response, 200, "panel upload overwrite");

  response = await dav("PUT", "/panel/api/upload?path=no-such-parent/x.txt", { body: "x" });
  await expectStatus(response, 409, "panel upload rejects missing parent");

  response = await dav("PUT", "/panel/api/upload?path=..%2Fescape.txt", { body: "x" });
  await expectStatus(response, 400, "panel upload rejects path traversal");
  response = await dav("PUT", "/panel/api/upload?path=back%5Cslash.txt", { body: "x" });
  await expectStatus(response, 400, "panel upload rejects backslash path");
  response = await dav("GET", "/panel/api/file?path=%2E%2E%2Fsecret");
  await expectStatus(response, 400, "panel file rejects dot-dot path");
  response = await dav("GET", "/panel/api/search?path=%2E%2E&q=a");
  await expectStatus(response, 400, "panel search rejects dot-dot path");

  response = await dav("GET", "/panel/api/file?path=panel-test/hello.txt");
  await expectStatus(response, 200, "panel preview/read");
  ok((await response.text()) === "hello panel v2", "panel file content");

  response = await dav("GET", "/panel/api/file?path=panel-test");
  await expectStatus(response, 400, "panel file rejects collection");
  response = await dav("GET", "/panel/api/file?path=panel-test/missing.txt");
  await expectStatus(response, 404, "panel file missing object");
  response = await dav("GET", "/panel/api/download?path=panel-test/missing.txt");
  await expectStatus(response, 404, "panel download missing object");

  response = await dav("GET", "/panel/api/download?path=panel-test/hello.txt");
  await expectStatus(response, 200, "panel download");
  ok((response.headers.get("Content-Disposition") || "").includes("attachment"), "panel download forces attachment");
  ok((response.headers.get("Content-Disposition") || "").includes("filename*"), "panel download RFC 5987 filename");

  response = await dav("GET", "/panel/api/list?path=");
  await expectStatus(response, 200, "panel root listing");
  const rootListing = await response.json();
  ok(Array.isArray(rootListing.items), "panel root listing items array");

  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mkdir", path: "panel-test" }),
  });
  await expectStatus(response, 409, "panel mkdir duplicate rejected");
  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mkdir", path: "missing-parent/child" }),
  });
  await expectStatus(response, 409, "panel mkdir rejects missing parent");

  // Delete requires only "source" — destination must be optional.
  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", source: "panel-test/hello.txt" }),
  });
  await expectStatus(response, 200, "panel delete with source only");
  response = await dav("GET", "/panel/api/file?path=panel-test/hello.txt");
  await expectStatus(response, 404, "panel deleted file is gone");

  response = await dav("PUT", "/panel/api/upload?path=panel-test/mv-src.txt", { body: "move me" });
  await expectStatus(response, 201, "panel upload for move");
  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "move", source: "panel-test/mv-src.txt", destination: "panel-test/mv-dst.txt" }),
  });
  await expectStatus(response, 200, "panel move");
  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "copy", source: "panel-test/mv-dst.txt", destination: "panel-test/cp-dst.txt" }),
  });
  await expectStatus(response, 200, "panel copy");
  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", source: "panel-test/mv-dst.txt" }),
  });
  await expectStatus(response, 200, "panel cleanup 1");
  response = await dav("POST", "/panel/api/action", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", source: "panel-test/cp-dst.txt" }),
  });
  await expectStatus(response, 200, "panel cleanup 2");

  // Multipart upload lifecycle
  response = await dav("POST", "/panel/api/upload/multipart", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test/big.bin", contentType: "application/octet-stream" }),
  });
  await expectStatus(response, 201, "multipart create");
  const uploadInfo = await response.json();

  response = await dav("PUT", "/panel/api/upload/multipart/part?path=panel-test/big.bin&uploadId=" + encodeURIComponent(uploadInfo.uploadId) + "&partNumber=1", {
    body: "part-one-",
  });
  await expectStatus(response, 200, "multipart part 1");
  const part1 = await response.json();
  response = await dav("PUT", "/panel/api/upload/multipart/part?path=panel-test/big.bin&uploadId=" + encodeURIComponent(uploadInfo.uploadId) + "&partNumber=2", {
    body: "part-two",
  });
  await expectStatus(response, 200, "multipart part 2");
  const part2 = await response.json();

  response = await dav("PUT", "/panel/api/upload/multipart/part?path=panel-test/big.bin&uploadId=" + encodeURIComponent(uploadInfo.uploadId) + "&partNumber=0", { body: "x" });
  await expectStatus(response, 400, "multipart rejects partNumber 0");
  response = await dav("PUT", "/panel/api/upload/multipart/part?path=panel-test/big.bin&uploadId=" + encodeURIComponent(uploadInfo.uploadId) + "&partNumber=10001", { body: "x" });
  await expectStatus(response, 400, "multipart rejects partNumber over 10000");
  response = await dav("POST", "/panel/api/upload/multipart/complete?path=panel-test/big.bin&uploadId=" + encodeURIComponent(uploadInfo.uploadId), {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [] }),
  });
  await expectStatus(response, 400, "multipart complete rejects empty parts");

  response = await dav("POST", "/panel/api/upload/multipart/complete?path=panel-test/big.bin&uploadId=" + encodeURIComponent(uploadInfo.uploadId), {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [part2, part1] }),
  });
  await expectStatus(response, 200, "multipart complete accepts unordered parts");
  response = await dav("GET", "/panel/api/file?path=panel-test/big.bin");
  await expectStatus(response, 200, "multipart file read");
  ok((await response.text()) === "part-one-part-two", "multipart content reassembled in order");

  // Multipart abort
  response = await dav("POST", "/panel/api/upload/multipart", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test/aborted.bin" }),
  });
  const abortInfo = await response.json();
  response = await dav("DELETE", "/panel/api/upload/multipart?path=panel-test/aborted.bin&uploadId=" + encodeURIComponent(abortInfo.uploadId));
  await expectStatus(response, 200, "multipart abort");
  response = await dav("PUT", "/panel/api/upload/multipart/part?path=panel-test/aborted.bin&uploadId=" + encodeURIComponent(abortInfo.uploadId) + "&partNumber=1", { body: "x" });
  await expectStatus(response, 400, "aborted upload rejects parts");

  // Search
  response = await dav("PUT", "/panel/api/upload?path=" + encodeURIComponent("panel-test/查找目标.txt"), {
    headers: { "Content-Type": "text/plain" }, body: "searchable",
  });
  await expectStatus(response, 201, "panel upload chinese name");
  response = await dav("GET", "/panel/api/search?path=panel-test&q=" + encodeURIComponent("查找"));
  await expectStatus(response, 200, "panel search chinese");
  const searchResult = await response.json();
  ok(searchResult.items.some((item) => item.name === "查找目标.txt"), "panel search finds chinese filename");
  response = await dav("GET", "/panel/api/search?path=panel-test&q=zzz-nothing");
  await expectStatus(response, 200, "panel search empty result");

  // List pagination (load more)
  for (let index = 1; index <= 25; index += 1) {
    await bucket.put(`pag/object-${String(index).padStart(3, "0")}.txt`, new Uint8Array([index]));
  }
  response = await dav("GET", "/panel/api/list?path=pag&limit=10");
  await expectStatus(response, 200, "panel list page 1");
  const page1 = await response.json();
  ok(page1.items.length === 10 && page1.truncated === true && page1.cursor, "panel list page 1 truncated with cursor");
  response = await dav("GET", "/panel/api/list?path=pag&limit=10&cursor=" + encodeURIComponent(page1.cursor));
  await expectStatus(response, 200, "panel list page 2");
  const page2 = await response.json();
  response = await dav("GET", "/panel/api/list?path=pag&limit=10&cursor=" + encodeURIComponent(page2.cursor));
  await expectStatus(response, 200, "panel list page 3");
  const page3 = await response.json();
  ok(page1.items.length + page2.items.length + page3.items.length === 25, "panel pagination covers all objects");
  ok(page3.truncated === false, "panel pagination terminates");

  // ============================================================
  // Temporary share links
  // ============================================================
  response = await dav("POST", "/panel/api/share", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test/big.bin", expiresIn: 3600 }),
  });
  await expectStatus(response, 200, "share link creation");
  const share = await response.json();
  const shareUrl = new URL(share.url);
  ok(shareUrl.pathname.startsWith("/share/"), "share URL path");
  response = await dav("GET", shareUrl.pathname, { authenticated: false });
  await expectStatus(response, 200, "anonymous public share access");
  ok((await response.text()) === "part-one-part-two", "share content");
  ok((response.headers.get("Content-Disposition") || "").startsWith("inline"), "share served inline");
  response = await dav("POST", shareUrl.pathname, { authenticated: false, body: "x" });
  await expectStatus(response, 400, "share rejects non-GET");

  // Expired token (correct signature, past exp) is rejected.
  const expiredPayload = base64Url(JSON.stringify({ key: "panel-test/big.bin", exp: Math.floor(Date.now() / 1000) - 100 }));
  const expiredToken = `${expiredPayload}.${await signShare(expiredPayload)}`;
  response = await dav("GET", `/share/${expiredToken}`, { authenticated: false });
  await expectStatus(response, 404, "expired share token rejected");

  // Tampered payload is rejected even with a valid-format token.
  const freshPayload = base64Url(JSON.stringify({ key: "panel-test/big.bin", exp: Math.floor(Date.now() / 1000) + 600 }));
  const tamperedToken = `${freshPayload.slice(0, -2)}XY.${await signShare(freshPayload)}`;
  response = await dav("GET", `/share/${tamperedToken}`, { authenticated: false });
  await expectStatus(response, 404, "tampered share token rejected");

  response = await dav("GET", "/share/not-a-token", { authenticated: false });
  await expectStatus(response, 404, "invalid share token rejected");

  // Share a directory and a missing file must fail.
  await bucket.put("panel-test/", new Uint8Array(), { httpMetadata: { contentType: "application/x-webdav-collection" } });
  response = await dav("POST", "/panel/api/share", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test" }),
  });
  await expectStatus(response, 404, "share rejects directory");
  response = await dav("POST", "/panel/api/share", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test/ghost.txt" }),
  });
  await expectStatus(response, 404, "share rejects missing file");

  // Expiry clamped to [300, 604800].
  response = await dav("POST", "/panel/api/share", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test/big.bin", expiresIn: 10 }),
  });
  const clamped = await response.json();
  const clampedSeconds = (new Date(clamped.expiresAt).getTime() - Date.now()) / 1000;
  ok(clampedSeconds > 250 && clampedSeconds <= 305, "share expiry clamped to minimum");
  response = await dav("POST", "/panel/api/share", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test/big.bin", expiresIn: 99999999 }),
  });
  const capped = await response.json();
  const cappedSeconds = (new Date(capped.expiresAt).getTime() - Date.now()) / 1000;
  ok(cappedSeconds <= 604800 + 10, "share expiry capped at 7 days");

  // HTML files shared anonymously must not be served as text/html.
  response = await dav("PUT", "/panel/api/upload?path=panel-test/page.html", {
    headers: { "Content-Type": "text/html" },
    body: "<html><body><script>alert(1)</script></body></html>",
  });
  await expectStatus(response, 201, "panel upload html file");
  response = await dav("POST", "/panel/api/share", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "panel-test/page.html", expiresIn: 3600 }),
  });
  const htmlShare = await response.json();
  response = await dav("GET", new URL(htmlShare.url).pathname, { authenticated: false });
  await expectStatus(response, 200, "html share accessible");
  ok(!(response.headers.get("Content-Type") || "").includes("text/html"), "shared HTML downgraded away from text/html");

  // ============================================================
  // WebDAV
  // ============================================================
  response = await dav("OPTIONS", "/");
  await expectStatus(response, 200, "OPTIONS");
  ok(response.headers.get("DAV")?.includes("1"), "OPTIONS advertises DAV level 1");
  ok((response.headers.get("Allow") || "").includes("PROPFIND"), "OPTIONS Allow header");
  ok(response.headers.get("MS-Author-Via") === "DAV", "OPTIONS MS-Author-Via");

  response = await dav("OPTIONS", "/", { authenticated: false });
  await expectStatus(response, 401, "unauthenticated request rejected");
  response = await dav("GET", "/backups/mihomo/config.yaml", { authenticated: false });
  await expectStatus(response, 401, "unauthenticated download rejected");

  response = await dav("PROPFIND", "/", { headers: { Depth: "0" } });
  await expectStatus(response, 207, "PROPFIND root depth 0");
  ok((await response.text()).includes("<D:multistatus"), "PROPFIND returns multistatus");

  response = await dav("PROPFIND", "/does-not-exist", { headers: { Depth: "1" } });
  await expectStatus(response, 404, "PROPFIND missing resource");

  response = await dav("MKCOL", "/backups");
  await expectStatus(response, 201, "create backups directory");
  response = await dav("MKCOL", "/backups");
  await expectStatus(response, 405, "MKCOL existing collection rejected");
  response = await dav("MKCOL", "/no-such-parent/child");
  await expectStatus(response, 409, "MKCOL rejects missing parent");
  response = await dav("MKCOL", "/backups/mihomo");
  await expectStatus(response, 201, "create nested directory");

  response = await dav("MKCOL", "/backups/body", { headers: { "Content-Length": "5" }, body: "hello" });
  await expectStatus(response, 415, "MKCOL with body rejected");

  response = await dav("PUT", "/backups/mihomo/config.yaml", { headers: { "Content-Type": "application/yaml" }, body: "mixed-port: 7890\nmode: rule\n" });
  await expectStatus(response, 201, "upload configuration");
  response = await dav("PUT", "/backups/mihomo/config.yaml", { headers: { "Content-Type": "application/yaml" }, body: "mixed-port: 7891\nmode: rule\n" });
  await expectStatus(response, 204, "overwrite configuration");

  response = await dav("PUT", "/no-such-parent/file.txt", { body: "x" });
  await expectStatus(response, 409, "PUT rejects missing parent collection");
  response = await dav("PUT", "/backups/trailing/", { body: "x" });
  await expectStatus(response, 409, "PUT rejects collection path");

  response = await dav("PROPFIND", "/backups/mihomo/", { headers: { Depth: "1" } });
  await expectStatus(response, 207, "list directory");
  const listing = await response.text();
  ok(listing.includes("<D:multistatus") && listing.includes("config.yaml") && listing.includes("<D:collection/>"), "PROPFIND multistatus XML");

  response = await dav("PROPFIND", "/backups/mihomo/config.yaml", { headers: { Depth: "1" } });
  await expectStatus(response, 207, "PROPFIND on file");
  ok(!(await response.text()).includes("<D:collection/>"), "PROPFIND file is not a collection");

  // A directory listing of an empty collection.
  response = await dav("MKCOL", "/backups/empty-dir");
  await expectStatus(response, 201, "create empty directory");
  response = await dav("PROPFIND", "/backups/empty-dir/", { headers: { Depth: "1" } });
  await expectStatus(response, 207, "PROPFIND empty directory");
  ok((await response.text()).split("<D:response>").length - 1 === 1, "empty directory lists only itself");

  // GET / behaves as a collection, never as a file download.
  response = await dav("GET", "/");
  await expectStatus(response, 405, "GET collection is not a file download");
  ok((await response.text()).includes("collection"), "GET collection message");
  response = await dav("GET", "/backups/mihomo/");
  await expectStatus(response, 405, "GET nested collection is not a file download");
  response = await dav("GET", "/", { headers: { Accept: "text/html" } });
  await expectStatus(response, 200, "browser GET root gets landing page");
  ok((await response.text()).includes("/panel/"), "browser landing page links to panel");
  response = await dav("GET", "/backups/mihomo/", { headers: { Accept: "text/html" } });
  await expectStatus(response, 200, "browser GET directory gets landing page");

  response = await dav("GET", "/backups/mihomo/config.yaml");
  await expectStatus(response, 200, "download configuration");
  ok((await response.text()) === "mixed-port: 7891\nmode: rule\n", "downloaded content matches overwritten content");
  ok(response.headers.get("ETag"), "GET returns ETag");
  ok(response.headers.get("Last-Modified"), "GET returns Last-Modified");
  ok(response.headers.get("Content-Length"), "GET returns Content-Length");
  ok((response.headers.get("Content-Type") || "").includes("yaml"), "GET returns stored content type");

  response = await dav("GET", "/backups/mihomo/missing.txt");
  await expectStatus(response, 404, "GET missing object");

  response = await dav("HEAD", "/backups/mihomo/config.yaml");
  await expectStatus(response, 200, "HEAD configuration");
  ok(response.headers.get("Content-Length"), "HEAD response includes Content-Length");

  // Conditional request
  response = await dav("GET", "/backups/mihomo/config.yaml");
  const etag = response.headers.get("ETag");
  response = await dav("GET", "/backups/mihomo/config.yaml", { headers: { "If-None-Match": etag } });
  await expectStatus(response, 304, "If-None-Match returns 304");
  response = await dav("PUT", "/backups/mihomo/config.yaml", { headers: { "If-None-Match": "*" }, body: "x" });
  await expectStatus(response, 412, "PUT If-None-Match * on existing object returns 412");

  // Range requests
  const configBody = "mixed-port: 7891\nmode: rule\n";
  response = await dav("GET", "/backups/mihomo/config.yaml", { headers: { Range: "bytes=0-4" } });
  await expectStatus(response, 206, "range request 206");
  ok(response.headers.get("Content-Range") === `bytes 0-4/${configBody.length}`, "range Content-Range");
  ok((await response.text()) === configBody.slice(0, 5), "range body slice");

  response = await dav("GET", "/backups/mihomo/config.yaml", { headers: { Range: "bytes=-6" } });
  await expectStatus(response, 206, "suffix range 206");
  ok((await response.text()) === configBody.slice(-6), "suffix range body");

  response = await dav("HEAD", "/backups/mihomo/config.yaml", { headers: { Range: "bytes=0-4" } });
  await expectStatus(response, 206, "HEAD honours range");
  ok(response.headers.get("Content-Length") === "5", "HEAD range content length");

  response = await dav("GET", "/backups/mihomo/config.yaml", { headers: { Range: "bytes=999999-1000000" } });
  await expectStatus(response, 416, "unsatisfiable range 416");
  ok(response.headers.get("Content-Range") === `bytes */${configBody.length}`, "416 Content-Range");

  // Unsupported/malformed ranges fall back to a full 200 response.
  response = await dav("GET", "/backups/mihomo/config.yaml", { headers: { Range: "bytes=0-1,5-6" } });
  await expectStatus(response, 200, "multi-range ignored returns 200");
  ok((await response.text()) === configBody, "multi-range returns full body");
  response = await dav("GET", "/backups/mihomo/config.yaml", { headers: { Range: "bytes=abc" } });
  await expectStatus(response, 200, "malformed range ignored returns 200");

  // Special filenames through URL encoding: Chinese, spaces, literal %.
  response = await dav("MKCOL", "/backups/中文 目录");
  await expectStatus(response, 201, "MKCOL chinese/space directory");
  response = await dav("PUT", "/backups/中文 目录/a b.txt", { body: "special names" });
  await expectStatus(response, 201, "PUT chinese/space name");
  response = await dav("GET", "/backups/" + encodeURIComponent("中文 目录") + "/" + encodeURIComponent("a b.txt"));
  await expectStatus(response, 200, "GET chinese/space name");
  ok((await response.text()) === "special names", "chinese/space name content");
  response = await dav("PUT", "/backups/100%25测试.txt", { body: "percent" });
  await expectStatus(response, 201, "PUT percent name");
  response = await dav("GET", "/backups/100%25" + encodeURIComponent("测试") + ".txt");
  await expectStatus(response, 200, "GET percent name");
  ok((await response.text()) === "percent", "percent name content");
  response = await dav("PROPFIND", "/backups/", { headers: { Depth: "1" } });
  const specialListing = await response.text();
  ok(specialListing.includes("100%测试.txt") && specialListing.includes("中文 目录"), "PROPFIND lists decoded special names");
  response = await dav("PROPFIND", "/backups/中文 目录/", { headers: { Depth: "1" } });
  ok((await response.text()).includes("a b.txt"), "PROPFIND lists file inside chinese directory");

  // Path traversal is rejected.
  response = await dav("GET", "/%2E%2E%2Fescape");
  await expectStatus(response, 400, "dot-dot traversal rejected");
  response = await dav("PUT", "/a%5Cevil.txt", { body: "x" });
  await expectStatus(response, 400, "backslash path rejected");
  response = await dav("PUT", "/a%2F%2Fb.txt", { body: "x" });
  await expectStatus(response, 400, "encoded slash inside segment rejected");

  // COPY / MOVE files
  response = await dav("COPY", "/backups/mihomo/config.yaml", {
    headers: { Destination: "https://dav.example/backups/mihomo/config-copy.yaml", Overwrite: "F" },
  });
  await expectStatus(response, 201, "copy configuration");
  response = await dav("COPY", "/backups/mihomo/config.yaml", {
    headers: { Destination: "https://dav.example/backups/mihomo/config-copy.yaml", Overwrite: "F" },
  });
  await expectStatus(response, 412, "copy with Overwrite F onto existing rejected");
  response = await dav("COPY", "/backups/mihomo/config.yaml", {
    headers: { Destination: "https://dav.example/backups/mihomo/config-copy.yaml", Overwrite: "T" },
  });
  await expectStatus(response, 204, "copy with Overwrite T replaces destination");

  response = await dav("MOVE", "/backups/mihomo/config-copy.yaml", {
    headers: { Destination: "https://dav.example/backups/mihomo/sing-box.json", Overwrite: "F" },
  });
  await expectStatus(response, 201, "move configuration");
  response = await dav("GET", "/backups/mihomo/config-copy.yaml");
  await expectStatus(response, 404, "moved source is gone");

  // COPY / MOVE collections recursively
  response = await dav("MKCOL", "/backups/mihomo/sub");
  await expectStatus(response, 201, "create subdirectory");
  response = await dav("PUT", "/backups/mihomo/sub/deep.yaml", { body: "deep: true" });
  await expectStatus(response, 201, "upload nested file");
  response = await dav("COPY", "/backups/mihomo", { headers: { Destination: "https://dav.example/backups/mihomo-copy" } });
  await expectStatus(response, 201, "copy collection recursively");
  response = await dav("GET", "/backups/mihomo-copy/sub/deep.yaml");
  await expectStatus(response, 200, "copied collection keeps children");
  response = await dav("COPY", "/backups/mihomo", { headers: { Destination: "https://dav.example/backups/depth0", Depth: "0" } });
  await expectStatus(response, 201, "copy collection depth 0");
  response = await dav("GET", "/backups/depth0/sub/deep.yaml");
  await expectStatus(response, 404, "depth 0 copy does not copy children");

  response = await dav("MOVE", "/backups/mihomo-copy", { headers: { Destination: "https://dav.example/backups/mihomo-moved" } });
  await expectStatus(response, 201, "move collection recursively");
  response = await dav("PROPFIND", "/backups/mihomo-copy", { headers: { Depth: "0" } });
  await expectStatus(response, 404, "moved collection source gone");
  response = await dav("GET", "/backups/mihomo-moved/sub/deep.yaml");
  await expectStatus(response, 200, "moved collection keeps children");

  response = await dav("MOVE", "/backups/mihomo", { headers: { Destination: "https://dav.example/backups/mihomo/inside" } });
  await expectStatus(response, 403, "move into own subtree rejected");
  response = await dav("COPY", "/backups/mihomo");
  await expectStatus(response, 400, "missing Destination header rejected");

  // Recursive delete removes children too.
  response = await dav("DELETE", "/backups/mihomo");
  await expectStatus(response, 204, "delete non-empty directory");
  response = await dav("PROPFIND", "/backups/mihomo", { headers: { Depth: "0" } });
  await expectStatus(response, 404, "deleted directory gone");
  response = await dav("GET", "/backups/mihomo/sub/deep.yaml");
  await expectStatus(response, 404, "deleted directory children gone");
  response = await dav("DELETE", "/backups/mihomo-moved");
  await expectStatus(response, 204, "delete moved collection");
  response = await dav("DELETE", "/backups/mihomo/config.yaml");
  await expectStatus(response, 404, "delete missing object");

  console.log(`OK: ${checks} assertions passed — panel entries (no redirect loop), panel API, multipart, share, WebDAV methods, ranges, traversal guards.`);
}

try {
  await run();
} catch (error) {
  console.error("TEST FAILURE:", error.message);
  process.exit(1);
}
