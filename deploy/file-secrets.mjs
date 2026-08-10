import { lstatSync, readFileSync } from "node:fs";

const MAX_SECRET_FILE_BYTES = 64 * 1024;

export const loadAllowedFileSecrets = (environment, allowlist) => {
  const enabled = environment.USE_FILE_SECRETS ?? "0";
  if (!new Set(["0", "1"]).has(enabled)) {
    throw new Error("USE_FILE_SECRETS yalnızca 0 veya 1 olabilir.");
  }

  for (const [fileVariable, targetVariable] of Object.entries(allowlist)) {
    const filePath = environment[fileVariable];
    if (filePath === undefined) continue;
    if (enabled !== "1") {
      throw new Error(`${fileVariable} yalnız USE_FILE_SECRETS=1 ile kullanılabilir.`);
    }
    if (environment[targetVariable] !== undefined) {
      throw new Error(`${targetVariable} ile ${fileVariable} aynı anda kullanılamaz.`);
    }
    if (!filePath) throw new Error(`${fileVariable} boş olamaz.`);

    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${fileVariable} normal ve symlink olmayan bir dosya olmalıdır.`);
    }
    if (stats.size < 1 || stats.size > MAX_SECRET_FILE_BYTES) {
      throw new Error(`${fileVariable} 1-${MAX_SECRET_FILE_BYTES} bayt aralığında olmalıdır.`);
    }
    const contents = readFileSync(filePath);
    if (contents.length !== stats.size || contents.includes(0)) {
      throw new Error(`${fileVariable} güvenli bir secret dosyası değildir.`);
    }
    const value = contents.toString("utf8").replace(/(?:\r?\n)+$/, "");
    if (!value) throw new Error(`${fileVariable} boş secret içeremez.`);
    environment[targetVariable] = value;
  }
};
