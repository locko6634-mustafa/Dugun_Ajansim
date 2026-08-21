const shootCards = [...document.querySelectorAll(".shoot-card")];
const shootsViewport = document.querySelector("[data-shoots-viewport]");
const shootsGrid = shootsViewport;
const shootsReveal = document.querySelector("[data-shoots-reveal]");
const shootsRevealLabel = shootsReveal?.querySelector("[data-shoots-reveal-label]");
const videoLightbox = document.querySelector(".video-lightbox");
const videoLightboxClose = videoLightbox.querySelector(".video-lightbox__close");
let activeVideo = null;
let activeVideoPlaceholder = null;

if (shootsViewport && shootsGrid && shootsReveal && shootsRevealLabel && shootCards.length > 4) {
  const setCollapsedCardAccess = (isExpanded) => {
    shootCards.slice(4).forEach((card) => {
      card.toggleAttribute("inert", !isExpanded);
    });
  };

  const syncExpandedHeight = () => {
    const firstCollapsedCard = shootCards[4];
    const gridTop = shootsGrid.getBoundingClientRect().top;
    const collapsedCardRect = firstCollapsedCard.getBoundingClientRect();
    const collapsedPreviewHeight = Math.min(Math.max(collapsedCardRect.height * 0.18, 56), 92);

    shootsViewport.style.setProperty("--shoots-expanded-height", `${shootsGrid.scrollHeight}px`);
    shootsViewport.style.setProperty(
      "--shoots-collapsed-height",
      `${collapsedCardRect.top - gridTop + collapsedPreviewHeight}px`
    );
  };

  const setShootsExpanded = (isExpanded) => {
    syncExpandedHeight();
    shootsViewport.classList.toggle("is-expanded", isExpanded);
    shootsReveal.classList.toggle("is-expanded", isExpanded);
    shootsReveal.setAttribute("aria-expanded", String(isExpanded));
    shootsRevealLabel.textContent = isExpanded ? "Daha Az Göster" : "Tümünü Gör";
    setCollapsedCardAccess(isExpanded);
  };

  syncExpandedHeight();
  shootsViewport.classList.add("is-collapsible");
  shootsReveal.hidden = false;
  setShootsExpanded(false);

  shootsReveal.addEventListener("click", () => {
    setShootsExpanded(shootsReveal.getAttribute("aria-expanded") !== "true");
  });

  if ("ResizeObserver" in window) {
    new window.ResizeObserver(syncExpandedHeight).observe(shootsGrid);
  } else {
    window.addEventListener("resize", syncExpandedHeight, { passive: true });
  }
}

function loadVideo(video) {
  if (video.dataset.loaded === "true") return;

  video.querySelectorAll("source[data-src]").forEach((source) => {
    source.src = source.dataset.src;
    source.removeAttribute("data-src");
  });
  video.dataset.loaded = "true";
  video.load();
}

function playVideo(video) {
  loadVideo(video);
  video.play().catch(() => {});
}

function openVideoLightbox(video) {
  shootCards.forEach((card) => {
    const previewVideo = card.querySelector("video");
    const soundButton = card.querySelector(".shoot-card__sound");

    previewVideo.pause();
    previewVideo.muted = true;
    soundButton.classList.add("is-muted");
    soundButton.setAttribute("aria-pressed", "false");
    soundButton.setAttribute("aria-label", `${previewVideo.getAttribute("aria-label")} sesini aç`);
  });

  activeVideo = video;
  activeVideoPlaceholder = document.createComment("video-preview");
  video.after(activeVideoPlaceholder);
  video.controls = true;
  video.currentTime = 0;
  video.muted = false;
  videoLightbox.querySelector("figure").prepend(video);
  videoLightbox.showModal();
  playVideo(video);
}

function closeVideoLightbox() {
  videoLightbox.close();
}

function restoreVideoPreview() {
  if (!activeVideo || !activeVideoPlaceholder) return;

  activeVideo.pause();
  activeVideo.muted = true;
  activeVideo.controls = false;
  activeVideoPlaceholder.replaceWith(activeVideo);
  const cardBounds = activeVideo.closest(".shoot-card").getBoundingClientRect();
  if (cardBounds.bottom > 0 && cardBounds.top < window.innerHeight) playVideo(activeVideo);
  activeVideo = null;
  activeVideoPlaceholder = null;
}
shootCards.forEach((card) => {
  const video = card.querySelector("video");
  const button = card.querySelector(".shoot-card__sound");
  const media = card.querySelector(".shoot-card__media");

  video.addEventListener("loadeddata", () => media.classList.add("is-video-ready"), {
    once: true
  });

  button.addEventListener("click", () => {
    playVideo(video);
    const willMute = !video.muted;

    if (!willMute) {
      shootCards.forEach((otherCard) => {
        const otherVideo = otherCard.querySelector("video");
        const otherButton = otherCard.querySelector(".shoot-card__sound");

        if (otherVideo === video) return;
        otherVideo.muted = true;
        otherButton.classList.add("is-muted");
        otherButton.setAttribute("aria-pressed", "false");
        otherButton.setAttribute(
          "aria-label",
          `${otherVideo.getAttribute("aria-label")} sesini aç`
        );
      });
    }

    video.muted = willMute;
    button.classList.toggle("is-muted", willMute);
    button.setAttribute("aria-pressed", String(!willMute));
    button.setAttribute(
      "aria-label",
      `${video.getAttribute("aria-label")} sesini ${willMute ? "aç" : "kapat"}`
    );
  });

  media.addEventListener("click", (event) => {
    if (event.target.closest(".shoot-card__sound")) return;

    openVideoLightbox(video);
  });
});

videoLightboxClose.addEventListener("click", closeVideoLightbox);

videoLightbox.addEventListener("click", (event) => {
  if (event.target === videoLightbox) closeVideoLightbox();
});

videoLightbox.addEventListener("close", () => {
  restoreVideoPreview();
});

const videoLoaderObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      loadVideo(entry.target.querySelector("video"));
      observer.unobserve(entry.target);
    });
  },
  { rootMargin: "240px 0px" }
);

const shootsObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const video = entry.target.querySelector("video");

      if (entry.isIntersecting) {
        playVideo(video);
      } else if (!video.paused) {
        video.pause();
      }
    });
  },
  { threshold: 0.2 }
);

shootCards.forEach((card) => {
  videoLoaderObserver.observe(card);
  shootsObserver.observe(card);
});
