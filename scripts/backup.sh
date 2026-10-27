#!/usr/bin/env bash
# สำรองฐานข้อมูล Givetome (PostgreSQL) เป็นไฟล์ .dump พร้อมตรวจไฟล์และลบของเก่า
#   DATABASE_URL=postgresql://... ./scripts/backup.sh            # เก็บ 14 ไฟล์ล่าสุดใน ./backups
#   BACKUP_DIR=/path KEEP=30 ./scripts/backup.sh
# ตั้งเวลาอัตโนมัติ (cron ทุกวัน 03:00):  0 3 * * * cd /path/to/givetome && DATABASE_URL=... ./scripts/backup.sh >> backups/backup.log 2>&1
# ไฟล์สำรองมีข้อมูลการเงินจริง — เก็บในที่ปลอดภัย อย่า commit ขึ้น Git (backups/ ถูกใส่ใน .gitignore แล้ว)
set -euo pipefail
: "${DATABASE_URL:?ต้องตั้ง DATABASE_URL}"
command -v pg_dump >/dev/null || { echo "ไม่พบ pg_dump (ติดตั้ง postgresql-client)"; exit 1; }
DIR="${BACKUP_DIR:-./backups}"; KEEP="${KEEP:-14}"
mkdir -p "$DIR"; chmod 700 "$DIR"
FILE="$DIR/givetome-$(date +%Y%m%d-%H%M%S).dump"
umask 077
pg_dump "$DATABASE_URL" -Fc --no-owner -f "$FILE.part"
pg_restore --list "$FILE.part" >/dev/null   # ตรวจว่าไฟล์อ่านได้จริง
mv "$FILE.part" "$FILE"
ls -1t "$DIR"/givetome-*.dump 2>/dev/null | tail -n +"$((KEEP+1))" | xargs -r rm -f --
echo "OK  $FILE  ($(du -h "$FILE" | cut -f1))  เก็บไว้ ${KEEP} ไฟล์ล่าสุด"
