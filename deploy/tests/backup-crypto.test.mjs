import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolPath = fileURLToPath(new URL("../backup-crypto.mjs", import.meta.url));
const primaryKey = randomBytes(32).toString("hex");
const applicationDataKey = randomBytes(32).toString("hex");
const applicationDataKeyFingerprint = createHash("sha256")
  .update(applicationDataKey, "hex")
  .digest("hex");
const secondaryApplicationKey = randomBytes(32).toString("hex");
const secondaryApplicationKeyFingerprint = createHash("sha256")
  .update(secondaryApplicationKey, "hex")
  .digest("hex");

const runTool = (mode, input, key = primaryKey) =>
  spawnSync(process.execPath, [toolPath, mode], {
    env: {
      ...process.env,
      BACKUP_ENCRYPTION_KEY: key,
      APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS: `${applicationDataKeyFingerprint},${secondaryApplicationKeyFingerprint}`
    },
    input,
    maxBuffer: 8 * 1024 * 1024
  });

test("AES-256-GCM yedek akışı veriyi kayıpsız geri açar", () => {
  const plaintext = Buffer.concat([
    Buffer.from("dugun-ajansim-backup\0"),
    randomBytes(2 * 1024 * 1024 + 173)
  ]);
  const encrypted = runTool("encrypt", plaintext);

  assert.equal(encrypted.status, 0, encrypted.stderr.toString());
  assert.notDeepEqual(encrypted.stdout, plaintext);
  assert.equal(encrypted.stdout.subarray(0, 7).toString("ascii"), "DAJSBKP");
  assert.equal(encrypted.stdout[7], 2);

  const decrypted = runTool("decrypt", encrypted.stdout);
  assert.equal(decrypted.status, 0, decrypted.stderr.toString());
  assert.deepEqual(decrypted.stdout, plaintext);
});

test("ilk parçadaki değişiklik doğrulanmamış hiçbir veriyi stdout'a çıkarmaz", () => {
  const encrypted = runTool("encrypt", Buffer.from("authenticated production backup"));
  assert.equal(encrypted.status, 0, encrypted.stderr.toString());

  const tampered = Buffer.from(encrypted.stdout);
  tampered[24] ^= 0x01;
  const decrypted = runTool("decrypt", tampered);

  assert.notEqual(decrypted.status, 0);
  assert.match(decrypted.stderr.toString(), /kimlik doğrulamasından geçemedi/);
  assert.equal(decrypted.stdout.length, 0);
});

test("eksik son parça ve son parçadan sonraki veri reddedilir", () => {
  const encrypted = runTool("encrypt", Buffer.from("authenticated terminal frame"));
  assert.equal(encrypted.status, 0, encrypted.stderr.toString());

  const truncated = runTool("decrypt", encrypted.stdout.subarray(0, -1));
  assert.notEqual(truncated.status, 0);
  assert.match(truncated.stderr.toString(), /eksik veya bozuk/);

  const withTrailingData = runTool(
    "decrypt",
    Buffer.concat([encrypted.stdout, Buffer.from([0x01])])
  );
  assert.notEqual(withTrailingData.status, 0);
  assert.match(withTrailingData.stderr.toString(), /son parçadan sonra veri içeriyor/);
});

test("yanlış yedek anahtarıyla geri açma reddedilir", () => {
  const encrypted = runTool("encrypt", Buffer.from("customer backup"));
  assert.equal(encrypted.status, 0, encrypted.stderr.toString());

  const decrypted = runTool("decrypt", encrypted.stdout, randomBytes(32).toString("hex"));
  assert.notEqual(decrypted.status, 0);
  assert.match(decrypted.stderr.toString(), /kimlik doğrulamasından geçemedi/);
});

test("eksik veya biçimsiz anahtar reddedilir", () => {
  const missingKey = spawnSync(process.execPath, [toolPath, "validate"], {
    env: {
      ...process.env,
      BACKUP_ENCRYPTION_KEY: "",
      APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS: applicationDataKeyFingerprint
    }
  });
  assert.notEqual(missingKey.status, 0);
  assert.match(missingKey.stderr.toString(), /32 baytlık hex/);

  const malformedKey = runTool("validate", undefined, "not-a-key");
  assert.notEqual(malformedKey.status, 0);
  assert.match(malformedKey.stderr.toString(), /32 baytlık hex/);
});

test("örnek, yinelenen veya uygulama anahtarıyla aynı yedek anahtarı reddedilir", () => {
  const exampleKey = runTool(
    "validate",
    undefined,
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
  assert.notEqual(exampleKey.status, 0);
  assert.match(exampleKey.stderr.toString(), /rastgele bir anahtar/);

  const repeatedKey = runTool("validate", undefined, "a".repeat(64));
  assert.notEqual(repeatedKey.status, 0);
  assert.match(repeatedKey.stderr.toString(), /rastgele bir anahtar/);

  const sameAsApplicationKey = runTool("validate", undefined, applicationDataKey);
  assert.notEqual(sameAsApplicationKey.status, 0);
  assert.match(sameAsApplicationKey.stderr.toString(), /uygulama güvenlik anahtarlarından farklı/);

  const sameAsSecondaryKey = runTool("validate", undefined, secondaryApplicationKey);
  assert.notEqual(sameAsSecondaryKey.status, 0);
  assert.match(sameAsSecondaryKey.stderr.toString(), /uygulama güvenlik anahtarlarından farklı/);
});
