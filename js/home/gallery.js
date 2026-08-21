const galleryCards = [...document.querySelectorAll(".gallery-card")];
const galleryViewport = document.querySelector("[data-gallery-viewport]");
const galleryTrack = galleryViewport?.querySelector(".gallery-track");
const galleryReveal = document.querySelector("[data-gallery-reveal]");
const galleryRevealLabel = galleryReveal?.querySelector("[data-gallery-reveal-label]");
const galleryLightbox = document.querySelector(".gallery-lightbox");
const galleryLightboxImage = galleryLightbox.querySelector("img");
const galleryLightboxCaption = galleryLightbox.querySelector("figcaption");
const galleryLightboxClose = galleryLightbox.querySelector(".gallery-lightbox__close");
const galleryLightboxPrev = galleryLightbox.querySelector(".gallery-lightbox__nav--prev");
const galleryLightboxNext = galleryLightbox.querySelector(".gallery-lightbox__nav--next");
let activeGalleryIndex = 0;

if (galleryViewport && galleryTrack && galleryReveal && galleryRevealLabel) {
  const setCollapsedCardAccess = (isExpanded) => {
    galleryCards.slice(4).forEach((card) => {
      card.toggleAttribute("inert", !isExpanded);
    });
  };

  const syncExpandedHeight = () => {
    galleryViewport.style.setProperty(
      "--gallery-expanded-height",
      `${galleryTrack.scrollHeight}px`
    );
  };

  const setGalleryExpanded = (isExpanded) => {
    syncExpandedHeight();
    galleryViewport.classList.toggle("is-expanded", isExpanded);
    galleryReveal.classList.toggle("is-expanded", isExpanded);
    galleryReveal.setAttribute("aria-expanded", String(isExpanded));
    galleryRevealLabel.textContent = isExpanded ? "Daha Az Göster" : "Tümünü Gör";
    setCollapsedCardAccess(isExpanded);
  };

  syncExpandedHeight();
  galleryViewport.classList.add("is-collapsible");
  galleryReveal.hidden = false;
  setGalleryExpanded(false);

  galleryReveal.addEventListener("click", () => {
    setGalleryExpanded(galleryReveal.getAttribute("aria-expanded") !== "true");
  });

  if ("ResizeObserver" in window) {
    new window.ResizeObserver(syncExpandedHeight).observe(galleryTrack);
  } else {
    window.addEventListener("resize", syncExpandedHeight, { passive: true });
  }
}

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
