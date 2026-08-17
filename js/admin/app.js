import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { initTrustedDevices } from "../shared/trusted-devices.js";
import {
  showCustomPrompt,
  showCatalogFormModal,
  showVenueFormModal
} from "../shared/custom-dialogs.js";
import {
  applyBookingFormConstraints,
  parseBookingFormConstraints
} from "../shared/booking-form-constraints.js";
import { parseBookingSchedulePolicy } from "../shared/booking-schedule-policy.js";
import { isAllowedDeliveryLinkUrl } from "../shared/delivery-link.js";
import {
  ACCOUNT_STATUS_LABELS,
  BOOKING_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  MESSAGE_KIND_LABELS,
  MESSAGE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PRIMARY_CONTACT_LABELS,
  STAFF_SPECIALTY_LABELS
} from "../shared/domain-labels.js";
import {
  APP_LOCALE,
  APP_TIME_ZONE,
  OPERATIONS_CITY,
  formatAppCurrency,
  formatAppTime
} from "../shared/runtime-config.js";
import { safeImageAssetPath } from "../shared/asset-url.js";
import { escapeHtml } from "../shared/html.js";
import { printWeddingReport } from "../shared/wedding-print-report.js";

const SPECIALTIES = STAFF_SPECIALTY_LABELS;
const STATUS_LABELS = DELIVERY_STATUS_LABELS;
const MESSAGE_LABELS = MESSAGE_KIND_LABELS;
const CATALOG_FALLBACK_IMAGE = "assets/images/hero-couple.webp";

function domainOptions(labels) {
  return Object.entries(labels)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
}

document.querySelectorAll('[data-domain-options="primary-contact"]').forEach((select) => {
  select.innerHTML = domainOptions(PRIMARY_CONTACT_LABELS);
});
document.querySelectorAll('[data-domain-options="payment-method"]').forEach((select) => {
  select.innerHTML = domainOptions(PAYMENT_METHOD_LABELS);
});
document.querySelector(".js-application-filter").innerHTML = `${domainOptions({
  ONAY_BEKLIYOR: BOOKING_STATUS_LABELS.ONAY_BEKLIYOR,
  "": "Tümü",
  ONAYLANDI: BOOKING_STATUS_LABELS.ONAYLANDI,
  REDDEDILDI: BOOKING_STATUS_LABELS.REDDEDILDI
})}<option value="ARCHIVED">Arşiv</option>`;
document.querySelector(".js-message-kind-filter").innerHTML =
  `<option value="">Tüm mesaj türleri</option>${domainOptions(MESSAGE_KIND_LABELS)}`;
document.querySelector(".js-message-status-filter").innerHTML =
  `<option value="">Tüm mesaj durumları</option>${domainOptions(MESSAGE_STATUS_LABELS)}`;

const createPaginationState = () => ({
  cursor: null,
  history: [],
  nextCursor: null,
  pageSize: 50,
  totalItems: 0,
  itemCount: 0,
  isLegacy: false,
  loading: false
});

const state = {
  dashboard: null,
  dashboardStatus: "idle",
  availabilityDate: "",
  availabilityVenueId: "",
  calendar: null,
  calendarStatus: "idle",
  calendarMonth: "",
  calendarVenueId: "",
  calendarView: "month",
  calendarFocusDate: "",
  calendarShowPast: false,
  staff: [],
  managers: [],
  montageUsers: [],
  venues: [],
  catalogVenues: [],
  packages: [],
  services: [],
  catalogFormConstraints: null,
  bookingFormConstraintsReady: false,
  bookingSchedulePolicy: null,
  lastDataAt: null,
  currentWedding: null,
  openedMessageTaskIds: new Set(),
  pagination: {
    applications: createPaginationState(),
    messages: createPaginationState()
  }
};

function resetPagination(key) {
  state.pagination[key] = createPaginationState();
  renderPagination(key);
}

function unpackPaginatedList(key, data) {
  const pager = state.pagination[key];
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const metadata = Array.isArray(data) ? null : data?.pagination;
  pager.isLegacy = Array.isArray(data);
  pager.pageSize = Number.isInteger(metadata?.pageSize) ? metadata.pageSize : pager.pageSize;
  pager.totalItems = Number.isInteger(metadata?.totalItems) ? metadata.totalItems : items.length;
  pager.nextCursor = typeof metadata?.nextCursor === "string" ? metadata.nextCursor : null;
  pager.itemCount = items.length;
  renderPagination(key);
  return items;
}

function renderPagination(key) {
  const pager = state.pagination[key];
  const nav = document.querySelector(`.js-${key}-pagination`);
  if (!nav) return;
  const hasPrevious = pager.history.length > 0;
  const hasNext = Boolean(pager.nextCursor);
  nav.hidden = pager.itemCount === 0 && !hasPrevious && !hasNext;
  nav.querySelector(`[data-pagination-prev="${key}"]`).disabled = pager.loading || !hasPrevious;
  nav.querySelector(`[data-pagination-next="${key}"]`).disabled = pager.loading || !hasNext;
  const firstItem = pager.totalItems > 0 ? pager.history.length * pager.pageSize + 1 : 0;
  const lastItem = Math.min(firstItem + Math.max(pager.itemCount - 1, 0), pager.totalItems);
  nav.querySelector(`.js-${key}-pagination-summary`).textContent =
    pager.totalItems > 0 ? `${firstItem}–${lastItem} / ${pager.totalItems}` : "0 kayıt";
}

const globalMessage = document.querySelector(".global-message");
const detailDialog = document.querySelector(".js-wedding-detail");
const detailContent = document.querySelector(".js-wedding-detail-content");
const weddingPdfButton = document.querySelector(".js-create-wedding-pdf");
const appDetailDialog = document.querySelector(".js-application-detail-dialog");
const appDetailTitle = document.querySelector(".js-app-detail-title");
const appDetailContent = document.querySelector(".js-app-detail-content");
const staffDialog = document.querySelector(".js-staff-dialog");
const staffForm = document.querySelector(".js-staff-form");
const managedUserDialog = document.querySelector(".js-managed-user-dialog");
const managedUserForm = document.querySelector(".js-managed-user-form");
const manualDialog = document.querySelector(".js-manual-dialog");
const manualForm = document.querySelector(".js-manual-form");
const weddingDialog = document.querySelector(".js-wedding-dialog");
const weddingForm = document.querySelector(".js-wedding-form");
const connectionStatus = document.querySelector(".js-connection-status");
const connectionText = document.querySelector(".js-connection-text");
const lastDataTime = document.querySelector(".js-last-data-time");
const dialogReturnFocus = new WeakMap();

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function openManagedDialog(dialog, trigger = document.activeElement) {
  if (!dialog || dialog.open) return;
  if (trigger instanceof HTMLElement) dialogReturnFocus.set(dialog, trigger);
  dialog.showModal();
  window.requestAnimationFrame(() => dialog.querySelector(FOCUSABLE_SELECTOR)?.focus());
}

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener("close", () => {
    const trigger = dialogReturnFocus.get(dialog);
    dialogReturnFocus.delete(dialog);
    if (trigger?.isConnected) trigger.focus();
  });
});

const apiRequestWithAdminStepUp = (path, options) => apiRequest(path, options);

const formatDate = (value, includeTime = false) =>
  value
    ? new Intl.DateTimeFormat(APP_LOCALE, {
        timeZone: APP_TIME_ZONE,
        dateStyle: "medium",
        ...(includeTime ? { timeStyle: "short" } : {})
      }).format(new Date(value))
    : "—";

const formatMoney = (cents) =>
  formatAppCurrency(Number(cents || 0) / 100, { maximumFractionDigits: 0 });

const centsToMoneyInput = (cents) => (Number(cents || 0) / 100).toFixed(2);
const moneyInputToCents = (value) => Math.round(Number(value || 0) * 100);

const datePartInIstanbul = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));

const timePartInIstanbul = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
const isIsoMonth = (value) => /^\d{4}-\d{2}$/.test(value || "");

const addDays = (date, days) => {
  if (!isIsoDate(date) || !Number.isFinite(days)) return null;
  const value = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(value.valueOf())) return null;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const addMonths = (month, amount) => {
  if (!isIsoMonth(month) || !Number.isFinite(amount)) return null;
  const value = new Date(`${month}-01T12:00:00.000Z`);
  if (Number.isNaN(value.valueOf())) return null;
  value.setUTCMonth(value.getUTCMonth() + amount);
  return value.toISOString().slice(0, 7);
};

const setMessage = (message, success = false) => {
  globalMessage.textContent = message;
  globalMessage.style.color = success ? "var(--success)" : "";
};

const clearFormErrorState = (form) => {
  const message = form.querySelector(".dialog-message");
  form.querySelectorAll('[aria-invalid="true"]').forEach((field) => {
    field.removeAttribute("aria-invalid");
    if (message?.id) {
      const ids = (field.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== message.id);
      if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
      else field.removeAttribute("aria-describedby");
    }
  });
};

const formErrorMessage = (form, error) => {
  clearFormErrorState(form);
  const details = [
    ...(Array.isArray(error?.payload?.errors) ? error.payload.errors : []),
    ...(Array.isArray(error?.payload?.fieldErrors) ? error.payload.fieldErrors : [])
  ];
  const detail = details.find(({ field }) => typeof field === "string");
  if (!detail) return error.message;

  const fieldName = detail.field
    .replace(/^body\./, "")
    .split(".")
    .at(-1);
  const field = form.elements.namedItem(fieldName);
  const message = form.querySelector(".dialog-message");
  if (field instanceof HTMLElement) {
    field.setAttribute("aria-invalid", "true");
    if (message?.id) {
      const describedBy = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/));
      describedBy.add(message.id);
      field.setAttribute("aria-describedby", [...describedBy].filter(Boolean).join(" "));
    }
    field.focus();
  }

  const label =
    field instanceof HTMLElement
      ? field.closest("label")?.childNodes[0]?.textContent?.trim()
      : "Alan";
  return `${label || "Alan"}: ${detail.message}`;
};

function beginInFlight(control) {
  if (!(control instanceof HTMLElement) || control.dataset.inFlight === "true") return null;
  const wasDisabled = control.disabled;
  control.dataset.inFlight = "true";
  control.disabled = true;
  control.setAttribute("aria-busy", "true");
  return () => {
    if (!control.isConnected) return;
    delete control.dataset.inFlight;
    control.disabled = wasDisabled;
    control.removeAttribute("aria-busy");
  };
}

function setCatalogMessage(copy, success = false) {
  const message = document.querySelector(".js-catalog-message");
  if (!message) return;
  message.textContent = copy;
  message.style.color = success ? "var(--success)" : "";
}

function syncDependencyControls() {
  const manualReady = state.bookingFormConstraintsReady && Boolean(state.bookingSchedulePolicy);
  const manualButton = document.querySelector(".js-open-manual");
  if (manualButton) {
    manualButton.disabled = !manualReady;
    manualButton.title = manualReady
      ? "Yeni manuel düğün başvurusu oluştur"
      : "Başvuru form koşulları yüklenemedi; sayfayı yenileyip tekrar deneyin";
  }

  const catalogReady = Boolean(state.catalogFormConstraints);
  document.querySelectorAll("[data-add-catalog], [data-edit-catalog]").forEach((button) => {
    button.disabled = !catalogReady;
    button.title = catalogReady
      ? ""
      : "Katalog form koşulları yüklenemedi; sayfayı yenileyip tekrar deneyin";
  });
}

function syncScheduleFields(form) {
  const policy = state.bookingSchedulePolicy;
  if (!form || !policy) return;
  const dateInput = form.elements.namedItem("weddingDate");
  const startInput = form.elements.namedItem("startTime");
  const endInput = form.elements.namedItem("endTime");
  if (!(dateInput instanceof window.HTMLInputElement)) return;

  const today = datePartInIstanbul(new Date());
  const [hours, minutes] = timePartInIstanbul(new Date()).split(":").map(Number);
  const nowMinutes = hours * 60 + minutes;
  const roundedMinutes = Math.ceil(nowMinutes / policy.stepMinutes) * policy.stepMinutes;
  const latestMinutes = policy.latestTime
    .split(":")
    .map(Number)
    .reduce((total, value, index) => total + value * (index === 0 ? 60 : 1), 0);
  const todayHasSlot = roundedMinutes <= latestMinutes;
  const newBookingMinimum = todayHasSlot ? today : addDays(today, 1);
  const originalWeddingDate = form.dataset.originalWeddingDate;
  dateInput.min =
    originalWeddingDate && originalWeddingDate < newBookingMinimum
      ? originalWeddingDate
      : newBookingMinimum;

  [startInput, endInput].forEach((input) => {
    if (!(input instanceof window.HTMLInputElement)) return;
    input.min = policy.earliestTime;
    input.max = policy.latestTime;
    input.step = String(policy.stepMinutes * 60);
  });
  if (startInput instanceof window.HTMLInputElement && dateInput.value === today && todayHasSlot) {
    const rounded = `${String(Math.floor(roundedMinutes / 60)).padStart(2, "0")}:${String(
      roundedMinutes % 60
    ).padStart(2, "0")}`;
    startInput.min = rounded > policy.earliestTime ? rounded : policy.earliestTime;
  }
}

function markDataSuccess() {
  state.lastDataAt = new Date();
  if (lastDataTime) {
    lastDataTime.textContent = `Son veri ${new Intl.DateTimeFormat(APP_LOCALE, {
      timeZone: APP_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(state.lastDataAt)}`;
  }
}

function setConnectionState(status, label) {
  if (!connectionStatus || !connectionText) return;
  connectionStatus.classList.remove("is-checking", "is-connected", "is-disconnected");
  connectionStatus.classList.add(`is-${status}`);
  connectionText.textContent = label;
}

async function loadHealth() {
  setConnectionState("checking", "Sistem kontrol ediliyor");
  try {
    const response = await apiRequest("/health", { timeoutMs: 5000 });
    const healthData = response.data || response;
    if (healthData?.status !== "healthy" || healthData?.database !== "connected") {
      throw new Error("Sistem sağlığı doğrulanamadı.");
    }
    setConnectionState("connected", "Sistem bağlı");
  } catch {
    setConnectionState("disconnected", "Sistem bağlantısı kesildi");
  }
}

const empty = (message) => `<p class="empty-state">${escapeHtml(message)}</p>`;
const coupleName = (wedding) =>
  `${wedding.brideFirstName} ${wedding.brideLastName || ""} & ${wedding.groomFirstName} ${wedding.groomLastName || ""}`
    .replaceAll(/\s+/g, " ")
    .trim();

const safePhoneHref = (phone) => `tel:${String(phone || "").replace(/[^+\d]/g, "")}`;

const openBlankPopup = () => {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  return popup;
};

const safeWhatsAppUrl = (value, expectedMessage) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Geçerli bir WhatsApp yönlendirmesi alınamadı.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "wa.me" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/\d{8,15}$/.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) => key !== "text") ||
    url.searchParams.getAll("text").length !== 1 ||
    url.searchParams.get("text") !== expectedMessage
  ) {
    throw new Error("Güvenli bir WhatsApp yönlendirmesi alınamadı.");
  }
  return url.href;
};

async function copyMessageToClipboard(value, popup = null) {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(message);
      return true;
    } catch {
      // Güvenli context veya odak eksikliği varsa diğer yöntemleri dene
    }
  }

  if (popup?.navigator?.clipboard?.writeText) {
    try {
      await popup.navigator.clipboard.writeText(message);
      return true;
    } catch {
      // ignore
    }
  }

  if (popup && popup.document && popup.document.body) {
    try {
      const fallback = popup.document.createElement("textarea");
      fallback.value = message;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      popup.document.body.append(fallback);
      fallback.select();
      const copied = popup.document.execCommand("copy");
      fallback.remove();
      if (copied) return true;
    } catch {
      // ignore
    }
  }

  try {
    const fallback = document.createElement("textarea");
    fallback.value = message;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (copied) return true;
  } catch {
    // ignore
  }

  return false;
}

async function openWhatsAppMessage(data, popup) {
  const message = typeof data?.message === "string" ? data.message : "";
  const whatsappUrl = safeWhatsAppUrl(data?.whatsappUrl, message);
  if (!popup) {
    throw new Error("WhatsApp penceresi engellendi. Açılır pencerelere izin verip tekrar deneyin.");
  }
  const copied = await copyMessageToClipboard(message, popup);
  popup.location.href = whatsappUrl;
  return copied;
}

async function openWhatsAppMessageAfterVerification(data) {
  const message = typeof data?.message === "string" ? data.message : "";
  const whatsappUrl = safeWhatsAppUrl(data?.whatsappUrl, message);
  const copied = await copyMessageToClipboard(message);
  const popup = window.open(whatsappUrl, "_blank");
  if (popup) {
    popup.opener = null;
  } else {
    window.location.assign(whatsappUrl);
  }
  return copied;
}

async function prepareWhatsAppMessageTask(
  { id, status = "PLANNED", dueAt = null, earlyOverrideAt = null },
  { activateCustomerNow = false } = {}
) {
  const request = activateCustomerNow ? apiRequestWithAdminStepUp : apiRequest;
  const requestOptions = activateCustomerNow
    ? { actionLabel: "Müşteri hesabını aktifleştirme" }
    : undefined;
  let currentStatus = status;

  if (["PLANNED", "FAILED"].includes(currentStatus)) {
    const rendered = await request(
      `/admin/message-tasks/${id}/render`,
      { method: "POST" },
      requestOptions
    );
    if (!rendered) return null;
    currentStatus = rendered.data.status;
  }

  if (activateCustomerNow && dueAt && new Date(dueAt).valueOf() > Date.now() && !earlyOverrideAt) {
    const overridden = await apiRequestWithAdminStepUp(
      `/admin/message-tasks/${id}/override-due`,
      {
        method: "POST",
        body: {}
      },
      { actionLabel: "Müşteri hesabını erken aktifleştirme" }
    );
    if (!overridden) return null;
  }

  if (!["PREPARED", "READY_TO_SEND"].includes(currentStatus)) {
    throw new Error("WhatsApp mesaj görevi gönderime hazırlanamadı.");
  }

  return request(
    `/admin/message-tasks/${id}/verify`,
    { method: "POST", body: activateCustomerNow ? { activateCustomerNow: true } : {} },
    requestOptions
  );
}

async function ensureAdmin() {
  try {
    const response = await apiRequest("/auth/session");
    if (response.data.role !== "ADMIN" || response.data.mustChangePassword) {
      window.location.replace("login.html");
      return false;
    }
    return true;
  } catch {
    window.location.replace("login.html");
    return false;
  }
}

function renderCrew(assignments = []) {
  if (!assignments.length) return '<span class="tag">Ekip atanmadı</span>';
  return assignments
    .map(
      ({ staff, specialty }) =>
        `<span>${escapeHtml(staff.firstName)} · ${escapeHtml(SPECIALTIES[specialty])}</span>`
    )
    .join("");
}

function eventCard(wedding) {
  return `<article class="event-card">
    <div class="event-time"><strong>${formatAppTime(wedding.startsAt)}</strong><small>${formatAppTime(wedding.endsAt)}</small></div>
    <div class="event-copy"><strong>${escapeHtml(coupleName(wedding))}</strong><small>${escapeHtml(wedding.venue.name)} · ${escapeHtml(wedding.packageSummary?.name || "Paket belirtilmedi")}</small><div class="crew-line">${renderCrew(wedding.assignments)}</div></div>
    <button class="mini-button" type="button" data-open-wedding="${escapeHtml(wedding.id)}">Dosyayı aç</button>
  </article>`;
}

function compactWedding(wedding) {
  return `<button class="compact-card text-button" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><span><strong>${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}</strong><small>${escapeHtml(wedding.venue.name)}</small></span><time>${formatAppTime(wedding.startsAt)}</time></button>`;
}

function renderDashboard() {
  const data = state.dashboard;
  const todayWeddings = (data.todayWeddings || []).filter(
    (wedding) => !wedding.cancelledAt && !wedding.deletedAt
  );
  const metrics = { ...data.metrics, todayWeddings: todayWeddings.length };
  Object.entries(metrics).forEach(([key, value]) => {
    const element = document.querySelector(`[data-metric="${key}"]`);
    if (element) element.textContent = value;
  });
  updateNavBadges(metrics);
  const todayElem = document.querySelector(".js-today-weddings");
  if (todayElem) {
    todayElem.innerHTML = todayWeddings.length
      ? todayWeddings.map(eventCard).join("")
      : empty("Bugün planlanmış düğün yok. Takvim nefes alıyor.");
  }
  document.querySelector(".js-tomorrow-weddings").innerHTML = data.tomorrowWeddings.length
    ? data.tomorrowWeddings.map(compactWedding).join("")
    : empty("Yarın için düğün yok.");
  const venueSelect = document.querySelector(".js-availability-venue");
  venueSelect.innerHTML = `<option value="">Tüm salonlar</option>${(data.venues || [])
    .map(
      (venue) =>
        `<option value="${escapeHtml(venue.id)}" ${venue.id === state.availabilityVenueId ? "selected" : ""}>${escapeHtml(venue.name)}</option>`
    )
    .join("")}`;
  setAvailabilityDateDisplay(data.availabilityDate, false);
  const staffAvailability =
    data.staffAvailability ||
    data.idleStaff.map((staff) => ({ ...staff, isAvailable: true, assignments: [] }));
  document.querySelector(".js-idle-staff").innerHTML = staffAvailability.length
    ? staffAvailability
        .map((staff) => {
          const assignmentText = staff.assignments.length
            ? staff.assignments
                .map(
                  ({ wedding }) =>
                    `${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)} · ${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}`
                )
                .join("<br>")
            : escapeHtml(staff.venue?.name || "Salon atanmamış");
          return `<article class="availability-person"><strong>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</strong><span class="availability-status ${staff.isAvailable ? "" : "is-busy"}">${staff.isAvailable ? "Müsait" : "Görevli"}</span><small>${assignmentText}</small></article>`;
        })
        .join("")
    : empty("Seçilen salon ve tarihte aktif personel bulunamadı.");
  document.querySelector(".js-conflicts").innerHTML = data.conflicts.length
    ? data.conflicts
        .map(
          (conflict) =>
            `<article class="compact-card conflict-card"><span><strong>${escapeHtml(conflict.staff.firstName)} ${escapeHtml(conflict.staff.lastName)}</strong><small>${escapeHtml(conflict.firstWedding.brideFirstName)} &amp; ${escapeHtml(conflict.firstWedding.groomFirstName)} / ${escapeHtml(conflict.secondWedding.brideFirstName)} &amp; ${escapeHtml(conflict.secondWedding.groomFirstName)}</small></span><b>!</b></article>`
        )
        .join("")
    : empty("Çakışan personel ataması yok.");
}

async function loadDashboard() {
  state.dashboardStatus = "loading";
  syncCalendarNavigation();
  const query = new window.URLSearchParams();
  if (state.availabilityDate) query.set("availabilityDate", state.availabilityDate);
  if (state.availabilityVenueId) query.set("venueId", state.availabilityVenueId);
  try {
    const response = await apiRequest(`/admin/dashboard${query.size ? `?${query}` : ""}`);
    state.dashboard = response.data;
    state.availabilityDate = response.data.availabilityDate;
    state.dashboardStatus = "ready";
    renderDashboard();
    markDataSuccess();
  } catch (error) {
    state.dashboardStatus = "error";
    throw error;
  } finally {
    syncCalendarNavigation();
  }
}

function calendarEventsByDate(weddings) {
  const byDate = new Map();
  weddings.forEach((wedding) => {
    let date = datePartInIstanbul(wedding.startsAt);
    const endDate = datePartInIstanbul(wedding.endsAt);
    while (date <= endDate) {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(wedding);
      date = addDays(date, 1);
    }
  });
  return byDate;
}

function calendarWeekStart(date) {
  if (!isIsoDate(date)) return null;
  const value = new Date(`${date}T12:00:00.000Z`);
  return addDays(date, -((value.getUTCDay() + 6) % 7));
}

function calendarRange(data) {
  if (state.calendarView === "week") {
    const weekStart = calendarWeekStart(state.calendarFocusDate || `${data.month}-01`);
    return { start: weekStart, count: 7 };
  }
  const monthDate = new Date(`${data.month}-01T12:00:00.000Z`);
  const year = monthDate.getUTCFullYear();
  const monthIndex = monthDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const leadingDays = (monthDate.getUTCDay() + 6) % 7;
  return {
    start: addDays(`${data.month}-01`, -leadingDays),
    count: leadingDays + daysInMonth <= 35 ? 35 : 42
  };
}

function calendarHeading(data) {
  const venueName = data.selectedVenue?.name || "Tüm Salonlar";
  if (state.calendarView === "month") {
    return `${new Intl.DateTimeFormat(APP_LOCALE, {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(`${data.month}-01T12:00:00.000Z`))} · ${venueName}`;
  }
  const weekStart = calendarWeekStart(state.calendarFocusDate || `${data.month}-01`);
  const weekEnd = addDays(weekStart, 6);
  const startDate = new Date(`${weekStart}T12:00:00.000Z`);
  const endDate = new Date(`${weekEnd}T12:00:00.000Z`);
  const startLabel = new Intl.DateTimeFormat(APP_LOCALE, {
    day: "numeric",
    month: startDate.getUTCMonth() === endDate.getUTCMonth() ? undefined : "long",
    timeZone: "UTC"
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat(APP_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(endDate);
  return `${startLabel}–${endLabel} · ${venueName}`;
}

function shouldHidePastCalendarEvents(data) {
  return (
    window.matchMedia("(max-width: 900px)").matches &&
    state.calendarView === "month" &&
    isIsoDate(data.today) &&
    data.month === data.today.slice(0, 7) &&
    !state.calendarShowPast
  );
}

function renderCalendar() {
  const data = state.calendar;
  if (!data || !isIsoMonth(data.month)) return;
  const venueContainer = document.querySelector(".js-calendar-venues");
  venueContainer.innerHTML = [
    '<button type="button" role="tab" aria-selected="' +
      String(!data.selectedVenue) +
      '" data-calendar-venue="">Tüm Salonlar</button>',
    ...data.venues.map(
      (venue) =>
        `<button class="${venue.isActive ? "" : "is-passive"}" type="button" role="tab" aria-selected="${venue.id === data.selectedVenue?.id}" data-calendar-venue="${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</button>`
    )
  ].join("");

  document.querySelector(".js-calendar-label").textContent = calendarHeading(data);
  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.calendarView === state.calendarView));
  });
  document
    .querySelector(".js-month-calendar")
    .classList.toggle("is-week-view", state.calendarView === "week");
  const historyToggle = document.querySelector(".calendar-history-toggle");
  const historyCheckbox = document.querySelector(".js-calendar-show-past");
  const isCurrentMonth = isIsoDate(data.today) && data.month === data.today.slice(0, 7);
  historyToggle.hidden = state.calendarView !== "month" || !isCurrentMonth;
  historyCheckbox.checked = state.calendarShowPast;

  const range = calendarRange(data);
  const byDate = calendarEventsByDate(data.weddings);
  const hidePastEvents = shouldHidePastCalendarEvents(data);
  let visibleEventCount = 0;
  const cells = Array.from({ length: range.count }, (_, index) => {
    const date = addDays(range.start, index);
    const dateValue = new Date(`${date}T12:00:00.000Z`);
    const events = hidePastEvents && date < data.today ? [] : byDate.get(date) || [];
    visibleEventCount += events.length;
    const outside = date.slice(0, 7) !== data.month;
    const weekday = new Intl.DateTimeFormat(APP_LOCALE, {
      weekday: "short",
      timeZone: "UTC"
    }).format(dateValue);
    const month = new Intl.DateTimeFormat(APP_LOCALE, {
      month: "short",
      timeZone: "UTC"
    }).format(dateValue);
    return `<section class="calendar-day ${outside ? "is-outside" : ""} ${events.length ? "" : "is-empty"} ${date === data.today ? "is-today" : ""}" aria-label="${escapeHtml(formatDate(`${date}T00:00:00.000Z`))}"><div class="calendar-day__head"><span class="calendar-day__number">${dateValue.getUTCDate()}<span class="calendar-day__month"> ${escapeHtml(month)}</span></span><span class="calendar-day__weekday">${escapeHtml(weekday)}</span></div><div class="calendar-events">${events
      .map(
        (wedding) =>
          `<button class="calendar-event ${wedding.assignments.length ? "" : "is-unassigned"}" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><strong>${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}</strong><small>${data.selectedVenue ? "" : `${escapeHtml(wedding.venue.name)} · `}${wedding.assignments.length ? `${wedding.assignments.length} kişilik ekip` : "Ekip atanmadı"}</small></button>`
      )
      .join("")}</div></section>`;
  }).join("");
  document.querySelector(".js-month-calendar").innerHTML = `${cells}${
    visibleEventCount
      ? ""
      : `<p class="calendar-mobile-empty empty-state">${hidePastEvents && data.weddings.length ? "Geçmiş düğünler gizli. Görmek için yukarıdaki seçeneği açın." : `Seçilen ${state.calendarView === "week" ? "hafta" : "ay"} için düğün yok.`}</p>`
  }`;
}

async function loadCalendar(
  month = state.calendarMonth,
  venueId = state.calendarVenueId,
  focusDate = state.calendarFocusDate
) {
  const calendarContainer = document.querySelector(".js-month-calendar");
  state.calendarStatus = "loading";
  syncCalendarNavigation();
  calendarContainer.innerHTML = empty("Takvim yükleniyor…");
  const query = new window.URLSearchParams();
  if (month) query.set("month", month);
  if (venueId) query.set("venueId", venueId);
  try {
    const response = await apiRequest(`/admin/calendar${query.size ? `?${query}` : ""}`);
    if (!isIsoMonth(response.data?.month)) throw new Error("Takvim ayı doğrulanamadı.");
    state.calendar = response.data;
    state.calendarMonth = response.data.month;
    state.calendarVenueId = response.data.selectedVenue?.id || "";
    state.calendarFocusDate =
      isIsoDate(focusDate) && focusDate.slice(0, 7) === response.data.month
        ? focusDate
        : response.data.today?.slice(0, 7) === response.data.month
          ? response.data.today
          : `${response.data.month}-01`;
    state.calendarStatus = "ready";
    renderCalendar();
    markDataSuccess();
  } catch (error) {
    state.calendar = null;
    state.calendarStatus = "error";
    calendarContainer.innerHTML = empty(`Takvim yüklenemedi: ${error.message}`);
    throw error;
  } finally {
    syncCalendarNavigation();
  }
}

function syncCalendarNavigation() {
  const monthEnabled = state.calendarStatus === "ready" && isIsoMonth(state.calendarMonth);
  document.querySelectorAll("[data-month-move], [data-month-today]").forEach((button) => {
    button.disabled = !monthEnabled;
  });
  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.disabled = !monthEnabled;
  });
  const previous = document.querySelector('[data-month-move="-1"]');
  const next = document.querySelector('[data-month-move="1"]');
  const today = document.querySelector("[data-month-today]");
  const period = state.calendarView === "week" ? "hafta" : "ay";
  previous.setAttribute("aria-label", `Önceki ${period}`);
  next.setAttribute("aria-label", `Sonraki ${period}`);
  today.textContent = state.calendarView === "week" ? "Bu hafta" : "Bu ay";
}

async function loadApplications() {
  const container = document.querySelector(".js-applications");
  const pager = state.pagination.applications;
  const filter = document.querySelector(".js-application-filter").value;
  const referenceCode = document.querySelector(".js-application-reference").value.trim();
  const query = new window.URLSearchParams();
  if (filter === "ARCHIVED") query.set("includeArchived", "true");
  else if (filter) query.set("status", filter);
  if (referenceCode) query.set("referenceCode", referenceCode);
  query.set("pageSize", String(pager.pageSize));
  if (pager.cursor) query.set("cursor", pager.cursor);
  container.innerHTML = empty("Başvurular yükleniyor…");
  try {
    const response = await apiRequest(
      `/admin/booking-applications${query.size ? `?${query}` : ""}`
    );
    const applications = unpackPaginatedList("applications", response.data);
    markDataSuccess();
    container.innerHTML = applications.length
      ? applications.map((item) => renderApplicationCard(item)).join("")
      : empty("Bu durumda başvuru yok.");
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

function isPaymentFlowEditable(item) {
  if (item.source !== "PUBLIC_FORM" || item.status !== "ONAY_BEKLIYOR") return true;
  const expiresAt = new Date(item.paymentFlowExpiresAt).valueOf();
  return !item.paymentFlowExpiredAt && Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function renderApplicationCard(item) {
  const venueName = item.venue?.name || "Salon Belirtilmedi";
  const dateStr = formatDate(item.weddingStartsAt, false);
  const startTime = formatAppTime(item.weddingStartsAt);
  const endTime = formatAppTime(item.weddingEndsAt);
  const timeRangeStr = `${startTime} – ${endTime}`;

  const brideFullName = `${item.brideFirstName} ${item.brideLastName}`.trim();
  const groomFullName = `${item.groomFirstName} ${item.groomLastName}`.trim();

  const isBridePrimary = item.primaryContact === "GELIN";
  const isGroomPrimary = item.primaryContact === "DAMAT";
  const primaryLabel = PRIMARY_CONTACT_LABELS[item.primaryContact] || item.primaryContact;
  const paymentLabel = PAYMENT_METHOD_LABELS[item.paymentMethod] || item.paymentMethod;
  const paymentFlowIsEditable = isPaymentFlowEditable(item);
  const canApprove = item.status === "ONAY_BEKLIYOR";
  const paymentStage =
    item.source === "ADMIN"
      ? "Yönetici başvurusu"
      : item.whatsappHandoffAt
        ? `Dekont kontrolü bekleniyor${paymentFlowIsEditable ? "" : " — düzenleme süresi doldu"}`
        : paymentFlowIsEditable
          ? `Dekont bekleniyor — ${formatDate(item.paymentFlowExpiresAt, true)} tarihine kadar düzenlenebilir`
          : "Dekont bekleniyor — düzenleme süresi doldu";

  const statusLabel = BOOKING_STATUS_LABELS[item.status] || item.status;

  const statusClass =
    item.status === "ONAYLANDI"
      ? "status-tag--approved"
      : item.status === "REDDEDILDI"
        ? "status-tag--rejected"
        : "status-tag--pending";

  return `<article class="data-row application-card" data-application-id="${escapeHtml(item.id)}">
    <div class="app-card__header-line">
      <div class="app-card__couple-info">
        <strong class="app-card__names">${escapeHtml(brideFullName)} &amp; ${escapeHtml(groomFullName)}</strong>
        <span class="ref-badge">${escapeHtml(item.referenceCode)}</span>
        <span class="status-tag ${statusClass}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="data-row__actions">
        <button class="mini-button" type="button" data-open-application="${escapeHtml(item.id)}">Detaylar</button>
        ${
          item.deletedAt
            ? `<button class="mini-button" type="button" data-restore-application="${item.id}">Geri Yükle</button>${["ONAY_BEKLIYOR", "REDDEDILDI"].includes(item.status) ? `<button class="mini-button mini-button--danger" type="button" data-delete-application="${item.id}">Kalıcı Sil</button>` : ""}`
            : item.status === "ONAY_BEKLIYOR"
              ? `${canApprove ? `<button class="mini-button mini-button--primary" type="button" data-approve="${item.id}">Onayla</button>` : ""}<button class="mini-button mini-button--danger" type="button" data-reject="${item.id}">Reddet</button><button class="mini-button" type="button" data-archive-application="${item.id}">Arşivle</button>`
              : ["REDDEDILDI", "IPTAL_EDILDI"].includes(item.status)
                ? `<button class="mini-button" type="button" data-archive-application="${item.id}">Arşivle</button>`
                : `<small>${escapeHtml(item.status.replaceAll("_", " "))}</small>`
        }
      </div>
    </div>

    <div class="app-card__body-grid">
      <div class="app-card__meta-item">
        <small>Paket &amp; Tutar</small>
        <strong>${escapeHtml(item.packageNameSnapshot)}</strong>
        <div class="app-card__price">${formatMoney(item.totalPriceCents)} <small>(${escapeHtml(paymentLabel)})</small></div>
        <small>${escapeHtml(paymentStage)}</small>
      </div>

      <div class="app-card__meta-item">
        <small>Salon &amp; Zaman</small>
        <strong>🏛️ ${escapeHtml(venueName)}</strong>
        <div>📅 ${escapeHtml(dateStr)} <span class="time-range-pill">⏰ ${escapeHtml(timeRangeStr)}</span></div>
      </div>

      <div class="app-card__meta-item">
        <small>İletişim Bilgileri (${escapeHtml(primaryLabel)} birincil)</small>
        <div class="contact-links-list">
          <a class="contact-link ${isBridePrimary ? "is-primary" : ""}" href="tel:${escapeHtml(item.bridePhone)}" title="Gelin Telefonu">
            <span>Gelin:</span> <strong>${escapeHtml(item.bridePhone)}</strong> ${isBridePrimary ? '<span class="primary-tag">Birincil</span>' : ""}
          </a>
          <a class="contact-link ${isGroomPrimary ? "is-primary" : ""}" href="tel:${escapeHtml(item.groomPhone)}" title="Damat Telefonu">
            <span>Damat:</span> <strong>${escapeHtml(item.groomPhone)}</strong> ${isGroomPrimary ? '<span class="primary-tag">Birincil</span>' : ""}
          </a>
          <a class="contact-link contact-link--email" href="mailto:${escapeHtml(item.primaryEmail)}" title="E-Posta">
            ✉️ <span>${escapeHtml(item.primaryEmail)}</span>
          </a>
        </div>
      </div>
    </div>
  </article>`;
}

async function openApplicationDetail(applicationId) {
  if (!appDetailDialog) return;
  if (!appDetailDialog.open) openManagedDialog(appDetailDialog);
  appDetailTitle.textContent = "Yükleniyor…";
  appDetailContent.innerHTML = empty("Başvuru detayları hazırlanıyor…");
  try {
    const response = await apiRequest(`/admin/booking-applications/${applicationId}`);
    renderApplicationDetailModal(response.data);
  } catch (error) {
    appDetailContent.innerHTML = empty(error.message);
  }
}

function renderApplicationDetailModal(item) {
  const venueName = item.venue?.name || "Salon Belirtilmedi";
  const dateStr = formatDate(item.weddingStartsAt, false);
  const startTime = formatAppTime(item.weddingStartsAt);
  const endTime = formatAppTime(item.weddingEndsAt);
  const timeRangeStr = `${startTime} – ${endTime}`;

  const brideFullName = `${item.brideFirstName} ${item.brideLastName}`.trim();
  const groomFullName = `${item.groomFirstName} ${item.groomLastName}`.trim();

  const primaryLabel = PRIMARY_CONTACT_LABELS[item.primaryContact] || item.primaryContact;
  const paymentLabel = PAYMENT_METHOD_LABELS[item.paymentMethod] || item.paymentMethod;
  const paymentFlowIsEditable = isPaymentFlowEditable(item);
  const canApprove = item.status === "ONAY_BEKLIYOR";
  const paymentStage =
    item.source === "ADMIN"
      ? "Yönetici başvurusu"
      : item.whatsappHandoffAt
        ? `Dekont kontrolü bekleniyor (${formatDate(item.whatsappHandoffAt, true)})${paymentFlowIsEditable ? "" : " — düzenleme süresi doldu"}`
        : paymentFlowIsEditable
          ? `Dekont bekleniyor — ${formatDate(item.paymentFlowExpiresAt, true)} tarihine kadar düzenlenebilir`
          : `Dekont bekleniyor — düzenleme süresi ${formatDate(item.paymentFlowExpiredAt || item.paymentFlowExpiresAt, true)} tarihinde doldu`;

  const statusLabel = BOOKING_STATUS_LABELS[item.status] || item.status;
  const statusClass =
    item.status === "ONAYLANDI"
      ? "status-tag--approved"
      : item.status === "REDDEDILDI"
        ? "status-tag--rejected"
        : "status-tag--pending";

  const servicesHtml =
    item.services && item.services.length
      ? item.services
          .map(
            (s) => `
        <div class="service-item-row">
          <span>${escapeHtml(s.nameSnapshot)}</span>
          <strong>${formatMoney(s.priceCents)}</strong>
        </div>
      `
          )
          .join("")
      : '<p class="empty-inline">Ekstra hizmet seçilmemiş.</p>';

  appDetailTitle.textContent = `${brideFullName} & ${groomFullName}`;

  appDetailContent.innerHTML = `
    <div class="app-detail-wrapper">
      <div class="app-detail-header-card">
        <div class="app-detail-header-left">
          <span class="ref-badge large">${escapeHtml(item.referenceCode)}</span>
          <span class="status-tag ${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="app-detail-header-date">
          <small>Başvuru Tarihi</small>
          <strong>${formatDate(item.createdAt, true)}</strong>
        </div>
      </div>

      <section class="app-detail-section">
        <h3>Etkinlik &amp; Salon Bilgileri</h3>
        <div class="app-detail-grid">
          <div class="app-detail-box">
            <small>Salon / Mekân</small>
            <strong>🏛️ ${escapeHtml(venueName)}</strong>
          </div>
          <div class="app-detail-box">
            <small>Düğün / Etkinlik Tarihi</small>
            <strong>📅 ${escapeHtml(dateStr)}</strong>
          </div>
          <div class="app-detail-box">
            <small>Başlangıç - Bitiş Saati</small>
            <strong class="highlight-time">⏰ ${escapeHtml(timeRangeStr)}</strong>
          </div>
        </div>
      </section>

      <section class="app-detail-section">
        <h3>İletişim &amp; Çift Bilgileri (Birincil: ${escapeHtml(primaryLabel)})</h3>
        <div class="app-detail-grid">
          <div class="app-detail-box ${item.primaryContact === "GELIN" ? "is-primary-box" : ""}">
            <small>Gelin ${item.primaryContact === "GELIN" ? "⭐ (Birincil)" : ""}</small>
            <strong>${escapeHtml(brideFullName)}</strong>
            <a href="tel:${escapeHtml(item.bridePhone)}" class="phone-link">📞 ${escapeHtml(item.bridePhone)}</a>
          </div>
          <div class="app-detail-box ${item.primaryContact === "DAMAT" ? "is-primary-box" : ""}">
            <small>Damat ${item.primaryContact === "DAMAT" ? "⭐ (Birincil)" : ""}</small>
            <strong>${escapeHtml(groomFullName)}</strong>
            <a href="tel:${escapeHtml(item.groomPhone)}" class="phone-link">📞 ${escapeHtml(item.groomPhone)}</a>
          </div>
          <div class="app-detail-box wide-box">
            <small>Birincil E-Posta Adresi</small>
            <a href="mailto:${escapeHtml(item.primaryEmail)}" class="email-link">✉️ ${escapeHtml(item.primaryEmail)}</a>
          </div>
        </div>
      </section>

      <section class="app-detail-section">
        <h3>Paket &amp; Hizmet Seçimleri</h3>
        <div class="package-summary-card">
          <div class="package-main-line">
            <div>
              <small>Ana Paket</small>
              <strong>${escapeHtml(item.packageNameSnapshot)}</strong>
            </div>
            <strong>${formatMoney(item.packagePriceCents)}</strong>
          </div>

          <div class="extra-services-block">
            <small>Seçilen Ek Hizmetler</small>
            ${servicesHtml}
          </div>

          <div class="package-total-line">
            <div>
              <small>Ödeme Yöntemi: <strong>${escapeHtml(paymentLabel)}</strong></small>
              <br><small>Hemen Ödenecek Tutar: <strong>${formatMoney(item.payableNowCents)}</strong></small>
              <br><small>Havale Referansı: <strong>${escapeHtml(item.referenceCode)}</strong></small>
              <br><small>Ödeme Bildirimi: <strong>${escapeHtml(paymentStage)}</strong></small>
            </div>
            <div class="total-amount">
              <small>Toplam Tutar</small>
              <strong>${formatMoney(item.totalPriceCents)}</strong>
            </div>
          </div>
        </div>
      </section>

      ${
        item.note
          ? `
        <section class="app-detail-section">
          <h3>Müşteri Notu</h3>
          <blockquote class="customer-note-quote">${escapeHtml(item.note)}</blockquote>
        </section>
      `
          : ""
      }

      ${
        item.rejectionReason
          ? `
        <section class="app-detail-section">
          <h3>Red Neden Bildirimi</h3>
          <div class="rejection-box">${escapeHtml(item.rejectionReason)}</div>
        </section>
      `
          : ""
      }

      <div class="app-detail-footer-actions">
        ${
          item.deletedAt
            ? `<button class="mini-button" type="button" data-restore-application="${item.id}">Geri Yükle</button>${["ONAY_BEKLIYOR", "REDDEDILDI"].includes(item.status) ? `<button class="mini-button mini-button--danger" type="button" data-delete-application="${item.id}">Kalıcı Sil</button>` : ""}`
            : item.status === "ONAY_BEKLIYOR"
              ? `${canApprove ? `<button class="mini-button mini-button--primary" type="button" data-approve="${item.id}">Onayla</button>` : ""}<button class="mini-button mini-button--danger" type="button" data-reject="${item.id}">Reddet</button><button class="mini-button" type="button" data-archive-application="${item.id}">Arşivle</button>`
              : ["REDDEDILDI", "IPTAL_EDILDI"].includes(item.status)
                ? `<button class="mini-button" type="button" data-archive-application="${item.id}">Arşivle</button>`
                : ``
        }
        <button class="secondary-button" type="button" data-close-app-dialog>Kapat</button>
      </div>
    </div>
  `;

  const closeBtn = appDetailContent.querySelector("[data-close-app-dialog]");
  if (closeBtn) closeBtn.addEventListener("click", () => appDetailDialog.close());
}

function packageDetail(summary = {}) {
  const services = Array.isArray(summary.services) ? summary.services : [];
  return `<strong>${escapeHtml(summary.name || "Paket bilgisi yok")}</strong><small>${escapeHtml(summary.code || "")} ${summary.totalPriceCents ? `· ${escapeHtml(formatMoney(summary.totalPriceCents))}` : ""}</small>${
    services.length
      ? `<div class="crew-line">${services.map((service) => `<span>${escapeHtml(service.name)}</span>`).join("")}</div>`
      : ""
  }`;
}

function deliveryAllowedTransitions(wedding, delivery) {
  const transitions =
    delivery?.allowedTransitions ||
    wedding.allowedTransitions ||
    wedding.allowedDeliveryTransitions ||
    [];
  return Array.isArray(transitions) ? transitions : [];
}

function renderWeddingLifecycleActions(wedding) {
  if (wedding.deletedAt) {
    return `<button class="secondary-button" type="button" data-restore-wedding="${wedding.id}">Geri Yükle</button>`;
  }
  if (wedding.cancelledAt) {
    return `<button class="secondary-button" type="button" data-reinstate-wedding="${wedding.id}">İptali geri al</button><button class="secondary-button" type="button" data-archive-wedding="${wedding.id}">Arşivle</button>`;
  }

  const activationTask = wedding.messageTasks?.find(
    (task) => task.kind === "ACCOUNT_ACTIVATION" && !["SENT", "CANCELLED"].includes(task.status)
  );
  const activationAction =
    wedding.customerUser.mustChangePassword && activationTask
      ? `<button class="primary-button" type="button" data-activate-customer="${escapeHtml(activationTask.id)}" data-task-status="${escapeHtml(activationTask.status)}" data-task-due-at="${escapeHtml(activationTask.dueAt)}" data-task-early-override-at="${escapeHtml(activationTask.earlyOverrideAt || "")}">Müşteri hesabını aktifleştir</button>`
      : "";
  const commonActions = `${activationAction}<button class="secondary-button" type="button" data-edit-current>Düğün bilgilerini düzenle</button><button class="secondary-button" type="button" data-reset-user="${escapeHtml(wedding.customerUser.id)}">Müşteri parolasını sıfırla</button>`;
  if (new Date(wedding.endsAt).valueOf() > Date.now()) {
    return `${commonActions}<button class="secondary-button" type="button" data-cancel-wedding="${wedding.id}">Düğünü iptal et</button>`;
  }
  return `${commonActions}<button class="secondary-button" type="button" data-archive-wedding="${wedding.id}">Arşivle</button>`;
}

function renderWeddingDetail(wedding) {
  const delivery = wedding.delivery;
  const deliveryLocked = Boolean(wedding.cancelledAt || wedding.deletedAt);
  const deliveryInputsDisabled = deliveryLocked || delivery?.status === "TESLIM_EDILDI";
  const deliveryTransitions = delivery ? deliveryAllowedTransitions(wedding, delivery) : [];
  const allowedDeliveryStatuses = delivery
    ? [...new Set([delivery.status, ...deliveryTransitions])]
    : [];
  const deliveryStatusDisabled = deliveryInputsDisabled || deliveryTransitions.length === 0;
  const assignedIds = new Set(wedding.assignments.map((assignment) => assignment.staffId));
  const available = wedding.availableStaff.filter((staff) => !assignedIds.has(staff.id));
  const expectedDeliveryDate = addDays(datePartInIstanbul(wedding.startsAt), 21);
  const paymentTotalCents = Number(
    wedding.paymentTotalCents ?? wedding.packageSummary?.totalPriceCents ?? 0
  );
  const paymentDepositCents = Number(wedding.paymentDepositCents || 0);
  const paymentReceivedCents = Number(wedding.paymentReceivedCents || 0);
  const paymentRemainingCents = Math.max(paymentTotalCents - paymentReceivedCents, 0);
  document.querySelector(".js-detail-title").textContent = coupleName(wedding);
  weddingPdfButton.disabled = false;
  detailContent.innerHTML = `<section class="detail-hero"><div class="detail-hero__meta"><span>${formatDate(wedding.startsAt, true)}</span><span>${escapeHtml(wedding.venue.name)}</span><span>${escapeHtml(wedding.cancelledAt ? "İptal edildi" : STATUS_LABELS[delivery?.status] || "Teslimat yok")}</span></div><div class="detail-actions">${renderWeddingLifecycleActions(wedding)}</div></section>
  <div class="detail-grid">
    <section class="detail-block"><h3>Çift ve iletişim</h3><div class="contact-line"><span>${escapeHtml(wedding.brideFirstName)} ${escapeHtml(wedding.brideLastName)}</span><a href="${safePhoneHref(wedding.bridePhone)}">${escapeHtml(wedding.bridePhone)}</a></div><div class="contact-line"><span>${escapeHtml(wedding.groomFirstName)} ${escapeHtml(wedding.groomLastName)}</span><a href="${safePhoneHref(wedding.groomPhone)}">${escapeHtml(wedding.groomPhone)}</a></div><div class="contact-line"><span>E-posta</span><a href="mailto:${escapeHtml(wedding.primaryEmail)}">${escapeHtml(wedding.primaryEmail)}</a></div></section>
    <section class="detail-block"><h3>Paket</h3>${packageDetail(wedding.packageSummary)}${wedding.note ? `<p>${escapeHtml(wedding.note)}</p>` : ""}</section>
    <section class="detail-block wide"><h3>Ödeme detayları</h3><div class="contact-line"><span>Toplam tutar</span><strong>${escapeHtml(formatMoney(paymentTotalCents))}</strong></div><div class="contact-line"><span>Kapora</span><strong>${escapeHtml(formatMoney(paymentDepositCents))}</strong></div><div class="contact-line"><span>Alınan para</span><strong>${escapeHtml(formatMoney(paymentReceivedCents))}</strong></div><div class="contact-line"><span>Kalan para</span><strong>${escapeHtml(formatMoney(paymentRemainingCents))}</strong></div></section>
    <section class="detail-block wide"><h3>Personel dağılımı</h3><div class="assignment-list">${
      wedding.assignments.length
        ? wedding.assignments
            .map(
              (assignment) =>
                `<div class="assignment-item"><span><strong>${escapeHtml(assignment.staff.firstName)} ${escapeHtml(assignment.staff.lastName)}</strong><small>${escapeHtml(SPECIALTIES[assignment.specialty])}</small></span><button class="mini-button mini-button--danger" type="button" data-remove-assignment="${escapeHtml(assignment.id)}" ${deliveryLocked ? "disabled" : ""}>Kaldır</button></div>`
            )
            .join("")
        : empty("Henüz personel atanmadı.")
    }</div>${
      deliveryLocked
        ? `<small>İptal edilmiş veya arşivlenmiş düğünde personel ataması değiştirilemez.</small>`
        : `<form class="assignment-form js-assignment-form"><select name="staffId" aria-label="Müsait personel" required><option value="">Müsait personel seçin</option>${available
            .map(
              (staff) =>
                `<option value="${staff.id}">${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)} · ${staff.specialties.map((key) => SPECIALTIES[key]).join(", ")}</option>`
            )
            .join(
              ""
            )}</select><select name="specialty" aria-label="Görev" required><option value="">Görev seçin</option></select><button class="mini-button mini-button--primary" type="submit">Ata</button></form>`
    }<p class="dialog-message js-assignment-message" role="alert" aria-live="assertive"></p></section>
    <section class="detail-block wide"><h3>Teslimat</h3>${
      delivery
        ? `<div class="delivery-controls" data-delivery-row="${delivery.id}"><select data-field="status" aria-label="Teslimat durumu" ${deliveryStatusDisabled ? "disabled" : ""}>${allowedDeliveryStatuses
            .map(
              (status) =>
                `<option value="${escapeHtml(status)}" ${delivery.status === status ? "selected" : ""}>${escapeHtml(STATUS_LABELS[status] || status)}</option>`
            )
            .join(
              ""
            )}</select><input data-field="dueDate" type="date" aria-label="Teslim tarihi" aria-describedby="delivery-error-${delivery.id}" min="${expectedDeliveryDate}" max="${expectedDeliveryDate}" value="${String(delivery.dueDate).slice(0, 10)}" ${deliveryInputsDisabled ? "disabled" : ""} /><input data-field="driveUrl" type="url" aria-label="Google Drive veya WeTransfer bağlantısı" aria-describedby="delivery-error-${delivery.id}" placeholder="https://drive.google.com/... veya https://we.tl/..." value="${escapeHtml(delivery.driveUrl || "")}" ${deliveryInputsDisabled ? "disabled" : ""} /><button class="mini-button" type="button" data-save-delivery="${delivery.id}" ${deliveryInputsDisabled ? "disabled" : ""}>Kaydet</button><button class="mini-button mini-button--primary" type="button" data-deliver="${delivery.id}" ${deliveryLocked || delivery.status !== "TESLIME_HAZIR" || !delivery.hasDriveUrl ? "disabled" : ""}>Teslim Et</button>${delivery.status === "TESLIM_EDILDI" && !delivery.revokedAt && !deliveryLocked ? `<button class="mini-button mini-button--danger" type="button" data-revoke-delivery="${delivery.id}">Erişimi geri çek</button>` : ""}${delivery.revokedAt ? `<span class="status-dot">Erişim geri çekildi</span>` : ""}<p id="delivery-error-${delivery.id}" class="dialog-message js-delivery-message" role="alert" aria-live="assertive"></p></div>`
        : empty("Teslimat kaydı yok.")
    }</section>
    ${wedding.deletedAt && !wedding.cancelledAt ? `<section class="detail-block wide danger-zone"><h3>Tehlikeli işlemler</h3><p>Kalıcı silme; atamaları, mesaj görevlerini ve teslimat operasyon kayıtlarını geri alınamaz şekilde siler. Denetim kayıtları korunur.</p><button class="mini-button mini-button--danger" type="button" data-delete-wedding="${wedding.id}">Kalıcı Sil</button></section>` : ""}
    <section class="detail-block wide"><h3>Mesaj geçmişi</h3><div class="message-timeline">${
      wedding.messageTasks.length
        ? wedding.messageTasks
            .map(
              (task) =>
                `<article class="timeline-item ${task.status === "SENT" ? "is-sent" : ""}"><span><strong>${escapeHtml(MESSAGE_LABELS[task.kind] || task.kind)}</strong><small>${escapeHtml(task.recipientPhone)} · Planlanan ${formatDate(task.dueAt, true)}</small></span><span><strong>${escapeHtml(MESSAGE_STATUS_LABELS[task.status] || task.status)}</strong><small>${task.sentAt ? formatDate(task.sentAt, true) : "—"}</small></span></article>`
            )
            .join("")
        : empty("Mesaj kaydı yok.")
    }</div></section>
  </div>`;
}

async function openWeddingDetail(weddingId) {
  if (!detailDialog.open) openManagedDialog(detailDialog);
  state.currentWedding = null;
  weddingPdfButton.disabled = true;
  document.querySelector(".js-detail-title").textContent = "Yükleniyor…";
  detailContent.innerHTML = empty("Düğün dosyası hazırlanıyor…");
  try {
    const response = await apiRequest(`/admin/weddings/${weddingId}`);
    state.currentWedding = response.data;
    renderWeddingDetail(response.data);
  } catch (error) {
    detailContent.innerHTML = empty(error.message);
  }
}

weddingPdfButton.addEventListener("click", () => {
  if (!state.currentWedding) return;
  printWeddingReport(state.currentWedding, { venueName: state.currentWedding.venue?.name });
});

async function loadStaff() {
  const container = document.querySelector(".js-staff");
  container.innerHTML = empty("Personeller yükleniyor…");
  try {
    const [response] = await Promise.all([apiRequest("/admin/staff"), ensureVenues()]);
    state.staff = response.data;
    markDataSuccess();
    renderStaff();
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

async function ensureVenues() {
  if (!state.venues.length) state.venues = (await apiRequest("/venues")).data;
  const options = state.venues
    .map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</option>`)
    .join("");
  renderVenueChoices(staffForm);
  renderVenueChoices(managedUserForm);
  const filterVenueSelect = document.querySelector(".js-staff-venue-filter");
  if (filterVenueSelect) {
    const currentValue = filterVenueSelect.value;
    filterVenueSelect.innerHTML = `<option value="">Tüm salonlar</option>${options}`;
    filterVenueSelect.value = currentValue;
  }
}

function venuePickerField(form) {
  return form.querySelector(".venue-picker");
}

function venuePickerInputs(form) {
  return [...venuePickerField(form).querySelectorAll('input[name="venueIds"]')];
}

function selectedVenueIds(form) {
  return venuePickerInputs(form)
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function updateVenueSummary(form) {
  const field = venuePickerField(form);
  const selectedIds = new Set(selectedVenueIds(form));
  const selectedVenues = state.venues.filter((venue) => selectedIds.has(venue.id));
  const count = field.querySelector(".venue-picker__count");
  const selected = field.querySelector(".venue-picker__selected");
  count.textContent = `${selectedVenues.length} salon seçili`;
  selected.innerHTML = selectedVenues
    .map(
      (venue) =>
        `<button type="button" data-remove-venue="${escapeHtml(venue.id)}" aria-label="${escapeHtml(`${venue.name} salonunu çıkar`)}">${escapeHtml(venue.name)} <span aria-hidden="true">×</span></button>`
    )
    .join("");
}

function setVenueSelection(form, venueIds) {
  const selected = new Set(venueIds);
  venuePickerInputs(form).forEach((input) => {
    input.checked = selected.has(input.value);
  });
  const field = venuePickerField(form);
  updateVenueSummary(form);
  field.setAttribute("aria-invalid", "false");
  field.querySelector(".field-error").textContent = "";
}

function renderVenueChoices(form) {
  const field = venuePickerField(form);
  const selectedIds = selectedVenueIds(form);
  const container = field.querySelector(".venue-picker__list");
  container.innerHTML = state.venues
    .map(
      (venue) =>
        `<label class="venue-picker__choice"><input type="checkbox" name="venueIds" value="${escapeHtml(venue.id)}"><span>${escapeHtml(venue.name)}</span></label>`
    )
    .join("");
  setVenueSelection(form, selectedIds);
}

function filterVenueChoices(form) {
  const field = venuePickerField(form);
  const search = field.querySelector(".venue-picker__search");
  const term = search.value.trim().toLocaleLowerCase(APP_LOCALE);
  let visibleCount = 0;
  field.querySelectorAll(".venue-picker__choice").forEach((choice) => {
    const matches = choice.textContent.toLocaleLowerCase(APP_LOCALE).includes(term);
    choice.hidden = !matches;
    if (matches) visibleCount += 1;
  });
  field.querySelector(".venue-picker__empty").hidden = visibleCount > 0;
}

function validateVenueSelection(form) {
  const valid = selectedVenueIds(form).length > 0;
  const field = venuePickerField(form);
  const error = field.querySelector(".field-error");
  field.setAttribute("aria-invalid", String(!valid));
  error.textContent = valid ? "" : "En az bir salon seçin.";
  if (!valid) {
    const search = field.querySelector(".venue-picker__search");
    search.value = "";
    filterVenueChoices(form);
    venuePickerInputs(form)[0]?.focus();
  }
  return valid;
}

function setupVenuePicker(form) {
  const field = venuePickerField(form);
  field.querySelector(".venue-picker__search").addEventListener("input", () => {
    filterVenueChoices(form);
  });
  field.querySelector(".venue-picker__list").addEventListener("change", (event) => {
    if (event.target.name !== "venueIds") return;
    updateVenueSummary(form);
    validateVenueSelection(form);
  });
  field.querySelector(".venue-picker__selected").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-venue]");
    if (!button) return;
    const input = venuePickerInputs(form).find(
      (candidate) => candidate.value === button.dataset.removeVenue
    );
    if (input) input.checked = false;
    updateVenueSummary(form);
    validateVenueSelection(form);
  });
}

function renderStaff() {
  const term = document
    .querySelector(".js-staff-search")
    .value.trim()
    .toLocaleLowerCase(APP_LOCALE);
  const specialty = document.querySelector(".js-staff-specialty-filter").value;
  const venueId = document.querySelector(".js-staff-venue-filter")?.value || "";
  const active = document.querySelector(".js-staff-active-filter").value;
  const rows = state.staff.filter((staff) => {
    const matchesTerm = `${staff.firstName} ${staff.lastName} ${staff.phone}`
      .toLocaleLowerCase(APP_LOCALE)
      .includes(term);
    const matchesSpecialty = !specialty || staff.specialties.includes(specialty);
    const matchesVenue =
      !venueId ||
      staff.venues?.some((venue) => venue.id === venueId) ||
      staff.venueId === venueId ||
      staff.venue?.id === venueId;
    const matchesActive =
      active === "all" || (active === "active" ? staff.isActive : !staff.isActive);
    return matchesTerm && matchesSpecialty && matchesVenue && matchesActive;
  });
  document.querySelector(".js-staff").innerHTML = rows.length
    ? rows
        .map(
          (staff) =>
            `<article class="staff-card ${staff.isActive ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(staff.firstName[0])}${escapeHtml(staff.lastName[0])}</span><span class="status-dot" data-status="${staff.isActive ? "TESLIM_EDILDI" : ""}">${staff.isActive ? "Aktif" : "Pasif"}</span></div><h3>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</h3><a class="staff-phone" href="${safePhoneHref(staff.phone)}">${escapeHtml(staff.phone)}</a><small class="staff-venue">${escapeHtml(staff.venues?.map((venue) => venue.name).join(" · ") || staff.venue?.name || "Salon atanmamış")}</small><div class="crew-line">${staff.specialties.map((key) => `<span class="tag">${escapeHtml(SPECIALTIES[key])}</span>`).join("")}</div><footer><span>${staff.assignments.length ? `${staff.assignments.length} yaklaşan görev` : "Yaklaşan görevi yok"}</span><button class="mini-button" type="button" data-edit-staff="${staff.id}">Düzenle</button><button class="mini-button" type="button" data-toggle-staff="${staff.id}" data-active="${staff.isActive}">${staff.isActive ? "Pasife al" : "Aktifleştir"}</button><button class="mini-button mini-button--danger" type="button" data-delete-staff="${staff.id}">Sil</button></footer></article>`
        )
        .join("")
    : empty("Filtreye uyan personel yok.");
}

async function openStaffForm(staff = null) {
  await ensureVenues();
  staffForm.reset();
  staffForm.elements.staffId.value = staff?.id || "";
  staffForm.elements.firstName.value = staff?.firstName || "";
  staffForm.elements.lastName.value = staff?.lastName || "";
  staffForm.elements.phone.value = staff?.phone || "";
  staffForm.elements.isActive.checked = staff?.isActive ?? true;
  setVenueSelection(
    staffForm,
    staff?.venues?.map((venue) => venue.id) ||
      [staff?.venueId || state.venues[0]?.id].filter(Boolean)
  );
  staffForm.querySelector(".js-staff-venue-search").value = "";
  filterVenueChoices(staffForm);
  document.querySelector(".js-staff-form-title").textContent = staff
    ? "Personeli düzenle"
    : "Personel ekle";
  staffForm.querySelector(".js-staff-form-message").textContent = "";
  staffForm.querySelector(".js-staff-specialties-error").hidden = true;
  const submitButton = staffForm.querySelector(".js-staff-submit");
  submitButton.disabled = false;
  submitButton.textContent = "Kaydet";
  staffForm.querySelectorAll('input[name="specialties"]').forEach((input) => {
    input.checked = staff?.specialties.includes(input.value) || false;
  });
  openManagedDialog(staffDialog);
}

async function loadManagers() {
  const container = document.querySelector(".js-managers");
  container.innerHTML = empty("Salon sorumluları yükleniyor…");
  try {
    const response = await apiRequest("/admin/venue-managers");
    state.managers = response.data;
    markDataSuccess();
    container.innerHTML = state.managers.length
      ? state.managers
          .map(
            (manager) =>
              `<article class="staff-card ${manager.status === "ACTIVE" ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(manager.username.slice(0, 2).toUpperCase())}</span><span class="status-dot" data-status="${manager.status === "ACTIVE" ? "TESLIM_EDILDI" : ""}">${escapeHtml(ACCOUNT_STATUS_LABELS[manager.status] || manager.status)}</span></div><h3>${escapeHtml(manager.username)}</h3><p>${escapeHtml(manager.venues?.map((venue) => venue.name).join(" · ") || manager.venue?.name || "Salon atanmamış")}</p><small>${manager.lastLoginAt ? `Son giriş: ${formatDate(manager.lastLoginAt, true)}` : "Henüz giriş yapmadı"}</small><footer><span>${manager.mustChangePassword ? "Parola değişimi bekleniyor" : "Hesap hazır"}</span><button class="mini-button" type="button" data-edit-managed-user="${manager.id}" data-managed-user-role="SALON_YETKILISI">Düzenle</button></footer></article>`
          )
          .join("")
      : empty("Henüz salon sorumlusu hesabı yok.");
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

async function loadMontageUsers() {
  const container = document.querySelector(".js-montage-users");
  container.innerHTML = empty("Montajcı hesapları yükleniyor…");
  try {
    const response = await apiRequest("/admin/montage-users");
    state.montageUsers = response.data;
    markDataSuccess();
    container.innerHTML = state.montageUsers.length
      ? state.montageUsers
          .map(
            (user) =>
              `<article class="staff-card ${user.status === "ACTIVE" ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(user.username.slice(0, 2).toUpperCase())}</span><span class="status-dot" data-status="${user.status === "ACTIVE" ? "TESLIM_EDILDI" : ""}">${escapeHtml(ACCOUNT_STATUS_LABELS[user.status] || user.status)}</span></div><h3>${escapeHtml(user.username)}</h3><p>Tüm düğün bilgileri ve teslimat bağlantısı yetkisi</p><small>${user.lastLoginAt ? `Son giriş: ${formatDate(user.lastLoginAt, true)}` : "Henüz giriş yapmadı"}</small><footer><span>${user.mustChangePassword ? "Parola değişimi bekleniyor" : "Hesap hazır"}</span><button class="mini-button" type="button" data-edit-managed-user="${user.id}" data-managed-user-role="MONTAJCI">Düzenle</button></footer></article>`
          )
          .join("")
      : empty("Henüz montajcı hesabı yok.");
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

async function loadManagedUsers() {
  await Promise.all([loadManagers(), loadMontageUsers()]);
}

function syncManagedUserRole() {
  const role = managedUserForm.dataset.role || managedUserForm.elements.role.value;
  const isMontageUser = role === "MONTAJCI";
  const venueField = managedUserForm.querySelector(".js-managed-user-venue");
  venueField.hidden = isMontageUser;
  if (isMontageUser) setVenueSelection(managedUserForm, []);
  else if (!selectedVenueIds(managedUserForm).length && state.venues[0]) {
    setVenueSelection(managedUserForm, [state.venues[0].id]);
  }
}

async function openManagedUserForm(user = null, role = "SALON_YETKILISI") {
  await ensureVenues();
  managedUserForm.reset();
  managedUserForm.dataset.role = user ? role : "";
  managedUserForm.elements.managedUserId.value = user?.id || "";
  managedUserForm.elements.role.value = role;
  managedUserForm.elements.role.disabled = Boolean(user);
  managedUserForm.elements.username.value = user?.username || "";
  setVenueSelection(
    managedUserForm,
    user?.venues?.map((venue) => venue.id) ||
      [user?.venue?.id || state.venues[0]?.id].filter(Boolean)
  );
  managedUserForm.querySelector(".js-managed-user-venue-search").value = "";
  filterVenueChoices(managedUserForm);
  managedUserForm.elements.isActive.checked = user?.status !== "DISABLED";
  managedUserForm.elements.password.required = !user;
  document.querySelector(".js-managed-user-password-note").textContent = user
    ? "Değişmeyecekse boş bırakın"
    : "En az 15 karakter";
  const roleLabel = role === "MONTAJCI" ? "Montajcı" : "Salon sorumlusu";
  document.querySelector(".js-managed-user-form-title").textContent = user
    ? `${roleLabel} hesabını düzenle`
    : "Kullanıcı hesabı ekle";
  managedUserForm.querySelector(".dialog-message").textContent = "";
  syncManagedUserRole();
  openManagedDialog(managedUserDialog);
}

function renderMessageActions(task) {
  if (task.status === "SENT" || task.status === "CANCELLED") {
    return `<span class="status-dot" data-status="TESLIM_EDILDI">${escapeHtml(MESSAGE_STATUS_LABELS[task.status] || task.status)}</span>`;
  }
  const dueReached = new Date(task.dueAt).valueOf() <= Date.now() || Boolean(task.earlyOverrideAt);
  const retryReached = !task.nextAttemptAt || new Date(task.nextAttemptAt).valueOf() <= Date.now();
  const cancelButton = `<button class="mini-button" type="button" data-cancel-message="${task.id}">İptal</button>`;
  const overrideButton = !dueReached
    ? `<button class="mini-button" type="button" data-override-message="${task.id}">Şimdi gönder</button>`
    : "";
  if (task.status === "PLANNED" || task.status === "FAILED") {
    return `<button class="mini-button mini-button--primary" type="button" data-prepare-message="${task.id}" ${retryReached ? "" : "disabled"}>Hazırla</button>${overrideButton}${cancelButton}`;
  }
  if (task.status === "PREPARED") {
    return `<button class="mini-button mini-button--primary" type="button" data-verify-message="${task.id}" ${dueReached ? "" : "disabled"}>Linki doğrula</button>${overrideButton}${cancelButton}`;
  }
  if (task.status === "READY_TO_SEND") {
    const opened = state.openedMessageTaskIds.has(task.id);
    return `<button class="mini-button mini-button--primary" type="button" data-send-message="${task.id}" ${dueReached ? "" : "disabled"}>WhatsApp'ta gönder</button><button class="mini-button" type="button" data-mark-sent="${task.id}" data-task-updated-at="${escapeHtml(task.updatedAt)}" ${opened ? "" : "disabled"}>Gönderildi işaretle</button><button class="mini-button" type="button" data-mark-failed="${task.id}" data-task-updated-at="${escapeHtml(task.updatedAt)}" ${opened ? "" : "disabled"}>Başarısız</button>${overrideButton}${cancelButton}`;
  }
  return `<span class="status-dot">${escapeHtml(MESSAGE_STATUS_LABELS[task.status] || task.status)}</span>`;
}

async function loadMessages() {
  const container = document.querySelector(".js-messages");
  const pager = state.pagination.messages;
  container.innerHTML = empty("Mesaj kayıtları yükleniyor…");
  try {
    const query = new window.URLSearchParams({ pageSize: String(pager.pageSize) });
    const kind = document.querySelector(".js-message-kind-filter").value;
    const status = document.querySelector(".js-message-status-filter").value;
    if (kind) query.set("kind", kind);
    if (status) query.set("status", status);
    if (pager.cursor) query.set("cursor", pager.cursor);
    const response = await apiRequest(`/admin/message-tasks?${query}`);
    const tasks = unpackPaginatedList("messages", response.data);
    markDataSuccess();
    container.innerHTML = tasks.length
      ? tasks
          .map(
            (task) =>
              `<article class="data-row"><div><strong>${escapeHtml(task.wedding.brideFirstName)} &amp; ${escapeHtml(task.wedding.groomFirstName)}</strong><small>${escapeHtml(MESSAGE_LABELS[task.kind] || task.kind)}</small></div><div><small>Alıcı</small><strong>${escapeHtml(task.recipientPhone)}</strong></div><div><small>${task.status === "SENT" ? "Gönderilen" : "Planlanan"}</small><strong>${formatDate(task.sentAt || task.dueAt, true)}</strong></div><div class="data-row__actions">${renderMessageActions(task)}</div></article>`
          )
          .join("")
      : empty("Mesaj kaydı bulunmuyor.");
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

function renderCatalogRows(container, rows, type) {
  if (!rows || !rows.length) {
    container.innerHTML = `<div class="empty-state" style="padding: 24px; text-align: center; color: var(--color-muted, #777); font-size: 14px;">Kayıt bulunamadı.</div>`;
    return;
  }
  const isPackage = type === "packages";
  container.innerHTML = rows
    .map((item) => {
      const img = safeImageAssetPath(item.imagePath, CATALOG_FALLBACK_IMAGE);
      const priceFormatted = (item.priceCents / 100).toLocaleString(APP_LOCALE);
      const subInfo = [
        `Kod: ${escapeHtml(item.code)}`,
        !isPackage && item.category ? `Kategori: ${escapeHtml(item.category)}` : null,
        !isPackage && item.eyebrow ? `Rozet: ${escapeHtml(item.eyebrow)}` : null
      ]
        .filter(Boolean)
        .join(" • ");

      return `
        <article class="catalog-row" data-catalog-row="${item.id}" data-catalog-type="${type}" data-catalog-name="${escapeHtml(item.name)}">
          <div class="catalog-thumb">
            <img class="js-catalog-image" src="${escapeHtml(img)}" alt="${escapeHtml(item.name)}" style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
          <div class="catalog-info">
            <div class="catalog-title-row">
              <strong class="catalog-title">${escapeHtml(item.name)}</strong>
              <span class="catalog-status-badge ${item.isActive ? "catalog-status-badge--active" : "catalog-status-badge--disabled"}">
                ${item.isActive ? "Yayında" : "Gizli"}
              </span>
            </div>
            <small class="catalog-subinfo">${subInfo}</small>
            ${
              item.description
                ? `<p class="catalog-desc">${escapeHtml(item.description)}</p>`
                : `<p class="catalog-desc catalog-desc--empty">Açıklama belirtilmemiş.</p>`
            }
          </div>
          <div class="catalog-price">
            <small>Fiyat</small>
            <strong>₺${priceFormatted}</strong>
          </div>
          <div class="catalog-actions">
            <button class="mini-button mini-button--primary catalog-edit" type="button" data-edit-catalog="${item.id}" ${state.catalogFormConstraints ? "" : 'disabled title="Katalog form koşulları yüklenemedi"'}>Düzenle</button>
            <button class="mini-button mini-button--danger catalog-delete" type="button" data-delete-catalog="${item.id}">Sil</button>
          </div>
        </article>`;
    })
    .join("");

  container.querySelectorAll(".js-catalog-image").forEach((image) => {
    image.addEventListener(
      "error",
      () => {
        if (image.getAttribute("src") !== CATALOG_FALLBACK_IMAGE) {
          image.setAttribute("src", CATALOG_FALLBACK_IMAGE);
        }
      },
      { once: true }
    );
  });
}

function renderVenueRows(container, rows) {
  if (!rows?.length) {
    container.innerHTML = empty("Henüz mekân kaydı bulunmuyor.");
    return;
  }

  container.innerHTML = rows
    .map((venue) => {
      const imagePath = safeImageAssetPath(venue.imagePath, "assets/images/venue-pavilion.webp");
      const visibility = [
        `Kod: ${escapeHtml(venue.slug)}`,
        venue.isPartner ? "İş ortağı" : "Müşteri mekânı",
        venue.isFeatured ? "Ana sayfada" : "Vitrin dışı"
      ].join(" • ");
      return `
        <article class="catalog-row" data-catalog-row="${venue.id}" data-catalog-type="venues" data-catalog-name="${escapeHtml(venue.name)}">
          <div class="catalog-thumb">
            <img src="${escapeHtml(imagePath)}" alt="" />
          </div>
          <div class="catalog-info">
            <div class="catalog-title-row">
              <strong class="catalog-title">${escapeHtml(venue.displayName || venue.name)}</strong>
              <span class="catalog-status-badge ${venue.isActive ? "catalog-status-badge--active" : "catalog-status-badge--disabled"}">
                ${venue.isActive ? "Aktif" : "Pasif"}
              </span>
            </div>
            <small class="catalog-subinfo">${visibility}</small>
            <p class="catalog-desc">Operasyon adı: ${escapeHtml(venue.name)}</p>
          </div>
          <div class="catalog-price">
            <small>Vitrin sırası</small>
            <strong>${venue.displayOrder}</strong>
          </div>
          <div class="catalog-actions">
            <button class="mini-button mini-button--primary catalog-edit" type="button" data-edit-catalog="${venue.id}" ${state.catalogFormConstraints ? "" : 'disabled title="Katalog form koşulları yüklenemedi"'}>Düzenle</button>
            <button class="mini-button mini-button--danger catalog-delete" type="button" data-delete-catalog="${venue.id}">Kaldır</button>
          </div>
        </article>`;
    })
    .join("");
}

async function loadCatalogAdmin() {
  setCatalogMessage("");
  try {
    const [packagesResponse, servicesResponse, venuesResponse, publicVenuesResponse] =
      await Promise.all([
        apiRequest("/admin/packages"),
        apiRequest("/admin/services"),
        apiRequest("/admin/venues"),
        apiRequest("/venues")
      ]);
    state.packages = packagesResponse.data;
    state.services = servicesResponse.data;
    state.catalogVenues = venuesResponse.data;
    state.venues = publicVenuesResponse.data;
    markDataSuccess();
    renderCatalogRows(document.querySelector(".js-packages"), state.packages, "packages");
    renderCatalogRows(document.querySelector(".js-services"), state.services, "services");
    renderVenueRows(document.querySelector(".js-venues-catalog"), state.catalogVenues);
  } catch (error) {
    setCatalogMessage(error.message);
    throw error;
  }
}

const panelLoaders = {
  overview: () => loadDashboard(),
  calendar: () => loadCalendar(),
  applications: loadApplications,
  staff: loadStaff,
  accounts: loadManagedUsers,
  messages: loadMessages,
  catalog: loadCatalogAdmin
};

const PANEL_TITLES = {
  overview: "Günün akışı",
  calendar: "Salon takvimi",
  applications: "Paket başvuruları",
  staff: "Personeller",
  messages: "Mesaj geçmişi",
  catalog: "Katalog yönetimi",
  accounts: "Kullanıcı hesapları"
};

async function movePagination(key, direction) {
  const pager = state.pagination[key];
  const loader = panelLoaders[key];
  if (!pager || !loader || pager.loading) return;
  if (direction === "next") {
    if (!pager.nextCursor) return;
    pager.history.push(pager.cursor);
    pager.cursor = pager.nextCursor;
  } else {
    if (pager.history.length === 0) return;
    pager.cursor = pager.history.pop() || null;
  }
  pager.loading = true;
  renderPagination(key);
  try {
    await loader();
  } finally {
    pager.loading = false;
    renderPagination(key);
  }
}

function activatePanel(name) {
  document.querySelectorAll("[data-panel]").forEach((button) => {
    const active = button.dataset.panel === name;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const panelTitle = document.querySelector(".js-panel-title");
  if (panelTitle) panelTitle.textContent = PANEL_TITLES[name] || "Yönetim";
  document.querySelectorAll("[data-panel-content]").forEach((panel) => {
    const active = panel.dataset.panelContent === name;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  const mobileMore = document.querySelector(".mobile-more");
  if (mobileMore) mobileMore.hidden = true;
  void panelLoaders[name]?.().catch((error) => setMessage(error.message));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  const panelButton = event.target.closest("[data-panel]");
  const jumpButton = event.target.closest("[data-jump]");
  const weddingButton = event.target.closest("[data-open-wedding]");
  if (panelButton) activatePanel(panelButton.dataset.panel);
  else if (jumpButton) activatePanel(jumpButton.dataset.jump);
  else if (weddingButton) void openWeddingDetail(weddingButton.dataset.openWedding);
});

const mobileMoreBtn = document.querySelector("[data-mobile-more]");
if (mobileMoreBtn) {
  mobileMoreBtn.addEventListener("click", () => {
    const menu = document.querySelector(".mobile-more");
    if (menu) menu.hidden = !menu.hidden;
  });
}
document.querySelectorAll(".dialog-close, [data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = button.closest("dialog");
    if (dialog) dialog.close();
  });
});

if (detailDialog) {
  detailDialog.addEventListener("click", (event) => {
    if (event.target === detailDialog) detailDialog.close();
  });
}
if (appDetailDialog) {
  appDetailDialog.addEventListener("click", (event) => {
    if (event.target === appDetailDialog) appDetailDialog.close();
  });
}

const availabilityDatePicker = document.querySelector(".js-availability-date-picker");
const availabilityDateInput = document.querySelector(".js-availability-date");
const availabilityDateTrigger = document.querySelector(".js-availability-date-trigger");
const availabilityDatePopover = document.querySelector(".js-availability-date-popover");
const availabilityDateValue = document.querySelector(".js-availability-date-value");
const availabilityCalendarTitle = document.querySelector(".js-availability-calendar-title");
const availabilityCalendarDays = document.querySelector(".js-availability-calendar-days");
const availabilityCalendarPrev = document.querySelector(".js-availability-calendar-prev");
const availabilityCalendarNext = document.querySelector(".js-availability-calendar-next");
const availabilityCalendarToday = document.querySelector(".js-availability-calendar-today");

const availabilityPickerDateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric"
});
const availabilityCalendarFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  month: "long",
  year: "numeric"
});
const dateToValue = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
const valueToDate = (value) => {
  if (!isIsoDate(value)) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

let availabilityCalendarView = valueToDate(datePartInIstanbul(new Date()));

function setAvailabilityPickerOpen(isOpen) {
  if (!availabilityDatePopover || !availabilityDateTrigger) return;
  availabilityDatePopover.hidden = !isOpen;
  availabilityDateTrigger.setAttribute("aria-expanded", String(isOpen));
}

function renderAvailabilityCalendar() {
  if (!availabilityCalendarDays || !availabilityCalendarTitle) return;
  availabilityCalendarTitle.textContent =
    availabilityCalendarFormatter.format(availabilityCalendarView);
  availabilityCalendarDays.replaceChildren();
  const year = availabilityCalendarView.getFullYear();
  const month = availabilityCalendarView.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayValue = datePartInIstanbul(new Date());
  const selectedValue = availabilityDateInput?.value || "";

  for (let index = 0; index < firstWeekday + daysInMonth; index += 1) {
    if (index < firstWeekday) {
      availabilityCalendarDays.append(document.createElement("span"));
      continue;
    }
    const day = index - firstWeekday + 1;
    const value = dateToValue(new Date(year, month, day));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-picker__day";
    button.textContent = String(day);
    button.dataset.dateValue = value;
    button.classList.toggle("is-today", value === todayValue);
    button.classList.toggle("is-selected", value === selectedValue);
    button.setAttribute("aria-label", availabilityPickerDateFormatter.format(valueToDate(value)));
    availabilityCalendarDays.append(button);
  }
}

function setAvailabilityDateDisplay(value, triggerChangeEvent = false) {
  if (!availabilityDateInput || !value) return;
  availabilityDateInput.value = value;
  state.availabilityDate = value;
  if (availabilityDateValue) {
    availabilityDateValue.textContent = availabilityPickerDateFormatter.format(valueToDate(value));
  }
  if (availabilityDateTrigger) {
    availabilityDateTrigger.classList.add("is-selected");
  }
  if (triggerChangeEvent) {
    availabilityDateInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
}

if (availabilityDateTrigger) {
  availabilityDateTrigger.addEventListener("click", () => {
    const isExpanded = availabilityDateTrigger.getAttribute("aria-expanded") === "true";
    if (!isExpanded) {
      if (availabilityDateInput?.value) {
        availabilityCalendarView = valueToDate(availabilityDateInput.value);
      }
      renderAvailabilityCalendar();
    }
    setAvailabilityPickerOpen(!isExpanded);
  });
}

if (availabilityCalendarPrev) {
  availabilityCalendarPrev.addEventListener("click", () => {
    availabilityCalendarView = new Date(
      availabilityCalendarView.getFullYear(),
      availabilityCalendarView.getMonth() - 1,
      1
    );
    renderAvailabilityCalendar();
  });
}

if (availabilityCalendarNext) {
  availabilityCalendarNext.addEventListener("click", () => {
    availabilityCalendarView = new Date(
      availabilityCalendarView.getFullYear(),
      availabilityCalendarView.getMonth() + 1,
      1
    );
    renderAvailabilityCalendar();
  });
}

if (availabilityCalendarToday) {
  availabilityCalendarToday.addEventListener("click", () => {
    const todayValue = datePartInIstanbul(new Date());
    availabilityCalendarView = valueToDate(todayValue);
    renderAvailabilityCalendar();
    setAvailabilityDateDisplay(todayValue, true);
    setAvailabilityPickerOpen(false);
  });
}

if (availabilityCalendarDays) {
  availabilityCalendarDays.addEventListener("click", (event) => {
    const button = event.target.closest("button.date-picker__day");
    if (!button || !button.dataset.dateValue) return;
    const value = button.dataset.dateValue;
    setAvailabilityDateDisplay(value, true);
    setAvailabilityPickerOpen(false);
  });
}

document.addEventListener("click", (event) => {
  if (
    availabilityDatePicker &&
    !availabilityDatePicker.contains(event.target) &&
    availabilityDatePopover &&
    !availabilityDatePopover.hidden
  ) {
    setAvailabilityPickerOpen(false);
  }
});

document.querySelector(".js-availability-filters").addEventListener("change", (event) => {
  if (!event.target.matches("select, input")) return;
  state.availabilityVenueId = document.querySelector(".js-availability-venue").value;
  state.availabilityDate = document.querySelector(".js-availability-date").value;
  void loadDashboard().catch((error) => setMessage(error.message));
});

document.querySelector(".js-calendar-venues").addEventListener("click", (event) => {
  const button = event.target.closest("[data-calendar-venue]");
  if (button && state.calendarStatus === "ready") {
    void loadCalendar(state.calendarMonth, button.dataset.calendarVenue).catch((error) =>
      setMessage(error.message)
    );
  }
});
document.querySelectorAll("[data-calendar-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.calendarStatus !== "ready" || button.dataset.calendarView === state.calendarView)
      return;
    state.calendarView = button.dataset.calendarView;
    renderCalendar();
    syncCalendarNavigation();
  });
});
document.querySelector(".js-calendar-show-past").addEventListener("change", (event) => {
  state.calendarShowPast = event.target.checked;
  renderCalendar();
});
document.querySelectorAll("[data-month-move]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.calendarStatus !== "ready") return;
    if (state.calendarView === "week") {
      const focusDate = addDays(state.calendarFocusDate, Number(button.dataset.monthMove) * 7);
      if (!focusDate) return;
      const targetMonth = focusDate.slice(0, 7);
      if (targetMonth === state.calendarMonth) {
        state.calendarFocusDate = focusDate;
        renderCalendar();
      } else {
        void loadCalendar(targetMonth, state.calendarVenueId, focusDate).catch((error) =>
          setMessage(error.message)
        );
      }
      return;
    }
    const target = addMonths(state.calendarMonth, Number(button.dataset.monthMove));
    if (target) {
      void loadCalendar(target, state.calendarVenueId).catch((error) => setMessage(error.message));
    }
  });
});
document.querySelector("[data-month-today]").addEventListener("click", () => {
  if (state.calendarStatus !== "ready") return;
  state.calendarMonth = "";
  state.calendarFocusDate = "";
  void loadCalendar("", state.calendarVenueId, "").catch((error) => setMessage(error.message));
});

document.querySelector(".js-application-search").addEventListener("submit", (event) => {
  event.preventDefault();
  resetPagination("applications");
  void loadApplications();
});
document.querySelector(".js-application-filter").addEventListener("change", () => {
  resetPagination("applications");
  void loadApplications();
});
document.querySelector(".js-applications").addEventListener("click", handleApplicationAction);
if (appDetailContent) appDetailContent.addEventListener("click", handleApplicationAction);

async function handleApplicationAction(event) {
  const openAppButton = event.target.closest("[data-open-application]");
  const approveButton = event.target.closest("[data-approve]");
  const rejectButton = event.target.closest("[data-reject]");
  const archiveButton = event.target.closest("[data-archive-application]");
  const restoreButton = event.target.closest("[data-restore-application]");
  const deleteButton = event.target.closest("[data-delete-application]");

  if (openAppButton) {
    void openApplicationDetail(openAppButton.dataset.openApplication);
    return;
  }

  const actionButton =
    approveButton || rejectButton || archiveButton || restoreButton || deleteButton;
  const finishInFlight = beginInFlight(actionButton);
  if (!finishInFlight) return;
  let whatsappPopup = null;

  try {
    if (approveButton) {
      whatsappPopup = openBlankPopup();
      const approval = await apiRequest(
        `/admin/booking-applications/${approveButton.dataset.approve}/approve`,
        { method: "POST" }
      );
      try {
        const prepared = await prepareWhatsAppMessageTask({ id: approval.data.decisionTaskId });
        if (!prepared) throw new Error("Onay mesajı hazırlanamadı.");
        await openWhatsAppMessage(prepared.data, whatsappPopup);
        state.openedMessageTaskIds.add(approval.data.decisionTaskId);
        setMessage("Başvuru onaylandı; onay mesajı WhatsApp'ta hazırlandı.", true);
      } catch (error) {
        whatsappPopup?.close();
        setMessage(`Başvuru onaylandı ancak WhatsApp mesajı açılamadı: ${error.message}`);
      }
      if (appDetailDialog?.open) appDetailDialog.close();
    } else if (rejectButton) {
      const reason = await showCustomPrompt({
        title: "Başvuruyu Reddet",
        message: "Lütfen başvuru sahibine iletilecek red nedenini belirtin.",
        placeholder: "Örn: Seçilen tarihte ajansımız doludur...",
        confirmText: "Reddet",
        cancelText: "Vazgeç",
        isDanger: true,
        required: true
      });
      if (!reason) return;
      await apiRequest(`/admin/booking-applications/${rejectButton.dataset.reject}/reject`, {
        method: "POST",
        body: { reason }
      });
      setMessage("Başvuru reddedildi.", true);
      if (appDetailDialog?.open) appDetailDialog.close();
    } else if (archiveButton) {
      await apiRequest(
        `/admin/booking-applications/${archiveButton.dataset.archiveApplication}/archive`,
        { method: "POST" }
      );
      setMessage("Başvuru arşivlendi.", true);
      if (appDetailDialog?.open) appDetailDialog.close();
    } else if (restoreButton) {
      await apiRequest(
        `/admin/booking-applications/${restoreButton.dataset.restoreApplication}/restore`,
        { method: "POST" }
      );
      setMessage(
        "Başvuru geri yüklendi; yalnız korunmuş ve süresi dolmamış ödeme akışı devam eder.",
        true
      );
      if (appDetailDialog?.open) appDetailDialog.close();
    } else if (deleteButton) {
      deleteButton.disabled = true;
      const response = await apiRequestWithAdminStepUp(
        `/admin/booking-applications/${deleteButton.dataset.deleteApplication}`,
        {
          method: "DELETE",
          body: {}
        },
        { actionLabel: "Başvuruyu kalıcı silme" }
      );
      if (!response) {
        deleteButton.disabled = false;
        return;
      }
      setMessage("Başvuru kalıcı olarak silindi.", true);
      if (appDetailDialog?.open) appDetailDialog.close();
    } else return;
    await Promise.all([loadApplications(), loadDashboard()]);
  } catch (error) {
    whatsappPopup?.close();
    if (deleteButton) deleteButton.disabled = false;
    setMessage(error.message);
  } finally {
    finishInFlight();
  }
}

document
  .querySelectorAll(".js-message-kind-filter, .js-message-status-filter")
  .forEach((select) => {
    select.addEventListener("change", () => {
      resetPagination("messages");
      void loadMessages();
    });
  });

document.querySelectorAll("[data-pagination-prev], [data-pagination-next]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.paginationNext || button.dataset.paginationPrev;
    const direction = button.dataset.paginationNext ? "next" : "previous";
    void movePagination(key, direction);
  });
});

detailContent.addEventListener("change", (event) => {
  if (event.target.name !== "staffId") return;
  const staff = state.currentWedding.availableStaff.find((item) => item.id === event.target.value);
  const specialtySelect = detailContent.querySelector('select[name="specialty"]');
  specialtySelect.innerHTML = '<option value="">Görev seçin</option>';
  if (staff) {
    specialtySelect.insertAdjacentHTML(
      "beforeend",
      staff.specialties
        .map(
          (specialty) =>
            `<option value="${specialty}">${escapeHtml(SPECIALTIES[specialty])}</option>`
        )
        .join("")
    );
  }
});

detailContent.addEventListener("submit", async (event) => {
  if (!event.target.matches(".js-assignment-form")) return;
  event.preventDefault();
  const form = event.target;
  const finishInFlight = beginInFlight(event.submitter || form.querySelector('[type="submit"]'));
  if (!finishInFlight) return;
  const formMessage = form.closest(".detail-block")?.querySelector(".js-assignment-message");
  if (formMessage) formMessage.textContent = "";
  const data = new FormData(form);
  const body = {
    staffId: data.get("staffId"),
    specialty: data.get("specialty"),
    allowConflict: false
  };
  try {
    try {
      await apiRequest(`/admin/weddings/${state.currentWedding.id}/assignments`, {
        method: "POST",
        body
      });
    } catch (error) {
      const conflicts = error.payload?.errors?.conflicts;
      if (error.status !== 409 || !Array.isArray(conflicts) || conflicts.length === 0) {
        if (formMessage) formMessage.textContent = formErrorMessage(form, error);
        return;
      }
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${state.currentWedding.id}/assignments`,
        {
          method: "POST",
          body: { ...body, allowConflict: true }
        },
        { actionLabel: "Çakışan personel ataması" }
      );
      if (!response) return;
    }
    setMessage("Personel düğüne atandı.", true);
    await Promise.all([
      openWeddingDetail(state.currentWedding.id),
      loadDashboard(),
      loadCalendar()
    ]);
  } catch (error) {
    if (formMessage) formMessage.textContent = formErrorMessage(form, error);
  } finally {
    finishInFlight();
  }
});

function validateDeliveryRow(row) {
  const message = row.querySelector(".js-delivery-message");
  const dueDateInput = row.querySelector('[data-field="dueDate"]');
  const driveUrlInput = row.querySelector('[data-field="driveUrl"]');
  if (message) message.textContent = "";
  if (!dueDateInput.reportValidity() || !driveUrlInput.reportValidity()) {
    if (message) {
      message.textContent = "Teslim tarihi veya Google Drive/WeTransfer bağlantısını kontrol edin.";
    }
    return false;
  }
  if (driveUrlInput.value.trim()) {
    try {
      if (!isAllowedDeliveryLinkUrl(driveUrlInput.value.trim())) throw new Error("invalid");
    } catch {
      driveUrlInput.setCustomValidity(
        "HTTPS kullanan geçerli bir Google Drive veya WeTransfer bağlantısı girin."
      );
      driveUrlInput.reportValidity();
      if (message) message.textContent = driveUrlInput.validationMessage;
      return false;
    }
  }
  driveUrlInput.setCustomValidity("");
  return true;
}

detailContent.addEventListener("input", (event) => {
  if (event.target.matches('[data-field="dueDate"], [data-field="driveUrl"]')) {
    event.target.setCustomValidity("");
    event.target
      .closest("[data-delivery-row]")
      ?.querySelector(".js-delivery-message")
      ?.replaceChildren();
  }
});

detailContent.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-current]");
  const saveButton = event.target.closest("[data-save-delivery]");
  const deliverButton = event.target.closest("[data-deliver]");
  const revokeDeliveryButton = event.target.closest("[data-revoke-delivery]");
  const activateCustomerButton = event.target.closest("[data-activate-customer]");
  const resetButton = event.target.closest("[data-reset-user]");
  const removeButton = event.target.closest("[data-remove-assignment]");
  const cancelWeddingButton = event.target.closest("[data-cancel-wedding]");
  const reinstateWeddingButton = event.target.closest("[data-reinstate-wedding]");
  const archiveWeddingButton = event.target.closest("[data-archive-wedding]");
  const restoreWeddingButton = event.target.closest("[data-restore-wedding]");
  const deleteWeddingButton = event.target.closest("[data-delete-wedding]");
  const actionButton =
    editButton ||
    saveButton ||
    deliverButton ||
    revokeDeliveryButton ||
    activateCustomerButton ||
    resetButton ||
    removeButton ||
    cancelWeddingButton ||
    reinstateWeddingButton ||
    archiveWeddingButton ||
    restoreWeddingButton ||
    deleteWeddingButton;
  const finishInFlight = beginInFlight(actionButton);
  if (!finishInFlight) return;
  try {
    if (editButton) {
      await openWeddingEditor(state.currentWedding);
      return;
    }
    if (saveButton) {
      const row = saveButton.closest("[data-delivery-row]");
      if (!validateDeliveryRow(row)) return;
      const driveUrl = row.querySelector('[data-field="driveUrl"]').value.trim();
      const nextStatus = row.querySelector('[data-field="status"]').value;
      const body = {
        status: nextStatus,
        dueDate: row.querySelector('[data-field="dueDate"]').value,
        driveUrl: driveUrl || null
      };
      await apiRequest(`/admin/deliveries/${saveButton.dataset.saveDelivery}`, {
        method: "PATCH",
        body
      });
      setMessage("Teslimat bilgileri kaydedildi.", true);
    } else if (deliverButton) {
      await apiRequest(`/admin/deliveries/${deliverButton.dataset.deliver}/deliver`, {
        method: "POST",
        body: {}
      });
      setMessage("Teslimat müşteriye açıldı ve mesaj görevi oluşturuldu.", true);
    } else if (revokeDeliveryButton) {
      const response = await apiRequestWithAdminStepUp(
        `/admin/deliveries/${revokeDeliveryButton.dataset.revokeDelivery}/revoke`,
        { method: "POST", body: {} },
        { actionLabel: "Teslimat erişimini geri çekme" }
      );
      if (!response) return;
      setMessage("Teslimat erişimi geri çekildi.", true);
    } else if (activateCustomerButton) {
      const prepared = await prepareWhatsAppMessageTask(
        {
          id: activateCustomerButton.dataset.activateCustomer,
          status: activateCustomerButton.dataset.taskStatus,
          dueAt: activateCustomerButton.dataset.taskDueAt,
          earlyOverrideAt: activateCustomerButton.dataset.taskEarlyOverrideAt || null
        },
        { activateCustomerNow: true }
      );
      if (!prepared) return;
      const copied = await openWhatsAppMessageAfterVerification(prepared.data);
      state.openedMessageTaskIds.add(activateCustomerButton.dataset.activateCustomer);
      setMessage(
        `Müşteri hesabı aktifleştirildi; kullanıcı adı ve şifre bağlantısı WhatsApp'ta hazırlandı${copied ? " ve panoya kopyalandı" : ""}.`,
        true
      );
    } else if (resetButton) {
      const response = await apiRequestWithAdminStepUp(
        `/admin/customers/${resetButton.dataset.resetUser}/reset-password`,
        { method: "POST", body: {} },
        { actionLabel: "Müşteri parolasını sıfırlama" }
      );
      if (!response) return;
      setMessage("Parola sıfırlama görevi oluşturuldu; Mesajlar bölümünden hazırlayın.", true);
      await Promise.all([loadMessages(), loadDashboard()]);
    } else if (cancelWeddingButton) {
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${cancelWeddingButton.dataset.cancelWedding}/cancel`,
        { method: "POST", body: {} },
        { actionLabel: "Düğünü iptal etme" }
      );
      if (!response) return;
      setMessage("Düğün iptal edildi; müşteri ve mesaj erişimleri durduruldu.", true);
    } else if (reinstateWeddingButton) {
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${reinstateWeddingButton.dataset.reinstateWedding}/reinstate`,
        { method: "POST", body: {} },
        { actionLabel: "Düğün iptalini geri alma" }
      );
      if (!response) return;
      setMessage("Düğün iptali geri alındı; teslimat erişimi kendiliğinden açılmadı.", true);
    } else if (archiveWeddingButton) {
      await apiRequest(`/admin/weddings/${archiveWeddingButton.dataset.archiveWedding}/archive`, {
        method: "POST"
      });
      detailDialog.close();
      setMessage("Düğün arşivlendi.", true);
    } else if (restoreWeddingButton) {
      await apiRequest(`/admin/weddings/${restoreWeddingButton.dataset.restoreWedding}/restore`, {
        method: "POST"
      });
      setMessage("Düğün geri yüklendi.", true);
    } else if (deleteWeddingButton) {
      deleteWeddingButton.disabled = true;
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${deleteWeddingButton.dataset.deleteWedding}`,
        { method: "DELETE", body: {} },
        { actionLabel: "Düğünü kalıcı silme" }
      );
      if (!response) {
        deleteWeddingButton.disabled = false;
        return;
      }
      detailDialog.close();
      setMessage("Düğün kalıcı olarak silindi.", true);
    } else if (removeButton) {
      removeButton.disabled = true;
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${state.currentWedding.id}/assignments/${removeButton.dataset.removeAssignment}`,
        { method: "DELETE", body: {} },
        { actionLabel: "Personel atamasını kaldırma" }
      );
      if (!response) {
        removeButton.disabled = false;
        return;
      }
      removeButton.disabled = false;
      setMessage("Personel ataması kaldırıldı.", true);
    } else return;
    await Promise.all([
      openWeddingDetail(state.currentWedding.id),
      loadDashboard(),
      loadCalendar()
    ]);
  } catch (error) {
    if (removeButton) removeButton.disabled = false;
    if (deleteWeddingButton) deleteWeddingButton.disabled = false;
    const contextualMessage =
      saveButton || deliverButton || revokeDeliveryButton
        ? detailContent.querySelector(".js-delivery-message")
        : removeButton
          ? detailContent.querySelector(".js-assignment-message")
          : null;
    if (contextualMessage) contextualMessage.textContent = error.message;
    else setMessage(error.message);
  } finally {
    finishInFlight();
  }
});

const specialtyOptions = Object.entries(SPECIALTIES)
  .map(
    ([key, label]) =>
      `<label><input type="checkbox" name="specialties" value="${key}" /> ${escapeHtml(label)}</label>`
  )
  .join("");
document.querySelector(".js-staff-specialties").innerHTML = specialtyOptions;
document.querySelector(".js-staff-specialty-filter").insertAdjacentHTML(
  "beforeend",
  Object.entries(SPECIALTIES)
    .map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`)
    .join("")
);
document.querySelector(".js-add-staff").addEventListener("click", () => void openStaffForm());
document.querySelector(".js-staff").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-staff]");
  const toggleButton = event.target.closest("[data-toggle-staff]");
  const deleteButton = event.target.closest("[data-delete-staff]");
  if (button)
    void openStaffForm(state.staff.find((staff) => staff.id === button.dataset.editStaff));
  else if (toggleButton) {
    const finishInFlight = beginInFlight(toggleButton);
    if (!finishInFlight) return;
    void apiRequest(`/admin/staff/${toggleButton.dataset.toggleStaff}`, {
      method: "PATCH",
      body: { isActive: toggleButton.dataset.active !== "true" }
    })
      .then(() => Promise.all([loadStaff(), loadDashboard()]))
      .then(() => setMessage("Personel durumu güncellendi.", true))
      .catch((error) => setMessage(error.message))
      .finally(finishInFlight);
  } else if (deleteButton) {
    void (async () => {
      deleteButton.disabled = true;
      try {
        const response = await apiRequestWithAdminStepUp(
          `/admin/staff/${deleteButton.dataset.deleteStaff}`,
          { method: "DELETE", body: {} },
          { actionLabel: "Personel kaydını silme" }
        );
        if (!response) return;
        setMessage("Personel kalıcı olarak silindi.", true);
        await Promise.all([loadStaff(), loadDashboard()]);
      } catch (error) {
        setMessage(error.message);
      } finally {
        deleteButton.disabled = false;
      }
    })();
  }
});
[
  ".js-staff-search",
  ".js-staff-specialty-filter",
  ".js-staff-venue-filter",
  ".js-staff-active-filter"
].forEach((selector) => {
  const el = document.querySelector(selector);
  if (el) el.addEventListener(selector.includes("search") ? "input" : "change", renderStaff);
});
staffForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => staffDialog.close());
});
staffForm.querySelector(".js-staff-specialties").addEventListener("change", () => {
  staffForm.querySelector(".js-staff-specialties-error").hidden = true;
});
setupVenuePicker(staffForm);
staffForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  const submitButton = staffForm.querySelector(".js-staff-submit");
  const specialtyError = staffForm.querySelector(".js-staff-specialties-error");
  const formMessage = staffForm.querySelector(".js-staff-form-message");
  const data = new FormData(staffForm);
  const staffId = data.get("staffId");
  const body = {
    firstName: data.get("firstName"),
    lastName: data.get("lastName"),
    phone: data.get("phone"),
    specialties: data.getAll("specialties"),
    isActive: data.has("isActive"),
    venueIds: data.getAll("venueIds")
  };
  specialtyError.hidden = body.specialties.length > 0;
  if (!validateVenueSelection(staffForm)) return;
  if (!body.specialties.length) {
    staffForm.querySelector('input[name="specialties"]')?.focus();
    return;
  }
  formMessage.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Kaydediliyor…";
  try {
    await apiRequest(staffId ? `/admin/staff/${staffId}` : "/admin/staff", {
      method: staffId ? "PATCH" : "POST",
      body
    });
    staffDialog.close();
    setMessage(staffId ? "Personel güncellendi." : "Personel eklendi.", true);
    await Promise.all([loadStaff(), loadDashboard()]);
  } catch (error) {
    formMessage.textContent = formErrorMessage(staffForm, error);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Kaydet";
  }
});

document
  .querySelector(".js-add-managed-user")
  .addEventListener("click", () => void openManagedUserForm());
document.querySelector('[data-panel-content="accounts"]').addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-managed-user]");
  if (!button) return;
  const role = button.dataset.managedUserRole;
  const collection = role === "MONTAJCI" ? state.montageUsers : state.managers;
  const user = collection.find((item) => item.id === button.dataset.editManagedUser);
  if (user) void openManagedUserForm(user, role);
});
managedUserForm.elements.role.addEventListener("change", syncManagedUserRole);
setupVenuePicker(managedUserForm);
managedUserForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => managedUserDialog.close());
});
managedUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  const data = new FormData(managedUserForm);
  const managedUserId = data.get("managedUserId");
  const role = managedUserForm.dataset.role || data.get("role");
  const isMontageUser = role === "MONTAJCI";
  if (!isMontageUser && !validateVenueSelection(managedUserForm)) return;
  const body = {
    username: data.get("username"),
    status: data.has("isActive") ? "ACTIVE" : "DISABLED",
    ...(!isMontageUser ? { venueIds: selectedVenueIds(managedUserForm) } : {}),
    ...(data.get("password") ? { password: data.get("password") } : {})
  };
  const endpoint = isMontageUser ? "/admin/montage-users" : "/admin/venue-managers";
  const roleLabel = isMontageUser ? "Montajcı" : "Salon sorumlusu";
  try {
    const response = await apiRequestWithAdminStepUp(
      managedUserId ? `${endpoint}/${managedUserId}` : endpoint,
      {
        method: managedUserId ? "PATCH" : "POST",
        body
      },
      {
        actionLabel: `${roleLabel} hesabını ${managedUserId ? "değiştirme" : "oluşturma"}`
      }
    );
    if (!response) return;
    managedUserDialog.close();
    setMessage(`${roleLabel} hesabı ${managedUserId ? "güncellendi" : "eklendi"}.`, true);
    await loadManagedUsers();
  } catch (error) {
    managedUserForm.querySelector(".dialog-message").textContent = error.message;
  }
});

document.querySelector(".js-messages").addEventListener("click", async (event) => {
  const prepareButton = event.target.closest("[data-prepare-message]");
  const verifyButton = event.target.closest("[data-verify-message]");
  const sendButton = event.target.closest("[data-send-message]");
  const sentButton = event.target.closest("[data-mark-sent]");
  const failedButton = event.target.closest("[data-mark-failed]");
  const cancelButton = event.target.closest("[data-cancel-message]");
  const overrideButton = event.target.closest("[data-override-message]");
  try {
    if (prepareButton) {
      const response = await apiRequestWithAdminStepUp(
        `/admin/message-tasks/${prepareButton.dataset.prepareMessage}/render`,
        { method: "POST", body: {} },
        { actionLabel: "Hassas müşteri mesajını ve kimlik bağlantısını hazırlama" }
      );
      if (!response) return;
      setMessage("Mesaj hazırlandı; link doğrulaması bekleniyor.", true);
      await loadMessages();
    } else if (verifyButton) {
      const response = await apiRequestWithAdminStepUp(
        `/admin/message-tasks/${verifyButton.dataset.verifyMessage}/verify`,
        { method: "POST", body: {} },
        { actionLabel: "Hassas müşteri mesajı bağlantısını doğrulama" }
      );
      if (!response) return;
      setMessage("Mesaj ve bağlantı doğrulandı; gönderime hazır.", true);
      await loadMessages();
    } else if (sendButton) {
      const popup = openBlankPopup();
      try {
        const response = await apiRequestWithAdminStepUp(
          `/admin/message-tasks/${sendButton.dataset.sendMessage}/verify`,
          { method: "POST", body: { activateCustomerNow: true } },
          { actionLabel: "Hassas müşteri mesajını WhatsApp'ta gönderme" }
        );
        if (!response) {
          popup?.close();
          return;
        }
        const copied = await openWhatsAppMessage(response.data, popup);
        state.openedMessageTaskIds.add(sendButton.dataset.sendMessage);
        const markButton = document.querySelector(
          `[data-mark-sent="${sendButton.dataset.sendMessage}"]`
        );
        const failedMarkButton = document.querySelector(
          `[data-mark-failed="${sendButton.dataset.sendMessage}"]`
        );
        if (markButton) {
          markButton.dataset.taskUpdatedAt = response.data.expectedUpdatedAt;
          markButton.disabled = false;
        }
        if (failedMarkButton) {
          failedMarkButton.dataset.taskUpdatedAt = response.data.expectedUpdatedAt;
          failedMarkButton.disabled = false;
        }
        setMessage(
          copied
            ? "Mesaj panoya kopyalandı ve WhatsApp açıldı."
            : "WhatsApp açıldı. Panoya kopyalama izni verilmediği için mesajı manuel kopyalamanız gerekebilir.",
          true
        );
      } catch (error) {
        popup?.close();
        throw error;
      }
    } else if (sentButton) {
      await apiRequest(`/admin/message-tasks/${sentButton.dataset.markSent}/mark-sent`, {
        method: "POST",
        body: { expectedUpdatedAt: sentButton.dataset.taskUpdatedAt }
      });
      state.openedMessageTaskIds.delete(sentButton.dataset.markSent);
      await Promise.all([loadMessages(), loadDashboard()]);
    } else if (failedButton) {
      await apiRequest(`/admin/message-tasks/${failedButton.dataset.markFailed}/mark-failed`, {
        method: "POST",
        body: { expectedUpdatedAt: failedButton.dataset.taskUpdatedAt }
      });
      state.openedMessageTaskIds.delete(failedButton.dataset.markFailed);
      await loadMessages();
    } else if (cancelButton) {
      await apiRequest(`/admin/message-tasks/${cancelButton.dataset.cancelMessage}/cancel`, {
        method: "POST",
        body: {}
      });
      state.openedMessageTaskIds.delete(cancelButton.dataset.cancelMessage);
      await loadMessages();
    } else if (overrideButton) {
      const response = await apiRequestWithAdminStepUp(
        `/admin/message-tasks/${overrideButton.dataset.overrideMessage}/override-due`,
        { method: "POST", body: {} },
        { actionLabel: "Mesaj için erken gönderim onayı" }
      );
      if (!response) return;
      await loadMessages();
    }
  } catch (error) {
    setMessage(error.message);
  }
});

document
  .querySelector('[data-panel-content="catalog"]')
  .addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-catalog]");
    const saveButton = event.target.closest("[data-save-catalog]");
    const deleteButton = event.target.closest("[data-delete-catalog]");
    const actionButton = editButton || saveButton || deleteButton;
    if (!actionButton) return;
    if (editButton && !state.catalogFormConstraints) {
      setCatalogMessage("Katalog form koşulları yüklenemedi. Sayfayı yenileyip tekrar deneyin.");
      return;
    }
    const finishInFlight = beginInFlight(actionButton);
    if (!finishInFlight) return;

    try {
      if (editButton) {
        const row = editButton.closest("[data-catalog-row]");
        const type = row.dataset.catalogType;
        const itemId = row.dataset.catalogRow;
        const itemsList =
          type === "packages"
            ? state.packages
            : type === "services"
              ? state.services
              : state.catalogVenues;
        const currentItem = itemsList.find((i) => i.id === itemId);

        if (!currentItem) return;

        const formData =
          type === "venues"
            ? await showVenueFormModal({
                title: "Mekân Bilgilerini Düzenle",
                initialData: currentItem,
                constraints: state.catalogFormConstraints
              })
            : await showCatalogFormModal({
                type,
                title:
                  type === "packages"
                    ? "Paket Bilgilerini Düzenle"
                    : "Ek Hizmet Bilgilerini Düzenle",
                initialData: currentItem,
                constraints: state.catalogFormConstraints
              });

        if (!formData) return;

        const body =
          type === "venues"
            ? {
                name: formData.name,
                displayName: formData.displayName,
                imagePath: formData.imagePath,
                displayOrder: formData.displayOrder,
                isFeatured: formData.isFeatured,
                isPartner: formData.isPartner,
                isActive: formData.isActive
              }
            : {
                name: formData.name,
                priceCents: formData.priceCents,
                imagePath: formData.imagePath,
                description: formData.description,
                features: formData.features,
                isActive: formData.isActive
              };
        if (type === "packages") {
          body.subtitle = formData.subtitle;
          body.deliveryText = formData.deliveryText;
        } else if (type === "services") {
          body.category = formData.category;
          body.eyebrow = formData.eyebrow;
          body.delivery = formData.delivery;
          body.gallery = formData.gallery;
        }

        try {
          await apiRequest(`/admin/${type}/${itemId}`, {
            method: "PATCH",
            body
          });
          await loadCatalogAdmin();
          setCatalogMessage("Katalog kaydı başarıyla güncellendi.", true);
        } catch (error) {
          setCatalogMessage(error.message);
        }
      } else if (saveButton) {
        const row = saveButton.closest("[data-catalog-row]");
        try {
          await apiRequest(`/admin/${row.dataset.catalogType}/${row.dataset.catalogRow}`, {
            method: "PATCH",
            body: {
              name: row.querySelector('input[type="text"]')?.value.trim(),
              priceCents: Math.round(
                Number(row.querySelector('input[type="number"]')?.value || 0) * 100
              ),
              isActive: row.querySelector('input[type="checkbox"]')?.checked ?? true
            }
          });
          await loadCatalogAdmin();
          setCatalogMessage("Katalog güncellendi.", true);
        } catch (error) {
          setCatalogMessage(error.message);
        }
      } else if (deleteButton) {
        const row = deleteButton.closest("[data-catalog-row]");
        const typeLabel =
          row.dataset.catalogType === "packages"
            ? "Temel paketi"
            : row.dataset.catalogType === "services"
              ? "Ek hizmeti"
              : "Mekânı";
        const isVenue = row.dataset.catalogType === "venues";
        try {
          const response = await apiRequestWithAdminStepUp(
            `/admin/${row.dataset.catalogType}/${row.dataset.catalogRow}`,
            { method: "DELETE", body: {} },
            { actionLabel: `${typeLabel} ${isVenue ? "kaldırma" : "silme"}` }
          );
          if (!response) return;
          await loadCatalogAdmin();
          setCatalogMessage(`${typeLabel} silindi.`, true);
        } catch (error) {
          setCatalogMessage(error.message);
        }
      }
    } finally {
      finishInFlight();
    }
  });

document.querySelectorAll("[data-add-catalog]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!state.catalogFormConstraints) {
      setCatalogMessage("Katalog form koşulları yüklenemedi. Sayfayı yenileyip tekrar deneyin.");
      return;
    }
    const finishInFlight = beginInFlight(button);
    if (!finishInFlight) return;
    try {
      const type = button.dataset.addCatalog;
      const formData =
        type === "venues"
          ? await showVenueFormModal({
              title: "Yeni Mekân Oluştur",
              constraints: state.catalogFormConstraints
            })
          : await showCatalogFormModal({
              type,
              title: type === "packages" ? "Yeni Paket Oluştur" : "Yeni Ek Hizmet Oluştur",
              constraints: state.catalogFormConstraints
            });
      if (!formData) return;

      if (type === "venues") {
        try {
          await apiRequest("/admin/venues", { method: "POST", body: formData });
          await loadCatalogAdmin();
          setCatalogMessage("Yeni mekân oluşturuldu.", true);
        } catch (error) {
          setCatalogMessage(error.message);
        }
        return;
      }

      const {
        code,
        name,
        priceCents,
        category,
        eyebrow,
        subtitle,
        deliveryText,
        delivery,
        imagePath,
        description,
        features,
        gallery,
        isActive
      } = formData;
      const body =
        type === "packages"
          ? {
              code,
              name,
              priceCents,
              subtitle,
              deliveryText,
              imagePath,
              description,
              features,
              isActive
            }
          : {
              code,
              name,
              category,
              eyebrow,
              priceCents,
              delivery,
              imagePath,
              description,
              features,
              gallery,
              isActive
            };

      try {
        await apiRequest(`/admin/${type}`, { method: "POST", body });
        await loadCatalogAdmin();
        setCatalogMessage("Yeni katalog kaydı oluşturuldu.", true);
      } catch (error) {
        setCatalogMessage(error.message);
      }
    } finally {
      finishInFlight();
    }
  });
});

async function loadManualOptions() {
  const [venues, catalog] = await Promise.all([apiRequest("/venues"), apiRequest("/catalog")]);
  state.venues = venues.data;
  state.packages = catalog.data.packages;
  state.services = catalog.data.services;
  document.querySelector(".js-manual-venue").innerHTML = state.venues
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join("");
  document.querySelector(".js-manual-package").innerHTML = state.packages
    .map((item) => `<option value="${item.code}">${escapeHtml(item.name)}</option>`)
    .join("");
  document.querySelector(".js-manual-services").innerHTML = state.services
    .map(
      (item) =>
        `<label><input type="checkbox" name="serviceCodes" value="${item.code}" /> ${escapeHtml(item.name)}</label>`
    )
    .join("");
}

document.querySelector(".js-open-manual").addEventListener("click", async (event) => {
  const finishInFlight = beginInFlight(event.currentTarget);
  if (!finishInFlight) return;
  try {
    await loadManualOptions();
    syncScheduleFields(manualForm);
    openManagedDialog(manualDialog, event.currentTarget);
  } catch (error) {
    setMessage(error.message);
  } finally {
    finishInFlight();
  }
});
manualForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => manualDialog.close());
});
manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  if (!manualForm.reportValidity()) return;
  const finishInFlight = beginInFlight(
    event.submitter || manualForm.querySelector('[type="submit"]')
  );
  if (!finishInFlight) return;
  const data = new FormData(manualForm);
  try {
    await apiRequest("/admin/booking-applications", {
      method: "POST",
      body: {
        brideFirstName: data.get("brideFirstName"),
        brideLastName: data.get("brideLastName"),
        bridePhone: data.get("bridePhone"),
        groomFirstName: data.get("groomFirstName"),
        groomLastName: data.get("groomLastName"),
        groomPhone: data.get("groomPhone"),
        primaryContact: data.get("primaryContact"),
        primaryEmail: data.get("primaryEmail"),
        weddingDate: data.get("weddingDate"),
        startTime: data.get("startTime"),
        endTime: data.get("endTime"),
        endsNextDay: false,
        venueId: data.get("venueId"),
        packageCode: data.get("packageCode"),
        serviceCodes: data.getAll("serviceCodes"),
        paymentMethod: data.get("paymentMethod"),
        note: data.get("note") || undefined,
        privacyConsent: false,
        marketingConsent: false
      }
    });
    manualDialog.close();
    manualForm.reset();
    setMessage("Başvuru oluşturuldu ve onay kuyruğuna eklendi.", true);
    await Promise.all([loadApplications(), loadDashboard()]);
  } catch (error) {
    manualForm.querySelector(".dialog-message").textContent = formErrorMessage(manualForm, error);
  } finally {
    finishInFlight();
  }
});

async function openWeddingEditor(wedding) {
  const [, catalog] = await Promise.all([ensureVenues(), apiRequest("/catalog")]);
  state.packages = catalog.data.packages;
  state.services = catalog.data.services;
  weddingForm.querySelector(".js-wedding-venue").innerHTML = state.venues
    .map(
      (venue) =>
        `<option value="${venue.id}" ${venue.id === wedding.venueId ? "selected" : ""}>${escapeHtml(venue.name)}</option>`
    )
    .join("");
  const currentPackage = wedding.packageSummary || {};
  const currentServices = Array.isArray(currentPackage.services) ? currentPackage.services : [];
  const packageOptions = [...state.packages];
  if (currentPackage.code && !packageOptions.some((item) => item.code === currentPackage.code)) {
    packageOptions.push({ code: currentPackage.code, name: currentPackage.name, isActive: false });
  }
  weddingForm.querySelector(".js-wedding-package").innerHTML = packageOptions
    .map(
      (item) =>
        `<option value="${escapeHtml(item.code)}" ${item.code === currentPackage.code ? "selected" : ""}>${escapeHtml(item.name)}${item.isActive === false ? " (pasif)" : ""}</option>`
    )
    .join("");
  const serviceOptions = [...state.services];
  currentServices.forEach((current) => {
    if (!serviceOptions.some((item) => item.code === current.code)) {
      serviceOptions.push({ ...current, isActive: false });
    }
  });
  const selectedServiceCodes = new Set(currentServices.map((service) => service.code));
  weddingForm.querySelector(".js-wedding-services").innerHTML = serviceOptions
    .map(
      (item) =>
        `<label><input type="checkbox" name="serviceCodes" value="${escapeHtml(item.code)}" ${selectedServiceCodes.has(item.code) ? "checked" : ""} /> ${escapeHtml(item.name)}${item.isActive === false ? " (pasif)" : ""}</label>`
    )
    .join("");
  const values = {
    weddingId: wedding.id,
    brideFirstName: wedding.brideFirstName,
    brideLastName: wedding.brideLastName,
    bridePhone: wedding.bridePhone,
    groomFirstName: wedding.groomFirstName,
    groomLastName: wedding.groomLastName,
    groomPhone: wedding.groomPhone,
    primaryContact: wedding.primaryContact,
    primaryEmail: wedding.primaryEmail,
    weddingDate: datePartInIstanbul(wedding.startsAt),
    startTime: timePartInIstanbul(wedding.startsAt),
    endTime: timePartInIstanbul(wedding.endsAt),
    venueId: wedding.venueId,
    paymentTotal: centsToMoneyInput(
      wedding.paymentTotalCents ?? currentPackage.totalPriceCents ?? 0
    ),
    paymentDeposit: centsToMoneyInput(wedding.paymentDepositCents),
    paymentReceived: centsToMoneyInput(wedding.paymentReceivedCents),
    note: wedding.note || ""
  };
  Object.entries(values).forEach(([name, value]) => {
    weddingForm.elements.namedItem(name).value = value;
  });
  weddingForm.querySelector(".dialog-message").textContent = "";
  weddingForm.dataset.originalPackageCode = currentPackage.code || "";
  weddingForm.dataset.originalWeddingDate = values.weddingDate;
  weddingForm.dataset.originalPackageName = currentPackage.name || "Paket bilgisi yok";
  weddingForm.dataset.originalServices = JSON.stringify(
    currentServices.map(({ code, name }) => ({ code, name }))
  );
  weddingForm.dataset.generatedNote = "";
  syncWeddingPaymentFields();
  syncScheduleFields(weddingForm);
  openManagedDialog(weddingDialog);
}

function syncWeddingPaymentFields() {
  const total = Number(weddingForm.elements.paymentTotal.value || 0);
  const deposit = weddingForm.elements.paymentDeposit;
  const received = weddingForm.elements.paymentReceived;
  deposit.setCustomValidity(
    Number(deposit.value || 0) > total ? "Kapora toplam tutarı aşamaz." : ""
  );
  received.setCustomValidity(
    Number(received.value || 0) > total ? "Alınan para toplam tutarı aşamaz." : ""
  );
  weddingForm.elements.paymentRemaining.value = Math.max(
    total - Number(received.value || 0),
    0
  ).toFixed(2);
}

function updateWeddingChangeNote() {
  const note = weddingForm.elements.note;
  const previousGenerated = weddingForm.dataset.generatedNote || "";
  const suffix = previousGenerated ? `\n${previousGenerated}` : "";
  const manualNote =
    suffix && note.value.endsWith(suffix) ? note.value.slice(0, -suffix.length) : note.value;
  const originalPackageCode = weddingForm.dataset.originalPackageCode || "";
  const originalPackageName = weddingForm.dataset.originalPackageName || "Paket bilgisi yok";
  const selectedPackage = state.packages.find(
    (item) => item.code === weddingForm.elements.packageCode.value
  );
  const originalServices = JSON.parse(weddingForm.dataset.originalServices || "[]");
  const originalByCode = new Map(originalServices.map((service) => [service.code, service.name]));
  const selectedCodes = new Set(new FormData(weddingForm).getAll("serviceCodes"));
  const selectedByCode = new Map(state.services.map((service) => [service.code, service.name]));
  const changes = [];
  if (selectedPackage && selectedPackage.code !== originalPackageCode) {
    changes.push(`Paket değiştirildi: ${originalPackageName} → ${selectedPackage.name}.`);
  }
  originalByCode.forEach((name, code) => {
    if (!selectedCodes.has(code)) changes.push(`Ek hizmet çıkarıldı: ${name}.`);
  });
  selectedCodes.forEach((code) => {
    if (!originalByCode.has(code)) {
      changes.push(`Ek hizmet eklendi: ${selectedByCode.get(code) || code}.`);
    }
  });
  const generated = changes.join("\n");
  note.value = [manualNote.trimEnd(), generated].filter(Boolean).join("\n");
  weddingForm.dataset.generatedNote = generated;
}

weddingForm.addEventListener("change", (event) => {
  if (event.target.name === "packageCode" || event.target.name === "serviceCodes") {
    updateWeddingChangeNote();
  }
});

weddingForm.addEventListener("input", (event) => {
  if (["paymentTotal", "paymentDeposit", "paymentReceived"].includes(event.target.name)) {
    syncWeddingPaymentFields();
  }
});

weddingForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => weddingDialog.close());
});
weddingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  if (!weddingForm.reportValidity()) return;
  const finishInFlight = beginInFlight(
    event.submitter || weddingForm.querySelector('[type="submit"]')
  );
  if (!finishInFlight) return;
  const data = new FormData(weddingForm);
  const weddingId = data.get("weddingId");
  try {
    const response = await apiRequestWithAdminStepUp(
      `/admin/weddings/${weddingId}`,
      {
        method: "PATCH",
        body: {
          brideFirstName: data.get("brideFirstName"),
          brideLastName: data.get("brideLastName"),
          bridePhone: data.get("bridePhone"),
          groomFirstName: data.get("groomFirstName"),
          groomLastName: data.get("groomLastName"),
          groomPhone: data.get("groomPhone"),
          primaryContact: data.get("primaryContact"),
          primaryEmail: data.get("primaryEmail"),
          weddingDate: data.get("weddingDate"),
          startTime: data.get("startTime"),
          endTime: data.get("endTime"),
          endsNextDay: false,
          venueId: data.get("venueId"),
          packageCode: data.get("packageCode"),
          serviceCodes: data.getAll("serviceCodes"),
          paymentTotalCents: moneyInputToCents(data.get("paymentTotal")),
          paymentDepositCents: moneyInputToCents(data.get("paymentDeposit")),
          paymentReceivedCents: moneyInputToCents(data.get("paymentReceived")),
          note: data.get("note") || undefined
        }
      },
      { actionLabel: "Düğün ve müşteri kimlik bilgilerini güncelleme" }
    );
    if (!response) return;
    weddingDialog.close();
    setMessage(
      response.data.credentialsRegenerated
        ? `Düğün güncellendi. Yeni kullanıcı adı: ${response.data.username}.`
        : "Düğün bilgileri güncellendi.",
      true
    );
    await Promise.all([openWeddingDetail(weddingId), loadCalendar(), loadDashboard()]);
  } catch (error) {
    weddingForm.querySelector(".dialog-message").textContent = formErrorMessage(weddingForm, error);
  } finally {
    finishInFlight();
  }
});

document
  .querySelectorAll(".js-logout")
  .forEach((button) =>
    button.addEventListener(
      "click",
      () =>
        void logoutUser({ redirectTo: "login.html", replace: true, messageElement: globalMessage })
    )
  );

document.querySelector(".js-current-date").textContent = `${new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  dateStyle: "long"
}).format(new Date())} · ${OPERATIONS_CITY}`;

[manualForm, weddingForm].forEach((form) => {
  form.elements
    .namedItem("weddingDate")
    ?.addEventListener("change", () => syncScheduleFields(form));
});

if (await ensureAdmin()) {
  initTrustedDevices();
  await Promise.all([
    loadDashboard().catch((error) => setMessage(error.message)),
    loadHealth(),
    apiRequest("/admin/catalog-form-constraints")
      .then((response) => {
        state.catalogFormConstraints = response.data;
        setCatalogMessage("");
      })
      .catch((error) => {
        state.catalogFormConstraints = null;
        setCatalogMessage(`Katalog formları kapalı: ${error.message}`);
      })
      .finally(syncDependencyControls),
    apiRequest("/catalog")
      .then((response) => {
        const constraints = parseBookingFormConstraints(response.data?.bookingFormConstraints);
        state.bookingSchedulePolicy = parseBookingSchedulePolicy(
          response.data?.bookingSchedulePolicy
        );
        applyBookingFormConstraints(document, constraints);
        state.bookingFormConstraintsReady = true;
        syncScheduleFields(manualForm);
        syncScheduleFields(weddingForm);
      })
      .catch((error) => {
        state.bookingFormConstraintsReady = false;
        state.bookingSchedulePolicy = null;
        setMessage(`Yeni düğün formu kapalı: ${error.message}`);
      })
      .finally(syncDependencyControls)
  ]);
}

/* UX & Klavye Kısayolları */
const toggleSidebarBtn = document.querySelector(".js-toggle-sidebar");
const closeSidebarBtn = document.querySelector(".js-close-sidebar");
const sidebar = document.querySelector(".admin-sidebar");
const sidebarOverlay = document.querySelector(".js-sidebar-overlay");
const adminMain = document.querySelector(".admin-main");

function closeAdminSidebar({ restoreFocus = true } = {}) {
  const wasOpen = sidebar?.classList.contains("is-open");
  sidebar?.classList.remove("is-open");
  sidebarOverlay?.classList.remove("is-open");
  sidebarOverlay?.setAttribute("aria-hidden", "true");
  toggleSidebarBtn?.setAttribute("aria-expanded", "false");
  if (adminMain) adminMain.inert = false;
  document.body.classList.remove("sidebar-open");
  if (wasOpen && restoreFocus) toggleSidebarBtn?.focus();
}

function openAdminSidebar() {
  sidebar?.classList.add("is-open");
  sidebarOverlay?.classList.add("is-open");
  sidebarOverlay?.setAttribute("aria-hidden", "false");
  toggleSidebarBtn?.setAttribute("aria-expanded", "true");
  if (adminMain) adminMain.inert = true;
  document.body.classList.add("sidebar-open");
  closeSidebarBtn?.focus();
}

if (toggleSidebarBtn && sidebar) {
  toggleSidebarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (sidebar.classList.contains("is-open")) {
      closeAdminSidebar();
    } else {
      openAdminSidebar();
    }
  });
  closeSidebarBtn?.addEventListener("click", () => closeAdminSidebar());
  sidebarOverlay?.addEventListener("click", () => closeAdminSidebar());
  sidebar.querySelectorAll("button, a").forEach((btn) => {
    if (btn !== closeSidebarBtn)
      btn.addEventListener("click", () => closeAdminSidebar({ restoreFocus: false }));
  });
  document.addEventListener("click", (e) => {
    if (
      sidebar.classList.contains("is-open") &&
      !sidebar.contains(e.target) &&
      !toggleSidebarBtn.contains(e.target)
    ) {
      closeAdminSidebar();
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sidebar?.classList.contains("is-open")) {
    e.preventDefault();
    closeAdminSidebar();
  }
});

function updateNavBadges(metrics) {
  if (!metrics) return;
  const appBadge = document.querySelector(".js-badge-applications");
  if (appBadge) {
    if (metrics.pendingBookings > 0) {
      appBadge.textContent = metrics.pendingBookings;
      appBadge.hidden = false;
    } else {
      appBadge.hidden = true;
    }
  }
  const msgBadge = document.querySelector(".js-badge-messages");
  if (msgBadge) {
    if (metrics.pendingMessages > 0) {
      msgBadge.textContent = metrics.pendingMessages;
      msgBadge.hidden = false;
    } else {
      msgBadge.hidden = true;
    }
  }
}
