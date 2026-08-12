import type { Prisma } from '@prisma/client';
import { AppError } from './appError.js';
import { piiCryptography } from './pii-crypto.js';

type ActiveStaffPhoneInput = {
  venueId: string;
  phone: string;
  isActive: boolean;
  excludeStaffId?: string;
};

export const assertActiveStaffPhoneAvailable = async (
  transaction: Prisma.TransactionClient,
  input: ActiveStaffPhoneInput,
): Promise<void> => {
  if (!input.isActive) return;
  const candidates = piiCryptography.blindIndexCandidates('Staff.phone', input.phone, 'phone');
  const conflict = await transaction.staff.findFirst({
    where: {
      venueId: input.venueId,
      isActive: true,
      ...(input.excludeStaffId ? { id: { not: input.excludeStaffId } } : {}),
      OR: candidates.map((candidate) => ({
        phoneBlindIndex: candidate.value,
        piiBlindIndexKeyId: candidate.keyId,
        piiBlindIndexVersion: candidate.version,
      })),
    },
    select: { id: true },
  });
  if (conflict) {
    throw new AppError('Bu salonda aynı telefonla aktif bir personel var.', 409, true, undefined, {
      code: 'ACTIVE_STAFF_PHONE_CONFLICT',
    });
  }
};
