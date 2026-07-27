const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = mobileMenu.querySelectorAll("a");
const faqQuestions = document.querySelectorAll(".faq-question");
const openAllFaqButton = document.querySelector(".js-open-all-faq");
const galleryTrack = document.querySelector(".gallery-track");
const galleryCards = [...document.querySelectorAll(".gallery-card")];
const galleryProgress = [...document.querySelectorAll(".gallery-mobile-progress span")];
const galleryLightbox = document.querySelector(".gallery-lightbox");
const galleryLightboxImage = galleryLightbox.querySelector("img");
const galleryLightboxCaption = galleryLightbox.querySelector("figcaption");
const galleryLightboxClose = galleryLightbox.querySelector(".gallery-lightbox__close");
const galleryLightboxPrev = galleryLightbox.querySelector(".gallery-lightbox__nav--prev");
const galleryLightboxNext = galleryLightbox.querySelector(".gallery-lightbox__nav--next");
const shootCards = [...document.querySelectorAll(".shoot-card")];
let activeGalleryIndex = 0;

function setMenu(open) {
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
  mobileMenu.setAttribute("aria-hidden", String(!open));
  mobileMenu.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
}

menuButton.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

mobileLinks.forEach((link) => {
  link.addEventListener("click", () => setMenu(false));
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 1060) setMenu(false);
});
