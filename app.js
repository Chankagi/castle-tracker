'use strict';
const C = CastleCore, castles = window.CASTLES, byId = new Map(castles.map(c => [c.number, c]));
const $ = id => document.getElementById(id);
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state, device, activePlan = '', map, markers = new Map(), routeLayer, userMarker;
let cloud, busy = false, syncAgain = false, syncTimer, toastTimer, writeQueue = Promise.resolve(), writable = true, detailsDirty = false;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
function fail(error) { console.error(error); toast(error?.message || '処理できませんでした。'); $('saveStatus').textContent = '保存・処理を確認してください'; }
function currentPlan() { return state.plans[activePlan] && !state.plans[activePlan].deleted ? state.plans[activePlan] : null; }
function plans() { return Object.entries(state.plans).filter(([,p]) => !p.deleted).sort((a,b) => a[1].date.localeCompare(b[1].date) || a[0].localeCompare(b[0])); }
function visited(n) { return state.visits[n]?.date || null; }
async function transaction(change, schedule = true) {
  if (!writable) throw Error('保存領域を読み取れません。元データを保存してから復元してください。');
  const task = async () => {
    const perform = () => {
      const next = C.merge(C.load(localStorage, device), state); change(next);
      state = C.save(localStorage, next); render(); $('saveStatus').textContent = 'この端末に保存済み';
    };
    if (navigator.locks) await navigator.locks.request('castle-tracker-save', perform); else perform();
    if (schedule) scheduleSync();
  };
  const next = writeQueue.then(task); writeQueue = next.catch(() => {}); return next;
}
function switchTab(name) {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== 'panel-' + name);
  window.scrollTo({top:0,behavior:'instant'});
  if (name === 'map') { initializeMap(); setTimeout(() => map?.invalidateSize(), 50); }
}
function initializeMap() {
  if (map) return;
  if (!window.L) { $('map').innerHTML = '<p class="empty">地図を読み込めませんでした。通信を確認して再読み込みしてください。スタンプ帳とプランは利用できます。</p>'; return; }
  map = L.map('map').setView([36.5, 138], 5);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>', maxZoom: 18 }).addTo(map);
  for (const c of castles) {
    const marker = L.circleMarker([c.lat,c.lng], { radius:6, weight:2, color:'#fff', fillOpacity:.95 }).addTo(map);
    marker.bindPopup(() => popup(c)); markers.set(c.number, marker);
  }
  routeLayer = L.layerGroup().addTo(map); renderMap();
}
function popup(c) {
  return `<div class="popup"><span class="badge">${c.number}番 · ${escapeHTML(c.series)}</span><h3>${escapeHTML(c.name)}</h3><p>${escapeHTML(c.prefecture)} / ${visited(c.number) ? '訪問済み：' + escapeHTML(visited(c.number)) : '未訪問'}</p><p>📍 ${escapeHTML(c.stamp)}<br>🅿 ${escapeHTML(c.parking)}</p><button class="primary" data-action="visit" data-id="${c.number}">${visited(c.number) ? '訪問日を編集' : '訪問を記録'}</button><button data-action="add" data-id="${c.number}">プランに追加</button><a class="button" target="_blank" rel="noopener" href="${searchURL(c)}">Googleマップ</a></div>`;
}
function searchURL(c) { return 'https://www.google.com/maps/search/?' + new URLSearchParams({ api:'1', query:`${c.lat},${c.lng}` }); }
function renderMap() {
  if (!map) return;
  const filter = $('mapFilter').value, plan = currentPlan(), stops = plan?.stops || [];
  for (const c of castles) {
    const m = markers.get(c.number), v = Boolean(visited(c.number));
    const show = filter === 'all' || filter === 'visited' && v || filter === 'unvisited' && !v || filter === 'plan' && stops.includes(c.number);
    if (show && !map.hasLayer(m)) m.addTo(map); else if (!show && map.hasLayer(m)) map.removeLayer(m);
    m.setStyle({ fillColor:v ? '#26785b' : '#c39546' }).setRadius(v ? 8 : 6);
    if (m.isPopupOpen()) m.setPopupContent(popup(c));
  }
  routeLayer.clearLayers();
  if (filter === 'plan' && stops.length) {
    const coords = stops.map(n => { const c=byId.get(n); return [c.lat,c.lng]; });
    if (coords.length > 1) L.polyline(coords,{color:'#4c6dc1',weight:3,dashArray:'7 8'}).addTo(routeLayer);
    coords.forEach((point,i) => L.marker(point,{icon:L.divIcon({className:'',html:`<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#4c6dc1;color:white;border:2px solid white;font-weight:700">${i+1}</span>`,iconSize:[26,26],iconAnchor:[13,13]})}).bindPopup(() => popup(byId.get(stops[i]))).addTo(routeLayer));
  }
  $('mapNote').textContent = filter === 'plan' ? (plan ? `${plan.name}：点線は訪問順を示します。道路の経路・走行距離ではありません。` : 'ドライブプランに城を追加すると表示されます。') : '城を選ぶと、訪問記録やプランへの追加ができます。';
}
function renderBook() {
  const q=$('searchInput').value.normalize('NFKC').trim(), series=$('filterSeries').value, filter=$('filterVisited').value;
  const list=castles.filter(c => (!q || c.name.includes(q)||c.prefecture.includes(q)||String(c.number)===q) && (!series || c.series===series) && (filter==='all'||filter==='visited'&&visited(c.number)||filter==='unvisited'&&!visited(c.number)));
  $('bookCount').textContent=`${list.length} 城`;
  $('stampBook').innerHTML=list.map(c => `<article class="card castle-card ${visited(c.number)?'is-visited':''}"><div class="row"><span class="badge ${c.series==='100名城'?'gold':''}">${c.series}</span><small>第${c.number}番 · ${c.prefecture}</small></div><h3>${c.name}</h3><div class="details">📍 ${c.stamp}<br>🅿 ${c.parking}</div><div class="visited-label">${visited(c.number)?'✓ '+escapeHTML(visited(c.number)):'未訪問'}</div><div class="row"><button class="primary" data-action="visit" data-id="${c.number}">${visited(c.number)?'訪問日を編集':'訪問を記録'}</button><button data-action="show" data-id="${c.number}">地図</button><button data-action="add" data-id="${c.number}" aria-label="${c.name}をプランに追加">＋</button></div></article>`).join('') || '<p class="empty">条件に合う城がありません。検索条件を変更してください。</p>';
}
function renderPlan() {
  const all=plans(); if (!currentPlan()) { activePlan=all[0]?.[0] || ''; detailsDirty=false; }
  $('planSelect').innerHTML=all.length?all.map(([key,p]) => `<option value="${key}">${escapeHTML(p.name)}${p.date?' · '+p.date:''}</option>`).join(''):'<option value="">プランがありません</option>';
  $('planSelect').value=activePlan;
  const p=currentPlan();
  if(!detailsDirty){$('planName').value=p?.name||'';$('planDate').value=p?.date||'';$('planOrigin').value=p?.origin||'';}
  $('planDetails').querySelectorAll('input,button').forEach(el=>el.disabled=!p);
  $('deletePlan').disabled=!p;$('planToMap').disabled=!p?.stops.length;
  $('planList').innerHTML=p?.stops.length?p.stops.map((n,i)=>{const c=byId.get(n);return `<li class="stop"><span class="order">${i+1}</span><div class="stop-info"><strong>${c.name}</strong><small>${c.prefecture} · 第${c.number}番 ${visited(n)?' · ✓ 訪問済み':''}</small></div><div class="actions"><button data-action="up" data-id="${n}" ${i===0?'disabled':''} aria-label="${c.name}を上へ">↑</button><button data-action="down" data-id="${n}" ${i===p.stops.length-1?'disabled':''} aria-label="${c.name}を下へ">↓</button><button data-action="remove" data-id="${n}" aria-label="${c.name}をプランから外す">×</button></div></li>`;}).join(''):'<li class="empty">まだ城が追加されていません。<br>上の検索から、最初の城を選びましょう。</li>';
  $('routeLinks').innerHTML=p?C.routes(p,castles).map(r=>`<a class="button primary" href="${escapeHTML(r.url)}" target="_blank" rel="noopener">↗ ${r.label}</a>`).join(''):'';
}
function renderStatistics() {
  const total=castles.filter(c=>visited(c.number)).length;$('headerCount').textContent=total;
  $('statSummary').innerHTML=[['訪問済みの城',castles],['100名城',castles.filter(c=>c.series==='100名城')],['続100名城',castles.filter(c=>c.series==='続100名城')]].map(([name,list])=>{const n=list.filter(c=>visited(c.number)).length;return `<div class="card"><h3>${name}</h3><div class="stat-number">${n} <small>/ ${list.length} 城</small></div><div class="progress"><div style="width:${n/list.length*100}%"></div></div></div>`;}).join('');
  $('regionalProgress').innerHTML='<h3>地域別の訪問状況</h3>'+[...new Set(castles.map(c=>c.region))].map(region=>{const list=castles.filter(c=>c.region===region),n=list.filter(c=>visited(c.number)).length;return `<div class="region"><div class="row"><span>${region}</span><strong>${n} / ${list.length}</strong></div><div class="progress"><div style="width:${n/list.length*100}%"></div></div></div>`;}).join('');
}
function render(){renderPlan();renderBook();renderStatistics();renderMap();}
function renderCandidates(){
  const query=$('planInput').value,found=C.candidates(castles,query);
  $('planCandidates').innerHTML=!query.trim()?'':found.length?found.map(c=>`<button data-action="add" data-id="${c.number}" ${currentPlan()?.stops.includes(c.number)?'disabled':''}><span>${c.number}. ${c.name} <small>${c.prefecture}</small></span><span>${currentPlan()?.stops.includes(c.number)?'追加済み':'＋ 追加'}</span></button>`).join(''):'<p class="notice">候補がありません。城名・都道府県・番号で検索してください。</p>';
}
async function newPlan(){const key='p-'+crypto.randomUUID();await transaction(s=>{s.plans[key]={name:'新しいドライブプラン',date:'',origin:'',stops:[],deleted:false,s:C.nextStamp(s,device)};});activePlan=key;detailsDirty=false;render();return key;}
async function addCastle(n){
  if(!byId.has(n))return;if(!currentPlan())await newPlan();const key=activePlan;
  if(currentPlan().stops.includes(n)){toast('この城は追加済みです。');return;}
  await transaction(s=>{const p=s.plans[key];if(!p||p.deleted)throw Error('プランが変更されました。選び直してください。');if(!p.stops.includes(n))p.stops.push(n);p.s=C.nextStamp(s,device);});renderCandidates();toast(`${byId.get(n).name}を「${state.plans[key].name}」に追加しました。`);
}
async function changeStop(n,action){const key=activePlan;await transaction(s=>{const p=s.plans[key];if(!p||p.deleted)throw Error('プランを選び直してください。');const i=p.stops.indexOf(n);if(i<0)return;if(action==='remove')p.stops.splice(i,1);else{const to=i+(action==='up'?-1:1);if(to>=0&&to<p.stops.length)[p.stops[i],p.stops[to]]=[p.stops[to],p.stops[i]];}p.s=C.nextStamp(s,device);});renderCandidates();}
function showVisit(n){const c=byId.get(n);if(!c)return;$('visitId').value=n;$('visitTitle').textContent=c.name;$('visitInfo').textContent=`${c.prefecture} · ${c.series} 第${c.number}番`;
  const raw=visited(n), date=raw?.replace(/\//g,'-').split('-').map((x,i)=>i?x.padStart(2,'0'):x).join('-');
  $('visitDate').value=date&&/^\d{4}-\d{2}-\d{2}$/.test(date)?date:today();$('cancelVisit').hidden=!raw;$('visitDialog').showModal();}
function showCastle(n){switchTab('map');$('mapFilter').value='all';renderMap();const c=byId.get(n);map?.setView([c.lat,c.lng],12);markers.get(n)?.openPopup();}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function exportBackup(){if(!writable){download(`訪城記_復旧用原本_${today()}.json`,{current:localStorage.getItem(C.KEY),legacy:localStorage.getItem(C.LEGACY),visited:localStorage.getItem('visited'),travelPlan:localStorage.getItem('travelPlan')});return;}download(`訪城記_バックアップ_${today()}.json`,{format:'castle-tracker-backup',exportedAt:new Date().toISOString(),state});}
function syncUI(message){
  const configured=cloud?.configured, logged=Boolean(cloud?.session);
  $('loginForm').hidden=!configured||logged;$('accountControls').hidden=!configured||!logged;
  $('cloudNotice').textContent=!configured?'クラウド同期は接続設定待ちです。現在はこの端末に保存しています。':logged?'この端末の記録をアカウントに同期します。もう一方の端末も同じアカウントでログインしてください。':'PCとスマホの両方で同じアカウントにログインしてください。初回は双方の既存記録を統合します。';
  $('accountEmail').textContent=cloud?.session?.user?.email||'';
  if(message)$('syncStatus').textContent=message;else if(!configured)$('syncStatus').textContent='クラウド同期：接続設定待ち';else if(!logged)$('syncStatus').textContent='クラウド同期：未ログイン';
}
function scheduleSync(){clearTimeout(syncTimer);if(busy){syncAgain=true;return;}if(cloud?.configured&&cloud.session&&writable)syncTimer=setTimeout(()=>syncNow(),1000);}
async function syncNow(){
  if(!cloud?.configured||!cloud.session)return;if(busy){syncAgain=true;return;}if(!navigator.onLine){syncUI('オフライン · 端末に保存、接続後に同期');return;}
  busy=true;$('syncNow').disabled=true;const user=cloud.session.user.id;
  try{
    if(state.owner&&state.owner!==user)throw Error('この記録は別アカウントに紐づいています。元のアカウントでログインしてください。');
    if(!state.owner)await transaction(s=>{if(s.owner&&s.owner!==user)throw Error('アカウントが変わりました。');if(!localStorage.getItem('castleTracker.beforeFirstSync'))localStorage.setItem('castleTracker.beforeFirstSync',JSON.stringify(s));s.owner=user;},false);
    syncUI('同期しています…');const sent=C.clone(state);
    const exchange=async()=>{cloud.session=JSON.parse(localStorage.getItem(cloud.sessionKey)||'null');if(cloud.session?.user.id!==user)throw Error('ログイン状態が変わりました。');return cloud.exchange(sent);};
    const remote=C.validate(await (navigator.locks?navigator.locks.request('castle-tracker-cloud',exchange):exchange()));
    if(cloud.session?.user.id!==user)throw Error('ログイン状態が変わったため同期を停止しました。');
    await transaction(s=>Object.assign(s,C.merge(s,remote)),false);
    const pending=JSON.stringify(remote)!==JSON.stringify(C.merge(remote,state));
    if(pending)syncAgain=true;
    syncUI(syncAgain?'端末に保存済み · 追加の変更を同期中':'同期済み · '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}));
  }catch(error){syncUI('同期未完了 · '+error.message);}
  finally{busy=false;$('syncNow').disabled=false;if(syncAgain){syncAgain=false;scheduleSync();}}
}
function events(){
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const n=Number(b.dataset.id),action=b.dataset.action;Promise.resolve().then(()=>{if(action==='visit')showVisit(n);if(action==='show')showCastle(n);if(action==='add')return addCastle(n);if(['up','down','remove'].includes(action))return changeStop(n,action);}).catch(fail);});
  for(const name of ['searchInput','filterSeries','filterVisited'])$(name).addEventListener(name==='searchInput'?'input':'change',renderBook);
  $('mapFilter').addEventListener('change',renderMap);
  $('planInput').addEventListener('input',renderCandidates);$('planSearch').addEventListener('submit',e=>{e.preventDefault();renderCandidates();});
  $('newPlan').addEventListener('click',()=>newPlan().then(()=>{$('planName').focus();$('planName').select();}).catch(fail));
  $('planSelect').addEventListener('change',()=>{activePlan=$('planSelect').value;detailsDirty=false;renderPlan();renderMap();renderCandidates();});
  $('planDetails').addEventListener('input',()=>detailsDirty=true);
  $('planDetails').addEventListener('submit',e=>{e.preventDefault();const key=activePlan,values={name:$('planName').value.trim()||'ドライブプラン',date:$('planDate').value,origin:$('planOrigin').value.trim()};transaction(s=>{const p=s.plans[key];if(!p||p.deleted)throw Error('プランを選び直してください。');Object.assign(p,values,{s:C.nextStamp(s,device)});}).then(()=>{detailsDirty=false;render();toast('プラン情報を保存しました。');}).catch(fail);});
  $('deletePlan').addEventListener('click',()=>{if(!currentPlan()||!confirm('このプランを削除しますか？ 直前の保存内容は「保存・同期」から取り出せます。'))return;const key=activePlan;transaction(s=>{s.plans[key].deleted=true;s.plans[key].s=C.nextStamp(s,device);}).then(()=>{detailsDirty=false;render();renderCandidates();}).catch(fail);});
  $('planToMap').addEventListener('click',()=>{switchTab('map');$('mapFilter').value='plan';renderMap();const points=currentPlan()?.stops.map(n=>[byId.get(n).lat,byId.get(n).lng]);if(points?.length)map?.fitBounds(points,{padding:[35,35],maxZoom:12});});
  $('closeVisit').addEventListener('click',()=>$('visitDialog').close());
  $('visitForm').addEventListener('submit',e=>{e.preventDefault();const n=$('visitId').value,date=$('visitDate').value;transaction(s=>s.visits[n]={date,s:C.nextStamp(s,device)}).then(()=>{$('visitDialog').close();toast('訪問記録を保存しました。地図・統計にも反映済みです。');}).catch(fail);});
  $('cancelVisit').addEventListener('click',()=>{if(!confirm('この城の訪問記録を取り消しますか？'))return;const n=$('visitId').value;transaction(s=>s.visits[n]={date:null,s:C.nextStamp(s,device)}).then(()=>$('visitDialog').close()).catch(fail);});
  $('exportBackup').addEventListener('click',exportBackup);
  $('exportLegacy').addEventListener('click',()=>{try{const raw=localStorage.getItem(C.LEGACY);download(`訪城記_移行前原本_${today()}.json`,raw?JSON.parse(raw):{visited:localStorage.getItem('visited'),travelPlan:localStorage.getItem('travelPlan')});}catch(e){fail(e);}});
  $('exportPrevious').addEventListener('click',()=>{try{const raw=localStorage.getItem(C.PREVIOUS);if(!raw)return toast('直前の保存内容はまだありません。');download(`訪城記_直前の記録_${today()}.json`,{format:'castle-tracker-backup',state:JSON.parse(raw)});}catch(e){fail(e);}});
  $('importBackup').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5000000)throw Error('5MB以下のバックアップを選んでください。');const imported=C.importBackup(JSON.parse(await file.text()),device);if(!confirm('バックアップを現在の記録に追加します。既存の城・プランは残し、バックアップの訪問済み記録とプランを追加します。よろしいですか？'))return;
    if(!writable){
      localStorage.setItem('castleTracker.recovery-'+Date.now(),JSON.stringify({current:localStorage.getItem(C.KEY),visited:localStorage.getItem('visited'),travelPlan:localStorage.getItem('travelPlan')}));
      state=C.save(localStorage,imported);writable=true;$('fatal').hidden=true;render();$('saveStatus').textContent='バックアップから復元済み';scheduleSync();
    }else await transaction(s=>{if(s.owner&&imported.owner&&s.owner!==imported.owner)throw Error('別アカウントのバックアップは復元できません。');for(const [n,v]of Object.entries(imported.visits)){if(v.date&&!s.visits[n]?.date)s.visits[n]={date:v.date,s:C.nextStamp(s,device)};}for(const p of Object.values(imported.plans)){if(p.deleted)continue;const same=Object.values(s.plans).some(q=>!q.deleted&&q.name===p.name&&q.date===p.date&&q.origin===p.origin&&JSON.stringify(q.stops)===JSON.stringify(p.stops));if(!same)s.plans['p-'+crypto.randomUUID()]={...p,s:C.nextStamp(s,device)};}});toast('バックアップの記録を追加しました。');
  }catch(error){fail(error);}finally{e.target.value='';}});
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginButton').disabled=true;try{const user=await cloud.signIn($('loginEmail').value.trim(),$('loginPassword').value);if(state.owner&&state.owner!==user.id){cloud.signOut();throw Error('以前と同じアカウントでログインしてください。既存記録は変更していません。');}syncUI();await syncNow();}catch(error){fail(error);}finally{$('loginPassword').value='';$('loginButton').disabled=false;}});
  $('signupButton').addEventListener('click',async()=>{if(!$('loginForm').reportValidity())return;const password=$('loginPassword').value;if(password.length<8)return toast('登録用パスワードは8文字以上にしてください。');$('signupButton').disabled=true;try{await cloud.signUp($('loginEmail').value.trim(),password);$('cloudNotice').textContent='確認メールを送信しました。メール内の「Confirm your mail」を開いたあと、この画面でログインしてください。届かない場合は迷惑メールも確認してください。';toast('メールを確認してからログインしてください。');}catch(error){fail(error);}finally{$('loginPassword').value='';$('signupButton').disabled=false;}});
  $('syncNow').addEventListener('click',syncNow);$('signOut').addEventListener('click',()=>{cloud.signOut();clearTimeout(syncTimer);syncUI();});
  $('locateBtn').addEventListener('click',()=>{if(!navigator.geolocation)return toast('この環境では位置情報が利用できません。');$('locateBtn').disabled=true;navigator.geolocation.getCurrentPosition(p=>{initializeMap();if(map){const pos=[p.coords.latitude,p.coords.longitude];if(userMarker)userMarker.setLatLng(pos);else userMarker=L.circleMarker(pos,{radius:8,color:'#fff',fillColor:'#287bd0',fillOpacity:1}).addTo(map).bindPopup('現在地');map.setView(pos,11);}$('locateBtn').disabled=false;},()=>{$('locateBtn').disabled=false;toast('現在地を取得できませんでした。位置情報の許可と通信を確認してください。');},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});});
  window.addEventListener('storage',e=>{if(e.key===C.KEY&&e.newValue){try{state=C.merge(state,C.validate(JSON.parse(e.newValue)));render();}catch(error){fail(error);}}});
  window.addEventListener('online',scheduleSync);window.addEventListener('offline',()=>syncUI('オフライン · この端末に保存'));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleSync();});
  setInterval(()=>{if(!document.hidden)scheduleSync();},30000);
}
function boot(){
  const emailConfirmed=location.hash.includes('access_token=');
  if(location.hash.includes('access_token=')||location.hash.includes('error='))history.replaceState(null,'',location.pathname+location.search);
  try{device=localStorage.getItem('castleTracker.device');if(!/^[a-zA-Z0-9_-]{1,80}$/.test(device||'')){device=crypto.randomUUID();localStorage.setItem('castleTracker.device',device);}state=C.load(localStorage,device);}
  catch(error){writable=false;state=C.blank();$('fatal').hidden=false;$('fatal').textContent='元の記録を保護するため編集を停止しました。保存データを読み込めません。「移行前の記録を保存」で控えを取得してください。ブラウザのサイトデータは削除しないでください。';$('saveStatus').textContent='読み込みエラー · 元データは保持';}
  try{cloud=new CastleSync(window.CASTLE_SYNC_CONFIG,localStorage);}catch(error){$('fatal').hidden=false;$('fatal').textContent=error.message;}
  events();render();initializeMap();syncUI();if(writable){$('saveStatus').textContent='この端末に保存済み';scheduleSync();}
  if(emailConfirmed){switchTab('settings');$('cloudNotice').textContent='メールの確認が完了しました。登録したメールアドレスとパスワードでログインしてください。';}
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});}).catch(()=>{});
}
boot();
