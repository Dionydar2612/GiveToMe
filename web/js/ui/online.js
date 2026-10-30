/* UI · เล่นออนไลน์กับเพื่อน (ห้องส่วนตัวด้วยรหัสห้อง)
   วิธีทำงาน (lockstep): ทั้งสองเบราว์เซอร์รัน engine ตัวเดียวกันด้วย seed เดียวกัน
   ฝั่งตัวเองใช้ io แบบคนกดหน้าจอแล้วส่ง "ตัวเลือกที่กด" ไปให้ server ส่งต่อ ส่วนฝั่งเพื่อนใช้ io ที่รอรับตัวเลือกนั้น
   server ไม่รู้กติกา (ดู /api/room/* ใน server.js) · ผู้เล่น 0 = คนสร้างห้อง, 1 = คนเข้าห้อง
   หมายเหตุ: เบราว์เซอร์ของแต่ละคนมีสถานะเกมเต็ม (เปิด DevTools แอบดูมือเพื่อนได้) เหมาะกับเล่นกับเพื่อน/Open Test เท่านั้น */
'use strict';
const OL={es:null,q:[],w:null,chain:Promise.resolve(),n:0,tok:0};
ui.ol=null;ui.olcode='';

const accName=()=>String((window.__AF&&window.__AF.user&&window.__AF.user.username)||'').trim();   // ชื่อที่แสดงตอนเล่น = ชื่อบัญชี
const olName=()=>(accName()||String(ui.pname||'').trim()).slice(0,16);
try{ui.pname=localStorage.getItem('af-pname')||''}catch(e){ui.pname=''}
const nameInput=()=>accName()?`<div class="opt"><label>เล่นในชื่อ</label><b>${esc(accName().slice(0,16))}</b></div>`:`<div class="opt"><label for="olname">ชื่อที่แสดงตอนเล่น</label><input id="olname" value="${esc(ui.pname||'')}" maxlength="16" placeholder="ชื่อของคุณ (ไม่ใส่ก็ได้)" autocomplete="off" style="padding:6px 10px;border:2px solid var(--ink);border-radius:8px;font-size:15px;min-width:180px"></div>`;
function olHash(){try{const s=JSON.stringify(Object.keys(AF.defs).sort().map(k=>[k,AF.defs[k]]));let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return String(h>>>0)}catch(e){return ''}}
async function olApi(path,body){
  let r,j;
  try{r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});j=await r.json().catch(()=>({}))}
  catch(e){throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้')}
  if(!r.ok||j.ok===false)throw new Error(j.error||'เกิดข้อผิดพลาด ('+r.status+')');
  return j;
}
/* ส่งข้อความเข้าห้อง: ส่งทีละอัน ตามลำดับ และลองใหม่เมื่อเน็ตสะดุด (server ตัดข้อความซ้ำด้วยเลขลำดับ n) */
function olSend(msg){
  const o=ui.ol;if(!o)return Promise.resolve();
  if(msg.t==='move')msg.n=++OL.n;
  const job=async()=>{
    for(let i=0;i<40;i++){
      if(ui.ol!==o&&msg.t!=='leave')return;   // ข้อความ leave ต้องส่งให้ได้แม้ปิดห้องฝั่งตัวเองแล้ว
      try{return await olApi('/api/room/send',{code:o.code,pid:o.pid,token:o.token,msg})}
      catch(e){if(/ไม่พบห้อง|ไม่ถูกต้อง|ยังไม่/.test(e.message))throw e;await new Promise(r=>setTimeout(r,1500))}
    }
  };
  const p=OL.chain.then(job);OL.chain=p.catch(()=>{});return p;
}
function olConnect(){
  const o=ui.ol;if(OL.es)OL.es.close();
  const es=new EventSource(`/api/room/events?code=${encodeURIComponent(o.code)}&pid=${o.pid}&token=${o.token}`);
  OL.es=es;
  es.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch(e){return}olOn(m)};
  es.onerror=()=>{if(ui.ol===o){o.conn=false;scheduleRender()}};
  es.onopen=()=>{if(ui.ol===o){o.conn=true;scheduleRender();if(o.mm&&!o.autoReady){o.autoReady=true;olReady()}}};   // แมตช์จับคู่: กด "พร้อม" ให้เองทันทีที่ต่อห้องได้
}
function olOn(m){
  const o=ui.ol;if(!o)return;
  if(m.t==='peer'){o.peer=!!m.online;if(m.online)o.hadPeer=true}
  else if(m.t==='peerready')o.peerReady=true;
  else if(m.t==='start')olStart(m);
  else if(m.t==='move'){if(OL.w&&OL.w.tok===OL.tok){const w=OL.w;OL.w=null;w.res(m)}else OL.q.push(m)}
  else if(m.t==='abort'){if(o.mm&&ui.screen!=='game')mmFail('คู่แข่งหลุดก่อนเริ่มเกม ลองค้นหาใหม่อีกครั้ง');return}
  else if(m.t==='settled'){
    o.settle=m;const mine=m.rewards&&m.rewards[o.pid];   // ผลสรุปรางวัลจากเซิร์ฟเวอร์ (หน้าสรุปผลอ่านจาก o.settle)
    if(mine&&mine.total){try{if(window.__AF&&__AF.user){__AF.user.coins=mine.total.coins;__AF.user.points=mine.total.points}postMessage({afCoins:mine.total.coins},location.origin)}catch(e){}}
  }
  else if(m.t==='leave'){
    if(ui.screen==='game'&&ui.over)return;   // จบเกมแล้ว ปล่อยให้ดูกระดานต่อ
    if(o.mm&&ui.screen!=='game'){mmFail('คู่แข่งออกจากแมตช์ก่อนเริ่มเกม ลองค้นหาใหม่อีกครั้ง');return}
    if(o.mm&&ui.screen==='game'){   // แมตช์จับคู่: คู่แข่งยอมแพ้/ออก = เราชนะ → ขึ้นหน้าสรุปผล (รางวัลมาจากเซิร์ฟเวอร์) ไม่เด้งกลับ Home
      const nm=ui.G&&ui.G.players[1-o.pid]?ui.G.players[1-o.pid].name:'คู่แข่ง';
      o.peer=false;ui.over={winner:o.pid,reason:nm+' ยอมแพ้/ออกจากเกม'};ui.pending=null;o.overAt=Date.now();setTimeout(scheduleRender,13000);
      return scheduleRender();
    }
    if(ui.screen==='game'){   // เพื่อนยอมแพ้/ออก → กลับหน้าแรกทันที
      const nm=ui.G&&ui.G.players[1-o.pid]?ui.G.players[1-o.pid].name:'เพื่อน';
      ui.token++;ui.screen='setup';ui.page='play';DATA.applyPending();fixSelections();ui.pending=null;ui.over=null;ui.modal=null;ui.menu=null;ui.settings=false;
      olLeave(false);ui.err=nm+' ยอมแพ้/ออกจากเกม จึงกลับมาหน้าแรก';
      return render();
    }
    o.peer=false;o.ready=false;o.peerReady=false;
  }
  scheduleRender();
}
function olLeave(notify){
  const o=ui.ol;if(!o)return;
  if(notify)olSend({t:'leave'}).catch(()=>{});
  const es=OL.es;ui.ol=null;OL.es=null;OL.q=[];OL.w=null;
  setTimeout(()=>{if(es)es.close()},notify?800:0);
}
async function olCreate(){
  ui.err='';ui.olbusy=true;render();
  try{const j=await olApi('/api/room/create');ui.ol={code:j.code,pid:j.pid,token:j.token,peer:false,ready:false,peerReady:false,conn:false};olConnect()}
  catch(e){ui.err=e.message}
  ui.olbusy=false;render();
}
async function olJoin(code){
  code=String(code||ui.olcode||'').trim().toUpperCase();ui.err='';
  if(code.length<4){ui.err='กรอกรหัสห้องก่อน';return render()}
  ui.olbusy=true;render();
  try{const j=await olApi('/api/room/join',{code});ui.ol={code:j.code,pid:j.pid,token:j.token,peer:true,ready:false,peerReady:false,conn:false};olConnect()}
  catch(e){ui.err=e.message}
  ui.olbusy=false;render();
}
async function olReady(){
  const o=ui.ol;if(!o||o.ready)return;
  if(deckErrors(ui.cfg.sel[0]).length){ui.err='เด็คยังไม่ครบ 60 ใบ';return render()}
  ui.err='';o.ready=true;render();
  try{await olSend({t:'ready',deck:deckOf(0),hash:olHash(),name:olName()})}
  catch(e){o.ready=false;ui.err=e.message;if(o.mm){olSend({t:'leave'}).catch(()=>{});mmFail(e.message);return}render()}   // แมตช์จับคู่: เด็คไม่ผ่านการตรวจ → แจ้งแล้วออกจากห้อง ไม่ค้างหน้ารอ
}
/* ------------------------------------------------------------------ แปลงตัวเลือกเป็นข้อความที่ส่งข้ามเครื่อง */
function olEnc(kind,v,spec){
  if(kind==='act'){if(v&&v.t==='pass')return {pass:1};const i=spec.actions.indexOf(v);return {i}}
  return v===undefined?null:v;
}
function olDec(kind,v,spec){
  if(kind==='act'){if(v&&v.pass)return {t:'pass'};const a=spec.actions[v&&v.i];if(!a)throw new Error('desync');return a}
  return v;
}
function olStart(m){
  const o=ui.ol;if(!o||ui.screen==='game')return;
  if(m.hashes[0]!==m.hashes[1]){ui.err='ข้อมูลการ์ดของสองเครื่องไม่ตรงกัน (card-api อัปเดตไม่พร้อมกัน) ให้ทั้งคู่รีเฟรชหน้าแล้วสร้าง/เข้าห้องใหม่';olLeave(true);return}
  const me=o.pid;ui.token++;const token=ui.token;
  OL.q=[];OL.w=null;OL.tok=token;
  const local=p=>{
    const f=kind=>async(G,pp,spec)=>{const v=await req(token,p,kind,spec);if(ui.token===token)olSend({t:'move',k:kind,v:olEnc(kind,v,spec)}).catch(()=>{});return v};
    return {act:f('act'),attack:f('attack'),pick:f('pick'),order:f('order'),respond:f('respond'),mulligan:f('mulligan')};
  };
  const remote=()=>{
    const f=kind=>async(G,pp,spec)=>{
      const mv=OL.q.length?OL.q.shift():await new Promise(res=>{OL.w={tok:token,res}});
      if(mv.k!==kind)throw new Error('desync: คาดว่า '+kind+' แต่ได้ '+mv.k);
      return olDec(kind,mv.v,spec);
    };
    return {act:f('act'),attack:f('attack'),pick:f('pick'),order:f('order'),respond:f('respond'),mulligan:f('mulligan')};
  };
  const io=[0,1].map(p=>p===me?local(p):remote());
  const names=[0,1].map(p=>(m.names&&m.names[p])||'ผู้เล่น '+(p+1));
  const G=AF.createGame({decks:m.decks,io,names,first:m.first,seed:m.seed,refresh:scheduleRender});
  Object.assign(ui,{G,intro:{first:G.first},screen:'game',pending:null,viewer:me,inspect:null,sel:null,menu:null,modal:null,cover:null,seen:0,over:null,tab:'card',peek:false,toast:'',err:''});
  if(o.mm){mmClear();try{AFSite.go('play')}catch(e){}}   // แมตช์จับคู่เริ่มแล้ว: ปิดหน้าค้นหา แล้วสลับไปกระดาน
  render();
  AF.runGame(G,120).then(r=>{if(ui.token===token){ui.over=r;ui.pending=null;if(o.mm&&ui.ol===o){o.overAt=Date.now();setTimeout(scheduleRender,13000);if(!/desync/.test(r.reason||''))olSend({t:'result',winner:r.winner==null?null:r.winner,turn:G.turn}).catch(()=>{})}render()}}).catch(e=>{console.error(e);if(ui.token===token){const ds=/desync/.test(e.message);ui.err=ds?'สถานะเกมของสองเครื่องไม่ตรงกัน (desync) ต้องจบเกมนี้':'เกิดข้อผิดพลาดในระบบ: '+e.message;ui.over={winner:null,reason:ui.err};render()}});
}
/* ------------------------------------------------------------------ หน้า lobby (แสดงแทนกล่องเลือกเด็คสองฝั่งเมื่อเลือกโหมดออนไลน์) */
function onlineHTML(pb){
  const o=ui.ol;
  const err=ui.err?`<span class="warnbox">${esc(ui.err)}</span>`:'';
  if(!o){
    return `<div class="setup" style="margin-top:16px">${pb(0)}<section class="pbox"><h2>ห้องส่วนตัว</h2>
      <p class="muted">เล่นกับเพื่อนผ่านอินเทอร์เน็ต เลือกเด็คของคุณทางซ้ายก่อน แล้วสร้างห้องส่งรหัสให้เพื่อน หรือกรอกรหัสที่เพื่อนให้มา</p>
      ${nameInput()}
      <div class="opt"><button class="btn pri" data-act="olcreate" ${ui.olbusy?'disabled':''}>สร้างห้อง</button></div>
      <div class="opt"><input id="olcode" value="${esc(ui.olcode||'')}" maxlength="5" placeholder="รหัสห้อง 5 ตัว" autocomplete="off" style="text-transform:uppercase;width:150px;padding:6px 10px;border:2px solid var(--ink);border-radius:8px;font:600 16px monospace;letter-spacing:2px"><button class="btn" data-act="oljoin" ${ui.olbusy?'disabled':''}>เข้าห้อง</button></div>
      ${err}</section></div>`;
  }
  const link=location.origin+location.pathname+'?room='+o.code;
  const st=o.pid===0&&!o.hadPeer?'รอเพื่อนเข้าห้อง… ส่งรหัสหรือลิงก์ด้านล่างให้เพื่อน':!o.peer?'เพื่อนหลุดจากห้อง (รอกลับเข้ามา)':o.ready?(o.peerReady?'กำลังเริ่มเกม…':'คุณพร้อมแล้ว รอเพื่อนกดพร้อม…'):(o.peerReady?'เพื่อนพร้อมแล้ว เลือกเด็คแล้วกด "พร้อม"':'เพื่อนอยู่ในห้องแล้ว เลือกเด็คแล้วกด "พร้อม"');
  const bad=deckErrors(ui.cfg.sel[0]).length;
  return `<div class="setup" style="margin-top:16px">${pb(0)}<section class="pbox"><h2>ห้อง <span style="font:700 26px monospace;letter-spacing:4px">${esc(o.code)}</span></h2>
    <p>${esc(st)}</p>
    <p class="muted">${o.conn===false?'⚠ กำลังเชื่อมต่อเซิร์ฟเวอร์ใหม่… · ':''}คุณคือ ${o.pid===0?'เจ้าของห้อง':'ผู้เข้าร่วม'} · ใครเล่นก่อนสุ่มให้ · ชื่อที่ว่างจะแสดงเป็น ผู้เล่น 1/2</p>
    ${o.ready?'':nameInput()}
    <div class="opt"><input id="ollink" readonly value="${esc(link)}" style="flex:1;min-width:200px;padding:6px 10px;border:2px solid var(--ink);border-radius:8px;font-size:13px" onclick="this.select()"><button class="btn sm" data-act="olcopy">คัดลอกลิงก์</button></div>
    <div class="opt"><button class="btn pri" data-act="olready" ${(!o.peer||o.ready||bad)?'disabled':''}>พร้อม</button><button class="btn" data-act="olleave">ออกจากห้อง</button></div>
    ${err}</section></div>`;
}
root.addEventListener('input',e=>{if(e.target.id==='olcode')ui.olcode=e.target.value.toUpperCase();if(e.target.id==='olname'){ui.pname=e.target.value;try{localStorage.setItem('af-pname',ui.pname)}catch(err){}}});
function olCopy(el){
  const t=(document.getElementById('ollink')||{}).value||'';let ok=false;
  try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).catch(()=>{});ok=true}}catch(e){}
  if(!ok){const i=document.getElementById('ollink');if(i){i.select();try{ok=document.execCommand('copy')}catch(e){}}}
  if(el){el.textContent=ok?'คัดลอกแล้ว':'กดคัดลอกเอง';}
}

/* ------------------------------------------------------------------ จับคู่ออนไลน์ (คิว)
   กด PLAY ในโหมด "จับคู่ออนไลน์" ที่ Home → เข้าคิว (POST /api/room/queue/join) → ถามสถานะทุก 1 วินาที
   ระหว่างค้นหามีหน้าจอเต็มจอ (#mmov) แสดงลีก เด็ค และเวลาที่รอ + ปุ่มยกเลิก · พอจับคู่ได้ → เข้าห้องและกด "พร้อม" ให้เอง
   ui.mm = null | { state:'search'|'found'|'error', since, label, waiting, opp, err, me:{league,points,wins,losses} } */
ui.mm=null;
const MM={poll:0,tick:0,el:null,wired:false};
const mmPad=n=>String(n).padStart(2,'0');
const mmClock=ms=>{const t=Math.max(0,Math.floor(ms/1000));return mmPad(Math.floor(t/60))+':'+mmPad(t%60)};
function mmClear(){clearInterval(MM.poll);clearInterval(MM.tick);MM.poll=MM.tick=0;ui.mm=null;if(MM.el){MM.el.remove();MM.el=null}document.documentElement.classList.remove('mm-on')}
function mmFail(msg){
  if(ui.ol&&ui.ol.mm)olLeave(false);
  clearInterval(MM.poll);clearInterval(MM.tick);MM.poll=MM.tick=0;
  ui.mm={state:'error',err:msg,me:(ui.mm&&ui.mm.me)||null};mmRender();
}
function mmEl(){
  if(MM.el)return MM.el;
  const el=document.createElement('div');el.id='mmov';el.className='mmov';el.setAttribute('role','dialog');el.setAttribute('aria-label','ค้นหาแมตช์');
  document.body.appendChild(el);MM.el=el;document.documentElement.classList.add('mm-on');
  el.addEventListener('click',e=>{const b=e.target.closest('[data-mm]');if(!b)return;if(b.dataset.mm==='cancel')mmCancel();else if(b.dataset.mm==='close')mmClear()});
  return el;
}
function mmRender(){
  const m=ui.mm;if(!m){if(MM.el){MM.el.remove();MM.el=null}return}
  const el=mmEl();const d=deckByKey(ui.cfg.sel[0]);const me=m.me||{};
  const lg=me.league||'BRONZE';
  const art=d?`<div class="art im-${artKey(d.avatar)}"></div>`:'<div class="art"></div>';
  const left=`<div class="mm-l"><div class="mm-league">${esc(lg)} LEAGUE</div><div class="mm-fmt"><span>${esc(m.label||'STANDARD')}</span></div>${me.points!=null?`<div class="mm-pts"><b>${me.points}</b> แต้ม · ชนะ ${me.wins||0} · แพ้ ${me.losses||0}</div>`:''}</div>`;
  const right=`<div class="mm-r"><div class="mm-sleeve"><div class="mm-sleeve2"></div><div class="mm-sleeve1">${art}</div></div><div class="mm-deck">${esc(d?d.name:'')}</div></div>`;
  let center;
  if(m.state==='error')center=`<div class="mm-c"><div class="mm-title err">ค้นหาไม่สำเร็จ</div><p class="mm-sub">${esc(m.err||'เกิดข้อผิดพลาด')}</p><button type="button" class="mm-btn" data-mm="close">ตกลง</button></div>`;
  else if(m.state==='found')center=`<div class="mm-c"><div class="mm-title ok">พบคู่แข่งแล้ว!</div><div class="mm-vs"><b>${esc(olName()||'คุณ')}</b><i>VS</i><b>${esc(m.opp||'คู่แข่ง')}</b></div><p class="mm-sub">กำลังเข้าสู่เกม…</p></div>`;
  else center=`<div class="mm-c"><div class="mm-title">กำลังค้นหาแมตช์</div><div class="mm-line"><i class="mm-orb"></i></div><div class="mm-time" id="mmtime">${mmClock(Date.now()-m.since)}</div><p class="mm-sub" id="mmwait">${m.waiting>1?`มีผู้เล่นกำลังค้นหาอยู่ ${m.waiting} คน`:'จะจับคู่กับผู้เล่นที่กำลังค้นหาอยู่พร้อมกัน'}</p><button type="button" class="mm-btn" data-mm="cancel">ยกเลิก</button></div>`;
  el.innerHTML=left+right+center;
}
function mmTick(){const m=ui.mm;if(!m||m.state!=='search')return;const t=document.getElementById('mmtime');if(t)t.textContent=mmClock(Date.now()-m.since)}
async function mmPoll(){
  const m=ui.mm;if(!m||m.state!=='search')return;
  let j;try{const r=await fetch('/api/room/queue/status',{credentials:'same-origin',cache:'no-store'});j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'ต่อเซิร์ฟเวอร์ไม่ได้')}
  catch(e){return}   // เน็ตสะดุดชั่วคราว: ลองใหม่รอบหน้า (ถ้าเงียบเกิน ~12 วินาที เซิร์ฟเวอร์จะตัดออกจากคิวเอง)
  if(ui.mm!==m||m.state!=='search')return;
  if(j.state==='matched')return mmFound(j);
  if(j.state==='none')return mmFail('หมดเวลาค้นหาหรือหลุดจากคิว ลองค้นหาใหม่อีกครั้ง');
  if(j.waiting!==m.waiting){m.waiting=j.waiting;const w=document.getElementById('mmwait');if(w)w.textContent=m.waiting>1?`มีผู้เล่นกำลังค้นหาอยู่ ${m.waiting} คน`:'จะจับคู่กับผู้เล่นที่กำลังค้นหาอยู่พร้อมกัน'}
}
function mmFound(j){
  const m=ui.mm;if(!m)return;
  clearInterval(MM.poll);clearInterval(MM.tick);MM.poll=MM.tick=0;
  m.state='found';m.opp=j.opp;mmRender();
  setTimeout(()=>{   // ให้เห็นหน้า "พบคู่แข่ง" ก่อนสักครู่ แล้วค่อยเข้าห้อง
    if(ui.mm!==m||m.state!=='found')return;
    ui.ol={code:j.code,pid:j.pid,token:j.token,peer:true,hadPeer:true,ready:false,peerReady:false,conn:false,mm:true};
    olConnect();
  },1300);
}
async function mmCancel(){
  const m=ui.mm;if(!m||m.state!=='search')return;
  let matched=false;
  try{const r=await fetch('/api/room/queue/cancel',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});const j=await r.json().catch(()=>({}));matched=!!j.matched}catch(e){}
  if(matched)return mmPoll();   // จับคู่ได้ไปแล้วพอดีตอนกดยกเลิก → ไปต่อเข้าเกมเลย
  mmClear();
}
/* เริ่มค้นหา: ตรวจเด็คก่อน แล้วเข้าคิว · คืน {ok,err} ทันที (ส่วนที่เหลือทำต่อเบื้องหลัง) */
function mmStart(){
  if(ui.mm&&ui.mm.state==='search')return {ok:true,queued:true};
  const k=ui.cfg.sel[0],errs=deckErrors(k);
  if(errs.length)return {ok:false,err:errs[0]};
  olLeave(true);ui.err='';ui.cfg.mode='online';saveCfg();
  const m=ui.mm={state:'search',since:Date.now(),label:'STANDARD',waiting:1,me:null};
  mmRender();MM.tick=setInterval(mmTick,250);
  fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(j=>{if(ui.mm===m&&j.user){m.me={league:j.user.league,points:j.user.points,wins:j.user.wins,losses:j.user.losses};if(m.state==='search')mmRender()}}).catch(()=>{});
  olApi('/api/room/queue/join',{key:'standard'}).then(j=>{
    if(ui.mm!==m)return;m.label=j.label||m.label;m.waiting=j.waiting||1;
    clearInterval(MM.poll);MM.poll=setInterval(mmPoll,1000);mmPoll();
  }).catch(e=>{if(ui.mm===m)mmFail(e.message)});
  return {ok:true,queued:true};
}
addEventListener('pagehide',()=>{if(ui.mm&&ui.mm.state==='search'){try{navigator.sendBeacon('/api/room/queue/cancel',new Blob(['{}'],{type:'application/json'}))}catch(e){}}});

/* ------------------------------------------------------------------ หน้าสรุปผลแมตช์จับคู่ (แทนกล่อง "จบเกม" เดิมเมื่อเล่นแบบจับคู่) */
const mmSgn=n=>n>0?'+'+n:n<0?'−'+Math.abs(n):'0';
function mmOverHTML(G,r,o){
  const me=o.pid,op=1-me,s=o.settle,mine=s&&s.rewards&&s.rewards[me],theirs=s&&s.rewards&&s.rewards[op];
  const res=r.winner==null?'draw':r.winner===me?'win':'lose';
  const title=res==='win'?'VICTORY':res==='lose'?'DEFEAT':'DRAW';
  const waitTimeout=!s&&o.overAt&&Date.now()-o.overAt>12000;
  const plate=(p,rw,mineSide)=>{
    const nm=esc(G.players[p].name);
    const win=r.winner===p;
    let pts,coins,foot='';
    if(rw&&!rw.error){
      pts=`<b class="${rw.points>0?'pos':rw.points<0?'neg':''}">${mmSgn(rw.points)}</b>`;coins=`<b class="${rw.coins>0?'pos':''}">${mmSgn(rw.coins)}</b>`;
      if(rw.total){const L=rw.league||{},nx=L.next;const pct=nx?Math.max(0,Math.min(100,Math.round((rw.total.points-L.from)/(nx.at-L.from)*100))):100;
        foot=`<div class="mmr-tot"><span class="mmr-lg">${esc(L.name||'')}</span> · ${rw.total.points} แต้ม · ${Number(rw.total.coins).toLocaleString('th-TH')} เหรียญ</div>${rw.pointsSaved===false?'':`<div class="mmr-bar"><i style="width:${pct}%"></i></div><div class="mmr-nx">${nx?`อีก ${nx.at-rw.total.points} แต้มถึง ${esc(nx.name)}`:'ลีกสูงสุดแล้ว'}</div>`}`}
      if(rw.capped)foot+=`<div class="mmr-nx">ถึงเพดานเหรียญจากแมตช์จับคู่ของวันนี้แล้ว</div>`;
    }else if(rw&&rw.error){pts=coins='<b>—</b>';foot='<div class="mmr-nx">บันทึกรางวัลไม่สำเร็จ</div>'}
    else if(waitTimeout){pts=coins='<b>—</b>';foot='<div class="mmr-nx">ยังไม่ได้รับผลสรุปจากเซิร์ฟเวอร์</div>'}
    else{pts=coins='<b class="wait">…</b>'}
    return `<section class="mmr-plate ${mineSide?'me':'op'}"><div class="mmr-pn">${win?'<span class="mmr-win"><i>★</i>WINNER</span>':''}<h3>${nm}</h3></div><div class="mmr-st"><span>แต้มที่ได้</span>${pts}</div><div class="mmr-st"><span>เหรียญที่ได้</span>${coins}</div>${foot}</section>`;
  };
  const card=p=>{const id=G.players[p].avatar.card.def.id;return `<div class="mmr-card ${win0(p)}"><div class="card ${cardArt(id)}"></div></div>`};
  const win0=p=>r.winner===p?'w':'';
  const note=s&&s.why?`<div class="mmr-note">${esc(s.why)}</div>`:'';
  return `<div class="ov mmres"><div class="mmr ${res}"><h1 class="mmr-t">${title}</h1><div class="mmr-why">${esc(r.reason||'')}</div>${note}
    <div class="mmr-cards">${card(me)}${card(op)}</div>
    <div class="mmr-plates">${plate(me,mine,true)}${plate(op,theirs,false)}</div>
    <div class="mmr-meta">เล่นไป ${G.turn} เทิร์น${s&&s.secs?' · '+mmClock(s.secs*1000):''}</div>
    <div class="acts"><button class="btn" data-act="closeover">ดูกระดาน</button><button class="btn" data-act="tosetup">กลับ Home</button><button class="btn pri" data-act="mmagain">ค้นหาอีกครั้ง</button></div></div></div>`;
}
