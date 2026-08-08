import assert from "node:assert/strict";
import test from "node:test";
import {
  getBookingTimeValues,
  parseBookingSchedulePolicy
} from "../js/shared/booking-schedule-policy.js";

const fullDayPolicy = Object.freeze({
  earliestTime: "00:00",
  latestTime: "23:30",
  stepMinutes: 30,
  allowNextDay: true
});

test("düğün saati politikası tam gün slotlarını katalog sözleşmesinden üretir", () => {
  const policy = parseBookingSchedulePolicy(fullDayPolicy);
  const values = getBookingTimeValues(policy);

  assert.equal(values.length, 48);
  assert.equal(values[0], "00:00");
  assert.equal(values.at(-1), "23:30");
  assert.equal(values.includes("02:00"), true);
});

test("geçersiz veya slot adımıyla uyumsuz politika reddedilir", () => {
  assert.throws(() => parseBookingSchedulePolicy({ ...fullDayPolicy, stepMinutes: 0 }));
  assert.throws(() =>
    parseBookingSchedulePolicy({ ...fullDayPolicy, latestTime: "23:45", stepMinutes: 30 })
  );
});
