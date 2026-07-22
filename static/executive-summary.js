const element = id => document.getElementById(id);
const integer = value => Math.max(0, Math.round(Number(value) || 0));
const number = value => new Intl.NumberFormat('en-US').format(value);
const idr = value => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
const dateTime = value => new Intl.DateTimeFormat('en-GB',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const businessCost = purchase => Number.isFinite(Number(purchase.businessCostIdr)) ? integer(purchase.businessCostIdr) : integer(purchase.purchasePrice);
let accounts = [], purchases = [], sales = [], snapshots = [];
const accountAssetValue = account => account.parent === true ? 15000 : integer(account.sendLimit) >= 10000 ? 25000 : 0;
const pad = value => String(value).padStart(2,'0');

function localDateKey(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}
function matchesPeriod(value) {
  const key=localDateKey(value), mode=element('periodMode').value;
  if (mode==='all') return true;
  if (!key) return false;
  if (mode==='date') return key===element('periodDate').value;
  if (mode==='month') return key.slice(0,7)===element('periodMonth').value;
  return key.slice(0,4)===element('periodYear').value;
}
function selectedPeriodLabel() {
  const mode=element('periodMode').value;
  if (mode==='all') return 'All time';
  if (mode==='date') return element('periodDate').value ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(`${element('periodDate').value}T00:00:00`)) : 'Selected date';
  if (mode==='month') return element('periodMonth').value ? new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(new Date(`${element('periodMonth').value}-01T00:00:00`)) : 'Selected month';
  return element('periodYear').value || 'Selected year';
}
function setupPeriodControls() {
  const now=new Date(), dateKey=localDateKey(now);
  if (!element('periodDate').value) element('periodDate').value=dateKey;
  if (!element('periodMonth').value) element('periodMonth').value=dateKey.slice(0,7);
  const years=[...new Set([...purchases.map(item=>localDateKey(item.purchasedAt)?.slice(0,4)),...sales.map(item=>localDateKey(item.createdAt)?.slice(0,4)),String(now.getFullYear())].filter(Boolean))].sort((a,b)=>b-a);
  const selected=element('periodYear').value||String(now.getFullYear());
  element('periodYear').innerHTML=years.map(year=>`<option value="${year}">${year}</option>`).join('');
  element('periodYear').value=years.includes(selected)?selected:years[0];
  updatePeriodControls();
}
function updatePeriodControls() {
  const mode=element('periodMode').value;
  element('dateFilter').hidden=mode!=='date';element('monthFilter').hidden=mode!=='month';element('yearFilter').hidden=mode!=='year';
  render();
}

async function loadDashboard() {
  try {
    const responses = await Promise.all([fetch('/api/accounts'),fetch('/api/limited-purchases'),fetch('/api/robux-sales'),fetch('/api/account-snapshots')]);
    const payloads = await Promise.all(responses.map(response => response.json()));
    const failed = responses.findIndex(response => !response.ok);
    if (failed >= 0) throw new Error(payloads[failed].error || 'Dashboard data could not be loaded');
    accounts=payloads[0].accounts || []; purchases=payloads[1].purchases || []; sales=payloads[2].sales || []; snapshots=payloads[3].snapshots || [];
    setupPeriodControls();
  } catch(error) { const status=element('dashboardStatus');status.hidden=false;status.textContent=error.message;status.className='dashboard-status error'; }
}

function render() {
  const rate=Number(element('executiveRate').value), mode=element('periodMode').value;
  const filteredPurchases=purchases.filter(item=>matchesPeriod(item.purchasedAt)), filteredSales=sales.filter(item=>matchesPeriod(item.createdAt)), periodLabel=selectedPeriodLabel();
  const periodSnapshots=mode==='all'?[]:snapshots.filter(item=>matchesPeriod(item.capturedAt)).sort((a,b)=>new Date(a.capturedAt)-new Date(b.capturedAt)), closing=periodSnapshots.at(-1)||null, opening=periodSnapshots[0]||null;
  const reportAccounts=closing?.accounts||accounts, historical=Boolean(closing)&&mode!=='all';
  const totalRap=reportAccounts.reduce((sum,a)=>sum+integer(a.limitedRapTotal),0),liquidRobux=reportAccounts.reduce((sum,a)=>sum+integer(a.robux),0),pending=reportAccounts.reduce((sum,a)=>sum+integer(a.robuxPending),0);
  const estimatedRobux=reportAccounts.reduce((sum,a)=>sum+(historical?integer(a.estimatedRobux):Math.round(integer(a.limitedRapTotal)*0.7)+integer(a.robux)+integer(a.robuxPending)),0);
  const accountAssets=reportAccounts.reduce((sum,a)=>sum+(historical?integer(a.assetIdr):accountAssetValue(a)),0),portfolioIdr=estimatedRobux*rate+accountAssets;
  const spending=filteredPurchases.reduce((sum,p)=>sum+businessCost(p),0), revenue=filteredSales.reduce((sum,s)=>sum+integer(s.price),0);
  element('kpiAccounts').textContent=number(reportAccounts.length);element('kpiPlus').textContent=`${reportAccounts.filter(a=>a.plusStatus==='active').length} Plus active`;
  element('kpiRap').textContent=number(totalRap);element('kpiRapMeta').textContent=historical?`Closing snapshot · ${dateTime(closing.capturedAt)}`:mode==='all'?'Current public inventory':'No snapshot · showing current inventory';element('kpiEstimatedRobux').textContent=number(estimatedRobux);element('kpiPortfolioIdr').textContent=idr(portfolioIdr);
  if(periodSnapshots.length){const values=periodSnapshots.map(snapshot=>integer(snapshot.totalEstimatedRobux)*rate+integer(snapshot.totalAssetIdr)),openingValue=values[0],average=Math.round(values.reduce((sum,value)=>sum+value,0)/values.length),change=portfolioIdr-openingValue;element('kpiPortfolioMeta').textContent=`Open ${idr(openingValue)} · Avg ${idr(average)} · Change ${change<0?'−':'+'}${idr(Math.abs(change))}`;}else element('kpiPortfolioMeta').textContent=mode==='all'?'Current · At selected rate':'No saved snapshot for this period';
  element('kpiSpending').textContent=idr(spending);element('kpiPurchaseCount').textContent=`${number(filteredPurchases.length)} purchases · ${periodLabel}`;
  element('kpiRevenue').textContent=idr(revenue);element('kpiRobuxSold').textContent=`${number(filteredSales.reduce((sum,s)=>sum+integer(s.robuxSold),0))} Robux sold · ${periodLabel}`;
  const cashFlow=revenue-spending;element('kpiCashFlow').textContent=idr(cashFlow);element('kpiCashFlow').className=cashFlow<0?'negative':'positive';
  element('kpiLiquidRobux').textContent=number(liquidRobux);element('kpiPending').textContent=`${number(pending)} pending`;
  renderAccounts(reportAccounts,historical);renderPurchaseMix(filteredPurchases,spending);renderActivity(filteredPurchases,filteredSales);element('accountAsOf').textContent=historical?`Closing snapshot · ${dateTime(closing.capturedAt)}`:`${number(accounts.length)} current accounts`;element('purchaseMixPeriod').textContent=`${periodLabel} · By IDR cost`;element('activityPeriod').textContent=`${periodLabel} · Latest 10`;
}

function renderAccounts(source,historical=false){let totalRap=0,total70Rap=0,totalRobux=0,totalPending=0,totalEstimated=0,totalAsset=0;element('executiveAccounts').innerHTML=[...source].sort((a,b)=>integer(b.limitedRapTotal)-integer(a.limitedRapTotal)).map(account=>{const rap=integer(account.limitedRapTotal),converted=Math.round(rap*0.7),robux=integer(account.robux),pending=integer(account.robuxPending),total=historical?integer(account.estimatedRobux):converted+robux+pending,asset=historical?integer(account.assetIdr):accountAssetValue(account);totalRap+=rap;total70Rap+=converted;totalRobux+=robux;totalPending+=pending;totalEstimated+=total;totalAsset+=asset;return `<tr><td><strong>${escapeHtml(account.username)}</strong>${account.plusStatus==='active'?'<small class="plus-label">Plus</small>':''}</td><td class="num">${number(rap)}</td><td class="num">${number(converted)}</td><td class="num">${number(robux)}</td><td class="num">${number(pending)}</td><td class="num value">${number(total)}</td><td class="num">${idr(asset)}</td></tr>`;}).join('')||'<tr><td colspan="7" class="muted">No accounts saved.</td></tr>';element('accountTotalRap').textContent=number(totalRap);element('accountTotal70Rap').textContent=number(total70Rap);element('accountTotalRobux').textContent=number(totalRobux);element('accountTotalPending').textContent=number(totalPending);element('accountTotalEstimated').textContent=number(totalEstimated);element('accountTotalAsset').textContent=idr(totalAsset);}

function renderPurchaseMix(filteredPurchases,total){const labels={limited:'Limited',subscription:'Roblox Plus',robux:'Robux',account:'Account',other:'Other'},groups=new Map();filteredPurchases.forEach(item=>{const type=item.purchaseType||'limited';groups.set(type,(groups.get(type)||0)+businessCost(item));});element('purchaseMix').innerHTML=[...groups.entries()].sort((a,b)=>b[1]-a[1]).map(([type,value])=>`<div><div class="mix-label"><strong>${labels[type]||type}</strong><span>${idr(value)} · ${total?((value/total)*100).toFixed(1):'0.0'}%</span></div><span class="mix-track"><i style="width:${total?value/total*100:0}%"></i></span></div>`).join('')||'<p class="muted">No purchases recorded for this period.</p>';}

function renderActivity(filteredPurchases,filteredSales){const activity=[...filteredPurchases.map(item=>({at:item.purchasedAt,type:'Purchase',title:item.itemName,account:item.username,amount:-businessCost(item)})),...filteredSales.map(item=>({at:item.createdAt,type:'Robux Sale',title:`${number(integer(item.robuxSold))} Robux`,account:item.usernameSource,amount:integer(item.price)}))].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,10);element('recentActivity').innerHTML=activity.map(item=>`<div><span class="activity-type">${escapeHtml(item.type)}</span><p><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.account||'Unassigned')} · ${dateTime(item.at)}</small></p><b class="${item.amount<0?'negative':'positive'}">${item.amount<0?'−':'+'}${idr(Math.abs(item.amount))}</b></div>`).join('')||'<p class="muted">No activity for this period.</p>';}
function escapeHtml(value){const node=document.createElement('div');node.textContent=String(value??'');return node.innerHTML;}
element('executiveRate').addEventListener('change',render);element('periodMode').addEventListener('change',updatePeriodControls);['periodDate','periodMonth','periodYear'].forEach(id=>element(id).addEventListener('change',render));loadDashboard();
