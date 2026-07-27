# Düğünajansım Frontend Uçtan Uca Analiz Raporu

**Tarih:** 27 Temmuz 2026  
**Kapsam:** `index.html`, `login.html`, `paketini-olustur.html`, tüm CSS/JavaScript modülleri ve görsel varlıklar  
**Test ölçüleri:** 1440×900, 768×1024, 375×812 ve 320×568  
**Yöntem:** Statik kaynak denetimi, gerçek tarayıcı render kontrolü, klavye/ARIA incelemesi, responsive taşma ölçümü, form doğrulama ve paket oluşturma akış testi

## 1. Yönetici özeti

Frontend'in görsel yönü güçlü ve ürüne özgü: editoryal/lüks düğün estetiği, tipografi, fotoğraf kullanımı, boşluk ritmi ve mobil yeniden kompozisyon başarılı. Üç sayfa da çalışıyor; test sırasında JavaScript konsolunda hata oluşmadı. Paket oluşturma akışında fiyat hesapları ve adım geçişleri doğru çalıştı.

Ancak backend geliştirmesine geçmeden önce çözülmesi gereken önemli sorunlar var:

- Ödeme ve dekont akışı gerçek işlem yapıyormuş gibi tamamlanıyor fakat tamamen tarayıcı içinde çalışıyor.
- Örnek IBAN, örnek banka, sahte telefonlar ve çalışmayan yasal bağlantılar kullanıcıya üretim verisi gibi sunuluyor.
- Mobil menü kapalıyken bağlantılar klavye odağında kalıyor.
- 320 px genişlikte paket ilerleme göstergesinin beşinci adımı kırpılıyor.
- Ana hero alanında bozuk kodlanmış `âœ¦` karakterleri görünür durumda.
- Görsel varlık klasörü yaklaşık **44,2 MB**; yalnızca altı mekân PNG'si yaklaşık **9,7 MB**.
- Beş otomatik oynayan video yalnızca iki Supabase Storage dosyasını tekrar kullanıyor.
- Görsellerde boyut rezervasyonu yok; lazy loading ve önceliklendirme eksik.
- Paket oluşturucu, mobilde 6–9 px boyutuna düşen kritik metinler ve bazı isimsiz butonlar içeriyor.
- KVKK/onay, gerçek gizlilik metni, dosya boyutu/türü güvenliği ve erişilebilir hata durumları tamamlanmamış.
- Otomatik test, lint, format, HTML doğrulama ve performans bütçesi altyapısı yok.

**Karar:** Frontend görsel olarak ileri seviyede, fakat üretime ve backend entegrasyonuna hazır değil. Önce P0 ve P1 bulguları kapatılmalı.

## 2. Sayfa bazlı durum

| Sayfa | Güçlü yön | Ana risk | Durum |
|---|---|---|---|
| Ana sayfa | Güçlü hero, tutarlı sanat yönü, iyi bölüm çeşitliliği | Performans, mobil menü erişilebilirliği, bozuk karakter, gerçek iletişim eksikliği | Revizyon gerekli |
| Giriş | Temiz form yapısı, label/autocomplete, hata odağı | Giriş ve şifre yenileme yalnızca bilgilendirme metni; gerçek akış yok | Backend öncesi demo durumu netleştirilmeli |
| Paket oluşturucu | Akış ve fiyat hesapları çalışıyor; mobil kompozisyon güçlü | Sahte ödeme tamamlama, KVKK/onay, dar ekran kırılması, erişilebilirlik | Kritik revizyon gerekli |

## 3. Doğrulanan olumlu bulgular

- Tüm sayfalarda `lang="tr"`, viewport, açıklama ve sayfa başlığı var.
- Her görünür sayfa/adımda tek bir etkin H1 bulunuyor.
- Ana yapıda `header`, `main`, `section`, `footer`, `dialog`, `form`, `label` gibi semantik elemanlar kullanılmış.
- Galeri ve video lightbox'ları native `dialog` ile kurulmuş.
- Giriş formu geçersiz alana odaklanıyor ve hata mesajlarını canlı bölgeyle bildiriyor.
- Paket oluşturucu boş zorunlu alanlarda ilk hatalı alana odaklanıyor.
- Paket fiyatları test edilen akışta doğru:
  - Mini Paket: 20.000 TL
  - Fotoğraf hizmeti: 7.000 TL
  - Ara toplam: 27.000 TL
  - Kapora: 5.000 TL
  - Peşin ödeme: 24.300 TL
- 1440, 768 ve 375 px ölçülerinde sayfa seviyesinde istenmeyen yatay scrollbar oluşmadı.
- Reduced-motion kuralları ana modüllerde mevcut.
- Ana sayfa JavaScript'i özellik bazlı modüllere ayrılmış.
- Görünür kırık görsel ve çalışma zamanı konsol hatası tespit edilmedi.

## 4. Önceliklendirilmiş bulgular

### P0 — Backend öncesi bloklayıcılar

#### F-01 — Ödeme bildirimi yalnızca frontend içinde “başarılı” oluyor

**Kanıt**

- Banka bilgileri doğrudan frontend sabitlerinde tutuluyor: `js/package-builder/application.js:6-14`.
- Ödeme referansı `Date.now()` ile tarayıcıda üretiliyor: `js/package-builder/application.js:13-14`.
- Form submit sonrasında herhangi bir API isteği olmadan başarı ekranı açılıyor: `js/package-builder/application.js:518-534`.
- Örnek hesap ekranda gerçek ödeme talimatı görünümünde: `paketini-olustur.html:365-371`.

**Etki**

- Kullanıcı örnek IBAN'a gerçek para göndermeye çalışabilir.
- Tarayıcı yenilendiğinde işlem ve müşteri verisi kaybolur.
- Referans numarasının benzersizliği ve siparişle ilişkisi garanti edilmez.
- Dekont dosyası hiçbir yere gönderilmediği halde “bildirim oluşturuldu” mesajı gösterilir.

**Çözüm**

- Backend hazır olana kadar ödeme adımını feature flag ile devre dışı bırakın veya belirgin “demo/önizleme” durumu gösterin.
- Gerçek başarı ekranını yalnızca sunucu tarafından doğrulanmış yanıt sonrasında açın.
- Sipariş ID, ödeme referansı, fiyat, indirim ve ödeme durumunun tek otoritesi backend olmalı.
- Frontend tarafından gönderilen fiyat ve toplam değerlerine güvenilmemeli.

#### F-02 — KVKK, gizlilik ve yasal onay akışı eksik

**Kanıt**

- Ad, telefon, e-posta, düğün tarihi, mekân ve dekont toplanıyor: `paketini-olustur.html:264-304`, `373-380`.
- Kullanıcıdan açık onay alınmıyor.
- “Gizlilik Politikası” ve “Kullanım Şartları” bağlantıları gerçek belgelere değil iletişim bölümüne gidiyor: `paketini-olustur.html:563-566`.
- Ana footer'da gerçek gizlilik/KVKK/çerez bağlantıları yok: `index.html:989-1049`.

**Etki**

- Kullanıcı, verisinin hangi amaçla ve ne kadar süre saklanacağını göremiyor.
- Dosya yükleme ve kişisel veri işleme için açık bilgilendirme/onay kanıtı yok.
- Sahte yasal bağlantılar güven kaybı yaratır.

**Çözüm**

- Gerçek KVKK aydınlatma, gizlilik, çerez ve kullanım koşulları sayfalarını hazırlayın.
- Zorunlu ve opsiyonel izinleri ayırın; pazarlama iznini varsayılan kapalı tutun.
- Form submit öncesinde gerekli onayı erişilebilir checkbox ile alın.
- Onay sürümü ve zamanı backend'de siparişle birlikte saklanmalı.

#### F-03 — Üretim arayüzünde örnek iletişim ve ödeme verileri bulunuyor

**Kanıt**

- Ana sayfa telefonu: `index.html:136` → `+90 555 101 01 01`.
- Paket sonu telefonu: `paketini-olustur.html:483-485` → `+90 555 123 45 67`.
- Banka/IBAN örnek değerleri: `js/package-builder/application.js:7-11`.

**Etki**

- Kullanıcı yanlış numarayı arayabilir veya yanlış hesaba ödeme yapmaya çalışabilir.
- İki farklı telefon numarası marka güvenini zedeler.

**Çözüm**

- Tek bir merkezi yapılandırma kullanın.
- Gerçek veriler hazır değilse CTA'ları pasifleştirin ve açıkça “yakında” olarak işaretleyin.
- Ödeme verilerini statik JavaScript içinde yayınlamayın; sunucudan sipariş bağlamında alın.

### P1 — Yüksek öncelikli frontend sorunları

#### F-04 — Kapalı mobil menüde odaklanabilir bağlantılar kalıyor

**Kanıt**

- Menü kapalıyken `aria-hidden="true"` fakat `display:grid`, `visibility:visible`.
- İçerideki sekiz bağlantının tamamı `tabIndex=0`.
- Menü yalnızca `pointer-events:none` ve opacity ile saklanıyor.
- Kod sadece class ve ARIA değerini değiştiriyor: `js/home/navigation.js:5-22`.

**Etki**

- Klavye kullanıcısı görünmeyen bağlantılara sekebilir.
- `aria-hidden` altında odaklanabilir içerik WCAG ihlali oluşturur.
- Escape tuşu menüyü kapatmıyor; testte menü açık kaldı.
- Menü açıldığında odak yönetimi/focus trap yok.

**Çözüm**

- Kapalı menüye `inert` uygulayın veya gerçekten `hidden`/`display:none` kullanın.
- Açılışta ilk menü bağlantısına, kapanışta menü butonuna odak verin.
- Escape ile kapatın.
- Açıkken arka sayfayı `inert` yapın veya uygun dialog/navigation drawer kalıbı kullanın.

#### F-05 — 320 px genişlikte paket ilerleme göstergesi kırpılıyor

**Kanıt**

- 320×568 testinde beşinci `.builder-progress__item` sağ sınırın dışına çıktı.
- Görsel kontrolde “5 / Özet” adımı görünmüyor.
- `body` yatay taşmayı maskelediği için kullanıcı kırpılan içeriğe ulaşamıyor.
- İlgili mobil boyutlar: `css/paket-builder.css:2252-2258`.

**Çözüm**

- 320 px için adımları kaydırılabilir yapın, etiketleri kısaltın veya yalnızca aktif/önceki/sonraki adımı gösterin.
- `overflow-x:hidden` ile kırpılmayı gizlemek yerine bileşen seviyesinde çözün.
- 320, 360, 375, 390 ve 430 px regresyon testi ekleyin.

#### F-06 — Ana hero alanında bozuk karakter görünür

**Kanıt**

- `css/styles/home.css:282-288` içinde `content: "âœ¦"` bulunuyor.
- Mobil ve masaüstü render'da bozuk karakter H1 yakınında görünüyor.
- Erişilebilir ad da “âœ¦ Türkiye’nin…” biçiminde kirleniyor.

**Çözüm**

- Karakteri gerçek `✦` ile düzeltin veya dekorasyonu SVG/CSS şekline çevirin.
- Dekorasyon H1 pseudo-element'inde kalacaksa ekran okuyucu adını etkilemediğini doğrulayın.
- CSS yorumlarındaki diğer mojibake kalıntılarını da UTF-8'e temizleyin.

#### F-07 — Görsel ve video yükü yüksek

**Kanıt**

- `assets/` toplamı yaklaşık **44.159.044 bayt**.
- Altı mekân logosu yalnızca PNG ve toplamda yaklaşık **9,7 MB**.
- 38 `<img>` elemanının hiçbirinde HTML `width` ve `height` yok.
- Yalnızca 10 görselde `loading="lazy"` var.
- `fetchpriority` ve `decoding` kullanılmıyor.
- Beş video `autoplay`, `loop`, `preload="metadata"` ile açılıyor: `index.html:482-579`.
- Canlı testte beş videonun tamamı `readyState=4` seviyesine geldi.

**Etki**

- Mobil veri tüketimi, LCP, CLS ve ilk etkileşim süresi olumsuz etkilenir.
- Uzak video servisi yavaşladığında ana sayfa deneyimi bozulur.

**Çözüm**

- Mekân PNG'lerini WebP/AVIF'e dönüştürün; gerçek render boyutuna göre yeniden ölçekleyin.
- Her görsele `width`/`height` veya `aspect-ratio` ekleyin.
- İlk hero görseline `fetchpriority="high"`; ekran altı görsellere lazy loading ve `decoding="async"` ekleyin.
- Videolara poster ekleyin; yalnızca görünür karta play verin.
- Mobilde autoplay yerine poster + kullanıcı başlatması değerlendirin.
- Görsel/video performans bütçesi tanımlayın.

#### F-08 — Beş farklı çekim kartı yalnızca iki videoyu tekrar kullanıyor

**Kanıt**

- Talia, Rena ve Mafsel aynı `video1.mp4` dosyasını kullanıyor.
- Bella ve Cess aynı `video3.mp4` dosyasını kullanıyor.
- Kart başlıkları ve tarihler farklı içerik izlenimi veriyor: `index.html:482-586`.

**Etki**

- “Gerçek hikâyeler” anlatısı ile gösterilen içerik uyuşmuyor.
- Kullanıcı aynı videoyu farklı çift/mekân adıyla görür; güven ve içerik doğruluğu zarar görür.

**Çözüm**

- Her karta gerçek ve benzersiz video bağlayın.
- İçerik hazır değilse kart sayısını gerçek içerik sayısına düşürün.
- Storage dosyaları için poster, süre, boyut ve içerik manifesti kullanın.

#### F-09 — Sayfa yükleyici gerçek içeriği gereksiz yere blokluyor

**Kanıt**

- Loader tüm viewport'u kapatıyor ve body scroll'unu kilitliyor: `css/styles/base.css:42-65`.
- Yalnızca `window.load` sonrası kaldırılıyor: `js/home/page-loader.js:19-25`.
- Kapanış geçişi 520 ms; fallback kaldırma 800 ms.
- Mobil testte ilk ekran görüntüsü içerik yerine loader gösterdi.

**Etki**

- İçerik hazır olsa bile kullanıcı önce marka animasyonunu bekliyor.
- Ağdaki uzak video/görsel gecikmeleri loader süresini uzatabilir.
- Algılanan LCP ve etkileşime hazır olma süresi kötüleşir.

**Çözüm**

- Loader'ı kaldırın veya yalnızca kritik bir başlangıç gereksinimi varsa kısa skeleton kullanın.
- `window.load` yerine gerekli minimum DOM/hero hazır olduğunda içerik gösterin.
- Loader'ı tekrar ziyaretlerde atlayın.

#### F-10 — Paket oluşturucu mobil erişilebilirlik durumları eksik

**Kanıt**

- Mobil CSS, geri butonlarının metnini gizliyor: `css/paket-builder.css:2322-2328`.
- SVG `aria-hidden`; sonuç olarak erişilebilir ağaçta buton isimsiz.
- İlerleme göstergesi yalnızca class değiştiriyor; `aria-current="step"` güncellenmiyor: `js/package-builder/application.js:106-111`.
- Hizmet filtreleri yalnızca `.is-active` class'ı alıyor; `aria-pressed` veya sekme semantiği yok: `js/package-builder/application.js:536-541`.
- Özet çekmecesi açılırken `aria-expanded`, `aria-controls`, odak yönetimi veya `inert` uygulanmıyor: `js/package-builder/application.js:544-547`.

**Çözüm**

- Geri butonlarına sabit `aria-label="Önceki adıma dön"` ekleyin.
- Etkin ilerleme öğesine `aria-current="step"` verin ve değişimde güncelleyin.
- Filtreleri `aria-pressed` buton grubu veya tablist olarak modelleyin.
- Özet drawer'ını erişilebilir dialog/drawer kalıbına dönüştürün.

#### F-11 — Form hata semantiği ve doğrulama kuralları yetersiz

**Kanıt**

- Paket formu hatayı yalnızca `.is-invalid` class'ı ile gösteriyor; `aria-invalid` eklenmiyor: `js/package-builder/application.js:433-444`.
- Hata metinleri input'a `aria-describedby` ile bağlanmamış.
- Telefon regex'i yalnızca izin verilen karakterlerden en az 10 tane istiyor: `paketini-olustur.html:274`. Örneğin yalnızca tirelerden oluşan değer teorik olarak geçebilir.
- Dekontta yalnızca `accept` filtresi var; boyut ve gerçek MIME doğrulaması yok: `paketini-olustur.html:380`.
- Tarih minimumu sadece tarayıcı tarafında atanıyor: `js/package-builder/application.js:574-581`.

**Çözüm**

- Hatalı alana `aria-invalid="true"` ekleyin; hata ID'sini `aria-describedby` ile bağlayın.
- Telefonu normalize edip gerçek iş kuralıyla doğrulayın.
- Dosya türü, MIME, imza ve boyutu backend'de yeniden doğrulayın; frontend'de erken geri bildirim verin.
- Tüm istemci doğrulamalarını sunucuda tekrarlayın.

### P2 — Orta öncelikli sorunlar

#### F-12 — SEO ve paylaşım metadatası eksik

Eksikler:

- Canonical URL
- Open Graph ve Twitter Card
- Paylaşım görseli
- `Organization`/`LocalBusiness`/`FAQPage` structured data
- Favicon ve web manifest
- `robots.txt` ve sitemap

**Çözüm:** Gerçek domain ve marka verileri netleştiğinde üç sayfa için metadata matrisi hazırlayın. FAQ structured data yalnızca görünür içerikle birebir eşleşmeli.

#### F-13 — Ana sayfada gerçek iletişim yüzeyi yok

`#iletisim` yalnızca footer ID'sidir. Footer'da adres, telefon, e-posta, çalışma saatleri, WhatsApp veya iletişim formu bulunmuyor; “İletişim” bağlantısı aynı footer'a gidiyor.

**Çözüm:** Gerçek iletişim bilgileri ve tercih edilen dönüşüm kanalını ekleyin. Telefon, WhatsApp ve form olaylarını ölçülebilir CTA'lara dönüştürün.

#### F-14 — CSS dağıtımı ve bakım maliyeti yüksek

**Kanıt**

- Paket CSS'i 3.689 satır / 67 KB.
- Ana CSS giriş dosyası 11 adet `@import` çağırıyor: `css/styles.css:2-12`.
- Toplam 47 media query var.
- Renk fonksiyonları/hardcoded renkler yaklaşık 425 kullanım.
- Aynı temel tokenlar ana sayfa, login ve builder dosyalarında tekrar tanımlanıyor.

**Etki**

- `@import` render-blocking istek zinciri yaratır.
- Breakpoint ve token farklılaşması regresyon riskini artırır.
- Paket sayfasında tek dosyada çok fazla farklı ekran/durum bulunuyor.

**Çözüm**

- Ortak tokenları tek bir `tokens.css` dosyasına taşıyın.
- CSS'i build aşamasında tek/minify edilmiş dosyaya paketleyin.
- Paket oluşturucuyu `base`, `steps`, `checkout`, `completion`, `dialogs`, `responsive` modüllerine ayırın.
- Breakpoint sözlüğünü standardize edin.

#### F-15 — Küçük dokunma hedefleri ve çok küçük metinler var

**Kanıt**

- Ana sayfa desktop ölçümünde video okları 38×38, ses butonları 42×42.
- Mobil ana sayfada 22 adet etkileşimli hedefin en az bir boyutu 44 px'in altında.
- Paket ilerleme etiketleri 430 px altında 6 px'e düşüyor: `css/paket-builder.css:2256-2258`.
- Çeşitli kritik açıklama ve hata metinleri 9 px.

**Çözüm**

- Etkileşimli hedeflerde minimum 44×44 CSS px kullanın.
- Kritik bilgi, hata ve yasal metinlerde mobil alt sınırı en az 12–14 px olarak belirleyin.
- Altın tonlu küçük metinleri WCAG AA kontrastına göre tekrar ölçün.

#### F-16 — Boş `src` kullanan görseller var

**Kanıt**

- Galeri lightbox görseli: `index.html:1059`.
- Paket showcase ve servis detayında başlangıçta boş `src` kullanan görseller var: `paketini-olustur.html:612`, `628`.

**Etki**

- Bazı tarayıcılarda mevcut HTML dokümanına gereksiz görsel isteği oluşabilir.
- Kırık görsel durumu ve gereksiz ağ trafiği riski yaratır.

**Çözüm**

- `src` niteliğini ilk kullanımda JavaScript ile ekleyin.
- Alternatif olarak küçük şeffaf placeholder kullanın.

#### F-17 — Giriş sayfası işlevsiz CTA'lar içeriyor

**Kanıt**

- Geçerli giriş formu hiçbir yere gönderilmiyor; yalnızca “yakında” mesajı gösteriyor: `js/login.js:76-92`.
- “Şifremi unuttum” aynı şekilde yalnızca bilgi mesajı veriyor: `js/login.js:70-74`.

**Çözüm**

- Backend öncesi giriş sayfasını gizleyin veya açıkça demo/bekleme listesi durumuna alın.
- Backend sonrası loading, yanlış kimlik bilgisi, rate limit, kilitli hesap, ağ hatası ve başarı durumlarını tasarlayın.

#### F-18 — HTML'de responsive içerik kopyaları bulunuyor

Hizmet avantajlarında desktop ve mobile için ayrı H2'ler var: `index.html:211-212`, `226-227`, `246-247`, `264-265`.

**Etki**

- Aynı içeriğin iki kez bakım görmesi gerekir.
- CSS/erişilebilirlik regresyonunda iki başlık aynı anda görünür olabilir.

**Çözüm:** Tek semantik başlık kullanın; yalnızca iç span düzenini CSS ile yeniden kompoze edin.

#### F-19 — Tarihe bağlı içerikler hızla eskiyecek

Video kartlarında sabit 2026 tarihleri ve footer'da sabit `© 2026` var. İçerik güncelleme süreci tanımlı değil.

**Çözüm:** Footer yılını otomatik üretin; çekim kartlarını içerik kataloğundan besleyin ve yayından kaldırma/güncelleme süreci tanımlayın.

### P3 — Kalite ve sürdürülebilirlik

#### F-20 — Otomatik kalite altyapısı yok

Projede `package.json`, ESLint, Stylelint, Prettier, HTML validator, Playwright/Cypress, CI, performans bütçesi veya erişilebilirlik testi bulunmuyor.

**Önerilen minimum paket**

- HTML doğrulama
- ESLint + Prettier
- Stylelint
- Playwright: ana sayfa smoke, mobil menü, login doğrulama, paket akışı
- axe-core erişilebilirlik kontrolü
- Lighthouse CI veya eşdeğer performans bütçesi
- 320/375/768/1440 görsel regresyon ekran görüntüleri

#### F-21 — `innerHTML` kullanımı gelecekte güvenlik riski oluşturabilir

`js/package-builder/application.js` içinde katalog verileri beş farklı yerde `innerHTML` ile render ediliyor. Mevcut veri sabit yerel katalogdan geldiği için bugün doğrudan bir açık doğrulanmadı; ancak içerik backend/CMS'den gelmeye başladığında XSS riski oluşur.

**Çözüm:** Metinleri `textContent`, güvenli DOM üretimi veya doğrulanmış/sanitize edilmiş template ile render edin.

## 5. Responsive test özeti

| Ölçü | Ana sayfa | Giriş | Paket oluşturucu |
|---|---|---|---|
| 1440×900 | Genel düzen başarılı | Başarılı | Başarılı |
| 768×1024 | Dekoratif/carousel taşmaları kontrollü | Başarılı | Başarılı |
| 375×812 | Genel kompozisyon başarılı; küçük hedefler var | Başarılı | Başarılı; metinler fazla küçük |
| 320×568 | Yatay sayfa taşması yok; yoğunluk yüksek | Başarılı | 5. ilerleme adımı kırpılıyor |

Not: Ana sayfadaki galeri/video raylarında viewport dışındaki kartlar kasıtlı yatay carousel davranışıdır. Bunlar sayfa seviyesinde yatay scrollbar üretmediği için hata olarak sınıflandırılmadı.

## 6. Backend entegrasyonundan önce önerilen uygulama sırası

### Faz 1 — Üretim güvenliği

- Örnek ödeme, IBAN ve telefon verilerini kaldırın/pasifleştirin.
- Gerçek yasal sayfaları ve KVKK onayını ekleyin.
- Sahte başarı ekranını backend yanıtına bağlanana kadar devre dışı bırakın.
- Giriş ve şifre yenileme CTA'larının demo durumunu netleştirin.

### Faz 2 — Erişilebilirlik ve responsive

- Mobil menü `inert`, Escape ve odak yönetimini düzeltin.
- Paket drawer, filtre ve ilerleme semantiğini tamamlayın.
- Mobil geri butonlarına erişilebilir ad ekleyin.
- Form hatalarını `aria-invalid`/`aria-describedby` ile bağlayın.
- 320 px ilerleme kırılmasını giderin.
- 44×44 hedef ve minimum okunabilir metin ölçülerini uygulayın.

### Faz 3 — Performans

- Görselleri yeniden boyutlandırıp WebP/AVIF'e dönüştürün.
- Boyut, lazy loading, decoding ve fetch priority ekleyin.
- Video autoplay/payload stratejisini değiştirin.
- Loader'ı kaldırın veya kısaltın.
- CSS `@import` zincirini bundle/minify edin.

### Faz 4 — İçerik, SEO ve kalite otomasyonu

- Benzersiz video içerikleri ve gerçek iletişim bilgilerini ekleyin.
- SEO/social/structured data katmanını tamamlayın.
- Lint, validator, erişilebilirlik, e2e ve görsel regresyon testlerini kurun.

## 7. Frontend “Definition of Done”

Backend geliştirmesine geçmeden önce aşağıdaki maddeler tamamlanmalı:

- [ ] P0 bulgularının tamamı kapatıldı.
- [ ] 320, 375, 768 ve 1440 px'de kırpılma/yatay taşma yok.
- [ ] Mobil menü, drawer ve dialog'lar yalnızca klavye ile tam kullanılabiliyor.
- [ ] Tüm etkileşimli kontrollerin erişilebilir adı ve en az 44×44 hedefi var.
- [ ] Form hataları ekran okuyucuya bağlı ve odağa alınabiliyor.
- [ ] Gerçek KVKK/gizlilik/şartlar sayfaları ve onay mekanizması var.
- [ ] Örnek telefon, IBAN, banka ve sahte ödeme başarısı kaldırıldı.
- [ ] Tüm görseller optimize, boyutlandırılmış ve doğru yükleme önceliğine sahip.
- [ ] Beş video kartı gerçek ve benzersiz içerik kullanıyor.
- [ ] Loader gerçek içeriği gereksiz yere bloklamıyor.
- [ ] Lighthouse/performans bütçesi belirlendi ve kabul sınırları geçiliyor.
- [ ] HTML, CSS ve JavaScript otomatik kontrollerden geçiyor.
- [ ] Ana sayfa, login ve paket akışı için e2e testleri var.
- [ ] Konsolda hata/uyarı ve görünür kırık varlık yok.
- [ ] SEO, favicon, canonical, sosyal paylaşım ve structured data tamamlandı.

## 8. Sonuç

Frontend'in en güçlü tarafı görsel tasarım ve ürün hissi. En zayıf tarafı ise üretim sözleşmesi: arayüz bazı işlemleri gerçekmiş gibi sunuyor fakat veri, ödeme, yasal onay ve başarı durumu henüz güvenilir bir sisteme bağlı değil. Önce bu sözleşme düzeltilmeli; ardından erişilebilirlik ve performans borcu kapatılmalıdır. Bu dört faz tamamlandığında backend entegrasyonuna çok daha güvenli, test edilebilir ve sürdürülebilir bir temel üzerinden geçilebilir.
