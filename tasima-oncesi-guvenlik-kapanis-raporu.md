# Taşıma Öncesi Güvenlik Kapanış Raporu

Tarih: 11 Ağustos 2026

## Sonuç

Taşımadan önce kaynak kodda kapatılabilen P0/P1/P2 bulguları giderildi. Yetki kontrolleri, admin adım doğrulaması, hassas veri şifreleme altyapısı, dağıtık hız sınırlama, gizli anahtar ve güvenli dağıtım akışı kod ve otomatik testlerle güçlendirildi. Hassas verilerin tek yönlü zorunlu şifreleme geçişi, yeni sunucudaki kontrollü dağıtım sırasında etkinleşecektir.

| Kategori | Kısa değerlendirme | Puan |
| --- | --- | ---: |
| Yetkilendirme ve RLS | İstek bağlamı, rol ayrımı ve audit erişimi veritabanı seviyesinde sınırlandı. | 9.2/10 |
| Müşteri hesabı ve oturum | Oturum, CSRF, yetki ve hesap bazlı kötüye kullanım kontrolleri güçlendirildi. | 8.8/10 |
| Admin hesabı ve kritik işlemler | Kritik işlemlerde parola + TOTP ile kısa ömürlü adım doğrulaması zorunlu. | 9.1/10 |
| Hassas veri şifreleme | PII için AEAD zarf şifreleme, anahtar kimliği, kör indeks ve bütünlük kontrolü eklendi. | 9.0/10 |
| Bot, spam ve form kötüye kullanımı | Dağıtık hız sınırı, bağımsız form kotaları ve bot sinyalleri mevcut. E-posta/telefon sahipliği dış sağlayıcıya bağlıdır. | 7.8/10 |
| API hız sınırlama | Üretimde veritabanı destekli, IP ve hesap temelli, hata halinde kapalı çalışan sınırlar var. | 8.9/10 |
| Gizli anahtar ve anahtar rotasyonu | Dosya tabanlı secret zorlaması, ayrık anahtarlar ve sınırlı keyring doğrulaması var. | 9.0/10 |
| Yedek güvenliği | Kimlikli anahtar rotasyonu, AEAD/AAD ve eski yedekler için güvenli geçiş desteği var. | 9.1/10 |
| Konteyner ve bağımlılıklar | Uygulama imajlarında kritik/yüksek açık bırakılmadı; ayrıcalıklar ve socket erişimi daraltıldı. | 8.8/10 |
| Dağıtım ve migration güvenliği | Yedekleme, genişletme, doğrulama, redaksiyon ve ileri yönlü geçiş sırası zorunlu. | 9.0/10 |
| Yeni sunucu, alan adı ve ağ | Kod hazır; TLS, DNS, WAF, SSH ve üretim anahtarları yeni sunucuda doğrulanmalıdır. | 7.5/10 |

## Kapanış durumu

- **P0:** Taşıma öncesi kod düzeyinde kapatıldı.
- **P1:** Kodla kapatılabilenler kapatıldı; üretim anahtarlarının kurulması ve şifreleme zorunluluğunun etkinleştirilmesi dağıtım adımıdır.
- **P2:** Kod ve dağıtım otomasyonuyla kapatılabilenler kapatıldı; DNS/TLS/WAF/SSH kontrolleri yeni sunucuya bağlıdır.

## Yeni sunucuda zorunlu son kontroller

1. Güçlü ve benzersiz üretim secret/keyring dosyalarını doğru sahiplik ve izinlerle kur.
2. Güvenli dağıtım akışını eksiksiz çalıştır; PII doğrulama ve redaksiyon başarılı olmadan trafiği açma.
3. TLS, DNS, güvenlik başlıkları, WAF/DDoS, SSH ve firewall ayarlarını canlı alan adında doğrula.
4. E-posta ve telefon sahipliği doğrulaması isteniyorsa uygun sağlayıcıyı bağla.

Genel sonuç: **8.8/10 — taşıma için kod tarafı hazır; kalan maddeler yeni sunucu aktivasyon kontrolüdür.**
