const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = mobileMenu.querySelectorAll("a");

const getFocusableElements = () =>
  [...mobileMenu.querySelectorAll("a, button, input, select, textarea, [tabindex]")].filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0
  );

function setMenu(open, { restoreFocus = true } = {}) {
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
  mobileMenu.setAttribute("aria-hidden", String(!open));
  mobileMenu.inert = !open;
  mobileMenu.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);

  if (restoreFocus) {
    if (open) {
      getFocusableElements()[0]?.focus();
    } else if (document.activeElement !== menuButton) {
      menuButton.focus();
    }
  }
}

menuButton.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

mobileLinks.forEach((link) => {
  link.addEventListener("click", () => setMenu(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
    setMenu(false);
    return;
  }

  if (event.key !== "Tab" || menuButton.getAttribute("aria-expanded") !== "true") return;

  const focusableElements = getFocusableElements();
  if (!focusableElements.length) return;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 1180) setMenu(false, { restoreFocus: false });
});

setMenu(false, { restoreFocus: false });

const sectionIds = [
  "anasayfa",
  "galeri",
  "cekimler",
  "hizmetler",
  "paket-olustur",
  "mekanlar",
  "sss",
  "iletisim"
];
const navLinks = document.querySelectorAll(
  ".desktop-nav a[data-nav-sections], .mobile-menu nav a[data-nav-sections]"
);
const sectionsToTrack = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
const siteHeader = document.querySelector(".site-header");
const headerSurfaces = [...document.querySelectorAll("[data-header-surface]")];
let isManualClick = false;
let manualClickTimer = null;
let scrollFrame = null;
let layoutCorrectionTimer = null;
let targetStabilityTimer = null;

function setActiveNav(targetId) {
  if (!targetId) return;
  navLinks.forEach((link) => {
    const linkedSections = link.dataset.navSections.split(" ");
    const isActive = linkedSections.includes(targetId);
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function scrollToTarget(targetElement) {
  if (!targetElement) return;

  const header = document.querySelector(".header-bar, .site-header, header");
  const headerHeight = header ? header.getBoundingClientRect().height : 80;
  const targetTop = targetElement.getBoundingClientRect().top + window.scrollY;
  const desiredY = Math.max(0, targetTop - headerHeight - 16);

  window.scrollTo({
    top: desiredY,
    behavior: "smooth"
  });
}

function correctTargetPosition(targetId) {
  if (window.location.hash !== `#${targetId}`) return;

  const targetElement = document.getElementById(targetId);
  const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 80;
  if (
    targetElement &&
    Math.abs(targetElement.getBoundingClientRect().top - headerHeight - 16) > 2
  ) {
    scrollToTarget(targetElement);
  }
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='#']");
  if (!link) return;

  const href = link.getAttribute("href");
  if (href && href.startsWith("#") && href.length > 1) {
    const targetId = href.slice(1);
    const targetElement = document.getElementById(targetId);
    if (targetElement) {
      event.preventDefault();
      clearTimeout(layoutCorrectionTimer);
      clearTimeout(targetStabilityTimer);
      if (targetId === "anasayfa") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        scrollToTarget(targetElement);
      }
      try {
        window.history.pushState(null, "", `#${targetId}`);
      } catch {}
      setActiveNav(targetId);
      if (sectionIds.indexOf(targetId) > sectionIds.indexOf("hizmetler")) {
        targetStabilityTimer = window.setTimeout(() => correctTargetPosition(targetId), 900);
      }
      isManualClick = true;
      clearTimeout(manualClickTimer);
      manualClickTimer = setTimeout(() => {
        isManualClick = false;
      }, 1400);
    }
  }
});

function initActiveNav() {
  const hash = window.location.hash.replace("#", "");
  if (hash && sectionIds.includes(hash)) {
    setActiveNav(hash);
  } else {
    setActiveNav("anasayfa");
  }
}

function getActiveSectionId() {
  if (window.scrollY < 80) return "anasayfa";

  const pageBottom = window.innerHeight + window.scrollY;
  if (pageBottom >= document.documentElement.scrollHeight - 50) return "iletisim";

  const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 80;
  const activationLine = headerHeight + Math.min(window.innerHeight * 0.28, 180);
  let activeSectionId = "anasayfa";

  sectionsToTrack.forEach((section) => {
    if (section.getBoundingClientRect().top <= activationLine) {
      activeSectionId = section.id;
    }
  });

  return activeSectionId;
}

function syncHeaderSurface() {
  if (!siteHeader) return;

  const probeY = Math.min(siteHeader.getBoundingClientRect().bottom + 1, window.innerHeight - 1);
  const activeSurface = headerSurfaces.find((surface) => {
    const bounds = surface.getBoundingClientRect();
    return bounds.top <= probeY && bounds.bottom > probeY;
  });
  const surfaceName = activeSurface?.dataset.headerSurface === "dark" ? "dark" : "light";

  siteHeader.classList.toggle("is-on-dark", surfaceName === "dark");
  siteHeader.dataset.currentSurface = surfaceName;
}

function syncActiveNav() {
  scrollFrame = null;
  syncHeaderSurface();
  if (!isManualClick) setActiveNav(getActiveSectionId());
}

initActiveNav();
syncHeaderSurface();

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.replace("#", "");
  if (hash && sectionIds.includes(hash)) {
    setActiveNav(hash);
  }
});

document.addEventListener("home:layoutchange", () => {
  syncHeaderSurface();
  const targetId = window.location.hash.replace("#", "");
  if (sectionIds.indexOf(targetId) <= sectionIds.indexOf("hizmetler")) return;

  clearTimeout(layoutCorrectionTimer);
  layoutCorrectionTimer = window.setTimeout(() => correctTargetPosition(targetId), 100);
});

window.addEventListener(
  "scroll",
  () => {
    if (!scrollFrame) scrollFrame = window.requestAnimationFrame(syncActiveNav);
  },
  { passive: true }
);

window.addEventListener("resize", () => {
  if (!scrollFrame) scrollFrame = window.requestAnimationFrame(syncActiveNav);
});
