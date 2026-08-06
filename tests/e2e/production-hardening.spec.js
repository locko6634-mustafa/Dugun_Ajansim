import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const readProjectFile = (relativePath) =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("production container ve dağıtım korumaları yapılandırmada kalır", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Yapılandırma denetimi tek projede yeterlidir.");

  const [
    backendDockerfile,
    frontendDockerfile,
    compose,
    nginx,
    exampleEnv,
    deployReadme,
    deployWorkflow,
    bootstrapAdmin,
    runtimeRoleScript
  ] = await Promise.all([
    readProjectFile("backend/Dockerfile"),
    readProjectFile("Dockerfile"),
    readProjectFile("compose.production.yaml"),
    readProjectFile("deploy/nginx.conf"),
    readProjectFile(".env.production.example"),
    readProjectFile("deploy/README.md"),
    readProjectFile(".github/workflows/deploy.yml"),
    readProjectFile("backend/src/scripts/bootstrapAdmin.ts"),
    readProjectFile("deploy/postgres/init-runtime-role.sh")
  ]);

  expect(backendDockerfile).toContain("FROM build AS migrate");
  expect(backendDockerfile).toContain("npm prune --omit=dev --omit=peer");
  expect(backendDockerfile).toContain(
    "COPY --from=production-dependencies /app/package.json ./package.json"
  );

  expect(frontendDockerfile).toContain("USER nginx");
  expect(frontendDockerfile).toContain("EXPOSE 8080");
  expect(frontendDockerfile).toContain("http://127.0.0.1:8080/healthz");
  expect(frontendDockerfile).toMatch(/chown -R nginx:nginx[\s\\]*[\s\S]*\/run/);

  expect(compose).toContain("admin-bootstrap:");
  expect(compose).toContain("dist/scripts/bootstrapAdmin.js");
  expect(compose).not.toMatch(/ADMIN_BOOTSTRAP_PASSWORD\s*:/);
  expect(compose).toContain("loadbalancer.server.port=8080");
  expect(compose).toContain("pids_limit:");
  expect(compose).toContain("stop_grace_period:");
  expect(compose).toContain('max-size: "10m"');
  expect(compose).toContain("ADMIN_SESSION_IDLE_MINUTES:");
  expect(compose).toContain("CUSTOMER_SESSION_IDLE_HOURS:");
  expect(compose).toContain("TEMPORARY_PASSWORD_TTL_HOURS:");
  expect(compose).toContain("TRUST_PROXY: ${TRUST_PROXY:?");
  expect(compose).not.toMatch(/TRUST_PROXY:\s*1(?:\s|$)/);
  expect(compose).toContain("db-role-bootstrap:");
  expect(compose).toContain(
    "./deploy/postgres/init-runtime-role.sh:/docker-entrypoint-initdb.d/20-runtime-role.sh:ro"
  );
  expect(compose).toMatch(
    /migrate:[\s\S]*?DATABASE_URL: postgresql:\/\/\$\{POSTGRES_USER:-dugun_app\}:\$\{POSTGRES_PASSWORD\}@postgres/
  );
  expect(compose).toMatch(
    /backend:[\s\S]*?DATABASE_URL: postgresql:\/\/\$\{POSTGRES_RUNTIME_USER:-dugun_runtime\}:\$\{POSTGRES_RUNTIME_PASSWORD:\?POSTGRES_RUNTIME_PASSWORD zorunludur\}@postgres/
  );
  expect(compose).toMatch(
    /seed:[\s\S]*?depends_on:\s*\n\s*db-role-bootstrap:\s*\n\s*condition: service_completed_successfully/
  );
  expect(compose).toMatch(
    /db-role-bootstrap:[\s\S]*?depends_on:\s*\n\s*migrate:\s*\n\s*condition: service_completed_successfully/
  );

  expect(nginx).toContain("listen 8080 default_server");
  expect(nginx).toContain("max-age=3600, must-revalidate");
  expect(nginx).toContain("Content-Security-Policy");
  expect(nginx).not.toContain("immutable");
  expect(nginx).not.toContain("expires 1y");

  expect(exampleEnv).toMatch(/^POSTGRES_PASSWORD=$/m);
  expect(exampleEnv).toMatch(/^POSTGRES_RUNTIME_USER=dugun_runtime$/m);
  expect(exampleEnv).toMatch(/^POSTGRES_RUNTIME_PASSWORD=$/m);
  expect(exampleEnv).toMatch(/^DATA_ENCRYPTION_KEY=$/m);
  expect(exampleEnv).toMatch(/^TRUST_PROXY=$/m);
  expect(exampleEnv).toContain("ADMIN_SESSION_IDLE_MINUTES=30");
  expect(exampleEnv).toContain("CUSTOMER_SESSION_IDLE_HOURS=12");
  expect(exampleEnv).toContain("TEMPORARY_PASSWORD_TTL_HOURS=72");

  expect(deployReadme).toContain("install -m 600");
  expect(deployReadme).toContain("config -q");
  expect(deployReadme).toContain("-e ADMIN_BOOTSTRAP_USERNAME -e ADMIN_BOOTSTRAP_PASSWORD");
  expect(deployReadme).toContain("pg_restore --exit-on-error");
  expect(deployReadme).toContain("-p dugun-ajansim-restore-check");
  expect(deployReadme).toContain("up -d --wait postgres");
  expect(deployReadme).toContain("Mevcut volume'u DDL yetkisiz runtime rolüne yükseltme");
  expect(deployReadme).toContain("database_create = false");
  expect(deployReadme).toContain("CREATE TABLE public.__runtime_ddl_probe");
  expect(deployReadme).toContain("pg_restore --list");
  expect(deployReadme).toContain("şifreli sunucu dışı kopya");
  expect(deployReadme).toContain("geri yükleme veya rollback garantisi değildir");

  expect(deployWorkflow).toContain("workflow_run:");
  expect(deployWorkflow).toContain("- Project quality");
  expect(deployWorkflow).toContain("- completed");
  expect(deployWorkflow).toContain("workflow_dispatch:");
  expect(deployWorkflow).not.toMatch(/^\s*push:/m);
  expect(deployWorkflow).toContain("github.event.workflow_run.conclusion == 'success'");
  expect(deployWorkflow).toContain("github.event.workflow_run.event == 'push'");
  expect(deployWorkflow).toContain("github.event.workflow_run.head_branch == 'main'");
  expect(deployWorkflow).toContain("github.event.workflow_run.head_sha");
  expect(deployWorkflow).toContain('git cat-file -e "${DEPLOY_SHA}^{commit}"');
  expect(deployWorkflow).toContain('git reset --hard "$DEPLOY_SHA"');
  expect(deployWorkflow).not.toContain("git reset --hard origin/main");
  expect(deployWorkflow).toContain("config -q");
  expect(deployWorkflow).toContain("pg_dump");
  expect(deployWorkflow).toContain("pg_restore --list");
  expect(deployWorkflow.indexOf("pg_restore --list")).toBeLessThan(
    deployWorkflow.indexOf("up -d --build --wait")
  );
  expect(deployWorkflow).toContain("up -d --build --wait");
  expect(deployWorkflow).toContain("http://127.0.0.1:5000/api/v1/health");
  expect(deployWorkflow).toContain("http://127.0.0.1:8080/healthz");
  expect(deployWorkflow).toContain('"$PUBLIC_ORIGIN/healthz"');
  expect(deployWorkflow).toContain('"$PUBLIC_ORIGIN/api/v1/health"');
  expect(deployWorkflow).toContain("DEPLOYED_GIT_SHA=%s");
  expect(bootstrapAdmin).toContain("console.log('İlk admin başarıyla oluşturuldu.')");
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
  expect(runtimeRoleScript).not.toMatch(
    /printf[^\n]*(?:runtime_password|POSTGRES_RUNTIME_PASSWORD)/
  );
});
