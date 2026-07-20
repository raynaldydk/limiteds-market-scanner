import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCache, scanAll } from '../server.mjs';

test('scans all pages and calculates metrics', async () => {
  clearCache(); let calls = 0;
  const pages = [
    { listings:[{ id:'a', item_name:' Hat ', price_usd:10, rap:5000 }], totalPages:2 },
    { listings:[{ id:'b', item_name:'Face', price_usd:4, rap:2000 }], totalPages:2 }
  ];
  const fetcher = async () => ({ ok:true, json:async () => pages[calls++] });
  const { items, cached } = await scanAll(false, fetcher);
  assert.equal(cached, false); assert.equal(items.length, 2); assert.equal(calls, 2);
  assert.equal(items[0].item_name, 'Hat'); assert.equal(items[0].usd_per_1k_rap, 2);
});

test('uses cache within TTL', async () => {
  clearCache(); let calls = 0;
  const fetcher = async () => { calls++; return { ok:true, json:async()=>({ listings:[{id:'a',price_usd:1,rap:1}], totalPages:1 }) }; };
  await scanAll(false, fetcher); const result = await scanAll(false, fetcher);
  assert.equal(result.cached, true); assert.equal(calls, 1);
});
