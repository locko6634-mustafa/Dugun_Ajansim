const shootCards = [...document.querySelectorAll(".shoot-card")];
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

    shootCards.forEach((otherCard) => {
      const otherVideo = otherCard.querySelector("video");
      const otherButton = otherCard.querySelector(".shoot-card__sound");

      if (otherVideo === video) return;
      otherVideo.muted = true;
      otherButton.classList.add("is-muted");
      otherButton.setAttribute("aria-pressed", "false");
      otherButton.setAttribute("aria-label", `${otherVideo.getAttribute("aria-label")} sesini aç`);
    });

    video.muted = false;
    button.classList.remove("is-muted");
    button.setAttribute("aria-pressed", "true");
    button.setAttribute("aria-label", `${video.getAttribute("aria-label")} sesini kapat`);
    video.play().catch(() => {});

    if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => {});
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
  });
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
