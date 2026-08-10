import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readProjectFile = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("zamanlanmış yedek aynı şifreli geri-yükleme provasını ve operasyon kilidini kullanır", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");
  const workflow = readProjectFile(".github/workflows/production-backup.yml");

  assert.match(workflow, /cron: "17 1 \* \* \*"/);
  assert.match(workflow, /uses: appleboy\/ssh-action@[0-9a-f]{40}/);
  assert.match(workflow, /fingerprint: \$\{\{ env\.SERVER_HOST_FINGERPRINT \}\}/);
  assert.match(workflow, /bash deploy\/deploy-production\.sh --backup-only/);
  assert.match(deployScript, /--backup-only\) backup_only=1/);
  assert.match(deployScript, /flock -n 9/);
  assert.match(deployScript, /pg_restore --exit-on-error/);
  assert.match(deployScript, /SCHEDULED_BACKUP_COMPLETED=%s/);
  assert.ok(
    deployScript.indexOf("pg_restore --exit-on-error") <
      deployScript.indexOf("SCHEDULED_BACKUP_COMPLETED=%s")
  );
});

test("watchdog yalnız uygulama katmanını onarır ve PostgreSQL arızasını operatöre bırakır", () => {
  const watchdog = readProjectFile("deploy/watchdog.sh");
  const workflow = readProjectFile(".github/workflows/production-watchdog.yml");
  const deployWorkflow = readProjectFile(".github/workflows/deploy.yml");

  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /uses: appleboy\/ssh-action@[0-9a-f]{40}/);
  assert.match(workflow, /bash deploy\/watchdog\.sh/);
  assert.match(watchdog, /reconcile_service backend "\$backend_replicas"/);
  assert.match(watchdog, /reconcile_service frontend 1/);
  assert.doesNotMatch(watchdog, /reconcile_service postgres/);
  assert.match(watchdog, /PostgreSQL sağlıksız; veri katmanı otomatik yeniden başlatılmadı/);
  assert.match(watchdog, /flock -n 9/);
  assert.match(workflow, /group: production-operations/);
  assert.match(deployWorkflow, /group: production-operations/);
});

test("dağıtım ve geri alma en az iki backend replikasını korur", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");
  const exampleEnvironment = readProjectFile(".env.production.example");

  assert.match(exampleEnvironment, /^BACKEND_REPLICAS=2$/m);
  assert.match(deployScript, /require_integer_range "BACKEND_REPLICAS" "\$backend_replicas" 2 8/);
  assert.equal(deployScript.match(/--scale backend="\$backend_replicas"/g)?.length, 2);
  assert.match(deployScript, /verify_backend_replicas/);
});

test("üretim bakım servisleri kesin proxy IP allowlist'ini devralır", () => {
  const compose = readProjectFile("compose.production.yaml");
  const services = ["admin-bootstrap", "pii-maintenance", "data-retention"];

  for (const service of services) {
    const start = compose.indexOf(`  ${service}:`);
    assert.notEqual(start, -1, `${service} servisi bulunamadı`);
    const remainder = compose.slice(start + 2);
    const nextServiceOffset = remainder.search(/\n  [a-z][a-z0-9-]*:\r?\n/);
    const serviceBlock =
      nextServiceOffset === -1
        ? compose.slice(start)
        : compose.slice(start, start + 2 + nextServiceOffset);

    assert.match(
      serviceBlock,
      /TRUST_PROXY: \$\{TRUST_PROXY:\?TRUST_PROXY kesin Traefik IP adresi zorunludur\}/,
      `${service} TRUST_PROXY değerini devralmalıdır`
    );
  }
});
