import { Decimal } from 'decimal.js';
export type Tx={id:string;type:'income'|'expense'|'transfer'|'refund'|'adjust';amount:string;from?:string;to?:string;status:'posted'|'void'};
export function balance(acc:string,opening:string,txs:Tx[]):string{
  let b=new Decimal(opening);
  for(const t of txs){ if(t.status!=='posted')continue; const a=new Decimal(t.amount);
    if(t.to===acc)b=b.plus(a); if(t.from===acc)b=b.minus(a);}
  return b.toFixed(2);
}
// รายรับ/รายจ่ายรวม: ไม่นับการโอนระหว่างบัญชี
export function totals(txs:Tx[]){
  let i=new Decimal(0),e=new Decimal(0);
  for(const t of txs){ if(t.status!=='posted')continue;
    if(t.type==='income'||t.type==='refund')i=i.plus(t.amount);
    if(t.type==='expense')e=e.plus(t.amount);}
  return {income:i.toFixed(2),expense:e.toFixed(2)};
}
export type Bill={amount:string;paid:string;keys:string[]};
// จ่ายบิลหลายครั้งได้ และคลิกซ้ำ (key เดิม) จะไม่สร้างซ้ำ
export function payBill(b:Bill,pay:string,key:string):Bill&{status:'unpaid'|'partial'|'paid';created:boolean}{
  const st=(p:Decimal)=>p.gte(b.amount)?'paid':p.gt(0)?'partial':'unpaid';
  if(b.keys.includes(key))return{...b,status:st(new Decimal(b.paid)),created:false};
  const p=new Decimal(b.paid).plus(pay);
  return{amount:b.amount,paid:p.toFixed(2),keys:[...b.keys,key],status:st(p),created:true};
}

// รายการเดินบัญชีของบัญชีเดียว: คำนวณยอดคงเหลือหลังแต่ละรายการ (txs ต้องเรียงเก่า→ใหม่)
// ช่วงเวลา from/to เป็น epoch ms; รายการ VOID แสดงได้แต่ไม่กระทบยอด
export type StTx=Tx&{at:number};
export function statement(acc:string,opening:string,txs:StTx[],from?:number,to?:number){
  let run=new Decimal(opening),start=new Decimal(opening),inn=new Decimal(0),out=new Decimal(0);
  const rows:{id:string;signed:string;running:string|null}[]=[];
  for(const t of txs){
    const a=new Decimal(t.amount),signed=t.to===acc?a:a.neg(),posted=t.status==='posted';
    if(posted)run=run.plus(signed);
    if(from!==undefined&&t.at<from){if(posted)start=run;continue;}
    if(to!==undefined&&t.at>to)continue;
    if(posted){if(signed.gt(0))inn=inn.plus(a);else out=out.plus(a);}
    rows.push({id:t.id,signed:signed.toFixed(2),running:posted?run.toFixed(2):null});
  }
  // run หลังลูป = ยอดปัจจุบันของบัญชี; end = ยอดสิ้นสุดช่วง
  return{start:start.toFixed(2),end:start.plus(inn).minus(out).toFixed(2),in:inn.toFixed(2),out:out.toFixed(2),balance:run.toFixed(2),rows:rows.reverse()};
}
