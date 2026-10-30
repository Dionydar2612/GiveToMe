-- Additive-only migration: preserves all existing tables, columns and rows.
ALTER TABLE "RecurringBill" ADD COLUMN IF NOT EXISTS "frequency" TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "RecurringBill" ADD COLUMN IF NOT EXISTS "weekday" INTEGER;
CREATE TABLE IF NOT EXISTS "RecurringBillPayment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "dueDate" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "accountId" TEXT NOT NULL,
  "transactionId" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringBillPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringBillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "RecurringBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecurringBillPayment_billId_dueDate_key" ON "RecurringBillPayment"("billId","dueDate");
CREATE UNIQUE INDEX IF NOT EXISTS "RecurringBillPayment_transactionId_key" ON "RecurringBillPayment"("transactionId");
CREATE INDEX IF NOT EXISTS "RecurringBillPayment_userId_dueDate_idx" ON "RecurringBillPayment"("userId","dueDate");
