// Uygulama genelinde standart, anlaşılır ve güvenli hata fırlatmak için kullanılan özel Hata (Error) sınıfı
export class AppError extends Error {
    // HTTP durum kodu (Örn: 400 Geçersiz İstek, 404 Bulunamadı, 500 Sunucu Hatası)
    statusCode;
    // Hatanın beklenen/öngörülen bir operasyonel hata mı yoksa beklenmeyen bir yazılım çökmesi mi olduğunu belirtir
    isOperational;
    // İsteğe bağlı olarak ek ayrıntılar veya validasyon (doğrulama) hatası listesi
    errors;
    // Yapıcı metod: Hata mesajı, durum kodu, operasyonel durumu ve detayları alır
    constructor(message, statusCode = 500, isOperational = true, errors) {
        // Üst sınıf olan varsayılan JavaScript Error sınıfına hata mesajını ilet
        super(message);
        // Verilen durum kodunu sınıfa ata
        this.statusCode = statusCode;
        // Operasyonel hata durumunu sınıfa ata
        this.isOperational = isOperational;
        // Varsa ek hata detaylarını sınıfa ata
        this.errors = errors;
        // Prototype zincirini düzgün korumak için Object.setPrototypeOf kullan (TypeScript/ES5 kalıtım uyumlaştırması)
        Object.setPrototypeOf(this, new.target.prototype);
        // Hatanın nerede oluştuğunu gösteren çağrı yığınını (stack trace) yakala ve temiz tut
        Error.captureStackTrace(this, this.constructor);
    }
}
