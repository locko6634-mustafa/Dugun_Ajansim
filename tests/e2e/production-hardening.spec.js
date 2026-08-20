import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const readProjectFile = (relativePath) =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("production container ve dağıtım korumaları yapılandırmada kalır", async () => {
  const [
    backendDockerfile,
    frontendDockerfile,
    compose,
    nginx,
    exampleEnv,
    deployReadme,
    deployWorkflow,
    bootstrapAdmin,
    runtimeRoleScript,
    runtimeTimeoutScript,
    deployScript,
    publicHealth,
    backupCrypto,
    homePage,
    homeBootstrap,
    packageBuilderApplication,
    packageBuilderPage,
    customerPanelApplication,
    deliveryLink
  ] = await Promise.all([
    readProjectFile("backend/Dockerfile"),
    readProjectFile("Dockerfile"),
    readProjectFile("compose.production.yaml"),
    readProjectFile("deploy/nginx.conf"),
    readProjectFile(".env.production.example"),
    readProjectFile("deploy/README.md"),
    readProjectFile(".github/workflows/deploy.yml"),
    readProjectFile("backend/src/scripts/bootstrapAdmin.ts"),
    readProjectFile("deploy/postgres/init-runtime-role.sh"),
    readProjectFile("deploy/postgres/configure-runtime-timeouts.sh"),
    readProjectFile("deploy/deploy-production.sh"),
    readProjectFile("deploy/public-health.sh"),
    readProjectFile("deploy/backup-crypto.mjs"),
    readProjectFile("index.html"),
    readProjectFile("js/home/bootstrap.js"),
    readProjectFile("js/package-builder/application.js"),
    readProjectFile("paketini-olustur.html"),
    readProjectFile("js/customer-panel/app.js"),
    readProjectFile("js/shared/delivery-link.js")
  ]);

  expect(backendDockerfile).toContain("FROM build AS migrate");
  expect(backendDockerfile).toContain("npm prune --omit=dev --omit=peer");
  expect(backendDockerfile).toContain(
    "COPY --from=production-dependencies /app/package.json ./package.json"
  );
  expect(backendDockerfile.match(/^FROM node:[^\s]+/gm)).toEqual([
    expect.stringMatching(/^FROM node:[^@\s]+@sha256:[0-9a-f]{64}$/),
    expect.stringMatching(/^FROM node:[^@\s]+@sha256:[0-9a-f]{64}$/),
    expect.stringMatching(/^FROM node:[^@\s]+@sha256:[0-9a-f]{64}$/)
  ]);
  expect(backendDockerfile).toContain("AS backup-crypto");
  expect(backendDockerfile).toContain("COPY deploy/backup-crypto.mjs ./backup-crypto.mjs");
  expect(backendDockerfile).toContain("org.opencontainers.image.revision");

  expect(frontendDockerfile).toContain("USER nginx");
  expect(frontendDockerfile).toContain("EXPOSE 8080");
  expect(frontendDockerfile).toContain("http://127.0.0.1:8080/healthz");
  expect(frontendDockerfile).toMatch(/chown -R nginx:nginx[\s\\]*[\s\S]*\/run/);
  expect(frontendDockerfile).toMatch(/^FROM nginx:[^@\s]+@sha256:[0-9a-f]{64}$/m);
  expect(frontendDockerfile).toContain("org.opencontainers.image.revision");

  expect(compose).toContain("admin-bootstrap:");
  expect(compose).toContain("dist/scripts/bootstrapAdmin.js");
  expect(compose).not.toMatch(/ADMIN_BOOTSTRAP_PASSWORD\s*:/);
  expect(compose).toContain("loadbalancer.server.port=8080");
  expect(compose).toContain("source: ${PUBLIC_MEDIA_DIR:-./storage/public-media}");
  expect(compose).toContain("target: /srv/dugun-ajansim-media");
  expect(compose).toMatch(
    /target: \/srv\/dugun-ajansim-media\s+read_only: true\s+bind:\s+create_host_path: false/
  );
  expect(compose).toContain("pids_limit:");
  expect(compose).toContain("stop_grace_period:");
  expect(compose.match(/^\s+image: dugun-ajansim-postgres$/gm)).toHaveLength(3);
  expect(compose).toContain("dockerfile: deploy/postgres/Dockerfile");
  expect(compose.match(/^\s+read_only: true$/gm)?.length).toBeGreaterThanOrEqual(8);
  expect(compose.match(/^\s+init: true$/gm)?.length).toBeGreaterThanOrEqual(7);
  expect(compose).toContain("mem_limit:");
  expect(compose).toContain("mem_reservation:");
  expect(compose).toContain("cpus:");
  expect(compose).toContain("POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256");
  expect(compose).toContain("db-runtime-hardening:");
  expect(compose).toContain("POSTGRES_RUNTIME_STATEMENT_TIMEOUT_MS:");
  expect(compose).toContain("POSTGRES_RUNTIME_LOCK_TIMEOUT_MS:");
  expect(compose).toContain("POSTGRES_RUNTIME_IDLE_TRANSACTION_TIMEOUT_MS:");
  expect(compose).toContain("backup-crypto:");
  expect(compose).toContain("BACKUP_ENCRYPTION_ACTIVE_KEY_ID:");
  expect(compose).toContain("BACKUP_ENCRYPTION_KEYRING_JSON:");
  expect(compose).toContain("APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS:");
  expect(compose).toContain("network_mode: none");
  expect(compose).toContain('max-size: "10m"');
  expect(compose).toContain("ADMIN_SESSION_IDLE_MINUTES:");
  expect(compose).toContain("ADMIN_SESSION_TTL_HOURS:");
  expect(compose).toContain("CUSTOMER_SESSION_IDLE_HOURS:");
  expect(compose).toContain("TEMPORARY_PASSWORD_TTL_HOURS:");
  expect(compose).toContain("APP_PROCESS_ROLE: api");
  expect(compose).toContain("APP_PROCESS_ROLE: admin-bootstrap");
  expect(compose).toContain("APP_PROCESS_ROLE: pii-maintenance");
  expect(compose).toContain("APP_PROCESS_ROLE: data-retention");
  expect(compose).toContain("data-retention:");
  expect(compose).toContain("PII_ENCRYPTION_MODE: ${PII_ENCRYPTION_MODE:-strict}");
  const adminBootstrapEnvironment = compose.match(
    /admin-bootstrap:[\s\S]*?environment:([\s\S]*?)depends_on:/
  )?.[1];
  const piiMaintenanceEnvironment = compose.match(
    /pii-maintenance:[\s\S]*?environment:([\s\S]*?)depends_on:/
  )?.[1];
  expect(adminBootstrapEnvironment).not.toContain("PII_BLIND_INDEX_KEY");
  expect(adminBootstrapEnvironment).not.toContain("RATE_LIMIT_HMAC_KEY");
  expect(adminBootstrapEnvironment).not.toContain("DATA_ENCRYPTION_KEY:");
  expect(piiMaintenanceEnvironment).not.toContain("DATA_ENCRYPTION_KEY:");
  expect(piiMaintenanceEnvironment).not.toContain("RATE_LIMIT_HMAC_KEY");
  expect(compose).toMatch(
    /data-retention:[\s\S]*?APP_PROCESS_ROLE: data-retention[\s\S]*?PUBLIC_APPLICATION_RETENTION_DAYS:/
  );
  expect(compose).toContain("TRUST_PROXY: ${TRUST_PROXY:?");
  expect(compose).not.toMatch(/TRUST_PROXY:\s*1(?:\s|$)/);
  expect(compose).toContain(
    "dugun-ajansim-edge-ratelimit,dugun-ajansim-edge-inflight,dugun-ajansim-compress"
  );
  expect(compose).toContain(
    "dugun-ajansim-edge-ratelimit.ratelimit.average=${EDGE_RATE_LIMIT_AVERAGE:-20}"
  );
  expect(compose).toContain(
    "dugun-ajansim-edge-ratelimit.ratelimit.period=${EDGE_RATE_LIMIT_PERIOD:-1s}"
  );
  expect(compose).toContain(
    "dugun-ajansim-edge-ratelimit.ratelimit.burst=${EDGE_RATE_LIMIT_BURST:-40}"
  );
  expect(compose).toContain(
    "dugun-ajansim-edge-ratelimit.ratelimit.sourcecriterion.ipstrategy.ipv6subnet=${EDGE_RATE_LIMIT_IPV6_SUBNET:-56}"
  );
  expect(compose).toContain(
    "dugun-ajansim-edge-inflight.inflightreq.amount=${EDGE_INFLIGHT_REQUESTS:-50}"
  );
  expect(compose).toContain(
    "dugun-ajansim-edge-inflight.inflightreq.sourcecriterion.requesthost=true"
  );
  expect(compose).toContain("db-role-bootstrap:");
  expect(compose).toContain(
    "./deploy/postgres/init-runtime-role.sh:/docker-entrypoint-initdb.d/20-runtime-role.sh:ro"
  );
  expect(compose).toMatch(
    /migrate:[\s\S]*?DATABASE_URL: postgresql:\/\/\$\{POSTGRES_USER:-dugun_app\}:\$\{POSTGRES_PASSWORD:-file-secret-required\}@postgres/
  );
  expect(compose).toMatch(
    /backend:[\s\S]*?DATABASE_URL: postgresql:\/\/\$\{POSTGRES_RUNTIME_USER:-dugun_runtime\}:\$\{POSTGRES_RUNTIME_PASSWORD:-file-secret-required\}@postgres/
  );
  expect(compose).toMatch(
    /seed:[\s\S]*?depends_on:\s*\n\s*db-runtime-hardening:\s*\n\s*condition: service_completed_successfully/
  );
  expect(compose).toMatch(
    /db-role-bootstrap:[\s\S]*?depends_on:\s*\n\s*migrate:\s*\n\s*condition: service_completed_successfully/
  );

  expect(nginx).toContain("listen 8080 default_server");
  expect(nginx).toContain("max-age=3600, must-revalidate");
  expect(nginx).toContain('Cache-Control "no-store"');
  expect(nginx).toContain("Content-Security-Policy");
  expect(nginx).toContain("location ^~ /media/");
  expect(nginx).toContain("alias /srv/dugun-ajansim-media/");
  expect(nginx).toContain('Cache-Control "public, max-age=86400, must-revalidate"');
  expect(nginx).not.toContain("supabase.co");
  expect(nginx.match(/script-src [^;]+/g)).not.toBeNull();
  expect(nginx.match(/script-src [^;]+/g)).toEqual(
    expect.arrayContaining([expect.not.stringContaining("'unsafe-inline'")])
  );
  expect(nginx).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  expect(nginx).toContain("script-src 'self' https://challenges.cloudflare.com");
  expect(nginx).toContain("frame-src https://challenges.cloudflare.com");
  expect(nginx).not.toContain("immutable");
  expect(nginx).not.toContain("expires 1y");

  expect(homePage).toContain('<script src="js/home/bootstrap.js"></script>');
  expect(homePage.match(/data-src="\/media\/videos\/[a-z0-9-]+\.mp4"/g)).toHaveLength(5);
  expect(homePage).not.toContain("supabase.co");
  expect(homePage).not.toMatch(/\sonload\s*=/i);
  expect(homePage).not.toContain('document.documentElement.classList.add("js")');
  expect(homeBootstrap).toContain('document.documentElement.classList.add("js")');
  expect(packageBuilderApplication).toContain('"Turnstile-Token": state.botChallengeToken');
  expect(packageBuilderApplication).toContain('"X-Booking-Elapsed-Ms"');
  expect(packageBuilderApplication).toContain('"X-Booking-Website"');
  expect(packageBuilderApplication).toContain("turnstile.render(container");
  expect(packageBuilderPage).toContain("js-turnstile");
  expect(packageBuilderPage).toContain('name="companyWebsite"');
  expect(packageBuilderApplication).not.toContain("paymentFlowKey:");
  expect(packageBuilderApplication).not.toContain('"Payment-Flow-Key"');
  expect(customerPanelApplication).toContain(
    'import { normalizeDeliveryLinkUrl } from "../shared/delivery-link.js"'
  );
  expect(deliveryLink).toContain(
    '["drive.google.com", "docs.google.com", "we.tl", "wetransfer.com"]'
  );
  expect(deliveryLink).toContain('normalized.endsWith(".wetransfer.com")');

  expect(exampleEnv).toMatch(/^POSTGRES_PASSWORD=$/m);
  expect(exampleEnv).toMatch(/^PUBLIC_MEDIA_DIR=\.\/storage\/public-media$/m);
  expect(exampleEnv).toMatch(/^POSTGRES_RUNTIME_USER=dugun_runtime$/m);
  expect(exampleEnv).toMatch(/^POSTGRES_RUNTIME_PASSWORD=$/m);
  expect(exampleEnv).toMatch(/^DATA_ENCRYPTION_KEY=$/m);
  expect(exampleEnv).toMatch(/^APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS=$/m);
  expect(exampleEnv).toMatch(/^USE_FILE_SECRETS=1$/m);
  expect(exampleEnv).toMatch(/^BACKUP_ENCRYPTION_ACTIVE_KEY_ID=backup-[A-Za-z0-9._-]+$/m);
  expect(exampleEnv).toMatch(/^BACKUP_ENCRYPTION_KEYRING_JSON=$/m);
  expect(exampleEnv).toMatch(/^PII_BLIND_INDEX_ACTIVE_KEY_ID=blind-[A-Za-z0-9._-]+$/m);
  expect(exampleEnv).toMatch(/^PII_BLIND_INDEX_KEYRING_JSON=$/m);
  expect(exampleEnv).toContain("POSTGRES_RUNTIME_STATEMENT_TIMEOUT_MS=30000");
  expect(exampleEnv).toContain("POSTGRES_MEMORY_LIMIT=2g");
  expect(exampleEnv).toContain("BACKEND_MEMORY_LIMIT=768m");
  expect(exampleEnv).toContain("FRONTEND_MEMORY_LIMIT=256m");
  expect(exampleEnv).toMatch(/^TRUST_PROXY=$/m);
  expect(exampleEnv).toMatch(/^BOT_PROTECTION_MODE=turnstile$/m);
  expect(exampleEnv).toMatch(/^TURNSTILE_SITE_KEY=$/m);
  expect(exampleEnv).toMatch(/^TURNSTILE_SECRET_KEY=$/m);
  expect(exampleEnv).toMatch(/^PII_ENCRYPTION_MODE=strict$/m);
  expect(exampleEnv).toMatch(/^PUBLIC_APPLICATION_RETENTION_DAYS=90$/m);
  expect(exampleEnv).toMatch(/^ARCHIVED_WEDDING_RETENTION_DAYS=3650$/m);
  expect(exampleEnv).toContain("EDGE_RATE_LIMIT_AVERAGE=20");
  expect(exampleEnv).toContain("EDGE_RATE_LIMIT_PERIOD=1s");
  expect(exampleEnv).toContain("EDGE_RATE_LIMIT_BURST=40");
  expect(exampleEnv).toContain("EDGE_RATE_LIMIT_IPV6_SUBNET=56");
  expect(exampleEnv).toContain("EDGE_INFLIGHT_REQUESTS=50");
  expect(exampleEnv).toContain("ADMIN_SESSION_IDLE_MINUTES=240");
  expect(exampleEnv).toContain("ADMIN_SESSION_TTL_HOURS=8");
  expect(exampleEnv).toContain("SALON_SESSION_IDLE_MINUTES=60");
  expect(exampleEnv).toContain("CUSTOMER_SESSION_IDLE_HOURS=12");
  expect(exampleEnv).toContain("TEMPORARY_PASSWORD_TTL_HOURS=24");

  expect(deployReadme).toContain("install -m 600");
  expect(deployReadme).toContain("config -q");
  expect(deployReadme).toContain("Traefik v3");
  expect(deployReadme).toContain("EDGE_RATE_LIMIT_AVERAGE");
  expect(deployReadme).toContain("EDGE_INFLIGHT_REQUESTS");
  expect(deployReadme).toContain("-e ADMIN_BOOTSTRAP_USERNAME -e ADMIN_BOOTSTRAP_PASSWORD");
  expect(deployReadme).toContain("AES-256-GCM");
  expect(deployReadme).toContain("pg_restore --exit-on-error");
  expect(deployReadme).toContain("BACKUP_ENCRYPTION_KEY");
  expect(deployReadme).toContain("otomatik döndürülür");
  expect(deployReadme).toContain("up -d --wait postgres");
  expect(deployReadme).toContain("Mevcut volume'u DDL yetkisiz runtime rolüne yükseltme");
  expect(deployReadme).toContain("database_create = false");
  expect(deployReadme).toContain("CREATE TABLE public.__runtime_ddl_probe");
  expect(deployReadme).toContain("sunucu dışı ve immutable depolama");
  expect(deployReadme).toContain("otomatik geri");

  expect(deployWorkflow).toContain("workflow_run:");
  expect(deployWorkflow).toContain("- Project quality");
  expect(deployWorkflow).toContain("- completed");
  expect(deployWorkflow).not.toContain("workflow_dispatch:");
  expect(deployWorkflow).not.toMatch(/^\s*push:/m);
  expect(deployWorkflow).toContain("github.event.workflow_run.conclusion == 'success'");
  expect(deployWorkflow).toContain("github.event.workflow_run.event == 'push'");
  expect(deployWorkflow).toContain("github.event.workflow_run.head_branch == 'main'");
  expect(deployWorkflow).toContain("github.event.workflow_run.head_sha");
  expect(deployWorkflow).toMatch(/uses: appleboy\/ssh-action@[0-9a-f]{40}\s+# v1\.0\.3/);
  expect(deployWorkflow).toContain("environment: production");
  expect(deployWorkflow).toContain("fingerprint: ${{ env.SERVER_HOST_FINGERPRINT }}");
  expect(deployWorkflow).toContain('git cat-file -e "${DEPLOY_SHA}^{commit}"');
  expect(deployWorkflow).toContain('git reset --hard "$DEPLOY_SHA"');
  expect(deployWorkflow).not.toContain("git reset --hard origin/main");
  expect(deployWorkflow).toContain("bash deploy/deploy-production.sh");
  expect(deployWorkflow).not.toContain('git reset --hard "$previous_sha"');
  expect(deployWorkflow).toContain("git status --porcelain --untracked-files=all");
  expect(deployWorkflow).toContain("BACKUP_RETENTION_DAYS");
  expect(deployScript).toContain("--profile operations run --rm --no-deps -T data-retention");
  expect(runtimeRoleScript).toContain("'rate_limit_buckets', 'password_setup_tokens'");

  expect(deployScript).toContain("config -q");
  expect(deployScript).toContain("pg_dump");
  expect(deployScript).toContain("pg_restore --exit-on-error");
  expect(deployScript.indexOf("pg_restore --exit-on-error")).toBeLessThan(
    deployScript.indexOf("MAINTENANCE_TRAFFIC_STOPPING=1")
  );
  expect(deployScript).toContain("--label traefik.enable=false backend");
  expect(deployScript).toContain("--verify-backfill");
  expect(deployScript).toContain("SELECT public.enable_data_encryption_enforcement()");
  expect(deployScript.indexOf("DATA_ENCRYPTION_ENFORCEMENT_ENABLED=1")).toBeLessThan(
    deployScript.indexOf("up -d --no-build --no-deps --wait frontend")
  );
  expect(deployScript).toContain("VALIDATED_ENCRYPTED_BACKUP=%s");
  expect(deployScript).toContain("BACKUP_MIN_FREE_MIB");
  expect(deployScript).toContain("PRUNED_BACKUP=%s");
  expect(deployScript).toContain("PRUNED_LEGACY_PLAINTEXT_BACKUP=%s");
  expect(deployScript).toContain('log "ROLLBACK_COMPLETED_SHA=$rollback_sha"');
  expect(deployScript).toContain('git reset --hard "$rollback_sha"');
  expect(deployScript).toContain("http://127.0.0.1:5000/api/v1/health");
  expect(deployScript).toContain("http://127.0.0.1:8080/healthz");
  expect(publicHealth).toContain('"$PUBLIC_ORIGIN/healthz"');
  expect(publicHealth).toContain('"$PUBLIC_ORIGIN/api/v1/health"');
  expect(deployScript).toContain("DEPLOYED_GIT_SHA=%s");

  expect(backupCrypto).toContain('const ALGORITHM = "aes-256-gcm"');
  expect(backupCrypto).toContain("cipher.setAAD(additionalData");
  expect(backupCrypto).toContain("cipher.getAuthTag()");
  expect(backupCrypto).toContain("decipher.setAuthTag(authTag)");
  expect(backupCrypto).toContain("terminalFrameSeen");
  expect(backupCrypto).toContain("uygulama güvenlik anahtarlarından farklı");
  expect(bootstrapAdmin).toMatch(/console\.log\(["']İlk admin başarıyla oluşturuldu\.["']\)/);
  expect(bootstrapAdmin).not.toContain("admin.username");

  expect(runtimeRoleScript).toContain("NOSUPERUSER NOCREATEDB NOCREATEROLE");
  expect(runtimeRoleScript).toContain("SET password_encryption = 'scram-sha-256'");
  expect(runtimeRoleScript).toContain("REVOKE ALL PRIVILEGES ON DATABASE");
  expect(runtimeRoleScript).toContain("REVOKE ALL PRIVILEGES ON SCHEMA public");
  expect(runtimeRoleScript).toContain("GRANT SELECT, INSERT, UPDATE ON ALL TABLES");
  expect(runtimeRoleScript).toContain("REVOKE UPDATE ON TABLE %I.%I FROM %I");
  expect(runtimeRoleScript).toContain("'public', 'audit_logs'");
  expect(runtimeRoleScript).toContain("GRANT DELETE ON TABLE %I.%I");
  expect(runtimeRoleScript).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE");
  expect(runtimeRoleScript).toContain("_prisma_migrations");
  expect(runtimeTimeoutScript).toContain("ALTER ROLE %I SET statement_timeout");
  expect(runtimeTimeoutScript).toContain("ALTER ROLE %I SET lock_timeout");
  expect(runtimeTimeoutScript).toContain("BEGIN;");
  expect(runtimeTimeoutScript).toContain("settings_valid");
  expect(runtimeTimeoutScript).toContain("idle_in_transaction_session_timeout");
  expect(runtimeRoleScript).not.toMatch(
    /printf[^\n]*(?:runtime_password|POSTGRES_RUNTIME_PASSWORD)/
  );
});
