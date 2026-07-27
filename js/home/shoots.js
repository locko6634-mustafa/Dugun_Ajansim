const shootCards = [...document.querySelectorAll(".shoot-card")];
const videoLightbox = document.querySelector(".video-lightbox");
const videoLightboxCaption = videoLightbox.querySelector("figcaption");
const videoLightboxClose = videoLightbox.querySelector(".video-lightbox__close");
let activeVideo = null;
let activeVideoPlaceholder = null;

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
  videoLightboxCaption.textContent = video.getAttribute("aria-label") || "Video çekimi";
  videoLightbox.showModal();
  video.play().catch(() => {});
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
  activeVideo.play().catch(() => {});
  activeVideo = null;
  activeVideoPlaceholder = null;
}
shootCards.forEach((card) => {
  const video = card.querySelector("video");
  const button = card.querySelector(".shoot-card__sound");
  const media = card.querySelector(".shoot-card__media");

  button.addEventListener("click", () => {
    const willMute = !video.muted;

    if (!willMute) {
      shootCards.forEach((otherCard) => {
        const otherVideo = otherCard.querySelector("video");
        const otherButton = otherCard.querySelector(".shoot-card__sound");

        if (otherVideo === video) return;
        otherVideo.muted = true;
        otherButton.classList.add("is-muted");
        otherButton.setAttribute("aria-pressed", "false");
        otherButton.setAttribute("aria-label", `${otherVideo.getAttribute("aria-label")} sesini aç`);
      });
    }

    video.muted = willMute;
    button.classList.toggle("is-muted", willMute);
    button.setAttribute("aria-pressed", String(!willMute));
    button.setAttribute(
      "aria-label",
      `${video.getAttribute("aria-label")} sesini ${willMute ? "aç" : "kapat"}`,
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

const shootsObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const video = entry.target.querySelector("video");

      if (entry.isIntersecting) {
        video.play().catch(() => {});
      } else if (!video.paused) {
        video.pause();
      }
    });
  },
  { threshold: 0.2 },
);

shootCards.forEach((card) => shootsObserver.observe(card));

const shootsTrack = document.querySelector(".shoots-grid");
const shootsPrevious = document.querySelector(".shoots-gallery__arrow--previous");
const shootsNext = document.querySelector(".shoots-gallery__arrow--next");

function scrollShoots(direction) {
  const firstCard = shootsTrack.querySelector(".shoot-card");
  const gap = Number.parseFloat(getComputedStyle(shootsTrack).gap) || 0;
  shootsTrack.scrollBy({ left: direction * (firstCard.offsetWidth + gap), behavior: "smooth" });
}

shootsPrevious.addEventListener("click", () => scrollShoots(-1));
shootsNext.addEventListener("click", () => scrollShoots(1));
