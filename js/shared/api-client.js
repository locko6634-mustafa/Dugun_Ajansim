const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
export const API_BASE_URL = isLocal
  ? `http://${window.location.hostname}:5000/api/v1`
  : `${window.location.origin}/api/v1`;

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}

export async function apiRequest(path, options = {}) {
  const method = options.method || "GET";
  const headers = new window.Headers(options.headers || {});
  headers.set("Accept", "application/json");

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrfToken = readCookie("dugunajansim_csrf");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
    body:
      options.body && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body
  });

  const payload = await response.json().catch(() => ({
    success: false,
    message: "Sunucudan geçersiz yanıt alındı."
  }));

  if (!response.ok) {
    const error = new Error(payload.message || "İşlem tamamlanamadı.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function createIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
