BEGIN;

ALTER TABLE public.weddings
  ADD COLUMN "paymentTotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paymentDepositCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paymentReceivedCents" INTEGER NOT NULL DEFAULT 0;

UPDATE public.weddings
SET "paymentTotalCents" = CASE
  WHEN jsonb_typeof("packageSummary"::jsonb -> 'totalPriceCents') = 'number'
    THEN GREATEST(("packageSummary"::jsonb ->> 'totalPriceCents')::INTEGER, 0)
  ELSE 0
END;

ALTER TABLE public.weddings
  ADD CONSTRAINT weddings_payment_total_nonnegative CHECK ("paymentTotalCents" >= 0),
  ADD CONSTRAINT weddings_payment_deposit_valid CHECK (
    "paymentDepositCents" >= 0 AND "paymentDepositCents" <= "paymentTotalCents"
  ),
  ADD CONSTRAINT weddings_payment_received_valid CHECK (
    "paymentReceivedCents" >= 0 AND "paymentReceivedCents" <= "paymentTotalCents"
  );

COMMIT;
