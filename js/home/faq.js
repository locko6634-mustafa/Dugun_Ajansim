const faqQuestions = document.querySelectorAll(".faq-question");
const openAllFaqButton = document.querySelector(".js-open-all-faq");

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
    (question) => question.getAttribute("aria-expanded") !== "true"
  );

  faqQuestions.forEach((question) => setFaqItem(question, shouldOpenAll));
  openAllFaqButton.querySelector("span").textContent = shouldOpenAll
    ? "Soruları kapat"
    : "Tüm soruları gör";
});
