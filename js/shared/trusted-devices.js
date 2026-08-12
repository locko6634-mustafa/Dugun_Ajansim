import { apiRequest } from "./api-client.js";

const formatDate = (value) =>
  new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );

export function initTrustedDevices() {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "trusted-devices-trigger";
  trigger.textContent = "Güvenilen cihazlar";
  const dialog = document.createElement("dialog");
  dialog.className = "trusted-devices-dialog";
  dialog.innerHTML = `
    <div class="trusted-devices-shell">
      <header><div><small>Hesap güvenliği</small><h2>Güvenilen cihazlar</h2></div>
      <button type="button" class="trusted-devices-close" aria-label="Kapat">×</button></header>
      <p>Bu cihazlar rutin girişlerde MFA kodunu geçici olarak atlayabilir.</p>
      <p class="trusted-devices-message" role="status" aria-live="polite"></p>
      <div class="trusted-devices-list"></div>
      <footer><button type="button" class="trusted-devices-revoke-all">Tüm cihaz güvenlerini iptal et</button></footer>
    </div>`;
  document.body.append(trigger, dialog);
  const list = dialog.querySelector(".trusted-devices-list");
  const message = dialog.querySelector(".trusted-devices-message");

  const load = async () => {
    message.textContent = "Cihazlar yükleniyor…";
    try {
      const response = await apiRequest("/auth/devices");
      const devices = response.data;
      list.replaceChildren();
      if (devices.length === 0) {
        list.innerHTML = '<p class="trusted-devices-empty">Etkin cihaz güveni bulunmuyor.</p>';
      } else {
        devices.forEach((device) => {
          const row = document.createElement("article");
          row.innerHTML = `<div><strong></strong><span></span><small></small></div><button type="button">İptal et</button>`;
          row.querySelector("strong").textContent =
            `${device.name}${device.current ? " · Bu cihaz" : ""}`;
          row.querySelector("span").textContent = device.trusted
            ? "30 gün güvenildi"
            : "24 saatlik MFA doğrulaması";
          row.querySelector("small").textContent =
            `Son kullanım: ${formatDate(device.lastUsedAt)} · Bitiş: ${formatDate(device.expiresAt)}`;
          row.querySelector("button").addEventListener("click", async () => {
            try {
              await apiRequest(`/auth/devices/${encodeURIComponent(device.id)}`, {
                method: "DELETE"
              });
              await load();
            } catch (error) {
              message.textContent = error.message;
            }
          });
          list.append(row);
        });
      }
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message;
    }
  };

  trigger.addEventListener("click", () => {
    dialog.showModal();
    void load();
  });
  dialog.querySelector(".trusted-devices-close").addEventListener("click", () => dialog.close());
  dialog.querySelector(".trusted-devices-revoke-all").addEventListener("click", async () => {
    try {
      await apiRequest("/auth/devices/revoke-all", { method: "POST" });
      await load();
    } catch (error) {
      message.textContent = error.message;
    }
  });
}
