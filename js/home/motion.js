const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionHeadings = [
  document.querySelector("#hero-title"),
  document.querySelector("#gallery-title"),
  document.querySelector("#shoots-title"),
  document.querySelector("#services-title"),
  document.querySelector("#faq-title")
].filter(Boolean);

function hasVisibleContent(nodes) {
  return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim());
}

function splitHeadingIntoLines(heading) {
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

function registerMotionGroup(selector, options = {}) {
  const elements = [...document.querySelectorAll(selector)];
  const { direction = "up", delay = 0, stagger = 80, maximumDelay = 420 } = options;

  elements.forEach((element, index) => {
    const resolvedDirection =
      typeof direction === "function" ? direction(index, element) : direction;

    element.classList.add("motion-reveal", `motion-reveal--${resolvedDirection}`);
    element.style.setProperty(
      "--motion-delay",
      `${Math.min(delay + index * stagger, maximumDelay)}ms`
    );
    observedMotionElements.add(element);
  });
}

const runIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 10));

const heroMotionSequence = [
  [document.querySelector(".hero-collage"), "hero", 30],
  [document.querySelector(".proof-pill"), "up", 120],
  [document.querySelector("#hero-title"), "heading", 210],
  [document.querySelector(".hero__lead"), "up", 370],
  [document.querySelector(".hero__actions"), "up", 470]
];

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
  motionHeadings.forEach(splitHeadingIntoLines);

  registerMotionGroup(".benefit-card", { stagger: 80 });
  registerMotionGroup(".legacy-value", { stagger: 85 });
  registerMotionGroup(".gallery-kicker, .gallery-heading > p:last-of-type", { stagger: 85 });
  registerMotionGroup(".gallery-track, .gallery-cta", { stagger: 110 });
  registerMotionGroup(".shoots-kicker, .shoots-heading > p", { stagger: 85 });
  registerMotionGroup(".shoot-card", {
    direction: (index) => (index % 2 === 0 ? "left" : "right"),
    stagger: 90
  });
  registerMotionGroup(".services-heading > p, .services-divider", {
    stagger: 75
  });
  registerMotionGroup(".service-card", {
    direction: (index) => (index % 2 === 0 ? "left" : "right"),
    stagger: 75
  });
  registerMotionGroup(".venues-heading__eyebrow, .venues-heading__rule, .venues-heading > p", {
    stagger: 80
  });
  registerMotionGroup(".venue-card", {
    direction: (index) => (index % 2 === 0 ? "left" : "right"),
    stagger: 75
  });
  registerMotionGroup(".faq-heading__eyebrow, .faq-heading__rule, .faq-heading > p", {
    stagger: 80
  });
  registerMotionGroup(".faq-item", { stagger: 65 });
  registerMotionGroup(".faq-actions", { stagger: 80 });
  registerMotionGroup(
    ".site-footer__brand, .site-footer__nav, .site-footer__cta, .site-footer__signature, .site-footer__bottom",
    { stagger: 85 }
  );

  motionHeadings
    .filter((heading) => heading.id !== "hero-title")
    .forEach((heading) => observedMotionElements.add(heading));

  function revealAllMotionElements() {
    observedMotionElements.forEach((element) => element.classList.add("is-visible"));
  }

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
        rootMargin: "0px 0px -8% 0px"
      }
    );

    observedMotionElements.forEach((element) => revealObserver.observe(element));
  }
}

runIdle(initNonHeroMotion);

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

if (!reducedMotionQuery.matches) {
  parallaxImages.forEach((image) => image.classList.add("motion-parallax"));
  window.addEventListener("scroll", requestParallaxUpdate, { passive: true });
  window.addEventListener("resize", requestParallaxUpdate);
  requestParallaxUpdate();
}
