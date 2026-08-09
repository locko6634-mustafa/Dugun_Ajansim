ALTER TABLE "booking_applications"
DROP CONSTRAINT "booking_applications_review_state_check",
ADD CONSTRAINT "booking_applications_review_state_check"
CHECK (
  (
    "status" = 'ONAY_BEKLIYOR'
    AND "reviewedAt" IS NULL
    AND "reviewedById" IS NULL
    AND "rejectionReason" IS NULL
    AND "paymentFlowExpiredAt" IS NULL
  )
  OR
  (
    "status" = 'ONAYLANDI'
    AND "reviewedAt" IS NOT NULL
    AND "reviewedById" IS NOT NULL
    AND "rejectionReason" IS NULL
    AND "paymentFlowExpiredAt" IS NULL
  )
  OR
  (
    "status" = 'REDDEDILDI'
    AND "reviewedAt" IS NOT NULL
    AND "reviewedById" IS NOT NULL
    AND (
      "rejectionReason" IS NOT NULL
      OR (
        "rejectionReason" IS NULL
        AND "piiCiphertext" IS NOT NULL
        AND "piiEncryptionVersion" = 3
        AND "piiSchemaVersion" = 1
      )
    )
    AND "paymentFlowExpiredAt" IS NULL
  )
  OR
  (
    "status" = 'IPTAL_EDILDI'
    AND (
      ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
      OR
      (
        "paymentFlowExpiredAt" IS NOT NULL
        AND "reviewedAt" IS NULL
        AND "reviewedById" IS NULL
        AND "rejectionReason" IS NULL
      )
    )
  )
);
