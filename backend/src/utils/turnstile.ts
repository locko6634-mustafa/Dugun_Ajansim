import { z } from "zod";
import { env } from "../config/env.config.js";
import { AppError } from "./appError.js";

export const BOOKING_TURNSTILE_ACTION = "booking_application";
const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const turnstileResponseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional()
});

type TurnstileConfiguration = {
  mode: "disabled" | "turnstile";
  secretKey: string;
  expectedHostname: string;
  timeoutMs: number;
  verifyUrl?: string;
};

type VerifyBookingBotChallengeInput = {
  token: string | undefined;
  remoteIp: string | undefined;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
  configuration?: TurnstileConfiguration;
};

export const assertBookingBotProtectionConfigured = (
  environment = env.NODE_ENV,
  mode = env.BOT_PROTECTION_MODE
): void => {
  if (environment === "production" && mode !== "turnstile") {
    throw new Error("Production API Turnstile bot koruması olmadan başlatılamaz.");
  }
};

const runtimeConfiguration = (): TurnstileConfiguration => ({
  mode: env.BOT_PROTECTION_MODE,
  secretKey: env.TURNSTILE_SECRET_KEY,
  expectedHostname: env.TURNSTILE_EXPECTED_HOSTNAME,
  timeoutMs: env.TURNSTILE_VERIFY_TIMEOUT_MS,
  verifyUrl: env.TURNSTILE_VERIFY_URL
});

export const verifyBookingBotChallenge = async ({
  token,
  remoteIp,
  idempotencyKey,
  fetchImpl = fetch,
  configuration = runtimeConfiguration()
}: VerifyBookingBotChallengeInput): Promise<void> => {
  if (configuration.mode === "disabled") return;
  const normalizedToken = token?.trim();
  if (!normalizedToken || normalizedToken.length > 2_048) {
    throw new AppError("Bot doğrulaması zorunludur.", 400);
  }

  let response: Response;
  try {
    response = await fetchImpl(configuration.verifyUrl ?? TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: configuration.secretKey,
        response: normalizedToken,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
        idempotency_key: idempotencyKey
      }),
      signal: AbortSignal.timeout(configuration.timeoutMs)
    });
  } catch {
    throw new AppError("Bot doğrulama servisine şu anda ulaşılamıyor.", 503);
  }

  if (!response.ok) {
    throw new AppError("Bot doğrulama servisine şu anda ulaşılamıyor.", 503);
  }

  let result: z.infer<typeof turnstileResponseSchema>;
  try {
    result = turnstileResponseSchema.parse(await response.json());
  } catch {
    throw new AppError("Bot doğrulama servisinden geçersiz yanıt alındı.", 503);
  }

  if (
    !result.success ||
    result.hostname?.toLowerCase() !== configuration.expectedHostname.toLowerCase() ||
    result.action !== BOOKING_TURNSTILE_ACTION
  ) {
    throw new AppError("Bot doğrulaması başarısız oldu. Lütfen yeniden deneyin.", 400);
  }
};
