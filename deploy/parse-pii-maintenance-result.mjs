#!/usr/bin/env node

import { readFileSync } from "node:fs";

const EXPECTED_COUNTERS = Object.freeze({
  backfill: Object.freeze([
    "bookingApplications",
    "weddings",
    "messageTasks",
    "staff",
    "deliveries"
  ]),
  "redact-legacy": Object.freeze(["bookingApplications", "weddings", "messageTasks", "staff"])
});

const expectedOperation = process.argv[2];
const expectedCounters = EXPECTED_COUNTERS[expectedOperation];

const reject = (message) => {
  console.error(`PII bakım sonucu geçersiz: ${message}`);
  process.exit(2);
};

if (!expectedCounters) reject("beklenmeyen operasyon.");

const lines = readFileSync(0, "utf8")
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean);

if (lines.length === 0) reject("JSON çıktı bulunamadı.");

let result;
try {
  result = JSON.parse(lines.at(-1));
} catch {
  reject("son satır geçerli JSON değil.");
}

if (result === null || typeof result !== "object" || Array.isArray(result)) {
  reject("kök değer nesne olmalıdır.");
}
if (result.operation !== expectedOperation) reject("operasyon eşleşmiyor.");

const counters = result.updated;
if (counters === null || typeof counters !== "object" || Array.isArray(counters)) {
  reject("updated sayaç nesnesi eksik.");
}

const actualCounterNames = Object.keys(counters).sort();
const expectedCounterNames = [...expectedCounters].sort();
if (
  actualCounterNames.length !== expectedCounterNames.length ||
  actualCounterNames.some((name, index) => name !== expectedCounterNames[index])
) {
  reject("beklenen model sayaçları eksik veya fazladan sayaç var.");
}

let remaining = false;
for (const counterName of expectedCounters) {
  const value = counters[counterName];
  if (!Number.isSafeInteger(value) || value < 0) {
    reject(`${counterName} sayacı negatif olmayan güvenli tam sayı olmalıdır.`);
  }
  remaining ||= value > 0;
}

process.exit(remaining ? 10 : 0);
