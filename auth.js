/* Google sign-in starts a revocable 30-day device session; the ID token is not stored in browser storage. */
(() => {
  'use strict';
  let token='',expires=0,waiters=[],validator,initializing=false,accessTransport,pendingToken='',pollTimer,checking=false,accountOutsideHandler,currentUser=null;
  function overlay() {
    let dialog=document.getElementById('reportLogin');if(dialog)return dialog;
    dialog=document.createElement('section');dialog.id='reportLogin';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','reportLoginTitle');
    dialog.style.cssText='position:fixed;inset:0;z-index:30000;background:#f8fafc;display:grid;place-items:center;padding:20px;font:15px/1.6 Inter,system-ui;color:#0f172a';
    const card=document.createElement('div');card.style.cssText='width:min(100%,420px);padding:28px;background:white;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 24px #0f172a0d;text-align:center';
    card.innerHTML='<h1 id="reportLoginTitle" style="font-size:20px;margin:0 0 12px">NTIC 報告記録</h1><p id="reportLoginIntro">Googleアカウントでログインしてください。初めての方はログイン後にアクセスを申請できます。<br>Sign in with Google. New users can request access after signing in.</p><div id="reportGoogleButton" style="display:flex;justify-content:center;min-height:44px"></div><div id="reportLoginStatus" style="min-height:28px;margin:10px 0;display:flex;align-items:center;justify-content:center;gap:9px;color:#64748b"><span id="reportLoginSpinner" aria-hidden="true" hidden style="width:16px;height:16px;flex:0 0 16px;border:2px solid #cbd5e1;border-top-color:#14b8a6;border-radius:50%;animation:reportAuthSpin .8s linear infinite"></span><p id="reportLoginMessage" role="status" aria-live="polite" style="font-size:13px;margin:0"></p></div><div id="reportRequestAccessHost" style="display:flex;justify-content:center;min-height:0"></div><style>#reportRequestAccess:not([hidden]){display:block;width:min(100%,260px);min-height:46px;margin:10px auto 0;padding:10px 18px;border:0;border-radius:8px;background:#0f766e;color:#fff;font:600 14px/1.3 Inter,system-ui,sans-serif;box-shadow:0 2px 5px #0f172a1a;cursor:pointer;transition:background-color .15s,box-shadow .15s}#reportRequestAccess:not([hidden]):hover{background:#0d655e;box-shadow:0 3px 8px #0f172a24}#reportRequestAccess:not([hidden]):focus-visible{outline:3px solid #99f6e4;outline-offset:2px}#reportRequestAccess:disabled{opacity:.65;cursor:wait}@media(max-width:480px){#reportRequestAccess:not([hidden]){width:100%}}@keyframes reportAuthSpin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){#reportLoginSpinner{animation:none}}</style><button id="reportLoginReload" type="button" hidden style="min-height:44px;margin:0 0 12px;padding:8px 16px">再読み込み / Reload</button><br><a href="privacy.html" style="font-size:12px;color:#64748b">プライバシー / Privacy</a>';
    card.querySelector('#reportLoginReload').onclick=()=>location.reload();
    const request=document.createElement('button');request.id='reportRequestAccess';request.type='button';request.hidden=true;request.textContent='アクセス申請 / Request access';request.style.cssText='box-sizing:border-box';
    request.onclick=async()=>{request.disabled=true;message('申請を送信しています… / Sending your request…',false,true);try{const state=await accessTransport('requestReportAccess',[],pendingToken);showPending(state);if(state.notificationSent===false)message('申請は保存されましたが、管理者への通知を送信できませんでした。5分後にもう一度申請してください。 / Your request was saved, but the notification could not be sent. Try requesting again in 5 minutes.');}catch(error){message('アクセスを申請できませんでした。時間をおいて再度お試しいただくか、管理者にお問い合わせください。 / Could not request access. Try again later or contact the administrator.',true);}finally{request.disabled=false;}};
    card.querySelector('#reportRequestAccessHost').append(request);
    dialog.append(card);document.body.append(dialog);return dialog;
  }
  function message(text,retry=false,loading=false){const box=overlay();box.querySelector('#reportLoginMessage').textContent=text;box.querySelector('#reportLoginSpinner').hidden=!loading;box.querySelector('#reportLoginStatus').style.visibility=text?'visible':'hidden';const intro=box.querySelector('#reportLoginIntro');if(loading)intro.hidden=true;else if(!pendingToken)intro.hidden=false;const googleButton=box.querySelector('#reportGoogleButton');googleButton.style.visibility=loading?'hidden':'visible';box.querySelector('#reportLoginReload').hidden=!retry;}
  function lock(){token='';expires=0;pendingToken='';clearTimeout(pollTimer);document.getElementById('reportAccountMenu')?.remove();if(accountOutsideHandler){document.removeEventListener('click',accountOutsideHandler);accountOutsideHandler=null;}document.getElementById('reportAccessAdminButton')?.remove();document.getElementById('reportAccessPanel')?.remove();const box=overlay();box.querySelector('#reportRequestAccess').hidden=true;box.hidden=false;box.style.display='grid';document.querySelector('.container')?.setAttribute('inert','');}
  function clearSavedSession(){try{localStorage.removeItem('nticReportSession');}catch(_){}}
  function finishSignIn(user,sessionToken,expiresAt){
    currentUser=user;token=sessionToken;expires=Number(expiresAt)||0;
    try{localStorage.setItem('nticReportSession',sessionToken);}catch(_){}
    pendingToken='';clearTimeout(pollTimer);overlay().querySelector('#reportRequestAccess').hidden=true;
    const box=overlay();box.hidden=true;box.style.display='none';document.querySelector('.container')?.removeAttribute('inert');
    for(const job of waiters.splice(0))job.resolve(token);
    document.getElementById('singleInput')?.focus();
    window.dispatchEvent(new CustomEvent('report-login',{detail:{email:user.email,role:user.role}}));
    accountMenu(user);
  }
  function showPending(user){
    const request=overlay().querySelector('#reportRequestAccess');request.hidden=user.status!=='none';
    const googleButton=overlay().querySelector('#reportGoogleButton');if(googleButton)googleButton.hidden=user.status==='pending';
    message(user.status==='rejected'?'アクセスは許可されていません。管理者にお問い合わせください。 / Access has not been granted. Please contact the administrator.':user.status==='pending'?'管理者の承認を待っています。承認後、自動的にアプリが開きます。 / Awaiting administrator approval. The app will open automatically once approved.':user.email+' のアクセスはまだ許可されていません。「アクセス申請」を押してください。 / This account is not yet authorized. Select Request access to contact the administrator.');
    clearTimeout(pollTimer);if(user.status==='pending')pollTimer=setTimeout(checkPending,20000);
  }
  async function checkPending(){
    if(!pendingToken||checking)return;
    if(document.hidden){pollTimer=setTimeout(checkPending,20000);return;}
    checking=true;
    try{await credential({credential:pendingToken});}finally{checking=false;}
  }
  async function credential(response){
    message('ログインを確認しています… / Verifying your account…',false,true);
    try{
      const user=await validator(response.credential);
      if(user.role==='pending'){token='';expires=0;pendingToken=response.credential;showPending(user);return;}
      if(!user.sessionToken||!user.expiresAt)throw new Error('SESSION_CREATE_FAILED');
      finishSignIn(user,user.sessionToken,user.expiresAt);
    }catch(error){token='';expires=0;clearTimeout(pollTimer);overlay().querySelector('#reportRequestAccess').hidden=true;message('ログインを確認できませんでした。再読み込みして、もう一度ログインしてください。 / Could not verify your sign-in. Reload and sign in again.',true);}
  }
  function accountMenu(user){
    document.getElementById('reportAccountMenu')?.remove();
    const host=document.querySelector('.header-card');if(!host)return;
    const wrap=document.createElement('div');wrap.id='reportAccountMenu';wrap.style.cssText='position:relative;flex:0 0 auto;z-index:10';
    const trigger=document.createElement('button');trigger.type='button';trigger.id='reportAccountMenuButton';trigger.className='report-account-trigger';trigger.setAttribute('aria-haspopup','true');trigger.setAttribute('aria-expanded','false');
    trigger.textContent=String(user.initials||'').slice(0,4)||'•';trigger.setAttribute('aria-label',(user.displayName||'Account')+' menu');
    trigger.style.cssText='display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:38px;height:38px;min-width:38px;padding:0;border:1px solid #64748b;border-radius:50%;background:#334155;color:#fff;font:700 13px/1 system-ui,sans-serif;letter-spacing:.2px;cursor:pointer;transition:background-color .15s,box-shadow .15s';
    trigger.addEventListener('mouseenter',()=>{trigger.style.backgroundColor='#475569';});trigger.addEventListener('mouseleave',()=>{trigger.style.backgroundColor='#334155';});
    trigger.addEventListener('focus',()=>{trigger.style.boxShadow='0 0 0 2px #94a3b8';});trigger.addEventListener('blur',()=>{trigger.style.boxShadow='none';});
    const menu=document.createElement('div');menu.hidden=true;menu.setAttribute('role','menu');menu.style.cssText='position:absolute;right:0;top:calc(100% + 8px);width:min(280px,calc(100vw - 32px));padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 28px #0002;color:#0f172a';
    function item(label,action){const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=label;button.style.cssText='display:block;width:100%;min-height:44px;text-align:left;padding:9px 12px;border:0;border-radius:8px;background:#fff;color:#0f172a;font:inherit;cursor:pointer';button.onmouseenter=()=>button.style.background='#f1f5f9';button.onmouseleave=()=>button.style.background='#fff';button.onclick=()=>{close();action();};menu.append(button);return button;}
    const adminMenuItem=user.role==='admin'?item(typeof currentLang!=='undefined'&&currentLang==='en'?'Users':'利用者',openAccessPanel):null;
    const logoutMenuItem=item(typeof currentLang!=='undefined'&&currentLang==='en'?'Log out':'ログアウト',()=>window.ReportAuth.signOut());
    function syncMenuLanguage(){const english=typeof currentLang!=='undefined'&&currentLang==='en';trigger.setAttribute('aria-label',(user.displayName||'Account')+' menu');if(adminMenuItem)adminMenuItem.textContent=english?'Users':'利用者';logoutMenuItem.textContent=english?'Log out':'ログアウト';}
    window.addEventListener('report-language-change',syncMenuLanguage);syncMenuLanguage();
    function close(){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(accountOutsideHandler){document.removeEventListener('click',accountOutsideHandler);accountOutsideHandler=null;}}
    trigger.onclick=()=>{const opening=menu.hidden;menu.hidden=!opening;trigger.setAttribute('aria-expanded',String(opening));if(opening){accountOutsideHandler=event=>{if(!wrap.contains(event.target))close();};setTimeout(()=>document.addEventListener('click',accountOutsideHandler),0);}};
    wrap.append(trigger,menu);const actions=document.getElementById('headerActions')||host;const languageButton=document.getElementById('langToggleBtn');if(languageButton&&languageButton.parentElement===actions)languageButton.after(wrap);else actions.append(wrap);
    if(user.role==='admin'&&new URL(location.href).searchParams.get('access')==='1')openAccessPanel();
  }
  async function openAccessPanel(){
    let panel=document.getElementById('reportAccessPanel');if(panel)return;
    const priorFocus=document.activeElement;
    panel=document.createElement('section');panel.id='reportAccessPanel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Pengguna dan permintaan akses');panel.style.cssText='position:fixed;inset:0;z-index:30001;background:#f8fafc;padding:20px;overflow:auto;font:16px/1.6 system-ui;color:#0f172a';
    const card=document.createElement('div');card.style.cssText='max-width:760px;margin:auto';
    const heading=document.createElement('h2');heading.textContent='Pengguna dan permintaan akses';
    const close=document.createElement('button');close.type='button';close.textContent='Tutup';close.style.cssText='min-height:44px;padding:8px 16px';close.onclick=()=>{panel.remove();priorFocus?.focus();};
    const reload=document.createElement('button');reload.type='button';reload.textContent='Muat ulang';reload.style.cssText='min-height:44px;margin:8px;padding:8px 16px';
    const status=document.createElement('p');status.setAttribute('role','status');const list=document.createElement('div');
    card.append(heading,close,reload,status,list);panel.append(card);document.body.append(panel);close.focus();
    panel.onkeydown=e=>{if(e.key==='Escape')close.click();if(e.key==='Tab'){const buttons=Array.from(panel.querySelectorAll('button:not(:disabled)'));const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
    async function refresh(){
      reload.disabled=true;status.textContent='Memuat…';
      try{
        const data=await accessTransport('listReportAccess',[],await window.ReportAuth.token());list.replaceChildren();
        function title(text){const h=document.createElement('h3');h.textContent=text;list.append(h);}
        function row(text){const box=document.createElement('div');box.style.cssText='padding:14px 0;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere';const p=document.createElement('p');p.style.margin='0 0 8px';p.textContent=text;box.append(p);list.append(box);return box;}
        function action(box,label,method,args,question){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='min-height:44px;padding:8px 16px;margin-right:8px';b.onclick=async()=>{if(question&&!confirm(question))return;box.querySelectorAll('button').forEach(x=>x.disabled=true);try{await accessTransport(method,args,await window.ReportAuth.token());await refresh();}catch(error){status.textContent=error.message;box.querySelectorAll('button').forEach(x=>x.disabled=false);}};box.append(b);}
        const requests=data.requests.filter(x=>x.status==='pending');title('Menunggu persetujuan ('+requests.length+')');
        if(!requests.length)row('Tidak ada permintaan baru.');
        for(const request of requests){const box=row((request.name?request.name+' — ':'')+request.email);action(box,'Izinkan','decideReportAccess',[request.email,request.id,'approve'],'Izinkan '+request.email+' membaca dan menggunakan laporan sebagai member?');action(box,'Tolak','decideReportAccess',[request.email,request.id,'reject']);}
        title('Sudah diizinkan');for(const user of data.users){
          const box=row(user.email+' · '+user.role),fields=document.createElement('div');fields.style.cssText='display:grid;grid-template-columns:minmax(150px,1fr) 90px auto;gap:8px;align-items:center;margin:8px 0';
          const name=document.createElement('input');name.type='text';name.maxLength=60;name.value=user.displayName||'';name.placeholder='Nama tampilan';name.setAttribute('aria-label','Nama tampilan');
          const initials=document.createElement('input');initials.type='text';initials.maxLength=4;initials.value=user.initials||'';initials.placeholder='Inisial';initials.setAttribute('aria-label','Inisial');
          [name,initials].forEach(input=>input.style.cssText='box-sizing:border-box;min-width:0;width:100%;min-height:42px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit');
          const save=document.createElement('button');save.type='button';save.textContent='Simpan nama';save.style.cssText='min-height:42px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer';
          save.onclick=async()=>{save.disabled=true;try{await accessTransport('updateReportUserProfile',[user.email,name.value,initials.value],await window.ReportAuth.token());if(currentUser&&currentUser.email===user.email){currentUser={...currentUser,displayName:name.value.trim(),initials:initials.value.trim()};const avatar=document.getElementById('reportAccountMenuButton');if(avatar){avatar.textContent=currentUser.initials||'•';avatar.setAttribute('aria-label',(currentUser.displayName||'Account')+' menu');}}await refresh();}catch(error){status.textContent=error.message;save.disabled=false;}};
          fields.append(name,initials,save);box.append(fields);
          if(user.role==='member')action(box,'Cabut akses','revokeReportAccess',[user.email],'Cabut akses '+user.email+'?');
        }
        status.textContent='Pengguna baru yang kamu izinkan mendapat akses member.';
      }catch(error){status.textContent=error.message;}finally{reload.disabled=false;}
    }
    reload.onclick=refresh;await refresh();
  }
  let restoreGeneration=0,restoreStartedAt=0,restoreDeadlineTimer=0,hiddenSince=0,resumeReloadPending=false,authStarted=false,authClientId='',validatorWaitTimer=0;
  function readSavedSession(){try{return localStorage.getItem('nticReportSession')||'';}catch(_){return '';}}
  function restoreSavedSession(id,force){
    const saved=readSavedSession();if(!saved)return loadGoogleSignIn(id);
    if(!validator){message('保存されたログインを確認しています… / Checking your saved sign-in…',false,true);return;}
    if(!force&&restoreStartedAt&&Date.now()-restoreStartedAt<12000)return;
    const attempt=++restoreGeneration;restoreStartedAt=Date.now();clearTimeout(restoreDeadlineTimer);
    restoreDeadlineTimer=setTimeout(()=>{
      if(attempt!==restoreGeneration)return;restoreStartedAt=0;restoreGeneration++;lock();loadGoogleSignIn(id);
      message('保存されたログインを確認できませんでした。接続を確認して、もう一度お試しください。 / Could not check the saved sign-in. Check the connection and try again.',true);
    },12000);
    Promise.resolve().then(()=>validator(saved,()=>{if(attempt===restoreGeneration)message('保存されたログインを確認しています… / Checking your saved sign-in…',false,true);})).then(function(user){
      if(attempt!==restoreGeneration)return;clearTimeout(restoreDeadlineTimer);restoreStartedAt=0;
      if(user&&user.sessionToken&&user.role!=='pending'){finishSignIn(user,user.sessionToken,user.expiresAt);return;}
      clearSavedSession();lock();loadGoogleSignIn(id);
    }).catch(function(error){
      if(attempt!==restoreGeneration)return;clearTimeout(restoreDeadlineTimer);restoreStartedAt=0;
      if(/AUTH_(?:INVALID|EXPIRED|REQUIRED)|ACCESS_DENIED/.test(String(error&&error.message||error))){clearSavedSession();lock();loadGoogleSignIn(id);return;}
      lock();loadGoogleSignIn(id);
      message('Sesi tersimpan belum dapat diperiksa. Periksa koneksi, lalu coba masuk lagi. / Could not check the saved session. Check the connection and sign in again.',true);
    });
  }
  function resumeSessionCheck(){
    if(document.hidden||token&&expires>Date.now()+30000)return;
    const box=document.getElementById('reportLogin');if(box&&box.hidden)return;
    if(!readSavedSession()||resumeReloadPending)return;
    resumeReloadPending=true;
    location.reload();
  }
  function initialize(){
    authStarted=true;lock();
    authClientId=window.REPORT_CONFIG?.googleClientId||'';
    if(!authClientId){message('Googleログインはまだ設定されていません。管理者にお問い合わせください。 / Google sign-in is not configured. Please contact the administrator.',true);return;}
    if(readSavedSession()){
      if(validator)restoreSavedSession(authClientId,false);
      else{
        message('保存されたログインを確認しています… / Checking your saved sign-in…',false,true);
        clearTimeout(validatorWaitTimer);validatorWaitTimer=setTimeout(()=>{
          if(validator||!readSavedSession())return;lock();loadGoogleSignIn(authClientId);
          message('保存されたログインを確認できませんでした。もう一度お試しください。 / Could not check the saved sign-in. Please try again.',true);
        },8000);
      }
      return;
    }
    loadGoogleSignIn(authClientId);
  }
  function loadGoogleSignIn(id){
    if(initializing)return;message('',false,false);initializing=true;
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
    script.onerror=()=>{initializing=false;message('Googleログインを読み込めませんでした。再読み込みしてください。 / Could not load Google sign-in. Please reload the page.',true);};
    script.onload=()=>{
      google.accounts.id.initialize({client_id:id,callback:credential,auto_select:true,ux_mode:'popup',itp_support:true,use_fedcm_for_button:true,button_auto_select:true});
      google.accounts.id.renderButton(document.getElementById('reportGoogleButton'),{theme:'outline',size:'medium',text:'signin_with',shape:'rectangular',width:200});
      google.accounts.id.prompt();
    };document.head.append(script);
  }
  window.ReportAuth={
    setValidator(fn){validator=fn;if(validator){clearTimeout(validatorWaitTimer);if(authStarted&&readSavedSession()&&authClientId&&!token)restoreSavedSession(authClientId,false);}},
    setAccessTransport(fn){accessTransport=fn;},
    token(){
      if(token&&expires>Date.now()+30000)return Promise.resolve(token);
      const pending=new Promise((resolve,reject)=>waiters.push({resolve,reject}));
      const saved=readSavedSession();
      if(saved){
        if(validator&&authClientId)restoreSavedSession(authClientId,false);
        else if(!authStarted)initialize();
        return pending;
      }
      lock();if(authClientId)loadGoogleSignIn(authClientId);
      return pending;
    },
    invalidate(){clearSavedSession();lock();message('ログインし直してください。 / Please sign in again.');},
    async signOut(){const previous=token;try{if(previous&&accessTransport)await accessTransport('logoutReportSession',[],previous);}catch(_){}clearSavedSession();google.accounts?.id?.disableAutoSelect();lock();location.reload();}
  };
  window.addEventListener('pageshow',event=>{if(event.persisted)resumeSessionCheck();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){hiddenSince=Date.now();return;}
    if(hiddenSince){hiddenSince=0;resumeSessionCheck();}
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
