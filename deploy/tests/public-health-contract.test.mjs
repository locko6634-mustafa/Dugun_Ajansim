import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const healthScript = readFileSync(new URL("../public-health.sh", import.meta.url), "utf8");
const deployWorkflow = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8"
);
const watchdogWorkflow = readFileSync(
  new URL("../../.github/workflows/production-watchdog.yml", import.meta.url),
  "utf8"
);

test("production health doğrulaması varsayılan olarak strict kalır", () => {
  assert.match(healthScript, /PUBLIC_HEALTHCHECK_MODE:-strict/);
  assert.match(deployWorkflow, /vars\.PUBLIC_HEALTHCHECK_MODE \|\| 'strict'/);
  assert.match(watchdogWorkflow, /vars\.PUBLIC_HEALTHCHECK_MODE \|\| 'strict'/);
});

test("pre-dns doğrulaması yalnız loopback edge rotasını insecure çağırır", () => {
  assert.match(healthScript, /== "pre-dns"/);
  assert.match(healthScript, /--insecure --resolve "\$hostname:\$port:127\.0\.0\.1"/);
  assert.match(healthScript, /PRE_DNS_EDGE_HEALTHY=1/);
  assert.match(healthScript, /PUBLIC_TRAFFIC_HEALTHY=1/);
});

test("deploy ve watchdog health modunu SSH oturumuna taşır", () => {
  assert.match(deployWorkflow, /envs: [^\n]*PUBLIC_HEALTHCHECK_MODE/);
  assert.match(watchdogWorkflow, /envs: [^\n]*PUBLIC_HEALTHCHECK_MODE/);
});
