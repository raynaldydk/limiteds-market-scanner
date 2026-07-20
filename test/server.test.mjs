import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAverageDailySales, clearCache, fetchCurrentRap, scanAll } from '../server.mjs';

test('scans all pages and calculates metrics', async () => {
  clearCache(); let calls = 0;
  const pages = [
    { listings:[{ id:'a', item_name:' Hat ', price_usd:10, rap:5000 }], totalPages:2 },
    { listings:[{ id:'b', item_name:'Face', price_usd:4, rap:2000 }], totalPages:2 },
    { IDR:16000 }
  ];
  const fetcher = async () => ({ ok:true, json:async () => pages[calls++] });
  const { items, cached } = await scanAll(false, fetcher, false);
  assert.equal(cached, false); assert.equal(items.length, 2); assert.equal(calls, 3);
  assert.equal(items[0].item_name, 'Hat'); assert.equal(items[0].market_rap, 5000);
  assert.equal(items[0].price_idr, 160000); assert.equal(items[0].after_tax_idr, 168480);
});

test('uses cache within TTL', async () => {
  clearCache(); let calls = 0;
  const replies = [{ listings:[{id:'a',price_usd:1,rap:1}], totalPages:1 }, { IDR:16000 }];
  const fetcher = async () => ({ ok:true, json:async()=>replies[calls++] });
  await scanAll(false, fetcher, false); const result = await scanAll(false, fetcher, false);
  assert.equal(result.cached, true); assert.equal(calls, 2);
});

test('gets current RAP for the exact official Roblox asset', async () => {
  const replies = [
    {data:[{id:1,name:'Test Hat',creatorName:'Copy Group'},{id:42,name:'Test Hat',creatorName:'Roblox'}]},
    {CollectibleItemId:'collectible-42'},
    {recentAveragePrice:9876}
  ]; let call = 0;
  const fetcher = async () => ({ok:true,json:async()=>replies[call++]});
  const result = await fetchCurrentRap('Test Hat', null, fetcher);
  assert.equal(result.assetId, 42); assert.equal(result.collectibleItemId, 'collectible-42');
  assert.equal(result.rap, 9876); assert.equal(result.status, 'current');
});

test('calculates trailing 30-day average daily sales', () => {
  const now = Date.UTC(2026, 6, 20, 12);
  const points = [
    {date:'2026-07-20T00:00:00Z',value:1},
    {date:'2026-07-01T00:00:00Z',value:2},
    {date:'2026-06-20T00:00:00Z',value:99}
  ];
  assert.deepEqual(calculateAverageDailySales(points, now), {total:3, average:0.1});
});
