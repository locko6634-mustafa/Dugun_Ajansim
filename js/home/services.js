import { apiRequest, hasApiEndpoint } from "../shared/api-client.js";
import { isSafeImageAssetPath, safeImageAssetPath } from "../shared/asset-url.js";
import { formatAppCurrency } from "../shared/runtime-config.js";
import { renderServiceDetail } from "../shared/service-detail.js";

const fallbackImage = "assets/images/hero-couple.webp";

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

  function createFallbackIcon() {
    const icon = document.createElement("span");
    icon.className = "service-card__icon";
    icon.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "24");
    circle.setAttribute("cy", "24");
    circle.setAttribute("r", "15");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M24 15v18M15 24h18");
    svg.append(circle, path);
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
    const icon = cardIcons.get(service.id)?.cloneNode(true) || createFallbackIcon();
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
