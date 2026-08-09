# Düğün Ajansım Güvenlik Analizi

**Tarih:** 9 Ağustos 2026

**Genel statik güvenlik puanı:** **7/10**
**Risk özeti:** Kritik 0 · Yüksek 4 · Orta 7

## Kapsam ve yöntem

Projenin frontend, backend, veritabanı şeması/migrationları, kimlik doğrulama, spam/DoS korumaları, Docker/dağıtım yapısı, yedekleme, CI ve güvenlik testleri altı paralel statik incelemeyle tarandı. Codex Security kullanılmadı ve `AGENT.md` dışında mevcut Markdown raporları okunmadı. Canlı sunucu erişilemediği için TLS'in gerçek davranışı, firewall, çalışan containerlar, disk şifreleme, gerçek sırlar, canlı veritabanı içeriği, harici Traefik politikası ve geri yükleme operasyonu doğrulanmadı.

## Öncelikli bulgular

| Seviye | Bulgu, sebep ve kısa etki | İlgili dosyalar |
|---|---|---|
| **Yüksek** | **Hatalı MFA denemeleri dağıtık giriş kotalarından düşülüyor.** Parola doğrulanınca istek, TOTP yanlış olsa ve 401 dönse bile limiter açısından başarılı kabul ediliyor. Parolayı bilen saldırgan hesap bazlı 20 deneme sınırını aşarak dağıtık TOTP brute-force yapabilir. | `backend/src/routes/auth.routes.ts:73-96,188-207`; `backend/src/middlewares/security.middleware.ts:83-95` |
| **Yüksek** | **Backend, frontend ve PostgreSQL tek hata noktası.** Tek örnek ve tek host/volume kullanılıyor; otomatik replika veya failover yok. Süreç çökmesi restart ile toparlanabilir, fakat host ya da DB kaybı tam kesinti üretir. | `compose.production.yaml:10,295-309,384,430-436` |
| **Yüksek** | **Yedekler aynı hostta ve yalnız dağıtım öncesi alınıyor.** Periyodik/PITR ve uzak/off-site kopya görünmüyor; disk, host veya fidye yazılımı kaybı ana veriyle yedeği birlikte etkileyebilir. Yedek dosyasının kendisi AES-256-GCM ile güçlü biçimde şifreleniyor. | `deploy/deploy-production.sh:349-358,376-457`; `compose.production.yaml:430-431`; `deploy/backup-crypto.mjs:69-219` |
| **Yüksek** | **Backend bağımlılıkları CI audit kapısında değil.** Kök `npm audit` yalnız frontend lock dosyasını tarıyor; internet-facing backend için CI veya `backend/package.json` audit komutu yok. Bugünkü manuel çevrimiçi audit temiz olsa da gelecek advisory'ler backend CI'ını durdurmaz. | `package.json:31`; `.github/workflows/quality.yml:19-22,65-68`; `backend/package.json:11-30`; `tools/dependency-security.test.mjs:11-49` |
| **Orta** | **Anonim başvuruda bot/insan doğrulaması yok; idempotency anahtarı opsiyonel.** IP başına 10/15 dakika sınırı tek IP spamini azaltıyor, ancak botnet/proxy havuzu ayrı başvuru, audit ve PII kaydı oluşturabilir. | `backend/src/routes/public.routes.ts:29-37,171-192`; `backend/prisma/schema.prisma:239-243` |
| **Orta** | **Rate-limit dayanıklılığı kısmi.** Kritik auth/başvuru sayaçları her denemede ana PostgreSQL'e yazar; saldırı iş sorgularıyla aynı DB kaynağını tüketebilir. Global ve uygunluk limitleri ise process belleğinde olduğundan restart/yatay ölçeklemede paylaşılmaz. | `backend/src/middlewares/databaseRateLimitStore.ts:29-51`; `backend/src/middlewares/security.middleware.ts:83-95`; `backend/src/routes/public.routes.ts:39-46` |
| **Orta** | **PII şifrelemesi güçlü ama tam ve uçtan uca değil.** Ad, telefon, e-posta, not ve ret gerekçesi AES-256-GCM ile şifreleniyor; düğün zamanı, salon, paket/fiyat, ödeme yöntemi ve durum zamanları açık sütunlarda. Backend veriyi çözebildiği için sistem kriptografik E2EE değildir. | `backend/src/utils/pii-crypto.ts:55-70,99-200,227-367`; `backend/prisma/schema.prisma:239-283,322-351` |
| **Orta** | **Eski plaintext PII'nin kalmadığı zorunlu değil.** Production varsayılanı `encrypted`, `strict` zorunlu değil; okuma katmanı strict dışında legacy alanlara dönebiliyor ve genişletme constraintleri `NOT VALID`. Yeni yazımlar şifreli olsa da geçmiş kayıtlar bakım/backfill tamamlanmadan açık kalabilir. | `backend/src/config/env.config.ts:225,294-297`; `backend/src/utils/pii-crypto.ts:258-281,310-373`; `backend/prisma/migrations/20260809150000_core_pii_encryption_expand/migration.sql:51-135` |
| **Orta** | **Anahtarlar ve tenant sınırı aynı uygulama güven alanına bağlı.** PII anahtarları container environment'ında; KMS/HSM/Docker Secrets yok. Runtime DB rolü tüm tablolarda `SELECT` sahibi ve RLS bulunmuyor; veri izolasyonu doğru route filtrelerine dayanıyor. Uygulama veya Docker yetkisi ele geçirilirse ikinci bariyer zayıf. | `compose.production.yaml:317-333`; `backend/src/config/env.config.ts:196-225,384-442`; `deploy/postgres/init-runtime-role.sh:103-109`; `backend/src/routes/customer.routes.ts:17,33-60`; `backend/src/routes/operations.routes.ts:43,176-227` |
| **Orta** | **Hesap kurtarma ve müşteri hesabı sertleştirmesi geliştirilmeli.** Parola kurulum/sıfırlama bağlantısının varsayılan ömrü 72 saat; müşteri rolü MFA kaydı yaptıramıyor. Tokenlar güçlü, hashli ve tek kullanımlı olsa da sızan bağlantı uzun süre geçerli kalır. | `backend/src/config/env.config.ts:246-250`; `backend/src/utils/passwordSetup.ts:22-35`; `backend/src/routes/auth.routes.ts:355-369,635-636,734-735` |
| **Orta** | **Frontend capability anahtarı JavaScript tarafından okunabilir.** Ödeme akışı kimliği ve anahtarı `sessionStorage` içinde tutuluyor; aynı origin'de oluşacak bir XSS veya kötü niyetli uzantı başvuru akışını okuyup değiştirebilir. Anahtar sekmeyle sınırlı ve akış bitince temizleniyor. | `js/package-builder/application.js:73-87,729-737,1609-1659` |

## Müşteri verileri şifreleniyor mu?

**Kısmen ve güçlü şekilde şifreleniyor; fakat tamamı ve uçtan uca değil.** Yeni temel müşteri PII kayıtları AES-256-GCM, rastgele IV, authentication tag, kayıt/model/sürüm bağlı AAD ve alan bazlı HMAC blind index kullanıyor. Parolalar Argon2id ile hashleniyor; oturum, CSRF, ödeme akışı ve parola kurulum tokenları veritabanında hash olarak tutuluyor. Teslimat Drive URL'si de AES-GCM ile şifreli. Buna karşı iş/etkinlik metadatası açık, eski plaintext kayıt ihtimali tamamen kapatılmamış ve anahtar backend'de bulunduğu için “sunucunun dahi okuyamadığı” E2EE yoktur.

## Güçlü mevcut katmanlar

- Backend seviyesinde rol/tenant filtreleri, zorunlu parola değişimi, ayrıcalıklı rollerde production MFA, CSRF ve `HttpOnly`/`Secure`/`SameSite=Lax` oturum çerezi.
- Zod strict doğrulama, HPP, 10 KB body sınırı, CORS allowlist, Helmet/CSP, clickjacking ve MIME-sniffing başlıkları.
- Edge rate-limit ve 50 in-flight sınırı; Node request/header/keep-alive timeoutları ve socket başına 1.000 istek sınırı.
- Root olmayan, read-only, capability'siz containerlar; CPU/RAM/PID limitleri, log rotasyonu ve graceful shutdown.
- Runtime DB rolünde superuser/DDL/BYPASSRLS yok; audit log güncelleme/silme yetkisi kaldırılmış ve sorgu/lock/idle timeoutları tanımlı.
- İki lock dosyasında yapılan çevrimiçi `npm audit` sonucu **0 bilinen açık**; backend sunucu gerektirmeyen güvenlik testlerinde **53/53 test geçti**.

## Öncelik sırası

1. MFA limiter mantığını düzeltip art arda yanlış TOTP için 429 regresyon testi ekle.
2. Uzak/periyodik şifreli yedek, PITR ve geri yükleme tatbikatı; ardından ikinci DB/backend örneği ve failover kur.
3. Backend `npm audit` kapısını CI'a ekle; production-hardening kontrollerini gerçek compose/header/trafik testleriyle güçlendir.
4. Public forma bot challenge ve zorunlu idempotency/iletişim doğrulaması ekle; limiter altyapısını iş DB'sinden ayır.
5. PII backfill'i doğrula, production'ı `strict` moda geçir, secret manager/KMS kullan ve veri saklama süreleri tanımla.

## Sonuç

Proje, sıradan web uygulamalarının üzerinde bir güvenlik temeline sahip: güçlü at-rest şifreleme, sağlam oturum/CSRF/rol kontrolleri, girdi sınırları ve sertleştirilmiş container yapısı mevcut. Puanı düşüren ana konular MFA kota hatası, dağıtık spam karşısında yalnız IP tabanlı koruma, backend audit boşluğu ve tek-host/tek-DB kurtarma mimarisidir. Bu dört alan giderildiğinde statik güvenlik seviyesi belirgin biçimde yükselecektir.
