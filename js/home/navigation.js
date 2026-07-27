const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = mobileMenu.querySelectorAll("a");

const getFocusableElements = () =>
  [...mobileMenu.querySelectorAll("a, button, input, select, textarea, [tabindex]")].filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0,
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
