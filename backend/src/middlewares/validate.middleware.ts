// Express türlerini içe aktar
import type { Request, Response, NextFunction } from "express";
// Zod hata türünü ve Zod nesne şeması türünü içe aktar
import { ZodError, type z } from "zod";
// Özel uygulama hata sınıfımızı içe aktar
import { AppError } from "../utils/appError.js";

type ValidationOptions = {
  statusCode?: 400 | 422;
  code?: string;
};

type RequestValidationSchema = z.ZodType<{
  body?: unknown;
  query?: unknown;
  params?: unknown;
}>;

// İstemciden gelen HTTP isteğinin body, query ve params verilerini Zod şeması ile doğrulayan middleware üretici fonksiyonu
export const validateRequest = (schema: RequestValidationSchema, options: ValidationOptions = {}) => {
  // Express middleware fonksiyonu döndür
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // İsteğin body, query ve params bileşenlerini Zod şemasına göre asenkron olarak doğrula ve ayrıştır (parse)
      const validatedRequest = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      });

      // Doğrulanmış ve temizlenmiş (normalize edilmiş) verileri tekrar request nesnesine geri yaz
      req.body = validatedRequest.body;
      req.query = validatedRequest.query as Request["query"];
      req.params = validatedRequest.params as Request["params"];

      // Bir sonraki middleware veya kontrolcüye (controller) geç
      next();
    } catch (error) {
      // Hata bir Zod doğrulama hatası ise
      if (error instanceof ZodError) {
        // Hatalı alanları ve mesajlarını kullanıcıya dönülecek temiz bir diziye dönüştür
        const formattedErrors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message
        }));
        // HTTP 400 Bad Request durumu ve doğrulama hatası detaylarıyla AppError fırlat ve next() ile ilet
        next(
          new AppError("Girdi doğrulama hatası", options.statusCode ?? 400, true, formattedErrors, {
            code: options.code ?? "VALIDATION_ERROR"
          })
        );
      } else {
        // Zod dışındaki beklenmeyen hataları doğrudan hata yakalama middleware'ine devret
        next(error);
      }
    }
  };
};
