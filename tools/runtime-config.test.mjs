import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_CURRENCY,
  APP_LOCALE,
  APP_TIME_ZONE,
  OPERATIONS_CITY,
  formatAppCurrency,
  formatAppDate,
  formatDateOnly
} from "../js/shared/runtime-config.js";

test("uygulama bölgesel ayarları tek pazar sözleşmesini korur", () => {
  assert.equal(APP_LOCALE, "tr-TR");
  assert.equal(APP_CURRENCY, "TRY");
  assert.equal(APP_TIME_ZONE, "Europe/Istanbul");
  assert.equal(OPERATIONS_CITY, "İstanbul");
  assert.equal(formatAppCurrency(1250, { maximumFractionDigits: 0 }), "₺1.250");
});

test("tarih-saat değerleri İstanbul gününe göre biçimlenir", () => {
  assert.equal(
    formatAppDate("2026-12-31T22:30:00.000Z", { day: "numeric", month: "long", year: "numeric" }),
    "1 Ocak 2027"
  );
});

test("yalnız-tarih değerleri çalışma ortamının saat diliminde gün kaydırmaz", () => {
  assert.equal(
    formatDateOnly("2026-08-10", { day: "numeric", month: "long", year: "numeric" }),
    "10 Ağustos 2026"
  );
  assert.throws(() => formatDateOnly("10.08.2026"), /YYYY-AA-GG/);
});
