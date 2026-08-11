import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolPath = fileURLToPath(new URL("../backup-crypto.mjs", import.meta.url));
const primaryKey = randomBytes(32).toString("hex");
const previousKey = randomBytes(32).toString("hex");
const activeKeyId = "backup-2026-08";
const previousKeyId = "backup-2026-07";
const applicationDataKey = randomBytes(32).toString("hex");
const applicationDataKeyFingerprint = createHash("sha256")
  .update(applicationDataKey, "hex")
  .digest("hex");
const secondaryApplicationKey = randomBytes(32).toString("hex");
const secondaryApplicationKeyFingerprint = createHash("sha256")
  .update(secondaryApplicationKey, "hex")
  .digest("hex");

const applicationFingerprints = `${applicationDataKeyFingerprint},${secondaryApplicationKeyFingerprint}`;
const defaultKeyring = {
  [activeKeyId]: primaryKey,
  [previousKeyId]: previousKey
};

const cleanEnvironment = () => {
  const environment = { ...process.env };
  for (const name of [
    "BACKUP_ENCRYPTION_KEY",
    "BACKUP_ENCRYPTION_KEY_FILE",
    "BACKUP_ENCRYPTION_ACTIVE_KEY_ID",
    "BACKUP_ENCRYPTION_KEYRING_JSON",
    "BACKUP_ENCRYPTION_KEYRING_JSON_FILE",
    "APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS",
    "APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS_FILE"
  ]) {
    delete environment[name];
  }
  return environment;
};

const runTool = (
  mode,
  input,
  { keyId = activeKeyId, keyring = defaultKeyring, fingerprints = applicationFingerprints } = {}
) =>
  spawnSync(process.execPath, [toolPath, mode], {
    env: {
      ...cleanEnvironment(),
      BACKUP_ENCRYPTION_ACTIVE_KEY_ID: keyId,
      BACKUP_ENCRYPTION_KEYRING_JSON: JSON.stringify(keyring),
      APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS: fingerprints
    },
    input,
    maxBuffer: 8 * 1024 * 1024
  });

const runLegacyConfiguration = (mode, input, key) =>
  spawnSync(process.execPath, [toolPath, mode], {
    env: {
      ...cleanEnvironment(),
      BACKUP_ENCRYPTION_KEY: key,
      APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS: applicationFingerprints
    },
    input,
    maxBuffer: 8 * 1024 * 1024
  });

const encryptLegacyV2Frame = (key, header, noncePrefix, frameCounter, plaintext) => {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(frameCounter);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(plaintext.length);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.concat([noncePrefix, counter])
  );
  cipher.setAAD(Buffer.concat([header, counter, length]), { plaintextLength: plaintext.length });
  return Buffer.concat([length, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
};

const createLegacyV2Backup = (plaintext, key) => {
  const noncePrefix = randomBytes(12);
  const header = Buffer.concat([Buffer.from("DAJSBKP", "ascii"), Buffer.from([2]), noncePrefix]);
  return Buffer.concat([
    header,
    encryptLegacyV2Frame(key, header, noncePrefix, 0, plaintext),
    encryptLegacyV2Frame(key, header, noncePrefix, 1, Buffer.alloc(0))
  ]);
};

test("AES-256-GCM yedek akışı veriyi kayıpsız geri açar", () => {
  const plaintext = Buffer.concat([
    Buffer.from("dugun-ajansim-backup\0"),
    randomBytes(2 * 1024 * 1024 + 173)
  ]);
  const encrypted = runTool("encrypt", plaintext);

  assert.equal(encrypted.status, 0, encrypted.stderr.toString());
  assert.notDeepEqual(encrypted.stdout, plaintext);
  assert.equal(encrypted.stdout.subarray(0, 7).toString("ascii"), "DAJSBKP");
  assert.equal(encrypted.stdout[7], 3);
  const encodedKeyIdLength = encrypted.stdout[8];
  assert.equal(encrypted.stdout.subarray(9, 9 + encodedKeyIdLength).toString("ascii"), activeKeyId);

  const decrypted = runTool("decrypt", encrypted.stdout);
  assert.equal(decrypted.status, 0, decrypted.stderr.toString());
  assert.deepEqual(decrypted.stdout, plaintext);
});

test("yedek keyring'i zorunlu secret dosyasından okunur", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "dugun-backup-secrets-"));
  try {
    const keyringPath = join(temporaryDirectory, "backup-keyring");
    const fingerprintsPath = join(temporaryDirectory, "application-fingerprints");
    writeFileSync(keyringPath, `${JSON.stringify(defaultKeyring)}\n`);
    writeFileSync(
      fingerprintsPath,
      `${applicationDataKeyFingerprint},${secondaryApplicationKeyFingerprint}\n`
    );
    const result = spawnSync(process.execPath, [toolPath, "validate"], {
      env: {
        ...cleanEnvironment(),
        USE_FILE_SECRETS: "1",
        BACKUP_ENCRYPTION_ACTIVE_KEY_ID: activeKeyId,
        BACKUP_ENCRYPTION_KEYRING_JSON_FILE: keyringPath,
        APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS_FILE: fingerprintsPath
      }
    });
    assert.equal(result.status, 0, result.stderr.toString());
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("ilk parçadaki değişiklik doğrulanmamış hiçbir veriyi stdout'a çıkarmaz", () => {
  const encrypted = runTool("encrypt", Buffer.from("authenticated production backup"));
  assert.equal(encrypted.status, 0, encrypted.stderr.toString());

  const tampered = Buffer.from(encrypted.stdout);
  const firstCiphertextByte = 9 + tampered[8] + 12 + 4;
  tampered[firstCiphertextByte] ^= 0x01;
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

  const decrypted = runTool("decrypt", encrypted.stdout, {
    keyring: { [activeKeyId]: randomBytes(32).toString("hex") }
  });
  assert.notEqual(decrypted.status, 0);
  assert.match(decrypted.stderr.toString(), /kimlik doğrulamasından geçemedi/);
});

test("eksik veya biçimsiz anahtar reddedilir", () => {
  const missingKey = spawnSync(process.execPath, [toolPath, "validate"], {
    env: {
      ...cleanEnvironment(),
      APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS: applicationDataKeyFingerprint
    }
  });
  assert.notEqual(missingKey.status, 0);
  assert.match(missingKey.stderr.toString(), /32 baytlık hex/);

  const malformedKey = runLegacyConfiguration("validate", undefined, "not-a-key");
  assert.notEqual(malformedKey.status, 0);
  assert.match(malformedKey.stderr.toString(), /32 baytlık hex/);
});

test("örnek, yinelenen veya uygulama anahtarıyla aynı yedek anahtarı reddedilir", () => {
  const exampleKey = runLegacyConfiguration(
    "validate",
    undefined,
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
  assert.notEqual(exampleKey.status, 0);
  assert.match(exampleKey.stderr.toString(), /rastgele bir anahtar/);

  const repeatedKey = runLegacyConfiguration("validate", undefined, "a".repeat(64));
  assert.notEqual(repeatedKey.status, 0);
  assert.match(repeatedKey.stderr.toString(), /rastgele bir anahtar/);

  const sameAsApplicationKey = runLegacyConfiguration("validate", undefined, applicationDataKey);
  assert.notEqual(sameAsApplicationKey.status, 0);
  assert.match(sameAsApplicationKey.stderr.toString(), /uygulama güvenlik anahtarlarından farklı/);

  const sameAsSecondaryKey = runLegacyConfiguration("validate", undefined, secondaryApplicationKey);
  assert.notEqual(sameAsSecondaryKey.status, 0);
  assert.match(sameAsSecondaryKey.stderr.toString(), /uygulama güvenlik anahtarlarından farklı/);
});

test("v2 yedek eski anahtar keyring'de tutulduğu sürece rotasyon sonrasında açılır", () => {
  const plaintext = Buffer.from("thirty-day-retained-legacy-backup");
  const legacyBackup = createLegacyV2Backup(plaintext, previousKey);

  const decrypted = runTool("decrypt", legacyBackup);
  assert.equal(decrypted.status, 0, decrypted.stderr.toString());
  assert.deepEqual(decrypted.stdout, plaintext);

  const withoutPreviousKey = runTool("decrypt", legacyBackup, {
    keyring: { [activeKeyId]: primaryKey }
  });
  assert.notEqual(withoutPreviousKey.status, 0);
  assert.match(withoutPreviousKey.stderr.toString(), /kimlik doğrulamasından geçemedi/);
  assert.equal(withoutPreviousKey.stdout.length, 0);
});

test("keyring aktif kimlik, benzersiz anahtar ve uygulama anahtar ayrımını zorunlu tutar", () => {
  const missingActive = runTool("validate", undefined, { keyId: "missing-key" });
  assert.notEqual(missingActive.status, 0);
  assert.match(missingActive.stderr.toString(), /keyring içinde bulunmalıdır/);

  const duplicateKey = runTool("validate", undefined, {
    keyring: { [activeKeyId]: primaryKey, [previousKeyId]: primaryKey }
  });
  assert.notEqual(duplicateKey.status, 0);
  assert.match(duplicateKey.stderr.toString(), /benzersiz olmalıdır/);

  const sharedApplicationKey = runTool("validate", undefined, {
    keyring: { [activeKeyId]: applicationDataKey }
  });
  assert.notEqual(sharedApplicationKey.status, 0);
  assert.match(sharedApplicationKey.stderr.toString(), /uygulama güvenlik anahtarlarından farklı/);
});
