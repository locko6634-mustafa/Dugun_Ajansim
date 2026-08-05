import { apiRequest } from "../shared/api-client.js";
import {
  showCustomConfirm,
  showCustomPrompt,
  showCatalogFormModal
} from "../shared/custom-dialogs.js";

const SPECIALTIES = {
  PHOTOGRAPHY: "Fotoğraf",
  VIDEO: "Video",
  DRONE: "Drone",
  JIMMY_JIB: "Jimmy Jib",
  ASSISTANT: "Asistan",
  EDITING: "Kurgu / Montaj",
  ALBUM: "Albüm"
};
const STATUS_LABELS = {
  HAZIRLANIYOR: "Hazırlanıyor",
  MONTAJ: "Montaj",
  KONTROL: "Kontrol",
  TESLIME_HAZIR: "Teslime Hazır",
  TESLIM_EDILDI: "Teslim Edildi"
};
const MESSAGE_LABELS = {
  ACCOUNT_ACTIVATION: "Hesap aktivasyonu",
  PREPARATION_UPDATE: "Hazırlık bilgisi",
  DELIVERY_READY: "Teslimat hazır",
  PASSWORD_RESET: "Parola sıfırlama"
};
const state = {
  dashboard: null,
  weekStart: "",
  calendar: null,
  calendarMonth: "",
  calendarVenueId: "",
  weddings: [],
  staff: [],
  managers: [],
  venues: [],
  packages: [],
  services: [],
  currentWedding: null
};

const globalMessage = document.querySelector(".global-message");
const detailDialog = document.querySelector(".js-wedding-detail");
const detailContent = document.querySelector(".js-wedding-detail-content");
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
  { title, copy, confirmation = "", button = "Kalıcı sil" },
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
  dangerForm.querySelector(".js-danger-message").textContent = "";
  dangerForm.querySelector(".js-danger-submit").textContent = button;
  dangerDialog.showModal();
  setTimeout(
    () => (confirmation ? input : dangerForm.querySelector(".js-danger-submit")).focus(),
    0
  );
  return new Promise((resolve) => {
    const done = (accepted) => {
      dangerDialog.removeEventListener("close", closed);
      resolve(accepted ? input.value.trim() || true : null);
      dangerTrigger?.focus();
      dangerTrigger = null;
    };
    const closed = () => done(false);
    dangerDialog.addEventListener("close", closed, { once: true });
    dangerForm.onsubmit = (event) => {
      event.preventDefault();
      if (confirmation && !input.value.trim()) {
        dangerForm.querySelector(".js-danger-message").textContent =
          "Devam etmek için onay metnini yazın.";
        input.focus();
        return;
      }
      done(true);
      dangerDialog.close();
    };
  });
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatDate = (value, includeTime = false) =>
  value
    ? new Intl.DateTimeFormat("tr-TR", {
        timeZone: includeTime ? "Europe/Istanbul" : "UTC",
        dateStyle: "medium",
        ...(includeTime ? { timeStyle: "short" } : {})
      }).format(new Date(value))
    : "—";

const formatTime = (value) =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const formatMoney = (cents) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0
  }).format(Number(cents || 0) / 100);

const datePartInIstanbul = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));

const timePartInIstanbul = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
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

const empty = (message) => `<p class="empty-state">${escapeHtml(message)}</p>`;
const coupleName = (wedding) =>
  `${wedding.brideFirstName} ${wedding.brideLastName || ""} & ${wedding.groomFirstName} ${wedding.groomLastName || ""}`
    .replaceAll(/\s+/g, " ")
    .trim();

const safePhoneHref = (phone) => `tel:${String(phone || "").replace(/[^+\d]/g, "")}`;

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
    <div class="event-time"><strong>${formatTime(wedding.startsAt)}</strong><small>${formatTime(wedding.endsAt)}</small></div>
    <div class="event-copy"><strong>${escapeHtml(coupleName(wedding))}</strong><small>${escapeHtml(wedding.venue.name)} · ${escapeHtml(wedding.packageSummary?.name || "Paket belirtilmedi")}</small><div class="crew-line">${renderCrew(wedding.assignments)}</div></div>
    <button class="mini-button" type="button" data-open-wedding="${escapeHtml(wedding.id)}">Dosyayı aç</button>
  </article>`;
}

function compactWedding(wedding) {
  return `<button class="compact-card text-button" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><span><strong>${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}</strong><small>${escapeHtml(wedding.venue.name)}</small></span><time>${formatTime(wedding.startsAt)}</time></button>`;
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
  document.querySelector(".js-idle-staff").innerHTML = data.idleStaff.length
    ? data.idleStaff
        .map((staff) => `<span>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</span>`)
        .join("")
    : empty("Bugün tüm ekip görevde.");
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
    const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "short", timeZone: "UTC" }).format(
      dateValue
    );
    const day = new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
      timeZone: "UTC"
    }).format(dateValue);
    return `<section class="day-column ${date === data.today ? "is-today" : ""}"><div class="day-head"><strong>${escapeHtml(day)}</strong><span>${escapeHtml(weekday)}</span></div><div class="day-events">${
      weddings.length
        ? weddings
            .map(
              (wedding) =>
                `<button class="day-event text-button ${wedding.assignments.length ? "" : "is-unassigned"}" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><time>${formatTime(wedding.startsAt)}–${formatTime(wedding.endsAt)}</time><strong>${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}</strong><small>${escapeHtml(wedding.venue.name)} · ${wedding.assignments.length} kişi</small></button>`
            )
            .join("")
        : '<p class="empty-state">Plan yok</p>'
    }</div></section>`;
  }).join("");
  const distElem = document.querySelector(".js-distribution");
  if (distElem) {
    distElem.innerHTML = Object.entries(SPECIALTIES)
      .map(
        ([key, label]) =>
          `<article class="distribution-item"><strong>${data.distribution[key] || 0}</strong><span>${escapeHtml(label)}</span></article>`
      )
      .join("");
  }
}

async function loadDashboard(weekStart = state.weekStart) {
  const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : "";
  const response = await apiRequest(`/admin/dashboard${query}`);
  state.dashboard = response.data;
  state.weekStart = response.data.weekStart;
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
  document.querySelector(".js-calendar-label").textContent = `${new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(monthDate)} · ${data.selectedVenue?.name || "Salon yok"}`;

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
    const weekday = new Intl.DateTimeFormat("tr-TR", {
      weekday: "short",
      timeZone: "UTC"
    }).format(dateValue);
    return `<section class="calendar-day ${outside ? "is-outside" : ""} ${events.length ? "" : "is-empty"} ${date === data.today ? "is-today" : ""}" aria-label="${escapeHtml(formatDate(`${date}T00:00:00.000Z`))}"><div class="calendar-day__head"><span class="calendar-day__number">${dateValue.getUTCDate()}</span><span class="calendar-day__weekday">${escapeHtml(weekday)}</span></div><div class="calendar-events">${events
      .map(
        (wedding) =>
          `<button class="calendar-event ${wedding.assignments.length ? "" : "is-unassigned"}" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><time>${formatTime(wedding.startsAt)}–${formatTime(wedding.endsAt)}</time><strong>${escapeHtml(wedding.brideFirstName)} &amp; ${escapeHtml(wedding.groomFirstName)}</strong><small>${wedding.assignments.length ? `${wedding.assignments.length} kişilik ekip` : "Ekip atanmadı"}</small></button>`
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
  const filter = document.querySelector(".js-application-filter").value;
  const referenceCode = document.querySelector(".js-application-reference").value.trim();
  const query = new window.URLSearchParams();
  if (filter === "ARCHIVED") query.set("includeArchived", "true");
  else if (filter) query.set("status", filter);
  if (referenceCode) query.set("referenceCode", referenceCode);
  container.innerHTML = empty("Başvurular yükleniyor…");
  try {
    const response = await apiRequest(
      `/admin/booking-applications${query.size ? `?${query}` : ""}`
    );
    container.innerHTML = response.data.length
      ? response.data
          .map(
            (item) =>
              `<article class="data-row"><div><strong>${escapeHtml(item.brideFirstName)} &amp; ${escapeHtml(item.groomFirstName)}</strong><small>${escapeHtml(item.referenceCode)}</small></div><div><small>Paket</small><strong>${escapeHtml(item.packageNameSnapshot)}</strong></div><div><small>Tarih</small><strong>${formatDate(item.weddingStartsAt, true)}</strong></div><div class="data-row__actions">${
                item.deletedAt
                  ? `<button class="mini-button" type="button" data-restore-application="${item.id}">Geri Yükle</button><button class="mini-button mini-button--danger" type="button" data-delete-application="${item.id}" data-confirm="${escapeHtml(item.referenceCode)}">Kalıcı Sil</button>`
                  : item.status === "ONAY_BEKLIYOR"
                    ? `<button class="mini-button mini-button--primary" type="button" data-approve="${item.id}">Onayla</button><button class="mini-button mini-button--danger" type="button" data-reject="${item.id}">Reddet</button><button class="mini-button" type="button" data-archive-application="${item.id}">Arşivle</button>`
                    : item.status === "REDDEDILDI"
                      ? `<button class="mini-button" type="button" data-archive-application="${item.id}">Arşivle</button>`
                      : `<small>${escapeHtml(item.status.replaceAll("_", " "))}</small>`
              }</div></article>`
          )
          .join("")
      : empty("Bu durumda başvuru yok.");
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

async function loadWeddings() {
  const container = document.querySelector(".js-weddings");
  container.innerHTML = empty("Düğünler yükleniyor…");
  try {
    const archived = document.querySelector(".js-wedding-status").value === "ARCHIVED";
    const response = await apiRequest(`/admin/weddings${archived ? "?includeArchived=true" : ""}`);
    state.weddings = response.data;
    renderWeddings();
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

function renderWeddings() {
  const term = document.querySelector(".js-wedding-search").value.trim().toLocaleLowerCase("tr-TR");
  const status = document.querySelector(".js-wedding-status").value;
  const rows = state.weddings.filter((wedding) => {
    const haystack =
      `${coupleName(wedding)} ${wedding.bridePhone} ${wedding.groomPhone} ${wedding.venue.name}`.toLocaleLowerCase(
        "tr-TR"
      );
    return (
      (!term || haystack.includes(term)) &&
      (!status || status === "ARCHIVED" || wedding.delivery?.status === status)
    );
  });
  document.querySelector(".js-weddings").innerHTML = rows.length
    ? rows
        .map((wedding) => {
          const date = new Date(wedding.startsAt);
          const day = new Intl.DateTimeFormat("tr-TR", {
            day: "2-digit",
            timeZone: "Europe/Istanbul"
          }).format(date);
          const month = new Intl.DateTimeFormat("tr-TR", {
            month: "short",
            timeZone: "Europe/Istanbul"
          }).format(date);
          return `<article class="wedding-card"><div class="date-tile"><strong>${day}</strong><span>${escapeHtml(month)}</span></div><div><h3>${escapeHtml(coupleName(wedding))}</h3><p>${escapeHtml(wedding.venue.name)} · ${formatTime(wedding.startsAt)}</p></div><div class="status-cell"><span class="status-dot" data-status="${escapeHtml(wedding.delivery?.status || "")}">${escapeHtml(STATUS_LABELS[wedding.delivery?.status] || "Teslimat yok")}</span><small class="delivery-date">${formatDate(wedding.delivery?.dueDate)}</small></div><div><div class="crew-line">${renderCrew(wedding.assignments)}</div></div><button class="mini-button" type="button" data-open-wedding="${escapeHtml(wedding.id)}">Ayrıntılar</button></article>`;
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

function renderWeddingDetail(wedding) {
  const delivery = wedding.delivery;
  const assignedIds = new Set(wedding.assignments.map((assignment) => assignment.staffId));
  const available = wedding.availableStaff.filter((staff) => !assignedIds.has(staff.id));
  document.querySelector(".js-detail-title").textContent = coupleName(wedding);
  detailContent.innerHTML = `<section class="detail-hero"><div class="detail-hero__meta"><span>${formatDate(wedding.startsAt, true)}</span><span>${escapeHtml(wedding.venue.name)}</span><span>${escapeHtml(STATUS_LABELS[delivery?.status] || "Teslimat yok")}</span></div><div class="detail-actions">${wedding.deletedAt ? `<button class="secondary-button" type="button" data-restore-wedding="${wedding.id}">Geri Yükle</button>` : `<button class="secondary-button" type="button" data-edit-current>Düğün bilgilerini düzenle</button><button class="secondary-button" type="button" data-reset-user="${escapeHtml(wedding.customerUser.id)}">Müşteri parolasını sıfırla</button><button class="secondary-button" type="button" data-archive-wedding="${wedding.id}">Arşivle</button>`}</div></section>
  <div class="detail-grid">
    <section class="detail-block"><h3>Çift ve iletişim</h3><div class="contact-line"><span>${escapeHtml(wedding.brideFirstName)} ${escapeHtml(wedding.brideLastName)}</span><a href="${safePhoneHref(wedding.bridePhone)}">${escapeHtml(wedding.bridePhone)}</a></div><div class="contact-line"><span>${escapeHtml(wedding.groomFirstName)} ${escapeHtml(wedding.groomLastName)}</span><a href="${safePhoneHref(wedding.groomPhone)}">${escapeHtml(wedding.groomPhone)}</a></div><div class="contact-line"><span>E-posta</span><a href="mailto:${escapeHtml(wedding.primaryEmail)}">${escapeHtml(wedding.primaryEmail)}</a></div></section>
    <section class="detail-block"><h3>Paket</h3>${packageDetail(wedding.packageSummary)}${wedding.note ? `<p>${escapeHtml(wedding.note)}</p>` : ""}</section>
    <section class="detail-block wide"><h3>Teslimat</h3>${
      delivery
        ? `<div class="delivery-controls" data-delivery-row="${delivery.id}"><select data-field="status" aria-label="Teslimat durumu" ${delivery.status === "TESLIM_EDILDI" ? "disabled" : ""}>${Object.entries(
            STATUS_LABELS
          )
            .filter(([key]) => key !== "TESLIM_EDILDI" || delivery.status === "TESLIM_EDILDI")
            .map(
              ([key, label]) =>
                `<option value="${key}" ${delivery.status === key ? "selected" : ""}>${escapeHtml(label)}</option>`
            )
            .join(
              ""
            )}</select><input data-field="dueDate" type="date" aria-label="Teslim tarihi" value="${String(delivery.dueDate).slice(0, 10)}" ${delivery.status === "TESLIM_EDILDI" ? "disabled" : ""} /><input data-field="driveUrl" type="url" aria-label="Google Drive bağlantısı" placeholder="Google Drive bağlantısı" value="${escapeHtml(delivery.driveUrl || "")}" ${delivery.status === "TESLIM_EDILDI" ? "disabled" : ""} /><button class="mini-button" type="button" data-save-delivery="${delivery.id}" ${delivery.status === "TESLIM_EDILDI" ? "disabled" : ""}>Kaydet</button><button class="mini-button mini-button--primary" type="button" data-deliver="${delivery.id}" ${delivery.status !== "TESLIME_HAZIR" || !delivery.hasDriveUrl ? "disabled" : ""}>Teslim Et</button></div>`
        : empty("Teslimat kaydı yok.")
    }</section>
    <section class="detail-block wide"><h3>Personel dağılımı</h3><div class="assignment-list">${
      wedding.assignments.length
        ? wedding.assignments
            .map(
              (assignment) =>
                `<div class="assignment-item"><span><strong>${escapeHtml(assignment.staff.firstName)} ${escapeHtml(assignment.staff.lastName)}</strong><small>${escapeHtml(SPECIALTIES[assignment.specialty])}</small></span><button class="mini-button mini-button--danger" type="button" data-remove-assignment="${escapeHtml(assignment.id)}">Kaldır</button></div>`
            )
            .join("")
        : empty("Henüz personel atanmadı.")
    }</div><form class="assignment-form js-assignment-form"><select name="staffId" aria-label="Müsait personel" required><option value="">Müsait personel seçin</option>${available
      .map(
        (staff) =>
          `<option value="${staff.id}">${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)} · ${staff.specialties.map((key) => SPECIALTIES[key]).join(", ")}</option>`
      )
      .join(
        ""
      )}</select><select name="specialty" aria-label="Görev" required><option value="">Görev seçin</option></select><button class="mini-button mini-button--primary" type="submit">Ata</button></form></section>
    <section class="detail-block wide danger-zone"><h3>Tehlikeli işlemler</h3><p>Kalıcı silme; atamaları, mesaj görevlerini ve teslimat operasyon kayıtlarını geri alınamaz şekilde siler. Denetim kayıtları korunur.</p><button class="mini-button mini-button--danger" type="button" data-delete-wedding="${wedding.id}" data-confirm="${escapeHtml(coupleName(wedding))}">Kalıcı Sil</button></section>
    <section class="detail-block wide"><h3>Mesaj geçmişi</h3><div class="message-timeline">${
      wedding.messageTasks.length
        ? wedding.messageTasks
            .map(
              (task) =>
                `<article class="timeline-item ${task.status === "SENT" ? "is-sent" : ""}"><span><strong>${escapeHtml(MESSAGE_LABELS[task.kind] || task.kind)}</strong><small>${escapeHtml(task.recipientPhone)} · Planlanan ${formatDate(task.dueAt, true)}</small></span><span><strong>${task.status === "SENT" ? "Gönderildi" : task.status === "PENDING" ? "Bekliyor" : "İptal"}</strong><small>${task.sentAt ? formatDate(task.sentAt, true) : "—"}</small></span></article>`
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
    const response = await apiRequest("/admin/staff");
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
}

function renderStaff() {
  const term = document.querySelector(".js-staff-search").value.trim().toLocaleLowerCase("tr-TR");
  const specialty = document.querySelector(".js-staff-specialty-filter").value;
  const active = document.querySelector(".js-staff-active-filter").value;
  const rows = state.staff.filter((staff) => {
    const matchesTerm = `${staff.firstName} ${staff.lastName} ${staff.phone}`
      .toLocaleLowerCase("tr-TR")
      .includes(term);
    const matchesSpecialty = !specialty || staff.specialties.includes(specialty);
    const matchesActive =
      active === "all" || (active === "active" ? staff.isActive : !staff.isActive);
    return matchesTerm && matchesSpecialty && matchesActive;
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
  staffForm.querySelector(".dialog-message").textContent = "";
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
              `<article class="staff-card ${manager.status === "ACTIVE" ? "" : "is-passive"}"><div class="staff-card__head"><span class="avatar">${escapeHtml(manager.username.slice(0, 2).toUpperCase())}</span><span class="status-dot" data-status="${manager.status === "ACTIVE" ? "TESLIM_EDILDI" : ""}">${manager.status === "ACTIVE" ? "Aktif" : "Pasif"}</span></div><h3>${escapeHtml(manager.username)}</h3><p>${escapeHtml(manager.venue?.name || "Salon atanmamış")}</p><small>${manager.lastLoginAt ? `Son giriş: ${formatDate(manager.lastLoginAt, true)}` : "Henüz giriş yapmadı"}</small><footer><span>${manager.mustChangePassword ? "Parola değişimi bekleniyor" : "Hesap hazır"}</span><button class="mini-button" type="button" data-edit-manager="${manager.id}">Düzenle</button></footer></article>`
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

async function loadMessages() {
  const container = document.querySelector(".js-messages");
  container.innerHTML = empty("Mesaj kayıtları yükleniyor…");
  try {
    const response = await apiRequest("/admin/message-tasks");
    container.innerHTML = response.data.length
      ? response.data
          .map(
            (task) =>
              `<article class="data-row"><div><strong>${escapeHtml(task.wedding.brideFirstName)} &amp; ${escapeHtml(task.wedding.groomFirstName)}</strong><small>${escapeHtml(MESSAGE_LABELS[task.kind] || task.kind)}</small></div><div><small>Alıcı</small><strong>${escapeHtml(task.recipientPhone)}</strong></div><div><small>${task.status === "SENT" ? "Gönderilen" : "Planlanan"}</small><strong>${formatDate(task.sentAt || task.dueAt, true)}</strong></div><div class="data-row__actions">${
                task.status === "PENDING"
                  ? `<button class="mini-button mini-button--primary" type="button" data-open-message="${task.id}">WhatsApp</button><button class="mini-button" type="button" data-mark-sent="${task.id}" data-task-updated-at="${escapeHtml(task.updatedAt)}">Gönderildi</button>`
                  : `<span class="status-dot" data-status="TESLIM_EDILDI">Gönderildi</span>`
              }</div></article>`
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
      const img = item.imagePath || "assets/images/hero-couple.webp";
      const priceFormatted = (item.priceCents / 100).toLocaleString("tr-TR");
      const subInfo = [
        `Kod: ${escapeHtml(item.code)}`,
        !isPackage && item.category ? `Kategori: ${escapeHtml(item.category)}` : null,
        !isPackage && item.eyebrow ? `Rozet: ${escapeHtml(item.eyebrow)}` : null
      ]
        .filter(Boolean)
        .join(" • ");

      return `
        <article class="catalog-row" data-catalog-row="${item.id}" data-catalog-type="${type}" data-catalog-name="${escapeHtml(item.name)}" style="display: flex; align-items: center; gap: 16px; padding: 14px 16px; border-bottom: 1px solid var(--color-border, #eee);">
          <div class="catalog-thumb" style="width: 56px; height: 56px; border-radius: 8px; overflow: hidden; background: #f3f4f6; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.08);">
            <img src="${escapeHtml(img)}" alt="${escapeHtml(item.name)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='assets/images/hero-couple.webp'" />
          </div>
          <div class="catalog-info" style="flex: 1; min-width: 150px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-size: 15px; color: var(--color-text, #111);">${escapeHtml(item.name)}</strong>
              <span class="status-dot ${item.isActive ? "status-dot--active" : "status-dot--disabled"}" style="font-size: 11px; padding: 2px 8px; border-radius: 12px; background: ${item.isActive ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)"}; color: ${item.isActive ? "#10b981" : "#ef4444"}; font-weight: 600;">
                ${item.isActive ? "Yayında" : "Gizli"}
              </span>
            </div>
            <small style="display: block; color: var(--color-muted, #666); font-size: 12px; margin-top: 2px;">${subInfo}</small>
            ${
              item.description
                ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: var(--color-subtext, #555); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">${escapeHtml(item.description)}</p>`
                : `<p style="margin: 4px 0 0 0; font-size: 11px; color: var(--color-muted, #aaa); italic;">Açıklama belirtilmemiş.</p>`
            }
          </div>
          <div class="catalog-price" style="text-align: right; min-width: 90px; flex-shrink: 0;">
            <small style="display: block; color: var(--color-muted, #777); font-size: 11px;">Fiyat</small>
            <strong style="font-size: 16px; color: var(--color-primary, #b89354);">₺${priceFormatted}</strong>
          </div>
          <div class="catalog-actions" style="display: flex; gap: 6px; flex-shrink: 0;">
            <button class="mini-button mini-button--primary catalog-edit" type="button" data-edit-catalog="${item.id}">Düzenle</button>
            <button class="mini-button mini-button--danger catalog-delete" type="button" data-delete-catalog="${item.id}">Sil</button>
          </div>
        </article>`;
    })
    .join("");
}

async function loadCatalogAdmin() {
  const [packagesResponse, servicesResponse] = await Promise.all([
    apiRequest("/admin/packages"),
    apiRequest("/admin/services")
  ]);
  state.packages = packagesResponse.data;
  state.services = servicesResponse.data;
  renderCatalogRows(document.querySelector(".js-packages"), state.packages, "packages");
  renderCatalogRows(document.querySelector(".js-services"), state.services, "services");
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
document.querySelector("[data-close-dialog]").addEventListener("click", () => detailDialog.close());
detailDialog.addEventListener("click", (event) => {
  if (event.target === detailDialog) detailDialog.close();
});

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
  void loadApplications();
});
document
  .querySelector(".js-application-filter")
  .addEventListener("change", () => void loadApplications());
document.querySelector(".js-applications").addEventListener("click", async (event) => {
  const approveButton = event.target.closest("[data-approve]");
  const rejectButton = event.target.closest("[data-reject]");
  const archiveButton = event.target.closest("[data-archive-application]");
  const restoreButton = event.target.closest("[data-restore-application]");
  const deleteButton = event.target.closest("[data-delete-application]");
  try {
    if (approveButton) {
      await apiRequest(`/admin/booking-applications/${approveButton.dataset.approve}/approve`, {
        method: "POST"
      });
      setMessage("Başvuru onaylandı; düğün ve teslimat planı oluşturuldu.", true);
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
    } else if (archiveButton) {
      const accepted = await requestDangerConfirmation(
        {
          title: "Başvuruyu arşivle",
          copy: "Başvuru normal listelerden kaldırılır; istediğiniz zaman geri yükleyebilirsiniz.",
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
    } else if (restoreButton) {
      await apiRequest(
        `/admin/booking-applications/${restoreButton.dataset.restoreApplication}/restore`,
        { method: "POST" }
      );
      setMessage("Başvuru geri yüklendi.", true);
    } else if (deleteButton) {
      const confirmation = await requestDangerConfirmation(
        {
          title: "Başvuruyu kalıcı sil",
          copy: "Bu işlem geri alınamaz. Başvuru ve bağlı hizmet seçimleri silinecektir.",
          confirmation: deleteButton.dataset.confirm,
          button: "Kalıcı Sil"
        },
        deleteButton
      );
      if (confirmation === null) return;
      deleteButton.disabled = true;
      await apiRequest(`/admin/booking-applications/${deleteButton.dataset.deleteApplication}`, {
        method: "DELETE",
        body: { confirmText: confirmation }
      });
      setMessage("Başvuru kalıcı olarak silindi.", true);
    } else return;
    await Promise.all([loadApplications(), loadDashboard()]);
  } catch (error) {
    if (deleteButton) deleteButton.disabled = false;
    setMessage(error.message);
  }
});

document.querySelector(".js-wedding-search").addEventListener("input", renderWeddings);
document.querySelector(".js-wedding-status").addEventListener("change", () => void loadWeddings());

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
    await apiRequest(`/admin/weddings/${state.currentWedding.id}/assignments`, {
      method: "POST",
      body: { ...body, allowConflict: true }
    });
  }
  setMessage("Personel düğüne atandı.", true);
  await Promise.all([openWeddingDetail(state.currentWedding.id), loadDashboard(), loadWeddings()]);
});

detailContent.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-current]");
  const saveButton = event.target.closest("[data-save-delivery]");
  const deliverButton = event.target.closest("[data-deliver]");
  const resetButton = event.target.closest("[data-reset-user]");
  const removeButton = event.target.closest("[data-remove-assignment]");
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
      await apiRequest(`/admin/deliveries/${saveButton.dataset.saveDelivery}`, {
        method: "PATCH",
        body: {
          status: row.querySelector('[data-field="status"]').value,
          dueDate: row.querySelector('[data-field="dueDate"]').value,
          ...(driveUrl ? { driveUrl } : {})
        }
      });
      setMessage("Teslimat bilgileri kaydedildi.", true);
    } else if (deliverButton) {
      const confirmed = await showCustomConfirm({
        title: "Teslimatı Onayla ve Bildir",
        message: "Drive bağlantısını müşteriye açıp teslim mesajını hazırlamak istiyor musunuz?",
        confirmText: "Teslim Et",
        cancelText: "Vazgeç"
      });
      if (!confirmed) return;
      await apiRequest(`/admin/deliveries/${deliverButton.dataset.deliver}/deliver`, {
        method: "POST"
      });
      setMessage("Teslimat müşteriye açıldı ve mesaj görevi oluşturuldu.", true);
    } else if (resetButton) {
      const confirmed = await showCustomConfirm({
        title: "Geçici Parola Oluştur",
        message: "Müşteri için yeni geçici parola hazırlansın mı?",
        confirmText: "Parola Hazırla",
        cancelText: "Vazgeç"
      });
      if (!confirmed) return;
      const response = await apiRequest(
        `/admin/customers/${resetButton.dataset.resetUser}/reset-password`,
        { method: "POST" }
      );
      window.open(response.data.whatsappUrl, "_blank", "noopener");
      setMessage("Geçici parola mesajı hazırlandı.", true);
    } else if (archiveWeddingButton) {
      const accepted = await requestDangerConfirmation(
        {
          title: "Düğünü arşivle",
          copy: "Düğün; plan, takvim, bugün/yarın ve yaklaşan teslimatlardan kaldırılır. Geri yüklenebilir.",
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
          button: "Kalıcı Sil"
        },
        deleteWeddingButton
      );
      if (confirmation === null) return;
      deleteWeddingButton.disabled = true;
      await apiRequest(`/admin/weddings/${deleteWeddingButton.dataset.deleteWedding}`, {
        method: "DELETE",
        body: { confirmText: confirmation }
      });
      detailDialog.close();
      setMessage("Düğün kalıcı olarak silindi.", true);
    } else if (removeButton) {
      const accepted = await requestDangerConfirmation(
        {
          title: "Personel atamasını kaldır",
          copy: "Bu işlem yalnızca atamayı kaldırır; geçmiş düğün ve personel kayıtları silinmez.",
          button: "Atamayı kaldır"
        },
        removeButton
      );
      if (accepted === null) return;
      removeButton.disabled = true;
      await apiRequest(
        `/admin/weddings/${state.currentWedding.id}/assignments/${removeButton.dataset.removeAssignment}`,
        { method: "DELETE" }
      );
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
        button: "Devam et"
      },
      deleteButton
    ).then(async (confirmation) => {
      if (confirmation === null) return;
      deleteButton.disabled = true;
      try {
        const response = await apiRequest(`/admin/staff/${deleteButton.dataset.deleteStaff}`, {
          method: "DELETE",
          body: { confirmText: confirmation }
        });
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
[".js-staff-search", ".js-staff-specialty-filter", ".js-staff-active-filter"].forEach(
  (selector) => {
    document
      .querySelector(selector)
      .addEventListener(selector.includes("search") ? "input" : "change", renderStaff);
  }
);
staffForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => staffDialog.close());
});
staffForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
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
  try {
    await apiRequest(staffId ? `/admin/staff/${staffId}` : "/admin/staff", {
      method: staffId ? "PATCH" : "POST",
      body
    });
    staffDialog.close();
    setMessage(staffId ? "Personel güncellendi." : "Personel eklendi.", true);
    await Promise.all([loadStaff(), loadDashboard()]);
  } catch (error) {
    staffForm.querySelector(".dialog-message").textContent = error.message;
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
    await apiRequest(managerId ? `/admin/venue-managers/${managerId}` : "/admin/venue-managers", {
      method: managerId ? "PATCH" : "POST",
      body
    });
    managerDialog.close();
    setMessage(managerId ? "Salon sorumlusu güncellendi." : "Salon sorumlusu eklendi.", true);
    await loadManagers();
  } catch (error) {
    managerForm.querySelector(".dialog-message").textContent = error.message;
  }
});

document.querySelector(".js-messages").addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-open-message]");
  const sentButton = event.target.closest("[data-mark-sent]");
  try {
    if (openButton) {
      const popup = window.open("about:blank", "_blank");
      try {
        const response = await apiRequest(
          `/admin/message-tasks/${openButton.dataset.openMessage}/render`
        );
        if (popup) {
          popup.opener = null;
          popup.location.href = response.data.whatsappUrl;
        } else window.location.href = response.data.whatsappUrl;
        const markButton = document.querySelector(
          `[data-mark-sent="${openButton.dataset.openMessage}"]`
        );
        if (markButton) markButton.dataset.taskUpdatedAt = response.data.expectedUpdatedAt;
      } catch (error) {
        popup?.close();
        throw error;
      }
    } else if (sentButton) {
      await apiRequest(`/admin/message-tasks/${sentButton.dataset.markSent}/mark-sent`, {
        method: "POST",
        body: { expectedUpdatedAt: sentButton.dataset.taskUpdatedAt }
      });
      await Promise.all([loadMessages(), loadDashboard()]);
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
      const itemsList = type === "packages" ? state.packages : state.services;
      const currentItem = itemsList.find((i) => i.id === itemId);

      if (!currentItem) return;

      const formData = await showCatalogFormModal({
        type,
        title: type === "packages" ? "Paket Bilgilerini Düzenle" : "Ek Hizmet Bilgilerini Düzenle",
        initialData: currentItem
      });

      if (!formData) return;

      const body = {
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
      } else {
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
      const typeLabel = row.dataset.catalogType === "packages" ? "Temel paketi" : "Ek hizmeti";
      const name = row.dataset.catalogName || "Katalog kaydı";
      const accepted = await showCustomConfirm({
        title: `${typeLabel} Sil`,
        message: `"${name}" seçeneğini silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`,
        badge: "SİLME ONAYI",
        confirmText: "Sil",
        cancelText: "Vazgeç",
        isDanger: true
      });
      if (!accepted) return;
      try {
        await apiRequest(`/admin/${row.dataset.catalogType}/${row.dataset.catalogRow}`, {
          method: "DELETE"
        });
        await loadCatalogAdmin();
        setMessage(`${typeLabel} silindi.`, true);
      } catch (error) {
        setMessage(error.message);
      }
    }
  });

document.querySelectorAll("[data-add-catalog]").forEach((button) => {
  button.addEventListener("click", async () => {
    const type = button.dataset.addCatalog;
    const formData = await showCatalogFormModal({
      type,
      title: type === "packages" ? "Yeni Paket Oluştur" : "Yeni Ek Hizmet Oluştur"
    });
    if (!formData) return;

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
    manualForm.querySelector(".dialog-message").textContent = error.message;
  }
});

async function openWeddingEditor(wedding) {
  await ensureVenues();
  weddingForm.querySelector(".js-wedding-venue").innerHTML = state.venues
    .map(
      (venue) =>
        `<option value="${venue.id}" ${venue.id === wedding.venueId ? "selected" : ""}>${escapeHtml(venue.name)}</option>`
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
  weddingDialog.showModal();
}

weddingForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => weddingDialog.close());
});
weddingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  const data = new FormData(weddingForm);
  const weddingId = data.get("weddingId");
  try {
    const response = await apiRequest(`/admin/weddings/${weddingId}`, {
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
        note: data.get("note") || undefined
      }
    });
    weddingDialog.close();
    setMessage(
      response.data.credentialsRegenerated
        ? `Düğün güncellendi. Yeni kullanıcı adı: ${response.data.username}.`
        : "Düğün bilgileri güncellendi.",
      true
    );
    await Promise.all([openWeddingDetail(weddingId), loadWeddings(), loadDashboard()]);
  } catch (error) {
    weddingForm.querySelector(".dialog-message").textContent = error.message;
  }
});

async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("login.html");
  }
}
document
  .querySelectorAll(".js-logout")
  .forEach((button) => button.addEventListener("click", () => void logout()));

document.querySelector(".js-current-date").textContent = `${new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  dateStyle: "long"
}).format(new Date())} · İstanbul`;

if (await ensureAdmin()) {
  await loadDashboard().catch((error) => setMessage(error.message));
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
