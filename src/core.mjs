import {parseLocalizedSales} from './locales.mjs';
const failure = (reason) => ({ ok: false, reason });

export function parseSales(rawText, language) {
  if (typeof rawText !== 'string' || !rawText.trim()) return failure('销量文本为空');
  const text = rawText.trim();
  if(language)return parseLocalizedSales(rawText,language);
  if(/sold$/i.test(text))return parseLocalizedSales(rawText,'en');
  const match = text.match(/^(?:已售|售出)\s*((?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d+)?)\s*(万)?\s*(\+)?\s*(?:件|单)$/);
  if (!match) return failure('无法识别销量文本');
  if (match[1].includes('.') && !match[2]) return failure('非万级销量必须是整数');
  if (match[3] && !match[2]) return failure('仅支持万级下界标签');
  const numeric = Number(match[1].replaceAll(',', ''));
  const value = match[2] ? numeric * 10000 : numeric;
  if (!Number.isSafeInteger(value) || value < 0) return failure('销量不是非负安全整数');
  const precision = match[3] ? 'lower_bound' : match[2] ? 'rounded' : 'number';
  return { ok: true, value, precision, rawText };
}

export function normalizeMinSales(input = 20) {
  const candidate = input === '' || input == null ? 20 : Number(input);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? { ok: true, value: candidate } : failure('最低累计销量必须是非负整数');
}

export function meetsThreshold(reading, minimum = 20) {
  const normalized = normalizeMinSales(minimum);
  return reading?.ok === true && normalized.ok && reading.value >= normalized.value;
}

const countFrom = (value) => value && typeof value === 'object' ? value.sold_quantity : value;

export function validateSkuSales(goodsId, skuList, primaryMap, mirrorMap) {
  if (typeof goodsId !== 'string' || !goodsId || !Array.isArray(skuList) || !primaryMap || typeof primaryMap !== 'object') return failure('SKU 输入无效');
  const ids = [], seen = new Set();
  for (const sku of skuList) {
    if (!sku || typeof sku.skuId !== 'string' || typeof sku.goodsId !== 'string') return failure('SKU ID 必须是字符串');
    if (sku.goodsId !== goodsId) return failure('SKU 归属其他商品');
    if (seen.has(sku.skuId)) return failure('SKU ID 重复');
    seen.add(sku.skuId); ids.push(sku.skuId);
  }
  if (!ids.length) return failure('SKU 清单为空');
  const mapIds = Object.keys(primaryMap);
  if (mapIds.length !== ids.length || mapIds.some((id) => !seen.has(id))) return failure('销量映射与 SKU 集合不一致');
  if (mirrorMap != null) {
    if (typeof mirrorMap !== 'object') return failure('镜像销量映射无效');
    const mirrorIds = Object.keys(mirrorMap);
    if (mirrorIds.length !== ids.length || mirrorIds.some((id) => !seen.has(id))) return failure('镜像 SKU 集合不一致');
  }
  const skuCounts = {}; let skuTotal = 0;
  for (const id of [...ids].sort()) {
    const count = countFrom(primaryMap[id]);
    if (!Number.isSafeInteger(count) || count < 0) return failure(`SKU ${id} 销量不是非负安全整数`);
    if (mirrorMap != null && countFrom(mirrorMap[id]) !== count) return failure('详情数据冲突');
    skuCounts[id] = count; skuTotal += count;
    if (!Number.isSafeInteger(skuTotal)) return failure('SKU 汇总超出安全整数范围');
  }
  return { ok: true, goodsId, skuTotal, skuIds: Object.keys(skuCounts), skuCounts };
}

export function dayKey(capturedAt, timezone = 'Asia/Shanghai') {
  const date = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { return null; }
}

export function previousDayKey(day, timezone = 'Asia/Shanghai') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, date, 12));
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== date) return null;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(normalized);
  } catch { return null; }
  return new Date(Date.UTC(year, month - 1, date - 1, 12)).toISOString().slice(0, 10);
}

const comparison = (fields) => ({ ok:true, source:'none', delta:null, label:'', status:'', previousValue:null, currentValue:null, previousCapturedAt:null, currentCapturedAt:null, ...fields });
const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);
const detailCompatible = (a, b) => a && b && a.metricVersion === b.metricVersion && Number.isSafeInteger(a.skuTotal) && Number.isSafeInteger(b.skuTotal) && sameIds(a.skuIds, b.skuIds);
const listCompatible = (a, b) => a && b && a.metricVersion === b.metricVersion && ['number','rounded'].includes(a.precision) && ['number','rounded'].includes(b.precision) && Number.isSafeInteger(a.value) && Number.isSafeInteger(b.value);
const listSourceCompatible = (a, b) => a && b && typeof a.metricVersion === 'string' && a.metricVersion === b.metricVersion && ['number','rounded','lower_bound'].includes(a.precision) && ['number','rounded','lower_bound'].includes(b.precision) && Number.isSafeInteger(a.value) && a.value >= 0 && Number.isSafeInteger(b.value) && b.value >= 0;
const identityKeys = ['market', 'language', 'shopId', 'goodsId'];
const hasIdentity = (snapshot) => identityKeys.every((key) => typeof snapshot?.[key] === 'string' && snapshot[key].length > 0);

export function compareSkuSnapshots(previous, current, historyExists = Boolean(previous)) {
  if (!current) return failure('今日快照缺失');
  if (!hasIdentity(current)) return failure('今日快照身份不完整');
  if (previous && !hasIdentity(previous)) return failure('昨日快照身份不完整');
  if (previous && identityKeys.some((key) => previous[key] !== current[key])) return failure('快照身份不一致');
  if (previousDayKey(current.day) == null) return failure('今日快照日期无效');
  if (!previous) return comparison({ status:historyExists ? '缺昨日数据' : '新收录', label:historyExists ? '缺昨日数据' : '新收录' });
  if (previousDayKey(previous.day) == null) return failure('历史快照日期无效');
  if (previous.day !== previousDayKey(current.day)) return comparison({ status:'缺昨日数据', label:'缺昨日数据' });
  const skuSetChanged = previous.detail && current.detail && !sameIds(previous.detail.skuIds, current.detail.skuIds);
  if (detailCompatible(previous.detail, current.detail)) {
    const delta = current.detail.skuTotal - previous.detail.skuTotal;
    return comparison({ source:'sku', delta, label:'SKU 汇总参考', status:delta < 0 ? '数值回落，需复核' : '可比', previousValue:previous.detail.skuTotal, currentValue:current.detail.skuTotal, previousCapturedAt:previous.detail.capturedAt ?? null, currentCapturedAt:current.detail.capturedAt ?? null });
  }
  if (listSourceCompatible(previous.list, current.list) && (previous.list.precision === 'lower_bound' || current.list.precision === 'lower_bound')) {
    const changed = previous.list?.rawText !== current.list?.rawText;
    return comparison({ source:'list', label:'列表下界标签', status:changed ? '展示档位变化' : '展示档位未变', previousCapturedAt:previous.list?.capturedAt ?? null, currentCapturedAt:current.list?.capturedAt ?? null });
  }
  if (listCompatible(previous.list, current.list)) {
    const delta = current.list.value - previous.list.value;
    const approximate = previous.list.precision === 'rounded' || current.list.precision === 'rounded';
    const status = skuSetChanged ? 'SKU 集合变化；回退列表参考' : delta < 0 ? '数值回落，需复核' : approximate && delta === 0 ? '展示未变' : '可比';
    return comparison({ source:'list', delta, label:`列表参考${approximate ? '（约）' : ''}`, status, previousValue:previous.list.value, currentValue:current.list.value, previousCapturedAt:previous.list.capturedAt ?? null, currentCapturedAt:current.list.capturedAt ?? null });
  }
  if (skuSetChanged) return comparison({ status:'SKU 集合变化', label:'SKU 集合变化' });
  return comparison({ status:'来源或统计口径不兼容', label:'不可比' });
}

function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows) {
  if (!Array.isArray(rows)) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))];
  return `\ufeff${[headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row?.[header])).join(','))].join('\r\n')}`;
}

// Production comparisons use displayed list readings only. Legacy SKU logic is retained for research tests.
export function compareSnapshots(previous,current,historyExists=Boolean(previous)) {
 return compareSkuSnapshots(previous ? {...previous,detail:null} : previous,current ? {...current,detail:null} : current,historyExists);
}
