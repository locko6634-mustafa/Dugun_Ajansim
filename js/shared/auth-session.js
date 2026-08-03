import { apiRequest } from "./api-client.js";

export async function fetchSession() {
  try {
    const response = await apiRequest("/auth/session");
    if (response && response.success && response.data) {
      return response.data;
    }
  } catch {
    // Oturum yok veya geçersiz
  }
  return null;
}

export async function logoutUser() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch (error) {
    console.error("Çıkış yaparken bir hata oluştu:", error);
  } finally {
    window.location.href = "index.html";
  }
}

export function getPanelUrlForRole(role) {
  const targets = {
    ADMIN: "admin.html",
    MUSTERI: "musteri-paneli.html",
    SALON_YETKILISI: "operasyon-paneli.html"
  };
  return targets[role] || "index.html";
}

export function getRoleLabel(role) {
  const labels = {
    ADMIN: "Admin Paneli",
    MUSTERI: "Müşteri Paneli",
    SALON_YETKILISI: "Operasyon Paneli"
  };
  return labels[role] || "Hesabım";
}

export async function initHeaderAuth() {
  const desktopLoginLink = document.querySelector(".header-login");
  const mobileLoginLink = document.querySelector(".mobile-login-button");
  const desktopHeaderActions = document.querySelector(".header-actions");
  const mobileMenuActions = document.querySelector(".mobile-menu__actions");

  if (!desktopLoginLink && !mobileLoginLink) return;

  const session = await fetchSession();
  if (!session || !session.role) return;

  const panelUrl = getPanelUrlForRole(session.role);
  const panelLabel = getRoleLabel(session.role);

  // Masaüstü Menü Güncelleme
  if (desktopLoginLink) {
    desktopLoginLink.href = panelUrl;
    desktopLoginLink.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
      ${panelLabel}
    `;
    desktopLoginLink.classList.add("header-login--authenticated");
  }

  if (desktopHeaderActions && !document.querySelector(".header-logout")) {
    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "header-logout";
    logoutBtn.setAttribute("aria-label", "Çıkış Yap");
    logoutBtn.setAttribute("title", "Çıkış Yap");
    logoutBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
      <span>Çıkış</span>
    `;
    logoutBtn.addEventListener("click", logoutUser);
    desktopHeaderActions.appendChild(logoutBtn);
  }

  // Mobil Menü Güncelleme
  if (mobileLoginLink) {
    mobileLoginLink.href = panelUrl;
    mobileLoginLink.textContent = panelLabel;
  }

  if (mobileMenuActions && !document.querySelector(".mobile-logout-button")) {
    const mobileLogoutBtn = document.createElement("button");
    mobileLogoutBtn.type = "button";
    mobileLogoutBtn.className = "button button--ghost mobile-logout-button";
    mobileLogoutBtn.textContent = "Çıkış Yap";
    mobileLogoutBtn.addEventListener("click", logoutUser);
    mobileMenuActions.appendChild(mobileLogoutBtn);
  }
}
