const galleryPreview = document.querySelector("[data-gallery-preview]");

if (galleryPreview) {
  const gallerySection = galleryPreview.closest(".gallery-section");
  const filters = [...gallerySection.querySelectorAll("[data-gallery-filter]")];
  const items = [...galleryPreview.querySelectorAll("[data-gallery-preview-item]")];
  const mainImage = galleryPreview.querySelector("[data-gallery-preview-main]");
  const leftImage = galleryPreview.querySelector("[data-gallery-preview-left]");
  const rightImage = galleryPreview.querySelector("[data-gallery-preview-right]");
  const caption = galleryPreview.querySelector("[data-gallery-preview-caption]");
  const stage = galleryPreview.querySelector(".gallery-preview__stage");
  const thumbnailStrip = galleryPreview.querySelector(".gallery-preview__thumbs");
  const previousButton = galleryPreview.querySelector("[data-gallery-preview-prev]");
  const nextButton = galleryPreview.querySelector("[data-gallery-preview-next]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeItem = items.find((item) => item.getAttribute("aria-pressed") === "true") || items[0];
  let pointerStart = null;
  let thumbnailScrollFrame;

  const setImage = (target, source, alt = "") => {
    const image = source.querySelector("img");
    target.src = image.getAttribute("src");
    target.alt = alt;
  };

  const keepActiveThumbnailVisible = () => {
    if (!thumbnailStrip || !activeItem || activeItem.hidden) return;

    cancelAnimationFrame(thumbnailScrollFrame);
    thumbnailScrollFrame = requestAnimationFrame(() => {
      const stripBounds = thumbnailStrip.getBoundingClientRect();
      const itemBounds = activeItem.getBoundingClientRect();
      const edgeInset = 3;
      let nextScrollLeft = thumbnailStrip.scrollLeft;

      if (itemBounds.right > stripBounds.right - edgeInset) {
        nextScrollLeft += itemBounds.right - stripBounds.right + edgeInset;
      } else if (itemBounds.left < stripBounds.left + edgeInset) {
        nextScrollLeft -= stripBounds.left - itemBounds.left + edgeInset;
      }

      const maximumScroll = Math.max(0, thumbnailStrip.scrollWidth - thumbnailStrip.clientWidth);
      nextScrollLeft = Math.max(0, Math.min(nextScrollLeft, maximumScroll));

      if (Math.abs(nextScrollLeft - thumbnailStrip.scrollLeft) < 1) return;

      thumbnailStrip.scrollTo({
        left: nextScrollLeft,
        behavior: reducedMotion.matches ? "auto" : "smooth"
      });
    });
  };

  const updateStage = (nextItem, direction = 0) => {
    const visibleItems = items.filter((item) => !item.hidden);
    if (!visibleItems.length) return;

    activeItem = visibleItems.includes(nextItem) ? nextItem : visibleItems[0];
    const activeIndex = visibleItems.indexOf(activeItem);
    const previousItem =
      visibleItems[(activeIndex - 1 + visibleItems.length) % visibleItems.length];
    const nextVisibleItem = visibleItems[(activeIndex + 1) % visibleItems.length];
    const activeLabel = activeItem.getAttribute("aria-label") || "Düğün fotoğrafı";

    items.forEach((item) => {
      item.setAttribute("aria-pressed", String(item === activeItem));
    });

    keepActiveThumbnailVisible();

    setImage(mainImage, activeItem, activeLabel);
    setImage(leftImage, previousItem);
    setImage(rightImage, nextVisibleItem);
    caption.textContent = activeLabel;

    if (direction && !reducedMotion.matches) {
      stage.querySelectorAll(".gallery-preview__photo").forEach((photo) => {
        photo.animate([{ opacity: 0.62 }, { opacity: 1 }], {
          duration: 240,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)"
        });
      });
    }
  };

  const moveStage = (direction) => {
    const visibleItems = items.filter((item) => !item.hidden);
    if (visibleItems.length < 2) return;

    const activeIndex = visibleItems.indexOf(activeItem);
    const nextIndex = (activeIndex + direction + visibleItems.length) % visibleItems.length;
    updateStage(visibleItems[nextIndex], direction);
  };

  const applyFilter = (filter) => {
    filters.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.galleryFilter === filter));
    });

    items.forEach((item) => {
      const categories = item.dataset.galleryCategory?.split(" ") || [];
      item.hidden = filter !== "all" && !categories.includes(filter);
    });

    updateStage(activeItem);
  };

  filters.forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.galleryFilter || "all"));
  });

  items.forEach((item) => {
    item.addEventListener("click", () => updateStage(item));
  });

  previousButton?.addEventListener("click", () => moveStage(-1));
  nextButton?.addEventListener("click", () => moveStage(1));

  stage.addEventListener("pointerdown", (event) => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    if (event.target.closest("button, a")) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture?.(event.pointerId);
  });

  stage.addEventListener("pointerup", (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;

    const distanceX = event.clientX - pointerStart.x;
    const distanceY = event.clientY - pointerStart.y;
    pointerStart = null;

    if (Math.abs(distanceX) < 44 || Math.abs(distanceX) <= Math.abs(distanceY)) return;
    moveStage(distanceX < 0 ? 1 : -1);
  });

  stage.addEventListener("pointercancel", () => {
    pointerStart = null;
  });

  stage.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveStage(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveStage(1);
    }
  });

  updateStage(activeItem);
}
