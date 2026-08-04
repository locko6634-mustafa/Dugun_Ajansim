import { apiRequest } from "../shared/api-client.js";

const SPECIALTIES = {
  PHOTOGRAPHY: "Fotoğraf",
  VIDEO: "Video",
  DRONE: "Drone",
  JIMMY_JIB: "Jimmy Jib",
  ASSISTANT: "Asistan",
  EDITING: "Kurgu / Montaj",
  ALBUM: "Albüm"
};
const PANEL_TITLES = {
  overview: "Bugünün akışı",
  calendar: "Salon takvimi",
  weddings: "Düğün planı",
  staff: "Salon ekibi"
};
const state = {
  dashboard: null,
  weekStart: "",
  calendarMonth: "",
  weddings: [],
  staff: [],
  currentWedding: null
};

const message = document.querySelector(".global-message");
const weddingDialog = document.querySelector(".js-wedding-dialog");
const detailContainer = document.querySelector(".js-wedding-detail");
const staffDialog = document.querySelector(".js-staff-dialog");
const staffForm = document.querySelector(".js-staff-form");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const empty = (copy) => `<p class="empty">${escapeHtml(copy)}</p>`;
const couple = (wedding) => `${wedding.brideFirstName} & ${wedding.groomFirstName}`;
const formatDate = (value, withTime = false) =>
  value
    ? new Intl.DateTimeFormat("tr-TR", {
        timeZone: "Europe/Istanbul",
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" } : {})
      }).format(new Date(value))
    : "—";
const formatTime = (value) =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
const dateKey = (value) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const inputTime = (value) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`;
};
const addDays = (date, days) => {
  const probe = new Date(`${date}T12:00:00.000Z`);
  probe.setUTCDate(probe.getUTCDate() + days);
  return probe.toISOString().slice(0, 10);
};
const setMessage = (copy, success = false) => {
  message.textContent = copy;
  message.classList.toggle("is-success", success);
};

async function ensureSession() {
  try {
    const response = await apiRequest("/auth/session");
    if (response.data.role !== "SALON_YETKILISI" || response.data.mustChangePassword) {
      window.location.replace("login.html");
      return false;
    }
    document.querySelector(".js-username").textContent = response.data.username;
    document.querySelector(".js-user-initial").textContent =
      response.data.username[0].toUpperCase();
    return true;
  } catch {
    window.location.replace("login.html");
    return false;
  }
}

function crew(assignments) {
  return assignments.length
    ? assignments
        .map(
          ({ staff, specialty }) =>
            `<span class="tag">${escapeHtml(staff.firstName)} · ${escapeHtml(SPECIALTIES[specialty])}</span>`
        )
        .join("")
    : '<span class="tag">Ekip bekliyor</span>';
}

function renderDashboard(data) {
  state.dashboard = data;
  state.weekStart = data.weekStart;
  document.querySelectorAll(".js-venue-name").forEach((node) => {
    node.textContent = data.venue.name;
  });
  Object.entries(data.metrics).forEach(([key, value]) => {
    const node = document.querySelector(`[data-metric="${key}"]`);
    if (node) node.textContent = value;
  });
  updateOpsBadges(data.metrics);
  document.querySelector(".js-today").innerHTML = data.todayWeddings.length
    ? data.todayWeddings
        .map(
          (wedding) =>
            `<article class="event-card"><time>${formatTime(wedding.startsAt)}–${formatTime(wedding.endsAt)}</time><div><strong>${escapeHtml(couple(wedding))}</strong><small>${wedding.assignments.length} personel atandı</small><div class="crew-line">${crew(wedding.assignments)}</div></div><button type="button" data-open-wedding="${wedding.id}">Planla</button></article>`
        )
        .join("")
    : empty("Bugün salonunuzda planlı düğün yok.");
  document.querySelector(".js-idle-staff").innerHTML = data.idleStaff.length
    ? data.idleStaff
        .map((staff) => `<span>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</span>`)
        .join("")
    : empty("Boşta personel yok.");
  document.querySelector(".js-conflicts").innerHTML = data.conflicts.length
    ? data.conflicts
        .map(
          (conflict) =>
            `<p><strong>${escapeHtml(conflict.staff.firstName)} ${escapeHtml(conflict.staff.lastName)}</strong><br><small>${escapeHtml(couple(conflict.firstWedding))} / ${escapeHtml(couple(conflict.secondWedding))}</small></p>`
        )
        .join("")
    : empty("Personel çakışması yok.");

  const days = Array.from({ length: 7 }, (_, index) => addDays(data.weekStart, index));
  document.querySelector(".js-week-label").textContent =
    `${formatDate(`${data.weekStart}T12:00:00Z`)} – ${formatDate(`${data.weekEnd}T12:00:00Z`)}`;
  document.querySelector(".js-week").innerHTML = days
    .map((day) => {
      const dayWeddings = data.weekWeddings.filter((wedding) => dateKey(wedding.startsAt) === day);
      const date = new Date(`${day}T12:00:00Z`);
      return `<article class="week-day ${day === data.today ? "is-today" : ""}"><header><span>${new Intl.DateTimeFormat("tr-TR", { weekday: "short" }).format(date)}</span><b>${date.getUTCDate()}</b></header>${dayWeddings
        .map(
          (wedding) =>
            `<button class="week-item" type="button" data-open-wedding="${wedding.id}"><strong>${formatTime(wedding.startsAt)} · ${escapeHtml(couple(wedding))}</strong><small>${wedding.assignments.length} kişilik ekip</small></button>`
        )
        .join("")}</article>`;
    })
    .join("");
}

async function loadDashboard(weekStart = state.weekStart) {
  const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : "";
  const response = await apiRequest(`/operations/dashboard${query}`);
  renderDashboard(response.data);
}

function renderCalendar(data) {
  state.calendarMonth = data.month;
  const [year, month] = data.month.split("-").map(Number);
  document.querySelector(".js-calendar-label").textContent = new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const leading = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - leading);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const probe = new Date(gridStart);
    probe.setUTCDate(gridStart.getUTCDate() + index);
    return probe.toISOString().slice(0, 10);
  });
  document.querySelector(".js-calendar").innerHTML = cells
    .map((day) => {
      const events = data.weddings.filter((wedding) => dateKey(wedding.startsAt) === day);
      return `<article class="calendar-day ${day.slice(0, 7) !== data.month ? "is-outside" : ""} ${day === data.today ? "is-today" : ""}"><b>${Number(day.slice(8))}</b>${events
        .map(
          (wedding) =>
            `<button class="calendar-event" type="button" data-open-wedding="${wedding.id}">${formatTime(wedding.startsAt)} · ${escapeHtml(couple(wedding))}</button>`
        )
        .join("")}</article>`;
    })
    .join("");
}

async function loadCalendar(month = state.calendarMonth) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  const response = await apiRequest(`/operations/calendar${query}`);
  renderCalendar(response.data);
}

function renderWeddings() {
  const term = document.querySelector(".js-wedding-search").value.trim().toLocaleLowerCase("tr-TR");
  const rows = state.weddings.filter((wedding) =>
    `${couple(wedding)} ${wedding.bridePhone} ${wedding.groomPhone}`
      .toLocaleLowerCase("tr-TR")
      .includes(term)
  );
  document.querySelector(".js-weddings").innerHTML = rows.length
    ? rows
        .map((wedding) => {
          const date = new Date(wedding.startsAt);
          return `<article class="wedding-card"><div class="date-tile"><strong>${new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit" }).format(date)}</strong><small>${new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", month: "short" }).format(date)}</small></div><div><strong>${escapeHtml(couple(wedding))}</strong><p>${formatTime(wedding.startsAt)}–${formatTime(wedding.endsAt)}</p></div><div class="crew-line">${crew(wedding.assignments)}</div><button class="mini-button" type="button" data-open-wedding="${wedding.id}">Ayrıntılar</button></article>`;
        })
        .join("")
    : empty("Aramanızla eşleşen düğün yok.");
}

async function loadWeddings() {
  const response = await apiRequest("/operations/weddings");
  state.weddings = response.data;
  renderWeddings();
}

function renderStaff() {
  const term = document.querySelector(".js-staff-search").value.trim().toLocaleLowerCase("tr-TR");
  const rows = state.staff.filter((staff) =>
    `${staff.firstName} ${staff.lastName} ${staff.phone}`.toLocaleLowerCase("tr-TR").includes(term)
  );
  document.querySelector(".js-staff").innerHTML = rows.length
    ? rows
        .map(
          (staff) =>
            `<article class="staff-card ${staff.isActive ? "" : "is-passive"}"><header><span class="avatar">${escapeHtml(staff.firstName[0])}${escapeHtml(staff.lastName[0])}</span><span class="status">${staff.isActive ? "Aktif" : "Pasif"}</span></header><h3>${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</h3><a class="staff-phone" href="tel:${escapeHtml(staff.phone.replaceAll(" ", ""))}">${escapeHtml(staff.phone)}</a><div class="crew-line">${staff.specialties.map((specialty) => `<span class="tag">${escapeHtml(SPECIALTIES[specialty])}</span>`).join("")}</div><small>${staff.assignments.length ? `${staff.assignments.length} yaklaşan görev` : "Yaklaşan görevi yok"}</small><footer><button class="mini-button" type="button" data-edit-staff="${staff.id}">Düzenle</button><button class="mini-button" type="button" data-toggle-staff="${staff.id}" data-active="${staff.isActive}">${staff.isActive ? "Pasife al" : "Aktifleştir"}</button></footer></article>`
        )
        .join("")
    : empty("Personel bulunamadı.");
}

async function loadStaff() {
  const response = await apiRequest("/operations/staff");
  state.staff = response.data;
  renderStaff();
}

function openStaffForm(staff = null) {
  staffForm.reset();
  staffForm.elements.staffId.value = staff?.id || "";
  staffForm.elements.firstName.value = staff?.firstName || "";
  staffForm.elements.lastName.value = staff?.lastName || "";
  staffForm.elements.phone.value = staff?.phone || "";
  staffForm.elements.isActive.checked = staff?.isActive ?? true;
  staffForm.querySelectorAll('[name="specialties"]').forEach((input) => {
    input.checked = staff?.specialties.includes(input.value) || false;
  });
  document.querySelector(".js-staff-form-title").textContent = staff
    ? "Personeli düzenle"
    : "Personel ekle";
  staffForm.querySelector(".dialog-message").textContent = "";
  staffDialog.showModal();
}

function renderWeddingDetail(wedding) {
  state.currentWedding = wedding;
  document.querySelector(".js-detail-title").textContent = couple(wedding);
  const startDate = dateKey(wedding.startsAt);
  const endDate = dateKey(wedding.endsAt);
  const availableOptions = wedding.availableStaff
    .map(
      (staff) =>
        `<option value="${staff.id}">${escapeHtml(staff.firstName)} ${escapeHtml(staff.lastName)}</option>`
    )
    .join("");
  detailContainer.innerHTML = `<div class="detail-grid"><section class="detail-card"><p class="section-index">İletişim</p><strong>${escapeHtml(wedding.brideFirstName)}: ${escapeHtml(wedding.bridePhone)}</strong><br><strong>${escapeHtml(wedding.groomFirstName)}: ${escapeHtml(wedding.groomPhone)}</strong></section><section class="detail-card"><p class="section-index">Paket</p><strong>${escapeHtml(wedding.packageSummary?.name || "Paket belirtilmedi")}</strong><p>${escapeHtml(wedding.note || "Operasyon notu yok.")}</p></section><section class="detail-card wide"><p class="section-index">Takvim düzenle</p><form class="form-grid js-schedule-form"><label>Tarih<input name="weddingDate" type="date" value="${startDate}" required></label><label>Başlangıç<input name="startTime" type="time" value="${inputTime(wedding.startsAt)}" required></label><label>Bitiş<input name="endTime" type="time" value="${inputTime(wedding.endsAt)}" required></label><label class="switch-row"><input name="endsNextDay" type="checkbox" ${startDate !== endDate ? "checked" : ""}> Bitiş ertesi gün</label><label class="wide">Operasyon notu<textarea name="note">${escapeHtml(wedding.note || "")}</textarea></label><button class="primary-button wide" type="submit">Takvimi güncelle</button></form></section><section class="detail-card wide"><p class="section-index">Görevli ekip</p><div>${wedding.assignments.length ? wedding.assignments.map((assignment) => `<div class="assignment-row"><span><strong>${escapeHtml(assignment.staff.firstName)} ${escapeHtml(assignment.staff.lastName)}</strong><small>${escapeHtml(SPECIALTIES[assignment.specialty])}</small></span><button class="mini-button" type="button" data-remove-assignment="${assignment.id}">Kaldır</button></div>`).join("") : empty("Henüz personel atanmadı.")}</div><form class="assignment-form js-assignment-form"><select name="staffId" required><option value="">Müsait personel seçin</option>${availableOptions}</select><select name="specialty" required><option value="">Önce personel seçin</option></select><button class="primary-button" type="submit">Ata</button></form><p class="dialog-message" role="status"></p></section></div>`;
}

async function openWedding(weddingId) {
  if (!weddingDialog.open) weddingDialog.showModal();
  detailContainer.innerHTML = empty("Düğün dosyası yükleniyor…");
  try {
    const response = await apiRequest(`/operations/weddings/${weddingId}`);
    renderWeddingDetail(response.data);
  } catch (error) {
    detailContainer.innerHTML = empty(error.message);
  }
}

const loaders = {
  overview: loadDashboard,
  calendar: loadCalendar,
  weddings: loadWeddings,
  staff: loadStaff
};
function activatePanel(name) {
  document
    .querySelectorAll("[data-panel]")
    .forEach((button) => button.classList.toggle("is-active", button.dataset.panel === name));
  document.querySelectorAll("[data-panel-content]").forEach((panel) => {
    const active = panel.dataset.panelContent === name;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelector(".js-page-title").textContent = PANEL_TITLES[name];
  void loaders[name]?.().catch((error) => setMessage(error.message));
}

document.addEventListener("click", (event) => {
  const panel = event.target.closest("[data-panel]");
  const wedding = event.target.closest("[data-open-wedding]");
  if (panel) activatePanel(panel.dataset.panel);
  else if (wedding) void openWedding(wedding.dataset.openWedding);
});
document
  .querySelector("[data-close-dialog]")
  .addEventListener("click", () => weddingDialog.close());
document.querySelector(".js-wedding-search").addEventListener("input", renderWeddings);
document.querySelector(".js-staff-search").addEventListener("input", renderStaff);
document.querySelector(".js-add-staff").addEventListener("click", () => openStaffForm());
document.querySelector(".js-staff").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-staff]");
  const toggle = event.target.closest("[data-toggle-staff]");
  if (edit) openStaffForm(state.staff.find((staff) => staff.id === edit.dataset.editStaff));
  else if (toggle)
    void apiRequest(`/operations/staff/${toggle.dataset.toggleStaff}`, {
      method: "PATCH",
      body: { isActive: toggle.dataset.active !== "true" }
    })
      .then(() => Promise.all([loadStaff(), loadDashboard()]))
      .then(() => setMessage("Personel durumu güncellendi.", true))
      .catch((error) => setMessage(error.message));
});
staffForm
  .querySelectorAll('[value="cancel"]')
  .forEach((button) => button.addEventListener("click", () => staffDialog.close()));
staffForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return;
  const data = new FormData(staffForm);
  const staffId = data.get("staffId");
  try {
    await apiRequest(staffId ? `/operations/staff/${staffId}` : "/operations/staff", {
      method: staffId ? "PATCH" : "POST",
      body: {
        firstName: data.get("firstName"),
        lastName: data.get("lastName"),
        phone: data.get("phone"),
        specialties: data.getAll("specialties"),
        isActive: data.has("isActive")
      }
    });
    staffDialog.close();
    await Promise.all([loadStaff(), loadDashboard()]);
    setMessage(staffId ? "Personel güncellendi." : "Personel eklendi.", true);
  } catch (error) {
    staffForm.querySelector(".dialog-message").textContent = error.message;
  }
});

detailContainer.addEventListener("change", (event) => {
  if (event.target.name !== "staffId") return;
  const staff = state.currentWedding.availableStaff.find((item) => item.id === event.target.value);
  const select = detailContainer.querySelector('[name="specialty"]');
  select.innerHTML = staff
    ? staff.specialties
        .map(
          (specialty) =>
            `<option value="${specialty}">${escapeHtml(SPECIALTIES[specialty])}</option>`
        )
        .join("")
    : '<option value="">Önce personel seçin</option>';
});
detailContainer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  try {
    if (event.target.matches(".js-schedule-form")) {
      await apiRequest(`/operations/weddings/${state.currentWedding.id}`, {
        method: "PATCH",
        body: {
          weddingDate: data.get("weddingDate"),
          startTime: data.get("startTime"),
          endTime: data.get("endTime"),
          endsNextDay: data.has("endsNextDay"),
          note: data.get("note")
        }
      });
      setMessage("Düğün takvimi güncellendi.", true);
    } else if (event.target.matches(".js-assignment-form")) {
      await apiRequest(`/operations/weddings/${state.currentWedding.id}/assignments`, {
        method: "POST",
        body: {
          staffId: data.get("staffId"),
          specialty: data.get("specialty"),
          allowConflict: false
        }
      });
      setMessage("Personel göreve atandı.", true);
    }
    await Promise.all([
      openWedding(state.currentWedding.id),
      loadDashboard(),
      loadWeddings(),
      loadCalendar()
    ]);
  } catch (error) {
    event.target
      .closest(".detail-card")
      .querySelector(".dialog-message")
      ?.replaceChildren(error.message);
    setMessage(error.message);
  }
});
detailContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-assignment]");
  if (!button) return;
  try {
    await apiRequest(
      `/operations/weddings/${state.currentWedding.id}/assignments/${button.dataset.removeAssignment}`,
      { method: "DELETE" }
    );
    await Promise.all([openWedding(state.currentWedding.id), loadDashboard(), loadWeddings()]);
    setMessage("Personel ataması kaldırıldı.", true);
  } catch (error) {
    setMessage(error.message);
  }
});

document
  .querySelectorAll("[data-week-move]")
  .forEach((button) =>
    button.addEventListener(
      "click",
      () => void loadDashboard(addDays(state.weekStart, Number(button.dataset.weekMove)))
    )
  );
document.querySelector("[data-week-today]").addEventListener("click", () => {
  state.weekStart = "";
  void loadDashboard();
});
const moveMonth = (offset) => {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1 + offset, 1));
  return probe.toISOString().slice(0, 7);
};
document
  .querySelectorAll("[data-month-move]")
  .forEach((button) =>
    button.addEventListener(
      "click",
      () => void loadCalendar(moveMonth(Number(button.dataset.monthMove)))
    )
  );
document.querySelector("[data-month-today]").addEventListener("click", () => {
  state.calendarMonth = "";
  void loadCalendar();
});

document.querySelector(".js-specialties").innerHTML = Object.entries(SPECIALTIES)
  .map(
    ([key, label]) =>
      `<label><input type="checkbox" name="specialties" value="${key}"> ${escapeHtml(label)}</label>`
  )
  .join("");
document.querySelector(".js-current-date").textContent =
  `${new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long" }).format(new Date())} · İstanbul`;
document.querySelectorAll(".js-logout").forEach((button) =>
  button.addEventListener("click", async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } finally {
      window.location.replace("login.html");
    }
  })
);

if (await ensureSession()) await loadDashboard().catch((error) => setMessage(error.message));

/* UX & Klavye Kısayolları */
const toggleOpsSidebarBtn = document.querySelector(".js-toggle-ops-sidebar");
const opsSidebar = document.querySelector(".ops-sidebar");
if (toggleOpsSidebarBtn && opsSidebar) {
  toggleOpsSidebarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opsSidebar.classList.toggle("is-open");
  });
  opsSidebar.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      opsSidebar.classList.remove("is-open");
    });
  });
  document.addEventListener("click", (e) => {
    if (
      opsSidebar.classList.contains("is-open") &&
      !opsSidebar.contains(e.target) &&
      !toggleOpsSidebarBtn.contains(e.target)
    ) {
      opsSidebar.classList.remove("is-open");
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    opsSidebar?.classList.remove("is-open");
    detailContainer?.close();
    weddingDialog?.close();
    staffDialog?.close();
  }
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  if (["input", "textarea", "select"].includes(activeTag)) return;

  if (e.key >= "1" && e.key <= "4") {
    const panels = ["overview", "calendar", "weddings", "staff"];
    const targetPanel = panels[parseInt(e.key, 10) - 1];
    if (targetPanel) {
      e.preventDefault();
      activatePanel(targetPanel);
    }
  } else if (e.key === "/") {
    e.preventDefault();
    const searchInput = document.querySelector(".js-wedding-search");
    searchInput?.focus();
  }
});

function updateOpsBadges(metrics) {
  if (!metrics) return;
  const weddingBadge = document.querySelector(".js-badge-ops-weddings");
  if (weddingBadge) {
    if (metrics.unassignedWeddings > 0) {
      weddingBadge.textContent = metrics.unassignedWeddings;
      weddingBadge.hidden = false;
    } else {
      weddingBadge.hidden = true;
    }
  }
}
