import { randomUUID } from 'node:crypto';
import { env } from '../config/env.config.js';
import { prisma } from '../config/prisma.js';
import { strongPasswordSchema } from '../schemas/api.schemas.js';
import { hashPassword } from '../utils/crypto.js';
import { createTemporaryPasswordExpiry, normalizeUsername } from '../utils/domain.js';

const username = normalizeUsername(process.env.ADMIN_BOOTSTRAP_USERNAME ?? '');
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';

if (username.length < 3 || !strongPasswordSchema.safeParse(password).success) {
  throw new Error(
    'ADMIN_BOOTSTRAP_USERNAME ve 15-128 karakterlik güvenli ADMIN_BOOTSTRAP_PASSWORD zorunludur.',
  );
}

const passwordHash = await hashPassword(password);
const now = new Date();
try {
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1940667980)`;
    const existingAdmin = await transaction.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    if (existingAdmin) {
      throw new Error('Sistemde zaten bir admin hesabı var. Bootstrap işlemi durduruldu.');
    }

    const created = await transaction.user.create({
      data: {
        username,
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true,
        activeAt: now,
        temporaryPasswordExpiresAt: createTemporaryPasswordExpiry(
          env.TEMPORARY_PASSWORD_TTL_HOURS,
          now,
        ),
      },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: created.id,
        action: 'admin.bootstrapped',
        targetType: 'User',
        targetId: created.id,
        correlationId: randomUUID(),
      },
    });
  });

  console.log('İlk admin başarıyla oluşturuldu.');
} finally {
  await prisma.$disconnect();
}
