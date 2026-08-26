#!/usr/bin/env node

const baseUrl = process.env.STAFF_AUTH_VERIFY_BASE_URL || process.argv[2];
if (!baseUrl) {
  throw new Error(
    "Set STAFF_AUTH_VERIFY_BASE_URL or pass the deployed application URL.",
  );
}

const origin = new URL(baseUrl).origin;
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const noCacheHeaders = {
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function deployedFetch(path, init = {}) {
  const url = new URL(path, origin);
  return fetch(url, {
    ...init,
    headers: { ...noCacheHeaders, ...init.headers },
  });
}

const pageResponse = await deployedFetch(`/staff-login?verify=${nonce}`);
assert(
  pageResponse.ok,
  `Staff login returned ${pageResponse.status} instead of 200.`,
);
const html = await pageResponse.text();
const assetPaths = Array.from(
  new Set(html.match(/\/assets\/[^"'<>\s]+\.js/g) ?? []),
);
assert(
  assetPaths.length > 0,
  "Staff login HTML did not reference client assets.",
);

const assetBodies = await Promise.all(
  assetPaths.map(async (path) => {
    const response = await deployedFetch(`${path}?verify=${nonce}`);
    assert(response.ok, `Client asset ${path} returned ${response.status}.`);
    return response.text();
  }),
);
const client = assetBodies.join("\n");

assert(
  client.includes("Venue ID (for example v_ab12cd34)"),
  "Deployed staff login is missing the venue field.",
);
assert(
  client.includes("Phone or staff account"),
  "Deployed staff login is missing the account field.",
);
assert(
  client.includes("6–8 digit PIN"),
  "Deployed staff login is missing the six-to-eight-digit PIN contract.",
);
assert(
  !client.includes("Demo PIN: 1234"),
  "Deployed staff login still contains the legacy demo PIN keypad.",
);

const serviceWorkerResponse = await deployedFetch(`/sw.js?verify=${nonce}`);
assert(
  serviceWorkerResponse.ok,
  `Service worker returned ${serviceWorkerResponse.status}.`,
);
const serviceWorker = await serviceWorkerResponse.text();
assert(
  serviceWorker.includes('url.pathname.startsWith("/staff")'),
  "Service worker does not classify staff routes as sensitive navigations.",
);

const resetResponse = await deployedFetch(
  "/api/staff/291c946b-d6c1-4121-a09a-e779eb9e68ba/pin/reset",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ temporaryPin: "246810" }),
  },
);
assert(
  resetResponse.status === 401,
  `Unauthenticated PIN rotation returned ${resetResponse.status}; expected the declared protected route to return 401.`,
);

console.log(`Staff authentication deployment verified at ${origin}.`);
