const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = mobileMenu.querySelectorAll("a");
const bookingDialog = document.querySelector(".booking-dialog");
const bookingButtons = document.querySelectorAll(".js-open-booking");
const closeDialogButton = bookingDialog.querySelector(".dialog-close");
const bookingForm = bookingDialog.querySelector(".booking-form");
const formSuccess = bookingDialog.querySelector(".form-success");

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

bookingButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMenu(false);
    formSuccess.hidden = true;
    bookingDialog.showModal();
  });
});

closeDialogButton.addEventListener("click", () => bookingDialog.close());

bookingDialog.addEventListener("click", (event) => {
  const rect = bookingDialog.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;

  if (outside) bookingDialog.close();
});

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  formSuccess.hidden = false;
  bookingForm.reset();
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 1060) setMenu(false);
});
