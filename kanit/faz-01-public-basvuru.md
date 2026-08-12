# Faz 01 — Public başvuru ve görünür hata akışı kanıtı

Tarih: 2026-08-12
Başlangıç SHA: `4132a838a5e9c26971774ebe92f86dc69ba19de8`

## Kök neden ve düzeltme

- Sentetik staging POST isteği `500 application/json` döndürdü; correlation ID `4e14fc0f-8cd6-4ba7-9c20-77083197f849` backend/PostgreSQL log zincirinde eşleştirildi.
- PostgreSQL hatası: public `INSERT ... RETURNING` sırasında `booking_applications` RLS SELECT görünürlük politikasının yeni satırı yardımcı fonksiyon üzerinden görememesi.
- `20260812170000_public_booking_rls_returning` migrationı yalnız mevcut public form `applicationId`/idempotency bağlamındaki satırın güvenli dönüşüne izin veren dar SELECT politikası ekledi.
- Runtime HTTP regresyonu gerçek ayrıcalıksız rol ve açık RLS enforcement ile önce 500 üretip düzeltmeden sonra 201 geçti.
- Kanıtlarda yalnız sentetik veri kullanıldı; parola, token ve kişi verisi kaydedilmedi.

## Backend ve veri bütünlüğü

- Public hata sözleşmesi: `code`, `message`, `requestId`, `fieldErrors`; 400/409/422/429/500 ayrımı.
- Aynı idempotency key iki istekte tek başvuru ve tek audit kaydı üretti.
- Farklı idempotency key ile aynı slot yarışında yalnız bir istek başarılı, diğeri 409 oldu.
- Geçersiz hizmet ilişkisi 400 döndürdü ve başvuru/ilişki bırakmadı.
- Paket ve hizmet fiyat snapshot’ları create/idempotent yanıtta backend tarafından döndürüldü.

## Frontend ve negatif UX

- Aktif adımda erişilebilir live-region, alan yanı hata, loading/disabled, güvenli retry ve form koruma eklendi.
- 400, 409, 422, 429, 500 ve offline; çift tıklama; Turnstile expired/error/script-load-fail; eski uygunluk yanıtı yarışı geçti.
- Fiyat değişikliğinde sunucu snapshot’ı gösteriliyor ve kullanıcı `Güncel fiyatı onayla` eylemiyle açık onay veriyor.
- Başarı referansı kalıcı ödeme adımında görünür/kopyalanabilir; session yenileme geri yüklemesi geçti.

## Çalıştırılan doğrulamalar

- Backend quick: 74/74 geçti.
- PostgreSQL integration: 11/11 geçti; 29 migration doğrulandı.
- Runtime role/RLS HTTP: 5/5 geçti.
- Odaklı negatif UX/Turnstile/fiyat/uygunluk: 10/10 geçti; fiyat snapshot testi ayrıca geçti.
- Form, özel salon, nakit/kapora ve session geri yükleme: 4/4 geçti.
- Gerçek Nginx katalog/console/network smoke: geçti.
- Gerçek Nginx → API → PostgreSQL: 3 nakit + 3 kapora, 6 benzersiz referans ve admin kuyruğunda 6/6 eşleşme geçti.
- Nginx `nginx -t` geçti; same-origin `/api/v1/health` 200 JSON döndürdü.

## Ortam ve sınırlar

- Kabul ortamı yalnız localhost ve sentetik, geçici PostgreSQL verisi kullandı.
- Canlı sunucu, DNS, TLS ve gerçek müşteri verisi değiştirilmedi.
- Yerel kabul konteynerleri kanıt incelemesi için çalışır bırakıldı; Faz 02 ayrı kullanıcı onayına bağlıdır.
