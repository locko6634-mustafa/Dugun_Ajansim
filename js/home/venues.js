import { apiRequest } from "../shared/api-client.js";
import { isSafeImageAssetPath, safeImageAssetPath } from "../shared/asset-url.js";

const COLLAPSED_VENUE_COUNT = 4;
const FALLBACK_IMAGE = "assets/images/venue-pavilion.webp";

const toggleText = (expanded, count) =>
  expanded ? "Daha Az Göster" : `Tüm Mekânları Gör (${count} Mekân)`;

function notifyLayoutChange() {
  window.requestAnimationFrame(() => {
    document.dispatchEvent(new window.CustomEvent("home:layoutchange"));
  });
}

function createVenueCard(venue, index) {
  const card = document.createElement("a");
  const name = venue.displayName || venue.name;
  const detail = venue.name && venue.name !== name ? venue.name : "Düğün ve davet mekânı";
  card.className = "venue-card";
  if (index >= COLLAPSED_VENUE_COUNT) card.classList.add("venue-card--extra");
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
  info.textContent = detail;

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
