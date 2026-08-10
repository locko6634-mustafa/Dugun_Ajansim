import { once } from "node:events";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { loadAllowedFileSecrets } from "./file-secrets.mjs";

loadAllowedFileSecrets(process.env, {
  BACKUP_ENCRYPTION_KEY_FILE: "BACKUP_ENCRYPTION_KEY",
  APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS_FILE: "APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS"
});

const ALGORITHM = "aes-256-gcm";
const MAGIC = Buffer.from("DAJSBKP", "ascii");
const VERSION = 2;
const NONCE_PREFIX_LENGTH = 12;
const NONCE_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const FRAME_LENGTH_BYTES = 4;
const MAX_FRAME_PLAINTEXT_BYTES = 1024 * 1024;
const MAX_FRAME_COUNTER = 0xffffffff;
const HEADER_LENGTH = MAGIC.length + 1 + NONCE_PREFIX_LENGTH;
const KNOWN_EXAMPLE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const fail = (message) => {
  throw new Error(message);
};

const readKey = () => {
  const encodedKey = process.env.BACKUP_ENCRYPTION_KEY ?? "";
  const applicationDataKeyFingerprints = (
    process.env.APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS ?? ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS;

  if (!/^[a-fA-F0-9]{64}$/.test(encodedKey)) {
    fail("BACKUP_ENCRYPTION_KEY 32 baytlık hex değer olmalıdır.");
  }
  if (
    applicationDataKeyFingerprints.length < 1 ||
    applicationDataKeyFingerprints.length > 32 ||
    applicationDataKeyFingerprints.some((value) => !/^[a-f0-9]{64}$/.test(value))
  ) {
    fail("APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS geçerli SHA-256 hex listesi olmalıdır.");
  }

  const normalizedKey = encodedKey.toLowerCase();
  const isWeakKey =
    normalizedKey === KNOWN_EXAMPLE_KEY ||
    /^([a-f0-9])\1{63}$/.test(normalizedKey) ||
    normalizedKey.slice(0, 32) === normalizedKey.slice(32);
  if (isWeakKey) {
    fail("BACKUP_ENCRYPTION_KEY örneklerden farklı, rastgele bir anahtar olmalıdır.");
  }
  const backupKeyFingerprint = createHash("sha256").update(encodedKey, "hex").digest("hex");
  if (applicationDataKeyFingerprints.includes(backupKeyFingerprint)) {
    fail("BACKUP_ENCRYPTION_KEY tüm uygulama güvenlik anahtarlarından farklı olmalıdır.");
  }

  return Buffer.from(encodedKey, "hex");
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

const encrypt = async (key) => {
  const noncePrefix = randomBytes(NONCE_PREFIX_LENGTH);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), noncePrefix]);
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

const decrypt = async (key) => {
  let pending = Buffer.alloc(0);
  let header;
  let noncePrefix;
  let frameCounter = 0;
  let plaintextBytes = 0;
  let terminalFrameSeen = false;

  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, chunk]);

    if (!header && pending.length >= HEADER_LENGTH) {
      header = pending.subarray(0, HEADER_LENGTH);
      const magic = header.subarray(0, MAGIC.length);
      const version = header[MAGIC.length];

      if (!magic.equals(MAGIC) || version !== VERSION) {
        fail("Şifreli yedek başlığı veya sürümü geçersiz.");
      }

      noncePrefix = header.subarray(MAGIC.length + 1);
      pending = pending.subarray(HEADER_LENGTH);
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

  const key = readKey();
  try {
    if (mode === "validate") return;
    if (mode === "encrypt") {
      await encrypt(key);
      return;
    }
    await decrypt(key);
  } finally {
    key.fill(0);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Bilinmeyen yedekleme hatası.";
  process.stderr.write(`Yedek şifreleme aracı başarısız: ${message}\n`);
  process.exitCode = 1;
});
