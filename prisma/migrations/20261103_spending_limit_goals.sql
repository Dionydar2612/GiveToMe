-- Additive-only migration: ไม่ลบ/ไม่แก้ข้อมูลเดิม ทำซ้ำได้ปลอดภัย
-- 1) ลิมิตใช้จ่ายรายวัน
CREATE TABLE IF NOT EXISTS "SpendingLimit" (
  "userId" TEXT NOT NULL,
  "dailyLimit" DECIMAL(14,2) NOT NULL,
  "startDate" DATE NOT NULL,
  "includeBills" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpendingLimit_pkey" PRIMARY KEY ("userId")
);

-- 2) เป้าหมายการออม: ตาราง SavingsGoal มีอยู่แล้วในฐานข้อมูลจริง (สร้างเปล่าไว้ให้เฉพาะ DB ใหม่) แล้วเพิ่มคอลัมน์ใหม่แบบ additive
CREATE TABLE IF NOT EXISTS "SavingsGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "target" DECIMAL(14,2) NOT NULL,
  "accountId" TEXT,
  CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "deadline" DATE;
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "saved" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SavingsGoal_userId_idx" ON "SavingsGoal"("userId");
