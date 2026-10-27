import {describe,it,expect} from 'vitest';
import {balance,totals,payBill,Tx} from './ledger';
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
