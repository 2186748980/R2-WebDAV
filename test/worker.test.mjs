import worker from "../src/worker.js";

const encoder = new TextEncoder();

class MemoryR2 {
  constructor() {
    this.objects = new Map();
    this.sequence = 0;
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

  async list({ prefix = "", delimiter, limit = 1000 } = {}) {
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
    return { objects: objects.slice(0, limit), delimitedPrefixes: [...prefixes].sort(), truncated: false };
  }
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

const env = {
  R2_BUCKET: new MemoryR2(),
  WEBDAV_USERNAME: "backup-user",
  WEBDAV_PASSWORD: "test-only-password",
  ASSETS: {
    async fetch(request) {
      return new Response("<!doctype html><title>R2-WebDAV</title>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  },
};
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

async function run() {
  response = await dav("GET", "/panel", { authenticated: false });
  await expectStatus(response, 401, "panel anonymous rejection");

  response = await dav("GET", "/panel");
  await expectStatus(response, 308, "panel redirect");

  response = await dav("GET", "/panel/");
  await expectStatus(response, 200, "panel asset");

  response = await dav("GET", "/panel/api/config");
  await expectStatus(response, 200, "panel config API");
  const panelConfig = await response.json();
  if (panelConfig.serverUrl !== "https://dav.example/" || panelConfig.panelUrl !== "https://dav.example/panel/" || panelConfig.username !== env.WEBDAV_USERNAME) {
    throw new Error("panel config API returned unexpected connection details");
  }

  let response = await dav("OPTIONS", "/");
  await expectStatus(response, 200, "OPTIONS");
  if (!response.headers.get("DAV")?.includes("1")) throw new Error("OPTIONS did not advertise DAV level 1");

  response = await dav("PROPFIND", "/", { authenticated: false, headers: { Depth: "0" } });
  await expectStatus(response, 401, "anonymous request rejection");

  response = await dav("MKCOL", "/backups");
  await expectStatus(response, 201, "create backups directory");

  response = await dav("MKCOL", "/backups/mihomo");
  await expectStatus(response, 201, "create nested directory");

  response = await dav("PUT", "/backups/mihomo/config.yaml", { body: "mixed-port: 7890\nmode: rule\n" });
  await expectStatus(response, 201, "upload configuration");

  response = await dav("PUT", "/backups/mihomo/config.yaml", { body: "mixed-port: 7891\nmode: rule\n" });
  await expectStatus(response, 204, "overwrite configuration");

  response = await dav("PROPFIND", "/backups/mihomo/", { headers: { Depth: "1" } });
  await expectStatus(response, 207, "list directory");
  const listing = await response.text();
  if (!listing.includes("<D:multistatus") || !listing.includes("config.yaml") || !listing.includes("<D:collection/>")) {
    throw new Error("PROPFIND did not return expected WebDAV multistatus XML");
  }

  response = await dav("GET", "/backups/mihomo/config.yaml");
  await expectStatus(response, 200, "download configuration");
  if ((await response.text()) !== "mixed-port: 7891\nmode: rule\n") throw new Error("downloaded content differs from overwritten content");

  response = await dav("HEAD", "/backups/mihomo/config.yaml");
  await expectStatus(response, 200, "HEAD configuration");
  if (!response.headers.get("Content-Length")) throw new Error("HEAD response omitted Content-Length");

  response = await dav("COPY", "/backups/mihomo/config.yaml", {
    headers: { Destination: "https://dav.example/backups/mihomo/config-copy.yaml", Overwrite: "F" },
  });
  await expectStatus(response, 201, "copy configuration");

  response = await dav("MOVE", "/backups/mihomo/config-copy.yaml", {
    headers: { Destination: "https://dav.example/backups/mihomo/sing-box.json", Overwrite: "F" },
  });
  await expectStatus(response, 201, "move configuration");

  response = await dav("DELETE", "/backups/mihomo/config.yaml");
  await expectStatus(response, 204, "delete old configuration");

  response = await dav("DELETE", "/backups/mihomo/sing-box.json");
  await expectStatus(response, 204, "delete moved configuration");

  response = await dav("DELETE", "/backups/mihomo");
  await expectStatus(response, 204, "delete empty directory");

  console.log("WebDAV mock integration tests passed: OPTIONS, auth, MKCOL, PUT overwrite, PROPFIND, GET, HEAD, COPY, MOVE, DELETE.");
}

await run();
