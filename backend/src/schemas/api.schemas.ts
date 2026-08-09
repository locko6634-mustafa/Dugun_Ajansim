import { z } from "zod";
import { isStrictGregorianDate } from "../utils/domain.js";

export const bookingFormConstraints = Object.freeze({
  personName: {
    minLength: 2,
    maxLength: 80,
    pattern: "^[\\p{L}\\p{M}][\\p{L}\\p{M} '’\\-]*$",
    message: "Ad ve soyad yalnızca harf, boşluk, kesme işareti ve kısa çizgi içerebilir."
  },
  phone: {
    minLength: 10,
    maxLength: 24,
    pattern: "^\\+?[\\d\\s()\\-]+$",
    message: "Telefon yalnızca rakam ve telefon ayraçları içerebilir."
  },
  email: { maxLength: 254 },
  customVenueName: { minLength: 2, maxLength: 140 },
  note: { maxLength: 2_000 }
});

export const bookingSchedulePolicy = Object.freeze({
  earliestTime: "00:00",
  latestTime: "23:30",
  stepMinutes: 30,
  allowNextDay: true
});

export const adminCatalogFormConstraints = Object.freeze({
  code: { minLength: 1, maxLength: 80, pattern: "^[a-z0-9-]+$" },
  name: { minLength: 2, maxLength: 80 },
  subtitle: { maxLength: 200 },
  eyebrow: { maxLength: 100 },
  description: { maxLength: 2_000 },
  imagePath: { maxLength: 500 },
  delivery: { maxLength: 200 },
  feature: { maxLength: 500 },
  galleryItem: { maxLength: 500 },
  priceCents: { minimum: 0, maximum: 100_000_000, step: 1 },
  venue: {
    displayName: { minLength: 2, maxLength: 140 },
    displayOrder: { minimum: 0, maximum: 10_000, step: 1 }
  }
});

const imageAssetPathSchema = z
  .string()
  .trim()
  .max(adminCatalogFormConstraints.imagePath.maxLength)
  .regex(
    /^assets\/images\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_-]*\.(?:avif|gif|jpe?g|png|webp)$/i,
    "Görsel yolu assets/images altında güvenli bir resim dosyası olmalıdır."
  );

const nameSchema = z
  .string()
  .trim()
  .min(bookingFormConstraints.personName.minLength)
  .max(bookingFormConstraints.personName.maxLength);
const personNameSchema = nameSchema.regex(
  new RegExp(bookingFormConstraints.personName.pattern, "u"),
  bookingFormConstraints.personName.message
);
const phoneSchema = z
  .string()
  .trim()
  .min(bookingFormConstraints.phone.minLength)
  .max(bookingFormConstraints.phone.maxLength)
  .regex(new RegExp(bookingFormConstraints.phone.pattern), bookingFormConstraints.phone.message);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isStrictGregorianDate, "Geçerli bir takvim tarihi girin.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const codeSchema = z
  .string()
  .trim()
  .min(adminCatalogFormConstraints.code.minLength)
  .max(adminCatalogFormConstraints.code.maxLength);
const catalogNameSchema = z
  .string()
  .trim()
  .min(adminCatalogFormConstraints.name.minLength)
  .max(adminCatalogFormConstraints.name.maxLength);
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
  "sifrem123456789",
  "ilkgiristedegistirilecekgucluparola"
]);

const normalizePasswordForBlocklist = (value: string): string =>
  value.normalize("NFKC").trim().toLowerCase();

const passwordHasPredictablePattern = (value: string): boolean => {
  const normalized = normalizePasswordForBlocklist(value).replace(/\s+/g, "");
  if (/(.)\1{5,}/u.test(normalized)) return true;

  for (let unitLength = 1; unitLength <= 4; unitLength += 1) {
    if (normalized.length % unitLength !== 0) continue;
    const unit = normalized.slice(0, unitLength);
    if (unit.repeat(normalized.length / unitLength) === normalized) return true;
  }

  const sequences = [
    "0123456789",
    "9876543210",
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
    "qwertyuiopasdfghjklzxcvbnm",
    "mnbvcxzlkjhgfdsaqpoiuytrewq"
  ];
  for (let index = 0; index <= normalized.length - 6; index += 1) {
    const fragment = normalized.slice(index, index + 6);
    if (sequences.some((sequence) => sequence.includes(fragment))) return true;
  }
  return false;
};

const normalizeCredentialComparison = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[013457]/g, (character) => ({
      "0": "o",
      "1": "i",
      "3": "e",
      "4": "a",
      "5": "s",
      "7": "t"
    })[character]!)
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

export const isPasswordSimilarToUsername = (password: string, username: string): boolean => {
  const passwordKey = normalizeCredentialComparison(password);
  const usernameKey = normalizeCredentialComparison(username);
  return usernameKey.length >= 3 && passwordKey.includes(usernameKey);
};

export const strongPasswordSchema = z
  .string()
  .min(15, "Yeni parola en az 15 karakter olmalıdır.")
  .max(128)
  .refine(
    (value) => !blockedPasswords.has(normalizePasswordForBlocklist(value)),
    "Daha az yaygın bir parola seçin."
  )
  .refine(
    (value) => !passwordHasPredictablePattern(value),
    "Parolanız tekrar eden veya sıralı bir desen içeremez."
  );

const addUsernamePasswordIssue = (
  value: { username?: string; password?: string },
  context: z.RefinementCtx
): void => {
  if (value.username && value.password && isPasswordSimilarToUsername(value.password, value.username)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["password"],
      message: "Parola kullanıcı adına benzememelidir."
    });
  }
};

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, "6 haneli doğrulama kodunu girin.");

const bookingBodyBaseSchema = z
  .object({
    brideFirstName: personNameSchema,
    brideLastName: personNameSchema,
    bridePhone: phoneSchema,
    groomFirstName: personNameSchema,
    groomLastName: personNameSchema,
    groomPhone: phoneSchema,
    primaryContact: z.enum(["GELIN", "DAMAT"]),
    primaryEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(bookingFormConstraints.email.maxLength),
    weddingDate: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    endsNextDay: z.boolean(),
    venueId: z.string().uuid().optional(),
    customVenueName: z
      .string()
      .trim()
      .min(bookingFormConstraints.customVenueName.minLength)
      .max(bookingFormConstraints.customVenueName.maxLength)
      .refine(
        (value) => !/[\u0000-\u001F\u007F]/.test(value),
        "Salon adı kontrol karakteri içeremez."
      )
      .optional(),
    packageCode: codeSchema,
    serviceCodes: z.array(codeSchema).max(20).default([]),
    paymentMethod: z.enum(["CASH", "DEPOSIT"]),
    note: z.string().trim().max(bookingFormConstraints.note.maxLength).optional().or(z.literal("")),
    privacyConsent: z.literal(true),
    marketingConsent: z.boolean().default(false)
  })
  .strict();

const validateVenueChoice = (
  value: { venueId?: string; customVenueName?: string },
  context: z.RefinementCtx
) => {
  if (!value.venueId && !value.customVenueName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["venueId"],
      message: "Bir salon seçin veya salon adını yazın."
    });
  }
  if (value.venueId && value.customVenueName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customVenueName"],
      message: "Salon seçimi ve özel salon adı birlikte gönderilemez."
    });
  }
};

export const bookingBodySchema = bookingBodyBaseSchema.superRefine(validateVenueChoice);

export const adminBookingBodySchema = bookingBodyBaseSchema
  .extend({ privacyConsent: z.boolean().default(false) })
  .superRefine(validateVenueChoice);

export const loginBodySchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    password: z.string().min(6).max(256),
    totpCode: totpCodeSchema.optional(),
    remember: z.boolean().default(false)
  })
  .strict();

export const passwordChangeBodySchema = z
  .object({
    currentPassword: z.string().min(6).max(256),
    newPassword: strongPasswordSchema
  })
  .strict();

export const passwordSetupBodySchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Kurulum bağlantısı geçersiz'),
    newPassword: strongPasswordSchema,
  })
  .strict();

export const mfaEnrollmentBodySchema = z
  .object({ currentPassword: z.string().min(6).max(256) })
  .strict();

export const mfaProtectedActionBodySchema = z
  .object({
    currentPassword: z.string().min(6).max(256),
    totpCode: totpCodeSchema
  })
  .strict();

export const rejectBookingBodySchema = z
  .object({
    reason: z.string().trim().min(3).max(500)
  })
  .strict();

export const packageBodySchema = z
  .object({
    code: codeSchema.regex(new RegExp(adminCatalogFormConstraints.code.pattern)),
    name: catalogNameSchema,
    subtitle: z
      .string()
      .trim()
      .max(adminCatalogFormConstraints.subtitle.maxLength)
      .optional()
      .nullable(),
    description: z
      .string()
      .trim()
      .max(adminCatalogFormConstraints.description.maxLength)
      .optional()
      .nullable(),
    imagePath: imageAssetPathSchema.optional().nullable(),
    priceCents: z
      .number()
      .int()
      .min(adminCatalogFormConstraints.priceCents.minimum)
      .max(adminCatalogFormConstraints.priceCents.maximum),
    deliveryText: z
      .string()
      .trim()
      .max(adminCatalogFormConstraints.delivery.maxLength)
      .optional()
      .nullable(),
    features: z
      .array(z.string().trim().max(adminCatalogFormConstraints.feature.maxLength))
      .optional()
      .default([]),
    isActive: z.boolean().default(true)
  })
  .strict();

export const serviceBodySchema = z
  .object({
    code: codeSchema.regex(new RegExp(adminCatalogFormConstraints.code.pattern)),
    category: codeSchema,
    name: catalogNameSchema,
    eyebrow: z
      .string()
      .trim()
      .max(adminCatalogFormConstraints.eyebrow.maxLength)
      .optional()
      .nullable(),
    description: z
      .string()
      .trim()
      .max(adminCatalogFormConstraints.description.maxLength)
      .optional()
      .nullable(),
    imagePath: imageAssetPathSchema.optional().nullable(),
    priceCents: z
      .number()
      .int()
      .min(adminCatalogFormConstraints.priceCents.minimum)
      .max(adminCatalogFormConstraints.priceCents.maximum),
    delivery: z
      .string()
      .trim()
      .max(adminCatalogFormConstraints.delivery.maxLength)
      .optional()
      .nullable(),
    features: z
      .array(z.string().trim().max(adminCatalogFormConstraints.feature.maxLength))
      .optional()
      .default([]),
    gallery: z.array(imageAssetPathSchema).optional().default([]),
    isActive: z.boolean().default(true)
  })
  .strict();

export const venueBodySchema = z
  .object({
    slug: codeSchema.regex(new RegExp(adminCatalogFormConstraints.code.pattern)),
    name: catalogNameSchema,
    displayName: z
      .string()
      .trim()
      .min(adminCatalogFormConstraints.venue.displayName.minLength)
      .max(adminCatalogFormConstraints.venue.displayName.maxLength)
      .optional()
      .nullable(),
    imagePath: imageAssetPathSchema.optional().nullable(),
    displayOrder: z
      .number()
      .int()
      .min(adminCatalogFormConstraints.venue.displayOrder.minimum)
      .max(adminCatalogFormConstraints.venue.displayOrder.maximum)
      .default(0),
    isFeatured: z.boolean().default(false),
    isActive: z.boolean().default(true),
    isPartner: z.boolean().default(true)
  })
  .strict();

export const deliveryUpdateBodySchema = z
  .object({
    status: z.enum(["HAZIRLANIYOR", "MONTAJ", "KONTROL", "TESLIME_HAZIR"]).optional(),
    dueDate: dateSchema.optional(),
    driveUrl: z.string().trim().url().max(2_000).nullable().optional()
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
    packageCode: codeSchema,
    serviceCodes: z.array(codeSchema).max(20),
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
  .strict()
  .superRefine(addUsernamePasswordIssue);

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
  .superRefine(addUsernamePasswordIssue)
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
    weekStart: dateSchema.optional(),
    availabilityDate: dateSchema.optional(),
    venueId: z.string().uuid().optional()
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
