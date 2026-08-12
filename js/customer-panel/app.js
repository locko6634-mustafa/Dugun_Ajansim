import { apiRequest } from "../shared/api-client.js";
import { logoutUser } from "../shared/auth-session.js";
import { initTrustedDevices } from "../shared/trusted-devices.js";
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
  document
    .querySelectorAll(".customer-hero, .event-strip, .journey-section, .security-section")
    .forEach((item) => {
      item.hidden = false;
    });
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

const mfaState = { enrollmentPassword: "" };
const mfaMessage = document.querySelector(".js-mfa-message");
const enrollForm = document.querySelector(".js-mfa-enroll-form");
const enrollmentPanel = document.querySelector(".js-mfa-enrollment");
const confirmForm = document.querySelector(".js-mfa-confirm-form");
const disableForm = document.querySelector(".js-mfa-disable-form");

function setMfaMessage(message, isError = false) {
  mfaMessage.textContent = message;
  mfaMessage.classList.toggle("is-error", isError);
}

function setMfaUi(enabled) {
  document.querySelector(".js-mfa-status").textContent = enabled ? "Etkin" : "Etkin değil";
  enrollForm.hidden = enabled;
  disableForm.hidden = !enabled;
  enrollmentPanel.hidden = true;
  mfaState.enrollmentPassword = "";
  confirmForm.reset();
}

function readSafeEnrollment(data) {
  const secret = typeof data?.secret === "string" ? data.secret : "";
  const otpauthUri = typeof data?.otpauthUri === "string" ? data.otpauthUri : "";
  if (!/^[A-Z2-7]{32}$/.test(secret)) {
    throw new Error("Güvenli MFA kurulum anahtarı alınamadı.");
  }
  let parsedUri;
  try {
    parsedUri = new URL(otpauthUri);
  } catch {
    throw new Error("Güvenli doğrulama uygulaması bağlantısı alınamadı.");
  }
  if (
    parsedUri.protocol !== "otpauth:" ||
    parsedUri.hostname !== "totp" ||
    parsedUri.searchParams.get("secret") !== secret
  ) {
    throw new Error("Güvenli doğrulama uygulaması bağlantısı alınamadı.");
  }
  return { secret, otpauthUri: parsedUri.href };
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

  if (data.delivery.status === "TESLIM_EDILDI") {
    document.querySelector(".delivery-release").hidden = false;
  }
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
  await logoutUser({
    redirectTo: "login.html",
    replace: true,
    messageElement: document.querySelector(".page-message")
  });
});

enrollForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = enrollForm.querySelector("button[type='submit']");
  const currentPassword = new FormData(enrollForm).get("currentPassword")?.toString() || "";
  button.disabled = true;
  setMfaMessage("");
  try {
    const response = await apiRequest("/auth/mfa/enroll", {
      method: "POST",
      body: { currentPassword }
    });
    const enrollment = readSafeEnrollment(response.data);
    mfaState.enrollmentPassword = currentPassword;
    document.querySelector(".js-mfa-secret").textContent = enrollment.secret;
    document.querySelector(".js-mfa-otpauth").href = enrollment.otpauthUri;
    enrollForm.reset();
    enrollmentPanel.hidden = false;
    setMfaMessage("Kurulum anahtarı oluşturuldu. Uygulamanızdaki 6 haneli kodu doğrulayın.");
  } catch (error) {
    mfaState.enrollmentPassword = "";
    enrollmentPanel.hidden = true;
    setMfaMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

confirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = confirmForm.querySelector("button[type='submit']");
  const totpCode = new FormData(confirmForm).get("totpCode")?.toString().trim() || "";
  button.disabled = true;
  setMfaMessage("");
  try {
    if (!mfaState.enrollmentPassword) throw new Error("MFA kurulumunu yeniden başlatın.");
    await apiRequest("/auth/mfa/confirm", {
      method: "POST",
      body: { currentPassword: mfaState.enrollmentPassword, totpCode }
    });
    setMfaUi(true);
    setMfaMessage("İki adımlı doğrulama etkinleştirildi.");
  } catch (error) {
    setMfaMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

disableForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = disableForm.querySelector("button[type='submit']");
  const formData = new FormData(disableForm);
  button.disabled = true;
  setMfaMessage("");
  try {
    await apiRequest("/auth/mfa/disable", {
      method: "POST",
      body: {
        currentPassword: formData.get("currentPassword")?.toString() || "",
        totpCode: formData.get("totpCode")?.toString().trim() || ""
      }
    });
    window.location.replace("login.html");
  } catch (error) {
    setMfaMessage(error.message, true);
    button.disabled = false;
  }
});

const customerSession = await ensureCustomer();
if (customerSession) {
  initTrustedDevices();
  setMfaUi(Boolean(customerSession.mfaEnabled));
  await loadDashboard().catch((error) => {
    document.querySelector(".page-message").textContent = error.message;
  });
}
