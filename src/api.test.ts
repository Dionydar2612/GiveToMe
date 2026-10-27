// เทสต์ API จริงกับ PostgreSQL — ต้องตั้ง TEST_DATABASE_URL (ฐานข้อมูลสำหรับทดสอบเท่านั้น! ห้ามชี้ไปฐานข้อมูลจริง)
//   TEST_DATABASE_URL=postgresql://... npx prisma db push && npm test
import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {PrismaClient} from '@prisma/client';
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import {createApp} from './app.js';

const url=process.env.TEST_DATABASE_URL;
const run=Math.random().toString(36).slice(2,8);
const PW='correct-horse-battery';

describe.skipIf(!url)('API (PostgreSQL)',()=>{
  let prisma:PrismaClient,server:Server,base='';
  const created:string[]=[];
  beforeAll(async()=>{
    prisma=new PrismaClient({datasources:{db:{url}}});
    const app=createApp(prisma,{secret:'test-secret',prod:false});
    server=app.listen(0);base='http://127.0.0.1:'+(server.address() as AddressInfo).port;});
  afterAll(async()=>{
    for(const id of created)for(const t of ['transaction','account','category','billOccurrence','billTemplate','salaryPayment','salarySetting','budget','savingsGoal','auditLog'] as const)
      await (prisma[t] as any).deleteMany({where:{userId:id}});
    await prisma.user.deleteMany({where:{id:{in:created}}});
    server.close();await prisma.$disconnect();});

  class Client{cookie='';
    async req(method:string,path:string,body?:unknown){
      const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.cookie?{cookie:this.cookie}:{})},body:body?JSON.stringify(body):undefined});
      const sc=r.headers.get('set-cookie');if(sc)this.cookie=sc.split(';')[0];
      const text=await r.text();let j:any=null;try{j=JSON.parse(text)}catch{}return{status:r.status,body:j,text};}
    get=(p:string)=>this.req('GET',p);post=(p:string,b:unknown={})=>this.req('POST',p,b);put=(p:string,b:unknown)=>this.req('PUT',p,b);del=(p:string)=>this.req('DELETE',p);}
  async function user(tag:string){const c=new Client();
    const r=await c.post('/api/auth/register',{email:`${tag}-${run}@test.local`,password:PW});expect(r.status).toBe(201);created.push(r.body.id);return c;}
  const key=()=>crypto.randomUUID();
  const acct=async(c:Client,name='เงินเดือน',opening='1000')=>(await c.post('/api/accounts',{name,kind:'เงินเดือน',opening})).body.id as string;
  const spend=(c:Client,a:string,amount:string,extra:object={})=>c.post('/api/transactions',{type:'EXPENSE',amount,title:'ค่าข้าว',fromAccountId:a,occurredAt:new Date().toISOString(),idempotencyKey:key(),...extra});
  const month=new Date(Date.now()+7*36e5).toISOString().slice(0,7);

  it('ต้องเข้าสู่ระบบก่อนใช้งาน และสมัครด้วยอีเมลซ้ำไม่ได้',async()=>{
    expect((await new Client().get('/api/accounts')).status).toBe(401);
    await user('dup');const c=new Client();
    expect((await c.post('/api/auth/register',{email:`dup-${run}@test.local`,password:PW})).status).toBe(409);
    expect((await c.post('/api/auth/register',{email:'x@test.local',password:'short'})).status).toBe(400);
    expect((await c.post('/api/auth/login',{email:`dup-${run}@test.local`,password:'wrong-password-1'})).status).toBe(401);
    expect((await c.post('/api/auth/login',{email:`dup-${run}@test.local`,password:PW})).status).toBe(200);});

  it('ข้อมูลแยกตามผู้ใช้: อีกคนมองไม่เห็นและแตะต้องไม่ได้',async()=>{
    const a=await user('a'),b=await user('b');const accA=await acct(a);const t=(await spend(a,accA,'100')).body;
    expect((await b.get('/api/accounts')).body.accounts).toHaveLength(0);
    expect((await b.get('/api/transactions')).body).toHaveLength(0);
    expect((await b.get(`/api/accounts/${accA}/statement`)).status).toBe(404);
    expect((await spend(b,accA,'5')).status).toBe(404);                       // ใช้บัญชีของคนอื่นไม่ได้
    expect((await b.put(`/api/transactions/${t.id}`,{amount:'1',title:'x'})).status).toBe(404);
    expect((await b.del(`/api/transactions/${t.id}`)).status).toBe(404);
    expect((await a.get('/api/transactions')).body).toHaveLength(1);});

  it('คำนวณยอด: รายจ่าย / แก้ไขแทนค่าเดิม / ยกเลิก / กดซ้ำไม่ซ้ำ',async()=>{
    const c=await user('ledger'),a=await acct(c,'ใช้จ่าย','1000'),k=key();
    const body={type:'EXPENSE',amount:'500',title:'ค่าห้อง',fromAccountId:a,occurredAt:new Date().toISOString(),idempotencyKey:k};
    const t1=await c.post('/api/transactions',body),t2=await c.post('/api/transactions',body);
    expect(t1.status).toBe(201);expect(t2.status).toBe(200);expect(t2.body.id).toBe(t1.body.id);
    const bal=async()=>(await c.get('/api/accounts')).body.accounts[0].balance;
    expect(await bal()).toBe('500.00');
    await c.put(`/api/transactions/${t1.body.id}`,{amount:'300',title:'ค่าห้อง'});expect(await bal()).toBe('700.00');
    await c.del(`/api/transactions/${t1.body.id}`);expect(await bal()).toBe('1000.00');
    expect((await c.post('/api/transactions',{...body,idempotencyKey:key(),amount:'-5'})).status).toBe(400);});

  it('รายการเดินบัญชี: ยอดคงเหลือหลังแต่ละรายการ และโอนไม่นับเป็นรายจ่าย',async()=>{
    const c=await user('stmt'),a=await acct(c,'หลัก','1000'),w=await acct(c,'กระเป๋า','0');
    await c.post('/api/transactions',{type:'TRANSFER',amount:'220',title:'เติมเงิน',fromAccountId:a,toAccountId:w,occurredAt:new Date(Date.now()-2000).toISOString(),idempotencyKey:key()});
    await spend(c,w,'60');
    const s=(await c.get(`/api/accounts/${w}/statement`)).body;
    expect(s.balance).toBe('160.00');expect(s.items.map((i:any)=>i.balanceAfter)).toEqual(['160.00','220.00']);
    const all=(await c.get('/api/accounts')).body;expect(all.totals.expense).toBe('60.00');});

  it('เช็คลิสต์รายเดือน: สร้างจากบิลประจำ ติ๊กจ่าย จ่ายบางส่วน ไม่จ่ายซ้ำ ยกเลิกได้',async()=>{
    const c=await user('bill'),a=await acct(c,'ใช้จ่าย','10000');
    const tpl=(await c.post('/api/bill-templates',{name:'ค่าห้อง',amount:'3500',dayOfMonth:5,category:'ค่าห้อง/น้ำไฟ'})).body;
    let list=(await c.get(`/api/checklist?month=${month}`)).body;
    expect(list.items).toHaveLength(1);expect((await c.get(`/api/checklist?month=${month}`)).body.items).toHaveLength(1); // เปิดซ้ำไม่สร้างซ้ำ
    const it0=list.items[0];expect(it0.status).toBe('unpaid');expect(it0.templateId).toBe(tpl.id);
    const k=key();
    expect((await c.post(`/api/checklist/${it0.id}/pay`,{accountId:a,amount:'1000',idempotencyKey:k})).status).toBe(201);
    expect((await c.post(`/api/checklist/${it0.id}/pay`,{accountId:a,amount:'1000',idempotencyKey:k})).status).toBe(200); // กดซ้ำ
    list=(await c.get(`/api/checklist?month=${month}`)).body;expect(list.items[0].status).toBe('partial');expect(list.items[0].paid).toBe('1000.00');
    await c.post(`/api/checklist/${it0.id}/pay`,{accountId:a,idempotencyKey:key()});                                // จ่ายส่วนที่เหลือ
    list=(await c.get(`/api/checklist?month=${month}`)).body;expect(list.items[0].status).toBe('paid');expect(list.left).toBe('0.00');
    expect((await c.post(`/api/checklist/${it0.id}/pay`,{accountId:a,idempotencyKey:key()})).status).toBe(400);   // จ่ายครบแล้ว
    expect((await c.get('/api/accounts')).body.accounts[0].balance).toBe('6500.00');
    expect((await c.del(`/api/checklist/${it0.id}`)).status).toBe(409);
    await c.post(`/api/checklist/${it0.id}/unpay`);
    expect((await c.get(`/api/checklist?month=${month}`)).body.items[0].status).toBe('unpaid');
    expect((await c.get('/api/accounts')).body.accounts[0].balance).toBe('10000.00');
    const other=await user('bill2');expect((await other.post(`/api/checklist/${it0.id}/pay`,{accountId:a,idempotencyKey:key()})).status).toBe(404);});

  it('เงินเดือนอัตโนมัติ: ตั้งค่าแล้วไม่ย้อนหลัง และลงซ้ำไม่ได้',async()=>{
    const c=await user('salary'),a=await acct(c,'เงินเดือน','0');
    const r=await c.put('/api/salary',{amount:'30000',payDay:25,accountId:a,title:'เงินเดือน',active:true});expect(r.status).toBe(200);
    await c.get('/api/salary');await c.get('/api/me');
    expect((await c.get('/api/salary')).body.payments).toHaveLength(0);            // ยังไม่ถึงรอบถัดไป
    await prisma.salarySetting.update({where:{userId:(await c.get('/api/me')).body.id},data:{startsAt:new Date(Date.now()-40*864e5)}}); // จำลองว่าตั้งไว้นานแล้ว
    await Promise.all([c.get('/api/salary'),c.get('/api/me')]);                      // เรียกพร้อมกัน ต้องไม่ลงซ้ำ
    const pays=(await c.get('/api/salary')).body.payments;expect(pays.length).toBeGreaterThanOrEqual(1);
    const bal=(await c.get('/api/accounts')).body.accounts[0].balance;expect(bal).toBe((30000*pays.length).toFixed(2));
    expect((await c.get('/api/cycle')).body.hasSalary).toBe(true);});

  it('งบประมาณ: นับรายจ่ายตามหมวดของเดือน และเตือนเมื่อใกล้เต็ม/เกิน',async()=>{
    const c=await user('budget'),a=await acct(c,'ใช้จ่าย','5000');
    await spend(c,a,'850',{category:'อาหาร'});await spend(c,a,'400',{category:'เดินทาง'});
    expect((await c.put('/api/budgets',{category:'อาหาร',amount:'1000'})).status).toBe(200);
    await c.put('/api/budgets',{category:'เดินทาง',amount:'300'});
    const b=(await c.get(`/api/budgets?month=${month}`)).body.budgets;
    expect(b.find((x:any)=>x.category==='อาหาร')).toMatchObject({spent:'850.00',remaining:'150.00',state:'near'});
    expect(b.find((x:any)=>x.category==='เดินทาง')).toMatchObject({state:'over'});
    await c.put('/api/budgets',{category:'เดินทาง',amount:'0'});
    expect((await c.get(`/api/budgets?month=${month}`)).body.budgets).toHaveLength(1);});

  it('เป้าหมายออม: ความคืบหน้ามาจากยอดบัญชีที่ผูกไว้',async()=>{
    const c=await user('goal'),main=await acct(c,'หลัก','5000'),sav=await acct(c,'ออม','0');
    const g=(await c.post('/api/goals',{name:'เที่ยวญี่ปุ่น',target:'10000',accountId:sav})).body;
    await c.post('/api/transactions',{type:'TRANSFER',amount:'2500',title:'ออมเข้า',fromAccountId:main,toAccountId:sav,occurredAt:new Date().toISOString(),idempotencyKey:key()});
    expect((await c.get('/api/goals')).body[0]).toMatchObject({name:'เที่ยวญี่ปุ่น',saved:'2500.00',pct:25,left:'7500.00'});
    const other=await user('goal2');expect((await other.get('/api/goals')).body).toHaveLength(0);
    expect((await other.del(`/api/goals/${g.id}`)).status).toBe(404);
    expect((await other.post('/api/goals',{name:'x',target:'1',accountId:sav})).status).toBe(404);});

  it('รายงานรายเดือน และ export CSV ป้องกัน formula injection',async()=>{
    const c=await user('report'),a=await acct(c,'ใช้จ่าย','0');
    await spend(c,a,'120',{title:'=HYPERLINK("x")'});
    const m=(await c.get('/api/reports/monthly?months=3')).body;expect(m).toHaveLength(3);expect(m[2].expense).toBe('120.00');
    const csv=(await c.get('/api/export/transactions.csv')).text;expect(csv).toContain(`"'=HYPERLINK`);});
});
