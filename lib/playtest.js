/* AvastFall Playtest – ส่วนเซิร์ฟเวอร์ของเกมทดลองเล่น (ย้ายมาจาก server.js ของ AvastFallTCGsim เดิม ไม่แก้ตรรกะ)
   - POST /api/feedback        รับข้อเสนอแนะจากผู้เล่น (สาธารณะ)
   - GET  /recommece           หน้าสำหรับเจ้าของไว้อ่านข้อเสนอแนะทั้งหมด (/recommend ใช้ได้เหมือนกัน)
   - GET  /api/feedback        ข้อมูลดิบ JSON (ต้องใส่ key ถ้าตั้ง ADMIN_KEY)
   - /api/room/*               ห้องออนไลน์เล่นกับเพื่อน (SSE + POST)
   - /api/room/queue/*         จับคู่ออนไลน์: join / status / cancel (คิวในหน่วยความจำ จับคู่เฉพาะคนที่กดค้นหาคิวเดียวกันอยู่ตอนนี้)
                               ผลแมตช์จับคู่: ทั้งสองเครื่องรายงานผลมา ตรงกันจึงแจกแต้ม/เหรียญ (ดู settle())

   ใช้เป็น middleware ของ Express: app.use(playtest.middleware)  (ต้องวางก่อน compression / express.json
   เพราะ SSE ห้ามถูกบีบอัด และ body ของห้องใหญ่กว่าที่ express.json รับ)

   ตั้งค่าด้วย environment variable
     ADMIN_KEY   รหัสเข้าดูหน้า /recommece?key=...  ถ้าเว้นว่างทุกคนที่รู้ลิงก์ดูได้ (แต่ลบไม่ได้)
                 (แยกจาก ADMIN_PASSWORD ของ /admin เพราะ key นี้ไปอยู่ใน URL)
     DATA_DIR    โฟลเดอร์เก็บข้อมูล (ค่าเริ่มต้น ./data) เก็บ feedback.json ตรงนี้
     RESEND_API_KEY / NOTIFY_EMAIL / MAIL_FROM   อีเมลสำเนาข้อเสนอแนะ */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const meLib = require('./me'), rank = require('./rank'), supa = require('./supa');

const ROOT = path.join(__dirname, '..');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'feedback.json');
const CATS = { suggest: 'ข้อเสนอแนะ', bug: 'พบข้อผิดพลาด', card: 'เรื่องการ์ด/เอฟเฟกต์', rule: 'เรื่องกติกา', other: 'อื่น ๆ' };
const MAX_ITEMS = 5000;
const NOTIFY_TO = process.env.NOTIFY_EMAIL || 'saknarinnumber8@gmail.com';   // อีเมลที่รับสำเนาทุกครั้ง
const RESEND_KEY = process.env.RESEND_API_KEY || '';                        // คีย์จาก resend.com
const MAIL_FROM = process.env.MAIL_FROM || 'AvastFall Feedback <onboarding@resend.dev>';

/* ---------------------------------------------------------------- storage */
let items = [];
try { items = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(items)) items = []; } catch (e) { items = []; }
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 1));
  fs.renameSync(tmp, FILE);
}

/* ---------------------------------------------------------------- helpers */
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isAdmin = (u, req) => !ADMIN_KEY || same(u.searchParams.get('key') || req.headers['x-admin-key'] || '', ADMIN_KEY);
const canDelete = (u, req) => !!ADMIN_KEY && isAdmin(u, req);
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const hits = new Map();   // ip -> เวลาที่ส่งล่าสุด (กันสแปม 5 ครั้ง / 10 นาที)
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (arr.length >= 5) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
function body(req, max = 8192) {
  return new Promise((res, rej) => {
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > max) { rej(new Error('too large')); req.destroy(); } else ch.push(c); });
    req.on('end', () => res(Buffer.concat(ch).toString('utf8')));
    req.on('error', rej);
  });
}
const send = (res, code, type, text, extra = {}) => { res.writeHead(code, Object.assign({ 'content-type': type, 'cache-control': 'no-store' }, extra)); res.end(text); };
const json = (res, code, obj, extra) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj), extra);

/* ---------------------------------------------------------------- อีเมลสำเนา (Resend HTTP API เพราะ Render ฟรีบล็อก SMTP) */
async function sendMail(subject, html) {
  if (!RESEND_KEY) return { ok: false, error: 'ยังไม่ได้ตั้ง RESEND_API_KEY' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + RESEND_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [NOTIFY_TO], subject, html })
    });
    const text = await r.text();
    if (!r.ok) { console.error('ส่งอีเมลไม่สำเร็จ', r.status, text); return { ok: false, status: r.status, error: text }; }
    console.log('ส่งอีเมลสำเร็จ ->', NOTIFY_TO, text);
    return { ok: true, status: r.status, to: NOTIFY_TO, from: MAIL_FROM, resend: text };
  } catch (err) { console.error('ส่งอีเมลไม่สำเร็จ', err.message); return { ok: false, error: err.message }; }
}
async function notify(it) {
  if (!RESEND_KEY) { console.warn('ยังไม่ได้ตั้ง RESEND_API_KEY จึงไม่ส่งอีเมล'); return; }
  const cat = CATS[it.category] || it.category;
  const ctx = Object.entries(it.context || {}).map(([k, v]) => esc(k) + ': ' + esc(v)).join(' · ');
  await sendMail('[AvastFall] ' + cat + ' - ' + it.text.slice(0, 50).replace(/\n/g, ' '),
    '<p><b>' + esc(cat) + '</b> · จาก: ' + esc(it.name || 'ไม่ระบุชื่อ') + (it.contact ? ' · ติดต่อ: ' + esc(it.contact) : '') + '</p><p style="white-space:pre-wrap">' + esc(it.text) + '</p><p style="color:#888">' + ctx + '</p>');
}

/* ---------------------------------------------------------------- หน้า /recommece */
function page(u, req) {
  const key = u.searchParams.get('key') || '';
  const q = key ? `key=${encodeURIComponent(key)}&` : '';
  const cat = u.searchParams.get('cat') || '';
  const list = items.filter(i => !cat || i.category === cat).slice().reverse();
  const del = canDelete(u, req);
  const counts = {}; for (const i of items) counts[i.category] = (counts[i.category] || 0) + 1;
  const fmt = t => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
  const chips = [['', 'ทั้งหมด', items.length], ...Object.entries(CATS).map(([k, v]) => [k, v, counts[k] || 0])]
    .map(([k, v, n]) => `<a class="chip ${cat === k ? 'on' : ''}" href="/recommece?${q}${k ? 'cat=' + k : ''}">${esc(v)} <b>${n}</b></a>`).join('');
  const cards = list.map(i => `<article class="fb">
    <header><span class="tag ${esc(i.category)}">${esc(CATS[i.category] || i.category)}</span><time>${esc(fmt(i.at))}</time>
    <span class="who">${esc(i.name || 'ไม่ระบุชื่อ')}${i.contact ? ' · ' + esc(i.contact) : ''}</span></header>
    <p>${esc(i.text)}</p>
    ${i.context && Object.keys(i.context).length ? `<small>${Object.entries(i.context).map(([k, v]) => esc(k) + ': ' + esc(v)).join(' · ')}</small>` : ''}
    ${del ? `<form method="post" action="/recommece/delete?${q}" onsubmit="return confirm('ลบข้อความนี้?')"><input type="hidden" name="id" value="${esc(i.id)}"><button>ลบ</button></form>` : ''}
  </article>`).join('') || '<p class="empty">ยังไม่มีข้อเสนอแนะ</p>';
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>ข้อเสนอแนะจากผู้ทดลองเล่น</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mali:wght@600;700&family=Noto+Sans+Thai:wght@400;500;600&display=swap">
<style>
:root{--paper:#f7f6f0;--panel:#fff;--ink:#173646;--ink2:#5a7280;--coral:#e4604a;--soft:#d9e0dc}
@media (prefers-color-scheme:dark){:root{--paper:#11181c;--panel:#1a252b;--ink:#e8f0f2;--ink2:#9bb2bc;--coral:#f27d66;--soft:#2a3a42}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 'Noto Sans Thai',Tahoma,sans-serif;padding:16px}
.wrap{max-width:860px;margin:0 auto}h1{font:700 26px 'Mali','Noto Sans Thai',sans-serif;margin:8px 0}
.top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
a{color:var(--coral)}.muted{color:var(--ink2)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
.chip{border:2px solid var(--ink);border-radius:99px;padding:2px 12px;text-decoration:none;color:var(--ink);background:var(--panel);font-weight:500}
.chip.on{background:var(--ink);color:var(--paper)}
.fb{background:var(--panel);border:2px solid var(--ink);border-radius:12px;padding:12px 14px;margin:12px 0;box-shadow:3px 3px 0 var(--ink)}
.fb header{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:13px;color:var(--ink2)}
.tag{background:var(--coral);color:#fff;border-radius:6px;padding:0 8px;font-weight:600}.tag.bug{background:#c0392b}.tag.card{background:#2d8f83}.tag.rule{background:#b98a00}.tag.other{background:#6b7f8a}
.fb p{margin:8px 0;white-space:pre-wrap;word-break:break-word}.fb small{color:var(--ink2)}
.fb form{margin-top:6px}.fb button{border:2px solid var(--ink);background:var(--panel);color:var(--ink);border-radius:8px;padding:2px 12px;cursor:pointer}
.empty{padding:30px;text-align:center;color:var(--ink2)}
</style></head><body><div class="wrap">
<div class="top"><h1>ข้อเสนอแนะจากผู้ทดลองเล่น</h1><span><a href="/">← กลับหน้าเกม</a> · <a href="/api/feedback?${q}download=1">ดาวน์โหลด JSON</a></span></div>
<p class="muted">ทั้งหมด ${items.length} รายการ · เรียงจากใหม่ไปเก่า${ADMIN_KEY ? '' : ' · ยังไม่ได้ตั้ง ADMIN_KEY ทุกคนที่รู้ลิงก์นี้เปิดอ่านได้ และลบไม่ได้'}</p>
<div class="chips">${chips}</div>${cards}</div></body></html>`;
}

/* ---------------------------------------------------------------- ตรวจเด็คฝั่งเซิร์ฟเวอร์ (เฉพาะแมตช์จับคู่ที่มีแต้ม/เหรียญ)
   ตรวจ: Avatar 1 ใบ · รวม 60 ใบ · การ์ดมีอยู่จริง · ชื่อเดียวกันไม่เกิน 4 ใบ · เป็นการ์ดที่ผู้เล่นมี
   ยกเว้นเด็คตัวอย่างฟรี = ใช้การ์ดจากชุด Starter Deck (SD*) ชุดเดียวทั้งเด็ค (ตรงกับที่เบราว์เซอร์ให้ใช้ฟรี) */
async function checkMmDeck(uid, deck) {
  const S = require('./store').state;
  const av = deck && S.byId.get(String(deck.avatar || '').toLowerCase());
  if (!av || av.type !== 'Avatar') return 'Avatar ในเด็คไม่ถูกต้อง';
  const counts = deck.counts && typeof deck.counts === 'object' ? deck.counts : null;
  if (!counts) return 'เด็คไม่ถูกต้อง';
  let total = 1; const names = {}, need = {}; const sets = new Set([av.deck]);
  for (const [id, n] of Object.entries(counts)) {
    const c = S.byId.get(String(id).toLowerCase()), k = Number(n);
    if (!c || c.type === 'Avatar') return 'เด็คมีการ์ดที่ไม่พบในระบบ: ' + clip(id, 20);
    if (!Number.isInteger(k) || k < 1 || k > 4) return 'จำนวนการ์ดในเด็คไม่ถูกต้อง';
    total += k; names[c.name] = (names[c.name] || 0) + k; sets.add(c.deck);
    const b = meLib.baseId(id); need[b] = (need[b] || 0) + k;
  }
  if (total !== 60) return 'เด็คต้องมี 60 ใบพอดี (ตอนนี้ ' + total + ')';
  if (Object.values(names).some(k => k > 4)) return 'การ์ดชื่อเดียวกันใส่ได้ไม่เกิน 4 ใบ';
  if (sets.size === 1 && /^SD/i.test([...sets][0])) return null;   // เด็คตัวอย่างฟรี
  const own = meLib.ownedBase(await meLib.ownedMap(uid));
  if (!(own[meLib.baseId(deck.avatar)] > 0)) return 'คุณยังไม่มี Avatar ของเด็คนี้';
  for (const [b, k] of Object.entries(need)) if ((own[b] || 0) < k) return 'การ์ดที่คุณมีไม่พอสำหรับเด็คนี้ (' + b + ')';
  return null;
}

/* ---------------------------------------------------------------- ห้องออนไลน์ (เล่นกับเพื่อน)
   เซิร์ฟเวอร์ไม่รู้กติกาเกม ทำหน้าที่แค่ส่งต่อ "ตัวเลือกที่ผู้เล่นกด" ระหว่างสองฝั่ง (SSE + POST)
   ทั้งสองเบราว์เซอร์รัน engine เดียวกันด้วย seed เดียวกัน (lockstep) ห้องเก็บในหน่วยความจำ รีสตาร์ตแล้วหาย */
const rooms = new Map();
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 300;
function newCode() { for (let t = 0; t < 50; t++) { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CH[crypto.randomInt(CODE_CH.length)]; if (!rooms.has(c)) return c; } return null; }
const mkPlayer = () => ({ token: crypto.randomBytes(12).toString('hex'), out: [], seq: 0, res: null, lastN: 0, ready: null, online: false });
function push(room, i, obj) {
  const p = room.pl[i]; if (!p) return;
  const id = ++p.seq, data = JSON.stringify(obj);
  p.out.push({ id, data }); if (p.out.length > 4000) p.out.shift();
  if (p.res) { try { p.res.write('id: ' + id + '\ndata: ' + data + '\n\n'); } catch (e) { } }
}

/* ---------------------------------------------------------------- จับคู่ออนไลน์ (คิว) + รางวัล
   - ผู้เล่นกด "ค้นหา" → เข้าคิวตามคีย์ (ตอนนี้มีคิวเดียว standard) · จับคู่เฉพาะคนที่ค้นหาคิวเดียวกันอยู่พร้อมกัน คนที่รอนานสุดได้คู่ก่อน
   - เบราว์เซอร์ถามสถานะทุก ~1 วินาที (status) ถ้าเงียบเกิน 12 วินาทีถือว่าปิดหน้าไปแล้ว → ออกจากคิวเอง
   - จับคู่ได้แล้วสร้างห้องให้ทั้งคู่ (ห้องเดียวกับห้องส่วนตัว แต่ mm = true) ทั้งสองฝั่งกด "พร้อม" ให้เองจากเบราว์เซอร์ */
const QUEUES = { standard: 'STANDARD' };
const queue = new Map();                      // uid -> { uid, name, key, since, seen, matched }
const Q_STALE = 12000, Q_MAX = 10 * 60e3, MM_START_WAIT = 45000, MM_OFFLINE_FORFEIT = 90000, MM_RESULT_WAIT = 25000;
const bangkokDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const dayCoins = new Map(), pairCount = new Map();   // เพดานเหรียญ/วัน และจำนวนครั้งที่เจอคู่เดิม/วัน (ในหน่วยความจำ รีสตาร์ตแล้วเริ่มนับใหม่)

function qSweep() {
  const now = Date.now();
  for (const [uid, e] of queue) {
    if (e.matched) { if (now - e.matched.at > 90000) queue.delete(uid); }
    else if (now - e.seen > Q_STALE || now - e.since > Q_MAX) queue.delete(uid);
  }
  const d = bangkokDay();
  for (const k of dayCoins.keys()) if (!k.startsWith(d)) dayCoins.delete(k);
  for (const k of pairCount.keys()) if (!k.startsWith(d)) pairCount.delete(k);
}
function qWaiting(key) { let n = 0; for (const e of queue.values()) if (!e.matched && e.key === key) n++; return n; }
function tryMatch(me) {
  let best = null;
  for (const e of queue.values()) if (!e.matched && e.key === me.key && e.uid !== me.uid && (!best || e.since < best.since)) best = e;
  if (!best) return;
  if (rooms.size >= MAX_ROOMS) return;
  const code = newCode(); if (!code) return;
  const flip = crypto.randomInt(2) === 1, a = flip ? best : me, b = flip ? me : best;   // สุ่มว่าใครเป็นผู้เล่น 0/1
  const room = { code, at: Date.now(), createdAt: Date.now(), pl: [mkPlayer(), mkPlayer()], started: false, mm: true, key: me.key, uids: [a.uid, b.uid], names: [a.name, b.name], startedAt: 0, settled: false, firstResultAt: 0, offAt: [0, 0] };
  rooms.set(code, room);
  const now = Date.now();
  [a, b].forEach((e, i) => { e.matched = { code, pid: i, token: room.pl[i].token, opp: i === 0 ? b.name : a.name, at: now }; });
}

async function settle(room, winner, reason, opts = {}) {
  if (room.settled) return; room.settled = true;
  const secs = Math.max(0, Math.round((Date.now() - (room.startedAt || room.createdAt)) / 1000));
  let why = opts.why || '';
  let noReward = !!opts.noReward;
  if (!noReward && secs < rank.MIN_SECS) { noReward = true; why = 'เกมสั้นกว่า ' + rank.MIN_SECS + ' วินาที จึงไม่นับรางวัล'; }
  const day = bangkokDay(), pairKey = day + '|' + room.uids.slice().sort().join('|');
  if (!noReward && (pairCount.get(pairKey) || 0) >= rank.PAIR_DAILY_CAP) { noReward = true; why = 'วันนี้เจอคู่แข่งคนเดิมครบ ' + rank.PAIR_DAILY_CAP + ' ครั้งแล้ว จึงไม่นับรางวัล'; }
  const out = { t: 'settled', winner, reason, secs, why, names: room.names, rewards: [null, null] };
  for (const i of [0, 1]) {
    const uid = room.uids[i], result = winner == null ? 'draw' : winner === i ? 'win' : 'loss';
    let coins = 0, points = 0, capped = false;
    if (!noReward) {
      const base = rank.REWARD[result], ck = day + '|' + uid, used = dayCoins.get(ck) || 0;
      points = base.points; coins = Math.max(0, Math.min(base.coins, rank.DAILY_COIN_CAP - used));
      capped = coins < base.coins; dayCoins.set(ck, used + coins);
    }
    try {
      const r = await meLib.awardMatch(uid, { coins, points, result: noReward ? null : result });
      out.rewards[i] = { result, coins, points: noReward ? 0 : r.dPoints, capped, total: { coins: r.coins, points: r.points, wins: r.wins, losses: r.losses }, league: rank.leagueOf(r.points), pointsSaved: r.pointsSaved };
    } catch (e) { console.error('แจกรางวัลแมตช์ไม่สำเร็จ', uid, e.message); out.rewards[i] = { result, coins: 0, points: 0, error: true }; }
  }
  if (!noReward) pairCount.set(pairKey, (pairCount.get(pairKey) || 0) + 1);
  push(room, 0, out); push(room, 1, out);
  try { await supa.db.from('match_results').insert({ room: room.code, p0: room.uids[0], p1: room.uids[1], winner, secs, reason, detail: { why, rewards: out.rewards.map(r => r && { result: r.result, coins: r.coins, points: r.points }) } }); }
  catch (e) { /* ตารางประวัติยังไม่ได้สร้าง ไม่เป็นไร */ }
}
// กวาดห้องจับคู่ (เรียกทุก 15 วินาที): ไม่มีใครเริ่มเกม · ฝั่งหนึ่งหายไปนาน · อีกฝั่งไม่ส่งผลมา
function mmSweep(now) {
  for (const [c, r] of rooms) {
    if (!r.mm || r.settled) continue;
    if (!r.started) {
      if (now - r.createdAt > MM_START_WAIT) { push(r, 0, { t: 'abort' }); push(r, 1, { t: 'abort' }); r.settled = true; setTimeout(() => rooms.delete(c), 5000).unref(); }
      continue;
    }
    for (const i of [0, 1]) { const p = r.pl[i]; if (p.online) r.offAt[i] = 0; else if (!r.offAt[i]) r.offAt[i] = now; }
    for (const i of [0, 1]) if (r.offAt[i] && now - r.offAt[i] > MM_OFFLINE_FORFEIT && r.pl[1 - i].online) return void settle(r, 1 - i, 'timeout');
    const [a, b] = r.pl;
    if ((a.result || b.result) && !(a.result && b.result) && now - r.firstResultAt > MM_RESULT_WAIT) {
      const got = a.result || b.result, from = a.result ? 0 : 1, silent = 1 - from;
      if (got.winner === silent || got.winner == null || !r.pl[silent].online) settle(r, got.winner, 'finish');   // ผู้รายงานบอกว่าตัวเองแพ้/เสมอ หรืออีกฝั่งหลุดไปแล้ว → ยอมรับ
      else settle(r, null, 'unconfirmed', { noReward: true, why: 'คู่แข่งไม่ยืนยันผล จึงไม่นับรางวัล' });
    }
  }
}
const roomOf = (code, pid, token) => {
  const r = rooms.get(String(code || '').toUpperCase()); pid = +pid;
  if (!r || (pid !== 0 && pid !== 1) || !r.pl[pid] || !same(token || '', r.pl[pid].token)) return null;
  r.at = Date.now(); return r;
};
setInterval(() => {
  const now = Date.now();
  qSweep(); mmSweep(now);
  for (const [c, r] of rooms) {
    for (const p of r.pl) if (p && p.res) { try { p.res.write(': ping\n\n'); } catch (e) { } }
    const anyOn = r.pl.some(p => p && p.online);
    if (now - r.at > 3 * 3600e3 || (!anyOn && now - r.at > 15 * 60e3)) { for (const p of r.pl) if (p && p.res) { try { p.res.end(); } catch (e) { } } rooms.delete(c); }
  }
}, 15000).unref();

async function roomRoute(u, req, res) {
  const path_ = u.pathname;
  if (path_.startsWith('/api/room/queue/')) {
    const sess = req.session; if (!sess) return json(res, 401, { ok: false, error: 'กรุณาเข้าสู่ระบบ' });
    const uid = sess.user.id, name = String(sess.profile.username || 'ผู้เล่น').slice(0, 16);
    if (path_ === '/api/room/queue/join' && req.method === 'POST') {
      let d = {}; try { d = JSON.parse(await body(req)) || {}; } catch (e) { }
      const key = QUEUES[d.key] ? d.key : 'standard', now = Date.now();
      queue.delete(uid);                                                    // กดซ้ำ/เปิดสองแท็บ = ใช้รายการล่าสุดอันเดียว
      const e = { uid, name, key, since: now, seen: now, matched: null };
      queue.set(uid, e); tryMatch(e);
      return json(res, 200, { ok: true, key, label: QUEUES[key], waiting: qWaiting(key), matched: !!e.matched });
    }
    if (path_ === '/api/room/queue/status' && req.method === 'GET') {
      const e = queue.get(uid);
      if (!e) return json(res, 200, { ok: true, state: 'none' });
      e.seen = Date.now();
      if (e.matched) { const m = e.matched; return json(res, 200, { ok: true, state: 'matched', code: m.code, pid: m.pid, token: m.token, opp: m.opp }); }
      return json(res, 200, { ok: true, state: 'waiting', waited: Math.floor((Date.now() - e.since) / 1000), waiting: qWaiting(e.key), label: QUEUES[e.key] });
    }
    if (path_ === '/api/room/queue/cancel' && req.method === 'POST') {
      const e = queue.get(uid); if (e && !e.matched) queue.delete(uid);
      return json(res, 200, { ok: true, matched: !!(e && e.matched) });    // ถ้าจับคู่ได้ไปแล้วตอนกดยกเลิก บอกให้เบราว์เซอร์รู้ (ไปต่อเข้าเกม)
    }
    return json(res, 404, { ok: false, error: 'ไม่พบคำสั่ง' });
  }
  if (path_ === '/api/room/create' && req.method === 'POST') {
    if (rooms.size >= MAX_ROOMS) return json(res, 503, { ok: false, error: 'ห้องเต็มชั่วคราว ลองใหม่ภายหลัง' });
    const code = newCode(); if (!code) return json(res, 503, { ok: false, error: 'สร้างห้องไม่ได้' });
    const room = { code, at: Date.now(), pl: [mkPlayer(), null], started: false };
    rooms.set(code, room);
    return json(res, 200, { ok: true, code, pid: 0, token: room.pl[0].token });
  }
  if (path_ === '/api/room/join' && req.method === 'POST') {
    let d; try { d = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
    const room = rooms.get(String(d.code || '').trim().toUpperCase());
    if (!room) return json(res, 404, { ok: false, error: 'ไม่พบห้องนี้ (ตรวจรหัสอีกครั้ง)' });
    if (room.pl[1]) return json(res, 409, { ok: false, error: 'ห้องนี้มีผู้เล่นครบสองคนแล้ว' });
    room.pl[1] = mkPlayer(); room.at = Date.now();
    return json(res, 200, { ok: true, code: room.code, pid: 1, token: room.pl[1].token });
  }
  if (path_ === '/api/room/events' && req.method === 'GET') {
    const room = roomOf(u.searchParams.get('code'), u.searchParams.get('pid'), u.searchParams.get('token'));
    if (!room) return send(res, 404, 'text/plain; charset=utf-8', 'ไม่พบห้อง');
    const me = +u.searchParams.get('pid'), you = 1 - me, p = room.pl[me];
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'connection': 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 2000\n\n');
    const last = +(req.headers['last-event-id'] || u.searchParams.get('last') || 0) || 0;
    for (const m of p.out) if (m.id > last) res.write('id: ' + m.id + '\ndata: ' + m.data + '\n\n');
    if (p.res && p.res !== res) { try { p.res.end(); } catch (e) { } }
    p.res = res; p.online = true;
    push(room, you, { t: 'peer', online: true });
    push(room, me, { t: 'peer', online: !!(room.pl[you] && room.pl[you].online) });
    req.on('close', () => {
      if (p.res !== res) return;
      p.res = null; p.online = false; room.at = Date.now();
      push(room, you, { t: 'peer', online: false });
    });
    return;
  }
  if (path_ === '/api/room/send' && req.method === 'POST') {
    let d; try { d = JSON.parse(await body(req, 24576)); } catch (e) { return json(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
    const room = roomOf(d.code, d.pid, d.token);
    if (!room) return json(res, 404, { ok: false, error: 'ไม่พบห้อง' });
    const me = +d.pid, you = 1 - me, p = room.pl[me], m = d.msg || {};
    if (m.t === 'ready') {
      if (!room.pl[you]) return json(res, 409, { ok: false, error: 'ยังไม่มีเพื่อนเข้าห้อง' });
      if (!m.deck || typeof m.deck !== 'object') return json(res, 400, { ok: false, error: 'ไม่มีเด็ค' });
      if (room.mm) { let why = null; try { why = await checkMmDeck(room.uids[me], m.deck); } catch (e) { console.error('ตรวจเด็คไม่สำเร็จ', e.message); why = 'ตรวจเด็คไม่สำเร็จ ลองใหม่อีกครั้ง'; } if (why) return json(res, 400, { ok: false, error: why }); }
      p.ready = { deck: m.deck, hash: clip(m.hash, 40), name: clip(m.name, 16) };
      const q = room.pl[you];
      if (q.ready && !room.started) {
        room.started = true; if (room.mm) room.startedAt = Date.now();
        const msg = { t: 'start', seed: crypto.randomInt(2 ** 31), first: crypto.randomInt(2), decks: [], hashes: [], names: [] };
        for (const i of [0, 1]) { msg.decks[i] = room.pl[i].ready.deck; msg.hashes[i] = room.pl[i].ready.hash; msg.names[i] = room.pl[i].ready.name || ('ผู้เล่น ' + (i + 1)); }
        if (msg.names[0] === msg.names[1]) msg.names[1] += ' (2)';
        push(room, 0, msg); push(room, 1, msg);
      } else if (!room.started) push(room, you, { t: 'peerready' });
    } else if (m.t === 'move') {
      if (!room.started) return json(res, 409, { ok: false, error: 'เกมยังไม่เริ่ม' });
      const n = +m.n || 0;
      if (n <= p.lastN) return json(res, 200, { ok: true, dup: true });   // ส่งซ้ำ (ลองใหม่หลังเน็ตหลุด)
      p.lastN = n;
      push(room, you, { t: 'move', k: clip(m.k, 12), v: m.v });
    } else if (m.t === 'result') {
      // แมตช์จับคู่: ทั้งสองเครื่องรันเกมเดียวกัน ต่างฝ่ายรายงานผู้ชนะมา · ตรงกัน = แจกรางวัล · ไม่ตรงกัน = ไม่แจกใคร
      if (!room.mm || !room.started || room.settled || p.result) return json(res, 200, { ok: true });
      p.result = { winner: m.winner === 0 || m.winner === 1 ? m.winner : null, at: Date.now() };
      const q = room.pl[you];
      if (q.result) { if (q.result.winner === p.result.winner) settle(room, p.result.winner, 'finish'); else settle(room, null, 'dispute', { noReward: true, why: 'ผลของสองเครื่องไม่ตรงกัน จึงไม่นับรางวัล' }); }
      else room.firstResultAt = Date.now();
    } else if (m.t === 'leave') {
      push(room, you, { t: 'leave' });
      if (room.mm && room.started && !room.settled) {
        const q = room.pl[you];
        if (p.result && !(q.result && q.result.winner !== p.result.winner)) settle(room, p.result.winner, 'finish');   // รายงานผลแล้วค่อยออก = นับตามผลที่รายงาน ไม่ใช่ยอมแพ้
        else settle(room, you, 'forfeit');   // ออกกลางเกม = แพ้
      }
    } else return json(res, 400, { ok: false, error: 'คำสั่งไม่ถูกต้อง' });
    return json(res, 200, { ok: true });
  }
  return false;
}

/* ---------------------------------------------------------------- routes */
const OWN = u => u.pathname === '/api/feedback' || u.pathname === '/recommece' || u.pathname === '/recommece/delete' || u.pathname === '/recommend' || u.pathname === '/recommece/test-mail' || u.pathname.startsWith('/api/room/');
async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (u.pathname === '/api/feedback') {
    if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '', cors);
    if (req.method === 'POST') {
      let d; try { d = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }, cors); }
      if (d && d.website) return json(res, 200, { ok: true }, cors);          // honeypot: บอทกรอกช่องที่ซ่อนไว้
      const text = clip(d.text, 1500);
      if (text.length < 3) return json(res, 400, { ok: false, error: 'กรุณาพิมพ์ข้อความอย่างน้อย 3 ตัวอักษร' }, cors);
      if (limited(ipOf(req))) return json(res, 429, { ok: false, error: 'ส่งบ่อยเกินไป รอสักครู่แล้วลองใหม่' }, cors);
      const ctx = {}; if (d.context && typeof d.context === 'object') for (const k of Object.keys(d.context).slice(0, 6)) ctx[clip(k, 20)] = clip(d.context[k], 120);
      const item = { id: crypto.randomBytes(6).toString('hex'), at: Date.now(), category: CATS[d.category] ? d.category : 'suggest', text, name: clip(d.name, 60), contact: clip(d.contact, 100), context: ctx };
      items.push(item);
      if (items.length > MAX_ITEMS) items = items.slice(-MAX_ITEMS);
      try { save(); } catch (e) { console.error('save failed', e.message); return json(res, 500, { ok: false, error: 'บันทึกไม่สำเร็จ' }, cors); }
      notify(item);   // ส่งสำเนาอีเมลเบื้องหลัง ไม่รอผล
      return json(res, 200, { ok: true }, cors);
    }
    if (req.method === 'GET') {
      if (!isAdmin(u, req)) return json(res, 401, { ok: false, error: 'ต้องใส่ key' });
      return json(res, 200, items, u.searchParams.get('download') ? { 'content-disposition': 'attachment; filename="feedback.json"' } : {});
    }
    return send(res, 405, 'text/plain', 'method not allowed');
  }
  if (u.pathname === '/recommece/test-mail') {   // ทดสอบส่งอีเมล: เปิด /recommece/test-mail?key=ADMIN_KEY (ต้องตั้ง ADMIN_KEY)
    if (!canDelete(u, req)) return json(res, 403, { ok: false, error: 'ต้องตั้ง ADMIN_KEY และใส่ key ให้ถูก' });
    return json(res, 200, await sendMail('[AvastFall] ทดสอบส่งอีเมล', '<p>ถ้าอ่านข้อความนี้ได้ แปลว่าระบบส่งอีเมลทำงานแล้ว ✅</p>'));
  }
  if (u.pathname === '/recommece' || u.pathname === '/recommend') {
    if (!isAdmin(u, req)) return send(res, 401, 'text/html; charset=utf-8', '<!doctype html><meta charset="utf-8"><title>ต้องใส่รหัส</title><p style="font:16px sans-serif;padding:24px">ต้องใส่รหัสเข้าดู เปิดด้วย <code>/recommece?key=รหัสของคุณ</code></p>');
    return send(res, 200, 'text/html; charset=utf-8', page(u, req));
  }
  if (u.pathname === '/recommece/delete' && req.method === 'POST') {
    if (!canDelete(u, req)) return send(res, 403, 'text/plain; charset=utf-8', 'ลบไม่ได้ (ยังไม่ได้ตั้ง ADMIN_KEY หรือรหัสไม่ถูก)');
    const id = new URLSearchParams(await body(req)).get('id');
    items = items.filter(i => i.id !== id); try { save(); } catch (e) { }
    const k = u.searchParams.get('key');
    return send(res, 303, 'text/plain', '', { location: '/recommece' + (k ? '?key=' + encodeURIComponent(k) : '') });
  }
  const r = await roomRoute(u, req, res);
  if (r === false) send(res, 404, 'text/plain', 'not found');
}

/* Express middleware: จัดการเฉพาะเส้นทางของเกมทดลองเล่น ที่เหลือส่งต่อ */
function middleware(req, res, next) {
  let u; try { u = new URL(req.url, 'http://x'); } catch (e) { return next(); }
  if (!OWN(u)) return next();
  handle(req, res).catch(e => { console.error(e); try { if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'เกิดข้อผิดพลาด'); else res.end(); } catch (_) { } });
}

module.exports = { middleware, FILE, hasAdminKey: !!ADMIN_KEY };
