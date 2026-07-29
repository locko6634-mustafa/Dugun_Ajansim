// Express türlerini içe aktar
import type { Request, Response, NextFunction } from 'express';
// Zod hata türünü ve Zod nesne şeması türünü içe aktar
import { ZodError, type AnyZodObject } from 'zod';
// Özel uygulama hata sınıfımızı içe aktar
import { AppError } from '../utils/appError.js';

// İstemciden gelen HTTP isteğinin body, query ve params verilerini Zod şeması ile doğrulayan middleware üretici fonksiyonu
export const validateRequest = (schema: AnyZodObject) => {
  // Express middleware fonksiyonu döndür
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // İsteğin body, query ve params bileşenlerini Zod şemasına göre asenkron olarak doğrula ve ayrıştır (parse)
      const validatedRequest = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Doğrulanmış ve temizlenmiş (normalize edilmiş) verileri tekrar request nesnesine geri yaz
      req.body = validatedRequest.body;
      req.query = validatedRequest.query;
      req.params = validatedRequest.params;
      
      // Bir sonraki middleware veya kontrolcüye (controller) geç
      next();
    } catch (error) {
      // Hata bir Zod doğrulama hatası ise
      if (error instanceof ZodError) {
        // Hatalı alanları ve mesajlarını kullanıcıya dönülecek temiz bir diziye dönüştür
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        // HTTP 400 Bad Request durumu ve doğrulama hatası detaylarıyla AppError fırlat ve next() ile ilet
        next(new AppError('Girdi doğrulama hatası', 400, true, formattedErrors));
      } else {
        // Zod dışındaki beklenmeyen hataları doğrudan hata yakalama middleware'ine devret
        next(error);
      }
    }
  };
};

