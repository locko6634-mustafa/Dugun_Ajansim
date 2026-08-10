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
  assert.match(workflow, /LEGACY_PLAINTEXT_BACKUP_CLEANUP:.*\|\| '0'/);
  assert.match(workflow, /envs:.*LEGACY_PLAINTEXT_BACKUP_CLEANUP/);
  assert.match(deployScript, /--backup-only\) backup_only=1/);
  assert.match(deployScript, /flock -n 9/);
  assert.match(deployScript, /pg_restore --exit-on-error/);
  assert.match(deployScript, /SCHEDULED_BACKUP_COMPLETED=%s/);
  assert.match(deployScript, /SCHEDULED_RETENTION_COMPLETED=1/);
  assert.ok(
    deployScript.indexOf("pg_restore --exit-on-error") <
      deployScript.indexOf("SCHEDULED_BACKUP_COMPLETED=%s")
  );
  assert.ok(
    deployScript.indexOf("pg_restore --exit-on-error") <
      deployScript.indexOf("SCHEDULED_RETENTION_COMPLETED=1")
  );
  assert.ok(
    deployScript.indexOf("SCHEDULED_RETENTION_COMPLETED=1") <
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
  const deployReadme = readProjectFile("deploy/README.md");
  const exampleEnvironment = readProjectFile(".env.production.example");

  assert.match(exampleEnvironment, /^BACKEND_REPLICAS=2$/m);
  assert.match(deployScript, /require_integer_range "BACKEND_REPLICAS" "\$backend_replicas" 2 8/);
  assert.equal(deployScript.match(/--scale backend="\$backend_replicas"/g)?.length, 2);
  assert.match(deployScript, /verify_backend_replicas/);
  assert.match(deployReadme, /--scale backend=2/);
  assert.match(deployReadme, /deploy-production\.sh/);
  assert.doesNotMatch(deployReadme, /git pull --ff-only/);
  assert.doesNotMatch(
    deployReadme,
    /docker compose --env-file \.env\.production -f compose\.production\.yaml up -d --build\s*$/m
  );
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

test("PII bakım döngüsü global operasyon seçeneğini gölgelemez", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");

  assert.match(deployScript, /run_pii_batches\(\) \{\s+local pii_operation="\$1"/);
  assert.doesNotMatch(deployScript, /local operation=/);
  assert.match(deployScript, /node dist\/scripts\/maintainPiiEncryption\.js "\$pii_operation"/);
});

test("file-backed secret modu opt-in kalır ve rollback aynı overlay'i kullanır", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");
  const deployWorkflow = readProjectFile(".github/workflows/deploy.yml");
  const backupWorkflow = readProjectFile(".github/workflows/production-backup.yml");
  const exampleEnvironment = readProjectFile(".env.production.example");
  const overlay = readProjectFile("compose.production.secrets.yaml");

  assert.match(exampleEnvironment, /^USE_FILE_SECRETS=0$/m);
  assert.match(deployWorkflow, /USE_FILE_SECRETS:.*\|\| '0'/);
  assert.match(backupWorkflow, /USE_FILE_SECRETS:.*\|\| '0'/);
  assert.match(deployScript, /compose\+=\(-f compose\.production\.secrets\.yaml\)/);
  assert.match(deployScript, /rollback_compose\+=\(-f compose\.production\.secrets\.yaml\)/);
  assert.match(overlay, /DATABASE_URL: !reset null/);
  assert.match(overlay, /DATA_ENCRYPTION_KEY: !reset null/);
  assert.match(overlay, /BACKUP_ENCRYPTION_KEY: !reset null/);
  assert.match(overlay, /DATABASE_URL_FILE: \/run\/secrets\/database_url_runtime/);
});

test("RLS enforcement yalnız yeni backend sağlıklıyken açılır ve rollback öncesi kapanır", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");
  const rollbackStart = deployScript.indexOf('log "ROLLBACK_STARTED_SHA=$rollback_sha"');
  const rollbackDisable = deployScript.indexOf("set_rls_enforcement false", rollbackStart);
  const rollbackCheckout = deployScript.indexOf('git reset --hard "$rollback_sha"', rollbackStart);
  const firstHealth = deployScript.indexOf('"$PUBLIC_ORIGIN/api/v1/health" >/dev/null');
  const enable = deployScript.indexOf("set_rls_enforcement true", firstHealth);
  const verified = deployScript.indexOf("deployment_verified=1", enable);

  assert.notEqual(rollbackStart, -1);
  assert.ok(rollbackStart < rollbackDisable && rollbackDisable < rollbackCheckout);
  assert.ok(firstHealth < enable && enable < verified);
  assert.match(deployScript, /RLS enforcement kapatılamadığı için eski backend rollback'i/);
});
