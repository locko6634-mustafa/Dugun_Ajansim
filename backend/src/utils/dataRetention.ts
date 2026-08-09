import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1_000;

export type DataRetentionPolicy = {
  publicApplicationDays: number;
  archivedApplicationDays: number;
  archivedWeddingDays: number;
  securityArtifactDays: number;
  batchSize: number;
};

export const buildRetentionCutoffs = (policy: DataRetentionPolicy, now = new Date()) => ({
  publicApplication: new Date(now.valueOf() - policy.publicApplicationDays * DAY_MS),
  archivedApplication: new Date(now.valueOf() - policy.archivedApplicationDays * DAY_MS),
  archivedWedding: new Date(now.valueOf() - policy.archivedWeddingDays * DAY_MS),
  securityArtifact: new Date(now.valueOf() - policy.securityArtifactDays * DAY_MS),
});

export type DataRetentionBatchResult = {
  rateLimitBuckets: number;
  authSessions: number;
  passwordSetupTokens: number;
  publicApplications: number;
  archivedApplications: number;
  archivedWeddings: number;
  customerUsers: number;
};

export const countRetentionDeletes = (result: DataRetentionBatchResult): number =>
  Object.values(result).reduce((total, count) => total + count, 0);

export const runDataRetentionBatch = async (
  client: PrismaClient,
  policy: DataRetentionPolicy,
  now = new Date(),
): Promise<DataRetentionBatchResult> => {
  const cutoffs = buildRetentionCutoffs(policy, now);
  return client.$transaction(
    async (transaction) => {
      const expiredBuckets = await transaction.rateLimitBucket.findMany({
        where: { expiresAt: { lt: now } },
        select: { keyHash: true },
        orderBy: { expiresAt: 'asc' },
        take: policy.batchSize,
      });
      const rateLimitBuckets = await transaction.rateLimitBucket.deleteMany({
        where: { keyHash: { in: expiredBuckets.map(({ keyHash }) => keyHash) } },
      });

      const staleSessions = await transaction.authSession.findMany({
        where: {
          OR: [
            { expiresAt: { lt: cutoffs.securityArtifact } },
            { revokedAt: { lt: cutoffs.securityArtifact } },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: policy.batchSize,
      });
      const authSessions = await transaction.authSession.deleteMany({
        where: { id: { in: staleSessions.map(({ id }) => id) } },
      });

      const staleSetupTokens = await transaction.passwordSetupToken.findMany({
        where: {
          OR: [
            { expiresAt: { lt: cutoffs.securityArtifact } },
            { usedAt: { lt: cutoffs.securityArtifact } },
            { revokedAt: { lt: cutoffs.securityArtifact } },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: policy.batchSize,
      });
      const passwordSetupTokens = await transaction.passwordSetupToken.deleteMany({
        where: { id: { in: staleSetupTokens.map(({ id }) => id) } },
      });

      const stalePublicApplications = await transaction.bookingApplication.findMany({
        where: {
          source: 'PUBLIC_FORM',
          wedding: null,
          updatedAt: { lt: cutoffs.publicApplication },
          OR: [
            { status: 'REDDEDILDI' },
            { paymentFlowExpiredAt: { lt: cutoffs.publicApplication } },
          ],
        },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: policy.batchSize,
      });
      const publicApplications = await transaction.bookingApplication.deleteMany({
        where: {
          id: { in: stalePublicApplications.map(({ id }) => id) },
          source: 'PUBLIC_FORM',
          wedding: null,
        },
      });

      const staleArchivedApplications = await transaction.bookingApplication.findMany({
        where: { deletedAt: { lt: cutoffs.archivedApplication }, wedding: null },
        select: { id: true },
        orderBy: { deletedAt: 'asc' },
        take: policy.batchSize,
      });
      const archivedApplications = await transaction.bookingApplication.deleteMany({
        where: {
          id: { in: staleArchivedApplications.map(({ id }) => id) },
          deletedAt: { lt: cutoffs.archivedApplication },
          wedding: null,
        },
      });

      const staleArchivedWeddings = await transaction.wedding.findMany({
        where: { deletedAt: { lt: cutoffs.archivedWedding } },
        select: { id: true, applicationId: true, customerUserId: true },
        orderBy: { deletedAt: 'asc' },
        take: policy.batchSize,
      });
      const archivedWeddings = await transaction.wedding.deleteMany({
        where: {
          id: { in: staleArchivedWeddings.map(({ id }) => id) },
          deletedAt: { lt: cutoffs.archivedWedding },
        },
      });
      const customerUsers = await transaction.user.deleteMany({
        where: {
          id: { in: staleArchivedWeddings.map(({ customerUserId }) => customerUserId) },
          role: 'MUSTERI',
          customerWedding: null,
        },
      });
      await transaction.bookingApplication.deleteMany({
        where: {
          id: { in: staleArchivedWeddings.map(({ applicationId }) => applicationId) },
          wedding: null,
        },
      });

      const result = {
        rateLimitBuckets: rateLimitBuckets.count,
        authSessions: authSessions.count,
        passwordSetupTokens: passwordSetupTokens.count,
        publicApplications: publicApplications.count,
        archivedApplications: archivedApplications.count,
        archivedWeddings: archivedWeddings.count,
        customerUsers: customerUsers.count,
      };
      if (countRetentionDeletes(result) > 0) {
        await transaction.auditLog.create({
          data: {
            action: 'maintenance.data_retention',
            targetType: 'System',
            targetId: null,
            outcome: 'SUCCESS',
            correlationId: randomUUID(),
            metadata: { deleted: result },
          },
        });
      }
      return result;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
};
