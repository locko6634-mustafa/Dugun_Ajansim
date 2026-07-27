const loginForm = document.querySelector(".login-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector(".password-toggle");
const forgotButton = document.querySelector(".forgot-button");
const formMessage = document.querySelector(".form-message");

function setFieldError(input, message) {
  const field = input.closest(".form-field");
  const error = field.querySelector(".field-error");

  field.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  error.textContent = message;
}

function validateEmail() {
  const value = emailInput.value.trim();

  if (!value) {
    setFieldError(emailInput, "Lütfen e-posta adresinizi girin.");
    return false;
  }

  if (!emailInput.validity.valid) {
    setFieldError(emailInput, "Geçerli bir e-posta adresi girin.");
    return false;
  }

  setFieldError(emailInput, "");
  return true;
}

function validatePassword() {
  if (!passwordInput.value) {
    setFieldError(passwordInput, "Lütfen şifrenizi girin.");
    return false;
  }

  if (passwordInput.value.length < 6) {
    setFieldError(passwordInput, "Şifreniz en az 6 karakter olmalıdır.");
    return false;
  }

  setFieldError(passwordInput, "");
  return true;
}

passwordToggle.addEventListener("click", () => {
  const willShow = passwordInput.type === "password";

  passwordInput.type = willShow ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(willShow));
  passwordToggle.setAttribute("aria-label", willShow ? "Şifreyi gizle" : "Şifreyi göster");
  passwordInput.focus();
});

emailInput.addEventListener("blur", validateEmail);
passwordInput.addEventListener("blur", validatePassword);

[emailInput, passwordInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") {
      input === emailInput ? validateEmail() : validatePassword();
    }
    formMessage.textContent = "";
  });
});

forgotButton.addEventListener("click", () => {
  formMessage.classList.add("is-info");
  formMessage.textContent =
    "Şifre yenileme özelliği yönetim sistemiyle birlikte kullanıma açılacak.";
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  formMessage.textContent = "";

  const isEmailValid = validateEmail();
  const isPasswordValid = validatePassword();

  if (!isEmailValid || !isPasswordValid) {
    const firstInvalid = loginForm.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
    return;
  }

  formMessage.classList.add("is-info");
  formMessage.textContent =
    "Giriş altyapısı yakında aktif olacak. Bilgileriniz hiçbir yere gönderilmedi.";
});
