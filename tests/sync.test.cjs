const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('sync.js','utf8');

test('browser fetch retains Window receiver for registration, login, refresh and sync',async()=>{
  const context=vm.createContext({AbortSignal,Date,JSON,requests:[],storage:{getItem:()=>null,setItem:()=>{}}});
  vm.runInContext(`
    globalThis.fetch=async function(url,options){
      if(this!==globalThis) throw new TypeError('Illegal invocation');
      requests.push({url,options});
      const data=url.includes('/rpc/')?JSON.parse(options.body).incoming:
        {access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'test-user',email:'test@example.invalid'}};
      return {ok:true,json:async()=>data};
    };
  `,context);
  vm.runInContext(source,context);
  const client=vm.runInContext("new CastleSync({url:'https://example.supabase.co',publishableKey:'sb_publishable_test'},storage)",context);
  await client.signUp('test@example.invalid','test-only-password');
  await client.signIn('test@example.invalid','test-only-password');
  client.session.expires_at=0;
  assert.equal((await client.exchange({owner:'test-user',version:2})).owner,'test-user');
  assert.equal(context.requests.length,4);
  assert.match(context.requests[0].url,/\/signup\?redirect_to=/);
  assert.match(context.requests[1].url,/grant_type=password/);
  assert.match(context.requests[2].url,/grant_type=refresh_token/);
  assert.match(context.requests[3].url,/\/rpc\/merge_castle_state$/);
  assert.equal(context.requests[3].options.headers.Authorization,'Bearer test-token');
  for(const request of context.requests)assert.equal(request.options.cache,'no-store');
});
