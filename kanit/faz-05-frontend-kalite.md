# Faz 05 — Frontend kalite kanıtı

**Tarih:** 2026-08-13

**Kapsam:** Yerel admin, salon operasyon, public, giriş ve paket oluşturucu arayüzleri

**Canlı etki:** Yok; canlı sisteme deploy veya canlı veri değişikliği yapılmadı.

## Uygulanan sözleşmeler

- Admin günlük kart/metrik/badge verisi tek aktif kayıt kümesine bağlandı; H1 ve `aria-current` aktif panelle eşleşiyor. Health göstergesi gerçek `/health` sonucunu, son veri alanı son başarılı API zamanını gösteriyor.
- Admin ve salon takvimleri yükleme/hata sırasında kilitli ve geçersiz dönem hesabına kapalı. Form/API hataları ilgili modal veya alan içinde live region ve `aria-describedby` ile görünür.
- Constraint verisi gelmeden bağımlı admin formları fail-closed kalıyor. Başvuru, personel, atama, katalog ve teslimat mutasyonlarında yinelenen gönderimi önleyen in-flight kilidi bulunuyor.
- Operasyon cache'i oturumdaki `venueId` ile bağlandı; başka salon kimlikli yanıt gösterilmeden temizleniyor. Başarılı mutasyon yalnız açık ayrıntıyı ve ilgili aktif paneli yeniliyor.
- Public retry davranışı ve paket oluşturucu başarı akışı korunurken hizmet erişilebilir adları, gerçek telefon/WhatsApp aksiyonları, WhatsApp parola desteği, login sınırları, başlık hiyerarşisi, lightbox ve video/ses klavye davranışı tamamlandı.
- Admin/salon drawer ve dialogları `aria-expanded`, `aria-controls`, inert arka içerik, Escape, focus trap ve focus dönüşü sözleşmesine geçirildi.

## Somut doğrulamalar

- Dar Chromium regresyon koşusu — admin, salon, public/login ve ortak dialog kapsamındaki **8 senaryonun tamamı geçti** (ilk koşudaki seçici hatası daraltıldı; admin senaryosu yeniden geçti).
- `tests/e2e/admin-responsive.spec.js` Chromium + mobile Chromium — **2/2 geçti**.
- `npm run test:quick` — **geçti**: format, JS/CSS lint, HTML ve güvenlik sözleşmeleri; admin ve responsive Playwright kapıları; backend build/typecheck; **77/77** hedefli backend testi. Fail/skip/todo yok.
- `npm --prefix backend run build` — geçti.
- `git diff --check` — geçti.

## Değişiklik kanıtları

- Admin: `admin.html`, `css/admin/admin.css`, `js/admin/app.js`
- Salon: `operasyon-paneli.html`, `css/operations/operations.css`, `js/operations/app.js`, `backend/src/routes/operations.routes.ts`
- Public/giriş/builder: `index.html`, `login.html`, `paketini-olustur.html`, `css/home/*`, `css/package-builder/package-builder.css`, `js/home/services.js`, `js/login/login.js`, `js/package-builder/application.js`
- Ortak erişilebilir dialog: `js/shared/custom-dialogs.js`
- Regresyon: `tests/e2e/smoke.spec.js`, `tests/e2e/admin-responsive.spec.js`

## İletişim kapsam kararı

- Yayında ve depoda doğrulanmış işletme e-postası bulunamadı. Telefon ve WhatsApp hedefleri `+90 538 688 83 06` ile işlevsel; e-posta uydurulmadı ve kişisel Git kimliği kullanılmadı.
- Kullanıcı 2026-08-13 tarihinde telefon + WhatsApp kanallarını yeterli kabul etti ve e-postayı bilinçli biçimde kapsam dışında bıraktı. Faz 05 çıkış kapısı bu onayla kapandı.
