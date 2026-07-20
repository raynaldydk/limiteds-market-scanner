import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://limitedsmarket.com';
const API_URL = `${BASE_URL}/api/listings`;
const ROOT = fileURLToPath(new URL('./static/', import.meta.url));
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 30) * 1000;
const cache = { at: 0, items: [] };
const currencyCache = { at: 0, idrRate: null };
const CURRENCY_TTL = Number(process.env.CURRENCY_TTL_SECONDS || 3600) * 1000;
const robloxData = new Map();
const robloxQueue = [];
const queuedNames = new Set();
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

export async function fetchCurrentRap(name, existingAssetId = null, fetcher = fetch, existingCollectibleItemId = null) {
  let assetId = existingAssetId;
  let collectibleItemId = existingCollectibleItemId;
  if (!assetId) {
    const params = new URLSearchParams({ Category:'1', Keyword:name, Limit:'10' });
    const catalog = await fetchJson(`https://catalog.roblox.com/v1/search/items/details?${params}`, fetcher);
    const normalized = name.trim().toLocaleLowerCase();
    const match = (catalog.data || []).find(item =>
      String(item.name || '').trim().toLocaleLowerCase() === normalized && item.creatorName === 'Roblox'
    );
    if (!match) return { assetId:null, collectibleItemId:null, rap:null, status:'unmatched', checkedAt:Date.now() };
    assetId = match.id;
  }
  if (!collectibleItemId) {
    const details = await fetchJson(`https://economy.roblox.com/v2/assets/${assetId}/details`, fetcher);
    collectibleItemId = details.CollectibleItemId || details.collectibleItemId || null;
  }
  if (!collectibleItemId) return { assetId, collectibleItemId:null, rap:null, status:'unavailable', checkedAt:Date.now() };
  const resale = await fetchJson(`https://apis.roblox.com/marketplace-sales/v1/item/${collectibleItemId}/resale-data`, fetcher);
  return {
    assetId,
    collectibleItemId,
    rap: Number.isFinite(resale.recentAveragePrice) ? resale.recentAveragePrice : null,
    status: Number.isFinite(resale.recentAveragePrice) ? 'current' : 'unavailable',
    checkedAt: Date.now()
  };
}

function queueRapUpdates(items) {
  const now = Date.now();
  const cheapestByName = new Map();
  for (const item of items) {
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
    try { robloxData.set(name, await fetchCurrentRap(name, existing?.assetId, fetch, existing?.collectibleItemId)); }
    catch { robloxData.set(name, { assetId:existing?.assetId || null, collectibleItemId:existing?.collectibleItemId || null, rap:null, status:'retrying', checkedAt:Date.now() - RAP_TTL + 30000 }); }
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
  if (updateRap) { queueRapUpdates(items); applyCurrentRap(items); }
  cache.at = now; cache.items = items;
  return { items, cached: false };
}

export function clearCache() { cache.at = 0; cache.items = []; currencyCache.at = 0; currencyCache.idrRate = null; robloxData.clear(); robloxQueue.length = 0; queuedNames.clear(); }

function applyCurrentRap(items) {
  for (const item of items) {
    const current = robloxData.get(item.item_name);
    const rap = Number(current?.rap || 0);
    item.rap = current?.rap ?? null;
    item.rap_status = current?.status || (queuedNames.has(item.item_name) ? 'updating' : 'queued');
    item.roblox_asset_id = current?.assetId || null;
    item.roblox_collectible_item_id = current?.collectibleItemId || null;
    item.rap_checked_at = current?.checkedAt ? new Date(current.checkedAt).toISOString() : null;
    item.idr_per_1k_rap = rap ? Math.round(item.price_idr * 1000 / rap) : null;
  }
}

const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
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
