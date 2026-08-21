import { apiRequest, hasApiEndpoint } from "../shared/api-client.js";
import { isSafeImageAssetPath, safeImageAssetPath } from "../shared/asset-url.js";
import { formatAppCurrency } from "../shared/runtime-config.js";
import { renderServiceDetail } from "../shared/service-detail.js";

const fallbackImage = "assets/images/hero-couple.webp";
const svgNamespace = "http://www.w3.org/2000/svg";

const serviceIconShapes = {
  fotograf: [
    ["path", { d: "M8 16h8l3-5h10l3 5h8v23H8V16Z" }],
    ["circle", { cx: "24", cy: "27", r: "7" }]
  ],
  video: [
    ["rect", { x: "7", y: "13", width: "25", height: "22", rx: "3" }],
    ["path", { d: "m32 21 9-5v16l-9-5M18 20l8 4-8 4v-8Z" }]
  ],
  drone: [
    ["path", { d: "M15 20h18l-3 12H18l-3-12ZM24 20v-6M11 14h10M27 14h10" }],
    ["circle", { cx: "10", cy: "14", r: "3" }],
    ["circle", { cx: "38", cy: "14", r: "3" }],
    ["path", { d: "M19 32v4m10-4v4M17 36h14" }]
  ],
  "jimmy-jib": [
    ["path", { d: "M7 36h34M15 36l8-22 6 22M12 19l25-8M34 9l5 5" }],
    ["rect", { x: "6", y: "17", width: "8", height: "6", rx: "1" }]
  ],
  "dis-cekim": [
    ["path", { d: "M8 37 19 24l7 8 5-6 9 11H8ZM11 15h8l2-3h7l2 3h7" }],
    ["circle", { cx: "24", cy: "19", r: "5" }]
  ],
  organizasyon: [
    ["path", { d: "m24 7 2.6 8.4L35 18l-8.4 2.6L24 29l-2.6-8.4L13 18l8.4-2.6L24 7Z" }],
    [
      "path",
      {
        d: "m37 27 1.4 4.6L43 33l-4.6 1.4L37 39l-1.4-4.6L31 33l4.6-1.4L37 27ZM10 27l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"
      }
    ]
  ],
  album: [
    ["path", { d: "M9 10h13a5 5 0 0 1 5 5v24H14a5 5 0 0 1-5-5V10Z" }],
    ["path", { d: "M27 15a5 5 0 0 1 5-5h7v29H27M14 31h8" }]
  ],
  "aninda-baski": [
    ["path", { d: "M14 17V8h20v9M12 34H8V18h32v16h-4" }],
    ["rect", { x: "14", y: "27", width: "20", height: "13" }],
    ["path", { d: "m18 36 4-4 3 3 3-3 3 4" }],
    ["circle", { cx: "35", cy: "22", r: "1" }]
  ],
  production: [
    ["rect", { x: "8", y: "11", width: "32", height: "26", rx: "3" }],
    ["path", { d: "m20 18 10 6-10 6V18Z" }]
  ],
  experience: [
    ["path", { d: "m24 8 3.2 10.8L38 22l-10.8 3.2L24 36l-3.2-10.8L10 22l10.8-3.2L24 8Z" }]
  ],
  other: [["path", { d: "M24 39S9 30 9 18a8 8 0 0 1 15-4 8 8 0 0 1 15 4c0 12-15 21-15 21Z" }]]
};

function formatPrice(amount) {
  if (!Number.isFinite(amount)) return "Güncel fiyatı paket oluşturucuda görün";
  return formatAppCurrency(amount, { maximumFractionDigits: 0 });
}

document.addEventListener("DOMContentLoaded", () => {
  const detailDialog = document.getElementById("home-service-detail");
  const servicesGrid = document.querySelector(".services-grid");
  if (!detailDialog || !servicesGrid) return;

  const detailClose = detailDialog.querySelector(".js-detail-close");
  const detailMainImage = detailDialog.querySelector(".js-detail-main-image");
  const detailNumber = detailDialog.querySelector(".js-detail-number");
  const detailThumbs = detailDialog.querySelector(".js-detail-thumbs");
  const detailEyebrow = detailDialog.querySelector(".service-detail__eyebrow");
  const detailTitle = detailDialog.querySelector(".js-detail-title");
  const detailDescription = detailDialog.querySelector(".js-detail-description");
  const detailFeatures = detailDialog.querySelector(".js-detail-features");
  const detailDelivery = detailDialog.querySelector(".js-detail-delivery");
  const detailPrice = detailDialog.querySelector(".js-detail-price");
  const detailAction = detailDialog.querySelector(".js-detail-action");
  const startingPrice = document.querySelector(".js-starting-price");
  const cardIcons = new Map(
    [...servicesGrid.querySelectorAll(".service-card")].flatMap((card) => {
      const code = card.querySelector("[data-open-service]")?.dataset.openService;
      const icon = card.querySelector(".service-card__icon");
      return code && icon ? [[code, icon.cloneNode(true)]] : [];
    })
  );
  let catalogServices = [];
  let activeServiceId = null;

  function notifyLayoutChange() {
    window.requestAnimationFrame(() => {
      document.dispatchEvent(new window.CustomEvent("home:layoutchange"));
    });
  }

  function createServiceIcon(service) {
    const icon = document.createElement("span");
    icon.className = "service-card__icon";
    icon.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    const shapes =
      serviceIconShapes[service.id] ||
      serviceIconShapes[service.category] ||
      serviceIconShapes.other;
    shapes.forEach(([elementName, attributes]) => {
      const shape = document.createElementNS(svgNamespace, elementName);
      Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
      svg.append(shape);
    });
    icon.append(svg);
    return icon;
  }

  function createServiceCard(service) {
    const card = document.createElement("article");
    card.className = "service-card";

    const media = document.createElement("figure");
    media.className = "service-card__media";
    const image = document.createElement("img");
    image.src = service.image;
    image.alt = `${service.name} hizmeti`;
    image.width = 1200;
    image.height = 800;
    image.loading = "lazy";
    media.append(image);

    const body = document.createElement("div");
    body.className = "service-card__body";
    const icon = cardIcons.get(service.id)?.cloneNode(true) || createServiceIcon(service);
    const title = document.createElement("h3");
    title.textContent = service.name;
    const description = document.createElement("p");
    description.textContent = service.description;
    const button = document.createElement("button");
    button.className = "service-card__link";
    button.type = "button";
    button.dataset.openService = service.id;
    button.setAttribute("aria-label", `${service.name} hizmetini incele`);
    button.append("İncele ");
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    button.append(arrow);
    body.append(icon, title, description, button);
    card.append(media, body);
    return card;
  }

  function renderServiceCards() {
    if (!catalogServices.length) {
      const emptyMessage = document.createElement("p");
      emptyMessage.className = "services-empty";
      emptyMessage.textContent = "Aktif hizmetler kısa süre içinde burada yayınlanacak.";
      servicesGrid.replaceChildren(emptyMessage);
      notifyLayoutChange();
      return;
    }
    servicesGrid.replaceChildren(...catalogServices.map(createServiceCard));
    notifyLayoutChange();
  }

  function renderCatalogUnavailable() {
    const message = document.createElement("p");
    message.className = "services-empty";
    message.textContent = "Hizmet kataloğu şu anda yüklenemiyor. Lütfen daha sonra tekrar deneyin.";
    catalogServices = [];
    servicesGrid.replaceChildren(message);
    notifyLayoutChange();
  }

  function normalizeCatalogServices(remoteServices) {
    if (!Array.isArray(remoteServices)) throw new Error("Hizmet kataloğu geçersiz.");
    return remoteServices.map((item) => {
      if (
        typeof item?.code !== "string" ||
        !item.code ||
        typeof item.name !== "string" ||
        !item.name ||
        !Number.isSafeInteger(item.priceCents) ||
        item.priceCents < 0
      ) {
        throw new Error("Hizmet kataloğunda geçersiz kayıt var.");
      }

      const gallery = Array.isArray(item.gallery)
        ? item.gallery.filter(isSafeImageAssetPath).map((value) => value.trim())
        : [];
      const image = isSafeImageAssetPath(item.imagePath)
        ? safeImageAssetPath(item.imagePath, fallbackImage)
        : gallery[0] || fallbackImage;
      return {
        id: item.code,
        category: typeof item.category === "string" ? item.category : "other",
        name: item.name,
        eyebrow: (typeof item.eyebrow === "string" && item.eyebrow) || "Düğününüze Özel Hizmet",
        price: item.priceCents / 100,
        image,
        gallery: gallery.length ? gallery : [image],
        description:
          (typeof item.description === "string" && item.description) ||
          "Düğününüze özel olarak planlanan profesyonel hizmet.",
        features: Array.isArray(item.features)
          ? item.features.filter((value) => typeof value === "string" && value)
          : [],
        delivery:
          (typeof item.delivery === "string" && item.delivery) || "Paket teslim planına göre"
      };
    });
  }

  async function hydrateCatalog() {
    if (!hasApiEndpoint()) {
      if (startingPrice) startingPrice.textContent = "Paket oluşturucuda güncel fiyatı görün";
      renderCatalogUnavailable();
      return;
    }
    try {
      const response = await apiRequest("/catalog");
      const packages = Array.isArray(response.data?.packages) ? response.data.packages : [];
      catalogServices = normalizeCatalogServices(response.data?.services);
      renderServiceCards();

      const packagePrices = packages
        .map((item) => item.priceCents)
        .filter((priceCents) => Number.isSafeInteger(priceCents) && priceCents >= 0);
      if (startingPrice) {
        startingPrice.textContent = packagePrices.length
          ? formatPrice(Math.min(...packagePrices) / 100)
          : "Paket oluşturucuda güncel fiyatı görün";
      }
      if (activeServiceId) {
        const activeService = catalogServices.find((item) => item.id === activeServiceId);
        if (activeService) openHomeServiceDetail(activeServiceId);
        else detailDialog.close();
      }
    } catch {
      if (startingPrice) startingPrice.textContent = "Paket oluşturucuda güncel fiyatı görün";
      renderCatalogUnavailable();
    }
  }

  function openHomeServiceDetail(serviceId) {
    const service = catalogServices.find((item) => item.id === serviceId);
    if (!service) return;

    activeServiceId = serviceId;
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

    if (detailAction) {
      detailAction.href = `paketini-olustur.html?hizmet=${service.id}`;
    }

    if (!detailDialog.open) detailDialog.showModal();
  }

  servicesGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-service]");
    if (!button) return;
    event.preventDefault();
    const serviceId = button.dataset.openService;
    if (serviceId) openHomeServiceDetail(serviceId);
  });

  void hydrateCatalog();

  detailClose?.addEventListener("click", () => {
    detailDialog.close();
  });

  detailDialog.addEventListener("close", () => {
    activeServiceId = null;
  });

  detailDialog.addEventListener("click", (event) => {
    const rect = detailDialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;

    if (!isInDialog) detailDialog.close();
  });
});
