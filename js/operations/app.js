import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { STAFF_SPECIALTY_LABELS } from "../shared/domain-labels.js";
import {
  APP_LOCALE,
  APP_TIME_ZONE,
  OPERATIONS_CITY,
  formatAppTime
} from "../shared/runtime-config.js";
import { escapeHtml } from "../shared/html.js";

const SPECIALTIES = STAFF_SPECIALTY_LABELS;
const PANEL_TITLES = {
  overview: "Bugünün akışı",
  calendar: "Salon takvimi",
  weddings: "Düğün planı",
  staff: "Salon ekibi"
};
const state = {
  dashboard: null,
  weekStart: "",
  calendarMonth: "",
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
const staffDialog = document.querySelector(".js-staff-dialog");
const staffForm = document.querySelector(".js-staff-form");
const weddingSearchInput = document.querySelector(".js-wedding-search");
const weddingPagination = document.querySelector(".js-wedding-pagination");

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
const inputTime = (value) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`;
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

async function ensureSession() {
  try {
    const response = await apiRequest("/auth/session");
    if (response.data.role !== "SALON_YETKILISI" || response.data.mustChangePassword) {
      window.location.replace("login.html");
      return false;
    }
    document.querySelector(".js-username").textContent = response.data.username;
    document.querySelector(".js-user-initial").textContent =
      response.data.username[0].toUpperCase();
    return true;
  } catch {
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
  state.dashboard = data;
  state.weekStart = data.weekStart;
  document.querySelectorAll(".js-venue-name").forEach((node) => {
    node.textContent = data.venue.name;
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
            `<article class="event-card"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><div><strong>${escapeHtml(couple(wedding))}</strong><small>${wedding.assignments.length} personel atandı</small><div class="crew-line">${crew(wedding.assignments)}</div></div><button type="button" data-open-wedding="${wedding.id}">Planla</button></article>`
        )
        .join("")
    : empty("Bugün salonunuzda planlı düğün yok.");
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
            `<button class="week-item" type="button" data-open-wedding="${wedding.id}"><strong>${formatAppTime(wedding.startsAt)} · ${escapeHtml(couple(wedding))}</strong><small>${wedding.assignments.length} kişilik ekip</small></button>`
        )
        .join("")}</article>`;
    })
    .join("");
}

async function loadDashboard(weekStart = state.weekStart) {
  const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : "";
  const response = await apiRequest(`/operations/dashboard${query}`);
  renderDashboard(response.data);
}

function renderCalendar(data) {
  state.calendarMonth = data.month;
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
            `<button class="calendar-event ${wedding.assignments.length ? "" : "is-unassigned"}" type="button" data-open-wedding="${wedding.id}"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><strong>${escapeHtml(couple(wedding))}</strong><small>${wedding.assignments.length ? `${wedding.assignments.length} kişilik ekip` : "Ekip atanmadı"}</small></button>`
        )
        .join("")}</div></article>`;
    })
    .join("");
  document.querySelector(".js-calendar-empty").hidden = data.weddings.length > 0;
}

async function loadCalendar(month = state.calendarMonth) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  const response = await apiRequest(`/operations/calendar${query}`);
  renderCalendar(response.data);
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
          return `<article class="wedding-card"><div class="date-tile"><strong>${new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, day: "2-digit" }).format(date)}</strong><small>${new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, month: "short" }).format(date)}</small></div><div><strong>${escapeHtml(couple(wedding))}</strong><p>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</p></div><div class="crew-line">${crew(wedding.assignments)}</div><button class="mini-button" type="button" data-open-wedding="${wedding.id}">Ayrıntılar</button></article>`;
        })
        .join("")
    : empty(term ? "Aramanızla eşleşen düğün yok." : "Planlanmış düğün yok.");
  renderWeddingPagination();
}

async function loadWeddings() {
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
    if (requestId !== state.weddingRequestId) return;
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
    if (staff.venue?.id && staff.venue?.name) {
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
    const matchesVenue = !venueId || staff.venueId === venueId || staff.venue?.id === venueId;
    return matchesTerm && matchesVenue;
  });
  document.querySelector(".js-staff").innerHTML = rows.length
    ? rows
        .map(
          (staff) =>
            `<article class="staff-card ${staff.isActive ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(staff.firstName[0])}${escapeHtml(staff.lastName[0])}</span><span class="status-dot ${staff.isActive ? "" : "is-passive"}">${staff.isActive ? "Aktif" : "Pasif"}</span></div><h3>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</h3><a class="staff-phone" href="tel:${escapeHtml(staff.phone.replaceAll(" ", ""))}">${escapeHtml(staff.phone)}</a><small class="staff-venue">${escapeHtml(staff.venue?.name || "Salon atanmamış")}</small><div class="crew-line">${staff.specialties.map((specialty) => `<span class="tag">${escapeHtml(SPECIALTIES[specialty])}</span>`).join("")}</div><footer><span>${staff.assignments.length ? `${staff.assignments.length} yaklaşan görev` : "Yaklaşan görevi yok"}</span><button class="mini-button" type="button" data-edit-staff="${staff.id}">Düzenle</button><button class="mini-button" type="button" data-toggle-staff="${staff.id}" data-active="${staff.isActive}">${staff.isActive ? "Pasife al" : "Aktifleştir"}</button></footer></article>`
        )
        .join("")
    : empty("Personel bulunamadı.");
}

async function loadStaff() {
  const response = await apiRequest("/operations/staff");
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
  staffForm.querySelector(".js-specialties-error").textContent = copy;
  return valid;
}

function clearStaffFormErrors() {
  ["firstName", "lastName", "phone"].forEach((fieldName) => setStaffFieldError(fieldName));
  staffForm
    .querySelectorAll('[name="specialties"]')
    .forEach((input) => input.setCustomValidity(""));
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
    }
  });
}

function openStaffForm(staff = null) {
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
  staffDialog.showModal();
}

function isWeddingReadOnly(wedding) {
  return Boolean(wedding?.deletedAt || wedding?.cancelledAt);
}

function renderWeddingDetail(wedding) {
  state.currentWedding = wedding;
  document.querySelector(".js-detail-title").textContent = couple(wedding);
  const startDate = dateKey(wedding.startsAt);
  const endDate = dateKey(wedding.endsAt);
  const locked = isWeddingReadOnly(wedding);
  const disabled = locked ? ' disabled aria-disabled="true"' : "";
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
  detailContainer.innerHTML = `<div class="detail-grid">${locked ? `<section class="detail-card wide"><p class="dialog-message">${escapeHtml(lockedMessage)}</p></section>` : ""}<section class="detail-card"><p class="section-index">İletişim</p><strong>${escapeHtml(wedding.brideFirstName)}: ${escapeHtml(wedding.bridePhone)}</strong><br><strong>${escapeHtml(wedding.groomFirstName)}: ${escapeHtml(wedding.groomPhone)}</strong></section><section class="detail-card"><p class="section-index">Paket</p><strong>${escapeHtml(wedding.packageSummary?.name || "Paket belirtilmedi")}</strong><p>${escapeHtml(wedding.note || "Operasyon notu yok.")}</p></section><section class="detail-card wide"><p class="section-index">Takvim düzenle</p><form class="form-grid js-schedule-form"><label>Tarih<input name="weddingDate" type="date" value="${startDate}" required${disabled}></label><label>Başlangıç<input name="startTime" type="time" value="${inputTime(wedding.startsAt)}" required${disabled}></label><label>Bitiş<input name="endTime" type="time" value="${inputTime(wedding.endsAt)}" required${disabled}></label><label class="switch-row"><input name="endsNextDay" type="checkbox" ${startDate !== endDate ? "checked" : ""}${disabled}> Bitiş ertesi gün</label><label class="wide">Operasyon notu<textarea name="note"${disabled}>${escapeHtml(wedding.note || "")}</textarea></label><button class="primary-button wide" type="submit"${disabled}>Takvimi güncelle</button></form></section><section class="detail-card wide"><p class="section-index">Görevli ekip</p><div>${assignments.length ? assignments.map((assignment) => `<div class="assignment-row"><span><strong>${escapeHtml(assignment.staff.firstName)} ${escapeHtml(assignment.staff.lastName)}</strong><small>${escapeHtml(SPECIALTIES[assignment.specialty])}</small></span>${locked ? "" : `<button class="mini-button" type="button" data-remove-assignment="${assignment.id}">Kaldır</button>`}</div>`).join("") : empty("Henüz personel atanmadı.")}</div>${locked ? "" : `<form class="assignment-form js-assignment-form"><select name="staffId" required><option value="">Müsait personel seçin</option>${availableOptions}</select><select name="specialty" required><option value="">Önce personel seçin</option></select><button class="primary-button" type="submit">Ata</button></form>`}<p class="dialog-message" role="status"></p></section></div>`;
}

async function openWedding(weddingId) {
  if (!weddingDialog.open) weddingDialog.showModal();
  detailContainer.innerHTML = empty("Düğün dosyası yükleniyor…");
  try {
    const response = await apiRequest(`/operations/weddings/${weddingId}`);
    renderWeddingDetail(response.data);
  } catch (error) {
    detailContainer.innerHTML = empty(error.message);
  }
}

const loaders = {
  overview: loadDashboard,
  calendar: loadCalendar,
  weddings: loadWeddings,
  staff: loadStaff
};
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
  else if (wedding) void openWedding(wedding.dataset.openWedding);
});
document
  .querySelector("[data-close-dialog]")
  .addEventListener("click", () => weddingDialog.close());
let weddingSearchTimer = null;
weddingSearchInput.addEventListener("input", () => {
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
document.querySelector(".js-wedding-search-reset").addEventListener("click", () => {
  window.clearTimeout(weddingSearchTimer);
  state.weddingRequestId += 1;
  weddingSearchInput.value = "";
  resetWeddingPagination();
  void loadWeddings().catch((error) => setMessage(error.message));
});
weddingPagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-wedding-page]");
  if (!button) return;
  void moveWeddingPage(button.dataset.weddingPage).catch((error) => setMessage(error.message));
});
document.querySelector(".js-staff-search").addEventListener("input", renderStaff);
document.querySelector(".js-staff-venue-filter")?.addEventListener("change", renderStaff);
document.querySelector(".js-add-staff").addEventListener("click", () => openStaffForm());
document.querySelector(".js-staff").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-staff]");
  const toggle = event.target.closest("[data-toggle-staff]");
  if (edit) openStaffForm(state.staff.find((staff) => staff.id === edit.dataset.editStaff));
  else if (toggle)
    void apiRequest(`/operations/staff/${toggle.dataset.toggleStaff}`, {
      method: "PATCH",
      body: { isActive: toggle.dataset.active !== "true" }
    })
      .then(() => Promise.all([loadStaff(), loadDashboard()]))
      .then(() => setMessage("Personel durumu güncellendi.", true))
      .catch((error) => setMessage(error.message));
});
staffForm
  .querySelectorAll('[value="cancel"]')
  .forEach((button) => button.addEventListener("click", () => staffDialog.close()));
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
  const submitButton = staffForm.querySelector(".js-staff-submit");
  const submitLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Kaydediliyor…";
  staffForm.setAttribute("aria-busy", "true");
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
    staffDialog.close();
    await Promise.all([loadStaff(), loadDashboard()]);
    setMessage(staffId ? "Personel güncellendi." : "Personel eklendi.", true);
  } catch (error) {
    applyStaffApiFieldErrors(error);
    staffForm.querySelector(".dialog-message").textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
    staffForm.removeAttribute("aria-busy");
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
detailContainer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isWeddingReadOnly(state.currentWedding)) {
    setMessage("İptal veya arşiv durumundaki düğünlerde operasyon değişikliği yapılamaz.");
    return;
  }
  const data = new FormData(event.target);
  try {
    if (event.target.matches(".js-schedule-form")) {
      await apiRequest(`/operations/weddings/${state.currentWedding.id}`, {
        method: "PATCH",
        body: {
          weddingDate: data.get("weddingDate"),
          startTime: data.get("startTime"),
          endTime: data.get("endTime"),
          endsNextDay: data.has("endsNextDay"),
          note: data.get("note")
        }
      });
      setMessage("Düğün takvimi güncellendi.", true);
    } else if (event.target.matches(".js-assignment-form")) {
      await apiRequest(`/operations/weddings/${state.currentWedding.id}/assignments`, {
        method: "POST",
        body: {
          staffId: data.get("staffId"),
          specialty: data.get("specialty")
        }
      });
      setMessage("Personel göreve atandı.", true);
    }
    await Promise.all([
      openWedding(state.currentWedding.id),
      loadDashboard(),
      loadWeddings(),
      loadCalendar()
    ]);
  } catch (error) {
    event.target
      .closest(".detail-card")
      .querySelector(".dialog-message")
      ?.replaceChildren(error.message);
    setMessage(error.message);
  }
});
detailContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-assignment]");
  if (!button) return;
  if (isWeddingReadOnly(state.currentWedding)) {
    setMessage("İptal veya arşiv durumundaki düğünlerde atama kaldırılamaz.");
    return;
  }
  try {
    await apiRequest(
      `/operations/weddings/${state.currentWedding.id}/assignments/${button.dataset.removeAssignment}`,
      { method: "DELETE" }
    );
    await Promise.all([openWedding(state.currentWedding.id), loadDashboard(), loadWeddings()]);
    setMessage("Personel ataması kaldırıldı.", true);
  } catch (error) {
    setMessage(error.message);
  }
});

document
  .querySelectorAll("[data-week-move]")
  .forEach((button) =>
    button.addEventListener(
      "click",
      () => void loadDashboard(addDays(state.weekStart, Number(button.dataset.weekMove)))
    )
  );
document.querySelector("[data-week-today]").addEventListener("click", () => {
  state.weekStart = "";
  void loadDashboard();
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
      () => void loadCalendar(moveMonth(Number(button.dataset.monthMove)))
    )
  );
document.querySelector("[data-month-today]").addEventListener("click", () => {
  state.calendarMonth = "";
  void loadCalendar();
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

function closeOpsSidebar() {
  opsSidebar?.classList.remove("is-open");
  opsSidebarOverlay?.classList.remove("is-open");
  document.body.classList.remove("sidebar-open");
}

function openOpsSidebar() {
  opsSidebar?.classList.add("is-open");
  opsSidebarOverlay?.classList.add("is-open");
  document.body.classList.add("sidebar-open");
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
    btn.addEventListener("click", () => closeOpsSidebar());
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeOpsSidebar();
    if (weddingDialog?.open) weddingDialog.close();
    if (staffDialog?.open) staffDialog.close();
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
