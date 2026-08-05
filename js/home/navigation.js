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
  if (window.innerWidth > 1060) setMenu(false, { restoreFocus: false });
});

setMenu(false, { restoreFocus: false });

const sectionIds = [
  "anasayfa",
  "hakkimizda",
  "konseptler",
  "hizmetler",
  "galeri",
  "paket-olustur",
  "iletisim"
];
let isManualClick = false;
let manualClickTimer = null;

function setActiveNav(targetId) {
  if (!targetId) return;
  const navLinks = document.querySelectorAll(
    ".desktop-nav a[href^='#'], .mobile-menu nav a[href^='#']"
  );
  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    const isActive = href === `#${targetId}`;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function scrollToTarget(targetElement) {
  if (!targetElement) return;

  const getDesiredY = () => {
    const header = document.querySelector(".header-bar, .site-header, header");
    const headerHeight = header ? header.getBoundingClientRect().height : 80;
    const targetTop = targetElement.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, targetTop - headerHeight - 16);
  };

  const initialY = getDesiredY();
  window.scrollTo({
    top: initialY,
    behavior: "smooth"
  });

  [250, 550, 900, 1300].forEach((delay) => {
    setTimeout(() => {
      const desired = getDesiredY();
      if (Math.abs(window.scrollY - desired) > 15) {
        window.scrollTo({
          top: desired,
          behavior: "smooth"
        });
      }
    }, delay);
  });
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
      if (targetId === "anasayfa") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        scrollToTarget(targetElement);
      }
      try {
        window.history.pushState(null, "", `#${targetId}`);
      } catch (_) {}
      setActiveNav(targetId);
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

initActiveNav();

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.replace("#", "");
  if (hash && sectionIds.includes(hash)) {
    setActiveNav(hash);
  }
});

const sectionsToObserve = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);

if ("IntersectionObserver" in window && sectionsToObserve.length > 0) {
  const navObserver = new IntersectionObserver(
    (entries) => {
      if (isManualClick) return;

      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveNav(entry.target.id);
        }
      });
    },
    {
      rootMargin: "-25% 0px -50% 0px",
      threshold: 0.05
    }
  );

  sectionsToObserve.forEach((section) => navObserver.observe(section));
}

window.addEventListener(
  "scroll",
  () => {
    if (isManualClick) return;
    if (window.scrollY < 80) {
      setActiveNav("anasayfa");
    } else if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 50) {
      setActiveNav("iletisim");
    }
  },
  { passive: true }
);
