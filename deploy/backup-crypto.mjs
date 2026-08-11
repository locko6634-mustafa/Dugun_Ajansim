import { once } from "node:events";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { loadAllowedFileSecrets } from "./file-secrets.mjs";

loadAllowedFileSecrets(process.env, {
  BACKUP_ENCRYPTION_KEY_FILE: "BACKUP_ENCRYPTION_KEY",
  BACKUP_ENCRYPTION_KEYRING_JSON_FILE: "BACKUP_ENCRYPTION_KEYRING_JSON",
  APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS_FILE: "APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS"
});

const ALGORITHM = "aes-256-gcm";
const MAGIC = Buffer.from("DAJSBKP", "ascii");
const LEGACY_VERSION = 2;
const VERSION = 3;
const NONCE_PREFIX_LENGTH = 12;
const NONCE_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const FRAME_LENGTH_BYTES = 4;
const KEY_ID_LENGTH_BYTES = 1;
const MAX_KEY_ID_BYTES = 64;
const MAX_FRAME_PLAINTEXT_BYTES = 1024 * 1024;
const MAX_FRAME_COUNTER = 0xffffffff;
const LEGACY_HEADER_LENGTH = MAGIC.length + 1 + NONCE_PREFIX_LENGTH;
const HEADER_PREFIX_LENGTH = MAGIC.length + 1;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KNOWN_EXAMPLE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const fail = (message) => {
  throw new Error(message);
};

const validateEncodedKey = (encodedKey, applicationDataKeyFingerprints) => {
  if (!/^[a-fA-F0-9]{64}$/.test(encodedKey)) {
    fail("Yedek anahtarları 32 baytlık hex değer olmalıdır.");
  }

  const normalizedKey = encodedKey.toLowerCase();
  const isWeakKey =
    normalizedKey === KNOWN_EXAMPLE_KEY ||
    /^([a-f0-9])\1{63}$/.test(normalizedKey) ||
    normalizedKey.slice(0, 32) === normalizedKey.slice(32);
  if (isWeakKey) {
    fail("Her yedek anahtarı örneklerden farklı, rastgele bir anahtar olmalıdır.");
  }

  const backupKeyFingerprint = createHash("sha256").update(encodedKey, "hex").digest("hex");
  if (applicationDataKeyFingerprints.includes(backupKeyFingerprint)) {
    fail("Yedek anahtarları tüm uygulama güvenlik anahtarlarından farklı olmalıdır.");
  }

  return normalizedKey;
};

const readKeyConfiguration = () => {
  const legacyEncodedKey = (process.env.BACKUP_ENCRYPTION_KEY ?? "").trim();
  const activeKeyId = (process.env.BACKUP_ENCRYPTION_ACTIVE_KEY_ID ?? "").trim();
  const encodedKeyring = (process.env.BACKUP_ENCRYPTION_KEYRING_JSON ?? "").trim();
  const applicationDataKeyFingerprints = (
    process.env.APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS ?? ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_ENCRYPTION_ACTIVE_KEY_ID;
  delete process.env.BACKUP_ENCRYPTION_KEYRING_JSON;
  delete process.env.APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS;

  if (
    applicationDataKeyFingerprints.length < 1 ||
    applicationDataKeyFingerprints.length > 32 ||
    applicationDataKeyFingerprints.some((value) => !/^[a-f0-9]{64}$/.test(value))
  ) {
    fail("APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS geçerli SHA-256 hex listesi olmalıdır.");
  }

  if (!activeKeyId && !encodedKeyring) {
    const normalizedLegacyKey = validateEncodedKey(
      legacyEncodedKey,
      applicationDataKeyFingerprints
    );
    return {
      activeKeyId: "legacy",
      keys: new Map([["legacy", Buffer.from(normalizedLegacyKey, "hex")]])
    };
  }

  if (legacyEncodedKey || !activeKeyId || !encodedKeyring || !KEY_ID_PATTERN.test(activeKeyId)) {
    fail(
      "BACKUP_ENCRYPTION_ACTIVE_KEY_ID ve BACKUP_ENCRYPTION_KEYRING_JSON birlikte, legacy anahtarsız kullanılmalıdır."
    );
  }

  let parsedKeyring;
  try {
    parsedKeyring = JSON.parse(encodedKeyring);
  } catch {
    fail("BACKUP_ENCRYPTION_KEYRING_JSON geçerli JSON olmalıdır.");
  }
  if (!parsedKeyring || typeof parsedKeyring !== "object" || Array.isArray(parsedKeyring)) {
    fail("BACKUP_ENCRYPTION_KEYRING_JSON bir JSON nesnesi olmalıdır.");
  }

  const entries = Object.entries(parsedKeyring);
  if (entries.length < 1 || entries.length > 32) {
    fail("BACKUP_ENCRYPTION_KEYRING_JSON 1-32 anahtar içermelidir.");
  }

  const normalizedEntries = entries.map(([keyId, encodedKey]) => {
    if (!KEY_ID_PATTERN.test(keyId) || typeof encodedKey !== "string") {
      fail("BACKUP_ENCRYPTION_KEYRING_JSON key ID veya anahtar biçimi geçersiz.");
    }
    return [keyId, validateEncodedKey(encodedKey, applicationDataKeyFingerprints)];
  });
  if (new Set(normalizedEntries.map(([, encodedKey]) => encodedKey)).size !== entries.length) {
    fail("BACKUP_ENCRYPTION_KEYRING_JSON anahtarları benzersiz olmalıdır.");
  }
  if (!normalizedEntries.some(([keyId]) => keyId === activeKeyId)) {
    fail("BACKUP_ENCRYPTION_ACTIVE_KEY_ID keyring içinde bulunmalıdır.");
  }

  return {
    activeKeyId,
    keys: new Map(
      normalizedEntries.map(([keyId, encodedKey]) => [keyId, Buffer.from(encodedKey, "hex")])
    )
  };
};

const writeOutput = async (chunk) => {
  if (chunk.length > 0 && !process.stdout.write(chunk)) {
    await once(process.stdout, "drain");
  }
};

const finishOutput = async () => {
  process.stdout.end();
  await once(process.stdout, "finish");
};

const createFrameContext = (header, noncePrefix, frameCounter, plaintextLength) => {
  if (frameCounter > MAX_FRAME_COUNTER) {
    fail("Şifreli yedek azami parça sayısını aştı.");
  }

  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(frameCounter);
  const length = Buffer.alloc(FRAME_LENGTH_BYTES);
  length.writeUInt32BE(plaintextLength);
  const nonce = Buffer.concat([noncePrefix, counter]);
  if (nonce.length !== NONCE_LENGTH) {
    fail("Şifreli yedek nonce uzunluğu geçersiz.");
  }
  const additionalData = Buffer.concat([header, counter, length]);

  return { additionalData, length, nonce };
};

const encryptFrame = (key, header, noncePrefix, frameCounter, plaintext) => {
  const { additionalData, length, nonce } = createFrameContext(
    header,
    noncePrefix,
    frameCounter,
    plaintext.length
  );
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(additionalData, { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([length, ciphertext, cipher.getAuthTag()]);
};

const encrypt = async ({ activeKeyId, keys }) => {
  const key = keys.get(activeKeyId);
  const keyId = Buffer.from(activeKeyId, "ascii");
  if (!key || keyId.length < 1 || keyId.length > MAX_KEY_ID_BYTES) {
    fail("Aktif yedek anahtarı yapılandırması geçersiz.");
  }
  const noncePrefix = randomBytes(NONCE_PREFIX_LENGTH);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION, keyId.length]), keyId, noncePrefix]);
  let pending = Buffer.alloc(0);
  let plaintextBytes = 0;
  let frameCounter = 0;

  await writeOutput(header);

  for await (const chunk of process.stdin) {
    plaintextBytes += chunk.length;
    pending = Buffer.concat([pending, chunk]);

    while (pending.length >= MAX_FRAME_PLAINTEXT_BYTES) {
      const plaintext = pending.subarray(0, MAX_FRAME_PLAINTEXT_BYTES);
      pending = pending.subarray(MAX_FRAME_PLAINTEXT_BYTES);
      await writeOutput(encryptFrame(key, header, noncePrefix, frameCounter, plaintext));
      frameCounter += 1;
    }
  }

  if (plaintextBytes === 0) {
    fail("Boş yedek şifrelenemez.");
  }

  if (pending.length > 0) {
    await writeOutput(encryptFrame(key, header, noncePrefix, frameCounter, pending));
    frameCounter += 1;
  }

  // Kimliği doğrulanan boş son parça, akışın sessizce kısaltılmasını engeller.
  await writeOutput(encryptFrame(key, header, noncePrefix, frameCounter, Buffer.alloc(0)));
  await finishOutput();
};

const decryptFrame = (key, header, noncePrefix, frameCounter, length, ciphertext, authTag) => {
  const { additionalData, nonce } = createFrameContext(header, noncePrefix, frameCounter, length);
  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAAD(additionalData, { plaintextLength: length });
  decipher.setAuthTag(authTag);

  // final() başarılı olmadan bu parça stdout'a yazılmaz.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

const decrypt = async ({ keys }) => {
  let pending = Buffer.alloc(0);
  let header;
  let noncePrefix;
  let key;
  let legacyKeyCandidates;
  let frameCounter = 0;
  let plaintextBytes = 0;
  let terminalFrameSeen = false;

  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, chunk]);

    if (!header && pending.length >= HEADER_PREFIX_LENGTH) {
      const magic = pending.subarray(0, MAGIC.length);
      const version = pending[MAGIC.length];
      if (!magic.equals(MAGIC) || ![LEGACY_VERSION, VERSION].includes(version)) {
        fail("Şifreli yedek başlığı veya sürümü geçersiz.");
      }

      let headerLength;
      if (version === LEGACY_VERSION) {
        headerLength = LEGACY_HEADER_LENGTH;
      } else {
        if (pending.length < HEADER_PREFIX_LENGTH + KEY_ID_LENGTH_BYTES) continue;
        const keyIdLength = pending[HEADER_PREFIX_LENGTH];
        if (keyIdLength < 1 || keyIdLength > MAX_KEY_ID_BYTES) {
          fail("Şifreli yedek anahtar kimliği geçersiz.");
        }
        headerLength =
          HEADER_PREFIX_LENGTH + KEY_ID_LENGTH_BYTES + keyIdLength + NONCE_PREFIX_LENGTH;
      }
      if (pending.length < headerLength) continue;

      header = pending.subarray(0, headerLength);
      if (version === LEGACY_VERSION) {
        noncePrefix = header.subarray(HEADER_PREFIX_LENGTH);
        legacyKeyCandidates = [...keys.values()];
      } else {
        const keyIdLength = header[HEADER_PREFIX_LENGTH];
        const keyIdStart = HEADER_PREFIX_LENGTH + KEY_ID_LENGTH_BYTES;
        const keyId = header.subarray(keyIdStart, keyIdStart + keyIdLength).toString("ascii");
        if (!KEY_ID_PATTERN.test(keyId) || !keys.has(keyId)) {
          fail("Şifreli yedek anahtar kimliği keyring içinde bulunamadı.");
        }
        key = keys.get(keyId);
        noncePrefix = header.subarray(keyIdStart + keyIdLength);
      }
      pending = pending.subarray(headerLength);
    }

    while (header && pending.length >= FRAME_LENGTH_BYTES) {
      if (terminalFrameSeen) {
        fail("Şifreli yedek son parçadan sonra veri içeriyor.");
      }

      const plaintextLength = pending.readUInt32BE(0);
      if (plaintextLength > MAX_FRAME_PLAINTEXT_BYTES) {
        fail("Şifreli yedek parça uzunluğu geçersiz.");
      }

      const frameLength = FRAME_LENGTH_BYTES + plaintextLength + AUTH_TAG_LENGTH;
      if (pending.length < frameLength) break;

      const length = pending.subarray(0, FRAME_LENGTH_BYTES);
      const ciphertext = pending.subarray(FRAME_LENGTH_BYTES, FRAME_LENGTH_BYTES + plaintextLength);
      const authTag = pending.subarray(FRAME_LENGTH_BYTES + plaintextLength, frameLength);
      pending = pending.subarray(frameLength);

      let plaintext;
      if (!key && legacyKeyCandidates) {
        const matches = [];
        for (const candidate of legacyKeyCandidates) {
          try {
            matches.push({
              key: candidate,
              plaintext: decryptFrame(
                candidate,
                header,
                noncePrefix,
                frameCounter,
                plaintextLength,
                ciphertext,
                authTag
              )
            });
          } catch {
            // Legacy v2 başlığında keyId yoktur; ilk doğrulanan parça doğru anahtarı seçer.
          }
        }
        if (matches.length !== 1) {
          fail("Şifreli yedek kimlik doğrulamasından geçemedi.");
        }
        [{ key, plaintext }] = matches;
        legacyKeyCandidates = undefined;
      } else {
        try {
          plaintext = decryptFrame(
            key,
            header,
            noncePrefix,
            frameCounter,
            plaintextLength,
            ciphertext,
            authTag
          );
        } catch {
          fail("Şifreli yedek kimlik doğrulamasından geçemedi.");
        }
      }
      frameCounter += 1;

      if (plaintextLength === 0) {
        terminalFrameSeen = true;
        if (pending.length > 0) {
          fail("Şifreli yedek son parçadan sonra veri içeriyor.");
        }
        continue;
      }

      plaintextBytes += plaintext.length;
      await writeOutput(plaintext);
    }
  }

  if (!header || !terminalFrameSeen || pending.length !== 0 || plaintextBytes === 0) {
    fail("Şifreli yedek eksik veya bozuk.");
  }

  await finishOutput();
};

const main = async () => {
  const [mode, ...extraArguments] = process.argv.slice(2);
  if (!mode || extraArguments.length > 0 || !["validate", "encrypt", "decrypt"].includes(mode)) {
    fail("Kullanım: backup-crypto.mjs <validate|encrypt|decrypt>");
  }

  const keyConfiguration = readKeyConfiguration();
  try {
    if (mode === "validate") return;
    if (mode === "encrypt") {
      await encrypt(keyConfiguration);
      return;
    }
    await decrypt(keyConfiguration);
  } finally {
    for (const key of keyConfiguration.keys.values()) key.fill(0);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Bilinmeyen yedekleme hatası.";
  process.stderr.write(`Yedek şifreleme aracı başarısız: ${message}\n`);
  process.exitCode = 1;
});
