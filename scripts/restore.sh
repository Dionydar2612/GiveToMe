#!/usr/bin/env bash
# กู้คืนจากไฟล์ .dump  —  ทับข้อมูลเดิมในฐานข้อมูลปลายทางทั้งหมด!
#   DATABASE_URL=postgresql://... ./scripts/restore.sh backups/givetome-20261027-030000.dump
set -euo pipefail
: "${DATABASE_URL:?ต้องตั้ง DATABASE_URL}"
FILE="${1:?ระบุไฟล์ .dump}"; [ -f "$FILE" ] || { echo "ไม่พบไฟล์ $FILE"; exit 1; }
pg_restore --list "$FILE" >/dev/null
echo "จะกู้คืน $FILE ลงฐานข้อมูลปลายทาง และ 'ลบข้อมูลปัจจุบัน' ที่ชนกัน"
read -r -p "พิมพ์ RESTORE เพื่อยืนยัน: " ok; [ "$ok" = "RESTORE" ] || { echo "ยกเลิก"; exit 1; }
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" "$FILE"
echo "กู้คืนเสร็จแล้ว"
