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
  const productionCompose = readProjectFile("compose.production.yaml");
  const postgresDockerfile = readProjectFile("deploy/postgres/Dockerfile");
  const expectedShaByAction = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/cache": "0057852bfaa89a56745cba8c7296529d2fc39830",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
    "docker/setup-buildx-action": "8d2750c68a42422c14e847fe6c8ac0403b4cbd6f",
    "docker/build-push-action": "f9f3042f7e2789586610d6e8b85c8f03e5195baf"
  };
  const actionReferences = [
    ...workflow.matchAll(
      /uses:\s+((?:actions\/(?:checkout|setup-node|cache|upload-artifact)|docker\/(?:setup-buildx-action|build-push-action)))@([^\s#]+)/g
    )
  ];

  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /- run: npm run audit:dependencies/);
  assert.equal(workflow.match(/- run: npm run audit:dependencies/g)?.length, 2);
  assert.equal(workflow.match(/node-version: 22\.23\.2/g)?.length, 3);
  assert.match(
    workflow,
    /image: postgres:17\.10-alpine3\.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4/
  );
  assert.match(workflow, /ports:\s*\n\s+- 5432\/tcp/);
  assert.doesNotMatch(workflow, /55632:5432/);
  assert.match(workflow, /POSTGRES_HOST_PORT: \$\{\{ job\.services\.postgres\.ports\[5432\] \}\}/);
  assert.match(workflow, /TEST_DATABASE_PORT=\$\{POSTGRES_HOST_PORT\}/);
  assert.match(workflow, /DATABASE_URL=.*localhost:\$\{POSTGRES_HOST_PORT\}/);
  assert.match(productionCompose, /image: dugun-ajansim-postgres/);
  assert.match(
    postgresDockerfile,
    /^FROM postgres:17\.10-alpine3\.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4 AS patched$/m
  );
  assert.match(postgresDockerfile, /^FROM scratch$/m);
  assert.match(postgresDockerfile, /^COPY --from=patched \/ \/$/m);
  assert.match(postgresDockerfile, /apk add --no-cache "su-exec=0\.3-r0"/);
  assert.match(postgresDockerfile, /rm -f \/usr\/local\/bin\/gosu/);
  assert.equal(actionReferences.length, 14);

  for (const [, actionName, sha] of actionReferences) {
    assert.equal(sha, expectedShaByAction[actionName]);
    assert.match(sha, /^[0-9a-f]{40}$/);
  }
});

test("Phase06 cache kapsamları ve süre ölçümlü aşamalar korunur", () => {
  const workflow = readProjectFile(".github/workflows/quality.yml");
  const phase06Script = readProjectFile("tools/run-phase06-quality.ps1");

  assert.match(
    workflow,
    /key: phase06-playwright-\$\{\{ runner\.os \}\}-\$\{\{ steps\.phase06-playwright-version\.outputs\.version \}\}/
  );
  assert.match(workflow, /if: steps\.phase06-playwright-cache\.outputs\.cache-hit != 'true'/);
  for (const scope of ["postgres", "migrate", "backend", "frontend"]) {
    assert.match(workflow, new RegExp(`cache-from: type=gha,scope=phase06-${scope}`));
    assert.match(workflow, new RegExp(`cache-to: type=gha,mode=max,scope=phase06-${scope}`));
  }
  for (const phase of ["boot", "test", "cleanup"]) {
    assert.match(
      workflow,
      new RegExp(`run: \\.\\/tools\\/run-phase06-quality\\.ps1 -Phase ${phase}`)
    );
  }
  assert.match(workflow, /if: always\(\) && steps\.phase06-boot\.outcome != 'skipped'/);
  assert.match(phase06Script, /ValidateSet\("all", "build", "boot", "test", "cleanup"\)/);
  assert.match(phase06Script, /PHASE06_TIMING phase=\$name durationSeconds=\$seconds/);
  assert.match(phase06Script, /GITHUB_STEP_SUMMARY/);
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
    ["backend/tests/test.env", false],
    [".npmrc", true],
    ["certificate.p12", true],
    ["certificate.pfx", true],
    ["keystore.jks", true],
    ["id_rsa", true],
    ["id_ed25519", true],
    ["putty.ppk", true]
  ]);

  for (const [relativePath, shouldBeIgnored] of expectedIgnoreState) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", relativePath], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    const expectedStatus = shouldBeIgnored ? 0 : 1;
    assert.equal(result.status, expectedStatus, result.stderr);
  }

  const dockerIgnore = readProjectFile(".dockerignore");
  for (const pattern of [".npmrc", "*.p12", "*.pfx", "*.jks", "id_rsa", "id_ed25519", "*.ppk"]) {
    const escapedPattern = pattern.replaceAll(".", "\\.").replaceAll("*", ".*");
    assert.match(dockerIgnore, new RegExp(`^${escapedPattern}$`, "m"));
  }
});
