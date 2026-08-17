import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { env } from "../config/env.config.js";
import { AppError } from "../utils/appError.js";

export const STAFF_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const STAFF_PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

type StaffPhotoContentType = (typeof STAFF_PHOTO_CONTENT_TYPES)[number];
type StoredStaffPhoto = { key: string; updatedAt: Date };

const contentTypeFormats: Record<StaffPhotoContentType, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp"
};
const storageKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f-]{36}\.webp$/i;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const storageRoot = (directory: string): string => path.resolve(directory);

const resolveStorageKey = (key: string, directory: string): string => {
  if (!storageKeyPattern.test(key))
    throw new Error("Geçersiz personel fotoğrafı depolama anahtarı.");
  const root = storageRoot(directory);
  const resolved = path.resolve(root, ...key.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Personel fotoğrafı yolu depolama dizini dışına çıkıyor.");
  }
  return resolved;
};

const assertUploadContentType = (contentType: string): StaffPhotoContentType => {
  if (!STAFF_PHOTO_CONTENT_TYPES.includes(contentType as StaffPhotoContentType)) {
    throw new AppError("Yalnızca JPG, PNG veya WebP fotoğraf yükleyebilirsiniz.", 415);
  }
  return contentType as StaffPhotoContentType;
};

export const storeStaffPhoto = async (
  staffId: string,
  source: Buffer,
  contentType: string,
  directory = env.STAFF_PHOTO_STORAGE_DIR
): Promise<StoredStaffPhoto> => {
  const acceptedContentType = assertUploadContentType(contentType);
  if (source.length === 0) throw new AppError("Fotoğraf dosyası boş olamaz.", 400);
  if (source.length > STAFF_PHOTO_MAX_BYTES) {
    throw new AppError("Fotoğraf en fazla 5 MB olabilir.", 413);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(source, { failOn: "warning", limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new AppError("Fotoğraf dosyası okunamadı veya bozuk.", 415);
  }
  if (metadata.format !== contentTypeFormats[acceptedContentType]) {
    throw new AppError("Fotoğraf içeriği dosya türüyle eşleşmiyor.", 415);
  }

  let output: Buffer;
  try {
    output = await sharp(source, { failOn: "warning", limitInputPixels: 40_000_000 })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention", withoutEnlargement: false })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();
  } catch {
    throw new AppError("Fotoğraf işlenemedi.", 415);
  }

  const key = `${staffId}/${randomUUID()}.webp`;
  const destination = resolveStorageKey(key, directory);
  const photoDirectory = path.dirname(destination);
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await mkdir(photoDirectory, { recursive: true, mode: 0o750 });
  try {
    await writeFile(temporaryPath, output, { flag: "wx", mode: 0o640 });
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { key, updatedAt: new Date() };
};

export const readStaffPhoto = async (
  key: string,
  directory = env.STAFF_PHOTO_STORAGE_DIR
): Promise<Buffer> => {
  try {
    return await readFile(resolveStorageKey(key, directory));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new AppError("Personel fotoğrafı bulunamadı.", 404);
    }
    throw error;
  }
};

export const removeStaffPhoto = async (
  key: string | null | undefined,
  directory = env.STAFF_PHOTO_STORAGE_DIR
): Promise<void> => {
  if (!key) return;
  try {
    const destination = resolveStorageKey(key, directory);
    await rm(destination, { force: true });
    await rm(path.dirname(destination), { recursive: false }).catch(() => undefined);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
};

export const staffPhotoUrl = (
  scope: "admin" | "operations",
  staffId: string,
  updatedAt: Date | null | undefined
): string | null =>
  updatedAt
    ? `/api/v1/${scope}/staff/${staffId}/photo?v=${encodeURIComponent(updatedAt.toISOString())}`
    : null;
