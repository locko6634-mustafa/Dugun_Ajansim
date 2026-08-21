import { apiRequest } from "../shared/api-client.js";
import { isSafeImageAssetPath, safeImageAssetPath } from "../shared/asset-url.js";

const COLLAPSED_VENUE_COUNT = 4;
const FALLBACK_IMAGE = "assets/images/venue-pavilion.webp";

const toggleText = (expanded, count) =>
  expanded ? "Daha Az Göster" : `Tüm Mekânları Gör (${count} Mekân)`;

function venuePresentation(venue) {
  const searchText =
    `${venue.slug || ""} ${venue.name || ""} ${venue.displayName || ""}`.toLocaleLowerCase("tr-TR");

  if (searchText.includes("yeşil nesil") || searchText.includes("yesil-nesil")) {
    return {
      description:
        "Geniş yeşil alanı ve göl manzarasıyla açık hava davetlerine ferah bir atmosfer sunar.",
      wide: true
    };
  }
  if (searchText.includes("cess")) {
    return {
      description: "Modern açık hava düzeniyle özel davetlere şık bir atmosfer sunar.",
      wide: false
    };
  }
  if (searchText.includes("rena")) {
    return {
      description: "Ferahlık hissi veren davet alanıyla kalabalık organizasyonlara uyum sağlar.",
      wide: false
    };
  }
  if (searchText.includes("talia")) {
    return {
      description: "Işıklandırılmış bahçe düzeniyle akşam davetlerine sıcak bir atmosfer katar.",
      wide: false
    };
  }
  if (searchText.includes("bella")) {
    return {
      description: "Zarif bahçe düzeniyle açık hava organizasyonlarına seçkin bir ortam sunar.",
      wide: false
    };
  }
  if (searchText.includes("mafsel")) {
    return {
      description: "Doğayla iç içe bahçe düzeniyle açık hava davetlerine sakin bir atmosfer sunar.",
      wide: false
    };
  }
  if (searchText.includes("green house")) {
    return {
      description: "Yeşil alanlarla çevrili davet düzeniyle özel günlere ferah bir ortam sunar.",
      wide: false
    };
  }

  return {
    description: "Özel davetler için özenle hazırlanmış seçkin bir buluşma noktasıdır.",
    wide: false
  };
}

function notifyLayoutChange() {
  window.requestAnimationFrame(() => {
    document.dispatchEvent(new window.CustomEvent("home:layoutchange"));
  });
}

function createVenueCard(venue, index) {
  const card = document.createElement("a");
  const name = venue.displayName || venue.name;
  const presentation = venuePresentation(venue);
  card.className = "venue-card";
  if (index >= COLLAPSED_VENUE_COUNT) card.classList.add("venue-card--extra");
  if (presentation.wide) card.classList.add("venue-card--wide");
  card.href = "#iletisim";
  card.setAttribute("aria-label", `${name} hakkında iletişime geç`);

  const image = document.createElement("img");
  image.className = "venue-card__image";
  image.src = safeImageAssetPath(venue.imagePath, FALLBACK_IMAGE);
  image.alt = `${name} düğün mekânı`;
  image.width = 1280;
  image.height = 853;
  image.loading = "lazy";
  image.addEventListener("error", () => (image.src = FALLBACK_IMAGE), { once: true });

  const content = document.createElement("span");
  content.className = "venue-card__content";

  const label = document.createElement("span");
  label.className = "venue-card__name";
  label.textContent = name;

  const info = document.createElement("span");
  info.className = "venue-card__info";
  info.textContent = presentation.description;

  content.append(label, info);
  card.append(image, content);
  return card;
}

function updateToggle(count) {
  const toggleBtn = document.querySelector(".js-venues-toggle");
  const grid = document.getElementById("venues-grid");
  if (!toggleBtn || !grid) return;
  const wrapper = toggleBtn.closest(".venues-toggle-wrapper");
  const hasExtraVenues = count > COLLAPSED_VENUE_COUNT;
  if (wrapper) wrapper.hidden = !hasExtraVenues;
  grid.setAttribute("data-expanded", "false");
  toggleBtn.setAttribute("aria-expanded", "false");
  const btnText = toggleBtn.querySelector("span");
  if (btnText) btnText.textContent = toggleText(false, count);
}

export function initVenuesToggle() {
  const toggleBtn = document.querySelector(".js-venues-toggle");
  const grid = document.getElementById("venues-grid");
  if (!toggleBtn || !grid) return;
  const wrapper = toggleBtn.closest(".venues-toggle-wrapper");
  if (wrapper) wrapper.hidden = true;

  toggleBtn.addEventListener("click", () => {
    const isExpanded = grid.getAttribute("data-expanded") === "true";
    const nextState = !isExpanded;
    grid.setAttribute("data-expanded", String(nextState));
    toggleBtn.setAttribute("aria-expanded", String(nextState));

    const btnText = toggleBtn.querySelector("span");
    if (btnText) {
      btnText.textContent = toggleText(nextState, Number(grid.dataset.venueCount || 0));
    }
  });
}

async function loadVenues() {
  const grid = document.getElementById("venues-grid");
  if (!grid) return;

  try {
    const response = await apiRequest("/venues");
    if (!Array.isArray(response.data)) throw new Error("Mekân yanıtı geçersiz.");
    const venues = response.data.filter(
      (venue) =>
        venue?.isFeatured === true &&
        isSafeImageAssetPath(venue.imagePath) &&
        (typeof venue.displayName === "string" || typeof venue.name === "string")
    );

    grid.replaceChildren();
    grid.dataset.venueCount = String(venues.length);
    if (!venues.length) {
      const status = document.createElement("p");
      status.className = "venues-status";
      status.textContent = "Yayında olan referans mekân bulunmuyor.";
      grid.append(status);
      updateToggle(0);
      notifyLayoutChange();
      return;
    }

    grid.append(...venues.map((venue, index) => createVenueCard(venue, index)));
    updateToggle(venues.length);
    notifyLayoutChange();
  } catch {
    grid.replaceChildren();
    const status = document.createElement("p");
    status.className = "venues-status";
    status.textContent = "Referans mekânlarımız şu anda yüklenemedi.";
    grid.append(status);
    updateToggle(0);
    notifyLayoutChange();
  }
}

initVenuesToggle();
loadVenues();
