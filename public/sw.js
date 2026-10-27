const C='gtm-shell-v2',F=['/','/manifest.webmanifest','/offline.html','/icon-192.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.pathname.startsWith('/api/')||u.pathname==='/health')return; // ข้อมูลการเงินไม่แคช
 if(e.request.mode==='navigate')return e.respondWith(fetch(e.request).catch(()=>caches.match('/offline.html')));
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
