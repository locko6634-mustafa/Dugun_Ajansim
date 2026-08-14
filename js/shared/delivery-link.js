const isAllowedDeliveryLinkHost = (hostname) => {
  const normalized = hostname.toLowerCase();
  return (
    ["drive.google.com", "docs.google.com", "we.tl", "wetransfer.com"].includes(normalized) ||
    normalized.endsWith(".wetransfer.com")
  );
};

export const normalizeDeliveryLinkUrl = (value) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !isAllowedDeliveryLinkHost(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new TypeError("Güvenli olmayan teslimat bağlantısı.");
  }
  return url.href;
};

export const isAllowedDeliveryLinkUrl = (value) => {
  try {
    normalizeDeliveryLinkUrl(value);
    return true;
  } catch {
    return false;
  }
};
