const IMAGE_ASSET_PATH_PATTERN =
  /^assets\/images\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_-]*\.(?:avif|gif|jpe?g|png|webp)$/i;

export function isSafeImageAssetPath(value) {
  return typeof value === "string" && IMAGE_ASSET_PATH_PATTERN.test(value.trim());
}

export function safeImageAssetPath(value, fallback = "assets/images/hero-couple.webp") {
  return isSafeImageAssetPath(value) ? value.trim() : fallback;
}
