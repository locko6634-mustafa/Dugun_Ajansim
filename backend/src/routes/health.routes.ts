// Express çatısından yönlendirme (routing) modülünü içe aktar
import { Router } from 'express';
// Sistem sağlık durumunu kontrol eden denetleyici (controller) fonksiyonu içe aktar
import { getSystemHealth } from '../controllers/health.controller.js';

// Yeni bir Express yönlendirici (Router) nesnesi oluştur
const router = Router();

// Kök adrese ('/') yapılan GET isteklerini getSystemHealth kontrolcüsüne yönlendir (API yolu: /api/v1/health)
router.get('/', getSystemHealth);

// Bu yönlendiriciyi ana uygulamada kullanılmak üzere dışa aktar
export default router;

