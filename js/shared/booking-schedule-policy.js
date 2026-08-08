const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeToMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (value) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

export function parseBookingSchedulePolicy(value) {
  const earliestTime = value?.earliestTime;
  const latestTime = value?.latestTime;
  const stepMinutes = value?.stepMinutes;
  const allowNextDay = value?.allowNextDay;

  if (
    !TIME_PATTERN.test(earliestTime ?? "") ||
    !TIME_PATTERN.test(latestTime ?? "") ||
    !Number.isInteger(stepMinutes) ||
    stepMinutes < 1 ||
    stepMinutes > 24 * 60 ||
    typeof allowNextDay !== "boolean"
  ) {
    throw new Error("Geçerli düğün saati politikası alınamadı.");
  }

  const earliestMinute = timeToMinutes(earliestTime);
  const latestMinute = timeToMinutes(latestTime);
  if (latestMinute < earliestMinute || (latestMinute - earliestMinute) % stepMinutes !== 0) {
    throw new Error("Düğün saati aralığı slot adımıyla uyumlu değil.");
  }

  return Object.freeze({ earliestTime, latestTime, stepMinutes, allowNextDay });
}

export function getBookingTimeValues(policy) {
  const earliestMinute = timeToMinutes(policy.earliestTime);
  const latestMinute = timeToMinutes(policy.latestTime);
  const values = [];
  for (let minutes = earliestMinute; minutes <= latestMinute; minutes += policy.stepMinutes) {
    values.push(minutesToTime(minutes));
  }
  return values;
}
