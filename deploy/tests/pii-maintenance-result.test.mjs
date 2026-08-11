import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const parserPath = fileURLToPath(new URL("../parse-pii-maintenance-result.mjs", import.meta.url));

const runParser = (operation, updated) =>
  spawnSync(process.execPath, [parserPath, operation], {
    input: `${JSON.stringify({ operation, batchSize: 100, updated })}\n`,
    encoding: "utf8"
  });

const emptyBackfill = () => ({
  bookingApplications: 0,
  weddings: 0,
  messageTasks: 0,
  staff: 0,
  deliveries: 0
});

test("backfill ancak bütün model sayaçları sıfırsa tamamlanır", () => {
  assert.equal(runParser("backfill", emptyBackfill()).status, 0);
});

test("çok partili Staff ve Delivery backfill erken tamamlanmaz", () => {
  const batches = [
    { ...emptyBackfill(), staff: 100 },
    { ...emptyBackfill(), deliveries: 4 },
    emptyBackfill()
  ];

  assert.deepEqual(
    batches.map((updated) => runParser("backfill", updated).status),
    [10, 10, 0]
  );
});

test("redact-legacy Staff sayacı sıfırlanana kadar devam eder", () => {
  const pending = {
    bookingApplications: 0,
    weddings: 0,
    messageTasks: 0,
    staff: 1
  };
  assert.equal(runParser("redact-legacy", pending).status, 10);
  assert.equal(runParser("redact-legacy", { ...pending, staff: 0 }).status, 0);
});

test("eksik, fazla ve bozuk sayaç sözleşmeleri fail-closed reddedilir", () => {
  const missing = emptyBackfill();
  delete missing.deliveries;
  assert.equal(runParser("backfill", missing).status, 2);
  assert.equal(runParser("backfill", { ...emptyBackfill(), unknownModel: 0 }).status, 2);
  assert.equal(runParser("backfill", { ...emptyBackfill(), staff: -1 }).status, 2);
});
