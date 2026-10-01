import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  compareSkuSnapshots as compareSnapshots, dayKey, meetsThreshold, normalizeMinSales, parseSales,
  previousDayKey, toCsv, validateSkuSales,
} from '../src/core.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/sku-sample.json', import.meta.url)));
const list = (value, precision = 'number', rawText = `已售 ${value} 件`, capturedAt = '2026-09-12T02:00:00Z') =>
  ({ value, precision, rawText, metricVersion: 'shop-sales-v1', capturedAt });
const detail = (total, ids, capturedAt = '2026-09-12T02:05:00Z') => ({
  skuTotal: total, skuIds: ids, metricVersion: 'sku-sold-quantity-v1',
  adapterVersion: 'temu-us-zh-v1', capturedAt,
});
const snapshot = ({ day = '2026-09-12', listValue = null, detailValue = null,
  market = 'US', language = 'zh-Hans', shopId = 'shop-1', goodsId = 'goods-1' } = {}) => ({
  market, language, shopId, goodsId, day, list: listValue, detail: detailValue,
});

test('parseSales parses exact integers and Chinese ten-thousand displays without inventing precision', () => {
  assert.deepEqual(parseSales('已售 1,234 件'), { ok: true, value: 1234, precision: 'number', rawText: '已售 1,234 件' });
  assert.deepEqual(parseSales('已售 1.1万件'), { ok: true, value: 11000, precision: 'rounded', rawText: '已售 1.1万件' });
  assert.deepEqual(parseSales('已售 1万+ 件'), { ok: true, value: 10000, precision: 'lower_bound', rawText: '已售 1万+ 件' });
});

test('parseSales rejects absent or different metrics', () => {
  for (const raw of ['', null, '暂无销量', '123 条评论', '¥ 19.99', '过去 30 天已售 200 件']) {
    assert.equal(parseSales(raw).ok, false, String(raw));
  }
});

test('parseSales requires a complete verified label and rejects unsupported units or malformed numbers', () => {
  for (const raw of [
    '未知促销 已售 123 件 截止昨日', '已售 123 件 另有 9 条评论', '已售 1,23 件',
    '已售 1,234.5 件', '已售 1.2亿件', '已售 1.2K 件', '已售 123 件 截止昨日',
  ]) assert.equal(parseSales(raw).ok, false, raw);
});

test('threshold normalization and inclusive boundaries are configurable', () => {
  assert.deepEqual(normalizeMinSales(undefined), { ok: true, value: 20 });
  assert.deepEqual(normalizeMinSales('50'), { ok: true, value: 50 });
  assert.equal(normalizeMinSales('-1').ok, false);
  assert.equal(normalizeMinSales('2.5').ok, false);
  assert.equal(meetsThreshold(parseSales('已售 19 件'), 20), false);
  assert.equal(meetsThreshold(parseSales('已售 20 件'), 20), true);
  assert.equal(meetsThreshold(parseSales('已售 49 件'), 50), false);
  assert.equal(meetsThreshold(parseSales('已售 50 件'), 50), true);
});

test('validateSkuSales accepts the verified 16-SKU sample and does not double-count its mirror', () => {
  const skuList = sample.rows.map(({ goodsId, skuId }) => ({ goodsId, skuId }));
  const map = Object.fromEntries(sample.rows.map(({ skuId, sold_quantity }) => [skuId, { sold_quantity }]));
  const result = validateSkuSales(sample.goodsId, skuList, map, structuredClone(map));
  assert.equal(result.ok, true);
  assert.equal(result.skuTotal, 11285);
  assert.equal(result.skuIds.length, 16);
  assert.equal(result.skuCounts['100552029521237'], 1122);
});

test('validateSkuSales rejects missing, extra, foreign, duplicate, conflicting, and non-integer data', () => {
  const skuList = sample.rows.map(({ goodsId, skuId }) => ({ goodsId, skuId }));
  const map = Object.fromEntries(sample.rows.map(({ skuId, sold_quantity }) => [skuId, { sold_quantity }]));
  const missing = structuredClone(map); delete missing[sample.rows[0].skuId];
  assert.equal(validateSkuSales(sample.goodsId, skuList, missing).ok, false);
  assert.equal(validateSkuSales(sample.goodsId, skuList, { ...map, other: { sold_quantity: 1 } }).ok, false);
  assert.equal(validateSkuSales(sample.goodsId, [...skuList, { goodsId: 'other', skuId: 'foreign' }], map).ok, false);
  assert.equal(validateSkuSales(sample.goodsId, [...skuList, skuList[0]], map).ok, false);
  const mirror = structuredClone(map); mirror[sample.rows[0].skuId].sold_quantity++;
  assert.equal(validateSkuSales(sample.goodsId, skuList, map, mirror).ok, false);
  const decimal = structuredClone(map); decimal[sample.rows[0].skuId].sold_quantity = 1.5;
  assert.equal(validateSkuSales(sample.goodsId, skuList, decimal).ok, false);
});

test('dayKey and previousDayKey use Shanghai natural days across midnight', () => {
  assert.equal(dayKey('2026-09-11T15:59:59.999Z', 'Asia/Shanghai'), '2026-09-11');
  assert.equal(dayKey('2026-09-11T16:00:00.000Z', 'Asia/Shanghai'), '2026-09-12');
  assert.equal(previousDayKey('2026-09-12', 'Asia/Shanghai'), '2026-09-11');
  assert.equal(previousDayKey('2026-01-01', 'Asia/Shanghai'), '2025-12-31');
  assert.equal(previousDayKey('2026-02-29', 'Asia/Shanghai'), null);
  assert.equal(previousDayKey('2026-02-30', 'Asia/Shanghai'), null);
  assert.equal(previousDayKey('2026-13-01', 'Asia/Shanghai'), null);
});

test('compareSnapshots uses the final same-day list reading and reports new/missing-yesterday separately', () => {
  assert.equal(compareSnapshots(snapshot({ day:'2026-09-11', listValue:list(60) }), snapshot({ listValue:list(90) })).delta, 30);
  const fresh = compareSnapshots(null, snapshot({ listValue:list(20) }), false);
  assert.equal(fresh.delta, null); assert.equal(fresh.status, '新收录');
  const missing = compareSnapshots(null, snapshot({ listValue:list(90) }), true);
  assert.equal(missing.delta, null); assert.equal(missing.status, '缺昨日数据');
});

test('compareSnapshots refuses a non-adjacent historical snapshot instead of calculating a daily delta', () => {
  const result = compareSnapshots(
    snapshot({ day:'2026-09-10', listValue:list(60) }),
    snapshot({ day:'2026-09-12', listValue:list(90) }), true);
  assert.equal(result.ok, true); assert.equal(result.source, 'none'); assert.equal(result.delta, null);
  assert.equal(result.status, '缺昨日数据');
});

test('compareSnapshots fails closed when any complete identity dimension is missing or different', () => {
  for (const key of ['market', 'language', 'shopId', 'goodsId']) {
    const previous = snapshot({ day:'2026-09-11', listValue:list(60) });
    const current = snapshot({ listValue:list(90) });
    current[key] = `${current[key]}-other`;
    const mismatch = compareSnapshots(previous, current, true);
    assert.equal(mismatch.ok, false, key); assert.match(mismatch.reason, /身份/);
    delete current[key];
    const missing = compareSnapshots(previous, current, true);
    assert.equal(missing.ok, false, key); assert.match(missing.reason, /身份/);
  }
});

test('compareSnapshots prioritizes matching SKU detail independent of order', () => {
  const ids = ['a','b'];
  const result = compareSnapshots(
    snapshot({ day:'2026-09-11', detailValue:detail(11285, ids) }),
    snapshot({ detailValue:detail(11320, [...ids].reverse()) }), true);
  assert.equal(result.source, 'sku'); assert.equal(result.delta, 35); assert.match(result.label, /SKU 汇总参考/);
});

test('detail comparison ignores adapter changes but rejects metric-version changes', () => {
  const previousDetail = detail(100, ['a']);
  const adapterChanged = { ...detail(120, ['a']), adapterVersion:'temu-us-zh-v2' };
  const comparable = compareSnapshots(snapshot({day:'2026-09-11',detailValue:previousDetail}), snapshot({detailValue:adapterChanged}), true);
  assert.equal(comparable.source, 'sku'); assert.equal(comparable.delta, 20);
  const metricChanged = { ...adapterChanged, metricVersion:'sku-sold-quantity-v2' };
  const incompatible = compareSnapshots(snapshot({day:'2026-09-11',detailValue:previousDetail}), snapshot({detailValue:metricChanged}), true);
  assert.equal(incompatible.source, 'none'); assert.equal(incompatible.delta, null); assert.match(incompatible.status, /口径/);
});

test('compareSnapshots never mixes list and detail and marks rounded list differences approximate', () => {
  const result = compareSnapshots(
    snapshot({ day:'2026-09-11', listValue:list(9999) }),
    snapshot({ listValue:list(11000, 'rounded', '已售 1.1万件'), detailValue:detail(11285, ['a']) }), true);
  assert.equal(result.source, 'list'); assert.equal(result.delta, 1001); assert.match(result.label, /约/);
});

test('compareSnapshots handles unchanged rounded displays, rounded movement, lower-bound tiers and negative values', () => {
  const roundedSame = compareSnapshots(snapshot({day:'2026-09-11',listValue:list(11000,'rounded','1.1万')}), snapshot({listValue:list(11000,'rounded','1.1万'),detailValue:detail(11285,['a'])}), true);
  assert.equal(roundedSame.delta, 0); assert.equal(roundedSame.status, '展示未变');
  const roundedMove = compareSnapshots(snapshot({day:'2026-09-11',listValue:list(11000,'rounded','1.1万')}), snapshot({listValue:list(12000,'rounded','1.2万')}), true);
  assert.equal(roundedMove.delta, 1000); assert.match(roundedMove.label, /约/);
  const tierMove = compareSnapshots(snapshot({day:'2026-09-11',listValue:list(10000,'lower_bound','1万+')}), snapshot({listValue:list(20000,'lower_bound','2万+')}), true);
  assert.equal(tierMove.delta, null); assert.equal(tierMove.status, '展示档位变化');
  const tierSame = compareSnapshots(snapshot({day:'2026-09-11',listValue:list(10000,'lower_bound','1万+')}), snapshot({listValue:list(10000,'lower_bound','1万+')}), true);
  assert.equal(tierSame.delta, null); assert.equal(tierSame.status, '展示档位未变');
  const down = compareSnapshots(snapshot({day:'2026-09-11',listValue:list(90)}), snapshot({listValue:list(60)}), true);
  assert.equal(down.delta, -30); assert.equal(down.status, '数值回落，需复核');
});

test('changed SKU sets fall back to comparable lists, otherwise remain incomparable', () => {
  const fallback = compareSnapshots(
    snapshot({day:'2026-09-11',listValue:list(100),detailValue:detail(120,['a','b'])}),
    snapshot({listValue:list(110),detailValue:detail(140,['a','c'])}), true);
  assert.equal(fallback.source, 'list'); assert.equal(fallback.delta, 10); assert.match(fallback.status, /SKU 集合变化/);
  const none = compareSnapshots(snapshot({day:'2026-09-11',detailValue:detail(120,['a','b'])}), snapshot({detailValue:detail(140,['a','c'])}), true);
  assert.equal(none.source, 'none'); assert.equal(none.delta, null); assert.equal(none.status, 'SKU 集合变化');
});

test('metric-version incompatibility is explicit and captured times follow the selected source', () => {
  const previous = snapshot({day:'2026-09-11',listValue:{...list(10),metricVersion:'old',capturedAt:'2026-09-11T01:00:00Z'}});
  const current = snapshot({listValue:{...list(20),capturedAt:'2026-09-12T01:00:00Z'}});
  const result = compareSnapshots(previous,current,true);
  assert.equal(result.source,'none'); assert.equal(result.delta,null); assert.match(result.status,/口径/);
  assert.equal(result.previousCapturedAt,null); assert.equal(result.currentCapturedAt,null);
});

test('lower-bound comparison requires two valid lists with the same metric version', () => {
  const oldTier = list(10000, 'lower_bound', '1万+');
  const newTier = { ...list(20000, 'lower_bound', '2万+'), metricVersion:'shop-sales-v2' };
  const versionMismatch = compareSnapshots(snapshot({day:'2026-09-11',listValue:oldTier}), snapshot({listValue:newTier}), true);
  assert.equal(versionMismatch.source, 'none'); assert.equal(versionMismatch.delta, null); assert.match(versionMismatch.status, /口径/);
  const unknownPrecision = compareSnapshots(snapshot({day:'2026-09-11',listValue:oldTier}), snapshot({listValue:list(20000, 'unknown', '未知')}), true);
  assert.equal(unknownPrecision.source, 'none'); assert.equal(unknownPrecision.delta, null); assert.match(unknownPrecision.status, /口径/);
  const absentOtherSide = compareSnapshots(snapshot({day:'2026-09-11',listValue:oldTier}), snapshot(), true);
  assert.equal(absentOtherSide.source, 'none'); assert.equal(absentOtherSide.delta, null); assert.match(absentOtherSide.status, /口径/);
});

test('toCsv emits BOM, escapes Chinese/quotes/newlines/formulas, keeps negative numbers, and leaves null blank', () => {
  const csv = toCsv([{ 日期:'2026-09-12', 商品名称:'中文,"商品"\n第二行', 商品ID:'=2+2', 参考增量:-3, 昨日比较值:null }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /"中文,""商品""\n第二行"/);
  assert.match(csv, /'\=2\+2|"'=2\+2"/);
  assert.match(csv, /,-3,/);
  assert.match(csv, /,$/);
});
