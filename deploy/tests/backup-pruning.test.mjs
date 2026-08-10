import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const shellTest = resolve(import.meta.dirname, "backup-pruning.test.sh");

const bashExecutable =
  process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(
        existsSync
      )
    : "bash";

test("legacy plaintext yedek temizliği güvenli allowlist ile çalışır", () => {
  assert.ok(bashExecutable, "Bash çalıştırıcısı bulunamadı.");
  const result = spawnSync(bashExecutable, [shellTest], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Legacy plaintext yedek budama testleri geçti\./);
});
