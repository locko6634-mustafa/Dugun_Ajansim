const pageLoader = document.querySelector(".page-loader");
let loaderHidden = false;

function hidePageLoader() {
  if (!pageLoader || loaderHidden) return;
  loaderHidden = true;
  pageLoader.classList.add("is-hidden");
  pageLoader.setAttribute("aria-hidden", "true");

  const removeLoader = () => {
    document.body.classList.remove("page-loading");
    pageLoader.remove();
  };

  pageLoader.addEventListener("transitionend", removeLoader, { once: true });
  window.setTimeout(removeLoader, 800);
}

if (document.readyState === "complete") {
  requestAnimationFrame(hidePageLoader);
} else {
  window.addEventListener("load", hidePageLoader, { once: true });
}

window.setTimeout(hidePageLoader, 8000);

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

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionHeadings = [
  document.querySelector("#hero-title"),
  document.querySelector("#legacy-title"),
  document.querySelector("#gallery-title"),
  document.querySelector("#shoots-title"),
  document.querySelector("#services-title"),
  document.querySelector("#faq-title"),
].filter(Boolean);

function hasVisibleContent(nodes) {
  return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim());
}

function splitHeadingIntoLines(heading) {
  const nodes = [...heading.childNodes];
  const hasExplicitBreak = nodes.some(
    (node) => node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR",
  );
  const meaningfulNodes = nodes.filter(
    (node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim(),
  );
  const isAlreadyLineBased = meaningfulNodes.every(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      ["SPAN", "EM"].includes(node.tagName),
  );
  const groups = [];

  if (isAlreadyLineBased) {
    meaningfulNodes.forEach((node) => groups.push([node]));
  } else {
    let currentGroup = [];

    nodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
        if (hasVisibleContent(currentGroup)) groups.push(currentGroup);
        currentGroup = [];
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "EM") {
        if (hasVisibleContent(currentGroup)) groups.push(currentGroup);
        groups.push([node]);
        currentGroup = [];
        return;
      }

      currentGroup.push(node);
    });

    if (hasVisibleContent(currentGroup)) groups.push(currentGroup);
  }

  heading.replaceChildren();
  heading.classList.add("motion-heading");
  heading.classList.toggle(
    "motion-heading--forced-lines",
    isAlreadyLineBased || hasExplicitBreak,
  );

  groups.forEach((group, index) => {
    const line = document.createElement("span");
    const inner = document.createElement("span");

    if (index > 0) heading.append(document.createTextNode(" "));
    line.className = "motion-heading__line";
    inner.className = "motion-heading__inner";
    inner.style.setProperty("--motion-line-index", index);
    group.forEach((node) => inner.append(node));
    line.append(inner);
    heading.append(line);
  });
}

motionHeadings.forEach(splitHeadingIntoLines);

const observedMotionElements = new Set();

function registerMotionGroup(selector, options = {}) {
  const elements = [...document.querySelectorAll(selector)];
  const {
    direction = "up",
    delay = 0,
    stagger = 80,
    maximumDelay = 420,
  } = options;

  elements.forEach((element, index) => {
    const resolvedDirection =
      typeof direction === "function" ? direction(index, element) : direction;

    element.classList.add("motion-reveal", `motion-reveal--${resolvedDirection}`);
    element.style.setProperty(
      "--motion-delay",
      `${Math.min(delay + index * stagger, maximumDelay)}ms`,
    );
    observedMotionElements.add(element);
  });
}

registerMotionGroup(".benefit-card", { stagger: 80 });
registerMotionGroup(".legacy-kicker, .legacy-flourish, .legacy-lead", { stagger: 85 });
registerMotionGroup(".legacy-photo", {
  direction: (index) => ["left", "right", "up"][index] || "up",
  stagger: 90,
});
registerMotionGroup(".legacy-value", { stagger: 85 });
registerMotionGroup(".gallery-kicker, .gallery-heading > p:last-of-type", { stagger: 85 });
registerMotionGroup(".gallery-track, .gallery-cta", { stagger: 110 });
registerMotionGroup(".shoots-kicker, .shoots-heading > p", { stagger: 85 });
registerMotionGroup(".shoot-card", {
  direction: (index) => (index % 2 === 0 ? "left" : "right"),
  stagger: 90,
});
registerMotionGroup(".services-kicker, .services-heading > p, .services-divider", {
  stagger: 75,
});
registerMotionGroup(".service-card", {
  direction: (index) => (index % 2 === 0 ? "left" : "right"),
  stagger: 75,
});
registerMotionGroup(".faq-heading__eyebrow, .faq-heading__rule, .faq-heading > p", {
  stagger: 80,
});
registerMotionGroup(".faq-item", { stagger: 65 });
registerMotionGroup(".faq-actions", { stagger: 80 });
registerMotionGroup(
  ".site-footer__brand, .site-footer__nav, .site-footer__cta, .site-footer__signature, .site-footer__bottom",
  { stagger: 85 },
);

const heroMotionSequence = [
  [document.querySelector(".hero-collage"), "hero", 30],
  [document.querySelector(".proof-pill"), "up", 120],
  [document.querySelector("#hero-title"), "heading", 210],
  [document.querySelector(".hero__lead"), "up", 370],
  [document.querySelector(".hero__actions"), "up", 470],
  [document.querySelector(".trust-row"), "up", 560],
];

heroMotionSequence.forEach(([element, direction, delay]) => {
  if (!element) return;

  if (direction !== "heading") {
    element.classList.add("motion-reveal", `motion-reveal--${direction}`);
  }

  element.style.setProperty("--motion-delay", `${delay}ms`);
});

motionHeadings
  .filter((heading) => heading.id !== "hero-title")
  .forEach((heading) => observedMotionElements.add(heading));

function revealAllMotionElements() {
  observedMotionElements.forEach((element) => element.classList.add("is-visible"));
  heroMotionSequence.forEach(([element]) => element?.classList.add("is-visible"));
}

document.documentElement.classList.add("motion-ready");

if (reducedMotionQuery.matches || !("IntersectionObserver" in window)) {
  revealAllMotionElements();
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.15,
      rootMargin: "0px 0px -8% 0px",
    },
  );

  observedMotionElements.forEach((element) => revealObserver.observe(element));

  requestAnimationFrame(() => {
    heroMotionSequence.forEach(([element]) => element?.classList.add("is-visible"));
  });
}

const parallaxImages = [
  document.querySelector(".hero-collage .photo--main img"),
  document.querySelector(".legacy-photo--center img"),
].filter(Boolean);
let parallaxFrame;

function updateParallax() {
  parallaxFrame = undefined;
  const viewportCenter = window.innerHeight / 2;

  parallaxImages.forEach((image) => {
    const bounds = image.getBoundingClientRect();

    if (bounds.bottom < -100 || bounds.top > window.innerHeight + 100) return;

    const imageCenter = bounds.top + bounds.height / 2;
    const progress = Math.max(-1, Math.min(1, (imageCenter - viewportCenter) / window.innerHeight));
    image.style.setProperty("--motion-parallax-y", `${(-progress * 10).toFixed(2)}px`);
  });
}

function requestParallaxUpdate() {
  if (parallaxFrame || reducedMotionQuery.matches) return;
  parallaxFrame = requestAnimationFrame(updateParallax);
}

if (!reducedMotionQuery.matches) {
  parallaxImages.forEach((image) => image.classList.add("motion-parallax"));
  window.addEventListener("scroll", requestParallaxUpdate, { passive: true });
  window.addEventListener("resize", requestParallaxUpdate);
  requestParallaxUpdate();
}
