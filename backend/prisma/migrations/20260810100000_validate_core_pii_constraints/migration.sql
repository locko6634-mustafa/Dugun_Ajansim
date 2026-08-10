ALTER TABLE "booking_applications"
  VALIDATE CONSTRAINT "booking_applications_pii_envelope_check";

ALTER TABLE "weddings"
  VALIDATE CONSTRAINT "weddings_pii_envelope_check";

ALTER TABLE "message_tasks"
  VALIDATE CONSTRAINT "message_tasks_pii_envelope_check";
