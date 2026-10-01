import {languages,normalizeText,readLocale,readTotal} from './locales.mjs';
import { parseSales, validateSkuSales } from './core.mjs';

const failure = (reason, extra = {}) => ({ ok:false, reason, ...extra });
const text = (node) => node?.textContent?.trim() ?? '';
const stringId = (value) => (typeof value === 'string' || Number.isSafeInteger(value)) ? String(value) : null;

export function pageProblem(document) {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  if (dialogs.some((node) => /请完成验证|安全验证|验证码|滑块验证|verify you are human|security verification|captcha/i.test(text(node)))) return '页面需要验证';
  if (dialogs.some((node) => /登录后继续|请先登录|sign in to continue|log in to continue/i.test(text(node)))) return '页面需要登录';
  const heading = text(document.querySelector('h1'));
  if (/页面不存在|访问出错|Something went wrong/i.test(heading)) return '页面加载失败';
  return null;
}

export function getShopRoot(document) {
  const anchor = document.getElementById('mall-top-head-category-container');
  const candidate = anchor?.nextElementSibling;
  return candidate?.classList?.contains('mainContent') && candidate.querySelector('.js-goods-list') ? candidate : null;
}

const locale = readLocale;

export function readShopContext(document, urlString) {
  const problem = pageProblem(document);
  if (problem) return failure(problem);
  let url;
  try { url = new URL(urlString); } catch { return failure('店铺网址无效'); }
  const shopId = url.hostname === 'www.temu.com' ? url.searchParams.get('mall_id') : null;
  const root = getShopRoot(document);
  const site = locale(document);
  if (!shopId || !root || !site) return failure('不支持的店铺页面结构');
  const reportedTotal = readTotal(root,site.language);
  return {ok:true,...site,shopId,shopName:text(document.querySelector('h1')),reportedTotal:Number.isSafeInteger(reportedTotal)?reportedTotal:null,root};
}

export function sanitizeProductUrl(urlString, expectedGoodsId) {
  let url;
  try { url = new URL(urlString, 'https://www.temu.com'); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'www.temu.com') return null;
  const expected = String(expectedGoodsId ?? '');
  const pathMatch = url.pathname.match(/-g-([^/.]+)\.html$/);
  if (pathMatch && pathMatch[1] === expected) return `https://www.temu.com${url.pathname}`;
  if (url.pathname === '/goods.html' && url.searchParams.get('goods_id') === expected) return `https://www.temu.com/goods.html?goods_id=${encodeURIComponent(expected)}`;
  return null;
}

function uniqueSales(rawText,language) {
  const direct=parseSales(rawText,language);
  if(direct.ok)return direct;
  const normalized=normalizeText(rawText);
  for(let split=1;split<normalized.length;split++){
    const a=normalized.slice(0,split).trim(),b=normalized.slice(split).trim();
    if(a===b){const parsed=parseSales(a,language);if(parsed.ok)return parsed;}
    if(parseSales(a,language).ok&&parseSales(b,language).ok)return failure('销量标签冲突');
  }
  if(language!=='zh-Hans')return failure('销量标签含未知内容');
  const pattern = /(?:已售|售出)\s*[0-9]+(?:\.[0-9]+)?(?:,[0-9]{3})*\s*万?\s*\+?\s*(?:件|单)?|[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?\s*[KM]?\s*\+?\s*sold/gi;
  const matches = rawText.match(pattern) ?? [];
  const unique = [...new Set(matches.map((value) => value.trim().replace(/\s+/g,' ')))];
  if (unique.length > 1) return failure('销量标签冲突');
  if (!unique.length) return failure('无法识别销量文本');
  if (rawText.replace(pattern, '').trim()) return failure('销量标签含未知内容');
  return parseSales(unique[0]);
}

export function readShopCards(document, context, urlString) {
  if (!context?.ok || !context.root || context.root !== getShopRoot(document)) return failure('店铺范围无法确认');
  const base = (() => { try { return new URL(urlString); } catch { return null; } })();
  const cards = [], errors = [], seenGoodsIds = [], seen = new Set();
  for (const node of context.root.querySelectorAll('.js-goods-list [data-tooltip^="goodContainer-"]')) {
    const goodsId = node.getAttribute('data-tooltip')?.slice('goodContainer-'.length);
    if (!goodsId || seen.has(goodsId)) continue;
    seen.add(goodsId); seenGoodsIds.push(goodsId);
    const rawSales=text(node.querySelector('[data-type="saleTips"]'));
    const sale = rawSales.trim() ? uniqueSales(rawSales,context.language) : failure('未展示销量');
    if (!sale.ok) { errors.push({goodsId,reason:sale.reason}); continue; }
    const href = node.querySelector('a[href]')?.getAttribute('href');
    let navigationUrl = null;
    try { navigationUrl = href ? new URL(href, base ?? 'https://www.temu.com').href : null; } catch {}
    const productUrl = navigationUrl && sanitizeProductUrl(navigationUrl, goodsId);
    if (!productUrl) { errors.push({goodsId,reason:'商品链接无法校验'}); continue; }
    cards.push({goodsId,title:node.getAttribute('data-tooltip-title') ?? '',productUrl,navigationUrl,list:{capturedAt:new Date().toISOString(),rawText:sale.rawText,value:sale.value,precision:sale.precision,metricVersion:'shop-sales-v1'}});
  }
  const moreButton = [...context.root.querySelectorAll('[role="button"],button')].find(node=>languages[context.language]?.more.test(normalizeText(node.getAttribute('aria-label') || text(node)))) ?? null;
  return {ok:true,cards,errors,seenGoodsIds,hasMore:Boolean(moreButton),moreButton,reportedTotal:context.reportedTotal};
}

function extractObjects(source) {
  const results = [];
  const positions = [];
  let quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let index=0; index<source.length; index++) {
    const char=source[index], next=source[index+1];
    if (lineComment) { if (char==='\n') lineComment=false; continue; }
    if (blockComment) { if (char==='*' && next==='/') { blockComment=false; index++; } continue; }
    if (quote) { if (escaped) escaped=false; else if (char==='\\') escaped=true; else if (char===quote) quote=null; continue; }
    if (char==='/' && next==='/') { lineComment=true; index++; continue; }
    if (char==='/' && next==='*') { blockComment=true; index++; continue; }
    if (char==='"' || char==="'" || char==='`') { quote=char; continue; }
    const match=source.slice(index).match(/^(?:window\.)?rawData\s*=/);
    const before=source[index-1];
    if (match && (!before || !/[\w$.]/.test(before))) { positions.push([index,match[0].length]); index+=match[0].length-1; }
  }
  for (const [position,length] of positions) {
    let start = position + length;
    while (/\s/.test(source[start])) start++;
    if (source[start] !== '{') continue;
    let depth = 0, inString = false, escaped = false, end = -1;
    for (let index=start; index<source.length; index++) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) { end=index+1; break; }
    }
    if (end < 0) throw new Error('rawData JSON 损坏：对象未闭合');
    try { results.push(JSON.parse(source.slice(start,end))); } catch (error) { throw new Error(`rawData JSON 损坏：${error.message}`); }
  }
  return results;
}

export function extractRawData(document) {
  const values = [...document.querySelectorAll('script')].flatMap((script) => extractObjects(script.textContent ?? ''));
  if (!values.length) throw new Error('未找到 rawData');
  const canonical = JSON.stringify(values[0]);
  if (values.some((value) => JSON.stringify(value) !== canonical)) throw new Error('多份 rawData 冲突');
  return values[0];
}

export function readDetail(document, expectedContext, urlString) {
  const problem = pageProblem(document); if (problem) return failure(problem);
  const site = locale(document); if (!site) return failure('详情站点或语言不支持');
  if (site.market !== expectedContext?.market || site.language !== expectedContext?.language) return failure('详情站点或语言与任务不一致');
  let raw;
  try { raw = extractRawData(document); } catch (error) { return failure(error.message, {pending:/未找到/.test(error.message)}); }
  const store = raw?.store; const goodsId = stringId(store?.goods?.goodsId); const shopId = stringId(store?.goods?.mallId);
  if (goodsId !== expectedContext?.goodsId) return failure('详情商品与任务不一致');
  if (shopId !== expectedContext?.shopId) return failure('详情店铺与任务不一致');
  if (!sanitizeProductUrl(urlString, goodsId)) return failure('详情网址与任务不一致');
  const skuList = Array.isArray(store?.sku) ? store.sku.map((sku) => ({skuId:stringId(sku?.skuId),goodsId:stringId(sku?.goodsId)})) : store?.sku;
  const primary = store?.moduleMap?.priceModule?.data?.skuTrackInfo;
  const mirror = store?.skuModuleMap?.priceModule?.data?.skuTrackInfo;
  const checked = validateSkuSales(goodsId, skuList, primary, mirror);
  if (!checked.ok) return checked;
  const display = store?.goods?.soldQuantity;
  return {ok:true,goodsId,detail:{capturedAt:new Date().toISOString(),skuTotal:checked.skuTotal,skuIds:checked.skuIds,skuCounts:checked.skuCounts,goodsDisplayValue:Number.isSafeInteger(display)?display:null,metricVersion:'sku-sold-quantity-v1',adapterVersion:'temu-detail-v1'}};
}
