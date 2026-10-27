import {describe,it,expect} from 'vitest';
import {balance,totals,payBill,Tx,bkk,monthKey,monthRange,dueDateIn,duePayDates,cycleBounds,billStatus,budgetStatus,goalProgress} from './ledger';
const tx=(o:Partial<Tx>):Tx=>({id:'1',type:'expense',amount:'0',status:'posted',...o});
describe('ledger',()=>{
 it('เงินเดือนเข้าแล้วยอดเพิ่ม',()=>expect(balance('A','100',[tx({type:'income',amount:'30000',to:'A'})])).toBe('30100.00'));
 it('รายจ่ายลดยอด',()=>expect(balance('A','1000',[tx({amount:'250.50',from:'A'})])).toBe('749.50'));
 it('แก้ 500→300 แล้วไม่หักซ้ำ',()=>expect(balance('A','1000',[tx({amount:'300',from:'A'})])).toBe('700.00'));
 it('ยกเลิกรายการแล้วยอดกลับ',()=>expect(balance('A','1000',[tx({amount:'300',from:'A',status:'void'})])).toBe('1000.00'));
 it('0.1+0.2 แม่นยำ',()=>expect(balance('A','0',[tx({type:'income',amount:'0.1',to:'A'}),tx({type:'income',amount:'0.2',to:'A'})])).toBe('0.30'));
 it('โอนเงิน: ยอดรวมไม่เปลี่ยน ไม่นับเป็นรายจ่าย',()=>{
  const t=[tx({type:'transfer',amount:'220',from:'A',to:'W'})];
  expect(+balance('A','1000',t)+ +balance('W','0',t)).toBe(1000);
  expect(totals(t).expense).toBe('0.00');});
 it('เติมเงิน 220 ใช้ 60: รายจ่ายจริงแค่ 60',()=>{
  const t=[tx({type:'transfer',amount:'220',from:'A',to:'W'}),tx({amount:'60',from:'W'})];
  expect(totals(t).expense).toBe('60.00'); expect(balance('W','0',t)).toBe('160.00');});
 it('จ่ายบิลหลายครั้ง และคลิกซ้ำไม่ซ้ำ',()=>{
  let b=payBill({amount:'3500',paid:'0',keys:[]},'1000','k1'); expect(b.status).toBe('partial');
  const d=payBill(b,'1000','k1'); expect(d.created).toBe(false); expect(d.paid).toBe('1000.00');
  b=payBill(b,'2500','k2'); expect(b.status).toBe('paid');});
});

describe('วันที่/รอบเงินเดือน (เวลาไทย)',()=>{
 const iso=(d:Date)=>d.toISOString();
 it('monthKey ใช้เวลาไทย: 1 ต.ค. 01:00 ไทย = เดือน 10',()=>expect(monthKey(new Date('2026-09-30T18:00:00Z'))).toBe('2026-10'));
 it('monthRange ครอบทั้งเดือน',()=>{const r=monthRange('2026-10');expect(iso(r.start)).toBe('2026-09-30T17:00:00.000Z');expect(iso(r.end)).toBe('2026-10-31T17:00:00.000Z');});
 it('วันที่ 31 ในเดือนที่มี 28 วัน ใช้วันสุดท้าย',()=>expect(iso(dueDateIn('2026-02',31))).toBe(iso(bkk(2026,1,28))));
 it('เงินเดือนลงเฉพาะวันที่หลังเริ่มตั้งค่า และถึงกำหนดแล้ว',()=>{
  const start=bkk(2026,9,20),now=bkk(2026,9,27);
  expect(duePayDates(start,now,25).map(iso)).toEqual([iso(bkk(2026,9,25))]);
  expect(duePayDates(start,now,28)).toEqual([]);   // ยังไม่ถึงวันที่ 28
  expect(duePayDates(start,now,15)).toEqual([]);   // 15 ต.ค. ผ่านไปก่อนตั้งค่า ไม่ย้อนหลัง
  expect(duePayDates(start,bkk(2026,10,16),15).map(iso)).toEqual([iso(bkk(2026,10,15))]);});
 it('ตามทันหลายเดือนที่ไม่ได้เปิดแอป และจัดการสิ้นเดือน',()=>{
  expect(duePayDates(bkk(2026,0,1),bkk(2026,2,1),31).map(iso)).toEqual([iso(bkk(2026,0,31)),iso(bkk(2026,1,28))]);});
 it('รอบเงินเดือน: หลัง/ก่อนวันเงินเดือน และไม่ตั้งค่า=เดือนปฏิทิน',()=>{
  expect(cycleBounds(bkk(2026,9,27),25)).toEqual({start:bkk(2026,9,25),end:bkk(2026,10,25)});
  expect(cycleBounds(bkk(2026,9,10),25)).toEqual({start:bkk(2026,8,25),end:bkk(2026,9,25)});
  expect(cycleBounds(bkk(2026,0,10),25)).toEqual({start:bkk(2025,11,25),end:bkk(2026,0,25)});
  expect(cycleBounds(bkk(2026,9,27),null)).toEqual({start:bkk(2026,9,1),end:bkk(2026,10,1)});});
});
describe('เช็คลิสต์ / งบ / เป้าหมาย',()=>{
 it('สถานะบิล',()=>{expect(billStatus('3500','0')).toBe('unpaid');expect(billStatus('3500','1000')).toBe('partial');expect(billStatus('3500','3500')).toBe('paid');expect(billStatus('0','0')).toBe('unpaid');});
 it('งบ: ปกติ/ใกล้เต็ม/เกิน',()=>{expect(budgetStatus('1000','500').state).toBe('ok');expect(budgetStatus('1000','800').state).toBe('near');
  const o=budgetStatus('1000','1200.50');expect(o.state).toBe('over');expect(o.remaining).toBe('-200.50');expect(o.pct).toBe(120);});
 it('เป้าหมายออม: เปอร์เซ็นต์ไม่เกิน 100 และไม่ติดลบ',()=>{expect(goalProgress('10000','2500')).toEqual({pct:25,left:'7500.00'});
  expect(goalProgress('10000','12000')).toEqual({pct:100,left:'0.00'});expect(goalProgress('10000','-5').pct).toBe(0);});
});
