const DAV_ALLOW = "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE";
const DAV_HEADERS = {
  "DAV": "1",
  "Allow": DAV_ALLOW,
  "MS-Author-Via": "DAV",
  "Accept-Ranges": "bytes",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Never accept Basic credentials over plain HTTP. A Workers custom domain
    // normally supplies TLS at the edge; this is a defense-in-depth redirect.
    if (url.protocol !== "https:") {
      url.protocol = "https:";
      return finalize(new Response(null, { status: 301, headers: { Location: url.toString() } }));
    }

    if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) {
      return finalize(textResponse("WebDAV service is not configured.", 503));
    }

    if (url.pathname.startsWith("/share/")) {
      return finalize(await handlePublicShare(request, env));
    }

    if (!isAuthorized(request, env)) {
      return finalize(new Response("Authentication required.", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Cloudflare R2 WebDAV", charset="UTF-8"',
          ...DAV_HEADERS,
        },
      }));
    }

    // Panel entry points are served explicitly and never redirect. With
    // html_handling = "none" the asset pipeline returns /panel/index.html
    // directly, so /panel, /panel/ and /panel/index.html all yield 200 HTML.
    if (url.pathname === "/panel" || url.pathname === "/panel/" || url.pathname === "/panel/index.html") {
      if (!env.ASSETS) return finalize(textResponse("Management panel assets are not configured.", 503));
      const assetUrl = new URL("/panel/index.html", request.url);
      return finalize(await env.ASSETS.fetch(new Request(assetUrl, request)));
    }
    if (url.pathname.startsWith("/panel/api/")) {
      return finalize(await handlePanelApi(request, env));
    }
    if (url.pathname.startsWith("/panel/")) {
      if (!env.ASSETS) return finalize(textResponse("Management panel assets are not configured.", 503));
      return finalize(await env.ASSETS.fetch(request));
    }

    let key;
    try {
      key = pathToKey(url.pathname);
    } catch {
      return finalize(textResponse("Invalid WebDAV path.", 400));
    }

    try {
      let response;
      switch (request.method.toUpperCase()) {
        case "OPTIONS":
          // Return 200 rather than an empty 204 for broad Android/WebDAV client
          // compatibility. Capability headers remain identical.
          response = new Response(null, { status: 200, headers: DAV_HEADERS });
          break;
        case "PROPFIND":
          response = await handlePropfind(request, env.R2_BUCKET, key);
          break;
        case "GET":
          response = await handleGet(request, env.R2_BUCKET, key, false);
          break;
        case "HEAD":
          response = await handleGet(request, env.R2_BUCKET, key, true);
          break;
        case "PUT":
          response = await handlePut(request, env.R2_BUCKET, key);
          break;
        case "DELETE":
          response = await handleDelete(env.R2_BUCKET, key);
          break;
        case "MKCOL":
          response = await handleMkcol(request, env.R2_BUCKET, key);
          break;
        case "COPY":
          response = await handleCopyOrMove(request, env.R2_BUCKET, key, false);
          break;
        case "MOVE":
          response = await handleCopyOrMove(request, env.R2_BUCKET, key, true);
          break;
        default:
          response = textResponse("Method not allowed.", 405, DAV_HEADERS);
      }
      return finalize(response);
    } catch (error) {
      // Do not reveal R2 details, object names, or secrets to unauthenticated
      // clients. Cloudflare Workers Logs can be consulted by the account owner.
      console.error("WebDAV request failed", { method: request.method, message: String(error?.message || error) });
      return finalize(textResponse("WebDAV operation failed.", 500));
    }
  },
};

async function handlePanelApi(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/panel/api/config" && request.method === "GET") {
    let files = 0;
    let folders = 0;
    let truncated = false;
    try {
      const page = await env.R2_BUCKET.list({ delimiter: "/", limit: 1000 });
      files = page.objects.length;
      folders = page.delimitedPrefixes.length;
      truncated = Boolean(page.truncated);
    } catch (error) {
      console.error("Panel config stats failed", { message: String(error?.message || error) });
    }
    return jsonResponse({
      serverUrl: new URL("/", request.url).toString(),
      panelUrl: new URL("/panel/", request.url).toString(),
      username: env.WEBDAV_USERNAME,
      stats: { files, folders, truncated },
    });
  }

  if (pathname === "/panel/api/health" && request.method === "GET") {
    try {
      const started = Date.now();
      await env.R2_BUCKET.list({ limit: 1 });
      return jsonResponse({ ok: true, r2: true, latencyMs: Date.now() - started, time: new Date().toISOString() });
    } catch (error) {
      console.error("Panel health check failed", { message: String(error?.message || error) });
      return jsonResponse({ ok: false, r2: false, time: new Date().toISOString() }, 503);
    }
  }

  if (pathname === "/panel/api/stats" && request.method === "GET") {
    try {
      return jsonResponse(await collectBucketStats(env.R2_BUCKET, 5000));
    } catch (error) {
      console.error("Panel stats failed", { message: String(error?.message || error) });
      return jsonResponse({ error: "Unable to read storage statistics." }, 503);
    }
  }

  if (pathname === "/panel/api/search" && request.method === "GET") {
    let prefix;
    try { prefix = panelPathToKey(url.searchParams.get("path") || ""); } catch { return jsonResponse({ error: "Invalid path." }, 400); }
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (!query) return jsonResponse({ items: [], truncated: false, scanned: 0 });
    return jsonResponse(await searchObjects(env.R2_BUCKET, prefix, query, 500));
  }

  if (pathname === "/panel/api/share" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON." }, 400); }
    try {
      const key = panelPathToKey(payload.path || "");
      if (!key) return jsonResponse({ error: "Invalid file path." }, 400);
      const resource = await findResource(env.R2_BUCKET, key);
      if (!resource || resource.kind !== "file") return jsonResponse({ error: "File not found." }, 404);
      const requestedSeconds = Number(payload.expiresIn || 86400);
      const expiresIn = Math.min(Math.max(Number.isFinite(requestedSeconds) ? requestedSeconds : 86400, 300), 604800);
      const exp = Math.floor(Date.now() / 1000) + expiresIn;
      const token = await createShareToken(key, exp, env.WEBDAV_PASSWORD);
      return jsonResponse({ url: new URL("/share/" + token, request.url).toString(), expiresAt: new Date(exp * 1000).toISOString() });
    } catch {
      return jsonResponse({ error: "Unable to create share link." }, 400);
    }
  }

  if (pathname === "/panel/api/list" && request.method === "GET") {
    let prefix;
    try {
      prefix = panelPathToKey(url.searchParams.get("path") || "");
    } catch {
      return jsonResponse({ error: "Invalid path." }, 400);
    }
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 1000);
    const page = await env.R2_BUCKET.list({ prefix: collectionPrefix(prefix), delimiter: "/", cursor, limit });
    const items = [];
    for (const object of page.objects) {
      if (object.key === collectionMarker(prefix)) continue;
      items.push({
        name: displayNameFor(object.key),
        path: object.key,
        type: "file",
        size: object.size,
        uploaded: object.uploaded,
        contentType: object.httpMetadata?.contentType || "application/octet-stream",
        etag: object.httpEtag || quoteETag(object.etag),
      });
    }
    for (const childPrefix of page.delimitedPrefixes) {
      const key = childPrefix.endsWith("/") ? childPrefix.slice(0, -1) : childPrefix;
      const marker = await env.R2_BUCKET.head(childPrefix);
      items.push({
        name: displayNameFor(key),
        path: key,
        type: "directory",
        size: 0,
        uploaded: marker?.uploaded || null,
        contentType: "application/x-webdav-collection",
      });
    }
    items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
    return jsonResponse({
      path: prefix,
      parent: parentKey(prefix),
      items,
      truncated: Boolean(page.truncated),
      cursor: page.truncated ? page.cursor : null,
    });
  }

  if (pathname === "/panel/api/file" && request.method === "GET") {
    let key;
    try {
      key = panelPathToKey(url.searchParams.get("path") || "");
    } catch {
      return textResponse("Invalid path.", 400);
    }
    if (!key) return textResponse("A collection cannot be downloaded.", 400);
    const resource = await findResource(env.R2_BUCKET, key);
    if (!resource) return textResponse("Not found.", 404);
    if (resource.kind === "directory") return textResponse("A collection cannot be downloaded.", 400);
    return handleGet(request, env.R2_BUCKET, key, false);
  }

  if (pathname === "/panel/api/download" && request.method === "GET") {
    let key;
    try {
      key = panelPathToKey(url.searchParams.get("path") || "");
    } catch {
      return textResponse("Invalid path.", 400);
    }
    if (!key) return textResponse("Invalid path.", 400);
    const resource = await findResource(env.R2_BUCKET, key);
    if (!resource || resource.kind !== "file") return textResponse("Not found.", 404);
    const response = await handleGet(request, env.R2_BUCKET, key, false);
    const headers = new Headers(response.headers);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(displayNameFor(key))}`);
    return new Response(response.body, { status: response.status, headers });
  }

  if (pathname === "/panel/api/upload" && request.method === "PUT") {
    let key;
    try {
      key = panelPathToKey(url.searchParams.get("path") || "");
    } catch {
      return textResponse("Invalid path.", 400);
    }
    if (!key) return textResponse("Invalid upload path.", 400);
    const parent = await findResource(env.R2_BUCKET, parentKey(key));
    if (!parent || parent.kind !== "directory") return textResponse("Parent collection does not exist.", 409);
    const existing = await findResource(env.R2_BUCKET, key);
    if (existing?.kind === "directory") return textResponse("A collection already exists at this path.", 409);
    await env.R2_BUCKET.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
    });
    return jsonResponse({ ok: true, path: key, overwritten: Boolean(existing) }, existing ? 200 : 201);
  }

  if (pathname === "/panel/api/upload/multipart" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON." }, 400); }
    try {
      const key = panelPathToKey(payload.path || "");
      if (!key) return jsonResponse({ error: "Invalid upload path." }, 400);
      const parent = await findResource(env.R2_BUCKET, parentKey(key));
      if (!parent || parent.kind !== "directory") return jsonResponse({ error: "Parent collection does not exist." }, 409);
      const existing = await findResource(env.R2_BUCKET, key);
      if (existing?.kind === "directory") return jsonResponse({ error: "A collection already exists at this path." }, 409);
      const upload = await env.R2_BUCKET.createMultipartUpload(key, {
        httpMetadata: { contentType: payload.contentType || "application/octet-stream" },
      });
      return jsonResponse({ key: upload.key, uploadId: upload.uploadId, overwritten: Boolean(existing) }, existing ? 200 : 201);
    } catch (error) {
      console.error("Multipart create failed", { message: String(error?.message || error) });
      return jsonResponse({ error: "Unable to create multipart upload." }, 500);
    }
  }

  if (pathname === "/panel/api/upload/multipart/part" && request.method === "PUT") {
    const keyValue = url.searchParams.get("path") || "";
    const uploadId = url.searchParams.get("uploadId") || "";
    const partNumber = Number(url.searchParams.get("partNumber"));
    try {
      const key = panelPathToKey(keyValue);
      if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !request.body) {
        return jsonResponse({ error: "Invalid multipart part request." }, 400);
      }
      const part = await env.R2_BUCKET.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, request.body);
      return jsonResponse(part);
    } catch {
      return jsonResponse({ error: "Multipart part upload failed." }, 400);
    }
  }

  if (pathname === "/panel/api/upload/multipart/complete" && request.method === "POST") {
    const keyValue = url.searchParams.get("path") || "";
    const uploadId = url.searchParams.get("uploadId") || "";
    try {
      const key = panelPathToKey(keyValue);
      if (!key || !uploadId) return jsonResponse({ error: "Invalid multipart completion request." }, 400);
      const payload = await request.json();
      if (!Array.isArray(payload.parts) || !payload.parts.length || payload.parts.length > 10000) return jsonResponse({ error: "Invalid multipart parts." }, 400);
      const parts = payload.parts.map(part => ({ partNumber: Number(part.partNumber), etag: String(part.etag) }));
      if (parts.some(part => !Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > 10000 || !part.etag)) return jsonResponse({ error: "Invalid multipart part metadata." }, 400);
      parts.sort((a,b) => a.partNumber - b.partNumber);
      const object = await env.R2_BUCKET.resumeMultipartUpload(key, uploadId).complete(parts);
      return jsonResponse({ ok: true, key: object.key, etag: object.httpEtag });
    } catch {
      return jsonResponse({ error: "Multipart completion failed." }, 400);
    }
  }

  if (pathname === "/panel/api/upload/multipart" && request.method === "DELETE") {
    const keyValue = url.searchParams.get("path") || "";
    const uploadId = url.searchParams.get("uploadId") || "";
    try {
      const key = panelPathToKey(keyValue);
      if (!key || !uploadId) return jsonResponse({ error: "Invalid multipart abort request." }, 400);
      await env.R2_BUCKET.resumeMultipartUpload(key, uploadId).abort();
      return jsonResponse({ ok: true });
    } catch {
      return jsonResponse({ error: "Multipart abort failed." }, 400);
    }
  }

  if (pathname === "/panel/api/action" && request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON." }, 400);
    }
    try {
      if (payload.action === "mkdir") {
        const key = panelPathToKey(payload.path || "");
        if (!key) return jsonResponse({ error: "Invalid folder path." }, 400);
        const parent = await findResource(env.R2_BUCKET, parentKey(key));
        if (!parent || parent.kind !== "directory") return jsonResponse({ error: "Parent folder does not exist." }, 409);
        if (await findResource(env.R2_BUCKET, key)) return jsonResponse({ error: "Destination already exists." }, 409);
        await createCollectionMarker(env.R2_BUCKET, key);
        return jsonResponse({ ok: true, path: key }, 201);
      }

      const sourceKey = panelPathToKey(payload.source || "");
      if (!sourceKey) return jsonResponse({ error: "Invalid source." }, 400);
      const source = await findResource(env.R2_BUCKET, sourceKey);
      if (!source) return jsonResponse({ error: "Source not found." }, 404);
      if (payload.action === "delete") {
        if (source.kind === "file") await env.R2_BUCKET.delete(sourceKey);
        else await deleteCollection(env.R2_BUCKET, sourceKey);
        return jsonResponse({ ok: true });
      }

      const destinationKey = panelPathToKey(payload.destination || "");
      if (!destinationKey || sourceKey === destinationKey) return jsonResponse({ error: "Invalid destination." }, 400);
      const destinationParent = await findResource(env.R2_BUCKET, parentKey(destinationKey));
      if (!destinationParent || destinationParent.kind !== "directory") return jsonResponse({ error: "Destination folder does not exist." }, 409);
      if (source.kind === "directory" && destinationKey.startsWith(collectionPrefix(sourceKey))) {
        return jsonResponse({ error: "Destination cannot be inside the source folder." }, 403);
      }
      const existing = await findResource(env.R2_BUCKET, destinationKey);
      if (existing) return jsonResponse({ error: "Destination already exists." }, 409);
      if (payload.action === "rename" || payload.action === "move") {
        if (source.kind === "file") {
          await copyFile(env.R2_BUCKET, sourceKey, destinationKey);
          await env.R2_BUCKET.delete(sourceKey);
        } else {
          await copyCollection(env.R2_BUCKET, sourceKey, destinationKey);
          await deleteCollection(env.R2_BUCKET, sourceKey);
        }
        return jsonResponse({ ok: true, path: destinationKey });
      }
      if (payload.action === "copy") {
        if (source.kind === "file") await copyFile(env.R2_BUCKET, sourceKey, destinationKey);
        else await copyCollection(env.R2_BUCKET, sourceKey, destinationKey);
        return jsonResponse({ ok: true, path: destinationKey });
      }
      return jsonResponse({ error: "Unknown action." }, 400);
    } catch (error) {
      console.error("Panel action failed", { message: String(error?.message || error) });
      return jsonResponse({ error: "Operation failed." }, 500);
    }
  }

  return textResponse("Not found.", 404);
}


async function collectBucketStats(bucket, maxObjects = 5000) {
  let cursor;
  let files = 0, folders = 0, bytes = 0, scanned = 0, truncated = false;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const object of page.objects) {
      scanned += 1;
      if (object.key.endsWith("/")) folders += 1;
      else { files += 1; bytes += object.size || 0; }
      if (scanned >= maxObjects) { truncated = page.truncated || scanned >= maxObjects; break; }
    }
    if (truncated || !page.truncated) break;
    cursor = page.cursor;
  } while (cursor);
  return { files, folders, bytes, scanned, truncated };
}

async function searchObjects(bucket, prefix, query, maxResults) {
  let cursor;
  const items = [];
  let scanned = 0, truncated = false;
  do {
    const page = await bucket.list({ prefix: collectionPrefix(prefix), cursor, limit: 1000 });
    for (const object of page.objects) {
      scanned += 1;
      if (object.key.endsWith("/")) continue;
      if (object.key.toLowerCase().includes(query)) {
        items.push({ name: displayNameFor(object.key), path: object.key, type: "file", size: object.size, uploaded: object.uploaded, contentType: object.httpMetadata?.contentType || "application/octet-stream" });
        if (items.length >= maxResults) { truncated = true; break; }
      }
    }
    if (truncated || !page.truncated || scanned >= 10000) break;
    cursor = page.cursor;
  } while (cursor);
  return { items, truncated: truncated || Boolean(cursor), scanned };
}

async function createShareToken(key, exp, secret) {
  const payload = base64UrlEncode(JSON.stringify({ key, exp }));
  return payload + "." + await signSharePayload(payload, secret);
}

async function verifyShareToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = await signSharePayload(payload, secret);
  if (!constantTimeEqual(expected, signature)) return null;
  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (!data?.key || !Number.isSafeInteger(data.exp) || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

async function signSharePayload(payload, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(signature);
}

function base64UrlEncode(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0)));
}

async function handlePublicShare(request, env) {
  if (!env.WEBDAV_PASSWORD) return textResponse("Share service is not configured.", 503);
  const url = new URL(request.url);
  const token = url.pathname.slice("/share/".length);
  if (request.method !== "GET" || !token) return textResponse("Invalid share request.", 400);
  const data = await verifyShareToken(token, env.WEBDAV_PASSWORD);
  if (!data) return textResponse("Share link expired or invalid.", 404);
  try {
    const response = await handleGet(request, env.R2_BUCKET, data.key, false);
    if (response.status >= 400) return response;
    const headers = new Headers(response.headers);
    // Share links are served anonymously: never hand executable document
    // types to the browser, or a shared file could run script against this
    // origin. Regular media, PDF and plain-text types are unaffected.
    if (/^\s*(text\/html|image\/svg\+xml|application\/xhtml\+xml)/i.test(headers.get("Content-Type") || "")) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
    }
    headers.set("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(displayNameFor(data.key)));
    headers.set("Cache-Control", "private, max-age=60");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return textResponse("Shared file is unavailable.", 404);
  }
}

function panelPathToKey(value) {
  if (!value || value === "/") return "";
  const normalized = value.startsWith("/") ? value.slice(1) : value;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\u0000"))) {
    throw new Error("unsafe panel path");
  }
  return segments.join("/");
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function finalize(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function textResponse(body, status, additionalHeaders = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...additionalHeaders },
  });
}

function isAuthorized(request, env) {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Basic ")) return false;

  try {
    const encoded = header.slice(6).trim();
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;

    const suppliedUsername = decoded.slice(0, separator);
    const suppliedPassword = decoded.slice(separator + 1);
    return constantTimeEqual(suppliedUsername, env.WEBDAV_USERNAME)
      && constantTimeEqual(suppliedPassword, env.WEBDAV_PASSWORD);
  } catch {
    return false;
  }
}

function constantTimeEqual(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let difference = aBytes.length ^ bBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (aBytes[index] || 0) ^ (bBytes[index] || 0);
  }
  return difference === 0;
}

function pathToKey(pathname) {
  const segments = pathname.split("/").filter(Boolean).map((segment) => {
    const decoded = decodeURIComponent(segment);
    if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\u0000")) {
      throw new Error("unsafe path segment");
    }
    return decoded;
  });
  return segments.join("/");
}

function parentKey(key) {
  const separator = key.lastIndexOf("/");
  return separator < 0 ? "" : key.slice(0, separator);
}

function collectionMarker(key) {
  return `${key}/`;
}

function collectionPrefix(key) {
  return key ? `${key}/` : "";
}

function hrefFor(key, kind) {
  if (!key) return "/";
  const escaped = key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `/${escaped}${kind === "directory" ? "/" : ""}`;
}

function displayNameFor(key) {
  if (!key) return "";
  const separator = key.lastIndexOf("/");
  return key.slice(separator + 1);
}

async function findResource(bucket, key) {
  if (!key) return { kind: "directory", key: "", object: null };

  const file = await bucket.head(key);
  if (file) return { kind: "file", key, object: file };

  const marker = await bucket.head(collectionMarker(key));
  if (marker) return { kind: "directory", key, object: marker };

  // R2 has no inherent directories. Treat a prefix with descendants as an
  // implicit WebDAV collection so clients can browse imported R2 content.
  const descendants = await bucket.list({ prefix: collectionPrefix(key), limit: 1 });
  if (descendants.objects.length > 0 || descendants.delimitedPrefixes.length > 0) {
    return { kind: "directory", key, object: null };
  }
  return null;
}

async function handleGet(request, bucket, key, headOnly) {
  if (!key) return collectionResponse(request, headOnly);

  const directory = await findResource(bucket, key);
  if (directory?.kind === "directory") {
    return collectionResponse(request, headOnly);
  }

  const metadata = await bucket.head(key);
  if (!metadata) return textResponse("Not found.", 404);

  const etag = metadata.httpEtag || quoteETag(metadata.etag);
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers: objectHeaders(metadata, etag) });
  }

  const rangeHeader = request.headers.get("Range");
  const range = parseRange(rangeHeader, metadata.size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${metadata.size}`, ...objectHeaders(metadata, etag) },
    });
  }

  if (headOnly) {
    const headers = objectHeaders(metadata, etag);
    if (range) {
      headers.set("Content-Length", String(range.length));
      headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
      return new Response(null, { status: 206, headers });
    }
    return new Response(null, { status: 200, headers });
  }

  const object = range
    ? await bucket.get(key, { range: { offset: range.offset, length: range.length } })
    : await bucket.get(key);
  if (!object) return textResponse("Not found.", 404);

  const headers = objectHeaders(object, etag);
  if (range) {
    headers.set("Content-Length", String(range.length));
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

// GET on a collection is not a file download. WebDAV clients keep receiving
// the compliant 405 response, while a normal browser (Accept: text/html) gets
// a small landing page that points at the management panel.
function collectionResponse(request, headOnly) {
  const accept = request.headers.get("Accept") || "";
  if (!headOnly && request.method.toUpperCase() === "GET" && accept.includes("text/html")) {
    return new Response(BROWSER_LANDING_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...DAV_HEADERS },
    });
  }
  return textResponse("A collection cannot be downloaded as a file.", 405, DAV_HEADERS);
}

const BROWSER_LANDING_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>R2-WebDAV</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{text-align:center;padding:2rem}a{color:#7dd3fc}code{background:#1e293b;padding:.2rem .5rem;border-radius:.4rem}</style></head>
<body><main><h1>R2-WebDAV 私有云</h1><p>此地址是 WebDAV 服务端点，请使用 WebDAV 客户端连接。</p><p>浏览器管理面板请访问 <a href="/panel/">/panel/</a></p><p><code>服务器</code> 填本页地址，<code>账号</code> 使用 WebDAV 用户名和密码。</p></main></body></html>`;

function objectHeaders(object, etag) {
  const headers = new Headers(DAV_HEADERS);
  if (typeof object.writeHttpMetadata === "function") {
    object.writeHttpMetadata(headers);
  } else {
    headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  }
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", etag);
  headers.set("Last-Modified", new Date(object.uploaded).toUTCString());
  return headers;
}

function quoteETag(value) {
  if (!value) return "";
  return value.startsWith('"') ? value : `"${value}"`;
}

function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) return false;
  return ifNoneMatch.split(",").map((value) => value.trim()).some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

// Returns { offset, length } for a satisfiable single range, null when the
// range is well-formed but unsatisfiable (416), and false when the header
// should be ignored in favour of a full 200 response (absent, malformed,
// multi-range, or an empty object). Ignoring unsupported ranges instead of
// rejecting them keeps video players and resuming downloaders working.
function parseRange(header, size) {
  if (!header) return false;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return false;
  const [, startText, endText] = match;
  if ((!startText && !endText) || size === 0) return false;

  let offset;
  let end;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    offset = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    offset = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset) return false;
    end = Math.min(end, size - 1);
  }
  if (offset >= size) return null;
  return { offset, length: end - offset + 1 };
}

async function handlePut(request, bucket, key) {
  if (!key || new URL(request.url).pathname.endsWith("/")) {
    return textResponse("PUT requires a file path.", 409);
  }

  const parent = await findResource(bucket, parentKey(key));
  if (!parent || parent.kind !== "directory") {
    return textResponse("Parent collection does not exist.", 409);
  }

  const existing = await findResource(bucket, key);
  if (existing?.kind === "directory") {
    return textResponse("A collection already exists at this path.", 409);
  }
  if (request.headers.get("If-None-Match") === "*" && existing) {
    return textResponse("Destination already exists.", 412);
  }

  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  await bucket.put(key, request.body, { httpMetadata: { contentType } });
  return new Response(null, { status: existing ? 204 : 201, headers: DAV_HEADERS });
}

async function handleMkcol(request, bucket, key) {
  if (!key) return textResponse("The root collection already exists.", 405, DAV_HEADERS);
  const contentLength = request.headers.get("Content-Length");
  // Workers may expose an empty ReadableStream even when an MKCOL request has
  // no entity body. Content-Length is the reliable compatibility signal here.
  if (contentLength && Number(contentLength) > 0) {
    return textResponse("MKCOL request bodies are not supported.", 415);
  }

  const parent = await findResource(bucket, parentKey(key));
  if (!parent || parent.kind !== "directory") {
    return textResponse("Parent collection does not exist.", 409);
  }
  if (await findResource(bucket, key)) {
    return textResponse("Destination already exists.", 405, DAV_HEADERS);
  }

  await bucket.put(collectionMarker(key), new Uint8Array(), {
    httpMetadata: { contentType: "application/x-webdav-collection" },
    customMetadata: { webdav: "collection" },
  });
  return new Response(null, { status: 201, headers: DAV_HEADERS });
}

async function handleDelete(bucket, key) {
  if (!key) return textResponse("The root collection cannot be deleted.", 403);
  const resource = await findResource(bucket, key);
  if (!resource) return textResponse("Not found.", 404);

  if (resource.kind === "file") {
    await bucket.delete(key);
  } else {
    await deleteCollection(bucket, key);
  }
  return new Response(null, { status: 204, headers: DAV_HEADERS });
}

async function deleteCollection(bucket, key) {
  let cursor;
  const prefix = collectionPrefix(key);
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function handleCopyOrMove(request, bucket, sourceKey, isMove) {
  if (!sourceKey) return textResponse("The root collection cannot be copied or moved.", 403);
  const source = await findResource(bucket, sourceKey);
  if (!source) return textResponse("Source not found.", 404);

  let destination;
  try {
    destination = destinationKey(request);
  } catch {
    return textResponse("Invalid Destination header.", 400);
  }
  if (!destination.key || destination.key === sourceKey) {
    return textResponse("Invalid destination.", 403);
  }
  if (source.kind === "file" && destination.hadTrailingSlash) {
    return textResponse("A file cannot be copied to a collection path.", 409);
  }

  const sourcePrefix = collectionPrefix(sourceKey);
  if (source.kind === "directory" && destination.key.startsWith(sourcePrefix)) {
    return textResponse("Destination cannot be inside the source collection.", 403);
  }

  const depth = request.headers.get("Depth");
  if (isMove && depth && depth.toLowerCase() !== "infinity") {
    return textResponse("MOVE requires Depth: infinity.", 400);
  }
  if (!isMove && source.kind === "directory" && depth && !["0", "infinity"].includes(depth.toLowerCase())) {
    return textResponse("COPY supports Depth: 0 or infinity for collections.", 400);
  }

  const destinationParent = await findResource(bucket, parentKey(destination.key));
  if (!destinationParent || destinationParent.kind !== "directory") {
    return textResponse("Destination parent collection does not exist.", 409);
  }

  const existingDestination = await findResource(bucket, destination.key);
  const overwrite = (request.headers.get("Overwrite") || "T").toUpperCase() !== "F";
  if (existingDestination && !overwrite) return textResponse("Destination already exists.", 412);
  if (existingDestination) {
    if (existingDestination.kind === "file") await bucket.delete(destination.key);
    else await deleteCollection(bucket, destination.key);
  }

  if (source.kind === "file") {
    await copyFile(bucket, source.key, destination.key);
  } else if (!isMove && depth?.toLowerCase() === "0") {
    await createCollectionMarker(bucket, destination.key);
  } else {
    await copyCollection(bucket, source.key, destination.key);
  }

  if (isMove) {
    if (source.kind === "file") await bucket.delete(source.key);
    else await deleteCollection(bucket, source.key);
  }

  return new Response(null, { status: existingDestination ? 204 : 201, headers: DAV_HEADERS });
}

function destinationKey(request) {
  const header = request.headers.get("Destination");
  if (!header) throw new Error("missing destination");
  const destination = new URL(header, request.url);
  const current = new URL(request.url);
  if (destination.origin !== current.origin || destination.search || destination.hash) throw new Error("cross-origin destination");
  return { key: pathToKey(destination.pathname), hadTrailingSlash: destination.pathname.endsWith("/") };
}

async function createCollectionMarker(bucket, key) {
  await bucket.put(collectionMarker(key), new Uint8Array(), {
    httpMetadata: { contentType: "application/x-webdav-collection" },
    customMetadata: { webdav: "collection" },
  });
}

async function copyFile(bucket, sourceKey, destinationKey) {
  const source = await bucket.get(sourceKey);
  if (!source) throw new Error("source disappeared during copy");
  await bucket.put(destinationKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });
}

async function copyCollection(bucket, sourceKey, destinationKey) {
  const sourcePrefix = collectionPrefix(sourceKey);
  const destinationPrefix = collectionPrefix(destinationKey);
  await createCollectionMarker(bucket, destinationKey);

  let cursor;
  do {
    const page = await bucket.list({ prefix: sourcePrefix, cursor, limit: 1000 });
    for (const listedObject of page.objects) {
      const source = await bucket.get(listedObject.key);
      if (!source) throw new Error("source disappeared during collection copy");
      const suffix = listedObject.key.slice(sourcePrefix.length);
      await bucket.put(`${destinationPrefix}${suffix}`, source.body, {
        httpMetadata: source.httpMetadata,
        customMetadata: source.customMetadata,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function handlePropfind(request, bucket, key) {
  const resource = await findResource(bucket, key);
  if (!resource) return textResponse("Not found.", 404);

  // Android backup clients and OpenList generally send Depth: 0 or 1. A missing
  // header is treated as 1 for practical client compatibility. Rejecting an
  // unbounded recursive listing avoids runaway R2 operations on a Worker.
  const depth = (request.headers.get("Depth") || "1").toLowerCase();
  if (!["0", "1"].includes(depth)) {
    return xmlError("propfind-finite-depth", 403);
  }

  const resources = [resource];
  if (depth === "1" && resource.kind === "directory") {
    const children = await listCollectionChildren(bucket, resource.key);
    resources.push(...children);
  }

  const body = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${resources.map(resourceToXml).join("\n")}\n</D:multistatus>`;
  return new Response(body, {
    status: 207,
    headers: { "Content-Type": "application/xml; charset=utf-8", ...DAV_HEADERS },
  });
}

async function listCollectionChildren(bucket, key) {
  const prefix = collectionPrefix(key);
  const page = await bucket.list({ prefix, delimiter: "/", limit: 1000 });
  const children = [];

  for (const object of page.objects) {
    if (object.key === prefix) continue; // the explicit marker for this collection
    children.push({ kind: "file", key: object.key, object });
  }
  for (const childPrefix of page.delimitedPrefixes) {
    const childKey = childPrefix.endsWith("/") ? childPrefix.slice(0, -1) : childPrefix;
    const marker = await bucket.head(childPrefix);
    children.push({ kind: "directory", key: childKey, object: marker || null });
  }

  return children.sort((left, right) => left.key.localeCompare(right.key));
}

function resourceToXml(resource) {
  const object = resource.object;
  const isDirectory = resource.kind === "directory";
  const properties = [
    `<D:displayname>${xmlEscape(displayNameFor(resource.key))}</D:displayname>`,
    `<D:resourcetype>${isDirectory ? "<D:collection/>" : ""}</D:resourcetype>`,
  ];

  if (!isDirectory) {
    properties.push(`<D:getcontentlength>${object.size}</D:getcontentlength>`);
    properties.push(`<D:getcontenttype>${xmlEscape(object.httpMetadata?.contentType || "application/octet-stream")}</D:getcontenttype>`);
  }
  if (object?.uploaded) {
    properties.push(`<D:getlastmodified>${xmlEscape(new Date(object.uploaded).toUTCString())}</D:getlastmodified>`);
    properties.push(`<D:creationdate>${xmlEscape(new Date(object.uploaded).toISOString())}</D:creationdate>`);
  }
  if (object?.httpEtag || object?.etag) {
    properties.push(`<D:getetag>${xmlEscape(object.httpEtag || quoteETag(object.etag))}</D:getetag>`);
  }

  return `<D:response>\n<D:href>${xmlEscape(hrefFor(resource.key, resource.kind))}</D:href>\n<D:propstat><D:prop>${properties.join("")}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>\n</D:response>`;
}

function xmlError(name, status) {
  const body = `<?xml version="1.0" encoding="utf-8"?><D:error xmlns:D="DAV:"><D:${name}/></D:error>`;
  return new Response(body, { status, headers: { "Content-Type": "application/xml; charset=utf-8", ...DAV_HEADERS } });
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}