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
          <p class="section-index custom-dialog-badge ${badgeClass}">${badge}</p>
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
          <p class="section-index custom-dialog-badge ${badgeClass}">${badge}</p>
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
 * Show a form modal specifically for adding catalog packages or services
 */
export function showCatalogFormModal({ type = "packages", title = "" } = {}) {
  const dialog = getOrCreateDialog();
  const isPackage = type === "packages";
  const modalTitle = title || (isPackage ? "Yeni Paket Ekle" : "Yeni Ek Hizmet Ekle");

  const categoryOptions = `
    <option value="experience">Deneyim / Organizasyon</option>
    <option value="photo">Fotoğraf & Video</option>
    <option value="production">Sinematik Prodüksiyon</option>
    <option value="album">Albüm & Baskı</option>
  `;

  dialog.innerHTML = `
    <form class="form-shell custom-dialog-shell" method="dialog">
      <div class="sheet-heading">
        <div>
          <p class="section-index custom-dialog-badge">KATALOG GÜNCELLEME</p>
          <h2 class="custom-dialog-title">${escapeHtml(modalTitle)}</h2>
        </div>
        <button class="dialog-close js-dialog-cancel" type="button" aria-label="Kapat">×</button>
      </div>
      <div class="form-grid custom-catalog-grid">
        <label>
          Benzersiz Kısa Kod *
          <input class="js-catalog-code" type="text" placeholder="Örn: PKG-VIP veya EXP-DRONE" required />
        </label>
        <label>
          Görünen Ad *
          <input class="js-catalog-name" type="text" placeholder="Örn: Premium Düğün Paketi" required />
        </label>
        <label>
          Fiyat (TL) *
          <input class="js-catalog-price" type="number" min="0" step="50" placeholder="0" required />
        </label>
        ${
          !isPackage
            ? `
        <label>
          Kategori *
          <select class="js-catalog-category">
            ${categoryOptions}
          </select>
        </label>`
            : ""
        }
      </div>
      <p class="dialog-message js-dialog-error" role="status"></p>
      <div class="dialog-actions" style="margin-top: 24px;">
        <button class="secondary-button js-dialog-cancel" type="button">Vazgeç</button>
        <button class="primary-button js-dialog-submit" type="submit">Katalog Kaydı Oluştur</button>
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
    const errorEl = dialog.querySelector(".js-dialog-error");
    const cancelButtons = dialog.querySelectorAll(".js-dialog-cancel");

    setTimeout(() => codeInput?.focus(), 50);

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

      if (!code || !name || !Number.isFinite(priceVal) || priceVal < 0) {
        if (errorEl) errorEl.textContent = "Lütfen tüm zorunlu alanları doğru doldurun.";
        return;
      }

      cleanup({
        code,
        name,
        price: priceVal,
        category
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
