# Givetome — สมุดบัญชีส่วนตัว (v0.3)

## สิ่งที่ใช้งานได้
สมัครบัญชีได้ทุกคน (ข้อมูลแยกตามผู้ใช้) · เข้าสู่ระบบ · หลายบัญชี · ดูรายการเดินบัญชีรายบัญชี (ยอดยกมา/เข้า/ออก/คงเหลือ) · เช็คลิสต์รายจ่ายประจำเดือน · รายการแยกวัน/หมวด · รายรับ/รายจ่าย/โอน(เติมเงิน) · แก้ไข/ยกเลิกรายการ (มี audit log) · ค้นหา/กรอง · Dashboard · Export CSV · PWA บน iPhone
## ยังไม่มีในเวอร์ชันนี้
ตั้งเงินเดือนอัตโนมัติ/รอบเงินเดือน, งบประมาณ, เป้าหมายออม, กราฟรายงาน, คิวออฟไลน์ (ขณะออฟไลน์จะ "บันทึกไม่ได้" และแจ้งเตือน), สคริปต์ backup, เทสต์ API
(ตารางในฐานข้อมูลของฟีเจอร์เหล่านี้ถูกสร้างไว้แล้ว)

## Deploy บน Render
1. สร้าง repo บน GitHub แล้ว push โฟลเดอร์นี้ (ไฟล์ `.env` ห้าม commit)
2. Render → New → **Blueprint** → เลือก repo (ใช้ `render.yaml` สร้าง Web Service + PostgreSQL)
3. ตรวจ Environment: `DATABASE_URL` (ผูกอัตโนมัติ), `SESSION_SECRET` (สุ่มอัตโนมัติ), เพิ่ม `NODE_ENV=production`
4. กด Deploy — ตอนสตาร์ตระบบจะสร้างตารางให้เอง (`prisma db push`)
5. เปิด `https://<ชื่อ>.onrender.com/health` ต้องได้ `{"ok":true}`
6. เปิดเว็บ → แท็บ "สร้างบัญชี" → กรอกอีเมล+รหัสผ่าน (≥10 ตัว) ใครก็สมัครได้ และเห็นเฉพาะข้อมูลของตัวเอง
   ถ้าไม่อยากเปิดรับสมัคร ตั้ง Environment `ALLOW_SIGNUP=false` (บัญชีเดิมยังเข้าสู่ระบบได้)
**ค่าใช้จ่าย/ข้อจำกัด:** ตรวจแผน Render ปัจจุบันเอง — แผนฟรีของ Postgres มีอายุจำกัดและไม่เหมาะเก็บข้อมูลจริงระยะยาว ควรใช้แผนเสียเงินที่มี backup

## รันในเครื่อง
`cp .env.example .env` (ตั้ง DATABASE_URL) → `npm install` → `npx prisma db push` → `npm run build && node dist/server.js` → http://localhost:3000
เทสต์: `npm test`

## Backup / Restore (ทำเอง ยังไม่มี backup อัตโนมัติ)
`pg_dump "$DATABASE_URL" -Fc -f backup.dump` · restore: `pg_restore --clean --no-owner -d "$DATABASE_URL" backup.dump`
