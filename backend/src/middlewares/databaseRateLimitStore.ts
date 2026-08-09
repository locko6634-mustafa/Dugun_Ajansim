import { createHmac } from 'node:crypto';
import { MemoryStore, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import { env } from '../config/env.config.js';
import { prisma } from '../config/prisma.js';

const CLEANUP_EVERY_INCREMENT_COUNT = 1_000;
const CLEANUP_BATCH_SIZE = 250;

export const hashRateLimitKey = (namespace: string, key: string, secret = env.RATE_LIMIT_HMAC_KEY) =>
  createHmac('sha256', Buffer.from(secret, 'hex')).update(`${namespace}\0${key}`).digest('hex');

export class DatabaseRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private increments = 0;
  private readonly developmentFallback = new MemoryStore();
  private developmentFallbackUntil = 0;

  constructor(private readonly namespace: string) {
    this.prefix = `${namespace}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.developmentFallback.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (env.NODE_ENV !== 'production' && Date.now() < this.developmentFallbackUntil) {
      return this.developmentFallback.increment(key);
    }
    const keyHash = hashRateLimitKey(this.namespace, key);
    const nextResetTime = new Date(Date.now() + this.windowMs);
    let rows: Array<{ hits: number; expiresAt: Date }>;
    try {
      rows = await prisma.$queryRaw<Array<{ hits: number; expiresAt: Date }>>`
        INSERT INTO "rate_limit_buckets" ("keyHash", "hits", "expiresAt", "updatedAt")
        VALUES (${keyHash}, 1, ${nextResetTime}, NOW())
        ON CONFLICT ("keyHash") DO UPDATE SET
          "hits" = CASE
            WHEN "rate_limit_buckets"."expiresAt" <= NOW() THEN 1
            ELSE "rate_limit_buckets"."hits" + 1
          END,
          "expiresAt" = CASE
            WHEN "rate_limit_buckets"."expiresAt" <= NOW() THEN EXCLUDED."expiresAt"
            ELSE "rate_limit_buckets"."expiresAt"
          END,
          "updatedAt" = NOW()
        RETURNING "hits", "expiresAt"
      `;
    } catch (error) {
      if (env.NODE_ENV === 'production') throw error;
      this.developmentFallbackUntil = Date.now() + 30_000;
      return this.developmentFallback.increment(key);
    }
    const bucket = rows[0];
    if (!bucket) throw new Error('Rate limit sayacı güncellenemedi.');

    this.increments += 1;
    if (this.increments >= CLEANUP_EVERY_INCREMENT_COUNT) {
      this.increments = 0;
      void this.cleanupExpiredBuckets();
    }

    return { totalHits: bucket.hits, resetTime: bucket.expiresAt };
  }

  async decrement(key: string): Promise<void> {
    if (env.NODE_ENV !== 'production' && Date.now() < this.developmentFallbackUntil) {
      await this.developmentFallback.decrement(key);
      return;
    }
    const keyHash = hashRateLimitKey(this.namespace, key);
    await prisma.$executeRaw`
      UPDATE "rate_limit_buckets"
      SET "hits" = GREATEST("hits" - 1, 0), "updatedAt" = NOW()
      WHERE "keyHash" = ${keyHash} AND "expiresAt" > NOW()
    `;
  }

  async resetKey(key: string): Promise<void> {
    if (env.NODE_ENV !== 'production' && Date.now() < this.developmentFallbackUntil) {
      this.developmentFallback.resetKey(key);
      return;
    }
    const keyHash = hashRateLimitKey(this.namespace, key);
    await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
  }

  private async cleanupExpiredBuckets(): Promise<void> {
    try {
      await prisma.$executeRaw`
        DELETE FROM "rate_limit_buckets"
        WHERE "keyHash" IN (
          SELECT "keyHash"
          FROM "rate_limit_buckets"
          WHERE "expiresAt" <= NOW()
          ORDER BY "expiresAt" ASC
          LIMIT ${CLEANUP_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
      `;
    } catch {
      // Temizlik başarısızlığı geçerli isteğin kota kararını etkilemez.
    }
  }
}
