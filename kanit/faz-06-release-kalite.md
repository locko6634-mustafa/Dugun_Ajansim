# Faz 06 — Full-stack, CI ve release kalite kanıtı

**Tarih:** 2026-08-13
**Kapsam:** İzole yerel production-benzeri yığın; canlı sistem ve gerçek müşteri verisi kullanılmadı.
**Release tabanı:** Koşum manifestindeki Git SHA; SHA değişince kapı yeniden çalıştırılır.

## Geçen otomatik kapılar

- `backend npm test`: **85/85 geçti**, fail/cancelled/skip/todo yok. Normal komut `abuse-security.test.ts` içindeki 6 testi gerçekten çalıştırdı.
- Backend kapsamı: `turnstile.ts` ve `delivery-link-access.ts` için **%100 line / %100 branch / %100 function**; zorunlu eşik %90 / %80 / %90.
- Frontend kapsamı: dört kritik ortak modülde **%100 line / %88.46 branch / %100 function**; zorunlu eşik %90 / %80 / %90.
- `tools/run-phase06-quality.ps1 -SkipBuild -SkipChannels`: **7/7 geçti**.
  - Desktop Chromium browser + axe moderate/serious/critical kapısı
  - Gerçek production imajı, Nginx, migration ve least-privilege runtime sözleşmesi
  - Rol/route, CSRF, CORS ve admin step-up negatif matrisi
  - Mock kullanılmayan telefon + WhatsApp altın yolu
  - WebKit/Safari sözleşmesi
  - Firefox sözleşmesi
  - Pixel 7 mobil Chromium emülasyonu
- Kararlı Chrome kanal smoke: **1/1 geçti**.
- `npm run test:quick`: **geçti**; statik/güvenlik kontrolleri, admin E2E **4/4**, responsive E2E **36/36**, backend build/typecheck ve hedefli auth backend testleri **13/13** tamamlandı; skip/todo yok.
- Her full-stack koşum sonunda Compose container ve volume kalıntısı: **0**.

## Altın yol kapsamı

`tests/phase06/fullstack-golden.spec.js` gerçek API ve PostgreSQL üzerinde şunları tekil sentetik kimliklerle doğrular: katalog/paket, nakit başvuru, WhatsApp handoff, admin kuyruğu ve onay, düğün/teslimat/mesaj görevleri, aktivasyon linki hazırlama-doğrulama-gönderildi durumu, gerçek tokenla parola, müşteri cookie login ve izolasyonu, salon personeli CRUD ve atama, teslimat state machine, güvenli Google URL açma/geri çekme, iptal/arşiv davranışı ve güvenli cleanup. Testte `page.route(...).fulfill(...)` yoktur.

`tests/phase06/browser-gate.js` beklenmeyen `console.error`, `pageerror`, `requestfailed`, 4xx/5xx ve izin dışı pending istekleri fail eder. Yalnız beklenen 401 oturum bootstrap sonucu ve Turnstile’ın belgeli uzun bağlantı hostu senaryo allowlist’indedir. Request ID artefaktı karakter allowlist’iyle maskesiz PII taşımayacak biçimde sınırlandırılır.

## CI ve artefakt

- `.github/workflows/quality.yml` mevcut kalite + backend integration işleri sonrasında izole Faz 06 kapısını çalıştırır.
- Başarısızlıkta trace, screenshot, video, maskelenmiş/minimal HAR, son 120 satır maskelenmiş container logu ve Compose durum kaydı `test-results/phase06` altından yüklenir.
- `playwright.config.js` yanlış mevcut sunucuya bağlanmamak için `reuseExistingServer: false`; sabit beklemeler koşul tabanlı hale getirildi; retry `0` olduğundan flaky sonuç gizlenmez.

## Kaynak madde → test eşlemesi

| Kaynak kapsamı | Otomatik kanıt |
| --- | --- |
| P0-12 production-benzeri zincir | `production imajı, Nginx, migration ve least-privilege runtime sözleşmesi` |
| P0-12 mock’suz gerçek altın yol | `mocksuz telefon ve WhatsApp altın yolu` |
| Abuse 6 senaryo | `backend/tests/abuse-security.test.ts`, normal `npm test` |
| Rol ve route izolasyonu | `rol, route, CSRF, CORS ve step-up negatif matrisi` |
| Global tarayıcı hataları | `browser sözleşmesi ve moderate+ erişilebilirlik kapısı` + `browser-gate.js` |
| Aktivasyon/müşteri/teslimat | mock’suz altın yol içindeki admin → müşteri → teslimat zinciri |
| Salon personel ve atama | mock’suz altın yol içindeki personel ekle/düzenle/ata/çıkar |
| Cleanup/kalıntı | test içi residual sayaçları + Compose container/volume doğrulaması |

## Açık dış/manüel kanıtlar

- **Edge:** Chrome smoke geçti. Edge makinede kurulu değil; Playwright kurucusu yetersiz ayrıcalık, `winget --scope user` ise uygulanabilir kurucu yok hatası verdi. Edge kurulup `npm run test:phase06:channels -- --project=stable-edge` production-benzeri yığın açıkken geçmelidir.
- **Gerçek Android Chrome:** Fiziksel cihaz veya güvenilir cihaz laboratuvarı gerekir; emülasyon kanıt yerine geçmez.
- **Gerçek iPhone Safari:** Fiziksel iPhone/Safari veya güvenilir cihaz laboratuvarı gerekir; WebKit masaüstü motor kanıtı gerçek cihaz kanıtı değildir.
- **Eski DB monoliti:** Faz 06 release kritik akışları bağımsız browser/full-stack senaryolarına ayrıldı; ancak `backend/tests/database.integration.test.ts` fiziksel olarak hâlâ büyük tek dosyadır.
- **Production clone migration provası:** İzole sıfırdan production-benzeri migration geçti; gerçek production klonu üzerinde prova canlı/veri erişimi ve ayrıca kullanıcı onayı gerektirir.

Bu açık maddeler kapanmadan Faz 06 çıkış kapısı tamamlanmış sayılmaz.
