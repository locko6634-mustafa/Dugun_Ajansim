import assert from "node:assert/strict";
import test from "node:test";
import { isSafeImageAssetPath, safeImageAssetPath } from "../js/shared/asset-url.js";

test("yalnız aynı origin altındaki güvenli resim asset yolları kabul edilir", () => {
  assert.equal(isSafeImageAssetPath("assets/images/services/fotograf-cekimi.webp"), true);
  assert.equal(isSafeImageAssetPath("https://tracker.example/customer.gif"), false);
  assert.equal(isSafeImageAssetPath("assets/images/../secret.svg"), false);
  assert.equal(isSafeImageAssetPath("data:image/svg+xml,<svg></svg>"), false);
  assert.equal(
    safeImageAssetPath("https://tracker.example/customer.gif"),
    "assets/images/hero-couple.webp"
  );
});
