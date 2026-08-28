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
  [".service-card", { direction: "soft-scale", stagger: 65 }],
  [".venues-heading > p", { stagger: 65 }],
  [".venue-card", { direction: "soft-scale", stagger: 60 }],
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

if (!reducedMotionQuery.matches && desktopParallaxQuery.matches) {
  parallaxImages.forEach((image) => image.classList.add("motion-parallax"));
  window.addEventListener("scroll", requestParallaxUpdate, { passive: true });
  window.addEventListener("resize", requestParallaxUpdate);
  requestParallaxUpdate();
}
