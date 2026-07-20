let allItems = [];
let visibleItems = [];
let rapPollTimer = null;
const $ = id => document.getElementById(id);
const number = n => new Intl.NumberFormat('en-US').format(n);

async function scan(force = false, silent = false) {
  if (!silent) { $('scan').disabled = true; $('scan').textContent = 'Scanning…'; $('status').textContent = 'reading every page'; }
  try {
    const response = await fetch(`/api/scan${force ? '?refresh=1' : ''}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Scan failed');
    allItems = data.items;
    populateCategories();
    updateStats(data);
    render();
    scheduleRapPoll();
  } catch (error) {
    $('status').textContent = error.message;
    $('grid').innerHTML = `<tr><td colspan="13" class="error">${escapeHtml(error.message)} — check your connection and try again.</td></tr>`;
  } finally {
    if (!silent) { $('scan').disabled = false; $('scan').textContent = 'Refresh report'; }
  }
}

function populateCategories() {
  const selected = $('category').value;
  const cats = [...new Set(allItems.map(x => x.category).filter(Boolean))].sort();
  $('category').innerHTML = '<option value="">All categories</option>' + cats.map(x => `<option>${escapeHtml(x)}</option>`).join('');
  $('category').value = selected;
}

function updateStats(data) {
  const best = allItems.filter(x => x.idr_per_1k_rap).sort((a,b) => a.idr_per_1k_rap-b.idr_per_1k_rap)[0];
  $('total').textContent = number(data.total);
  $('best').textContent = best ? idr(best.idr_per_1k_rap) : '—';
  $('rap').textContent = compact(allItems.reduce((sum,x) => sum + (x.rap || 0), 0));
  $('last').textContent = new Date(data.scanned_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const current = allItems.filter(x => x.rap_status === 'current').length;
  $('status').textContent = `${current}/${allItems.length} current RAP · ${data.cached ? 'cached' : 'fresh'}`;
}

function scheduleRapPoll() {
  clearTimeout(rapPollTimer);
  if (allItems.some(x => ['queued','updating','retrying'].includes(x.rap_status))) {
    rapPollTimer = setTimeout(() => scan(false, true), 4000);
  }
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  const category = $('category').value;
  const maxPrice = Number($('maxPrice').value) || Infinity;
  const minRap = Number($('minRap').value) || 0;
  const minDailySales = Number($('minDailySales').value) || 0;
  visibleItems = allItems.filter(x => x.item_name.toLowerCase().includes(q) && (!category || x.category === category) && x.price_idr <= maxPrice && x.rap >= minRap && (x.avg_daily_sales_30d ?? 0) >= minDailySales);
  const sorts = {
    value:(a,b)=>(a.idr_per_1k_rap??Infinity)-(b.idr_per_1k_rap??Infinity), priceAsc:(a,b)=>a.price_idr-b.price_idr,
    priceDesc:(a,b)=>b.price_idr-a.price_idr, rapDesc:(a,b)=>b.rap-a.rap, newest:(a,b)=>new Date(b.created_at)-new Date(a.created_at)
  };
  visibleItems.sort(sorts[$('sort').value]);
  const sellRate = Number($('sellRate').value);
  $('resultCount').textContent = `Showing ${visibleItems.length} of ${allItems.length} listings`;
  $('empty').hidden = visibleItems.length > 0;
  $('grid').innerHTML = visibleItems.map((x,i) => `
    <tr>
      <td class="rank">${i+1}</td>
      <td><div class="item"><img src="${escapeHtml(x.thumbnail_url)}" alt="" loading="lazy"><div class="item-title">${x.roblox_url ? `<a class="item-name" href="${escapeHtml(x.roblox_url)}" target="_blank" rel="noopener">${escapeHtml(x.item_name)}</a>` : `<strong>${escapeHtml(x.item_name)}</strong>`}${x.rolimons_url ? `<a class="rolimons-link" href="${escapeHtml(x.rolimons_url)}" target="_blank" rel="noopener" title="Open on Rolimon's"><img src="https://www.rolimons.com/favicon.ico" alt="Rolimon's">↗</a>` : ''}</div></div></td>
      <td class="seller-id" title="${escapeHtml(x.seller_id)}">${x.seller_internal_id ? `Seller ${number(x.seller_internal_id)}` : '—'}</td>
      <td class="num">${x.avg_daily_sales_30d == null ? '—' : x.avg_daily_sales_30d.toFixed(2)}</td>
      <td class="num">${x.rap == null ? `<span class="rap-state">${escapeHtml(x.rap_status)}</span>` : number(x.rap)}</td>
      <td class="num">${x.robux_sell == null ? '—' : number(x.robux_sell)}</td>
      <td class="num price">${idr(x.after_tax_idr)}</td>
      <td class="num value ${x.robux_sell != null && x.robux_sell * sellRate - x.after_tax_idr < 0 ? 'negative-value' : ''}">${x.idr_per_1k_rap ? idr(x.idr_per_1k_rap) : '—'}</td>
      <td class="num">${x.robux_sell == null ? '—' : idr(x.robux_sell * sellRate)}</td>
      <td class="num profit ${x.robux_sell != null && x.robux_sell * sellRate - x.after_tax_idr >= 0 ? 'positive' : 'negative'}">${x.robux_sell == null ? '—' : idr(x.robux_sell * sellRate - x.after_tax_idr)}</td>
      <td class="num profit ${x.robux_sell != null && x.robux_sell * sellRate - x.after_tax_idr >= 0 ? 'positive' : 'negative'}">${x.robux_sell == null || !x.after_tax_idr ? '—' : `${((x.robux_sell * sellRate - x.after_tax_idr) / x.after_tax_idr * 100).toFixed(2)}%`}</td>
      <td class="date">${formatDate(x.created_at)}</td>
      <td><a class="view" href="${escapeHtml(x.listing_url)}" target="_blank" rel="noopener">Listing ↗</a></td>
    </tr>`).join('');
}

function exportCsv() {
  const cols = ['item_name','seller_internal_id','seller_id','category','idr_rate','price_idr','after_tax_idr','market_rap','rap','robux_sell','robux_sell_rate','robux_sell_idr','profit_idr','profit_cost_ratio','sales_30d','avg_daily_sales_30d','rap_status','rap_checked_at','roblox_asset_id','roblox_collectible_item_id','idr_per_1k_rap','created_at','listing_url','roblox_url','rolimons_url'];
  const sellRate = Number($('sellRate').value);
  const rows = visibleItems.map(x => { const profit = x.robux_sell == null ? null : x.robux_sell*sellRate-x.after_tax_idr; return {...x, robux_sell_rate:sellRate, robux_sell_idr:x.robux_sell == null ? null : x.robux_sell*sellRate, profit_idr:profit, profit_cost_ratio:profit == null || !x.after_tax_idr ? null : Math.round(profit/x.after_tax_idr*10000)/100}; });
  const quote = v => `"${String(v ?? '').replaceAll('"','""')}"`;
  const csv = [cols.join(','), ...rows.map(x => cols.map(c => quote(x[c])).join(','))].join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  link.download = `limiteds-market-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}
function compact(n) { return Intl.NumberFormat('en', {notation:'compact', maximumFractionDigits:1}).format(n); }
function idr(n) { return new Intl.NumberFormat('id-ID', {style:'currency', currency:'IDR', maximumFractionDigits:0}).format(n); }
function formatDate(value) {
  const date = new Date(value), pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()}<br>${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}
function escapeHtml(v) { const d=document.createElement('div'); d.textContent=String(v??''); return d.innerHTML; }
['search','category','maxPrice','minRap','minDailySales','sort','sellRate'].forEach(id => $(id).addEventListener(id==='search'?'input':'change', render));
$('scan').addEventListener('click', () => scan(true)); $('export').addEventListener('click', exportCsv); scan();
