// Paket olusturucu sayfasinin uygulama mantigi.
import { basePackages, services } from "./catalog.js";
const moneyFormatter = new Intl.NumberFormat("tr-TR");
const formatPrice = (value) => `${moneyFormatter.format(value)} TL`;

const state = {
  step: 1,
  base: "mini",
  extras: new Set(),
  filter: "all",
  activeService: null,
  payment: "cash",
  customer: {},
};

const stepPanels = [...document.querySelectorAll(".builder-step")];
const progressItems = [...document.querySelectorAll(".builder-progress__item")];
const baseInputs = [...document.querySelectorAll('input[name="base-package"]')];
const servicesGrid = document.querySelector(".builder-services");
const filterButtons = [...document.querySelectorAll(".service-filter button")];
const detailDialog = document.querySelector(".service-detail");
const detailMainImage = document.querySelector(".js-detail-main-image");
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
const completionSuccess = document.querySelector(".js-completion-success");
const completionShowcase = document.querySelector(".js-completion-showcase");
const completionInfoDialog = document.querySelector(".js-booking-info");
const showcaseImageButtons = [...document.querySelectorAll(".js-showcase-image")];
const showcaseLightbox = document.querySelector(".js-showcase-lightbox");
const showcaseLightboxImage = document.querySelector(".js-showcase-lightbox-image");
const showcaseLightboxCaption = document.querySelector(".js-showcase-lightbox-caption");
let activeShowcaseImage = 0;

const paymentMethods = {
  cash: {
    title: "Peşin ödeme avantajı",
    copy: "Toplam paket tutarınıza %10 indirim uygulanır.",
  },
  installment: {
    title: "Vade farksız iki taksit",
    copy: "İlk taksiti şimdi, ikinci taksiti ekibimizle planladığınız tarihte ödeyin.",
  },
  deposit: {
    title: "5.000 TL ile tarihinizi ayırın",
    copy: "Kalan paket tutarını düğün gününde tamamlayabilirsiniz.",
  },
};

function getOrderSubtotal() {
  const base = basePackages[state.base];
  return getSelectedExtras().reduce((sum, service) => sum + service.price, base.price);
}

function getPaymentDetails() {
  const subtotal = getOrderSubtotal();

  if (state.payment === "cash") {
    const discount = Math.round(subtotal * 0.1);
    return {
      subtotal,
      payable: subtotal - discount,
      adjustment: -discount,
      adjustmentLabel: "Peşin ödeme indirimi",
      payableLabel: "Ödenecek tutar",
      benefit: `Peşin ödeme seçeneğiyle ${formatPrice(discount)} avantaj kazandınız.`,
    };
  }

  if (state.payment === "installment") {
    const firstInstallment = Math.ceil(subtotal / 2);
    return {
      subtotal,
      payable: firstInstallment,
      adjustment: 0,
      adjustmentLabel: "",
      payableLabel: "Bugün ödenecek ilk taksit",
      benefit: `Toplam ${formatPrice(subtotal)} tutarını vade farksız iki eşit ödemeyle tamamlayabilirsiniz.`,
    };
  }

  return {
    subtotal,
    payable: Math.min(5000, subtotal),
    adjustment: 0,
    adjustmentLabel: "",
    payableLabel: "Bugün ödenecek kapora",
    benefit: `${formatPrice(Math.min(5000, subtotal))} kapora ile tarihinizi ayırın, kalan tutarı düğün günü ödeyin.`,
  };
}

function updateProgress() {
  progressItems.forEach((item) => {
    const itemStep = Number(item.dataset.progress);
    item.classList.toggle("is-active", itemStep === state.step);
    item.classList.toggle("is-complete", itemStep < state.step);
  });
}

function goToStep(step) {
  state.step = step;
  stepPanels.forEach((panel) => {
    const isActive = Number(panel.dataset.step) === step;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
  updateProgress();
  document.body.classList.remove("is-summary-open");
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
  summaryList.innerHTML = extras
    .map(
      (service) => `
        <li>
          <span>${service.name}</span>
          <b>${formatPrice(service.price)}</b>
        </li>
      `,
    )
    .join("");

  updatePaymentUI();
  if (state.step === 5) renderOrderReview();
}

function updatePaymentUI() {
  const subtotal = getOrderSubtotal();
  const cashTotal = Math.round(subtotal * 0.9);
  const installment = Math.ceil(subtotal / 2);
  const method = paymentMethods[state.payment];

  document.querySelector(".js-cash-original").textContent = formatPrice(subtotal);
  document.querySelector(".js-cash-total").textContent = formatPrice(cashTotal);
  document.querySelector(".js-installment-copy").textContent = `2 × ${formatPrice(installment)}`;
  document.querySelector(".js-installment-total").textContent = formatPrice(subtotal);
  document.querySelector(".js-deposit-total").textContent = formatPrice(Math.min(5000, subtotal));
  document.querySelector(".js-payment-assurance-title").textContent = method.title;
  document.querySelector(".js-payment-assurance-copy").textContent = method.copy;

  paymentInputs.forEach((input) => {
    input.closest(".payment-option").classList.toggle("is-selected", input.checked);
  });
}

function formatWeddingDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function renderOrderReview() {
  const base = basePackages[state.base];
  const extras = getSelectedExtras();
  const payment = getPaymentDetails();
  const items = [
    { ...base, type: "Temel paket" },
    ...extras.map((service) => ({ ...service, type: "Ek hizmet" })),
  ];

  orderItemsContainer.innerHTML = items
    .map(
      (item) => `
        <div class="order-review__item">
          <img src="${item.image}" alt="" />
          <span>
            <small>${item.type}</small>
            <strong>${item.name}</strong>
          </span>
          <div class="order-review__item-actions">
            <b>${formatPrice(item.price)}</b>
            ${
              item.type === "Ek hizmet"
                ? `
                  <button
                    class="order-review__remove"
                    type="button"
                    aria-label="${item.name} hizmetini paketten çıkar"
                    title="Paketten çıkar"
                    data-remove-service="${item.id}"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                `
                : ""
            }
          </div>
        </div>
      `,
    )
    .join("");

  document.querySelector(".js-order-subtotal").textContent = formatPrice(payment.subtotal);
  document.querySelector(".js-order-payable-label").textContent = payment.payableLabel;
  document.querySelector(".js-order-payable").textContent = formatPrice(payment.payable);
  document.querySelector(".js-order-benefit span").textContent = payment.benefit;

  const adjustmentRow = document.querySelector(".js-order-adjustment-row");
  adjustmentRow.hidden = payment.adjustment === 0;
  document.querySelector(".js-order-adjustment-label").textContent = payment.adjustmentLabel;
  document.querySelector(".js-order-adjustment").textContent = formatPrice(payment.adjustment);

  document.querySelector(".js-review-name").textContent = state.customer.fullName || "—";
  document.querySelector(".js-review-phone").textContent = state.customer.phone || "—";
  document.querySelector(".js-review-date").textContent = formatWeddingDate(state.customer.weddingDate);
  document.querySelector(".js-review-venue").textContent = state.customer.venue || "—";
}

function renderServices() {
  const visibleServices = services.filter(
    (service) => state.filter === "all" || service.category === state.filter,
  );

  servicesGrid.innerHTML = visibleServices
    .map((service, index) => {
      const isAdded = state.extras.has(service.id);
      return `
        <article class="builder-service${isAdded ? " is-added" : ""}" data-service="${service.id}">
          <button
            class="builder-service__open"
            type="button"
            aria-label="${service.name} hizmetini incele"
            data-open-service="${service.id}"
          >
            <span class="builder-service__media">
              <img src="${service.image}" alt="${service.name} çekim örneği" loading="lazy" />
            </span>
            <span class="builder-service__details">
              <small>0${index + 1} / İncele</small>
              <strong>${service.name}</strong>
              <b>${formatPrice(service.price)}</b>
            </span>
          </button>
          <button
            class="builder-service__add"
            type="button"
            aria-label="${service.name} hizmetini ${isAdded ? "paketten çıkar" : "pakete ekle"}"
            aria-pressed="${isAdded}"
            data-toggle-service="${service.id}"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
              <path class="line-vertical" d="M12 5v14" />
            </svg>
          </button>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-open-service]").forEach((button) => {
    button.addEventListener("click", () => openServiceDetail(button.dataset.openService));
  });

  document.querySelectorAll("[data-toggle-service]").forEach((button) => {
    button.addEventListener("click", () => toggleService(button.dataset.toggleService));
  });
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

function openServiceDetail(serviceId) {
  const service = services.find((item) => item.id === serviceId);
  if (!service) return;

  state.activeService = serviceId;
  detailTitle.textContent = service.name;
  detailDescription.textContent = service.description;
  detailFeatures.innerHTML = service.features.map((feature) => `<li>${feature}</li>`).join("");
  detailDelivery.textContent = service.delivery;
  detailPrice.textContent = formatPrice(service.price);
  detailThumbs.innerHTML = service.gallery
    .map(
      (image, index) => `
        <button type="button" aria-label="${index + 1}. çekim örneğini göster">
          <img src="${image}" alt="" />
        </button>
      `,
    )
    .join("");

  [...detailThumbs.querySelectorAll("button")].forEach((button, index) => {
    button.addEventListener("click", () => setDetailImage(service, service.gallery[index], index));
  });

  setDetailImage(service, service.gallery[0], 0);
  updateDetailButton(serviceId);
  detailDialog.showModal();
}

function closeServiceDetail() {
  detailDialog.close();
  state.activeService = null;
  if (new URL(window.location.href).searchParams.has("hizmet")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

baseInputs.forEach((input) => {
  input.addEventListener("change", () => {
    state.base = input.value;
    updateBaseSelection();
  });
});

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

checkoutForm.addEventListener("input", (event) => {
  const field = event.target.closest(".form-field");
  if (field && event.target.validity.valid) field.classList.remove("is-invalid");
});

checkoutForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const requiredFields = [...checkoutForm.querySelectorAll("[required]")];

  requiredFields.forEach((input) => {
    input.closest(".form-field").classList.toggle("is-invalid", !input.validity.valid);
  });

  const firstInvalid = requiredFields.find((input) => !input.validity.valid);
  if (firstInvalid) {
    firstInvalid.focus();
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

document.querySelector(".js-terms").addEventListener("change", (event) => {
  if (event.target.checked) document.querySelector(".js-terms-error").hidden = true;
});

document.querySelector(".js-submit-booking").addEventListener("click", () => {
  const terms = document.querySelector(".js-terms");
  const error = document.querySelector(".js-terms-error");

  if (!terms.checked) {
    error.hidden = false;
    terms.focus();
    return;
  }

  const reference = `DA-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  document.querySelector(".js-booking-reference").textContent = reference;
  error.hidden = true;
  completionSuccess.hidden = false;
  completionShowcase.hidden = true;
  bookingCompletion.hidden = false;
  document.body.classList.add("is-completion-open");
  document.querySelectorAll(".builder-header, .builder-progress, .builder-layout").forEach((element) => {
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  });
  document.querySelector(".js-completion-title").focus({ preventScroll: true });
});

function closeCompletionInfo() {
  if (completionInfoDialog.open) completionInfoDialog.close();
}

document.querySelector(".js-show-completion-showcase").addEventListener("click", () => {
  completionSuccess.hidden = true;
  completionShowcase.hidden = false;
  completionShowcase.scrollTop = 0;
  completionInfoDialog.showModal();
});

document.querySelectorAll(".js-booking-info-open").forEach((button) => {
  button.addEventListener("click", () => completionInfoDialog.showModal());
});

document.querySelectorAll(".js-booking-info-close").forEach((button) => {
  button.addEventListener("click", closeCompletionInfo);
});

completionInfoDialog.addEventListener("click", (event) => {
  if (event.target === completionInfoDialog) closeCompletionInfo();
});

function showShowcaseImage(index) {
  activeShowcaseImage = (index + showcaseImageButtons.length) % showcaseImageButtons.length;
  const selectedImage = showcaseImageButtons[activeShowcaseImage].querySelector("img");
  showcaseLightboxImage.src = selectedImage.currentSrc || selectedImage.src;
  showcaseLightboxImage.alt = selectedImage.alt;
  showcaseLightboxCaption.textContent = selectedImage.alt;
  if (!showcaseLightbox.open) showcaseLightbox.showModal();
}

showcaseImageButtons.forEach((button, index) => {
  button.addEventListener("click", () => showShowcaseImage(index));
});

document.querySelector(".js-showcase-lightbox-close").addEventListener("click", () => {
  showcaseLightbox.close();
});

document.querySelector(".js-showcase-lightbox-prev").addEventListener("click", () => {
  showShowcaseImage(activeShowcaseImage - 1);
});

document.querySelector(".js-showcase-lightbox-next").addEventListener("click", () => {
  showShowcaseImage(activeShowcaseImage + 1);
});

showcaseLightbox.addEventListener("click", (event) => {
  if (event.target === showcaseLightbox) showcaseLightbox.close();
});

showcaseLightbox.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") showShowcaseImage(activeShowcaseImage - 1);
  if (event.key === "ArrowRight") showShowcaseImage(activeShowcaseImage + 1);
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    renderServices();
  });
});

document.querySelectorAll(".js-summary-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    document.body.classList.toggle("is-summary-open");
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
    document.body.classList.remove("is-summary-open");
  }
});

renderServices();
updateSummary();
updateProgress();

const weddingDateInput = document.querySelector(".js-wedding-date");
const today = new Date();
const localToday = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");
weddingDateInput.min = localToday;

const requestedService = new URL(window.location.href).searchParams.get("hizmet");
if (requestedService && services.some((service) => service.id === requestedService)) {
  openServiceDetail(requestedService);
}
