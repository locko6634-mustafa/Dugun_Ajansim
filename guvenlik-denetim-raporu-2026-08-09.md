# Düğün Ajansım Güvenlik Raporu — Düzeltme Sonrası

**Tarih:** 9 Ağustos 2026
**Genel güvenlik puanı:** **8,7 / 10 — güçlü uygulama güvenliği, dış altyapı riskleri sürüyor**
**İlk denetim puanı:** 6,2 / 10

## Kapsam

Kimlik ve yetki, spam/DoS, müşteri verisi, frontend, PostgreSQL, container,
yedekleme, dağıtım, CI ve bağımlılıklar altı uzman alt ajanla incelendi ve düzeltildi.
Codex Security **kullanılmadı**. `AGENT.md` ile bu rapor dışında başka Markdown
raporları okunmadı veya referans alınmadı.

Bu sonuç kaynak kodu ve yerel test ortamı içindir; canlı sunucuya penetrasyon testi
yapılmadı. Canlı sistemin bu seviyeye gelmesi için migration, gerçek anahtarlar ve
PII bakım adımlarıyla yeni sürümün dağıtılması gerekir.

## Kısa sonuç

- İlk rapordaki kritik/yüksek uygulama açıkları giderildi; 11 bulgunun 7'si kapandı,
  4'ü önemli ölçüde azaltıldı ancak dış altyapı veya mimari karar gerektiriyor.
- Frontend araç zincirindeki **19 yüksek advisory sıfıra** indirildi. Frontend ve
  backend güncel `npm audit` sonuçları: **0 bulgu**.
- Temel müşteri PII'si artık kod ve şema düzeyinde AES-256-GCM ile korunuyor.
- Spam/brute-force limitleri process-local olmaktan çıkarılıp PostgreSQL üzerinde
  paylaşımlı ve HMAC anahtarlı hale getirildi.
- En büyük kalan risk tek host mimarisi ile aynı hostta tutulan yedeklerdir.

## Müşteri bilgileri şifreleniyor mu?

**Evet, repo düzeyinde; fakat kriptografik uçtan uca şifreleme değildir.** Sunucu iş
kurallarını çalıştırabilmek için veriyi çözer. Tarayıcı–edge trafiği TLS ile korunur;
iç container ağında mTLS yoktur.

| Veri | Koruma | Başlıca dosyalar |
| --- | --- | --- |
| Parolalar | Argon2id, geri döndürülemez özet | `backend/src/utils/crypto.ts` |
| Oturum, CSRF ve tek kullanımlık kurulum tokenları | Yalnız SHA-256 özetleri saklanır | `backend/src/utils/passwordSetup.ts`, `backend/src/routes/auth.routes.ts` |
| Ad, telefon, e-posta, not ve mesaj alıcısı | AES-256-GCM; rastgele IV, auth-tag ve kayıt/model/key-id bağlı AAD | `backend/src/utils/pii-crypto.ts`, `backend/prisma/schema.prisma` |
| PII arama alanları | Ayrı anahtarla HMAC blind index | `backend/src/utils/pii-crypto.ts` |
| Anahtar rotasyonu | Aktif key-id + çoklu anahtar keyring; TOTP de girişte döndürülür | `backend/src/config/env.config.ts`, `backend/src/routes/auth.routes.ts` |
| Eski düz metin kayıtlar | Bounded backfill, redaction ve doğrulama; loglara PII yazılmaz | `backend/src/scripts/maintainPiiEncryption.ts`, `deploy/deploy-production.sh` |
| Veritabanı yedeği | Parçalı AES-256-GCM AEAD, sıra/son-parça doğrulaması ve ayrı yedek anahtarı | `deploy/backup-crypto.mjs`, `deploy/tests/backup-crypto.test.mjs` |

Mevcut production verileri ancak dağıtım betiğindeki `--backfill`,
`--redact-legacy` ve `--verify` adımları başarıyla tamamlanınca bütünüyle bu duruma
gelir. Doğrulama düz metin miras kayıt kalırsa dağıtımı başarısız sayar.

## İlk bulguların durumu

| Bulgu | Durum ve kısa sebep | Başlıca dosyalar |
| --- | --- | --- |
| G-01 Ödeme temizliği/DB rolü | **Kapandı.** Audit kayıtları silinmiyor; PII kontrollü temizleniyor ve runtime rolü gerçek PostgreSQL testiyle doğrulandı. | `backend/src/services/booking.service.ts`, `deploy/postgres/init-runtime-role.sh`, `backend/tests/database.integration.test.ts` |
| G-02 Public istekten sınırsız sweep | **Kapandı.** Önce hedef anahtarı doğrulanıyor; global iş 100 kayıtla sınırlı ve PostgreSQL advisory lock kullanıyor. | `backend/src/services/booking.service.ts`, `backend/src/routes/public.routes.ts` |
| G-03 Düz metin temel PII | **Kapandı (dağıtım gerekli).** Yeni yazımlar şifreli; eski kayıtlar için backfill/redact/verify var. | `backend/src/utils/pii-crypto.ts`, `backend/src/scripts/maintainPiiEncryption.ts`, `backend/prisma/migrations/20260809150000_core_pii_encryption_expand/migration.sql` |
| G-04 Ayrıcalıklı hesap etkisi | **Büyük ölçüde kapandı.** Admin/salon için TOTP MFA, kısa oturum, güçlü parola ve tek kullanımlık kurulum bağlantısı eklendi. İnce taneli admin rol ayrımı hâlâ mimari iyileştirmedir. | `backend/src/routes/auth.routes.ts`, `backend/src/middlewares/auth.middleware.ts`, `backend/src/utils/totp.ts`, `backend/src/utils/passwordSetup.ts` |
| G-05 Tek host/felaket kurtarma | **Kısmi.** Kaynak limitleri, şifreli yedek, restore testi, image provenance ve rollback eklendi; çoklu host ve uzak immutable yedek yok. | `compose.production.yaml`, `deploy/deploy-production.sh`, `.github/workflows/deploy.yml` |
| G-06 Spam/brute-force | **Büyük ölçüde kapandı.** IP + hesap HMAC bucket'ları PostgreSQL'de paylaşılır ve production DB hatasında fail-closed çalışır. Harici bot doğrulaması yok. | `backend/src/middlewares/databaseRateLimitStore.ts`, `backend/src/middlewares/rateLimit.middleware.ts`, `backend/prisma/migrations/20260809152000_distributed_rate_limits/migration.sql` |
| G-07 Timeout/iş yükü sınırı | **Kapandı.** Node HTTP ve PostgreSQL timeout'ları, container limitleri ve O(n log n) çakışma hesabı eklendi. | `backend/src/bootstrap.ts`, `deploy/postgres/configure-runtime-timeouts.sh`, `backend/src/utils/intervalConflicts.ts`, `compose.production.yaml` |
| G-08 Frontend PII/yetenek sırrı | **Kapandı.** WhatsApp URL'sinden PII çıkarıldı, kod panoya kopyalanıyor, handoff sonrası oturum sırrı siliniyor; RNG fail-closed CSPRNG oldu. | `js/package-builder/application.js`, `js/shared/api-client.js`, `paketini-olustur.html` |
| G-09 Anahtar rotasyonu/veri yaşam döngüsü | **Büyük ölçüde kapandı.** Keyring, key-id, yeniden şifreleme ve miras veri redaksiyonu var; hukuki saklama süreleri kurumsal karar bekliyor. | `backend/src/config/env.config.ts`, `backend/src/scripts/maintainPiiEncryption.ts`, `backend/prisma/schema.prisma` |
| G-10 Bağımlılık/CI zinciri | **Kapandı.** 19 yüksek advisory giderildi; CI audit kapısı, SHA-pinned actions, salt-okunur izin ve `.env*` deny-by-default eklendi. | `package-lock.json`, `tools/dependency-security.test.mjs`, `.github/workflows/quality.yml`, `.gitignore` |
| G-11 Savunma derinliği/test matrisi | **Kısmi.** En az yetkili runtime rolü ve production sözleşme testleri güçlendi; gerçek DB RLS ve düzenli chaos/soak testi yok. | `deploy/postgres/init-runtime-role.sh`, `tests/e2e/production-hardening.spec.js`, `backend/tests/database.integration.test.ts` |

## Kalan riskler

1. **Yüksek — Tek host ve aynı-host yedek:** Host/disk kaybı tam kesintiye yol
   açabilir. Çoklu host otomatik failover, immutable uzak object storage, ayrı KMS/key
   escrow ve PITR gerekir. Restore testi halen aynı PostgreSQL cluster'ında geçici DB
   kullanır. Dosyalar: `compose.production.yaml`, `deploy/deploy-production.sh`.
2. **Orta — Gelişmiş bot doğrulaması yok:** Paylaşımlı limitler güçlüdür fakat dağıtık
   botlar formu doldurabilir. Risk bazlı Turnstile/CAPTCHA ve iletişim sahipliği
   doğrulaması gerekir. Dosyalar: `backend/src/routes/public.routes.ts`,
   `backend/src/middlewares/databaseRateLimitStore.ts`.
3. **Orta — Veritabanı RLS yok:** Runtime rolü daraltıldı, ancak tenant ayrımı hâlâ
   uygulama sorgularına dayanıyor. Gerçek RLS için istek kimliğinin transaction'a güvenli
   aktarılacağı yeni DB erişim mimarisi gerekir. Dosyalar: `backend/prisma/schema.prisma`,
   `deploy/postgres/init-runtime-role.sh`.
4. **Orta/Düşük — İç ağ ve tarayıcı sırrı:** Containerlar izole ağdadır ama mTLS yoktur;
   ödeme yetenek anahtarı WhatsApp handoff'a kadar `sessionStorage` içindedir. Dosyalar:
   `compose.production.yaml`, `js/package-builder/application.js`.
5. **Orta/Düşük — Saklama politikası:** Eski düz metin redaksiyonu ve süresi dolan ödeme
   PII temizliği otomatik; diğer ticari kayıtların hukuki saklama/silme süreleri henüz
   kodlanmadı. Dosyalar: `backend/src/scripts/maintainPiiEncryption.ts`,
   `backend/src/services/booking.service.ts`.

## Dayanıklılık katmanları

- Edge + uygulama + PostgreSQL tabanlı rate limit; IP ve hesap anahtarları HMAC'li.
- Helmet/CSP/CORS/HPP, 10 KB body sınırı, Zod allowlist, CSRF ve rol/tenant kontrolleri.
- TOTP MFA, mutlak/idle oturum sınırı, replay koruması ve çevrimdışı denetimli MFA kurtarma.
- HTTP header/request/keep-alive timeout; DB statement/lock/idle timeout.
- Non-root, read-only container, capability düşürme, PID/CPU/RAM sınırı ve log rotasyonu.
- Şifreli yedek, restore doğrulaması, temiz Git/SHA provenance kontrolü ve rollback koruması.

## Puanlama

| Alan | Puan |
| --- | ---: |
| Kimlik, oturum ve yetki | 9,0 / 10 |
| API ve iş kuralı bütünlüğü | 9,1 / 10 |
| Frontend güvenliği | 8,7 / 10 |
| Spam/bot koruması | 8,2 / 10 |
| Çökme/DoS dayanıklılığı | 8,4 / 10 |
| Veri, kriptografi ve gizlilik | 8,9 / 10 |
| Üretim altyapısı ve felaket kurtarma | 7,5 / 10 |
| Bağımlılık, CI ve test güvencesi | 9,4 / 10 |

Genel puanı 9'un altında tutan ana nedenler tek-host mimarisi, uzak immutable yedek
eksikliği, harici bot doğrulaması ve DB RLS olmamasıdır.

## Doğrulama

- Kök `npm run test:quick`: geçti.
- Backend quick testleri: **53/53** geçti.
- Temiz PostgreSQL şemasında tüm 20 migration ve entegrasyon testleri: **6/6** geçti.
- Chromium smoke: **32/32**; tek kullanımlık kurulum bağlantısı: **1/1** geçti.
- Backup kriptografi: **6/6**; production-hardening sözleşmesi: **1/1** geçti.
- Frontend ve backend `npm audit`: **0 bulgu**.
- Production compose doğrulaması, Bash sözdizimi, format, typecheck ve build: geçti.
- Testlerde `skip`, `only` veya `todo` bırakılmadı.

Başarılı testler kusursuz güvenlik garantisi değildir; özellikle kalan beş madde canlı
altyapı, operasyon ve ürün politikası düzeyinde ayrıca tamamlanmalıdır.
