export const ROLE_PANEL_CONFIG = Object.freeze({
  ADMIN: Object.freeze({ url: "admin.html", label: "Admin Paneli" }),
  SALON_YETKILISI: Object.freeze({
    url: "operasyon-paneli.html",
    label: "Salon Sorumlusu Paneli"
  }),
  MUSTERI: Object.freeze({ url: "musteri-paneli.html", label: "Müşteri Paneli" })
});

export const STAFF_SPECIALTY_LABELS = Object.freeze({
  PHOTOGRAPHY: "Fotoğraf",
  VIDEO: "Video",
  DRONE: "Drone",
  JIMMY_JIB: "Jimmy Jib",
  ASSISTANT: "Asistan",
  EDITING: "Kurgu / Montaj",
  ALBUM: "Albüm"
});

export const DELIVERY_STATUS_LABELS = Object.freeze({
  HAZIRLANIYOR: "Hazırlanıyor",
  MONTAJ: "Montaj Aşamasında",
  KONTROL: "Kontrol Ediliyor",
  TESLIME_HAZIR: "Teslime Hazır",
  TESLIM_EDILDI: "Teslim Edildi"
});

export const DELIVERY_STATUS_ORDER = Object.freeze(Object.keys(DELIVERY_STATUS_LABELS));

export const MESSAGE_KIND_LABELS = Object.freeze({
  ACCOUNT_ACTIVATION: "Hesap aktivasyonu",
  PREPARATION_UPDATE: "Hazırlık bilgisi",
  DELIVERY_READY: "Teslimat hazır",
  PASSWORD_RESET: "Parola sıfırlama"
});

export function getPanelUrlForRole(role) {
  return ROLE_PANEL_CONFIG[role]?.url || "index.html";
}

export function getRoleLabel(role) {
  return ROLE_PANEL_CONFIG[role]?.label || "Hesabım";
}
