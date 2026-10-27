import {PrismaClient} from '@prisma/client';
import {createApp} from './app.js';

const prisma=new PrismaClient();
const prod=process.env.NODE_ENV==='production';
const secret=process.env.SESSION_SECRET||'';
if(!secret||secret==='change-me'){ if(prod){console.error('SESSION_SECRET required');process.exit(1);} }
const app=createApp(prisma,{secret,prod});
const port=Number(process.env.PORT)||3000;
const server=app.listen(port,()=>console.log('Givetome listening on '+port));
// ลงเงินเดือนอัตโนมัติให้ทุกคนที่ถึงกำหนด (ตอนเปิดแอปก็ลงให้เจ้าตัวทันทีอยู่แล้ว)
const sweep=()=>app.sweepSalaries().catch(e=>console.error('sweep',e));
sweep();const timer=setInterval(sweep,36e5);timer.unref();
process.on('SIGTERM',()=>server.close(async()=>{clearInterval(timer);await prisma.$disconnect();process.exit(0);}));
