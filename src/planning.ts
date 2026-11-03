// ตรรกะคำนวณ "ลิมิตใช้จ่ายรายวัน" และ "เป้าหมายการออม"
// ใช้หน่วยสตางค์ (จำนวนเต็ม) ทั้งหมดเพื่อไม่ให้ทศนิยมคลาดเคลื่อน และไม่พึ่งแพ็กเกจภายนอก
// วันที่ทุกตัวเป็นสตริง 'YYYY-MM-DD' (วันตามเวลาไทย Asia/Bangkok)

// ---------- เงิน (สตางค์) ----------
export const toSatang=(s:string|number):number=>{
  const m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(s).trim());
  if(!m)throw new Error('รูปแบบจำนวนเงินไม่ถูกต้อง: '+s);
  const v=Number(m[2])*100+Number((m[3]||'').padEnd(2,'0'));
  return m[1]?-v:v;
};
export const fromSatang=(c:number):string=>{
  const sign=c<0?'-':'',a=Math.abs(c);
  return sign+Math.floor(a/100)+'.'+String(a%100).padStart(2,'0');
};

// ---------- วันที่ ----------
const MS_DAY=864e5;
const toUTC=(k:string)=>{const[y,m,d]=k.split('-').map(Number);return Date.UTC(y,m-1,d);};
const keyOf=(ms:number)=>new Date(ms).toISOString().slice(0,10);
/** วันที่ตามเวลาไทยของ instant หนึ่ง (ไทยไม่มี DST = UTC+7 ตลอด) */
export const bangkokDay=(d:Date)=>keyOf(d.getTime()+7*36e5);
export const addDays=(k:string,n:number)=>keyOf(toUTC(k)+n*MS_DAY);
export const diffDays=(from:string,to:string)=>Math.round((toUTC(to)-toUTC(from))/MS_DAY);
/** บวกเดือน โดยถ้าวันที่ไม่มีในเดือนปลายทาง (เช่น 31 ม.ค. + 1 เดือน) ใช้วันสุดท้ายของเดือน */
export const addMonths=(k:string,n:number)=>{
  const[y,m,d]=k.split('-').map(Number);
  const first=new Date(Date.UTC(y,m-1+n,1));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return keyOf(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(d,last)));
};
/** จำนวนเดือน (ปัดขึ้น) นับจาก from ถึง to — ถ้าเหลือเศษวันก็นับเพิ่มอีก 1 เดือน */
export const monthsBetween=(from:string,to:string)=>{
  const[fy,fm,fd]=from.split('-').map(Number),[ty,tm,td]=to.split('-').map(Number);
  return (ty-fy)*12+(tm-fm)+(td>fd?1:0);
};

// ---------- ลิมิตรายวัน ----------
/**
 * กติกา: วงเงินต่อวัน L, "ยอดเกินค้างหัก" (debt) คือเงินที่ใช้เกินจากวันก่อน ๆ ที่ยังไม่ได้หักคืน
 *  - วงเงินที่ใช้ได้วันนี้ = max(0, L − debt)
 *  - ใช้ไม่หมด ไม่สะสมไปวันถัดไป
 *  - ใช้เกิน → ส่วนที่เกินถูกยกไปหักจากวงเงินวันถัดไป: debt ใหม่ = max(0, debt + ใช้จริง − L)
 *  - ถ้าเกินมากกว่าวงเงินทั้งวัน ยอดที่เหลือจะถูกหักต่อวันละไม่เกิน L จนหมด
 */
export type LimitDay={date:string;spent:number;carried:number;allowance:number;remaining:number;over:number;nextCarried:number};
export const LIMIT_MAX_DAYS=3660;
/** วันเริ่มนับที่ใช้จริง (กันลูปยาวเกินไปถ้าตั้งไว้นานมาก) */
export const clampStart=(start:string,today:string)=>{
  if(start>today)return today;
  const floor=addDays(today,-LIMIT_MAX_DAYS);
  return start<floor?floor:start;
};
export function limitStatus(limit:number,start:string,today:string,spentByDay:Record<string,number>){
  const rows:LimitDay[]=[];
  let debt=0;
  for(let d=clampStart(start,today);d<=today;d=addDays(d,1)){
    const spent=spentByDay[d]||0;
    const allowance=Math.max(0,limit-debt);
    const remaining=allowance-spent;            // ติดลบ = ใช้เกินวงเงินของวันนี้
    const nextCarried=Math.max(0,debt+spent-limit);
    rows.push({date:d,spent,carried:debt,allowance,remaining,over:Math.max(0,-remaining),nextCarried});
    debt=nextCarried;
  }
  const t=rows[rows.length-1];
  return{today:t,tomorrow:{carried:t.nextCarried,allowance:Math.max(0,limit-t.nextCarried)},rows};
}

// ---------- เป้าหมายการออม ----------
export type GoalPlan={remaining:number;pct:number;done:boolean;overdue:boolean;
  monthsLeft:number|null;monthly:number|null;weekly:number|null;daily:number|null};
export function goalPlan(target:number,saved:number,deadline:string|null,today:string):GoalPlan{
  const remaining=Math.max(0,target-saved);
  const pct=target>0?Math.min(100,Math.floor(saved/target*1000)/10):0;
  const done=remaining===0;
  if(!deadline)return{remaining,pct,done,overdue:false,monthsLeft:null,monthly:null,weekly:null,daily:null};
  const overdue=deadline<today;
  const monthsLeft=overdue?1:Math.max(1,monthsBetween(today,deadline));
  const daysLeft=overdue?1:Math.max(1,diffDays(today,deadline));
  // ปัดขึ้นเสมอ เพื่อให้เก็บครบตามเป้าจริง ไม่ขาดเศษสตางค์
  return{remaining,pct,done,overdue,monthsLeft,
    monthly:done?0:Math.ceil(remaining/monthsLeft),
    weekly:done?0:Math.ceil(remaining/Math.max(1,Math.ceil(daysLeft/7))),
    daily:done?0:Math.ceil(remaining/daysLeft)};
}
/** สร้างแผนเป้าหมายใหม่ จาก "จำนวนเดือน" หรือ "ยอดที่เก็บไหวต่อเดือน" */
export function planNew(target:number,saved:number,mode:'MONTHS'|'MONTHLY',months:number|undefined,monthly:number|undefined,today:string){
  const remaining=Math.max(0,target-saved);
  let n=remaining===0?1:mode==='MONTHS'?(months??1):Math.ceil(remaining/Math.max(1,monthly??1));
  n=Math.min(600,Math.max(1,n));
  const deadline=addMonths(today,n);
  return{months:n,deadline,plan:goalPlan(target,saved,deadline,today)};
}
