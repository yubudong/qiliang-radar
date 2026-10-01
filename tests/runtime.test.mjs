import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/storage.mjs';
const mod = await import('../src/runtime.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const { createRuntime, taskKeys, addTaskMarker, parseTaskMarker } = mod;
const flush = async () => { for (let i=0;i<100;i++) await Promise.resolve(); };
const context = {market:'US',language:'zh-Hans',shopId:'shop-1',shopName:'Test shop'};
const card = (goodsId,value=11000) => ({goodsId,title:`Item ${goodsId}`,productUrl:`https://www.temu.com/item-g-${goodsId}.html`,navigationUrl:`https://www.temu.com/item-g-${goodsId}.html?source=shop`,list:{capturedAt:'2026-09-12T04:00:00.000Z',rawText:`已售${value}`,value,precision:'number',metricVersion:'shop-sales-v1'}});
const identity = goodsId => ({...context,goodsId,title:`Item ${goodsId}`,productUrl:`https://www.temu.com/item-g-${goodsId}.html`});
const detail = {capturedAt:'2026-09-12T04:00:00.000Z',skuTotal:11285,skuIds:['sku-1'],skuCounts:{'sku-1':11285},goodsDisplayValue:11000,metricVersion:'sku-sold-quantity-v1',adapterVersion:'test-v1'};
function clock() {
  let time=Date.parse('2026-09-12T04:00:00.000Z'),seq=0; const timers=new Map();
  return {now:()=>new Date(time),setTimeout(fn,ms){const id=++seq;timers.set(id,{at:time+ms,fn});return id;},clearTimeout(id){timers.delete(id);},async advance(ms){const end=time+ms;await flush();while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at).find(([,t])=>t.at<=end);if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}time=end;await flush();},jump(iso){time=Date.parse(iso);}};
}
function locks() {
  let owner=false;return {get held(){return owner;},async request(name,options,callback){assert.equal(name,'qiliang-radar:v1:writer');assert.equal(options.ifAvailable,true);if(owner)return callback(null);owner=true;try{return await callback({name});}finally{owner=false;}}};
}
function gmStore(){
  const values=new Map(),listeners=new Map(),pastListeners=[];let seq=0;
  const api={values,listeners,pastListeners,failKey:null,onSet:null,onListen:null,
    async getValue(key,fallback=null){await api.onGet?.(key);return structuredClone(values.has(key)?values.get(key):fallback);},
    async setValue(key,value){if(api.failKey?.(key))throw new Error('disk full');const old=values.get(key);values.set(key,structuredClone(value));for(const [,l] of listeners)if(l.key===key)l.callback(key,old,structuredClone(value),true);await api.onSet?.(key,value);},
    async listValues(){return [...values.keys()];},
    addValueChangeListener(key,callback){const id=++seq;listeners.set(id,{key,callback});pastListeners.push({key,callback});api.onListen?.(key);return id;},
    removeValueChangeListener(id){listeners.delete(id);}
  };return api;
}
function harness({enableDetail=true,gm=gmStore(),lock=locks(),time=clock(),cards=[card('606196396351614')],readCards,clickMore,scrollList,openBehavior,config={}}={}) {
  assert.equal(typeof createRuntime,'function','createRuntime must exist');
  let runtime;const pages=[],events=[];let ids=0;
  const storage=createStorage(gm,{canWrite:()=>runtime?.canWrite?.()??runtime?.ownsLock()??false,now:time.now});
  const deps={enableDetail,storage,gm:{...gm,async openInTab(url){const page={url,closed:false,close(){throw new Error('runtime must not close a handle');}};pages.push(page);events.push(['open',time.now().getTime()]);if(openBehavior)return openBehavior(page,gm);return page;}},locks:lock,readCards:readCards??(async()=>({ok:true,cards,errors:[],seenGoodsIds:cards.map(c=>c.goodsId),hasMore:false,reportedTotal:cards.length})),clickMore:clickMore??(async()=>{}),scrollList,onState:s=>events.push(['state',s.status,s.reason]),now:time.now,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,createId:()=>`id-${++ids}`,config};
  runtime=createRuntime(deps);
  const result=async(extra={})=>{const task=runtime.getState().currentTask;assert.ok(task);const payload={runId:task.runId,taskId:task.taskId,workerInstanceId:'worker-1',goodsId:task.goodsId,...context,day:'2026-09-12',ok:true,detail,...extra};await gm.setValue(taskKeys(task.runId,task.taskId).result,payload);await flush();return payload;};
  return {runtime,storage,gm,lock,time,pages,events,result};
}
async function start(h){assert.equal((await h.runtime.startRun(context,{minSales:20})).ok,true);await flush();}
async function stop(h){await h.runtime.endRun();await flush();}

test('task fragments round-trip and preserve unrelated site fragments by refusing them',()=>{
  assert.equal(typeof addTaskMarker,'function');
  const url=addTaskMarker('https://www.temu.com/a-g-123.html?a=1',{runId:'r-1',taskId:'t-1'});
  assert.deepEqual(parseTaskMarker(url),{runId:'r-1',taskId:'t-1'});
  assert.equal(parseTaskMarker('https://www.temu.com/a#other'),null);
  assert.equal(parseTaskMarker('https://www.temu.com/a#qiliang-radar=%7B%22runId%22%3A%22%22%7D'),null);
  assert.throws(()=>addTaskMarker('https://www.temu.com/a#site-route',{runId:'r',taskId:'t'}));
  assert.deepEqual(taskKeys('r','t'),{task:'qiliang-radar:v1:task:r:t',result:'qiliang-radar:v1:result:r:t',ack:'qiliang-radar:v1:ack:r:t'});
});

test('double click and two master pages share one writer; pause retains it and end releases it',async()=>{
  const gm=gmStore(),lock=locks(),h=harness({gm,lock}),other=harness({gm,lock});
  const first=h.runtime.startRun(context,{minSales:20});
  assert.equal((await h.runtime.startRun(context,{minSales:20})).ok,false);
  await first;await flush();assert.equal(h.pages.length,1);
  assert.equal((await other.runtime.startRun(context,{minSales:20})).ok,false);
  await h.runtime.pauseRun();assert.equal(h.runtime.ownsLock(),true);assert.equal(lock.held,true);
  await h.runtime.resumeRun();assert.equal(h.runtime.ownsLock(),true);assert.equal(h.pages.length,1);
  await stop(h);assert.equal(lock.held,false);assert.equal(h.runtime.ownsLock(),false);
});

test('daily threshold is fixed, repeated cards save once, unknowns count toward seen but not qualified',async()=>{
  const entries=[card('101',19),card('102',20),card('103',21),card('102',20)];
  const h=harness({cards:entries,readCards:async()=>({ok:true,cards:entries,errors:[{goodsId:'104',reason:'unknown-sales'}],seenGoodsIds:['101','102','103','104'],hasMore:false,reportedTotal:4})});
  await start(h);const snapshots=await h.storage.listSnapshots(context,'2026-09-12');
  assert.deepEqual(snapshots.map(s=>s.goodsId).sort(),['102','103']);assert.equal(h.runtime.getState().discoveredGoodsIds.length,4);assert.equal(h.runtime.getState().listComplete,true);assert.equal(h.runtime.getState().status,'completed');assert.equal(h.lock.held,false);
});

test('clicks load more only once until new cards arrive and marks incomplete after bounded no-progress wait',async()=>{
  let clicks=0;const h=harness({readCards:async()=>({ok:true,cards:[card('101',30)],seenGoodsIds:['101'],errors:[],hasMore:true,moreButton:{},reportedTotal:2}),clickMore:async()=>{clicks++;}});
  await start(h);assert.equal(clicks,1);await h.time.advance(30000);
  assert.equal(clicks,1);assert.equal(h.runtime.getState().listComplete,false);assert.equal(h.runtime.getState().status,'completed');assert.equal(h.pages.length,0);
});

test('list scan saves newly loaded cards and only complete count plus no-more proves completeness',async()=>{
  let loaded=false;const h=harness({readCards:async()=>({ok:true,cards:loaded?[card('101',30),card('102',40)]:[card('101',30)],seenGoodsIds:loaded?['101','102']:['101'],errors:[],hasMore:!loaded,moreButton:loaded?null:{},reportedTotal:2}),clickMore:async()=>{loaded=true;}});
  await start(h);await h.time.advance(500);assert.equal((await h.storage.listSnapshots(context)).length,2);assert.equal(h.runtime.getState().listComplete,true);
});

test('result saved and reread before ack; next page waits for closure plus interval',async()=>{
  const h=harness({cards:[card('101'),card('102')]});await start(h);const task=h.runtime.getState().currentTask;
  h.gm.onSet=async(key,value)=>{if(key===taskKeys(task.runId,task.taskId).ack){const saved=await h.storage.getSnapshot(identity('101'),'2026-09-12');assert.equal(saved.detail.skuTotal,11285);assert.equal(value.workerInstanceId,'worker-1');}};
  await h.result();assert.equal(h.pages.length,1);assert.equal((await h.storage.getSnapshot(identity('101'),'2026-09-12')).detail.skuTotal,11285);
  await h.time.advance(4000);assert.equal(h.pages.length,1);
  h.pages[0].closed=true;await h.time.advance(250);await h.time.advance(2999);assert.equal(h.pages.length,1);await h.time.advance(1);assert.equal(h.pages.length,2);await stop(h);
});

test('duplicate result cannot rewrite daily detail or bind a different document instance',async()=>{
  const h=harness();await start(h);const result=await h.result();const keys=taskKeys(result.runId,result.taskId);
  await h.gm.setValue(keys.result,{...result,detail:{...detail,skuTotal:99999,capturedAt:'2026-09-12T05:00:00.000Z'}});await h.gm.setValue(keys.result,{...result,workerInstanceId:'other',detail:{...detail,skuTotal:99999}});await flush();
  assert.equal((await h.storage.getSnapshot(identity(result.goodsId),'2026-09-12')).detail.skuTotal,11285);assert.equal((await h.gm.getValue(keys.ack)).workerInstanceId,'worker-1');await stop(h);
});

test('timeout pauses dispatch and requires old page closure before one manual retry',async()=>{
  const h=harness({cards:[card('101'),card('102')]});await start(h);const old=h.runtime.getState().currentTask;
  await h.time.advance(30000);assert.equal(h.runtime.getState().status,'paused');assert.equal(h.pages.length,1);
  assert.equal((await h.runtime.resumeRun()).ok,false);h.pages[0].closed=true;
  assert.equal((await h.runtime.resumeRun()).ok,true);await h.time.advance(3000);assert.equal(h.pages.length,2);assert.notEqual(h.runtime.getState().currentTask.taskId,old.taskId);
  await h.gm.setValue(taskKeys(old.runId,old.taskId).result,{...old,workerInstanceId:'old',ok:true,detail});await flush();assert.equal((await h.storage.getSnapshot(identity('101'),'2026-09-12')).detail,null);
  await h.time.advance(30000);h.pages[1].closed=true;assert.equal((await h.runtime.resumeRun()).ok,false);await stop(h);
});

test('verification result pauses, keeps list data and skips only after old page closes',async()=>{
  const h=harness({cards:[card('101'),card('102')]});await start(h);await h.result({ok:false,reason:'verification-required',detail:undefined});assert.equal(h.runtime.getState().status,'paused');assert.equal(h.pages.length,1);
  assert.equal((await h.runtime.skipCurrent()).ok,false);h.pages[0].closed=true;assert.equal((await h.runtime.skipCurrent()).ok,true);await h.time.advance(3000);assert.equal(h.pages.length,2);assert.equal((await h.storage.getSnapshot(identity('101'),'2026-09-12')).list.value,11000);await stop(h);
});

test('manual pause lets current data settle but opens no later page',async()=>{
  const h=harness({cards:[card('101'),card('102')]});await start(h);await h.runtime.pauseRun();await h.result();h.pages[0].closed=true;await h.time.advance(4000);assert.equal(h.pages.length,1);assert.equal(h.runtime.ownsLock(),true);
  await h.runtime.resumeRun();await h.time.advance(3000);assert.equal(h.pages.length,2);await stop(h);
});

test('stored result predating listener registration is recovered by reread',async()=>{
  const h=harness();h.gm.onSet=async(key,value)=>{if(key.includes(':task:'))h.gm.values.set(taskKeys(value.runId,value.taskId).result,{...value,workerInstanceId:'early-worker',ok:true,detail});};await start(h);
  assert.equal((await h.storage.getSnapshot(identity('606196396351614'),'2026-09-12')).detail.skuTotal,11285);await stop(h);
});

test('late callback after end and lock release cannot write or ack',async()=>{
  const h=harness();await start(h);const task=h.runtime.getState().currentTask;const callback=h.gm.pastListeners.find(l=>l.key.includes(':result:')).callback;await stop(h);
  const writes=h.gm.values.size;callback(taskKeys(task.runId,task.taskId).result,null,{...task,workerInstanceId:'late',ok:true,detail},true);await flush();assert.equal(h.gm.values.size,writes);assert.equal((await h.storage.getSnapshot(identity(task.goodsId),task.day)).detail,null);assert.equal(h.gm.listeners.size,0);
});

test('storage failure never emits saved acknowledgement',async()=>{
  const h=harness();await start(h);const task=h.runtime.getState().currentTask;h.gm.failKey=key=>key.includes(':snapshot:');await h.result();
  assert.equal(await h.gm.getValue(taskKeys(task.runId,task.taskId).ack),null);assert.equal(h.runtime.getState().status,'paused');assert.equal(h.pages.length,1);h.gm.failKey=null;await stop(h);
});

test('navigated task tab is never closed by a stale handle and blocks next task',async()=>{
  const h=harness({cards:[card('101'),card('102')]});await start(h);await h.result();h.pages[0].url='https://www.temu.com/other';await h.time.advance(30000);
  assert.equal(h.runtime.getState().status,'paused');assert.equal(h.pages.length,1);assert.equal((await h.runtime.resumeRun()).ok,false);await stop(h);
});

test('closed task without result pauses instead of starting another page',async()=>{
  const h=harness({cards:[card('101'),card('102')]});await start(h);h.pages[0].closed=true;await h.time.advance(250);assert.equal(h.runtime.getState().status,'paused');assert.equal(h.pages.length,1);await stop(h);
});

test('midnight rejects old-day result and launches no new tasks',async()=>{
  const h=harness({cards:[card('101'),card('102')]});await start(h);const task=h.runtime.getState().currentTask;h.time.jump('2026-09-12T16:00:01.000Z');await h.result();await h.time.advance(250);
  assert.equal(h.runtime.getState().status,'paused');assert.equal(h.pages.length,1);assert.equal((await h.storage.getSnapshot(identity('101'),task.day)).detail,null);assert.equal((await h.runtime.resumeRun()).ok,false);assert.equal(await h.gm.getValue(taskKeys(task.runId,task.taskId).ack),null);await stop(h);
});

test('reload recovery remains read-only until manual resume, merges persisted result and requires orphan confirmation',async()=>{
  const old=harness({cards:[card('101'),card('102')]});await start(old);const prior=(await old.storage.getRun()).current;const task=old.runtime.getState().currentTask;await stop(old);
  old.gm.values.set('qiliang-radar:v1:run',{current:prior,history:[]});old.gm.values.set(taskKeys(task.runId,task.taskId).result,{...task,workerInstanceId:'before-reload',ok:true,detail});
  const h=harness({gm:old.gm,lock:old.lock,time:old.time,cards:[card('101'),card('102')]});assert.equal((await h.runtime.startRun(context,{minSales:20})).reason,'resume-required');assert.equal(h.runtime.ownsLock(),false);assert.equal(h.pages.length,0);
  await h.runtime.resumeRun();await flush();assert.equal(h.runtime.ownsLock(),true);assert.equal(h.pages.length,0);assert.equal((await h.storage.getSnapshot(identity('101'),'2026-09-12')).detail.skuTotal,11285);
  assert.equal((await h.runtime.resumeRun()).ok,false);assert.equal((await h.runtime.resumeRun({confirmedOrphanClosed:true})).ok,true);await h.time.advance(3000);assert.equal(h.pages.length,1);assert.equal(h.runtime.getState().currentTask.goodsId,'102');await stop(h);
});

test('reload unfinished task is requeued with new task id only after orphan close confirmation',async()=>{
  const old=harness();await start(old);const prior=(await old.storage.getRun()).current;const task=old.runtime.getState().currentTask;await stop(old);old.gm.values.set('qiliang-radar:v1:run',{current:prior,history:[]});
  const h=harness({gm:old.gm,lock:old.lock,time:old.time});await h.runtime.startRun(context,{minSales:20});await h.runtime.resumeRun();await flush();assert.equal(h.pages.length,0);
  await h.runtime.resumeRun({confirmedOrphanClosed:true});await h.time.advance(3000);assert.equal(h.pages.length,1);assert.notEqual(h.runtime.getState().currentTask.taskId,task.taskId);await stop(h);
});

test('new day does not resume prior-day unfinished run',async()=>{
  const old=harness();await start(old);const prior=(await old.storage.getRun()).current;await stop(old);old.gm.values.set('qiliang-radar:v1:run',{current:prior,history:[]});old.time.jump('2026-09-13T04:00:00.000Z');
  const h=harness({gm:old.gm,lock:old.lock,time:old.time,cards:[{...card('101',30),list:{...card('101',30).list,capturedAt:'2026-09-13T04:00:00.000Z'}}]});assert.equal((await h.runtime.startRun(context,{minSales:20},{confirmedOrphanClosed:true})).ok,true);await flush();assert.equal(h.runtime.getState().day,'2026-09-13');assert.notEqual(h.runtime.getState().runId,prior.runId);await stop(h);
});

test('pause during task preparation prevents a page opening until resume',async()=>{
  const h=harness();let release,entered;const gate=new Promise(r=>{release=r;});const enteredPromise=new Promise(r=>{entered=r;});
  h.gm.onSet=async key=>{if(key.includes(':task:')){entered();await gate;}};
  await h.runtime.startRun(context,{minSales:20});await enteredPromise;const pause=h.runtime.pauseRun();release();await pause;await flush();assert.equal(h.pages.length,0);
  await h.runtime.resumeRun();await flush();assert.equal(h.pages.length,1);await stop(h);
});

test('result notification triggers a storage reread instead of trusting callback contents',async()=>{
  const h=harness();await start(h);const task=h.runtime.getState().currentTask;const key=taskKeys(task.runId,task.taskId).result;
  h.gm.values.set(key,{...task,workerInstanceId:'stored-worker',ok:true,detail});h.gm.pastListeners.find(l=>l.key===key).callback(key,null,undefined,true);await flush();
  assert.equal((await h.storage.getSnapshot(identity(task.goodsId),task.day)).detail?.skuTotal,11285);await stop(h);
});

test('end waits for in-flight write, removes listeners and persists explicit interruption before unlock',async()=>{
  const h=harness();await start(h);let release,entered;const gate=new Promise(r=>{release=r;});const enteredPromise=new Promise(r=>{entered=r;});
  h.gm.onSet=async(key,value)=>{if(key.includes(':snapshot:')&&value.detail){entered();await gate;}};
  const received=h.result();await enteredPromise;const ending=h.runtime.endRun();await flush();assert.equal(h.lock.held,true);assert.equal(h.gm.listeners.size,0);release();await received;await ending;
  assert.equal(h.lock.held,false);assert.equal((await h.storage.getRun()).current.status,'interrupted');assert.equal((await h.storage.getRun()).current.reason,'ended-by-user');
});

test('midnight during storage read disables late daily write while actual lock remains held',async()=>{
  const h=harness();await start(h);assert.equal(typeof h.runtime.canWrite,'function');const task=h.runtime.getState().currentTask;
  let release,entered;const gate=new Promise(r=>{release=r;});const enteredPromise=new Promise(r=>{entered=r;});
  h.gm.onGet=async key=>{if(key.includes(':snapshot:')){entered();await gate;}};
  const received=h.result();await enteredPromise;h.time.jump('2026-09-12T16:00:01.000Z');assert.equal(h.runtime.ownsLock(),true);assert.equal(h.runtime.canWrite(),false);
  release();await received;h.gm.onGet=null;assert.equal((await h.storage.getSnapshot(identity(task.goodsId),task.day)).detail,null);assert.equal(await h.gm.getValue(taskKeys(task.runId,task.taskId).ack),null);await stop(h);
});

test('unsupported tab closure state requires explicit manual close confirmation before retry',async()=>{
  const h=harness({openBehavior:async()=>({})});await start(h);assert.equal(h.runtime.getState().status,'paused');assert.equal((await h.runtime.resumeRun()).ok,false);
  assert.equal((await h.runtime.resumeRun({confirmedOrphanClosed:true})).ok,true);await h.time.advance(3000);assert.equal(h.pages.length,2);await stop(h);
});

test('wrong task identity or date cannot create detail or saved ack',async()=>{
  const h=harness();await start(h);const task=h.runtime.getState().currentTask;
  for(const wrong of [{goodsId:'other'},{market:'UK'},{shopId:'other'},{language:'en'},{day:'2026-09-11'},{taskId:'old'}])await h.result(wrong);
  assert.equal((await h.storage.getSnapshot(identity(task.goodsId),task.day)).detail,null);assert.equal(await h.gm.getValue(taskKeys(task.runId,task.taskId).ack),null);await stop(h);
});

test('unknown hasMore cannot prove complete even when observed count matches reported total',async()=>{
  const h=harness({readCards:async()=>({ok:true,cards:[card('101',30)],errors:[],seenGoodsIds:['101'],reportedTotal:1})});await start(h);assert.equal(h.runtime.getState().listComplete,false);assert.equal(h.runtime.getState().status,'completed');
});

test('recovery rescans with fresh discovery count instead of treating earlier seen items as current completeness evidence',async()=>{
  const old=harness({cards:[card('101'),card('102')]});await start(old);const prior=(await old.storage.getRun()).current;await stop(old);old.gm.values.set('qiliang-radar:v1:run',{current:prior,history:[]});
  const h=harness({gm:old.gm,lock:old.lock,time:old.time,readCards:async()=>({ok:true,cards:[card('101',30)],errors:[],seenGoodsIds:['101'],hasMore:false,reportedTotal:2})});
  await h.runtime.startRun(context,{minSales:20});await h.runtime.resumeRun();await flush();await h.runtime.skipCurrent({confirmedOrphanClosed:true});await h.time.advance(3000);assert.equal(h.runtime.getState().listComplete,false);await stop(h);
});

test('recovery does not accept a late result from an already timed-out task',async()=>{
  const old=harness();await start(old);const task=old.runtime.getState().currentTask;await old.time.advance(30000);const prior=(await old.storage.getRun()).current;await stop(old);
  old.gm.values.set('qiliang-radar:v1:run',{current:prior,history:[]});old.gm.values.set(taskKeys(task.runId,task.taskId).result,{...task,workerInstanceId:'too-late',ok:true,detail});
  const h=harness({gm:old.gm,lock:old.lock,time:old.time});await h.runtime.startRun(context,{minSales:20});await h.runtime.resumeRun();await flush();assert.equal((await h.storage.getSnapshot(identity(task.goodsId),task.day)).detail,null);await stop(h);
});

test('below threshold identities are visible separately and reset for each new batch',async()=>{
  const h=harness({cards:[card('101',19),card('102',20)]});await start(h);assert.deepEqual(h.runtime.getState().belowThresholdGoodsIds,['101']);assert.deepEqual((await h.storage.getRun()).current.belowThresholdGoodsIds,['101']);
  await h.runtime.startRun(context,{minSales:10});await flush();assert.deepEqual(h.runtime.getState().belowThresholdGoodsIds,[]);assert.equal((await h.storage.listSnapshots(context)).length,2);
});

test('ending with a live tab blocks a new batch even for another shop until the page closes',async()=>{
  const h=harness();await start(h);await stop(h);const another={...context,shopId:'shop-2'};
  assert.equal((await h.runtime.startRun(another,{minSales:20})).reason,'orphan-page-close-required');assert.equal(h.pages.length,1);
  h.pages[0].closed=true;assert.equal((await h.runtime.startRun(another,{minSales:20})).ok,true);await flush();assert.equal(h.pages.length,2);await stop(h);
});

test('new master requires explicit orphan closure for an ended batch before opening another shop',async()=>{
  const old=harness();await start(old);await stop(old);const h=harness({gm:old.gm,lock:old.lock,time:old.time});const another={...context,shopId:'shop-2'};
  assert.equal((await h.runtime.startRun(another,{minSales:20})).reason,'orphan-page-close-required');assert.equal(h.pages.length,0);
  assert.equal((await h.runtime.startRun(another,{minSales:20},{confirmedOrphanClosed:true})).ok,true);await flush();assert.equal(h.pages.length,1);await stop(h);
});

test('prior-day live task still requires orphan closure even though its readings cannot be resumed',async()=>{
  const old=harness();await start(old);await stop(old);old.time.jump('2026-09-13T04:00:00.000Z');
  const h=harness({gm:old.gm,lock:old.lock,time:old.time,cards:[{...card('101'),list:{...card('101').list,capturedAt:'2026-09-13T04:00:00.000Z'}}]});
  assert.equal((await h.runtime.startRun(context,{minSales:20})).reason,'orphan-page-close-required');assert.equal(h.pages.length,0);
  await h.runtime.startRun(context,{minSales:20},{confirmedOrphanClosed:true});await flush();assert.equal(h.pages.length,1);assert.equal(h.runtime.getState().day,'2026-09-13');await stop(h);
});

 test('list-only production mode saves a ten-thousand reading without opening detail tabs',async()=>{
 const h=harness({enableDetail:false}); await start(h);
 assert.equal(h.pages.length,0); assert.equal(h.runtime.getState().savedListGoodsIds.length,1);
 await stop(h);
 });

test('late load-more button after scroll is clicked even before new cards arrive',async()=>{
 let button=false,loaded=false;
 const h=harness({enableDetail:false,readCards:async()=>({ok:true,cards:loaded?[card('101',30),card('102',40)]:[card('101',30)],seenGoodsIds:loaded?['101','102']:['101'],errors:[],hasMore:button&&!loaded,moreButton:button&&!loaded?{}:null,reportedTotal:2}),scrollList:async()=>{button=true;},clickMore:async()=>{loaded=true;}});
 await start(h);await h.time.advance(31000);
 assert.equal(h.runtime.getState().listComplete,true);assert.equal((await h.storage.listSnapshots(context)).length,2);
});
test('successful scrolling continues beyond three batches',async()=>{
 let count=1;
 const h=harness({enableDetail:false,readCards:async()=>({ok:true,cards:Array.from({length:count},(_,i)=>card(String(100+i),30)),seenGoodsIds:Array.from({length:count},(_,i)=>String(100+i)),errors:[],hasMore:false,reportedTotal:6}),scrollList:async()=>{count++;}});
 await start(h);await h.time.advance(31000);assert.equal(h.runtime.getState().listComplete,true);assert.equal((await h.storage.listSnapshots(context)).length,6);
});
