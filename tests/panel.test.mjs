import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { buildResultRows, createLatestRefresh, filterResultRows, formatProgress, mountPanel, renderResultsTable, rowsToCsv } from '../src/panel.mjs';

const identity={market:'US',language:'zh-Hans',shopId:'s1'};
const snap=(goodsId,day,list,extra={})=>({...identity,goodsId,shopName:'店铺',title:goodsId,productUrl:`https://www.temu.com/item-g-${goodsId}.html`,day,list,detail:null,lastAttempt:null,...extra});
const reading=(value,precision='number',rawText=`已售${value}件`)=>({value,precision,rawText,metricVersion:'shop-sales-v1',capturedAt:'2026-09-12T01:00:00Z'});

test('panel rows use the selected comparison source, keep new cumulative text, and sort deltas first', () => {
  const previous=new Map([
    ['g-list',snap('g-list','2026-09-11',reading(60))],
    ['g-sku',snap('g-sku','2026-09-11',reading(100),{detail:{skuTotal:120,skuIds:['a'],metricVersion:'sku-v1',adapterVersion:'a1',capturedAt:'2026-09-11T01:10:00Z'}})],
  ]);
  const current=[
    snap('g-new','2026-09-12',reading(20)),
    snap('g-list','2026-09-12',reading(90)),
    snap('g-sku','2026-09-12',reading(999),{detail:{skuTotal:125,skuIds:['a'],metricVersion:'sku-v1',adapterVersion:'a2',capturedAt:'2026-09-12T01:10:00Z'}}),
  ];
  const rows=buildResultRows(current,previous,new Set());
  assert.deepEqual(rows.map((row)=>row.goodsId),['g-sku','g-list','g-new']);
  assert.equal(rows[0].comparison.source,'list'); assert.equal(rows[0].previousDisplay,'100'); assert.equal(rows[0].currentDisplay,'999');
  assert.equal(rows[2].currentDisplay,'已售20件'); assert.equal(rows[2].deltaDisplay,''); assert.equal(rows[2].status,'新收录');
});

test('panel keeps incomparable rows last and renders hostile titles as text, never markup', () => {
  const hostile='<img src=x onerror=alert(1)>';
  const rows=buildResultRows([snap('g1','2026-09-12',reading(20),{title:hostile,lastAttempt:{status:'failed',reasonCode:'详情未取到'}})],new Map(),new Set());
  const {document}=parseHTML('<div id="root"></div>');
  renderResultsTable(document.getElementById('root'),rows,document);
  assert.equal(document.querySelector('img'),null);
  assert.match(document.getElementById('root').textContent,/img src=x/);
  assert.match(document.getElementById('root').textContent,/详情未取到/);
});

test('latest refresh wins when an older storage read resolves after a newer one', async () => {
  let firstResolve, secondResolve; const applied=[];
  const pending=[new Promise((resolve)=>{firstResolve=resolve;}),new Promise((resolve)=>{secondResolve=resolve;})];
  const refresh=createLatestRefresh(()=>pending.shift(),(value)=>applied.push(value));
  const first=refresh(); const second=refresh();
  secondResolve('new'); await second;
  firstResolve('old'); await first;
  assert.deepEqual(applied,['new']);
});

test('progress distinguishes saved list records from completed details and flags partial scans', () => {
  assert.equal(formatProgress({status:'running',savedListGoodsIds:['a','b'],completedGoodsIds:['b'],errors:[],listComplete:false}), '采集中｜已扫描 0 / 未知｜保存成功 2｜低于门槛跳过 0｜未展示销量 0｜失败商品 0');
  assert.equal(formatProgress({status:'completed',savedListGoodsIds:['a'],completedGoodsIds:[],errors:[],listComplete:true}), '已完成｜已扫描 0 / 未知｜保存成功 1｜低于门槛跳过 0｜未展示销量 0｜失败商品 0');
});

test('missing historical products distinguish not captured from explicitly below threshold', () => {
  const missing=snap('old','2026-09-12',null,{missingToday:true});
  const rows=buildResultRows([missing],new Map(),new Set(['old']),{belowThresholdGoodsIds:new Set()});
  assert.equal(rows[0].status,'今日未采到'); assert.equal(rows[0].deltaDisplay,'');
  const below=buildResultRows([missing],new Map(),new Set(['old']),{belowThresholdGoodsIds:new Set(['old'])});
  assert.equal(below[0].status,'本次未达门槛');
});

test('rounded list comparisons show approximation in UI and CSV, and export can use filtered rows', () => {
  const current=snap('rounded','2026-09-12',reading(11000,'rounded','已售1.1万件'));
  const previous=new Map([['rounded',snap('rounded','2026-09-11',reading(10000))]]);
  const rows=buildResultRows([current],previous,new Set(['rounded']));
  assert.match(rows[0].deltaDisplay,/约/); assert.match(rows[0].sourceDisplay,/约/);
  const csv=rowsToCsv(filterResultRows(rows,'全部'),'2026-09-12',identity);
  assert.match(csv,/列表参考（约）/);
});

test('orphan confirmation after a rejected start retries start with explicit confirmation', async () => {
  const {document}=parseHTML('<html><body></body></html>'); const calls=[];
  const storage={getSettings:async()=>({minSales:20}),saveSettings:async()=>{},listSnapshots:async()=>[]};
  const runtime={startRun:async(...args)=>{calls.push(args); return calls.length===1?{ok:false,reason:'orphan-page-close-required'}:{ok:true};},pauseRun:async()=>({ok:true}),resumeRun:async()=>{throw new Error('wrong route');},endRun:async()=>({ok:true}),skipCurrent:async()=>({ok:true})};
  const panel=mountPanel({document,context:{...identity,shopName:'店铺'},storage,runtime,initialDay:'2026-09-12'});
  const buttons=[...panel.host.shadowRoot.querySelectorAll('button')];
  buttons.find((button)=>button.textContent==='开始').click(); await new Promise((resolve)=>setTimeout(resolve,0));
  buttons.find((button)=>button.textContent==='已关闭旧详情页，继续').click(); await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(calls.length,2); assert.deepEqual(calls[1][2],{confirmedOrphanClosed:true});
});

test('progress separates missing sales and deduplicates failures recovered by success',()=>{
 const result=formatProgress({status:'completed',listComplete:false,reportedTotal:8,discoveredGoodsIds:['a','b','c','d'],savedListGoodsIds:['a'],belowThresholdGoodsIds:['b'],errors:[{goodsId:'a',reasonCode:'bad'},{goodsId:'c',reasonCode:'未展示销量'},{goodsId:'d',reasonCode:'bad'},{goodsId:'d',reasonCode:'bad'}]});
 assert.match(result,/未采全/);assert.match(result,/已扫描 4 \/ 8/);assert.match(result,/未展示销量 1/);assert.match(result,/失败商品 1/);
});
