# Faz 02 — TTL, handoff ve veri saklama kanıtı

Tarih: 2026-08-12

Başlangıç SHA: `c013cea`

## İş kararı ve durum modeli

Kullanıcının Faz 02–06 için verdiği uygulama yetkisi kapsamında aşağıdaki güvenli saklama kuralı kabul edildi:

| İş durumu | Kalıcı göstergeler | TTL sınırındaki davranış | Slot / yönetici davranışı |
|---|---|---|---|
| Ödeme adımına ulaşmamış aktif başvuru | `ONAY_BEKLIYOR`, handoff ve kanal yok, son tarih gelecekte | Public erişim sürer | Slotu tutar |
| Gerçek terk | `ONAY_BEKLIYOR`, handoff ve kanal yok, son tarih dolmuş | Fiziksel silme yapılmaz; atomik olarak `IPTAL_EDILDI`, `deletedAt`, `paymentFlowExpiredAt` ve audit yazılır; token kapatılır | Slotu bırakır |
| Handoff açıldı | `whatsappHandoffAt` veya `paymentNotificationChannel` var | Kayıt korunur; yalnız public token kapatılır | Slotu tutar, yönetici onay/red verebilir |
| Dekont gönderildi | WhatsApp dış kanalı backend tarafından bağımsız doğrulanamaz | Güvenli tarafta kalınır: handoff/kanal bulunan tüm kayıtlar ödeme kanıtı taşıyabilir kabul edilip korunur | Admin kuyruğunda bekler |
| Admin bekliyor | Korumalı `ONAY_BEKLIYOR` | TTL fiziksel silme veya iptal yapmaz | Süre geçse de onay/red yapılabilir |
| Onay / red | `ONAYLANDI` / `REDDEDILDI` | TTL cleanup kapsamı dışındadır | Normal terminal yaşam döngüsü işler |

Gerçek terk satırı 60 dakikada fiziksel silinmez. Mevcut public application retention politikasıyla varsayılan 90 gün sonunda toplu fiziksel silmeye aday olur. Handoff/kanal bulunan kayıt bu terk retention sorgusundan da hariç tutulur.

## Uygulama kanıtı

- Cleanup seçimi yalnız son tarihi dolmuş, handoff ve bildirim kanalı bulunmayan public pending kayıtları kapsıyor.
- Gerçek terk dönüşümü ile audit aynı PostgreSQL transactionında; audit hatası enjekte edildiğinde durum, token ve silme alanlarının tümü geri alındı.
- Audit; kayıt ID’si, karar zamanı, `no_handoff_or_payment_evidence_before_deadline` nedeni ve `physicalDelete=false` bilgisini taşıyor.
- Sweep sonucu `selectedCount`, `retainedCount`, `archivedAbandonedCount`, `preservedEvidenceCount`, `publicAccessClosedCount`, `failedCount` ve `physicalDeletedCount` metriklerini üretiyor.
- Başarısız sweep veya sıfırdan farklı fiziksel silme bütünlük alarmına dönüşüyor; scheduler yapılandırılmış JSON kayıt üretiyor.
- Advisory lock ve terminal duruma geçiş sorgusu tekrar çalışmayı idempotent tutuyor.
- Public uygunluk sorgusu ve DB `public_venue_has_conflict` fonksiyonu, TTL’si geçmiş korumalı başvurunun slotunu tutuyor.
- Admin onay claim’i korumalı kayıtta artık ilk ödeme TTL’sine bağlı değil.
- Yeni migration: `backend/prisma/migrations/20260812180000_retain_payment_handoff/migration.sql`.

## Test kanıtı

- Kırmızı regresyon: eski kod, handoff kaydını fiziksel sildi ve `assert.ok(retained)` başarısız oldu.
- Odaklı sabit saat regresyonu: 25 saatlik handoff ve tam TTL sınırında kayıt korundu; public token kapandı, audit yazıldı, ikinci sweep sıfır aday buldu ve hata enjeksiyonunda transaction geri alındı — 1/1 geçti.
- Backend build ve test typecheck geçti.
- Gerçek yerel PostgreSQL migration + entegrasyon paketi geçti — 11/11; 30 migration doğrulandı.
- Entegrasyon; gerçek terkin kontrollü arşivini, 100 kayıtlık batch’i, advisory lock’u, handoff sonrası slot korumasını, çakışma reddini ve TTL sonrası admin onayını doğruladı.

## Ortam ve sınırlar

- Smoke, Faz 00’da kurulan production-benzeri izole yerel staging PostgreSQL’i ve yalnız sentetik `.invalid` veriyi kullandı.
- Canlı sunucu, DNS, TLS ve gerçek müşteri verisi değiştirilmedi.
- Gerçek müşteri/dekont tesliminin canlı sonrası operasyonel gözlemi Faz 14 kapsamındaki takip kapısında ayrıca yapılacaktır.
