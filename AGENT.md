## 1. KESİN KURAL: Sunucu Çalıştırma ve Test Prosedürü

> [!CAUTION]
> **DOĞRUDAN SUNUCU BAŞLATMAK KESİNLİKLE YASAKTIR!**
> Ajan, terminal üzerinden doğrudan `python -m http.server`, `npx http-server`, `live-server` veya başka bir bağımsız komut **ÇALIŞTIRAMAZ**.

### ⚠️ Sunucu Çalıştırma Protokolü:

1. **Test ve Görüntüleme:** Sayfayı yerel ortamda test etmek veya sunucuyu açmak için **YALNIZCA VE KESİNLİKLE** `run_server.bat` dosyası çalıştırılmalıdır.
2. **Komut Kullanımı:**
   - PowerShell üzerinden: `powershell -ExecutionPolicy Bypass -File .\sunucu_baslat.ps1`
3. **Çalışma Mantığı:** Bu script, Windows WMI (`Win32_Process`) kullanarak Python HTTP sunucusunu terminal oturumundan bağımsız bir arka plan süreci olarak başlatır. Port 8000 doluysa eski süreci temizler ve `http://localhost:8000` adresinde projeyi yayına alır.
4. **Ajan Davranışı:** Ajan hiçbir koşulda port açmak için kendi özel komut dizilimini türetmeye çalışmayacak, doğrudan projedeki hazır scripti tetikleyecektir.

## 2. Git Versiyon Kontrolü ve Push Kuralları

Ajan, geliştirmelerini veya hata düzeltmelerini tamamlayıp testlerden geçirdikten sonra değişiklikleri uzak repoya (GitHub) kaydetmelidir.

### 📌 Commit ve Push Kuralları:

1. **Anlamlı Türkçe + ASCII Alfabe:** Commit mesajları ne yapıldığını açıkça anlatan **anlamlı Türkçe** cümleler olmalıdır. Ancak karakter bozulmalarını ve terminal uyumsuzluklarını önlemek için **yalnızca İngilizce alfabe (ASCII) karakterleri** kullanılmalıdır (`ç, ğ, ı, ö, ş, ü` yerine `c, g, i, o, s, u`).
   - ✅ _Doğru Örnek:_ `git commit -m "feat: otomatik test paketi eklendi ve agent.md guncellendi"`
   - ❌ _Hatalı Örnek:_ `git commit -m "geliştirme yapıldı"` (Anlamsız ve Türkçe karakter içeriyor)
2. **Otomatik Push:** Commit oluşturulduktan sonra değişiklikler `git push` komutu ile GitHub üzerindeki aktif dala (branch) gönderilmelidir.

## 3. Moduler Frontend Mimarisi

### JavaScript yapisi

- Her HTML sayfasi sadece kendi giris modulunu `type="module"` ile yukler.
- Her sayfanin JavaScript betikleri `js/<sayfa-adi>/` klasoru altinda bulunur (`js/home/app.js`, `js/login/login.js`, `js/package-builder/main.js`, `js/yasal/`).
- Yeni alanlar (ornek: `js/dashboard/`) kendi klasoru altinda `main.js` veya `app.js` giris dosyasiyla eklenmelidir.
- Birden fazla sayfanin kullandigi, DOM'a dogrudan bagli olmayan yardimcilar `js/shared/` altinda konumlanir.
- Veri kataloglari, durum/is kurallari ve arayuz davranislari ayri modullerde tutulur. Moduller acik `export`/`import` kullansin; global degisken ve klasik script bagimliligi olusturmayin.

### CSS yapisi

- Her sayfanin stil dosyalari `css/<sayfa-adi>/` klasoru altinda bulunur.
- Ana sayfa stilleri `css/home/styles.css` giris noktasi ile `css/home/` altindaki modulleri bir araya getirir.
- Giriş ekrani `css/login/login.css`, paket olusturucu `css/package-builder/package-builder.css`, yasal sayfalar `css/yasal/yasal.css` konumundadir.
- Ortak token ve temel kurallar sadece gercekten paylasiliyorsa `css/shared/` gibi ortak bir modulde tutulur.

### Dosya yerlesimi

- Sayfa HTML dosyalari proje kokunde tutulur (`index.html`, `login.html`, `paketini-olustur.html`).
- Sayfaya ait tüm stil ve betikler istisnasiz `css/<sayfa-adi>/` ve `js/<sayfa-adi>/` klasörleri altinda yer alir.
- Bir dosya tasindiginda tum HTML kaynak yollari, sayfa baglantilari ve goreli varlik yollari ayni degisiklikte guncellenir.
