const faqQuestions = document.querySelectorAll(".faq-question");
const openAllFaqButton = document.querySelector(".js-open-all-faq");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setFaqItem(question, open) {
  const item = question.closest(".faq-item");
  const answer = document.getElementById(question.getAttribute("aria-controls"));
  const wasOpen = question.getAttribute("aria-expanded") === "true";

  question.setAttribute("aria-expanded", String(open));
  item.classList.toggle("is-open", open);
  answer.hidden = !open;

  if (open && !wasOpen && !reducedMotion.matches && answer.animate) {
    answer.animate(
      [
        { opacity: 0, transform: "translateY(-8px)" },
        { opacity: 1, transform: "translateY(0)" }
      ],
      {
        duration: 420,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      }
    );
  }
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
