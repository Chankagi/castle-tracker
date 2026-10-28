// Local preview only. No uploads or directory listings; bind loopback exclusively.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname;
const allowed=new Set(['responsive.html','index.html','app.js','core.js','sync.js','sync-config.js','castles.js','app.css','sw.js','manifest.json','icon-192.png','icon-512.png','icon-512-maskable.png','apple-touch-icon.png','同期セットアップ.txt']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';if(!allowed.has(name)){res.writeHead(404);return res.end();}fs.readFile(path.join(root,name),(err,body)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);});}).listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:'+(process.env.PORT||4173)));
