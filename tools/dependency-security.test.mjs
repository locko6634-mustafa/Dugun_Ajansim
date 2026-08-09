import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const readProjectFile = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("bağımlılık audit kapısı ve güvenli transitive sürümler korunur", () => {
  const manifest = JSON.parse(readProjectFile("package.json"));
  const backendManifest = JSON.parse(readProjectFile("backend/package.json"));
  const lockfile = JSON.parse(readProjectFile("package-lock.json"));
  const expectedVersions = {
    "brace-expansion": "1.1.18",
    "fast-uri": "3.1.5",
    "js-yaml": "4.3.1",
    nanoid: "3.3.18"
  };

  assert.equal(manifest.scripts["audit:dependencies"], "npm audit");
  assert.equal(backendManifest.scripts["audit:dependencies"], "npm audit");
  assert.match(manifest.scripts.validate, /npm run validate:dependency-security/);

  for (const [packageName, expectedVersion] of Object.entries(expectedVersions)) {
    const lockedPackage = lockfile.packages[`node_modules/${packageName}`];
    assert.equal(lockedPackage?.version, expectedVersion);
    assert.match(lockedPackage?.integrity ?? "", /^sha512-/);
  }
});

test("kalite workflow'u en az yetki, audit ve immutable action SHA'ları kullanır", () => {
  const workflow = readProjectFile(".github/workflows/quality.yml");
  const expectedShaByAction = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/cache": "0057852bfaa89a56745cba8c7296529d2fc39830"
  };
  const actionReferences = [
    ...workflow.matchAll(/uses:\s+(actions\/(?:checkout|setup-node|cache))@([^\s#]+)/g)
  ];

  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /- run: npm run audit:dependencies/);
  assert.equal(workflow.match(/- run: npm run audit:dependencies/g)?.length, 2);
  assert.equal(actionReferences.length, 5);

  for (const [, actionName, sha] of actionReferences) {
    assert.equal(sha, expectedShaByAction[actionName]);
    assert.match(sha, /^[0-9a-f]{40}$/);
  }
});

test("ortam varyantları ignore edilirken sentetik fixture ve örnekler izlenebilir kalır", () => {
  const expectedIgnoreState = new Map([
    [".env.local", true],
    [".env.staging", true],
    [".env.test", true],
    ["backend/.env.qa", true],
    ["backend/.env.test.local", true],
    [".env.production.example", false],
    ["backend/.env.example", false],
    ["backend/tests/test.env", false]
  ]);

  for (const [relativePath, shouldBeIgnored] of expectedIgnoreState) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", relativePath], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    const expectedStatus = shouldBeIgnored ? 0 : 1;
    assert.equal(result.status, expectedStatus, result.stderr);
  }
});
