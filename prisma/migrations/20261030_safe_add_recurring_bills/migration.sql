-- SAFE, ADDITIVE migration for GiveToMe v0.3.
-- Intentionally does not DROP tables/columns, ALTER existing columns, or delete rows.
-- Legacy BillTemplate, SalarySetting and BillOccurrence.templateId are preserved.

CREATE TABLE IF NOT EXISTS "RecurringBill" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "dueDay" INTEGER NOT NULL DEFAULT 1,
  "accountId" TEXT,
  "category" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringBill_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecurringBill_userId_idx"
  ON "RecurringBill"("userId");

CREATE TABLE IF NOT EXISTS "BillCheck" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "accountId" TEXT,
  "transactionId" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillCheck_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "RecurringBill"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillCheck_billId_month_key"
  ON "BillCheck"("billId", "month");
CREATE INDEX IF NOT EXISTS "BillCheck_userId_month_idx"
  ON "BillCheck"("userId", "month");
