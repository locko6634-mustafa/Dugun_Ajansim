import { services as homeServices } from "../shared/service-catalog.js";
import { apiRequest, hasApiEndpoint } from "../shared/api-client.js";

function formatPrice(amount) {
  if (!Number.isFinite(amount)) return "Güncel fiyatı paket oluşturucuda görün";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0
  }).format(amount);
}

document.addEventListener("DOMContentLoaded", () => {
  const detailDialog = document.getElementById("home-service-detail");
  if (!detailDialog) return;

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
  let activeServiceId = null;

  async function hydrateCatalogPrices() {
    if (!hasApiEndpoint()) {
      if (startingPrice) startingPrice.textContent = "Paket oluşturucuda güncel fiyatı görün";
      return;
    }
    try {
      const response = await apiRequest("/catalog");
      const packages = Array.isArray(response.data?.packages) ? response.data.packages : [];
      const remoteServices = Array.isArray(response.data?.services) ? response.data.services : [];

      remoteServices.forEach((remoteService) => {
        const service = homeServices.find((item) => item.id === remoteService.code);
        if (
          service &&
          Number.isSafeInteger(remoteService.priceCents) &&
          remoteService.priceCents >= 0
        ) {
          service.price = remoteService.priceCents / 100;
        }
      });

      const packagePrices = packages
        .map((item) => item.priceCents)
        .filter((priceCents) => Number.isSafeInteger(priceCents) && priceCents >= 0);
      if (startingPrice) {
        startingPrice.textContent = packagePrices.length
          ? formatPrice(Math.min(...packagePrices) / 100)
          : "Paket oluşturucuda güncel fiyatı görün";
      }
      if (activeServiceId) {
        const activeService = homeServices.find((item) => item.id === activeServiceId);
        detailPrice.textContent = formatPrice(activeService?.price);
      }
    } catch {
      if (startingPrice) startingPrice.textContent = "Paket oluşturucuda güncel fiyatı görün";
    }
  }

  function setDetailImage(service, imagePath, index) {
    detailMainImage.src = imagePath;
    detailMainImage.alt = `${service.name} çekim örneği ${index + 1}`;
    detailNumber.textContent = `0${index + 1}`;
    detailThumbs.querySelectorAll("button").forEach((button, buttonIndex) => {
      button.classList.toggle("is-active", buttonIndex === index);
    });
  }

  function openHomeServiceDetail(serviceId) {
    const service = homeServices.find((item) => item.id === serviceId);
    if (!service) return;

    activeServiceId = serviceId;
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

    if (detailAction) {
      detailAction.href = `paketini-olustur.html?hizmet=${service.id}`;
    }

    detailThumbs.replaceChildren(
      ...service.gallery.map((image, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", `${index + 1}. çekim örneğini göster`);

        const img = document.createElement("img");
        img.src = image;
        img.alt = "";

        button.append(img);
        button.addEventListener("click", () => setDetailImage(service, image, index));
        return button;
      })
    );

    setDetailImage(service, service.gallery[0], 0);
    detailDialog.showModal();
  }

  document.querySelectorAll("[data-open-service]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const serviceId = button.dataset.openService;
      if (serviceId) openHomeServiceDetail(serviceId);
    });
  });

  void hydrateCatalogPrices();

  detailClose?.addEventListener("click", () => {
    detailDialog.close();
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
