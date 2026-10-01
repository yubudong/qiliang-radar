import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots } from '../src/core.mjs';
import { createStorage } from '../src/storage.mjs';

const identity = (goodsId='g1', shopId='s1') => ({ market:'US', language:'zh-Hans', shopId, goodsId, shopName:'Shop', title:'Item', productUrl:`https://www.temu.com/item-g-${goodsId}.html?track=private` });
const list = (capturedAt, value) => ({ kind:'list', data:{ capturedAt, rawText:`已售${value}件`, value, precision:'number', metricVersion:'shop-sales-v1' } });
const memory = () => { const map = new Map(); return { map, api:{ getValue:async (key, fallback)=>map.has(key)?structuredClone(map.get(key)):fallback, setValue:async (key,value)=>{map.set(key,structuredClone(value));}, listValues:async()=>[...map.keys()] } }; };

test('daily merge keeps latest valid source and records failure without replacing it', async () => {
  const { api } = memory(); const storage = createStorage(api, { canWrite:()=>true, now:()=>new Date('2026-09-12T05:00:00Z') });
  await storage.saveDailyReading(identity(), list('2026-09-10T16:10:00Z',60));
  await storage.saveDailyReading(identity(), list('2026-09-11T16:10:00Z',80));
  await storage.saveDailyReading(identity(), list('2026-09-12T01:00:00Z',90));
  await storage.saveDailyReading(identity(), list('2026-09-11T23:00:00Z',85));
  await storage.recordFailure(identity(), '2026-09-12', '详情未取到');
  const yesterday = await storage.getSnapshot(identity(), '2026-09-11');
  const today = await storage.getSnapshot(identity(), '2026-09-12');
  assert.equal(yesterday.list.value, 60);
  assert.equal(today.list.value, 90);
  assert.equal(compareSnapshots(yesterday,today).delta, 30);
  assert.equal(today.lastAttempt.reasonCode, '详情未取到');
  assert.equal(today.productUrl, 'https://www.temu.com/item-g-g1.html');
});

test('list and detail retain independent latest timestamps and failed detail does not erase success', async () => {
  const { api } = memory(); const storage = createStorage(api, { canWrite:()=>true, now:()=>new Date('2026-09-12T05:00:00Z') });
  await storage.saveDailyReading(identity(), list('2026-09-12T01:00:00Z',90));
  await storage.saveDailyReading(identity(), {kind:'detail',data:{capturedAt:'2026-09-12T02:00:00Z',skuTotal:91,skuIds:['a'],skuCounts:{a:91},goodsDisplayValue:90,metricVersion:'sku-sold-quantity-v1',adapterVersion:'temu-detail-v1'}});
  await storage.recordFailure(identity(), '2026-09-12', '详情未取到');
  const value = await storage.getSnapshot(identity(), '2026-09-12');
  assert.equal(value.list.capturedAt, '2026-09-12T01:00:00Z');
  assert.equal(value.detail.capturedAt, '2026-09-12T02:00:00Z');
  assert.equal(value.detail.skuTotal, 91);
});

test('structured identity keys isolate site, shop, product and Beijing day', async () => {
  const { api } = memory(); const storage = createStorage(api, { canWrite:()=>true, now:()=>new Date() });
  await storage.saveDailyReading(identity('g:1','s|1'), list('2026-09-11T15:59:59Z',20));
  await storage.saveDailyReading(identity('g:1','s|2'), list('2026-09-11T16:00:00Z',30));
  assert.equal((await storage.listSnapshots({market:'US',language:'zh-Hans',shopId:'s|1'}, '2026-09-11')).length, 1);
  assert.equal((await storage.listSnapshots({market:'US',language:'zh-Hans',shopId:'s|2'}, '2026-09-12'))[0].list.value, 30);
});

test('identity is validated before key generation and returned identity retrieves the same record', async () => {
  const {api}=memory(); const storage=createStorage(api,{canWrite:()=>true,now:()=>new Date()});
  for (const bad of [{...identity(),goodsId:1},{...identity(),shopId:''},{...identity(),productUrl:'https://evil.test/x-g-g1.html'}]) {
    await assert.rejects(storage.saveDailyReading(bad,list('2026-09-12T01:00:00Z',1)),/商品身份无效/);
  }
  const saved=await storage.saveDailyReading(identity(),list('2026-09-12T01:00:00Z',1));
  assert.equal((await storage.getSnapshot(saved,'2026-09-12')).list.value,1);
});

test('malformed, failed, or incomplete newer readings cannot replace a valid source', async () => {
  const {api}=memory(); const storage=createStorage(api,{canWrite:()=>true,now:()=>new Date()});
  await storage.saveDailyReading(identity(),list('2026-09-12T01:00:00Z',90));
  const invalid=[
    {kind:'list',data:{capturedAt:'2026-09-12T02:00:00Z'}},
    {kind:'list',data:{capturedAt:'2026-09-12T02:00:00Z',rawText:'已售-1件',value:-1,precision:'unknown',metricVersion:'shop-sales-v1'}},
    {...list('2026-09-12T02:00:00Z',91),status:'failed'},
    {kind:'detail',data:{capturedAt:'2026-09-12T02:00:00Z',skuTotal:1,skuIds:['b','a'],skuCounts:{a:1,b:0},goodsDisplayValue:1,metricVersion:'sku-sold-quantity-v1',adapterVersion:'v1'}}
  ];
  for(const reading of invalid) await assert.rejects(storage.saveDailyReading(identity(),reading),/每日读数无效/);
  assert.equal((await storage.getSnapshot(identity(),'2026-09-12')).list.value,90);
});

test('writes require lock, reject storage failure and detect reread mismatch', async () => {
  const base = memory(); const unlocked = createStorage(base.api, {canWrite:()=>false,now:()=>new Date()});
  await assert.rejects(unlocked.saveDailyReading(identity(), list('2026-09-12T01:00:00Z',1)), /没有写入锁/);
  await assert.rejects(unlocked.saveRun({runId:'r'}), /没有写入锁/);
  await assert.rejects(unlocked.recordFailure(identity(),'2026-09-12','x'), /没有写入锁/);
  const rejected = createStorage({...base.api,setValue:async()=>{throw new Error('quota');}}, {canWrite:()=>true,now:()=>new Date()});
  await assert.rejects(rejected.saveDailyReading(identity(), list('2026-09-12T01:00:00Z',1)), /本地存储写入失败.*quota/);
  const mismatch = createStorage({...base.api,getValue:async()=>({tampered:true})}, {canWrite:()=>true,now:()=>new Date()});
  await assert.rejects(mismatch.saveRun({runId:'r',navigationUrl:'secret'}), /写后复读不一致/);
});

test('losing the lock during an awaited read prevents the physical write', async () => {
  let locked=true, writes=0;
  const api={getValue:async(_key,fallback)=>{locked=false;return fallback;},setValue:async()=>{writes++;},listValues:async()=>[]};
  const storage=createStorage(api,{canWrite:()=>locked,now:()=>new Date()});
  await assert.rejects(storage.saveDailyReading(identity(),list('2026-09-12T01:00:00Z',1)),/没有写入锁/);
  assert.equal(writes,0);
});

test('settings bypass run lock, run strips navigation URL and preserves successful history', async () => {
  const { api, map } = memory(); const storage = createStorage(api, {canWrite:()=>false,now:()=>new Date('2026-09-12T00:00:00Z')});
  await storage.saveSettings({minSales:25});
  assert.deepEqual(await storage.getSettings(), {schemaVersion:1,minSales:25,dayTimezone:'Asia/Shanghai'});
  const writable = createStorage(api, {canWrite:()=>true,now:()=>new Date('2026-09-12T01:00:00Z')});
  await writable.saveRun({runId:'ok',status:'completed',navigationUrl:'secret',currentTask:{goodsId:'g1',navigationUrl:'also-secret'}});
  await writable.saveRun({runId:'next',status:'running'});
  const run = await writable.getRun();
  assert.equal(run.current.runId, 'next');
  assert.equal(run.history[0].runId, 'ok');
  assert.equal(JSON.stringify([...map.values()]).includes('navigationUrl'), false);
});

test('settings normalize minimum sales and corrupted stored settings fall back safely', async () => {
  const {api,map}=memory(); const storage=createStorage(api,{canWrite:()=>false,now:()=>new Date()});
  for(const minSales of [-1,1.5,'abc']) await assert.rejects(storage.saveSettings({minSales}),/最低累计销量/);
  map.set('qiliang-radar:v1:settings',{schemaVersion:1,minSales:-2,dayTimezone:'bad'});
  const defaults={schemaVersion:1,minSales:20,dayTimezone:'Asia/Shanghai'};
  assert.deepEqual(await storage.getSettings(),defaults);
  assert.deepEqual(map.get('qiliang-radar:v1:settings'),defaults);
});
