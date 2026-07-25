## 1. KESİN KURAL: Sunucu Çalıştırma ve Test Prosedürü
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

## 2. Git Versiyon Kontrolü ve Push Kuralları

Ajan, geliştirmelerini veya hata düzeltmelerini tamamlayıp testlerden geçirdikten sonra değişiklikleri uzak repoya (GitHub) kaydetmelidir.

### 📌 Commit ve Push Kuralları:
1. **Anlamlı Türkçe + ASCII Alfabe:** Commit mesajları ne yapıldığını açıkça anlatan **anlamlı Türkçe** cümleler olmalıdır. Ancak karakter bozulmalarını ve terminal uyumsuzluklarını önlemek için **yalnızca İngilizce alfabe (ASCII) karakterleri** kullanılmalıdır (`ç, ğ, ı, ö, ş, ü` yerine `c, g, i, o, s, u`).
   - ✅ *Doğru Örnek:* `git commit -m "feat: otomatik test paketi eklendi ve agent.md guncellendi"`
   - ✅ *Doğru Örnek:* `git commit -m "fix: mobil menu toggle aksiyonu duzeltildi"`
   - ❌ *Hatalı Örnek:* `git commit -m "geliştirme yapıldı"` (Anlamsız ve Türkçe karakter içeriyor)
2. **Otomatik Push:** Commit oluşturulduktan sonra değişiklikler `git push` komutu ile GitHub üzerindeki aktif dala (branch) gönderilmelidir.

