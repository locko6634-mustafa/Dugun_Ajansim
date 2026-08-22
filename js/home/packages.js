import { apiRequest } from "../shared/api-client.js";
import { safeImageAssetPath } from "../shared/asset-url.js";
import { formatAppCurrency } from "../shared/runtime-config.js";

const FALLBACK_IMAGE = "assets/images/why-digital-delivery.webp";

function notifyLayoutChange() {
  window.requestAnimationFrame(() => {
    document.dispatchEvent(new window.CustomEvent("home:layoutchange"));
  });
}

function createPackageCard(packageItem) {
  const card = document.createElement("article");
  card.className = "package-card";
  card.dataset.packageCode = packageItem.code;

  const media = document.createElement("figure");
  media.className = "package-card__media";
  const image = document.createElement("img");
  image.src = safeImageAssetPath(packageItem.imagePath, FALLBACK_IMAGE);
  image.alt = `${packageItem.name} düğün çekimi örneği`;
  image.width = 700;
  image.height = 350;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => (image.src = FALLBACK_IMAGE), { once: true });
  media.append(image);

  const body = document.createElement("div");
  body.className = "package-card__body";

  const label = document.createElement("p");
  label.className = "package-card__label";
  label.textContent = packageItem.subtitle || "Hazır çekim paketi";

  const title = document.createElement("h3");
  title.textContent = packageItem.name;

  const price = document.createElement("p");
  price.className = "package-card__price";
  price.textContent = formatAppCurrency(packageItem.priceCents / 100, {
    maximumFractionDigits: 0
  });

  const ornament = document.createElement("span");
  ornament.className = "package-card__ornament";
  ornament.setAttribute("aria-hidden", "true");
  ornament.textContent = "◇";

  body.append(label, title, price, ornament);

  if (packageItem.description) {
    const description = document.createElement("p");
    description.className = "package-card__description";
    description.textContent = packageItem.description;
    body.append(description);
  }

  const features = document.createElement("ul");
  packageItem.features.forEach((feature) => {
    const item = document.createElement("li");
    const check = document.createElement("span");
    check.className = "package-card__check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    const text = document.createElement("span");
    text.textContent = feature;
    item.append(check, text);
    features.append(item);
  });
  body.append(features);

  if (packageItem.deliveryText) {
    const note = document.createElement("p");
    note.className = "package-card__note";
    note.textContent = packageItem.deliveryText;
    body.append(note);
  }

  card.append(media, body);
  return card;
}

function validPackage(packageItem) {
  return (
    packageItem &&
    typeof packageItem.code === "string" &&
    typeof packageItem.name === "string" &&
    Number.isSafeInteger(packageItem.priceCents) &&
    packageItem.priceCents >= 0 &&
    Array.isArray(packageItem.features) &&
    packageItem.features.every((feature) => typeof feature === "string")
  );
}

function renderStatus(container, message) {
  const status = document.createElement("p");
  status.className = "package-invitation__status";
  status.textContent = message;
  container.replaceChildren(status);
  notifyLayoutChange();
}

async function loadPackages() {
  const container = document.querySelector(".package-invitation__packages");
  if (!container) return;

  try {
    const response = await apiRequest("/catalog");
    if (!Array.isArray(response.data?.packages)) throw new Error("Paket yanıtı geçersiz.");
    const packages = response.data.packages.filter(validPackage);
    if (!packages.length) {
      renderStatus(container, "Şu anda yayında olan hazır paket bulunmuyor.");
      return;
    }
    container.replaceChildren(...packages.map(createPackageCard));
    notifyLayoutChange();
  } catch {
    renderStatus(container, "Hazır paketlerimiz şu anda yüklenemedi.");
  }
}

loadPackages();
