import { services as homeServices } from "../shared/service-catalog.js";

function formatPrice(amount) {
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
