import express from 'express';
import {PrismaClient,Prisma} from '@prisma/client';
import {z} from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {Decimal} from 'decimal.js';
import {balance,totals,statement,type Tx} from './ledger.js';

const prisma=new PrismaClient();
const prod=process.env.NODE_ENV==='production';
const SECRET=process.env.SESSION_SECRET||'';
if(!SECRET||SECRET==='change-me'){ if(prod){console.error('SESSION_SECRET required');process.exit(1);} }
const KEY=SECRET||'dev-only';
const app=express();
app.set('trust proxy',1);
app.use(express.json({limit:'100kb'}));
app.use((_q,r,n)=>{r.setHeader('X-Content-Type-Options','nosniff');r.setHeader('X-Frame-Options','DENY');n();});

// ---------- auth (scrypt + signed HttpOnly cookie, หมดอายุ 7 วัน) ----------
const hash=(pw:string)=>{const s=crypto.randomBytes(16);return s.toString('hex')+':'+crypto.scryptSync(pw,s,64).toString('hex');};
const verify=(pw:string,h:string)=>{const[s,k]=h.split(':');const a=Buffer.from(k,'hex'),b=crypto.scryptSync(pw,Buffer.from(s,'hex'),64);return a.length===b.length&&crypto.timingSafeEqual(a,b);};
const sign=(v:string)=>crypto.createHmac('sha256',KEY).update(v).digest('base64url');
function makeToken(uid:string){const v=uid+'.'+(Date.now()+7*864e5);return v+'.'+sign(v);}
function readUser(req:express.Request):string|null{
  const c=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('gtm='));
  if(!c)return null;const[uid,exp,sig]=decodeURIComponent(c.slice(4)).split('.');
  if(!sig||sign(uid+'.'+exp)!==sig||Date.now()>+exp)return null;return uid;}
const setCookie=(res:express.Response,v:string,age:number)=>res.setHeader('Set-Cookie',`gtm=${encodeURIComponent(v)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${prod?'; Secure':''}`);
const hits=new Map<string,{n:number;t:number}>();
function limit(max:number,ms:number):express.RequestHandler{return(q,r,n)=>{const k=q.ip+q.path,now=Date.now(),h=hits.get(k);
  if(!h||now-h.t>ms){hits.set(k,{n:1,t:now});return n();} if(++h.n>max)return void r.status(429).json({error:'ลองใหม่ภายหลัง'});n();};}
// CSRF: SameSite=Strict + ต้องเป็น JSON เท่านั้นสำหรับ POST/PUT/DELETE
const needJson:express.RequestHandler=(q,r,n)=>{if(q.method!=='GET'&&!q.is('application/json')&&q.method!=='DELETE')return void r.status(415).json({error:'ต้องส่งเป็น JSON'});n();};
const auth=(q:express.Request,r:express.Response,n:express.NextFunction)=>{const u=readUser(q);if(!u)return void r.status(401).json({error:'กรุณาเข้าสู่ระบบ'});(q as any).uid=u;n();};
const uid=(q:express.Request):string=>(q as any).uid;
const wrap=(f:express.RequestHandler):express.RequestHandler=>(q,r,n)=>Promise.resolve(f(q,r,n)).catch(e=>{
  if(e instanceof z.ZodError)return void r.status(400).json({error:'ข้อมูลไม่ถูกต้อง',details:e.issues});
  console.error(e);r.status(500).json({error:'เกิดข้อผิดพลาดของระบบ'});});

app.get('/api/me',auth,wrap(async(q,r)=>{const u=await prisma.user.findUnique({where:{id:uid(q)}});
  if(!u)return void r.status(401).json({error:'กรุณาเข้าสู่ระบบ'});r.json({id:u.id,email:u.email});}));
app.get('/health',wrap(async(_q,r)=>{await prisma.$queryRaw`SELECT 1`;r.json({ok:true});}));
const cred=z.object({email:z.string().email().max(200),password:z.string().min(10).max(200)});
// สมัครบัญชีได้ทุกคน (ข้อมูลแยกตาม userId ทุกตาราง) — ตั้ง ALLOW_SIGNUP=false เพื่อปิดรับสมัคร
app.post('/api/auth/register',limit(10,36e5),needJson,wrap(async(q,r)=>{
  if(process.env.ALLOW_SIGNUP==='false')return void r.status(403).json({error:'ปิดรับสมัครอยู่'});
  const b=cred.parse(q.body),email=b.email.toLowerCase();
  if(await prisma.user.findUnique({where:{email}}))return void r.status(409).json({error:'อีเมลนี้มีบัญชีแล้ว ลองเข้าสู่ระบบแทน'});
  try{const u=await prisma.user.create({data:{email,passwordHash:hash(b.password)}});
    setCookie(r,makeToken(u.id),604800);r.status(201).json({id:u.id});}
  catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return void r.status(409).json({error:'อีเมลนี้มีบัญชีแล้ว ลองเข้าสู่ระบบแทน'});throw e;}}));
app.post('/api/auth/login',limit(10,9e5),needJson,wrap(async(q,r)=>{
  const b=cred.parse(q.body);const u=await prisma.user.findUnique({where:{email:b.email.toLowerCase()}});
  if(!u||!verify(b.password,u.passwordHash))return void r.status(401).json({error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'});
  setCookie(r,makeToken(u.id),604800);r.json({ok:true});}));
app.post('/api/auth/logout',needJson,(_q,r)=>{setCookie(r,'',0);r.json({ok:true});});

// ---------- accounts ----------
const money=z.string().regex(/^\d{1,12}(\.\d{1,2})?$/,'จำนวนเงินต้องเป็นตัวเลขไม่ติดลบ');
app.post('/api/accounts',auth,needJson,wrap(async(q,r)=>{
  const b=z.object({name:z.string().min(1).max(80),kind:z.string().max(30),opening:money.default('0')}).parse(q.body);
  r.status(201).json(await prisma.account.create({data:{...b,userId:uid(q)}}));}));
async function accountsWithBalance(userId:string){
  const [accs,rows]=await Promise.all([prisma.account.findMany({where:{userId,active:true}}),
    prisma.transaction.findMany({where:{userId,status:'POSTED'}})]);
  const txs:Tx[]=rows.map(t=>({id:t.id,type:t.type.toLowerCase() as Tx['type'],amount:t.amount.toString(),from:t.fromAccountId??undefined,to:t.toAccountId??undefined,status:'posted'}));
  return{accounts:accs.map(a=>({id:a.id,name:a.name,kind:a.kind,balance:balance(a.id,a.opening.toString(),txs)})),totals:totals(txs)};}
app.get('/api/accounts',auth,wrap(async(q,r)=>r.json(await accountsWithBalance(uid(q)))));
// รายการเดินบัญชีของบัญชีเดียว (ยอดยกมา/เข้า/ออก/คงเหลือหลังแต่ละรายการ) — ดูได้เฉพาะบัญชีของตัวเอง
app.get('/api/accounts/:id/statement',auth,wrap(async(q,r)=>{
  const userId=uid(q),id=z.string().uuid().parse(q.params.id);
  const f=z.object({from:z.string().datetime().optional(),to:z.string().datetime().optional()}).parse(q.query);
  const acc=await prisma.account.findFirst({where:{id,userId}});if(!acc)return void r.status(404).json({error:'ไม่พบบัญชี'});
  const all=await prisma.transaction.findMany({where:{userId,OR:[{fromAccountId:id},{toAccountId:id}]},orderBy:[{occurredAt:'asc'},{createdAt:'asc'}]});
  const st=statement(id,acc.opening.toString(),all.map(t=>({id:t.id,type:t.type.toLowerCase() as Tx['type'],amount:t.amount.toString(),
    from:t.fromAccountId??undefined,to:t.toAccountId??undefined,status:t.status==='POSTED'?'posted':'void',at:t.occurredAt.getTime()})),
    f.from?new Date(f.from).getTime():undefined,f.to?new Date(f.to).getTime():undefined);
  const byId=new Map(all.map(t=>[t.id,t]));
  r.json({account:{id:acc.id,name:acc.name,kind:acc.kind,opening:acc.opening.toString()},start:st.start,end:st.end,in:st.in,out:st.out,balance:st.balance,
    rows:st.rows.map(x=>({...byId.get(x.id)!,signed:x.signed,running:x.running}))});}));

// ---------- transactions (ยอดคำนวณจากรายการในฐานข้อมูลเสมอ ไม่รับยอดจาก Frontend) ----------
const txIn=z.object({type:z.enum(['INCOME','EXPENSE','TRANSFER','REFUND','ADJUST']),amount:money,title:z.string().min(1).max(120),
  categoryId:z.string().uuid().optional(),fromAccountId:z.string().uuid().optional(),toAccountId:z.string().uuid().optional(),
  occurredAt:z.string().datetime(),idempotencyKey:z.string().min(8).max(100),note:z.string().max(500).optional(),category:z.string().max(60).optional()})
 .refine(t=>t.type==='TRANSFER'?!!t.fromAccountId&&!!t.toAccountId&&t.fromAccountId!==t.toAccountId:true,'โอนต้องมีบัญชีต้นทางและปลายทางที่ต่างกัน')
 .refine(t=>t.type==='EXPENSE'?!!t.fromAccountId:['INCOME','REFUND'].includes(t.type)?!!t.toAccountId:true,'ต้องระบุบัญชี');
async function ownsAccounts(userId:string,ids:(string|undefined)[]){const x=ids.filter(Boolean) as string[];
  return x.length===0||(await prisma.account.count({where:{userId,id:{in:x}}}))===x.length;}
app.post('/api/transactions',auth,needJson,wrap(async(q,r)=>{
  const b=txIn.parse(q.body);const userId=uid(q);
  if(!await ownsAccounts(userId,[b.fromAccountId,b.toAccountId]))return void r.status(404).json({error:'ไม่พบบัญชี'});
  try{const t=await prisma.$transaction(async db=>{const t=await db.transaction.create({data:{...b,userId,occurredAt:new Date(b.occurredAt)}});
    await db.auditLog.create({data:{userId,entity:'transaction',entityId:t.id,newValue:t as unknown as Prisma.InputJsonValue}});return t;});
    r.status(201).json(t);}
  catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002'){ // คลิกซ้ำ -> คืนรายการเดิม
    return void r.json(await prisma.transaction.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey:b.idempotencyKey}}}));}throw e;}}));
app.get('/api/transactions',auth,wrap(async(q,r)=>{
  const f=z.object({search:z.string().max(100).optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional(),
    type:z.enum(['INCOME','EXPENSE','TRANSFER','REFUND','ADJUST']).optional(),accountId:z.string().uuid().optional(),status:z.enum(['POSTED','VOID']).optional(),limit:z.coerce.number().int().min(1).max(500).default(500),
    sort:z.enum(['asc','desc']).default('desc')}).parse(q.query);
  r.json(await prisma.transaction.findMany({where:{userId:uid(q),type:f.type,status:f.status,
    title:f.search?{contains:f.search,mode:'insensitive'}:undefined,
    occurredAt:{gte:f.from?new Date(f.from):undefined,lte:f.to?new Date(f.to):undefined},
    OR:f.accountId?[{fromAccountId:f.accountId},{toAccountId:f.accountId}]:undefined},
    orderBy:{occurredAt:f.sort},take:f.limit}));}));
// แก้ไข = แทนที่ค่าในรายการเดิม (500→300 ยอดเป็น 300 ไม่ใช่ 800) + บันทึก audit ค่าเดิม/ค่าใหม่
app.put('/api/transactions/:id',auth,needJson,wrap(async(q,r)=>{
  const b=z.object({amount:money,title:z.string().min(1).max(120),note:z.string().max(500).nullable().optional(),category:z.string().max(60).nullable().optional()}).parse(q.body);const userId=uid(q);
  const id=z.string().uuid().parse(q.params.id);
  const out=await prisma.$transaction(async db=>{const old=await db.transaction.findFirst({where:{id,userId,status:'POSTED'}});if(!old)return null;
    const n=await db.transaction.update({where:{id},data:b});
    if(old.billOccurrenceId)await db.billCheck.updateMany({where:{id:old.billOccurrenceId,userId},data:{amount:b.amount}});
    await db.auditLog.create({data:{userId,entity:'transaction',entityId:id,oldValue:old as unknown as Prisma.InputJsonValue,newValue:n as unknown as Prisma.InputJsonValue}});return n;});
  out?r.json(out):r.status(404).json({error:'ไม่พบรายการ'});}));
app.delete('/api/transactions/:id',auth,wrap(async(q,r)=>{ // ยกเลิก (VOID) ไม่ลบจริง
  const userId=uid(q);const id=z.string().uuid().parse(q.params.id);
  const out=await prisma.$transaction(async db=>{const old=await db.transaction.findFirst({where:{id,userId,status:'POSTED'}});if(!old)return null;
    const n=await db.transaction.update({where:{id},data:{status:'VOID'}});
    if(old.billOccurrenceId)await db.billCheck.deleteMany({where:{id:old.billOccurrenceId,userId}});
    await db.auditLog.create({data:{userId,entity:'transaction',entityId:id,oldValue:{status:'POSTED'},newValue:{status:'VOID'}}});return n;});
  out?r.json(out):r.status(404).json({error:'ไม่พบรายการ'});}));

// ---------- recurring bills: monthly / weekly, linked to a default funding account ----------
const ym=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const billIn=z.object({name:z.string().min(1).max(80),amount:money,frequency:z.enum(['MONTHLY','WEEKLY']).default('MONTHLY'),
  dueDay:z.number().int().min(1).max(31).default(1),weekday:z.number().int().min(0).max(6).nullable().optional(),
  accountId:z.string().uuid(),category:z.string().max(60).nullable().optional()})
  .refine(b=>b.frequency!=='WEEKLY'||b.weekday!==null&&b.weekday!==undefined,'เลือกวันที่หักรายสัปดาห์');
const monthOf=(d:Date)=>d.toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).slice(0,7);
const dateKey=(d:Date)=>d.toISOString().slice(0,10);
const daysForBill=(bill:any,year:number,month:number)=>{
  const last=new Date(Date.UTC(year,month,0)).getUTCDate(),out:string[]=[];
  if(bill.frequency==='WEEKLY'){
    for(let day=1;day<=last;day++){const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCDay()===bill.weekday)out.push(dateKey(d));}
  } else out.push(dateKey(new Date(Date.UTC(year,month-1,Math.min(bill.dueDay,last)))));
  return out;
};
app.get('/api/bills',auth,wrap(async(q,r)=>{
  const {month}=z.object({month:ym}).parse(q.query);const userId=uid(q),[year,mo]=month.split('-').map(Number);
  const [bills,payments,legacy]=await Promise.all([
    prisma.recurringBill.findMany({where:{userId},orderBy:[{dueDay:'asc'},{createdAt:'asc'}]}),
    prisma.recurringBillPayment.findMany({where:{userId,dueDate:{gte:new Date(Date.UTC(year,mo-1,1)),lt:new Date(Date.UTC(year,mo,1))}}}),
    prisma.billCheck.findMany({where:{userId,month}})
  ]);
  const paid=new Map(payments.map(x=>[dateKey(x.dueDate),x]));
  const legacyByBill=new Map(legacy.map(x=>[x.billId,x]));
  const items=bills.flatMap(b=>{
    if(!b.active&& !payments.some(p=>p.billId===b.id) && !legacyByBill.has(b.id))return [];
    if(monthOf(b.createdAt)>month)return [];
    return daysForBill(b,year,mo).map(d=>{
      const p=payments.find(x=>x.billId===b.id&&dateKey(x.dueDate)===d);
      const old= b.frequency==='MONTHLY'?legacyByBill.get(b.id):undefined;
      const isPaid=!!p||!!old;
      return {id:b.id,occurrenceDate:d,name:b.name,planned:b.amount.toString(),amount:(p?.amount??old?.amount??b.amount).toString(),
        dueDay:b.dueDay,frequency:b.frequency,weekday:b.weekday,accountId:p?.accountId??old?.accountId??b.accountId,category:b.category,
        paid:isPaid,paidAt:p?.paidAt??old?.paidAt??null};
    });
  }).sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate));
  const sum=(xs:typeof items)=>xs.reduce((s,i)=>s.plus(i.amount),new Decimal(0));
  r.json({month,items,total:sum(items).toFixed(2),paid:sum(items.filter(i=>i.paid)).toFixed(2),remaining:sum(items.filter(i=>!i.paid)).toFixed(2)});
}));
app.post('/api/bills',auth,needJson,wrap(async(q,r)=>{
  const b=billIn.parse(q.body),userId=uid(q);
  if(!await ownsAccounts(userId,[b.accountId]))return void r.status(404).json({error:'ไม่พบบัญชี'});
  r.status(201).json(await prisma.recurringBill.create({data:{...b,userId,weekday:b.frequency==='WEEKLY'?b.weekday:null}}));}));
app.put('/api/bills/:id',auth,needJson,wrap(async(q,r)=>{
  const b=billIn.parse(q.body),userId=uid(q),id=z.string().uuid().parse(q.params.id);
  if(!await ownsAccounts(userId,[b.accountId]))return void r.status(404).json({error:'ไม่พบบัญชี'});
  const n=await prisma.recurringBill.updateMany({where:{id,userId},data:{...b,weekday:b.frequency==='WEEKLY'?b.weekday:null}});
  n.count?r.json({ok:true}):r.status(404).json({error:'ไม่พบรายการ'});}));
app.delete('/api/bills/:id',auth,wrap(async(q,r)=>{
  const userId=uid(q),id=z.string().uuid().parse(q.params.id);
  const n=await prisma.recurringBill.updateMany({where:{id,userId},data:{active:false}});
  n.count?r.json({ok:true}):r.status(404).json({error:'ไม่พบรายการ'});}));
app.post('/api/bills/:id/pay',auth,needJson,wrap(async(q,r)=>{
  const userId=uid(q),id=z.string().uuid().parse(q.params.id);
  const b=z.object({occurrenceDate:dateOnly,amount:money.optional(),accountId:z.string().uuid().optional()}).parse(q.body);
  const bill=await prisma.recurringBill.findFirst({where:{id,userId}});if(!bill)return void r.status(404).json({error:'ไม่พบรายการ'});
  const accountId=b.accountId??bill.accountId;if(!await ownsAccounts(userId,[accountId]))return void r.status(404).json({error:'ไม่พบบัญชี'});
  const d=new Date(b.occurrenceDate+'T00:00:00.000Z'),amount=b.amount??bill.amount.toString(),payId=crypto.randomUUID();
  try{await prisma.$transaction(async db=>{
    const t=await db.transaction.create({data:{userId,type:'EXPENSE',amount,title:bill.name,category:bill.category,fromAccountId:accountId,
      occurredAt:new Date(),idempotencyKey:'recurring:'+payId,billOccurrenceId:payId,note:'บิลประจำ '+b.occurrenceDate}});
    await db.recurringBillPayment.create({data:{id:payId,userId,billId:id,dueDate:d,amount,accountId,transactionId:t.id}});
    await db.auditLog.create({data:{userId,entity:'transaction',entityId:t.id,newValue:t as unknown as Prisma.InputJsonValue}});
  });r.status(201).json({ok:true});}
  catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return void r.json({ok:true,already:true});throw e;}
}));
app.delete('/api/bills/:id/pay/:occurrenceDate',auth,wrap(async(q,r)=>{
  const userId=uid(q),id=z.string().uuid().parse(q.params.id),d=dateOnly.parse(q.params.occurrenceDate);
  const c=await prisma.recurringBillPayment.findFirst({where:{billId:id,userId,dueDate:new Date(d+'T00:00:00.000Z')}});
  if(c){await prisma.$transaction(async db=>{
    if(c.transactionId)await db.transaction.updateMany({where:{id:c.transactionId,userId,status:'POSTED'},data:{status:'VOID'}});
    await db.recurringBillPayment.delete({where:{id:c.id}});
  });return void r.json({ok:true});}
  // Backward-compatible undo for legacy monthly checks.
  const month=d.slice(0,7),old=await prisma.billCheck.findFirst({where:{billId:id,userId,month}});
  if(!old)return void r.status(404).json({error:'ยังไม่ได้จ่ายรายการนี้'});
  await prisma.$transaction(async db=>{if(old.transactionId)await db.transaction.updateMany({where:{id:old.transactionId,userId,status:'POSTED'},data:{status:'VOID'}});await db.billCheck.delete({where:{id:old.id}});});
  r.json({ok:true});}));

// สรุปวิเคราะห์ (นับเฉพาะรายรับ/รายจ่ายที่ POSTED, ไม่นับโอนระหว่างบัญชี)
app.get('/api/summary',auth,wrap(async(q,r)=>{
  const f=z.object({from:z.string().datetime(),to:z.string().datetime()}).parse(q.query);
  const rows=await prisma.transaction.findMany({where:{userId:uid(q),status:'POSTED',type:{in:['INCOME','EXPENSE','REFUND']},occurredAt:{gte:new Date(f.from),lte:new Date(f.to)}},orderBy:{occurredAt:'asc'}});
  let inc=new Decimal(0),exp=new Decimal(0);const cat=new Map<string,Decimal>(),day=new Map<string,{income:Decimal;expense:Decimal}>();
  const dk=(d:Date)=>d.toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
  for(const t of rows){const a=new Decimal(t.amount.toString()),k=dk(t.occurredAt);const d=day.get(k)||{income:new Decimal(0),expense:new Decimal(0)};
    if(t.type==='EXPENSE'){exp=exp.plus(a);d.expense=d.expense.plus(a);const c=t.category||'ไม่ระบุหมวด';cat.set(c,(cat.get(c)||new Decimal(0)).plus(a));}
    else{inc=inc.plus(a);d.income=d.income.plus(a);} day.set(k,d);}
  r.json({income:inc.toFixed(2),expense:exp.toFixed(2),net:inc.minus(exp).toFixed(2),count:rows.length,
    byCategory:[...cat].map(([name,v])=>({name,amount:v.toFixed(2)})).sort((x,y)=>+y.amount-+x.amount),
    byDay:[...day].map(([date,v])=>({date,income:v.income.toFixed(2),expense:v.expense.toFixed(2)})),
    top:rows.filter(t=>t.type==='EXPENSE').sort((x,y)=>+y.amount-+x.amount).slice(0,5).map(t=>({title:t.title,amount:t.amount.toString(),category:t.category,note:t.note,date:dk(t.occurredAt)}))});}));

// Export CSV กัน formula injection
const csvCell=(v:unknown)=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
app.get('/api/export/transactions.csv',auth,wrap(async(q,r)=>{
  const f=z.object({from:z.string().datetime().optional(),to:z.string().datetime().optional()}).parse(q.query);
  const rows=await prisma.transaction.findMany({where:{userId:uid(q),occurredAt:{gte:f.from?new Date(f.from):undefined,lte:f.to?new Date(f.to):undefined}},orderBy:{occurredAt:'desc'}});
  r.type('text/csv; charset=utf-8').send('\ufeff'+['วันที่,ประเภท,ชื่อรายการ,จำนวน,สถานะ,หมวดหมู่,หมายเหตุ',...rows.map(t=>[t.occurredAt.toISOString(),t.type,t.title,t.amount,t.status,t.category,t.note].map(csvCell).join(','))].join('\n'));}));

const web=path.resolve('public');if(fs.existsSync(web)){app.use(express.static(web));app.get('*',(_q,r)=>r.sendFile(path.join(web,'index.html')));}
const port=Number(process.env.PORT)||3000;
const server=app.listen(port,()=>console.log('Givetome listening on '+port));
process.on('SIGTERM',()=>server.close(async()=>{await prisma.$disconnect();process.exit(0);}));
