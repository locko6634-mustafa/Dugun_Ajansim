# Güvenlik Düzeltme Raporu

**Tarih:** 9 Ağustos 2026  
**Kapsam:** Depodaki frontend, API, kimlik doğrulama, veri koruma, spam önleme, bağımlılıklar ve üretim yapılandırması. Sunucu erişilemediği için canlı TLS, DNS, firewall, çalışan secret'lar, veritabanı durumu ve gerçek yedek çıktıları kapsam dışıdır.

## Sonuç

Bulunan kod ve yapılandırma açıkları kapatıldı. Mevcut statik güvenlik puanı **8,5/10** olarak değerlendirildi. Puanı sınırlayan ana unsurlar canlı ortamın doğrulanamaması, tek fiziksel host bağımlılığı ve şifreli yedeklerin sunucu dışı immutable depoya otomatik kopyalanmamasıdır.

Müşteri verileri uygulama ile veritabanı arasında gerçek anlamda uçtan uca şifreli değildir; API iş mantığı için veriyi çözebilmelidir. Buna karşılık hassas alanlar veritabanında **AES-256-GCM**, alan/kayıt bağlamlı AAD, anahtar halkası ve ayrı blind index anahtarıyla şifrelenir. Parolalar geri döndürülemez **Argon2id** özeti olarak tutulur. Ağ aktarımı üretim yapılandırmasında HTTPS/TLS üzerinden tasarlanmıştır; canlı sertifika doğrulanmamıştır.

## Kapatılan bulgular

| Alan                    | Bulgu ve neden                                                                                              | Uygulanan düzeltme                                                                                                                                                     | Başlıca dosyalar                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimlik doğrulama        | Hatalı MFA denemesi login sayacından düşebiliyor, parola bilinen hesaplarda kaba kuvvet alanı açıyordu.     | Kota yalnız MFA dahil tam başarılı oturumda sıfırlanıyor; regresyon testi eklendi.                                                                                     | `backend/src/routes/auth.routes.ts`, `backend/tests/backend.test.ts`                                                                                              |
| Spam ve kötüye kullanım | Public başvuru yalnız IP kotasına dayanıyor; bot, tekrar ve dağıtık iletişim spam'i yeterince ayrışmıyordu. | Turnstile production'da fail-closed sunucu doğrulaması, zorunlu UUID idempotency, atomik DB rate limit ve iletişim bazlı çapraz-IP kota eklendi.                       | `backend/src/routes/public.routes.ts`, `backend/src/utils/turnstile.ts`, `backend/src/middlewares/databaseRateLimitStore.ts`, `js/package-builder/application.js` |
| Ödeme akışı kabiliyeti  | Bearer ödeme anahtarı JavaScript state/sessionStorage içindeydi; XSS etkisini büyütüyordu.                  | Anahtar HttpOnly, production'da Secure ve SameSite=Strict cookie'ye taşındı; resmi frontend header veya web storage kullanmıyor.                                       | `backend/src/routes/public.routes.ts`, `js/package-builder/application.js`                                                                                        |
| PII koruması            | Production yanlış ayarla plaintext fallback açabilir, bakım süreçleri gereğinden fazla secret alabilirdi.   | Production API strict şifrelemeye zorlandı; süreç rolleri ve secret kapsamları ayrıldı; keyring/backfill/legacy redaksiyon kontrolleri korundu.                        | `backend/src/config/env.config.ts`, `backend/src/utils/pii-crypto.ts`, `backend/src/scripts/maintainPiiEncryption.ts`, `compose.production.yaml`                  |
| Veri minimizasyonu      | Süresi dolmuş başvuru, arşiv ve güvenlik kayıtları otomatik temizlenmiyordu.                                | Sınırlı partiler, transaction ve immutable audit kaydıyla saklama politikası eklendi.                                                                                  | `backend/src/services/data-retention.service.ts`, `backend/src/scripts/maintainDataRetention.ts`, `compose.production.yaml`                                       |
| URL ve içerik yüzeyi    | Yönetilebilir görsel/teslim URL'leri takip pikseli, harici kaynak veya kimlik bilgili URL riski taşıyordu.  | Görseller `assets/images` altındaki güvenli uzantılarla; teslimatlar yalnız HTTPS Google Drive host allowlist'iyle sınırlandı.                                         | `backend/src/schemas/api.schemas.ts`, `backend/src/utils/domain.ts`, `js/shared/asset-url.js`, `js/customer-panel/app.js`                                         |
| Bağımlılık zinciri      | Backend audit'i ve üretim güvenlik sözleşmelerinin regresyon kapsamı eksikti.                               | Frontend/backend audit kapıları, immutable Action SHA denetimi ve güvenlik regresyon testleri eklendi.                                                                 | `.github/workflows/quality.yml`, `tools/dependency-security.test.mjs`, `tools/agent-check.mjs`                                                                    |
| Yedekleme               | Şifreli ve restore-testli yedek yalnız dağıtım sırasında alınıyordu.                                        | Günlük zamanlanmış AES-256-GCM yedek, gerçek geçici veritabanına restore provası, atomik dosya ve ortak operasyon kilidi eklendi.                                      | `.github/workflows/production-backup.yml`, `deploy/deploy-production.sh`, `deploy/backup-crypto.mjs`                                                              |
| Çökme dayanıklılığı     | Healthcheck sağlıksız konteyneri otomatik onarmıyor, dağıtım tek backend örneği çalıştırıyordu.             | 15 dakikalık sınırlı watchdog, en az iki backend replikası ve rollback sırasında replika koruması eklendi. PostgreSQL otomatik restart yerine operatör hatasına düşer. | `.github/workflows/production-watchdog.yml`, `deploy/watchdog.sh`, `deploy/deploy-production.sh`                                                                  |

## Doğrulama

- `npm run test:quick`: geçti.
- Backend güvenlik/birim paketi: **59/59** geçti.
- Son responsive E2E paketi: **30/30** geçti.
- Production hardening ve yeni operasyon güvenlik testleri: geçti.
- Bash sözdizimi ve `git diff --check`: geçti.
- Veritabanı entegrasyon testi çalıştırılamadı; yerel PostgreSQL `localhost:55632` erişilemezdi.

## Canlı ortamda kalan doğrulamalar

1. Turnstile site/secret anahtarları, beklenen hostname ve gerçek token tüketimi doğrulanmalı.
2. TLS sertifika zinciri, HSTS, firewall ve yalnız Traefik'ten gelen `TRUST_PROXY` adresi doğrulanmalı.
3. PII backfill/verify, veri saklama dry-run sonucu ve ilk zamanlanmış restore provası gözlenmeli.
4. Şifreli yedekler ayrı hesap/sağlayıcıdaki immutable sunucu dışı depoya kopyalanmalı.
5. İki backend replikası ve watchdog için kontrollü konteyner düşürme tatbikatı yapılmalı.

Bu maddeler kod bulgusu değil, erişilemeyen canlı altyapı için kabul testleridir.
