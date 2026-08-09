ALTER TABLE "message_tasks"
  DROP CONSTRAINT "message_tasks_pending_secret_check";

-- Aktivasyon ve sıfırlama görevleri artık geri çözülebilir parola değil,
-- yalnız talep anında üretilen hash'li tek kullanımlık bağlantı taşır.
