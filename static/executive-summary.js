const element = id => document.getElementById(id);
const integer = value => Math.max(0, Math.round(Number(value) || 0));
const number = value => new Intl.NumberFormat('en-US').format(value);
const idr = value => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
const dateTime = value => new Intl.DateTimeFormat('en-GB',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
let accounts = [], purchases = [], sales = [];

async function loadDashboard() {
  try {
    const responses = await Promise.all([fetch('/api/accounts'),fetch('/api/limited-purchases'),fetch('/api/robux-sales')]);
    const payloads = await Promise.all(responses.map(response => response.json()));
    const failed = responses.findIndex(response => !response.ok);
    if (failed >= 0) throw new Error(payloads[failed].error || 'Dashboard data could not be loaded');
    accounts=payloads[0].accounts || []; purchases=payloads[1].purchases || []; sales=payloads[2].sales || [];
    render();
  } catch(error) { const status=element('dashboardStatus');status.hidden=false;status.textContent=error.message;status.className='dashboard-status error'; }
}

function render() {
  const rate=Number(element('executiveRate').value), totalRap=accounts.reduce((sum,a)=>sum+integer(a.limitedRapTotal),0);
  const liquidRobux=accounts.reduce((sum,a)=>sum+integer(a.robux),0), pending=accounts.reduce((sum,a)=>sum+integer(a.robuxPending),0);
  const estimatedRobux=accounts.reduce((sum,a)=>sum+Math.round(integer(a.limitedRapTotal)*0.7)+integer(a.robux)+integer(a.robuxPending),0);
  const spending=purchases.reduce((sum,p)=>sum+integer(p.purchasePrice),0), revenue=sales.reduce((sum,s)=>sum+integer(s.price),0);
  element('kpiAccounts').textContent=number(accounts.length);element('kpiPlus').textContent=`${accounts.filter(a=>a.plusStatus==='active').length} Plus active`;
  element('kpiRap').textContent=number(totalRap);element('kpiEstimatedRobux').textContent=number(estimatedRobux);element('kpiPortfolioIdr').textContent=idr(estimatedRobux*rate);
  element('kpiSpending').textContent=idr(spending);element('kpiPurchaseCount').textContent=`${number(purchases.length)} purchases`;
  element('kpiRevenue').textContent=idr(revenue);element('kpiRobuxSold').textContent=`${number(sales.reduce((sum,s)=>sum+integer(s.robuxSold),0))} Robux sold`;
  const cashFlow=revenue-spending;element('kpiCashFlow').textContent=idr(cashFlow);element('kpiCashFlow').className=cashFlow<0?'negative':'positive';
  element('kpiLiquidRobux').textContent=number(liquidRobux);element('kpiPending').textContent=`${number(pending)} pending`;
  renderAccounts();renderPurchaseMix(spending);renderActivity();element('accountAsOf').textContent=`${number(accounts.length)} accounts`;
}

function renderAccounts(){let totalRap=0,total70Rap=0,totalRobux=0,totalPending=0,totalEstimated=0;element('executiveAccounts').innerHTML=[...accounts].sort((a,b)=>integer(b.limitedRapTotal)-integer(a.limitedRapTotal)).map(account=>{const rap=integer(account.limitedRapTotal),converted=Math.round(rap*0.7),robux=integer(account.robux),pending=integer(account.robuxPending),total=converted+robux+pending;totalRap+=rap;total70Rap+=converted;totalRobux+=robux;totalPending+=pending;totalEstimated+=total;return `<tr><td><strong>${escapeHtml(account.username)}</strong>${account.plusStatus==='active'?'<small class="plus-label">Plus</small>':''}</td><td class="num">${number(rap)}</td><td class="num">${number(converted)}</td><td class="num">${number(robux)}</td><td class="num">${number(pending)}</td><td class="num value">${number(total)}</td></tr>`;}).join('')||'<tr><td colspan="6" class="muted">No accounts saved.</td></tr>';element('accountTotalRap').textContent=number(totalRap);element('accountTotal70Rap').textContent=number(total70Rap);element('accountTotalRobux').textContent=number(totalRobux);element('accountTotalPending').textContent=number(totalPending);element('accountTotalEstimated').textContent=number(totalEstimated);}

function renderPurchaseMix(total){const labels={limited:'Limited',subscription:'Roblox Plus',robux:'Robux',account:'Account',other:'Other'},groups=new Map();purchases.forEach(item=>{const type=item.purchaseType||'limited';groups.set(type,(groups.get(type)||0)+integer(item.purchasePrice));});element('purchaseMix').innerHTML=[...groups.entries()].sort((a,b)=>b[1]-a[1]).map(([type,value])=>`<div><div class="mix-label"><strong>${labels[type]||type}</strong><span>${idr(value)} · ${total?((value/total)*100).toFixed(1):'0.0'}%</span></div><span class="mix-track"><i style="width:${total?value/total*100:0}%"></i></span></div>`).join('')||'<p class="muted">No purchases recorded.</p>';}

function renderActivity(){const activity=[...purchases.map(item=>({at:item.purchasedAt,type:'Purchase',title:item.itemName,account:item.username,amount:-integer(item.purchasePrice)})),...sales.map(item=>({at:item.createdAt,type:'Robux Sale',title:`${number(integer(item.robuxSold))} Robux`,account:item.usernameSource,amount:integer(item.price)}))].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,10);element('recentActivity').innerHTML=activity.map(item=>`<div><span class="activity-type">${escapeHtml(item.type)}</span><p><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.account||'Unassigned')} · ${dateTime(item.at)}</small></p><b class="${item.amount<0?'negative':'positive'}">${item.amount<0?'−':'+'}${idr(Math.abs(item.amount))}</b></div>`).join('')||'<p class="muted">No recent activity.</p>';}
function escapeHtml(value){const node=document.createElement('div');node.textContent=String(value??'');return node.innerHTML;}
element('executiveRate').addEventListener('change',render);loadDashboard();
