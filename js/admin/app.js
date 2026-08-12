import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { initTrustedDevices } from "../shared/trusted-devices.js";
import {
  showAdminStepUpDialog,
  showCustomConfirm,
  showCustomPrompt,
  showCatalogFormModal,
  showVenueFormModal
} from "../shared/custom-dialogs.js";
import {
  applyBookingFormConstraints,
  parseBookingFormConstraints
} from "../shared/booking-form-constraints.js";
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
  weekStart: "",
  availabilityDate: "",
  availabilityVenueId: "",
  calendar: null,
  calendarMonth: "",
  calendarVenueId: "",
  weddings: [],
  staff: [],
  managers: [],
  venues: [],
  catalogVenues: [],
  packages: [],
  services: [],
  catalogFormConstraints: null,
  currentWedding: null,
  openedMessageTaskIds: new Set(),
  pagination: {
    applications: createPaginationState(),
    weddings: createPaginationState(),
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
const appDetailDialog = document.querySelector(".js-application-detail-dialog");
const appDetailTitle = document.querySelector(".js-app-detail-title");
const appDetailContent = document.querySelector(".js-app-detail-content");
const staffDialog = document.querySelector(".js-staff-dialog");
const staffForm = document.querySelector(".js-staff-form");
const managerDialog = document.querySelector(".js-manager-dialog");
const managerForm = document.querySelector(".js-manager-form");
const manualDialog = document.querySelector(".js-manual-dialog");
const manualForm = document.querySelector(".js-manual-form");
const weddingDialog = document.querySelector(".js-wedding-dialog");
const weddingForm = document.querySelector(".js-wedding-form");
const dangerDialog = document.querySelector(".js-danger-dialog");
const dangerForm = document.querySelector(".js-danger-form");
let dangerTrigger = null;

dangerForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => dangerDialog.close());
});

function requestDangerConfirmation(
  { title, copy, confirmation = "", button = "Kalıcı sil", reasonRequired = false },
  trigger
) {
  dangerTrigger = trigger;
  dangerForm.querySelector("h2").textContent = title;
  dangerForm.querySelector(".js-danger-copy").textContent = copy;
  dangerForm.querySelector(".js-danger-confirm-wrap").hidden = !confirmation;
  dangerForm.querySelector(".js-danger-confirm-label").textContent = confirmation;
  const input = dangerForm.querySelector(".js-danger-confirm");
  input.value = "";
  input.required = Boolean(confirmation);
  const reasonWrap = dangerForm.querySelector(".js-danger-reason-wrap");
  const reasonInput = dangerForm.querySelector(".js-danger-reason");
  reasonWrap.hidden = !reasonRequired;
  reasonInput.value = "";
  reasonInput.required = reasonRequired;
  dangerForm.querySelector(".js-danger-message").textContent = "";
  dangerForm.querySelector(".js-danger-submit").textContent = button;
  dangerDialog.showModal();
  setTimeout(
    () =>
      (confirmation
        ? input
        : reasonRequired
          ? reasonInput
          : dangerForm.querySelector(".js-danger-submit")
      ).focus(),
    0
  );
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      dangerDialog.removeEventListener("close", closed);
      dangerForm.onsubmit = null;
      input.value = "";
      reasonInput.value = "";
      if (dangerDialog.open) dangerDialog.close();
      resolve(result);
      dangerTrigger?.focus();
      dangerTrigger = null;
    };
    const closed = () => done(null);
    dangerDialog.addEventListener("close", closed, { once: true });
    dangerForm.onsubmit = (event) => {
      event.preventDefault();
      const confirmText = input.value.trim();
      const reason = reasonInput.value.trim();
      if (confirmation && confirmText !== confirmation) {
        dangerForm.querySelector(".js-danger-message").textContent =
          "Onay metni gösterilen değerle tam olarak eşleşmelidir.";
        input.focus();
        return;
      }
      if (reasonRequired && reason.length < 10) {
        dangerForm.querySelector(".js-danger-message").textContent =
          "İşlem gerekçesi en az 10 karakter olmalıdır.";
        reasonInput.focus();
        return;
      }
      done(reasonRequired ? { confirmText, reason } : confirmation ? confirmText : true);
    };
  });
}

const isAdminStepUpRequired = (error) =>
  error?.status === 428 && error?.payload?.details?.code === "ADMIN_STEP_UP_REQUIRED";

const requestAdminStepUp = (actionLabel) =>
  showAdminStepUpDialog({
    message: `${actionLabel} için güncel yönetici parolanız ve doğrulama uygulamanızdaki kod gereklidir.`,
    onVerify: ({ currentPassword, totpCode, signal }) =>
      apiRequest("/auth/admin-step-up", {
        method: "POST",
        signal,
        body: { currentPassword, totpCode }
      })
  });

async function apiRequestWithAdminStepUp(path, options, { actionLabel = "Bu işlem" } = {}) {
  try {
    return await apiRequest(path, options);
  } catch (error) {
    if (!isAdminStepUpRequired(error)) throw error;
  }

  const verified = await requestAdminStepUp(actionLabel);
  if (!verified) return null;
  return apiRequest(path, options);
}

async function requestRequiredReason(options) {
  const value = await showCustomPrompt({ ...options, required: true });
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const reason = String(value).trim();
  if (reason.length < 10) {
    setMessage("İşlem gerekçesi en az 10 karakter olmalıdır.");
    return null;
  }
  return reason;
}

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

const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const addMonths = (month, amount) => {
  const value = new Date(`${month}-01T12:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return value.toISOString().slice(0, 7);
};

const setMessage = (message, success = false) => {
  globalMessage.textContent = message;
  globalMessage.style.color = success ? "var(--success)" : "";
};

const formErrorMessage = (form, error) => {
  const detail = error?.payload?.errors?.find(({ field }) => field.startsWith("body."));
  if (!detail) return error.message;

  const fieldName = detail.field.slice("body.".length);
  const field = form.elements.namedItem(fieldName);
  if (field instanceof HTMLElement) field.focus();

  const label =
    field instanceof HTMLElement
      ? field.closest("label")?.childNodes[0]?.textContent?.trim()
      : "Alan";
  return `${label || "Alan"}: ${detail.message}`;
};

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

const safeWhatsAppUrl = (value) => {
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
    url.search ||
    url.hash ||
    !/^\/\d{8,15}$/.test(url.pathname)
  ) {
    throw new Error("Güvenli bir WhatsApp yönlendirmesi alınamadı.");
  }
  return url.href;
};

async function copyMessageToClipboard(value) {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) throw new Error("Kopyalanacak mesaj içeriği alınamadı.");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(message);
      return;
    } catch {
      // Güvenli context veya izin yoksa aşağıdaki yerel kopyalama yöntemini dene.
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
    if (!copied) throw new Error("copy-failed");
  } catch {
    throw new Error("Mesaj panoya kopyalanamadı; hiçbir parola bağlantıya eklenmedi.");
  }
}

async function openWhatsAppMessage(data, popup) {
  const whatsappUrl = safeWhatsAppUrl(data?.whatsappUrl);
  await copyMessageToClipboard(data?.message);
  if (!popup) {
    throw new Error(
      "Mesaj panoya kopyalandı ancak WhatsApp penceresi engellendi. Açılır pencerelere izin verip tekrar deneyin."
    );
  }
  popup.location.href = whatsappUrl;
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
  Object.entries(data.metrics).forEach(([key, value]) => {
    const element = document.querySelector(`[data-metric="${key}"]`);
    if (element) element.textContent = value;
  });
  updateNavBadges(data.metrics);
  const todayElem = document.querySelector(".js-today-weddings");
  if (todayElem) {
    todayElem.innerHTML = data.todayWeddings.length
      ? data.todayWeddings.map(eventCard).join("")
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
  document.querySelector(".js-availability-date").value = data.availabilityDate;
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
  document.querySelector(".js-upcoming-deliveries").innerHTML = data.upcomingDeliveries.length
    ? data.upcomingDeliveries
        .map(
          (delivery) =>
            `<button class="delivery-card text-button" type="button" data-open-wedding="${escapeHtml(delivery.wedding.id)}"><strong>${escapeHtml(delivery.wedding.brideFirstName)} &amp; ${escapeHtml(delivery.wedding.groomFirstName)}</strong><span>${formatDate(delivery.dueDate)} · ${escapeHtml(STATUS_LABELS[delivery.status])}</span></button>`
        )
        .join("")
    : empty("Yaklaşan teslimat yok.");
  renderWeek();
}

function renderWeek() {
  const data = state.dashboard;
  const startLabel = formatDate(`${data.weekStart}T00:00:00.000Z`);
  const endLabel = formatDate(`${data.weekEnd}T00:00:00.000Z`);
  document.querySelector(".js-week-label").textContent = `${startLabel} — ${endLabel}`;
  document.querySelector(".js-week-days").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(data.weekStart, index);
    const weddings = data.weekWeddings.filter(
      (wedding) => datePartInIstanbul(wedding.startsAt) === date
    );
    const dateValue = new Date(`${date}T12:00:00.000Z`);
    const weekday = new Intl.DateTimeFormat(APP_LOCALE, {
      weekday: "short",
      timeZone: "UTC"
    }).format(dateValue);
    const day = new Intl.DateTimeFormat(APP_LOCALE, {
      day: "numeric",
      month: "short",
      timeZone: "UTC"
    }).format(dateValue);
    return `<section class="day-column ${date === data.today ? "is-today" : ""}"><div class="day-head"><strong>${escapeHtml(day)}</strong><span>${escapeHtml(weekday)}</span></div><div class="day-events">${
      weddings.length
        ? weddings
            .map(
              (wedding) =>
                `<button class="day-event text-button ${wedding.assignments.length ? "" : "is-unassigned"}" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><strong>${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}</strong><small>${escapeHtml(wedding.venue.name)} · ${wedding.assignments.length} kişi</small></button>`
            )
            .join("")
        : '<p class="empty-state">Plan yok</p>'
    }</div></section>`;
  }).join("");
}

async function loadDashboard(weekStart = state.weekStart) {
  const query = new window.URLSearchParams();
  if (weekStart) query.set("weekStart", weekStart);
  if (state.availabilityDate) query.set("availabilityDate", state.availabilityDate);
  if (state.availabilityVenueId) query.set("venueId", state.availabilityVenueId);
  const response = await apiRequest(`/admin/dashboard${query.size ? `?${query}` : ""}`);
  state.dashboard = response.data;
  state.weekStart = response.data.weekStart;
  state.availabilityDate = response.data.availabilityDate;
  renderDashboard();
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

function renderCalendar() {
  const data = state.calendar;
  const venueContainer = document.querySelector(".js-calendar-venues");
  venueContainer.innerHTML = data.venues.length
    ? data.venues
        .map(
          (venue) =>
            `<button class="${venue.isActive ? "" : "is-passive"}" type="button" role="tab" aria-selected="${venue.id === data.selectedVenue?.id}" data-calendar-venue="${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</button>`
        )
        .join("")
    : empty("Kayıtlı salon bulunmuyor.");

  const monthDate = new Date(`${data.month}-01T12:00:00.000Z`);
  document.querySelector(".js-calendar-label").textContent = `${new Intl.DateTimeFormat(
    APP_LOCALE,
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }
  ).format(monthDate)} · ${data.selectedVenue?.name || "Salon yok"}`;

  const year = monthDate.getUTCFullYear();
  const monthIndex = monthDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const leadingDays = (monthDate.getUTCDay() + 6) % 7;
  const cellCount = leadingDays + daysInMonth <= 35 ? 35 : 42;
  const gridStart = addDays(`${data.month}-01`, -leadingDays);
  const byDate = calendarEventsByDate(data.weddings);
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const date = addDays(gridStart, index);
    const dateValue = new Date(`${date}T12:00:00.000Z`);
    const events = byDate.get(date) || [];
    const outside = date.slice(0, 7) !== data.month;
    const weekday = new Intl.DateTimeFormat(APP_LOCALE, {
      weekday: "short",
      timeZone: "UTC"
    }).format(dateValue);
    return `<section class="calendar-day ${outside ? "is-outside" : ""} ${events.length ? "" : "is-empty"} ${date === data.today ? "is-today" : ""}" aria-label="${escapeHtml(formatDate(`${date}T00:00:00.000Z`))}"><div class="calendar-day__head"><span class="calendar-day__number">${dateValue.getUTCDate()}</span><span class="calendar-day__weekday">${escapeHtml(weekday)}</span></div><div class="calendar-events">${events
      .map(
        (wedding) =>
          `<button class="calendar-event ${wedding.assignments.length ? "" : "is-unassigned"}" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><strong>${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}</strong><small>${wedding.assignments.length ? `${wedding.assignments.length} kişilik ekip` : "Ekip atanmadı"}</small></button>`
      )
      .join("")}</div></section>`;
  }).join("");
  document.querySelector(".js-month-calendar").innerHTML = `${cells}${
    data.weddings.length
      ? ""
      : '<p class="calendar-mobile-empty empty-state">Bu salonda seçilen ay için düğün yok.</p>'
  }`;
}

async function loadCalendar(month = state.calendarMonth, venueId = state.calendarVenueId) {
  const query = new window.URLSearchParams();
  if (month) query.set("month", month);
  if (venueId) query.set("venueId", venueId);
  const response = await apiRequest(`/admin/calendar${query.size ? `?${query}` : ""}`);
  state.calendar = response.data;
  state.calendarMonth = response.data.month;
  state.calendarVenueId = response.data.selectedVenue?.id || "";
  renderCalendar();
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
    container.innerHTML = applications.length
      ? applications.map((item) => renderApplicationCard(item)).join("")
      : empty("Bu durumda başvuru yok.");
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

function hasActivePaymentFlow(item) {
  if (item.source !== "PUBLIC_FORM" || item.status !== "ONAY_BEKLIYOR") return true;
  const expiresAt = new Date(item.paymentFlowExpiresAt).valueOf();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
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
  const paymentFlowIsActive = hasActivePaymentFlow(item);
  const canApprove =
    item.source === "ADMIN" || (Boolean(item.whatsappHandoffAt) && paymentFlowIsActive);
  const paymentStage =
    item.paymentFlowExpiredAt || !paymentFlowIsActive
      ? "Bildirim süresi doldu"
      : item.source === "ADMIN"
        ? "Yönetici başvurusu"
        : item.whatsappHandoffAt
          ? `Dekont kontrolü bekleniyor — son süre ${formatDate(item.paymentFlowExpiresAt, true)}`
          : "WhatsApp geçişi bekleniyor";

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
            ? `<button class="mini-button" type="button" data-restore-application="${item.id}">Geri Yükle</button><button class="mini-button mini-button--danger" type="button" data-delete-application="${item.id}" data-confirm="${escapeHtml(item.referenceCode)}">Kalıcı Sil</button>`
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
  if (!appDetailDialog.open) appDetailDialog.showModal();
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
  const paymentFlowIsActive = hasActivePaymentFlow(item);
  const canApprove =
    item.source === "ADMIN" || (Boolean(item.whatsappHandoffAt) && paymentFlowIsActive);
  const paymentStage =
    item.paymentFlowExpiredAt || !paymentFlowIsActive
      ? `Bildirim süresi doldu (${formatDate(item.paymentFlowExpiredAt || item.paymentFlowExpiresAt, true)})`
      : item.source === "ADMIN"
        ? "Yönetici başvurusu"
        : item.whatsappHandoffAt
          ? `Dekont kontrolü bekleniyor (${formatDate(item.whatsappHandoffAt, true)}) — son süre ${formatDate(item.paymentFlowExpiresAt, true)}`
          : `WhatsApp geçişi bekleniyor${item.paymentFlowExpiresAt ? ` — son süre ${formatDate(item.paymentFlowExpiresAt, true)}` : ""}`;

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
          <span>${escapeHtml(s.serviceNameSnapshot)}</span>
          <strong>${formatMoney(s.priceCentsSnapshot)}</strong>
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
            ? `<button class="mini-button" type="button" data-restore-application="${item.id}">Geri Yükle</button><button class="mini-button mini-button--danger" type="button" data-delete-application="${item.id}" data-confirm="${escapeHtml(item.referenceCode)}">Kalıcı Sil</button>`
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

async function loadWeddings() {
  const container = document.querySelector(".js-weddings");
  const pager = state.pagination.weddings;
  container.innerHTML = empty("Düğünler yükleniyor…");
  try {
    const status = document.querySelector(".js-wedding-status").value;
    const search = document.querySelector(".js-wedding-search").value.trim();
    const query = new window.URLSearchParams();
    if (status === "ARCHIVED") query.set("includeArchived", "true");
    else if (status) query.set("deliveryStatus", status);
    if (search.length >= 2) query.set("search", search);
    if (pager.cursor) query.set("cursor", pager.cursor);
    const response = await apiRequest(`/admin/weddings${query.size ? `?${query}` : ""}`);
    state.weddings = unpackPaginatedList("weddings", response.data);
    renderWeddings();
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

function renderWeddings() {
  const term = document
    .querySelector(".js-wedding-search")
    .value.trim()
    .toLocaleLowerCase(APP_LOCALE);
  const status = document.querySelector(".js-wedding-status").value;
  const rows = state.pagination.weddings.isLegacy
    ? state.weddings.filter((wedding) => {
        const haystack =
          `${coupleName(wedding)} ${wedding.bridePhone} ${wedding.groomPhone} ${wedding.venue.name}`.toLocaleLowerCase(
            APP_LOCALE
          );
        return (
          (!term || haystack.includes(term)) &&
          (!status || status === "ARCHIVED" || wedding.delivery?.status === status)
        );
      })
    : state.weddings;
  document.querySelector(".js-weddings").innerHTML = rows.length
    ? rows
        .map((wedding) => {
          const date = new Date(wedding.startsAt);
          const day = new Intl.DateTimeFormat(APP_LOCALE, {
            day: "2-digit",
            timeZone: APP_TIME_ZONE
          }).format(date);
          const month = new Intl.DateTimeFormat(APP_LOCALE, {
            month: "short",
            timeZone: APP_TIME_ZONE
          }).format(date);
          return `<article class="wedding-card"><div class="date-tile"><strong>${day}</strong><small>${escapeHtml(month)}</small></div><div><strong>${escapeHtml(coupleName(wedding))}</strong><p>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</p></div><div class="crew-line">${renderCrew(wedding.assignments)}</div><button class="mini-button" type="button" data-open-wedding="${escapeHtml(wedding.id)}">Ayrıntılar</button></article>`;
        })
        .join("")
    : empty("Filtreye uyan düğün bulunamadı.");
}

function packageDetail(summary = {}) {
  const services = Array.isArray(summary.services) ? summary.services : [];
  return `<strong>${escapeHtml(summary.name || "Paket bilgisi yok")}</strong><small>${escapeHtml(summary.code || "")} ${summary.totalPriceCents ? `· ${escapeHtml(formatMoney(summary.totalPriceCents))}` : ""}</small>${
    services.length
      ? `<div class="crew-line">${services.map((service) => `<span>${escapeHtml(service.name)}</span>`).join("")}</div>`
      : ""
  }`;
}

const DELIVERY_STATUS_ORDER = ["HAZIRLANIYOR", "MONTAJ", "KONTROL", "TESLIME_HAZIR"];

function deliveryAllowedTransitions(wedding, delivery) {
  const transitions =
    delivery?.allowedTransitions ||
    wedding.allowedTransitions ||
    wedding.allowedDeliveryTransitions ||
    [];
  return Array.isArray(transitions) ? transitions : [];
}

function isBackwardDeliveryTransition(currentStatus, nextStatus) {
  return DELIVERY_STATUS_ORDER.indexOf(nextStatus) < DELIVERY_STATUS_ORDER.indexOf(currentStatus);
}

function renderWeddingLifecycleActions(wedding) {
  if (wedding.deletedAt) {
    return `<button class="secondary-button" type="button" data-restore-wedding="${wedding.id}">Geri Yükle</button>`;
  }
  if (wedding.cancelledAt) {
    return `<button class="secondary-button" type="button" data-reinstate-wedding="${wedding.id}">İptali geri al</button><button class="secondary-button" type="button" data-archive-wedding="${wedding.id}">Arşivle</button>`;
  }

  const commonActions = `<button class="secondary-button" type="button" data-edit-current>Düğün bilgilerini düzenle</button><button class="secondary-button" type="button" data-reset-user="${escapeHtml(wedding.customerUser.id)}" data-confirm="${escapeHtml(wedding.customerUser.username)}">Müşteri parolasını sıfırla</button>`;
  if (new Date(wedding.endsAt).valueOf() > Date.now()) {
    return `${commonActions}<button class="secondary-button" type="button" data-cancel-wedding="${wedding.id}">Düğünü iptal et</button><small>Aktif düğün arşivlenmeden önce iptal edilmelidir.</small>`;
  }
  return `${commonActions}<button class="secondary-button" type="button" data-archive-wedding="${wedding.id}">Arşivle</button>`;
}

function renderWeddingDetail(wedding) {
  const delivery = wedding.delivery;
  const deliveryLocked = Boolean(wedding.cancelledAt || wedding.deletedAt);
  const deliveryInputsDisabled = deliveryLocked || delivery?.status === "TESLIM_EDILDI";
  const allowedDeliveryStatuses = delivery
    ? [...new Set([delivery.status, ...deliveryAllowedTransitions(wedding, delivery)])]
    : [];
  const assignedIds = new Set(wedding.assignments.map((assignment) => assignment.staffId));
  const available = wedding.availableStaff.filter((staff) => !assignedIds.has(staff.id));
  document.querySelector(".js-detail-title").textContent = coupleName(wedding);
  detailContent.innerHTML = `<section class="detail-hero"><div class="detail-hero__meta"><span>${formatDate(wedding.startsAt, true)}</span><span>${escapeHtml(wedding.venue.name)}</span><span>${escapeHtml(wedding.cancelledAt ? "İptal edildi" : STATUS_LABELS[delivery?.status] || "Teslimat yok")}</span>${wedding.cancelledAt && wedding.cancellationReason ? `<small>İptal nedeni: ${escapeHtml(wedding.cancellationReason)}</small>` : ""}</div><div class="detail-actions">${renderWeddingLifecycleActions(wedding)}</div></section>
  <div class="detail-grid">
    <section class="detail-block"><h3>Çift ve iletişim</h3><div class="contact-line"><span>${escapeHtml(wedding.brideFirstName)} ${escapeHtml(wedding.brideLastName)}</span><a href="${safePhoneHref(wedding.bridePhone)}">${escapeHtml(wedding.bridePhone)}</a></div><div class="contact-line"><span>${escapeHtml(wedding.groomFirstName)} ${escapeHtml(wedding.groomLastName)}</span><a href="${safePhoneHref(wedding.groomPhone)}">${escapeHtml(wedding.groomPhone)}</a></div><div class="contact-line"><span>E-posta</span><a href="mailto:${escapeHtml(wedding.primaryEmail)}">${escapeHtml(wedding.primaryEmail)}</a></div></section>
    <section class="detail-block"><h3>Paket</h3>${packageDetail(wedding.packageSummary)}${wedding.note ? `<p>${escapeHtml(wedding.note)}</p>` : ""}</section>
    <section class="detail-block wide"><h3>Teslimat</h3>${
      delivery
        ? `<div class="delivery-controls" data-delivery-row="${delivery.id}" data-current-status="${escapeHtml(delivery.status)}"><select data-field="status" aria-label="Teslimat durumu" ${deliveryInputsDisabled ? "disabled" : ""}>${allowedDeliveryStatuses
            .map(
              (status) =>
                `<option value="${escapeHtml(status)}" ${delivery.status === status ? "selected" : ""}>${escapeHtml(STATUS_LABELS[status] || status)}</option>`
            )
            .join(
              ""
            )}</select><input data-field="dueDate" type="date" aria-label="Teslim tarihi" value="${String(delivery.dueDate).slice(0, 10)}" ${deliveryInputsDisabled ? "disabled" : ""} /><input data-field="driveUrl" type="url" aria-label="Google Drive bağlantısı" placeholder="Google Drive bağlantısı" value="${escapeHtml(delivery.driveUrl || "")}" ${deliveryInputsDisabled ? "disabled" : ""} /><button class="mini-button" type="button" data-save-delivery="${delivery.id}" ${deliveryInputsDisabled ? "disabled" : ""}>Kaydet</button><button class="mini-button mini-button--primary" type="button" data-deliver="${delivery.id}" ${deliveryLocked || delivery.status !== "TESLIME_HAZIR" || !delivery.hasDriveUrl ? "disabled" : ""}>Teslim Et</button>${delivery.status === "TESLIM_EDILDI" && !delivery.revokedAt && !deliveryLocked ? `<button class="mini-button mini-button--danger" type="button" data-revoke-delivery="${delivery.id}">Erişimi geri çek</button>` : ""}${delivery.revokedAt ? `<span class="status-dot">Erişim geri çekildi</span>` : ""}</div>`
        : empty("Teslimat kaydı yok.")
    }</section>
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
    }</section>
    <section class="detail-block wide danger-zone"><h3>Tehlikeli işlemler</h3><p>Kalıcı silme; atamaları, mesaj görevlerini ve teslimat operasyon kayıtlarını geri alınamaz şekilde siler. Denetim kayıtları korunur.</p><button class="mini-button mini-button--danger" type="button" data-delete-wedding="${wedding.id}" data-confirm="${escapeHtml(coupleName(wedding))}">Kalıcı Sil</button></section>
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
  if (!detailDialog.open) detailDialog.showModal();
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

async function loadStaff() {
  const container = document.querySelector(".js-staff");
  container.innerHTML = empty("Personeller yükleniyor…");
  try {
    const [response] = await Promise.all([apiRequest("/admin/staff"), ensureVenues()]);
    state.staff = response.data;
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
  document.querySelector(".js-staff-venue").innerHTML = options;
  document.querySelector(".js-manager-venue").innerHTML = options;
  const filterVenueSelect = document.querySelector(".js-staff-venue-filter");
  if (filterVenueSelect) {
    const currentValue = filterVenueSelect.value;
    filterVenueSelect.innerHTML = `<option value="">Tüm salonlar</option>${options}`;
    filterVenueSelect.value = currentValue;
  }
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
    const matchesVenue = !venueId || staff.venueId === venueId || staff.venue?.id === venueId;
    const matchesActive =
      active === "all" || (active === "active" ? staff.isActive : !staff.isActive);
    return matchesTerm && matchesSpecialty && matchesVenue && matchesActive;
  });
  document.querySelector(".js-staff").innerHTML = rows.length
    ? rows
        .map(
          (staff) =>
            `<article class="staff-card ${staff.isActive ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(staff.firstName[0])}${escapeHtml(staff.lastName[0])}</span><span class="status-dot" data-status="${staff.isActive ? "TESLIM_EDILDI" : ""}">${staff.isActive ? "Aktif" : "Pasif"}</span></div><h3>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</h3><a class="staff-phone" href="${safePhoneHref(staff.phone)}">${escapeHtml(staff.phone)}</a><small class="staff-venue">${escapeHtml(staff.venue?.name || "Salon atanmamış")}</small><div class="crew-line">${staff.specialties.map((key) => `<span class="tag">${escapeHtml(SPECIALTIES[key])}</span>`).join("")}</div><footer><span>${staff.assignments.length ? `${staff.assignments.length} yaklaşan görev` : "Yaklaşan görevi yok"}</span><button class="mini-button" type="button" data-edit-staff="${staff.id}">Düzenle</button><button class="mini-button" type="button" data-toggle-staff="${staff.id}" data-active="${staff.isActive}">${staff.isActive ? "Pasife al" : "Aktifleştir"}</button><button class="mini-button mini-button--danger" type="button" data-delete-staff="${staff.id}" data-confirm="${escapeHtml(`${staff.firstName} ${staff.lastName}`)}">Sil</button></footer></article>`
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
  staffForm.elements.venueId.value = staff?.venueId || state.venues[0]?.id || "";
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
  staffDialog.showModal();
}

async function loadManagers() {
  const container = document.querySelector(".js-managers");
  container.innerHTML = empty("Salon sorumluları yükleniyor…");
  try {
    const response = await apiRequest("/admin/venue-managers");
    state.managers = response.data;
    container.innerHTML = state.managers.length
      ? state.managers
          .map(
            (manager) =>
              `<article class="staff-card ${manager.status === "ACTIVE" ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(manager.username.slice(0, 2).toUpperCase())}</span><span class="status-dot" data-status="${manager.status === "ACTIVE" ? "TESLIM_EDILDI" : ""}">${escapeHtml(ACCOUNT_STATUS_LABELS[manager.status] || manager.status)}</span></div><h3>${escapeHtml(manager.username)}</h3><p>${escapeHtml(manager.venue?.name || "Salon atanmamış")}</p><small>${manager.lastLoginAt ? `Son giriş: ${formatDate(manager.lastLoginAt, true)}` : "Henüz giriş yapmadı"}</small><footer><span>${manager.mustChangePassword ? "Parola değişimi bekleniyor" : "Hesap hazır"}</span><button class="mini-button" type="button" data-edit-manager="${manager.id}">Düzenle</button></footer></article>`
          )
          .join("")
      : empty("Henüz salon sorumlusu hesabı yok.");
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

async function openManagerForm(manager = null) {
  await ensureVenues();
  managerForm.reset();
  managerForm.elements.managerId.value = manager?.id || "";
  managerForm.elements.username.value = manager?.username || "";
  managerForm.elements.venueId.value = manager?.venue?.id || state.venues[0]?.id || "";
  managerForm.elements.isActive.checked = manager?.status !== "DISABLED";
  managerForm.elements.password.required = !manager;
  document.querySelector(".js-manager-password-note").textContent = manager
    ? "Değişmeyecekse boş bırakın"
    : "En az 15 karakter";
  document.querySelector(".js-manager-form-title").textContent = manager
    ? "Sorumlu hesabını düzenle"
    : "Sorumlu hesabı ekle";
  managerForm.querySelector(".dialog-message").textContent = "";
  managerDialog.showModal();
}

function renderMessageActions(task) {
  if (task.status === "SENT" || task.status === "CANCELLED") {
    return `<span class="status-dot" data-status="TESLIM_EDILDI">${escapeHtml(MESSAGE_STATUS_LABELS[task.status] || task.status)}</span>`;
  }
  const dueReached = new Date(task.dueAt).valueOf() <= Date.now() || Boolean(task.earlyOverrideAt);
  const retryReached = !task.nextAttemptAt || new Date(task.nextAttemptAt).valueOf() <= Date.now();
  const cancelButton = `<button class="mini-button" type="button" data-cancel-message="${task.id}">İptal</button>`;
  const overrideButton = !dueReached
    ? `<button class="mini-button" type="button" data-override-message="${task.id}">Erken gönderim onayı</button>`
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
            <button class="mini-button mini-button--primary catalog-edit" type="button" data-edit-catalog="${item.id}">Düzenle</button>
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
            <button class="mini-button mini-button--primary catalog-edit" type="button" data-edit-catalog="${venue.id}">Düzenle</button>
            <button class="mini-button mini-button--danger catalog-delete" type="button" data-delete-catalog="${venue.id}">Kaldır</button>
          </div>
        </article>`;
    })
    .join("");
}

async function loadCatalogAdmin() {
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
  renderCatalogRows(document.querySelector(".js-packages"), state.packages, "packages");
  renderCatalogRows(document.querySelector(".js-services"), state.services, "services");
  renderVenueRows(document.querySelector(".js-venues-catalog"), state.catalogVenues);
}

const panelLoaders = {
  overview: () => loadDashboard(),
  plan: () => loadDashboard(),
  calendar: () => loadCalendar(),
  applications: loadApplications,
  weddings: loadWeddings,
  staff: loadStaff,
  managers: loadManagers,
  messages: loadMessages,
  catalog: loadCatalogAdmin
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
    button.classList.toggle("is-active", button.dataset.panel === name);
  });
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

document.querySelectorAll("[data-week-move]").forEach((button) => {
  button.addEventListener(
    "click",
    () => void loadDashboard(addDays(state.weekStart, Number(button.dataset.weekMove)))
  );
});
document.querySelector("[data-week-today]").addEventListener("click", () => {
  state.weekStart = "";
  void loadDashboard();
});

document.querySelector(".js-availability-filters").addEventListener("change", (event) => {
  if (!event.target.matches("select, input")) return;
  state.availabilityVenueId = document.querySelector(".js-availability-venue").value;
  state.availabilityDate = document.querySelector(".js-availability-date").value;
  void loadDashboard();
});

document.querySelector(".js-calendar-venues").addEventListener("click", (event) => {
  const button = event.target.closest("[data-calendar-venue]");
  if (button) void loadCalendar(state.calendarMonth, button.dataset.calendarVenue);
});
document.querySelectorAll("[data-month-move]").forEach((button) => {
  button.addEventListener("click", () => {
    void loadCalendar(
      addMonths(state.calendarMonth, Number(button.dataset.monthMove)),
      state.calendarVenueId
    );
  });
});
document.querySelector("[data-month-today]").addEventListener("click", () => {
  state.calendarMonth = "";
  void loadCalendar("", state.calendarVenueId);
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

  try {
    if (approveButton) {
      await apiRequest(`/admin/booking-applications/${approveButton.dataset.approve}/approve`, {
        method: "POST"
      });
      setMessage("Başvuru onaylandı; düğün ve teslimat planı oluşturuldu.", true);
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
      const accepted = await requestDangerConfirmation(
        {
          title: "Başvuruyu arşivle",
          copy: "Başvuru normal listelerden kaldırılır. Henüz WhatsApp'a aktarılmamış etkin ödeme bağlantısı son süresine kadar korunur; aktarılmış veya süresi dolmuş bağlantı güvenlik için iptal edilir ve geri yüklemeyle yeniden açılmaz.",
          button: "Arşivle"
        },
        archiveButton
      );
      if (accepted === null) return;
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
      const confirmation = await requestDangerConfirmation(
        {
          title: "Başvuruyu kalıcı sil",
          copy: "Bu işlem geri alınamaz. Başvuru ve bağlı hizmet seçimleri silinecektir.",
          confirmation: deleteButton.dataset.confirm,
          button: "Kalıcı Sil",
          reasonRequired: true
        },
        deleteButton
      );
      if (confirmation === null) return;
      deleteButton.disabled = true;
      const response = await apiRequestWithAdminStepUp(
        `/admin/booking-applications/${deleteButton.dataset.deleteApplication}`,
        {
          method: "DELETE",
          body: confirmation
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
    if (deleteButton) deleteButton.disabled = false;
    setMessage(error.message);
  }
}

let weddingSearchTimer = null;
document.querySelector(".js-wedding-search").addEventListener("input", () => {
  renderWeddings();
  window.clearTimeout(weddingSearchTimer);
  weddingSearchTimer = window.setTimeout(() => {
    resetPagination("weddings");
    void loadWeddings();
  }, 250);
});
document.querySelector(".js-wedding-status").addEventListener("change", () => {
  resetPagination("weddings");
  void loadWeddings();
});

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
  const data = new FormData(event.target);
  const body = {
    staffId: data.get("staffId"),
    specialty: data.get("specialty"),
    allowConflict: false
  };
  try {
    await apiRequest(`/admin/weddings/${state.currentWedding.id}/assignments`, {
      method: "POST",
      body
    });
  } catch (error) {
    const conflicts = error.payload?.errors?.conflicts;
    if (error.status !== 409 || !Array.isArray(conflicts) || conflicts.length === 0) {
      setMessage(error.message);
      return;
    }
    const summary = conflicts
      .map((wedding) => `${coupleName(wedding)} (${formatDate(wedding.startsAt, true)})`)
      .join("\n");
    const confirmed = await showCustomConfirm({
      title: "Çakışan Görev Uyarısı",
      message: `Personelin çakışan görevi var:\n${summary}\n\nYine de atansın mı?`,
      confirmText: "Yine de Atansın",
      cancelText: "Vazgeç",
      isWarning: true
    });
    if (!confirmed) return;
    const overrideReason = await requestRequiredReason({
      title: "Çakışan atama gerekçesi",
      message: "Bu istisnanın neden gerekli olduğunu denetim kaydı için yazın.",
      placeholder: "En az 10 karakterlik operasyon gerekçesi",
      confirmText: "Gerekçeyi kaydet",
      cancelText: "Vazgeç",
      isWarning: true
    });
    if (!overrideReason) return;
    const response = await apiRequestWithAdminStepUp(
      `/admin/weddings/${state.currentWedding.id}/assignments`,
      {
        method: "POST",
        body: { ...body, allowConflict: true, overrideReason }
      },
      { actionLabel: "Çakışan personel ataması" }
    );
    if (!response) return;
  }
  setMessage("Personel düğüne atandı.", true);
  await Promise.all([openWeddingDetail(state.currentWedding.id), loadDashboard(), loadWeddings()]);
});

detailContent.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-current]");
  const saveButton = event.target.closest("[data-save-delivery]");
  const deliverButton = event.target.closest("[data-deliver]");
  const revokeDeliveryButton = event.target.closest("[data-revoke-delivery]");
  const resetButton = event.target.closest("[data-reset-user]");
  const removeButton = event.target.closest("[data-remove-assignment]");
  const cancelWeddingButton = event.target.closest("[data-cancel-wedding]");
  const reinstateWeddingButton = event.target.closest("[data-reinstate-wedding]");
  const archiveWeddingButton = event.target.closest("[data-archive-wedding]");
  const restoreWeddingButton = event.target.closest("[data-restore-wedding]");
  const deleteWeddingButton = event.target.closest("[data-delete-wedding]");
  try {
    if (editButton) {
      await openWeddingEditor(state.currentWedding);
      return;
    }
    if (saveButton) {
      const row = saveButton.closest("[data-delivery-row]");
      const driveUrl = row.querySelector('[data-field="driveUrl"]').value.trim();
      const currentStatus = row.dataset.currentStatus;
      const nextStatus = row.querySelector('[data-field="status"]').value;
      const body = {
        status: nextStatus,
        dueDate: row.querySelector('[data-field="dueDate"]').value,
        driveUrl: driveUrl || null
      };
      if (isBackwardDeliveryTransition(currentStatus, nextStatus)) {
        const reason = await requestRequiredReason({
          title: "Teslimat aşamasını geri al",
          message: "Geri geçiş nedenini denetim kaydı için yazın.",
          placeholder: "En az 10 karakterlik geri geçiş nedeni",
          confirmText: "Geri al",
          cancelText: "Vazgeç",
          isWarning: true
        });
        if (!reason) return;
        const response = await apiRequestWithAdminStepUp(
          `/admin/deliveries/${saveButton.dataset.saveDelivery}`,
          { method: "PATCH", body: { ...body, reason } },
          { actionLabel: "Teslimat durumunu geri alma" }
        );
        if (!response) return;
      } else {
        await apiRequest(`/admin/deliveries/${saveButton.dataset.saveDelivery}`, {
          method: "PATCH",
          body
        });
      }
      setMessage("Teslimat bilgileri kaydedildi.", true);
    } else if (deliverButton) {
      const sharingConfirmation = await showCustomPrompt({
        title: "Drive paylaşımını doğrula",
        message:
          "Bağlantıyı gizli pencerede açıp 'bağlantıya sahip herkes' erişimini doğrulayın ve ERİŞİMİ DOĞRULADIM yazın.",
        placeholder: "ERİŞİMİ DOĞRULADIM",
        confirmText: "Teslim Et",
        required: true
      });
      if (sharingConfirmation !== "ERİŞİMİ DOĞRULADIM") {
        throw new Error("Teslimat için Drive paylaşım izni doğrulanmalıdır.");
      }
      await apiRequest(`/admin/deliveries/${deliverButton.dataset.deliver}/deliver`, {
        method: "POST",
        body: { sharingConfirmed: true, sharingConfirmation }
      });
      setMessage("Teslimat müşteriye açıldı ve mesaj görevi oluşturuldu.", true);
    } else if (revokeDeliveryButton) {
      const reason = await showCustomPrompt({
        title: "Teslimat erişimini geri çek",
        message: "Müşteri bağlantıya artık erişemeyecek. Gerekçeyi yazın.",
        confirmText: "Erişimi geri çek",
        isDanger: true,
        required: true
      });
      if (!reason) return;
      const response = await apiRequestWithAdminStepUp(
        `/admin/deliveries/${revokeDeliveryButton.dataset.revokeDelivery}/revoke`,
        { method: "POST", body: { reason } },
        { actionLabel: "Teslimat erişimini geri çekme" }
      );
      if (!response) return;
      setMessage("Teslimat erişimi geri çekildi.", true);
    } else if (resetButton) {
      const confirmation = await requestDangerConfirmation(
        {
          title: "Müşteri parolasını sıfırla",
          copy: "Müşterinin açık oturumları kapatılır ve tek kullanımlık parola belirleme bağlantısı hazırlanır.",
          confirmation: resetButton.dataset.confirm,
          button: "Parolayı Sıfırla",
          reasonRequired: true
        },
        resetButton
      );
      if (confirmation === null) return;
      const response = await apiRequestWithAdminStepUp(
        `/admin/customers/${resetButton.dataset.resetUser}/reset-password`,
        { method: "POST", body: confirmation },
        { actionLabel: "Müşteri parolasını sıfırlama" }
      );
      if (!response) return;
      setMessage("Parola sıfırlama görevi oluşturuldu; Mesajlar bölümünden hazırlayın.", true);
      await Promise.all([loadMessages(), loadDashboard()]);
    } else if (cancelWeddingButton) {
      const reason = await requestRequiredReason({
        title: "Düğünü iptal et",
        message:
          "Müşteri erişimi ve bekleyen mesaj görevleri durdurulur. Personel atamaları kayıt amacıyla korunur.",
        placeholder: "En az 10 karakterlik iptal nedeni",
        confirmText: "Düğünü iptal et",
        cancelText: "Vazgeç",
        isDanger: true
      });
      if (!reason) return;
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${cancelWeddingButton.dataset.cancelWedding}/cancel`,
        { method: "POST", body: { reason } },
        { actionLabel: "Düğünü iptal etme" }
      );
      if (!response) return;
      setMessage("Düğün iptal edildi; müşteri ve mesaj erişimleri durduruldu.", true);
    } else if (reinstateWeddingButton) {
      const reason = await requestRequiredReason({
        title: "Düğün iptalini geri al",
        message:
          "Takvim uygunluğu yeniden denetlenir. İptalde geri çekilen teslimat erişimi kendiliğinden açılmaz.",
        placeholder: "En az 10 karakterlik geri alma nedeni",
        confirmText: "İptali geri al",
        cancelText: "Vazgeç",
        isWarning: true
      });
      if (!reason) return;
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${reinstateWeddingButton.dataset.reinstateWedding}/reinstate`,
        { method: "POST", body: { reason } },
        { actionLabel: "Düğün iptalini geri alma" }
      );
      if (!response) return;
      setMessage("Düğün iptali geri alındı; teslimat erişimi kendiliğinden açılmadı.", true);
    } else if (archiveWeddingButton) {
      const accepted = await requestDangerConfirmation(
        {
          title: "Düğünü arşivle",
          copy: "İptal edilmiş veya zamanı geçmiş düğün; plan, takvim ve teslimat listelerinden kaldırılır. Gelecekteki aktif düğün önce iptal edilmelidir.",
          button: "Arşivle"
        },
        archiveWeddingButton
      );
      if (accepted === null) return;
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
      const confirmation = await requestDangerConfirmation(
        {
          title: "Düğünü kalıcı sil",
          copy: "Bu işlem geri alınamaz. Operasyon kayıtları silinir; denetim kayıtları korunur.",
          confirmation: deleteWeddingButton.dataset.confirm,
          button: "Kalıcı Sil",
          reasonRequired: true
        },
        deleteWeddingButton
      );
      if (confirmation === null) return;
      deleteWeddingButton.disabled = true;
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${deleteWeddingButton.dataset.deleteWedding}`,
        { method: "DELETE", body: confirmation },
        { actionLabel: "Düğünü kalıcı silme" }
      );
      if (!response) {
        deleteWeddingButton.disabled = false;
        return;
      }
      detailDialog.close();
      setMessage("Düğün kalıcı olarak silindi.", true);
    } else if (removeButton) {
      const confirmation = await requestDangerConfirmation(
        {
          title: "Personel atamasını kaldır",
          copy: "Bu işlem yalnızca atamayı kaldırır; geçmiş düğün ve personel kayıtları silinmez.",
          confirmation: "ATAMAYI KALDIR",
          button: "Atamayı kaldır",
          reasonRequired: true
        },
        removeButton
      );
      if (confirmation === null) return;
      removeButton.disabled = true;
      const response = await apiRequestWithAdminStepUp(
        `/admin/weddings/${state.currentWedding.id}/assignments/${removeButton.dataset.removeAssignment}`,
        { method: "DELETE", body: confirmation },
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
      loadWeddings()
    ]);
  } catch (error) {
    if (removeButton) removeButton.disabled = false;
    if (deleteWeddingButton) deleteWeddingButton.disabled = false;
    setMessage(error.message);
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
  else if (toggleButton)
    void apiRequest(`/admin/staff/${toggleButton.dataset.toggleStaff}`, {
      method: "PATCH",
      body: { isActive: toggleButton.dataset.active !== "true" }
    })
      .then(() => Promise.all([loadStaff(), loadDashboard()]))
      .then(() => setMessage("Personel durumu güncellendi.", true))
      .catch((error) => setMessage(error.message));
  else if (deleteButton)
    void requestDangerConfirmation(
      {
        title: "Personeli sil",
        copy: "Ataması varsa personel silinmez, pasife alınır. Ataması yoksa işlem geri alınamaz.",
        confirmation: deleteButton.dataset.confirm,
        button: "Devam et",
        reasonRequired: true
      },
      deleteButton
    ).then(async (confirmation) => {
      if (confirmation === null) return;
      deleteButton.disabled = true;
      try {
        const response = await apiRequestWithAdminStepUp(
          `/admin/staff/${deleteButton.dataset.deleteStaff}`,
          { method: "DELETE", body: confirmation },
          { actionLabel: "Personel kaydını silme" }
        );
        if (!response) return;
        setMessage(
          response.data.action === "deactivated"
            ? "Personelin geçmiş atamaları var; pasife alındı."
            : "Personel kalıcı olarak silindi.",
          true
        );
        await Promise.all([loadStaff(), loadDashboard()]);
      } catch (error) {
        setMessage(error.message);
      } finally {
        deleteButton.disabled = false;
      }
    });
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
    venueId: data.get("venueId")
  };
  specialtyError.hidden = body.specialties.length > 0;
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
    formMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Kaydet";
  }
});

document.querySelector(".js-add-manager").addEventListener("click", () => void openManagerForm());
document.querySelector(".js-managers").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-manager]");
  if (button)
    void openManagerForm(
      state.managers.find((manager) => manager.id === button.dataset.editManager)
    );
});
managerForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => managerDialog.close());
});
managerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  const data = new FormData(managerForm);
  const managerId = data.get("managerId");
  const body = {
    username: data.get("username"),
    venueId: data.get("venueId"),
    status: data.has("isActive") ? "ACTIVE" : "DISABLED",
    ...(data.get("password") ? { password: data.get("password") } : {})
  };
  try {
    const response = await apiRequestWithAdminStepUp(
      managerId ? `/admin/venue-managers/${managerId}` : "/admin/venue-managers",
      {
        method: managerId ? "PATCH" : "POST",
        body
      },
      {
        actionLabel: managerId
          ? "Salon sorumlusu hesabını değiştirme"
          : "Salon sorumlusu hesabı oluşturma"
      }
    );
    if (!response) return;
    managerDialog.close();
    setMessage(managerId ? "Salon sorumlusu güncellendi." : "Salon sorumlusu eklendi.", true);
    await loadManagers();
  } catch (error) {
    managerForm.querySelector(".dialog-message").textContent = error.message;
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
          { method: "POST", body: {} },
          { actionLabel: "Hassas müşteri mesajını WhatsApp'ta gönderme" }
        );
        if (!response) {
          popup?.close();
          return;
        }
        await openWhatsAppMessage(response.data, popup);
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
        setMessage("Mesaj panoya kopyalandı ve WhatsApp açıldı.", true);
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
      const reason = await showCustomPrompt({
        title: "Gönderim başarısız",
        message: "Yeniden deneme kuyruğuna alınması için kısa nedeni yazın.",
        confirmText: "Başarısız işaretle",
        required: true
      });
      if (!reason) return;
      await apiRequest(`/admin/message-tasks/${failedButton.dataset.markFailed}/mark-failed`, {
        method: "POST",
        body: { expectedUpdatedAt: failedButton.dataset.taskUpdatedAt, reason }
      });
      state.openedMessageTaskIds.delete(failedButton.dataset.markFailed);
      await loadMessages();
    } else if (cancelButton) {
      const reason = await showCustomPrompt({
        title: "Mesaj görevini iptal et",
        message: "İptal nedeni denetim kaydına yazılır.",
        confirmText: "İptal et",
        isDanger: true,
        required: true
      });
      if (!reason) return;
      await apiRequest(`/admin/message-tasks/${cancelButton.dataset.cancelMessage}/cancel`, {
        method: "POST",
        body: { reason }
      });
      state.openedMessageTaskIds.delete(cancelButton.dataset.cancelMessage);
      await loadMessages();
    } else if (overrideButton) {
      const reason = await showCustomPrompt({
        title: "Erken gönderim onayı",
        message: "Planlanan zamandan önce gönderme gerekçesini yazın.",
        confirmText: "Onayla",
        required: true
      });
      if (!reason) return;
      const response = await apiRequestWithAdminStepUp(
        `/admin/message-tasks/${overrideButton.dataset.overrideMessage}/override-due`,
        { method: "POST", body: { reason } },
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
                type === "packages" ? "Paket Bilgilerini Düzenle" : "Ek Hizmet Bilgilerini Düzenle",
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
        setMessage("Katalog kaydı başarıyla güncellendi.", true);
      } catch (error) {
        setMessage(error.message);
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
        setMessage("Katalog güncellendi.", true);
      } catch (error) {
        setMessage(error.message);
      }
    } else if (deleteButton) {
      const row = deleteButton.closest("[data-catalog-row]");
      const typeLabel =
        row.dataset.catalogType === "packages"
          ? "Temel paketi"
          : row.dataset.catalogType === "services"
            ? "Ek hizmeti"
            : "Mekânı";
      const name = row.dataset.catalogName || "Katalog kaydı";
      const isVenue = row.dataset.catalogType === "venues";
      const confirmation = await requestDangerConfirmation(
        {
          title: `${typeLabel} ${isVenue ? "kaldır" : "sil"}`,
          copy: isVenue
            ? `"${name}" mekânı ilişkili operasyon kaydı varsa pasife alınır; yoksa kalıcı silinir.`
            : `"${name}" seçeneği kullanılmıyorsa kalıcı silinir; ilişkili kayıt varsa pasife alınır.`,
          confirmation: name,
          button: isVenue ? "Kaldır" : "Sil",
          reasonRequired: true
        },
        deleteButton
      );
      if (confirmation === null) return;
      try {
        const response = await apiRequestWithAdminStepUp(
          `/admin/${row.dataset.catalogType}/${row.dataset.catalogRow}`,
          { method: "DELETE", body: confirmation },
          { actionLabel: `${typeLabel} ${isVenue ? "kaldırma" : "silme"}` }
        );
        if (!response) return;
        await loadCatalogAdmin();
        setMessage(`${typeLabel} ${isVenue ? "kaldırıldı" : "silindi"}.`, true);
      } catch (error) {
        setMessage(error.message);
      }
    }
  });

document.querySelectorAll("[data-add-catalog]").forEach((button) => {
  button.addEventListener("click", async () => {
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
        setMessage("Yeni mekân oluşturuldu.", true);
      } catch (error) {
        setMessage(error.message);
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
      setMessage("Yeni katalog kaydı oluşturuldu.", true);
    } catch (error) {
      setMessage(error.message);
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

document.querySelector(".js-open-manual").addEventListener("click", async () => {
  try {
    await loadManualOptions();
    manualDialog.showModal();
  } catch (error) {
    setMessage(error.message);
  }
});
manualForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => manualDialog.close());
});
manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  if (!manualForm.reportValidity()) return;
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
        endsNextDay: data.has("endsNextDay"),
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
    note: wedding.note || ""
  };
  Object.entries(values).forEach(([name, value]) => {
    weddingForm.elements.namedItem(name).value = value;
  });
  weddingForm.elements.endsNextDay.checked =
    datePartInIstanbul(wedding.startsAt) !== datePartInIstanbul(wedding.endsAt);
  weddingForm.querySelector(".dialog-message").textContent = "";
  weddingForm.dataset.originalPackageCode = currentPackage.code || "";
  weddingForm.dataset.originalPackageName = currentPackage.name || "Paket bilgisi yok";
  weddingForm.dataset.originalServices = JSON.stringify(
    currentServices.map(({ code, name }) => ({ code, name }))
  );
  weddingForm.dataset.generatedNote = "";
  weddingDialog.showModal();
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

weddingForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => weddingDialog.close());
});
weddingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  if (!weddingForm.reportValidity()) return;
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
          endsNextDay: data.has("endsNextDay"),
          venueId: data.get("venueId"),
          packageCode: data.get("packageCode"),
          serviceCodes: data.getAll("serviceCodes"),
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
    await Promise.all([openWeddingDetail(weddingId), loadWeddings(), loadDashboard()]);
  } catch (error) {
    weddingForm.querySelector(".dialog-message").textContent = formErrorMessage(weddingForm, error);
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

if (await ensureAdmin()) {
  initTrustedDevices();
  await Promise.all([
    loadDashboard(),
    apiRequest("/admin/catalog-form-constraints").then((response) => {
      state.catalogFormConstraints = response.data;
    }),
    apiRequest("/catalog").then((response) => {
      const constraints = parseBookingFormConstraints(response.data?.bookingFormConstraints);
      applyBookingFormConstraints(document, constraints);
    })
  ]).catch((error) => setMessage(error.message));
}

/* UX & Klavye Kısayolları */
const toggleSidebarBtn = document.querySelector(".js-toggle-sidebar");
const closeSidebarBtn = document.querySelector(".js-close-sidebar");
const sidebar = document.querySelector(".admin-sidebar");
const sidebarOverlay = document.querySelector(".js-sidebar-overlay");

function closeAdminSidebar() {
  sidebar?.classList.remove("is-open");
  sidebarOverlay?.classList.remove("is-open");
  document.body.classList.remove("sidebar-open");
}

function openAdminSidebar() {
  sidebar?.classList.add("is-open");
  sidebarOverlay?.classList.add("is-open");
  document.body.classList.add("sidebar-open");
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
    btn.addEventListener("click", () => closeAdminSidebar());
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
  if (e.key === "Escape") {
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
