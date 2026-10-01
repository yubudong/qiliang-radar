// ==UserScript==
// @name         起量雷达
// @namespace    local.qiliang-radar
// @version      0.1.7-beta.3
// @description  Temu竞品销量参考增量追踪
// @match        https://www.temu.com/*
// @run-at       document-start
// @sandbox      DOM
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// ==/UserScript==
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/locales.mjs
  function parseCount(raw, language, { abbreviated = false } = {}) {
    const commaDecimal = ["es", "pt", "fr", "ru"].includes(language);
    const decimal = commaDecimal ? "," : ".";
    const groups = ["es", "pt"].includes(language) ? ["."] : language === "fr" ? [" ", ","] : language === "ru" ? [" "] : [","];
    let value = normalizeText(raw);
    if (abbreviated) {
      const escaped = ["pt", "ru"].includes(language) ? "[.,]" : decimal === "." ? "\\." : ",";
      if (!new RegExp(`^(?:0|[1-9]\\d*)(?:${escaped}\\d+)?$`).test(value)) return null;
      return Number(value.replace(",", "."));
    }
    if (/^(?:0|[1-9]\d*)$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : null;
    for (const separator of groups) {
      const escaped = separator === "." ? "\\." : separator;
      if (new RegExp(`^[1-9]\\d{0,2}(?:${escaped}\\d{3})+$`).test(value)) {
        const number = Number(value.split(separator).join(""));
        return Number.isSafeInteger(number) ? number : null;
      }
    }
    return null;
  }
  function parseLocalizedSales(rawText, language) {
    const fail = { ok: false, reason: "无法识别销量文本" };
    const config = languages[language];
    if (!config) return fail;
    const match = normalizeText(rawText).match(config.sold);
    if (!match) return fail;
    let number = (match[1] ?? match[2]).trim(), lower = false;
    if (number.endsWith("+")) {
      lower = true;
      number = number.slice(0, -1).trim();
    }
    const unitPatterns = { en: /\s*(K|M)$/i, es: /\s*(mil|mill\.)$/i, pt: /\s*(mil|mi)$/i, fr: /\s*(k|M)$/i, ru: /\s*(тыс\.?|млн)$/i, ar: /\s*(ألف|آلاف|مليون|K|M)$/i, ko: /\s*(천|만)$/, "zh-Hans": /(万)$/, "zh-Hant": /(萬)$/ };
    const unit = number.match(unitPatterns[language]);
    let multiplier = 1;
    if (unit) {
      const key = unit[1].toLowerCase();
      multiplier = ["m", "mill.", "mi", "млн", "مليون"].includes(key) ? 1e6 : ["万", "萬", "만"].includes(key) ? 1e4 : 1e3;
      number = number.slice(0, unit.index).trim();
    }
    const count = parseCount(number, language, { abbreviated: Boolean(unit) });
    if (count == null) return fail;
    const value = count * multiplier;
    if (!Number.isSafeInteger(value) || value < 0) return fail;
    return { ok: true, value, precision: lower ? "lower_bound" : unit ? "rounded" : "number", rawText };
  }
  function readLocale(document2) {
    const country = /^(?:美国|美國|United States(?: of America)?|US|USA|Estados Unidos|États-Unis|США|Соединенные Штаты|الولايات المتحدة(?: الأمريكية)?|미국)[ ,·]+/i;
    const controls = [...document2.querySelectorAll('[role="button"][aria-label],button[aria-label]')].map((n) => normalizeText(n.getAttribute("aria-label"))).filter((label) => Object.values(languages).some((c) => label.endsWith(c.name)));
    if (controls.length !== 1 || !country.test(controls[0])) return null;
    const name = controls[0].replace(country, "");
    const language = Object.keys(languages).find((key) => languages[key].name === name);
    return language ? { market: "US", language } : null;
  }
  function readTotal(root, language) {
    const values = /* @__PURE__ */ new Set();
    for (const node of root.querySelectorAll("div,span,p,h2")) {
      if (node.closest(".js-goods-list") || node.querySelector(".js-goods-list") || node.children.length) continue;
      const match = normalizeText(node.textContent).match(languages[language]?.total);
      if (!match) continue;
      const value = parseCount(match[1].trim(), language);
      if (value != null) values.add(value);
    }
    return values.size === 1 ? [...values][0] : null;
  }
  var languages, normalizeText;
  var init_locales = __esm({
    "src/locales.mjs"() {
      languages = {
        en: { name: "English", sold: /^(.+?)\s*sold$/i, total: /^([\d., ]+)\s*(?:items|products)\b/i, more: /^(?:See|View|Load) more(?: items| products)?$/i },
        es: { name: "Español", sold: /^(.+?)\s+vendidos?$/i, total: /^([\d., ]+)\s*(?:artículos|productos)\b/i, more: /^(?:Ver|Mostrar|Cargar) más(?: artículos| productos)?$/i },
        fr: { name: "Français", sold: /^(.+?)\s*(?:ventes?|vendu(?:s|es|e)?)$/i, total: /^([\d., ]+)\s*(?:articles|produits)\b/i, more: /^(?:Voir|Afficher) plus(?: d['’](?:articles)| de produits)?$/i },
        pt: { name: "Português", sold: /^(.+?)\s*vendidos?$/i, total: /^([\d., ]+)\s*(?:artigos|produtos|itens)\b/i, more: /^(?:Ver|Mostrar|Carregar) mais(?: artigos| produtos| itens)?$/i },
        ru: { name: "Русский", sold: /^(?:Продано\s+(.+)|(.+?)\s*продано)$/i, total: /^([\d., ]+)\s*(?:товаров|товара|товары|товар|продуктов)(?:\s|$)/i, more: /^(?:Посмотреть|Показать|Загрузить) (?:больше|ещё|еще)(?: товаров)?$/i },
        ar: { name: "العربية", sold: /^(?:تم\s*بيع|تمّ\s*بيع)\s*(.+)$/, total: /^([\d., ]+)\s*(?:منتجات|منتج(?:\(ـات\))?|سلعة|سلع)(?:\s|$)/, more: /^(?:عرض|شاهد|مشاهدة) المزيد(?: من المنتجات| من السلع)?$/ },
        ko: { name: "한국어", sold: /^(.+?)(?:개)?\s*(?:판매|판매됨|판매 완료)$/, total: /^([\d., ]+)\s*(?:개\s*)?상품/, more: /^(?:더 많은 상품 보기|상품 더 보기|더 보기)$/ },
        "zh-Hans": { name: "简体中文", sold: /^(?:已售|售出)\s*(.+?)\s*(?:件|单)$/, total: /^([\d., ]+)\s*商品/, more: /^查看更多(?:商品)?$/ },
        "zh-Hant": { name: "繁體中文", sold: /^(?:已售出|已售|售出)\s*(.+?)\s*(?:件|單)$/, total: /^([\d., ]+)\s*商品/, more: /^查看更多(?:商品)?$/ }
      };
      normalizeText = (value) => String(value ?? "").normalize("NFKC").replace(/[\u200e\u200f\u061c]/g, "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776)).replace(/٬/g, ",").replace(/٫/g, ".").replace(/\s+/g, " ").trim();
    }
  });

  // src/core.mjs
  function parseSales(rawText, language) {
    if (typeof rawText !== "string" || !rawText.trim()) return failure("销量文本为空");
    const text3 = rawText.trim();
    if (language) return parseLocalizedSales(rawText, language);
    if (/sold$/i.test(text3)) return parseLocalizedSales(rawText, "en");
    const match = text3.match(/^(?:已售|售出)\s*((?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d+)?)\s*(万)?\s*(\+)?\s*(?:件|单)$/);
    if (!match) return failure("无法识别销量文本");
    if (match[1].includes(".") && !match[2]) return failure("非万级销量必须是整数");
    if (match[3] && !match[2]) return failure("仅支持万级下界标签");
    const numeric = Number(match[1].replaceAll(",", ""));
    const value = match[2] ? numeric * 1e4 : numeric;
    if (!Number.isSafeInteger(value) || value < 0) return failure("销量不是非负安全整数");
    const precision = match[3] ? "lower_bound" : match[2] ? "rounded" : "number";
    return { ok: true, value, precision, rawText };
  }
  function normalizeMinSales(input = 20) {
    const candidate = input === "" || input == null ? 20 : Number(input);
    return Number.isSafeInteger(candidate) && candidate >= 0 ? { ok: true, value: candidate } : failure("最低累计销量必须是非负整数");
  }
  function validateSkuSales(goodsId, skuList, primaryMap, mirrorMap) {
    if (typeof goodsId !== "string" || !goodsId || !Array.isArray(skuList) || !primaryMap || typeof primaryMap !== "object") return failure("SKU 输入无效");
    const ids = [], seen = /* @__PURE__ */ new Set();
    for (const sku of skuList) {
      if (!sku || typeof sku.skuId !== "string" || typeof sku.goodsId !== "string") return failure("SKU ID 必须是字符串");
      if (sku.goodsId !== goodsId) return failure("SKU 归属其他商品");
      if (seen.has(sku.skuId)) return failure("SKU ID 重复");
      seen.add(sku.skuId);
      ids.push(sku.skuId);
    }
    if (!ids.length) return failure("SKU 清单为空");
    const mapIds = Object.keys(primaryMap);
    if (mapIds.length !== ids.length || mapIds.some((id) => !seen.has(id))) return failure("销量映射与 SKU 集合不一致");
    if (mirrorMap != null) {
      if (typeof mirrorMap !== "object") return failure("镜像销量映射无效");
      const mirrorIds = Object.keys(mirrorMap);
      if (mirrorIds.length !== ids.length || mirrorIds.some((id) => !seen.has(id))) return failure("镜像 SKU 集合不一致");
    }
    const skuCounts = {};
    let skuTotal = 0;
    for (const id of [...ids].sort()) {
      const count = countFrom(primaryMap[id]);
      if (!Number.isSafeInteger(count) || count < 0) return failure(`SKU ${id} 销量不是非负安全整数`);
      if (mirrorMap != null && countFrom(mirrorMap[id]) !== count) return failure("详情数据冲突");
      skuCounts[id] = count;
      skuTotal += count;
      if (!Number.isSafeInteger(skuTotal)) return failure("SKU 汇总超出安全整数范围");
    }
    return { ok: true, goodsId, skuTotal, skuIds: Object.keys(skuCounts), skuCounts };
  }
  function dayKey(capturedAt, timezone = "Asia/Shanghai") {
    const date = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
    if (Number.isNaN(date.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type)?.value;
      return `${get("year")}-${get("month")}-${get("day")}`;
    } catch {
      return null;
    }
  }
  function previousDayKey(day, timezone = "Asia/Shanghai") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const [year, month, date] = day.split("-").map(Number);
    const normalized = new Date(Date.UTC(year, month - 1, date, 12));
    if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== date) return null;
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(normalized);
    } catch {
      return null;
    }
    return new Date(Date.UTC(year, month - 1, date - 1, 12)).toISOString().slice(0, 10);
  }
  function compareSkuSnapshots(previous, current, historyExists = Boolean(previous)) {
    if (!current) return failure("今日快照缺失");
    if (!hasIdentity(current)) return failure("今日快照身份不完整");
    if (previous && !hasIdentity(previous)) return failure("昨日快照身份不完整");
    if (previous && identityKeys.some((key) => previous[key] !== current[key])) return failure("快照身份不一致");
    if (previousDayKey(current.day) == null) return failure("今日快照日期无效");
    if (!previous) return comparison({ status: historyExists ? "缺昨日数据" : "新收录", label: historyExists ? "缺昨日数据" : "新收录" });
    if (previousDayKey(previous.day) == null) return failure("历史快照日期无效");
    if (previous.day !== previousDayKey(current.day)) return comparison({ status: "缺昨日数据", label: "缺昨日数据" });
    const skuSetChanged = previous.detail && current.detail && !sameIds(previous.detail.skuIds, current.detail.skuIds);
    if (detailCompatible(previous.detail, current.detail)) {
      const delta = current.detail.skuTotal - previous.detail.skuTotal;
      return comparison({ source: "sku", delta, label: "SKU 汇总参考", status: delta < 0 ? "数值回落，需复核" : "可比", previousValue: previous.detail.skuTotal, currentValue: current.detail.skuTotal, previousCapturedAt: previous.detail.capturedAt ?? null, currentCapturedAt: current.detail.capturedAt ?? null });
    }
    if (listSourceCompatible(previous.list, current.list) && (previous.list.precision === "lower_bound" || current.list.precision === "lower_bound")) {
      const changed = previous.list?.rawText !== current.list?.rawText;
      return comparison({ source: "list", label: "列表下界标签", status: changed ? "展示档位变化" : "展示档位未变", previousCapturedAt: previous.list?.capturedAt ?? null, currentCapturedAt: current.list?.capturedAt ?? null });
    }
    if (listCompatible(previous.list, current.list)) {
      const delta = current.list.value - previous.list.value;
      const approximate = previous.list.precision === "rounded" || current.list.precision === "rounded";
      const status = skuSetChanged ? "SKU 集合变化；回退列表参考" : delta < 0 ? "数值回落，需复核" : approximate && delta === 0 ? "展示未变" : "可比";
      return comparison({ source: "list", delta, label: `列表参考${approximate ? "（约）" : ""}`, status, previousValue: previous.list.value, currentValue: current.list.value, previousCapturedAt: previous.list.capturedAt ?? null, currentCapturedAt: current.list.capturedAt ?? null });
    }
    if (skuSetChanged) return comparison({ status: "SKU 集合变化", label: "SKU 集合变化" });
    return comparison({ status: "来源或统计口径不兼容", label: "不可比" });
  }
  function csvCell(value) {
    if (value == null) return "";
    if (typeof value === "number") return String(value);
    let text3 = String(value);
    if (/^[=+\-@\t\r]/.test(text3)) text3 = `'${text3}`;
    return /[",\r\n]/.test(text3) ? `"${text3.replaceAll('"', '""')}"` : text3;
  }
  function toCsv(rows) {
    if (!Array.isArray(rows)) return "";
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))];
    return `\uFEFF${[headers.map(csvCell).join(","), ...rows.map((row) => headers.map((header) => csvCell(row?.[header])).join(","))].join("\r\n")}`;
  }
  function compareSnapshots(previous, current, historyExists = Boolean(previous)) {
    return compareSkuSnapshots(previous ? { ...previous, detail: null } : previous, current ? { ...current, detail: null } : current, historyExists);
  }
  var failure, countFrom, comparison, sameIds, detailCompatible, listCompatible, listSourceCompatible, identityKeys, hasIdentity;
  var init_core = __esm({
    "src/core.mjs"() {
      init_locales();
      failure = (reason) => ({ ok: false, reason });
      countFrom = (value) => value && typeof value === "object" ? value.sold_quantity : value;
      comparison = (fields) => ({ ok: true, source: "none", delta: null, label: "", status: "", previousValue: null, currentValue: null, previousCapturedAt: null, currentCapturedAt: null, ...fields });
      sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);
      detailCompatible = (a, b) => a && b && a.metricVersion === b.metricVersion && Number.isSafeInteger(a.skuTotal) && Number.isSafeInteger(b.skuTotal) && sameIds(a.skuIds, b.skuIds);
      listCompatible = (a, b) => a && b && a.metricVersion === b.metricVersion && ["number", "rounded"].includes(a.precision) && ["number", "rounded"].includes(b.precision) && Number.isSafeInteger(a.value) && Number.isSafeInteger(b.value);
      listSourceCompatible = (a, b) => a && b && typeof a.metricVersion === "string" && a.metricVersion === b.metricVersion && ["number", "rounded", "lower_bound"].includes(a.precision) && ["number", "rounded", "lower_bound"].includes(b.precision) && Number.isSafeInteger(a.value) && a.value >= 0 && Number.isSafeInteger(b.value) && b.value >= 0;
      identityKeys = ["market", "language", "shopId", "goodsId"];
      hasIdentity = (snapshot) => identityKeys.every((key) => typeof snapshot?.[key] === "string" && snapshot[key].length > 0);
    }
  });

  // src/adapters.mjs
  var adapters_exports = {};
  __export(adapters_exports, {
    extractRawData: () => extractRawData,
    getShopRoot: () => getShopRoot,
    pageProblem: () => pageProblem,
    readDetail: () => readDetail,
    readShopCards: () => readShopCards,
    readShopContext: () => readShopContext,
    sanitizeProductUrl: () => sanitizeProductUrl
  });
  function pageProblem(document2) {
    const dialogs = [...document2.querySelectorAll('[role="dialog"]')];
    if (dialogs.some((node) => /请完成验证|安全验证|验证码|滑块验证|verify you are human|security verification|captcha/i.test(text(node)))) return "页面需要验证";
    if (dialogs.some((node) => /登录后继续|请先登录|sign in to continue|log in to continue/i.test(text(node)))) return "页面需要登录";
    const heading = text(document2.querySelector("h1"));
    if (/页面不存在|访问出错|Something went wrong/i.test(heading)) return "页面加载失败";
    return null;
  }
  function getShopRoot(document2) {
    const anchor = document2.getElementById("mall-top-head-category-container");
    const candidate = anchor?.nextElementSibling;
    return candidate?.classList?.contains("mainContent") && candidate.querySelector(".js-goods-list") ? candidate : null;
  }
  function readShopContext(document2, urlString) {
    const problem = pageProblem(document2);
    if (problem) return failure2(problem);
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return failure2("店铺网址无效");
    }
    const shopId = url.hostname === "www.temu.com" ? url.searchParams.get("mall_id") : null;
    const root = getShopRoot(document2);
    const site = locale(document2);
    if (!shopId || !root || !site) return failure2("不支持的店铺页面结构");
    const reportedTotal = readTotal(root, site.language);
    return { ok: true, ...site, shopId, shopName: text(document2.querySelector("h1")), reportedTotal: Number.isSafeInteger(reportedTotal) ? reportedTotal : null, root };
  }
  function sanitizeProductUrl(urlString, expectedGoodsId) {
    let url;
    try {
      url = new URL(urlString, "https://www.temu.com");
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.hostname !== "www.temu.com") return null;
    const expected = String(expectedGoodsId ?? "");
    const pathMatch = url.pathname.match(/-g-([^/.]+)\.html$/);
    if (pathMatch && pathMatch[1] === expected) return `https://www.temu.com${url.pathname}`;
    if (url.pathname === "/goods.html" && url.searchParams.get("goods_id") === expected) return `https://www.temu.com/goods.html?goods_id=${encodeURIComponent(expected)}`;
    return null;
  }
  function uniqueSales(rawText, language) {
    const direct = parseSales(rawText, language);
    if (direct.ok) return direct;
    const normalized = normalizeText(rawText);
    for (let split = 1; split < normalized.length; split++) {
      const a = normalized.slice(0, split).trim(), b = normalized.slice(split).trim();
      if (a === b) {
        const parsed = parseSales(a, language);
        if (parsed.ok) return parsed;
      }
      if (parseSales(a, language).ok && parseSales(b, language).ok) return failure2("销量标签冲突");
    }
    if (language !== "zh-Hans") return failure2("销量标签含未知内容");
    const pattern = /(?:已售|售出)\s*[0-9]+(?:\.[0-9]+)?(?:,[0-9]{3})*\s*万?\s*\+?\s*(?:件|单)?|[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?\s*[KM]?\s*\+?\s*sold/gi;
    const matches = rawText.match(pattern) ?? [];
    const unique = [...new Set(matches.map((value) => value.trim().replace(/\s+/g, " ")))];
    if (unique.length > 1) return failure2("销量标签冲突");
    if (!unique.length) return failure2("无法识别销量文本");
    if (rawText.replace(pattern, "").trim()) return failure2("销量标签含未知内容");
    return parseSales(unique[0]);
  }
  function readShopCards(document2, context, urlString) {
    if (!context?.ok || !context.root || context.root !== getShopRoot(document2)) return failure2("店铺范围无法确认");
    const base = (() => {
      try {
        return new URL(urlString);
      } catch {
        return null;
      }
    })();
    const cards = [], errors = [], seenGoodsIds = [], seen = /* @__PURE__ */ new Set();
    for (const node of context.root.querySelectorAll('.js-goods-list [data-tooltip^="goodContainer-"]')) {
      const goodsId = node.getAttribute("data-tooltip")?.slice("goodContainer-".length);
      if (!goodsId || seen.has(goodsId)) continue;
      seen.add(goodsId);
      seenGoodsIds.push(goodsId);
      const rawSales = text(node.querySelector('[data-type="saleTips"]'));
      const sale = rawSales.trim() ? uniqueSales(rawSales, context.language) : failure2("未展示销量");
      if (!sale.ok) {
        errors.push({ goodsId, reason: sale.reason });
        continue;
      }
      const href = node.querySelector("a[href]")?.getAttribute("href");
      let navigationUrl = null;
      try {
        navigationUrl = href ? new URL(href, base ?? "https://www.temu.com").href : null;
      } catch {
      }
      const productUrl = navigationUrl && sanitizeProductUrl(navigationUrl, goodsId);
      if (!productUrl) {
        errors.push({ goodsId, reason: "商品链接无法校验" });
        continue;
      }
      cards.push({ goodsId, title: node.getAttribute("data-tooltip-title") ?? "", productUrl, navigationUrl, list: { capturedAt: (/* @__PURE__ */ new Date()).toISOString(), rawText: sale.rawText, value: sale.value, precision: sale.precision, metricVersion: "shop-sales-v1" } });
    }
    const moreButton = [...context.root.querySelectorAll('[role="button"],button')].find((node) => languages[context.language]?.more.test(normalizeText(node.getAttribute("aria-label") || text(node)))) ?? null;
    return { ok: true, cards, errors, seenGoodsIds, hasMore: Boolean(moreButton), moreButton, reportedTotal: context.reportedTotal };
  }
  function extractObjects(source) {
    const results = [];
    const positions = [];
    let quote = null, escaped = false, lineComment = false, blockComment = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index], next = source[index + 1];
      if (lineComment) {
        if (char === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          index++;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "/" && next === "/") {
        lineComment = true;
        index++;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        index++;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      const match = source.slice(index).match(/^(?:window\.)?rawData\s*=/);
      const before = source[index - 1];
      if (match && (!before || !/[\w$.]/.test(before))) {
        positions.push([index, match[0].length]);
        index += match[0].length - 1;
      }
    }
    for (const [position, length] of positions) {
      let start = position + length;
      while (/\s/.test(source[start])) start++;
      if (source[start] !== "{") continue;
      let depth = 0, inString = false, escaped2 = false, end = -1;
      for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (inString) {
          if (escaped2) escaped2 = false;
          else if (char === "\\") escaped2 = true;
          else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === "{") depth++;
        else if (char === "}" && --depth === 0) {
          end = index + 1;
          break;
        }
      }
      if (end < 0) throw new Error("rawData JSON 损坏：对象未闭合");
      try {
        results.push(JSON.parse(source.slice(start, end)));
      } catch (error) {
        throw new Error(`rawData JSON 损坏：${error.message}`);
      }
    }
    return results;
  }
  function extractRawData(document2) {
    const values = [...document2.querySelectorAll("script")].flatMap((script) => extractObjects(script.textContent ?? ""));
    if (!values.length) throw new Error("未找到 rawData");
    const canonical = JSON.stringify(values[0]);
    if (values.some((value) => JSON.stringify(value) !== canonical)) throw new Error("多份 rawData 冲突");
    return values[0];
  }
  function readDetail(document2, expectedContext, urlString) {
    const problem = pageProblem(document2);
    if (problem) return failure2(problem);
    const site = locale(document2);
    if (!site) return failure2("详情站点或语言不支持");
    if (site.market !== expectedContext?.market || site.language !== expectedContext?.language) return failure2("详情站点或语言与任务不一致");
    let raw;
    try {
      raw = extractRawData(document2);
    } catch (error) {
      return failure2(error.message, { pending: /未找到/.test(error.message) });
    }
    const store = raw?.store;
    const goodsId = stringId(store?.goods?.goodsId);
    const shopId = stringId(store?.goods?.mallId);
    if (goodsId !== expectedContext?.goodsId) return failure2("详情商品与任务不一致");
    if (shopId !== expectedContext?.shopId) return failure2("详情店铺与任务不一致");
    if (!sanitizeProductUrl(urlString, goodsId)) return failure2("详情网址与任务不一致");
    const skuList = Array.isArray(store?.sku) ? store.sku.map((sku) => ({ skuId: stringId(sku?.skuId), goodsId: stringId(sku?.goodsId) })) : store?.sku;
    const primary = store?.moduleMap?.priceModule?.data?.skuTrackInfo;
    const mirror = store?.skuModuleMap?.priceModule?.data?.skuTrackInfo;
    const checked = validateSkuSales(goodsId, skuList, primary, mirror);
    if (!checked.ok) return checked;
    const display = store?.goods?.soldQuantity;
    return { ok: true, goodsId, detail: { capturedAt: (/* @__PURE__ */ new Date()).toISOString(), skuTotal: checked.skuTotal, skuIds: checked.skuIds, skuCounts: checked.skuCounts, goodsDisplayValue: Number.isSafeInteger(display) ? display : null, metricVersion: "sku-sold-quantity-v1", adapterVersion: "temu-detail-v1" } };
  }
  var failure2, text, stringId, locale;
  var init_adapters = __esm({
    "src/adapters.mjs"() {
      init_locales();
      init_core();
      failure2 = (reason, extra = {}) => ({ ok: false, reason, ...extra });
      text = (node) => node?.textContent?.trim() ?? "";
      stringId = (value) => typeof value === "string" || Number.isSafeInteger(value) ? String(value) : null;
      locale = readLocale;
    }
  });

  // src/storage.mjs
  var storage_exports = {};
  __export(storage_exports, {
    createStorage: () => createStorage
  });
  function createStorage({ getValue, setValue, listValues }, { canWrite = () => false, now = () => /* @__PURE__ */ new Date() } = {}) {
    if (![getValue, setValue, listValues].every((fn) => typeof fn === "function")) throw new Error("GM 存储接口不完整");
    const read = async (key, fallback = null) => clone(await getValue(key, fallback));
    const requireLock = () => {
      if (!canWrite()) throw new Error("没有写入锁，已停止保存");
    };
    const writeVerified = async (key, value, protectedWrite = true) => {
      if (protectedWrite) requireLock();
      try {
        await setValue(key, clone(value));
      } catch (error) {
        throw new Error(`本地存储写入失败：${error.message}`);
      }
      let reread;
      try {
        reread = await getValue(key, null);
      } catch (error) {
        throw new Error(`本地存储复读失败：${error.message}`);
      }
      if (!same(reread, value)) throw new Error("本地存储写后复读不一致");
    };
    const normalizedIdentity = (identity) => {
      const fields = ["market", "language", "shopId", "goodsId", "shopName", "title"];
      if (!identity || fields.some((key) => typeof identity[key] !== "string" || !identity[key])) throw new Error("商品身份无效：字段必须是非空字符串");
      const productUrl = sanitizeProductUrl(identity.productUrl, identity.goodsId);
      if (!productUrl) throw new Error("商品身份无效：商品链接无法校验");
      return { ...Object.fromEntries(fields.map((key) => [key, identity[key]])), productUrl };
    };
    const validReading = (reading) => {
      if (!reading || !["list", "detail"].includes(reading.kind) || !reading.data || reading.status && reading.status !== "success" || !dayKey(reading.data.capturedAt)) return false;
      const data = reading.data;
      if (reading.kind === "list") return typeof data.rawText === "string" && Boolean(data.rawText.trim()) && Number.isSafeInteger(data.value) && data.value >= 0 && ["number", "rounded", "lower_bound"].includes(data.precision) && data.metricVersion === "shop-sales-v1";
      if (!Number.isSafeInteger(data.skuTotal) || data.skuTotal < 0 || !Array.isArray(data.skuIds) || !data.skuIds.length || typeof data.skuCounts !== "object" || !data.skuCounts || data.metricVersion !== "sku-sold-quantity-v1" || typeof data.adapterVersion !== "string" || !data.adapterVersion) return false;
      if (data.goodsDisplayValue !== null && (!Number.isSafeInteger(data.goodsDisplayValue) || data.goodsDisplayValue < 0)) return false;
      const sorted = [...data.skuIds].sort();
      if (data.skuIds.some((id) => typeof id !== "string" || !id) || new Set(data.skuIds).size !== data.skuIds.length || !data.skuIds.every((id, index) => id === sorted[index])) return false;
      if (Object.keys(data.skuCounts).sort().join("\0") !== sorted.join("\0")) return false;
      let total = 0;
      for (const id of sorted) {
        const count = data.skuCounts[id];
        if (!Number.isSafeInteger(count) || count < 0) return false;
        total += count;
      }
      return Number.isSafeInteger(total) && total === data.skuTotal;
    };
    const queues = /* @__PURE__ */ new Map();
    const serialize = async (key, operation) => {
      const prior = queues.get(key) ?? Promise.resolve();
      const current = prior.catch(() => {
      }).then(operation);
      queues.set(key, current);
      try {
        return await current;
      } finally {
        if (queues.get(key) === current) queues.delete(key);
      }
    };
    return {
      async getSettings() {
        const stored = await read(SETTINGS, {});
        const min = normalizeMinSales(stored?.minSales);
        const settings = { schemaVersion: 1, minSales: min.ok ? min.value : 20, dayTimezone: "Asia/Shanghai" };
        if (!min.ok || stored?.schemaVersion !== 1 || stored?.dayTimezone !== "Asia/Shanghai") await writeVerified(SETTINGS, settings, false);
        return settings;
      },
      async saveSettings(value) {
        const min = normalizeMinSales(value?.minSales);
        if (!min.ok) throw new Error(min.reason);
        const settings = { schemaVersion: 1, minSales: min.value, dayTimezone: "Asia/Shanghai" };
        await writeVerified(SETTINGS, settings, false);
        return settings;
      },
      async saveDailyReading(identity, reading) {
        requireLock();
        const id = normalizedIdentity(identity);
        if (!validReading(reading)) throw new Error("每日读数无效");
        const day = dayKey(reading.data.capturedAt);
        const key = snapshotKey(id, day);
        return serialize(key, async () => {
          requireLock();
          const previous = await read(key, null);
          const base = previous ?? { schemaVersion: 1, ...id, day, list: null, detail: null, lastAttempt: null };
          const old = base[reading.kind];
          const isNewer = !old || Date.parse(reading.data.capturedAt) > Date.parse(old.capturedAt);
          const result = { ...base, ...id, [reading.kind]: isNewer ? clone(reading.data) : old, lastAttempt: { attemptedAt: now().toISOString(), status: "success", reasonCode: null } };
          await writeVerified(key, result);
          return result;
        });
      },
      async recordFailure(identity, day, reason) {
        requireLock();
        const id = normalizedIdentity(identity);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !reason) throw new Error("失败记录无效");
        const key = snapshotKey(id, day);
        return serialize(key, async () => {
          requireLock();
          const previous = await read(key, null);
          if (!previous) return null;
          const result = { ...previous, lastAttempt: { attemptedAt: now().toISOString(), status: "failed", reasonCode: String(reason) } };
          await writeVerified(key, result);
          return result;
        });
      },
      async getSnapshot(identity, day) {
        const id = normalizedIdentity(identity);
        return read(snapshotKey(id, day), null);
      },
      async listSnapshots(context = {}, day) {
        const keys = await listValues();
        const values = [];
        for (const key of keys.filter((key2) => key2.startsWith(SNAPSHOT) && (!day || key2.endsWith(`:${day}`)))) {
          const value = await read(key, null);
          if (value && ["market", "language", "shopId", "goodsId"].every((field) => context[field] == null || value[field] === context[field])) values.push(value);
        }
        return values;
      },
      async getRun() {
        return read(RUN, { current: null, history: [] });
      },
      async saveRun(run) {
        requireLock();
        return serialize(RUN, async () => {
          requireLock();
          const existing = await read(RUN, { current: null, history: [] });
          const clean = cleanDeep(run);
          const history = [...existing.history ?? []];
          if (clean?.status === "completed" && !history.some((item) => item.runId === clean.runId)) history.push(clean);
          const result = { current: clean, history };
          await writeVerified(RUN, result);
          return result;
        });
      }
    };
  }
  var PREFIX, SETTINGS, RUN, SNAPSHOT, clone, identityParts, identityKey, snapshotKey, same, cleanDeep;
  var init_storage = __esm({
    "src/storage.mjs"() {
      init_core();
      init_adapters();
      PREFIX = "qiliang-radar:v1:";
      SETTINGS = `${PREFIX}settings`;
      RUN = `${PREFIX}run`;
      SNAPSHOT = `${PREFIX}snapshot:`;
      clone = (value) => value == null ? value : structuredClone(value);
      identityParts = (value) => [value.market, value.language, value.shopId, value.goodsId];
      identityKey = (identity) => encodeURIComponent(JSON.stringify(identityParts(identity)));
      snapshotKey = (identity, day) => `${SNAPSHOT}${identityKey(identity)}:${day}`;
      same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      cleanDeep = (value) => {
        if (Array.isArray(value)) return value.map(cleanDeep);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "navigationUrl").map(([key, item]) => [key, cleanDeep(item)]));
      };
    }
  });

  // src/runtime.mjs
  var runtime_exports = {};
  __export(runtime_exports, {
    RUNTIME_DEFAULTS: () => RUNTIME_DEFAULTS,
    addTaskMarker: () => addTaskMarker,
    createRuntime: () => createRuntime,
    parseTaskMarker: () => parseTaskMarker,
    taskKeys: () => taskKeys
  });
  function taskKeys(runId, taskId) {
    if (!validMarker({ runId, taskId })) throw new Error("任务标识无效");
    const suffix = `${runId}:${taskId}`;
    return { task: `${PREFIX2}task:${suffix}`, result: `${PREFIX2}result:${suffix}`, ack: `${PREFIX2}ack:${suffix}` };
  }
  function addTaskMarker(url, marker) {
    if (!validMarker(marker)) throw new Error("任务标识无效");
    const parsed = new URL(url);
    if (parsed.hash) throw new Error("existing-hash");
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.temu.com") throw new Error("任务链接不属于支持的站点");
    parsed.hash = MARKER + encodeURIComponent(JSON.stringify({ runId: marker.runId, taskId: marker.taskId }));
    return parsed.href;
  }
  function parseTaskMarker(url) {
    try {
      const hash = new URL(url).hash;
      if (!hash.startsWith(MARKER)) return null;
      const value = JSON.parse(decodeURIComponent(hash.slice(MARKER.length)));
      return validMarker(value) ? { runId: value.runId, taskId: value.taskId } : null;
    } catch {
      return null;
    }
  }
  function createRuntime(deps) {
    const { storage, gm, locks, readCards, clickMore, scrollList, onState = () => {
    }, now = () => /* @__PURE__ */ new Date(), setTimeout: schedule = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout, createId = () => globalThis.crypto.randomUUID() } = deps;
    const config = { ...RUNTIME_DEFAULTS, ...deps.config };
    for (const key of Object.keys(RUNTIME_DEFAULTS)) if (!Number.isFinite(config[key]) || config[key] <= 0) throw new Error(`无效运行参数：${key}`);
    config.taskIntervalMs = Math.max(3e3, config.taskIntervalMs);
    config.maxScrollRounds = Math.min(3, Math.floor(config.maxScrollRounds));
    let held = false, starting = false, ending = false, lifetime = null, writeChain = Promise.resolve(), active = null, recovery = null, shopContext = null;
    let run = { status: "idle", phase: "list", reason: null, discoveredGoodsIds: [], pendingGoodsIds: [], completedGoodsIds: [], errors: [], currentTask: null };
    let items = [], seen = /* @__PURE__ */ new Set(), saved = /* @__PURE__ */ new Set(), belowThreshold = /* @__PURE__ */ new Set(), blockedTask = null, navigation = /* @__PURE__ */ new Map(), listDone = false, lastClosedAt = null, fatal = false;
    const waiters = /* @__PURE__ */ new Set();
    const milliseconds = () => now().getTime();
    const today = () => dayKey(now());
    const live = () => held && !ending;
    const currentDay = () => today() === run.day;
    const snapshot = () => clone2({ ...run, items, currentTask: active?.task ?? blockedTask ?? null, belowThresholdGoodsIds: [...belowThreshold], discoveredGoodsIds: [...seen], pendingGoodsIds: items.filter((item) => item.status === "pending").map((item) => item.identity.goodsId), completedGoodsIds: items.filter((item) => item.status === "completed").map((item) => item.identity.goodsId), savedListGoodsIds: [...saved] });
    const emit = () => {
      try {
        onState(snapshot());
      } catch {
      }
    };
    const wake = () => {
      for (const finish of [...waiters]) finish();
    };
    const wait = (ms = config.pollMs) => new Promise((resolve) => {
      let timer;
      const finish = () => {
        if (timer !== void 0) cancel(timer);
        waiters.delete(finish);
        resolve();
      };
      waiters.add(finish);
      timer = schedule(finish, ms);
      if (ending) finish();
    });
    const change = (status, reason = null) => {
      run.status = status;
      run.reason = reason;
      emit();
      wake();
    };
    const checkDay = () => {
      if (currentDay()) return true;
      change("paused", "day-changed");
      if (active) active.invalid = true;
      return false;
    };
    const guardedWrite = (fn) => {
      const job = writeChain.then(async () => {
        if (!live() || !checkDay()) return false;
        await fn();
        return true;
      });
      writeChain = job.catch(() => {
      });
      return job;
    };
    const persist = () => guardedWrite(() => storage.saveRun({ ...snapshot(), updatedAt: now().toISOString() }));
    const failure3 = (goodsId, reason) => {
      run.errors.push({ goodsId: goodsId ?? null, reasonCode: reason });
    };
    const detach = async (target) => {
      if (target?.listener != null) {
        const id = target.listener;
        target.listener = null;
        await gm.removeValueChangeListener(id);
      }
    };
    const storageFailed = (error) => {
      fatal = true;
      if (active) active.invalid = true;
      failure3(active?.task.goodsId, "storage-failed");
      change("paused", `storage-failed: ${error.message}`);
    };
    const pauseFor = async (reason, goodsId = active?.task.goodsId) => {
      if (!live()) return;
      if (active) {
        active.failed = true;
        active.invalid = true;
        active.task.status = "failed";
      }
      failure3(goodsId, reason);
      change("paused", reason);
      if (goodsId && currentDay()) {
        const item = items.find((item2) => item2.identity.goodsId === goodsId);
        if (item) await guardedWrite(() => storage.recordFailure(item.identity, run.day, reason));
      }
      await persist();
    };
    const waitRunnable = async () => {
      while (live()) {
        checkDay();
        if (run.status === "running") return true;
        await wait();
      }
      return false;
    };
    const makeIdentity = (card) => ({ ...pickContext(shopContext), goodsId: String(card.goodsId), title: String(card.title ?? ""), productUrl: String(card.productUrl ?? "") });
    const readList = async () => {
      if (!live() || !checkDay()) return null;
      const result2 = await readCards(shopContext);
      if (!live() || !checkDay()) return null;
      if (!result2?.ok) {
        await pauseFor(result2?.reason ?? "list-unavailable", null);
        return null;
      }
      for (const id of result2.seenGoodsIds ?? []) if (typeof id === "string" && id) seen.add(id);
      for (const error of result2.errors ?? []) {
        if (error.goodsId) seen.add(String(error.goodsId));
        if (!run.errors.some((e) => e.goodsId === error.goodsId && e.reasonCode === error.reason)) failure3(error.goodsId, error.reason ?? "list-invalid");
      }
      for (const card of result2.cards ?? []) {
        if (!live() || !checkDay()) break;
        if (typeof card.goodsId !== "string" || !card.goodsId) continue;
        seen.add(card.goodsId);
        if (typeof card.navigationUrl === "string") navigation.set(card.goodsId, card.navigationUrl);
        const reading = card.list;
        if (!reading || !Number.isSafeInteger(reading.value) || reading.value < 0 || !["number", "rounded", "lower_bound"].includes(reading.precision) || !reading.metricVersion) {
          failure3(card.goodsId, "list-invalid");
          continue;
        }
        if (reading.value < run.minSales) {
          belowThreshold.add(card.goodsId);
          continue;
        }
        belowThreshold.delete(card.goodsId);
        if (saved.has(card.goodsId)) continue;
        if (dayKey(reading.capturedAt) !== run.day) {
          failure3(card.goodsId, "reading-day-mismatch");
          continue;
        }
        const identity = makeIdentity(card);
        if (!await guardedWrite(() => storage.saveDailyReading(identity, { kind: "list", data: reading }))) break;
        saved.add(card.goodsId);
        let item = items.find((item2) => item2.identity.goodsId === card.goodsId);
        if (item) item.identity = identity;
        else if (deps.enableDetail === true && reading.value >= 1e4) {
          item = { identity, status: "pending", attempts: 0 };
          items.push(item);
        }
      }
      run.reportedTotal = Number.isSafeInteger(result2.reportedTotal) ? result2.reportedTotal : null;
      emit();
      await persist();
      return result2;
    };
    const scan = async () => {
      run.phase = "list";
      run.listComplete = false;
      emit();
      let result2 = await readList(), rounds = 0, scrolls = 0;
      while (live() && result2 && rounds++ < config.maxListRounds) {
        if (!await waitRunnable()) return;
        if (result2.hasMore === false && run.reportedTotal !== null && seen.size >= run.reportedTotal) {
          run.listComplete = true;
          break;
        }
        const before = seen.size;
        const clickedMore = Boolean(result2.hasMore && result2.moreButton);
        if (result2.hasMore && result2.moreButton) {
          await clickMore(result2.moreButton);
        } else if (scrollList && scrolls < config.maxScrollRounds) {
          await scrollList(shopContext);
          scrolls++;
        } else break;
        const deadline = milliseconds() + config.listWaitMs;
        let progressed = false;
        while (live() && milliseconds() < deadline) {
          if (!await waitRunnable()) return;
          result2 = await readList();
          if (!result2) return;
          if (seen.size > before) {
            scrolls = 0;
            progressed = true;
            break;
          }
          if (!clickedMore && result2.hasMore && result2.moreButton) {
            progressed = true;
            break;
          }
          await wait(Math.min(config.pollMs, Math.max(1, deadline - milliseconds())));
        }
        if (!progressed) {
          run.listReason = "no-new-cards";
          break;
        }
      }
      if (result2) {
        listDone = true;
        run.phase = "detail";
        await persist();
        emit();
      }
    };
    const validResult = (value, target) => value && value.runId === target.task.runId && value.taskId === target.task.taskId && value.goodsId === target.task.goodsId && sameContext(value, target.task) && value.day === run.day && validId(value.workerInstanceId) && (!target.task.workerInstanceId || value.workerInstanceId === target.task.workerInstanceId) && typeof value.ok === "boolean";
    const validDetail = (value) => value && dayKey(value.capturedAt) === run.day && Number.isSafeInteger(value.skuTotal) && value.skuTotal >= 0 && Array.isArray(value.skuIds) && value.skuIds.length > 0 && new Set(value.skuIds).size === value.skuIds.length && value.skuIds.every((id) => typeof id === "string" && id) && typeof value.metricVersion === "string" && typeof value.adapterVersion === "string";
    const consume = async (target, value) => {
      if (!live() || active !== target || target.invalid || target.accepted || target.processing || !checkDay() || !validResult(value, target)) return;
      target.processing = true;
      target.task.workerInstanceId = value.workerInstanceId;
      try {
        if (!value.ok) {
          await pauseFor(value.reason ?? "detail-unavailable");
          return;
        }
        if (!validDetail(value.detail)) {
          await pauseFor("detail-invalid");
          return;
        }
        const item = items.find((item2) => item2.identity.goodsId === target.task.goodsId);
        if (!item) {
          await pauseFor("task-identity-missing");
          return;
        }
        if (!await guardedWrite(() => storage.saveDailyReading(item.identity, { kind: "detail", data: value.detail }))) return;
        if (!live() || active !== target || !checkDay() || target.invalid) return;
        target.accepted = true;
        target.task.status = "saved";
        target.acceptedAt = milliseconds();
        await guardedWrite(() => gm.setValue(target.keys.ack, { runId: target.task.runId, taskId: target.task.taskId, workerInstanceId: value.workerInstanceId, goodsId: value.goodsId, day: run.day, saved: true }));
        await persist();
        emit();
        wake();
      } catch (error) {
        storageFailed(error);
      } finally {
        target.processing = false;
        wake();
      }
    };
    const listen = async (target) => {
      const reread = async () => {
        if (!live() || active !== target) return;
        try {
          await consume(target, await gm.getValue(target.keys.result, null));
        } catch (error) {
          storageFailed(error);
        }
      };
      target.listener = await gm.addValueChangeListener(target.keys.result, () => {
        void reread();
      });
      if (!live() || active !== target) {
        await detach(target);
        return;
      }
      await consume(target, await gm.getValue(target.keys.result, null));
    };
    const monitor = async (target) => {
      while (live() && active === target) {
        if (!checkDay()) {
          await wait();
          continue;
        }
        if (target.action) return target.action;
        if (target.orphan) {
          await wait();
          continue;
        }
        if (!target.processing && !target.failed) {
          if (target.accepted && target.handle?.closed === true) return "completed";
          if (!target.accepted && target.handle?.closed === true) await pauseFor("page-closed-before-result");
          else if (!target.accepted && milliseconds() - target.startedAt >= config.timeoutMs) await pauseFor("detail-timeout");
          else if (target.accepted && milliseconds() - target.acceptedAt >= config.closeTimeoutMs) await pauseFor("page-not-closed");
        }
        await wait();
      }
      return "ended";
    };
    const finishTask = async (target, outcome) => {
      target.invalid = true;
      await detach(target);
      const item = items.find((item2) => item2.identity.goodsId === target.task.goodsId);
      if (item && outcome === "completed") item.status = "completed";
      if (item && outcome === "skipped") item.status = "skipped";
      if (active === target) active = null;
      lastClosedAt = milliseconds();
      await persist();
      emit();
    };
    const dispatch = async (item) => {
      if (!live() || !checkDay()) return;
      const task = { schemaVersion: 1, runId: run.runId, taskId: `${createId()}-${milliseconds()}`, goodsId: item.identity.goodsId, ...pickContext(run), day: run.day, createdAt: now().toISOString(), status: "pending", config: { timeoutMs: config.timeoutMs, maxScrollRounds: config.maxScrollRounds } };
      const target = { task, keys: taskKeys(task.runId, task.taskId), handle: null, startedAt: milliseconds(), accepted: false, failed: false, invalid: false, processing: false, orphan: false };
      let url;
      try {
        url = addTaskMarker(navigation.get(item.identity.goodsId), task);
      } catch (error) {
        await pauseFor(error.message, item.identity.goodsId);
        return;
      }
      item.attempts++;
      active = target;
      await persist();
      if (!await guardedWrite(() => gm.setValue(target.keys.task, task))) return;
      await listen(target);
      if (!await waitRunnable()) return;
      target.startedAt = milliseconds();
      try {
        target.handle = await gm.openInTab(url, { active: false, insert: true, setParent: true });
        if (!target.handle || typeof target.handle.closed !== "boolean") {
          target.orphan = true;
          await pauseFor("page-close-state-unavailable");
        }
      } catch {
        await pauseFor("page-open-failed");
      }
      const outcome = await monitor(target);
      if (live()) await finishTask(target, outcome);
    };
    const restoreActive = async () => {
      const task = recovery?.currentTask;
      if (!task) return;
      const target = { task: clone2(task), keys: taskKeys(task.runId, task.taskId), handle: null, startedAt: milliseconds(), accepted: false, failed: task.status === "failed", invalid: task.status === "failed", processing: false, orphan: true };
      active = target;
      await listen(target);
      if (!live()) return;
      change("paused", "orphan-page-close-required");
      await persist();
      const outcome = await monitor(target);
      if (live()) await finishTask(target, outcome);
    };
    const loop = async () => {
      try {
        if (recovery) await restoreActive();
        if (deps.enableDetail !== true) items = [];
        while (live()) {
          if (!await waitRunnable()) break;
          if (!listDone) {
            await scan();
            continue;
          }
          const item = items.find((item2) => item2.status === "pending");
          if (!item) {
            change("completed");
            await persist();
            break;
          }
          if (!navigation.has(item.identity.goodsId)) {
            change("paused", "navigation-unavailable");
            continue;
          }
          if (lastClosedAt !== null && milliseconds() - lastClosedAt < config.taskIntervalMs) {
            await wait(config.taskIntervalMs - (milliseconds() - lastClosedAt));
            continue;
          }
          await dispatch(item);
        }
      } catch (error) {
        storageFailed(error);
        while (live()) await wait();
      } finally {
        ending = true;
        wake();
        if (active) {
          active.invalid = true;
          await detach(active);
        }
        await writeChain;
        if (run.reason === "ended-by-user" && currentDay()) try {
          await storage.saveRun({ ...snapshot(), updatedAt: now().toISOString() });
        } catch (error) {
          failure3(null, `storage-failed: ${error.message}`);
        }
        held = false;
        starting = false;
        emit();
      }
    };
    const acquire = async () => {
      if (!locks?.request) {
        change("interrupted", "locks-unavailable");
        return { ok: false, reason: "locks-unavailable" };
      }
      const entered = deferred();
      starting = true;
      ending = false;
      fatal = false;
      lifetime = Promise.resolve().then(() => locks.request(LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) {
          starting = false;
          change("interrupted", "lock-unavailable");
          entered.resolve({ ok: false, reason: "lock-unavailable" });
          return;
        }
        held = true;
        starting = false;
        change("running");
        try {
          await persist();
          entered.resolve({ ok: true });
          await loop();
        } catch (error) {
          ending = true;
          if (active) {
            active.invalid = true;
            await detach(active);
          }
          await writeChain;
          held = false;
          starting = false;
          change("interrupted", `storage-failed: ${error.message}`);
          entered.resolve({ ok: false, reason: "storage-failed" });
        }
      })).catch((error) => {
        held = false;
        starting = false;
        change("interrupted", error.message);
        entered.resolve({ ok: false, reason: error.message });
      });
      return entered.promise;
    };
    const prepare = (context, settings, old = null) => {
      shopContext = context;
      ending = false;
      fatal = false;
      belowThreshold = /* @__PURE__ */ new Set();
      blockedTask = null;
      navigation = /* @__PURE__ */ new Map();
      lastClosedAt = null;
      active = null;
      listDone = false;
      if (old) {
        recovery = clone2(old);
        run = clone2(old);
        items = clone2(old.items ?? []);
        seen = /* @__PURE__ */ new Set();
        saved = /* @__PURE__ */ new Set();
      } else {
        recovery = null;
        items = [];
        seen = /* @__PURE__ */ new Set();
        saved = /* @__PURE__ */ new Set();
        run = { schemaVersion: 1, runId: `${createId()}-${milliseconds()}`, ...pickContext(context), day: today(), minSales: settings.minSales, status: "idle", phase: "list", reason: null, listComplete: false, errors: [] };
      }
    };
    const result = (reason) => ({ ok: false, reason });
    const pageClosed = (options, target) => {
      if (target.orphan) return options.confirmedOrphanClosed === true;
      return target.handle?.closed === true || !target.handle && options.confirmedOrphanClosed === true;
    };
    return {
      ownsLock: () => held,
      canWrite: () => held && currentDay(),
      getState: snapshot,
      async startRun(context, settings = {}, options = {}) {
        if (starting || held) return result("already-running");
        const minimum = normalizeMinSales(settings.minSales);
        if (!minimum.ok) return result(minimum.reason);
        if (!context?.market || !context?.language || !context?.shopId) return result("shop-context-invalid");
        starting = true;
        try {
          const stored = await storage.getRun(), old = stored?.current ?? null;
          if (old && old.day === today() && sameContext(old, context) && !["completed", "ended", "interrupted"].includes(old.status)) {
            prepare(context, { minSales: minimum.value }, old);
            starting = false;
            change("recoverable", "resume-required");
            return result("resume-required");
          }
          const knownClosed = active?.task.runId === old?.currentTask?.runId && active?.task.taskId === old?.currentTask?.taskId && active?.handle?.closed === true;
          if (old?.currentTask && !knownClosed && options.confirmedOrphanClosed !== true) {
            blockedTask = clone2(old.currentTask);
            starting = false;
            change("interrupted", "orphan-page-close-required");
            return result("orphan-page-close-required");
          }
          prepare(context, { minSales: minimum.value });
          return await acquire();
        } catch (error) {
          starting = false;
          change("interrupted", error.message);
          return result(error.message);
        }
      },
      async pauseRun() {
        if (!live()) return result("not-running");
        change("paused", "manual-pause");
        if (!listDone) {
          run.listComplete = false;
          run.listReason = "manual-pause";
        }
        try {
          await persist();
          return { ok: true };
        } catch (error) {
          storageFailed(error);
          return result("storage-failed");
        }
      },
      async resumeRun(options = {}) {
        if (starting) return result("already-running");
        if (run.day && !currentDay()) return result("day-changed");
        if (!held) {
          if (run.status !== "recoverable" || !recovery) return result("no-recovery");
          return acquire();
        }
        if (ending) return result("ended");
        if (fatal) return result("storage-failed-restart-required");
        if (active && (active.failed || active.orphan)) {
          if (!pageClosed(options, active)) return result(active.orphan ? "orphan-page-close-required" : "page-close-required");
          const item = items.find((item2) => item2.identity.goodsId === active.task.goodsId);
          if (!active.accepted && item?.attempts >= 2) return result("retry-exhausted");
          active.invalid = true;
          active.action = active.accepted ? "completed" : "retry";
        }
        if (run.reason === "navigation-unavailable") listDone = false;
        change("running");
        await persist();
        return { ok: true };
      },
      async skipCurrent(options = {}) {
        if (!live() || !active) return result("no-current-task");
        if (!currentDay()) return result("day-changed");
        if (!pageClosed(options, active)) return result(active.orphan ? "orphan-page-close-required" : "page-close-required");
        active.invalid = true;
        active.action = active.accepted ? "completed" : "skipped";
        change("running");
        await persist();
        return { ok: true };
      },
      async endRun() {
        if (!held) {
          if (lifetime) await lifetime;
          return { ok: true };
        }
        ending = true;
        run.status = "interrupted";
        run.reason = "ended-by-user";
        if (active) {
          active.invalid = true;
          await detach(active);
        }
        wake();
        await writeChain;
        if (lifetime) await lifetime;
        emit();
        return { ok: true };
      }
    };
  }
  var PREFIX2, LOCK, MARKER, RUNTIME_DEFAULTS, clone2, validId, validMarker, contextFields, sameContext, pickContext, deferred;
  var init_runtime = __esm({
    "src/runtime.mjs"() {
      init_core();
      PREFIX2 = "qiliang-radar:v1:";
      LOCK = `${PREFIX2}writer`;
      MARKER = "#qiliang-radar=";
      RUNTIME_DEFAULTS = Object.freeze({ timeoutMs: 3e4, closeTimeoutMs: 3e4, taskIntervalMs: 3e3, pollMs: 250, listWaitMs: 3e4, maxListRounds: 100, maxScrollRounds: 3 });
      clone2 = (value) => structuredClone(value);
      validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
      validMarker = (value) => value && validId(value.runId) && validId(value.taskId);
      contextFields = ["market", "language", "shopId", "shopName"];
      sameContext = (a, b) => ["market", "language", "shopId"].every((key) => a?.[key] === b?.[key]);
      pickContext = (value) => Object.fromEntries(contextFields.map((key) => [key, String(value?.[key] ?? "")]));
      deferred = () => {
        let resolve;
        const promise = new Promise((r) => {
          resolve = r;
        });
        return { promise, resolve };
      };
    }
  });

  // src/trends.mjs
  function trendMetrics(history, day) {
    const records = history.filter((s) => s.day <= day && s.list);
    const byDay = new Map(records.map((s) => [s.day, s]));
    const firstSeen = records.map((s) => s.day).sort()[0] ?? null;
    const delta = (d) => {
      const c = compareSnapshots(byDay.get(previousDayKey(d)), byDay.get(d));
      return c.ok && Number.isFinite(c.delta) && c.delta >= 0 ? c.delta : null;
    };
    const days = [day];
    for (let i = 0; i < 3; i++) days.push(previousDayKey(days.at(-1)));
    const values = days.map(delta);
    const avg = (a) => a.every((v) => v !== null) ? a.reduce((a2, b) => a2 + b, 0) / a.length : null;
    const average = avg(values.slice(0, 3)), prior = avg(values.slice(1, 4));
    const acceleration = values[0] !== null && prior !== null ? values[0] - prior : null;
    let streak = 0, cursor = day;
    while (byDay.has(cursor)) {
      const v = delta(cursor);
      if (v === null || v <= 0) break;
      streak++;
      cursor = previousDayKey(cursor);
    }
    const streakIncomplete = delta(cursor) === null;
    if (streak === 0 && streakIncomplete) streak = null;
    const age = firstSeen ? (Date.parse(day) - Date.parse(firstSeen)) / 864e5 : null;
    return { average, acceleration, streak, streakIncomplete, firstSeen, rising: age !== null && age < 7 && streak >= 2 && acceleration > 0 };
  }
  var init_trends = __esm({
    "src/trends.mjs"() {
      init_core();
    }
  });

  // src/panel.mjs
  var panel_exports = {};
  __export(panel_exports, {
    buildResultRows: () => buildResultRows,
    collectResultRows: () => collectResultRows,
    createLatestRefresh: () => createLatestRefresh,
    filterResultRows: () => filterResultRows,
    formatProgress: () => formatProgress,
    humanReason: () => humanReason,
    mountPanel: () => mountPanel,
    renderResultsTable: () => renderResultsTable,
    rowsToCsv: () => rowsToCsv
  });
  function buildResultRows(currentSnapshots, previousByGoodsId = /* @__PURE__ */ new Map(), historyGoodsIds = /* @__PURE__ */ new Set(), { belowThresholdGoodsIds = /* @__PURE__ */ new Set() } = {}) {
    return currentSnapshots.map((current) => {
      const previous = previousByGoodsId.get(current.goodsId) ?? null;
      const comparison2 = compareSnapshots(previous, current, historyGoodsIds.has(current.goodsId));
      const source = comparison2.ok ? comparison2.source : "none";
      let previousDisplay = "", currentDisplay = "";
      if (source === "sku") {
        previousDisplay = text2(comparison2.previousValue);
        currentDisplay = text2(comparison2.currentValue);
      } else if (source === "list") {
        previousDisplay = comparison2.previousValue == null ? previous?.list?.rawText ?? "" : text2(comparison2.previousValue);
        currentDisplay = comparison2.currentValue == null ? current.list?.rawText ?? "" : text2(comparison2.currentValue);
      } else if (!previous) {
        currentDisplay = current.list?.rawText ?? (current.detail ? text2(current.detail.skuTotal) : "");
      }
      const baseStatus = current.missingToday ? belowThresholdGoodsIds.has(current.goodsId) ? "本次未达门槛" : "今日未采到" : comparison2.ok ? comparison2.status : comparison2.reason;
      const failureReason = current.lastAttempt?.status === "failed" ? current.lastAttempt.reasonCode : null;
      const status = failureReason ? `${baseStatus}；${failureReason}` : baseStatus;
      return {
        ...current,
        comparison: comparison2,
        previousDisplay,
        currentDisplay,
        deltaDisplay: comparison2.ok && comparison2.delta != null ? `${comparison2.label?.includes("约") ? "约 " : ""}${comparison2.delta > 0 ? "+" : ""}${comparison2.delta}` : "",
        sourceDisplay: comparison2.ok ? comparison2.label : "",
        status
      };
    }).sort((a, b) => {
      const aDelta = a.comparison.ok ? a.comparison.delta : null;
      const bDelta = b.comparison.ok ? b.comparison.delta : null;
      if (aDelta == null && bDelta == null) return 0;
      if (aDelta == null) return 1;
      if (bDelta == null) return -1;
      return bDelta - aDelta;
    });
  }
  async function collectResultRows(storage, context, day, options = {}) {
    const current = await storage.listSnapshots(context, day);
    const yesterday = previousDayKey(day);
    const all = await storage.listSnapshots(context);
    const previous = /* @__PURE__ */ new Map();
    const history = /* @__PURE__ */ new Set();
    const latestByGoods = /* @__PURE__ */ new Map();
    for (const item of all) {
      if (item.day === yesterday) previous.set(item.goodsId, item);
      if (item.day < day) history.add(item.goodsId);
      if (item.day < day && (!latestByGoods.has(item.goodsId) || latestByGoods.get(item.goodsId).day < item.day)) latestByGoods.set(item.goodsId, item);
    }
    const currentIds = new Set(current.map((item) => item.goodsId));
    for (const goodsId of history) if (!currentIds.has(goodsId)) current.push({ ...latestByGoods.get(goodsId), day, list: null, detail: null, lastAttempt: null, missingToday: true });
    const grouped = /* @__PURE__ */ new Map();
    for (const item of all) {
      if (!grouped.has(item.goodsId)) grouped.set(item.goodsId, []);
      grouped.get(item.goodsId).push(item);
    }
    return buildResultRows(current, previous, history, options).map((row) => ({ ...row, trends: trendMetrics(grouped.get(row.goodsId) ?? [], day) }));
  }
  function filterResultRows(rows, filter) {
    return rows.filter((row) => filter === "全部" || (filter === "新星" ? row.trends?.rising === true : filter === "新收录" ? row.status === "新收录" : /复核|异常|变化|失败|缺|未采到|未达门槛/.test(row.status)));
  }
  function formatProgress(state = {}) {
    const saved = new Set(state.savedListGoodsIds ?? []), below = new Set(state.belowThresholdGoodsIds ?? []);
    const failed = /* @__PURE__ */ new Set(), missing = /* @__PURE__ */ new Set();
    let systemErrors = 0;
    for (const e of state.errors ?? []) {
      if (!e.goodsId) {
        systemErrors++;
        continue;
      }
      if (saved.has(e.goodsId) || below.has(e.goodsId)) continue;
      (e.reasonCode === "未展示销量" ? missing : failed).add(e.goodsId);
    }
    for (const id of failed) missing.delete(id);
    const status = state.status === "completed" && state.listComplete === false ? "本次结束（未采全）" : statusNames[state.status] ?? "未开始";
    const total = state.reportedTotal == null ? "未知" : state.reportedTotal;
    const reason = state.reason ? `；${humanReason(state.reason)}` : "";
    return `${status}｜已扫描 ${new Set(state.discoveredGoodsIds ?? []).size} / ${total}｜保存成功 ${saved.size}｜低于门槛跳过 ${below.size}｜未展示销量 ${missing.size}｜失败商品 ${failed.size}${systemErrors ? `｜运行异常 ${systemErrors}` : ""}${reason}`;
  }
  function createLatestRefresh(load, apply, onError = () => {
  }) {
    let generation = 0;
    return async function refresh() {
      const current = ++generation;
      try {
        const value = await load();
        if (current === generation) apply(value);
        return value;
      } catch (error) {
        if (current === generation) onError(error);
        return null;
      }
    };
  }
  function appendCell(row, node) {
    const cell = row.ownerDocument.createElement("td");
    cell.append(node);
    row.append(cell);
  }
  function renderResultsTable(container, rows, document2 = container.ownerDocument) {
    container.replaceChildren();
    const table = element(document2, "table");
    const head = element(document2, "thead");
    const headerRow = element(document2, "tr");
    for (const title of ["商品", "昨日参考", "今日参考", "参考增量", "近3日均增量", "连续增长天数", "增速变化", "首次发现", "状态"]) headerRow.append(element(document2, "th", title));
    head.append(headerRow);
    table.append(head);
    const body = element(document2, "tbody");
    for (const item of rows) {
      const row = element(document2, "tr");
      const link = element(document2, "a", item.title || item.goodsId);
      if (typeof item.productUrl === "string" && item.productUrl.startsWith("https://www.temu.com/")) {
        link.href = item.productUrl;
        link.target = "_blank";
        link.rel = "noopener";
      }
      appendCell(row, link);
      appendCell(row, element(document2, "span", item.previousDisplay));
      appendCell(row, element(document2, "span", item.currentDisplay));
      appendCell(row, element(document2, "span", item.deltaDisplay));
      for (const value of trendDisplays(item.trends)) appendCell(row, element(document2, "span", value));
      const details = element(document2, "details");
      details.append(element(document2, "summary", item.status));
      const source = item.comparison.source === "sku" ? "SKU 汇总参考" : item.comparison.source === "list" ? "列表参考" : "无可比来源";
      const detailText = [
        `来源：${item.sourceDisplay || source}`,
        item.list?.rawText ? `列表原文：${item.list.rawText}` : "",
        item.list?.capturedAt ? `列表采集：${item.list.capturedAt}` : "",
        item.detail?.capturedAt ? `详情采集：${item.detail.capturedAt}` : "",
        item.detail?.skuIds ? `SKU 数：${item.detail.skuIds.length}` : "",
        item.lastAttempt?.reasonCode ? `异常：${item.lastAttempt.reasonCode}` : ""
      ].filter(Boolean).join("；");
      details.append(element(document2, "div", detailText));
      appendCell(row, details);
      body.append(row);
    }
    table.append(body);
    container.append(table);
    return table;
  }
  function trendDisplays(t = {}) {
    return [metricText(t.average), t.streak == null ? "数据不足" : `${t.streakIncomplete ? "至少 " : ""}${t.streak}`, metricText(t.acceleration), t.firstSeen ?? "数据不足"];
  }
  function rowsToCsv(rows, day, context) {
    return toCsv(rows.map((row) => ({
      日期: day,
      站点: context.market,
      页面语言: context.language,
      店铺ID: context.shopId,
      店铺名称: row.shopName,
      商品ID: `‌${row.goodsId}`,
      商品名称: row.title,
      商品链接: row.productUrl,
      昨日原文: row.comparison.source === "list" ? row.previousDisplay || "" : "",
      今日原文: row.list?.rawText ?? "",
      昨日比较值: row.comparison.previousValue,
      今日比较值: row.comparison.currentValue,
      来源: row.sourceDisplay || row.comparison.source,
      参考增量: row.comparison.delta,
      近3日均增量: trendDisplays(row.trends)[0],
      连续增长天数: trendDisplays(row.trends)[1],
      增速变化: trendDisplays(row.trends)[2],
      首次发现: trendDisplays(row.trends)[3],
      新星: row.trends?.rising ? "是" : "",
      状态: row.status,
      昨日采集时间: row.comparison.previousCapturedAt,
      今日采集时间: row.comparison.currentCapturedAt
    })));
  }
  function mountPanel({ document: document2, context, storage, runtime, initialDay, contextStillMatches = () => true }) {
    const host = element(document2, "div");
    host.id = "qiliang-radar-host";
    document2.documentElement.append(host);
    const root = host.attachShadow({ mode: "open" });
    const style = element(document2, "style");
    style.textContent = ":host{all:initial} .panel{position:fixed;z-index:2147483647;right:16px;top:72px;width:min(1120px,calc(100vw - 32px));max-height:78vh;overflow:auto;background:#fff;color:#17212b;border:1px solid #ccd4dc;border-radius:10px;padding:12px;font:14px/1.45 system-ui;box-shadow:0 8px 30px #0002} header{display:flex;justify-content:space-between} .controls{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0} button,input,select{font:inherit} table{min-width:1000px;width:100%;border-collapse:collapse} th,td{border-top:1px solid #e5e7eb;padding:6px;text-align:left;vertical-align:top} th{white-space:nowrap} td:first-child{min-width:240px;max-width:320px;overflow-wrap:anywhere} .progress-summary{position:sticky;top:0;z-index:2;background:#eef6ff;border:1px solid #abc9ec;border-radius:6px;padding:12px;margin:10px 0;font-weight:600;line-height:1.8;white-space:normal} .status{color:#4b5563}";
    root.append(style);
    const panel = element(document2, "section", null, "panel");
    const header = element(document2, "header");
    const titleWrap = element(document2, "div");
    titleWrap.append(element(document2, "strong", "起量雷达"), element(document2, "div", "Temu竞品销量追踪助手"));
    const fold = element(document2, "button", "折叠");
    header.append(titleWrap, fold);
    panel.append(header);
    const content = element(document2, "div");
    content.append(element(document2, "div", `${context.shopName || context.shopId} · ${context.market} · ${context.language} · ${initialDay}`));
    const controls = element(document2, "div", null, "controls");
    const threshold = element(document2, "input");
    threshold.type = "number";
    threshold.min = "0";
    threshold.value = "20";
    threshold.title = "最低累计销量";
    const day = element(document2, "input");
    day.type = "date";
    day.value = initialDay;
    const filter = element(document2, "select");
    for (const value of ["全部", "新星", "新收录", "需复核"]) {
      const option = element(document2, "option", value);
      option.value = value;
      filter.append(option);
    }
    const buttons = {};
    for (const name of ["开始", "暂停", "继续", "结束本次", "跳过当前", "已关闭旧详情页，继续", "导出 CSV"]) {
      buttons[name] = element(document2, "button", name);
      controls.append(buttons[name]);
    }
    buttons["已关闭旧详情页，继续"].hidden = true;
    controls.prepend(element(document2, "label", "最低累计销量"), threshold, day, filter);
    content.append(controls);
    content.append(element(document2, "div", "近3日均增量含今日；增速变化＝今日增量－此前3日均增量。缺采不补零；首次发现不等于上架日期。新星：首次发现7天内、连续增长至少2天、增速变化为正。", "status"));
    const progress = element(document2, "div", "尚未开始：点击开始后显示本次采集统计", "progress-summary");
    const table = element(document2, "div");
    content.append(progress, table);
    panel.append(content);
    root.append(panel);
    let rows = [], runtimeState = { belowThresholdGoodsIds: [] }, orphanMode = null;
    const showError = (error) => {
      progress.textContent = error?.message ?? String(error);
    };
    const refresh = createLatestRefresh(
      () => collectResultRows(storage, context, day.value, { belowThresholdGoodsIds: new Set(runtimeState.day === day.value ? runtimeState.belowThresholdGoodsIds ?? [] : []) }),
      (value) => {
        rows = value;
        renderResultsTable(table, filterResultRows(rows, filter.value), document2);
      },
      showError
    );
    const guard = () => {
      if (!contextStillMatches()) throw new Error("当前店铺已变化，请刷新后重新开始");
    };
    const action = (fn) => async () => {
      try {
        guard();
        const result = await fn();
        if (result?.ok === false) throw new Error(humanReason(result.reason));
        await refresh();
      } catch (error) {
        showError(error);
      }
    };
    storage.getSettings().then((settings) => {
      threshold.value = String(settings.minSales);
    }).catch(showError);
    const minimum = () => {
      const result = normalizeMinSales(threshold.value);
      if (!result.ok) throw new Error(result.reason);
      return result.value;
    };
    threshold.addEventListener("change", async () => {
      try {
        await storage.saveSettings({ minSales: minimum() });
      } catch (error) {
        showError(error);
      }
    });
    const startAttempt = async (options) => {
      try {
        guard();
        const result = await runtime.startRun(context, { minSales: minimum(), dayTimezone: "Asia/Shanghai" }, options);
        if (result?.ok === false) {
          if (result.reason === "orphan-page-close-required") {
            orphanMode = "start";
            buttons["已关闭旧详情页，继续"].hidden = false;
            buttons["继续"].hidden = true;
          }
          throw new Error(humanReason(result.reason));
        }
        orphanMode = null;
        await refresh();
      } catch (error) {
        showError(error);
      }
    };
    buttons["开始"].addEventListener("click", () => startAttempt());
    buttons["暂停"].addEventListener("click", action(() => runtime.pauseRun()));
    buttons["继续"].addEventListener("click", action(() => runtime.resumeRun()));
    buttons["结束本次"].addEventListener("click", action(() => runtime.endRun()));
    buttons["跳过当前"].addEventListener("click", action(() => runtime.skipCurrent()));
    buttons["已关闭旧详情页，继续"].addEventListener("click", () => orphanMode === "start" ? startAttempt({ confirmedOrphanClosed: true }) : action(() => runtime.resumeRun({ confirmedOrphanClosed: true }))());
    buttons["导出 CSV"].addEventListener("click", () => {
      try {
        const blob = new Blob([rowsToCsv(filterResultRows(rows, filter.value), day.value, context)], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = element(document2, "a");
        anchor.href = url;
        const shopFileName = String(context.shopName || context.shopId || "未知店铺").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").trim().replace(/[. ]+$/g, "").slice(0, 100) || context.shopId || "未知店铺";
        anchor.download = `起量雷达-${shopFileName}-${day.value}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        showError(error);
      }
    });
    day.addEventListener("change", refresh);
    filter.addEventListener("change", refresh);
    fold.addEventListener("click", () => {
      content.hidden = !content.hidden;
      fold.textContent = content.hidden ? "展开" : "折叠";
    });
    refresh();
    return { host, refresh, updateState(state) {
      runtimeState = state ?? {};
      const orphan = state?.reason === "orphan-page-close-required";
      if (orphan && orphanMode == null) orphanMode = "resume";
      if (!orphan) orphanMode = null;
      buttons["已关闭旧详情页，继续"].hidden = !orphan;
      buttons["继续"].hidden = orphan;
      progress.textContent = formatProgress(state);
      void refresh();
    } };
  }
  var text2, element, statusNames, reasonNames, humanReason, metricText;
  var init_panel = __esm({
    "src/panel.mjs"() {
      init_trends();
      init_core();
      text2 = (value) => value == null ? "" : String(value);
      element = (document2, tag, value, className) => {
        const node = document2.createElement(tag);
        if (value != null) node.textContent = text2(value);
        if (className) node.className = className;
        return node;
      };
      statusNames = { idle: "未开始", running: "采集中", paused: "已暂停", completed: "已完成", interrupted: "已结束", recoverable: "可继续" };
      reasonNames = { "orphan-page-close-required": "请先关闭旧详情页", "day-changed": "日期已变化，请重新采集", "manual-pause": "手动暂停", "resume-required": "发现未完成批次，请确认后继续", "detail-timeout": "详情读取超时", "storage-failed": "本地存储失败", "page-close-required": "请先关闭当前详情页" };
      humanReason = (reason) => reasonNames[reason] ?? (reason ? `异常：${reason}` : "");
      metricText = (v) => v == null ? "数据不足" : `约 ${Number(v.toFixed(1))}`;
    }
  });

  // src/entry.mjs
  init_core();
  var PREFIX3 = "qiliang-radar:v1:";
  var localTaskKeys = (runId, taskId) => ({ task: `${PREFIX3}task:${runId}:${taskId}`, result: `${PREFIX3}result:${runId}:${taskId}`, ack: `${PREFIX3}ack:${runId}:${taskId}` });
  function localParseTaskMarker(urlString) {
    try {
      const hash = new URL(urlString).hash.slice(1);
      const params = new URLSearchParams(hash);
      const combined = params.get("qiliang-radar-task");
      if (combined) {
        const split = combined.indexOf(":");
        if (split > 0) return { runId: combined.slice(0, split), taskId: combined.slice(split + 1) };
      }
      const runId = params.get("qiliang-radar-run"), taskId = params.get("qiliang-radar-task-id");
      return runId && taskId ? { runId, taskId } : null;
    } catch {
      return null;
    }
  }
  var sameTask = (task, marker) => task?.schemaVersion === 1 && task?.status === "pending" && task.runId === marker.runId && task.taskId === marker.taskId && ["goodsId", "market", "language", "shopId", "day"].every((key) => typeof task[key] === "string" && task[key]);
  var delay = (setTimer, milliseconds) => new Promise((resolve) => setTimer(resolve, milliseconds));
  async function runDetailWorker(deps) {
    const {
      document: document2,
      location,
      gm,
      readDetail: readDetail2,
      pageProblem: pageProblem2 = () => null,
      now = () => /* @__PURE__ */ new Date(),
      createId = () => crypto.randomUUID(),
      close = () => globalThis.close(),
      setTimeout: setTimer = globalThis.setTimeout,
      clearTimeout: clearTimer = globalThis.clearTimeout,
      scroll = () => globalThis.scrollBy?.(0, Math.max(600, globalThis.innerHeight ?? 600)),
      parseTaskMarker: parseTaskMarker2 = localParseTaskMarker,
      taskKeys: taskKeys2 = localTaskKeys
    } = deps;
    const marker = parseTaskMarker2(location.href);
    if (!marker) return { ok: false, controlled: false, reason: "无任务标记" };
    const keys = taskKeys2(marker.runId, marker.taskId);
    const task = await gm.getValue(keys.task, null);
    if (!sameTask(task, marker)) return { ok: false, controlled: false, reason: "任务无效或已失效" };
    if (dayKey(now(), "Asia/Shanghai") !== task.day) return { ok: false, controlled: true, reason: "任务日期不匹配" };
    if (document2.readyState === "loading") await new Promise((resolve) => document2.addEventListener("DOMContentLoaded", resolve, { once: true }));
    const workerInstanceId = createId();
    let closed = false, listenerId = null;
    const cleanup = () => {
      if (listenerId != null) {
        gm.removeValueChangeListener(listenerId);
        listenerId = null;
      }
    };
    const stillOriginal = async () => {
      const currentMarker = parseTaskMarker2(location.href);
      if (!currentMarker || currentMarker.runId !== task.runId || currentMarker.taskId !== task.taskId) return false;
      const currentTask = await gm.getValue(keys.task, null);
      return currentTask?.runId === task.runId && currentTask?.taskId === task.taskId && currentTask?.goodsId === task.goodsId && currentTask?.day === task.day && dayKey(now(), "Asia/Shanghai") === task.day;
    };
    const acceptAck = async () => {
      if (closed) return;
      const ack = await gm.getValue(keys.ack, null);
      if (!ack?.saved || ack.runId !== task.runId || ack.taskId !== task.taskId || ack.workerInstanceId !== workerInstanceId || ack.goodsId !== task.goodsId || ack.day !== task.day) return;
      if (!await stillOriginal()) return;
      const reread = readDetail2(document2, task, location.href);
      if (!reread?.ok || reread.goodsId !== task.goodsId) return;
      closed = true;
      cleanup();
      try {
        close();
      } catch {
      }
    };
    listenerId = gm.addValueChangeListener(keys.ack, () => acceptAck());
    await acceptAck();
    if (closed) return { ok: true, controlled: true, workerInstanceId, cleanup };
    const explicitProblem = pageProblem2(document2);
    let reading = explicitProblem ? { ok: false, reason: explicitProblem } : readDetail2(document2, task, location.href);
    const maxRounds = Math.max(0, Math.min(3, task.config?.maxScrollRounds ?? 3));
    const timeoutMs = Math.max(0, Math.min(3e4, task.config?.timeoutMs ?? 3e4));
    const started = now().getTime();
    for (let round = 0; reading?.pending && round < maxRounds && now().getTime() - started < timeoutMs; round++) {
      scroll();
      await delay(setTimer, Math.min(500, timeoutMs));
      if (!await stillOriginal()) {
        cleanup();
        return { ok: false, controlled: true, reason: "页面已导航或任务失效" };
      }
      const problem = pageProblem2(document2);
      reading = problem ? { ok: false, reason: problem } : readDetail2(document2, task, location.href);
    }
    if (!await stillOriginal()) {
      cleanup();
      return { ok: false, controlled: true, reason: "页面已导航、任务失效或已经跨日" };
    }
    if (reading?.ok && (reading.goodsId !== task.goodsId || dayKey(reading.detail?.capturedAt, "Asia/Shanghai") !== task.day)) reading = { ok: false, reason: "详情身份或日期不匹配" };
    const result = { runId: task.runId, taskId: task.taskId, workerInstanceId, goodsId: task.goodsId, market: task.market, language: task.language, shopId: task.shopId, day: task.day, ok: Boolean(reading?.ok) };
    if (reading?.ok) result.detail = reading.detail;
    else result.reason = reading?.pending ? "详情未取到" : reading?.reason ?? "详情未取到";
    await gm.setValue(keys.result, result);
    return { ok: true, controlled: true, workerInstanceId, result, cleanup };
  }
  var waitForDom = (document2) => document2.readyState === "loading" ? new Promise((resolve) => document2.addEventListener("DOMContentLoaded", resolve, { once: true })) : Promise.resolve();
  async function bootBrowser(globalObject = globalThis, gm = {
    getValue: typeof GM_getValue === "function" ? GM_getValue : globalObject.GM_getValue,
    setValue: typeof GM_setValue === "function" ? GM_setValue : globalObject.GM_setValue,
    listValues: typeof GM_listValues === "function" ? GM_listValues : globalObject.GM_listValues
  }) {
    const document2 = globalObject.document, location = globalObject.location;
    if (!document2 || !location) return { ok: false, reason: "非浏览器环境" };
    const [{ readDetail: readDetail2, pageProblem: pageProblem2, readShopCards: readShopCards2, readShopContext: readShopContext2 }, { createStorage: createStorage2 }, { createRuntime: createRuntime2, parseTaskMarker: parseTaskMarker2, taskKeys: taskKeys2 }, { mountPanel: mountPanel2 }] = await Promise.all([
      Promise.resolve().then(() => (init_adapters(), adapters_exports)),
      Promise.resolve().then(() => (init_storage(), storage_exports)),
      Promise.resolve().then(() => (init_runtime(), runtime_exports)),
      Promise.resolve().then(() => (init_panel(), panel_exports))
    ]);
    if (![gm.getValue, gm.setValue, gm.listValues].every((fn) => typeof fn === "function")) return { ok: false, reason: "Tampermonkey 接口不完整" };
    await waitForDom(document2);
    const context = readShopContext2(document2, location.href);
    if (!context.ok) return context;
    let runtime, panel;
    const storage = createStorage2(gm, { canWrite: () => runtime?.canWrite?.() ?? false });
    runtime = createRuntime2({ storage, gm, locks: globalObject.navigator?.locks, readCards: () => readShopCards2(document2, context, location.href), clickMore: (button) => button?.click(), scrollList: () => context.root?.scrollIntoView({ block: "end" }), onState: (state) => panel?.updateState(state) });
    panel = mountPanel2({ document: document2, context, storage, runtime, initialDay: dayKey(/* @__PURE__ */ new Date(), "Asia/Shanghai"), contextStillMatches: () => {
      const current = readShopContext2(document2, location.href);
      return current.ok && ["market", "language", "shopId"].every((key) => current[key] === context[key]);
    } });
    return { ok: true, context, storage, runtime, panel };
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") void bootBrowser(window);
})();
