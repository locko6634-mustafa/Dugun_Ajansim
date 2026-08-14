import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { DELIVERY_STATUS_LABELS, STAFF_SPECIALTY_LABELS } from "../shared/domain-labels.js";
import { isAllowedDeliveryLinkUrl } from "../shared/delivery-link.js";
import { escapeHtml } from "../shared/html.js";
import {
  APP_LOCALE,
  APP_TIME_ZONE,
  OPERATIONS_CITY,
  formatAppCurrency,
  formatAppTime
} from "../shared/runtime-config.js";

const state = {
  month: "",
  venueId: "",
  calendar: null,
  currentWedding: null,
  loading: false
};

const message = document.querySelector(".global-message");
const calendar = document.querySelector(".js-calendar");
const calendarMessage = document.querySelector(".js-calendar-message");
const venueFilter = document.querySelector(".js-venue-filter");
const dialog = document.querySelector(".js-delivery-dialog");
const dialogContent = document.querySelector(".js-delivery-content");
const montageDeliveryStatuses = ["HAZIRLANIYOR", "MONTAJ", "KONTROL", "TESLIME_HAZIR"];

const setMessage = (copy, success = false) => {
  message.textContent = copy;
  message.classList.toggle("is-success", success);
};

const couple = (wedding) => `${wedding.brideFirstName} & ${wedding.groomFirstName}`;

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

const infoRow = (label, value) =>
  `<div class="info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>`;

function renderPackageInfo(summary = {}) {
  const services = Array.isArray(summary.services) ? summary.services : [];
  return `<strong class="package-name">${escapeHtml(summary.name || "Paket bilgisi yok")}</strong>${summary.code ? `<small>${escapeHtml(summary.code)}</small>` : ""}${
    services.length
      ? `<ul class="service-list">${services.map((service) => `<li><span>${escapeHtml(service.name || "Hizmet")}</span>${service.priceCents ? `<strong>${escapeHtml(formatMoney(service.priceCents))}</strong>` : ""}</li>`).join("")}</ul>`
      : '<p class="info-empty">Ek hizmet kaydı yok.</p>'
  }`;
}

function renderWeddingInformation(wedding) {
  const assignments = Array.isArray(wedding.assignments) ? wedding.assignments : [];
  const primaryContact = wedding.primaryContact === "DAMAT" ? "Damat" : "Gelin";
  return `<section class="wedding-information" aria-labelledby="wedding-information-title"><div class="information-heading"><div><p class="eyebrow">Salt okunur düğün dosyası</p><h3 id="wedding-information-title">Tüm iş bilgileri</h3></div><span>Bilgiler yalnızca görüntülenebilir</span></div><div class="wedding-info-grid">
    <article class="info-card"><h4>Planlama</h4>${infoRow("Tarih", formatDate(wedding.startsAt))}${infoRow("Saat", `${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}`)}${infoRow("Salon", wedding.venue?.name)}</article>
    <article class="info-card"><h4>Çift ve iletişim</h4>${infoRow("Gelin", `${wedding.brideFirstName || ""} ${wedding.brideLastName || ""}`.trim())}${infoRow("Gelin telefonu", wedding.bridePhone)}${infoRow("Damat", `${wedding.groomFirstName || ""} ${wedding.groomLastName || ""}`.trim())}${infoRow("Damat telefonu", wedding.groomPhone)}${infoRow("E-posta", wedding.primaryEmail)}${infoRow("Birincil iletişim", primaryContact)}</article>
    <article class="info-card"><h4>Paket ve hizmetler</h4>${renderPackageInfo(wedding.packageSummary)}</article>
    <article class="info-card"><h4>Ödeme</h4>${infoRow("Toplam tutar", formatMoney(wedding.paymentTotalCents))}${infoRow("Kapora", formatMoney(wedding.paymentDepositCents))}${infoRow("Alınan", formatMoney(wedding.paymentReceivedCents))}${infoRow("Kalan", formatMoney(wedding.paymentRemainingCents))}</article>
    <article class="info-card info-card--wide"><h4>Atanmış ekip</h4><div class="assignment-list">${
      assignments.length
        ? assignments
            .map(
              (assignment) =>
                `<div class="assignment-row"><span><strong>${escapeHtml(`${assignment.staff.firstName} ${assignment.staff.lastName}`)}</strong><small>${escapeHtml(STAFF_SPECIALTY_LABELS[assignment.specialty] || assignment.specialty)}</small></span><span>${escapeHtml(assignment.staff.phone || "Telefon yok")}</span></div>`
            )
            .join("")
        : '<p class="info-empty">Henüz personel atanmamış.</p>'
    }</div></article>
    <article class="info-card info-card--wide"><h4>Düğün notu</h4><p class="wedding-note">${escapeHtml(wedding.note || "Not eklenmemiş.")}</p></article>
    <article class="info-card info-card--wide record-card"><h4>Kayıt bilgisi</h4>${infoRow("Oluşturulma", formatDate(wedding.createdAt, true))}${infoRow("Son güncelleme", formatDate(wedding.updatedAt, true))}</article>
  </div></section>`;
}

const addMonths = (month, offset) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
};

const deliveryClass = (delivery) => {
  if (delivery?.status === "TESLIM_EDILDI") return "is-delivered";
  if (delivery?.status === "KONTROL" || delivery?.status === "TESLIME_HAZIR") return "is-ready";
  return "is-waiting";
};

const deliveryCopy = (delivery) => {
  if (!delivery) return "Teslimat kaydı yok";
  return DELIVERY_STATUS_LABELS[delivery.status] || delivery.status;
};

async function ensureSession() {
  try {
    const response = await apiRequest("/auth/session");
    if (response.data.role !== "MONTAJCI" || response.data.mustChangePassword) {
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

function renderCalendar(data) {
  state.calendar = data;
  state.month = data.month;
  state.venueId = data.selectedVenue?.id || "";
  const [year, monthNumber] = data.month.split("-").map(Number);
  document.querySelector(".js-calendar-title").textContent = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  venueFilter.innerHTML = `<option value="">Tüm salonlar</option>${data.venues
    .map(
      (venue) =>
        `<option value="${escapeHtml(venue.id)}" ${venue.id === state.venueId ? "selected" : ""}>${escapeHtml(venue.name)}</option>`
    )
    .join("")}`;

  const first = new Date(Date.UTC(year, monthNumber - 1, 1, 12));
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cellCount = leading + daysInMonth <= 35 ? 35 : 42;
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - leading);
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const probe = new Date(gridStart);
    probe.setUTCDate(gridStart.getUTCDate() + index);
    return probe.toISOString().slice(0, 10);
  });

  calendar.innerHTML = cells
    .map((day) => {
      const events = data.weddings.filter((wedding) => dateKey(wedding.startsAt) === day);
      const date = new Date(`${day}T12:00:00.000Z`);
      const outside = day.slice(0, 7) !== data.month;
      const weekday = new Intl.DateTimeFormat(APP_LOCALE, { weekday: "short" }).format(date);
      return `<article class="calendar-day ${outside ? "is-outside" : ""} ${events.length ? "" : "is-empty"} ${day === data.today ? "is-today" : ""}" aria-label="${escapeHtml(formatDate(date))}"><div class="day-heading"><span class="day-number">${date.getUTCDate()}</span><span class="day-name">${escapeHtml(weekday)}</span></div><div class="calendar-events">${events
        .map(
          (wedding) =>
            `<button class="calendar-event ${deliveryClass(wedding.delivery)}" type="button" data-open-wedding="${escapeHtml(wedding.id)}"><time>${formatAppTime(wedding.startsAt)}–${formatAppTime(wedding.endsAt)}</time><strong>${escapeHtml(couple(wedding))}</strong><small>${escapeHtml(wedding.venue.name)} · ${escapeHtml(deliveryCopy(wedding.delivery))}</small></button>`
        )
        .join("")}</div></article>`;
    })
    .join("");
  calendarMessage.textContent = data.weddings.length
    ? ""
    : "Seçilen ay ve salon için planlı düğün yok.";
}

async function loadCalendar(month = state.month, venueId = state.venueId) {
  if (state.loading) return;
  state.loading = true;
  calendar.setAttribute("aria-busy", "true");
  calendarMessage.textContent = "Takvim yükleniyor…";
  document.querySelectorAll("[data-month-move], [data-month-today]").forEach((button) => {
    button.disabled = true;
  });
  try {
    const query = new window.URLSearchParams();
    if (month) query.set("month", month);
    if (venueId) query.set("venueId", venueId);
    const response = await apiRequest(`/montage/calendar${query.size ? `?${query}` : ""}`);
    renderCalendar(response.data);
    setMessage("");
  } catch (error) {
    calendarMessage.textContent = `Takvim yüklenemedi: ${error.message}`;
    throw error;
  } finally {
    state.loading = false;
    calendar.setAttribute("aria-busy", "false");
    document.querySelectorAll("[data-month-move], [data-month-today]").forEach((button) => {
      button.disabled = false;
    });
  }
}

function syncDeliveryButtons() {
  const form = dialogContent.querySelector(".js-delivery-form");
  if (!form) return;
  const submit = form.querySelector(".deliver-button");
  const driveUrl = form.elements.driveUrl.value.trim();
  submit.disabled =
    form.elements.status.value !== "TESLIME_HAZIR" ||
    !form.elements.sharingConfirmed.checked ||
    !isAllowedDeliveryLinkUrl(driveUrl);
}

function validateDeliveryLinkInput(form, { required = false } = {}) {
  const input = form.elements.driveUrl;
  const value = input.value.trim();
  input.setCustomValidity("");
  if ((required && !value) || (value && !isAllowedDeliveryLinkUrl(value))) {
    input.setCustomValidity(
      "HTTPS kullanan geçerli bir Google Drive veya WeTransfer bağlantısı girin."
    );
    input.reportValidity();
    return false;
  }
  return true;
}

function renderWeddingDetail(wedding) {
  state.currentWedding = wedding;
  document.querySelector(".js-dialog-title").textContent = couple(wedding);
  const delivery = wedding.delivery;
  const information = renderWeddingInformation(wedding);
  const status = `<div class="status-banner"><strong>${escapeHtml(deliveryCopy(delivery))}</strong><span>${delivery ? `Son teslim ${escapeHtml(formatDate(delivery.dueDate))}${delivery.isStatusManuallyControlled ? " · Manuel yönetim aktif" : ""}` : "Teslimat oluşturulmamış"}</span></div>`;
  let deliveryAction = "";
  if (!delivery) {
    deliveryAction =
      '<p class="waiting-note">Bu düğün için teslimat kaydı bulunmuyor. Yöneticiyle iletişime geçin.</p>';
  } else if (delivery.status === "TESLIM_EDILDI") {
    deliveryAction = `<p class="delivered-note"><strong>Teslim tamamlandı.</strong><br />Müşteri erişimi ${escapeHtml(formatDate(delivery.releasedAt, true))} tarihinde açıldı.</p>`;
  } else {
    const statusOptions = montageDeliveryStatuses
      .map(
        (statusValue) =>
          `<option value="${statusValue}" ${delivery.status === statusValue ? "selected" : ""}>${escapeHtml(DELIVERY_STATUS_LABELS[statusValue])}</option>`
      )
      .join("");
    deliveryAction = `<form class="delivery-form js-delivery-form"><label class="delivery-field">Teslimat durumu<select name="status">${statusOptions}</select><small>Seçtiğiniz durum tarih akışından bağımsız kalır ve otomasyon tarafından değiştirilmez.</small></label><label class="delivery-field">Google Drive veya WeTransfer bağlantısı<input name="driveUrl" type="url" maxlength="2000" placeholder="https://drive.google.com/... veya https://we.tl/..." value="${escapeHtml(delivery.driveUrl || "")}" autocomplete="off" /><small>Bağlantının müşterinin oturum açmadan erişebileceği şekilde paylaşıldığından emin olun.</small></label><button class="status-save-button" type="submit">Durumu ve bağlantıyı kaydet</button><label class="confirm-row"><input name="sharingConfirmed" type="checkbox" /><span>Bağlantı erişimini kontrol ettim ve müşteriye açılmasını onaylıyorum.</span></label><button class="deliver-button" type="button" disabled>Bağlantıyı doğrula ve teslim et</button><p class="form-message" role="alert" aria-live="assertive"></p></form>`;
  }
  dialogContent.innerHTML = `<section class="delivery-workbench" aria-labelledby="delivery-workbench-title"><div class="workbench-heading"><div><p class="eyebrow">Öncelikli işlem</p><h3 id="delivery-workbench-title">Teslimat yönetimi</h3></div><span class="workbench-index">01</span></div>${status}${deliveryAction}</section>${information}`;
  const form = dialogContent.querySelector(".js-delivery-form");
  if (!form) return;
  form.addEventListener("input", () => {
    form.elements.driveUrl.setCustomValidity("");
    syncDeliveryButtons();
  });
  form.addEventListener("change", syncDeliveryButtons);
  form.addEventListener("submit", saveDelivery);
  form.querySelector(".deliver-button").addEventListener("click", submitDelivery);
  syncDeliveryButtons();
}

async function openWedding(weddingId, trigger) {
  dialogContent.innerHTML = '<p class="waiting-note">Teslimat bilgileri yükleniyor…</p>';
  if (!dialog.open) dialog.showModal();
  dialog.dataset.returnFocus = trigger ? weddingId : "";
  try {
    const response = await apiRequest(`/montage/weddings/${weddingId}`);
    renderWeddingDetail(response.data);
  } catch (error) {
    dialogContent.innerHTML = `<p class="waiting-note">${escapeHtml(error.message)}</p>`;
  }
}

async function saveDelivery(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (
    !form.reportValidity() ||
    !validateDeliveryLinkInput(form) ||
    !state.currentWedding?.delivery
  ) {
    return;
  }
  const submit = form.querySelector(".status-save-button");
  const formMessage = form.querySelector(".form-message");
  submit.disabled = true;
  submit.textContent = "Kaydediliyor…";
  formMessage.textContent = "";
  try {
    await apiRequest(`/montage/deliveries/${state.currentWedding.delivery.id}`, {
      method: "PATCH",
      body: {
        status: form.elements.status.value,
        driveUrl: form.elements.driveUrl.value.trim() || null
      }
    });
    setMessage(`${couple(state.currentWedding)} teslimat bilgileri kaydedildi.`, true);
    await Promise.all([
      openWedding(state.currentWedding.id),
      loadCalendar(state.month, state.venueId)
    ]);
  } catch (error) {
    formMessage.textContent = error.message;
    submit.disabled = false;
    submit.textContent = "Durumu ve bağlantıyı kaydet";
  }
}

async function submitDelivery(event) {
  const submit = event.currentTarget;
  const form = submit.closest("form");
  if (
    !state.currentWedding?.delivery ||
    form.elements.status.value !== "TESLIME_HAZIR" ||
    !form.elements.sharingConfirmed.checked ||
    !validateDeliveryLinkInput(form, { required: true })
  ) {
    return;
  }
  const formMessage = form.querySelector(".form-message");
  submit.disabled = true;
  submit.textContent = "Bağlantı doğrulanıyor…";
  formMessage.textContent = "";
  try {
    await apiRequest(`/montage/deliveries/${state.currentWedding.delivery.id}`, {
      method: "PATCH",
      body: {
        status: "TESLIME_HAZIR",
        driveUrl: form.elements.driveUrl.value.trim()
      }
    });
    await apiRequest(`/montage/deliveries/${state.currentWedding.delivery.id}/deliver`, {
      method: "POST",
      body: {
        sharingConfirmed: true,
        sharingConfirmation: "ERİŞİMİ DOĞRULADIM"
      }
    });
    setMessage(`${couple(state.currentWedding)} teslimatı tamamlandı.`, true);
    await Promise.all([
      openWedding(state.currentWedding.id),
      loadCalendar(state.month, state.venueId)
    ]);
  } catch (error) {
    formMessage.textContent = error.message;
    submit.disabled = false;
    submit.textContent = "Bağlantıyı doğrula ve teslim et";
  }
}

calendar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-wedding]");
  if (button) void openWedding(button.dataset.openWedding, button);
});

document.querySelectorAll("[data-month-move]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!state.month) return;
    void loadCalendar(addMonths(state.month, Number(button.dataset.monthMove)), state.venueId);
  });
});

document.querySelector("[data-month-today]").addEventListener("click", () => {
  state.month = "";
  void loadCalendar("", state.venueId);
});

venueFilter.addEventListener("change", () => {
  state.venueId = venueFilter.value;
  void loadCalendar(state.month, state.venueId);
});

document.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  const returnButton = dialog.dataset.returnFocus
    ? calendar.querySelector(
        `[data-open-wedding="${window.CSS.escape(dialog.dataset.returnFocus)}"]`
      )
    : null;
  returnButton?.focus();
  delete dialog.dataset.returnFocus;
});

document.querySelector(".js-logout").addEventListener("click", () => {
  void logoutUser({ redirectTo: "login.html", replace: true, messageElement: message });
});

document.querySelector(".montage-intro .eyebrow").textContent = `${new Intl.DateTimeFormat(
  APP_LOCALE,
  { timeZone: APP_TIME_ZONE, dateStyle: "long" }
).format(new Date())} · ${OPERATIONS_CITY}`;

if (await ensureSession()) {
  await loadCalendar().catch((error) => setMessage(error.message));
}
