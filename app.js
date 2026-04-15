  const BASE = 'https://paper-api.alpaca.markets/v2';
  const DATA = 'https://data.alpaca.markets/v2';
  let state = { key:'', secret:'', account:null, positions:[], orders:[], tab:'portfolio', side:'buy', orderType:'market' };
  let assetCache = null;
  let suggestTimer = null;

  // ── Formatting ──────────────────────────────────────────────────────────────
  const usd = v => v == null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
  const plu = v => { const n=parseFloat(v); if(isNaN(n)) return '—'; return (n>=0?'+':'')+usd(n); };
  const pct = v => { const n=parseFloat(v)*100; return (n>=0?'+':'')+n.toFixed(2)+'%'; };
  const plClass = v => parseFloat(v)>=0?'green':'red';
  const plArrow = v => parseFloat(v)>=0?'▲':'▼';
  const num = v => v!=null?Number(v).toLocaleString():'—';

  function orderStatusClass(s){
    if(s==='filled') return 'badge-filled';
    if(s==='canceled'||s==='expired') return 'badge-canceled';
    if(s==='partially_filled') return 'badge-partial';
    return 'badge-pending';
  }

  // ── API ──────────────────────────────────────────────────────────────────────
  async function api(path, opts={}) {
    const url = path.startsWith('http') ? path : BASE+path;
    const r = await fetch(url, { ...opts, headers: { 'APCA-API-KEY-ID':state.key, 'APCA-API-SECRET-KEY':state.secret, 'Content-Type':'application/json', ...(opts.headers||{}) }});
    if(!r.ok){ const t=await r.json().catch(()=>({message:'Error '+r.status})); throw new Error(t.message||'Error '+r.status); }
    return r.json();
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────
  async function doLogin() {
    const key = document.getElementById('inp-key').value.trim();
    const secret = document.getElementById('inp-secret').value.trim();
    if(!key||!secret){ showLoginError('Both fields are required.'); return; }
    setLoginLoading(true);
    try {
      const acct = await fetch(BASE+'/account',{headers:{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret}}).then(r=>{ if(!r.ok) throw new Error('Invalid credentials.'); return r.json(); });
      state.key=key; state.secret=secret; state.account=acct;
      localStorage.setItem('alpaca_key',key);
      localStorage.setItem('alpaca_secret',secret);
      showApp();
      fetchAll();
    } catch(e){ showLoginError(e.message); }
    finally{ setLoginLoading(false); }
  }

  function doLogout(){
    localStorage.removeItem('alpaca_key'); localStorage.removeItem('alpaca_secret');
    state={key:'',secret:'',account:null,positions:[],orders:[],tab:'portfolio',side:'buy',orderType:'market'};
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login').style.display='flex';
    document.getElementById('inp-key').value='';
    document.getElementById('inp-secret').value='';
  }

  function showLoginError(msg){ const el=document.getElementById('login-error'); el.textContent=msg; el.classList.remove('hidden'); }
  function setLoginLoading(v){ document.getElementById('login-btn').disabled=v; document.getElementById('login-btn-text').textContent=v?'Connecting…':'Connect Account'; document.getElementById('login-spinner').classList.toggle('hidden',!v); document.getElementById('login-error').classList.add('hidden'); }

  function showApp(){
    document.getElementById('login').style.display='none';
    document.getElementById('app').classList.remove('hidden');
  }

  // ── Fetch Data ───────────────────────────────────────────────────────────────
  async function fetchAll(){
    if(!state.key) return;
    document.getElementById('header-spinner').classList.remove('hidden');
    try {
      const [acct,pos,ord] = await Promise.all([
        api('/account'),
        api('/positions'),
        api('/orders?status=all&limit=20&direction=desc')
      ]);
      state.account=acct;
      state.positions=Array.isArray(pos)?pos:[];
      state.orders=Array.isArray(ord)?ord:[];
      renderPortfolio(); renderOrders();
      renderAccount();
    } catch(e){ console.warn(e); }
    finally{ document.getElementById('header-spinner').classList.add('hidden'); }
  }

  // ── Portfolio Render ─────────────────────────────────────────────────────────
  function renderPortfolio(){
    const a=state.account; if(!a) return;
    document.getElementById('p-equity').textContent = usd(a.portfolio_value);
    const pl=parseFloat(a.unrealized_intraday_pl||0), plp=parseFloat(a.unrealized_intraday_plpc||0);
    const plEl=document.getElementById('p-daypl');
    plEl.className='hero-pl '+(pl>=0?'green':'red');
    plEl.innerHTML=`<span>${pl>=0?'▲':'▼'}</span><span>${usd(Math.abs(pl))}</span><span style="font-weight:400;font-size:12px;opacity:.7">(${pct(plp)}) today</span>`;
    document.getElementById('p-bp').textContent=usd(a.buying_power);
    document.getElementById('p-cash').textContent=usd(a.cash);
    document.getElementById('p-pos-label').textContent=`Positions (${state.positions.length})`;
    const box=document.getElementById('p-positions');
    if(!state.positions.length){
      box.innerHTML='<div class="empty"><div class="empty-icon">📭</div>No open positions<br><span style="font-size:11px;color:#374151;margin-top:4px;display:block">Head to Trade to buy your first stock</span></div>';
      return;
    }
    box.innerHTML=state.positions.map(p=>{
      const pl=parseFloat(p.unrealized_pl), plp=parseFloat(p.unrealized_plpc);
      return `<div class="pos-card" style="margin-bottom:8px" onclick="goTrade('${p.symbol}')">
        <div class="pos-row">
          <div><div class="pos-symbol">${p.symbol}</div><div class="pos-detail">${p.qty} shares · avg ${usd(p.avg_entry_price)}</div></div>
          <div><div class="pos-value">${usd(p.market_value)}</div><div class="${plClass(pl)}" style="font-size:12px;font-weight:700;text-align:right">${plu(pl)} (${pct(plp)})</div></div>
        </div>
        <div class="pos-footer">
          <span>Current: <span style="color:#9ca3af">${usd(p.current_price)}</span></span>
          <span>Cost: <span style="color:#9ca3af">${usd(p.cost_basis)}</span></span>
        </div>
      </div>`;
    }).join('');
  }

  // ── Trade ────────────────────────────────────────────────────────────────────
  function setSide(s){
    state.side=s;
    document.getElementById('btn-buy').classList.toggle('active',s==='buy');
    document.getElementById('btn-sell').classList.toggle('active',s==='sell');
    updateTradeBtn();
  }
  function setOrderType(t){
    state.orderType=t;
    document.getElementById('pill-market').classList.toggle('active',t==='market');
    document.getElementById('pill-limit').classList.toggle('active',t==='limit');
    document.getElementById('limit-field').classList.toggle('hidden',t!=='limit');
  }
  function updateTradeBtn(){
    const sym=document.getElementById('t-symbol').value.toUpperCase()||'—';
    const btn=document.getElementById('trade-btn');
    btn.className='btn '+(state.side==='buy'?'btn-green':'btn-red');
    document.getElementById('trade-btn-text').textContent=`${state.side.toUpperCase()} ${sym}`;
  }
  document.getElementById('t-symbol').addEventListener('input',updateTradeBtn);

  async function placeOrder(){
    const sym=document.getElementById('t-symbol').value.trim().toUpperCase();
    const qty=parseInt(document.getElementById('t-qty').value);
    const lp=parseFloat(document.getElementById('t-limit').value);
    document.getElementById('trade-success').classList.add('hidden');
    document.getElementById('trade-error').classList.add('hidden');
    if(!sym||!qty){ showTradeMsg('error','Symbol and shares are required.'); return; }
    if(state.orderType==='limit'&&!lp){ showTradeMsg('error','Limit price is required.'); return; }
    setTradeLoading(true);
    try {
      const body={symbol:sym,qty,side:state.side,type:state.orderType,time_in_force:'day'};
      if(state.orderType==='limit') body.limit_price=lp;
      const o=await api('/orders',{method:'POST',body:JSON.stringify(body)});
      showTradeMsg('success',`✅ ${state.side.toUpperCase()} order placed — ${o.qty} ${o.symbol}`);
      document.getElementById('t-qty').value='';
      document.getElementById('t-limit').value='';
      fetchAll();
    } catch(e){ showTradeMsg('error',e.message); }
    finally{ setTradeLoading(false); }
  }
  function showTradeMsg(type,msg){ const el=document.getElementById(type==='success'?'trade-success':'trade-error'); el.textContent=msg; el.classList.remove('hidden'); }
  function setTradeLoading(v){ document.getElementById('trade-btn').disabled=v; document.getElementById('trade-spinner').classList.toggle('hidden',!v); document.getElementById('trade-btn-text').classList.toggle('hidden',v); }

  async function cancelOrder(id){ try{ await api('/orders/'+id,{method:'DELETE'}); fetchAll(); }catch(e){} }

  function renderOrders(){
    const box=document.getElementById('orders-list');
    document.getElementById('orders-label').textContent=`Recent Orders (${state.orders.length})`;
    if(!state.orders.length){ box.innerHTML='<div class="empty">No orders yet</div>'; return; }
    box.innerHTML=state.orders.slice(0,10).map(o=>{
      const canCancel=['new','accepted','pending_new'].includes(o.status);
      return `<div class="order-item" style="margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="order-badge ${o.side==='buy'?'badge-buy':'badge-sell'}">${o.side.toUpperCase()}</span>
          <div>
            <span style="color:#fff;font-weight:800;font-size:14px">${o.symbol}</span>
            <span class="muted" style="font-size:12px;margin-left:6px">${o.qty} sh</span>
            ${o.limit_price?`<span style="color:#374151;font-size:11px;margin-left:4px">@ ${usd(o.limit_price)}</span>`:''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="order-badge ${orderStatusClass(o.status)}">${o.status}</span>
          ${canCancel?`<button class="order-cancel" onclick="cancelOrder('${o.id}')">✕</button>`:''}
        </div>
      </div>`;
    }).join('');
  }

  function goTrade(sym){ document.getElementById('t-symbol').value=sym; updateTradeBtn(); switchTab('trade'); }

  // ── Search ───────────────────────────────────────────────────────────────────
  function isTickerLike(q){ return /^[A-Z0-9]{1,5}$/.test(q.trim()); }

  async function loadAssets(){
    if(assetCache) return assetCache;
    const data=await api('/assets?status=active&asset_class=us_equity');
    assetCache=data; return data;
  }

  function onSearchInput(){
    const q=document.getElementById('s-query').value.trim();
    const box=document.getElementById('suggest-box');
    clearTimeout(suggestTimer);
    if(!q||isTickerLike(q.toUpperCase())){ box.classList.add('hidden'); box.innerHTML=''; return; }
    suggestTimer=setTimeout(async()=>{
      try{
        const assets=await loadAssets();
        const lower=q.toLowerCase();
        const matches=assets.filter(a=>a.name?.toLowerCase().includes(lower)&&a.tradable).slice(0,7);
        if(!matches.length){ box.classList.add('hidden'); return; }
        box.innerHTML=matches.map(a=>`<button class="suggest-item" onclick="pickSuggest('${a.symbol}','${a.name.replace(/'/g,"\\'")}')">
          <span class="suggest-name">${a.name}</span>
          <span class="suggest-ticker">${a.symbol}</span>
        </button>`).join('')+`<div style="padding:8px 16px;color:#374151;font-size:11px;border-top:1px solid #1f2937">Tap to look up live price</div>`;
        box.classList.remove('hidden');
      }catch(e){}
    },350);
  }

  function pickSuggest(sym,name){
    document.getElementById('s-query').value=sym;
    document.getElementById('suggest-box').classList.add('hidden');
    doSearch(sym);
  }

  function quickSearch(sym){ document.getElementById('s-query').value=sym; doSearch(sym); }

  async function doSearch(overrideSym){
    const sym=(overrideSym||document.getElementById('s-query').value).trim().toUpperCase();
    if(!sym) return;
    document.getElementById('suggest-box').classList.add('hidden');
    document.getElementById('s-icon').classList.add('hidden');
    document.getElementById('s-spinner').classList.remove('hidden');
    document.getElementById('s-btn').disabled=true;
    document.getElementById('search-result-box').innerHTML='';
    try{
      const data=await api(`${DATA}/stocks/snapshots?symbols=${sym}&feed=iex`);
      const d=data[sym];
      if(!d){ document.getElementById('search-result-box').innerHTML=`<div class="card"><p class="red">"${sym}" not found or no data available.</p></div>`; return; }
      const lp=d.latestTrade?.p||d.latestQuote?.ap||d.dailyBar?.c;
      const prev=d.prevDailyBar?.c;
      const chg=lp&&prev?lp-prev:null;
      const chgPct=chg&&prev?chg/prev:null;
      let html=`<div class="card fade-in">
        <div class="result-header">
          <div><div class="result-symbol">${sym}</div><div class="result-label">Last Trade Price</div></div>
          <div><div class="result-price">${lp?usd(lp):'—'}</div>`;
      if(chg!=null) html+=`<div class="${chg>=0?'green':'red'}" style="font-size:13px;font-weight:700;text-align:right">${chg>=0?'▲':'▼'} ${usd(Math.abs(chg))} (${(chgPct*100).toFixed(2)}%)</div>`;
      html+=`</div></div>`;
      if(d.dailyBar){
        html+=`<div class="stat-grid">
          ${[['Open',usd(d.dailyBar.o)],['High',usd(d.dailyBar.h)],['Low',usd(d.dailyBar.l)],['Close',usd(d.dailyBar.c)],['Volume',num(d.dailyBar.v)],['Prev Close',usd(prev)]].map(([l,v])=>`<div class="stat-cell"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join('')}
        </div>`;
      }
      if(d.latestQuote){
        html+=`<div class="bid-ask">
          <div class="bid-box"><div class="bid-ask-label">Bid</div><div class="bid-ask-price green">${usd(d.latestQuote.bp)}</div><div class="bid-ask-size">${d.latestQuote.bs} sh</div></div>
          <div class="ask-box"><div class="bid-ask-label">Ask</div><div class="bid-ask-price red">${usd(d.latestQuote.ap)}</div><div class="bid-ask-size">${d.latestQuote.as} sh</div></div>
        </div>`;
      }
      html+=`<button class="btn btn-sky" onclick="goTrade('${sym}')">Trade ${sym}</button></div>`;
      document.getElementById('search-result-box').innerHTML=html;
    }catch(e){
      document.getElementById('search-result-box').innerHTML=`<div class="card"><p class="red">${e.message}</p></div>`;
    }finally{
      document.getElementById('s-icon').classList.remove('hidden');
      document.getElementById('s-spinner').classList.add('hidden');
      document.getElementById('s-btn').disabled=false;
    }
  }

  // ── Account Render ───────────────────────────────────────────────────────────
  function renderAccount(){
    const a=state.account; if(!a) return;
    const rows=[['Account #',a.account_number],['Status',a.status],['Portfolio Value',usd(a.portfolio_value)],['Equity',usd(a.equity)],['Cash',usd(a.cash)],['Buying Power',usd(a.buying_power)],['Day Trades Used',a.daytrade_count],['Pattern Day Trader',a.pattern_day_trader?'⚠️ Yes':'No']];
    document.getElementById('acct-rows').innerHTML=rows.map(([k,v])=>`<div class="acct-row"><span class="acct-key">${k}</span><span class="acct-val">${v}</span></div>`).join('');
    document.getElementById('acct-key-display').textContent=state.key.slice(0,8)+'••••••••';
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  function switchTab(tab){
    ['portfolio','trade','search','account'].forEach(t=>{
      document.getElementById('tab-'+t).classList.toggle('hidden',t!==tab);
      document.getElementById('nav-'+t).classList.toggle('active',t===tab);
    });
    state.tab=tab;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  (async function init(){
    const k=localStorage.getItem('alpaca_key');
    const s=localStorage.getItem('alpaca_secret');
    if(k&&s){
      setLoginLoading(true);
      try{
        const acct=await fetch(BASE+'/account',{headers:{'APCA-API-KEY-ID':k,'APCA-API-SECRET-KEY':s}}).then(r=>{ if(!r.ok) throw new Error(); return r.json(); });
        state.key=k; state.secret=s; state.account=acct;
        showApp(); fetchAll();
      }catch(e){
        localStorage.removeItem('alpaca_key'); localStorage.removeItem('alpaca_secret');
      }finally{ setLoginLoading(false); }
    }
  })();