import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { STAFF_SPECIALTY_LABELS } from "../shared/domain-labels.js";
import {
  APP_LOCALE,
  APP_TIME_ZONE,
  OPERATIONS_CITY,
  formatAppCurrency,
  formatAppTime
} from "../shared/runtime-config.js";
import { escapeHtml } from "../shared/html.js";
import { printWeddingReport } from "../shared/wedding-print-report.js";

const SPECIALTIES = STAFF_SPECIALTY_LABELS;
const PANEL_TITLES = {
  overview: "Bugünün akışı",
  calendar: "Salon takvimi",
  staff: "Salon ekibi"
};
const state = {
  venueId: null,
  venueIds: [],
  venueScopeKey: "",
  dashboard: null,
  weekStart: "",
  dashboardReady: false,
  dashboardLoading: false,
  dashboardRequestId: 0,
  calendarMonth: "",
  calendarReady: false,
  calendarLoading: false,
  calendarRequestId: 0,
  weddings: [],
  weddingPagination: {
    cursor: null,
    history: [],
    nextCursor: null,
    pageSize: 50,
    totalItems: 0,
    isLegacy: false,
    loading: false
  },
  weddingRequestId: 0,
  staff: [],
  currentWedding: null
};

const message = document.querySelector(".global-message");
const weddingDialog = document.querySelector(".js-wedding-dialog");
const detailContainer = document.querySelector(".js-wedding-detail");
const weddingPdfButton = document.querySelector(".js-create-wedding-pdf");
const staffDialog = document.querySelector(".js-staff-dialog");
const staffForm = document.querySelector(".js-staff-form");
const weddingSearchInput = document.querySelector(".js-wedding-search");
const weddingPagination = document.querySelector(".js-wedding-pagination");
const weekNavigationButtons = [...document.querySelectorAll("[data-week-move], [data-week-today]")];
const calendarNavigationButtons = [
  ...document.querySelectorAll("[data-month-move], [data-month-today]")
];
const formControlStates = new WeakMap();
const dialogReturnFocus = new WeakMap();

const empty = (copy) => `<p class="empty">${escapeHtml(copy)}</p>`;
const couple = (wedding) => `${wedding.brideFirstName} & ${wedding.groomFirstName}`;
const formatDate = (value, withTime = false) =>
  value
    ? new Intl.DateTimeFormat(APP_LOCALE, {
        timeZone: APP_TIME_ZONE,
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" } : {})
      }).format(new Date(value))
    : "—";
const formatMoney = (cents) =>
  formatAppCurrency(Number(cents || 0) / 100, { maximumFractionDigits: 0 });
const dateKey = (value) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const addDays = (date, days) => {
  const probe = new Date(`${date}T12:00:00.000Z`);
  probe.setUTCDate(probe.getUTCDate() + days);
  return probe.toISOString().slice(0, 10);
};
const setMessage = (copy, success = false) => {
  message.textContent = copy;
  message.classList.toggle("is-success", success);
};

function syncDateNavigation() {
  weekNavigationButtons.forEach((button) => {
    button.disabled = state.dashboardLoading || !state.dashboardReady;
  });
  calendarNavigationButtons.forEach((button) => {
    button.disabled = state.calendarLoading || !state.calendarReady;
  });
  document.querySelector(".js-week")?.setAttribute("aria-busy", String(state.dashboardLoading));
  document.querySelector(".js-calendar")?.setAttribute("aria-busy", String(state.calendarLoading));
}

function venueScopeKey(venueIds) {
  return [...new Set(venueIds)].sort().join(":");
}

function clearVenueScopedUi(nextVenueIds = []) {
  state.venueIds = [...new Set(nextVenueIds)];
  state.venueId = state.venueIds[0] || null;
  state.venueScopeKey = venueScopeKey(state.venueIds);
  state.dashboard = null;
  state.weekStart = "";
  state.dashboardReady = false;
  state.dashboardLoading = false;
  state.dashboardRequestId += 1;
  state.calendarMonth = "";
  state.calendarReady = false;
  state.calendarLoading = false;
  state.calendarRequestId += 1;
  state.weddings = [];
  state.staff = [];
  state.currentWedding = null;
  state.weddingRequestId += 1;
  resetWeddingPagination();
  [".js-today", ".js-week", ".js-calendar", ".js-weddings", ".js-staff"].forEach((selector) =>
    document.querySelector(selector)?.replaceChildren()
  );
  document.querySelectorAll("[data-metric]").forEach((node) => {
    node.textContent = "—";
  });
  document.querySelectorAll(".js-venue-name").forEach((node) => {
    node.textContent = "Yükleniyor";
  });
  syncDateNavigation();
}

function assertVenuePayload(data) {
  const payloadVenueIds = Array.isArray(data?.venues)
    ? data.venues.map((venue) => venue.id)
    : [data?.venue?.id].filter(Boolean);
  if (!state.venueScopeKey || venueScopeKey(payloadVenueIds) !== state.venueScopeKey) {
    clearVenueScopedUi();
    throw new Error(
      "Salon oturumu değişti. Veriler güvenlik için temizlendi; yeniden giriş yapın."
    );
  }
}

async function ensureSession() {
  try {
    const response = await apiRequest("/auth/session");
    if (response.data.role !== "SALON_YETKILISI" || response.data.mustChangePassword) {
      window.location.replace("login.html");
      return false;
    }
    const venueIds = Array.isArray(response.data.venueIds)
      ? response.data.venueIds
      : [response.data.venueId].filter((venueId) => typeof venueId === "string");
    if (!venueIds.length) throw new Error("Salon kapsamı bulunamadı.");
    if (state.venueScopeKey !== venueScopeKey(venueIds)) clearVenueScopedUi(venueIds);
    document.querySelector(".js-username").textContent = response.data.username;
    document.querySelector(".js-user-initial").textContent =
      response.data.username[0].toUpperCase();
    return true;
  } catch {
    clearVenueScopedUi();
    window.location.replace("login.html");
    return false;
  }
}

function crew(assignments) {
  return assignments.length
    ? assignments
        .map(
          ({ staff, specialty }) =>
            `<span class="tag">${escapeHtml(staff.firstName)} · ${escapeHtml(SPECIALTIES[specialty])}</span>`
        )
        .join("")
    : '<span class="tag">Ekip bekliyor</span>';
}

function renderDashboard(data) {
  assertVenuePayload(data);
  const venues = Array.isArray(data.venues) ? data.venues : [data.venue];
  state.dashboard = data;
  state.weekStart = data.weekStart;
  state.dashboardReady = true;
  document.querySelectorAll(".js-venue-name").forEach((node) => {
    node.textContent = venues.map((venue) => venue.name).join(" · ");
  });
  Object.entries(data.metrics).forEach(([key, value]) => {
    const node = document.querySelector(`[data-metric="${key}"]`);
    if (node) node.textContent = value;
  });
  updateOpsBadges(data.metrics);
  document.querySelector(".js-today").innerHTML = data.todayWeddings.length
    ? data.todayWeddings
        .map(
          (wedding) =>
            `<article class="event-card"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><div><strong>${escapeHtml(couple(wedding))}</strong><small>${escapeHtml(wedding.venue.name)} · ${wedding.assignments.length} personel atandı</small><div class="crew-line">${crew(wedding.assignments)}</div></div><button type="button" data-open-wedding="${wedding.id}">Görüntüle ve personel ata</button></article>`
        )
        .join("")
    : empty("Bugün salonlarınızda planlı düğün yok.");
  document.querySelector(".js-idle-staff").innerHTML = data.idleStaff.length
    ? data.idleStaff
        .map((staff) => `<span>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</span>`)
        .join("")
    : empty("Boşta personel yok.");
  document.querySelector(".js-conflicts").innerHTML = data.conflicts.length
    ? data.conflicts
        .map(
          (conflict) =>
            `<p><strong>${escapeHtml(conflict.staff.firstName)} ${escapeHtml(conflict.staff.lastName)}</strong><br><small>${escapeHtml(couple(conflict.firstWedding))} / ${escapeHtml(couple(conflict.secondWedding))}</small></p>`
        )
        .join("")
    : empty("Personel çakışması yok.");

  const days = Array.from({ length: 7 }, (_, index) => addDays(data.weekStart, index));
  document.querySelector(".js-week-label").textContent =
    `${formatDate(`${data.weekStart}T12:00:00Z`)} – ${formatDate(`${data.weekEnd}T12:00:00Z`)}`;
  document.querySelector(".js-week").innerHTML = days
    .map((day) => {
      const dayWeddings = data.weekWeddings.filter((wedding) => dateKey(wedding.startsAt) === day);
      const date = new Date(`${day}T12:00:00Z`);
      return `<article class="week-day ${day === data.today ? "is-today" : ""}"><header><span>${new Intl.DateTimeFormat(APP_LOCALE, { weekday: "short" }).format(date)}</span><b>${date.getUTCDate()}</b></header>${dayWeddings
        .map(
          (wedding) =>
            `<button class="week-item" type="button" data-open-wedding="${wedding.id}"><strong>${formatAppTime(wedding.startsAt)} · ${escapeHtml(couple(wedding))}</strong><small>${escapeHtml(wedding.venue.name)} · ${wedding.assignments.length} kişilik ekip</small></button>`
        )
        .join("")}</article>`;
    })
    .join("");
}

async function loadDashboard(weekStart = state.weekStart) {
  const requestId = ++state.dashboardRequestId;
  const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : "";
  state.dashboardLoading = true;
  syncDateNavigation();
  document.querySelector(".js-week-message").textContent = "";
  try {
    const response = await apiRequest(`/operations/dashboard${query}`);
    if (requestId !== state.dashboardRequestId) return;
    renderDashboard(response.data);
  } catch (error) {
    if (requestId === state.dashboardRequestId) {
      document.querySelector(".js-week-message").textContent = error.message;
    }
    throw error;
  } finally {
    if (requestId === state.dashboardRequestId) {
      state.dashboardLoading = false;
      syncDateNavigation();
    }
  }
}

function renderCalendar(data) {
  assertVenuePayload(data);
  state.calendarMonth = data.month;
  state.calendarReady = true;
  const [year, month] = data.month.split("-").map(Number);
  document.querySelector(".js-calendar-label").textContent = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = leading + daysInMonth <= 35 ? 35 : 42;
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - leading);
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const probe = new Date(gridStart);
    probe.setUTCDate(gridStart.getUTCDate() + index);
    return probe.toISOString().slice(0, 10);
  });
  document.querySelector(".js-calendar").innerHTML = cells
    .map((day) => {
      const events = data.weddings.filter((wedding) => dateKey(wedding.startsAt) === day);
      const date = new Date(`${day}T12:00:00.000Z`);
      const outside = day.slice(0, 7) !== data.month;
      const weekday = new Intl.DateTimeFormat(APP_LOCALE, { weekday: "short" }).format(date);
      return `<article class="calendar-day ${outside ? "is-outside" : ""} ${events.length ? "" : "is-empty"} ${day === data.today ? "is-today" : ""}"><div class="calendar-day__head"><span class="calendar-day__number">${date.getUTCDate()}</span><span class="calendar-day__weekday">${escapeHtml(weekday)}</span></div><div class="calendar-events">${events
        .map(
          (wedding) =>
            `<button class="calendar-event ${wedding.assignments.length ? "" : "is-unassigned"}" type="button" data-open-wedding="${wedding.id}"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><strong>${escapeHtml(couple(wedding))}</strong><small>${escapeHtml(wedding.venue.name)} · ${wedding.assignments.length ? `${wedding.assignments.length} kişilik ekip` : "Ekip atanmadı"}</small></button>`
        )
        .join("")}</div></article>`;
    })
    .join("");
  document.querySelector(".js-calendar-empty").hidden = data.weddings.length > 0;
}

async function loadCalendar(month = state.calendarMonth) {
  const requestId = ++state.calendarRequestId;
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  state.calendarLoading = true;
  syncDateNavigation();
  document.querySelector(".js-calendar-message").textContent = "";
  try {
    const response = await apiRequest(`/operations/calendar${query}`);
    if (requestId !== state.calendarRequestId) return;
    renderCalendar(response.data);
  } catch (error) {
    if (requestId === state.calendarRequestId) {
      document.querySelector(".js-calendar-message").textContent = error.message;
    }
    throw error;
  } finally {
    if (requestId === state.calendarRequestId) {
      state.calendarLoading = false;
      syncDateNavigation();
    }
  }
}

function weddingSearchTerm() {
  return weddingSearchInput.value.trim();
}

function resetWeddingPagination() {
  state.weddingPagination.cursor = null;
  state.weddingPagination.history = [];
  state.weddingPagination.nextCursor = null;
  state.weddingPagination.totalItems = 0;
}

function renderWeddingPagination() {
  const pagination = state.weddingPagination;
  const previous = weddingPagination.querySelector('[data-wedding-page="previous"]');
  const next = weddingPagination.querySelector('[data-wedding-page="next"]');
  previous.disabled = pagination.loading || pagination.history.length === 0;
  next.disabled = pagination.loading || !pagination.nextCursor;
  weddingPagination.querySelector(".js-wedding-page-summary").textContent =
    `${pagination.history.length + 1}. sayfa · ${pagination.totalItems} kayıt`;
  document.querySelector(".js-wedding-search-reset").disabled = !weddingSearchTerm();
}

function renderWeddings() {
  const term = weddingSearchTerm().toLocaleLowerCase(APP_LOCALE);
  if (term.length === 1) {
    document.querySelector(".js-weddings").innerHTML = empty(
      "Arama yapmak için en az 2 karakter yazın."
    );
    renderWeddingPagination();
    return;
  }
  const rows = state.weddingPagination.isLegacy
    ? state.weddings.filter((wedding) =>
        `${couple(wedding)} ${wedding.bridePhone} ${wedding.groomPhone}`
          .toLocaleLowerCase(APP_LOCALE)
          .includes(term)
      )
    : state.weddings;
  document.querySelector(".js-weddings").innerHTML = rows.length
    ? rows
        .map((wedding) => {
          const date = new Date(wedding.startsAt);
          return `<article class="wedding-card"><div class="date-tile"><strong>${new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, day: "2-digit" }).format(date)}</strong><small>${new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, month: "short" }).format(date)}</small></div><div><strong>${escapeHtml(couple(wedding))}</strong><p>${escapeHtml(wedding.venue.name)} · ${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</p></div><div class="crew-line">${crew(wedding.assignments)}</div><button class="mini-button" type="button" data-open-wedding="${wedding.id}">Ayrıntılar</button></article>`;
        })
        .join("")
    : empty(term ? "Aramanızla eşleşen düğün yok." : "Planlanmış düğün yok.");
  renderWeddingPagination();
}

async function loadWeddings() {
  const scopeKey = state.venueScopeKey;
  if (!scopeKey) throw new Error("Salon oturumu doğrulanmadan veri yüklenemez.");
  const term = weddingSearchTerm();
  if (term.length === 1) {
    state.weddingRequestId += 1;
    state.weddings = [];
    state.weddingPagination.nextCursor = null;
    state.weddingPagination.totalItems = 0;
    renderWeddings();
    return;
  }

  const requestId = ++state.weddingRequestId;
  const query = new window.URLSearchParams({
    pageSize: String(state.weddingPagination.pageSize)
  });
  if (state.weddingPagination.cursor) query.set("cursor", state.weddingPagination.cursor);
  if (term.length >= 2) query.set("search", term);
  state.weddingPagination.loading = true;
  renderWeddingPagination();

  try {
    const response = await apiRequest(`/operations/weddings?${query.toString()}`);
    if (requestId !== state.weddingRequestId || scopeKey !== state.venueScopeKey) return;
    const isLegacy = Array.isArray(response.data);
    const items = isLegacy ? response.data : response.data?.items;
    if (!Array.isArray(items)) throw new Error("Düğün listesi geçersiz yanıt verdi.");
    const pagination = isLegacy ? null : response.data?.pagination;
    state.weddings = items;
    state.weddingPagination.isLegacy = isLegacy;
    state.weddingPagination.nextCursor =
      typeof pagination?.nextCursor === "string" ? pagination.nextCursor : null;
    state.weddingPagination.pageSize = Number.isInteger(pagination?.pageSize)
      ? pagination.pageSize
      : state.weddingPagination.pageSize;
    state.weddingPagination.totalItems = Number.isInteger(pagination?.totalItems)
      ? pagination.totalItems
      : items.length;
    renderWeddings();
  } finally {
    if (requestId === state.weddingRequestId) {
      state.weddingPagination.loading = false;
      renderWeddingPagination();
    }
  }
}

async function moveWeddingPage(direction) {
  const pagination = state.weddingPagination;
  if (pagination.loading) return;
  const snapshot = {
    cursor: pagination.cursor,
    history: [...pagination.history],
    nextCursor: pagination.nextCursor
  };
  if (direction === "next" && pagination.nextCursor) {
    pagination.history.push(pagination.cursor);
    pagination.cursor = pagination.nextCursor;
  } else if (direction === "previous" && pagination.history.length > 0) {
    pagination.cursor = pagination.history.at(-1) || null;
    pagination.history.pop();
  } else {
    return;
  }

  try {
    await loadWeddings();
  } catch (error) {
    pagination.cursor = snapshot.cursor;
    pagination.history = snapshot.history;
    pagination.nextCursor = snapshot.nextCursor;
    renderWeddingPagination();
    throw error;
  }
}

function populateVenueFilter() {
  const select = document.querySelector(".js-staff-venue-filter");
  if (!select) return;
  const currentValue = select.value;
  const venues = new Map();
  (state.staff || []).forEach((staff) => {
    if (Array.isArray(staff.venues)) {
      staff.venues.forEach((venue) => venues.set(venue.id, venue.name));
    } else if (staff.venue?.id && staff.venue?.name) {
      venues.set(staff.venue.id, staff.venue.name);
    } else if (staff.venueId) {
      venues.set(staff.venueId, staff.venueName || "Salon");
    }
  });

  if (venues.size === 0) return;

  let options = '<option value="">Tüm salonlar</option>';
  venues.forEach((name, id) => {
    options += `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
  });
  select.innerHTML = options;
  select.value = currentValue;
}

function renderStaff() {
  const term =
    document.querySelector(".js-staff-search")?.value.trim().toLocaleLowerCase(APP_LOCALE) || "";
  const venueId = document.querySelector(".js-staff-venue-filter")?.value || "";
  const rows = state.staff.filter((staff) => {
    const matchesTerm = `${staff.firstName} ${staff.lastName} ${staff.phone}`
      .toLocaleLowerCase(APP_LOCALE)
      .includes(term);
    const matchesVenue =
      !venueId ||
      staff.venues?.some((venue) => venue.id === venueId) ||
      staff.venueId === venueId ||
      staff.venue?.id === venueId;
    return matchesTerm && matchesVenue;
  });
  document.querySelector(".js-staff").innerHTML = rows.length
    ? rows
        .map(
          (staff) =>
            `<article class="staff-card ${staff.isActive ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(staff.firstName[0])}${escapeHtml(staff.lastName[0])}</span><span class="status-dot ${staff.isActive ? "" : "is-passive"}">${staff.isActive ? "Aktif" : "Pasif"}</span></div><h3>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</h3><a class="staff-phone" href="tel:${escapeHtml(staff.phone.replaceAll(" ", ""))}">${escapeHtml(staff.phone)}</a><small class="staff-venue">${escapeHtml(staff.venues?.map((venue) => venue.name).join(" · ") || staff.venue?.name || "Salon atanmamış")}</small><div class="crew-line">${staff.specialties.map((specialty) => `<span class="tag">${escapeHtml(SPECIALTIES[specialty])}</span>`).join("")}</div><footer><span>${staff.assignments.length ? `${staff.assignments.length} yaklaşan görev` : "Yaklaşan görevi yok"}</span><button class="mini-button" type="button" data-edit-staff="${staff.id}" aria-label="${escapeHtml(`${staff.firstName} ${staff.lastName} personelini düzenle`)}">Düzenle</button></footer></article>`
        )
        .join("")
    : empty("Personel bulunamadı.");
}

async function loadStaff() {
  const scopeKey = state.venueScopeKey;
  if (!scopeKey) throw new Error("Salon oturumu doğrulanmadan veri yüklenemez.");
  const response = await apiRequest("/operations/staff");
  if (scopeKey !== state.venueScopeKey) return;
  const allowedVenueIds = new Set(state.venueIds);
  if (
    !Array.isArray(response.data) ||
    response.data.some((staff) =>
      (staff.venues || [staff.venue].filter(Boolean)).some(
        (venue) => !allowedVenueIds.has(venue.id)
      )
    )
  ) {
    clearVenueScopedUi();
    throw new Error("Salon kapsamı dışında veri alındı; görünüm güvenlik için temizlendi.");
  }
  state.staff = response.data;
  populateVenueFilter();
  renderStaff();
}

const staffNamePattern = /^[\p{L}\p{M}][\p{L}\p{M} '’\-]*$/u;
const staffPhonePattern = /^\+?[\d\s()\-]+$/;

function setStaffFieldError(fieldName, copy = "") {
  const input = staffForm.elements[fieldName];
  const error = staffForm.querySelector(`[data-staff-error="${fieldName}"]`);
  input?.setCustomValidity(copy);
  input?.setAttribute("aria-invalid", String(Boolean(copy)));
  if (error) error.textContent = copy;
}

function validateStaffTextField(fieldName) {
  const input = staffForm.elements[fieldName];
  const value = input.value.trim();
  let error = "";
  if (!value) error = "Bu alan zorunludur.";
  else if (value.length < 2 || value.length > 80) error = "2–80 karakter arasında bir değer yazın.";
  else if (!staffNamePattern.test(value))
    error = "Yalnızca harf, boşluk, kesme işareti ve kısa çizgi kullanın.";
  setStaffFieldError(fieldName, error);
  return !error;
}

function validateStaffPhone() {
  const input = staffForm.elements.phone;
  const value = input.value.trim();
  let error = "";
  if (!value) error = "Telefon zorunludur.";
  else if (value.length < 10 || value.length > 24)
    error = "Telefon 10–24 karakter arasında olmalıdır.";
  else if (!staffPhonePattern.test(value))
    error = "Yalnızca rakam, boşluk, +, parantez ve kısa çizgi kullanın.";
  setStaffFieldError("phone", error);
  return !error;
}

function validateStaffSpecialties() {
  const inputs = [...staffForm.querySelectorAll('[name="specialties"]')];
  const valid = inputs.some((input) => input.checked);
  const copy = valid ? "" : "En az bir uzmanlık seçin.";
  inputs[0]?.setCustomValidity(copy);
  staffForm.querySelector(".specialty-choices")?.setAttribute("aria-invalid", String(!valid));
  staffForm.querySelector(".js-specialties-error").textContent = copy;
  return valid;
}

function clearStaffFormErrors() {
  ["firstName", "lastName", "phone"].forEach((fieldName) => setStaffFieldError(fieldName));
  staffForm
    .querySelectorAll('[name="specialties"]')
    .forEach((input) => input.setCustomValidity(""));
  staffForm.querySelector(".specialty-choices")?.setAttribute("aria-invalid", "false");
  staffForm.querySelector(".js-specialties-error").textContent = "";
}

function validateStaffForm() {
  const valid = [
    validateStaffTextField("firstName"),
    validateStaffTextField("lastName"),
    validateStaffPhone(),
    validateStaffSpecialties()
  ].every(Boolean);
  if (!valid) staffForm.reportValidity();
  return valid;
}

function applyStaffApiFieldErrors(error) {
  const fieldErrors = error?.payload?.fieldErrors;
  if (!Array.isArray(fieldErrors)) return;
  fieldErrors.forEach((item) => {
    if (["firstName", "lastName", "phone"].includes(item?.field)) {
      setStaffFieldError(item.field, item.message);
    } else if (item?.field === "specialties") {
      staffForm.querySelector(".js-specialties-error").textContent = item.message;
      staffForm.querySelector(".specialty-choices")?.setAttribute("aria-invalid", "true");
    }
  });
}

function setFormBusy(form, busy, pendingLabel) {
  const controls = [...form.querySelectorAll("input, select, textarea, button")];
  if (busy) {
    formControlStates.set(
      form,
      controls.map((control) => ({ control, disabled: control.disabled }))
    );
    controls.forEach((control) => {
      control.disabled = true;
    });
    const submit = form.querySelector('[type="submit"]');
    if (submit) {
      submit.dataset.idleLabel = submit.textContent;
      submit.textContent = pendingLabel;
    }
    form.setAttribute("aria-busy", "true");
    return;
  }

  (formControlStates.get(form) || []).forEach(({ control, disabled }) => {
    control.disabled = disabled;
  });
  const submit = form.querySelector('[type="submit"]');
  if (submit?.dataset.idleLabel) {
    submit.textContent = submit.dataset.idleLabel;
    delete submit.dataset.idleLabel;
  }
  form.removeAttribute("aria-busy");
  formControlStates.delete(form);
}

function setDialogBusy(dialog, busy) {
  dialog.dataset.busy = String(busy);
  const closeButton = dialog.querySelector(".dialog-close");
  if (closeButton) closeButton.disabled = busy;
}

function clearDynamicFieldError(input) {
  input.setCustomValidity("");
  input.setAttribute("aria-invalid", "false");
  input.form?.querySelector(`[data-field-error="${input.name}"]`)?.replaceChildren();
}

function showDynamicFieldError(form, fieldName, copy) {
  const input = form.elements[fieldName];
  const error = form.querySelector(`[data-field-error="${fieldName}"]`);
  if (!input || !error) return false;
  input.setCustomValidity(copy);
  input.setAttribute("aria-invalid", "true");
  error.textContent = copy;
  return true;
}

function applyDynamicApiErrors(form, error) {
  const errors = error?.payload?.fieldErrors;
  if (!Array.isArray(errors)) return false;
  return errors.reduce((shown, item) => {
    const fieldName = String(item?.field || "")
      .split(".")
      .at(-1);
    return showDynamicFieldError(form, fieldName, item?.message || "Alanı kontrol edin.") || shown;
  }, false);
}

function showDialog(dialog, returnFocus, initialFocus) {
  if (returnFocus instanceof HTMLElement) dialogReturnFocus.set(dialog, returnFocus);
  if (dialog.open) return;
  dialog.showModal();
  window.requestAnimationFrame(() => initialFocus?.focus());
}

function closeDialog(dialog) {
  if (dialog.dataset.busy === "true") return;
  if (dialog.open) dialog.close();
}

function restoreDialogFocus(dialog) {
  const target = dialogReturnFocus.get(dialog);
  dialogReturnFocus.delete(dialog);
  if (target?.isConnected) target.focus();
}

function openStaffForm(staff = null, returnFocus = null) {
  staffForm.reset();
  clearStaffFormErrors();
  staffForm.elements.staffId.value = staff?.id || "";
  staffForm.elements.firstName.value = staff?.firstName || "";
  staffForm.elements.lastName.value = staff?.lastName || "";
  staffForm.elements.phone.value = staff?.phone || "";
  staffForm.elements.isActive.checked = staff?.isActive ?? true;
  staffForm.querySelectorAll('[name="specialties"]').forEach((input) => {
    input.checked = staff?.specialties.includes(input.value) || false;
  });
  document.querySelector(".js-staff-form-title").textContent = staff
    ? "Personeli düzenle"
    : "Personel ekle";
  staffForm.querySelector(".dialog-message").textContent = "";
  showDialog(staffDialog, returnFocus, staffForm.elements.firstName);
}

function isWeddingReadOnly(wedding) {
  return Boolean(wedding?.deletedAt || wedding?.cancelledAt);
}

function renderWeddingDetail(wedding) {
  state.currentWedding = wedding;
  weddingPdfButton.disabled = false;
  document.querySelector(".js-detail-title").textContent = couple(wedding);
  const locked = isWeddingReadOnly(wedding);
  const lockedMessage = wedding.deletedAt
    ? "Bu düğün arşivli olduğu için operasyon kontrolleri kapalıdır."
    : wedding.cancelledAt
      ? "Bu düğün iptal edildiği için operasyon kontrolleri kapalıdır."
      : "";
  const availableOptions = (wedding.availableStaff || [])
    .map(
      (staff) =>
        `<option value="${staff.id}">${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</option>`
    )
    .join("");
  const assignments = wedding.assignments || [];
  const paymentTotalCents = Number(
    wedding.paymentTotalCents ?? wedding.packageSummary?.totalPriceCents ?? 0
  );
  const paymentReceivedCents = Number(wedding.paymentReceivedCents || 0);
  const services = Array.isArray(wedding.packageSummary?.services)
    ? wedding.packageSummary.services
        .map((service) => service?.name)
        .filter(Boolean)
        .join(", ")
    : "";
  detailContainer.innerHTML = `<div class="detail-grid">
    ${locked ? `<section class="detail-card wide"><p class="dialog-message">${escapeHtml(lockedMessage)}</p></section>` : ""}
    <section class="detail-card">
      <p class="section-index">Çift ve iletişim</p>
      <strong>Gelin: ${escapeHtml(`${wedding.brideFirstName} ${wedding.brideLastName || ""}`.trim())}</strong><br>
      <span>${escapeHtml(wedding.bridePhone)}</span><br>
      <strong>Damat: ${escapeHtml(`${wedding.groomFirstName} ${wedding.groomLastName || ""}`.trim())}</strong><br>
      <span>${escapeHtml(wedding.groomPhone)}</span>
      ${wedding.primaryEmail ? `<p>${escapeHtml(wedding.primaryEmail)}</p>` : ""}
    </section>
    <section class="detail-card">
      <p class="section-index">Paket</p>
      <strong>${escapeHtml(wedding.packageSummary?.name || "Paket belirtilmedi")}</strong>
      ${services ? `<p>${escapeHtml(services)}</p>` : ""}
      <p>${escapeHtml(wedding.note || "Operasyon notu yok.")}</p>
    </section>
    <section class="detail-card wide">
      <p class="section-index">Ödeme detayları</p>
      <strong>Toplam: ${escapeHtml(formatMoney(paymentTotalCents))}</strong><br>
      <span>Kapora: ${escapeHtml(formatMoney(wedding.paymentDepositCents))}</span><br>
      <span>Alınan: ${escapeHtml(formatMoney(paymentReceivedCents))}</span><br>
      <span>Kalan: ${escapeHtml(formatMoney(Math.max(paymentTotalCents - paymentReceivedCents, 0)))}</span>
    </section>
    <section class="detail-card wide">
      <p class="section-index">Tarih, saat ve not</p>
      <strong>${escapeHtml(wedding.venue?.name || "Salon belirtilmedi")}</strong><br>
      <strong>${escapeHtml(formatDate(wedding.startsAt))}</strong><br>
      <span>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</span>
      <p>${escapeHtml(wedding.note || "Takvim notu yok.")}</p>
    </section>
    <section class="detail-card wide">
      <p class="section-index">Görevli ekip</p>
      <div>${assignments.length ? assignments.map((assignment) => `<div class="assignment-row"><span><strong>${escapeHtml(assignment.staff.firstName)} ${escapeHtml(assignment.staff.lastName)}</strong><small>${escapeHtml(SPECIALTIES[assignment.specialty])}</small></span>${locked ? "" : `<button class="mini-button" type="button" data-remove-assignment="${assignment.id}">Kaldır</button>`}</div>`).join("") : empty("Henüz personel atanmadı.")}</div>
      ${locked ? "" : `<form class="assignment-form js-assignment-form"><label>Personel<select name="staffId" aria-describedby="assignment-staff-error" required><option value="">Müsait personel seçin</option>${availableOptions}</select><span class="field-error" id="assignment-staff-error" data-field-error="staffId" aria-live="polite"></span></label><label>Uzmanlık<select name="specialty" aria-describedby="assignment-specialty-error" required><option value="">Önce personel seçin</option></select><span class="field-error" id="assignment-specialty-error" data-field-error="specialty" aria-live="polite"></span></label><button class="primary-button" type="submit">Ata</button><p class="dialog-message js-form-message" role="alert" aria-live="assertive"></p></form>`}
    </section>
  </div>`;
}

async function openWedding(weddingId, returnFocus = null, { showLoading = true } = {}) {
  const scopeKey = state.venueScopeKey;
  showDialog(weddingDialog, returnFocus, weddingDialog.querySelector(".dialog-close"));
  state.currentWedding = null;
  weddingPdfButton.disabled = true;
  if (showLoading) detailContainer.innerHTML = empty("Düğün dosyası yükleniyor…");
  try {
    if (!scopeKey) throw new Error("Salon oturumu doğrulanmadan veri yüklenemez.");
    const response = await apiRequest(`/operations/weddings/${weddingId}`);
    if (scopeKey !== state.venueScopeKey) return;
    renderWeddingDetail(response.data);
  } catch (error) {
    if (scopeKey === state.venueScopeKey) detailContainer.innerHTML = empty(error.message);
  }
}

weddingPdfButton.addEventListener("click", () => {
  if (!state.currentWedding) return;
  printWeddingReport(state.currentWedding, { venueName: state.currentWedding.venue?.name });
});

const loaders = {
  overview: loadDashboard,
  calendar: loadCalendar,
  weddings: loadWeddings,
  staff: loadStaff
};

function activePanelName() {
  return document.querySelector("[data-panel].is-active")?.dataset.panel || "overview";
}

async function refreshActivePanel() {
  await loaders[activePanelName()]?.();
}

async function refreshWeddingContext(weddingId) {
  await Promise.all([openWedding(weddingId, null, { showLoading: false }), refreshActivePanel()]);
}

function activatePanel(name) {
  document
    .querySelectorAll("[data-panel]")
    .forEach((button) => button.classList.toggle("is-active", button.dataset.panel === name));
  document.querySelectorAll("[data-panel-content]").forEach((panel) => {
    const active = panel.dataset.panelContent === name;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelector(".js-page-title").textContent = PANEL_TITLES[name];
  void loaders[name]?.().catch((error) => setMessage(error.message));
}

document.addEventListener("click", (event) => {
  const panel = event.target.closest("[data-panel]");
  const wedding = event.target.closest("[data-open-wedding]");
  if (panel) activatePanel(panel.dataset.panel);
  else if (wedding) void openWedding(wedding.dataset.openWedding, wedding);
});
document
  .querySelector("[data-close-dialog]")
  .addEventListener("click", () => closeDialog(weddingDialog));
let weddingSearchTimer = null;
weddingSearchInput?.addEventListener("input", () => {
  window.clearTimeout(weddingSearchTimer);
  state.weddingRequestId += 1;
  resetWeddingPagination();
  renderWeddingPagination();
  if (weddingSearchTerm().length === 1) {
    void loadWeddings();
    return;
  }
  weddingSearchTimer = window.setTimeout(
    () => void loadWeddings().catch((error) => setMessage(error.message)),
    250
  );
});
document.querySelector(".js-wedding-search-reset")?.addEventListener("click", () => {
  window.clearTimeout(weddingSearchTimer);
  state.weddingRequestId += 1;
  weddingSearchInput.value = "";
  resetWeddingPagination();
  void loadWeddings().catch((error) => setMessage(error.message));
});
weddingPagination?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-wedding-page]");
  if (!button) return;
  void moveWeddingPage(button.dataset.weddingPage).catch((error) => setMessage(error.message));
});
document.querySelector(".js-staff-search").addEventListener("input", renderStaff);
document.querySelector(".js-staff-venue-filter")?.addEventListener("change", renderStaff);
document.querySelector(".js-add-staff")?.addEventListener("click", () => openStaffForm());
document.querySelector(".js-staff").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-staff]");
  if (!edit) return;
  const staff = state.staff.find((item) => item.id === edit.dataset.editStaff);
  if (staff) openStaffForm(staff, edit);
});
staffForm
  .querySelectorAll('[value="cancel"]')
  .forEach((button) => button.addEventListener("click", () => closeDialog(staffDialog)));
staffForm.addEventListener("input", (event) => {
  if (["firstName", "lastName"].includes(event.target.name))
    validateStaffTextField(event.target.name);
  else if (event.target.name === "phone") validateStaffPhone();
  else if (event.target.name === "specialties") validateStaffSpecialties();
});
staffForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  if (!validateStaffForm()) return;
  const data = new FormData(staffForm);
  const staffId = data.get("staffId");
  setFormBusy(staffForm, true, "Kaydediliyor…");
  setDialogBusy(staffDialog, true);
  try {
    await apiRequest(staffId ? `/operations/staff/${staffId}` : "/operations/staff", {
      method: staffId ? "PATCH" : "POST",
      body: {
        firstName: data.get("firstName"),
        lastName: data.get("lastName"),
        phone: data.get("phone"),
        specialties: data.getAll("specialties"),
        isActive: data.has("isActive")
      }
    });
    setDialogBusy(staffDialog, false);
    closeDialog(staffDialog);
    await loadStaff();
    setMessage(staffId ? "Personel güncellendi." : "Personel eklendi.", true);
  } catch (error) {
    applyStaffApiFieldErrors(error);
    staffForm.querySelector(".dialog-message").textContent = error.message;
  } finally {
    setFormBusy(staffForm, false);
    setDialogBusy(staffDialog, false);
  }
});

detailContainer.addEventListener("change", (event) => {
  if (event.target.name !== "staffId") return;
  const staff = state.currentWedding.availableStaff.find((item) => item.id === event.target.value);
  const select = detailContainer.querySelector('[name="specialty"]');
  select.innerHTML = staff
    ? staff.specialties
        .map(
          (specialty) =>
            `<option value="${specialty}">${escapeHtml(SPECIALTIES[specialty])}</option>`
        )
        .join("")
    : '<option value="">Önce personel seçin</option>';
});
detailContainer.addEventListener("input", (event) => {
  if (event.target.matches("input, select, textarea")) clearDynamicFieldError(event.target);
});
detailContainer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isWeddingReadOnly(state.currentWedding)) {
    setMessage("İptal veya arşiv durumundaki düğünlerde operasyon değişikliği yapılamaz.");
    return;
  }
  const form = event.target;
  const data = new FormData(event.target);
  const formMessage = form.querySelector(".js-form-message");
  formMessage?.replaceChildren();
  setFormBusy(form, true, form.matches(".js-schedule-form") ? "Güncelleniyor…" : "Atanıyor…");
  setDialogBusy(weddingDialog, true);
  try {
    if (form.matches(".js-assignment-form")) {
      await apiRequest(`/operations/weddings/${state.currentWedding.id}/assignments`, {
        method: "POST",
        body: {
          staffId: data.get("staffId"),
          specialty: data.get("specialty")
        }
      });
      setMessage("Personel göreve atandı.", true);
    }
    await refreshWeddingContext(state.currentWedding.id);
  } catch (error) {
    applyDynamicApiErrors(form, error);
    formMessage?.replaceChildren(error.message);
  } finally {
    setFormBusy(form, false);
    setDialogBusy(weddingDialog, false);
  }
});
detailContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-assignment]");
  if (!button) return;
  if (isWeddingReadOnly(state.currentWedding)) {
    setMessage("İptal veya arşiv durumundaki düğünlerde atama kaldırılamaz.");
    return;
  }
  const idleLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Kaldırılıyor…";
  setDialogBusy(weddingDialog, true);
  try {
    await apiRequest(
      `/operations/weddings/${state.currentWedding.id}/assignments/${button.dataset.removeAssignment}`,
      { method: "DELETE" }
    );
    await refreshWeddingContext(state.currentWedding.id);
    setMessage("Personel ataması kaldırıldı.", true);
  } catch (error) {
    detailContainer
      .querySelector(
        ".js-assignment-form + .dialog-message, .detail-card:last-child .dialog-message"
      )
      ?.replaceChildren(error.message);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = idleLabel;
    }
    setDialogBusy(weddingDialog, false);
  }
});

document
  .querySelectorAll("[data-week-move]")
  .forEach((button) =>
    button.addEventListener(
      "click",
      () =>
        void loadDashboard(addDays(state.weekStart, Number(button.dataset.weekMove))).catch(
          (error) => setMessage(error.message)
        )
    )
  );
document.querySelector("[data-week-today]").addEventListener("click", () => {
  void loadDashboard("").catch((error) => setMessage(error.message));
});
const moveMonth = (offset) => {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1 + offset, 1));
  return probe.toISOString().slice(0, 7);
};
document
  .querySelectorAll("[data-month-move]")
  .forEach((button) =>
    button.addEventListener(
      "click",
      () =>
        void loadCalendar(moveMonth(Number(button.dataset.monthMove))).catch((error) =>
          setMessage(error.message)
        )
    )
  );
document.querySelector("[data-month-today]").addEventListener("click", () => {
  void loadCalendar("").catch((error) => setMessage(error.message));
});

document.querySelector(".js-specialties").innerHTML = Object.entries(SPECIALTIES)
  .map(
    ([key, label]) =>
      `<label><input type="checkbox" name="specialties" value="${key}"> ${escapeHtml(label)}</label>`
  )
  .join("");
document.querySelector(".js-current-date").textContent =
  `${new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, dateStyle: "long" }).format(new Date())} · ${OPERATIONS_CITY}`;
document
  .querySelectorAll(".js-logout")
  .forEach((button) =>
    button.addEventListener(
      "click",
      () => void logoutUser({ redirectTo: "login.html", replace: true, messageElement: message })
    )
  );

if (await ensureSession()) {
  await loadDashboard().catch((error) => setMessage(error.message));
}

/* UX & Klavye Kısayolları */
const toggleOpsSidebarBtn = document.querySelector(".js-toggle-ops-sidebar");
const closeOpsSidebarBtn = document.querySelector(".js-close-ops-sidebar");
const opsSidebar = document.querySelector(".ops-sidebar");
const opsSidebarOverlay = document.querySelector(".js-ops-sidebar-overlay");
const opsMain = document.querySelector(".ops-main");

function closeOpsSidebar({ restoreFocus = true } = {}) {
  const wasOpen = opsSidebar?.classList.contains("is-open");
  opsSidebar?.classList.remove("is-open");
  opsSidebarOverlay?.classList.remove("is-open");
  opsSidebarOverlay?.setAttribute("aria-hidden", "true");
  toggleOpsSidebarBtn?.setAttribute("aria-expanded", "false");
  if (opsMain) opsMain.inert = false;
  document.body.classList.remove("sidebar-open");
  if (wasOpen && restoreFocus) toggleOpsSidebarBtn?.focus();
}

function openOpsSidebar() {
  opsSidebar?.classList.add("is-open");
  opsSidebarOverlay?.classList.add("is-open");
  opsSidebarOverlay?.setAttribute("aria-hidden", "false");
  toggleOpsSidebarBtn?.setAttribute("aria-expanded", "true");
  if (opsMain) opsMain.inert = true;
  document.body.classList.add("sidebar-open");
  closeOpsSidebarBtn?.focus();
}

if (toggleOpsSidebarBtn && opsSidebar) {
  toggleOpsSidebarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (opsSidebar.classList.contains("is-open")) {
      closeOpsSidebar();
    } else {
      openOpsSidebar();
    }
  });
  closeOpsSidebarBtn?.addEventListener("click", () => closeOpsSidebar());
  opsSidebarOverlay?.addEventListener("click", () => closeOpsSidebar());
  opsSidebar.querySelectorAll("button, a").forEach((btn) => {
    if (btn !== closeOpsSidebarBtn) btn.addEventListener("click", () => closeOpsSidebar());
  });
  document.addEventListener("click", (e) => {
    if (
      opsSidebar.classList.contains("is-open") &&
      !opsSidebar.contains(e.target) &&
      !toggleOpsSidebarBtn.contains(e.target)
    ) {
      closeOpsSidebar();
    }
  });
}

[weddingDialog, staffDialog].forEach((dialog) => {
  dialog.addEventListener("cancel", (event) => {
    if (dialog.dataset.busy === "true") event.preventDefault();
  });
  dialog.addEventListener("close", () => restoreDialogFocus(dialog));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && opsSidebar?.classList.contains("is-open")) {
    event.preventDefault();
    closeOpsSidebar();
  }
});

function updateOpsBadges(metrics) {
  if (!metrics) return;
  const weddingBadge = document.querySelector(".js-badge-ops-weddings");
  if (weddingBadge) {
    if (metrics.unassignedWeddings > 0) {
      weddingBadge.textContent = metrics.unassignedWeddings;
      weddingBadge.hidden = false;
    } else {
      weddingBadge.hidden = true;
    }
  }
}
