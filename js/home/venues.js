export function initVenuesToggle() {
  const toggleBtn = document.querySelector(".js-venues-toggle");
  const grid = document.getElementById("venues-grid");
  if (!toggleBtn || !grid) return;

  toggleBtn.addEventListener("click", () => {
    const isExpanded = grid.getAttribute("data-expanded") === "true";
    const nextState = !isExpanded;
    grid.setAttribute("data-expanded", String(nextState));
    toggleBtn.setAttribute("aria-expanded", String(nextState));

    const btnText = toggleBtn.querySelector("span");
    if (btnText) {
      btnText.textContent = nextState ? "Daha Az Göster" : "Tüm Mekânları Gör (7 Mekân)";
    }
  });
}

initVenuesToggle();
