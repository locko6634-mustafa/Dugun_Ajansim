import { env } from "../config/env.config.js";
import { prisma, runWithRlsContext } from "../config/prisma.js";
import {
  countRetentionDeletes,
  runDataRetentionBatch,
  type DataRetentionBatchResult
} from "../utils/dataRetention.js";

const policy = {
  publicApplicationDays: env.PUBLIC_APPLICATION_RETENTION_DAYS,
  archivedApplicationDays: env.ARCHIVED_APPLICATION_RETENTION_DAYS,
  archivedWeddingDays: env.ARCHIVED_WEDDING_RETENTION_DAYS,
  securityArtifactDays: env.SECURITY_ARTIFACT_RETENTION_DAYS,
  batchSize: env.DATA_RETENTION_BATCH_SIZE
};

const emptyResult = (): DataRetentionBatchResult => ({
  rateLimitBuckets: 0,
  authSessions: 0,
  trustedDevices: 0,
  passwordSetupTokens: 0,
  publicApplications: 0,
  archivedApplications: 0,
  archivedWeddings: 0,
  customerUsers: 0
});

const main = async () => {
  const total = emptyResult();
  for (let batch = 1; batch <= env.DATA_RETENTION_MAX_BATCHES; batch += 1) {
    const result = await runDataRetentionBatch(prisma, policy);
    for (const key of Object.keys(total) as Array<keyof DataRetentionBatchResult>) {
      total[key] += result[key];
    }
    const deleted = countRetentionDeletes(result);
    console.log(JSON.stringify({ operation: "data-retention", batch, deleted, result }));
    if (deleted === 0) {
      console.log(JSON.stringify({ operation: "data-retention-complete", total }));
      return;
    }
  }
  throw new Error("Veri saklama temizliği güvenli parti sınırı içinde tamamlanamadı.");
};

runWithRlsContext({ actorRole: "maintenance", purpose: "maintenance.retention" }, main)
  .catch(() => {
    console.error("Veri saklama temizliği başarısız oldu; kayıt ayrıntıları loglanmadı.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
