let allItems = [];
let visibleItems = [];
let rapPollTimer = null;
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(n);
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
    $('grid').innerHTML = `<tr><td colspan="11" class="error">${escapeHtml(error.message)} — check your connection and try again.</td></tr>`;
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
  const best = allItems.filter(x => x.usd_per_1k_rap).sort((a,b) => a.usd_per_1k_rap-b.usd_per_1k_rap)[0];
  $('total').textContent = number(data.total);
  $('best').textContent = best ? money(best.usd_per_1k_rap) : '—';
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
  visibleItems = allItems.filter(x => x.item_name.toLowerCase().includes(q) && (!category || x.category === category) && x.price_usd <= maxPrice && x.rap >= minRap);
  const sorts = {
    value:(a,b)=>(a.usd_per_1k_rap??Infinity)-(b.usd_per_1k_rap??Infinity), priceAsc:(a,b)=>a.price_usd-b.price_usd,
    priceDesc:(a,b)=>b.price_usd-a.price_usd, rapDesc:(a,b)=>b.rap-a.rap, newest:(a,b)=>new Date(b.created_at)-new Date(a.created_at)
  };
  visibleItems.sort(sorts[$('sort').value]);
  $('resultCount').textContent = `Showing ${visibleItems.length} of ${allItems.length} listings`;
  $('empty').hidden = visibleItems.length > 0;
  $('grid').innerHTML = visibleItems.map((x,i) => `
    <tr>
      <td class="rank">${i+1}</td>
      <td><div class="item"><img src="${escapeHtml(x.thumbnail_url)}" alt="" loading="lazy"><strong>${escapeHtml(x.item_name)}</strong></div></td>
      <td><span class="category">${escapeHtml(x.category || 'Other')}</span></td>
      <td class="num price">${money(x.price_usd)}</td>
      <td class="num muted">${number(x.market_rap)}</td>
      <td class="num">${x.rap == null ? `<span class="rap-state">${escapeHtml(x.rap_status)}</span>` : `${number(x.rap)}<small class="rap-source">Roblox</small>`}</td>
      <td class="num value">${x.usd_per_1k_rap ? money(x.usd_per_1k_rap) : '—'}</td>
      <td class="num muted">${x.rap_per_usd ? number(x.rap_per_usd) : '—'}</td>
      <td>${x.is_verified_seller ? '<span class="verified">Verified</span>' : '<span class="muted">Standard</span>'}</td>
      <td class="date">${new Date(x.created_at).toLocaleDateString()}</td>
      <td><a class="view" href="${escapeHtml(x.listing_url)}" target="_blank" rel="noopener">View ↗</a></td>
    </tr>`).join('');
}

function exportCsv() {
  const cols = ['item_name','category','price_usd','market_rap','rap','rap_status','rap_checked_at','roblox_asset_id','roblox_collectible_item_id','usd_per_1k_rap','rap_per_usd','is_verified_seller','created_at','listing_url'];
  const quote = v => `"${String(v ?? '').replaceAll('"','""')}"`;
  const csv = [cols.join(','), ...visibleItems.map(x => cols.map(c => quote(x[c])).join(','))].join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  link.download = `limiteds-market-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}
function compact(n) { return Intl.NumberFormat('en', {notation:'compact', maximumFractionDigits:1}).format(n); }
function escapeHtml(v) { const d=document.createElement('div'); d.textContent=String(v??''); return d.innerHTML; }
['search','category','maxPrice','minRap','sort'].forEach(id => $(id).addEventListener(id==='search'?'input':'change', render));
$('scan').addEventListener('click', () => scan(true)); $('export').addEventListener('click', exportCsv); scan();
