import { AppError } from './appError.js';
import { assertDeliveryLinkUrl } from './domain.js';

type DeliveryLinkAccessOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type DeliveryLinkAccessResult = {
  status: number;
  redirectHost: string | null;
};

const isGoogleRedirectHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'google.com' ||
    normalized.endsWith('.google.com') ||
    normalized === 'googleusercontent.com' ||
    normalized.endsWith('.googleusercontent.com')
  );
};

const isWeTransferHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'we.tl' ||
    normalized === 'wetransfer.com' ||
    normalized.endsWith('.wetransfer.com')
  );
};

export const verifyDeliveryLinkAccess = async (
  value: string,
  { fetchImpl = fetch, timeoutMs = 5_000 }: DeliveryLinkAccessOptions = {},
): Promise<DeliveryLinkAccessResult> => {
  const normalizedUrl = assertDeliveryLinkUrl(value);
  const sourceHost = new URL(normalizedUrl).hostname.toLowerCase();
  const sourceIsWeTransfer = isWeTransferHost(sourceHost);
  let response: Response;
  try {
    response = await fetchImpl(normalizedUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError('Teslimat bağlantısına şu anda ulaşılamıyor.', 503);
  }

  if ([401, 403, 404, 410].includes(response.status)) {
    throw new AppError('Teslimat bağlantısı erişilebilir değil.', 422);
  }
  if (response.status >= 500) {
    throw new AppError('Teslimat bağlantısı geçici olarak doğrulanamıyor.', 503);
  }

  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400) {
    if (!location) {
      throw new AppError('Teslimat bağlantısının yönlendirmesi doğrulanamadı.', 422);
    }
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(location, normalizedUrl);
    } catch {
      throw new AppError('Teslimat bağlantısının yönlendirmesi geçersiz.', 422);
    }
    const redirectHost = redirectUrl.hostname.toLowerCase();
    if (
      redirectUrl.protocol !== 'https:' ||
      (sourceIsWeTransfer
        ? !isWeTransferHost(redirectHost)
        : !isGoogleRedirectHost(redirectHost) || redirectHost === 'accounts.google.com')
    ) {
      throw new AppError('Teslimat bağlantısı anonim erişime açık görünmüyor.', 422);
    }
    return { status: response.status, redirectHost };
  }

  if (!response.ok) {
    throw new AppError('Teslimat bağlantısı erişilebilir değil.', 422);
  }
  return { status: response.status, redirectHost: null };
};
