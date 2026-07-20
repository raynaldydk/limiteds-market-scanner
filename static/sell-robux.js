const element = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('en-US').format(value);
const idr = value => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(value);
let accounts = [];
let sales = [];

async function loadData() {
  try {
    const [accountsResponse, salesResponse] = await Promise.all([fetch('/api/accounts'), fetch('/api/robux-sales')]);
    const accountsData = await accountsResponse.json();
    const salesData = await salesResponse.json();
    if (!accountsResponse.ok) throw new Error(accountsData.error);
    if (!salesResponse.ok) throw new Error(salesData.error);
    accounts = accountsData.accounts;
    sales = salesData.sales;
    renderAccounts(); renderSales(); updatePrice();
  } catch (error) { showStatus(error.message, true); }
}

function renderAccounts() {
  const selected = element('sourceAccount').value;
  element('sourceAccount').innerHTML = '<option value="">Select account</option>' + accounts.map(account =>
    `<option value="${escapeHtml(account.id)}">${escapeHtml(account.username)}</option>`).join('');
  element('sourceAccount').value = accounts.some(account => account.id === selected) ? selected : '';
  updateSourceBalance();
}

function renderSales() {
  element('saleCount').textContent = number(sales.length);
  element('totalRobuxSold').textContent = number(sales.reduce((sum, sale) => sum + Number(sale.robuxSold || 0), 0));
  element('totalSalePrice').textContent = idr(sales.reduce((sum, sale) => sum + Number(sale.price || 0), 0));
  element('salesEmpty').hidden = sales.length > 0;
  element('salesGrid').innerHTML = sales.map(sale => `<tr><td><strong>${escapeHtml(sale.usernameSource)}</strong></td><td class="num">${number(sale.robuxSold)}</td><td class="num">${number(sale.rate)}</td><td class="num price">${idr(sale.price)}</td><td class="date">${formatDate(sale.createdAt)}</td></tr>`).join('');
}

function updateSourceBalance() {
  const account = accounts.find(item => item.id === element('sourceAccount').value);
  element('sourceBalance').textContent = account
    ? `Available: ${number(account.robux || 0)} Robux · Remaining send limit: ${number(Math.max(0, (account.sendLimit || 0) - (account.sendLimitUsed || 0)))}`
    : 'Select a source account.';
}

function updatePrice() {
  element('salePrice').textContent = idr((Number(element('robuxSold').value) || 0) * Number(element('saleRate').value));
}

function showStatus(message, error = false) {
  element('saleStatus').hidden = false; element('saleStatus').textContent = message;
  element('saleStatus').className = `sale-status ${error ? 'error' : 'success'}`;
}

element('saleForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const response = await fetch('/api/robux-sales', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ accountId:element('sourceAccount').value, robuxSold:Number(element('robuxSold').value), rate:Number(element('saleRate').value) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Sale could not be saved');
    sales.unshift(data.sale);
    const index = accounts.findIndex(account => account.id === data.account.id);
    if (index >= 0) accounts[index] = data.account;
    element('robuxSold').value = ''; renderAccounts(); renderSales(); updatePrice(); showStatus('Sale saved and source account updated.');
  } catch (error) { showStatus(error.message, true); }
});

element('sourceAccount').addEventListener('change', updateSourceBalance);
element('robuxSold').addEventListener('input', updatePrice);
element('saleRate').addEventListener('change', updatePrice);
function escapeHtml(value) { const node=document.createElement('div'); node.textContent=String(value??''); return node.innerHTML; }
function formatDate(value) { const date=new Date(value), pad=value=>String(value).padStart(2,'0'); return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`; }
loadData();
