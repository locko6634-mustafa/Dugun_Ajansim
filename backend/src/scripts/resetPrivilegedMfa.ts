import { randomUUID } from "node:crypto";
import { prisma, runWithRlsContext } from "../config/prisma.js";
import { normalizeUsername } from "../utils/domain.js";
import { writeAuditLog } from "../utils/audit.js";

const main = async (): Promise<void> => {
  const rawUsername = process.env.MFA_RECOVERY_USERNAME ?? "";
  const username = normalizeUsername(rawUsername);
  const confirmation = process.env.MFA_RECOVERY_CONFIRM ?? "";
  if (!username || confirmation !== `RESET-MFA:${username}`) {
    throw new Error("MFA recovery için kullanıcı adı ve birebir onay ifadesi zorunludur.");
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      role: true,
      status: true,
      updatedAt: true,
      totpEnabledAt: true
    }
  });
  if (
    !user ||
    user.status !== "ACTIVE" ||
    !["ADMIN", "SALON_YETKILISI"].includes(user.role) ||
    user.totpEnabledAt === null
  ) {
    throw new Error("Sıfırlanabilir etkin ayrıcalıklı MFA kaydı bulunamadı.");
  }

  const now = new Date();
  await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.user.updateMany({
      where: { id: user.id, updatedAt: user.updatedAt, totpEnabledAt: { not: null } },
      data: {
        totpSecretCiphertext: null,
        totpSecretIv: null,
        totpSecretAuthTag: null,
        totpKeyId: null,
        totpEnrollmentExpiresAt: null,
        totpEnabledAt: null,
        totpLastUsedStep: null
      }
    });
    if (claimed.count !== 1) throw new Error("MFA kaydı eşzamanlı olarak değiştirildi.");
    await transaction.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now }
    });
    await writeAuditLog(transaction, {
      data: {
        action: "auth.mfa_recovery_reset",
        targetType: "User",
        targetId: user.id,
        correlationId: randomUUID(),
        metadata: { role: user.role, recovery: "offline-operator" }
      }
    });
  });

  console.log(JSON.stringify({ success: true, userId: user.id, sessionsRevoked: true }));
};

runWithRlsContext({ actorRole: "maintenance", purpose: "maintenance.reset-mfa" }, main)
  .catch(() => {
    console.error("MFA recovery işlemi tamamlanamadı; hesap ayrıntıları loglanmadı.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
