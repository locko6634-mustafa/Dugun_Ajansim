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
   - ✅ *Doğru Örnek:* `git commit -m "feat: otomatik test paketi eklendi ve agent.md guncellendi"`
   - ❌ *Hatalı Örnek:* `git commit -m "geliştirme yapıldı"` (Anlamsız ve Türkçe karakter içeriyor)
2. **Otomatik Push:** Commit oluşturulduktan sonra değişiklikler `git push` komutu ile GitHub üzerindeki aktif dala (branch) gönderilmelidir.


## 3. Moduler Frontend Mimarisi

### JavaScript yapisi

- Her HTML sayfasi sadece kendi giris modulunu `type="module"` ile yukler. Giris dosyalari yalnizca ilgili modulleri bir araya getirir.
- Sayfaya ozgu JavaScript dosyalari `js/` altinda bulunur. Kucuk sayfalar tek dosya kullanabilir (`js/login.js`); buyuyen alanlar ozellik bazli klasorlerde ayrilir (`js/home/`, `js/package-builder/`, ileride `js/dashboard/`).
- Yeni dashboard kodlari `js/dashboard/` altinda, kendi `main.js` giris dosyasi ve ozellik bazli modullerle eklenmelidir. Dashboarda ait kodlari ana sayfa veya paket olusturucu modullerine eklemeyin.
- Birden fazla sayfanin kullandigi, DOM'a dogrudan bagli olmayan yardimcilar `js/shared/` altinda konumlanir. Sayfaya ozgu selectorler ve event listener'lar ortak alana tasinmaz.
- Veri kataloglari, durum/is kurallari ve arayuz davranislari ayri modullerde tutulur. Moduller acik `export`/`import` kullansin; global degisken ve klasik script bagimliligi olusturmayin.

### CSS yapisi

- `css/styles.css` ana stil giris noktasi olarak kalir; bolum stilleri `css/styles/` altindaki dosyalarda tutulur.
- Yeni ekranlar kendi stil giris dosyalarini `css/` altinda kullanir. Ornek: giris ekrani `css/login.css`; ana sayfa bolumleri `css/styles/` altindadir. Ortak token ve temel kurallar sadece gercekten paylasiliyorsa ortak bir modulde tutulur.

### Dosya yerlesimi

- Sayfa HTML dosyalari proje kokunde tutulur (`index.html`, `login.html`, `paketini-olustur.html`).
- Sayfaya ait stil ve betikler sirasiyla `css/<sayfa>.css` ve `js/<sayfa>.js` konumunda bulunur; kod buyudugunde yalnizca ilgili alan icin `js/<sayfa>/` klasoru acilir.
- Bir dosya tasindiginda tum HTML kaynak yollari, sayfa baglantilari ve goreli varlik yollari ayni degisiklikte guncellenir.
