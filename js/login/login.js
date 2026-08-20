import { apiRequest } from "../shared/api-client.js";
import { fetchSession, getPanelUrlForRole } from "../shared/auth-session.js";

const loginForm = document.querySelector(".login-form");
const changeForm = document.querySelector(".password-change-form");
const resetForm = document.querySelector(".password-reset-form");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector(".password-toggle");
const forgotButton = document.querySelector(".forgot-button");
const resetRequestStep = resetForm.querySelector(".password-reset-request-step");
const resetConfirmStep = resetForm.querySelector(".password-reset-confirm-step");
const resetUsernameInput = resetForm.querySelector("#reset-username");
const resetCodeInput = resetForm.querySelector("#reset-code");
const resetNewPasswordInput = resetForm.querySelector("#reset-new-password");
const resetConfirmPasswordInput = resetForm.querySelector("#reset-confirm-password");
const resetInstruction = resetForm.querySelector(".password-reset-instruction");
const resetMessage = resetForm.querySelector(".password-reset-message");
const resetRequestSubmit = resetForm.querySelector(".password-reset-request-submit");
const resetConfirmSubmit = resetForm.querySelector(".password-reset-confirm-submit");
const resetBackButton = resetForm.querySelector(".password-reset-back");
const mfaLoginField = document.querySelector(".mfa-login-field");
const totpCodeInput = document.querySelector("#totp-code");
const formMessage = loginForm.querySelector(".form-message");
const changeMessage = changeForm.querySelector(".password-change-message");
const changeCurrentPasswordField = changeForm.querySelector(".password-current-field");
const mfaEnrollmentForm = document.querySelector(".mfa-enrollment-form");
const mfaEnrollmentDetails = mfaEnrollmentForm.querySelector(".mfa-enrollment-details");
const mfaEnrollmentMessage = mfaEnrollmentForm.querySelector(".mfa-enrollment-message");
const mfaEnrollmentSubmitLabel = mfaEnrollmentForm.querySelector(".mfa-enrollment-submit span");
const mfaSecretInput = mfaEnrollmentForm.querySelector("#mfa-secret");
const mfaOtpauthLink = mfaEnrollmentForm.querySelector(".mfa-otpauth-link");
let authenticatedRole = "";
let mfaEnrollmentStarted = false;
let passwordSetupToken = "";
let passwordSetupPurpose = "";
let resetChallengeId = "";
let resetSetupToken = "";

async function checkExistingSession() {
  const session = await fetchSession();
  if (session && session.role) {
    if (session.mustChangePassword) {
      showPasswordChange(session.role);
    } else if (session.mustEnrollMfa) {
      showMfaEnrollment(session.role);
    } else if (session.mfaEnabled && !session.mfaVerified) {
      showMfaCodeField();
      formMessage.textContent = "Devam etmek için parolanızı ve doğrulama kodunuzu girin.";
    } else {
      redirectForRole(session.role);
    }
  }
}
const setupTokenFromFragment =
  new window.URLSearchParams(window.location.hash.slice(1)).get("setup") || "";
const setupPurposeFromFragment =
  new window.URLSearchParams(window.location.hash.slice(1)).get("purpose") || "";
if (
  /^[A-Za-z0-9_-]{43}$/.test(setupTokenFromFragment) &&
  ["ACCOUNT_ACTIVATION", "PASSWORD_RESET"].includes(setupPurposeFromFragment)
) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  showPasswordSetup(setupTokenFromFragment, setupPurposeFromFragment);
} else {
  void checkExistingSession();
}

function setFieldError(input, message) {
  const field = input.closest(".form-field");
  const error = field.querySelector(".field-error");
  field.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  if (error) error.textContent = message;
}

function validateUsername() {
  const length = usernameInput.value.trim().length;
  const valid = length >= 3 && length <= 64;
  setFieldError(usernameInput, valid ? "" : "Kullanıcı adınız 3–64 karakter olmalıdır.");
  return valid;
}

function validatePassword() {
  const valid = passwordInput.value.length >= 6 && passwordInput.value.length <= 256;
  setFieldError(passwordInput, valid ? "" : "Parolanız 6–256 karakter arasında olmalıdır.");
  return valid;
}

function validateResetUsername() {
  const length = resetUsernameInput.value.trim().length;
  const valid = length >= 3 && length <= 64;
  setFieldError(resetUsernameInput, valid ? "" : "Kullanıcı adınız 3–64 karakter olmalıdır.");
  return valid;
}

function validateResetCode() {
  const valid = /^\d{6}$/.test(resetCodeInput.value.trim());
  setFieldError(resetCodeInput, valid ? "" : "6 haneli doğrulama kodunu girin.");
  return valid;
}

function validateResetNewPassword() {
  const valid =
    resetNewPasswordInput.value.length >= 8 && resetNewPasswordInput.value.length <= 128;
  setFieldError(
    resetNewPasswordInput,
    valid ? "" : "Yeni parolanız 8–128 karakter arasında olmalıdır."
  );
  return valid;
}

function validateResetConfirmPassword() {
  const valid =
    resetConfirmPasswordInput.value.length >= 8 &&
    resetConfirmPasswordInput.value.length <= 128 &&
    resetConfirmPasswordInput.value === resetNewPasswordInput.value;
  setFieldError(resetConfirmPasswordInput, valid ? "" : "Yeni parolalar birbiriyle eşleşmelidir.");
  return valid;
}

function clearResetFieldErrors() {
  [resetUsernameInput, resetCodeInput, resetNewPasswordInput, resetConfirmPasswordInput].forEach(
    (input) => setFieldError(input, "")
  );
}

function setResetStageRequirements(isConfirmStep) {
  resetUsernameInput.required = !isConfirmStep;
  resetCodeInput.required = isConfirmStep;
  resetNewPasswordInput.required = isConfirmStep;
  resetConfirmPasswordInput.required = isConfirmStep;
}

function setResetBusy(isBusy) {
  resetForm.toggleAttribute("aria-busy", isBusy);
  resetRequestSubmit.disabled = isBusy;
  resetConfirmSubmit.disabled = isBusy;
  resetBackButton.disabled = isBusy;
}

function resetPasswordResetState() {
  resetChallengeId = "";
  resetSetupToken = "";
  resetForm.reset();
  resetCodeInput.readOnly = false;
  clearResetFieldErrors();
  resetRequestStep.hidden = false;
  resetConfirmStep.hidden = true;
  setResetStageRequirements(false);
  resetInstruction.textContent = "";
  resetMessage.textContent = "";
  resetMessage.classList.remove("is-info");
  setResetBusy(false);
}

function showLoginForm({
  username = "",
  message = "",
  focusPassword = false,
  resetLoginState = false
} = {}) {
  resetPasswordResetState();
  resetForm.hidden = true;
  changeForm.hidden = true;
  mfaEnrollmentForm.hidden = true;
  loginForm.hidden = false;
  if (resetLoginState) {
    passwordInput.value = "";
    setFieldError(passwordInput, "");
    mfaLoginField.hidden = true;
    totpCodeInput.required = false;
    totpCodeInput.value = "";
    setFieldError(totpCodeInput, "");
    loginForm.elements.trustDevice.checked = false;
  }
  if (username) usernameInput.value = username;
  formMessage.classList.toggle("is-info", Boolean(message));
  formMessage.textContent = message;
  (focusPassword ? passwordInput : usernameInput).focus();
}

function showPasswordResetRequest() {
  const currentUsername = usernameInput.value.trim();
  resetPasswordResetState();
  if (currentUsername.length >= 3 && currentUsername.length <= 64) {
    resetUsernameInput.value = currentUsername;
  }
  loginForm.hidden = true;
  changeForm.hidden = true;
  mfaEnrollmentForm.hidden = true;
  resetForm.hidden = false;
  resetUsernameInput.focus();
}

function showPasswordResetConfirm(challengeId, expiresInMinutes) {
  resetChallengeId = challengeId;
  resetSetupToken = "";
  resetCodeInput.readOnly = false;
  resetRequestStep.hidden = true;
  resetConfirmStep.hidden = false;
  setResetStageRequirements(true);
  const validExpiry = Number.isInteger(expiresInMinutes) && expiresInMinutes > 0;
  const expiryCopy = validExpiry ? ` Kod ${expiresInMinutes} dakika geçerlidir.` : "";
  resetInstruction.textContent = `Hesap bilgileriniz eşleşiyorsa kayıtlı e-posta adresinize 6 haneli kod gönderdik.${expiryCopy}`;
  resetCodeInput.focus();
}

function redirectForRole(role) {
  window.location.href = getPanelUrlForRole(role);
}

function showPasswordChange(role, currentPassword = "") {
  authenticatedRole = role;
  passwordSetupToken = "";
  passwordSetupPurpose = "";
  loginForm.hidden = true;
  resetForm.hidden = true;
  changeForm.hidden = false;
  mfaEnrollmentForm.hidden = true;
  changeCurrentPasswordField.hidden = false;
  changeForm.elements.currentPassword.required = true;
  changeForm.elements.currentPassword.value = currentPassword;
  changeForm.elements.currentPassword.focus();
}

function showPasswordSetup(token, purpose) {
  authenticatedRole = "";
  passwordSetupToken = token;
  passwordSetupPurpose = purpose;
  loginForm.hidden = true;
  resetForm.hidden = true;
  changeForm.hidden = false;
  mfaEnrollmentForm.hidden = true;
  changeCurrentPasswordField.hidden = true;
  changeForm.elements.currentPassword.required = false;
  changeForm.elements.currentPassword.value = "";
  changeMessage.textContent = "Tek kullanımlık bağlantınızla yeni parolanızı belirleyin.";
  changeForm.elements.newPassword.focus();
}

function showMfaCodeField() {
  mfaLoginField.hidden = false;
  totpCodeInput.required = true;
  totpCodeInput.focus();
}

function showMfaEnrollment(role, currentPassword = "") {
  authenticatedRole = role;
  loginForm.hidden = true;
  resetForm.hidden = true;
  changeForm.hidden = true;
  mfaEnrollmentForm.hidden = false;
  mfaEnrollmentStarted = false;
  mfaEnrollmentDetails.hidden = true;
  mfaEnrollmentSubmitLabel.textContent = "Kurulumu Başlat";
  mfaEnrollmentMessage.textContent = "";
  mfaSecretInput.value = "";
  mfaOtpauthLink.href = "#";
  mfaEnrollmentForm.elements.totpCode.value = "";
  mfaEnrollmentForm.elements.currentPassword.value = currentPassword;
  mfaEnrollmentForm.elements.currentPassword.focus();
}

passwordToggle.addEventListener("click", () => {
  const willShow = passwordInput.type === "password";
  passwordInput.type = willShow ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(willShow));
  passwordToggle.setAttribute("aria-label", willShow ? "Parolayı gizle" : "Parolayı göster");
  passwordInput.focus();
});

forgotButton.addEventListener("click", showPasswordResetRequest);
resetBackButton.addEventListener("click", () => showLoginForm());

usernameInput.addEventListener("blur", validateUsername);
passwordInput.addEventListener("blur", validatePassword);
resetUsernameInput.addEventListener("blur", validateResetUsername);
resetCodeInput.addEventListener("blur", validateResetCode);
resetNewPasswordInput.addEventListener("blur", validateResetNewPassword);
resetConfirmPasswordInput.addEventListener("blur", validateResetConfirmPassword);

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";
  formMessage.classList.remove("is-info");
  if (!validateUsername() || !validatePassword()) return;

  const totpCode = totpCodeInput.value.trim();
  if (!mfaLoginField.hidden && !/^\d{6}$/.test(totpCode)) {
    setFieldError(totpCodeInput, "6 haneli doğrulama kodunu girin.");
    return;
  }
  setFieldError(totpCodeInput, "");

  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await apiRequest("/auth/login", {
      method: "POST",
      body: {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
        ...(totpCode ? { totpCode } : {}),
        remember: loginForm.elements.remember.checked,
        trustDevice: loginForm.elements.trustDevice.checked
      }
    });
    if (response.data.mustChangePassword) {
      showPasswordChange(response.data.role, passwordInput.value);
    } else if (response.data.mustEnrollMfa) {
      showMfaEnrollment(response.data.role, passwordInput.value);
    } else {
      redirectForRole(response.data.role);
    }
  } catch (error) {
    if (error?.payload?.errors?.code === "MFA_REQUIRED") showMfaCodeField();
    formMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetMessage.textContent = "";
  resetMessage.classList.remove("is-info");

  if (!resetChallengeId) {
    if (!validateResetUsername()) return;

    setResetBusy(true);
    try {
      const response = await apiRequest("/auth/password/reset/request", {
        method: "POST",
        body: { username: resetUsernameInput.value.trim() }
      });
      const challengeId =
        typeof response?.data?.challengeId === "string" ? response.data.challengeId.trim() : "";
      if (!challengeId) {
        throw new Error("Doğrulama işlemi başlatılamadı. Lütfen tekrar deneyin.");
      }
      showPasswordResetConfirm(challengeId, response.data.expiresInMinutes);
    } catch (error) {
      resetMessage.textContent = error.message;
      resetUsernameInput.focus();
    } finally {
      setResetBusy(false);
    }
    return;
  }

  const codeIsValid = resetSetupToken ? true : validateResetCode();
  const passwordIsValid = validateResetNewPassword();
  const confirmationIsValid = validateResetConfirmPassword();
  if (!codeIsValid || !passwordIsValid || !confirmationIsValid) return;

  setResetBusy(true);
  try {
    if (!resetSetupToken) {
      const verification = await apiRequest("/auth/password/reset/verify", {
        method: "POST",
        body: {
          challengeId: resetChallengeId,
          code: resetCodeInput.value.trim()
        }
      });
      const setupToken =
        typeof verification?.data?.token === "string" ? verification.data.token.trim() : "";
      if (!setupToken || verification?.data?.purpose !== "PASSWORD_RESET") {
        throw new Error("Doğrulama işlemi tamamlanamadı. Lütfen yeni bir kod isteyin.");
      }
      resetSetupToken = setupToken;
      resetCodeInput.readOnly = true;
      resetInstruction.textContent =
        "Kod doğrulandı. Parolanız kaydedilene kadar yeni parolanızı güvenle yeniden deneyebilirsiniz.";
    }

    const response = await apiRequest("/auth/password/setup", {
      method: "POST",
      body: {
        token: resetSetupToken,
        purpose: "PASSWORD_RESET",
        newPassword: resetNewPasswordInput.value
      }
    });
    const returnedUsername =
      typeof response?.data?.username === "string" ? response.data.username.trim() : "";
    const username =
      returnedUsername.length >= 3 && returnedUsername.length <= 64
        ? returnedUsername
        : resetUsernameInput.value.trim();
    showLoginForm({
      username,
      message: "Parolanız yenilendi. Şimdi yeni parolanızla giriş yapabilirsiniz.",
      focusPassword: true,
      resetLoginState: true
    });
  } catch (error) {
    resetMessage.textContent = error.message;
    (resetSetupToken ? resetNewPasswordInput : resetCodeInput).focus();
  } finally {
    setResetBusy(false);
  }
});

changeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  changeMessage.textContent = "";
  const data = new FormData(changeForm);
  const currentPassword = String(data.get("currentPassword") ?? "");
  const newPassword = String(data.get("newPassword") ?? "");
  const confirmPassword = String(data.get("confirmPassword") ?? "");
  if (
    !changeCurrentPasswordField.hidden &&
    (currentPassword.length < 6 || currentPassword.length > 256)
  ) {
    changeMessage.textContent = "Mevcut parolanız 6–256 karakter arasında olmalıdır.";
    changeForm.elements.currentPassword.focus();
    return;
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    changeMessage.textContent = "Yeni parolanız 8–128 karakter arasında olmalıdır.";
    changeForm.elements.newPassword.focus();
    return;
  }
  if (newPassword !== confirmPassword) {
    changeMessage.textContent = "Yeni parolalar birbiriyle eşleşmiyor.";
    changeForm.elements.confirmPassword.focus();
    return;
  }

  const submitButton = changeForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    if (passwordSetupToken) {
      const response = await apiRequest("/auth/password/setup", {
        method: "POST",
        body: { token: passwordSetupToken, purpose: passwordSetupPurpose, newPassword }
      });
      passwordSetupToken = "";
      passwordSetupPurpose = "";
      changeForm.reset();
      changeCurrentPasswordField.hidden = false;
      changeForm.elements.currentPassword.required = true;
      changeForm.hidden = true;
      loginForm.hidden = false;
      usernameInput.value = response.data.username;
      formMessage.classList.add("is-info");
      formMessage.textContent = "Parolanız belirlendi. Şimdi giriş yapabilirsiniz.";
      passwordInput.focus();
      return;
    }
    const response = await apiRequest("/auth/password/change", {
      method: "POST",
      body: {
        currentPassword,
        newPassword
      }
    });
    if (response.data.mustEnrollMfa) {
      showMfaEnrollment(authenticatedRole, newPassword);
    } else {
      redirectForRole(authenticatedRole);
    }
  } catch (error) {
    changeMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

mfaEnrollmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  mfaEnrollmentMessage.textContent = "";
  const currentPassword = String(mfaEnrollmentForm.elements.currentPassword.value ?? "");
  if (currentPassword.length < 6 || currentPassword.length > 256) {
    mfaEnrollmentMessage.textContent = "Mevcut parolanız 6–256 karakter arasında olmalıdır.";
    mfaEnrollmentForm.elements.currentPassword.focus();
    return;
  }

  const submitButton = mfaEnrollmentForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    if (!mfaEnrollmentStarted) {
      const response = await apiRequest("/auth/mfa/enroll", {
        method: "POST",
        body: { currentPassword }
      });
      mfaSecretInput.value = response.data.secret;
      mfaOtpauthLink.href = response.data.otpauthUri;
      mfaEnrollmentDetails.hidden = false;
      mfaEnrollmentStarted = true;
      mfaEnrollmentSubmitLabel.textContent = "Kurulumu Doğrula";
      mfaEnrollmentMessage.textContent =
        "Anahtarı uygulamanıza ekleyin ve üretilen 6 haneli kodu girin.";
      mfaEnrollmentForm.elements.totpCode.focus();
      return;
    }

    const totpCode = String(mfaEnrollmentForm.elements.totpCode.value ?? "").trim();
    if (!/^\d{6}$/.test(totpCode)) {
      mfaEnrollmentMessage.textContent = "6 haneli doğrulama kodunu girin.";
      mfaEnrollmentForm.elements.totpCode.focus();
      return;
    }
    await apiRequest("/auth/mfa/confirm", {
      method: "POST",
      body: { currentPassword, totpCode }
    });
    mfaSecretInput.value = "";
    mfaEnrollmentForm.reset();
    redirectForRole(authenticatedRole);
  } catch (error) {
    if (error?.status === 410) {
      mfaEnrollmentStarted = false;
      mfaEnrollmentDetails.hidden = true;
      mfaSecretInput.value = "";
      mfaOtpauthLink.href = "#";
      mfaEnrollmentSubmitLabel.textContent = "Kurulumu Yeniden Başlat";
    }
    mfaEnrollmentMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
