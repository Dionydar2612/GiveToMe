import {describe,it,expect} from 'vitest';
import {toSatang,fromSatang,addDays,addMonths,monthsBetween,bangkokDay,limitStatus,goalPlan,planNew} from './planning';

describe('เงิน (สตางค์)',()=>{
 it('แปลงไป-กลับ ไม่คลาดเคลื่อน',()=>{
  expect(toSatang('100')).toBe(10000);expect(toSatang('0.1')).toBe(10);expect(toSatang('120.50')).toBe(12050);
  expect(fromSatang(10)).toBe('0.10');expect(fromSatang(-12050)).toBe('-120.50');expect(fromSatang(toSatang('999999999999.99'))).toBe('999999999999.99');});
 it('รูปแบบผิดจะ throw',()=>expect(()=>toSatang('1e3')).toThrow());
});

describe('วันที่',()=>{
 it('วันตามเวลาไทย: 23:30 UTC ของวันที่ 3 คือวันที่ 4 ในไทย',()=>{
  expect(bangkokDay(new Date('2026-11-03T16:59:59Z'))).toBe('2026-11-03');
  expect(bangkokDay(new Date('2026-11-03T17:00:00Z'))).toBe('2026-11-04');});
 it('บวกเดือนแบบหนีวันที่ไม่มี',()=>{
  expect(addMonths('2026-01-31',1)).toBe('2026-02-28');expect(addMonths('2028-01-31',1)).toBe('2028-02-29');
  expect(addMonths('2026-11-03',6)).toBe('2027-05-03');expect(addMonths('2026-12-15',2)).toBe('2027-02-15');});
 it('นับเดือนปัดขึ้น',()=>{
  expect(monthsBetween('2026-01-15','2026-03-15')).toBe(2);
  expect(monthsBetween('2026-01-15','2026-03-20')).toBe(3);
  expect(monthsBetween('2026-01-15','2026-03-10')).toBe(2);});
 it('addDays ข้ามเดือน/ปี',()=>expect(addDays('2026-12-31',1)).toBe('2027-01-01'));
});

describe('ลิมิตรายวัน',()=>{
 const L=10000; // 100 บาท
 it('ยังไม่ได้ใช้เลย ใช้ได้เต็มวงเงิน',()=>{
  const s=limitStatus(L,'2026-11-03','2026-11-03',{});
  expect(s.today.remaining).toBe(10000);expect(s.today.over).toBe(0);expect(s.tomorrow.allowance).toBe(10000);});
 it('ใช้ 150 วันนี้ → เกิน 50 พรุ่งนี้ใช้ได้ 50',()=>{
  const s=limitStatus(L,'2026-11-03','2026-11-03',{'2026-11-03':15000});
  expect(s.today.remaining).toBe(-5000);expect(s.today.over).toBe(5000);
  expect(s.tomorrow.carried).toBe(5000);expect(s.tomorrow.allowance).toBe(5000);});
 it('เมื่อวานเกิน 50 วันนี้ใช้ได้ 50 และใช้ 30 → เหลือ 20 ไม่เกิน',()=>{
  const s=limitStatus(L,'2026-11-02','2026-11-03',{'2026-11-02':15000,'2026-11-03':3000});
  expect(s.today.carried).toBe(5000);expect(s.today.allowance).toBe(5000);expect(s.today.remaining).toBe(2000);
  expect(s.today.over).toBe(0);expect(s.tomorrow.carried).toBe(0);expect(s.tomorrow.allowance).toBe(10000);});
 it('ใช้ไม่หมดไม่สะสม: เมื่อวานใช้ 20 วันนี้ยังใช้ได้แค่ 100',()=>{
  const s=limitStatus(L,'2026-11-02','2026-11-03',{'2026-11-02':2000});
  expect(s.today.allowance).toBe(10000);expect(s.today.remaining).toBe(10000);});
 it('เกินมากกว่าวงเงินทั้งวัน: ถูกหักต่อหลายวัน วันละไม่เกิน L',()=>{
  // วัน1 ใช้ 350 → ค้าง 250 ; วัน2 ไม่ใช้ → ค้าง 150 ; วัน3 ไม่ใช้ → ค้าง 50 ; วัน4 ใช้ได้ 50
  const sp={'2026-11-01':35000};
  const d2=limitStatus(L,'2026-11-01','2026-11-02',sp).today;
  expect(d2.carried).toBe(25000);expect(d2.allowance).toBe(0);expect(d2.remaining).toBe(0);expect(d2.over).toBe(0);expect(d2.nextCarried).toBe(15000);
  const d4=limitStatus(L,'2026-11-01','2026-11-04',sp).today;
  expect(d4.carried).toBe(5000);expect(d4.allowance).toBe(5000);
  const d5=limitStatus(L,'2026-11-01','2026-11-05',sp).today;
  expect(d5.carried).toBe(0);expect(d5.allowance).toBe(10000);});
 it('ช่วงที่ยังมียอดค้าง ถ้าใช้เพิ่มจะเกินและยอดค้างเพิ่มตาม',()=>{
  const s=limitStatus(L,'2026-11-01','2026-11-02',{'2026-11-01':35000,'2026-11-02':3000});
  expect(s.today.over).toBe(3000);expect(s.tomorrow.carried).toBe(18000);expect(s.tomorrow.allowance).toBe(0);});
 it('วันเริ่มนับอยู่ในอนาคต/รายการวันก่อนเริ่มไม่ถูกนับ',()=>{
  const s=limitStatus(L,'2026-11-10','2026-11-03',{'2026-11-02':99999});
  expect(s.rows).toHaveLength(1);expect(s.today.remaining).toBe(10000);});
 it('นับได้ยาวหลายปีไม่ช้า',()=>{
  const s=limitStatus(L,'2010-01-01','2026-11-03',{});expect(s.rows.length).toBeLessThanOrEqual(3661);});
});

describe('เป้าหมายการออม',()=>{
 it('ตัวอย่างของผู้ใช้: ของ 3,000 บาท เก็บใน 6 เดือน → เดือนละ 500',()=>{
  const p=planNew(300000,0,'MONTHS',6,undefined,'2026-11-03');
  expect(p.deadline).toBe('2027-05-03');expect(p.plan.monthsLeft).toBe(6);expect(p.plan.monthly).toBe(50000);});
 it('หารไม่ลงตัว ปัดขึ้นเป็นสตางค์: 1,000 ใน 3 เดือน → 333.34',()=>{
  const p=planNew(100000,0,'MONTHS',3,undefined,'2026-11-03');expect(p.plan.monthly).toBe(33334);});
 it('มีเงินเก็บแล้ว หักออกก่อนหาร',()=>{
  const p=planNew(300000,100000,'MONTHS',4,undefined,'2026-11-03');expect(p.plan.remaining).toBe(200000);expect(p.plan.monthly).toBe(50000);expect(p.plan.pct).toBe(33.3);});
 it('กำหนดยอดต่อเดือน → คำนวณจำนวนเดือน: 3,000 เดือนละ 400 → 8 เดือน',()=>{
  const p=planNew(300000,0,'MONTHLY',undefined,40000,'2026-11-03');expect(p.months).toBe(8);expect(p.plan.monthly).toBeLessThanOrEqual(40000);});
 it('เก็บครบแล้ว ไม่ต้องเก็บเพิ่ม',()=>{
  const p=planNew(300000,300000,'MONTHS',6,undefined,'2026-11-03');expect(p.plan.done).toBe(true);expect(p.plan.monthly).toBe(0);expect(p.plan.pct).toBe(100);});
 it('เดือนที่ผ่านไปทำให้ยอดต่อเดือนปรับตามจริง',()=>{
  // เป้าหมาย 3,000 ภายใน 6 เดือน (ครบ 3 พ.ค. 2027) ผ่านไป 2 เดือนเก็บได้แค่ 500 → เหลือ 2,500 ใน 4 เดือน = 625
  const p=goalPlan(300000,50000,'2027-05-03','2027-01-03');expect(p.monthsLeft).toBe(4);expect(p.monthly).toBe(62500);});
 it('เลยกำหนดแล้ว: ต้องเก็บส่วนที่เหลือทั้งหมดทันที',()=>{
  const p=goalPlan(300000,100000,'2026-10-01','2026-11-03');expect(p.overdue).toBe(true);expect(p.monthly).toBe(200000);});
 it('เป้าหมายเก่าที่ไม่มีวันครบกำหนด: คำนวณแผนไม่ได้ แต่ยังมีความคืบหน้า',()=>{
  const p=goalPlan(300000,60000,null,'2026-11-03');expect(p.monthly).toBeNull();expect(p.pct).toBe(20);});
 it('ยอดรายสัปดาห์/รายวัน',()=>{
  const p=goalPlan(300000,0,'2027-05-03','2026-11-03');expect(p.daily).toBe(Math.ceil(300000/181));expect(p.weekly).toBe(Math.ceil(300000/26));});
});
