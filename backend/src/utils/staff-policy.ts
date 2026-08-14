import type { Prisma } from "@prisma/client";
import { AppError } from "./appError.js";
import { piiCryptography } from "./pii-crypto.js";

type ActiveStaffPhoneInput = {
  venueId?: string;
  venueIds?: string[];
  phone: string;
  isActive: boolean;
  excludeStaffId?: string;
};

export const assertActiveStaffPhoneAvailable = async (
  transaction: Prisma.TransactionClient,
  input: ActiveStaffPhoneInput
): Promise<void> => {
  if (!input.isActive) return;
  const venueIds = [
    ...new Set([...(input.venueIds ?? []), ...(input.venueId ? [input.venueId] : [])])
  ];
  if (venueIds.length === 0) throw new AppError("Personel için en az bir salon seçilmelidir.", 400);
  const candidates = piiCryptography.blindIndexCandidates("Staff.phone", input.phone, "phone");
  const conflict = await transaction.staff.findFirst({
    where: {
      OR: [
        { venueId: { in: venueIds } },
        { venueAssignments: { some: { venueId: { in: venueIds } } } }
      ],
      isActive: true,
      ...(input.excludeStaffId ? { id: { not: input.excludeStaffId } } : {}),
      AND: {
        OR: candidates.map((candidate) => ({
          phoneBlindIndex: candidate.value,
          piiBlindIndexKeyId: candidate.keyId,
          piiBlindIndexVersion: candidate.version
        }))
      }
    },
    select: { id: true }
  });
  if (conflict) {
    throw new AppError("Bu salonda aynı telefonla aktif bir personel var.", 409, true, undefined, {
      code: "ACTIVE_STAFF_PHONE_CONFLICT"
    });
  }
};
