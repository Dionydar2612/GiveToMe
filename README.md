# Givetome — สมุดบัญชีส่วนตัว (v0.3)

## สิ่งที่ใช้งานได้
- **บัญชีผู้ใช้**: ใครก็สมัครได้ ข้อมูลทุกอย่างแยกตาม user (ทุก query ผูก `userId`; รหัสผ่าน scrypt + cookie ลงลายมือชื่อ)
  ปิดรับสมัครได้ด้วย `ALLOW_SIGNUP=false`
- **รายรับ / รายจ่าย / โอนระหว่างบัญชี**, แก้ไข/ยกเลิกรายการ (VOID + audit log), ค้นหา/กรอง, Export CSV
- **รายการ**: ลิสต์ว่าจ่ายอะไรบ้างรายเดือน แยกตามวัน กรองตามประเภท/บัญชี
- **รายการเดินบัญชี**: กดบัญชีเพื่อดู statement พร้อมยอดคงเหลือหลังแต่ละรายการ
- **เช็คลิสต์รายเดือน + บิลประจำ**: บิลประจำสร้างรายการของแต่ละเดือนให้เอง ติ๊กจ่าย (จ่ายบางส่วน/หลายครั้งได้, กดซ้ำไม่ซ้ำ) แก้ยอดเฉพาะเดือน ยกเลิกการจ่ายได้
- **เงินเดือนอัตโนมัติ / รอบเงินเดือน**: ลงรายรับให้เองเมื่อถึงวัน (ตั้งแต่รอบถัดไป ไม่ย้อนหลัง) แสดงรอบปัจจุบันและวันที่เหลือ
- **งบประมาณรายหมวด** (ใช้ต่อเนื่องทุกเดือนจนกว่าจะเปลี่ยน), **เป้าหมายออม** (ความคืบหน้า = ยอดบัญชีที่ผูกไว้)
- **รายงาน**: กราฟสัดส่วนหมวด, รายวัน, แนวโน้มรายเดือน
- **ออฟไลน์**: ไม่มีคิวเขียนข้อมูลโดยเจตนา (กันยอดเงินเพี้ยน) — ขณะออฟไลน์ปุ่มบันทึกถูกปิด ขึ้นแถบเตือน/แจ้งเตือน และข้อมูลที่กรอกไว้ไม่หาย
- PWA บน iPhone

## Deploy บน Render
1. สร้าง repo บน GitHub แล้ว push โฟลเดอร์นี้ (ไฟล์ `.env` ห้าม commit)
2. Render → New → **Blueprint** → เลือก repo (ใช้ `render.yaml` สร้าง Web Service + PostgreSQL)
3. ตรวจ Environment: `DATABASE_URL` (ผูกอัตโนมัติ), `SESSION_SECRET` (สุ่มอัตโนมัติ), เพิ่ม `NODE_ENV=production`
4. กด Deploy — ตอนสตาร์ตระบบสร้าง/อัปเดตตารางให้เอง (`prisma db push`; v0.3 เพิ่มตาราง `BillTemplate`, `SalarySetting` และคอลัมน์ `BillOccurrence.templateId` — เพิ่มอย่างเดียว ไม่ลบข้อมูลเดิม)
5. เปิด `https://<ชื่อ>.onrender.com/health` ต้องได้ `{"ok":true}`
6. เปิดเว็บ → แท็บ “สมัครใช้งาน”
**ค่าใช้จ่าย/ข้อจำกัด:** ตรวจแผน Render ปัจจุบันเอง — แผนฟรีของ Postgres มีอายุจำกัดและไม่เหมาะเก็บข้อมูลจริงระยะยาว ควรใช้แผนเสียเงินที่มี backup

## รันในเครื่อง
`cp .env.example .env` → `npm install` → `npx prisma db push` → `npm run build && node dist/server.js` → http://localhost:3000

## เทสต์
- `npm test` — เทสต์ตรรกะ (ledger, รอบเงินเดือน, งบ, เป้าหมาย) รันได้ทันที
- เทสต์ API (`src/api.test.ts`) ต่อ PostgreSQL จริง และจะถูกข้ามถ้าไม่ตั้ง `TEST_DATABASE_URL`:
  `TEST_DATABASE_URL=postgresql://... npx prisma db push && npm test` (ใช้ฐานข้อมูลสำหรับทดสอบเท่านั้น)

## Backup / Restore
- `DATABASE_URL=... npm run backup` (หรือ `./scripts/backup.sh`) → ไฟล์ `backups/givetome-<เวลา>.dump` ตรวจไฟล์หลังสร้าง เก็บ 14 ไฟล์ล่าสุด (`KEEP=30`, `BACKUP_DIR=...` ปรับได้)
- ตั้งเวลา: cron `0 3 * * * cd /path/givetome && DATABASE_URL=... ./scripts/backup.sh >> backups/backup.log 2>&1`
- กู้คืน: `DATABASE_URL=... ./scripts/restore.sh backups/<ไฟล์>.dump` (ต้องพิมพ์ RESTORE ยืนยัน)
- ต้องมี `pg_dump`/`pg_restore` (postgresql-client) ไฟล์สำรองมีข้อมูลการเงินจริง เก็บไว้ที่ปลอดภัย (`backups/` อยู่ใน `.gitignore`)
