import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRobuxSale, calculateAverageDailySales, calculateRobuxSell, clearCache, fetchCurrentRap, fetchPublicRobloxAccount, scanAll } from '../server.mjs';

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

test('uses an official-Roblox catalog search for face RAP lookup', async () => {
  const urls = [];
  const replies = [
    {data:[
      {id:999,itemType:'Asset',assetType:42,name:'Playful Vampire',creatorName:'Copy Group'},
      {id:2409285794,itemType:'Asset',assetType:18,name:'Playful Vampire',creatorName:'Roblox'}
    ]},
    {CollectibleItemId:'face-collectible'},
    {recentAveragePrice:76543,volumeDataPoints:[]}
  ];
  let call = 0;
  const fetcher = async url => { urls.push(url); return {ok:true,json:async()=>replies[call++]}; };
  const result = await fetchCurrentRap('Playful Vampire', null, fetcher, null, 'Face');
  assert.match(urls[0], /\/v2\/search\/items\/details/);
  assert.match(urls[0], /CreatorName=Roblox/);
  assert.equal(result.assetId, 2409285794);
  assert.equal(result.rap, 76543);
});

test('falls back from a classic face to its official dynamic-head bundle', async () => {
  const urls = [];
  const replies = [
    {data:[{id:555,itemType:'Bundle',name:'Playful Vampire',creatorName:'Roblox'}]},
    {items:[{id:777,type:'Asset',name:'Playful Vampire Head'},{id:778,type:'Asset',name:'Playful Vampire Mood'}],collectibleItemDetail:{collectibleItemId:'dynamic-face-collectible'}},
    {recentAveragePrice:81234,volumeDataPoints:[]}
  ];
  let call = 0;
  const fetcher = async url => { urls.push(url); return {ok:true,json:async()=>replies[call++]}; };
  const result = await fetchCurrentRap('Playful Vampire', null, fetcher, null, 'Face');
  assert.match(urls[0], /\/v2\/search\/items\/details/);
  assert.match(urls[0], /CreatorName=Roblox/);
  assert.match(urls[1], /\/v1\/bundles\/555\/details/);
  assert.equal(result.assetId, 777);
  assert.equal(result.bundleId, 555);
  assert.equal(result.collectibleItemId, 'dynamic-face-collectible');
  assert.equal(result.rap, 81234);
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

test('calculates Robux sell as 70 percent of RAP rounded to zero decimals', () => {
  assert.equal(calculateRobuxSell(10001), 7001);
  assert.equal(calculateRobuxSell(null), null);
});

test('resolves a public Roblox account and collectible inventory by username', async () => {
  const urls = [];
  const replies = [
    {data:[{id:123,name:'ExampleUser',displayName:'Example'}]},
    {data:[{imageUrl:'https://tr.rbxcdn.com/avatar.png'}]},
    {data:[{name:'Limited One',recentAveragePrice:1200},{name:'Limited Two',recentAveragePrice:2300}],nextPageCursor:null}
  ];
  let call = 0;
  const fetcher = async (url, options) => { urls.push({url,options}); return {ok:true,json:async()=>replies[call++]}; };
  const account = await fetchPublicRobloxAccount('ExampleUser', fetcher);
  assert.match(urls[0].url, /usernames\/users/);
  assert.equal(JSON.parse(urls[0].options.body).usernames[0], 'ExampleUser');
  assert.equal(account.robloxUserId, '123');
  assert.equal(account.avatarUrl, 'https://tr.rbxcdn.com/avatar.png');
  assert.deepEqual(account.limitedItems, ['Limited One','Limited Two']);
  assert.equal(account.limitedRapTotal, 3500);
});

test('applies a Robux sale to balance and send-limit usage', () => {
  const accounts = [{id:'account-1',username:'SourceUser',robux:5000,sendLimit:10000,sendLimitUsed:2500}];
  const result = applyRobuxSale(accounts, {accountId:'account-1',robuxSold:1200,rate:135}, new Date('2026-07-20T12:00:00Z'));
  assert.equal(result.updatedAccount.robux, 3800);
  assert.equal(result.updatedAccount.sendLimitUsed, 3700);
  assert.equal(result.sale.price, 162000);
  assert.equal(result.sale.usernameSource, 'SourceUser');
});
