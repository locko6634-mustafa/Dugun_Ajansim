import { lstatSync, readFileSync, type Stats } from "node:fs";

const MAX_SECRET_FILE_BYTES = 64 * 1024;

export const FILE_SECRET_ALLOWLIST = Object.freeze({
  DATABASE_URL_FILE: "DATABASE_URL",
  TURNSTILE_SITE_KEY_FILE: "TURNSTILE_SITE_KEY",
  TURNSTILE_SECRET_KEY_FILE: "TURNSTILE_SECRET_KEY",
  SMTP_PASSWORD_FILE: "SMTP_PASSWORD",
  PASSWORD_RESET_CODE_HMAC_KEY_FILE: "PASSWORD_RESET_CODE_HMAC_KEY",
  DATA_ENCRYPTION_KEY_FILE: "DATA_ENCRYPTION_KEY",
  APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS_FILE: "APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS",
  DATA_ENCRYPTION_KEYRING_JSON_FILE: "DATA_ENCRYPTION_KEYRING_JSON",
  PII_BLIND_INDEX_KEY_FILE: "PII_BLIND_INDEX_KEY",
  PII_BLIND_INDEX_KEYRING_JSON_FILE: "PII_BLIND_INDEX_KEYRING_JSON",
  RATE_LIMIT_HMAC_KEY_FILE: "RATE_LIMIT_HMAC_KEY",
  BACKUP_ENCRYPTION_KEY_FILE: "BACKUP_ENCRYPTION_KEY"
} as const);

type FileSecretIo = {
  lstatSync: (path: string) => Stats;
  readFileSync: (path: string) => Buffer;
};

const defaultIo: FileSecretIo = { lstatSync, readFileSync };

export const loadFileBackedSecrets = (
  environment: NodeJS.ProcessEnv = process.env,
  io: FileSecretIo = defaultIo
): void => {
  const enabled = environment.USE_FILE_SECRETS ?? "0";
  if (enabled !== "0" && enabled !== "1") {
    throw new Error("USE_FILE_SECRETS yalnızca 0 veya 1 olabilir.");
  }

  for (const [fileVariable, targetVariable] of Object.entries(FILE_SECRET_ALLOWLIST)) {
    const filePath = environment[fileVariable];
    if (filePath === undefined) continue;
    if (enabled !== "1") {
      throw new Error(`${fileVariable} yalnız USE_FILE_SECRETS=1 ile kullanılabilir.`);
    }
    if (environment[targetVariable] !== undefined) {
      throw new Error(`${targetVariable} ile ${fileVariable} aynı anda kullanılamaz.`);
    }
    if (filePath.length === 0) throw new Error(`${fileVariable} boş olamaz.`);

    const stats = io.lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${fileVariable} normal ve symlink olmayan bir dosya olmalıdır.`);
    }
    if (stats.size < 1 || stats.size > MAX_SECRET_FILE_BYTES) {
      throw new Error(`${fileVariable} 1-${MAX_SECRET_FILE_BYTES} bayt aralığında olmalıdır.`);
    }
    const contents = io.readFileSync(filePath);
    if (contents.length !== stats.size || contents.includes(0)) {
      throw new Error(`${fileVariable} güvenli bir secret dosyası değildir.`);
    }
    const value = contents.toString("utf8").replace(/(?:\r?\n)+$/, "");
    if (value.length === 0) throw new Error(`${fileVariable} boş secret içeremez.`);
    environment[targetVariable] = value;
  }
};
