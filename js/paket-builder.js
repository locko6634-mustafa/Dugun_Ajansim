const basePackages = {
  mini: {
    name: "Mini Paket",
    price: 20000,
    image: "assets/images/hero-couple.webp",
  },
  signature: {
    name: "İmza Paket",
    price: 28000,
    image: "assets/images/services/fotograf-cekimi.webp",
  },
  timeless: {
    name: "Zamansız Paket",
    price: 36000,
    image: "assets/images/venue-pavilion.webp",
  },
};

const services = [
  {
    id: "fotograf",
    category: "photo",
    name: "Fotoğraf Çekimi",
    price: 7000,
    image: "assets/images/services/fotograf-cekimi.webp",
    gallery: [
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp",
    ],
    description:
      "Günün en doğal anlarını yönlendirmesi güçlü, zarif ve zamansız karelere dönüştürüyoruz. Çekim planı düğün akışınıza göre önceden hazırlanır.",
    features: [
      "Profesyonel fotoğraf ekibi",
      "Çift ve aile portreleri",
      "Özenli renk ve ışık düzenleme",
      "Yüksek çözünürlüklü dijital teslim",
    ],
    delivery: "7–14 iş günü",
  },
  {
    id: "video",
    category: "video",
    name: "Video Çekimi",
    price: 9000,
    image: "assets/images/services/video-cekimi.webp",
    gallery: [
      "assets/images/services/video-cekimi.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Hazırlıktan kutlamaya uzanan günün sesini, hareketini ve duygusunu sinematik bir anlatıyla kaydediyoruz.",
    features: [
      "4K profesyonel video kaydı",
      "Hazırlık ve tören anları",
      "Temel kurgu ve renk düzenleme",
      "Dijital bağlantı ile teslim",
    ],
    delivery: "14–21 iş günü",
  },
  {
    id: "drone",
    category: "video",
    name: "Drone Çekimi",
    price: 8000,
    image: "assets/images/services/drone-cekimi.webp",
    gallery: [
      "assets/images/services/drone-cekimi.webp",
      "assets/images/venue-pavilion.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Profesyonel drone ile düğününüzün en özel anlarını havadan yakalıyoruz. Mekânın ölçeğini ve atmosferini sinematik görüntülerle unutulmaz hale getiriyoruz.",
    features: [
      "4K kalitede hava görüntüsü",
      "Özel rota planlaması",
      "Düğün mekânına uygun çekim",
      "Ortalama 3–5 dakikalık klip içeriği",
    ],
    delivery: "7–14 iş günü",
  },
  {
    id: "klip",
    category: "video",
    name: "Düğün Klibi",
    price: 12000,
    image: "assets/images/services/klip-cekimi.webp",
    gallery: [
      "assets/images/services/klip-cekimi.webp",
      "assets/images/services/video-cekimi.webp",
      "assets/images/groom-portrait.webp",
    ],
    description:
      "Hikâyenizi seçtiğiniz müzik, güçlü sahneler ve dinamik bir kurgu ile size özel kısa bir düğün filmine dönüştürüyoruz.",
    features: [
      "Size özel hikâye akışı",
      "Sinematik çekim ve kurgu",
      "Lisanslı müzik seçeneği",
      "Sosyal medya için kısa versiyon",
    ],
    delivery: "14–21 iş günü",
  },
  {
    id: "album",
    category: "keepsake",
    name: "Albüm Tasarımı",
    price: 7000,
    image: "assets/images/services/album-tasarimi.webp",
    gallery: [
      "assets/images/services/album-tasarimi.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Seçtiğiniz kareleri kaliteli malzeme, dengeli sayfa tasarımı ve size özel kapak seçenekleriyle kalıcı bir hatıraya dönüştürüyoruz.",
    features: [
      "Kişiye özel sayfa tasarımı",
      "Premium baskı ve ciltleme",
      "Kapak malzemesi seçenekleri",
      "Baskı öncesi dijital onay",
    ],
    delivery: "21–30 iş günü",
  },
  {
    id: "video360",
    category: "keepsake",
    name: "360° Video Booth",
    price: 5500,
    image: "assets/images/services/360-video.webp",
    gallery: [
      "assets/images/services/360-video.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Misafirlerinizin eğlenceli anlarını hareketli kamera platformuyla kaydediyor, anında paylaşılabilir kısa videolara dönüştürüyoruz.",
    features: [
      "Profesyonel 360° platform",
      "Etkinlik boyunca operatör",
      "Kişiselleştirilmiş video çerçevesi",
      "Anında dijital paylaşım",
    ],
    delivery: "Etkinlik günü",
  },
];

const moneyFormatter = new Intl.NumberFormat("tr-TR");
const formatPrice = (value) => `${moneyFormatter.format(value)} TL`;

const state = {
  step: 1,
  base: "mini",
  extras: new Set(),
  filter: "all",
  activeService: null,
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
  const total = extras.reduce((sum, service) => sum + service.price, base.price);

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

const requestedService = new URL(window.location.href).searchParams.get("hizmet");
if (requestedService && services.some((service) => service.id === requestedService)) {
  openServiceDetail(requestedService);
}
