export const ROLE_PANEL_CONFIG = Object.freeze({
  ADMIN: Object.freeze({ url: "admin.html", label: "Admin Paneli" }),
  SALON_YETKILISI: Object.freeze({
    url: "operasyon-paneli.html",
    label: "Salon Sorumlusu Paneli"
  }),
  MONTAJCI: Object.freeze({ url: "montajci-paneli.html", label: "Montajcı Paneli" }),
  MUSTERI: Object.freeze({ url: "musteri-paneli.html", label: "Müşteri Paneli" })
});

export const STAFF_SPECIALTY_LABELS = Object.freeze({
  ACTUAL_CAMERA: "Aktüel Kamera",
  PHOTOGRAPHY: "Fotoğrafçı",
  DRONE: "Drone",
  VIDEO: "Klipçi",
  PRINTING: "Baskıcı",
  SALES: "Satış Personeli",
  JIMMY_JIB: "Jimmy Jib",
  EDITING: "Kurgu / Montaj",
  ALBUM: "Albüm Tasarımı"
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
  APPLICATION_APPROVED: "Başvuru onayı",
  APPLICATION_REJECTED: "Başvuru reddi",
  ACCOUNT_ACTIVATION: "Hesap aktivasyonu",
  PREPARATION_UPDATE: "Hazırlık bilgisi",
  DELIVERY_READY: "Teslimat hazır",
  PASSWORD_RESET: "Parola sıfırlama"
});

export const BOOKING_STATUS_LABELS = Object.freeze({
  ONAY_BEKLIYOR: "Onay Bekliyor",
  ONAYLANDI: "Onaylandı",
  REDDEDILDI: "Reddedildi",
  IPTAL_EDILDI: "İptal Edildi"
});

export const EVENT_TYPE_LABELS = Object.freeze({
  WEDDING: "Düğün",
  ENGAGEMENT: "Nişan",
  HENNA: "Kına",
  ADDITIONAL_JOB: "Ek iş"
});

export const PAYMENT_METHOD_LABELS = Object.freeze({
  CASH: "Peşin",
  DEPOSIT: "Kapora"
});

export const PRIMARY_CONTACT_LABELS = Object.freeze({
  GELIN: "Gelin",
  DAMAT: "Damat"
});

export const MESSAGE_STATUS_LABELS = Object.freeze({
  PLANNED: "Planlandı",
  PREPARED: "Hazırlandı",
  READY_TO_SEND: "Gönderime hazır",
  SENT: "Gönderildi",
  FAILED: "Başarısız",
  CANCELLED: "İptal"
});

export const ACCOUNT_STATUS_LABELS = Object.freeze({
  ACTIVE: "Aktif",
  DISABLED: "Pasif"
});

export function getPanelUrlForRole(role) {
  return ROLE_PANEL_CONFIG[role]?.url || "index.html";
}

export function getRoleLabel(role) {
  return ROLE_PANEL_CONFIG[role]?.label || "Hesabım";
}
