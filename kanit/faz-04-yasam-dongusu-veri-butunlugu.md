# Faz 04 — Yaşam döngüsü ve veri bütünlüğü kanıtı

**Tarih:** 2026-08-12

**Kapsam:** Yerel uygulama ve sentetik PostgreSQL entegrasyon ortamı

**Canlı etki:** Yok; canlı veriye veya canlı şemaya değişiklik uygulanmadı.

## Uygulanan sözleşmeler

- Başvuru arşiv/restore akışı satır kilidi, `Serializable` transaction ve karşılaştırmalı güncelleme ile yarış koşullarına kapatıldı. Aktif handoff-öncesi ödeme anahtarı arşivde korunuyor; handoff/sona ermiş anahtar temizleniyor. Özel salonlu `venueId=null` kayıt restore edilebiliyor.
- Düğün iptal/geri alma endpointleri neden, yakın tarihli admin MFA step-up ve audit kaydı gerektiriyor. İptal; takvim slotunu serbest bırakıyor, bekleyen mesaj görevleri ve müşteri/teslimat erişimini kapatıyor, personel geçmişini koruyor. Geri alma yeniden uygunluk kontrolü yapıyor ve teslimatı otomatik yayımlamıyor.
- Teslimat durumları backend allowlist'i ile yönetiliyor. Geri geçiş neden ve yetki istiyor; geçersiz sıçrama `409`, URL'siz teslim `409` dönüyor. URL yalnızca HTTPS Google Drive/Docs biçiminde kabul ediliyor ve yayın öncesi sınırlı erişim smoke kontrolünden geçiyor. SLA tarihi düğünden 21 gün sonra.
- Tarih/saat tek backend politikası altında İstanbul saat dilimi, 30 dakikalık adım, `00:00–23:30` aralığı ve gelecekte başlangıç şartıyla doğrulanıyor. Referans kodu İstanbul takvim gününü kullanıyor.
- Başvuru, düğün ve mesaj listeleri imzalı opaque cursor, kararlı ikincil `id` sıralaması, toplam kayıt ve `hasNextPage` sözleşmesine geçirildi. Arşiv/silme filtreleri cursor kapsamına bağlandı.
- Aktif salon personeli telefonu salon bazında unique tutuluyor. Atamalar satır kilidi ve deterministik kilit sırasıyla çakışmaya kapalı; yalnız admin, neden + MFA step-up + audit ile override yapabiliyor. Salon yetkilisi başka salon verisine erişemiyor.

PostgreSQL uygulaması; keyset pagination, bileşik/FK indeksleri, veritabanı constraint'leri, kısa transaction'lar ve deterministik kilit sırası esas alınarak gözden geçirildi.

## Somut kanıtlar

- `npx prisma generate` — geçti.
- `npm run test:targeted -- --test-name-pattern="domain tarih|pagination|delivery-link" tests/mvp.test.ts tests/backend.test.ts` — **3/3 geçti**, skip/todo yok.
- `npm run test:targeted -- --test-name-pattern="başvuru, atomik onay" tests/database.integration.test.ts` — **1/1 geçti**; arşiv/restore, iptal/geri alma, teslimat ve atama yarış/negatif senaryolarını sentetik PostgreSQL üzerinde doğruladı.
- `npx playwright test tests/e2e/smoke.spec.js --project=chromium --grep="tarayıcı saat diliminden"` — **1/1 geçti**; İstanbul dışı tarayıcı saat diliminde minimum tarih ve gecikme hesabını doğruladı.
- `npm run test:quick` — geçti: frontend statik kontroller, admin E2E **4/4**, responsive E2E **34/34**, backend build/typecheck ve hedefli auth **13/13**; fail/skip/todo yok.
- Yeni migration yerel sentetik test veritabanına başarıyla uygulandı; şema toplam **32 migration** ile güncel doğrulandı.

## Değişiklik kanıtları

- Şema/migration: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260812200000_lifecycle_integrity/migration.sql`
- Yaşam döngüsü ve API: `backend/src/routes/admin.routes.ts`, `backend/src/routes/operations.routes.ts`, `backend/src/services/booking.service.ts`
- Ortak politikalar: `backend/src/utils/domain.ts`, `backend/src/utils/pagination.ts`, `backend/src/utils/staff-policy.ts`, `backend/src/utils/delivery-link-access.ts`
- UI: `admin.html`, `operasyon-paneli.html`, `js/admin/app.js`, `js/operations/app.js`, `js/customer-panel/app.js`, `js/package-builder/application.js`
- Otomatik kanıt: `backend/tests/backend.test.ts`, `backend/tests/mvp.test.ts`, `backend/tests/database.integration.test.ts`, `tests/e2e/smoke.spec.js`

## Kalan kontrollü riskler

- Migration canlıya uygulanmadı. Canlı deploy öncesi eski iptal kayıtlarında zorunlu iptal alanları ve salon bazında aktif tekrar telefonlar salt okunur sorgularla kontrol edilmelidir; uygunsuz veri varsa migration güvenli biçimde duracaktır.
- Gerçek Google Drive paylaşım davranışı ile canlı proxy/ağ doğrulaması Faz 13–15 canlı kabul adımlarında ayrıca kanıtlanacaktır.
