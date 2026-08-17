const isLocalDevelopmentServer =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "8000";
const configuredApiBaseUrl = document
  .querySelector('meta[name="api-base-url"]')
  ?.content.trim()
  .replace(/\/$/, "");

export const API_BASE_URL =
  configuredApiBaseUrl ||
  (isLocalDevelopmentServer ? `http://${window.location.hostname}:5000/api/v1` : "/api/v1");

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function hasApiEndpoint() {
  return Boolean(API_BASE_URL);
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}

export async function apiRequest(path, options = {}) {
  if (!hasApiEndpoint()) {
    const error = new Error("API adresi bu ortam için yapılandırılmamış.");
    error.status = 503;
    throw error;
  }

  const {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    signal: callerSignal,
    ...requestOptions
  } = options;
  const method = requestOptions.method || "GET";
  const headers = new window.Headers(requestOptions.headers || {});
  headers.set("Accept", "application/json");
  const bodyCanBeSentDirectly =
    requestOptions.body instanceof FormData ||
    requestOptions.body instanceof window.Blob ||
    requestOptions.body instanceof ArrayBuffer ||
    ArrayBuffer.isView(requestOptions.body) ||
    requestOptions.body instanceof window.URLSearchParams;
  const shouldSerializeJson = Boolean(requestOptions.body) && !bodyCanBeSentDirectly;

  if (shouldSerializeJson) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrfToken = readCookie("dugunajansim_csrf");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  const controller = new window.AbortController();
  let timedOut = false;
  const requestTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestOptions,
      method,
      headers,
      credentials: "include",
      signal: controller.signal,
      body: shouldSerializeJson ? JSON.stringify(requestOptions.body) : requestOptions.body
    });

    const payload = await response.json().catch(() => ({
      success: false,
      message: "Sunucudan geçersiz yanıt alındı."
    }));

    if (!response.ok) {
      const error = new Error(payload.message || "İşlem tamamlanamadı.");
      error.status = response.status;
      error.payload = payload;
      const retryAfter = Number.parseInt(
        response.headers.get("Retry-After") || String(payload.retryAfterSeconds || ""),
        10
      );
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = retryAfter;
      throw error;
    }

    return payload;
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error("Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.");
      timeoutError.status = 408;
      timeoutError.code = "REQUEST_TIMEOUT";
      throw timeoutError;
    }
    if (error?.name === "AbortError" && callerSignal?.aborted) throw error;
    if (error instanceof TypeError) {
      const offlineError = new Error(
        "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin."
      );
      offlineError.status = 0;
      offlineError.code = "NETWORK_ERROR";
      throw offlineError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function createIdempotencyKey(cryptoApi = window.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Güvenli rastgele anahtar üretimi bu tarayıcıda desteklenmiyor.");
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
