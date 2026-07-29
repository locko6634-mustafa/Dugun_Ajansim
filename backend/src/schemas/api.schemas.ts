import { z } from 'zod';

const nameSchema = z.string().trim().min(2).max(80);
const phoneSchema = z.string().trim().min(10).max(24);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const codeSchema = z.string().trim().min(1).max(80);

export const bookingBodySchema = z.object({
  brideFirstName: nameSchema,
  brideLastName: nameSchema,
  bridePhone: phoneSchema,
  groomFirstName: nameSchema,
  groomLastName: nameSchema,
  groomPhone: phoneSchema,
  primaryContact: z.enum(['GELIN', 'DAMAT']),
  primaryEmail: z.string().trim().toLowerCase().email().max(254),
  weddingDate: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  endsNextDay: z.boolean(),
  venueId: z.string().uuid(),
  packageCode: codeSchema,
  serviceCodes: z.array(codeSchema).max(20).default([]),
  paymentMethod: z.enum(['CASH', 'DEPOSIT']),
  note: z.string().trim().max(2_000).optional().or(z.literal('')),
  privacyConsent: z.literal(true),
  marketingConsent: z.boolean().default(false),
});

export const adminBookingBodySchema = bookingBodySchema.extend({
  privacyConsent: z.boolean().default(false),
});

export const loginBodySchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(6).max(256),
  remember: z.boolean().default(false),
});

export const passwordChangeBodySchema = z.object({
  currentPassword: z.string().min(6).max(256),
  newPassword: z
    .string()
    .min(10, 'Yeni parola en az 10 karakter olmalıdır.')
    .max(128)
    .regex(/[a-zçğıöşü]/i, 'Yeni parola harf içermelidir.')
    .regex(/\d/, 'Yeni parola rakam içermelidir.'),
});

export const rejectBookingBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const packageBodySchema = z.object({
  code: codeSchema.regex(/^[a-z0-9-]+$/),
  name: nameSchema,
  description: z.string().trim().max(1_000).optional().nullable(),
  imagePath: z.string().trim().max(500).optional().nullable(),
  priceCents: z.number().int().min(0).max(100_000_000),
  isActive: z.boolean().default(true),
});

export const serviceBodySchema = z.object({
  code: codeSchema.regex(/^[a-z0-9-]+$/),
  category: codeSchema,
  name: nameSchema,
  eyebrow: z.string().trim().max(100).optional().nullable(),
  description: z.string().trim().max(2_000).optional().nullable(),
  imagePath: z.string().trim().max(500).optional().nullable(),
  priceCents: z.number().int().min(0).max(100_000_000),
  isActive: z.boolean().default(true),
});

export const deliveryUpdateBodySchema = z.object({
  status: z.enum(['HAZIRLANIYOR', 'MONTAJ', 'KONTROL', 'TESLIME_HAZIR']).optional(),
  dueDate: dateSchema.optional(),
  driveUrl: z.string().trim().url().max(2_000).optional(),
});

export const weddingUpdateBodySchema = z.object({
  brideFirstName: nameSchema,
  brideLastName: nameSchema,
  bridePhone: phoneSchema,
  groomFirstName: nameSchema,
  groomLastName: nameSchema,
  groomPhone: phoneSchema,
  primaryContact: z.enum(['GELIN', 'DAMAT']),
  primaryEmail: z.string().trim().toLowerCase().email().max(254),
  weddingDate: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  endsNextDay: z.boolean(),
  venueId: z.string().uuid(),
  note: z.string().trim().max(2_000).optional().or(z.literal('')),
});

export const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

export const bookingQuerySchema = z.object({
  status: z.enum(['ONAY_BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI', 'IPTAL_EDILDI']).optional(),
  referenceCode: z.string().trim().min(3).max(40).optional(),
});
