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

// ---------- วันที่ (โซนเวลาไทย UTC+7) ----------
const TZ_MS=7*36e5;
/** วันที่ y-m-d เวลา 00:00 ตามเวลาไทย (m เริ่มที่ 0) */
export const bkk=(y:number,m:number,d:number)=>new Date(Date.UTC(y,m,d)-TZ_MS);
const parts=(d:Date)=>{const s=new Date(d.getTime()+TZ_MS);return{y:s.getUTCFullYear(),m:s.getUTCMonth(),d:s.getUTCDate()};};
export const daysIn=(y:number,m:number)=>new Date(Date.UTC(y,m+1,0)).getUTCDate();
/** "2026-10" ของเวลาไทย */
export const monthKey=(d:Date)=>{const p=parts(d);return p.y+'-'+String(p.m+1).padStart(2,'0');};
export function monthRange(key:string):{start:Date;end:Date}{
  const[y,m]=key.split('-').map(Number);return{start:bkk(y,m-1,1),end:bkk(y,m,1)};}
/** วันครบกำหนดของเดือน (วันที่เกินวันสุดท้ายของเดือน จะใช้วันสุดท้าย) */
export function dueDateIn(key:string,day:number):Date{
  const[y,m]=key.split('-').map(Number);return bkk(y,m-1,Math.min(day,daysIn(y,m-1)));}

// ---------- เงินเดือนอัตโนมัติ ----------
/** วันเงินเดือนที่ถึงกำหนดแล้ว: หลัง startsAt และไม่เกิน now (ไม่ย้อนหลังเกิน 24 เดือน) */
export function duePayDates(startsAt:Date,now:Date,payDay:number):Date[]{
  const s=parts(startsAt),out:Date[]=[];
  for(let i=0;i<24;i++){const y=s.y+Math.floor((s.m+i)/12),m=(s.m+i)%12;
    const d=bkk(y,m,Math.min(payDay,daysIn(y,m)));
    if(d>now)break; if(d>startsAt)out.push(d);}
  return out;}
/** รอบเงินเดือนปัจจุบัน [start,end) — ถ้าไม่ตั้งเงินเดือนใช้เดือนปฏิทิน */
export function cycleBounds(now:Date,payDay?:number|null):{start:Date;end:Date}{
  const p=parts(now);
  if(!payDay)return{start:bkk(p.y,p.m,1),end:bkk(p.y,p.m+1,1)};
  const at=(y:number,m:number)=>{const yy=y+Math.floor(m/12),mm=((m%12)+12)%12;return bkk(yy,mm,Math.min(payDay,daysIn(yy,mm)));};
  const thisM=at(p.y,p.m);
  return now>=thisM?{start:thisM,end:at(p.y,p.m+1)}:{start:at(p.y,p.m-1),end:thisM};}

// ---------- บิลประจำเดือน / งบ / เป้าหมาย ----------
export type BillState='unpaid'|'partial'|'paid';
export function billStatus(amount:string,paid:string):BillState{
  const p=new Decimal(paid);return p.gte(amount)&&new Decimal(amount).gt(0)?'paid':p.gt(0)?'partial':'unpaid';}
export function budgetStatus(amount:string,spent:string){
  const a=new Decimal(amount),s=new Decimal(spent);
  return{remaining:a.minus(s).toFixed(2),pct:a.gt(0)?Math.round(s.div(a).times(100).toNumber()):0,state:s.gt(a)?'over' as const:s.gte(a.times(0.8))?'near' as const:'ok' as const};}
export function goalProgress(target:string,saved:string){
  const t=new Decimal(target),s=Decimal.max(new Decimal(saved),0);
  return{pct:t.gt(0)?Math.min(100,Math.floor(s.div(t).times(100).toNumber())):0,left:Decimal.max(t.minus(s),0).toFixed(2)};}
