# Güvenlik İnceleme Raporu

**Tarih:** 11 Ağustos 2026

**Kapsam:** Uygulama kaynak kodu, üretim yapılandırması, güvenlik testleri ve mevcut geliştirme sunucusunun salt-okunur incelemesi.

**Puanlama:** 10 en güvenli durumdur. Puanlar mevcut kanıta ve üretim ayarlarının doğru uygulanacağı varsayımına dayanır.

## Kısa sonuç

- **Uygulama/kod tasarımı:** **8,0/10** — Güçlü kimlik doğrulama, yetkilendirme, şifreleme ve giriş doğrulaması var; veri kapsamı, anahtar yönetimi ve dağıtım imajlarında açıklar bulunuyor.
- **Müşteri hesabı:** **8,0/10** — Güçlü parola, oturum ve isteğe bağlı MFA var; kayıp MFA cihazı için güvenli kurtarma akışı eksik.
- **Admin hesabı:** **8,5/10** — Üretimde MFA zorunlu, oturum kısa ve tüm admin API'leri rol kontrolünde.
- **Mevcut geliştirme sunucusu:** **7,3/10** — Host ve konteyner temeli iyi; ancak uygulama, PostgreSQL ve Redis henüz kurulu değil.
- **Canlıya geçiş hazırlığı:** **6,8/10** — Aşağıdaki P0/P1 maddeleri kapanmadan üretime hazır kabul edilmemeli.

**Admin girişi olmadan uzaktan admin işlemi yapılabildiğine dair bir yol bulunmadı.** Admin yönlendiricisi oturum, parola/MFA durumu ve `ADMIN` rolünü zorunlu tutuyor; yazma işlemlerinde CSRF kontrolü de var. Sunucuda çalıştırılabilen kurtarma betikleri ise host/DB operatör yetkisi ister ve HTTP admin bypass'ı değildir.

## Kategori puanları

| Kategori | Puan | Kısa değerlendirme |
|---|---:|---|
| Müşteri hesap güvenliği | 8,0/10 | Güçlü parola, tek kullanımlık kurulum bağlantısı, hashli oturum ve oturum yenileme var; müşteri MFA kurtarması eksik. |
| Admin hesap güvenliği | 8,5/10 | Üretimde zorunlu TOTP MFA, 30 dk boşta/8 saat mutlak oturum ve dağıtık giriş limiti güçlü. Kritik işlemlerde tekrar parola/MFA doğrulaması yok. |
| Admin RBAC / yetki atlama direnci | 9,0/10 | Tüm admin API'leri merkezi auth ve rol zincirinin arkasında; doğrulanmış bypass bulunmadı. |
| Parola, token ve oturum kriptografisi | 8,5/10 | Parolalar Argon2id; session, CSRF ve kurulum tokenları 256-bit rastgele üretilip yalnız hash olarak saklanıyor. |
| Müşteri PII şifrelemesi | 7,5/10 | Temel ad, telefon, e-posta ve notlar AES-256-GCM ile korunuyor; şema hâlâ eski düz kolonlara izin veriyor. |
| Personel ve ikincil veri koruması | 4,5/10 | Personel ad/soyad/telefonu ile bazı özel salon ve operasyon verileri düz metin. |
| Oturum, cookie, CSRF ve CORS | 9,0/10 | Üretimde `HttpOnly`, `Secure`, `SameSite`; bağlı CSRF tokenı ve kesin origin allowlist var. |
| Veritabanı RLS / tenant izolasyonu | 8,0/10 | NOBYPASSRLS runtime rolü ve kapsamlı politikalar güçlü; korumalı isteğin ilk auth sorgusunda bağlam hatası riski var. |
| Girdi doğrulama / injection / XSS / SSRF | 9,0/10 | Katı Zod şemaları, parametreli sorgular, CSP ve URL allowlist mevcut; doğrulanmış SQL/command injection, SSRF veya upload açığı yok. |
| Bot, spam ve brute-force koruması | 7,0/10 | Turnstile ve kalıcı IP/iletişim/hesap limitleri güçlü; iletişim sahipliği doğrulaması yok ve global limit process-local. |
| Audit, log ve izleme | 7,5/10 | Hassas değerler üretim loglarından ayıklanıyor ve audit kayıtları güçlü; merkezi alarm/SIEM ve metadata allowlist kanıtı yok. |
| Yedekleme ve kurtarma | 7,5/10 | Yedekler AES-256-GCM ile doğrulamalı şifreleniyor ve restore testi var; off-site/immutable saklama ve anahtar rotasyonu eksik. |
| Node bağımlılıkları | 9,0/10 | Kök ve backend `npm audit` sonuçları 0 bilinen açık; otomatik güncelleme/SBOM/attestation yok. |
| Konteyner imaj güvenliği | 5,0/10 | Güncel taramada Node imajında 3 kritik/9 yüksek, PostgreSQL'de 1 kritik/16 yüksek, Traefik'te 4 yüksek bulgu görüldü. |
| Konteyner, ağ ve CI/CD sertleştirmesi | 8,5/10 | Non-root, salt-okunur FS, capability azaltımı, iç DB ağı, digest/SHA sabitleme ve dar CI izinleri güçlü. |
| Mevcut sunucu | 7,3/10 | Yama, UFW, SSH ve izolasyon iyi; disk şifreleme kanıtı, uygulama WAF/rate-limit ve uygulama yedeği henüz yok. |

## Hangi veri nasıl korunuyor?

| Veri | Yöntem | Puan | Not |
|---|---|---:|---|
| Müşteri adları, telefonları, e-posta, not ve ret nedeni | AES-256-GCM + rastgele IV + AAD + PII keyring | 7,5/10 | DB kopyası sızıntısına karşı güçlü; uygulama hostu ele geçirilirse anahtarlar da erişilebilir. |
| Parolalar | Argon2id hash | 8,5/10 | Geri çözülemez; güçlü parola politikası uygulanıyor. |
| Session, CSRF, parola-kurulum ve ödeme-akış tokenları | 256-bit rastgele token + SHA-256 hash | 9,0/10 | Veritabanında ham token tutulmuyor. |
| Arama indeksleri | Ayrı anahtarlı HMAC-SHA256 blind index | 7,0/10 | Düz e-posta/telefon gerektirmiyor; bağımsız anahtar rotasyonu tamamlanmamış. |
| TOTP sırrı, mesaj telefonu ve Drive teslim URL'si | AES-256-GCM | 7,0/10 | TOTP/PII rotasyonu var; Drive URL'sinde `keyId` ve güvenli rotasyon yolu yok. |
| Şifreli veritabanı yedekleri | Streaming AES-256-GCM + bütünlük doğrulaması | 7,5/10 | Kripto güçlü; anahtar ve yedek aynı host güven sınırında kalabiliyor. |
| Personel adı, soyadı ve telefonu | Düz metin | 3,0/10 | Öncelikli olarak PII zarfına alınmalı. |
| Özel salon adı ve etkinlik/ödeme operasyon metadatası | Düz metin | 5,0/10 | Kart/PAN/CVV saklanmıyor; fakat özel salon adı kişisel bilgi içerebilir. |
| PII tabanlı idempotency fingerprint | Anahtarsız SHA-256 | 4,5/10 | Geri çözülemez; tahmin/linkleme oracle'ı olmaması için HMAC veya PII'siz tasarım gerekir. |

## Öncelikli bulgular

1. **P0 — RLS oturum doğrulama yolunu düzelt ve gerçek runtime rolüyle test et.** `/admin`, `/customer` ve `/operations` istekleri, oturum okunmadan önce `public` DB bağlamına girebiliyor. RLS enforcement açıkken geçerli oturumlar 401 alabilir. Bu yetki yükseltme değil, fail-closed erişilebilirlik ve canlıya hazırlık sorunudur.
2. **P0 — Üretim imajlarını güncelle.** Kritik/yüksek CVE içeren sabit Node, PostgreSQL ve Traefik digestlerini düzeltilmiş sürümlere taşı; sonra regresyon ve imaj taramasını tekrar çalıştır. Tarayıcı bulguları paket seviyesindedir; doğrudan sömürülebilirlik ayrıca doğrulanmalıdır.
3. **P1 — Geliştirme modunu internete açma.** Development modunda Turnstile/CSP/Secure-cookie/ayrıntılı hata korumaları düşer. Canlıda `NODE_ENV=production`, Turnstile ve TLS zorunlu olmalı.
4. **P1 — Düz PII alanlarını kapat.** Personel PII, özel salon adı ve PII tabanlı fingerprint için AEAD/HMAC tasarımı uygula; eski düz kolonları backfill sonrası DB constraint ile yasakla.
5. **P1 — Secret ve anahtar yönetimini güçlendir.** Yeni sunucuda `USE_FILE_SECRETS=1` zorunlu yap; secret dosyası sahiplik/modunu doğrula; mümkünse KMS/HSM kullan. Drive, blind-index ve backup anahtarlarına `keyId` tabanlı rotasyon ekle.
6. **P1 — Hesap kurtarma ve kritik admin işlemlerini sertleştir.** Kayıp müşteri MFA cihazı için kimlik doğrulamalı recovery; kalıcı silme/parola sıfırlama için step-up MFA veya çift onay ekle.
7. **P2 — Spam ve genel dayanıklılığı artır.** E-posta/SMS sahiplik doğrulaması veya doğrulanmamış kuyruk, honeypot/davranış sinyali ve paylaşımlı global rate-limit store kullan.
8. **P2 — Yeni hostta yeniden doğrula.** Etkin `PermitRootLogin` değerini kesinleştir, Docker grup yetkisini sınırla, disk/sağlayıcı şifrelemesini ve off-site immutable yedeği doğrula; gerçek alan adında TLS, başlık, WAF ve rate-limit testi yap.

## Mevcut sunucu ve sınırlar

Mevcut sunucuda yalnız Traefik ve Docker socket proxy çalışıyor; uygulama, müşteri verisi, PostgreSQL ve Redis yok. Ubuntu yamaları güncel, UFW varsayılan giriş politikası `DROP`, yalnız 22/80/443 dinliyor; SSH parola girişi kapalı ve fail2ban aktif. Buna rağmen çelişen `PermitRootLogin` ayarının etkin sonucu okunamadı, görünür LUKS disk şifrelemesi yok ve hosttaki Docker grubu root eşdeğeri risktir.

Bu nedenle sunucu üzerinden müşteri/admin oturumu, veri şifreleme ve uygulama bot koruması canlı olarak doğrulanamadı. **Değiştirilecek yeni sunucu incelenmedi; daha güvenli/hazır olduğu varsayımı bu raporla doğrulanmış sayılmaz.**

## Doğrulama özeti

- Backend hızlı testleri: **61/61 geçti**.
- Bağımlılık, operasyon, servis ve file-secret güvenlik doğrulamaları: **tamamı geçti**.
- Kök ve backend npm denetimi: **0 bilinen açık**.
- Compose yapılandırmaları doğrulandı; konteyner imajları ayrıca güncel CVE taramasından geçirildi.
- Sunucu incelemesi salt-okunur yapıldı; hiçbir sunucu ayarı değiştirilmedi.
- Uygulama sunucuda bulunmadığı için tam dinamik pentest ve `runtime-role + gerçek HTTP login/admin` entegrasyon testi yapılamadı.

Başlıca kod kanıtları: `backend/src/routes/admin.routes.ts:73`, `backend/src/middlewares/auth.middleware.ts:75`, `backend/src/utils/pii-crypto.ts:99`, `backend/src/utils/crypto.ts:28`, `backend/src/utils/turnstile.ts:30`, `backend/src/utils/asyncHandler.ts:8`, `backend/prisma/schema.prisma:239`, `compose.production.yaml:348`.
