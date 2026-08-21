// Paket olusturucu sayfasinin uygulama mantigi.
import { basePackages, services } from "../shared/service-catalog.js";
import { apiRequest, createIdempotencyKey, hasApiEndpoint } from "../shared/api-client.js";
import {
  applyBookingFormConstraints,
  parseBookingFormConstraints
} from "../shared/booking-form-constraints.js";
import {
  getBookingTimeValues,
  parseBookingSchedulePolicy
} from "../shared/booking-schedule-policy.js";
import { APP_LOCALE, APP_TIME_ZONE } from "../shared/runtime-config.js";
import { isSafeImageAssetPath, safeImageAssetPath } from "../shared/asset-url.js";
import { renderServiceDetail } from "../shared/service-detail.js";
const moneyFormatter = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 2 });
const formatPrice = (value) =>
  Number.isFinite(value) ? `${moneyFormatter.format(value)} TL` : "—";
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
const PAYMENT_FLOW_SESSION_KEY = "dugunajansim_payment_flow";
const PACKAGE_DRAFT_STORAGE_KEY = "dugunajansim_package_draft";
const PACKAGE_DRAFT_VERSION = 1;
const PACKAGE_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const BOOKING_TURNSTILE_ACTION = "booking_application";

const state = {
  step: 1,
  base: "mini",
  extras: new Set(),
  filter: "all",
  activeService: null,
  payment: "cash",
  customer: {},
  transferReference: "",
  idempotencyKey: createIdempotencyKey(),
  applicationId: null,
  paymentFlowExpiresAt: null,
  whatsappHandoffAt: null,
  confirmedPayment: null,
  paymentMode: null,
  paymentPolicy: null,
  bookingFormConstraints: null,
  bookingSchedulePolicy: null,
  botProtection: { enabled: false, siteKey: null, action: BOOKING_TURNSTILE_ACTION },
  botChallengeToken: null,
  bookingFormStartedAt: window.performance.now(),
  catalogReady: false
};

let paymentFlowCountdownTimer = null;
let turnstileWidgetId = null;
let turnstileScriptPromise = null;

function clearPackageDraft() {
  try {
    window.localStorage.removeItem(PACKAGE_DRAFT_STORAGE_KEY);
  } catch {
    // Depolama kapalıysa temizlenecek kalıcı bir taslak yoktur.
  }
}

function persistPackageDraft() {
  if (state.applicationId) return;
  try {
    window.localStorage.setItem(
      PACKAGE_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: PACKAGE_DRAFT_VERSION,
        savedAt: Date.now(),
        step: Math.min(Math.max(state.step, 1), 3),
        base: state.base,
        extras: [...state.extras]
      })
    );
  } catch {
    // Akış açık sekmede çalışmaya devam eder; yalnız taslak geri yüklenemez.
  }
}

function restorePackageDraft() {
  let draft;
  try {
    draft = JSON.parse(window.localStorage.getItem(PACKAGE_DRAFT_STORAGE_KEY));
  } catch {
    clearPackageDraft();
    return false;
  }

  const isValid =
    draft?.version === PACKAGE_DRAFT_VERSION &&
    Number.isFinite(draft.savedAt) &&
    Date.now() - draft.savedAt <= PACKAGE_DRAFT_MAX_AGE_MS &&
    Number.isInteger(draft.step) &&
    draft.step >= 1 &&
    draft.step <= 3 &&
    typeof draft.base === "string" &&
    Array.isArray(draft.extras) &&
    draft.extras.every((code) => typeof code === "string") &&
    Boolean(basePackages[draft.base]);

  if (!isValid) {
    clearPackageDraft();
    return false;
  }

  const activeServiceCodes = new Set(services.map((service) => service.id));
  state.base = draft.base;
  state.extras = new Set(draft.extras.filter((code) => activeServiceCodes.has(code)));
  baseInputs.forEach((input) => {
    input.checked = input.value === state.base;
  });
  renderServices();
  updateBaseSelection();

  const requestedService = new URL(window.location.href).searchParams.get("hizmet");
  if (!requestedService || !activeServiceCodes.has(requestedService)) goToStep(draft.step);
  return true;
}

function persistPaymentFlowSession() {
  if (!state.applicationId) return;
  try {
    window.sessionStorage.setItem(PAYMENT_FLOW_SESSION_KEY, state.applicationId);
  } catch {
    // Akış açık sekmede çalışmaya devam eder; yalnız yenileme geri yüklemesi kullanılamaz.
  }
}

function clearPaymentFlowSession() {
  try {
    window.sessionStorage.removeItem(PAYMENT_FLOW_SESSION_KEY);
  } catch {
    // Depolama kapalıysa temizlenecek kalıcı bir oturum yoktur.
  }
}

function invalidateConfirmedPayment() {
  if (!state.whatsappHandoffAt) state.confirmedPayment = null;
}

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
const bookingHoneypotInput = checkoutForm?.querySelector('input[name="companyWebsite"]');
const orderItemsContainer = document.querySelector(".js-order-items");
const bookingCompletion = document.querySelector(".js-booking-completion");
const paymentNotificationForm = document.querySelector("#payment-notification-form");
const paymentNotificationStatus = document.querySelector(".js-payment-notification-status");
const builderRequestStatus = document.querySelector(".js-builder-request-status");
const builderRequestTitle = document.querySelector(".js-builder-request-title");
const builderRequestMessage = document.querySelector(".js-builder-request-message");
const builderRequestRetry = document.querySelector(".js-builder-request-retry");
const paymentSubmitButton = paymentNotificationForm?.querySelector('button[type="submit"]');
const summaryPanel = document.querySelector(".package-summary");
const summaryToggles = [...document.querySelectorAll(".js-summary-toggle")];
const summaryBackground = document.querySelector(".summary-backdrop");
const summaryFocusSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let summaryReturnFocus = null;
let bookingSubmissionInFlight = false;
let requestRetryAction = null;
let availabilityController = null;
let availabilityRequestSequence = 0;
const venueNames = new Map();
const CUSTOM_VENUE_VALUE = "__custom_venue__";

function setBuilderRequestStatus(
  message,
  {
    title = "İşlem tamamlanamadı",
    type = "error",
    retryAction = null,
    actionLabel = "Tekrar dene",
    focus = false
  } = {}
) {
  if (!builderRequestStatus) return;
  builderRequestTitle.textContent = message ? title : "";
  builderRequestMessage.textContent = message || "";
  builderRequestStatus.dataset.status = type;
  builderRequestStatus.hidden = !message;
  requestRetryAction = retryAction;
  builderRequestRetry.hidden = !retryAction;
  builderRequestRetry.textContent = actionLabel;
  if (message && focus) builderRequestStatus.focus({ preventScroll: true });
}

builderRequestRetry?.addEventListener("click", () => {
  const action = requestRetryAction;
  setBuilderRequestStatus("");
  if (!action) return;
  Promise.resolve(action()).catch((error) => {
    setBuilderRequestStatus(
      error?.message || "İşlem yeniden başlatılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
      { retryAction: action, focus: true }
    );
  });
});

function bindBaseInputs() {
  baseInputs = [...document.querySelectorAll('input[name="base-package"]')];
  baseInputs.forEach((input) => {
    input.addEventListener("change", () => {
      state.base = input.value;
      invalidateConfirmedPayment();
      updateBaseSelection();
      persistPackageDraft();
    });
  });
}

function renderBasePackages(
  packages,
  emptyMessage = "Şu anda başvuruya açık bir paket bulunmuyor. Lütfen daha sonra tekrar deneyin."
) {
  const container = document.querySelector(".base-packages");
  const nextButton = document.querySelector(".js-next-step");
  if (nextButton) nextButton.disabled = !state.catalogReady || packages.length === 0;
  if (!packages.length) {
    state.base = "";
    baseInputs = [];
    const message = document.createElement("div");
    message.className = "builder-tip";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✦";
    const copy = document.createElement("p");
    copy.textContent = emptyMessage;
    message.append(icon, copy);
    container.replaceChildren(message);
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
            <img src="${escapeHtml(item.imagePath || "assets/images/why-digital-delivery.webp")}" alt="${escapeHtml(item.name)} düğün çekimi örneği" />
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

function parseCatalogData(data) {
  const remotePackages = data?.packages;
  const remoteServices = data?.services;
  const cashDiscountPercent = data?.paymentPolicy?.cashDiscountPercent;
  const depositMaximumCents = data?.paymentPolicy?.depositMaximumCents;
  const constraints = parseBookingFormConstraints(data?.bookingFormConstraints);
  const schedulePolicy = parseBookingSchedulePolicy(data?.bookingSchedulePolicy);
  const rawBotProtection = data?.botProtection;
  const botProtection = rawBotProtection?.enabled
    ? {
        enabled: true,
        siteKey: rawBotProtection.siteKey,
        action: rawBotProtection.action
      }
    : { enabled: false, siteKey: null, action: BOOKING_TURNSTILE_ACTION };
  const hasValidPolicy =
    Number.isInteger(cashDiscountPercent) &&
    cashDiscountPercent >= 0 &&
    cashDiscountPercent < 100 &&
    Number.isSafeInteger(depositMaximumCents) &&
    depositMaximumCents >= 0;
  const hasValidPrices =
    Array.isArray(remotePackages) &&
    remotePackages.every((item) => Number.isSafeInteger(item.priceCents) && item.priceCents >= 0) &&
    Array.isArray(remoteServices) &&
    remoteServices.every((item) => Number.isSafeInteger(item.priceCents) && item.priceCents >= 0);
  const hasValidBotProtection =
    !botProtection.enabled ||
    (rawBotProtection?.provider === "turnstile" &&
      typeof botProtection.siteKey === "string" &&
      botProtection.siteKey.length > 0 &&
      botProtection.action === BOOKING_TURNSTILE_ACTION);
  if (!hasValidPolicy || !hasValidPrices || !hasValidBotProtection) {
    throw new Error("Sunucudan geçerli katalog, ödeme ve form koşulları alınamadı.");
  }

  return {
    remotePackages,
    remoteServices,
    paymentPolicy: { cashDiscountPercent, depositMaximumCents },
    bookingFormConstraints: constraints,
    bookingSchedulePolicy: schedulePolicy,
    botProtection
  };
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Bot doğrulama bileşeni yüklenemedi."));
    });
    script.addEventListener("error", () =>
      reject(new Error("Bot doğrulama bileşeni yüklenemedi."))
    );
    document.head.append(script);
  }).catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });
  return turnstileScriptPromise;
}

async function initializeBotProtection(configuration) {
  const container = document.querySelector(".js-turnstile");
  state.botProtection = configuration;
  state.botChallengeToken = null;
  container.hidden = !configuration.enabled;
  if (!configuration.enabled) return;

  const turnstile = await loadTurnstileScript();
  if (turnstileWidgetId !== null) {
    turnstile.remove(turnstileWidgetId);
    turnstileWidgetId = null;
  }
  turnstileWidgetId = turnstile.render(container, {
    sitekey: configuration.siteKey,
    action: configuration.action,
    callback: (token) => {
      state.botChallengeToken = token;
      setBuilderRequestStatus("");
    },
    "expired-callback": () => {
      state.botChallengeToken = null;
      setBuilderRequestStatus("Bot doğrulamasının süresi doldu. Yeniden doğrulayıp devam edin.", {
        title: "Doğrulama süresi doldu",
        retryAction: () => initializeBotProtection(state.botProtection),
        focus: true
      });
    },
    "error-callback": () => {
      state.botChallengeToken = null;
      setBuilderRequestStatus("Bot doğrulaması tamamlanamadı. Bileşeni yeniden yükleyin.", {
        title: "Doğrulama yüklenemedi",
        retryAction: () => initializeBotProtection(state.botProtection),
        focus: true
      });
    }
  });
}

function resetBotChallenge() {
  state.botChallengeToken = null;
  if (turnstileWidgetId !== null && window.turnstile) {
    window.turnstile.reset(turnstileWidgetId);
  }
}

async function hydrateRemoteData() {
  if (!hasApiEndpoint()) {
    renderBasePackages([], "Güncel paketleri yüklemek için sunucu bağlantısı gerekli.");
    updateSummary();
    return;
  }

  try {
    const [catalogResponse, venuesResponse] = await Promise.all([
      apiRequest("/catalog"),
      apiRequest("/venues")
    ]);

    const {
      remotePackages,
      remoteServices: remoteServiceItems,
      paymentPolicy,
      bookingFormConstraints,
      bookingSchedulePolicy,
      botProtection
    } = parseCatalogData(catalogResponse.data);
    state.paymentPolicy = paymentPolicy;
    state.bookingFormConstraints = bookingFormConstraints;
    state.bookingSchedulePolicy = bookingSchedulePolicy;
    applyBookingFormConstraints(checkoutForm, bookingFormConstraints);
    await initializeBotProtection(botProtection);
    state.catalogReady = true;
    const activePackageCodes = new Set(remotePackages.map((item) => item.code));
    Object.keys(basePackages).forEach((code) => {
      if (!activePackageCodes.has(code)) delete basePackages[code];
    });
    remotePackages.forEach((item) => {
      basePackages[item.code] = {
        name: item.name,
        subtitle: item.subtitle || "Temel çekim paketi",
        description: item.description || "Düğün gününüze özel profesyonel çekim planı",
        deliveryText: item.deliveryText || "Teslim planı paket detaylarına göre belirlenir",
        price: item.priceCents / 100,
        image: safeImageAssetPath(item.imagePath)
      };
    });
    renderBasePackages(remotePackages);

    const remoteServices = remoteServiceItems.map((item) => {
      const parsedFeatures =
        Array.isArray(item.features) && item.features.length > 0 ? item.features : [];
      const parsedGallery =
        Array.isArray(item.gallery) && item.gallery.length > 0
          ? item.gallery.filter(isSafeImageAssetPath).map((value) => value.trim())
          : [safeImageAssetPath(item.imagePath)];

      return {
        id: item.code,
        category: item.category,
        name: item.name,
        eyebrow: item.eyebrow || "Ek Hizmet",
        price: item.priceCents / 100,
        image: safeImageAssetPath(item.imagePath),
        gallery: parsedGallery.length ? parsedGallery : [safeImageAssetPath(item.imagePath)],
        description: item.description || "Düğününüze özel olarak planlanan ek hizmet.",
        features: parsedFeatures,
        delivery: item.delivery || "Paket teslim planına göre"
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
    venueNames.clear();
    venueSelect.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
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
    updateSummary();
    if (remotePackages.length) {
      openRequestedService();
    } else {
      setPaymentNotificationStatus(
        "Şu anda başvuruya açık bir paket bulunmuyor. Lütfen daha sonra tekrar deneyin."
      );
    }
  } catch (error) {
    state.catalogReady = false;
    state.paymentPolicy = null;
    state.bookingSchedulePolicy = null;
    services.forEach((service) => {
      delete service.price;
    });
    renderBasePackages(
      [],
      "Güncel paket ve ödeme koşulları alınamadı. Lütfen bağlantınızı kontrol edip sayfayı yenileyin."
    );
    renderServices();
    updateSummary();
    setPaymentNotificationStatus(
      "Güncel paket ve salon bilgileri alınamadı. Lütfen bağlantınızı kontrol edip sayfayı yenileyin."
    );
    setBuilderRequestStatus(
      `Güncel paket, salon veya doğrulama bilgileri alınamadı. ${
        error?.message || "Bağlantınızı kontrol edip yeniden deneyin."
      }`,
      {
        title: "Başvuru bilgileri yüklenemedi",
        retryAction: hydrateRemoteData,
        focus: true
      }
    );
  }
}

function getOrderSubtotal() {
  const base = basePackages[state.base];
  const extras = getSelectedExtras();
  if (!Number.isFinite(base?.price) || extras.some((service) => !Number.isFinite(service.price))) {
    return null;
  }
  return extras.reduce((sum, service) => sum + service.price, base.price);
}

function getPaymentMethodContent(paymentMethod) {
  const policy = state.paymentPolicy;
  if (!policy) {
    return {
      title: "Ödeme koşulları yükleniyor",
      copy: "Güncel koşullar sunucudan alınacaktır.",
      optionCopy:
        paymentMethod === "cash" ? "Güncel indirim yükleniyor" : "Güncel kapora tutarı yükleniyor"
    };
  }

  if (paymentMethod === "cash") {
    return {
      title: policy.cashDiscountPercent > 0 ? "Peşin ödeme avantajı" : "Peşin ödeme",
      copy:
        policy.cashDiscountPercent > 0
          ? `Toplam paket tutarınıza %${moneyFormatter.format(policy.cashDiscountPercent)} indirim uygulanır.`
          : "Peşin ödeme tutarı güncel katalog üzerinden hesaplanır.",
      optionCopy:
        policy.cashDiscountPercent > 0
          ? `%${moneyFormatter.format(policy.cashDiscountPercent)} erken ödeme indirimi`
          : "Güncel peşin ödeme tutarı"
    };
  }

  return {
    title: `${formatPrice(fromCents(policy.depositMaximumCents))} kapora ödemesi`,
    copy: "Kalan paket tutarını ekibimizle planlayacağınız tarihte tamamlayabilirsiniz.",
    optionCopy: "Güncel kapora üst sınırı"
  };
}

function calculatePaymentPreview(paymentMethod) {
  const subtotal = getOrderSubtotal();
  const policy = state.paymentPolicy;
  if (!Number.isFinite(subtotal) || !policy) {
    return {
      subtotal: null,
      subtotalLabel: "Ara toplam",
      payable: null,
      adjustment: 0,
      adjustmentLabel: "",
      payableLabel:
        paymentMethod === "cash" ? "Bugün havale edilecek" : "Bugün havale edilecek kapora",
      benefit: "Güncel fiyat ve ödeme koşulları sunucudan yükleniyor."
    };
  }

  const subtotalCents = toCents(subtotal);
  if (paymentMethod === "cash") {
    const totalPriceCents = Math.round((subtotalCents * (100 - policy.cashDiscountPercent)) / 100);
    const discountCents = subtotalCents - totalPriceCents;
    return {
      subtotal,
      subtotalLabel: "Ara toplam",
      payable: fromCents(totalPriceCents),
      adjustment: fromCents(-discountCents),
      adjustmentLabel: "Peşin ödeme indirimi",
      payableLabel: "Bugün havale edilecek",
      benefit:
        discountCents > 0
          ? `Peşin ödeme seçeneğiyle ${formatPrice(fromCents(discountCents))} avantaj kazandınız.`
          : "Peşin ödeme tutarı güncel katalog üzerinden hesaplandı."
    };
  }

  const payableNowCents = Math.min(policy.depositMaximumCents, subtotalCents);
  return {
    subtotal,
    subtotalLabel: "Ara toplam",
    payable: fromCents(payableNowCents),
    adjustment: 0,
    adjustmentLabel: "",
    payableLabel: "Bugün havale edilecek kapora",
    benefit: `${formatPrice(fromCents(payableNowCents))} kapora ödemesinin ardından kalan tutarı ekibimizle planlayabilirsiniz.`
  };
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

  return calculatePaymentPreview(state.payment);
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
    summaryPanel.inert = false;
  } else {
    summaryPanel.setAttribute("aria-hidden", String(!shouldOpen));
    summaryPanel.inert = !shouldOpen;
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
  if (step <= 3) persistPackageDraft();
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
  const emptyState = document.querySelector(".js-summary-empty");
  const summaryList = document.querySelector(".js-summary-list");

  document.querySelector(".js-summary-base-name").textContent = base?.name || "Paket yükleniyor";
  document.querySelector(".js-summary-base-price").textContent = formatPrice(base?.price);
  if (base?.image) document.querySelector(".package-summary__base img").src = base.image;
  document.querySelector(".js-summary-total").textContent = formatPrice(total);
  document.querySelector(".js-extra-count").textContent = `${extras.length} seçim`;
  document.querySelector(".builder-bag__count").textContent = String(
    (base ? 1 : 0) + extras.length
  );

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
  const cashPayment = calculatePaymentPreview("cash");
  const depositPayment = calculatePaymentPreview("deposit");
  const method = getPaymentMethodContent(state.payment);

  document.querySelector(".js-cash-original").textContent = formatPrice(cashPayment.subtotal);
  document.querySelector(".js-cash-total").textContent = formatPrice(cashPayment.payable);
  document.querySelector(".js-deposit-total").textContent = formatPrice(depositPayment.payable);
  document.querySelector(".js-cash-discount-copy").textContent =
    getPaymentMethodContent("cash").optionCopy;
  document.querySelector(".js-deposit-copy").textContent =
    getPaymentMethodContent("deposit").optionCopy;
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
        ? "Test WhatsApp mesajını hazırla"
        : enabled
          ? "WhatsApp'tan dekont gönder"
          : "Ödeme talimatları kullanılamıyor";
  }
  const heading = document.querySelector(".js-payment-submit-heading");
  if (heading)
    heading.textContent = mode === "test" ? "Test dekont bildirimi" : "Dekontunuzu gönderin";
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
  invalidateConfirmedPayment();
  if (state.extras.has(serviceId)) {
    state.extras.delete(serviceId);
  } else {
    state.extras.add(serviceId);
  }
  renderServices();
  updateSummary();
  persistPackageDraft();

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

function closeServiceDetail() {
  detailDialog.close();
  state.activeService = null;
  if (new URL(window.location.href).searchParams.has("hizmet")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

function getBookingRequestBody() {
  return {
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
    endsNextDay: false,
    venueId: isCustomVenueSelected() ? undefined : state.customer.venueId,
    customVenueName: isCustomVenueSelected() ? state.customer.customVenueName?.trim() : undefined,
    packageCode: state.base,
    serviceCodes: [...state.extras],
    paymentMethod: state.payment.toUpperCase(),
    note: state.customer.note || undefined,
    privacyConsent: Boolean(state.customer.privacyConsent),
    marketingConsent: Boolean(state.customer.marketingConsent)
  };
}

function applyPaymentFlowSummary(data) {
  if (data.packageCodeSnapshot && data.packageNameSnapshot) {
    basePackages[data.packageCodeSnapshot] = {
      ...(basePackages[data.packageCodeSnapshot] || {}),
      name: data.packageNameSnapshot,
      price: fromCents(data.packagePriceCents)
    };
  }
  if (Array.isArray(data.services)) {
    data.services.forEach((snapshot) => {
      const service = services.find((item) => item.id === snapshot.codeSnapshot);
      if (!service) return;
      service.name = snapshot.nameSnapshot;
      service.price = fromCents(snapshot.priceCents);
    });
  }
  setConfirmedPayment(data);
  state.applicationId = data.id;
  state.transferReference = data.referenceCode;
  state.paymentFlowExpiresAt = data.paymentFlowExpiresAt;
  state.whatsappHandoffAt = data.whatsappHandoffAt;
  clearPackageDraft();
  persistPaymentFlowSession();
  updateTransferUI();
  updatePaymentFlowState();
}

function isPaymentFlowEditingExpired() {
  const expiresAt = new Date(state.paymentFlowExpiresAt).valueOf();
  return Boolean(state.applicationId) && (!Number.isFinite(expiresAt) || expiresAt <= Date.now());
}

function showPaymentFlowEditExpired() {
  if (paymentFlowCountdownTimer) window.clearInterval(paymentFlowCountdownTimer);
  const warning = document.querySelector(".js-payment-flow-expired");
  warning.hidden = false;
  document.querySelector(".js-transfer-layout").hidden = false;
  document.querySelector(".js-payment-flow-expiry").hidden = true;
  setPaymentNotificationStatus(
    "24 saatlik düzenleme süreniz doldu. Başvurunuz ve referans numaranız geçerliliğini koruyor.",
    "success"
  );
  goToStep(5);
  warning.focus({ preventScroll: true });
}

function requestPaymentFlowEdit(targetStep) {
  if (isPaymentFlowEditingExpired()) {
    showPaymentFlowEditExpired();
    return;
  }
  goToStep(targetStep);
}

function updatePaymentFlowState() {
  const expiry = document.querySelector(".js-payment-flow-expiry");
  if (state.whatsappHandoffAt) {
    setPaymentNotificationStatus(
      "WhatsApp görüşmeniz hazır. Dekontunuzu dilediğiniz zaman aynı başvuru numarasıyla gönderebilirsiniz.",
      "success"
    );
  }
  const renderCountdown = () => {
    const remainingMs = new Date(state.paymentFlowExpiresAt).valueOf() - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      showPaymentFlowEditExpired();
      return false;
    }
    document.querySelector(".js-payment-flow-expired").hidden = true;
    const hours = Math.floor(remainingMs / 3_600_000);
    const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
    const seconds = Math.floor((remainingMs % 60_000) / 1000);
    expiry.hidden = false;
    expiry.textContent = `Başvuruyu düzenlemek için kalan süre: ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return true;
  };
  if (paymentFlowCountdownTimer) window.clearInterval(paymentFlowCountdownTimer);
  if (!renderCountdown()) return;
  paymentFlowCountdownTimer = window.setInterval(renderCountdown, 1000);
}

async function savePaymentFlow() {
  if (!hasApiEndpoint()) throw new Error("Başvuru oluşturmak için sunucu bağlantısı gerekli.");
  const isUpdate = Boolean(state.applicationId);
  if (!isUpdate && state.botProtection.enabled && !state.botChallengeToken) {
    throw new Error("Lütfen bot doğrulamasını tamamlayın.");
  }
  try {
    const response = await apiRequest(
      isUpdate
        ? `/booking-applications/${state.applicationId}/payment-flow`
        : "/booking-applications",
      {
        method: isUpdate ? "PATCH" : "POST",
        headers: {
          ...(!isUpdate
            ? {
                "Idempotency-Key": state.idempotencyKey,
                "X-Booking-Elapsed-Ms": String(
                  Math.max(0, Math.floor(window.performance.now() - state.bookingFormStartedAt))
                ),
                "X-Booking-Website": bookingHoneypotInput?.value ?? "",
                ...(state.botChallengeToken ? { "Turnstile-Token": state.botChallengeToken } : {})
              }
            : {})
        },
        body: getBookingRequestBody()
      }
    );
    applyPaymentFlowSummary(response.data);
    if (!isUpdate) state.botChallengeToken = null;
    return response.data;
  } catch (error) {
    if (!isUpdate) resetBotChallenge();
    throw error;
  }
}

async function openPaymentSummary() {
  if (bookingSubmissionInFlight) return;
  const button = document.querySelector(".js-summary-step");
  const label = button.querySelector("span");
  const originalLabel = label.textContent;
  bookingSubmissionInFlight = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  label.textContent = state.applicationId ? "Başvuru güncelleniyor" : "Referans oluşturuluyor";
  setBuilderRequestStatus("Başvurunuz güvenli şekilde hazırlanıyor.", {
    title: "Lütfen bekleyin",
    type: "pending"
  });
  setPaymentNotificationStatus("Başvurunuz güvenli şekilde hazırlanıyor...", "pending");
  goToStep(5);
  try {
    const previewBeforeSave = calculatePaymentPreview(state.payment);
    const responseData = await savePaymentFlow();
    document.querySelector(".js-payment-flow-expired").hidden = true;
    document.querySelector(".js-transfer-layout").hidden = false;
    renderOrderReview();
    setPaymentNotificationStatus("Başvurunuz güvenli şekilde hazırlandı.", "success");
    const previewTotalCents = toCents(previewBeforeSave.subtotal + previewBeforeSave.adjustment);
    const priceChanged =
      Boolean(responseData.packageCodeSnapshot) &&
      (previewTotalCents !== responseData.totalPriceCents ||
        toCents(previewBeforeSave.payable) !== responseData.payableNowCents);
    if (priceChanged) {
      if (paymentSubmitButton) paymentSubmitButton.disabled = true;
      setBuilderRequestStatus(
        "Paket fiyatı siz formu doldururken güncellendi. Aşağıdaki sunucu doğrulamalı yeni toplamı inceleyip açıkça onaylayın.",
        {
          title: "Fiyat güncellendi",
          type: "pending",
          actionLabel: "Güncel fiyatı onayla",
          retryAction: () => {
            if (paymentSubmitButton) paymentSubmitButton.disabled = !transferAccount?.enabled;
          },
          focus: true
        }
      );
    } else {
      setBuilderRequestStatus("");
    }
  } catch (error) {
    if (error.status === 410) {
      showPaymentFlowEditExpired();
    } else {
      const hasFieldErrors = applyServerFieldErrors(error);
      const message = getBookingFailureMessage(error);
      setPaymentNotificationStatus(message);
      setBuilderRequestStatus(message, {
        retryAction: openPaymentSummary,
        focus: !hasFieldErrors
      });
    }
  } finally {
    bookingSubmissionInFlight = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    label.textContent = originalLabel;
  }
}

document.querySelector(".js-next-step").addEventListener("click", () => goToStep(2));
document.querySelector(".js-prev-step").addEventListener("click", () => goToStep(1));
document.querySelector(".js-details-step").addEventListener("click", () => goToStep(3));
document
  .querySelector(".js-summary-step")
  .addEventListener("click", () => void openPaymentSummary());

document.querySelectorAll(".js-step-back").forEach((button) => {
  button.addEventListener("click", () => requestPaymentFlowEdit(Number(button.dataset.targetStep)));
});

paymentInputs.forEach((input) => {
  input.addEventListener("change", () => {
    state.payment = input.value;
    invalidateConfirmedPayment();
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

function applyServerFieldErrors(error) {
  const fieldErrors = error?.payload?.fieldErrors;
  if (!Array.isArray(fieldErrors)) return false;
  let firstInvalid = null;
  fieldErrors.forEach(({ field, message }) => {
    if (typeof field !== "string" || typeof message !== "string") return;
    const input = checkoutForm.elements.namedItem(field);
    if (!(input instanceof HTMLElement)) return;
    setFieldValidity(input, false, message);
    firstInvalid ||= input;
  });
  if (!firstInvalid) return false;
  goToStep(3);
  firstInvalid.focus();
  return true;
}

function getBookingFailureMessage(error) {
  const supportReference = error?.reference ? ` Destek kodu: ${error.reference}.` : "";
  if (error?.status === 409) {
    return "Seçtiğiniz salon veya başvuru bilgileri başka bir işlemle çakıştı. Bilgileri kontrol edip tekrar deneyin.";
  }
  if (error?.status === 429) {
    const wait = error.retryAfterSeconds
      ? ` Yaklaşık ${error.retryAfterSeconds} saniye sonra`
      : " Bir süre sonra";
    return `Çok fazla deneme yapıldı.${wait} tekrar deneyin.`;
  }
  if (error?.status >= 500 || error?.status === 0 || error?.status === 408) {
    return `Başvurunuz şu anda kaydedilemedi. Bilgileriniz korundu; bağlantınızı kontrol edip tekrar deneyin.${supportReference}`;
  }
  return error?.message || "Başvuru tamamlanamadı. Bilgilerinizi kontrol edip tekrar deneyin.";
}

function validatePhone(input) {
  const config = state.bookingFormConstraints?.phone;
  const value = input.value.trim();
  const isValid =
    Boolean(config) &&
    value.length >= config.minLength &&
    value.length <= config.maxLength &&
    new RegExp(config.pattern).test(value);
  input.setCustomValidity(
    isValid || !value ? "" : config?.message || "Geçerli bir telefon numarası yazın."
  );
  return isValid;
}

const venueSelect = document.querySelector(".js-venue-select");
const customVenueNameInput = document.querySelector(".js-custom-venue-name");
const customVenueField = document.querySelector(".js-custom-venue-field");
const weddingDateInput = document.querySelector(".js-wedding-date");
const startTimeInput = checkoutForm ? checkoutForm.querySelector('input[name="startTime"]') : null;
const endTimeInput = checkoutForm ? checkoutForm.querySelector('input[name="endTime"]') : null;
const dateHint = document.querySelector(".js-date-hint");
const availabilityBanner = document.querySelector(".js-availability-banner");
const datePicker = document.querySelector(".js-date-picker");
const dateTrigger = document.querySelector(".js-date-trigger");
const datePopover = document.querySelector(".js-date-popover");
const dateValue = document.querySelector(".js-date-value");
const calendarTitle = document.querySelector(".js-calendar-title");
const calendarDays = document.querySelector(".js-calendar-days");
const timePickers = [...document.querySelectorAll(".js-time-picker")];
const dateValueInIstanbul = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

let hasVenueOccupancy = false;

const pickerDateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric"
});
const calendarFormatter = new Intl.DateTimeFormat(APP_LOCALE, { month: "long", year: "numeric" });
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
let calendarView = valueToDate(dateValueInIstanbul());

function positionMobilePicker(picker) {
  const popover = picker.querySelector(".picker-popover");
  const trigger = picker.querySelector(".picker-trigger");
  if (!popover || !trigger || !window.matchMedia("(max-width: 640px)").matches) {
    popover?.style.removeProperty("--picker-mobile-top");
    return;
  }

  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const triggerRect = trigger.getBoundingClientRect();
  const popoverHeight = popover.offsetHeight;
  const edgeGap = 16;
  const triggerGap = 8;
  const stickyBottom = [...document.querySelectorAll(".builder-header, .builder-progress")].reduce(
    (bottom, element) => Math.max(bottom, element.getBoundingClientRect().bottom),
    viewportTop
  );
  const safeTop = Math.max(viewportTop + edgeGap, stickyBottom + triggerGap);
  const belowTop = triggerRect.bottom + triggerGap;
  const aboveTop = triggerRect.top - popoverHeight - triggerGap;
  const preferredTop = belowTop + popoverHeight <= viewportBottom - edgeGap ? belowTop : aboveTop;
  const top = Math.max(safeTop, Math.min(preferredTop, viewportBottom - popoverHeight - edgeGap));

  popover.style.setProperty("--picker-mobile-top", `${Math.round(top)}px`);
}

function setPickerOpen(picker, isOpen) {
  const popover = picker.querySelector(".picker-popover");
  const trigger = picker.querySelector(".picker-trigger");
  popover.hidden = !isOpen;
  trigger.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) positionMobilePicker(picker);
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
  const todayValue = dateValueInIstanbul();
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
  for (const value of getBookingTimeValues(state.bookingSchedulePolicy)) {
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
  calendarView = weddingDateInput?.value
    ? valueToDate(weddingDateInput.value)
    : valueToDate(dateValueInIstanbul());
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
  calendarView = valueToDate(dateValueInIstanbul());
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

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

async function fetchVenueAvailability() {
  const venueId = venueSelect?.value;
  const date = weddingDateInput?.value;
  availabilityController?.abort();
  const controller = new window.AbortController();
  availabilityController = controller;
  const requestSequence = ++availabilityRequestSequence;

  if (!venueId || venueId === CUSTOM_VENUE_VALUE || !date) {
    availabilityController = null;
    hasVenueOccupancy = false;
    if (availabilityBanner) availabilityBanner.hidden = true;
    return;
  }

  if (!hasApiEndpoint()) {
    availabilityController = null;
    if (availabilityBanner) availabilityBanner.hidden = true;
    return;
  }

  try {
    const res = await apiRequest(`/venues/${venueId}/availability?date=${date}`, {
      signal: controller.signal
    });
    if (requestSequence !== availabilityRequestSequence) return;
    hasVenueOccupancy = res.data.hasOccupancy === true;
    renderAvailabilityBanner();
  } catch {
    if (controller.signal.aborted || requestSequence !== availabilityRequestSequence) return;
    hasVenueOccupancy = false;
    if (availabilityBanner) {
      availabilityBanner.innerHTML = `<div class="availability-banner__warning">⚠️ Salon doluluk bilgisi alınamadı.</div>`;
      availabilityBanner.hidden = false;
    }
  } finally {
    if (availabilityController === controller) availabilityController = null;
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
  }
  hasVenueOccupancy = false;
  if (availabilityBanner) availabilityBanner.hidden = true;
}

function renderAvailabilityBanner() {
  if (!availabilityBanner) return;

  if (!hasVenueOccupancy) {
    availabilityBanner.innerHTML = `
      <div class="availability-banner__info">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        <span>Seçilen tarihte bu salon için henüz bir düğün/başvuru kaydı bulunmamaktadır.</span>
      </div>
    `;
    availabilityBanner.hidden = false;
    return;
  }

  availabilityBanner.innerHTML = `
    <div class="availability-banner__warning">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <div>
        <strong>Bu tarihte salon için başka kayıtlar bulunmaktadır.</strong>
        <small style="display:block; margin-top:2px;">Seçtiğiniz saat aralığının uygunluğu başvuru sırasında güvenli biçimde kontrol edilecektir.</small>
      </div>
    </div>
  `;
  availabilityBanner.hidden = false;
}

function validateTimeSlots() {
  if (!startTimeInput || !endTimeInput) return true;
  const startTime = startTimeInput.value;
  const endTime = endTimeInput.value;
  if (!startTime || !endTime) {
    setFieldValidity(startTimeInput, true);
    setFieldValidity(endTimeInput, true);
    return true;
  }

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);

  if (newEnd <= newStart) {
    setFieldValidity(endTimeInput, false, "Bitiş saati başlangıç saatinden sonra olmalıdır.");
    return false;
  }

  setFieldValidity(startTimeInput, true);
  setFieldValidity(endTimeInput, true);
  return true;
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

    if (hasDate) {
      if (isCustomVenueSelected()) {
        hasVenueOccupancy = false;
        if (availabilityBanner) availabilityBanner.hidden = true;
      } else {
        fetchVenueAvailability();
      }
    } else {
      hasVenueOccupancy = false;
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
checkoutForm.addEventListener("input", (event) => {
  if (!builderRequestStatus?.hidden) setBuilderRequestStatus("");
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

  if (state.botProtection.enabled && !state.botChallengeToken) {
    setBuilderRequestStatus("Devam etmek için bot doğrulamasını tamamlayın.", {
      title: "Bot doğrulaması gerekli",
      retryAction: () => initializeBotProtection(state.botProtection),
      focus: true
    });
    document
      .querySelector(".js-turnstile")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

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

document
  .querySelector(".js-edit-package")
  .addEventListener("click", () => requestPaymentFlowEdit(2));
document
  .querySelector(".js-edit-details")
  .addEventListener("click", () => requestPaymentFlowEdit(3));

orderItemsContainer.addEventListener("click", async (event) => {
  const removeButton = event.target.closest("[data-remove-service]");
  if (!removeButton) return;
  if (isPaymentFlowEditingExpired()) {
    showPaymentFlowEditExpired();
    return;
  }

  const serviceId = removeButton.dataset.removeService;
  if (!state.extras.has(serviceId)) return;

  state.extras.delete(serviceId);
  invalidateConfirmedPayment();
  renderServices();
  updateSummary();
  try {
    await savePaymentFlow();
    renderOrderReview();
  } catch (error) {
    state.extras.add(serviceId);
    renderServices();
    updateSummary();
    setPaymentNotificationStatus(error.message);
  }
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
    return true;
  } catch {
    setCopyFeedback(`${label} kopyalanamadı. Lütfen elle kopyalayın.`);
    return false;
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

function getWhatsAppUrl() {
  const phone = String(transferAccount?.whatsappPhone || "").replace(/\D/g, "");
  if (!phone) return null;
  return `https://wa.me/${phone}`;
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

function showBookingCompletion() {
  if (!bookingCompletion) return;
  const reference = document.querySelector(".js-booking-reference");
  if (reference) reference.textContent = state.transferReference;

  const isTest = state.paymentMode === "test";
  document.querySelector(".js-completion-eyebrow").textContent = isTest
    ? "Test Başvurunuz Kaydedildi"
    : "Başvurunuz Kaydedildi";
  document.querySelector(".js-completion-status").textContent = isTest
    ? "Test başvurunuz oluşturuldu; gerçek ödeme alınmadı."
    : "Başvurunuz oluşturuldu; dekontunuzu dilediğiniz zaman WhatsApp'tan iletebilirsiniz.";
  document.querySelector(".js-completion-copy").textContent = isTest
    ? "Bu bir test akışıdır. Test hesabına gerçek para göndermeyin."
    : `Dekontunuzu WhatsApp üzerinden iletin. Başvurunuzu ${state.transferReference} referansıyla takip edebilirsiniz.`;

  bookingCompletion.hidden = false;
  document.body.classList.add("is-completion-open");
  document
    .querySelectorAll(".builder-header, .builder-progress, .builder-layout")
    .forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
  document.querySelector(".js-completion-title")?.focus({ preventScroll: true });
}

if (paymentNotificationForm) {
  paymentNotificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!transferAccount) {
      setPaymentNotificationStatus("Ödeme talimatları henüz yüklenmedi. Lütfen tekrar deneyin.");
      return;
    }
    if (!state.applicationId || !state.transferReference) {
      setPaymentNotificationStatus("Ödeme referansı henüz oluşturulmadı. Lütfen tekrar deneyin.");
      return;
    }
    if (!transferAccount.whatsappPhone) {
      setPaymentNotificationStatus(
        "WhatsApp alıcısı henüz yapılandırılmadığı için yönlendirme yapılamıyor."
      );
      return;
    }
    const firstInvalid = validatePaymentNotificationForm();
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const submitButton = paymentNotificationForm.querySelector('button[type="submit"]');
    const whatsappWindow = window.open("about:blank", "_blank");
    if (!whatsappWindow) {
      setPaymentNotificationStatus(
        "WhatsApp penceresi engellendi. Açılır pencerelere izin verip tekrar deneyin."
      );
      return;
    }
    if (whatsappWindow) whatsappWindow.opener = null;
    submitButton.disabled = true;
    setPaymentNotificationStatus("WhatsApp yönlendirmesi hazırlanıyor...", "pending");

    try {
      const response = await apiRequest(
        `/booking-applications/${state.applicationId}/whatsapp-handoff`,
        {
          method: "POST",
          body: {}
        }
      );
      applyPaymentFlowSummary(response.data);
      renderOrderReview();
      await copyTransferValue(state.transferReference, "Başvuru kodu");
      const waUrl = getWhatsAppUrl();
      if (waUrl) {
        whatsappWindow.location.href = waUrl;
        showBookingCompletion();
      } else {
        whatsappWindow.close();
        setPaymentNotificationStatus(
          "WhatsApp alıcısı henüz yapılandırılmadığı için yönlendirme yapılamıyor."
        );
      }
    } catch (error) {
      whatsappWindow?.close();
      if (error.status === 410) showPaymentFlowEditExpired();
      else setPaymentNotificationStatus(error.message);
    } finally {
      submitButton.disabled = false;
      if (!document.querySelector(".js-payment-flow-expired").hidden) return;
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

const showcaseLightbox = document.querySelector(".js-showcase-lightbox");
const showcaseImageButtons = [...document.querySelectorAll(".js-showcase-image")];
const showcaseLightboxImage = showcaseLightbox?.querySelector(".js-showcase-lightbox-image");
const showcaseLightboxCaption = showcaseLightbox?.querySelector(".js-showcase-lightbox-caption");
const showcaseLightboxClose = showcaseLightbox?.querySelector(".js-showcase-lightbox-close");
const showcaseLightboxPrevious = showcaseLightbox?.querySelector(".js-showcase-lightbox-prev");
const showcaseLightboxNext = showcaseLightbox?.querySelector(".js-showcase-lightbox-next");
let activeShowcaseImageIndex = 0;
let showcaseLightboxTrigger = null;

function renderShowcaseLightbox(index) {
  if (!showcaseImageButtons.length || !showcaseLightboxImage || !showcaseLightboxCaption) return;
  activeShowcaseImageIndex = (index + showcaseImageButtons.length) % showcaseImageButtons.length;
  const sourceImage = showcaseImageButtons[activeShowcaseImageIndex].querySelector("img");
  showcaseLightboxImage.src = sourceImage.currentSrc || sourceImage.src;
  showcaseLightboxImage.alt = sourceImage.alt;
  showcaseLightboxCaption.textContent = sourceImage.alt;
}

function openShowcaseLightbox(button, index) {
  if (!showcaseLightbox) return;
  showcaseLightboxTrigger = button;
  renderShowcaseLightbox(index);
  showcaseLightbox.showModal();
}

showcaseImageButtons.forEach((button, index) => {
  button.addEventListener("click", () => openShowcaseLightbox(button, index));
});

showcaseLightboxClose?.addEventListener("click", () => showcaseLightbox.close());
showcaseLightboxPrevious?.addEventListener("click", () =>
  renderShowcaseLightbox(activeShowcaseImageIndex - 1)
);
showcaseLightboxNext?.addEventListener("click", () =>
  renderShowcaseLightbox(activeShowcaseImageIndex + 1)
);
showcaseLightbox?.addEventListener("click", (event) => {
  if (event.target === showcaseLightbox) showcaseLightbox.close();
});
showcaseLightbox?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") renderShowcaseLightbox(activeShowcaseImageIndex - 1);
  if (event.key === "ArrowRight") renderShowcaseLightbox(activeShowcaseImageIndex + 1);
});
showcaseLightbox?.addEventListener("close", () => {
  showcaseLightboxTrigger?.focus();
  showcaseLightboxTrigger = null;
});

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

function restoreFormFieldValues(data) {
  const values = {
    ...data,
    venueId: data.customVenueName ? CUSTOM_VENUE_VALUE : data.venueId,
    privacyConsent: data.privacyConsent,
    marketingConsent: data.marketingConsent
  };
  checkoutForm.querySelectorAll("[name]").forEach((field) => {
    const value = values[field.name];
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (field.type === "radio") {
      field.checked = field.value === value;
    } else if (value !== undefined && field.type !== "hidden") {
      field.value = value;
    }
  });
  venueSelect.value = data.customVenueName ? CUSTOM_VENUE_VALUE : data.venueId || "";
  if (data.customVenueName) customVenueNameInput.value = data.customVenueName;
  updateVenueDependentFields();
  setDateValue(data.weddingDate);
  timePickers.forEach((picker) => {
    const input = picker.querySelector('input[type="hidden"]');
    if (input.name === "startTime") setTimeValue(picker, data.startTime);
    if (input.name === "endTime") setTimeValue(picker, data.endTime);
  });
}

function applyRestoredPaymentFlow(data) {
  if (!basePackages[data.packageCode]) {
    basePackages[data.packageCode] = {
      name: data.packageName,
      price: fromCents(data.packagePriceCents),
      image: "assets/images/hero-couple.webp"
    };
  }
  data.services.forEach((item) => {
    if (services.some((service) => service.id === item.codeSnapshot)) return;
    services.push({
      id: item.codeSnapshot,
      category: "restored",
      name: item.nameSnapshot,
      price: fromCents(item.priceCents),
      image: "assets/images/hero-couple.webp",
      gallery: ["assets/images/hero-couple.webp"],
      description: "Başvurunuzda kayıtlı ek hizmet.",
      features: [],
      delivery: "Paket teslim planına göre"
    });
  });
  state.base = data.packageCode;
  state.extras = new Set(data.serviceCodes);
  state.payment = data.paymentMethod.toLowerCase();
  state.customer = {
    brideFirstName: data.brideFirstName,
    brideLastName: data.brideLastName,
    bridePhone: data.bridePhone,
    groomFirstName: data.groomFirstName,
    groomLastName: data.groomLastName,
    groomPhone: data.groomPhone,
    primaryContact: data.primaryContact,
    primaryEmail: data.primaryEmail,
    weddingDate: data.weddingDate,
    startTime: data.startTime,
    endTime: data.endTime,
    venueId: data.customVenueName ? CUSTOM_VENUE_VALUE : data.venueId,
    customVenueName: data.customVenueName,
    note: data.note,
    privacyConsent: data.privacyConsent,
    marketingConsent: data.marketingConsent
  };
  baseInputs.forEach((input) => {
    input.checked = input.value === state.base;
  });
  paymentInputs.forEach((input) => {
    input.checked = input.value === state.payment;
  });
  restoreFormFieldValues(data);
  renderServices();
  updateBaseSelection();
  updatePaymentUI();
  applyPaymentFlowSummary(data);
  document.querySelector(".js-transfer-layout").hidden = false;
  goToStep(5);
}

async function restorePaymentFlowSession() {
  let applicationId;
  try {
    applicationId = window.sessionStorage.getItem(PAYMENT_FLOW_SESSION_KEY);
  } catch {
    clearPaymentFlowSession();
    return false;
  }
  if (!applicationId || !/^[0-9a-f-]{36}$/i.test(applicationId)) {
    clearPaymentFlowSession();
    return false;
  }
  state.applicationId = applicationId;
  try {
    const response = await apiRequest(`/booking-applications/${applicationId}/payment-flow`);
    applyRestoredPaymentFlow(response.data);
    return true;
  } catch (error) {
    if (error.status === 410) {
      showPaymentFlowEditExpired();
      return true;
    } else {
      clearPaymentFlowSession();
      state.applicationId = null;
      setPaymentNotificationStatus(error.message);
      return false;
    }
  }
}

function openRequestedService() {
  const requestedService = new URL(window.location.href).searchParams.get("hizmet");
  if (requestedService && services.some((service) => service.id === requestedService)) {
    goToStep(2);
    openServiceDetail(requestedService);
  }
}

renderServices();
bindBaseInputs();
updateSummary();
updateProgress();
setSummaryOpen(false, { returnFocus: false });
void Promise.all([hydrateRemoteData(), hydratePaymentInstructions()]).then(async () => {
  const restoredPaymentFlow = await restorePaymentFlowSession();
  if (!restoredPaymentFlow) restorePackageDraft();
});

const todayInIstanbul = dateValueInIstanbul();
if (weddingDateInput) weddingDateInput.min = todayInIstanbul;
if (transferDateInput) transferDateInput.max = todayInIstanbul;

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
  renderServiceDetail({
    service,
    formatPrice,
    elements: {
      eyebrow: detailEyebrow,
      title: detailTitle,
      description: detailDescription,
      features: detailFeatures,
      delivery: detailDelivery,
      price: detailPrice,
      thumbs: detailThumbs,
      mainImage: detailMainImage,
      number: detailNumber
    }
  });
  updateDetailButton(serviceId);
  detailDialog.showModal();
}
