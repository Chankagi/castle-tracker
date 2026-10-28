'use strict';
const VERSION='v2.0.2-release', SHELL='castle-shell-'+VERSION, RUNTIME='castle-runtime-'+VERSION;
const SHELL_FILES=['./','./index.html','./app.css?v=2.0.2-release','./castles.js?v=2.0.2-release','./core.js?v=2.0.2-release','./app.js?v=2.0.2-release','./sync.js?v=2.0.2-release','./sync-config.js?v=2.0.2-release','./manifest.json','./icon-192.png','./icon-512.png','./icon-512-maskable.png','./apple-touch-icon.png'];
const CDN=['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css','https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL);
  await cache.addAll(SHELL_FILES.map(url=>new Request(url,{cache:'reload'})));
  await Promise.all(CDN.map(url=>cache.add(url).catch(()=>{})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys()) if((name.startsWith('castle-shell-')||name.startsWith('castle-runtime-'))&&name!==SHELL&&name!==RUNTIME)await caches.delete(name);
  await self.clients.claim();
})()));
async function navigation(req){
  try{const res=await fetch(req);if(!res.ok)throw Error('offline');const cache=await caches.open(SHELL);await cache.put('./index.html',res.clone());return res;}
  catch{return await caches.match('./index.html')||new Response('通信がありません。接続後にもう一度開いてください。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
}
async function asset(req){const cached=await caches.match(req);if(cached)return cached;return fetch(req);}
async function tile(req){
  const cache=await caches.open(RUNTIME),cached=await cache.match(req);if(cached)return cached;
  const res=await fetch(req);if(res.ok||res.type==='opaque'){await cache.put(req,res.clone());const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-160)))await cache.delete(key);}return res;
}
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url),scope=new URL(self.registration.scope);
  // No interception of authentication, API calls or unrelated same-origin applications.
  if(url.origin===scope.origin&&url.pathname.startsWith(scope.pathname)){
    if(req.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===scope.pathname+'index.html')){event.respondWith(navigation(req));return;}
    if(url.pathname.endsWith('/sync-config.js')){event.respondWith(fetch(req,{cache:'no-store'}).then(async res=>{if(!res.ok)throw Error('offline');const c=await caches.open(SHELL);await c.put(req,res.clone());return res;}).catch(()=>caches.match(req)));return;}
    event.respondWith(asset(req));return;
  }
  if(CDN.includes(url.href)){event.respondWith(asset(req));return;}
  if(url.hostname==='cyberjapandata.gsi.go.jp'&&url.pathname.startsWith('/xyz/pale/'))event.respondWith(tile(req));
});
