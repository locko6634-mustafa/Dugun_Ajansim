export function renderServiceDetail({ service, formatPrice, elements }) {
  const { eyebrow, title, description, features, delivery, price, thumbs, mainImage, number } =
    elements;

  const selectImage = (image, index) => {
    mainImage.src = image;
    mainImage.alt = `${service.name} çekim örneği ${index + 1}`;
    number.textContent = `0${index + 1}`;
    thumbs.querySelectorAll("button").forEach((button, buttonIndex) => {
      button.classList.toggle("is-active", buttonIndex === index);
    });
  };

  eyebrow.textContent = service.eyebrow;
  title.textContent = service.name;
  description.textContent = service.description;
  features.replaceChildren(
    ...service.features.map((feature) => {
      const item = document.createElement("li");
      item.textContent = feature;
      return item;
    })
  );
  delivery.textContent = service.delivery;
  if (price && typeof formatPrice === "function") {
    price.textContent = formatPrice(service.price);
  }
  thumbs.replaceChildren(
    ...service.gallery.map((image, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `${index + 1}. çekim örneğini göster`);

      const thumbnail = document.createElement("img");
      thumbnail.src = image;
      thumbnail.alt = "";
      button.append(thumbnail);
      button.addEventListener("click", () => selectImage(image, index));
      return button;
    })
  );

  selectImage(service.gallery[0], 0);
}
