# Güvenlik Denetimi: Dugun_Ajansim

## Kapsam

Düğün Ajansım ön yüz, arka uç, Prisma/geçiş, Docker/Nginx, PostgreSQL rolü ve CI/CD yüzeylerinde standart tek geçişli statik güvenlik denetimi. İlk tarama puanı: 6,5/10. Güncel durumlar 9 Ağustos 2026 tarihli yeniden doğrulama bölümünde gösterilir; puan yeniden hesaplanmamıştır.

- Tarama biçimi: depo
- Hedef türü: git_sürümü
- Hedef kimliği: target_sha256_a7258619dcfe6659a4227b12cff5bcb5b25f691a735b294a4181d45f37952495
- Sürüm: 1ddc965fa54df421027009340434b08a1fc80f30
- Envanter stratejisi: depo
- Dahil edilen yollar: .
- Hariç tutulan yollar: yok
- Çalışma veya test durumu: güvenlik_keşfi_için_çalıştırılmadı
- İncelenen yapıtlar: 170 izlenen dosyalık envanter, 131 kaynak/yapılandırma türü dosya, en az 62 tamamen okunmuş dosya, 5 odaklı inceleme yüzeyi ve bağımsız temel değerlendirme
- Tarama bağlamı: Kullanıcı rakip/düşman saldırısı ve sitenin kapatılma riskinden endişe ediyor. Puan, doğrulanmış bulgu şiddeti ile mevcut koruyucu kontroller birlikte değerlendirilerek verildi.

Sınırlamalar ve kapsam dışı tutulanlar:

- Statik/çevrimdışı; canlı DAST yapılmadı.
- Güncel harici bağımlılık güvenlik bildirimi verisi sorgulanmadı.
- Canlı ana makine/Traefik/güvenlik duvarı/WAF/gizli bilgi deposu/depolama/yedek ayarları doğrulanmadı.
- hariç tutuldu node_modules/\*\*, backend/node_modules/\*\*, dist/\*\*, backend/dist/\*\*: tedarikçi/üretilmiş yapıt; kaynak incelemesi kapsamı dışı.
- hariç tutuldu ikili ortam/yazı tipi varlıkları: Çalıştırılabilir ürün mantığı içermeyen ikili varlıklar.
- hariç tutuldu yok sayılan gizli bilgi dosya içerikleri; örneğin backend/.env: Sır içeriği okunmadı; yalnız dosya varlığı doğrulandı.
- hariç tutuldu canlı üretim çalışma zamanı ve harici ağ: Canlı DAST yetkisi verilmedi; standart kaynak incelemesi çevrimdışı yürütüldü.

### Tarama Özeti

| Alan                 | Değer                               |
| -------------------- | ----------------------------------- |
| Raporlanabilir bulgu | 13                                  |
| Önem düzeyi dağılımı | yüksek: 1, orta: 4, düşük: 8        |
| Güven dağılımı       | yüksek: 12, orta: 1                 |
| Kapsama              | kısmi                               |
| Doğrulama biçimi     | üst düzey statik kaynak doğrulaması |

Temel yapıtlar: `scan-manifest.json`, `findings.json` ve `coverage.json`. Bu rapor, söz konusu dosyaların belirlenimci bir yansımasıdır.

### Güncel Yeniden Doğrulama — 9 Ağustos 2026

- İncelenen kaynak sürümü: `55962449a9ae45adb9efab6da5492a842d82009a`
- Yöntem: güncel kaynakta saldırgan girdisi → en yakın kontrol → etki zinciri, karşı kontroller ve mevcut regresyon testleri incelendi; hedefli testler çalıştırıldı.
- Durum dağılımı: **çözüldü: 12, kısmen çözüldü: 0, çözülmedi: 1**.
- İlk taramadaki 6,5/10 puan, yeni ve tam kapsamlı tarama yapılmadığı için değiştirilmedi.

Doğrulama rubriği:

- [x] Saldırgan girdisinin güncel erişilebilirliği kontrol edildi.
- [x] İlk rapordaki kök neden güncel kodda arandı.
- [x] Yeni veya mevcut güvenlik kontrolünün zinciri kesip kesmediği incelendi.
- [x] Etkinin güncel kodda hâlâ üretilebilir olup olmadığı değerlendirildi.
- [x] Regresyon testleri ve dağıtım yapılandırması karşı kanıt olarak doğrulandı.

| No | Güncel durum     | Yeniden doğrulama kanıtı | Kalan açıklık |
| -- | ---------------- | ------------------------- | ------------- |
| 1  | Çözüldü         | Genel başvurular ve WhatsApp devri aynı mutlak `paymentFlowExpiresAt` sınırına tabi; takvim yalnız süresi dolmamış genel tutmaları dikkate alıyor ve süpürme devir yapılmış kayıtları da siliyor. | Yok. |
| 2  | Çözüldü         | Dakikalık süpürme, süresi dolan kayıtları 100'lük kısa transaction partileri halinde aday kalmayana kadar tüketiyor; başvuru, ilişkili denetim kayıtları ve sahipsiz müşteri salonu siliniyor. 101 kayıtlık regresyon testi tüm kalıcı ayak izinin tek süpürmede kaldırıldığını doğruluyor. | Yok. |
| 3  | Çözüldü         | CORS ve `Sec-Fetch-Site` çapraz-site reddi global API sınırlayıcısından önce çalışıyor; hedefli kota testi geçti. | Yok. |
| 4  | Çözüldü         | Ödeme akışı erişimi yalnız silinmemiş `PUBLIC_FORM` ve `ONAY_BEKLIYOR` kayıtlarında geçerli; süre sonu kayıtları siliniyor, onay/arşiv akışları token özetini temizliyor. | Yok. |
| 5  | Çözüldü         | Yerel sunucu varsayılan olarak `127.0.0.1` üzerinde dinliyor ve yalnız kök HTML ile `assets/`, `css/`, `js/` yollarını sunuyor; hassas yol testleri geçti. | Yok. |
| 6  | Çözüldü         | SSH eylemi tam commit SHA'sına, Node/Nginx/Postgres tabanları `sha256` digestlerine sabitlendi; üretim sertleştirme testi geçti. | Yok. |
| 7  | Çözüldü         | Geçici parola içeren mesaj görüntülendiğinde aynı transaction içinde `message.secret_viewed` denetim kaydı oluşturuluyor; gizli değer metadata'ya yazılmıyor. | Yok. |
| 8  | Çözüldü         | Salon operasyon yanıtları `weddingSelectForVenue` allowlist seçimi ve daraltılmış `packageSummary` DTO'su kullanıyor; gereksiz müşteri/ödeme alanları dönmüyor. | Yok. |
| 9  | Çözüldü         | Ödeme akışı GET çağrısı önce hedef kaydı bulup taşıyıcı anahtarını doğruluyor; yalnız doğrulanmış hedef süresi dolmuşsa hedefe özel süpürme yapılıyor. | Yok. |
| 10 | Çözüldü         | Üretim `script-src` artık `'unsafe-inline'` içermiyor; satır içi başlangıç betikleri harici modüllere taşındı ve CSP regresyon testi geçti. | Yok. |
| 11 | Çözüldü         | Genel uygunluk yanıtı kesin saatler yerine yalnız `hasOccupancy` döndürüyor ve tarih ufku 366 günle sınırlı. | Yok. |
| 12 | Çözüldü         | Ortak çıkış yardımcısı yalnız başarı veya zaten geçersiz 401 oturumunda yönlendiriyor; 403/429/ağ/5xx hatalarında sayfada kalıp aktif oturum uyarısı gösteriyor. | Yok. |
| 13 | Çözülmedi       | Dağıtım hâlâ her çalışmada benzersiz tam `pg_dump` üretiyor. | Yaş/adet/boyut saklama politikası, minimum boş disk eşiği ve otomatik sunucu dışı aktarım uygulanmıyor. |

## Tehdit Modeli

Düğün Ajansım anonim ziyaretçi, müşteri, salon yetkilisi, yönetici ve altyapı operatörü sınırları olan genel erişime açık rezervasyon/operasyon platformudur. İlk tarama güvenlik puanı 6,5/10 idi. Güncel yeniden doğrulamada WhatsApp devir ve anonim kalıcı kayıt büyümesi bulguları çözülmüş, yedek saklama bulgusu açık kalmıştır.

### Varlıklar

- Başvuru ve müşteri PII'ı
- Salon takvimi ve rezervasyon kullanılabilirliği
- Admin/salon/müşteri sessionları
- Geçici parolalar ve teslimat URL'leri
- Paket/fiyat/ödeme bütünlüğü
- PostgreSQL, yedekler ve DATA_ENCRYPTION_KEY
- üretim SSH/dağıtım yetkisi

### Güven Sınırları

- Anonim tarayıcı -\> genel erişime açık API
- çerez oturum + DB-bound CSRF -\> korumalı API
- Müşteri/SALON_YETKILISI/ADMIN rol ve kayıt sınırları
- Traefik/Nginx -\> Express -\> dahili PostgreSQL
- çalışma zamanı DB rolü -\> sahip/geçiş rolü
- GitHub Actions -\> üçüncü taraf eylem/kalıp
- Yerel dev sunucu -\> çalışma alanı

### Saldırgan Yetenekleri

- genel erişime açık uç noktaları çağırma
- Dağıtık IP veya saldırgan sayfası ile trafik üretme
- Kendi Ödeme akışı-anahtar yetenek'sini oluşturma
- Çalınmış rol oturum kullanma
- Paylaşılan sekmeden yetenek edinme
- Düşük olasılıklı üst kaynak tedarik zinciri ele geçirilmesi

### Güvenlik Hedefleri

- Yalnız doğrulanmış ve unsüresi dolmuş rezervasyonların slot bloklaması
- Rol/salon/müşteri sınırları
- oturum/yetenek yaşam döngüsü iptal
- PII ve gizli bilgi minimum açığa çıkarma
- sunucu-authoritative fiyat
- Anonim girdinin kalıcı kaynak tüketimini sınırlama
- üretim yapıt/dağıtım bütünlüğü

### Varsayımlar

- Statik/çevrimdışı güncel sürüm incelemesi yapıldı.
- Canlı Traefik/DNS/WAF/güvenlik duvarı/gizli bilgi deposu/depolama durumu kaynak koddan doğrulanamaz.
- üretim dağıtım compose/Dockerfile akışını izler.
- Rakip genel erişime açık API'ye erişebilir; rol saldırıları ilgili oturum ele geçirilmesi gerektirir.

## Bulgular

| Bulgu                                                                                                       | İlk önem | İlk güven | Güncel durum    | Ayrıntılı açıklama |
| ----------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---------------- | ------------------ |
| [Sahte WhatsApp devir işlemi salon saatini süresiz bloke edebiliyor](#finding-1)                            | yüksek   | yüksek     | Çözüldü         | aşağıda            |
| [Kimliksiz genel erişime açık başvurular kalıcı veritabanı büyümesi oluşturabiliyor](#finding-2)            | orta     | yüksek     | Çözüldü         | aşağıda            |
| [Çapraz kaynaklı reddedilen trafik kurban IP'nin API kotasını tüketebiliyor](#finding-3)                    | orta     | yüksek     | Çözüldü         | aşağıda            |
| [Ödeme akışı taşıyıcı anahtarı süre sonu ve terminal/arşiv durumlarından sonra geçerli kalıyor](#finding-4) | orta     | yüksek     | Çözüldü         | aşağıda            |
| [Yerel statik sunucu depo kökünü tüm ağ arayüzlerine yayımlıyor](#finding-5)                                | orta     | yüksek     | Çözüldü         | aşağıda            |
| [Üretim eylemi ve konteyner tabanları değişebilir etiketlere bağlı](#finding-6)                             | düşük    | yüksek     | Çözüldü         | aşağıda            |
| [Geçici parolanın düz metin görüntülenmesi denetim kaydı kaydı oluşturmuyor](#finding-7)                    | düşük    | yüksek     | Çözüldü         | aşağıda            |
| [Salon operasyon API'leri gerekli olmayan düğün alanlarını döndürüyor](#finding-8)                          | düşük    | yüksek     | Çözüldü         | aşağıda            |
| [Geçersiz Ödeme akışı GET isteği küresel süre sonu süpürmesini tetikleyebiliyor](#finding-9)                | düşük    | orta       | Çözüldü         | aşağıda            |
| [Üretim CSP satır içi betik çalıştırılmasına izin veriyor](#finding-10)                                     | düşük    | yüksek     | Çözüldü         | aşağıda            |
| [genel erişime açık uygunluk uç noktası salonların kesin doluluk saatlerini açığa çıkarıyor](#finding-11)   | düşük    | yüksek     | Çözüldü         | aşağıda            |
| [ön yüz çıkış, sunucu iptal başarısız olsa da tamamlanmış gibi yönlendiriyor](#finding-12)                  | düşük    | yüksek     | Çözüldü         | aşağıda            |
| [Dağıtım yedekleri saklama olmadan sınırsız birikebiliyor](#finding-13)                                     | düşük    | yüksek     | Çözülmedi       | aşağıda            |

### Güven Ölçeği

| Label  | Meaning                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------- |
| yüksek | Doğrudan kanıt, çözümlenmemiş önemli bir engel olmadan bulguyu destekliyor.                       |
| orta   | Kanıt makul bir sorunu destekliyor ancak önemli çalışma zamanı veya erişilebilirlik kanıtı eksik. |
| düşük  | Kanıt eksik ve madde yalnızca açık izleme için tutuluyor.                                         |

<a id="finding-1"></a>

### [1] Sahte WhatsApp devir işlemi salon saatini süresiz bloke edebiliyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | yüksek                                                                                                                                                                                                                            |
| Güven              | yüksek                                                                                                                                                                                                                            |
| Güven gerekçesi    | genel erişime açık oluşturma ve devir rotasından süre sonu ve takvim çakışma sorgularına kadar kaynak akışı doğrudan doğrulandı.                                                                                                  |
| Kategori           | iş-mantığı-kötüye-kullanımı                                                                                                                                                                                                       |
| CWE                | CWE-841                                                                                                                                                                                                                           |
| Etkilenen satırlar | backend/src/hizmetler/rezervasyon.service.ts:521, backend/src/hizmetler/rezervasyon.service.ts:137, backend/src/hizmetler/rezervasyon.service.ts:742, backend/src/routes/public.routes.ts:210, js/package-builder/başvuru.js:1445 |

#### Özet

Kimliksiz bir saldırgan kendi genel erişime açık başvurusunda istemci kontrollü WhatsApp devir sinyalini tetikleyerek ödeme/dekont doğrulanmadan salon slotunu süresiz rezerve edebilir.

#### Kök Neden

İstemci tarafından üretilebilen whatsappHandoffAt telemetrisi, sunucu tarafından doğrulanmış ödeme olmadan geçici tutmayı süresiz aktif rezervasyona yükseltiyor; süre sonu seçimi devir yapılmış kayıtları hariç tutuyor.

**devir kayıtları süpürülmüyor** — `backend/src/services/booking.service.ts:516`

whatsappHandoffAt dolu kayıtlar mutlak TTL geçmiş olsa bile süre sonu dışındadır.

```typescript
where: { source: "PUBLIC_FORM", status: "ONAY_BEKLIYOR", deletedAt: null, whatsappHandoffAt: null, paymentFlowExpiredAt: null, paymentFlowExpiresAt: { lte: now } }
```

**devir TTL'den bağımsız çakışma sayılıyor** — `backend/src/services/booking.service.ts:132`

devir işareti rezervasyonu süresiz aktif kabul eder.

```typescript
OR: [
  { status: "ONAYLANDI" },
  { whatsappHandoffAt: { not: null } },
  { paymentFlowExpiresAt: null },
  { paymentFlowExpiresAt: { gt: new Date() } }
];
```

#### Doğrulama

markWhatsappHandoff yalnız taşıyıcı anahtarını, beklemede durumu ve mevcut TTL'yi kontrol edip whatsappHandoffAt yazar. expireStalePaymentFlows whatsappHandoffAt dolu kayıtları dışlar; takvim sorguları bu kayıtları TTL'den bağımsız çakışma sayar.

**devir kayıtları süpürülmüyor** — `backend/src/services/booking.service.ts:516`

whatsappHandoffAt dolu kayıtlar mutlak TTL geçmiş olsa bile süre sonu dışındadır.

```typescript
where: { source: "PUBLIC_FORM", status: "ONAY_BEKLIYOR", deletedAt: null, whatsappHandoffAt: null, paymentFlowExpiredAt: null, paymentFlowExpiresAt: { lte: now } }
```

**devir TTL'den bağımsız çakışma sayılıyor** — `backend/src/services/booking.service.ts:132`

devir işareti rezervasyonu süresiz aktif kabul eder.

```typescript
OR: [
  { status: "ONAYLANDI" },
  { whatsappHandoffAt: { not: null } },
  { paymentFlowExpiresAt: null },
  { paymentFlowExpiresAt: { gt: new Date() } }
];
```

#### Veri Akışı

genel erişime açık katalogdan geçerli kimlikleri al -\> sahte başvuru oluştur -\> kendi Ödeme akışı-anahtar ile devir çağır -\> whatsappHandoffAt yazılır -\> süre sonu kaydı atlar -\> takvim slotu süresiz dolu sayar.

#### Erişilebilirlik

Kimlik doğrulama gerekmez; iki geçerli genel erişime açık API çağrısı yeterlidir. Hız IP başına sınırlı olsa da etki yönetici müdahalesine kadar kalıcıdır.

#### Önem düzeyi

**yüksek** — Anonim, düşük maliyetli ve tekrarlanabilir saldırı doğrudan rezervasyon kullanılabilirliğini ve geliri etkiler; IP limitleri hızı azaltır ancak rezervasyon ömrünü sınırlamaz.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

Tüm genel erişime açık rezervasyonlara devir'tan bağımsız mutlak reservationExpiresAt üst sınırı uygulayın. whatsappHandoffAt değerini yalnız telemetri sayın; kalıcı blokajı ödeme webhook'u, doğrulanmış dekont/personel sahiplenme'i veya yönetici onayıyla başlatın. Takvim sorgularını yalnız onaylı kayıtlar ve süresi dolmamış tutmalarla sınırlandırın.

Testler:

- devir yapılmış genel erişime açık rezervasyon mutlak TTL sonunda takvimden çıkmalıdır.
- Ödeme doğrulaması olmadan devir kalıcı rezervasyon oluşturmamalıdır.

Önleyici kontroller:

- Sunucu doğrulamalı ödeme/dekont olayı
- Mutlak rezervasyon TTL'si
- Kişi/cihaz/slot kötüye kullanım limiti

<a id="finding-2"></a>

### [2] Kimliksiz genel erişime açık başvurular kalıcı veritabanı büyümesi oluşturabiliyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | orta                                                                                                                                                                                                                                   |
| Güven              | yüksek                                                                                                                                                                                                                                 |
| Güven gerekçesi    | oluşturma/güncelleme, süre sonu, admin salon delete ve şema ilişkileri kaynakta doğrulandı.                                                                                                                                            |
| Kategori           | kaynak-tüketimi                                                                                                                                                                                                                        |
| CWE                | CWE-400, CWE-770                                                                                                                                                                                                                       |
| Etkilenen satırlar | backend/src/hizmetler/rezervasyon.service.ts:261, backend/src/hizmetler/rezervasyon.service.ts:341, backend/src/routes/public.routes.ts:159, backend/src/hizmetler/rezervasyon.service.ts:540, backend/src/routes/admin.routes.ts:2146 |

#### Özet

İsteğe bağlı yinelenebilirlik ve genel erişime açık özel-salon oluşturma, anonim saldırganın kalıcı Venue, BookingApplication, ilişki ve AuditLog kayıtlarını yaşam döngüsü temizliği olmadan biriktirmesine izin veriyor.

#### Kök Neden

Doğrulanmamış özelSalonAdı küresel aktif Venue satırına dönüştürülüyor; yinelenebilirlik zorunlu değil ve süre sonu silme/anonimleştirme yerine durum ile denetim kaydı ekliyor.

**Anonim isimden küresel salon** — `backend/src/services/booking.service.ts:261`

genel erişime açık girdi kalıcı küresel Venue üretir.

```typescript
transaction.venue.create({
  data: {
    name: customVenueName!,
    slug: `musteri-salonu-${randomReferenceCode().toLowerCase()}`,
    isPartner: false
  }
});
```

**süre sonu silmiyor** — `backend/src/services/booking.service.ts:540`

Yaşam döngüsü depolama ayak izini geri kazanmaz.

```typescript
data: { status: "IPTAL_EDILDI", paymentFlowExpiredAt: now }
```

#### Doğrulama

Her benzersiz özelSalonAdı aktif Venue oluşturabilir; aynı akış başvuru, service ve denetim kaydı kayıtları üretir. süre sonu yalnız IPTAL_EDILDI yapar; referanslı salon silinmez.

**Anonim isimden küresel salon** — `backend/src/services/booking.service.ts:261`

genel erişime açık girdi kalıcı küresel Venue üretir.

```typescript
transaction.venue.create({
  data: {
    name: customVenueName!,
    slug: `musteri-salonu-${randomReferenceCode().toLowerCase()}`,
    isPartner: false
  }
});
```

**süre sonu silmiyor** — `backend/src/services/booking.service.ts:540`

Yaşam döngüsü depolama ayak izini geri kazanmaz.

```typescript
data: { status: "IPTAL_EDILDI", paymentFlowExpiredAt: now }
```

#### Veri Akışı

Benzersiz özelSalonAdı -\> Venue.create -\> BookingApplication + hizmetler + AuditLog -\> süre sonu yalnız durum/denetim kaydı -\> FK nedeniyle salon yalnız pasifleşir.

#### Erişilebilirlik

IP başına hız sınırı toplam kalıcı kayıt sayısını veya saklama süresini sınırlamaz.

#### Önem düzeyi

**orta** — İstek başı boyut ve IP hızı sınırlı olsa da etki kalıcıdır, dağıtık kaynaklarla büyütülebilir ve iptal kayıtları mevcut akışla tam temizlenemez.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

Uygulanan çözüm, doğrulanmamış genel başvurulara mutlak ödeme akışı TTL'si uygular. Dakikalık süpürücü süresi dolan kayıtları 100'lük kısa transaction partileri halinde aday kalmayana kadar tüketir; ilişkili denetim kayıtlarını, başvuruyu ve sahipsiz müşteri salonunu siler. Böylece trafik tek partiyi aşsa da kalıcı temizleme kuyruğu oluşmaz.

Testler:

- 100 kayıtlık parti sınırını aşan 101 süresi dolmuş başvuru tek süpürmede temizlenmelidir.
- Saklama süresi dolmuş ilişkiler, denetim kayıtları ve sahipsiz salon kayıtları temizlenmelidir.

Önleyici kontroller:

- İletişim doğrulaması
- Kalıcı kötüye kullanım kotası
- saklama/anonymization

<a id="finding-3"></a>

### [3] Çapraz kaynaklı reddedilen trafik kurban IP'nin API kotasını tüketebiliyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | orta                                                                                                                                    |
| Güven              | yüksek                                                                                                                                  |
| Güven gerekçesi    | Middleware sırası ve izin verilmeyen kaynak isteklerinin 101. istekte 429 aldığı depo testi doğrulandı.                                 |
| Kategori           | hizmet-engelleme                                                                                                                        |
| CWE                | CWE-400                                                                                                                                 |
| Etkilenen satırlar | backend/src/middlewares/security.middleware.ts:56, backend/src/middlewares/security.middleware.ts:60, backend/tests/arka uç.test.ts:942 |

#### Özet

küresel IP limiti CORS kontrolünden önce çalıştığı için saldırgan sayfası kurban tarayıcısından reddedilecek istekler göndererek aynı IP/NAT üzerindeki meşru API erişimini 15 dakika engelleyebilir.

#### Kök Neden

Reddedilecek tarayıcı Çapraz kaynaklı istekleri kaynak/getirme üst verisi politikası uygulanmadan ortak küresel IP kota havuzuna yazılıyor.

**sınırlayıcı CORS'tan önce** — `backend/src/middlewares/security.middleware.ts:56`

Reddedilecek Çapraz kaynaklı trafik önce kota tüketir.

```typescript
app.use('/api', globalLimiter); ... app.use(cors({ ... }));
```

**Davranış testi** — `backend/tests/backend.test.ts:942`

depo testi mekanizmayı doğrular.

```typescript
test('genel rate limiter CORS tarafından reddedilen 101. API isteğini de engeller', async () => { ... assert.equal(response?.status, 429); });
```

#### Doğrulama

globalLimiter /api altında CORS'tan önce monte edilir. depo testi 101 izin verilmeyen-kaynak isteğinin 429 ürettiğini gösterir.

**sınırlayıcı CORS'tan önce** — `backend/src/middlewares/security.middleware.ts:56`

Reddedilecek Çapraz kaynaklı trafik önce kota tüketir.

```typescript
app.use('/api', globalLimiter); ... app.use(cors({ ... }));
```

**Davranış testi** — `backend/tests/backend.test.ts:942`

depo testi mekanizmayı doğrular.

```typescript
test('genel rate limiter CORS tarafından reddedilen 101. API isteğini de engeller', async () => { ... assert.equal(response?.status, 429); });
```

#### Veri Akışı

Çapraz kaynaklı istek -\> IP kota havuzu artar -\> CORS sonra 403 verir -\> 100 istek sonrası sınırlayıcı önce 429 döndürür -\> meşru istekler rota'a ulaşamaz.

#### Erişilebilirlik

CORS yanıtı okumayı engeller, isteği göndermeyi değil. Etki 15 dakikalık pencere ve IP/NAT kapsamındadır.

#### Önem düzeyi

**orta** — Saldırı kimlik doğrulamasız ve tarayıcıdan tekrarlanabilir; etki IP/IPv6 /56 veya ortak NAT ile sınırlı olsa da giriş, çıkış ve panelleri keser.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

Katı kaynak ve Getirme Üst Verisi kontrollerini uygulama kotasından önce çalıştırın. Uç katman volumetrik limiti ayrı tutun; genel erişime açık/giriş/kimliği doğrulanmış kota havuzlarını ayırın ve kimliği doğrulanmış trafiği IP yanında oturum/kullanıcı ile anahtarlayın.

Testler:

- izin verilmeyen-kaynak istekleri kimliği doğrulanmış kotasını tüketmemelidir.
- çıkış/genel erişime açık/kimliği doğrulanmış kota havuzu'ları bağımsız sınanmalıdır.

Önleyici kontroller:

- CORS öncesi Getirme Üst Verisi/kaynak reddi
- Ayrı quota kota havuzu'ları
- Uç katman hız sınırlaması

<a id="finding-4"></a>

### [4] Ödeme akışı taşıyıcı anahtarı süre sonu ve terminal/arşiv durumlarından sonra geçerli kalıyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | orta                                                                                                                                                                                                                                                                             |
| Güven              | yüksek                                                                                                                                                                                                                                                                           |
| Güven gerekçesi    | assertPaymentFlowAccess, get/güncelleme/devir ve admin terminal yazımları doğrulandı; belirteç hashini temizleyen geçiş bulunmadı.                                                                                                                                               |
| Kategori           | oturum-ve-yetenek-yaşam-döngüsü                                                                                                                                                                                                                                                  |
| CWE                | CWE-613, CWE-863                                                                                                                                                                                                                                                                 |
| Etkilenen satırlar | backend/src/hizmetler/rezervasyon.service.ts:460, backend/src/hizmetler/rezervasyon.service.ts:563, backend/src/hizmetler/rezervasyon.service.ts:599, backend/src/hizmetler/rezervasyon.service.ts:725, backend/src/routes/admin.routes.ts:295, js/package-builder/başvuru.js:68 |

#### Özet

Ödeme akışı erişim kontrolü yalnız kaynak ve belirteç hashini doğruluyor; devir, onay, ret ve arşiv anahtarı iptal etmiyor, böylece ele geçirilmiş yetenek PII okumayı sürdürür ve arşivli beklemede kayıtlar mutasyona açık kalabilir.

#### Kök Neden

taşıyıcı yetenek süre, deletedAt ve izin verilen yaşam döngüsü durum ile bağlı değil; terminal/geçiş işlemleri paymentFlowTokenHash'i iptal etmiyor.

**Erişim yalnız kaynak/özet** — `backend/src/services/booking.service.ts:460`

Süre veya yaşam döngüsü durum kontrol edilmez.

```typescript
if (
  application.source !== "PUBLIC_FORM" ||
  !application.paymentFlowTokenHash ||
  !tokenHashesMatch(paymentFlowKey, application.paymentFlowTokenHash)
) {
  throw new AppError("Ödeme akışı bulunamadı.", 404);
}
```

**yetenek geniş PII döndürüyor** — `backend/src/services/booking.service.ts:473`

Ele geçirilen yetenek geniş müşteri verisine erişir.

```typescript
return { id, referenceCode, status, brideFirstName, brideLastName, bridePhone, groomFirstName, groomLastName, groomPhone, primaryEmail, ... }
```

#### Doğrulama

assertPaymentFlowAccess yalnız PUBLIC_FORM ve özet eşleşmesini kontrol eder. GET geniş PII döndürür; güncelleme/devir deletedAt filtresi kullanmaz; admin geçişleri tokenı temizlemez.

**Erişim yalnız kaynak/özet** — `backend/src/services/booking.service.ts:460`

Süre veya yaşam döngüsü durum kontrol edilmez.

```typescript
if (
  application.source !== "PUBLIC_FORM" ||
  !application.paymentFlowTokenHash ||
  !tokenHashesMatch(paymentFlowKey, application.paymentFlowTokenHash)
) {
  throw new AppError("Ödeme akışı bulunamadı.", 404);
}
```

**yetenek geniş PII döndürüyor** — `backend/src/services/booking.service.ts:473`

Ele geçirilen yetenek geniş müşteri verisine erişir.

```typescript
return { id, referenceCode, status, brideFirstName, brideLastName, bridePhone, groomFirstName, groomLastName, groomPhone, primaryEmail, ... }
```

#### Veri Akışı

yetenek ortak sekme/sessionStorage'dan alınır -\> üstbilgi ile yeniden oynatma -\> özet kontrolü geçer -\> süre sonu/terminal/silinmiş durum dikkate alınmadan PII veya arşivlenmiş beklemede mutasyonu gerçekleşir.

#### Erişilebilirlik

Brute force gerçekçi değildir; yetenek çiftinin ele geçirilmesi gerekir. Ele geçirildiğinde sunucu tarafı yaşam döngüsü iptal yoktur.

#### Önem düzeyi

**orta** — Anahtar yüksek entropili ve ele geçirilmesi gerekir; paylaşılan/açık tab veya sessionStorage maruziyetinde kapsamlı PII'ya yaşam döngüsü sonrasında da erişim verir.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

Get/güncelleme/devir sorgularını deletedAt:null, durum izin listesi'i ve mutlak okuma/yazma süre sonu ile sınırlandırın. devir, onay, ret, arşiv ve süre sonu sırasında belirteç hashini aynı işlemde null yapın/yenileyin edin; devir sonrası yalnız asgari durum yetenek kullanın.

Testler:

- devir/onay/ret/arşiv/süre sonu sonrası eski belirteç 404/410 vermelidir.
- Arşivli beklemede kayıt taşıyıcı ile değiştirilememelidir.

Önleyici kontroller:

- durum-bound yetenek
- Terminal belirteç iptal
- Asgari devir sonrası DTO

<a id="finding-5"></a>

### [5] Yerel statik sunucu depo kökünü tüm ağ arayüzlerine yayımlıyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Önem düzeyi        | orta                                                                                                                                                   |
| Güven              | yüksek                                                                                                                                                 |
| Güven gerekçesi    | Sunucu kökü, dosya akışı, bağlama adresi ve başlatıcı kaynakta doğrulandı; backend/.env ile .git/yapılandırma varlığı içerikleri okunmadan doğrulandı. |
| Kategori           | hassas-dosya-açığa-çıkması                                                                                                                             |
| CWE                | CWE-552                                                                                                                                                |
| Etkilenen satırlar | tools/serve.mjs:8, tools/serve.mjs:48, tools/serve.mjs:52, sunucu_baslat.ps1:17, sunucu_baslat.ps1:25                                                  |

#### Özet

Geliştirme sunucusu depo kökünü 0.0.0.0 üzerinde servis ederek çalıştığı sırada backend/.env, .git ve özel kaynak dosyalarını LAN veya yönlendirilmiş port üzerinden okunabilir kılabilir.

#### Kök Neden

Statik kök yayımlanabilir genel erişime açık dizini yerine tüm depo; izin listesi yok ve sunucu loopback yerine 0.0.0.0'a bağlanıyor.

**Depo kökü web kökü** — `tools/serve.mjs:8`

Statik kök tüm depo'dir.

```javascript
const rootDir = path.resolve(__dirname, "..");
```

**Ağdan genel dosya akışı** — `tools/serve.mjs:48`

Dosya izin listesi'i yoktur ve tüm arayüzlere bağlanır.

```javascript
fs.createReadStream(filePath).pipe(res); ... server.listen(port, "0.0.0.0", () => {
```

#### Doğrulama

tools/serve.mjs herhangi bir dosyayı rootDir altından stream eder ve 0.0.0.0 üzerinde dinler. sunucu_baslat.ps1 bu yolu kalıcı başlatır; üretim kalıp'ı yalnız ön yüz izin listesi'ini kopyalar.

**Depo kökü web kökü** — `tools/serve.mjs:8`

Statik kök tüm depo'dir.

```javascript
const rootDir = path.resolve(__dirname, "..");
```

**Ağdan genel dosya akışı** — `tools/serve.mjs:48`

Dosya izin listesi'i yoktur ve tüm arayüzlere bağlanır.

```javascript
fs.createReadStream(filePath).pipe(res); ... server.listen(port, "0.0.0.0", () => {
```

#### Veri Akışı

İstek yolu depo köküyle birleşir -\> fs.stat dosyayı kabul eder -\> fs.createReadStream içeriği HTTP yanıtına taşır.

#### Erişilebilirlik

Yalnız geliştirme sunucusu çalışırken ve saldırgan porta erişebildiğinde geçerlidir; üretim Nginx etkilenmez.

#### Önem düzeyi

**orta** — Sır ve kaynak kod sızıntısının etkisi yüksek olsa da yol üretim Nginx'ini değil, geliştirme makinesinde açıkça başlatılan yerel sunucuyu etkiler.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

Yalnız yayımlanabilir ön yüz içeren ayrı genel erişime açık/build kökü kullanın, realpath sınırlama doğrulayın, dotfile/backend/dağıtım/env yollarını reddedin ve varsayılan bağlama adresini 127.0.0.1 yapın. Python fallback'i aynı kurallarla sınırlandırın.

Testler:

- /backend/.env ve /.git/yapılandırma 403/404 dönmelidir.
- Varsayılan dinleme adresi 127.0.0.1 olmalıdır.

Önleyici kontroller:

- Ayrı genel erişime açık kökü
- Gerçek yol sınırlama
- Loopback varsayılanı

<a id="finding-6"></a>

### [6] Üretim eylemi ve konteyner tabanları değişebilir etiketlere bağlı

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Önem düzeyi        | düşük                                                                                           |
| Güven              | yüksek                                                                                          |
| Güven gerekçesi    | eylem/kalıp referansları ve bunlara verilen SSH/DB/encryption gizli bilgi yetkileri doğrulandı. |
| Kategori           | tedarik-zinciri-bütünlüğü                                                                       |
| CWE                | CWE-494                                                                                         |
| Etkilenen satırlar | .github/workflows/dağıtım.yml:35, Dockerfile:1, backend/Dockerfile:1, compose.üretim.yaml:11    |

#### Özet

SSH dağıtım eylem ve Node/Nginx/Postgres tabanları tam commit/digest yerine etiketle seçildiği için üst kaynak etiket ele geçirilmesi sonraki deployda üretim sırları ve sunucu yetkisine ulaşabilir.

#### Kök Neden

Üçüncü taraf çalıştırılabilir yapıt referansları içerik adresli commit SHA/kalıp digest ile sabitlenmemiş.

**SSH eylem tag ile seçiliyor** — `.github/workflows/deploy.yml:35`

Tam commit SHA pin'i yoktur.

```yaml
uses: appleboy/ssh-action@v1.0.3
```

**Taban kalıp tagi** — `backend/Dockerfile:1`

İçerik digest ile sabit değildir.

```text
FROM node:22-bookworm-slim AS dependencies
```

#### Doğrulama

Workflow appleboy/ssh-eylem@v1.0.3 kullanıp SSH anahtar verir. Docker/compose node:22-bookworm-slim, nginx:stable-alpine ve postgres:17-alpine'i digest olmadan kullanır.

**SSH eylem tag ile seçiliyor** — `.github/workflows/deploy.yml:35`

Tam commit SHA pin'i yoktur.

```yaml
uses: appleboy/ssh-action@v1.0.3
```

**Taban kalıp tagi** — `backend/Dockerfile:1`

İçerik digest ile sabit değildir.

```text
FROM node:22-bookworm-slim AS dependencies
```

#### Veri Akışı

Mutable tag başka içeriğe taşınır -\> dağıtım indirir/çalıştırır -\> eylem SSH anahtar'i veya kalıp DB/encryption sırlarını görür -\> kompromis.

#### Erişilebilirlik

depo değişikliği gerekmez; üst kaynak ele geçirilmesi ve yeni dağıtım gerekir.

#### Önem düzeyi

**düşük** — Etki tam üretim kompromisidir; ancak güvenilen üst kaynak/registry yayın zincirinin ele geçirilmesi gibi düşük olasılıklı önkoşula bağlıdır.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

appleboy eylem'ı incelenmiş tam commit SHA'sına; Node/Nginx/Postgres kalıp'larını doğrulanmış sha256 digestlerine sabitleyin. Güncellemeleri kontrollü PR'larla yapın ve dağıtım hesabını daraltın.

Testler:

- eylem referansları tam SHA olmalıdır.
- üretim kalıp referansları @sha256 digest içermelidir.

Önleyici kontroller:

- Commit SHA pinning
- OCI digest pinning
- Dar dağıtım hesabı

<a id="finding-7"></a>

### [7] Geçici parolanın düz metin görüntülenmesi denetim kaydı kaydı oluşturmuyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Önem düzeyi        | düşük                                                                                                                                                              |
| Güven              | yüksek                                                                                                                                                             |
| Güven gerekçesi    | Liste, şifre çözme, görüntüleme yanıt ve komşu mark-sent/reset denetim kaydı akışları karşılaştırıldı.                                                             |
| Kategori           | yetersiz-kayıt-tutma                                                                                                                                               |
| CWE                | CWE-778                                                                                                                                                            |
| Etkilenen satırlar | backend/src/routes/admin.routes.ts:2279, backend/src/routes/admin.routes.ts:2226, backend/src/routes/admin.routes.ts:2241, backend/src/routes/admin.routes.ts:2183 |

#### Özet

ADMIN message-task görüntüleme endpointi şifreli aktivasyon/reset parolasını çözüp yanıtta döndürürken hangi adminin kimlik bilgisi'ı görüntülediğini AuditLog'a yazmıyor ve tek-görüntüleme uygulamıyor.

#### Kök Neden

kimlik bilgisi görüntüleme okuma işlemi güvenlik olayı olarak modellenmemiş; düz metin yanıt sonrasında yalnızca eklemeli denetim kaydı/tek seferlik görüntüleme durum'i yok.

**Geçici parola çözülüyor** — `backend/src/routes/admin.routes.ts:2226`

gizli bilgi düz metin'e dönüşür.

```typescript
const password = decryptValue({ ciphertext: task.secretCiphertext, iv: task.secretIv, authTag: task.secretAuthTag }, ...);
```

**düz metin yanıt denetim kaydı olmadan** — `backend/src/routes/admin.routes.ts:2279`

rota içinde createAudit yoktur.

```typescript
router.get("/message-tasks/:id/render", ... res.json({ success: true, data: { message: rendered.message, ... } }));
```

#### Doğrulama

renderMessage ACCOUNT_ACTIVATION/PASSWORD_RESET secretini decryptValue ile çözüp GET yanıt message alanında döndürür. uç nokta createAudit çağırmaz; mark-sent ve reset denetim kaydı yazar.

**Geçici parola çözülüyor** — `backend/src/routes/admin.routes.ts:2226`

gizli bilgi düz metin'e dönüşür.

```typescript
const password = decryptValue({ ciphertext: task.secretCiphertext, iv: task.secretIv, authTag: task.secretAuthTag }, ...);
```

**düz metin yanıt denetim kaydı olmadan** — `backend/src/routes/admin.routes.ts:2279`

rota içinde createAudit yoktur.

```typescript
router.get("/message-tasks/:id/render", ... res.json({ success: true, data: { message: rendered.message, ... } }));
```

#### Veri Akışı

Task listesi -\> ID -\> görüntüleme -\> encrypted gizli bilgi şifre çözme -\> düz metin JSON -\> denetim kaydı olmadan tekrarlı görüntüleme.

#### Erişilebilirlik

ADMIN rolü gerekir; kimlik bilgisi görüntüleme işlevin parçasıdır fakat hesap verebilirlik eksiktir.

#### Önem düzeyi

**düşük** — uç nokta güçlü admin oturum/rol ve no-store ile korunur; risk kötü niyetli/ele geçirilmiş adminin kimlik bilgisi erişiminde hesap verebilirlik eksikliğidir.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

kimlik bilgisi görüntülemeyi ayrı sonrası ve mümkünse ek doğrulama doğrulamalı yetkiye taşıyın. Başarılı/başarısız görüntülemede actorUserId, taskId, weddingId, kind içeren ama gizli bilgi içermeyen denetim kaydı yazın; uygun ise tek-görüntüleme kullanın.

Testler:

- kimlik bilgisi görüntüleme denemeleri gizli bilgi içermeyen AuditLog üretmelidir.
- Tek-görüntüleme seçilirse ikinci görüntüleme reddedilmelidir.

Önleyici kontroller:

- kimlik bilgisi erişim denetim kaydı
- Step-up auth
- One-time view

<a id="finding-8"></a>

### [8] Salon operasyon API'leri gerekli olmayan düğün alanlarını döndürüyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | düşük                                                                                                                                                                                                               |
| Güven              | yüksek                                                                                                                                                                                                              |
| Güven gerekçesi    | Include şekli, JSON dönüşleri, Prisma modeli ve ön yüz kullanımı karşılaştırıldı.                                                                                                                                   |
| Kategori           | hassas-veri-açığa-çıkması                                                                                                                                                                                           |
| CWE                | CWE-201                                                                                                                                                                                                             |
| Etkilenen satırlar | backend/src/routes/operations.routes.ts:66, backend/src/routes/operations.routes.ts:153, backend/src/routes/operations.routes.ts:317, backend/src/routes/operations.routes.ts:332, backend/prisma/schema.prisma:268 |

#### Özet

Prisma dahil etme Wedding modelinin tüm skaler alanlarını döndürerek salon yetkilisine operasyon için gereksiz primaryEmail, başvuruId, customerUserId ve fiyat snapshotlarını açıyor.

#### Kök Neden

Özet/liste/detay için açık seçim/DTO yerine ilişki dahil etme kullanılıyor ve tüm Wedding scalarları doğrudan yanıta gidiyor.

**Scalarlar daraltılmıyor** — `backend/src/routes/operations.routes.ts:66`

Prisma dahil etme tüm Wedding scalarlarını korur.

```typescript
const weddingIncludeForVenue = (venueId: string) => ({ venue: { select: { id: true, name: true } }, assignments: { ... } }) satisfies Prisma.WeddingInclude;
```

**Geniş nesne doğrudan dönüyor** — `backend/src/routes/operations.routes.ts:153`

Asgari DTO uygulanmaz.

```typescript
res.json({ success: true, data: { ... todayWeddings, weekWeddings, ... }, correlationId: req.correlationId });
```

#### Doğrulama

weddingIncludeForVenue relationları tanımlar, skaler seçim kullanmaz. Dashboard/list/detail geniş nesneyi JSON'a koyar; model gereksiz e-posta/iç ID/packageSummary alanlarını içerir.

**Scalarlar daraltılmıyor** — `backend/src/routes/operations.routes.ts:66`

Prisma dahil etme tüm Wedding scalarlarını korur.

```typescript
const weddingIncludeForVenue = (venueId: string) => ({ venue: { select: { id: true, name: true } }, assignments: { ... } }) satisfies Prisma.WeddingInclude;
```

**Geniş nesne doğrudan dönüyor** — `backend/src/routes/operations.routes.ts:153`

Asgari DTO uygulanmaz.

```typescript
res.json({ success: true, data: { ... todayWeddings, weekWeddings, ... }, correlationId: req.correlationId });
```

#### Veri Akışı

Venue sorgusu -\> Prisma tüm scalarlar -\> DTO daraltması yok -\> e-posta/iç kimlik/fiyat toplanır.

#### Erişilebilirlik

rol ve salon sınırı etkilidir; yalnız kendi salon verisi görünür.

#### Önem düzeyi

**düşük** — Erişim aynı salon ile doğru sınırlandırılmıştır; risk ele geçirilmiş salon hesabında ihlal kapsamını büyütür ve cross-salon erişim sağlamaz.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

uç nokta-özel açık Prisma seçim/DTO tanımlayın. primaryEmail, başvuruId, customerUserId ve fiyat dökümünü gereksinim yoksa çıkarın; negatif yanıt-contract testleri ekleyin.

Testler:

- Operations yanıt'larında gereksiz e-posta/iç ID/fiyat alanları bulunmamalıdır.

Önleyici kontroller:

- açık Prisma seçim
- uç nokta DTO
- Negatif contract testi

<a id="finding-9"></a>

### [9] Geçersiz Ödeme akışı GET isteği küresel süre sonu süpürmesini tetikleyebiliyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Önem düzeyi        | düşük                                                                                                                                                                    |
| Güven              | orta                                                                                                                                                                     |
| Güven gerekçesi    | Pahalı işin doğrulamadan önce çağrıldığı kesin; gerçek kilit/gecikme etkisinin büyüklüğü çalışma zamanı birikmiş iş ve DB kapasitesine bağlı.                            |
| Kategori           | kaynak-tüketimi                                                                                                                                                          |
| CWE                | CWE-400                                                                                                                                                                  |
| Etkilenen satırlar | backend/src/hizmetler/rezervasyon.service.ts:563, backend/src/hizmetler/rezervasyon.service.ts:516, backend/src/routes/public.routes.ts:180, backend/src/bootstrap.ts:22 |

#### Özet

Kimliksiz GET, başvuru ve taşıyıcı doğrulanmadan önce 100 kayda kadar küresel süre sonu işlem'ı çalıştırarak birikmiş iş ve eşzamanlılık koşullarında veritabanı işini büyütebilir.

#### Kök Neden

Küresel bakım işi anonim arama istek yolunda hedef ve yetenek doğrulanmadan çalıştırılıyor; istek kaynaklı çağrılar tekilleştirilmiyor.

**Süpürme aramadan önce** — `backend/src/services/booking.service.ts:563`

Geçersiz taşıyıcı bile küresel işi tetikler.

```typescript
await expireStalePaymentFlows(new Date(), correlationId); const application = await prisma.bookingApplication.findUnique(...); assertPaymentFlowAccess(application, paymentFlowKey);
```

**100 kayıtlık işlem** — `backend/src/services/booking.service.ts:516`

Tek istek çoklu DB mutasyonu tetikleyebilir.

```typescript
const expiredCandidates = await transaction.bookingApplication.findMany({ ... take: 100 }); for (const candidate of expiredCandidates) { ... }
```

#### Doğrulama

getPaymentFlowApplication ilk olarak expireStalePaymentFlows çağırır; bu fonksiyon 100 küresel aday seçip her biri için updateMany/denetim kaydı yapabilir. arka plan işleyici zaten 60 saniyede bir aynı işi yapar.

**Süpürme aramadan önce** — `backend/src/services/booking.service.ts:563`

Geçersiz taşıyıcı bile küresel işi tetikler.

```typescript
await expireStalePaymentFlows(new Date(), correlationId); const application = await prisma.bookingApplication.findUnique(...); assertPaymentFlowAccess(application, paymentFlowKey);
```

**100 kayıtlık işlem** — `backend/src/services/booking.service.ts:516`

Tek istek çoklu DB mutasyonu tetikleyebilir.

```typescript
const expiredCandidates = await transaction.bookingApplication.findMany({ ... take: 100 }); for (const candidate of expiredCandidates) { ... }
```

#### Veri Akışı

istek -\> küresel süpürme -\> hedef arama/taşıyıcı kontrolü -\> 404.

#### Erişilebilirlik

Her istek küresel sınırlayıcı altındadır; anlamlı etki için süresi dolmuş birikmiş iş ve eşzamanlı çağrılar gerekir.

#### Önem düzeyi

**düşük** — Etki süre sonu birikmiş iş ve eşzamanlı istek önkoşullarına bağlıdır; küresel IP limiti, en fazla 100 kayıt ve koşullu sahiplenmeler büyütmeyi sınırlar.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

küresel süpürmeyi yalnız arka plan işleyiciye taşıyın. tembel süre sonu gerekiyorsa doğru taşıyıcı sonrası yalnız hedef ID'de koşullu güncelleme yapın. işleyicide eşzamanlılık/zaman aşımı ve kilitli kayıtları atlama benzeri sahiplenme, GET'te dar limit kullanın.

Testler:

- Yanlış taşıyıcı/UUID küresel süpürme çağırmamalıdır.
- Eşzamanlı süpürme tek işleyici/güvenli sahiplenme ile çalışmalıdır.

Önleyici kontroller:

- yalnızca arka plan bakımı
- hedef-yerel süre sonu
- eşzamanlılık sınırı

<a id="finding-10"></a>

### [10] Üretim CSP satır içi betik çalıştırılmasına izin veriyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | düşük                                                                                             |
| Güven              | yüksek                                                                                            |
| Güven gerekçesi    | Nginx üstbilgi varyantları ve satır içi başlatma/yüklenme ihtiyacı doğrulandı.                    |
| Kategori           | security-misconfiguration                                                                         |
| CWE                | CWE-693                                                                                           |
| Etkilenen satırlar | dağıtım/nginx.conf:15, dağıtım/nginx.conf:33, dağıtım/nginx.conf:43, index.html:49, index.html:60 |

#### Özet

script-src 'unsafe-inline' satır içi olay işleyici ve scriptleri çalıştırabildiği için mevcut veya gelecekteki işaretleme enjeksiyonu kusurlarında CSP bağımsız sınırlama sağlamıyor.

#### Kök Neden

Inline tema/yazı tipi kodu dış dosyaya taşınmadığı için üretim script-src unsafe-inline ile genişletilmiş.

**üretim CSP gevşek** — `deploy/nginx.conf:15`

Inline betik/olay işleyici çalışabilir.

```text
script-src 'self' 'unsafe-inline';
```

**Inline kod mevcut** — `index.html:60`

Inline başlatma gevşekliğin gerekçesidir.

```text
<script>document.documentElement.classList.add("js");</script>
```

#### Doğrulama

Nginx üç yanıt konumunda script-src 'self' 'unsafe-inline' döndürür; index.html satır içi yüklenme/betik içerir.

**üretim CSP gevşek** — `deploy/nginx.conf:15`

Inline betik/olay işleyici çalışabilir.

```text
script-src 'self' 'unsafe-inline';
```

**Inline kod mevcut** — `index.html:60`

Inline başlatma gevşekliğin gerekçesidir.

```text
<script>document.documentElement.classList.add("js");</script>
```

#### Veri Akışı

işaretleme enjeksiyonu -\> satır içi olay işleyici/betik -\> CSP izin verir -\> kaynak'de kod.

#### Erişilebilirlik

Ek bir işaretleme enjeksiyonu kusuru gerekir.

#### Önem düzeyi

**düşük** — olağan genel erişime açık inputtan doğrulanmış XSS zinciri bulunmadı; doğrudan kompromisten çok savunma derinliği kaybıdır.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

Inline başlatma ve yüklenme işleyiciyi aynı kaynaklı modüle taşıyın veya tek kullanımlık değer/özet kullanın. script-src içinden unsafe-inline'ı kaldırın; style-src geçişini ayrı yönetin.

Testler:

- üretim CSP script-src unsafe-inline içermemelidir.

Önleyici kontroller:

- harici modules
- tek kullanımlık değer/özet CSP
- CSP regression testi

<a id="finding-11"></a>

### [11] genel erişime açık uygunluk uç noktası salonların kesin doluluk saatlerini açığa çıkarıyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | düşük                                                                                                                               |
| Güven              | yüksek                                                                                                                              |
| Güven gerekçesi    | genel erişime açık salon/uygunluk rotaları ve kesin doluZamanDilimleri dönüşü doğrulandı.                                           |
| Kategori           | bilgi-açığa-çıkması                                                                                                                 |
| CWE                | CWE-200                                                                                                                             |
| Etkilenen satırlar | backend/src/routes/public.routes.ts:137, backend/src/hizmetler/rezervasyon.service.ts:1041, backend/src/routes/public.routes.ts:116 |

#### Özet

Anonim rakip, genel erişime açık salon UUID'leriyle tarih tarih sorgulayarak düğün ve aktif başvuruların dakika hassasiyetindeki başlangıç/bitiş slotlarını haritalayabilir.

#### Kök Neden

genel erişime açık uygunluk cevabı minimum uygun/uygun değil yerine kesin başlangıç/bitiş slotları ve sınırsız tarih ufku döndürüyor.

**Anonim rota** — `backend/src/routes/public.routes.ts:137`

Kimlik doğrulama gerektirmez.

```typescript
router.get("/venues/:venueId/availability", validateRequest(availabilitySchema), ...);
```

**Kesin saatler** — `backend/src/services/booking.service.ts:1082`

Başlangıç/bitiş dakikası açılır.

```typescript
slotsMap.set(`${s}-${e}`, { startTime: s, endTime: e });
```

#### Doğrulama

genel erişime açık /salons UUID'leri verir; uygunluk yalnız UUID/tarih doğrular; servis Wedding ve BookingApplication aralıklarını başlangıçZamanı/bitişZamanı döndürür.

**Anonim rota** — `backend/src/routes/public.routes.ts:137`

Kimlik doğrulama gerektirmez.

```typescript
router.get("/venues/:venueId/availability", validateRequest(availabilitySchema), ...);
```

**Kesin saatler** — `backend/src/services/booking.service.ts:1082`

Başlangıç/bitiş dakikası açılır.

```typescript
slotsMap.set(`${s}-${e}`, { startTime: s, endTime: e });
```

#### Veri Akışı

Venue UUID listesi -\> tarihler üzerinde sorgu -\> gerçek/aktif aralıklar -\> kesin doluZamanDilimleri -\> rakip takvim haritası.

#### Erişilebilirlik

Kimlik doğrulama yoktur; IP limiti uzun süreli/dağıtık veri kazıma'i tamamen engellemez.

#### Önem düzeyi

**düşük** — Yanıt PII içermez ve rezervasyon UX'i için işlevseldir; ancak rakip için operasyon istihbaratı ve kötüye kullanım hedefleme sağlar.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

genel erişime açık yanıtta yalnız uygun/uygun değil veya kaba zaman dilimleri kullanın; tarih ufkunu sınırlandırın. Ayrıntılı takvimi yetkili panellere bırakın ve veri kazıma algılama/kota ekleyin.

Testler:

- genel erişime açık uç nokta minimum detay ve izinli tarih ufku döndürmelidir.

Önleyici kontroller:

- Kaba uygunluk
- Tarih ufku
- veri kazıma tespiti

<a id="finding-12"></a>

### [12] ön yüz çıkış, sunucu iptal başarısız olsa da tamamlanmış gibi yönlendiriyor

> Güncel durum (9 Ağustos 2026): **Çözüldü**

| Alan               | Değer                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | düşük                                                                                                                                           |
| Güven              | yüksek                                                                                                                                          |
| Güven gerekçesi    | Dört ön yüz işleyici ve arka uç iptal başarı yolu doğrulandı.                                                                                   |
| Kategori           | oturum-yaşam-döngüsü                                                                                                                            |
| CWE                | CWE-613                                                                                                                                         |
| Etkilenen satırlar | js/shared/auth-oturum.js:18, js/admin/app.js:2132, js/müşteri-panel/app.js:108, js/operations/app.js:502, backend/src/routes/auth.routes.ts:303 |

#### Özet

Admin, müşteri, operasyon ve ortak üstbilgi çıkış işlemleri 403/429/5xx veya ağ hatasında da giriş/index sayfasına gider; HttpOnly çerez ve sunucu oturum geçerli kalabilir.

#### Kök Neden

İstemci çıkış başarısını sunucu iptal sonucundan ayırıyor ve hata halinde oturum'ın aktif olduğunu kullanıcıya bildirmiyor.

**Hata halinde de yönlendirme** — `js/shared/auth-session.js:18`

sunucu sonucu başarı olarak doğrulanmaz.

```javascript
try { await apiRequest("/auth/logout", { method: "POST" }); } catch (error) { ... } finally { window.location.href = "index.html"; }
```

**iptal yalnız başarı path** — `backend/src/routes/auth.routes.ts:303`

rota'a ulaşılamazsa oturum geçerlidir.

```typescript
await transaction.authSession.updateMany({ ... data: { revokedAt: now } }); ... clearAuthCookies(res);
```

#### Doğrulama

apiRequest hata/2xx dışı yanıt için istisna üretirken çıkış işleyici'ları sonlandırma veya yutulan yakalama sonrası yönlendirir. arka uç iptal/çerez temizleme yalnız rota başarıyla tamamlanırsa çalışır.

**Hata halinde de yönlendirme** — `js/shared/auth-session.js:18`

sunucu sonucu başarı olarak doğrulanmaz.

```javascript
try { await apiRequest("/auth/logout", { method: "POST" }); } catch (error) { ... } finally { window.location.href = "index.html"; }
```

**iptal yalnız başarı path** — `backend/src/routes/auth.routes.ts:303`

rota'a ulaşılamazsa oturum geçerlidir.

```typescript
await transaction.authSession.updateMany({ ... data: { revokedAt: now } }); ... clearAuthCookies(res);
```

#### Veri Akışı

çıkış sonrası başarısız -\> istisna -\> sonlandırma yönlendirme -\> çerez/sunucu oturum değişmez -\> oturum sonraki erişimde kullanılabilir.

#### Erişilebilirlik

Kota tüketimi somut 429 sağlar; güvenlik etkisi paylaşılan cihaz/belirteç senaryosunda oluşur.

#### Önem düzeyi

**düşük** — Etkisi paylaşılan tarayıcı, çalınmış belirteç veya çıkış hatası gibi ek koşullara bağlıdır; başarılı arka uç yolu doğru iptal yapar.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

Yalnız 2xx veya oturum zaten geçersiz diyen 401 sonrası yönlendirin. 403/429/ağ/5xx durumunda sayfada kalıp oturum aktif uyarısı ve yeniden deneme sunun; işleyici'ları ortak yardımcı'da birleştirin.

Testler:

- 429/403/ağ/5xx çıkış hatasında yönlendirme olmamalı ve uyarı gösterilmelidir.

Önleyici kontroller:

- Başarıya bağlı navigasyon
- çıkış ayrı kotası
- Açık failure UX

<a id="finding-13"></a>

### [13] Dağıtım yedekleri saklama olmadan sınırsız birikebiliyor

> Güncel durum (9 Ağustos 2026): **Çözülmedi**

| Alan               | Değer                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Önem düzeyi        | düşük                                                                                                    |
| Güven              | yüksek                                                                                                   |
| Güven gerekçesi    | dağıtım scripti, benzersiz yedek yolu ve saklama adımı yokluğu doğrulandı.                               |
| Kategori           | kaynak-tüketimi                                                                                          |
| CWE                | CWE-770                                                                                                  |
| Etkilenen satırlar | .github/workflows/dağıtım.yml:67, .github/workflows/dağıtım.yml:70, .gitignore:82, dağıtım/README.md:137 |

#### Özet

Her dağıtım benzersiz zaman damgalı tam pg_dump üretirken eski yedekler için yaş/adet/boyut veya boş depolama eşiği uygulanmıyor; zaman içinde depolama dolması hizmeti durdurabilir.

#### Kök Neden

Yedek üretimi için saklama, depolama kapasitesi koruma'ı ve doğrulanmış harici konum yaşam döngüsü bulunmuyor.

**Her dağıtım yeni döküm** — `.github/workflows/deploy.yml:70`

Aynı SHA için bile yeni dosya üretir.

```yaml
backup_path="backups/pre-deploy-${DEPLOY_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

**Yalnız doğrulama** — `.github/workflows/deploy.yml:74`

saklama veya depolama koruma yoktur.

```yaml
test -s "$backup_path"; $compose exec -T postgres pg_restore --list < "$backup_path" >/dev/null
```

#### Doğrulama

Her dağıtım pre-dağıtım-SHA-timestamp.döküm oluşturup yalnız boyut/pg_restore listesi doğrular; eski dosyaları silen/taşıyan adım yoktur.

**Her dağıtım yeni döküm** — `.github/workflows/deploy.yml:70`

Aynı SHA için bile yeni dosya üretir.

```yaml
backup_path="backups/pre-deploy-${DEPLOY_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

**Yalnız doğrulama** — `.github/workflows/deploy.yml:74`

saklama veya depolama koruma yoktur.

```yaml
test -s "$backup_path"; $compose exec -T postgres pg_restore --list < "$backup_path" >/dev/null
```

#### Veri Akışı

Her dağıtım -\> tam pg_dump -\> benzersiz yerel dosya -\> saklama yok -\> depolama dolar -\> PostgreSQL/log/dağıtım yazmaları durur.

#### Erişilebilirlik

Tek çalıştırma sınırlıdır; zaman içinde veya tekrarlı dispatch ile birikim oluşur.

#### Önem düzeyi

**düşük** — Etki gerçek ve kalıcıdır ancak genellikle uzun süreli normal operasyon veya tekrarlı yetkili/ele geçirilmiş dağıtım tetiklemesi gerekir.

Ek çalışma zamanı veya dağıtım kanıtı bu önem düzeyini yükseltebilir ya da düşürebilir.

#### Düzeltme

döküm öncesi minimum boş depolama eşiği koyun. Sabit backups dizini altında güvenli yaş/adet/boyut saklama uygulayın; son doğrulanmış N yedeği koruyup şifreli harici konum depoya aktarın.

Testler:

- saklama yalnız politika dışı dosyaları güvenli sabit dizinde silmelidir.
- Düşük depolama alanında dağıtım fail-closed olmalıdır.

Önleyici kontroller:

- depolama koruma
- saklama
- Şifreli harici konum yedek

## İncelenen Yüzeyler

| Surface                                                 | Risk Area                                 | Outcome         | Notes                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| genel erişime açık rezervasyon, Ödeme akışı ve uygunluk | İş mantığı, PII, uygunluk                 | raporlandı      | Anonim oluşturma/güncelleme/devir, süre sonu, yinelenebilirlik, fiyatlandırma, özel salon ve takvim incelendi. |
| Kimlik doğrulama, oturum, CSRF, CORS ve hız sınırlaması | Hesap ve API kontrol düzlem               | raporlandı      | giriş, çerez, yenileme/süre sonu, CSRF, CORS, vekil güveni ve loglar incelendi.                                |
| müşteri, salon-manager ve admin yetkilendirme           | sahiplik ve ayrıcalıklı operations        | raporlandı      | müşteri sahiplik, salon kapsamlandırma, admin durum, denetim kaydı ve kimlik bilgisi görüntüleme incelendi.    |
| ön yüz DOM, gezinme ve tarayıcı yetenek                 | XSS, yönlendirme, depolama, gizlilik      | raporlandı      | olağan genel erişime açık inputtan doğrulanmış XSS bulunmadı; yaşam döngüsü/çıkış/CSP riskleri raporlandı.     |
| üretim konteynerler, vekil, DB roller ve CI/CD          | Tedarik zinciri, gizli bilgiler, uygunluk | raporlandı      | Bileşim, Docker dosyaları, Nginx, çalışma zamanı DB rol, dağıtım, sağlık ve yedek incelendi.                   |
| yerel geliştirme sunucu                                 | Developer gizli bilgi exposure            | raporlandı      | depo-kök sunma ve bağlama davranışı incelendi.                                                                 |
| SQL, process, filesystem ve execution sinks             | Injection/code execution                  | Sorun bulunmadı | üretim SQL/command enjeksiyonu doğrulanmadı.                                                                   |
| parola, belirteç ve encrypted-Alan depolama             | şifreleme/gizli bilgi işleme              | Sorun bulunmadı | Argon2id, belirteç hashes, AES-256-GCM/AAD, anahtar Doğrulama ve maskeleme incelendi.                          |

## Açık Sorular ve İzleme Adımları

- Canlı Traefik iletilen üstbilgi güveni ve uç katman hız sınırı/WAF kaynak dokümanıyla uyumlu mu?
- Yerel dev sunucu yalnız loopback/güvenilir LAN üzerinde mi ve 8000/TCP dışarı yönlendiriliyor mu?
- Expired genel erişime açık başvurular ve DB yedekleri için onaylı saklama süresi nedir?
- GitHub üretim ortam onaylayıcısı ve dal koruması platform ayarlarında etkin mi?
- Canlı TLS/Traefik/WAF/rate-limit/DNS yüzeyi yalnız izinli dinamik testle doğrulanabilir.
  - İzleme istemi: inceleme ertelenmiş birim deferred_live_dast ve belirtilen kanıt boşluğunu kapat. yollar: compose.üretim.yaml, dağıtım/README.md.
- Güncel dış güvenlik bildirimi/CVE verisi çevrimdışı taramada sorgulanmadı.
  - İzleme istemi: inceleme ertelenmiş birim deferred_dependency_advisories ve belirtilen kanıt boşluğunu kapat. yollar: package-kilit.json, backend/package-kilit.json.
- 170 izlenen dosyanın en az 62'si tamamen incelendi; kalan dosyalar güvenlik yüzeyi odaklı arama/örnekleme ile kapsandı, harfî tamlık iddiası yapılmadı.
  - İzleme istemi: inceleme ertelenmiş birim deferred_full_file_line_review ve belirtilen kanıt boşluğunu kapat.
