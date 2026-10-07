// Post-deploy verification: confirms the LIVE worker can actually serve.
// A 503 "service is not configured" means the deployed version lost its
// authentication secrets; a 3xx on /panel means the redirect-loop regression
// came back. Exit code 1 in both cases so CI fails loudly.
//
// Usage: node scripts/verify-deployment.mjs [baseUrl] [--wait seconds]
// Without --wait a single check runs. With --wait N the checks poll every
// 10 seconds for up to N seconds, to ride out deploy propagation delay.

const args = process.argv.slice(2);
const waitIndex = args.indexOf("--wait");
const waitSeconds = waitIndex >= 0 ? Number(args[waitIndex + 1]) || 0 : 0;
const base = (args.find((arg) => !arg.startsWith("--") && arg !== String(waitSeconds)) || "https://r2-webdav.2186.workers.dev").replace(/\/+$/, "");

const SECRETS_HINT = "Fix: Dashboard → Workers & Pages → r2-webdav → Settings → Variables and Secrets → re-add WEBDAV_USERNAME / WEBDAV_PASSWORD with type \"Secret\" (a dashboard \"Text\" variable is wiped by the next deploy), or run npx wrangler secret put.";

async function checkOnce() {
  const problems = [];

  let root;
  try {
    root = await fetch(base + "/", { redirect: "manual", headers: { "User-Agent": "r2-webdav-deploy-check" } });
  } catch (error) {
    return [`GET / unreachable from this network (${error.cause?.code || error.message}). The check needs a network path to workers.dev; GitHub Actions runners and Cloudflare build containers have one.`];
  }

  if (root.status === 503) {
    const body = await root.text();
    if (/not configured/i.test(body)) {
      problems.push(`GET / -> 503 "service is not configured": WEBDAV_USERNAME / WEBDAV_PASSWORD are missing on the live version. ${SECRETS_HINT}`);
    } else {
      problems.push(`GET / -> unexpected 503: ${body.slice(0, 120)}`);
    }
    return problems;
  }
  if (root.status === 401) {
    if (!(root.headers.get("www-authenticate") || "").includes("Basic")) {
      problems.push("GET / -> 401 but without a Basic WWW-Authenticate challenge; WebDAV clients cannot authenticate.");
    }
  } else if (root.status === 200) {
    problems.push(`GET / -> 200 without credentials; the Basic Auth gate is not active.`);
  } else {
    problems.push(`GET / -> unexpected HTTP ${root.status}.`);
  }

  const panel = await fetch(base + "/panel", { redirect: "manual", headers: { "User-Agent": "r2-webdav-deploy-check" } });
  const location = panel.headers.get("location");
  if (panel.status === 503) {
    const body = await panel.text();
    if (/not configured/i.test(body)) {
      problems.push(`GET /panel -> 503 "service is not configured": secrets missing on the live version. ${SECRETS_HINT}`);
    } else {
      problems.push(`GET /panel -> unexpected 503: ${body.slice(0, 120)}`);
    }
  } else if (panel.status !== 200) {
    problems.push(`GET /panel -> HTTP ${panel.status}${location ? ` with Location: ${location}` : ""}; expected 200 (public shell). A 3xx here is the ERR_TOO_MANY_REDIRECTS regression.`);
  } else {
    if (location) problems.push(`GET /panel -> 200 but with a Location header (${location}); redirect responses on /panel are forbidden.`);
    if (!(panel.headers.get("content-type") || "").includes("text/html")) {
      problems.push("GET /panel -> 200 but not text/html; the login shell is not being served.");
    }
    // The API must stay authenticated even though the shell is public.
    const apiProbe = await fetch(base + "/panel/api/health", { redirect: "manual", headers: { "User-Agent": "r2-webdav-deploy-check" } });
    if (apiProbe.status !== 401 || !(apiProbe.headers.get("www-authenticate") || "").includes("Basic")) {
      problems.push(`GET /panel/api/health unauthenticated -> HTTP ${apiProbe.status}; expected 401 with a Basic challenge (auth gate lost).`);
    }
  }
  return problems;
}

const deadline = Date.now() + waitSeconds * 1000;
let problems = await checkOnce();
while (problems.length > 0 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  problems = await checkOnce();
}

if (problems.length > 0) {
  console.error(`DEPLOYMENT VERIFICATION FAILED for ${base}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Deployment verification passed for ${base}: auth gate active, /panel serves the public shell without redirects, API requires Basic auth.`);
