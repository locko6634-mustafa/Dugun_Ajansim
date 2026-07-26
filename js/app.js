const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const mobileLinks = mobileMenu.querySelectorAll("a");
const bookingDialog = document.querySelector(".booking-dialog");
const bookingButtons = document.querySelectorAll(".js-open-booking");
const closeDialogButton = bookingDialog.querySelector(".dialog-close");
const bookingForm = bookingDialog.querySelector(".booking-form");
const formSuccess = bookingDialog.querySelector(".form-success");
const reservationForm = document.querySelector(".reservation-form");
const reservationSuccess = document.querySelector(".reservation-success");
const faqQuestions = document.querySelectorAll(".faq-question");
const openAllFaqButton = document.querySelector(".js-open-all-faq");

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

reservationForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!reservationForm.checkValidity()) {
    reservationForm.reportValidity();
    return;
  }

  reservationSuccess.hidden = false;
  reservationForm.reset();
  reservationSuccess.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

function setFaqItem(question, open) {
  const item = question.closest(".faq-item");
  const answer = document.getElementById(question.getAttribute("aria-controls"));

  question.setAttribute("aria-expanded", String(open));
  item.classList.toggle("is-open", open);
  answer.hidden = !open;
}

faqQuestions.forEach((question) => {
  question.addEventListener("click", () => {
    const willOpen = question.getAttribute("aria-expanded") !== "true";

    faqQuestions.forEach((otherQuestion) => {
      if (otherQuestion !== question) setFaqItem(otherQuestion, false);
    });

    setFaqItem(question, willOpen);
    openAllFaqButton.querySelector("span").textContent = "Tüm soruları gör";
  });
});

openAllFaqButton.addEventListener("click", () => {
  const shouldOpenAll = [...faqQuestions].some(
    (question) => question.getAttribute("aria-expanded") !== "true",
  );

  faqQuestions.forEach((question) => setFaqItem(question, shouldOpenAll));
  openAllFaqButton.querySelector("span").textContent = shouldOpenAll
    ? "Soruları kapat"
    : "Tüm soruları gör";
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 1060) setMenu(false);
});
