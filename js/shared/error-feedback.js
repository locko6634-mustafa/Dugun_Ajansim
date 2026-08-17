const GENERIC_MESSAGES = new Set([
  "bir hata oluştu.",
  "girdi doğrulama hatası",
  "işlem tamamlanamadı.",
  "istek biçimi geçersiz.",
  "sunucu içi bir hata oluştu."
]);

const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

const safeReference = (payload) => {
  const candidate = payload?.errorId || payload?.requestId || payload?.correlationId;
  return typeof candidate === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(candidate)
    ? candidate
    : "";
};

export function describeRequestError({
  status = null,
  message = "",
  payload = null,
  retryAfterSeconds = null
} = {}) {
  const numericStatus = Number.isInteger(status) ? status : null;
  const serverMessage = cleanText(message || payload?.message);
  const hasMeaningfulServerMessage =
    serverMessage &&
    !GENERIC_MESSAGES.has(serverMessage.toLocaleLowerCase("tr-TR")) &&
    !/^(?:TypeError|ReferenceError|SyntaxError):|Cannot (?:read|set)|(?:undefined|null) is not|Unexpected token|Failed to fetch|NetworkError/i.test(
      serverMessage
    );
  const waitSeconds =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.ceil(retryAfterSeconds)
      : null;

  let title = "Beklenmedik bir sorun oluştu";
  let fallback =
    "Bu bölüm hazırlanırken beklenmedik bir sorun oluştu. Sayfayı yenileyip tekrar deneyin.";
  let retryable = numericStatus === null;

  if (numericStatus === 0) {
    title = "Bağlantı kurulamadı";
    fallback = "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.";
    retryable = true;
  } else if (numericStatus === 408) {
    title = "Yanıt gecikti";
    fallback = "Sunucu zamanında yanıt vermedi. Bağlantınızı kontrol edip tekrar deneyin.";
    retryable = true;
  } else if (numericStatus === 401) {
    title = "Oturum doğrulanamadı";
    fallback = "Oturumunuz sona erdi. Güvenli biçimde devam etmek için yeniden giriş yapın.";
  } else if (numericStatus === 403) {
    title = "Bu işlem için yetkiniz yok";
    fallback =
      "Bu bilgiye veya işleme erişim izniniz bulunmuyor. Gerekirse yöneticinizle iletişime geçin.";
  } else if (numericStatus === 404) {
    title = "Kayıt bulunamadı";
    fallback =
      "Aradığınız kayıt bulunamadı veya artık erişilebilir değil. Sayfayı yenileyip tekrar deneyin.";
  } else if (numericStatus === 409) {
    title = "Bilgiler güncelliğini yitirdi";
    fallback = "Kayıt başka bir işlemde değişti. Güncel bilgileri yükleyip tekrar deneyin.";
    retryable = true;
  } else if (numericStatus === 410) {
    title = "İşlem süresi doldu";
    fallback = "Bu işlem bağlantısının süresi doldu. İşlemi baştan başlatın.";
  } else if (numericStatus === 413) {
    title = "Dosya veya istek çok büyük";
    fallback =
      "Gönderilen içerik izin verilen boyutu aşıyor. Daha küçük bir dosyayla tekrar deneyin.";
  } else if (numericStatus === 422 || payload?.code === "VALIDATION_ERROR") {
    title = "Bazı bilgiler düzeltilmeli";
    fallback =
      "Gönderilen bilgilerden biri geçerli değil. İşaretli alanları kontrol edip tekrar deneyin.";
  } else if (numericStatus === 429) {
    title = "Çok fazla deneme yapıldı";
    fallback = waitSeconds
      ? `Güvenliğiniz için işlem kısa süreliğine durduruldu. ${waitSeconds} saniye sonra tekrar deneyin.`
      : "Güvenliğiniz için işlem kısa süreliğine durduruldu. Bir süre sonra tekrar deneyin.";
    retryable = true;
  } else if (numericStatus >= 400 && numericStatus < 500) {
    title = "İşlem kabul edilmedi";
    fallback = "Gönderilen bilgiler işlenemedi. Bilgileri kontrol edip tekrar deneyin.";
  } else if (numericStatus >= 500) {
    title = "Hizmet geçici olarak kullanılamıyor";
    fallback =
      "İşlem şu anda tamamlanamıyor. Bilgileriniz ekranda korunuyorsa birkaç dakika sonra tekrar deneyin.";
    retryable = true;
  }

  const reference = numericStatus !== null && numericStatus >= 500 ? safeReference(payload) : "";
  const copy = hasMeaningfulServerMessage ? serverMessage : fallback;
  const displayMessage = reference ? `${copy} Destek kodu: ${reference}.` : copy;

  return { title, message: displayMessage, reference, retryable };
}

export function decorateRequestError(error, options = {}) {
  const feedback = describeRequestError({
    status: options.status ?? error?.status,
    message: options.message ?? error?.message,
    payload: options.payload ?? error?.payload,
    retryAfterSeconds: options.retryAfterSeconds ?? error?.retryAfterSeconds
  });
  error.message = feedback.message;
  error.userTitle = feedback.title;
  error.retryable = feedback.retryable;
  error.reference = feedback.reference;
  return error;
}

export function clearErrorFeedback(target) {
  if (!target) return;
  target.replaceChildren();
  target.classList.remove("error-feedback");
  delete target.dataset.feedbackState;
  target.setAttribute("role", "status");
  target.setAttribute("aria-live", "polite");
}

export function renderErrorFeedback(
  target,
  error,
  { title = "", retryAction = null, actionLabel = "Tekrar dene", focus = false } = {}
) {
  if (!target) return;
  const feedback = error?.userTitle
    ? {
        title: error.userTitle,
        message: error.message,
        retryable: Boolean(error.retryable)
      }
    : describeRequestError({
        status: error?.status,
        message: error?.message,
        payload: error?.payload,
        retryAfterSeconds: error?.retryAfterSeconds
      });

  const heading = document.createElement("strong");
  heading.className = "error-feedback__title";
  heading.textContent = title || feedback.title;
  const copy = document.createElement("span");
  copy.className = "error-feedback__copy";
  copy.textContent = feedback.message;
  target.replaceChildren(heading, copy);
  target.classList.add("error-feedback");
  target.dataset.feedbackState = "error";
  target.setAttribute("role", "alert");
  target.setAttribute("aria-live", "assertive");
  target.setAttribute("aria-atomic", "true");

  if (typeof retryAction === "function" && feedback.retryable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "error-feedback__action";
    button.textContent = actionLabel;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "Yeniden deneniyor…";
      try {
        await retryAction();
        clearErrorFeedback(target);
      } catch (retryError) {
        renderErrorFeedback(target, retryError, { title, retryAction, actionLabel, focus: true });
      }
    });
    target.append(button);
  }

  if (focus) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}
