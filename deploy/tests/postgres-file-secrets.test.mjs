import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const shellTest = resolve(import.meta.dirname, "postgres-file-secrets.test.sh");
const bashExecutable =
  process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(
        existsSync
      )
    : "bash";

test("PostgreSQL yardımcıları file-backed secret kurallarını uygular", () => {
  assert.ok(bashExecutable, "Bash çalıştırıcısı bulunamadı.");
  const result = spawnSync(bashExecutable, [shellTest], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PostgreSQL file-backed secret testleri geçti\./);
});
