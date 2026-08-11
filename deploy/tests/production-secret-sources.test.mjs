import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const validator = readFileSync(
  new URL("../validate-production-secrets.sh", import.meta.url),
  "utf8"
);
const environmentExample = readFileSync(
  new URL("../../.env.production.example", import.meta.url),
  "utf8"
);

test("production secret kökü env sözleşmesinden ve kanonik yoldan doğrulanır", () => {
  assert.match(validator, /PRODUCTION_SECRET_ROOT/);
  assert.match(validator, /canonical_secret_root=.*pwd -P/);
  assert.match(validator, /canonical_secret_root" == "\$secret_root/);
  assert.match(environmentExample, /^PRODUCTION_SECRET_ROOT=\/run\/dugun-ajansim-secrets$/m);
});

test("korumalı kökte Compose salt-okunur secret modu kabul edilir", () => {
  assert.match(validator, /secret_root_mode" == "700"/);
  assert.match(validator, /secret_mode" == "444"/);
  assert.doesNotMatch(validator, /secret_mode" == "644"/);
});
