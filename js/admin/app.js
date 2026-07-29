import { apiRequest } from "../shared/api-client.js";

const state = { venues: [], packages: [], services: [], weddings: [] };
const globalMessage = document.querySelector(".global-message");
const applicationContainer = document.querySelector(".js-applications");
const deliveryContainer = document.querySelector(".js-deliveries");
const messageContainer = document.querySelector(".js-messages");
const auditContainer = document.querySelector(".js-audit");
const manualDialog = document.querySelector(".js-manual-dialog");
const manualForm = document.querySelector(".js-manual-form");
const weddingDialog = document.querySelector(".js-wedding-dialog");
const weddingForm = document.querySelector(".js-wedding-form");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const formatDate = (value, includeTime = false) =>
  value
    ? new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        ...(includeTime ? { timeStyle: "short" } : {})
      }).format(new Date(value))
    : "—";

const formatMoney = (cents) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0
  }).format(cents / 100);

const datePartInIstanbul = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));

const timePartInIstanbul = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));

function setMessage(message, success = false) {
  globalMessage.textContent = message;
  globalMessage.style.color = success ? "var(--success)" : "";
}

document.querySelector(".js-current-date").textContent = `${new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  dateStyle: "long"
}).format(new Date())} · İstanbul`;

async function ensureAdmin() {
  try {
    const response = await apiRequest("/auth/session");
    if (response.data.role !== "ADMIN" || response.data.mustChangePassword) {
      window.location.replace("login.html");
      return false;
    }
    return true;
  } catch {
    window.location.replace("login.html");
    return false;
  }
}

function activatePanel(name) {
  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.panel === name);
  });
  document.querySelectorAll("[data-panel-content]").forEach((panel) => {
    const active = panel.dataset.panelContent === name;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  if (name === "applications") void loadApplications();
  if (name === "deliveries") void loadDeliveries();
  if (name === "messages") void loadMessages();
  if (name === "catalog") void loadCatalogAdmin();
  if (name === "audit") void loadAudit();
}

document.querySelectorAll("[data-panel]").forEach((button) => {
  button.addEventListener("click", () => activatePanel(button.dataset.panel));
});
document.querySelectorAll("[data-jump]").forEach((button) => {
  button.addEventListener("click", () => activatePanel(button.dataset.jump));
});

async function loadOverview() {
  const response = await apiRequest("/admin/overview");
  Object.entries(response.data).forEach(([key, value]) => {
    const element = document.querySelector(`[data-metric="${key}"]`);
    if (element) element.textContent = value;
  });
}

async function loadApplications() {
  const filter = document.querySelector(".js-application-filter").value;
  const referenceCode = document.querySelector(".js-application-reference").value.trim();
  const query = new window.URLSearchParams();
  if (filter) query.set("status", filter);
  if (referenceCode) query.set("referenceCode", referenceCode);
  applicationContainer.innerHTML = '<p class="empty-state">Başvurular yükleniyor…</p>';
  try {
    const response = await apiRequest(
      `/admin/booking-applications${query.size ? `?${query}` : ""}`
    );
    if (!response.data.length) {
      applicationContainer.innerHTML = '<p class="empty-state">Bu durumda başvuru yok.</p>';
      return;
    }
    applicationContainer.innerHTML = response.data
      .map(
        (item) => `
          <article class="data-row">
            <div class="data-row__title"><strong>${escapeHtml(item.brideFirstName)} &amp; ${escapeHtml(item.groomFirstName)}</strong><small>${escapeHtml(item.referenceCode)}</small></div>
            <div><small>Salon</small><strong>${escapeHtml(item.venue.name)}</strong></div>
            <div><small>Tarih</small><strong>${formatDate(item.weddingStartsAt, true)}</strong></div>
            <div class="data-row__actions">
              <span>${formatMoney(item.payableNowCents)}</span>
              ${
                item.status === "ONAY_BEKLIYOR"
                  ? `<button class="mini-button mini-button--primary" data-approve="${item.id}">Onayla</button>
                     <button class="mini-button mini-button--danger" data-reject="${item.id}">Reddet</button>`
                  : `<small>${escapeHtml(item.status.replaceAll("_", " "))}</small>`
              }
            </div>
          </article>`
      )
      .join("");
  } catch (error) {
    applicationContainer.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

applicationContainer.addEventListener("click", async (event) => {
  const approveButton = event.target.closest("[data-approve]");
  const rejectButton = event.target.closest("[data-reject]");
  try {
    if (approveButton) {
      await apiRequest(`/admin/booking-applications/${approveButton.dataset.approve}/approve`, {
        method: "POST"
      });
      setMessage("Başvuru onaylandı ve müşteri hesabı hazırlandı.", true);
    } else if (rejectButton) {
      const reason = window.prompt("Ret nedenini yazın:");
      if (!reason) return;
      await apiRequest(`/admin/booking-applications/${rejectButton.dataset.reject}/reject`, {
        method: "POST",
        body: { reason }
      });
      setMessage("Başvuru reddedildi.", true);
    } else {
      return;
    }
    await Promise.all([loadApplications(), loadOverview()]);
  } catch (error) {
    setMessage(error.message);
  }
});

document.querySelector(".js-application-filter").addEventListener("change", loadApplications);
document.querySelector(".js-application-search").addEventListener("submit", (event) => {
  event.preventDefault();
  void loadApplications();
});

const statusLabels = {
  HAZIRLANIYOR: "Hazırlanıyor",
  MONTAJ: "Montaj",
  KONTROL: "Kontrol",
  TESLIME_HAZIR: "Teslime Hazır",
  TESLIM_EDILDI: "Teslim Edildi"
};

async function openWeddingEditor(weddingId) {
  const wedding = state.weddings.find((item) => item.id === weddingId);
  if (!wedding) return;
  if (!state.venues.length) {
    state.venues = (await apiRequest("/venues")).data;
  }
  weddingForm.querySelector(".js-wedding-venue").innerHTML = state.venues
    .map(
      (venue) =>
        `<option value="${venue.id}" ${venue.id === wedding.venueId ? "selected" : ""}>${escapeHtml(venue.name)}</option>`
    )
    .join("");

  const fields = {
    weddingId: wedding.id,
    brideFirstName: wedding.brideFirstName,
    brideLastName: wedding.brideLastName,
    bridePhone: wedding.bridePhone,
    groomFirstName: wedding.groomFirstName,
    groomLastName: wedding.groomLastName,
    groomPhone: wedding.groomPhone,
    primaryContact: wedding.primaryContact,
    primaryEmail: wedding.primaryEmail,
    weddingDate: datePartInIstanbul(wedding.startsAt),
    startTime: timePartInIstanbul(wedding.startsAt),
    endTime: timePartInIstanbul(wedding.endsAt),
    note: wedding.note || ""
  };
  Object.entries(fields).forEach(([name, value]) => {
    weddingForm.elements.namedItem(name).value = value;
  });
  weddingForm.elements.namedItem("endsNextDay").checked =
    datePartInIstanbul(wedding.startsAt) !== datePartInIstanbul(wedding.endsAt);
  weddingForm.querySelector(".dialog-message").textContent = "";
  weddingDialog.showModal();
}

async function loadDeliveries() {
  deliveryContainer.innerHTML = '<p class="empty-state">Teslimatlar yükleniyor…</p>';
  try {
    const response = await apiRequest("/admin/weddings");
    state.weddings = response.data;
    if (!state.weddings.length) {
      deliveryContainer.innerHTML = '<p class="empty-state">Henüz onaylı düğün yok.</p>';
      return;
    }
    deliveryContainer.innerHTML = state.weddings
      .map((item) => {
        const delivery = item.delivery;
        const selectable = ["HAZIRLANIYOR", "MONTAJ", "KONTROL", "TESLIME_HAZIR"];
        return `
          <article class="data-row delivery-row" data-delivery-row="${delivery.id}">
            <div class="data-row__title"><strong>${escapeHtml(item.brideFirstName)} &amp; ${escapeHtml(item.groomFirstName)}</strong><small>${escapeHtml(item.customerUser.username)} · ${formatDate(item.startsAt)}</small></div>
            <div><small>${escapeHtml(item.venue.name)}</small><strong>${formatDate(delivery.dueDate)}</strong></div>
            <div class="delivery-controls">
              <select data-field="status" ${delivery.status === "TESLIM_EDILDI" ? "disabled" : ""}>
                ${selectable.map((status) => `<option value="${status}" ${delivery.status === status ? "selected" : ""}>${statusLabels[status]}</option>`).join("")}
                ${delivery.status === "TESLIM_EDILDI" ? '<option selected value="TESLIM_EDILDI">Teslim Edildi</option>' : ""}
              </select>
              <input data-field="driveUrl" type="url" placeholder="${delivery.hasDriveUrl ? "Google Drive bağlantısı kayıtlı" : "Google Drive bağlantısı"}" ${delivery.status === "TESLIM_EDILDI" ? "disabled" : ""} />
              <button class="mini-button" data-save-delivery="${delivery.id}" ${delivery.status === "TESLIM_EDILDI" ? "disabled" : ""}>Kaydet</button>
            </div>
            <div class="data-row__actions">
              <button class="mini-button" data-edit-wedding="${item.id}">Düzenle</button>
              <button class="mini-button mini-button--primary" data-deliver="${delivery.id}" ${delivery.status !== "TESLIME_HAZIR" || !delivery.hasDriveUrl ? "disabled" : ""}>Teslim Et</button>
              <button class="mini-button" data-reset-user="${item.customerUser.id}">Parola sıfırla</button>
            </div>
          </article>`;
      })
      .join("");
  } catch (error) {
    deliveryContainer.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

deliveryContainer.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-save-delivery]");
  const deliverButton = event.target.closest("[data-deliver]");
  const resetButton = event.target.closest("[data-reset-user]");
  const editButton = event.target.closest("[data-edit-wedding]");
  try {
    if (editButton) {
      await openWeddingEditor(editButton.dataset.editWedding);
      return;
    } else if (saveButton) {
      const row = saveButton.closest("[data-delivery-row]");
      const driveUrl = row.querySelector('[data-field="driveUrl"]').value.trim();
      await apiRequest(`/admin/deliveries/${saveButton.dataset.saveDelivery}`, {
        method: "PATCH",
        body: {
          status: row.querySelector('[data-field="status"]').value,
          ...(driveUrl ? { driveUrl } : {})
        }
      });
      setMessage("Teslimat bilgileri kaydedildi.", true);
    } else if (deliverButton) {
      await apiRequest(`/admin/deliveries/${deliverButton.dataset.deliver}/deliver`, {
        method: "POST"
      });
      setMessage("Teslimat müşteriye açıldı ve mesaj görevi oluşturuldu.", true);
    } else if (resetButton) {
      const popup = window.open("about:blank", "_blank");
      try {
        const response = await apiRequest(
          `/admin/customers/${resetButton.dataset.resetUser}/reset-password`,
          { method: "POST" }
        );
        if (popup) {
          popup.opener = null;
          popup.location.href = response.data.whatsappUrl;
        } else {
          window.location.href = response.data.whatsappUrl;
        }
      } catch (error) {
        popup?.close();
        throw error;
      }
      setMessage("Geçici parola hazırlandı. WhatsApp mesajını gönderin.", true);
    } else {
      return;
    }
    await Promise.all([loadDeliveries(), loadOverview()]);
  } catch (error) {
    setMessage(error.message);
  }
});

async function loadMessages() {
  messageContainer.innerHTML = '<p class="empty-state">Mesaj görevleri yükleniyor…</p>';
  try {
    const response = await apiRequest("/admin/message-tasks");
    if (!response.data.length) {
      messageContainer.innerHTML = '<p class="empty-state">Mesaj görevi bulunmuyor.</p>';
      return;
    }
    messageContainer.innerHTML = response.data
      .map(
        (task) => `
          <article class="data-row">
            <div class="data-row__title"><strong>${escapeHtml(task.wedding.brideFirstName)} &amp; ${escapeHtml(task.wedding.groomFirstName)}</strong><small>${escapeHtml(task.kind.replaceAll("_", " "))}</small></div>
            <div><small>Planlanan</small><strong>${formatDate(task.dueAt, true)}</strong></div>
            <div><small>Durum</small><strong>${escapeHtml(task.status)}</strong></div>
            <div class="data-row__actions">
              ${task.status === "PENDING" ? `<button class="mini-button mini-button--primary" data-open-message="${task.id}">WhatsApp</button><button class="mini-button" data-mark-sent="${task.id}">Gönderildi</button>` : `<small>${formatDate(task.sentAt, true)}</small>`}
            </div>
          </article>`
      )
      .join("");
  } catch (error) {
    messageContainer.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

messageContainer.addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-open-message]");
  const sentButton = event.target.closest("[data-mark-sent]");
  try {
    if (openButton) {
      const popup = window.open("about:blank", "_blank");
      try {
        const response = await apiRequest(
          `/admin/message-tasks/${openButton.dataset.openMessage}/render`
        );
        if (popup) {
          popup.opener = null;
          popup.location.href = response.data.whatsappUrl;
        } else {
          window.location.href = response.data.whatsappUrl;
        }
      } catch (error) {
        popup?.close();
        throw error;
      }
    } else if (sentButton) {
      await apiRequest(`/admin/message-tasks/${sentButton.dataset.markSent}/mark-sent`, {
        method: "POST"
      });
      await loadMessages();
    }
  } catch (error) {
    setMessage(error.message);
  }
});

function renderCatalogRows(container, rows, type) {
  container.innerHTML = rows
    .map(
      (item) => `
        <div class="catalog-row" data-catalog-row="${item.id}" data-catalog-type="${type}">
          <div class="catalog-name"><input aria-label="${escapeHtml(item.name)} adı" type="text" value="${escapeHtml(item.name)}" /><small>${escapeHtml(item.code)}</small></div>
          <input aria-label="${escapeHtml(item.name)} fiyatı" type="number" min="0" step="100" value="${item.priceCents / 100}" />
          <label><input type="checkbox" ${item.isActive ? "checked" : ""} /> Aktif</label>
          <button class="mini-button" data-save-catalog="${item.id}">Kaydet</button>
        </div>`
    )
    .join("");
}

async function loadCatalogAdmin() {
  const [packagesResponse, servicesResponse] = await Promise.all([
    apiRequest("/admin/packages"),
    apiRequest("/admin/services")
  ]);
  state.packages = packagesResponse.data;
  state.services = servicesResponse.data;
  renderCatalogRows(document.querySelector(".js-packages"), state.packages, "packages");
  renderCatalogRows(document.querySelector(".js-services"), state.services, "services");
}

document
  .querySelector('[data-panel-content="catalog"]')
  .addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-catalog]");
    if (!button) return;
    const row = button.closest("[data-catalog-row]");
    try {
      await apiRequest(`/admin/${row.dataset.catalogType}/${row.dataset.catalogRow}`, {
        method: "PATCH",
        body: {
          name: row.querySelector('input[type="text"]').value.trim(),
          priceCents: Math.round(Number(row.querySelector('input[type="number"]').value) * 100),
          isActive: row.querySelector('input[type="checkbox"]').checked
        }
      });
      setMessage("Katalog güncellendi.", true);
    } catch (error) {
      setMessage(error.message);
    }
  });

document.querySelectorAll("[data-add-catalog]").forEach((button) => {
  button.addEventListener("click", async () => {
    const type = button.dataset.addCatalog;
    const code = window.prompt("Benzersiz kısa kod (ör. ekstra-klip):")?.trim();
    const name = code ? window.prompt("Görünen ad:")?.trim() : "";
    const price = name ? Number(window.prompt("Fiyat (TL):", "0")) : Number.NaN;
    if (!code || !name || !Number.isFinite(price) || price < 0) return;
    try {
      const body =
        type === "packages"
          ? { code, name, priceCents: Math.round(price * 100), isActive: true }
          : {
              code,
              name,
              category: window.prompt("Kategori:", "experience")?.trim() || "experience",
              priceCents: Math.round(price * 100),
              isActive: true
            };
      await apiRequest(`/admin/${type}`, { method: "POST", body });
      await loadCatalogAdmin();
      setMessage("Yeni katalog kaydı oluşturuldu.", true);
    } catch (error) {
      setMessage(error.message);
    }
  });
});

async function loadAudit() {
  const response = await apiRequest("/admin/audit-logs");
  auditContainer.innerHTML = response.data
    .map(
      (log) => `
        <article class="data-row">
          <div class="data-row__title"><strong>${escapeHtml(log.action)}</strong><small>${escapeHtml(log.targetType)}</small></div>
          <div><small>Aktör</small><strong>${escapeHtml(log.actor?.username || "Sistem")}</strong></div>
          <div><small>Zaman</small><strong>${formatDate(log.createdAt, true)}</strong></div>
          <div><small>İzleme</small><strong>${escapeHtml(log.correlationId.slice(0, 12))}</strong></div>
        </article>`
    )
    .join("");
}

async function loadManualOptions() {
  const [venues, catalog] = await Promise.all([apiRequest("/venues"), apiRequest("/catalog")]);
  state.venues = venues.data;
  state.packages = catalog.data.packages;
  state.services = catalog.data.services;
  document.querySelector(".js-manual-venue").innerHTML = state.venues
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join("");
  document.querySelector(".js-manual-package").innerHTML = state.packages
    .map((item) => `<option value="${item.code}">${escapeHtml(item.name)}</option>`)
    .join("");
  document.querySelector(".js-manual-services").innerHTML = state.services
    .map(
      (item) =>
        `<label><input type="checkbox" name="serviceCodes" value="${item.code}" /> ${escapeHtml(item.name)}</label>`
    )
    .join("");
}

document.querySelector(".js-open-manual").addEventListener("click", async () => {
  await loadManualOptions();
  manualDialog.showModal();
});

manualForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => manualDialog.close());
});

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    manualDialog.close();
    return;
  }
  const data = new FormData(manualForm);
  try {
    await apiRequest("/admin/booking-applications", {
      method: "POST",
      body: {
        brideFirstName: data.get("brideFirstName"),
        brideLastName: data.get("brideLastName"),
        bridePhone: data.get("bridePhone"),
        groomFirstName: data.get("groomFirstName"),
        groomLastName: data.get("groomLastName"),
        groomPhone: data.get("groomPhone"),
        primaryContact: data.get("primaryContact"),
        primaryEmail: data.get("primaryEmail"),
        weddingDate: data.get("weddingDate"),
        startTime: data.get("startTime"),
        endTime: data.get("endTime"),
        endsNextDay: data.has("endsNextDay"),
        venueId: data.get("venueId"),
        packageCode: data.get("packageCode"),
        serviceCodes: data.getAll("serviceCodes"),
        paymentMethod: data.get("paymentMethod"),
        note: data.get("note") || undefined,
        privacyConsent: false,
        marketingConsent: false
      }
    });
    manualDialog.close();
    manualForm.reset();
    setMessage("Manuel başvuru oluşturuldu; onay kuyruğuna eklendi.", true);
    await Promise.all([loadApplications(), loadOverview()]);
  } catch (error) {
    manualForm.querySelector(".dialog-message").textContent = error.message;
  }
});

weddingForm.querySelectorAll('button[value="cancel"]').forEach((button) => {
  button.addEventListener("click", () => weddingDialog.close());
});

weddingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(weddingForm);
  const weddingId = data.get("weddingId");
  try {
    const response = await apiRequest(`/admin/weddings/${weddingId}`, {
      method: "PATCH",
      body: {
        brideFirstName: data.get("brideFirstName"),
        brideLastName: data.get("brideLastName"),
        bridePhone: data.get("bridePhone"),
        groomFirstName: data.get("groomFirstName"),
        groomLastName: data.get("groomLastName"),
        groomPhone: data.get("groomPhone"),
        primaryContact: data.get("primaryContact"),
        primaryEmail: data.get("primaryEmail"),
        weddingDate: data.get("weddingDate"),
        startTime: data.get("startTime"),
        endTime: data.get("endTime"),
        endsNextDay: data.has("endsNextDay"),
        venueId: data.get("venueId"),
        note: data.get("note") || undefined
      }
    });
    weddingDialog.close();
    setMessage(
      response.data.credentialsRegenerated
        ? `Düğün güncellendi. Yeni kullanıcı adı: ${response.data.username}. Aktivasyon mesajı yenilendi.`
        : "Düğün bilgileri güncellendi.",
      true
    );
    await Promise.all([loadDeliveries(), loadOverview()]);
  } catch (error) {
    weddingForm.querySelector(".dialog-message").textContent = error.message;
  }
});

document.querySelector(".js-logout").addEventListener("click", async () => {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("login.html");
  }
});

if (await ensureAdmin()) {
  await loadOverview().catch((error) => setMessage(error.message));
}
