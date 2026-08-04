import { z } from "zod";
import { isStrictGregorianDate } from "../utils/domain.js";

const nameSchema = z.string().trim().min(2).max(80);
const personNameSchema = nameSchema.regex(
  /^[\p{L}\p{M}][\p{L}\p{M} '’\-]*$/u,
  "Ad ve soyad yalnızca harf, boşluk, kesme işareti ve kısa çizgi içerebilir."
);
const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(24)
  .regex(/^\+?[\d\s()\-]+$/, "Telefon yalnızca rakam ve telefon ayraçları içerebilir.");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isStrictGregorianDate, "Geçerli bir takvim tarihi girin.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const codeSchema = z.string().trim().min(1).max(80);
export const staffSpecialtySchema = z.enum([
  "PHOTOGRAPHY",
  "VIDEO",
  "DRONE",
  "JIMMY_JIB",
  "ASSISTANT",
  "EDITING",
  "ALBUM"
]);
const blockedPasswords = new Set([
  "123456789012345",
  "passwordpassword",
  "qwertyuiopasdfgh",
  "dugunajansim123",
  "sifrem123456789"
]);

const normalizePasswordForBlocklist = (value: string): string =>
  value.normalize("NFKC").trim().toLowerCase();

export const strongPasswordSchema = z
  .string()
  .min(15, "Yeni parola en az 15 karakter olmalıdır.")
  .max(128)
  .refine(
    (value) => !blockedPasswords.has(normalizePasswordForBlocklist(value)),
    "Daha az yaygın bir parola seçin."
  );

export const bookingBodySchema = z
  .object({
    brideFirstName: personNameSchema,
    brideLastName: personNameSchema,
    bridePhone: phoneSchema,
    groomFirstName: personNameSchema,
    groomLastName: personNameSchema,
    groomPhone: phoneSchema,
    primaryContact: z.enum(["GELIN", "DAMAT"]),
    primaryEmail: z.string().trim().toLowerCase().email().max(254),
    weddingDate: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    endsNextDay: z.boolean(),
    venueId: z.string().uuid(),
    packageCode: codeSchema,
    serviceCodes: z.array(codeSchema).max(20).default([]),
    paymentMethod: z.enum(["CASH", "DEPOSIT"]),
    note: z.string().trim().max(2_000).optional().or(z.literal("")),
    privacyConsent: z.literal(true),
    marketingConsent: z.boolean().default(false)
  })
  .strict();

export const adminBookingBodySchema = bookingBodySchema.extend({
  privacyConsent: z.boolean().default(false)
});

export const loginBodySchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    password: z.string().min(6).max(256),
    remember: z.boolean().default(false)
  })
  .strict();

export const passwordChangeBodySchema = z
  .object({
    currentPassword: z.string().min(6).max(256),
    newPassword: strongPasswordSchema
  })
  .strict();

export const rejectBookingBodySchema = z
  .object({
    reason: z.string().trim().min(3).max(500)
  })
  .strict();

export const packageBodySchema = z
  .object({
    code: codeSchema.regex(/^[a-z0-9-]+$/),
    name: nameSchema,
    description: z.string().trim().max(1_000).optional().nullable(),
    imagePath: z.string().trim().max(500).optional().nullable(),
    priceCents: z.number().int().min(0).max(100_000_000),
    isActive: z.boolean().default(true)
  })
  .strict();

export const serviceBodySchema = z
  .object({
    code: codeSchema.regex(/^[a-z0-9-]+$/),
    category: codeSchema,
    name: nameSchema,
    eyebrow: z.string().trim().max(100).optional().nullable(),
    description: z.string().trim().max(2_000).optional().nullable(),
    imagePath: z.string().trim().max(500).optional().nullable(),
    priceCents: z.number().int().min(0).max(100_000_000),
    isActive: z.boolean().default(true)
  })
  .strict();

export const deliveryUpdateBodySchema = z
  .object({
    status: z.enum(["HAZIRLANIYOR", "MONTAJ", "KONTROL", "TESLIME_HAZIR"]).optional(),
    dueDate: dateSchema.optional(),
    driveUrl: z.string().trim().url().max(2_000).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "En az bir alan gönderin.");

export const weddingUpdateBodySchema = z
  .object({
    brideFirstName: personNameSchema,
    brideLastName: personNameSchema,
    bridePhone: phoneSchema,
    groomFirstName: personNameSchema,
    groomLastName: personNameSchema,
    groomPhone: phoneSchema,
    primaryContact: z.enum(["GELIN", "DAMAT"]),
    primaryEmail: z.string().trim().toLowerCase().email().max(254),
    weddingDate: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    endsNextDay: z.boolean(),
    venueId: z.string().uuid(),
    note: z.string().trim().max(2_000).optional().or(z.literal(""))
  })
  .strict();

export const staffBodySchema = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    phone: phoneSchema,
    specialties: z.array(staffSpecialtySchema).min(1).max(7),
    isActive: z.boolean().default(true),
    venueId: z.string().uuid()
  })
  .strict();

export const staffUpdateBodySchema = staffBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "En az bir alan gönderin.");

export const venueStaffBodySchema = staffBodySchema.omit({ venueId: true });
export const venueStaffUpdateBodySchema = venueStaffBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "En az bir alan gönderin.");

export const venueManagerBodySchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/),
    password: strongPasswordSchema,
    venueId: z.string().uuid(),
    status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE")
  })
  .strict();

export const venueManagerUpdateBodySchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/)
      .optional(),
    password: strongPasswordSchema.optional(),
    venueId: z.string().uuid().optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "En az bir alan gönderin.");

export const operationalWeddingUpdateBodySchema = z
  .object({
    weddingDate: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    endsNextDay: z.boolean(),
    note: z.string().trim().max(2_000).optional().or(z.literal(""))
  })
  .strict();

export const assignmentBodySchema = z
  .object({
    staffId: z.string().uuid(),
    specialty: staffSpecialtySchema,
    allowConflict: z.boolean().default(false)
  })
  .strict();

export const dashboardQuerySchema = z
  .object({
    weekStart: dateSchema.optional()
  })
  .strict();

export const calendarQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    venueId: z.string().uuid().optional()
  })
  .strict();

export const uuidParamsSchema = z
  .object({
    id: z.string().uuid()
  })
  .strict();

export const bookingQuerySchema = z
  .object({
    status: z.enum(["ONAY_BEKLIYOR", "ONAYLANDI", "REDDEDILDI", "IPTAL_EDILDI"]).optional(),
    referenceCode: z.string().trim().min(3).max(40).optional(),
    includeArchived: z.enum(["true", "false"]).optional()
  })
  .strict();

export const archivedQuerySchema = z
  .object({
    includeArchived: z.enum(["true", "false"]).optional()
  })
  .strict();

export const permanentDeleteBodySchema = z
  .object({
    confirmText: z.string().trim().min(3).max(160)
  })
  .strict();
