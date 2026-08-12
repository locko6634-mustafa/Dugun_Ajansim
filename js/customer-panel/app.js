import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_ORDER } from "../shared/domain-labels.js";
import { formatAppDate } from "../shared/runtime-config.js";

const statusOrder = DELIVERY_STATUS_ORDER;
const statusLabels = DELIVERY_STATUS_LABELS;

const formatDate = (value) => formatAppDate(value, { dateStyle: "long" });

const safeDeliveryUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Geçerli bir teslimat bağlantısı alınamadı.");
  }
  if (
    url.protocol !== "https:" ||
    !["drive.google.com", "docs.google.com"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Güvenli bir teslimat bağlantısı alınamadı.");
  }
  return url.href;
};

function showContent() {
  document.querySelectorAll(".customer-hero, .event-strip, .journey-section").forEach((item) => {
    item.hidden = false;
  });
}

function hideSensitiveContent() {
  document.querySelectorAll(".customer-hero, .event-strip, .journey-section").forEach((item) => {
    item.hidden = true;
  });
  document.querySelector(".delivery-release").hidden = true;
  document.querySelector(".js-bride").textContent = "";
  document.querySelector(".js-groom").textContent = "";
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
  } catch {
    window.location.replace("login.html");
    return null;
  }
}

async function loadDashboard() {
  const response = await apiRequest("/customer/dashboard");
  const data = response.data;
  document.querySelector(".js-bride").textContent = data.couple.bride;
  document.querySelector(".js-groom").textContent = data.couple.groom;
  document.querySelector(".js-wedding-date").textContent = formatDate(data.startsAt);
  document.querySelector(".js-venue").textContent = data.venue;
  document.querySelector(".js-current-status").textContent = statusLabels[data.delivery.status];
  document.querySelector(".js-due-date").textContent = formatDate(data.delivery.dueDate);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(data.delivery.dueDate);
  dueDate.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((dueDate - today) / 86_400_000));
  document.querySelector(".js-days").textContent = days;
  document.querySelector(".js-days-label").textContent =
    data.delivery.status === "TESLIM_EDILDI" ? "teslimat tamamlandı" : "gün kaldı";

  const activeIndex = statusOrder.indexOf(data.delivery.status);
  const journeySection = document.querySelector(".journey-section");
  journeySection.style.setProperty(
    "--delivery-progress",
    `${Math.max(0, activeIndex) / (statusOrder.length - 1)}`
  );
  document.querySelector(".js-timeline").innerHTML = statusOrder
    .map(
      (status, index) => `
        <li class="${index < activeIndex ? "is-complete" : index === activeIndex ? "is-current" : ""}"${index === activeIndex ? ' aria-current="step"' : ""}>
          <small>0${index + 1}</small>
          <strong>${statusLabels[status]}</strong>
          <span>${index < activeIndex ? "Tamamlandı" : index === activeIndex ? "Şu an bu aşamada" : "Sırada"}</span>
        </li>`
    )
    .join("");

  document.querySelector(".delivery-release").hidden = !data.delivery.available;
  document.querySelector(".page-message").textContent = "";
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
    document.querySelector(".page-message").textContent = error.message;
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
      document.querySelector(".page-message").textContent = error.message;
    });
  });
});

hideSensitiveContent();
const customerSession = await ensureCustomer();
if (customerSession) {
  await loadDashboard().catch((error) => {
    document.querySelector(".page-message").textContent = error.message;
  });
}
