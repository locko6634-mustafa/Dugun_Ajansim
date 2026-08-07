export function initCurrentYear(root = document, now = new Date()) {
  const currentYear = String(now.getFullYear());

  root.querySelectorAll("[data-current-year]").forEach((element) => {
    element.textContent = currentYear;
  });
}
