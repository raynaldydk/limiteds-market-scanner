const element = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('en-US').format(value);
const idr = value => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(value);
let purchases = [];

async function loadData() {
  try {
    const [purchaseResponse, accountResponse] = await Promise.all([fetch('/api/limited-purchases'), fetch('/api/accounts')]);
    const purchaseData = await purchaseResponse.json();
    const accountData = await accountResponse.json();
    if (!purchaseResponse.ok) throw new Error(purchaseData.error);
    if (!accountResponse.ok) throw new Error(accountData.error);
    purchases = purchaseData.purchases || [];
    element('username').innerHTML = '<option value="">Select Account Manager username</option>' + (accountData.accounts || [])
      .sort((left, right) => left.username.localeCompare(right.username))
      .map(account => `<option value="${escapeHtml(account.username)}">${escapeHtml(account.username)}</option>`).join('');
    renderPurchases();
  } catch (error) { showStatus(error.message, true); }
}

function renderPurchases() {
  element('purchaseCount').textContent = number(purchases.length);
  element('totalCost').textContent = idr(purchases.reduce((sum, item) => sum + Number(item.purchasePrice || 0), 0));
  const revenue = purchases.reduce((sum, item) => sum + getRevenue(item), 0);
  const profit = purchases.reduce((sum, item) => sum + getProfit(item), 0);
  element('totalRevenue').textContent = idr(revenue);
  element('totalProfit').textContent = idr(profit);
  element('totalProfit').classList.toggle('negative', profit < 0);
  element('purchaseEmpty').hidden = purchases.length > 0;
  element('purchaseGrid').innerHTML = purchases.map(item => { const sell70=getRobuxSell70(item), revenue=getRevenue(item), profit=getProfit(item); return `<tr><td><strong>${escapeHtml(item.username)}</strong></td><td>${escapeHtml(item.itemName)}</td><td class="num">${number(item.rap)}</td><td class="num">${number(sell70)}</td><td class="num price">${idr(item.purchasePrice)}</td><td class="num">${idr(revenue)}</td><td class="date">${formatDate(item.purchasedAt)}</td><td class="num">${number(item.minimumRobuxSell)}</td><td class="num value ${profit < 0 ? 'negative' : ''}">${idr(profit)}</td></tr>`; }).join('');
}

function getRobuxSell70(item) { return Number.isFinite(Number(item.robuxSell70)) ? Number(item.robuxSell70) : Math.round(Number(item.rap || 0) * 0.7); }
function getRevenue(item) { return Number.isFinite(Number(item.estimatedRevenue)) ? Number(item.estimatedRevenue) : getRobuxSell70(item) * Number(item.rate || 0); }
function getProfit(item) { return Number.isFinite(Number(item.profitEstimate)) ? Number(item.profitEstimate) : getRevenue(item) - Number(item.purchasePrice || 0); }

function updatePreview() {
  const rap = Number(element('rap').value) || 0;
  const price = parseIdr(element('purchasePrice').value);
  const rate = Number(element('purchaseRate').value);
  const robuxSell70 = Math.round(rap * 0.7);
  const revenue = robuxSell70 * rate;
  element('robuxSellPreview').textContent = number(robuxSell70);
  element('revenuePreview').textContent = idr(revenue);
  element('minimumPreview').textContent = number(price ? Math.ceil(price / rate) : 0);
  const profit = revenue - price;
  element('profitPreview').textContent = idr(profit);
  element('profitPreview').classList.toggle('negative', profit < 0);
}

function parseIdr(value) { return Number(String(value || '').replace(/\D/g, '')) || 0; }
function formatIdrInput() { const value = parseIdr(element('purchasePrice').value); element('purchasePrice').value = value ? `Rp${number(value)}` : ''; updatePreview(); }
function showStatus(message, error = false) { element('purchaseStatus').hidden=false; element('purchaseStatus').textContent=message; element('purchaseStatus').className=`purchase-status ${error ? 'error' : 'success'}`; }
function showScanStatus(message, error = false) { element('rapScanStatus').hidden=false; element('rapScanStatus').textContent=message; element('rapScanStatus').className=`scan-status ${error ? 'error' : 'success'}`; }
function setDefaultDate() { const now=new Date(), local=new Date(now.getTime()-now.getTimezoneOffset()*60000); element('purchasedAt').value=local.toISOString().slice(0,16); }

element('purchaseForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const response = await fetch('/api/limited-purchases', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username:element('username').value, itemName:element('itemName').value, rap:Number(element('rap').value), purchasePrice:parseIdr(element('purchasePrice').value), rate:Number(element('purchaseRate').value), purchasedAt:element('purchasedAt').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Purchase could not be saved');
    purchases.unshift(data.purchase); element('purchaseForm').reset(); setDefaultDate(); renderPurchases(); updatePreview(); showStatus('Purchase saved.');
  } catch (error) { showStatus(error.message, true); }
});

element('purchasePrice').addEventListener('input', formatIdrInput);
element('rap').addEventListener('input', updatePreview);
element('purchaseRate').addEventListener('change', updatePreview);
element('scanRap').addEventListener('click', async () => {
  const itemName = element('itemName').value.trim();
  if (!itemName) return showScanStatus('Enter an exact item name first.', true);
  const button = element('scanRap'); button.disabled=true; button.textContent='Scanning...'; showScanStatus('Looking up current Roblox RAP...');
  try {
    const response = await fetch(`/api/roblox/rap?name=${encodeURIComponent(itemName)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'RAP could not be found');
    element('rap').value = data.rap; updatePreview(); showScanStatus(`Current RAP found: ${number(data.rap)}.`, false);
  } catch (error) { showScanStatus(error.message, true); }
  finally { button.disabled=false; button.textContent='Scan RAP'; }
});
function escapeHtml(value) { const node=document.createElement('div'); node.textContent=String(value??''); return node.innerHTML; }
function formatDate(value) { const date=new Date(value), pad=value=>String(value).padStart(2,'0'); return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}.${pad(date.getMinutes())}`; }
setDefaultDate(); updatePreview(); loadData();
