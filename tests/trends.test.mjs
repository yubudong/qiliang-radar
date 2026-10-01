import test from 'node:test';
import assert from 'node:assert/strict';
import {trendMetrics} from '../src/trends.mjs';
const snapshots=(values)=>values.map((value,i)=>({market:'US',language:'zh-Hans',shopId:'s',goodsId:'g',day:`2026-09-${String(8+i).padStart(2,'0')}`,list:{value,precision:'number',metricVersion:'shop-sales-v1',rawText:`已售${value}件`,capturedAt:`2026-09-${String(8+i).padStart(2,'0')}T04:00:00Z`}}));
test('three day average and acceleration use different windows',()=>{const m=trendMetrics(snapshots([20,22,26,32,42]),'2026-09-12');assert.equal(m.average,20/3);assert.equal(m.acceleration,6);assert.equal(m.streak,4);assert.equal(m.firstSeen,'2026-09-08');assert.equal(m.rising,true);});
test('gaps are not zero and future readings do not leak',()=>{const a=snapshots([20,22,26,32,42]);a.splice(2,1);const m=trendMetrics(a,'2026-09-11');assert.equal(m.average,null);assert.equal(m.acceleration,null);assert.equal(m.streak,null);assert.equal(m.rising,false);});
test('negative changes do not count as growth',()=>{const m=trendMetrics(snapshots([20,22,26,32,21]),'2026-09-12');assert.equal(m.average,null);assert.equal(m.rising,false);});
