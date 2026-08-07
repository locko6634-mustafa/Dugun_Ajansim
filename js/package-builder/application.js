// Paket olusturucu sayfasinin uygulama mantigi.
import { basePackages, services } from "./catalog.js";
import { apiRequest, createIdempotencyKey, hasApiEndpoint } from "../shared/api-client.js";
const moneyFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const formatPrice = (value) => `${moneyFormatter.format(value)} TL`;
const toCents = (value) => Math.round(value * 100);
const fromCents = (value) => value / 100;
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const createSvg = (paths) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach(({ d, className }) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    if (className) path.classList.add(className);
    svg.append(path);
  });
  return svg;
};

const createImage = (src, alt, loading) => {
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  if (loading) image.loading = loading;
  return image;
};

let transferAccount = null;

const createTransferReference = () =>
  `DA-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

const state = {
  step: 1,
  base: "mini",
  extras: new Set(),
  filter: "all",
  activeService: null,
  payment: "cash",
  customer: {},
  transferReference: createTransferReference(),
  idempotencyKey: createIdempotencyKey(),
  confirmedPayment: null,
  paymentMode: null
};

const stepPanels = [...document.querySelectorAll(".builder-step")];
const progressItems = [...document.querySelectorAll(".builder-progress__item")];
let baseInputs = [...document.querySelectorAll('input[name="base-package"]')];
const servicesGrid = document.querySelector(".builder-services");
const filterButtons = [...document.querySelectorAll(".service-filter button")];
const detailDialog = document.querySelector(".service-detail");
const detailMainImage = document.querySelector(".js-detail-main-image");
const detailEyebrow = document.querySelector(".js-detail-eyebrow");
const detailTitle = document.querySelector(".js-detail-title");
const detailDescription = document.querySelector(".js-detail-description");
const detailFeatures = document.querySelector(".js-detail-features");
const detailDelivery = document.querySelector(".js-detail-delivery");
const detailPrice = document.querySelector(".js-detail-price");
const detailNumber = document.querySelector(".js-detail-number");
const detailThumbs = document.querySelector(".js-detail-thumbs");
const detailAddButton = document.querySelector(".js-detail-add");
const paymentInputs = [...document.querySelectorAll('input[name="payment-method"]')];
const checkoutForm = document.querySelector("#checkout-form");
const orderItemsContainer = document.querySelector(".js-order-items");
const bookingCompletion = document.querySelector(".js-booking-completion");
const paymentNotificationForm = document.querySelector("#payment-notification-form");
const paymentNotificationStatus = document.querySelector(".js-payment-notification-status");
const paymentSubmitButton = paymentNotificationForm?.querySelector('button[type="submit"]');
const summaryPanel = document.querySelector(".package-summary");
const summaryToggles = [...document.querySelectorAll(".js-summary-toggle")];
const summaryBackground = document.querySelector(".summary-backdrop");
const summaryFocusSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let summaryReturnFocus = null;
const venueNames = new Map();
const CUSTOM_VENUE_VALUE = "__custom_venue__";

function bindBaseInputs() {
  baseInputs = [...document.querySelectorAll('input[name="base-package"]')];
  baseInputs.forEach((input) => {
    input.addEventListener("change", () => {
      state.base = input.value;
      updateBaseSelection();
    });
  });
}

function renderBasePackages(packages) {
  const container = document.querySelector(".base-packages");
  const nextButton = document.querySelector(".js-next-step");
  if (nextButton) nextButton.disabled = packages.length === 0;
  if (!packages.length) {
    state.base = "";
    baseInputs = [];
    container.replaceChildren();
    return;
  }
  if (!packages.some((item) => item.code === state.base)) {
    state.base = packages[0].code;
  }
  container.innerHTML = packages
    .map(
      (item) => `
        <label class="base-package ${item.code === state.base ? "is-selected" : ""}">
          <input type="radio" name="base-package" value="${escapeHtml(item.code)}" ${item.code === state.base ? "checked" : ""} />
          <span class="base-package__media">
            <img src="${escapeHtml(item.imagePath || "assets/images/hero-couple.webp")}" alt="${escapeHtml(item.name)} düğün çekimi örneği" />
            <span class="base-package__check" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9" /></svg>
            </span>
          </span>
          <span class="base-package__body">
            <span class="base-package__topline">
              <span><small>${escapeHtml(item.subtitle || "Temel çekim paketi")}</small><strong>${escapeHtml(item.name)}</strong></span>
              <b>${formatPrice(item.priceCents / 100)}</b>
            </span>
            <span class="base-package__features">
              <span>${escapeHtml(item.description || "Düğün gününüze özel profesyonel çekim planı")}</span>
              <span>${escapeHtml(item.deliveryText || "En geç 21 takvim gününde dijital teslim")}</span>
            </span>
          </span>
        </label>`
    )
    .join("");
  bindBaseInputs();
}

async function hydrateRemoteData() {
  if (!hasApiEndpoint()) return;

  try {
    const [catalogResponse, venuesResponse] = await Promise.all([
      apiRequest("/catalog"),
      apiRequest("/venues")
    ]);

    const remotePackages = catalogResponse.data.packages;
    const activePackageCodes = new Set(remotePackages.map((item) => item.code));
    Object.keys(basePackages).forEach((code) => {
      if (!activePackageCodes.has(code)) delete basePackages[code];
    });
    remotePackages.forEach((item) => {
      const current = basePackages[item.code] || {};
      basePackages[item.code] = {
        ...current,
        name: item.name,
        subtitle: item.subtitle || current.subtitle,
        description: item.description || current.description,
        deliveryText: item.deliveryText || current.deliveryText,
        price: item.priceCents / 100,
        image: item.imagePath || current.image || "assets/images/hero-couple.webp"
      };
    });
    renderBasePackages(remotePackages);

    const remoteServices = catalogResponse.data.services.map((item) => {
      const current = services.find((service) => service.id === item.code);
      const parsedFeatures =
        Array.isArray(item.features) && item.features.length > 0
          ? item.features
          : current?.features || [];
      const parsedGallery =
        Array.isArray(item.gallery) && item.gallery.length > 0
          ? item.gallery
          : current?.gallery || [item.imagePath || "assets/images/hero-couple.webp"];

      return {
        id: item.code,
        category: item.category,
        name: item.name,
        eyebrow: item.eyebrow || current?.eyebrow || "Ek Hizmet",
        price: item.priceCents / 100,
        image: item.imagePath || current?.image || "assets/images/hero-couple.webp",
        gallery: parsedGallery,
        description:
          item.description || current?.description || "Düğününüze özel olarak planlanan ek hizmet.",
        features: parsedFeatures,
        delivery: item.delivery || current?.delivery || "Paket teslim planına göre"
      };
    });
    services.splice(0, services.length, ...remoteServices);
    const activeServiceCodes = new Set(remoteServices.map((item) => item.id));
    state.extras.forEach((code) => {
      if (!activeServiceCodes.has(code)) state.extras.delete(code);
    });
    if (state.activeService && !activeServiceCodes.has(state.activeService)) {
      state.activeService = null;
      if (detailDialog.open) detailDialog.close();
    }

    const venueSelect = document.querySelector(".js-venue-select");
    venuesResponse.data.forEach((venue) => {
      venueNames.set(venue.id, venue.name);
      const option = document.createElement("option");
      option.value = venue.id;
      option.textContent = venue.name;
      venueSelect.append(option);
    });
    const customOption = document.createElement("option");
    customOption.value = CUSTOM_VENUE_VALUE;
    customOption.textContent = "Listede yok — salon adını kendim yazacağım";
    venueSelect.append(customOption);

    renderServices();
    if (remotePackages.length) {
      updateSummary();
    } else {
      setPaymentNotificationStatus(
        "Şu anda başvuruya açık bir paket bulunmuyor. Lütfen daha sonra tekrar deneyin."
      );
    }
  } catch {
    setPaymentNotificationStatus(
      "Güncel paket ve salon bilgileri alınamadı. Lütfen bağlantınızı kontrol edip sayfayı yenileyin."
    );
  }
}

const paymentMethods = {
  cash: {
    title: "Peşin ödeme avantajı",
    copy: "Toplam paket tutarınıza %10 indirim uygulanır."
  },
  deposit: {
    title: "5.000 TL kapora ödemesi",
    copy: "Kalan paket tutarını ekibimizle planlayacağınız tarihte tamamlayabilirsiniz."
  }
};

function getOrderSubtotal() {
  const base = basePackages[state.base];
  return getSelectedExtras().reduce((sum, service) => sum + service.price, base.price);
}

function getPaymentDetails() {
  if (state.confirmedPayment) {
    return {
      subtotal: fromCents(state.confirmedPayment.totalPriceCents),
      subtotalLabel: "Doğrulanmış toplam",
      payable: fromCents(state.confirmedPayment.payableNowCents),
      adjustment: 0,
      adjustmentLabel: "",
      payableLabel:
        state.payment === "cash" ? "Bugün havale edilecek" : "Bugün havale edilecek kapora",
      benefit: "Tutar, güncel katalog fiyatlarıyla sunucu tarafından doğrulandı."
    };
  }

  const subtotalCents = toCents(getOrderSubtotal());
  if (state.payment === "cash") {
    const totalPriceCents = Math.round(subtotalCents * 0.9);
    const discountCents = subtotalCents - totalPriceCents;
    return {
      subtotal: fromCents(subtotalCents),
      subtotalLabel: "Ara toplam",
      payable: fromCents(totalPriceCents),
      adjustment: fromCents(-discountCents),
      adjustmentLabel: "Peşin ödeme indirimi",
      payableLabel: "Bugün havale edilecek",
      benefit: `Peşin ödeme seçeneğiyle ${formatPrice(fromCents(discountCents))} avantaj kazandınız.`
    };
  }

  const payableNowCents = Math.min(500_000, subtotalCents);
  return {
    subtotal: fromCents(subtotalCents),
    subtotalLabel: "Ara toplam",
    payable: fromCents(payableNowCents),
    adjustment: 0,
    adjustmentLabel: "",
    payableLabel: "Bugün havale edilecek kapora",
    benefit: `${formatPrice(fromCents(payableNowCents))} kapora ödemesinin ardından kalan tutarı ekibimizle planlayabilirsiniz.`
  };
}

function setConfirmedPayment(responseData) {
  const totalPriceCents = responseData?.totalPriceCents;
  const payableNowCents = responseData?.payableNowCents;
  const hasValidAmounts =
    Number.isSafeInteger(totalPriceCents) &&
    totalPriceCents >= 0 &&
    Number.isSafeInteger(payableNowCents) &&
    payableNowCents >= 0 &&
    payableNowCents <= totalPriceCents;

  if (!hasValidAmounts) {
    throw new Error("Sunucudan geçerli bir fiyat doğrulaması alınamadı. Lütfen tekrar deneyin.");
  }

  state.confirmedPayment = { totalPriceCents, payableNowCents };
}

function updateProgress() {
  progressItems.forEach((item) => {
    const itemStep = Number(item.dataset.progress);
    item.classList.toggle("is-active", itemStep === state.step);
    item.classList.toggle("is-complete", itemStep < state.step);
    if (itemStep === state.step) {
      item.setAttribute("aria-current", "step");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

function setSummaryOpen(isOpen, { returnFocus = true } = {}) {
  const shouldOpen = Boolean(isOpen);

  document.body.classList.toggle("is-summary-open", shouldOpen);
  summaryToggles.forEach((toggle) => {
    if (toggle === summaryBackground) return;
    toggle.setAttribute("aria-expanded", String(shouldOpen));
  });

  const isMobile = window.matchMedia("(max-width: 960px)").matches;
  if (!isMobile) {
    summaryPanel.removeAttribute("aria-hidden");
  } else {
    summaryPanel.setAttribute("aria-hidden", String(!shouldOpen));
    document
      .querySelectorAll(".builder-header, .builder-progress, .builder-content")
      .forEach((element) => {
        element.inert = shouldOpen;
      });
  }

  if (shouldOpen) {
    if (returnFocus) summaryReturnFocus = document.activeElement;
    window.requestAnimationFrame(() =>
      summaryPanel.querySelector(".package-summary__close")?.focus()
    );
  } else if (returnFocus && summaryReturnFocus instanceof HTMLElement) {
    summaryReturnFocus.focus();
    summaryReturnFocus = null;
  }
}

function goToStep(step) {
  state.step = step;
  stepPanels.forEach((panel) => {
    const isActive = Number(panel.dataset.step) === step;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
  updateProgress();
  setSummaryOpen(false, { returnFocus: false });
  if (step === 5) renderOrderReview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateBaseSelection() {
  baseInputs.forEach((input) => {
    input.closest(".base-package").classList.toggle("is-selected", input.checked);
  });
  updateSummary();
}

function getSelectedExtras() {
  return services.filter((service) => state.extras.has(service.id));
}

function updateSummary() {
  const base = basePackages[state.base];
  const extras = getSelectedExtras();
  const total = getOrderSubtotal();

  document.querySelector(".js-summary-base-name").textContent = base.name;
  document.querySelector(".js-summary-base-price").textContent = formatPrice(base.price);
  document.querySelector(".package-summary__base img").src = base.image;
  document.querySelector(".js-summary-total").textContent = formatPrice(total);
  document.querySelector(".js-extra-count").textContent = `${extras.length} seçim`;
  document.querySelector(".builder-bag__count").textContent = String(1 + extras.length);

  const emptyState = document.querySelector(".js-summary-empty");
  const summaryList = document.querySelector(".js-summary-list");
  emptyState.hidden = extras.length > 0;
  summaryList.replaceChildren(
    ...extras.map((service) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const price = document.createElement("b");
      name.textContent = service.name;
      price.textContent = formatPrice(service.price);
      item.append(name, price);
      return item;
    })
  );

  updatePaymentUI();
  if (state.step === 5) renderOrderReview();
}

function updatePaymentUI() {
  const subtotal = getOrderSubtotal();
  const cashTotal = fromCents(Math.round(toCents(subtotal) * 0.9));
  const method = paymentMethods[state.payment];

  document.querySelector(".js-cash-original").textContent = formatPrice(subtotal);
  document.querySelector(".js-cash-total").textContent = formatPrice(cashTotal);
  document.querySelector(".js-deposit-total").textContent = formatPrice(Math.min(5000, subtotal));
  document.querySelector(".js-payment-assurance-title").textContent = method.title;
  document.querySelector(".js-payment-assurance-copy").textContent = method.copy;

  paymentInputs.forEach((input) => {
    input.closest(".payment-option").classList.toggle("is-selected", input.checked);
  });

  updateTransferUI();
}

function getTransferDescription() {
  const payerName =
    `${state.customer.brideFirstName || ""} ${state.customer.groomFirstName || ""}`.trim() ||
    "Müşteri";
  return `${state.transferReference} - ${payerName}`;
}

function updateTransferUI() {
  const payment = getPaymentDetails();
  const transferDescription = state.confirmedPayment
    ? getTransferDescription()
    : "Başvuru kaydedildiğinde oluşturulur";

  document.querySelectorAll(".js-transfer-payable").forEach((element) => {
    element.textContent = formatPrice(payment.payable);
  });
  document.querySelectorAll(".js-transfer-payable-label").forEach((element) => {
    element.textContent = payment.payableLabel;
  });
  document.querySelectorAll(".js-transfer-bank").forEach((element) => {
    element.textContent = transferAccount?.bankName || "Henüz tanımlanmadı";
  });
  document.querySelectorAll(".js-transfer-account-holder").forEach((element) => {
    element.textContent = transferAccount?.accountHolder || "Henüz tanımlanmadı";
  });
  document.querySelectorAll(".js-transfer-iban").forEach((element) => {
    element.textContent = transferAccount?.iban || "Henüz tanımlanmadı";
  });
  document.querySelectorAll(".js-transfer-reference").forEach((element) => {
    element.textContent = transferDescription;
  });
  document.querySelectorAll(".js-notification-amount").forEach((element) => {
    element.value = formatPrice(payment.payable);
  });
}

function setPaymentInstructionsStatus(message, { enabled = false, mode = null } = {}) {
  const title = document.querySelector(".js-payment-instruction-title");
  const copy = document.querySelector(".js-payment-instruction-copy");
  if (title) title.textContent = mode === "test" ? "Test ödeme bilgileri" : "Ödeme talimatları";
  if (copy) copy.textContent = message;
  if (paymentSubmitButton) {
    paymentSubmitButton.disabled = !enabled;
    paymentSubmitButton.querySelector("span").textContent =
      mode === "test"
        ? "Test başvurusu oluştur ve WhatsApp mesajını hazırla"
        : enabled
          ? "Başvuruyu kaydet ve WhatsApp'tan dekont gönder"
          : "Ödeme talimatları kullanılamıyor";
  }
  const heading = document.querySelector(".js-payment-submit-heading");
  if (heading) heading.textContent = mode === "test" ? "Test başvurusu" : "Başvuruyu kaydet";
}

async function hydratePaymentInstructions() {
  if (!hasApiEndpoint()) {
    setPaymentInstructionsStatus("Ödeme talimatları için sunucu bağlantısı gerekli.");
    return;
  }
  try {
    const response = await apiRequest("/payment-instructions");
    if (!response.data?.enabled) throw new Error("Ödeme talimatları şu anda kullanılamıyor.");
    transferAccount = response.data;
    state.paymentMode = response.data.mode;
    setPaymentInstructionsStatus(response.data.notice, { enabled: true, mode: response.data.mode });
    updateTransferUI();
  } catch (error) {
    setPaymentInstructionsStatus(
      error.message || "Ödeme talimatları yüklenemedi. Lütfen tekrar deneyin."
    );
  }
}

function formatWeddingDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function toggleService(serviceId) {
  if (state.extras.has(serviceId)) {
    state.extras.delete(serviceId);
  } else {
    state.extras.add(serviceId);
  }
  renderServices();
  updateSummary();

  if (state.activeService === serviceId && detailDialog.open) {
    updateDetailButton(serviceId);
  }
}

function updateDetailButton(serviceId) {
  const isAdded = state.extras.has(serviceId);
  detailAddButton.classList.toggle("is-added", isAdded);
  detailAddButton.querySelector("span").textContent = isAdded ? "Paketten Çıkar" : "Pakete Ekle";
  detailAddButton.setAttribute("aria-pressed", String(isAdded));
}

function setDetailImage(service, image, index) {
  detailMainImage.src = image;
  detailMainImage.alt = `${service.name} çekim örneği ${index + 1}`;
  detailNumber.textContent = `0${index + 1}`;
  [...detailThumbs.querySelectorAll("button")].forEach((button, buttonIndex) => {
    button.classList.toggle("is-active", buttonIndex === index);
  });
}

function closeServiceDetail() {
  detailDialog.close();
  state.activeService = null;
  if (new URL(window.location.href).searchParams.has("hizmet")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

document.querySelector(".js-next-step").addEventListener("click", () => goToStep(2));
document.querySelector(".js-prev-step").addEventListener("click", () => goToStep(1));
document.querySelector(".js-details-step").addEventListener("click", () => goToStep(3));
document.querySelector(".js-summary-step").addEventListener("click", () => goToStep(5));

document.querySelectorAll(".js-step-back").forEach((button) => {
  button.addEventListener("click", () => goToStep(Number(button.dataset.targetStep)));
});

paymentInputs.forEach((input) => {
  input.addEventListener("change", () => {
    state.payment = input.value;
    updatePaymentUI();
  });
});

const phoneInputs = [
  ...checkoutForm.querySelectorAll('input[name="bridePhone"], input[name="groomPhone"]')
];
const transferDateInput = paymentNotificationForm?.querySelector('input[name="transferDate"]');
function setFieldValidity(input, isValid, message) {
  const field = input.closest(".form-field, .consent-field");
  if (!field) return;

  field.classList.toggle("is-invalid", !isValid);
  input.setAttribute("aria-invalid", String(!isValid));
  const error = field.querySelector(".form-field__error");
  if (error && message) error.textContent = message;
}

function validatePhone(input) {
  const digits = input.value.replace(/\D/g, "");
  const normalized = digits.startsWith("90")
    ? digits.slice(2)
    : digits.startsWith("0")
      ? digits.slice(1)
      : digits;
  const isValid = /^[2-5]\d{9}$/.test(normalized);
  input.setCustomValidity(
    isValid || !input.value.trim() ? "" : "Geçerli bir telefon numarası yazın."
  );
  return isValid;
}

const venueSelect = document.querySelector(".js-venue-select");
const customVenueNameInput = document.querySelector(".js-custom-venue-name");
const customVenueField = document.querySelector(".js-custom-venue-field");
const weddingDateInput = document.querySelector(".js-wedding-date");
const startTimeInput = checkoutForm ? checkoutForm.querySelector('input[name="startTime"]') : null;
const endTimeInput = checkoutForm ? checkoutForm.querySelector('input[name="endTime"]') : null;
const endsNextDayCheckbox = checkoutForm
  ? checkoutForm.querySelector('input[name="endsNextDay"]')
  : null;
const dateHint = document.querySelector(".js-date-hint");
const availabilityBanner = document.querySelector(".js-availability-banner");
const datePicker = document.querySelector(".js-date-picker");
const dateTrigger = document.querySelector(".js-date-trigger");
const datePopover = document.querySelector(".js-date-popover");
const dateValue = document.querySelector(".js-date-value");
const calendarTitle = document.querySelector(".js-calendar-title");
const calendarDays = document.querySelector(".js-calendar-days");
const timePickers = [...document.querySelectorAll(".js-time-picker")];
let calendarView = new Date();

let currentOccupiedSlots = [];

const pickerDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric"
});
const calendarFormatter = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });
const dateToValue = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
const valueToDate = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

function setPickerOpen(picker, isOpen) {
  const popover = picker.querySelector(".picker-popover");
  const trigger = picker.querySelector(".picker-trigger");
  popover.hidden = !isOpen;
  trigger.setAttribute("aria-expanded", String(isOpen));
}

function setPickerDisabled(input, isDisabled) {
  input.disabled = isDisabled;
  input
    .closest(".form-field")
    ?.querySelector(".picker-trigger")
    ?.toggleAttribute("disabled", isDisabled);
  if (isDisabled) setPickerOpen(input.closest(".form-field"), false);
}

function closePickers(except = null) {
  [datePicker, ...timePickers].filter(Boolean).forEach((picker) => {
    if (picker !== except) setPickerOpen(picker, false);
  });
}

function renderCalendar() {
  if (!calendarDays || !calendarTitle) return;
  calendarTitle.textContent = calendarFormatter.format(calendarView);
  calendarDays.replaceChildren();
  const year = calendarView.getFullYear();
  const month = calendarView.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayValue = dateToValue(new Date());
  for (let index = 0; index < firstWeekday + daysInMonth; index += 1) {
    if (index < firstWeekday) {
      calendarDays.append(document.createElement("span"));
      continue;
    }
    const day = index - firstWeekday + 1;
    const value = dateToValue(new Date(year, month, day));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-picker__day";
    button.textContent = String(day);
    button.dataset.dateValue = value;
    button.disabled = value < todayValue;
    button.classList.toggle("is-today", value === todayValue);
    button.classList.toggle("is-selected", value === weddingDateInput?.value);
    button.setAttribute("aria-label", pickerDateFormatter.format(valueToDate(value)));
    calendarDays.append(button);
  }
}

function setDateValue(value) {
  if (!weddingDateInput) return;
  weddingDateInput.value = value;
  dateValue.textContent = pickerDateFormatter.format(valueToDate(value));
  dateTrigger.classList.add("is-selected");
  setFieldValidity(weddingDateInput, true);
  weddingDateInput.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function renderTimeOptions(picker) {
  const input = picker.querySelector('input[type="hidden"]');
  const options = picker.querySelector(".js-time-options");
  options.replaceChildren();
  for (let minutes = 9 * 60; minutes <= 23 * 60 + 30; minutes += 30) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-picker__option";
    button.textContent = value;
    button.dataset.timeValue = value;
    button.classList.toggle("is-selected", input.value === value);
    options.append(button);
  }
}

function setTimeValue(picker, value) {
  const input = picker.querySelector('input[type="hidden"]');
  input.value = value;
  picker.querySelector(".js-time-value").textContent = value;
  picker.querySelector(".picker-trigger").classList.add("is-selected");
  setFieldValidity(input, true);
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  validateTimeSlots();
}

dateTrigger?.addEventListener("click", () => {
  closePickers(datePicker);
  calendarView = weddingDateInput?.value ? valueToDate(weddingDateInput.value) : new Date();
  renderCalendar();
  setPickerOpen(datePicker, datePopover.hidden);
});
document.querySelector(".js-calendar-prev")?.addEventListener("click", () => {
  calendarView.setMonth(calendarView.getMonth() - 1);
  renderCalendar();
});
document.querySelector(".js-calendar-next")?.addEventListener("click", () => {
  calendarView.setMonth(calendarView.getMonth() + 1);
  renderCalendar();
});
document.querySelector(".js-calendar-today")?.addEventListener("click", () => {
  calendarView = new Date();
  renderCalendar();
});
calendarDays?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date-value]");
  if (!button) return;
  setDateValue(button.dataset.dateValue);
  setPickerOpen(datePicker, false);
  dateTrigger.focus();
});
timePickers.forEach((picker) => {
  const trigger = picker.querySelector(".js-time-trigger");
  trigger.addEventListener("click", () => {
    closePickers(picker);
    renderTimeOptions(picker);
    setPickerOpen(picker, picker.querySelector(".js-time-popover").hidden);
  });
  picker.querySelector(".js-time-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-time-value]");
    if (!button) return;
    setTimeValue(picker, button.dataset.timeValue);
    setPickerOpen(picker, false);
    trigger.focus();
  });
});
document.addEventListener("click", (event) => {
  if (![datePicker, ...timePickers].filter(Boolean).some((picker) => picker.contains(event.target)))
    closePickers();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePickers();
});

const timeToMinutes = (timeStr, isNextDay = false) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m + (isNextDay ? 24 * 60 : 0);
};

async function fetchVenueAvailability() {
  const venueId = venueSelect?.value;
  const date = weddingDateInput?.value;

  if (!venueId || venueId === CUSTOM_VENUE_VALUE || !date) {
    currentOccupiedSlots = [];
    if (availabilityBanner) availabilityBanner.hidden = true;
    return;
  }

  if (!hasApiEndpoint()) {
    if (availabilityBanner) availabilityBanner.hidden = true;
    return;
  }

  try {
    const res = await apiRequest(`/venues/${venueId}/availability?date=${date}`);
    currentOccupiedSlots = res.data.occupiedSlots || [];
    renderAvailabilityBanner();
    validateTimeSlots();
  } catch {
    currentOccupiedSlots = [];
    if (availabilityBanner) {
      availabilityBanner.innerHTML = `<div class="availability-banner__warning">⚠️ Salon doluluk bilgisi alınamadı.</div>`;
      availabilityBanner.hidden = false;
    }
  }
}

function isCustomVenueSelected() {
  return venueSelect?.value === CUSTOM_VENUE_VALUE;
}

function getVenueDisplayName() {
  return isCustomVenueSelected()
    ? state.customer.customVenueName?.trim() || "—"
    : venueNames.get(state.customer.venueId) || "—";
}

function updateVenueDependentFields() {
  const isCustomVenue = isCustomVenueSelected();
  if (customVenueField) customVenueField.hidden = !isCustomVenue;
  if (customVenueNameInput) {
    customVenueNameInput.disabled = !isCustomVenue;
    customVenueNameInput.required = isCustomVenue;
  }

  const hasVenue = isCustomVenue
    ? Boolean(customVenueNameInput?.value.trim())
    : Boolean(venueSelect?.value);
  if (weddingDateInput) {
    setPickerDisabled(weddingDateInput, !hasVenue);
    if (!hasVenue) {
      weddingDateInput.value = "";
      dateValue.textContent = "Tarih seçin";
      dateTrigger.classList.remove("is-selected");
    }
  }
  if (dateHint) {
    dateHint.textContent = isCustomVenue
      ? "Salon adını yazdıktan sonra düğün tarihinizi seçin."
      : hasVenue
        ? "Lütfen düğün tarihinizi seçin."
        : "Tarih seçebilmek için lütfen önce salon seçiniz.";
  }
  if (!hasVenue) {
    if (startTimeInput) {
      startTimeInput.value = "";
      setPickerDisabled(startTimeInput, true);
      startTimeInput.closest(".form-field").querySelector(".js-time-value").textContent =
        "Saat seçin";
      startTimeInput
        .closest(".form-field")
        .querySelector(".picker-trigger")
        .classList.remove("is-selected");
    }
    if (endTimeInput) {
      endTimeInput.value = "";
      setPickerDisabled(endTimeInput, true);
      endTimeInput.closest(".form-field").querySelector(".js-time-value").textContent =
        "Saat seçin";
      endTimeInput
        .closest(".form-field")
        .querySelector(".picker-trigger")
        .classList.remove("is-selected");
    }
    if (endsNextDayCheckbox) {
      endsNextDayCheckbox.checked = false;
      endsNextDayCheckbox.disabled = true;
    }
  }
  currentOccupiedSlots = [];
  if (availabilityBanner) availabilityBanner.hidden = true;
}

function renderAvailabilityBanner() {
  if (!availabilityBanner) return;

  if (currentOccupiedSlots.length === 0) {
    availabilityBanner.innerHTML = `
      <div class="availability-banner__info">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        <span>Seçilen tarihte bu salon için henüz bir düğün/başvuru kaydı bulunmamaktadır.</span>
      </div>
    `;
    availabilityBanner.hidden = false;
    return;
  }

  const slotsText = currentOccupiedSlots.map((s) => `${s.startTime} - ${s.endTime}`).join(", ");

  availabilityBanner.innerHTML = `
    <div class="availability-banner__warning">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <div>
        <strong>Bu tarihteki dolu saatler:</strong> ${escapeHtml(slotsText)}
        <small style="display:block; margin-top:2px;">Bu saat aralıklarıyla çakışmayan bir zaman aralığı seçebilirsiniz (örn. dolu saat 13:00 - 17:00 ise 18:00 - 22:00 seçilebilir).</small>
      </div>
    </div>
  `;
  availabilityBanner.hidden = false;
}

function validateTimeSlots() {
  if (!startTimeInput || !endTimeInput) return true;
  const startTime = startTimeInput.value;
  const endTime = endTimeInput.value;
  const endsNextDay = Boolean(endsNextDayCheckbox?.checked);

  if (!startTime || !endTime) {
    setFieldValidity(startTimeInput, true);
    setFieldValidity(endTimeInput, true);
    return true;
  }

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime, endsNextDay);

  if (newEnd <= newStart) {
    setFieldValidity(endTimeInput, false, "Bitiş saati başlangıç saatinden sonra olmalıdır.");
    return false;
  }

  if (currentOccupiedSlots.length === 0) {
    setFieldValidity(startTimeInput, true);
    setFieldValidity(endTimeInput, true);
    return true;
  }

  const conflictingSlot = currentOccupiedSlots.find((slot) => {
    const slotStart = timeToMinutes(slot.startTime);
    let slotEnd = timeToMinutes(slot.endTime);
    if (slotEnd <= slotStart) slotEnd += 24 * 60;

    return newStart < slotEnd && newEnd > slotStart;
  });

  if (conflictingSlot) {
    const errorMsg = `Seçilen saat aralığı salondaki dolu saatlerle (${conflictingSlot.startTime} - ${conflictingSlot.endTime}) çakışıyor.`;
    setFieldValidity(startTimeInput, false, errorMsg);
    setFieldValidity(endTimeInput, false, errorMsg);
    return false;
  } else {
    setFieldValidity(startTimeInput, true);
    setFieldValidity(endTimeInput, true);
    return true;
  }
}

if (venueSelect) {
  venueSelect.addEventListener("change", () => {
    updateVenueDependentFields();
    if (isCustomVenueSelected()) {
      customVenueNameInput?.focus();
    } else if (venueSelect.value) {
      fetchVenueAvailability();
    }
  });
}

if (customVenueNameInput) {
  customVenueNameInput.addEventListener("input", updateVenueDependentFields);
}

if (weddingDateInput) {
  weddingDateInput.addEventListener("change", () => {
    const hasDate = Boolean(weddingDateInput.value);
    if (startTimeInput) setPickerDisabled(startTimeInput, !hasDate);
    if (endTimeInput) setPickerDisabled(endTimeInput, !hasDate);
    if (endsNextDayCheckbox) endsNextDayCheckbox.disabled = !hasDate;

    if (hasDate) {
      if (isCustomVenueSelected()) {
        currentOccupiedSlots = [];
        if (availabilityBanner) availabilityBanner.hidden = true;
      } else {
        fetchVenueAvailability();
      }
    } else {
      currentOccupiedSlots = [];
      if (availabilityBanner) availabilityBanner.hidden = true;
    }
  });
}

if (startTimeInput) {
  startTimeInput.addEventListener("input", validateTimeSlots);
  startTimeInput.addEventListener("change", validateTimeSlots);
}
if (endTimeInput) {
  endTimeInput.addEventListener("input", validateTimeSlots);
  endTimeInput.addEventListener("change", validateTimeSlots);
}
if (endsNextDayCheckbox) {
  endsNextDayCheckbox.addEventListener("change", validateTimeSlots);
}

checkoutForm.addEventListener("input", (event) => {
  if (phoneInputs.includes(event.target)) validatePhone(event.target);
  const field = event.target.closest(".form-field");
  if (field && event.target.validity.valid) setFieldValidity(event.target, true);
});

checkoutForm.addEventListener("change", (event) => {
  const field = event.target.closest(".consent-field");
  if (field && event.target.validity.valid) setFieldValidity(event.target, true);
});

checkoutForm.addEventListener("submit", (event) => {
  event.preventDefault();
  phoneInputs.forEach(validatePhone);
  const requiredFields = [
    ...checkoutForm.querySelectorAll("[required]"),
    weddingDateInput,
    startTimeInput,
    endTimeInput
  ].filter(Boolean);

  requiredFields.forEach((input) => {
    const isPickerField = input.matches('input[type="hidden"]');
    setFieldValidity(input, isPickerField ? Boolean(input.value) : input.validity.valid);
  });

  const isTimeValid = validateTimeSlots();

  const firstInvalid = requiredFields.find((input) =>
    input.matches('input[type="hidden"]') ? !input.value : !input.validity.valid
  );
  if (firstInvalid || !isTimeValid) {
    if (firstInvalid) {
      firstInvalid.closest(".form-field")?.querySelector(".picker-trigger")?.focus() ||
        firstInvalid.focus();
    } else if (startTimeInput)
      startTimeInput.closest(".form-field")?.querySelector(".picker-trigger")?.focus();
    return;
  }

  state.customer = Object.fromEntries(new FormData(checkoutForm).entries());
  goToStep(4);
});

document.querySelector(".js-edit-package").addEventListener("click", () => goToStep(2));
document.querySelector(".js-edit-details").addEventListener("click", () => goToStep(3));

orderItemsContainer.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-service]");
  if (!removeButton) return;

  const serviceId = removeButton.dataset.removeService;
  if (!state.extras.has(serviceId)) return;

  state.extras.delete(serviceId);
  renderServices();
  updateSummary();
});

function setCopyFeedback(message) {
  document.querySelector(".js-copy-feedback").textContent = message;
}

async function copyTransferValue(value, label) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const fallback = document.createElement("textarea");
      fallback.value = value;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      if (!copied) throw new Error("copy-failed");
    }
    setCopyFeedback(`${label} panoya kopyalandı.`);
  } catch {
    setCopyFeedback(`${label} kopyalanamadı. Lütfen elle kopyalayın.`);
  }
}

document.querySelectorAll(".js-copy-transfer").forEach((button) => {
  button.addEventListener("click", () => {
    const isIban = button.dataset.copy === "iban";
    const label = isIban ? "IBAN" : "Açıklama kodu";
    const value = isIban ? transferAccount?.iban : getTransferDescription();
    if (!value) {
      setCopyFeedback(`${label} henüz tanımlanmadı.`);
      return;
    }
    copyTransferValue(value, label);
  });
});

function generateWhatsAppMessage() {
  const payment = getPaymentDetails();
  const base = basePackages[state.base];
  const extras =
    getSelectedExtras()
      .map((s) => s.name)
      .join(", ") || "Yok";
  const refNo = state.transferReference || `DA-${Math.floor(100000 + Math.random() * 900000)}`;
  state.transferReference = refNo;

  const couple = `${state.customer.brideFirstName || "—"} ${
    state.customer.brideLastName || ""
  } & ${state.customer.groomFirstName || "—"} ${state.customer.groomLastName || ""}`.trim();
  const primaryPhone =
    state.customer.primaryContact === "DAMAT"
      ? state.customer.groomPhone
      : state.customer.bridePhone;
  return `Merhaba Düğünajansım Ekibi,\n\nPaket başvurumu oluşturdum. Dekontumu paylaşmak istiyorum.\n\n📋 *Başvuru Kodu:* ${refNo}\n💍 *Çift:* ${couple}\n📞 *Birincil Telefon:* ${primaryPhone || "—"}\n📅 *Düğün Tarihi:* ${formatWeddingDate(state.customer.weddingDate)}\n⏰ *Saat:* ${state.customer.startTime || "—"} - ${state.customer.endTime || ""}${state.customer.endsNextDay ? " (ertesi gün)" : ""}\n📍 *Salon:* ${getVenueDisplayName()}\n\n🎁 *Paket:* ${base?.name || "Mini Paket"}\n➕ *Ek Hizmetler:* ${extras}\n💰 *Ödenecek Tutar:* ${formatPrice(payment.payable)} (${payment.payableLabel})\n\n⚠️ Havale/EFT açıklamasına *${refNo}* referans numarasını yazdım. Dekontumu bu mesaja ekliyorum.`;
}

function getWhatsAppUrl() {
  const phone = String(transferAccount?.whatsappPhone || "").replace(/\D/g, "");
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(generateWhatsAppMessage())}`;
}

function validatePaymentNotificationForm() {
  const requiredFields = [...paymentNotificationForm.querySelectorAll("[required]")];
  requiredFields.forEach((input) => {
    setFieldValidity(input, input.validity.valid);
  });
  return requiredFields.find((input) => !input.validity.valid);
}

function setPaymentNotificationStatus(message, type = "error") {
  if (!paymentNotificationStatus) return;
  paymentNotificationStatus.textContent = message;
  paymentNotificationStatus.dataset.status = type;
  paymentNotificationStatus.hidden = !message;
}

if (paymentNotificationForm) {
  paymentNotificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!transferAccount) {
      setPaymentNotificationStatus("Ödeme talimatları henüz yüklenmedi. Lütfen tekrar deneyin.");
      return;
    }
    const firstInvalid = validatePaymentNotificationForm();
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const submitButton = paymentNotificationForm.querySelector('button[type="submit"]');
    const whatsappWindow = transferAccount?.whatsappPhone
      ? window.open("about:blank", "_blank")
      : null;
    if (whatsappWindow) whatsappWindow.opener = null;
    submitButton.disabled = true;
    setPaymentNotificationStatus("Başvurunuz güvenli şekilde kaydediliyor...", "pending");

    try {
      const response = await apiRequest("/booking-applications", {
        method: "POST",
        headers: { "Idempotency-Key": state.idempotencyKey },
        body: {
          brideFirstName: state.customer.brideFirstName,
          brideLastName: state.customer.brideLastName,
          bridePhone: state.customer.bridePhone,
          groomFirstName: state.customer.groomFirstName,
          groomLastName: state.customer.groomLastName,
          groomPhone: state.customer.groomPhone,
          primaryContact: state.customer.primaryContact,
          primaryEmail: state.customer.primaryEmail,
          weddingDate: state.customer.weddingDate,
          startTime: state.customer.startTime,
          endTime: state.customer.endTime,
          endsNextDay: Boolean(state.customer.endsNextDay),
          venueId: isCustomVenueSelected() ? undefined : state.customer.venueId,
          customVenueName: isCustomVenueSelected()
            ? state.customer.customVenueName?.trim()
            : undefined,
          packageCode: state.base,
          serviceCodes: [...state.extras],
          paymentMethod: state.payment.toUpperCase(),
          note: state.customer.note || undefined,
          privacyConsent: Boolean(state.customer.privacyConsent),
          marketingConsent: Boolean(state.customer.marketingConsent)
        }
      });
      setConfirmedPayment(response.data);
      state.transferReference = response.data.referenceCode;
      renderOrderReview();
      const waUrl = getWhatsAppUrl();

      const refElement = document.querySelector(".js-booking-reference");
      if (refElement) refElement.textContent = state.transferReference;

      const isTest = state.paymentMode === "test";
      document.querySelector(".js-completion-eyebrow").textContent = isTest
        ? "Test Başvurunuz Kaydedildi"
        : "Başvurunuz Kaydedildi";
      document.querySelector(".js-completion-status").textContent = isTest
        ? "Test başvurunuz oluşturuldu; gerçek ödeme alınmadı."
        : "Başvurunuz oluşturuldu; dekont bildiriminiz bekleniyor.";
      document.querySelector(".js-completion-copy").textContent = isTest
        ? "Bu bir test akışıdır. Test hesabına gerçek para göndermeyin; DA referansınızı WhatsApp mesajında kontrol edin."
        : `Havale/EFT açıklamasına ${state.transferReference} referansını yazın; ardından dekontunuzu WhatsApp hattımızdan paylaşın.`;

      if (waUrl && whatsappWindow) {
        whatsappWindow.location.href = waUrl;
      } else if (waUrl) {
        const fallbackWindow = window.open(waUrl, "_blank", "noopener,noreferrer");
        if (!fallbackWindow) {
          setPaymentNotificationStatus(
            "Başvurunuz kaydedildi; WhatsApp penceresi tarayıcı tarafından engellendi."
          );
        }
      } else {
        setPaymentNotificationStatus(
          "Başvurunuz kaydedildi. WhatsApp alıcısı henüz yapılandırılmadığı için yönlendirme yapılmadı.",
          "success"
        );
      }

      bookingCompletion.hidden = false;
      document.body.classList.add("is-completion-open");
      document
        .querySelectorAll(".builder-header, .builder-progress, .builder-layout")
        .forEach((element) => {
          element.inert = true;
          element.setAttribute("aria-hidden", "true");
        });

      const completionTitle = document.querySelector(".js-completion-title");
      if (completionTitle) completionTitle.focus({ preventScroll: true });
    } catch (error) {
      whatsappWindow?.close();
      setPaymentNotificationStatus(error.message);
      submitButton.disabled = false;
      paymentNotificationStatus.focus();
    }
  });
}

const bookingInfoDialog = document.querySelector(".js-booking-info");
const bookingInfoOpenBtn = document.querySelector(".js-booking-info-open");
const bookingInfoCloseBtns = document.querySelectorAll(".js-booking-info-close");

function openBookingInfo() {
  if (bookingInfoDialog) {
    if (typeof bookingInfoDialog.showModal === "function") {
      bookingInfoDialog.showModal();
    } else {
      bookingInfoDialog.setAttribute("open", "");
    }
  }
}

function closeBookingInfo() {
  if (bookingInfoDialog) {
    if (typeof bookingInfoDialog.close === "function") {
      bookingInfoDialog.close();
    } else {
      bookingInfoDialog.removeAttribute("open");
    }
  }
}

if (bookingInfoOpenBtn) {
  bookingInfoOpenBtn.addEventListener("click", openBookingInfo);
}

bookingInfoCloseBtns.forEach((btn) => {
  btn.addEventListener("click", closeBookingInfo);
});

if (bookingInfoDialog) {
  bookingInfoDialog.addEventListener("click", (event) => {
    if (event.target === bookingInfoDialog) closeBookingInfo();
  });
}

const continueBtn = document.querySelector(".js-showcase-continue");
if (continueBtn) {
  continueBtn.addEventListener("click", () => {
    const successView = document.querySelector(".js-completion-success");
    const showcaseView = document.querySelector(".js-completion-showcase");
    if (successView && showcaseView) {
      successView.hidden = true;
      showcaseView.hidden = false;
      openBookingInfo();
    } else {
      window.location.href = "index.html";
    }
  });
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    filterButtons.forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });
    renderServices();
  });
});

summaryToggles.forEach((button) => {
  button.addEventListener("click", () => {
    setSummaryOpen(!document.body.classList.contains("is-summary-open"));
  });
});

document.querySelector(".js-detail-close").addEventListener("click", closeServiceDetail);
detailAddButton.addEventListener("click", () => {
  if (state.activeService) toggleService(state.activeService);
});

detailDialog.addEventListener("click", (event) => {
  if (event.target === detailDialog) closeServiceDetail();
});

detailDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeServiceDetail();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("is-summary-open")) {
    event.preventDefault();
    setSummaryOpen(false);
    return;
  }

  if (event.key === "Tab" && document.body.classList.contains("is-summary-open")) {
    const focusable = [...summaryPanel.querySelectorAll(summaryFocusSelector)];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

renderServices();
bindBaseInputs();
updateSummary();
updateProgress();
setSummaryOpen(false, { returnFocus: false });
void hydrateRemoteData();
void hydratePaymentInstructions();

const today = new Date();
const localToday = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0")
].join("-");
if (weddingDateInput) weddingDateInput.min = localToday;
if (transferDateInput) transferDateInput.max = localToday;

const requestedService = new URL(window.location.href).searchParams.get("hizmet");
if (requestedService && services.some((service) => service.id === requestedService)) {
  goToStep(2);
  openServiceDetail(requestedService);
}

function renderOrderReview() {
  const base = basePackages[state.base];
  const extras = getSelectedExtras();
  const payment = getPaymentDetails();
  const items = [
    { ...base, type: "Temel paket" },
    ...extras.map((service) => ({ ...service, type: "Ek hizmet" }))
  ];

  orderItemsContainer.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("div");
      row.className = "order-review__item";
      row.append(createImage(item.image, ""));

      const nameGroup = document.createElement("span");
      const type = document.createElement("small");
      const name = document.createElement("strong");
      type.textContent = item.type;
      name.textContent = item.name;
      nameGroup.append(type, name);

      const actions = document.createElement("div");
      actions.className = "order-review__item-actions";
      const price = document.createElement("b");
      price.textContent = formatPrice(item.price);
      actions.append(price);

      if (item.type === "Ek hizmet") {
        const removeButton = document.createElement("button");
        removeButton.className = "order-review__remove";
        removeButton.type = "button";
        removeButton.setAttribute("aria-label", `${item.name} hizmetini paketten çıkar`);
        removeButton.title = "Paketten çıkar";
        removeButton.dataset.removeService = item.id;
        removeButton.append(createSvg([{ d: "M6 6l12 12M18 6 6 18" }]));
        actions.append(removeButton);
      }

      row.append(nameGroup, actions);
      return row;
    })
  );

  const subtotalElement = document.querySelector(".js-order-subtotal");
  subtotalElement.previousElementSibling.textContent = payment.subtotalLabel;
  subtotalElement.textContent = formatPrice(payment.subtotal);
  document.querySelector(".js-order-payable-label").textContent = payment.payableLabel;
  document.querySelector(".js-order-payable").textContent = formatPrice(payment.payable);
  document.querySelector(".js-order-benefit span").textContent = payment.benefit;
  const adjustmentRow = document.querySelector(".js-order-adjustment-row");
  adjustmentRow.hidden = payment.adjustment === 0;
  document.querySelector(".js-order-adjustment-label").textContent = payment.adjustmentLabel;
  document.querySelector(".js-order-adjustment").textContent = formatPrice(payment.adjustment);
  document.querySelector(".js-review-couple").textContent =
    `${state.customer.brideFirstName || ""} ${state.customer.brideLastName || ""} & ${
      state.customer.groomFirstName || ""
    } ${state.customer.groomLastName || ""}`.trim() || "—";
  document.querySelector(".js-review-phone").textContent =
    state.customer.primaryContact === "DAMAT"
      ? state.customer.groomPhone || "—"
      : state.customer.bridePhone || "—";
  document.querySelector(".js-review-date").textContent = formatWeddingDate(
    state.customer.weddingDate
  );
  document.querySelector(".js-review-venue").textContent = getVenueDisplayName();
  updateTransferUI();
}

function renderServices() {
  const visibleServices = services.filter(
    (service) => state.filter === "all" || service.category === state.filter
  );

  servicesGrid.replaceChildren(
    ...visibleServices.map((service, index) => {
      const isAdded = state.extras.has(service.id);
      const article = document.createElement("article");
      article.className = `builder-service${isAdded ? " is-added" : ""}`;
      article.dataset.service = service.id;

      const openButton = document.createElement("button");
      openButton.className = "builder-service__open";
      openButton.type = "button";
      openButton.setAttribute("aria-label", `${service.name} hizmetini incele`);
      openButton.dataset.openService = service.id;
      const media = document.createElement("span");
      media.className = "builder-service__media";
      media.append(createImage(service.image, `${service.name} çekim örneği`, "lazy"));
      const details = document.createElement("span");
      details.className = "builder-service__details";
      const indexLabel = document.createElement("small");
      const name = document.createElement("strong");
      const price = document.createElement("b");
      indexLabel.textContent = `0${index + 1} / İncele`;
      name.textContent = service.name;
      price.textContent = formatPrice(service.price);
      details.append(indexLabel, name, price);
      openButton.append(media, details);

      const addButton = document.createElement("button");
      addButton.className = "builder-service__add";
      addButton.type = "button";
      addButton.setAttribute(
        "aria-label",
        `${service.name} hizmetini ${isAdded ? "paketten çıkar" : "pakete ekle"}`
      );
      addButton.setAttribute("aria-pressed", String(isAdded));
      addButton.dataset.toggleService = service.id;
      addButton.append(
        createSvg([{ d: "M5 12h14" }, { d: "M12 5v14", className: "line-vertical" }])
      );

      article.append(openButton, addButton);
      return article;
    })
  );

  document.querySelectorAll("[data-open-service]").forEach((button) => {
    button.addEventListener("click", () => openServiceDetail(button.dataset.openService));
  });
  document.querySelectorAll("[data-toggle-service]").forEach((button) => {
    button.addEventListener("click", () => toggleService(button.dataset.toggleService));
  });
}

function openServiceDetail(serviceId) {
  const service = services.find((item) => item.id === serviceId);
  if (!service) return;

  state.activeService = serviceId;
  detailEyebrow.textContent = service.eyebrow;
  detailTitle.textContent = service.name;
  detailDescription.textContent = service.description;
  detailFeatures.replaceChildren(
    ...service.features.map((feature) => {
      const item = document.createElement("li");
      item.textContent = feature;
      return item;
    })
  );
  detailDelivery.textContent = service.delivery;
  detailPrice.textContent = formatPrice(service.price);
  detailThumbs.replaceChildren(
    ...service.gallery.map((image, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `${index + 1}. çekim örneğini göster`);
      button.append(createImage(image, ""));
      button.addEventListener("click", () => setDetailImage(service, image, index));
      return button;
    })
  );

  setDetailImage(service, service.gallery[0], 0);
  updateDetailButton(serviceId);
  detailDialog.showModal();
}
