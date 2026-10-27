import express from 'express';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {Decimal} from 'decimal.js';
import {balance,totals,billStatus,budgetStatus,goalProgress,cycleBounds,duePayDates,dueDateIn,monthKey,monthRange,type Tx} from './ledger.js';

const TXTYPES=['INCOME','EXPENSE','TRANSFER','REFUND','ADJUST'] as const;
const money=z.string().regex(/^\d{1,12}(\.\d{1,2})?$/,'จำนวนเงินต้องเป็นตัวเลขไม่ติดลบ');
const monthQ=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dk=(d:Date)=>d.toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
const json=(v:unknown)=>v as Prisma.InputJsonValue;
const isDup=(e:unknown)=>e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002';

export function createApp(prisma:PrismaClient,opts:{secret:string;prod:boolean}){
const KEY=opts.secret||'dev-only',prod=opts.prod;
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
const id=(q:express.Request,k='id')=>z.string().uuid().parse(q.params[k]);
const notFound=(r:express.Response,m='ไม่พบข้อมูล')=>r.status(404).json({error:m});

app.get('/health',wrap(async(_q,r)=>{await prisma.$queryRaw`SELECT 1`;r.json({ok:true});}));
const cred=z.object({email:z.string().email().max(200),password:z.string().min(10).max(200)});
// ใครก็สมัครได้ — ข้อมูลทุกอย่างแยกตาม userId ทุก query
app.post('/api/auth/register',limit(10,36e5),needJson,wrap(async(q,r)=>{
  if(process.env.ALLOW_SIGNUP==='false')return void r.status(403).json({error:'ปิดรับสมัครใหม่ชั่วคราว'});
  const b=cred.parse(q.body);
  try{const u=await prisma.user.create({data:{email:b.email.toLowerCase(),passwordHash:hash(b.password)}});
    setCookie(r,makeToken(u.id),604800);r.status(201).json({id:u.id});}
  catch(e){if(isDup(e))return void r.status(409).json({error:'อีเมลนี้มีบัญชีแล้ว'});throw e;}}));
app.post('/api/auth/login',limit(10,9e5),needJson,wrap(async(q,r)=>{
  const b=cred.parse(q.body);const u=await prisma.user.findUnique({where:{email:b.email.toLowerCase()}});
  if(!u||!verify(b.password,u.passwordHash))return void r.status(401).json({error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'});
  setCookie(r,makeToken(u.id),604800);r.json({ok:true});}));
app.post('/api/auth/logout',needJson,(_q,r)=>{setCookie(r,'',0);r.json({ok:true});});

// ---------- ธุรกรรม: ตัวกลางที่ทุกฟีเจอร์ใช้สร้างรายการ ----------
const ownsAccounts=async(userId:string,ids:(string|null|undefined)[])=>{const x=ids.filter(Boolean) as string[];
  return x.length===0||(await prisma.account.count({where:{userId,id:{in:x}}}))===x.length;};
async function categoryId(userId:string,name?:string|null){
  const n=name?.trim();if(!n)return null;
  return(await prisma.category.upsert({where:{userId_name:{userId,name:n}},update:{},create:{userId,name:n}})).id;}
type NewTx={type:typeof TXTYPES[number];amount:string;title:string;note?:string|null;category?:string|null;fromAccountId?:string|null;toAccountId?:string|null;
  occurredAt:Date;idempotencyKey:string;billOccurrenceId?:string|null};
async function createTx(userId:string,b:NewTx){
  const cid=await categoryId(userId,b.category);
  try{const t=await prisma.$transaction(async db=>{
      const t=await db.transaction.create({data:{userId,type:b.type,amount:b.amount,title:b.title,note:b.note??null,category:b.category?.trim()||null,categoryId:cid,
        fromAccountId:b.fromAccountId??null,toAccountId:b.toAccountId??null,billOccurrenceId:b.billOccurrenceId??null,idempotencyKey:b.idempotencyKey,occurredAt:b.occurredAt}});
      await db.auditLog.create({data:{userId,entity:'transaction',entityId:t.id,newValue:json(t)}});return t;});
    return{tx:t,created:true};}
  catch(e){if(isDup(e)){ // คลิกซ้ำ -> คืนรายการเดิม
    const old=await prisma.transaction.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey:b.idempotencyKey}}});
    if(old)return{tx:old,created:false};}throw e;}}

// ---------- accounts ----------
const acctIn=z.object({name:z.string().min(1).max(80),kind:z.string().max(30),opening:money.default('0')});
app.post('/api/accounts',auth,needJson,wrap(async(q,r)=>{
  r.status(201).json(await prisma.account.create({data:{...acctIn.parse(q.body),userId:uid(q)}}));}));
app.put('/api/accounts/:id',auth,needJson,wrap(async(q,r)=>{
  const b=acctIn.pick({name:true,kind:true}).parse(q.body),i=id(q),userId=uid(q);
  const a=await prisma.account.findFirst({where:{id:i,userId}});if(!a)return notFound(r,'ไม่พบบัญชี');
  r.json(await prisma.account.update({where:{id:i},data:b}));}));
const toTx=(t:{id:string;type:string;amount:Prisma.Decimal;fromAccountId:string|null;toAccountId:string|null}):Tx=>
  ({id:t.id,type:t.type.toLowerCase() as Tx['type'],amount:t.amount.toString(),from:t.fromAccountId??undefined,to:t.toAccountId??undefined,status:'posted'});
async function accountsWithBalance(userId:string){
  const [accs,rows]=await Promise.all([prisma.account.findMany({where:{userId,active:true},orderBy:{name:'asc'}}),
    prisma.transaction.findMany({where:{userId,status:'POSTED'}})]);
  const txs=rows.map(toTx);
  return{accounts:accs.map(a=>({id:a.id,name:a.name,kind:a.kind,opening:a.opening.toString(),balance:balance(a.id,a.opening.toString(),txs)})),totals:totals(txs)};}
app.get('/api/accounts',auth,wrap(async(q,r)=>r.json(await accountsWithBalance(uid(q)))));
// รายการเดินบัญชี (statement) ของบัญชีเดียว พร้อมยอดคงเหลือหลังแต่ละรายการ
app.get('/api/accounts/:id/statement',auth,wrap(async(q,r)=>{
  const userId=uid(q),i=id(q);
  const a=await prisma.account.findFirst({where:{id:i,userId}});if(!a)return notFound(r,'ไม่พบบัญชี');
  const rows=await prisma.transaction.findMany({where:{userId,OR:[{fromAccountId:i},{toAccountId:i}]},orderBy:[{occurredAt:'asc'},{createdAt:'asc'}]});
  let run=new Decimal(a.opening.toString());
  const items=rows.map(t=>{const amt=new Decimal(t.amount.toString());let delta=new Decimal(0);
    if(t.status==='POSTED'){if(t.toAccountId===i)delta=delta.plus(amt);if(t.fromAccountId===i)delta=delta.minus(amt);}
    run=run.plus(delta);return{id:t.id,type:t.type,title:t.title,note:t.note,category:t.category,status:t.status,occurredAt:t.occurredAt,
      fromAccountId:t.fromAccountId,toAccountId:t.toAccountId,amount:t.amount.toString(),delta:delta.toFixed(2),balanceAfter:run.toFixed(2)};});
  r.json({account:{id:a.id,name:a.name,kind:a.kind,opening:a.opening.toString()},balance:run.toFixed(2),items:items.reverse().slice(0,300)});}));

// ---------- transactions (ยอดคำนวณจากรายการในฐานข้อมูลเสมอ ไม่รับยอดจาก Frontend) ----------
const txIn=z.object({type:z.enum(TXTYPES),amount:money,title:z.string().min(1).max(120),
  fromAccountId:z.string().uuid().optional(),toAccountId:z.string().uuid().optional(),
  occurredAt:z.string().datetime(),idempotencyKey:z.string().min(8).max(100),note:z.string().max(500).optional(),category:z.string().max(60).optional()})
 .refine(t=>t.type==='TRANSFER'?!!t.fromAccountId&&!!t.toAccountId&&t.fromAccountId!==t.toAccountId:true,'โอนต้องมีบัญชีต้นทางและปลายทางที่ต่างกัน')
 .refine(t=>t.type==='EXPENSE'?!!t.fromAccountId:['INCOME','REFUND'].includes(t.type)?!!t.toAccountId:true,'ต้องระบุบัญชี');
app.post('/api/transactions',auth,needJson,wrap(async(q,r)=>{
  const b=txIn.parse(q.body),userId=uid(q);
  if(!await ownsAccounts(userId,[b.fromAccountId,b.toAccountId]))return notFound(r,'ไม่พบบัญชี');
  const{tx,created}=await createTx(userId,{...b,occurredAt:new Date(b.occurredAt)});
  r.status(created?201:200).json(tx);}));
app.get('/api/transactions',auth,wrap(async(q,r)=>{
  const f=z.object({search:z.string().max(100).optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional(),
    type:z.enum(TXTYPES).optional(),accountId:z.string().uuid().optional(),sort:z.enum(['asc','desc']).default('desc')}).parse(q.query);
  r.json(await prisma.transaction.findMany({where:{userId:uid(q),type:f.type,
    title:f.search?{contains:f.search,mode:'insensitive'}:undefined,
    occurredAt:{gte:f.from?new Date(f.from):undefined,lte:f.to?new Date(f.to):undefined},
    OR:f.accountId?[{fromAccountId:f.accountId},{toAccountId:f.accountId}]:undefined},
    orderBy:{occurredAt:f.sort},take:500}));}));
// แก้ไข = แทนที่ค่าในรายการเดิม (500→300 ยอดเป็น 300 ไม่ใช่ 800) + บันทึก audit ค่าเดิม/ค่าใหม่
app.put('/api/transactions/:id',auth,needJson,wrap(async(q,r)=>{
  const b=z.object({amount:money,title:z.string().min(1).max(120),note:z.string().max(500).nullable().optional(),category:z.string().max(60).nullable().optional()}).parse(q.body);
  const userId=uid(q),i=id(q);
  const cid=b.category!==undefined?await categoryId(userId,b.category):undefined;
  const out=await prisma.$transaction(async db=>{const old=await db.transaction.findFirst({where:{id:i,userId,status:'POSTED'}});if(!old)return null;
    const n=await db.transaction.update({where:{id:i},data:{...b,category:b.category?.trim()||(b.category===undefined?undefined:null),categoryId:cid}});
    await db.auditLog.create({data:{userId,entity:'transaction',entityId:i,oldValue:json(old),newValue:json(n)}});return n;});
  out?r.json(out):notFound(r,'ไม่พบรายการ');}));
app.delete('/api/transactions/:id',auth,wrap(async(q,r)=>{ // ยกเลิก (VOID) ไม่ลบจริง
  const userId=uid(q),i=id(q);
  const out=await prisma.$transaction(async db=>{const old=await db.transaction.findFirst({where:{id:i,userId,status:'POSTED'}});if(!old)return null;
    const n=await db.transaction.update({where:{id:i},data:{status:'VOID'}});
    await db.auditLog.create({data:{userId,entity:'transaction',entityId:i,oldValue:{status:'POSTED'},newValue:{status:'VOID'}}});return n;});
  out?r.json(out):notFound(r,'ไม่พบรายการ');}));
app.get('/api/categories',auth,wrap(async(q,r)=>{
  r.json((await prisma.category.findMany({where:{userId:uid(q),active:true},orderBy:{name:'asc'}})).map(c=>c.name));}));

// ---------- สรุป / รายงาน (นับเฉพาะรายรับ/รายจ่ายที่ POSTED, ไม่นับโอนระหว่างบัญชี) ----------
app.get('/api/summary',auth,wrap(async(q,r)=>{
  const f=z.object({from:z.string().datetime(),to:z.string().datetime()}).parse(q.query);
  const rows=await prisma.transaction.findMany({where:{userId:uid(q),status:'POSTED',type:{in:['INCOME','EXPENSE','REFUND']},occurredAt:{gte:new Date(f.from),lte:new Date(f.to)}},orderBy:{occurredAt:'asc'}});
  let inc=new Decimal(0),exp=new Decimal(0);const cat=new Map<string,Decimal>(),day=new Map<string,{income:Decimal;expense:Decimal}>();
  for(const t of rows){const a=new Decimal(t.amount.toString()),k=dk(t.occurredAt);const d=day.get(k)||{income:new Decimal(0),expense:new Decimal(0)};
    if(t.type==='EXPENSE'){exp=exp.plus(a);d.expense=d.expense.plus(a);const c=t.category||'ไม่ระบุหมวด';cat.set(c,(cat.get(c)||new Decimal(0)).plus(a));}
    else{inc=inc.plus(a);d.income=d.income.plus(a);} day.set(k,d);}
  r.json({income:inc.toFixed(2),expense:exp.toFixed(2),net:inc.minus(exp).toFixed(2),count:rows.length,
    byCategory:[...cat].map(([name,v])=>({name,amount:v.toFixed(2)})).sort((x,y)=>+y.amount-+x.amount),
    byDay:[...day].map(([date,v])=>({date,income:v.income.toFixed(2),expense:v.expense.toFixed(2)})),
    top:rows.filter(t=>t.type==='EXPENSE').sort((x,y)=>+y.amount-+x.amount).slice(0,5).map(t=>({title:t.title,amount:t.amount.toString(),category:t.category,note:t.note,date:dk(t.occurredAt)}))});}));
// แนวโน้มรายเดือนย้อนหลัง (สำหรับกราฟ)
app.get('/api/reports/monthly',auth,wrap(async(q,r)=>{
  const n=z.coerce.number().int().min(2).max(12).default(6).parse(q.query.months);
  const now=new Date();let from=monthRange(monthKey(now)).start;
  for(let i=1;i<n;i++)from=monthRange(monthKey(new Date(from.getTime()-864e5))).start;
  const rows=await prisma.transaction.findMany({where:{userId:uid(q),status:'POSTED',type:{in:['INCOME','EXPENSE','REFUND']},occurredAt:{gte:from}}});
  const m=new Map<string,{income:Decimal;expense:Decimal}>();
  let k=monthKey(from);const keys:string[]=[];
  for(let i=0;i<n;i++){keys.push(k);m.set(k,{income:new Decimal(0),expense:new Decimal(0)});k=monthKey(monthRange(k).end);}
  for(const t of rows){const x=m.get(monthKey(t.occurredAt));if(!x)continue;const a=new Decimal(t.amount.toString());
    if(t.type==='EXPENSE')x.expense=x.expense.plus(a);else x.income=x.income.plus(a);}
  r.json(keys.map(k=>({month:k,income:m.get(k)!.income.toFixed(2),expense:m.get(k)!.expense.toFixed(2)})));}));

// ---------- เช็คลิสต์รายจ่ายประจำเดือน + บิลประจำ ----------
const tplIn=z.object({name:z.string().min(1).max(80),amount:money,dayOfMonth:z.number().int().min(1).max(31),
  category:z.string().max(60).nullable().optional(),accountId:z.string().uuid().nullable().optional()});
app.get('/api/bill-templates',auth,wrap(async(q,r)=>{
  r.json(await prisma.billTemplate.findMany({where:{userId:uid(q),active:true},orderBy:[{dayOfMonth:'asc'},{name:'asc'}]}));}));
app.post('/api/bill-templates',auth,needJson,wrap(async(q,r)=>{
  const b=tplIn.parse(q.body),userId=uid(q);
  if(!await ownsAccounts(userId,[b.accountId]))return notFound(r,'ไม่พบบัญชี');
  r.status(201).json(await prisma.billTemplate.create({data:{...b,userId}}));}));
app.put('/api/bill-templates/:id',auth,needJson,wrap(async(q,r)=>{
  const b=tplIn.parse(q.body),userId=uid(q),i=id(q);
  if(!await ownsAccounts(userId,[b.accountId]))return notFound(r,'ไม่พบบัญชี');
  const t=await prisma.billTemplate.findFirst({where:{id:i,userId,active:true}});if(!t)return notFound(r);
  const out=await prisma.billTemplate.update({where:{id:i},data:b});
  // เดือนนี้เป็นต้นไปที่ยังไม่ได้จ่าย ใช้ยอด/วันใหม่ (ตัดทิ้งแล้วสร้างใหม่ตอนเปิดเช็คลิสต์)
  await dropUnpaidFrom(userId,i,monthRange(monthKey(new Date())).start);
  r.json(out);}));
app.delete('/api/bill-templates/:id',auth,wrap(async(q,r)=>{
  const userId=uid(q),i=id(q);
  const t=await prisma.billTemplate.findFirst({where:{id:i,userId,active:true}});if(!t)return notFound(r);
  await prisma.billTemplate.update({where:{id:i},data:{active:false}});
  await dropUnpaidFrom(userId,i,monthRange(monthKey(new Date())).start);
  r.json({ok:true});}));
async function dropUnpaidFrom(userId:string,templateId:string,from:Date){
  const occ=await prisma.billOccurrence.findMany({where:{userId,templateId,dueDate:{gte:from}},select:{id:true}});
  if(!occ.length)return;
  const paid=await prisma.transaction.findMany({where:{userId,status:'POSTED',billOccurrenceId:{in:occ.map(o=>o.id)}},select:{billOccurrenceId:true}});
  const keep=new Set(paid.map(p=>p.billOccurrenceId));
  await prisma.billOccurrence.deleteMany({where:{userId,id:{in:occ.map(o=>o.id).filter(x=>!keep.has(x))}}});}
async function ensureMonth(userId:string,key:string){
  const tpls=await prisma.billTemplate.findMany({where:{userId,active:true}});
  const data=tpls.filter(t=>key>=monthKey(t.createdAt)).map(t=>({userId,name:t.name,amount:t.amount,dueDate:dueDateIn(key,t.dayOfMonth),templateId:t.id}));
  if(data.length)await prisma.billOccurrence.createMany({data,skipDuplicates:true});}
async function checklist(userId:string,key:string){
  await ensureMonth(userId,key);const{start,end}=monthRange(key);
  const occ=await prisma.billOccurrence.findMany({where:{userId,dueDate:{gte:start,lt:end}},orderBy:[{dueDate:'asc'},{name:'asc'}]});
  const paid=occ.length?await prisma.transaction.groupBy({by:['billOccurrenceId'],_sum:{amount:true},where:{userId,status:'POSTED',billOccurrenceId:{in:occ.map(o=>o.id)}}}):[];
  const pm=new Map<string|null,Decimal>(paid.map((p:{billOccurrenceId:string|null;_sum:{amount:Prisma.Decimal|null}})=>[p.billOccurrenceId,new Decimal((p._sum.amount??0).toString())] as [string|null,Decimal]));
  const items=occ.map(o=>{const p=pm.get(o.id)||new Decimal(0);
    return{id:o.id,name:o.name,amount:o.amount.toString(),dueDate:o.dueDate,templateId:o.templateId,paid:p.toFixed(2),status:billStatus(o.amount.toString(),p.toFixed(2))};});
  const total=items.reduce((s,i)=>s.plus(i.amount),new Decimal(0)),done=items.reduce((s,i)=>s.plus(Decimal.min(i.paid,i.amount)),new Decimal(0));
  return{month:key,items,total:total.toFixed(2),paid:done.toFixed(2),left:total.minus(done).toFixed(2),doneCount:items.filter(i=>i.status==='paid').length};}
app.get('/api/checklist',auth,wrap(async(q,r)=>{
  r.json(await checklist(uid(q),monthQ.default(monthKey(new Date())).parse(q.query.month)));}));
app.post('/api/checklist',auth,needJson,wrap(async(q,r)=>{ // เพิ่มรายการครั้งเดียวในเดือนนั้น
  const b=z.object({month:monthQ,name:z.string().min(1).max(80),amount:money,day:z.number().int().min(1).max(31).default(1)}).parse(q.body),userId=uid(q);
  try{r.status(201).json(await prisma.billOccurrence.create({data:{userId,name:b.name,amount:b.amount,dueDate:dueDateIn(b.month,b.day)}}));}
  catch(e){if(isDup(e))return void r.status(409).json({error:'มีรายการชื่อนี้ในวันนั้นแล้ว'});throw e;}}));
app.put('/api/checklist/:id',auth,needJson,wrap(async(q,r)=>{ // แก้ยอดของเดือนนั้น (เช่น ค่าน้ำ-ไฟที่ไม่เท่ากันทุกเดือน)
  const b=z.object({amount:money,name:z.string().min(1).max(80).optional()}).parse(q.body),userId=uid(q),i=id(q);
  const o=await prisma.billOccurrence.findFirst({where:{id:i,userId}});if(!o)return notFound(r);
  r.json(await prisma.billOccurrence.update({where:{id:i},data:b}));}));
app.delete('/api/checklist/:id',auth,wrap(async(q,r)=>{
  const userId=uid(q),i=id(q);
  const o=await prisma.billOccurrence.findFirst({where:{id:i,userId}});if(!o)return notFound(r);
  if(await prisma.transaction.count({where:{userId,billOccurrenceId:i,status:'POSTED'}}))return void r.status(409).json({error:'รายการนี้จ่ายแล้ว ให้ยกเลิกการจ่ายก่อน'});
  await prisma.billOccurrence.delete({where:{id:i}});r.json({ok:true});}));
// ติ๊กจ่าย = สร้างรายจ่ายจริงผูกกับรายการนี้ (จ่ายหลายครั้ง/จ่ายบางส่วนได้ กดซ้ำด้วย key เดิมไม่ซ้ำ)
app.post('/api/checklist/:id/pay',auth,needJson,wrap(async(q,r)=>{
  const b=z.object({accountId:z.string().uuid(),amount:money.optional(),idempotencyKey:z.string().min(8).max(100)}).parse(q.body),userId=uid(q),i=id(q);
  const o=await prisma.billOccurrence.findFirst({where:{id:i,userId}});if(!o)return notFound(r);
  if(!await ownsAccounts(userId,[b.accountId]))return notFound(r,'ไม่พบบัญชี');
  const paid=(await prisma.transaction.aggregate({_sum:{amount:true},where:{userId,status:'POSTED',billOccurrenceId:i}}))._sum.amount??0;
  const left=Decimal.max(new Decimal(o.amount.toString()).minus(paid.toString()),0);
  const amount=b.amount??left.toFixed(2);
  if(new Decimal(amount).lte(0))return void r.status(400).json({error:'รายการนี้จ่ายครบแล้ว'});
  const tpl=o.templateId?await prisma.billTemplate.findFirst({where:{id:o.templateId,userId}}):null;
  const{tx,created}=await createTx(userId,{type:'EXPENSE',amount,title:o.name,category:tpl?.category??null,fromAccountId:b.accountId,occurredAt:new Date(),idempotencyKey:b.idempotencyKey,billOccurrenceId:i});
  r.status(created?201:200).json(tx);}));
app.post('/api/checklist/:id/unpay',auth,needJson,wrap(async(q,r)=>{ // ยกเลิกการจ่ายทั้งหมดของรายการนี้ (VOID)
  const userId=uid(q),i=id(q);
  const o=await prisma.billOccurrence.findFirst({where:{id:i,userId}});if(!o)return notFound(r);
  const n=await prisma.$transaction(async db=>{const rows=await db.transaction.findMany({where:{userId,billOccurrenceId:i,status:'POSTED'}});
    for(const t of rows){await db.transaction.update({where:{id:t.id},data:{status:'VOID'}});
      await db.auditLog.create({data:{userId,entity:'transaction',entityId:t.id,oldValue:{status:'POSTED'},newValue:{status:'VOID'}}});}
    return rows.length;});
  r.json({voided:n});}));

// ---------- เงินเดือนอัตโนมัติ / รอบเงินเดือน ----------
const salaryIn=z.object({amount:money,payDay:z.number().int().min(1).max(31),accountId:z.string().uuid(),title:z.string().min(1).max(60).default('เงินเดือน'),active:z.boolean().default(true)});
async function postSalaries(userId:string,now=new Date()){
  const s=await prisma.salarySetting.findUnique({where:{userId}});if(!s||!s.active)return 0;
  if(!await prisma.account.count({where:{id:s.accountId,userId}}))return 0;
  let n=0;
  for(const d of duePayDates(s.startsAt,now,s.payDay)){
    try{await prisma.$transaction(async db=>{
        await db.salaryPayment.create({data:{userId,periodStart:d,expected:s.amount}}); // unique(userId,periodStart) กันซ้ำ
        const t=await db.transaction.create({data:{userId,type:'INCOME',amount:s.amount,title:s.title,category:'เงินเดือน',toAccountId:s.accountId,idempotencyKey:'salary-'+d.toISOString(),occurredAt:d}});
        await db.salaryPayment.update({where:{userId_periodStart:{userId,periodStart:d}},data:{received:s.amount}});
        await db.auditLog.create({data:{userId,entity:'transaction',entityId:t.id,newValue:json(t)}});});n++;}
    catch(e){if(!isDup(e))throw e;}}
  return n;}
app.get('/api/salary',auth,wrap(async(q,r)=>{
  const userId=uid(q);await postSalaries(userId);
  const [setting,payments]=await Promise.all([prisma.salarySetting.findUnique({where:{userId}}),prisma.salaryPayment.findMany({where:{userId},orderBy:{periodStart:'desc'},take:6})]);
  r.json({setting,payments});}));
app.put('/api/salary',auth,needJson,wrap(async(q,r)=>{
  const b=salaryIn.parse(q.body),userId=uid(q);
  if(!await ownsAccounts(userId,[b.accountId]))return notFound(r,'ไม่พบบัญชี');
  // startsAt = ตอนนี้ → ระบบจะลงเงินเดือนตั้งแต่วันเงินเดือนถัดไป ไม่ย้อนไปซ้ำกับที่บันทึกเองไว้แล้ว
  r.json(await prisma.salarySetting.upsert({where:{userId},create:{...b,userId},update:{...b,startsAt:new Date()}}));}));
app.delete('/api/salary',auth,wrap(async(q,r)=>{await prisma.salarySetting.deleteMany({where:{userId:uid(q)}});r.json({ok:true});}));
app.get('/api/cycle',auth,wrap(async(q,r)=>{
  const userId=uid(q),now=new Date();await postSalaries(userId,now);
  const s=await prisma.salarySetting.findUnique({where:{userId}});
  const{start,end}=cycleBounds(now,s?.active?s.payDay:null);
  const rows=await prisma.transaction.findMany({where:{userId,status:'POSTED',type:{in:['INCOME','EXPENSE','REFUND']},occurredAt:{gte:start,lt:end}}});
  const t=totals(rows.map(x=>({...toTx(x),type:x.type.toLowerCase() as Tx['type']})));
  r.json({start,end,daysLeft:Math.max(0,Math.ceil((end.getTime()-now.getTime())/864e5)),totalDays:Math.round((end.getTime()-start.getTime())/864e5),
    income:t.income,expense:t.expense,hasSalary:!!(s&&s.active)});}));
// ตัวเรียกจาก server.ts (ทุกชั่วโมง) — ลงเงินเดือนให้ทุกคนที่ถึงกำหนด
(app as any).sweepSalaries=async()=>{const all=await prisma.salarySetting.findMany({where:{active:true},select:{userId:true}});
  for(const s of all)await postSalaries(s.userId).catch(e=>console.error('salary sweep',e));};

app.get('/api/me',auth,wrap(async(q,r)=>{
  const u=await prisma.user.findUnique({where:{id:uid(q)},select:{id:true,email:true}});
  if(!u)return void r.status(401).json({error:'กรุณาเข้าสู่ระบบ'});
  await postSalaries(u.id);r.json(u);}));

// ---------- งบประมาณรายหมวด (ต่อเดือน; ไม่ได้ตั้งใหม่ = ใช้ค่าของเดือนก่อนหน้า) ----------
app.get('/api/budgets',auth,wrap(async(q,r)=>{
  const userId=uid(q),key=monthQ.default(monthKey(new Date())).parse(q.query.month),{start,end}=monthRange(key);
  const [bs,cats,spent]=await Promise.all([
    prisma.budget.findMany({where:{userId,periodStart:{lte:start}},orderBy:{periodStart:'desc'}}),
    prisma.category.findMany({where:{userId}}),
    prisma.transaction.groupBy({by:['category'],_sum:{amount:true},where:{userId,status:'POSTED',type:'EXPENSE',occurredAt:{gte:start,lt:end}}})]);
  const name=new Map<string,string>(cats.map((c:{id:string;name:string})=>[c.id,c.name] as [string,string])),sp=new Map<string|null,string>(spent.map((s:{category:string|null;_sum:{amount:Prisma.Decimal|null}})=>[s.category,s._sum.amount?.toString()??'0'] as [string|null,string]));
  const seen=new Set<string>(),out:{categoryId:string;category:string;amount:string;spent:string;remaining:string;pct:number;state:'ok'|'near'|'over'}[]=[];
  for(const b of bs){if(seen.has(b.categoryId))continue;seen.add(b.categoryId);if(new Decimal(b.amount.toString()).lte(0))continue;
    const n=name.get(b.categoryId);if(!n)continue;const used=sp.get(n)??'0';
    out.push({categoryId:b.categoryId,category:n,amount:b.amount.toString(),spent:used,...budgetStatus(b.amount.toString(),used)});}
  r.json({month:key,budgets:out.sort((a,b)=>b.pct-a.pct)});}));
app.put('/api/budgets',auth,needJson,wrap(async(q,r)=>{ // amount "0" = เลิกใช้งบหมวดนี้ตั้งแต่เดือนนั้น
  const b=z.object({category:z.string().min(1).max(60),amount:money,month:monthQ.default(monthKey(new Date()))}).parse(q.body),userId=uid(q);
  const cid=await categoryId(userId,b.category) as string,periodStart=monthRange(b.month).start;
  r.json(await prisma.budget.upsert({where:{userId_categoryId_periodStart:{userId,categoryId:cid,periodStart}},create:{userId,categoryId:cid,periodStart,amount:b.amount},update:{amount:b.amount}}));}));

// ---------- เป้าหมายออม (ความคืบหน้า = ยอดคงเหลือของบัญชีที่ผูกไว้) ----------
const goalIn=z.object({name:z.string().min(1).max(80),target:money,accountId:z.string().uuid()});
app.get('/api/goals',auth,wrap(async(q,r)=>{
  const userId=uid(q);const [gs,{accounts}]=await Promise.all([prisma.savingsGoal.findMany({where:{userId},orderBy:{name:'asc'}}),accountsWithBalance(userId)]);
  r.json(gs.map(g=>{const a=accounts.find(x=>x.id===g.accountId);const saved=a?.balance??'0.00';
    return{id:g.id,name:g.name,target:g.target.toString(),accountId:g.accountId,accountName:a?.name??null,saved,...goalProgress(g.target.toString(),saved)};}));}));
app.post('/api/goals',auth,needJson,wrap(async(q,r)=>{
  const b=goalIn.parse(q.body),userId=uid(q);if(!await ownsAccounts(userId,[b.accountId]))return notFound(r,'ไม่พบบัญชี');
  r.status(201).json(await prisma.savingsGoal.create({data:{...b,userId}}));}));
app.put('/api/goals/:id',auth,needJson,wrap(async(q,r)=>{
  const b=goalIn.parse(q.body),userId=uid(q),i=id(q);if(!await ownsAccounts(userId,[b.accountId]))return notFound(r,'ไม่พบบัญชี');
  if(!await prisma.savingsGoal.count({where:{id:i,userId}}))return notFound(r);
  r.json(await prisma.savingsGoal.update({where:{id:i},data:b}));}));
app.delete('/api/goals/:id',auth,wrap(async(q,r)=>{
  const out=await prisma.savingsGoal.deleteMany({where:{id:id(q),userId:uid(q)}});out.count?r.json({ok:true}):notFound(r);}));

// Export CSV กัน formula injection
const csvCell=(v:unknown)=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
app.get('/api/export/transactions.csv',auth,wrap(async(q,r)=>{
  const rows=await prisma.transaction.findMany({where:{userId:uid(q)},orderBy:{occurredAt:'desc'}});
  r.type('text/csv; charset=utf-8').send('\ufeff'+['วันที่,ประเภท,ชื่อรายการ,จำนวน,สถานะ,หมวดหมู่,หมายเหตุ',...rows.map(t=>[t.occurredAt.toISOString(),t.type,t.title,t.amount,t.status,t.category,t.note].map(csvCell).join(','))].join('\n'));}));

const web=path.resolve('public');if(fs.existsSync(web)){app.use(express.static(web));app.get('*',(_q,r)=>r.sendFile(path.join(web,'index.html')));}
return app as express.Express&{sweepSalaries:()=>Promise<void>};
}
