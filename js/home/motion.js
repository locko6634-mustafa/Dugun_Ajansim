const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const compactViewportQuery = window.matchMedia("(max-width: 640px)");
const desktopParallaxQuery = window.matchMedia("(min-width: 768px) and (pointer: fine)");
const supportsIntersectionObserver = "IntersectionObserver" in window;
const motionHeadings = [
  document.querySelector("#hero-title"),
  document.querySelector("#gallery-title"),
  document.querySelector("#shoots-title"),
  document.querySelector("#services-title"),
  document.querySelector("#venues-title"),
  document.querySelector("#package-invitation-title"),
  document.querySelector("#faq-title")
].filter(Boolean);

function hasVisibleContent(nodes) {
  return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim());
}

function splitHeadingIntoLines(heading) {
  if (heading.classList.contains("motion-heading")) return;

  const nodes = [...heading.childNodes];
  const hasExplicitBreak = nodes.some(
    (node) => node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR"
  );
  const meaningfulNodes = nodes.filter(
    (node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim()
  );
  const isAlreadyLineBased = meaningfulNodes.every(
    (node) => node.nodeType === Node.ELEMENT_NODE && ["SPAN", "EM"].includes(node.tagName)
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
  heading.classList.toggle("motion-heading--forced-lines", isAlreadyLineBased || hasExplicitBreak);

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

const observedMotionElements = new Set();
let revealObserver;
let revealWithoutObserver = false;

function revealMotionElement(element) {
  element.classList.add("is-visible");
}

function registerMotionGroup(selector, options = {}) {
  const elements = [...document.querySelectorAll(selector)];
  const { direction = "up", delay = 0, stagger = 80, maximumDelay = 420 } = options;
  const resolvedStagger = compactViewportQuery.matches ? Math.min(stagger, 55) : stagger;
  const resolvedMaximumDelay = compactViewportQuery.matches
    ? Math.min(maximumDelay, 260)
    : maximumDelay;

  elements.forEach((element, index) => {
    if (observedMotionElements.has(element)) return;

    const resolvedDirection =
      typeof direction === "function" ? direction(index, element) : direction;

    element.classList.add("motion-reveal", `motion-reveal--${resolvedDirection}`);
    element.style.setProperty(
      "--motion-delay",
      `${Math.min(delay + index * resolvedStagger, resolvedMaximumDelay)}ms`
    );
    observedMotionElements.add(element);

    if (reducedMotionQuery.matches || revealWithoutObserver) {
      revealMotionElement(element);
      return;
    }

    revealObserver?.observe(element);
  });
}

const motionGroups = [
  [".gallery-page .gallery-home-link", { direction: "left" }],
  [".gallery-heading > p:last-of-type", { stagger: 70 }],
  [".gallery-filters", { delay: 45 }],
  [".gallery-preview__stage", { direction: "soft-scale", delay: 60 }],
  [".gallery-preview__dock", { delay: 100 }],
  [
    ".gallery-card",
    {
      direction: (index) => (index % 2 === 0 ? "photo-left" : "photo-right"),
      stagger: 65
    }
  ],
  [".shoots-heading > p", { stagger: 70 }],
  [".shoot-card", { direction: "soft-scale", stagger: 75 }],
  [".shoots-reveal-row", { delay: 70 }],
  [".services-heading > p, .services-divider", { stagger: 65 }],
  [".service-card", { direction: "fade", stagger: 65 }],
  [".venues-heading > p", { stagger: 65 }],
  [".venue-card", { direction: "fade", stagger: 60 }],
  [".venues-toggle-wrapper", { delay: 60 }],
  [".package-invitation__eyebrow, .package-invitation__heading > p:last-child", { stagger: 65 }],
  [".package-invitation__divider", { direction: "soft-scale", delay: 55 }],
  [".package-card", { direction: "soft-scale", stagger: 65 }],
  [".package-invitation__custom", { direction: "soft-scale", delay: 70 }],
  [".faq-heading__eyebrow, .faq-heading__rule, .faq-heading > p", { stagger: 65 }],
  [".faq-item", { stagger: 55 }],
  [".faq-actions", { delay: 55 }],
  [
    ".site-footer__brand, .site-footer__nav, .site-footer__cta, .site-footer__contact, .site-footer__signature, .site-footer__bottom",
    { stagger: 70 }
  ]
];

function registerAllMotionGroups() {
  motionGroups.forEach(([selector, options]) => registerMotionGroup(selector, options));
}

const runIdle = window.requestIdleCallback
  ? (callback) => window.requestIdleCallback(callback, { timeout: 160 })
  : (callback) => setTimeout(callback, 10);

const heroMotionSequence = [
  [document.querySelector(".hero-collage"), "hero", 30],
  [document.querySelector(".proof-pill"), "up", 120],
  [document.querySelector("#hero-title"), "heading", 210],
  [document.querySelector(".hero__lead"), "up", 370],
  [document.querySelector(".hero__actions"), "up", 470]
];

if (!reducedMotionQuery.matches) motionHeadings.forEach(splitHeadingIntoLines);

heroMotionSequence.forEach(([element, direction, delay]) => {
  if (!element) return;

  if (direction !== "heading") {
    element.classList.add("motion-reveal", `motion-reveal--${direction}`);
  }

  element.style.setProperty("--motion-delay", `${delay}ms`);
});

document.documentElement.classList.add("motion-ready");

requestAnimationFrame(() => {
  heroMotionSequence.forEach(([element]) => element?.classList.add("is-visible"));
});

function initNonHeroMotion() {
  if (supportsIntersectionObserver) {
    revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          revealMotionElement(entry.target);
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: compactViewportQuery.matches ? 0.08 : 0.14,
        rootMargin: compactViewportQuery.matches ? "0px 0px -4% 0px" : "0px 0px -8% 0px"
      }
    );
  } else {
    revealWithoutObserver = true;
  }

  registerAllMotionGroups();

  motionHeadings
    .filter((heading) => heading.id !== "hero-title")
    .forEach((heading) => observedMotionElements.add(heading));

  function revealAllMotionElements() {
    observedMotionElements.forEach((element) => element.classList.add("is-visible"));
  }

  if (revealWithoutObserver) {
    revealAllMotionElements();
  } else {
    observedMotionElements.forEach((element) => revealObserver.observe(element));
  }

  document.addEventListener("home:layoutchange", registerAllMotionGroups);
}

if (!reducedMotionQuery.matches) {
  runIdle(initNonHeroMotion);
}

const parallaxImages = [document.querySelector(".hero-collage .photo--main img")].filter(Boolean);
let parallaxFrame;

function updateParallax() {
  parallaxFrame = undefined;
  const viewportHeight = window.innerHeight || 1;
  const viewportCenter = viewportHeight / 2;
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - viewportHeight);
  const scrollProgress = Math.max(0, Math.min(1, window.scrollY / maxScroll));

  document.documentElement.style.setProperty("--scroll-progress", scrollProgress.toFixed(4));

  const heroSection = document.querySelector(".hero");
  if (heroSection) {
    const heroRect = heroSection.getBoundingClientRect();
    const heroProgress = Math.max(0, Math.min(1, -heroRect.top / Math.max(1, heroRect.height)));
    heroSection.style.setProperty("--hero-scroll-progress", heroProgress.toFixed(3));
  }

  parallaxImages.forEach((image) => {
    const bounds = image.getBoundingClientRect();

    if (bounds.bottom < -100 || bounds.top > viewportHeight + 100) return;

    const imageCenter = bounds.top + bounds.height / 2;
    const progress = Math.max(-1, Math.min(1, (imageCenter - viewportCenter) / viewportHeight));
    image.style.setProperty("--motion-parallax-y", `${(-progress * 18).toFixed(2)}px`);
  });

  const botanicals = document.querySelectorAll(".faq-botanical");
  botanicals.forEach((svg, index) => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.bottom < -150 || bounds.top > viewportHeight + 150) return;
    const progress = (bounds.top - viewportCenter) / viewportHeight;
    const shiftY = (-progress * (index % 2 === 0 ? 22 : -18)).toFixed(2);
    svg.style.setProperty("--botanical-shift-y", `${shiftY}px`);
  });
}

function requestParallaxUpdate() {
  if (parallaxFrame || reducedMotionQuery.matches) return;
  parallaxFrame = requestAnimationFrame(updateParallax);
}

if (!reducedMotionQuery.matches) {
  window.addEventListener("scroll", requestParallaxUpdate, { passive: true });
  window.addEventListener("resize", requestParallaxUpdate);
  requestParallaxUpdate();
}

if (!reducedMotionQuery.matches && desktopParallaxQuery.matches) {
  parallaxImages.forEach((image) => image.classList.add("motion-parallax"));
}

const interactiveElements = new WeakSet();

const TILT_CARD_SELECTOR = [
  ".shoot-card",
  ".service-card",
  ".venue-card",
  ".package-card",
  ".package-invitation__custom",
  ".gallery-preview__photo--main",
  ".gallery-card",
  ".faq-item"
].join(", ");

const MAGNETIC_BUTTON_SELECTOR = [
  ".button--primary",
  ".button--outline",
  ".header-cta",
  ".package-invitation__action",
  ".faq-cta",
  ".site-footer__action",
  ".gallery-preview__link",
  ".gallery-preview__arrow",
  ".shoots-reveal",
  ".venues-toggle-btn"
].join(", ");

function attachCardSpotlightAndTilt(card) {
  if (interactiveElements.has(card)) return;
  interactiveElements.add(card);
  card.classList.add("interactive-surface");

  const isSubtleTilt =
    card.classList.contains("faq-item") || card.classList.contains("package-invitation__custom");
  const maxTilt = isSubtleTilt ? 1.8 : 4.8;

  let rafId = null;

  card.addEventListener(
    "pointermove",
    (event) => {
      if (reducedMotionQuery.matches || !desktopParallaxQuery.matches) return;
      const clientX = event.clientX;
      const clientY = event.clientY;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const relX = clientX - rect.left;
        const relY = clientY - rect.top;
        const normX = Math.max(0, Math.min(1, relX / rect.width));
        const normY = Math.max(0, Math.min(1, relY / rect.height));
        const tiltY = ((normX - 0.5) * 2 * maxTilt).toFixed(2);
        const tiltX = ((0.5 - normY) * 2 * maxTilt).toFixed(2);

        card.style.setProperty("--spot-x", `${relX.toFixed(1)}px`);
        card.style.setProperty("--spot-y", `${relY.toFixed(1)}px`);
        card.style.setProperty("--spot-opacity", "1");
        card.style.setProperty("--tilt-x", `${tiltX}deg`);
        card.style.setProperty("--tilt-y", `${tiltY}deg`);
      });
    },
    { passive: true }
  );

  card.addEventListener("pointerleave", () => {
    if (rafId) cancelAnimationFrame(rafId);
    card.style.setProperty("--spot-opacity", "0");
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
  });
}

function attachMagneticEffect(button) {
  if (interactiveElements.has(button)) return;
  interactiveElements.add(button);
  button.classList.add("magnetic-btn");

  const isCompactControl = button.classList.contains("gallery-preview__arrow");
  const maxPull = isCompactControl ? 5 : 8;
  let rafId = null;

  button.addEventListener(
    "pointermove",
    (event) => {
      if (reducedMotionQuery.matches || !desktopParallaxQuery.matches) return;
      const clientX = event.clientX;
      const clientY = event.clientY;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = button.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = ((clientX - centerX) / (rect.width / 2)) * maxPull;
        const deltaY = ((clientY - centerY) / (rect.height / 2)) * (maxPull * 0.72);
        const spotX = clientX - rect.left;
        const spotY = clientY - rect.top;

        button.style.setProperty("--mag-x", `${deltaX.toFixed(2)}px`);
        button.style.setProperty("--mag-y", `${deltaY.toFixed(2)}px`);
        button.style.setProperty("--btn-spot-x", `${spotX.toFixed(1)}px`);
        button.style.setProperty("--btn-spot-y", `${spotY.toFixed(1)}px`);
      });
    },
    { passive: true }
  );

  button.addEventListener("pointerleave", () => {
    if (rafId) cancelAnimationFrame(rafId);
    button.style.setProperty("--mag-x", "0px");
    button.style.setProperty("--mag-y", "0px");
  });
}

function initHeroInteractiveParallax() {
  const hero = document.querySelector(".hero");
  if (!hero || interactiveElements.has(hero)) return;
  interactiveElements.add(hero);

  let rafId = null;
  hero.addEventListener(
    "pointermove",
    (event) => {
      if (reducedMotionQuery.matches || !desktopParallaxQuery.matches) return;
      const clientX = event.clientX;
      const clientY = event.clientY;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const relX = clientX - rect.left;
        const relY = clientY - rect.top;
        const normX = (relX / rect.width - 0.5) * 2;
        const normY = (relY / rect.height - 0.5) * 2;

        hero.style.setProperty("--hero-spot-x", `${relX.toFixed(1)}px`);
        hero.style.setProperty("--hero-spot-y", `${relY.toFixed(1)}px`);
        hero.style.setProperty("--hero-tilt-x", `${(-normY * 2.6).toFixed(2)}deg`);
        hero.style.setProperty("--hero-tilt-y", `${(normX * 3.2).toFixed(2)}deg`);
        hero.style.setProperty("--hero-shift-x", `${(normX * 14).toFixed(2)}px`);
        hero.style.setProperty("--hero-shift-y", `${(normY * 10).toFixed(2)}px`);
      });
    },
    { passive: true }
  );

  hero.addEventListener("pointerleave", () => {
    if (rafId) cancelAnimationFrame(rafId);
    hero.style.setProperty("--hero-tilt-x", "0deg");
    hero.style.setProperty("--hero-tilt-y", "0deg");
    hero.style.setProperty("--hero-shift-x", "0px");
    hero.style.setProperty("--hero-shift-y", "0px");
  });
}

function initGalleryFilterSlidingPill() {
  const filterGroups = document.querySelectorAll(".gallery-filters");
  filterGroups.forEach((group) => {
    if (interactiveElements.has(group)) return;
    interactiveElements.add(group);

    const buttons = [...group.querySelectorAll(".gallery-filter")];
    const updateActiveIndicator = () => {
      const activeBtn =
        buttons.find((btn) => btn.getAttribute("aria-pressed") === "true") || buttons[0];
      if (!activeBtn) return;

      const groupRect = group.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      if (!groupRect.width || !btnRect.width) return;

      group.style.setProperty("--pill-left", `${(btnRect.left - groupRect.left).toFixed(1)}px`);
      group.style.setProperty("--pill-top", `${(btnRect.top - groupRect.top).toFixed(1)}px`);
      group.style.setProperty("--pill-width", `${btnRect.width.toFixed(1)}px`);
      group.style.setProperty("--pill-height", `${btnRect.height.toFixed(1)}px`);
      group.classList.add("has-pill-indicator");
    };

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        requestAnimationFrame(updateActiveIndicator);
      });
    });

    window.addEventListener("resize", updateActiveIndicator, { passive: true });
    requestAnimationFrame(updateActiveIndicator);
  });
}

function registerInteractiveEnhancements() {
  document.querySelectorAll(TILT_CARD_SELECTOR).forEach(attachCardSpotlightAndTilt);
  document.querySelectorAll(MAGNETIC_BUTTON_SELECTOR).forEach(attachMagneticEffect);
  initHeroInteractiveParallax();
  initGalleryFilterSlidingPill();
}

if (!reducedMotionQuery.matches) {
  runIdle(registerInteractiveEnhancements);
  document.addEventListener("home:layoutchange", registerInteractiveEnhancements);
}
