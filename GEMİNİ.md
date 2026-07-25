# DüğünAjansım — Ajan (Agent) Geliştirme Yönergesi ve Proje Standartları

Bu doküman, **DüğünAjansım** projesinde görev alan yapay zeka ajanları (AI Agents) ve geliştiriciler için çalışma kurallarını, proje mimarisini ve test/sunucu başlatma prosedürlerini tanımlar.

---

## 1. Proje Genel Bakışı ve Mevcut Durum

**DüğünAjansım**, İstanbul ve çevresinde hizmet veren profesyonel düğün fotoğrafçılığı ve sinematik film ajansı için hazırlanmış, yüksek estetik standartlara ve akıcı animasyonlara sahip modern bir landing page projesidir.

### Proje Yapısı ve Mimari:
* **`index.html`**: Semantik HTML5 yapısına, SEO meta etiketlerine ve erişilebilirlik (a11y) standartlarına uygun ana sayfa.
* **`css/styles.css`**: Vanilla CSS ile yazılmış; renk değişkenleri (CSS Custom Properties/HSL), tipografi, responsive grid/flexbox yapıları ve bileşen stillerini barındıran stil dosyası.
* **`js/app.js`**: Sayfa içi etkileşimler, modallar, form doğrulama ve GSAP/ScrollTrigger entegrasyonlarını yöneten JavaScript modülü.
* **`vendor/`**: Üçüncü taraf bağımlılıkların (GSAP `gsap.min.js` ve `ScrollTrigger.min.js`) yerel kopyaları.
* **`assets/`**: WebP ve AVIF formatlarında optimize edilmiş yüksek kaliteli görsel ve medya öğeleri.
* **`quality/tests/`**: VitrinOS mimarisi baz alınarak eklenmiş otomatik test paketi (Config, Frontend Contract, Responsive Overflow ve E2E Smoke testleri).
* **`run_server.bat` / `sunucu_baslat.ps1`**: Projeyi bağımsız Python HTTP sunucusu ile 8000 portunda başlatan scriptler.

---

## 2. KESİN KURAL: Sunucu Çalıştırma ve Test Prosedürü

> [!CAUTION]
> **DOĞRUDAN SUNUCU BAŞLATMAK KESİNLİKLE YASAKTIR!**
> Ajan, terminal üzerinden doğrudan `python -m http.server`, `npx http-server`, `live-server` veya başka bir bağımsız komut **ÇALIŞTIRAMAZ**.

### ⚠️ Sunucu Çalıştırma Protokolü:
1. **Test ve Görüntüleme:** Sayfayı yerel ortamda test etmek veya sunucuyu açmak için **YALNIZCA VE KESİNLİKLE** `run_server.bat` dosyası çalıştırılmalıdır.
2. **Komut Kullanımı:**
   - Windows cmd/batch üzerinden: `.\run_server.bat`
   - PowerShell üzerinden: `powershell -ExecutionPolicy Bypass -File .\sunucu_baslat.ps1`
3. **Çalışma Mantığı:** Bu script, Windows WMI (`Win32_Process`) kullanarak Python HTTP sunucusunu terminal oturumundan bağımsız bir arka plan süreci olarak başlatır. Port 8000 doluysa eski süreci temizler ve `http://localhost:8000` adresinde projeyi yayına alır.
4. **Ajan Davranışı:** Ajan hiçbir koşulda port açmak için kendi özel komut dizilimini türetmeye çalışmayacak, doğrudan projedeki hazır scripti tetikleyecektir.

---

## 3. Otomatik Test Süreci (VitrinOS Mimarisi)

Projede `VitrinOS` standartlarında hazırlanmış, Node.js yerel test koşucusu (`node --test`) ve Playwright tabanlı otomatik test paketi yer almaktadır.

### Test Komutları:
* **Tüm Testleri Çalıştırma**: `npm test` veya `npm run check`
* **Yapılandırma Testi**: `npm run test:config`
* **Sözleşme & Arayüz Testi**: `npm run test:contract`
* **Duyarlı Tasarım (Responsive Overflow) Testi**: `npm run test:responsive` *(Sunucunun açık kalması gerekir)*
* **E2E Duman Testi (Smoke Test)**: `npm run test:e2e` *(Sunucunun açık kalması gerekir)*

### Test Paket İçeriği (`quality/tests/`):
1. **`config.test.mjs`**: Dosya ve klasör yapısının, `run_server.bat` ve `AGENT.md` kurallarının varlığını doğrular.
2. **`frontend-contract.test.mjs`**: `index.html` içinde tanımlı kritik DOM ID'leri, SEO etiketleri, font bağlantıları ve HSL tasarım sistemini doğrular.
3. **`responsive-overflow.test.mjs`**: 280px ile 1920px arasındaki 13 farklı viewport'ta sayfanın yatay taşma (horizontal overflow) yapıp yapmadığını sına ve ekran görüntülerini `quality/tests/screenshots/` altına kaydeder.
4. **`e2e-smoke.test.mjs`**: Playwright ile tarayıcı ortamında sayfa başlığını, mobil menü butonunu ve WhatsApp CTA tıklamalarını test eder.

---

## 4. Geliştirme ve Kodlama Kuralları

### A. Dil Politikası
- Tüm düşünce süreçleri, planlamalar, komut açıklamaları ve çıktılar **istisnasız TÜRKÇE** olmalıdır.

### B. Teknoloji Yığını ve Bağımlılıklar
- Proje saf (Vanilla) HTML, CSS ve JavaScript yapısındadır.
- Animasyonlarda `vendor/` dizinindeki GSAP kütüphanesi kullanılmalıdır.

### C. Tasarım ve Estetik (Anti-Slop İlkeleri)
- **Renk Paleti:** Ad-hoc renkler yerine HSL bazlı, uyumlu ve premium renk paletleri kullanılmalıdır.
- **Tipografi:** Projedeki `Gloock` (serf) ve `Instrument Sans` font dengesi korunmalıdır.
- **Etkileşim:** Hover durumları, butonlar ve geçişlerde pürüzsüz mikro animasyonlar ve transform efektleri uygulanmalıdır.

### D. Kod Düzenleme ve Performans
- **Nokta Atışı Düzenleme:** Dosyaların tamamını yeniden yazmak yerine `replace_file_content` aracı ile sadece ilgili satırlar güncellenmelidir.
- **SEO & Performans:** `<img>` etiketlerinde `alt` öznitelikleri, WebP/AVIF formatları ve `loading="lazy"` / `fetchpriority` stratejilerine dikkat edilmelidir.

---

## 5. Git Versiyon Kontrolü ve Push Kuralları

Ajan, geliştirmelerini veya hata düzeltmelerini tamamlayıp testlerden geçirdikten sonra değişiklikleri uzak repoya (GitHub) kaydetmelidir.

### 📌 Commit ve Push Kuralları:
1. **Anlamlı Türkçe + ASCII Alfabe:** Commit mesajları ne yapıldığını açıkça anlatan **anlamlı Türkçe** cümleler olmalıdır. Ancak karakter bozulmalarını ve terminal uyumsuzluklarını önlemek için **yalnızca İngilizce alfabe (ASCII) karakterleri** kullanılmalıdır (`ç, ğ, ı, ö, ş, ü` yerine `c, g, i, o, s, u`).
   - ✅ *Doğru Örnek:* `git commit -m "feat: otomatik test paketi eklendi ve agent.md guncellendi"`
   - ✅ *Doğru Örnek:* `git commit -m "fix: mobil menu toggle aksiyonu duzeltildi"`
   - ❌ *Hatalı Örnek:* `git commit -m "geliştirme yapıldı"` (Anlamsız ve Türkçe karakter içeriyor)
2. **Otomatik Push:** Commit oluşturulduktan sonra değişiklikler `git push` komutu ile GitHub üzerindeki aktif dala (branch) gönderilmelidir.

