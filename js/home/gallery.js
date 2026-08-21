const galleryCards = [...document.querySelectorAll(".gallery-card")];
const galleryLightbox = document.querySelector(".gallery-lightbox");
const galleryLightboxImage = galleryLightbox.querySelector("img");
const galleryLightboxCaption = galleryLightbox.querySelector("figcaption");
const galleryLightboxClose = galleryLightbox.querySelector(".gallery-lightbox__close");
const galleryLightboxPrev = galleryLightbox.querySelector(".gallery-lightbox__nav--prev");
const galleryLightboxNext = galleryLightbox.querySelector(".gallery-lightbox__nav--next");
let activeGalleryIndex = 0;
function showGalleryImage(index) {
  activeGalleryIndex = (index + galleryCards.length) % galleryCards.length;
  const image = galleryCards[activeGalleryIndex].querySelector("img");

  galleryLightboxImage.src = image.currentSrc || image.src;
  galleryLightboxImage.alt = image.alt;
  galleryLightboxCaption.textContent = image.alt;
}

galleryCards.forEach((card, index) => {
  card.addEventListener("click", () => {
    showGalleryImage(index);
    galleryLightbox.showModal();
  });
});

galleryLightboxClose.addEventListener("click", () => galleryLightbox.close());
galleryLightboxPrev.addEventListener("click", () => showGalleryImage(activeGalleryIndex - 1));
galleryLightboxNext.addEventListener("click", () => showGalleryImage(activeGalleryIndex + 1));

galleryLightbox.addEventListener("click", (event) => {
  if (event.target === galleryLightbox) galleryLightbox.close();
});

galleryLightbox.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") showGalleryImage(activeGalleryIndex - 1);
  if (event.key === "ArrowRight") showGalleryImage(activeGalleryIndex + 1);
});
