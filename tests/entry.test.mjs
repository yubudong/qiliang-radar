import test from 'node:test';
import assert from 'node:assert/strict';
import { runDetailWorker } from '../src/entry.mjs';
import { addTaskMarker, parseTaskMarker, taskKeys } from '../src/runtime.mjs';

const taskUrl = addTaskMarker('https://www.temu.com/item-g-g1.html',{runId:'r1',taskId:'t1'});
const task = {schemaVersion:1,runId:'r1',taskId:'t1',goodsId:'g1',market:'US',language:'zh-Hans',shopId:'s1',day:'2026-09-12',status:'pending',config:{timeoutMs:50,maxScrollRounds:0}};
const detail = {ok:true,goodsId:'g1',detail:{capturedAt:'2026-09-12T01:00:00Z',skuTotal:5,skuIds:['a'],skuCounts:{a:5},goodsDisplayValue:5,metricVersion:'sku-sold-quantity-v1',adapterVersion:'v1'}};

function harness(overrides={}) {
  const values = new Map([['qiliang-radar:v1:task:r1:t1', structuredClone(task)]]);
  const listeners = new Map(); let listenerId=0, closeCount=0, reads=0;
  const gm = {
    getValue: async (key, fallback=null) => values.has(key) ? structuredClone(values.get(key)) : fallback,
    setValue: async (key, value) => values.set(key, structuredClone(value)),
    addValueChangeListener: (key, callback) => { const id=++listenerId; listeners.set(id,{key,callback}); return id; },
    removeValueChangeListener: (id) => listeners.delete(id),
  };
  return {
    deps:{
      document:{readyState:'complete'}, location:{href:taskUrl}, gm, parseTaskMarker, taskKeys,
      readDetail:(_document,expected)=>{ reads++; return ['goodsId','market','language','shopId'].every((key)=>expected[key]===task[key]) ? detail : {ok:false,reason:'详情身份不匹配'}; }, pageProblem:()=>null,
      now:()=>new Date('2026-09-12T02:00:00Z'), createId:()=> 'worker-new', close:()=>{closeCount++;},
      setTimeout:(fn)=>{ fn(); return 1; }, clearTimeout:()=>{}, ...overrides,
    }, values, listeners,
    emit: async (key,value) => { values.set(key,structuredClone(value)); for (const {key:k,callback} of listeners.values()) if (k===key) await callback(key,null,value,true); },
    stats:()=>({closeCount,reads,listeners:listeners.size}),
  };
}

test('worker ignores normal product pages without a private task marker', async () => {
  const h=harness(); h.deps.location.href='https://www.temu.com/item-g-g1.html';
  const result=await runDetailWorker(h.deps);
  assert.equal(result.controlled,false); assert.equal(h.stats().reads,0); assert.equal(h.stats().closeCount,0);
});

test('worker rejects mismatched identity and Beijing day without closing', async () => {
  const identity=harness(); identity.values.set('qiliang-radar:v1:task:r1:t1',{...task,shopId:'other'});
  const identityResult=await runDetailWorker(identity.deps);
  assert.equal(identityResult.result.ok,false); assert.match(identityResult.result.reason,/身份/); assert.equal(identity.stats().closeCount,0);
  const date=harness(); date.values.set('qiliang-radar:v1:task:r1:t1',{...task,day:'2026-09-11'});
  const dateResult=await runDetailWorker(date.deps);
  assert.equal(dateResult.ok,false); assert.equal([...date.values.keys()].some((key)=>key.includes(':result:')),false); assert.equal(date.stats().closeCount,0);
});

test('worker closes only after rereading its matching saved acknowledgement', async () => {
  const h=harness(); const result=await runDetailWorker(h.deps);
  assert.equal(result.ok,true); assert.equal(h.stats().closeCount,0);
  const ackKey='qiliang-radar:v1:ack:r1:t1';
  await h.emit(ackKey,{runId:'r1',taskId:'t1',workerInstanceId:'worker-old',goodsId:'g1',day:'2026-09-12',saved:true});
  assert.equal(h.stats().closeCount,0);
  await h.emit(ackKey,{runId:'r1',taskId:'t1',workerInstanceId:'worker-new',goodsId:'g1',day:'2026-09-12',saved:true});
  assert.equal(h.stats().closeCount,1);
});

test('matching acknowledgement cannot close a document navigated to another task fragment', async () => {
  const h=harness(); await runDetailWorker(h.deps);
  h.deps.location.href=addTaskMarker('https://www.temu.com/item-g-g1.html',{runId:'r1',taskId:'t2'});
  await h.emit('qiliang-radar:v1:ack:r1:t1',{runId:'r1',taskId:'t1',workerInstanceId:'worker-new',goodsId:'g1',day:'2026-09-12',saved:true});
  assert.equal(h.stats().closeCount,0);
});
