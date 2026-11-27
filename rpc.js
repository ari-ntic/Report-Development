/*
 * Preserve the existing google.script.run call sites on GitHub Pages.
 * Google executes server functions in its own HTML Service frame. Messages are
 * bound to one random channel, one approved origin, and one pinned frame source.
 * No automatic write retries: existing submission/operation IDs remain in charge.
 */
(() => {
  'use strict';
  const config = window.REPORT_CONFIG;
  const allowed = new Set(config?.methods || []);
  const pending = new Map();
  const channel = crypto.randomUUID().replaceAll('-', '');
  let frame, peer, peerOrigin, connectTimer, connecting, resolveReady, rejectReady;
  let nextId = 0;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});

  function notice(message) {
    if (!document.body) return;
    let box = document.getElementById('reportConnectionNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'reportConnectionNotice';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:20000;padding:12px 16px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#78350f;font:14px/1.5 system-ui;box-shadow:0 2px 12px #0002';
      document.body.append(box);
    }
    box.replaceChildren(document.createTextNode(message+' '));
    const reload = document.createElement('button');
    reload.type = 'button'; reload.textContent = '再読み込み / Reload';
    reload.style.cssText = 'margin-left:8px;min-height:40px;padding:6px 12px';
    reload.onclick = () => location.reload();
    const old = document.createElement('a');
    old.href = config.endpoint; old.textContent = '元のアプリ / Original app';
    old.target = '_blank'; old.rel = 'noopener'; old.style.marginLeft = '12px';
    box.append(reload, old);
  }
  function connect() {
    if (connecting) return;
    connecting = true;
    try {
      const url = new URL(config.endpoint);
      if (url.origin !== 'https://script.google.com' || !url.pathname.endsWith('/exec')) throw Error('Invalid report endpoint');
      url.searchParams.set('page', 'github-bridge');
      url.searchParams.set('channel', channel);
      url.searchParams.set('origin', location.origin);
      frame = document.createElement('iframe');
      frame.title = 'Google Sheets and Drive connection';
      frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none';
      frame.src = url.href;
      document.body.append(frame);
      connectTimer = setTimeout(() => {
        const error = Error('Google 接続を確認できません。再読み込みしてください。 / Could not connect to Google. Reload to try again.');
        rejectReady(error); notice(error.message);
      }, config.connectTimeoutMs);
    } catch (error) { rejectReady(error); notice(error.message); }
  }
  window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg || msg.channel !== channel || msg.protocol !== 'ntic-report-v1') return;
    if (msg.type === 'ready') {
      if (peer || !event.source || !new RegExp('^https://[a-z0-9-]+-script\\.googleusercontent\\.com$').test(event.origin)) return;
      if (msg.version !== config.version) { rejectReady(Error('Report connection version mismatch')); return; }
      peer = event.source; peerOrigin = event.origin; clearTimeout(connectTimer);
      document.getElementById('reportConnectionNotice')?.remove(); resolveReady(); return;
    }
    if (event.source !== peer || event.origin !== peerOrigin || msg.type !== 'result') return;
    const job = pending.get(msg.id); if (!job) return;
    clearTimeout(job.timer); pending.delete(msg.id);
    if (msg.ok) job.resolve(msg.result);
    else job.reject(Object.assign(Error(msg.error?.message || 'Report request failed'), {code:msg.error?.code}));
  });
  async function transport(method, args, token, onSent) {
    if (!allowed.has(method)) throw Error('Unsupported report function: '+method);
    if (document.readyState === 'loading') await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    connect();
    await ready;
    return new Promise((resolve, reject) => {
      const id = channel+'_'+(++nextId);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('結果を確認できませんでした。送信内容を保持してから再試行してください。 / Result not confirmed. Keep your draft and retry.'));
      }, config.requestTimeoutMs);
      pending.set(id, {resolve,reject,timer});
      try {
        peer.postMessage({protocol:'ntic-report-v1',type:'call',channel,id,method,args,token},peerOrigin);
        if (typeof onSent === 'function') onSent();
      } catch (error) { clearTimeout(timer);pending.delete(id);reject(error); }
    });
  }
  window.ReportAuth.setValidator((token,onSent)=>transport('getReportSession',[],token,onSent));
  window.ReportAuth.setAccessTransport?.((method,args,token)=>transport(method,args,token));
  async function invoke(method,args){
    const token=await window.ReportAuth.token();
    try{return await transport(method,args,token);}
    catch(error){if(/AUTH_(?:INVALID|EXPIRED|REQUIRED)/.test(error.message))window.ReportAuth.invalidate();throw error;}
  }
  function runner(success, failure, userObject) {
    return new Proxy(Object.create(null), {get(_target, method) {
      if (method === 'withSuccessHandler') return fn => runner(fn,failure,userObject);
      if (method === 'withFailureHandler') return fn => runner(success,fn,userObject);
      if (method === 'withUserObject') return value => runner(success,failure,value);
      if (typeof method !== 'string' || method === 'then') return undefined;
      return (...args) => {
        invoke(method,args).then(result => { if(typeof success === 'function')success(result,userObject); }, error => {
          if(typeof failure === 'function')failure(error,userObject);else console.error(error);
        });
      };
    }});
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runner();
  window.addEventListener('pagehide', () => {
    for (const job of pending.values()) { clearTimeout(job.timer);job.reject(Error('Page closed; result unconfirmed')); }
    pending.clear();
  });
  // Do not even load the Google backend iframe before a login credential exists.
  // This also prevents an older unmodified deployment from loading data invisibly.
})();
