const galleryCards = [...document.querySelectorAll(".gallery-card")];
const galleryViewport = document.querySelector("[data-gallery-viewport]");
const galleryTrack = galleryViewport?.querySelector(".gallery-track");
const galleryReveal = document.querySelector("[data-gallery-reveal]");
const galleryRevealLabel = galleryReveal?.querySelector("[data-gallery-reveal-label]");
const galleryFilters = [...document.querySelectorAll("[data-gallery-filter]")];
const galleryLightbox = document.querySelector(".gallery-lightbox");
const galleryLightboxImage = galleryLightbox?.querySelector("img");
const galleryLightboxCaption = galleryLightbox?.querySelector("figcaption");
const galleryLightboxClose = galleryLightbox?.querySelector(".gallery-lightbox__close");
const galleryLightboxPrev = galleryLightbox?.querySelector(".gallery-lightbox__nav--prev");
const galleryLightboxNext = galleryLightbox?.querySelector(".gallery-lightbox__nav--next");
let activeGalleryIndex = 0;
let visibleGalleryCards = galleryCards;

if (galleryViewport && galleryTrack) {
  const canRevealGallery = Boolean(galleryReveal && galleryRevealLabel);

  const setCollapsedCardAccess = (isExpanded) => {
    galleryCards.slice(4).forEach((card) => {
      card.toggleAttribute("inert", !isExpanded);
    });
  };

  const syncExpandedHeight = () => {
    const firstCollapsedCard = galleryCards[4];
    const trackTop = galleryTrack.getBoundingClientRect().top;
    const collapsedCardRect = firstCollapsedCard?.getBoundingClientRect();
    const collapsedPreviewHeight = collapsedCardRect
      ? Math.min(Math.max(collapsedCardRect.height * 0.2, 64), 96)
      : 0;

    galleryViewport.style.setProperty(
      "--gallery-expanded-height",
      `${galleryTrack.scrollHeight}px`
    );
    galleryViewport.style.setProperty(
      "--gallery-collapsed-height",
      `${collapsedCardRect ? collapsedCardRect.top - trackTop + collapsedPreviewHeight : galleryTrack.scrollHeight}px`
    );
  };

  const setGalleryExpanded = (isExpanded) => {
    if (!galleryReveal || !galleryRevealLabel) return;

    syncExpandedHeight();
    galleryViewport.classList.toggle("is-expanded", isExpanded);
    galleryReveal.classList.toggle("is-expanded", isExpanded);
    galleryReveal.setAttribute("aria-expanded", String(isExpanded));
    galleryRevealLabel.textContent = isExpanded ? "Daha Az Göster" : "Tümünü Gör";
    setCollapsedCardAccess(isExpanded);
  };

  const setGalleryFilter = (filter) => {
    const showAll = filter === "all";
    let filterOrder = 0;

    galleryFilters.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.galleryFilter === filter));
    });

    galleryCards.forEach((card) => {
      const categories = card.dataset.galleryCategory?.split(" ") || [];
      const isVisible = showAll || categories.includes(filter);

      card.hidden = !isVisible;
      card.toggleAttribute("inert", !isVisible);
      if (isVisible && !showAll) {
        filterOrder += 1;
        card.dataset.filterOrder = String(filterOrder);
      } else {
        delete card.dataset.filterOrder;
      }
    });

    visibleGalleryCards = galleryCards.filter((card) => !card.hidden);
    galleryTrack.classList.toggle("is-filtered", !showAll);

    if (showAll) {
      if (canRevealGallery) {
        galleryViewport.classList.add("is-collapsible");
        galleryReveal.hidden = false;
        setGalleryExpanded(false);
      } else {
        galleryViewport.classList.remove("is-collapsible", "is-expanded");
        galleryViewport.style.removeProperty("--gallery-collapsed-height");
        galleryViewport.style.removeProperty("--gallery-expanded-height");
        setCollapsedCardAccess(true);
      }
      return;
    }

    galleryViewport.classList.remove("is-collapsible", "is-expanded");
    galleryViewport.style.removeProperty("--gallery-collapsed-height");
    galleryViewport.style.removeProperty("--gallery-expanded-height");
    if (galleryReveal && galleryRevealLabel) {
      galleryReveal.hidden = true;
      galleryReveal.classList.remove("is-expanded");
      galleryReveal.setAttribute("aria-expanded", "false");
      galleryRevealLabel.textContent = "Tümünü Gör";
    }
  };

  if (galleryReveal && galleryRevealLabel) {
    syncExpandedHeight();
    galleryViewport.classList.add("is-collapsible");
    galleryReveal.hidden = false;
    setGalleryExpanded(false);

    galleryReveal.addEventListener("click", () => {
      setGalleryExpanded(galleryReveal.getAttribute("aria-expanded") !== "true");
    });
  } else {
    setCollapsedCardAccess(true);
  }

  galleryFilters.forEach((button) => {
    button.addEventListener("click", () => {
      setGalleryFilter(button.dataset.galleryFilter || "all");
    });
  });

  if (canRevealGallery && "ResizeObserver" in window) {
    new window.ResizeObserver(syncExpandedHeight).observe(galleryTrack);
  } else if (canRevealGallery) {
    window.addEventListener("resize", syncExpandedHeight, { passive: true });
  }
}

function showGalleryImage(index) {
  if (!visibleGalleryCards.length || !galleryLightboxImage || !galleryLightboxCaption) return;

  activeGalleryIndex = (index + visibleGalleryCards.length) % visibleGalleryCards.length;
  const image = visibleGalleryCards[activeGalleryIndex].querySelector("img");

  galleryLightboxImage.src = image.currentSrc || image.src;
  galleryLightboxImage.alt = image.alt;
  galleryLightboxCaption.textContent = image.alt;
}

galleryCards.forEach((card, index) => {
  card.addEventListener("click", () => {
    if (!galleryLightbox) return;

    const visibleIndex = visibleGalleryCards.indexOf(card);
    showGalleryImage(visibleIndex === -1 ? index : visibleIndex);
    galleryLightbox.showModal();
  });
});

galleryLightboxClose?.addEventListener("click", () => galleryLightbox.close());
galleryLightboxPrev?.addEventListener("click", () => showGalleryImage(activeGalleryIndex - 1));
galleryLightboxNext?.addEventListener("click", () => showGalleryImage(activeGalleryIndex + 1));

galleryLightbox?.addEventListener("click", (event) => {
  if (event.target === galleryLightbox) galleryLightbox.close();
});

galleryLightbox?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") showGalleryImage(activeGalleryIndex - 1);
  if (event.key === "ArrowRight") showGalleryImage(activeGalleryIndex + 1);
});
