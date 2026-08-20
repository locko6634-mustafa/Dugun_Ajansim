import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

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

test("üretim domaini deploy ve watchdog sağlık kapılarında tek sözleşmedir", () => {
  const exampleEnvironment = readProjectFile(".env.production.example");
  const deployWorkflow = readProjectFile(".github/workflows/deploy.yml");
  const watchdogWorkflow = readProjectFile(".github/workflows/production-watchdog.yml");
  const deployReadme = readProjectFile("deploy/README.md");
  const productionFiles = [exampleEnvironment, deployWorkflow, watchdogWorkflow, deployReadme];

  assert.match(exampleEnvironment, /^APP_DOMAIN=dugunajansim\.com$/m);
  assert.match(deployWorkflow, /^\s*PUBLIC_ORIGIN: https:\/\/dugunajansim\.com$/m);
  assert.match(watchdogWorkflow, /^\s*PUBLIC_ORIGIN: https:\/\/dugunajansim\.com$/m);
  assert.match(deployReadme, /curl -fsS "https:\/\/dugunajansim\.com\/healthz"/);
  assert.match(deployReadme, /curl -fsS "https:\/\/dugunajansim\.com\/api\/v1\/health"/);

  for (const productionFile of productionFiles) {
    assert.doesNotMatch(productionFile, /dugun\.n8n-mustafa\.me/);
  }
});

test("edge proxy Docker API erişimini exact allowlistli internal proxy ile sınırlar", () => {
  const edgeProxy = readProjectFile("deploy/edge-proxy.compose.yaml");

  assert.match(
    edgeProxy,
    /ghcr\.io\/wollomatic\/socket-proxy:1\.13\.0@sha256:0cca81832f3cc99df2b9eca6a25d133b2a2594ab9474bfdc1366fc38495daf97/
  );
  assert.match(edgeProxy, /user: "65534:\$\{DOCKER_GID:\?DOCKER_GID must be set\}"/);
  assert.match(edgeProxy, /SP_ALLOWFROM: "traefik"/);
  assert.match(edgeProxy, /SP_ALLOW_HEAD: "\/_ping"/);
  assert.match(
    edgeProxy,
    /SP_ALLOW_GET: '\/v\[0-9\]\+\\\.\[0-9\]\+\/\(version\|containers\/json\|containers\/\[0-9a-f\]\{64\}\/json\|events\)'/
  );
  assert.match(edgeProxy, /--providers\.docker\.endpoint=tcp:\/\/socket-proxy:2375/);
  assert.doesNotMatch(edgeProxy, /--providers\.docker\.endpoint=unix:/);
  assert.equal(edgeProxy.match(/source: \/var\/run\/docker\.sock/g)?.length, 1);
  assert.match(
    edgeProxy,
    /socket_proxy:\s+name: edge_socket_proxy\s+driver: bridge\s+internal: true/
  );
  assert.match(edgeProxy, /ipv4_address: 172\.30\.0\.2/);
  assert.match(edgeProxy, /- "80:80\/tcp"/);
  assert.match(edgeProxy, /- "443:443\/tcp"/);
});

test("SSH drop-in kalan forwarding ve kullanıcı RC yüzeylerini kapatır", () => {
  const sshPolicy = readProjectFile("deploy/ssh/00-dugun-restrictions.conf");

  assert.match(sshPolicy, /^AllowStreamLocalForwarding no$/m);
  assert.match(sshPolicy, /^PermitUserRC no$/m);
  assert.match(sshPolicy, /^ClientAliveInterval 300$/m);
  assert.match(sshPolicy, /^ClientAliveCountMax 2$/m);
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
  const resultParser = readProjectFile("deploy/parse-pii-maintenance-result.mjs");

  assert.match(deployScript, /run_pii_batches\(\) \{\s+local pii_operation="\$1"/);
  assert.doesNotMatch(deployScript, /local operation=/);
  assert.match(deployScript, /node dist\/scripts\/maintainPiiEncryption\.js "\$1"/);
  assert.match(deployScript, /result_status.*"10"/s);
  assert.doesNotMatch(deployScript, /"bookingApplications":0,"weddings":0,"messageTasks":0/);
  for (const counter of [
    "bookingApplications",
    "weddings",
    "messageTasks",
    "staff",
    "deliveries"
  ]) {
    assert.match(resultParser, new RegExp(`"${counter}"`));
  }
});

test("şifreleme rollout'u trafiği enforcement ve RLS tamamlanana dek kapalı tutar", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");
  const publicHealth = readProjectFile("deploy/public-health.sh");
  const maintenance = deployScript.indexOf('log "MAINTENANCE_TRAFFIC_STOPPING=1"');
  const trafficStop = deployScript.indexOf("stop --timeout 30 frontend backend", maintenance);
  const migration = deployScript.indexOf("run --rm --no-deps -T migrate", trafficStop);
  const internalStart = deployScript.indexOf("--label traefik.enable=false backend", migration);
  const internalHealth = deployScript.indexOf(
    'log "STRICT_BACKEND_INTERNAL_HEALTHY=1"',
    internalStart
  );
  const rollbackClosed = deployScript.indexOf("rollback_window_closed=1", internalHealth);
  const firstBackfill = deployScript.indexOf("run_pii_batches --backfill", rollbackClosed);
  const firstVerify = deployScript.indexOf("--verify-backfill", firstBackfill);
  const deltaBackfill = deployScript.indexOf("run_pii_batches --backfill", firstBackfill + 1);
  const deltaVerify = deployScript.indexOf("--verify-backfill", deltaBackfill);
  const redact = deployScript.indexOf("run_pii_batches --redact-legacy", deltaVerify);
  const verify = deployScript.indexOf("maintainPiiEncryption.js --verify", redact);
  const enable = deployScript.indexOf("\nenable_data_encryption_enforcement\n", verify);
  const rls = deployScript.indexOf("\nset_rls_enforcement true\n", enable);
  const enforcedHealth = deployScript.indexOf('log "STRICT_BACKEND_ENFORCED_HEALTHY=1"', rls);
  const edgeBackend = deployScript.indexOf(
    '--scale backend="$backend_replicas" backend',
    enforcedHealth
  );
  const frontend = deployScript.indexOf("up -d --no-build --no-deps --wait frontend", edgeBackend);
  const publicHealthy = deployScript.indexOf("verify_public_edge_health", frontend);
  const positions = [
    maintenance,
    trafficStop,
    migration,
    internalStart,
    internalHealth,
    rollbackClosed,
    firstBackfill,
    firstVerify,
    deltaBackfill,
    deltaVerify,
    redact,
    verify,
    enable,
    rls,
    enforcedHealth,
    edgeBackend,
    frontend,
    publicHealthy
  ];

  assert.ok(positions.every((position) => position >= 0));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index]);
  }
  assert.match(
    deployScript,
    /enable_data_encryption_enforcement\(\).*postgres_owner_exec.*SELECT public\.enable_data_encryption_enforcement\(\)/s
  );
  assert.match(deployScript, /ROLLBACK_BLOCKED_FORWARD_ONLY=1/);
  assert.match(deployScript, /MAINTENANCE_OUTAGE=1/);
  assert.match(deployScript, /ROLLBACK_BACKUP=%s/);
  assert.match(publicHealth, /PUBLIC_TRAFFIC_HEALTHY=1/);
  assert.ok(
    deployScript.lastIndexOf("verify_public_edge_health") <
      deployScript.lastIndexOf("deployment_verified=1")
  );
});

test("file-backed secret modu production ve rollback için fail-closed zorunludur", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");
  const watchdog = readProjectFile("deploy/watchdog.sh");
  const validator = readProjectFile("deploy/validate-production-secrets.sh");
  const deployWorkflow = readProjectFile(".github/workflows/deploy.yml");
  const backupWorkflow = readProjectFile(".github/workflows/production-backup.yml");
  const exampleEnvironment = readProjectFile(".env.production.example");
  const overlay = readProjectFile("compose.production.secrets.yaml");

  assert.match(exampleEnvironment, /^USE_FILE_SECRETS=1$/m);
  assert.match(
    exampleEnvironment,
    /^BACKUP_ENCRYPTION_KEYRING_SECRET_FILE=\/run\/dugun-ajansim-secrets\/backup-encryption-keyring$/m
  );
  assert.match(
    exampleEnvironment,
    /^PII_BLIND_INDEX_KEYRING_SECRET_FILE=\/run\/dugun-ajansim-secrets\/pii-blind-index-keyring$/m
  );
  assert.match(
    exampleEnvironment,
    /^SMTP_PASSWORD_SECRET_FILE=\/run\/dugun-ajansim-secrets\/smtp-password$/m
  );
  assert.match(
    exampleEnvironment,
    /^PASSWORD_RESET_CODE_HMAC_KEY_SECRET_FILE=\/run\/dugun-ajansim-secrets\/password-reset-code-hmac-key$/m
  );
  assert.match(deployWorkflow, /^\s*USE_FILE_SECRETS: "1"$/m);
  assert.match(backupWorkflow, /^\s*USE_FILE_SECRETS: "1"$/m);
  assert.match(deployScript, /USE_FILE_SECRETS=1 olmadan çalıştırılamaz/);
  assert.match(watchdog, /USE_FILE_SECRETS=1 olmadan çalıştırılamaz/);
  assert.match(deployScript, /validate_production_secret_sources/);
  assert.match(watchdog, /validate_production_secret_sources/);
  assert.match(deployScript, /compose=.*compose\.production\.secrets\.yaml/s);
  assert.match(deployScript, /rollback_compose=.*compose\.production\.secrets\.yaml/s);
  assert.match(deployScript, /\[ -x \/usr\/local\/bin\/with-owner-password\.sh \]/);
  assert.match(
    deployScript,
    /USE_FILE_SECRETS:-0.*POSTGRES_PASSWORD:-.*PGPASSWORD="\$POSTGRES_PASSWORD"/s
  );
  assert.match(deployScript, /secret_file="\$\{PGPASSWORD_FILE:-\$\{POSTGRES_PASSWORD_FILE:-\}\}"/);
  assert.match(
    deployScript,
    /run --rm --no-deps -T.*-e PGHOST=postgres postgres sh \/usr\/local\/bin\/with-owner-password\.sh/s
  );
  assert.match(overlay, /DATABASE_URL: !reset null/);
  assert.match(overlay, /DATA_ENCRYPTION_KEY: !reset null/);
  assert.match(overlay, /SMTP_PASSWORD: !reset null/);
  assert.match(overlay, /SMTP_PASSWORD_FILE: \/run\/secrets\/smtp_password/);
  assert.match(overlay, /smtp_password:[\s\S]*?SMTP_PASSWORD_SECRET_FILE/);
  assert.match(overlay, /PASSWORD_RESET_CODE_HMAC_KEY: !reset null/);
  assert.match(
    overlay,
    /PASSWORD_RESET_CODE_HMAC_KEY_FILE: \/run\/secrets\/password_reset_code_hmac_key/
  );
  assert.match(
    overlay,
    /password_reset_code_hmac_key:[\s\S]*?PASSWORD_RESET_CODE_HMAC_KEY_SECRET_FILE/
  );
  assert.match(overlay, /BACKUP_ENCRYPTION_KEYRING_JSON: !reset null/);
  assert.match(
    overlay,
    /PII_BLIND_INDEX_KEYRING_JSON_FILE: \/run\/secrets\/pii_blind_index_keyring/
  );
  assert.match(overlay, /DATABASE_URL_FILE: \/run\/secrets\/database_url_runtime/);
  assert.match(validator, /izinleri non-root container erişimi için 444 olmalıdır/);
  assert.match(validator, /birden fazla hard link içeremez/);
  assert.match(validator, /dağıtım kullanıcısına ait olmalıdır/);
  assert.match(validator, /1-65536 bayt aralığında olmalıdır/);
  assert.match(validator, /NUL baytı içeremez/);
});

test("production secret kaynak doğrulayıcısı eksik ve gevşek izinli dosyaları reddeder", () => {
  const shellTest = "deploy/tests/production-secret-sources.test.sh";
  const executable = process.platform === "win32" ? "docker" : "bash";
  const args =
    process.platform === "win32"
      ? [
          "run",
          "--rm",
          "--mount",
          `type=bind,source=${repositoryRoot},target=/workspace,readonly`,
          "-w",
          "/workspace",
          "postgres:17-alpine",
          "bash",
          shellTest
        ]
      : [shellTest];
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Production secret kaynak kontrolleri geçti\./);
});

test("RLS enforcement iç sağlık sonrası ve edge açılmadan önce etkinleşir; rollback öncesi kapanır", () => {
  const deployScript = readProjectFile("deploy/deploy-production.sh");
  const rollbackStart = deployScript.indexOf('log "ROLLBACK_STARTED_SHA=$rollback_sha"');
  const rollbackDisable = deployScript.indexOf("set_rls_enforcement false", rollbackStart);
  const rollbackCheckout = deployScript.indexOf('git reset --hard "$rollback_sha"', rollbackStart);
  const internalHealth = deployScript.indexOf('log "STRICT_BACKEND_INTERNAL_HEALTHY=1"');
  const enable = deployScript.indexOf("set_rls_enforcement true", internalHealth);
  const edgeBackend = deployScript.indexOf('--scale backend="$backend_replicas" backend', enable);

  assert.notEqual(rollbackStart, -1);
  assert.ok(rollbackStart < rollbackDisable && rollbackDisable < rollbackCheckout);
  assert.ok(internalHealth < enable && enable < edgeBackend);
  assert.match(deployScript, /RLS enforcement kapatılamadığı için eski backend rollback'i/);
});
