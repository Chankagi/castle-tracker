const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {request,recoveryToken}=require('../reset.js');
const config={url:'https://example.supabase.co',publishableKey:'sb_publishable_test'};
test('only password recovery fragments are accepted',()=>{
  assert.equal(recoveryToken('#access_token=abc&type=recovery'),'abc');
  assert.equal(recoveryToken('#access_token=abc&type=signup'),null);
  assert.equal(recoveryToken('#error=expired'),null);
});
test('password update uses authenticated PUT, with no caching',async()=>{
  let sent;await request(config,'user','PUT',{password:'test-new-password'},'test-token',async(url,options)=>{sent={url,options};return{ok:true,json:async()=>({id:'test'})};});
  assert.equal(sent.url,'https://example.supabase.co/auth/v1/user');
  assert.equal(sent.options.method,'PUT');assert.equal(sent.options.headers.Authorization,'Bearer test-token');
  assert.equal(sent.options.cache,'no-store');assert.equal(sent.options.referrerPolicy,'no-referrer');
});
test('expired recovery and throttling produce actionable messages',async()=>{
  for(const [status,pattern] of [[401,/有効期限/],[429,/少し待って/]])await assert.rejects(request(config,'user','GET',null,'test',async()=>({ok:false,status,json:async()=>({})})),pattern);
});
test('recovery UI clears URL, verifies user, handles mismatch, then updates without touching storage',async()=>{
  const nodes={},calls=[],history=[],listeners={};
  const get=id=>nodes[id]||=( {value:'',hidden:false,textContent:'',focus(){},addEventListener(event,fn){listeners[id+':'+event]=fn;}} );
  const context={URLSearchParams,AbortSignal,CASTLE_SYNC_CONFIG:config,location:{hash:'#access_token=test&type=recovery',pathname:'/reset.html',search:''},history:{replaceState:(_a,_b,url)=>history.push(url)},document:{getElementById:get},localStorage:{setItem(){throw Error('Must not write journal or session');},getItem(){throw Error('Must not read journal');}},fetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({id:'test-user',email:'test@example.invalid'})};}};
  vm.runInNewContext(fs.readFileSync('reset.js','utf8'),context);
  await new Promise(setImmediate);
  assert.deepEqual(history,['/reset.html']);assert.equal(get('passwordForm').hidden,false);assert.match(get('resetAccount').textContent,/test@example.invalid/);
  get('newPassword').value='new-test-password';get('repeatPassword').value='different';
  await listeners['passwordForm:submit']({preventDefault(){}});assert.equal(calls.length,1);
  get('repeatPassword').value='new-test-password';await listeners['passwordForm:submit']({preventDefault(){}});
  assert.equal(calls.length,2);assert.equal(calls[1].options.method,'PUT');assert.equal(get('passwordForm').hidden,true);assert.equal(get('newPassword').value,'');assert.match(get('resetNotice').textContent,/変更しました/);
});
test('main recovery callback leaves before loading or syncing existing records',()=>{
  let target;const source=fs.readFileSync('app.js','utf8').slice(fs.readFileSync('app.js','utf8').indexOf('function boot(){'));
  vm.runInNewContext(source,{URLSearchParams,location:{hash:'#type=recovery&access_token=test',replace:url=>target=url}});
  assert.equal(target,'./reset.html#type=recovery&access_token=test');
});
