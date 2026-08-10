# Güvenlik İnceleme Raporu — 10 Ağustos 2026

## Kısa sonuç

**Genel güvenlik puanı: 8,5 / 10 — güçlü, ancak üretim öncesi birkaç operasyonel iyileştirme gerekli.**

- Kaynak kod güvenliği: **8,8 / 10**
- Mevcut geliştirme sunucusu: **8,0 / 10**
- Admin girişi olmadan admin işlemi: **Hayır.** Kaynakta tüm admin rotaları oturum, değiştirilmiş parola, MFA ve `ADMIN` rolü istiyor. Canlıda oturumsuz GET ve POST denemeleri `401` döndürdü.
- Müşteri hesapları: **Yeterli ve güçlü korunuyor.** Parola, oturum, CSRF, veri sahipliği ve isteğe bağlı MFA var. Teslimat erişen müşteriler için MFA'nın zorunlu yapılması savunmayı artırır.
- Kritik/yüksek bulgu: **Yok.** Bir adet düşük önem seviyeli düz metin eski yedek bulgusu var.

## Kategori puanları

| Kategori | Puan | Kısa değerlendirme |
|---|---:|---|
| Müşteri hesabı güvenliği | 8,5 / 10 | En az 15 karakter parola, Argon2id, tek kullanımlık kurulum bağlantısı, oturum iptali ve sahiplik kontrolü güçlü. Müşteri MFA'sı isteğe bağlı. |
| Admin hesabı güvenliği | 9,0 / 10 | Production ortamında TOTP MFA zorunlu; 8 saat mutlak, 30 dakika hareketsizlik süresi; brute-force limiti ve tekrar kullanılan TOTP engeli var. |
| Yetkilendirme ve veri izolasyonu | 9,5 / 10 | Admin, müşteri ve salon rotaları backend'de ayrılmış. Müşteri yalnız kendi düğününü, salon yetkilisi yalnız kendi salonunu görebiliyor; PostgreSQL RLS ikinci katman sağlıyor. |
| Oturum ve CSRF | 9,0 / 10 | Oturum tokenı hashli, cookie `HttpOnly + Secure + SameSite=Lax`; tüm kritik değişikliklerde çift gönderimli ve sunucu hashli CSRF kontrolü var. |
| Veri şifreleme | 9,0 / 10 | Çekirdek PII, TOTP sırrı ve teslimat bağlantısı AES-256-GCM ile bağlama bağlı şifreli. Ayrı keyring ve anahtar rotasyonu destekleniyor. |
| Veritabanı güvenliği | 9,0 / 10 | Ayrı ve kısıtlı runtime rolü, etkin RLS, transaction-local güvenlik bağlamı ve değiştirilemez audit ayrıcalıkları kullanılıyor. |
| Bot, spam ve brute-force | 8,5 / 10 | Turnstile, edge rate-limit, global API limiti, IP + hesap giriş limiti, iletişim bilgisi ve uygunluk sorgu limitleri birlikte çalışıyor. |
| Girdi, XSS ve injection koruması | 9,0 / 10 | Zod `strict` allowlist, 10 KB body sınırı, HPP, CORS, CSP/Helmet ve parametreli Prisma sorguları kullanılıyor. Doğrulanmış SQL/XSS açığı bulunmadı. |
| Secret ve anahtar yönetimi | 7,5 / 10 | Anahtar ayrımı ve dosya tabanlı secret desteği güçlü; mevcut sunucu ise secret overlay yerine ortam değişkenli temel compose kullanıyor. |
| Yedekleme ve veri saklama | 7,5 / 10 | Yeni yedekler ayrı anahtarla AES-256-GCM şifreli ve restore testi yapılıyor. Ancak iki eski düz metin PostgreSQL dump hâlâ diskte. |
| Audit, hata ve log güvenliği | 8,5 / 10 | Kritik işlemler audit ediliyor; production hata yanıtları ve loglar sır/PII sızıntısına karşı filtreli. Merkezi uzak log bütünlüğü doğrulanmadı. |
| Sunucu ve konteyner güvenliği | 8,0 / 10 | Yalnız 22/80/443 açık; UFW, Fail2ban ve otomatik güncelleme aktif. Konteynerler root olmayan kullanıcı, read-only FS, cap-drop ve limitlerle çalışıyor. Paylaşılan host/ağ, 6 bekleyen güncelleme ve konuk diskte LUKS olmaması puanı düşürüyor. |

## Hangi veriler nasıl korunuyor?

| Veri | Koruma |
|---|---|
| Kullanıcı parolaları | Geri açılamayan **Argon2id hash** |
| Oturum ve parola kurulum tokenları | Veritabanında yalnız **SHA-256 hash**, ham token cookie/tek kullanımlık bağlantıda |
| Gelin/damat adları, telefonlar, e-posta, not ve red nedeni | Kayıt/model/şema/anahtar bağlamlı **AES-256-GCM**; arama için ayrı anahtarlı **HMAC-SHA-256 blind index** |
| TOTP MFA sırrı | Kullanıcıya özel AAD ile **AES-256-GCM**, keyring rotasyonu |
| Google Drive teslimat bağlantısı | Teslimata özel AAD ile **AES-256-GCM** |
| Mesaj alıcı telefonu | Çekirdek PII zarfında **AES-256-GCM** |
| Güncel veritabanı yedekleri | Ayrı anahtarlı, parça doğrulamalı **AES-256-GCM v2** ve geri-yükleme provası |
| Personel adı/telefonu, kullanıcı adı/rol, tarih-fiyat ve audit metadata | Veritabanında düz metin; erişim kontrolü/RLS ile korunuyor |

Canlı doğrulamada **65 başvuru + 56 düğün + 63 mesaj görevi = 184 kaydın tamamı** `strict` modda şifreli bulundu; eksik zarf, eski anahtar, bozuk blind index veya legacy düz metin PII yoktu.

## Doğrulanmış bulgu ve öncelikler

1. **Eski düz metin yedekleri kaldırılmalı.** Sunucuda iki dolu `PGDMP` dosyası var. Dizin `700`, dosyalar `600` olduğu için internetten doğrudan erişilemiyor; yine de host hesabı ele geçirilirse tarihsel veriler açığa çıkar. Yeni `.dump.gcm` yedekleri doğrulandıktan sonra kontrollü bakımda silinmeli ve `LEGACY_PLAINTEXT_BACKUP_CLEANUP` güvenli varsayılan olmalı.
2. **Yeni sunucuda file-backed secrets zorunlu olmalı.** `compose.production.secrets.yaml` kullanılmalı; veritabanı, Turnstile, PII, rate-limit ve yedek anahtarları container environment içinde taşınmamalı.
3. **Yeni sunucuda disk ve ağ izolasyonu güçlendirilmeli.** LUKS veya sağlayıcı yönetimli disk şifreleme, projeye özel proxy ağı ve yalnız gerekli yönetim erişimi tercih edilmeli.
4. **Teslimat erişen müşteriler için MFA zorunluluğu değerlendirilmeli.** Mevcut müşteri MFA'sı isteğe bağlıdır.
5. **Sunucu bakımı tamamlanmalı.** Bekleyen 6 güncelleme uygulanmalı; yeni sunucuda UFW kuralları ve Fail2ban etkinliği ayrıcalıklı denetimle tekrar doğrulanmalı.

## Kanıt ve kapsam

- Kaynak kod, migration, compose/Docker, Nginx, güvenlik testleri ve mevcut sunucu salt-okunur incelendi; proje dokümantasyonu olan diğer Markdown dosyaları kullanıcı talebi gereği okunmadı.
- `npm audit`: frontend ve backend production bağımlılıklarında **0 açık**.
- Backend hızlı güvenlik grubu: **61/61 geçti**.
- Yedek/secret/operasyon güvenlik grubu: **18/18 geçti**.
- Canlı: TLS/HSTS/CSP aktif; uygulama ve veritabanı konteynerleri sağlıklı; RLS `enforced=true`; oturumsuz admin GET/POST `401`.
- Sunucuda hiçbir ayar veya veri değiştirilmedi.

Bu değerlendirme anlık görüntüdür; yeni sunucuya geçişten sonra aynı kontroller tekrar çalıştırılmalıdır.
