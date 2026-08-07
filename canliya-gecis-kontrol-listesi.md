# Canlıya Geçiş Öncesi Uçtan Uca Kontrol Listesi

**Denetim tarihi:** 7 Ağustos 2026  
**Denetlenen revizyon:** `5fc5216`  
**Kapsam:** Kullanıcı deneyimi, responsive tasarım, erişilebilirlik, içerik, KVKK/gizlilik, frontend, backend, veritabanı, güvenlik, testler, Docker/dağıtım ve operasyon  
**Mevcut karar:** **NO-GO — P0 maddeleri kapanmadan canlıya çıkılmamalı.**

## Öncelik tanımları

- **P0:** Canlıya çıkışı durdurur; işlev, hukuk, veri güvenliği veya işletim riski doğurur.
- **P1:** Canlıdan önce tamamlanması beklenir; ertelenirse açık risk kabulü gerekir.
- **P2:** İlk stabil sürüm için planlanmalı; kalite, performans ve erişilebilirliği etkiler.
- **P3:** Canlı sonrası iyileştirme havuzu.

## Denetimde geçen kontroller

- [x] `npm run validate`: Prettier, ESLint, Stylelint ve HTML doğrulaması geçti.
- [x] `npm run audit:performance`: mevcut statik performans bütçesi geçti.
- [x] `npm run test:e2e`: 45 test geçti, 1 test atlandı.
- [x] `backend/npm test`: derleme, test typecheck ve 43 test geçti.
- [x] Frontend ve backend üretim bağımlılık denetiminde yüksek/kritik açık bulunmadı.
- [x] Standard güvenlik taraması tamamlandı: **2 orta, 2 düşük** doğrulanmış bulgu; kritik/yüksek bulgu yok. Tarama kimliği: `8b93eb43-fc2e-4c7d-bffb-c9812f1963f1`.
- [x] `docker compose ... config -q`: sentetik üretim değişkenleriyle yapılandırma doğrulandı.
- [x] 1440×900, 768×1024 ve 375×812 görsel kontrollerinde yatay taşma görülmedi.
- [x] Ana sayfa mobil menüsünde odak yönetimi, `inert`, Escape ve ARIA durumları çalıştı.
- [x] Yerel HTML/CSS asset taramasında kırık dosya referansı bulunmadı.
- [ ] Veritabanı entegrasyon testleri çalıştırılamadı; Docker Desktop daemon erişilebilir değildi.
- [ ] Üretim Docker imajları build/run edilerek gerçek Nginx, backend ve Postgres davranışı doğrulanmadı.

## P0 — Canlıya çıkış bloklayıcıları

### P0-01 — Ödeme ve WhatsApp akışını gerçeğe uygun hale getir

- [ ] Ürün kararını netleştir: akış ya gerçek ödeme/dekont akışı olacak ya da açıkça “başvuru gönder” akışına çevrilecek.
- [ ] Ödeme kullanılacaksa banka adı, hesap sahibi, IBAN, ödeme bildirimi endpoint'i ve doğrulanmış WhatsApp hattını üretim ayarlarından sağla.
- [ ] Ödeme kullanılmayacaksa “Siparişi tamamla”, “ödeme”, “dekont gönder” ve benzeri tüm vaatleri kaldır.
- [ ] Başarı ekranında yalnızca gerçekten kullanılabilen sonraki adımı göster; eksik konfigürasyonda başarılı sipariş algısı oluşturma.
- [ ] Başarı, eksik konfigürasyon, API hatası ve tekrar gönderim senaryolarını gerçek cihazda test et.

**Kapanış ölçütü:** Kullanıcı ödeme/başvuru sonrasında çalışan tek bir kanala ulaşabiliyor; gösterilen tutar ve talimat backend kaydıyla birebir eşleşiyor.  
**Kanıt:** `js/package-builder/application.js:36-41,912-925`, `paketini-olustur.html:642-701,790-844`

### P0-02 — İletişim kanallarını ve yasal metinleri tamamla

- [ ] Veri sorumlusunun tam ticari unvanını, açık adresini, telefonunu, e-posta/KEP bilgisini ve veri sahibi başvuru kanalını yayımla.
- [ ] KVKK aydınlatma metnindeki “daha sonra eklenecek/yayımlanacak” ifadelerini kaldır; amaç, hukuki sebep, veri kategorileri, alıcılar, saklama süresi, toplama yöntemi ve hakları gerçek akışla eşleştir.
- [ ] Gizlilik politikasını gerçek üretim saklama, log, yedekleme, çerez ve üçüncü taraf aktarım düzeniyle güncelle.
- [ ] Kullanım şartlarına hizmet kapsamı, teslimat, ödeme, iptal/iade, cayma, uyuşmazlık ve sorumluluk hükümlerini eklet.
- [ ] WhatsApp, Google Fonts, Supabase/Drive ve kullanılan diğer dış hizmetlere veri aktarımını hukuk danışmanıyla doğrula.
- [ ] Footer, hero CTA, giriş/parola sıfırlama, başarı ekranı ve yasal sayfalardaki tüm iletişim bağlantılarını gerçek cihazdan test et.
- [ ] Nihai metinler için hukuk/onay kaydını sürüm kanıtına ekle.

**Kapanış ölçütü:** Taslak ifade kalmıyor; kullanıcı satış, destek, parola kurtarma ve veri sahibi talebi için çalışan kanala ulaşabiliyor.  
**Kanıt:** `kvkk-aydinlatma.html:16-20,34-37`, `gizlilik-politikasi.html:21-30`, `index.html:193-200,1468-1517`, `login.html:226-228`

### P0-03 — Anonim başvuruların takvimi süresiz kilitlemesini engelle

- [ ] `BookingApplication` için kısa ömürlü bir `expiresAt`/soft-hold modeli ve güvenilir temizleme işi ekle.
- [ ] Çatışma ve müsaitlik sorgularında süresi dolmuş bekleyen başvuruları yok say.
- [ ] Uzun süreli blokajı OTP ile doğrulanmış iletişim, depozito veya yönetici onayı sonrasına bırak.
- [ ] İleri tarih ufku ile mekân/tarih/iletişim bazlı kota uygula; çoklu instance için dağıtık rate limiter kullan.
- [ ] Süre dolumu, yeniden deneme, yarış durumu, kota ve gerçek başvurunun engellenmemesi için entegrasyon testleri ekle.

**Kapanış ölçütü:** Anonim bir istemci, düşük sayıda istekle bir veya daha fazla salonu süresiz kapatamıyor.  
**Güvenlik şiddeti:** Orta — `PUBLIC-PENDING-BOOKING-HOLD-EXPIRY` / CWE-770; iş etkisi nedeniyle genel yayın önceliği P0  
**Kanıt:** `backend/src/routes/public.routes.ts:16-23,84-111`, `backend/src/services/booking.service.ts:230-310,630-639`, `backend/prisma/schema.prisma:189-237`

### P0-04 — Yerel statik sunucunun depo ve sır dosyalarını yayımlamasını engelle

- [ ] `tools/serve.mjs` için web kökünü depo kökü yerine yalnızca yayımlanabilir `public/build` çıktısına sabitle.
- [ ] Varsayılan dinleme adresini `127.0.0.1` yap; ağ erişimini açık ve bilinçli bir seçenek haline getir.
- [ ] `.git`, `backend`, `deploy`, dotfile ve env yollarını reddet; gerçek yol ve symlink containment denetimi uygula.
- [ ] Hassas yolların 404/403 döndürdüğünü otomatik test et.
- [ ] Bu sunucu güvenilmeyen bir ağa veya internete açıldıysa veritabanı parolası ve veri şifreleme anahtarı için olay değerlendirmesi yap; gerekiyorsa sırları döndür.

**Kapanış ölçütü:** Statik sunucu yalnızca frontend allowlist'ini sunuyor ve LAN'dan hassas dosya okunamıyor.  
**Güvenlik şiddeti:** Orta — `STATIC-SERVER-REPOSITORY-DISCLOSURE` / CWE-552; resmi üretim Nginx imajı bu yoldan etkilenmiyor, sır ifşası riski nedeniyle genel yayın önceliği P0.  
**Kanıt:** `tools/serve.mjs:6-9,27-54`, `sunucu_baslat.ps1:10-32`, `deploy/nginx.conf:23-25`

### P0-05 — Üretime yakın ortamda mocksuz altın yolu geçir

- [ ] Docker Desktop/daemon sorununu gider ve temiz ortamda üretim imajlarını build et.
- [ ] Compose ile Postgres, migration, runtime DB rolü, backend ve Nginx'i ayağa kaldır.
- [ ] Veritabanı entegrasyon testlerini geçir.
- [ ] Mocksuz şu yolu otomatik test et: **başvuru → admin onayı → müşteri girişi/parola değişimi → teslimat yayını → müşteri erişimi**.
- [ ] Hatalı giriş, 401/403, logout sonrası oturum iptali, booking conflict, idempotency, çift gönderim ve API hata/yeniden deneme senaryolarını geçir.
- [ ] Admin/operasyon kritik mutasyonlarını test et: red, arşiv, silme/geri alma, teslimat, parola sıfırlama, personel/sorumlu/katalog ve operasyon kayıtları.
- [ ] Konteynerlerin non-root çalıştığını, sağlık kontrollerini, migration sırasını ve Nginx güvenlik başlıklarını çalışan sistemde doğrula.

**Kapanış ölçütü:** CI veya release kanıtında mocksuz kritik iş akışı ve tüm veritabanı entegrasyon testleri yeşil.  
**Kanıt:** `playwright.config.js:16`, `tests/e2e/smoke.spec.js`, `compose.production.yaml`

### P0-06 — Yedekleme, geri yükleme ve rollback'i prova et

- [ ] Şifreli ve üretim sunucusu dışında saklanan Postgres yedeğini etkinleştir.
- [ ] Yedek saklama süresini, RPO/RTO hedeflerini ve alarm sahibini yazılı hale getir.
- [ ] Ayrı bir ortamda gerçek geri yükleme tatbikatı yap; sonuç ve süreyi kaydet.
- [ ] Uygulama, migration ve veri için adım adım rollback runbook'u oluştur.
- [ ] Dağıtım öncesi yedek, sağlık kontrolü ve rollback karar eşiğini release prosedürüne bağla.

**Kapanış ölçütü:** Belgeli bir restore tatbikatı başarıyla tamamlanmış ve ekip rollback'i erişilebilir sırlarla uygulayabiliyor.  
**Kanıt:** `deploy/README.md:97-137`, `.github/workflows/deploy.yml`

### P0-07 — Üretim izleme ve alarm zincirini kur

- [ ] Dışarıdan uptime/health kontrolü ve sorumlu kişiye ulaşan alarm kur.
- [ ] 5xx oranı, API gecikmesi, DB bağlantısı, disk kullanımı, sertifika süresi, rate-limit anomalisi ve yedekleme başarısızlığı için eşikler tanımla.
- [ ] Log saklama, kişisel veri maskeleme, erişim yetkisi ve korelasyon kimliğiyle olay takibini doğrula.
- [ ] Olay müdahale ve iletişim runbook'u oluştur; ilk nöbet/eskalasyon sahibini ata.
- [ ] En az bir sentetik alarmı uçtan uca tetikleyip alındığını kaydet.

**Kapanış ölçütü:** Kritik hata kullanıcı bildirmeden önce algılanıyor ve kimin, hangi sürede müdahale edeceği belli.

## P1 — Canlıdan önce tamamlanması gerekenler

### Ürün ve veri doğruluğu

- [ ] **P1-01:** API kataloğu yüklenene kadar paket seçimini kapat; timeout/500/boş katalog hatasını ilk adımda görünür ve tekrar denenebilir yap. Statik eski fiyatla ilerlemeyi engelle. (`application.js:139-145,219-222,1046-1051`)
- [ ] **P1-02:** Fiyat için tek kaynak belirle; admin panelindeki güncellemenin ana sayfa, fallback katalog, paket özeti ve backend toplamına yansımasını test et. (`index.html:1054-1057`, `js/shared/service-catalog.js:2-7`, `js/admin/app.js:1629-1671`)
- [ ] **P1-03:** Teslimat SLA'sını “21 takvim günü” veya “21 iş günü” olarak tekleştir; tüm sayfa, mesaj ve sözleşmelerde aynı ifadeyi kullan. (`index.html:1337-1342`, `paketini-olustur.html:141`)
- [ ] **P1-04:** Formdaki “üçüncü kişilerle paylaşılmaz” vaadini gerçek WhatsApp/veri aktarımıyla uyumlu hale getir; gönderilecek veriyi kullanıcıya önceden göster. (`paketini-olustur.html:504-511`, `application.js:811-834`)
- [ ] **P1-05:** Marka kıdemini tekleştir: “10. yıl”, “8 yıldır” ve “2018'den beri” ifadeleri için tek onaylı anlatım kullan. (`login.html:48,77`, `index.html:95,1481`)
- [ ] **P1-06:** Farklı çekim olarak sunulan Talia/Rena video kaynaklarını içerik sahibiyle doğrula. (`index.html:644-730`)

### Güvenlik ve dağıtım

- [ ] **P1-07:** `appleboy/ssh-action@v1.0.3` kullanımını incelenmiş tam 40 karakterlik commit SHA'sına sabitle; deploy anahtarını mümkün olan en dar yetkiyle sınırla. **Düşük / CWE-829** (`.github/workflows/deploy.yml:35-43`)
- [ ] **P1-08:** Manuel `workflow_dispatch` dağıtımında kalite kapısının atlanmasını engelle veya açık, kayıtlı bir acil durum onayına bağla.
- [ ] **P1-09:** Veri saklama ve silme politikasını kodla eşleştir; müşteri PII, başvuru, teslimat, audit ve loglar için otomatik retention/purge işi ve denetim izi ekle.
- [ ] **P1-10:** Canlıya özel tüm sırları benzersiz üret, örnek değer kullanılmadığını doğrula, erişimleri sınırla ve sır döndürme runbook'unu test et.
- [ ] **P1-11:** Üçüncü taraf container tabanlarını ve deploy bağımlılıklarını digest/SHA ile sabitleme politikasını uygula.

### Erişilebilirlik ve kritik panel davranışı

- [ ] **P1-12:** Admin ve operasyon mobil menülerine `aria-expanded`, `aria-controls`, ilk odak, focus trap, Escape, arka plan `inert` ve tetikleyiciye odak dönüşü ekle. (`js/admin/app.js:1926-1972`, `js/operations/app.js:518-565`)
- [ ] **P1-13:** Aktif panel/sekme durumunu yalnızca CSS sınıfıyla değil uygun ARIA niteliğiyle duyur.
- [ ] **P1-14:** Parola sıfırlama yönlendirmesini gerçek ve çalışan destek kanalına bağla; başarılı/hatalı akışı test et.

## P2 — Kalite, performans ve keşfedilebilirlik

### Erişilebilirlik ve responsive davranış

- [ ] **P2-01:** Video kartlarını semantik buton/bağlantı yap; Enter/Space, odak dönüşü ve medya hata fallback'i ekle. (`js/home/shoots.js:64-71,102-106`)
- [ ] **P2-02:** Paket özeti açık/kapalıyken breakpoint ve yön değişiminde `aria-hidden`, `inert`, odak ve görünürlüğü yeniden hesapla. (`application.js:313-341`)
- [ ] **P2-03:** Ana mobil CTA'ları en az 44×44 CSS piksel dokunma hedefiyle doğrula.
- [ ] **P2-04:** Axe kapsamını tüm dokuz sayfa, açık menü/dialog ve panel durumlarına genişlet; `critical` yanında `serious` ihlalleri de sıfırla.
- [ ] **P2-05:** Chromium yanında Firefox, WebKit, iPhone/Android ve tablet kritik yol testleri ekle; klavye ve reduced-motion senaryolarını geçir.

### Performans

- [ ] **P2-06:** Üretim imajı üzerinden mobil Lighthouse/CWV ölç; LCP, CLS, INP, JS maliyeti, istek ve byte bütçelerini CI kapısı yap.
- [ ] **P2-07:** Brotli/gzip'i etkinleştir; hash'li assetler için uzun süreli `immutable` cache, HTML için güvenli kısa cache politikası belirle. (`deploy/nginx.conf:27-34`)
- [ ] **P2-08:** Harici Google Fonts'u self-host etmeyi ve kritik font preload/subset kullanımını değerlendir.

### SEO ve içerik

- [ ] **P2-09:** Üretim origin'iyle `robots.txt` ve `sitemap.xml` oluştur; Docker imajına dahil et.
- [ ] **P2-10:** Organization JSON-LD `logo` alanını gerçek logo ile değiştir; onaylı iletişim/adres/`sameAs` verisini ekle. (`index.html:39-46`)
- [ ] **P2-11:** Yasal sayfalara benzersiz description, canonical ve robots kararı ekle; Search Console, structured-data ve sosyal kart testlerini geçir.
- [ ] **P2-12:** Üretim build'inde hiçbir `__APP_ORIGIN__` placeholder'ı kalmadığını ve canonical/OG URL'lerinin 200 döndüğünü test et.

### Savunma derinliği ve bakım

- [ ] **P2-13:** Inline script/style kullanımını nonce/hash veya harici dosyalarla kaldırarak CSP'deki `unsafe-inline` ihtiyacını azalt.
- [ ] **P2-14:** Root geliştirme araçlarındaki 16 yüksek bağımlılık uyarısını takip et; araçları runtime imajından ayrı tut, güvenilmeyen config işlemelerini engelle ve upstream/migrasyon planı aç.
- [ ] **P2-15:** Gerçek üretim imajı için container ve bağımlılık güvenlik taramasını CI kanıtına ekle.
- [ ] **P2-16:** Anonim uygunluk sorgusundan önce salonun `isActive: true` olduğunu doğrula; pasif/bilinmeyen UUID için aynı 404 yanıtını döndür ve regresyon testi ekle. **Düşük / CWE-200** (`backend/src/routes/public.routes.ts:60-80`, `backend/src/services/booking.service.ts:607-641`)

## P3 — Canlı sonrası iyileştirmeler

- [ ] Markalı ve yönlendirici bir 404 sayfası ekle. (`deploy/nginx.conf:44-48`)
- [ ] Ana sayfa, paket akışı ve kritik paneller için kararlı görsel regresyon snapshot'ları ekle.
- [ ] Uzun admin E2E testini bağımsız iş akışlarına böl; sabit beklemeler yerine olay/yanıt tabanlı bekleme kullan.
- [ ] Test envanteri, feature sahibi, alarm sahibi ve risk kabul kayıtlarını tek bir release dokümanında tut.
- [ ] Üçüncü taraf medya için hata durumunda yerel poster/fallback ve içerik uygunluk kontrolü ekle.

## Canlıya çıkış günü kontrolü

### Altyapı ve sırlar

- [ ] DNS A/AAAA kayıtları, TLS zinciri ve otomatik sertifika yenileme doğrulandı.
- [ ] HSTS yalnızca HTTPS ve alt alan adı kararı doğrulandıktan sonra etkin.
- [ ] `APP_DOMAIN`, `CORS_ORIGIN`, cookie domain/Secure/SameSite ve `TRUST_PROXY` gerçek proxy topolojisiyle doğrulandı.
- [ ] Postgres owner/runtime parolaları, `DATA_ENCRYPTION_KEY`, oturum ve deploy sırları benzersiz; dosya izinleri en az yetkiyle sınırlandı.
- [ ] Runtime DB rolünün DDL/owner yetkisi olmadığı çalışan veritabanında doğrulandı.

### Build ve dağıtım

- [ ] Temiz SHA'dan frontend/backend/migration imajları yeniden üretildi; tag/digest release kaydına yazıldı.
- [ ] Migration yedeği alındı ve migration başarıyla tamamlandı.
- [ ] `/health/live` ve `/health/ready` hem container içinden hem dış proxy üzerinden geçti.
- [ ] Frontend ana sayfa, paket, login, admin, operasyon ve müşteri yolları beklenen 200/redirect davranışını verdi.
- [ ] Güvenlik başlıkları doğrulandı: CSP, HSTS, frame-ancestors/X-Frame-Options, nosniff, Referrer-Policy ve Permissions-Policy.
- [ ] Production source map, `.env`, `.git`, backend kaynakları ve dizin listeleme internetten erişilemiyor.
- [ ] Onaylı revision dışında manuel/yanlış SHA dağıtılamadığı doğrulandı.

### İşlevsel smoke

- [ ] Gerçek başvuru kontrollü test verisiyle oluşturuldu; toplam fiyat, takvim ve referans kodu doğrulandı.
- [ ] Admin başvuruyu görebildi, onayladı; müşteri ilk giriş/parola değişimini tamamladı.
- [ ] Operasyon kaydı ve teslimat yayını oluşturuldu; müşteri yetkili içeriğe erişti.
- [ ] Logout, yetkisiz rol, süresi dolmuş oturum ve CSRF reddi beklendiği gibi çalıştı.
- [ ] Test kayıtları tanımlı prosedürle temizlendi veya anonimleştirildi.

### Gözlem ve geri dönüş

- [ ] Uptime, 5xx, DB, disk, sertifika ve yedek alarmı yeşil; sentetik alarm alındı.
- [ ] Dağıtım öncesi yedek ve rollback komutları doğrulandı.
- [ ] Rollback karar sahibi ve iletişim kanalı canlı dağıtım penceresinde hazır.
- [ ] İlk 60 dakika log, hata oranı, başvuru başarısı ve gecikme panosu izlendi.

## İlk 24 saat

- [ ] Başvuru oluşturma başarı/hata oranı ve bekleyen başvuru yaşı izleniyor.
- [ ] 401/403/429/5xx anomalileri ve şüpheli IP/iletişim tekrarları incelendi.
- [ ] DB bağlantı havuzu, sorgu gecikmesi, CPU, RAM ve disk büyümesi normal.
- [ ] Ödeme/iletişim kanalına ulaşamama ve parola kurtarma geri bildirimleri kontrol edildi.
- [ ] İlk otomatik yedek başarıyla alındı ve offsite kopyası doğrulandı.
- [ ] P1/P2 kalanları için sahip ve hedef tarih atandı.

## Go/No-Go çıkış ölçütü

Canlıya geçiş için aşağıdaki koşulların tamamı sağlanmalı:

- [ ] Tüm P0 maddeleri kanıt bağlantısıyla kapalı.
- [ ] Açık yüksek/kritik güvenlik bulgusu yok; orta bulgular kapalı veya yazılı risk kabulüne sahip.
- [ ] Üretim imajı, DB entegrasyonu ve mocksuz kritik E2E akışı yeşil.
- [ ] Hukuk, ürün ve operasyon sahipleri kendi bölümlerini yazılı onayladı.
- [ ] İzleme, yedek, restore ve rollback tatbikatı tamamlandı.
- [ ] Dağıtılacak commit SHA'sı, imaj digestleri, migration ve geri dönüş sürümü release kaydında sabit.

## Denetim sınırlamaları

- Docker daemon erişilebilir olmadığı için gerçek üretim container'ları ve veritabanı entegrasyonu bu denetimde çalıştırılamadı.
- Playwright testlerinin önemli bölümü API mock'ları kullanıyor; sonuçlar gerçek backend altın yolunun yerine geçmez.
- KVKK, gizlilik, kullanım şartları ve ticari ifadeler teknik tutarlılık açısından incelendi; nihai hukuk uygunluğu yetkili hukuk danışmanı tarafından onaylanmalı.
- Güvenlik taraması statik kaynak incelemesine dayanır; altyapı, DNS, dış servis hesapları ve canlı sunucu konfigürasyonu erişim olmadan doğrulanmadı.
