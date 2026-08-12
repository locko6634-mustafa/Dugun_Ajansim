export const APP_LOCALE = "tr-TR";
export const APP_CURRENCY = "TRY";
export const APP_TIME_ZONE = "Europe/Istanbul";
export const OPERATIONS_CITY = "İstanbul";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatAppDate(value, options = {}) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    ...options
  }).format(new Date(value));
}

export function formatAppTime(value) {
  return formatAppDate(value, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateOnly(value, options = {}) {
  if (!DATE_ONLY_PATTERN.test(value)) throw new TypeError("Tarih YYYY-AA-GG biçiminde olmalıdır.");
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: "UTC",
    ...options
  }).format(new Date(`${value}T12:00:00.000Z`));
}

export function formatAppCurrency(value, options = {}) {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: APP_CURRENCY,
    ...options
  }).format(value);
}
