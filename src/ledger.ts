import Decimal from 'decimal.js';
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
