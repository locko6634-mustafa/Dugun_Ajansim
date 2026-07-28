import { ZodError } from 'zod';
import { AppError } from '../utils/appError.js';
export const validateRequest = (schema) => {
    return async (req, _res, next) => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            next();
        }
        catch (error) {
            if (error instanceof ZodError) {
                const formattedErrors = error.errors.map((err) => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));
                next(new AppError('Girdi doğrulama hatası', 400, true, formattedErrors));
            }
            else {
                next(error);
            }
        }
    };
};
