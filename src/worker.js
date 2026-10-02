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

    if (!isAuthorized(request, env)) {
      return finalize(new Response("Authentication required.", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Cloudflare R2 WebDAV", charset="UTF-8"',
          ...DAV_HEADERS,
        },
      }));
    }

    if (url.pathname === "/panel") {
      return finalize(Response.redirect(new URL("/panel/", request.url), 308));
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
  if (request.method !== "GET") return textResponse("Method not allowed.", 405);

  if (url.pathname === "/panel/api/config") {
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

  return textResponse("Not found.", 404);
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
  if (!key) return textResponse("A collection cannot be downloaded as a file.", 405, DAV_HEADERS);

  const directory = await findResource(bucket, key);
  if (directory?.kind === "directory") {
    return textResponse("A collection cannot be downloaded as a file.", 405, DAV_HEADERS);
  }

  const metadata = await bucket.head(key);
  if (!metadata) return textResponse("Not found.", 404);

  const etag = metadata.httpEtag || quoteETag(metadata.etag);
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers: objectHeaders(metadata, etag) });
  }

  const range = parseRange(request.headers.get("Range"), metadata.size);
  if (request.headers.has("Range") && !range) {
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

function parseRange(header, size) {
  if (!header || size === 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (!startText && !endText) return null;

  let offset;
  let end;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    offset = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    offset = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset || offset >= size) return null;
    end = Math.min(end, size - 1);
  }
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
