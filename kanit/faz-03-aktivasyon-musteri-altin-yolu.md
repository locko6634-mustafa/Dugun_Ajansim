# Faz 03 — Aktivasyon, mesajlar ve müşteri altın yolu kanıtı

Tarih: 2026-08-12
Ortam: Yerel uygulama ve yalnız sentetik PostgreSQL test veritabanı
Canlı sistem etkisi: Yok

## Uygulanan sözleşme

- Mesaj görevleri `PLANNED → PREPARED → READY_TO_SEND → SENT` akışını izler; `FAILED` yeniden deneme kuyruğunu, `CANCELLED` güvenli iptali temsil eder.
- `SENT` geçişi hazırlanmış mesaj olmadan, parola görevlerinde doğru kullanıcı/amaç için geçerli token olmadan ve `dueAt` gelmeden reddedilir.
- Erken gönderim ayrı endpoint, yakın tarihli admin MFA step-up, gerekçe ve audit kaydı ister.
- Hazırlama ve token üretimi aynı transaction içindedir. Eşzamanlı iki render denemesinde yalnız biri başarılı olur.
- Onay ve red karar mesajları, karar transaction’ında başvuruya bağlı ayrı WhatsApp outbox görevleri olarak oluşturulur. Aktivasyon kararı ayrı görevdir.
- Parola kurulum URL’si token amacını taşır; tüketim endpointi amacı doğrular. Token tek kullanımlı, süreli ve kullanıcı hesabına bağlıdır.
- Müşteri sorguları oturum kullanıcısına bağlıdır; yabancı düğün/teslimat kimliği ile arşivli veya iptal düğün 404 döndürür.
- Teslimat erişimi 30 günle sınırlıdır ve admin MFA step-up ile geri çekilebilir. Yayınlama, Google Drive bağlantısının gizli pencerede “bağlantıya sahip herkes” olarak açıldığını operatörün birebir onay ifadesiyle doğrulamasını zorunlu tutar.
- Müşteri paneli logout/pagehide anında hassas DOM’u temizler; BFCache dönüşünde oturumu yeniden doğrulamadan içeriği göstermez.

## Altın yol ve negatif kabul

Tek sentetik entegrasyon senaryosu aşağıdaki zinciri birlikte doğruladı:

1. Public başvuru, WhatsApp handoff ve atomik admin onayı.
2. Doğru alıcı/referansla karar görevi ve daha sonraki aktivasyon görevi.
3. Aktivasyon mesajını gerçek `render` ve `verify` endpointleriyle hazırlama.
4. Erken doğrulamanın 409 olması; MFA step-up + gerekçeli override sonrasında açılması.
5. Yanlış amaç, erken kullanım, süresi dolmuş token ve replay reddi.
6. Güçlü parola belirleme, müşteri login, cookie/idle/logout davranışı.
7. Yabancı düğün ve teslimat kimliği ile iptal/arşivli düğün erişiminin 404 olması.
8. Hazır olmayan URL’nin gizlenmesi; onaylı test URL’sinin yayınlanması.
9. Teslimat linkinin süre sonu ve geri çekme sonrasında kapanması.
10. Mesaj hazırlama yarışı, rendersız gönderildi reddi, başarısız/retry ve güvenli iptal.
11. Test sonu sentetik kayıt cleanup’ı.

Test mesajları, tokenlar ve parolalar audit kayıtlarında aranarak düz metin bulunmadığı doğrulandı; değerler bu belgeye alınmadı.

## MFA, step-up ve güvenilen cihaz

- Sentetik admin enrollment, şifreli TOTP sırrı, doğru/yanlış MFA login, replay yarışı ve IP/hesap rate limitleri geçti.
- Step-up CSRF, yanlış parola/kod, yarış, beş dakikalık geçerlilik ve oturum rotasyonu geçti.
- Güvenilen cihaz oluşturma, tanınan cihazla login, tekil geri çekme ve süresi dolmuş/geri çekilmiş cookie reddi geçti.
- Offline recovery betiği sentetik admin üzerinde çalıştırıldı: MFA alanları temizlendi, açık oturum ve cihaz sayıları sıfırlandı, tek audit kaydı oluştu; sentetik kayıt sonrasında silindi.
- Kontrollü TOTP saat testi mevcut, önceki ve sonraki 30 saniyelik adımı kabul eder; iki adım sapmayı reddeder. Yerel Windows `w32time` servisi aktif olmadığı için `w32tm /query /status` bu makinede hizmet-kapalı döndü. Üretim NTP kaynağı ve deploy durdurma kapısı Faz 10/13 kapsamında ayrıca doğrulanacaktır.

## Çalıştırılan doğrulamalar

- `npx prisma validate`: geçti.
- `npx tsx --env-file=tests/test.env src/scripts/migrateTestDatabase.ts`: geçti; 31 migration bulundu ve `20260812190000_message_task_state_machine` uygulandı.
- Hedefli müşteri altın yolu entegrasyonu: 1/1 geçti.
- Hedefli admin MFA/güvenilen cihaz entegrasyonu: 1/1 geçti.
- Sentetik MFA recovery drill ve cleanup doğrulaması: geçti; MFA temiz, aktif oturum 0, aktif cihaz 0, audit 1.
- `npm run test:quick`: geçti. 34 responsive E2E, 13 hedefli backend testi, backend build ve test typecheck başarıyla tamamlandı; başarısız/atlanan/todo test yok.

## Operasyon notları

- Gerçek Google Drive izin denetimi ücretsiz API kimliği olmadan otomatik yapılmıyor; yayınlama bu nedenle operatörün gizli pencere kontrolü ve birebir onay ifadesiyle fail-closed çalışır.
- Canlı müşteri, canlı mesaj, canlı Drive bağlantısı, DNS ve TLS üzerinde işlem yapılmadı. Güncel release canlı ortamda Faz 15’te yeniden doğrulanacaktır.
