import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import {
  classifyChanges,
  createCacheKey,
  createPlan,
  filesForCommand,
  infrastructureEvidence,
  runOnce
} from "./agent-check.mjs";

test("yalnız dokümantasyon değişikliği biçim kontrolünü seçer", () => {
  assert.deepEqual(
    createPlan(["AGENT.md"]).map(({ id }) => id),
    ["docs-format"]
  );
});

test("responsive değişiklik iki cihazlık hedefli E2E seçer", () => {
  const plan = createPlan(["css/home.css"]);
  assert.deepEqual(
    plan.map(({ id }) => id),
    ["frontend-static", "responsive-e2e"]
  );
  assert.match(plan[1].args.join(" "), /mobile-chromium/);
});

test("admin değişikliği yalnız admin hedefli grubunu seçer", () => {
  assert.deepEqual(
    createPlan(["js/admin/dashboard.js"]).map(({ id }) => id),
    ["frontend-static", "admin-e2e"]
  );
});

test("backend yardımcı kodu veritabanı olmadan hedefli birim grubunu seçer", () => {
  const plan = createPlan(["backend/src/lib/date.ts"]);
  assert.deepEqual(
    plan.map(({ id }) => id),
    ["backend-build", "backend-test-types", "backend-targeted"]
  );
  assert.match(plan[2].args.join(" "), /backend-unit/);
});

test("auth ve Prisma değişikliği auth grubuna yönelir", () => {
  for (const file of ["backend/src/auth/session.ts", "backend/prisma/schema.prisma"]) {
    const plan = createPlan([file]);
    assert.match(plan.at(-1).args.join(" "), /auth/);
    assert.equal(
      plan.some(({ id }) => id.includes("integration")),
      false
    );
  }
});

test("bilinmeyen dosya güvenli geniş yerel grupları seçer", () => {
  const ids = createPlan(["unmapped.config"]).map(({ id }) => id);
  assert.deepEqual(ids, [
    "frontend-static",
    "responsive-e2e",
    "backend-build",
    "backend-test-types",
    "backend-targeted"
  ]);
});

test("sınıflandırma katmanlar arası değişiklikleri birlikte korur", () => {
  assert.deepEqual([...classifyChanges(["admin.html", "backend/src/routes/admin.ts"])].sort(), [
    "admin",
    "backend-auth"
  ]);
});

test("komut bütçesi dolunca yalnız başlatılan süreç zaman aşımına uğrar", async () => {
  const result = await runOnce({
    id: "timeout-fixture",
    cwd: process.cwd(),
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    budget: 150
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.duration < 5_000);
});

test("yalnız açık altyapı belirtileri kontrollü tekrar için kabul edilir", () => {
  assert.equal(infrastructureEvidence("listen EADDRINUSE: address already in use"), true);
  assert.equal(infrastructureEvidence("assertion expected true but received false"), false);
});

test("önbellek anahtarı çalışma ağacı veya komut değiştiğinde geçersizleşir", () => {
  const item = { id: "static", args: ["run", "validate"] };
  assert.equal(createCacheKey("state-a", item), createCacheKey("state-a", item));
  assert.notEqual(createCacheKey("state-a", item), createCacheKey("state-b", item));
  assert.notEqual(
    createCacheKey("state-a", item),
    createCacheKey("state-a", { ...item, args: ["run", "build"] })
  );
});

test("önbellek girdileri frontend ve backend alt sistemlerini ayırır", () => {
  const files = ["css/home.css", "backend/src/app.ts", "AGENT.md"];
  assert.deepEqual(filesForCommand("frontend-static", files), ["css/home.css"]);
  assert.deepEqual(filesForCommand("backend-build", files), ["backend/src/app.ts"]);
  assert.deepEqual(filesForCommand("docs-format", files), ["AGENT.md"]);
});
