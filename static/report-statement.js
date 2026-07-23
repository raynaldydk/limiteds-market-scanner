const element=id=>document.getElementById(id);
const integer=value=>Math.max(0,Math.round(Number(value)||0));
const number=value=>new Intl.NumberFormat('en-US').format(value);
const idr=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
const dateLabel=value=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(`${value}T00:00:00`));
const dateTime=value=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const businessCost=purchase=>Number.isFinite(Number(purchase.businessCostIdr))?integer(purchase.businessCostIdr):integer(purchase.purchasePrice);
const accountAssetValue=account=>account.parent===true?15000:integer(account.sendLimit)>=10000?25000:0;
const pad=value=>String(value).padStart(2,'0');
const dateKey=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?null:`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;};
let accounts=[],purchases=[],sales=[],snapshots=[];

function setPreset(){
  const now=new Date(),preset=element('periodPreset').value;
  let from=null,to=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(preset==='month')from=new Date(now.getFullYear(),now.getMonth(),1);
  if(preset==='lastMonth'){from=new Date(now.getFullYear(),now.getMonth()-1,1);to=new Date(now.getFullYear(),now.getMonth(),0);}
  if(preset==='year')from=new Date(now.getFullYear(),0,1);
  if(preset==='all'){from=null;to=null;}
  if(preset!=='custom'){element('dateFrom').value=from?dateKey(from):'';element('dateTo').value=to?dateKey(to):'';}
  render();
}
function inPeriod(value){const key=dateKey(value),from=element('dateFrom').value,to=element('dateTo').value;return Boolean(key)&&(!from||key>=from)&&(!to||key<=to);}
function periodLabel(){const from=element('dateFrom').value,to=element('dateTo').value;if(!from&&!to)return'All Time';if(from&&to)return`${dateLabel(from)} – ${dateLabel(to)}`;return from?`From ${dateLabel(from)}`:`Through ${dateLabel(to)}`;}
function row(label,value,className='',detail=false){return`<tr class="${detail?'detail':''}"><th>${label}</th><td class="num ${className}">${idr(value)}</td></tr>`;}
function escapeHtml(value){const node=document.createElement('div');node.textContent=String(value??'');return node.innerHTML;}

async function loadStatement(){
  try{
    const responses=await Promise.all([fetch('/api/accounts'),fetch('/api/limited-purchases'),fetch('/api/robux-sales'),fetch('/api/account-snapshots')]);
    const payloads=await Promise.all(responses.map(response=>response.json()));
    const failed=responses.findIndex(response=>!response.ok);
    if(failed>=0)throw new Error(payloads[failed].error||'Statement data could not be loaded');
    accounts=payloads[0].accounts||[];purchases=payloads[1].purchases||[];sales=payloads[2].sales||[];snapshots=payloads[3].snapshots||[];
    setPreset();
  }catch(error){const status=element('statementStatus');status.hidden=false;status.textContent=error.message;status.className='statement-status error';}
}

function render(){
  const filteredPurchases=purchases.filter(item=>inPeriod(item.purchasedAt));
  const filteredSales=sales.filter(item=>inPeriod(item.createdAt));
  const typeLabels={limited:'Limiteds',subscription:'Roblox Plus',robux:'Robux',account:'Accounts',other:'Other'};
  const expenseGroups=new Map();
  filteredPurchases.forEach(item=>{const type=item.purchaseType||'limited';expenseGroups.set(type,(expenseGroups.get(type)||0)+businessCost(item));});
  const revenue=filteredSales.reduce((sum,item)=>sum+integer(item.price),0);
  const spending=filteredPurchases.reduce((sum,item)=>sum+businessCost(item),0);
  const net=revenue-spending;
  const expenseRows=[...expenseGroups.entries()].sort((a,b)=>b[1]-a[1]).map(([type,value])=>row(typeLabels[type]||escapeHtml(type),-value,'negative',true)).join('');
  element('operatingRows').innerHTML=`<tr class="section-row"><th colspan="2">Revenue</th></tr>${row('Robux sales',revenue,'positive',true)}<tr class="section-row"><th colspan="2">Business spending</th></tr>${expenseRows||row('No recorded spending',0,'',true)}${row('Total business spending',-spending,'negative')}`;
  element('netCashFlow').textContent=idr(net);element('netCashFlow').className=`num ${net<0?'negative':'positive'}`;

  const to=element('dateTo').value;
  const eligibleSnapshots=snapshots.filter(snapshot=>!to||dateKey(snapshot.capturedAt)<=to).sort((a,b)=>new Date(a.capturedAt)-new Date(b.capturedAt));
  const snapshot=eligibleSnapshots.at(-1)||null,historical=Boolean(snapshot&&to);
  const positionAccounts=historical?snapshot.accounts:accounts;
  const rate=Number(element('statementRate').value);
  const rap=positionAccounts.reduce((sum,a)=>sum+integer(a.limitedRapTotal),0);
  const converted=positionAccounts.reduce((sum,a)=>sum+Math.round(integer(a.limitedRapTotal)*.7),0);
  const robux=positionAccounts.reduce((sum,a)=>sum+integer(a.robux),0);
  const pending=positionAccounts.reduce((sum,a)=>sum+integer(a.robuxPending),0);
  const assets=positionAccounts.reduce((sum,a)=>sum+(historical?integer(a.assetIdr):accountAssetValue(a)),0);
  const totalPortfolio=(converted+robux+pending)*rate+assets;
  element('positionRows').innerHTML=`<tr class="section-row"><th colspan="2">Robux position</th></tr>${row('70% of Limiteds RAP',converted*rate,'',true)}${row('Liquid Robux',robux*rate,'',true)}${row('Pending Robux',pending*rate,'',true)}${row('Account asset value',assets,'',true)}<tr class="section-row"><th colspan="2">Underlying balances</th></tr><tr class="detail"><th>Limiteds RAP</th><td class="num">${number(rap)}</td></tr><tr class="detail"><th>Estimated Robux</th><td class="num">${number(converted+robux+pending)}</td></tr>`;
  element('totalPortfolio').textContent=idr(totalPortfolio);
  element('positionAsOf').textContent=historical?`Snapshot ${dateTime(snapshot.capturedAt)}`:'Current account state';

  const ledger=[
    ...filteredSales.map(item=>({at:item.createdAt,type:'Revenue',description:`${number(integer(item.robuxSold))} Robux sold`,account:item.usernameSource,amount:integer(item.price)})),
    ...filteredPurchases.map(item=>({at:item.purchasedAt,type:typeLabels[item.purchaseType||'limited']||item.purchaseType,description:item.itemName||'Purchase',account:item.username,amount:-businessCost(item)}))
  ].sort((a,b)=>new Date(b.at)-new Date(a.at));
  element('statementLedger').innerHTML=ledger.map(item=>`<tr><td class="date">${dateTime(item.at)}</td><td>${escapeHtml(item.type)}</td><td><strong>${escapeHtml(item.description)}</strong></td><td>${escapeHtml(item.account||'Unassigned')}</td><td class="num ${item.amount<0?'negative':'positive'}">${item.amount<0?'−':'+'}${idr(Math.abs(item.amount))}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No transactions recorded for this period.</td></tr>';
  element('statementPeriod').textContent=periodLabel();element('preparedAt').textContent=dateTime(new Date());element('valuationBasis').textContent=`${number(rate)} IDR / Robux`;
  element('transactionCount').textContent=`${number(ledger.length)} transactions`;element('ledgerCount').textContent=`${number(ledger.length)} entries`;
}

element('periodPreset').addEventListener('change',setPreset);
['dateFrom','dateTo'].forEach(id=>element(id).addEventListener('change',()=>{element('periodPreset').value='custom';render();}));
element('statementRate').value=localStorage.getItem('limiteds-market-account-sell-rate')||'130';
element('statementRate').addEventListener('change',render);
element('printStatement').addEventListener('click',()=>window.print());
loadStatement();
