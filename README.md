# Givetome — สมุดบัญชีส่วนตัว (v0.3)

## สิ่งที่ใช้งานได้
สมัครบัญชีได้ทุกคน (ข้อมูลแยกตามผู้ใช้) · เข้าสู่ระบบ · หลายบัญชี · ดูรายการเดินบัญชีรายบัญชี (ยอดยกมา/เข้า/ออก/คงเหลือ) · เช็คลิสต์รายจ่ายประจำเดือน · รายการแยกวัน/หมวด · รายรับ/รายจ่าย/โอน(เติมเงิน) · แก้ไข/ยกเลิกรายการ (มี audit log) · ค้นหา/กรอง · Dashboard · Export CSV · PWA บน iPhone
## ยังไม่มีในเวอร์ชันนี้
ตั้งเงินเดือนอัตโนมัติ/รอบเงินเดือน, งบประมาณ, เป้าหมายออม, กราฟรายงาน, คิวออฟไลน์ (ขณะออฟไลน์จะ "บันทึกไม่ได้" และแจ้งเตือน), สคริปต์ backup, เทสต์ API
(ตารางในฐานข้อมูลของฟีเจอร์เหล่านี้ถูกสร้างไว้แล้ว)

## Deploy บน Render (รักษาข้อมูล Supabase เดิม)

1. สำรองฐานข้อมูล Supabase ก่อน Deploy ทุกครั้ง (ดู `scripts/backup.sh`)
2. Push โปรเจกต์นี้ขึ้น GitHub แล้วเลือก Render → New → Blueprint หรืออัปเดต Web Service เดิม
3. ตั้ง `DATABASE_URL` เป็น connection string ของ **Supabase โปรเจกต์เดิม** และคง `SESSION_SECRET` เดิมไว้
4. Build command: `npm ci --include=dev && npm run build`
5. Start command: `npm start`
6. Start จะรันเฉพาะ SQL แบบ additive ที่สร้าง `RecurringBill` และ `BillCheck` เมื่อยังไม่มี จากนั้นเปิดเซิร์ฟเวอร์ โดยไม่ลบ `BillTemplate`, `SalarySetting` หรือ `BillOccurrence.templateId`
7. ตรวจ `https://<ชื่อ>.onrender.com/health` ต้องได้ `{"ok":true}` แล้วทดสอบเข้าสู่ระบบด้วยบัญชีเดิมและตรวจสอบข้อมูล

**ห้ามใช้ `prisma db push` กับฐานข้อมูลจริงในเวอร์ชันนี้** เพราะ Schema ใหม่ไม่ map ตาราง/คอลัมน์ legacy บางรายการ และ Prisma อาจเสนอให้ลบข้อมูลเหล่านั้น

ดูขั้นตอนและข้อควรระวังเพิ่มเติมที่ `DEPLOY-SAFE.md`

## รันในเครื่อง

ตั้ง `DATABASE_URL` เป็นฐานข้อมูลทดสอบ/ฐานข้อมูล local ก่อน → `npm ci` → `npm run build` → `npm start` → http://localhost:3000

`npm start` จะรัน SQL แบบ additive ที่ทำซ้ำได้ ไม่ใช้ `prisma db push`
เทสต์ unit: `npm test`

## Backup / Restore (ทำเอง ยังไม่มี backup อัตโนมัติ)
`pg_dump "$DATABASE_URL" -Fc -f backup.dump` · restore: `pg_restore --clean --no-owner -d "$DATABASE_URL" backup.dump`
