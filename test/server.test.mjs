import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlusExpirations, applyPurchaseToAccounts, applyRobuxSale, calculateAccountAssetValue, calculateAverageDailySales, calculateRobuxSell, clearCache, createAccountSnapshot, createLimitedPurchase, fetchCurrentRap, fetchCurrentRapByName, fetchPublicRobloxAccount, fetchRobloxCommunityIcon, scanAll, upsertAccountSnapshot } from '../server.mjs';

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

test('resolves a public Roblox community icon by ID', async () => {
  const fetcher = async url => {
    assert.match(url, /groupIds=123/);
    return {ok:true,json:async()=>({data:[{targetId:123,state:'Completed',imageUrl:'https://tr.rbxcdn.com/community.png'}]})};
  };
  const result = await fetchRobloxCommunityIcon('123', fetcher);
  assert.equal(result.iconUrl, 'https://tr.rbxcdn.com/community.png');
  assert.rejects(() => fetchRobloxCommunityIcon('not-an-id', fetcher), /numeric/);
});

test('applies a Robux sale to balance and send-limit usage', () => {
  const accounts = [{id:'account-1',username:'SourceUser',robux:5000,sendLimit:10000,sendLimitUsed:2500}];
  const result = applyRobuxSale(accounts, {accountId:'account-1',robuxSold:1200,rate:135}, new Date('2026-07-20T12:00:00Z'));
  assert.equal(result.updatedAccount.robux, 3800);
  assert.equal(result.updatedAccount.sendLimitUsed, 3700);
  assert.equal(result.sale.price, 162000);
  assert.equal(result.sale.usernameSource, 'SourceUser');
});

test('calculates a limited purchase break-even and profit estimate', () => {
  const purchase = createLimitedPurchase({ username:'Buyer', itemName:'Test Limited', rap:10000, purchasePrice:800000, rate:130, purchasedAt:'2026-07-20T12:00:00Z' }, new Date('2026-07-20T13:00:00Z'));
  assert.equal(purchase.minimumRobuxSell, 6154);
  assert.equal(purchase.robuxSell70, 7000);
  assert.equal(purchase.estimatedRevenue, 910000);
  assert.equal(purchase.profitEstimate, 110000);
  assert.equal(purchase.purchasedAt, '2026-07-20T12:00:00.000Z');
});

test('looks up purchase RAP by exact item name', async () => {
  const replies = [{data:[{id:42,name:'Test Hat',creatorName:'Roblox'}]},{CollectibleItemId:'collectible-42'},{recentAveragePrice:4321}];
  let call = 0;
  const result = await fetchCurrentRapByName('Test Hat', async () => ({ok:true,json:async()=>replies[call++]}));
  assert.equal(result.rap, 4321);
});

test('stores a subscription with only account, price, and date', () => {
  const purchase = createLimitedPurchase({ purchaseType:'subscription', username:'Subscriber', purchasePrice:75000, rate:130, purchasedAt:'2026-07-21T12:00:00Z' }, new Date('2026-07-21T13:00:00Z'));
  assert.equal(purchase.purchaseType, 'subscription');
  assert.equal(purchase.username, 'Subscriber');
  assert.equal(purchase.itemName, 'Roblox Plus');
  assert.equal(purchase.rap, null);
  assert.equal(purchase.profitEstimate, -75000);
});

test('treats an other purchase as a negative profit expense', () => {
  const purchase = createLimitedPurchase({ purchaseType:'other', itemName:'Operational expense', purchasePrice:36000, rate:130, purchasedAt:'2026-07-21T12:00:00Z' });
  assert.equal(purchase.profitEstimate, -36000);
});

test('expires Roblox Plus after 30 days', () => {
  const accounts = [{username:'Subscriber',plusStatus:'active',plusExpiresAt:'2026-08-20T12:00:00.000Z'}];
  assert.equal(applyPlusExpirations(accounts, new Date('2026-08-20T11:59:59.000Z')).accounts[0].plusStatus, 'active');
  const result = applyPlusExpirations(accounts, new Date('2026-08-20T12:00:00.000Z'));
  assert.equal(result.accounts[0].plusStatus, 'inactive');
  assert.equal(result.changed, true);
});

test('adds a Robux purchase to its Account Manager balance', () => {
  const purchase = createLimitedPurchase({ purchaseType:'robux', username:'Buyer', robuxAmount:1000, purchasePrice:135000, rate:135, purchasedAt:'2026-07-21T12:00:00Z' });
  assert.equal(purchase.itemName, '1,000 Robux');
  assert.equal(purchase.robuxAmount, 1000);
  assert.equal(purchase.profitEstimate, -135000);
  const result = applyPurchaseToAccounts([{username:'Buyer',robux:250}], purchase);
  assert.equal(result.updatedAccount.robux, 1250);
});

test('adds a purchased Roblox account to Account Manager', () => {
  const purchase = createLimitedPurchase({ purchaseType:'account', accountUsername:'NewOwner', purchasePrice:500000, rate:130, purchasedAt:'2026-07-21T12:00:00Z' });
  const publicAccount = {robloxUserId:'999',username:'NewOwner',displayName:'New Owner',avatarUrl:'avatar.png',profileUrl:'profile',limitedItems:['Hat'],limitedRapTotal:1234};
  const result = applyPurchaseToAccounts([], purchase, publicAccount);
  assert.equal(purchase.itemName, 'NewOwner Account');
  assert.equal(purchase.profitEstimate, -500000);
  assert.equal(result.updatedAccount.id, 'roblox-999');
  assert.equal(result.updatedAccount.limitedRapTotal, 1234);
  assert.equal(result.updatedAccount.robux, 0);
  assert.equal(result.updatedAccount.underage, false);
  assert.equal(result.updatedAccount.parent, false);
});

test('values accounts as assets from their send limit tier', () => {
  assert.equal(calculateAccountAssetValue(10000), 25000);
  assert.equal(calculateAccountAssetValue(45000), 25000);
  assert.equal(calculateAccountAssetValue(1000), 0);
  assert.equal(calculateAccountAssetValue(1000, true), 15000);
  assert.equal(calculateAccountAssetValue(10000, true), 15000);
});

test('creates portfolio snapshots and replaces only the automatic daily snapshot', () => {
  const account={username:'Owner',limitedRapTotal:10000,robux:100,robuxPending:50,sendLimit:10000,parent:false,plusStatus:'active'};
  const first=createAccountSnapshot([account],130,false,new Date('2026-07-22T01:00:00Z'));
  assert.equal(first.totalEstimatedRobux,7150);assert.equal(first.totalPortfolioIdr,954500);assert.equal(first.dateKey,'2026-07-22');
  const manual=createAccountSnapshot([account],130,true,new Date('2026-07-22T02:00:00Z'));
  const replacement=createAccountSnapshot([{...account,robux:200}],130,false,new Date('2026-07-22T03:00:00Z'));
  const snapshots=upsertAccountSnapshot(upsertAccountSnapshot([first],manual),replacement);
  assert.equal(snapshots.length,2);assert.equal(snapshots.filter(item=>item.manual).length,1);assert.equal(snapshots[0].totalEstimatedRobux,7250);
});

test('marks sssssssel6 as underage when purchasing the account', () => {
  const purchase = createLimitedPurchase({ purchaseType:'account', accountUsername:'sssssssel6', purchasePrice:500000, rate:130, purchasedAt:'2026-07-21T12:00:00Z' });
  const publicAccount = {robloxUserId:'1000',username:'sssssssel6',displayName:'Seller',avatarUrl:'avatar.png',profileUrl:'profile',limitedItems:[],limitedRapTotal:0};
  const result = applyPurchaseToAccounts([], purchase, publicAccount);
  assert.equal(result.updatedAccount.underage, true);
});

test('deducts a Robux-paid Limited purchase from its account', () => {
  const purchase = createLimitedPurchase({ purchaseType:'limited', paymentMethod:'robux', username:'Buyer', itemName:'Test Hat', rap:2000, robuxCost:1200, rate:135, purchasedAt:'2026-07-21T12:00:00Z' });
  assert.equal(purchase.purchasePrice, 162000);
  assert.equal(purchase.robuxCost, 1200);
  const result = applyPurchaseToAccounts([{username:'Buyer',robux:1500}], purchase);
  assert.equal(result.updatedAccount.robux, 300);
  assert.throws(() => applyPurchaseToAccounts([{username:'Buyer',robux:1000}], purchase), /enough Robux/);
});
