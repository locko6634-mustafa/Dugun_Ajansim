import { randomInt } from 'node:crypto';
import { AppError } from './appError.js';
const ISTANBUL_OFFSET = '+03:00';
export const normalizeUsername = (value) => value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ç', 'c')
    .replaceAll('ğ', 'g')
    .replaceAll('ı', 'i')
    .replaceAll('ö', 'o')
    .replaceAll('ş', 's')
    .replaceAll('ü', 'u')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
export const normalizePhone = (value) => {
    const digits = value.replace(/\D/g, '');
    const national = digits.startsWith('90')
        ? digits.slice(2)
        : digits.startsWith('0')
            ? digits.slice(1)
            : digits;
    if (!/^[2-5]\d{9}$/.test(national)) {
        throw new AppError('Geçerli bir Türkiye telefon numarası girin.', 400);
    }
    return `+90${national}`;
};
export const createWeddingRange = (weddingDate, startTime, endTime, endsNextDay) => {
    const startsAt = new Date(`${weddingDate}T${startTime}:00${ISTANBUL_OFFSET}`);
    const endDate = endsNextDay ? addCalendarDays(weddingDate, 1) : weddingDate;
    const endsAt = new Date(`${endDate}T${endTime}:00${ISTANBUL_OFFSET}`);
    if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
        throw new AppError('Düğün tarih veya saat bilgisi geçersiz.', 400);
    }
    const durationMs = endsAt.valueOf() - startsAt.valueOf();
    if (durationMs <= 0 || durationMs > 36 * 60 * 60 * 1000) {
        throw new AppError('Düğün bitişi başlangıçtan sonra ve en fazla 36 saat içinde olmalıdır.', 400);
    }
    return { startsAt, endsAt };
};
export const addCalendarDays = (date, days) => {
    const value = new Date(`${date}T12:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
};
export const getIstanbulDate = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};
export const atIstanbulTime = (date, time) => new Date(`${date}T${time}:00${ISTANBUL_OFFSET}`);
export const temporaryWeddingPassword = (date) => {
    const [year, month, day] = date.split('-');
    return `${day}${month}${year}`;
};
export const randomFourDigitCode = () => String(randomInt(1000, 10_000));
export const randomReferenceCode = () => {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `DA-${date}-${String(randomInt(100_000, 1_000_000))}`;
};
export const randomTemporaryPassword = () => `${randomFourDigitCode()}-${randomInt(100_000, 1_000_000)}-Da!`;
export const assertGoogleDriveUrl = (value) => {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new AppError('Geçerli bir Google Drive bağlantısı girin.', 400);
    }
    const allowedHosts = new Set(['drive.google.com', 'docs.google.com']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) {
        throw new AppError('Yalnızca güvenli Google Drive bağlantıları kabul edilir.', 400);
    }
    return url.toString();
};
export const formatMoney = (priceCents) => new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
}).format(priceCents / 100);
