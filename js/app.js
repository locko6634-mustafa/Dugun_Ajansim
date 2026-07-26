const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = mobileMenu.querySelectorAll("a");
const bookingDialog = document.querySelector(".booking-dialog");
const bookingButtons = document.querySelectorAll(".js-open-booking");
const closeDialogButton = bookingDialog.querySelector(".dialog-close");
const bookingForm = bookingDialog.querySelector(".booking-form");
const formSuccess = bookingDialog.querySelector(".form-success");
const reservationForm = document.querySelector(".reservation-form");
const reservationSuccess = document.querySelector(".reservation-success");
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

bookingButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMenu(false);
    formSuccess.hidden = true;
    bookingDialog.showModal();
  });
});

closeDialogButton.addEventListener("click", () => bookingDialog.close());

bookingDialog.addEventListener("click", (event) => {
  const rect = bookingDialog.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;

  if (outside) bookingDialog.close();
});

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  formSuccess.hidden = false;
  bookingForm.reset();
});

reservationForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!reservationForm.checkValidity()) {
    reservationForm.reportValidity();
    return;
  }

  reservationSuccess.hidden = false;
  reservationForm.reset();
  reservationSuccess.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

function setFaqItem(question, open) {
  const item = question.closest(".faq-item");
  const answer = document.getElementById(question.getAttribute("aria-controls"));

  question.setAttribute("aria-expanded", String(open));
  item.classList.toggle("is-open", open);
  answer.hidden = !open;
}

faqQuestions.forEach((question) => {
  question.addEventListener("click", () => {
    const willOpen = question.getAttribute("aria-expanded") !== "true";

    faqQuestions.forEach((otherQuestion) => {
      if (otherQuestion !== question) setFaqItem(otherQuestion, false);
    });

    setFaqItem(question, willOpen);
    openAllFaqButton.querySelector("span").textContent = "Tüm soruları gör";
  });
});

openAllFaqButton.addEventListener("click", () => {
  const shouldOpenAll = [...faqQuestions].some(
    (question) => question.getAttribute("aria-expanded") !== "true",
  );

  faqQuestions.forEach((question) => setFaqItem(question, shouldOpenAll));
  openAllFaqButton.querySelector("span").textContent = shouldOpenAll
    ? "Soruları kapat"
    : "Tüm soruları gör";
});

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

shootCards.forEach((card) => {
  const video = card.querySelector("video");
  const button = card.querySelector(".shoot-card__sound");

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

window.addEventListener("resize", () => {
  if (window.innerWidth > 1060) setMenu(false);
});
