import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_ORDER } from "../shared/domain-labels.js";
import { normalizeDeliveryLinkUrl } from "../shared/delivery-link.js";
import { clearErrorFeedback, renderErrorFeedback } from "../shared/error-feedback.js";
import { APP_TIME_ZONE, formatAppDate } from "../shared/runtime-config.js";

const statusOrder = DELIVERY_STATUS_ORDER;
const statusLabels = DELIVERY_STATUS_LABELS;
const pageMessage = document.querySelector(".page-message");

const reloadPage = () => window.location.reload();

function showPanelError(error, title) {
  renderErrorFeedback(pageMessage, error, {
    title,
    retryAction: reloadPage,
    actionLabel: "Sayfayı yeniden dene",
    focus: true
  });
}

const formatDate = (value) => formatAppDate(value, { dateStyle: "long" });

const calendarDayInIstanbul = (value) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type) => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
};

const safeDeliveryUrl = (value) => {
  try {
    return normalizeDeliveryLinkUrl(value);
  } catch {
    throw new Error("Güvenli bir teslimat bağlantısı alınamadı.");
  }
};

function showContent() {
  document.querySelectorAll(".customer-hero, .event-strip, .journey-section").forEach((item) => {
    item.hidden = false;
  });
}

const STATUS_ICONS = Object.freeze({
  HAZIRLANIYOR: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  MONTAJ: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  KONTROL: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
  TESLIME_HAZIR: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><polyline points="8 13 12 9 16 13"/></svg>`,
  TESLIM_EDILDI: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
});

let countdownTimerId = null;

function clearCountdownTimer() {
  if (countdownTimerId !== null) {
    window.clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
}

function startCountdownTimer(dueDateValue, status) {
  clearCountdownTimer();

  const daysEl = document.querySelector(".js-days");
  const hoursEl = document.querySelector(".js-countdown-hours");
  const minutesEl = document.querySelector(".js-countdown-minutes");
  const secondsEl = document.querySelector(".js-countdown-seconds");
  const labelEl = document.querySelector(".js-days-label");

  const isDelivered = status === "TESLIM_EDILDI";
  if (isDelivered) {
    if (daysEl) daysEl.textContent = "0";
    if (hoursEl) hoursEl.textContent = "00";
    if (minutesEl) minutesEl.textContent = "00";
    if (secondsEl) secondsEl.textContent = "00";
    if (labelEl) labelEl.textContent = "teslimat tamamlandı";
    return;
  }

  const targetDate = new Date(dueDateValue);
  const targetTime = new Date(targetDate);
  if (targetTime.getUTCHours() === 0 && targetTime.getUTCMinutes() === 0) {
    targetTime.setUTCHours(20, 59, 59, 999);
  }

  const update = () => {
    const now = Date.now();
    const diffMs = targetTime.getTime() - now;
    const calendarDays = calendarDayInIstanbul(dueDateValue) - calendarDayInIstanbul(new Date());

    if (diffMs <= 0) {
      if (daysEl) daysEl.textContent = String(Math.abs(calendarDays));
      if (hoursEl) hoursEl.textContent = "00";
      if (minutesEl) minutesEl.textContent = "00";
      if (secondsEl) secondsEl.textContent = "00";
      if (labelEl) labelEl.textContent = calendarDays < 0 ? "gün gecikti" : "bugün teslim ediliyor";
      return;
    }

    const totalSec = Math.floor(diffMs / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    if (daysEl) daysEl.textContent = String(d);
    if (hoursEl) hoursEl.textContent = String(h).padStart(2, "0");
    if (minutesEl) minutesEl.textContent = String(m).padStart(2, "0");
    if (secondsEl) secondsEl.textContent = String(s).padStart(2, "0");
    if (labelEl) labelEl.textContent = "gün kaldı";
  };

  update();
  countdownTimerId = window.setInterval(update, 1000);
}

function hideSensitiveContent() {
  clearCountdownTimer();
  document.querySelectorAll(".customer-hero, .event-strip, .journey-section").forEach((item) => {
    item.hidden = true;
  });
  document.querySelector(".delivery-release").hidden = true;
  document.querySelector(".js-bride").textContent = "";
  document.querySelector(".js-groom").textContent = "";
  const monogram = document.querySelector(".js-couple-monogram");
  if (monogram) monogram.textContent = "DA";
  document.querySelector(".js-timeline").replaceChildren();
}

async function ensureCustomer() {
  try {
    const session = await apiRequest("/auth/session");
    if (session.data.role !== "MUSTERI" || session.data.mustChangePassword) {
      window.location.replace("login.html");
      return null;
    }
    return session.data;
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      window.location.replace("login.html");
      return null;
    }
    showPanelError(error, "Güvenli oturum doğrulanamadı");
    return null;
  }
}

async function loadDashboard() {
  const response = await apiRequest("/customer/dashboard");
  const data = response.data;
  const bride = data.couple.bride;
  const groom = data.couple.groom;

  document.querySelector(".js-bride").textContent = bride;
  document.querySelector(".js-groom").textContent = groom;

  const brideInitial = (bride || "").trim().charAt(0).toLocaleUpperCase("tr-TR");
  const groomInitial = (groom || "").trim().charAt(0).toLocaleUpperCase("tr-TR");
  const monogramEl = document.querySelector(".js-couple-monogram");
  if (monogramEl) {
    monogramEl.textContent =
      brideInitial && groomInitial ? `${brideInitial} & ${groomInitial}` : "DA";
  }

  document.querySelector(".js-wedding-date").textContent = formatDate(data.startsAt);
  document.querySelector(".js-venue").textContent = data.venue;
  document.querySelector(".js-current-status").textContent = statusLabels[data.delivery.status];
  document.querySelector(".js-due-date").textContent = formatDate(data.delivery.dueDate);

  startCountdownTimer(data.delivery.dueDate, data.delivery.status);

  const activeIndex = statusOrder.indexOf(data.delivery.status);
  const journeySection = document.querySelector(".journey-section");
  journeySection.style.setProperty(
    "--delivery-progress",
    `${Math.max(0, activeIndex) / (statusOrder.length - 1)}`
  );

  document.querySelector(".js-timeline").innerHTML = statusOrder
    .map((status, index) => {
      const isComplete = index < activeIndex;
      const isCurrent = index === activeIndex;
      const statusClass = isComplete ? "is-complete" : isCurrent ? "is-current" : "";
      const ariaCurrent = isCurrent ? ' aria-current="step"' : "";
      const iconSvg = STATUS_ICONS[status] || "";
      const stateText = isComplete ? "Tamamlandı" : isCurrent ? "Şu an bu aşamada" : "Sırada";

      return `
        <li class="${statusClass}"${ariaCurrent}>
          <div class="timeline-step-badge">
            <span class="timeline-step-icon" aria-hidden="true">${iconSvg}</span>
            <small class="timeline-step-num">0${index + 1}</small>
          </div>
          <div class="timeline-content">
            <strong>${statusLabels[status]}</strong>
            <span class="timeline-state">${stateText}</span>
          </div>
        </li>`;
    })
    .join("");

  document.querySelector(".delivery-release").hidden = !data.delivery.available;
  clearErrorFeedback(pageMessage);
  showContent();
}

document.querySelector(".js-open-delivery").addEventListener("click", async () => {
  const button = document.querySelector(".js-open-delivery");
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  button.disabled = true;
  try {
    const response = await apiRequest("/customer/delivery");
    const driveUrl = safeDeliveryUrl(response.data.driveUrl);
    if (!popup) {
      throw new Error(
        "Teslimat penceresi tarayıcı tarafından engellendi. Açılır pencerelere izin verip tekrar deneyin."
      );
    }
    popup.location.href = driveUrl;
  } catch (error) {
    popup?.close();
    renderErrorFeedback(pageMessage, error, {
      title: "Teslimat bağlantısı açılamadı",
      focus: true
    });
  } finally {
    button.disabled = false;
  }
});

document.querySelector(".js-logout").addEventListener("click", async () => {
  hideSensitiveContent();
  await logoutUser({
    redirectTo: "login.html",
    replace: true,
    messageElement: document.querySelector(".page-message")
  });
});

window.addEventListener("pagehide", hideSensitiveContent);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  hideSensitiveContent();
  void ensureCustomer().then((session) => {
    if (!session) return;
    void loadDashboard().catch((error) => {
      showPanelError(error, "Teslimat bilgileri yüklenemedi");
    });
  });
});

hideSensitiveContent();
const customerSession = await ensureCustomer();
if (customerSession) {
  await loadDashboard().catch((error) => {
    showPanelError(error, "Teslimat bilgileri yüklenemedi");
  });
}
