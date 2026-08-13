import { STAFF_SPECIALTY_LABELS } from "./domain-labels.js";
import { APP_LOCALE, APP_TIME_ZONE } from "./runtime-config.js";
import { escapeHtml } from "./html.js";

const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "long",
  year: "numeric"
});
const timeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit"
});
const moneyFormatter = new Intl.NumberFormat(APP_LOCALE, {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2
});

function safeValue(value, fallback = "—") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return escapeHtml(normalized || fallback);
}

function fullName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || "Bilgi yok";
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : dateFormatter.format(date);
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : timeFormatter.format(date);
}

function formatMoney(cents) {
  const amount = Number(cents);
  return Number.isFinite(amount) ? moneyFormatter.format(amount / 100) : "—";
}

function renderPerson(title, firstName, lastName, phone) {
  return `<section class="wedding-print-person">
    <h2>${escapeHtml(title)}</h2>
    <dl>
      <div><dt>Ad soyad</dt><dd>${escapeHtml(fullName(firstName, lastName))}</dd></div>
      <div><dt>Telefon</dt><dd>${safeValue(phone)}</dd></div>
    </dl>
  </section>`;
}

function renderServices(packageSummary) {
  const services = Array.isArray(packageSummary?.services) ? packageSummary.services : [];
  return services.length
    ? `<ul>${services.map((service) => `<li>${safeValue(service?.name)}</li>`).join("")}</ul>`
    : '<p class="wedding-print-muted">Ek hizmet kaydı yok.</p>';
}

function renderAssignments(assignments) {
  return assignments.length
    ? `<table>
        <thead><tr><th scope="col">Görev</th><th scope="col">Personel</th></tr></thead>
        <tbody>${assignments
          .map(
            (assignment) =>
              `<tr><td>${safeValue(STAFF_SPECIALTY_LABELS[assignment.specialty] || assignment.specialty)}</td><td>${escapeHtml(fullName(assignment.staff?.firstName, assignment.staff?.lastName))}</td></tr>`
          )
          .join("")}</tbody>
      </table>`
    : '<p class="wedding-print-muted">Henüz personel atanmadı.</p>';
}

function lifecycleStatus(wedding) {
  if (wedding.deletedAt) return "Arşivli";
  if (wedding.cancelledAt) return "İptal edildi";
  return "Planlandı";
}

export function weddingPrintMarkup(wedding, { venueName = "" } = {}) {
  const packageSummary = wedding.packageSummary || {};
  const assignments = Array.isArray(wedding.assignments) ? wedding.assignments : [];
  const resolvedVenueName = venueName || wedding.venue?.name || "Salon bilgisi yok";
  const email = typeof wedding.primaryEmail === "string" ? wedding.primaryEmail.trim() : "";
  const note = typeof wedding.note === "string" ? wedding.note.trim() : "";
  const totalPriceCents = Number(packageSummary.totalPriceCents);
  const hasTotal = Number.isFinite(totalPriceCents);

  return `<div class="wedding-print-page">
    <header class="wedding-print-header">
      <div class="wedding-print-brand"><span>DA</span><div><strong>Düğünajansım</strong><small>Düğün operasyon föyü</small></div></div>
      <div class="wedding-print-heading"><span>${escapeHtml(lifecycleStatus(wedding))}</span><h1>${escapeHtml(fullName(wedding.brideFirstName, wedding.brideLastName))} &amp; ${escapeHtml(fullName(wedding.groomFirstName, wedding.groomLastName))}</h1><p>${escapeHtml(formatDate(wedding.startsAt))}</p></div>
    </header>

    <div class="wedding-print-people">
      ${renderPerson("Gelin bilgileri", wedding.brideFirstName, wedding.brideLastName, wedding.bridePhone)}
      ${renderPerson("Damat bilgileri", wedding.groomFirstName, wedding.groomLastName, wedding.groomPhone)}
    </div>

    <section class="wedding-print-section">
      <h2>Düğün bilgileri</h2>
      <dl class="wedding-print-facts">
        <div><dt>Düğün salonu / mekân</dt><dd>${escapeHtml(resolvedVenueName)}</dd></div>
        <div><dt>Düğün tarihi</dt><dd>${escapeHtml(formatDate(wedding.startsAt))}</dd></div>
        <div><dt>Saat</dt><dd>${escapeHtml(formatTime(wedding.startsAt))} – ${escapeHtml(formatTime(wedding.endsAt))}</dd></div>
        ${email ? `<div><dt>İletişim e-postası</dt><dd>${escapeHtml(email)}</dd></div>` : ""}
      </dl>
    </section>

    <section class="wedding-print-section wedding-print-package">
      <div>
        <h2>Paket bilgisi</h2>
        <strong class="wedding-print-package-name">${safeValue(packageSummary.name, "Paket belirtilmedi")}</strong>
        ${renderServices(packageSummary)}
      </div>
      <dl class="wedding-print-totals">
        <div><dt>Toplam tutar</dt><dd>${hasTotal ? escapeHtml(formatMoney(totalPriceCents)) : "Kayıtlı değil"}</dd></div>
      </dl>
    </section>

    <section class="wedding-print-section wedding-print-note">
      <h2>Operasyon notu</h2>
      <p>${note ? escapeHtml(note) : "Operasyon notu bulunmuyor."}</p>
    </section>

    <section class="wedding-print-section wedding-print-staff">
      <h2>Personel listesi</h2>
      ${renderAssignments(assignments)}
    </section>

    <footer class="wedding-print-footer">
      <span>Yalnızca yetkili operasyon kullanımı içindir.</span>
      <span>Düğünajansım · ${escapeHtml(formatDate(new Date()))}</span>
    </footer>
  </div>`;
}

function reportContainer() {
  let report = document.querySelector(".js-wedding-print-report");
  if (!report) {
    report = document.createElement("section");
    report.className = "wedding-print-report js-wedding-print-report";
    report.setAttribute("aria-hidden", "true");
    document.body.append(report);
  }
  return report;
}

export function printWeddingReport(wedding, options = {}) {
  const report = reportContainer();
  report.innerHTML = weddingPrintMarkup(wedding, options);
  const previousTitle = document.title;
  const date = String(wedding.startsAt || "dugun").slice(0, 10);
  document.title = `dugun-operasyon-foyu-${date}`;
  try {
    window.print();
  } finally {
    document.title = previousTitle;
  }
}
