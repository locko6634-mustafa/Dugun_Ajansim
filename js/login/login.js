import { apiRequest } from "../shared/api-client.js";

const loginForm = document.querySelector(".login-form");
const changeForm = document.querySelector(".password-change-form");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector(".password-toggle");
const forgotButton = document.querySelector(".forgot-button");
const formMessage = loginForm.querySelector(".form-message");
const changeMessage = changeForm.querySelector(".password-change-message");
let authenticatedRole = "";

function setFieldError(input, message) {
  const field = input.closest(".form-field");
  const error = field.querySelector(".field-error");
  field.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  if (error) error.textContent = message;
}

function validateUsername() {
  const valid = usernameInput.value.trim().length >= 3;
  setFieldError(usernameInput, valid ? "" : "Kullanıcı adınızı girin.");
  return valid;
}

function validatePassword() {
  const valid = passwordInput.value.length >= 6;
  setFieldError(passwordInput, valid ? "" : "Parolanız en az 6 karakter olmalıdır.");
  return valid;
}

function redirectForRole(role) {
  const targets = {
    ADMIN: "admin.html",
    MUSTERI: "musteri-paneli.html",
    SALON_YETKILISI: "operasyon-paneli.html"
  };
  window.location.href = targets[role] || "index.html";
}

function showPasswordChange(role, currentPassword = "") {
  authenticatedRole = role;
  loginForm.hidden = true;
  changeForm.hidden = false;
  changeForm.elements.currentPassword.value = currentPassword;
  changeForm.elements.currentPassword.focus();
}

passwordToggle.addEventListener("click", () => {
  const willShow = passwordInput.type === "password";
  passwordInput.type = willShow ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(willShow));
  passwordToggle.setAttribute("aria-label", willShow ? "Parolayı gizle" : "Parolayı göster");
  passwordInput.focus();
});

usernameInput.addEventListener("blur", validateUsername);
passwordInput.addEventListener("blur", validatePassword);

forgotButton.addEventListener("click", () => {
  formMessage.classList.add("is-info");
  formMessage.textContent =
    "Parolanızı sıfırlamak için Düğün Ajansım ekibiyle iletişime geçin. Admin size geçici parola oluşturacaktır.";
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";
  if (!validateUsername() || !validatePassword()) return;

  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await apiRequest("/auth/login", {
      method: "POST",
      body: {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
        remember: loginForm.elements.remember.checked
      }
    });
    if (response.data.mustChangePassword) {
      showPasswordChange(response.data.role, passwordInput.value);
    } else {
      redirectForRole(response.data.role);
    }
  } catch (error) {
    formMessage.textContent = error.message;
    formMessage.classList.remove("is-info");
  } finally {
    submitButton.disabled = false;
  }
});

changeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  changeMessage.textContent = "";
  const data = new FormData(changeForm);
  if (data.get("newPassword") !== data.get("confirmPassword")) {
    changeMessage.textContent = "Yeni parolalar birbiriyle eşleşmiyor.";
    return;
  }

  const submitButton = changeForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await apiRequest("/auth/password/change", {
      method: "POST",
      body: {
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword")
      }
    });
    redirectForRole(authenticatedRole);
  } catch (error) {
    changeMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
