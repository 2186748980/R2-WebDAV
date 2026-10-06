// Pre-deploy gate: refuses to deploy when the Worker's authentication secrets
// are missing — or when they only exist as plain-text dashboard variables,
// which `wrangler deploy` does NOT carry over (secret bindings are inherited;
// vars absent from wrangler.toml are cleared). Exits non-zero so an npm
// `predeploy` hook stops `wrangler deploy` before a 503-only version ships.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = ["WEBDAV_USERNAME", "WEBDAV_PASSWORD"];
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readScriptName() {
  const config = readFileSync(join(repoRoot, "wrangler.toml"), "utf8");
  const match = /^name\s*=\s*"([^"]+)"/m.exec(config);
  if (!match) throw new Error('wrangler.toml is missing a name = "..." field');
  return match[1];
}

async function listSecretNames(scriptName) {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (token && account) {
    // Workers Builds injects these automatically; prefer the direct API.
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${scriptName}/secrets`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await response.json();
    if (!data.success) throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
    return (data.result || []).map((secret) => secret.name);
  }
  // Locally, fall back to the wrangler CLI (uses the logged-in OAuth session).
  const output = execSync("npx wrangler secret list", {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`Cannot parse wrangler secret list output: ${output.slice(0, 200)}`);
  return JSON.parse(output.slice(start, end + 1)).map((secret) => secret.name);
}

const scriptName = readScriptName();
let present;
try {
  present = await listSecretNames(scriptName);
} catch (error) {
  console.error(`DEPLOY BLOCKED: cannot verify Worker Secrets (${error.message}).`);
  console.error("Fix authentication (wrangler login / CLOUDFLARE_API_TOKEN) and retry, or deploy manually after verifying the secrets exist.");
  process.exit(1);
}

const missing = REQUIRED.filter((name) => !present.includes(name));
if (missing.length > 0) {
  console.error(`DEPLOY BLOCKED: Worker "${scriptName}" is missing required Secrets: ${missing.join(", ")}`);
  console.error("Deploying now would ship a version where every request answers 503 \"WebDAV service is not configured.\"");
  console.error("");
  console.error("Fix (choose one):");
  console.error(`  1. Dashboard → Workers & Pages → ${scriptName} → Settings → Variables and Secrets → Add.`);
  console.error('     Type MUST be "Secret". A dashboard "Text" (plain) variable is wiped by the next deploy.');
  console.error("  2. CLI: npx wrangler secret put WEBDAV_USERNAME && npx wrangler secret put WEBDAV_PASSWORD");
  process.exit(1);
}

console.log(`Secret check passed: ${REQUIRED.join(", ")} present on Worker "${scriptName}".`);
