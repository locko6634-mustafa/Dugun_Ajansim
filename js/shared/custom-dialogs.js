/**
 * Custom Modal & Dialog Utility
 * Replaces browser default alert(), confirm(), prompt() dialogs
 * with fully styled, accessible, modern HTML <dialog> overlays.
 */

function getOrCreateDialog() {
  let dialog = document.getElementById("app-custom-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "app-custom-dialog";
    dialog.className = "form-dialog custom-modal-dialog";
    document.body.appendChild(dialog);
  }
  return dialog;
}

/**
 * Show a custom confirmation dialog (replaces window.confirm)
 */
export function showCustomConfirm({
  title = "İşlemi Onayla",
  message = "Bu işlemi gerçekleştirmek istediğinizden emin misiniz?",
  badge = "ONAY GEREKLİ",
  confirmText = "Onayla",
  cancelText = "Vazgeç",
  isDanger = false,
  isWarning = false
} = {}) {
  const dialog = getOrCreateDialog();
  const badgeClass = isDanger ? "custom-badge--danger" : isWarning ? "custom-badge--warning" : "";
  const submitClass = isDanger ? "mini-button mini-button--danger" : "primary-button";

  dialog.innerHTML = `
    <form class="form-shell custom-dialog-shell" method="dialog">
      <div class="sheet-heading">
        <div>
          <p class="section-index custom-dialog-badge ${badgeClass}">${escapeHtml(badge)}</p>
          <h2 class="custom-dialog-title">${escapeHtml(title)}</h2>
        </div>
        <button class="dialog-close js-dialog-cancel" type="button" aria-label="Kapat">×</button>
      </div>
      <div class="custom-dialog-body">
        <p class="custom-dialog-message">${escapeHtml(message)}</p>
      </div>
      <div class="dialog-actions">
        <button class="secondary-button js-dialog-cancel" type="button">${escapeHtml(cancelText)}</button>
        <button class="${submitClass} js-dialog-submit" type="submit">${escapeHtml(confirmText)}</button>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    dialog.showModal();
    const form = dialog.querySelector("form");
    const cancelButtons = dialog.querySelectorAll(".js-dialog-cancel");
    const submitBtn = dialog.querySelector(".js-dialog-submit");

    submitBtn?.focus();

    const cleanup = (result) => {
      dialog.close();
      dialog.removeEventListener("close", onClose);
      resolve(result);
    };

    const onClose = () => cleanup(false);
    dialog.addEventListener("close", onClose, { once: true });

    cancelButtons.forEach((btn) => {
      btn.addEventListener("click", () => cleanup(false), { once: true });
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      cleanup(true);
    };
  });
}

/**
 * Show a custom single-input prompt dialog (replaces window.prompt)
 */
export function showCustomPrompt({
  title = "Bilgi Girin",
  message = "",
  label = "",
  badge = "GİRDİ GEREKLİ",
  placeholder = "",
  defaultValue = "",
  confirmText = "Tamam",
  cancelText = "Vazgeç",
  isDanger = false,
  multiline = false,
  required = false
} = {}) {
  const dialog = getOrCreateDialog();
  const badgeClass = isDanger ? "custom-badge--danger" : "";
  const submitClass = isDanger ? "mini-button mini-button--danger" : "primary-button";

  const inputHtml = multiline
    ? `<textarea class="custom-dialog-input" rows="3" placeholder="${escapeHtml(placeholder)}" ${required ? "required" : ""}>${escapeHtml(defaultValue)}</textarea>`
    : `<input class="custom-dialog-input" type="text" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" ${required ? "required" : ""} />`;

  dialog.innerHTML = `
    <form class="form-shell custom-dialog-shell" method="dialog">
      <div class="sheet-heading">
        <div>
          <p class="section-index custom-dialog-badge ${badgeClass}">${escapeHtml(badge)}</p>
          <h2 class="custom-dialog-title">${escapeHtml(title)}</h2>
        </div>
        <button class="dialog-close js-dialog-cancel" type="button" aria-label="Kapat">×</button>
      </div>
      <div class="custom-dialog-body">
        ${message ? `<p class="custom-dialog-message">${escapeHtml(message)}</p>` : ""}
        <label class="custom-dialog-label">
          ${label ? `<span>${escapeHtml(label)}</span>` : ""}
          ${inputHtml}
        </label>
        <p class="dialog-message js-dialog-error" role="status"></p>
      </div>
      <div class="dialog-actions">
        <button class="secondary-button js-dialog-cancel" type="button">${escapeHtml(cancelText)}</button>
        <button class="${submitClass} js-dialog-submit" type="submit">${escapeHtml(confirmText)}</button>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    dialog.showModal();
    const form = dialog.querySelector("form");
    const input = dialog.querySelector(".custom-dialog-input");
    const errorEl = dialog.querySelector(".js-dialog-error");
    const cancelButtons = dialog.querySelectorAll(".js-dialog-cancel");

    setTimeout(() => input?.focus(), 50);

    const cleanup = (value) => {
      dialog.close();
      dialog.removeEventListener("close", onClose);
      resolve(value);
    };

    const onClose = () => cleanup(null);
    dialog.addEventListener("close", onClose, { once: true });

    cancelButtons.forEach((btn) => {
      btn.addEventListener("click", () => cleanup(null), { once: true });
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      const val = input ? input.value.trim() : "";
      if (required && !val) {
        if (errorEl) errorEl.textContent = "Bu alan boş bırakılamaz.";
        input?.focus();
        return;
      }
      cleanup(val);
    };
  });
}

/**
 * Verifies a privileged admin action without returning credentials to the caller.
 * Password and TOTP values live only for the duration of the submit callback and
 * are scrubbed whenever the dialog closes or a verification attempt finishes.
 */
export function showAdminStepUpDialog({
  title = "Yönetici doğrulaması",
  message = "Bu hassas işleme devam etmek için parolanızı ve doğrulama kodunuzu yeniden girin.",
  onVerify
} = {}) {
  if (typeof onVerify !== "function") {
    throw new TypeError("Yönetici doğrulama işlemi tanımlanmalıdır.");
  }

  const dialog = getOrCreateDialog();
  dialog.innerHTML = `
    <form class="form-shell custom-dialog-shell js-admin-step-up-form" method="dialog">
      <div class="sheet-heading">
        <div>
          <p class="section-index custom-dialog-badge custom-badge--warning">EK DOĞRULAMA</p>
          <h2 class="custom-dialog-title">${escapeHtml(title)}</h2>
        </div>
        <button class="dialog-close js-dialog-cancel" type="button" aria-label="Kapat">×</button>
      </div>
      <div class="custom-dialog-body">
        <p class="custom-dialog-message">${escapeHtml(message)}</p>
        <div class="admin-step-up-fields">
          <label class="custom-dialog-label">
            <span>Güncel yönetici parolası</span>
            <input
              class="custom-dialog-input js-admin-step-up-password"
              type="password"
              autocomplete="current-password"
              maxlength="256"
              required
            />
          </label>
          <label class="custom-dialog-label">
            <span>6 haneli doğrulama kodu</span>
            <input
              class="custom-dialog-input admin-step-up-code js-admin-step-up-totp"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              minlength="6"
              maxlength="6"
              required
            />
          </label>
        </div>
        <p class="custom-dialog-security-note">
          Bilgileriniz yalnız bu doğrulama isteğinde kullanılır ve pencere kapanınca temizlenir.
        </p>
        <p class="dialog-message js-dialog-error" role="status" aria-live="polite"></p>
      </div>
      <div class="dialog-actions">
        <button class="secondary-button js-dialog-cancel" type="button">Vazgeç</button>
        <button class="primary-button js-dialog-submit" type="submit">Doğrula ve devam et</button>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    const form = dialog.querySelector(".js-admin-step-up-form");
    const passwordInput = dialog.querySelector(".js-admin-step-up-password");
    const totpInput = dialog.querySelector(".js-admin-step-up-totp");
    const errorElement = dialog.querySelector(".js-dialog-error");
    const submitButton = dialog.querySelector(".js-dialog-submit");
    const cancelButtons = dialog.querySelectorAll(".js-dialog-cancel");
    let settled = false;
    let verificationController = null;

    const scrubCredentials = () => {
      if (passwordInput) passwordInput.value = "";
      if (totpInput) totpInput.value = "";
      form?.reset();
    };

    const finish = (verified, abortPending = false) => {
      if (settled) return;
      settled = true;
      if (abortPending) verificationController?.abort();
      scrubCredentials();
      form.onsubmit = null;
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      dialog.replaceChildren();
      resolve(verified);
    };

    const onClose = () => finish(false, true);
    dialog.addEventListener("close", onClose, { once: true });
    cancelButtons.forEach((button) => {
      button.addEventListener("click", () => finish(false, true), { once: true });
    });

    totpInput?.addEventListener("input", () => {
      totpInput.value = totpInput.value.replace(/\D/g, "").slice(0, 6);
    });

    form.onsubmit = async (event) => {
      event.preventDefault();
      if (submitButton.disabled) return;

      let currentPassword = passwordInput?.value || "";
      let totpCode = totpInput?.value.trim() || "";
      if (!currentPassword || !/^\d{6}$/.test(totpCode)) {
        errorElement.textContent = "Parolanızı ve 6 haneli doğrulama kodunu eksiksiz girin.";
        (currentPassword ? totpInput : passwordInput)?.focus();
        currentPassword = "";
        totpCode = "";
        return;
      }

      submitButton.disabled = true;
      cancelButtons.forEach((button) => {
        button.disabled = true;
      });
      errorElement.textContent = "Doğrulanıyor…";
      verificationController = new window.AbortController();

      try {
        await onVerify({
          currentPassword,
          totpCode,
          signal: verificationController.signal
        });
        currentPassword = "";
        totpCode = "";
        finish(true);
      } catch (error) {
        currentPassword = "";
        totpCode = "";
        if (settled) return;
        scrubCredentials();
        errorElement.textContent =
          error?.status === 429
            ? "Çok fazla doğrulama denemesi yapıldı. Lütfen daha sonra tekrar deneyin."
            : "Doğrulama başarısız. Parolanızı ve güncel kodunuzu yeniden girin.";
        passwordInput?.focus();
      } finally {
        verificationController = null;
        if (!settled) {
          submitButton.disabled = false;
          cancelButtons.forEach((button) => {
            button.disabled = false;
          });
        }
      }
    };

    dialog.showModal();
    setTimeout(() => passwordInput?.focus(), 0);
  });
}

/**
 * Show a form modal specifically for adding catalog packages or services
 */
/**
 * Show a form modal specifically for adding or editing catalog packages or services
 */
export function showCatalogFormModal({
  type = "packages",
  title = "",
  initialData = null,
  constraints
} = {}) {
  if (!constraints) throw new Error("Admin katalog formu sınırları yüklenemedi.");
  const dialog = getOrCreateDialog();
  const isPackage = type === "packages";
  const isEdit = Boolean(initialData && initialData.id);
  const modalTitle =
    title ||
    (isEdit
      ? isPackage
        ? "Paket Bilgilerini Düzenle"
        : "Ek Hizmet Bilgilerini Düzenle"
      : isPackage
        ? "Yeni Paket Ekle"
        : "Yeni Ek Hizmet Ekle");

  const categories = [
    { value: "experience", label: "Deneyim / Organizasyon" },
    { value: "photo", label: "Fotoğraf & Video" },
    { value: "production", label: "Sinematik Prodüksiyon" },
    { value: "album", label: "Albüm & Baskı" }
  ];

  const categoryOptions = categories
    .map(
      (cat) =>
        `<option value="${cat.value}" ${
          initialData?.category === cat.value ? "selected" : ""
        }>${escapeHtml(cat.label)}</option>`
    )
    .join("");

  const sampleImages = [
    "assets/images/hero-couple.webp",
    "assets/images/story-1.webp",
    "assets/images/story-2.webp",
    "assets/images/story-3.webp"
  ];

  const currentCode = initialData?.code || "";
  const currentName = initialData?.name || "";
  const currentPrice = initialData?.priceCents
    ? initialData.priceCents / 100
    : initialData?.price || 0;
  const currentEyebrow = initialData?.eyebrow || "";
  const currentSubtitle = initialData?.subtitle || "";
  const currentDelivery = initialData?.deliveryText || initialData?.delivery || "";
  const currentDescription = initialData?.description || "";
  const currentImagePath = initialData?.imagePath || "";
  const currentFeatures = Array.isArray(initialData?.features)
    ? initialData.features.join("\n")
    : initialData?.features || "";
  const currentGallery = Array.isArray(initialData?.gallery)
    ? initialData.gallery.join("\n")
    : initialData?.gallery || "";
  const currentIsActive =
    initialData?.isActive !== undefined ? Boolean(initialData.isActive) : true;
  const priceMinimum = constraints.priceCents.minimum / 100;
  const priceMaximum = constraints.priceCents.maximum / 100;
  const priceStep = constraints.priceCents.step / 100;

  dialog.innerHTML = `
    <form class="form-shell custom-dialog-shell" method="dialog" style="max-width: 680px; max-height: 85vh; overflow-y: auto;">
      <div class="sheet-heading">
        <div>
          <p class="section-index custom-dialog-badge">${isEdit ? "DÜZENLEME MODU" : "YENİ KAYIT"}</p>
          <h2 class="custom-dialog-title">${escapeHtml(modalTitle)}</h2>
        </div>
        <button class="dialog-close js-dialog-cancel" type="button" aria-label="Kapat">×</button>
      </div>
      <div class="form-grid custom-catalog-grid">
        <label>
          Benzersiz Kısa Kod *
          <input class="js-catalog-code" type="text" minlength="${constraints.code.minLength}" maxlength="${constraints.code.maxLength}" pattern="${escapeHtml(constraints.code.pattern)}" placeholder="Örn: premium-paket veya drone" value="${escapeHtml(
            currentCode
          )}" ${isEdit ? "readonly style='opacity:0.75; cursor:not-allowed;'" : "required"} />
        </label>
        <label>
          Görünen Ad / Başlık *
          <input class="js-catalog-name" type="text" minlength="${constraints.name.minLength}" maxlength="${constraints.name.maxLength}" placeholder="Örn: Premium Düğün Paketi" value="${escapeHtml(
            currentName
          )}" required />
        </label>
        <label>
          Fiyat (TL) *
          <input class="js-catalog-price" type="number" min="${priceMinimum}" max="${priceMaximum}" step="${priceStep}" placeholder="0" value="${currentPrice}" required />
        </label>
        ${
          isPackage
            ? `
        <label>
          Alt Başlık / Etiket
          <input class="js-catalog-subtitle" type="text" maxlength="${constraints.subtitle.maxLength}" placeholder="Örn: Temel çekim paketi" value="${escapeHtml(
            currentSubtitle
          )}" />
        </label>`
            : `
        <label>
          Kategori *
          <select class="js-catalog-category">
            ${categoryOptions}
          </select>
        </label>
        <label>
          Üst Başlık (Eyebrow / Rozet)
          <input class="js-catalog-eyebrow" type="text" maxlength="${constraints.eyebrow.maxLength}" placeholder="Örn: ZAMANSIZ KARELER" value="${escapeHtml(
            currentEyebrow
          )}" />
        </label>`
        }
        <label class="wide">
          Teslim Süresi Metni
          <input class="js-catalog-delivery" type="text" maxlength="${constraints.delivery.maxLength}" placeholder="${
            isPackage
              ? "Örn: En geç 21 takvim gününde dijital teslim"
              : "Örn: En geç 21 takvim günü"
          }" value="${escapeHtml(currentDelivery)}" />
        </label>
        <label class="wide">
          Ana Görsel Yolu / URL
          <input class="js-catalog-image" type="text" maxlength="${constraints.imagePath.maxLength}" placeholder="Örn: assets/images/hero-couple.webp" value="${escapeHtml(
            currentImagePath
          )}" />
          <small style="margin-top: 4px; display: block; color: var(--color-muted, #666);">
            Örnek Görseller:
            ${sampleImages
              .map(
                (img) =>
                  `<button type="button" class="mini-button js-quick-img" data-img="${img}" style="margin-left: 4px; padding: 2px 6px; font-size: 11px;">${img.split("/").pop()}</button>`
              )
              .join("")}
          </small>
        </label>
        ${
          !isPackage
            ? `
        <label class="wide">
          Ek Galeri Görselleri (Her satıra bir görsel yolu)
          <textarea class="js-catalog-gallery" rows="2" data-item-maxlength="${constraints.galleryItem.maxLength}" placeholder="assets/images/story-1.webp&#10;assets/images/story-2.webp">${escapeHtml(
            currentGallery
          )}</textarea>
        </label>`
            : ""
        }
        <label class="wide">
          Genel Açıklama Metni
          <textarea class="js-catalog-description" rows="3" maxlength="${constraints.description.maxLength}" placeholder="Hazırlık telaşından son dansa kadar günün gerçek duygusunu doğal, estetik ve zamansız karelerle anlatıyoruz...">${escapeHtml(
            currentDescription
          )}</textarea>
        </label>
        <label class="wide">
          Özellik Maddeleri (Tikli Liste - Her satıra bir madde yazın)
          <textarea class="js-catalog-features" rows="4" data-item-maxlength="${constraints.feature.maxLength}" placeholder="Hazırlık, tören ve davet boyunca profesyonel fotoğraf çekimi&#10;Gelin-damat, aile ve yakın çevre portreleri&#10;Doğal anlara odaklanan belgesel çekim yaklaşımı&#10;Seçilen karelerde renk, ışık ve rötuş düzenlemesi">${escapeHtml(
            currentFeatures
          )}</textarea>
        </label>
        <label class="switch-row wide">
          <input class="js-catalog-active" type="checkbox" ${currentIsActive ? "checked" : ""} />
          <span><strong>Yayında / Aktif</strong> <small>Müşterilere başvuru ve paket oluşturma ekranında görünsün.</small></span>
        </label>
      </div>
      <p class="dialog-message js-dialog-error" role="status"></p>
      <div class="dialog-actions" style="margin-top: 24px;">
        <button class="secondary-button js-dialog-cancel" type="button">Vazgeç</button>
        <button class="primary-button js-dialog-submit" type="submit">${isEdit ? "Değişiklikleri Kaydet" : "Katalog Kaydı Oluştur"}</button>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    dialog.showModal();
    const form = dialog.querySelector("form");
    const codeInput = dialog.querySelector(".js-catalog-code");
    const nameInput = dialog.querySelector(".js-catalog-name");
    const priceInput = dialog.querySelector(".js-catalog-price");
    const categorySelect = dialog.querySelector(".js-catalog-category");
    const eyebrowInput = dialog.querySelector(".js-catalog-eyebrow");
    const subtitleInput = dialog.querySelector(".js-catalog-subtitle");
    const deliveryInput = dialog.querySelector(".js-catalog-delivery");
    const imageInput = dialog.querySelector(".js-catalog-image");
    const galleryInput = dialog.querySelector(".js-catalog-gallery");
    const descriptionInput = dialog.querySelector(".js-catalog-description");
    const featuresInput = dialog.querySelector(".js-catalog-features");
    const activeCheckbox = dialog.querySelector(".js-catalog-active");
    const errorEl = dialog.querySelector(".js-dialog-error");
    const cancelButtons = dialog.querySelectorAll(".js-dialog-cancel");

    // Quick image buttons
    dialog.querySelectorAll(".js-quick-img").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (imageInput) imageInput.value = btn.dataset.img;
      });
    });

    setTimeout(() => {
      if (!isEdit && codeInput) codeInput.focus();
      else if (nameInput) nameInput.focus();
    }, 50);

    const cleanup = (value) => {
      dialog.close();
      dialog.removeEventListener("close", onClose);
      resolve(value);
    };

    const onClose = () => cleanup(null);
    dialog.addEventListener("close", onClose, { once: true });

    cancelButtons.forEach((btn) => {
      btn.addEventListener("click", () => cleanup(null), { once: true });
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      const code = codeInput ? codeInput.value.trim() : "";
      const name = nameInput ? nameInput.value.trim() : "";
      const priceVal = priceInput ? Number(priceInput.value) : Number.NaN;
      const category = categorySelect ? categorySelect.value : "experience";
      const eyebrow = eyebrowInput ? eyebrowInput.value.trim() : undefined;
      const subtitle = subtitleInput ? subtitleInput.value.trim() : undefined;
      const deliveryText = deliveryInput ? deliveryInput.value.trim() : undefined;
      const imagePath = imageInput ? imageInput.value.trim() : undefined;
      const description = descriptionInput ? descriptionInput.value.trim() : undefined;
      const features = featuresInput
        ? featuresInput.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const gallery = galleryInput
        ? galleryInput.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const isActive = activeCheckbox ? activeCheckbox.checked : true;

      if (!code || !name || !Number.isFinite(priceVal) || priceVal < 0) {
        if (errorEl)
          errorEl.textContent = "Lütfen zorunlu alanları (Kod, Ad, Fiyat) doğru doldurun.";
        return;
      }
      if (features.some((item) => item.length > constraints.feature.maxLength)) {
        errorEl.textContent = `Her özellik en fazla ${constraints.feature.maxLength} karakter olabilir.`;
        return;
      }
      if (gallery.some((item) => item.length > constraints.galleryItem.maxLength)) {
        errorEl.textContent = `Her galeri yolu en fazla ${constraints.galleryItem.maxLength} karakter olabilir.`;
        return;
      }

      cleanup({
        code,
        name,
        price: priceVal,
        priceCents: Math.round(priceVal * 100),
        category,
        eyebrow,
        subtitle,
        deliveryText,
        delivery: deliveryText,
        imagePath,
        description,
        features,
        gallery,
        isActive
      });
    };
  });
}

export function showVenueFormModal({ title = "", initialData = null, constraints } = {}) {
  if (!constraints) throw new Error("Admin katalog formu sınırları yüklenemedi.");
  const dialog = getOrCreateDialog();
  const isEdit = Boolean(initialData?.id);
  const modalTitle = title || (isEdit ? "Mekân Bilgilerini Düzenle" : "Yeni Mekân Ekle");
  const currentActive = initialData?.isActive !== undefined ? Boolean(initialData.isActive) : true;
  const currentPartner =
    initialData?.isPartner !== undefined ? Boolean(initialData.isPartner) : true;
  const currentFeatured = Boolean(initialData?.isFeatured);

  dialog.innerHTML = `
    <form class="form-shell custom-dialog-shell" method="dialog" style="max-width: 680px; max-height: 85vh; overflow-y: auto;">
      <div class="sheet-heading">
        <div>
          <p class="section-index custom-dialog-badge">${isEdit ? "DÜZENLEME MODU" : "YENİ KAYIT"}</p>
          <h2 class="custom-dialog-title">${escapeHtml(modalTitle)}</h2>
        </div>
        <button class="dialog-close js-dialog-cancel" type="button" aria-label="Kapat">×</button>
      </div>
      <div class="form-grid custom-catalog-grid">
        <label>
          Benzersiz Kısa Kod *
          <input class="js-venue-slug" type="text" minlength="${constraints.code.minLength}" maxlength="${constraints.code.maxLength}" pattern="${escapeHtml(constraints.code.pattern)}" placeholder="Örn: rena-garden" value="${escapeHtml(initialData?.slug || "")}" ${isEdit ? "readonly" : "required"} />
        </label>
        <label>
          Operasyon Adı *
          <input class="js-venue-name" type="text" minlength="${constraints.name.minLength}" maxlength="${constraints.name.maxLength}" placeholder="Örn: Rena Garden" value="${escapeHtml(initialData?.name || "")}" required />
        </label>
        <label>
          Vitrin Adı
          <input class="js-venue-display-name" type="text" minlength="${constraints.venue.displayName.minLength}" maxlength="${constraints.venue.displayName.maxLength}" placeholder="Örn: Rena" value="${escapeHtml(initialData?.displayName || "")}" />
        </label>
        <label>
          Vitrin Sırası
          <input class="js-venue-display-order" type="number" min="${constraints.venue.displayOrder.minimum}" max="${constraints.venue.displayOrder.maximum}" step="${constraints.venue.displayOrder.step}" value="${Number(initialData?.displayOrder || 0)}" />
        </label>
        <label class="wide">
          Mekân Görseli Yolu / URL
          <input class="js-venue-image" type="text" maxlength="${constraints.imagePath.maxLength}" placeholder="Örn: assets/images/venues/rena.webp" value="${escapeHtml(initialData?.imagePath || "")}" />
          <small>Referans vitrininde yayınlanacak mekânlar için görsel zorunludur.</small>
        </label>
        <label class="switch-row wide">
          <input class="js-venue-featured" type="checkbox" ${currentFeatured ? "checked" : ""} />
          <span><strong>Ana sayfa vitrininde göster</strong> <small>Vitrin adı, görseli ve sırası kullanılır.</small></span>
        </label>
        <label class="switch-row wide">
          <input class="js-venue-partner" type="checkbox" ${currentPartner ? "checked" : ""} />
          <span><strong>İş ortağı mekân</strong> <small>Başvuru formundaki mekân seçeneklerine dahil edilir.</small></span>
        </label>
        <label class="switch-row wide">
          <input class="js-venue-active" type="checkbox" ${currentActive ? "checked" : ""} />
          <span><strong>Aktif</strong> <small>Pasif mekân yeni başvuru ve vitrin akışlarında gösterilmez.</small></span>
        </label>
      </div>
      <p class="dialog-message js-dialog-error" role="status"></p>
      <div class="dialog-actions" style="margin-top: 24px;">
        <button class="secondary-button js-dialog-cancel" type="button">Vazgeç</button>
        <button class="primary-button" type="submit">${isEdit ? "Değişiklikleri Kaydet" : "Mekân Oluştur"}</button>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    dialog.showModal();
    const form = dialog.querySelector("form");
    const slugInput = dialog.querySelector(".js-venue-slug");
    const nameInput = dialog.querySelector(".js-venue-name");
    const displayNameInput = dialog.querySelector(".js-venue-display-name");
    const imageInput = dialog.querySelector(".js-venue-image");
    const orderInput = dialog.querySelector(".js-venue-display-order");
    const featuredInput = dialog.querySelector(".js-venue-featured");
    const partnerInput = dialog.querySelector(".js-venue-partner");
    const activeInput = dialog.querySelector(".js-venue-active");
    const errorEl = dialog.querySelector(".js-dialog-error");

    const cleanup = (value) => {
      dialog.close();
      dialog.removeEventListener("close", onClose);
      resolve(value);
    };
    const onClose = () => cleanup(null);
    dialog.addEventListener("close", onClose, { once: true });
    dialog.querySelectorAll(".js-dialog-cancel").forEach((button) => {
      button.addEventListener("click", () => cleanup(null), { once: true });
    });

    (isEdit ? nameInput : slugInput)?.focus();

    form.onsubmit = (event) => {
      event.preventDefault();
      const slug = slugInput.value.trim();
      const name = nameInput.value.trim();
      const displayName = displayNameInput.value.trim();
      const imagePath = imageInput.value.trim();
      const displayOrder = Number(orderInput.value);
      const isFeatured = featuredInput.checked;

      if (
        !slug ||
        !name ||
        !new RegExp(constraints.code.pattern).test(slug) ||
        !Number.isInteger(displayOrder)
      ) {
        errorEl.textContent = "Kısa kod, operasyon adı ve vitrin sırasını doğru doldurun.";
        return;
      }
      if (isFeatured && (!displayName || !imagePath)) {
        errorEl.textContent = "Vitrinde gösterilecek mekân için vitrin adı ve görsel gereklidir.";
        return;
      }

      cleanup({
        slug,
        name,
        displayName: displayName || null,
        imagePath: imagePath || null,
        displayOrder,
        isFeatured,
        isPartner: partnerInput.checked,
        isActive: activeInput.checked
      });
    };
  });
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
