const galleryTrack = document.querySelector(".gallery-track");
const galleryCards = [...document.querySelectorAll(".gallery-card")];
const galleryProgress = [...document.querySelectorAll(".gallery-mobile-progress span")];
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
let galleryScrollFrame;

galleryTrack.addEventListener(
  "scroll",
  () => {
    cancelAnimationFrame(galleryScrollFrame);
    galleryScrollFrame = requestAnimationFrame(() => {
      if (window.innerWidth > 760) return;

      const trackCenter = galleryTrack.scrollLeft + galleryTrack.clientWidth / 2;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      galleryCards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const distance = Math.abs(trackCenter - cardCenter);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      const progressIndex = Math.round(
        (nearestIndex / Math.max(galleryCards.length - 1, 1)) * (galleryProgress.length - 1),
      );

      galleryProgress.forEach((dot, index) => {
        dot.classList.toggle("is-active", index === progressIndex);
      });
    });
  },
  { passive: true },
);
