import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://limitedsmarket.com';
const API_URL = `${BASE_URL}/api/listings`;
const ROOT = fileURLToPath(new URL('./static/', import.meta.url));
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 30) * 1000;
const cache = { at: 0, items: [] };

export async function scanAll(force = false, fetcher = fetch) {
  const now = Date.now();
  if (!force && cache.items.length && now - cache.at < CACHE_TTL) return { items: [...cache.items], cached: true };
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
    const price = Number(item.price_usd || 0), rap = Number(item.rap || 0);
    item.item_name = String(item.item_name || 'Unknown').trim();
    item.usd_per_1k_rap = rap ? Math.round(price * 10000000 / rap) / 10000 : null;
    item.rap_per_usd = price ? Math.round(rap / price * 100) / 100 : null;
    item.listing_url = `${BASE_URL}/listing/${item.id || ''}`;
  }
  cache.at = now; cache.items = items;
  return { items, cached: false };
}

export function clearCache() { cache.at = 0; cache.items = []; }

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
