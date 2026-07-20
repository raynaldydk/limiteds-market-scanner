import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://limitedsmarket.com';
const API_URL = `${BASE_URL}/api/listings`;
const ROOT = fileURLToPath(new URL('./static/', import.meta.url));
const ACCOUNT_DATA_PATH = fileURLToPath(new URL('./data/accounts.json', import.meta.url));
const ROBUX_SALES_PATH = fileURLToPath(new URL('./data/robux-sales.json', import.meta.url));
const LIMITED_PURCHASES_PATH = fileURLToPath(new URL('./data/limited-purchases.json', import.meta.url));
const SELLER_MAP_PATH = fileURLToPath(new URL('./data/seller-map.json', import.meta.url));
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 30) * 1000;
const cache = { at: 0, items: [] };
const currencyCache = { at: 0, idrRate: null };
const CURRENCY_TTL = Number(process.env.CURRENCY_TTL_SECONDS || 3600) * 1000;
const robloxData = new Map();
const robloxQueue = [];
const queuedNames = new Set();
const categoryByName = new Map();
const RAP_TTL = Number(process.env.RAP_TTL_SECONDS || 300) * 1000;
let queueRunning = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getIdrRate(force, fetcher) {
  if (!force && currencyCache.idrRate && Date.now() - currencyCache.at < CURRENCY_TTL) return currencyCache.idrRate;
  const rates = await fetchJson('https://limitedsmarket.com/api/currency/rates', fetcher);
  const idrRate = Number(rates.IDR);
  if (!Number.isFinite(idrRate) || idrRate <= 0) throw new Error('Limiteds Market returned an invalid IDR rate');
  currencyCache.at = Date.now(); currencyCache.idrRate = idrRate;
  return idrRate;
}

async function fetchJson(url, fetcher = fetch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(url, { headers: { 'User-Agent': 'LimitedsMarketScanner/1.0' }, signal: AbortSignal.timeout(20000) });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) throw new Error(`Roblox returned HTTP ${response.status}`);
    await wait(750 * 2 ** attempt);
  }
  throw new Error('Roblox rate limit persisted');
}

async function readAccounts() {
  try {
    const accounts = JSON.parse(await readFile(ACCOUNT_DATA_PATH, 'utf8'));
    return Array.isArray(accounts) ? accounts : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAccounts(accounts) {
  if (!Array.isArray(accounts)) throw new Error('Account data must be an array');
  await mkdir(fileURLToPath(new URL('./data/', import.meta.url)), { recursive:true });
  await writeFile(ACCOUNT_DATA_PATH, `${JSON.stringify(accounts, null, 2)}\n`, 'utf8');
}

async function readRobuxSales() {
  try {
    const sales = JSON.parse(await readFile(ROBUX_SALES_PATH, 'utf8'));
    return Array.isArray(sales) ? sales : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeRobuxSales(sales) {
  await mkdir(fileURLToPath(new URL('./data/', import.meta.url)), { recursive:true });
  await writeFile(ROBUX_SALES_PATH, `${JSON.stringify(sales, null, 2)}\n`, 'utf8');
}

async function readLimitedPurchases() {
  try {
    const purchases = JSON.parse(await readFile(LIMITED_PURCHASES_PATH, 'utf8'));
    return Array.isArray(purchases) ? purchases : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeLimitedPurchases(purchases) {
  await mkdir(fileURLToPath(new URL('./data/', import.meta.url)), { recursive:true });
  await writeFile(LIMITED_PURCHASES_PATH, `${JSON.stringify(purchases, null, 2)}\n`, 'utf8');
}

export function createLimitedPurchase(input, now = new Date()) {
  const username = String(input.username || '').trim();
  const itemName = String(input.itemName || '').trim();
  const rap = Math.round(Number(input.rap));
  const purchasePrice = Math.round(Number(input.purchasePrice));
  const rate = Number(input.rate);
  const purchasedAt = new Date(input.purchasedAt || now);
  if (!username) throw new Error('Username is required');
  if (!itemName) throw new Error('Item name is required');
  if (!Number.isFinite(rap) || rap <= 0) throw new Error('RAP must be greater than zero');
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) throw new Error('Purchase price must be greater than zero');
  if (![130, 135, 140].includes(rate)) throw new Error('Rate must be 130, 135, or 140');
  if (Number.isNaN(purchasedAt.getTime())) throw new Error('Purchase date is invalid');
  const estimatedRobuxSell = Math.round(rap * 0.7);
  const estimatedRevenue = estimatedRobuxSell * rate;
  return {
    id:`purchase-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    username, itemName, rap, purchasePrice, rate,
    purchasedAt:purchasedAt.toISOString(),
    robuxSell70:estimatedRobuxSell,
    estimatedRevenue,
    minimumRobuxSell:Math.ceil(purchasePrice / rate),
    profitEstimate:estimatedRevenue - purchasePrice,
    createdAt:now.toISOString()
  };
}

async function applySellerMapping(items) {
  let mapping = { nextId:1, sellers:{} };
  try {
    const saved = JSON.parse(await readFile(SELLER_MAP_PATH, 'utf8'));
    if (saved?.sellers && Number.isInteger(saved.nextId)) mapping = saved;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let changed = false;
  for (const item of items) {
    const uuid = String(item.seller_id || '').trim();
    if (!uuid) { item.seller_internal_id = null; continue; }
    if (!mapping.sellers[uuid]) {
      mapping.sellers[uuid] = mapping.nextId++;
      changed = true;
    }
    item.seller_internal_id = mapping.sellers[uuid];
  }
  if (changed) {
    await mkdir(fileURLToPath(new URL('./data/', import.meta.url)), { recursive:true });
    await writeFile(SELLER_MAP_PATH, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');
  }
}

export function applyRobuxSale(accounts, input, now = new Date()) {
  const robuxSold = Math.round(Number(input.robuxSold));
  const rate = Number(input.rate);
  if (!Number.isFinite(robuxSold) || robuxSold <= 0) throw new Error('Robux sold must be greater than zero');
  if (![130, 135, 140].includes(rate)) throw new Error('Rate must be 130, 135, or 140');
  const source = accounts.find(account => account.id === input.accountId);
  if (!source) throw new Error('Source account was not found');
  const availableRobux = Math.max(0, Math.round(Number(source.robux) || 0));
  const sendLimit = Math.max(0, Math.round(Number(source.sendLimit) || 0));
  const sendLimitUsed = Math.max(0, Math.round(Number(source.sendLimitUsed) || 0));
  if (robuxSold > availableRobux) throw new Error('Source account does not have enough Robux');
  if (robuxSold > Math.max(0, sendLimit - sendLimitUsed)) throw new Error('Sale exceeds the remaining send limit');
  const updatedAccount = { ...source, robux:availableRobux - robuxSold, sendLimitUsed:sendLimitUsed + robuxSold };
  const sale = {
    id:`sale-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`, accountId:source.id,
    usernameSource:source.username, robuxSold, rate, price:robuxSold * rate, createdAt:now.toISOString()
  };
  return { accounts:accounts.map(account => account.id === source.id ? updatedAccount : account), updatedAccount, sale };
}

async function requestJson(request, maxBytes = 1000000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

export async function fetchPublicRobloxAccount(username, fetcher = fetch) {
  const lookupResponse = await fetcher('https://users.roblox.com/v1/usernames/users', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ usernames:[username], excludeBannedUsers:true }), signal:AbortSignal.timeout(20000)
  });
  if (!lookupResponse.ok) throw new Error(`Roblox username lookup returned HTTP ${lookupResponse.status}`);
  const lookup = await lookupResponse.json();
  const user = lookup.data?.[0];
  if (!user) return null;
  const thumbnailResponse = await fetcher(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`, { signal:AbortSignal.timeout(20000) });
  const thumbnail = thumbnailResponse.ok ? await thumbnailResponse.json() : { data:[] };
  const limitedItems = [];
  let limitedRapTotal = 0;
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ sortOrder:'Asc', limit:'100' });
    if (cursor) params.set('cursor', cursor);
    const inventoryResponse = await fetcher(`https://inventory.roblox.com/v1/users/${user.id}/assets/collectibles?${params}`, { signal:AbortSignal.timeout(20000) });
    if (!inventoryResponse.ok) break;
    const inventory = await inventoryResponse.json();
    limitedItems.push(...(inventory.data || []).map(item => item.name).filter(Boolean));
    limitedRapTotal += (inventory.data || []).reduce((sum, item) => sum + (Number(item.recentAveragePrice) || 0), 0);
    cursor = inventory.nextPageCursor || '';
    if (!cursor) break;
  }
  return {
    robloxUserId:String(user.id), username:user.name, displayName:user.displayName || user.name,
    profileUrl:`https://www.roblox.com/users/${user.id}/profile`, avatarUrl:thumbnail.data?.[0]?.imageUrl || '', limitedItems, limitedRapTotal
  };
}

export async function fetchCurrentRap(name, existingAssetId = null, fetcher = fetch, existingCollectibleItemId = null, category = null, existingBundleId = null) {
  let assetId = existingAssetId;
  let collectibleItemId = existingCollectibleItemId;
  let bundleId = existingBundleId;
  if (!assetId) {
    const normalized = name.trim().toLocaleLowerCase();
    const isFace = String(category || '').toLocaleLowerCase() === 'face';
    const searches = isFace
      ? [{ version:'v2', params:new URLSearchParams({ Category:'1', CreatorName:'Roblox', Keyword:name, Limit:'30' }), allowBundle:true }]
      : [{ version:'v1', params:new URLSearchParams({ Category:'1', Keyword:name, Limit:'30' }), allowBundle:false }];
    let match = null;
    for (const { version, params, allowBundle } of searches) {
      const catalog = await fetchJson(`https://catalog.roblox.com/${version}/search/items/details?${params}`, fetcher);
      match = (catalog.data || []).find(item =>
        [normalized, `${normalized} head`].includes(String(item.name || '').trim().toLocaleLowerCase()) &&
        String(item.creatorName || '').toLocaleLowerCase() === 'roblox' &&
        ['asset', ...(allowBundle ? ['bundle'] : [])].includes(String(item.itemType || 'Asset').toLocaleLowerCase())
      );
      if (match) break;
    }
    if (!match) return { assetId:null, bundleId:null, collectibleItemId:null, rap:null, status:'unmatched', checkedAt:Date.now() };
    if (String(match.itemType || 'Asset').toLocaleLowerCase() === 'bundle') {
      bundleId = match.id;
      const bundle = await fetchJson(`https://catalog.roblox.com/v1/bundles/${match.id}/details`, fetcher);
      collectibleItemId = bundle.collectibleItemDetail?.collectibleItemId || bundle.collectibleItemId || null;
      const bundledAsset = (bundle.items || bundle.bundledItems || []).find(item =>
        String(item.type || '').toLocaleLowerCase() === 'asset' && (() => {
          const itemName = String(item.name || '').trim().toLocaleLowerCase();
          return itemName === normalized || (itemName.includes(normalized) && itemName.includes('head'));
        })()
      );
      assetId = bundledAsset?.id || bundledAsset?.Id || null;
    } else assetId = match.id;
    if (!assetId) return { assetId:null, bundleId, collectibleItemId:null, rap:null, status:'unmatched', checkedAt:Date.now() };
  }
  if (!collectibleItemId) {
    const details = await fetchJson(`https://economy.roblox.com/v2/assets/${assetId}/details`, fetcher);
    collectibleItemId = details.CollectibleItemId || details.collectibleItemId || null;
  }
  if (!collectibleItemId) return { assetId, bundleId, collectibleItemId:null, rap:null, status:'unavailable', checkedAt:Date.now() };
  const resale = await fetchJson(`https://apis.roblox.com/marketplace-sales/v1/item/${collectibleItemId}/resale-data`, fetcher);
  const sales = calculateAverageDailySales(resale.volumeDataPoints || []);
  return {
    assetId,
    bundleId,
    collectibleItemId,
    rap: Number.isFinite(resale.recentAveragePrice) ? resale.recentAveragePrice : null,
    sales30d: sales.total,
    avgDailySales30d: sales.average,
    status: Number.isFinite(resale.recentAveragePrice) ? 'current' : 'unavailable',
    checkedAt: Date.now()
  };
}

export async function fetchCurrentRapByName(name, fetcher = fetch) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Item name is required');
  const regular = await fetchCurrentRap(trimmedName, null, fetcher);
  if (regular.status !== 'unmatched') return regular;
  return fetchCurrentRap(trimmedName, null, fetcher, null, 'Face');
}

export function calculateAverageDailySales(points, now = Date.now()) {
  const dayMs = 86400000;
  const todayUtc = Math.floor(now / dayMs) * dayMs;
  const cutoff = todayUtc - 29 * dayMs;
  const total = points.reduce((sum, point) => {
    const date = Date.parse(point.date);
    const value = Number(point.value);
    return date >= cutoff && date <= todayUtc && Number.isFinite(value) ? sum + value : sum;
  }, 0);
  return { total, average: Math.round(total / 30 * 100) / 100 };
}

export function calculateRobuxSell(rap) {
  const value = Number(rap);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 0.7) : null;
}

function queueRapUpdates(items) {
  const now = Date.now();
  const cheapestByName = new Map();
  for (const item of items) {
    categoryByName.set(item.item_name, item.category || null);
    const price = Number(item.price_usd || Infinity);
    if (!cheapestByName.has(item.item_name) || price < cheapestByName.get(item.item_name)) cheapestByName.set(item.item_name, price);
  }
  const namesByLowestPrice = [...cheapestByName].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  for (const name of namesByLowestPrice) {
    const known = robloxData.get(name);
    if ((!known || now - known.checkedAt >= RAP_TTL) && !queuedNames.has(name)) {
      queuedNames.add(name); robloxQueue.push(name);
    }
  }
  robloxQueue.sort((a, b) => (cheapestByName.get(a) ?? Infinity) - (cheapestByName.get(b) ?? Infinity));
  if (!queueRunning && robloxQueue.length) void processRapQueue();
}

async function processRapQueue() {
  queueRunning = true;
  while (robloxQueue.length) {
    const name = robloxQueue.shift();
    const existing = robloxData.get(name);
    try { robloxData.set(name, await fetchCurrentRap(name, existing?.assetId, fetch, existing?.collectibleItemId, categoryByName.get(name), existing?.bundleId)); }
    catch { robloxData.set(name, { assetId:existing?.assetId || null, bundleId:existing?.bundleId || null, collectibleItemId:existing?.collectibleItemId || null, rap:null, status:'retrying', checkedAt:Date.now() - RAP_TTL + 30000 }); }
    queuedNames.delete(name);
    await wait(750);
  }
  queueRunning = false;
}

export async function scanAll(force = false, fetcher = fetch, updateRap = true, forceRap = false) {
  const now = Date.now();
  if (forceRap) {
    for (const value of robloxData.values()) value.checkedAt = 0;
  }
  if (!force && cache.items.length && now - cache.at < CACHE_TTL) {
    const items = cache.items.map(item => ({ ...item }));
    if (updateRap) { queueRapUpdates(items); applyCurrentRap(items); }
    return { items, cached: true };
  }
  const items = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ market: 'limiteds', sort: 'popular', page: String(page), limit: '40' });
    const response = await fetcher(`${API_URL}?${params}`, { headers: { 'User-Agent': 'LimitedsMarketScanner/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`);
    const data = await response.json();
    items.push(...(data.listings || []));
    if (page >= Number(data.totalPages || 1)) break;
    page++;
  }
  const idrRate = await getIdrRate(force, fetcher);
  for (const item of items) {
    const price = Number(item.price_usd || 0);
    item.market_rap = Number(item.rap || 0);
    item.item_name = String(item.item_name || 'Unknown').trim();
    item.idr_rate = idrRate;
    item.price_idr = Math.round(price * idrRate);
    item.after_tax_idr = Math.round(price * idrRate * 1.053);
    item.listing_url = `${BASE_URL}/listing/${item.id || ''}`;
  }
  if (fetcher === fetch) await applySellerMapping(items);
  if (updateRap) { queueRapUpdates(items); applyCurrentRap(items); }
  cache.at = now; cache.items = items;
  return { items, cached: false };
}

export function clearCache() { cache.at = 0; cache.items = []; currencyCache.at = 0; currencyCache.idrRate = null; robloxData.clear(); robloxQueue.length = 0; queuedNames.clear(); categoryByName.clear(); }

function applyCurrentRap(items) {
  for (const item of items) {
    const current = robloxData.get(item.item_name);
    const rap = Number(current?.rap || 0);
    item.rap = current?.rap ?? null;
    item.robux_sell = calculateRobuxSell(current?.rap);
    item.rap_status = current?.status || (queuedNames.has(item.item_name) ? 'updating' : 'queued');
    item.roblox_asset_id = current?.assetId || null;
    item.roblox_bundle_id = current?.bundleId || null;
    item.roblox_collectible_item_id = current?.collectibleItemId || null;
    item.roblox_url = current?.bundleId
      ? `https://www.roblox.com/bundles/${current.bundleId}`
      : current?.assetId ? `https://www.roblox.com/catalog/${current.assetId}` : null;
    item.rolimons_url = current?.bundleId
      ? `https://www.rolimons.com/bundle/${current.bundleId}`
      : current?.assetId ? `https://www.rolimons.com/item/${current.assetId}` : null;
    item.rap_checked_at = current?.checkedAt ? new Date(current.checkedAt).toISOString() : null;
    item.sales_30d = current?.sales30d ?? null;
    item.avg_daily_sales_30d = current?.avgDailySales30d ?? null;
    item.idr_per_1k_rap = rap ? Math.round(item.after_tax_idr * 1000 / rap) : null;
  }
}

const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/roblox/account') {
    try {
      const username = String(url.searchParams.get('username') || '').trim();
      if (!username) return json(res, 400, { error:'Roblox username is required.' });
      const account = await fetchPublicRobloxAccount(username, fetch);
      return account ? json(res, 200, account) : json(res, 404, { error:'Roblox username was not found.' });
    } catch (error) { return json(res, 502, { error:`Roblox account lookup failed: ${error.message}` }); }
  }
  if (url.pathname === '/api/accounts' && req.method === 'GET') {
    try { return json(res, 200, { accounts:await readAccounts() }); }
    catch (error) { return json(res, 500, { error:`Account data could not be read: ${error.message}` }); }
  }
  if (url.pathname === '/api/accounts' && req.method === 'PUT') {
    try {
      const body = await requestJson(req);
      if (!Array.isArray(body?.accounts)) return json(res, 400, { error:'accounts must be an array' });
      await writeAccounts(body.accounts);
      return json(res, 200, { saved:true, count:body.accounts.length });
    } catch (error) { return json(res, 400, { error:`Account data could not be saved: ${error.message}` }); }
  }
  if (url.pathname === '/api/robux-sales' && req.method === 'GET') {
    try { return json(res, 200, { sales:await readRobuxSales() }); }
    catch (error) { return json(res, 500, { error:`Robux sales could not be read: ${error.message}` }); }
  }
  if (url.pathname === '/api/robux-sales' && req.method === 'POST') {
    try {
      const input = await requestJson(req);
      const accounts = await readAccounts();
      const result = applyRobuxSale(accounts, input);
      const sales = await readRobuxSales();
      await writeRobuxSales([result.sale, ...sales]);
      try { await writeAccounts(result.accounts); }
      catch (error) { await writeRobuxSales(sales); throw error; }
      return json(res, 201, { sale:result.sale, account:result.updatedAccount });
    } catch (error) { return json(res, 400, { error:error.message }); }
  }
  if (url.pathname === '/api/roblox/rap') {
    try {
      const name = String(url.searchParams.get('name') || '').trim();
      const result = await fetchCurrentRapByName(name, fetch);
      if (!Number.isFinite(result.rap)) return json(res, 404, { error:'Current RAP was not found for that exact item name.' });
      return json(res, 200, result);
    } catch (error) { return json(res, 502, { error:`RAP lookup failed: ${error.message}` }); }
  }
  if (url.pathname === '/api/limited-purchases' && req.method === 'GET') {
    try { return json(res, 200, { purchases:await readLimitedPurchases() }); }
    catch (error) { return json(res, 500, { error:`Limited purchases could not be read: ${error.message}` }); }
  }
  if (url.pathname === '/api/limited-purchases' && req.method === 'POST') {
    try {
      const purchase = createLimitedPurchase(await requestJson(req));
      const purchases = await readLimitedPurchases();
      await writeLimitedPurchases([purchase, ...purchases]);
      return json(res, 201, { purchase });
    } catch (error) { return json(res, 400, { error:error.message }); }
  }
  if (url.pathname === '/api/scan') {
    const started = performance.now();
    try {
      const force = url.searchParams.get('refresh') === '1';
      const result = await scanAll(force, fetch, true, force);
      return json(res, 200, { ...result, total: result.items.length, scanned_at: new Date().toISOString(), duration_ms: Math.round(performance.now() - started) });
    } catch (error) { return json(res, 502, { error: `Market scan failed: ${error.message}` }); }
  }
  try {
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
    const body = await readFile(join(ROOT, safe));
    res.writeHead(200, { 'Content-Type': types[extname(safe)] || 'application/octet-stream', 'Cache-Control':'no-cache' }); res.end(body);
  } catch { res.writeHead(404, { 'Content-Type':'text/plain' }); res.end('Not found'); }
});

function json(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(body); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8000);
  server.listen(port, '127.0.0.1', () => console.log(`Limiteds scanner running at http://127.0.0.1:${port}`));
}
