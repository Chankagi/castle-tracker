/* Recovery is isolated from journal storage and never starts record synchronization. */
(function(root){
  'use strict';
  const SITE='https://chankagi.github.io/castle-tracker/';
  function recoveryToken(hash){const p=new URLSearchParams(hash.replace(/^#/,''));return p.get('type')==='recovery'?p.get('access_token'):null;}
  async function request(config,path,method,body,token,fetcher=root.fetch.bind(root)){
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config?.url||'')||!config.publishableKey?.startsWith('sb_publishable_'))throw Error('接続設定を確認してください。');
    const res=await fetcher(config.url.replace(/\/$/,'')+'/auth/v1/'+path,{method,headers:{apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    let data;try{data=await res.json();}catch{throw Error('通信を確認して、もう一度お試しください。');}
    if(!res.ok){
      if(res.status===429)throw Error('短時間に何度も送信されています。少し待ってからお試しください。');
      if(data.code==='same_password')throw Error('今までとは異なる新しいパスワードを入力してください。');
      if(data.code==='weak_password')throw Error('より長く、推測されにくいパスワードを入力してください。');
      if(res.status===401||res.status===403)throw Error('再設定リンクの有効期限が切れています。この画面を開き直して、メールを再送してください。');
      throw Error('手続きが完了しませんでした。通信を確認して、もう一度お試しください。');
    }
    return data;
  }
  async function boot(){
    const $=id=>document.getElementById(id),config=root.CASTLE_SYNC_CONFIG;
    let token=recoveryToken(location.hash);
    const hadError=new URLSearchParams(location.hash.slice(1)).has('error');
    if(location.hash)history.replaceState(null,'',location.pathname+location.search);
    const notice=message=>$('resetNotice').textContent=message;
    $('requestForm').addEventListener('submit',async e=>{e.preventDefault();$('requestButton').disabled=true;try{
      await request(config,'recover?redirect_to='+encodeURIComponent(SITE),'POST',{email:$('resetEmail').value.trim()});
      notice('このアドレスが登録されていれば、再設定メールが届きます。最新の「Reset Your Password」メール内のリンクを開いてください。迷惑メールも確認してください。');
    }catch(error){notice(error.message);}finally{$('requestButton').disabled=false;}});
    $('passwordForm').addEventListener('submit',async e=>{e.preventDefault();if(!token)return;
      if($('newPassword').value!==$('repeatPassword').value){notice('2つのパスワードが一致していません。');return;}
      $('savePassword').disabled=true;try{
        await request(config,'user','PUT',{password:$('newPassword').value},token);
        token=null;$('passwordForm').hidden=true;notice('パスワードを変更しました。下の「保存・同期へ戻る」から、同じメールアドレスと新しいパスワードでログインしてください。');
      }catch(error){notice(error.message);}finally{$('newPassword').value='';$('repeatPassword').value='';$('savePassword').disabled=false;}
    });
    if(hadError)notice('このリンクは使用済み、または有効期限切れです。メールアドレスを入力して、新しい再設定メールを送ってください。');
    if(token){$('requestForm').hidden=true;notice('再設定リンクを確認しています…');try{
      const user=await request(config,'user','GET',null,token);
      if(!user.id||!user.email)throw Error('アカウントを確認できませんでした。メールを再送してください。');
      $('resetAccount').textContent='変更するアカウント：'+user.email;
      $('passwordForm').hidden=false;notice('新しいパスワードを2回入力してください。');$('newPassword').focus();
    }catch(error){token=null;$('requestForm').hidden=false;notice(error.message);}}
  }
  if(typeof module==='object'&&module.exports)module.exports={request,recoveryToken};
  else boot();
})(globalThis);
