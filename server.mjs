import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://limitedsmarket.com';
const API_URL = `${BASE_URL}/api/listings`;
const ROOT = fileURLToPath(new URL('./static/', import.meta.url));
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 30) * 1000;
const cache = { at: 0, items: [] };
const robloxData = new Map();
const robloxQueue = [];
const queuedNames = new Set();
const RAP_TTL = Number(process.env.RAP_TTL_SECONDS || 300) * 1000;
let queueRunning = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  for (const name of new Set(items.map(item => item.item_name))) {
    const known = robloxData.get(name);
    if ((!known || now - known.checkedAt >= RAP_TTL) && !queuedNames.has(name)) {
      queuedNames.add(name); robloxQueue.push(name);
    }
  }
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

export async function scanAll(force = false, fetcher = fetch, updateRap = true) {
  const now = Date.now();
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
  for (const item of items) {
    item.market_rap = Number(item.rap || 0);
    item.item_name = String(item.item_name || 'Unknown').trim();
    item.listing_url = `${BASE_URL}/listing/${item.id || ''}`;
  }
  if (updateRap) { queueRapUpdates(items); applyCurrentRap(items); }
  cache.at = now; cache.items = items;
  return { items, cached: false };
}

export function clearCache() { cache.at = 0; cache.items = []; robloxData.clear(); robloxQueue.length = 0; queuedNames.clear(); }

function applyCurrentRap(items) {
  for (const item of items) {
    const current = robloxData.get(item.item_name);
    const price = Number(item.price_usd || 0), rap = Number(current?.rap || 0);
    item.rap = current?.rap ?? null;
    item.rap_status = current?.status || (queuedNames.has(item.item_name) ? 'updating' : 'queued');
    item.roblox_asset_id = current?.assetId || null;
    item.roblox_collectible_item_id = current?.collectibleItemId || null;
    item.rap_checked_at = current?.checkedAt ? new Date(current.checkedAt).toISOString() : null;
    item.usd_per_1k_rap = rap ? Math.round(price * 10000000 / rap) / 10000 : null;
    item.rap_per_usd = price && rap ? Math.round(rap / price * 100) / 100 : null;
  }
}

const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/scan') {
    const started = performance.now();
    try {
      const result = await scanAll(url.searchParams.get('refresh') === '1');
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
