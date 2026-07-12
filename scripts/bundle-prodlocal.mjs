// Bundles the built Cloudflare Worker into a single, self-contained ESM file that
// the LOCAL Workers runtime (`wrangler dev` / workerd) can load. This is ONLY for
// the prod-local mirror (localhost:8787) — the shared dist/ that `wrangler deploy`
// ships to the Cloudflare edge is left untouched.
//
// Why this is needed: the route-split production build makes the worker entry
// (dist/server/server.js) re-export shared constants so the ~100 lazy route chunks
// can import them, e.g. `export { INSTANT_PAYOUT_PERCENT as I, MANAGEABLE_ROLES as
// M, ROLE_RANK as R, server as default, ... }`. Newer workerd validates EVERY named
// export of the worker module as an entrypoint (WorkerEntrypoint/DurableObject/
// handler) and rejects the non-function ones:
//   "Incorrect type for map entry 'I': the provided value is not of type
//    'function or ExportedHandler'."
// The Cloudflare edge deploy tree-shakes these unused named exports away, so it
// only breaks `wrangler dev`. We fix it by bundling through a tiny wrapper whose
// ONLY export is `default` (the ExportedHandler); the constants collapse to
// internal bindings, and every route chunk + npm dependency (postgres, react, …)
// is inlined so the file can be served with `wrangler dev --no-bundle`.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const serverDir = join(process.cwd(), "dist", "server");
const wrapper = join(serverDir, "_prodlocal_entry.mjs");
const outfile = join(serverDir, "worker.single.js");

// Re-export ONLY `default` (the ExportedHandler) and the RealtimeHub Durable
// Object class — a valid named entrypoint. The route-split entry's other named
// exports (INSTANT_PAYOUT_PERCENT as I, MANAGEABLE_ROLES as M, …) are NOT
// re-exported, so they collapse to internal bindings and workerd stops rejecting
// them as invalid entrypoints.
writeFileSync(
  wrapper,
  'import worker from "./server.js";\n' +
    'export { RealtimeHub } from "./server.js";\n' +
    "export default worker;\n",
);

await build({
  entryPoints: [wrapper],
  bundle: true,
  format: "esm",
  platform: "node",
  // Keep node built-ins + Cloudflare runtime modules external — nodejs_compat
  // provides them at runtime. Everything else (postgres, react, route chunks) is
  // inlined so no bare specifier is left for workerd to resolve.
  external: ["node:*", "cloudflare:*"],
  conditions: ["workerd", "worker", "module", "import"],
  outfile,
  logLevel: "error",
});

console.log(`prod-local worker bundled -> ${outfile}`);
