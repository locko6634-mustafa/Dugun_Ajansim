function updateCurrentYear() {
  const currentYear = new Date().getFullYear();
  const yearElements = document.querySelectorAll("[data-current-year]");
  for (const element of yearElements) {
    element.textContent = String(currentYear);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateCurrentYear();
});
