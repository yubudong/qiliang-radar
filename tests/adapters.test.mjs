import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { extractRawData, getShopRoot, pageProblem, readDetail, readShopCards, readShopContext, sanitizeProductUrl } from '../src/adapters.mjs';

const fixture = async (name) => parseHTML(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).document;

test('shop context anchors the verified main list and excludes recommendation containers', async () => {
  const document = await fixture('shop-cards.html');
  const url = 'https://www.temu.com/mall.html?mall_id=634418226107291';
  const context = readShopContext(document, url);
  assert.equal(context.ok, true);
  assert.deepEqual({ market: context.market, language: context.language, shopId: context.shopId, shopName: context.shopName, reportedTotal: context.reportedTotal }, { market:'US', language:'zh-Hans', shopId:'634418226107291', shopName:'Refined Boy Closet', reportedTotal:1167 });
  assert.equal(context.root, getShopRoot(document));
  const result = readShopCards(document, context, url);
  assert.equal(result.ok, true);
  assert.deepEqual(result.seenGoodsIds, ['601103607015450','601103599055065','601103731960555','601103884098224','malformed','extra']);
  assert.deepEqual(result.cards.map((card) => [card.goodsId, card.list.value]), [['601103607015450',20],['601103599055065',5553]]);
  assert.equal(result.errors[0].reason, '销量标签冲突');
  assert.deepEqual(result.errors[1], {goodsId:'601103884098224',reason:'销量标签含未知内容'});
  assert.deepEqual(result.errors.slice(2), [
    {goodsId:'malformed',reason:'销量标签含未知内容'},
    {goodsId:'extra',reason:'销量标签含未知内容'}
  ]);
  assert.equal(result.hasMore, true);
  assert.equal(result.moreButton.textContent, '更多');
  assert.equal(result.cards[0].productUrl, 'https://www.temu.com/edge-g-601103607015450.html');
  assert.match(result.cards[0].navigationUrl, /test_tracking=synthetic/);
});

test('locale requires one unambiguous US Simplified Chinese control regardless of button order', async () => {
  const document = await fixture('shop-cards.html');
  assert.equal(readShopContext(document,'https://www.temu.com/mall.html?mall_id=1').language,'zh-Hans');
  document.querySelector('[aria-label="美国 简体中文"]').remove();
  assert.equal(readShopContext(document,'https://www.temu.com/mall.html?mall_id=1').ok,false);
  document.body.insertAdjacentHTML('afterbegin','<button role="button" aria-label="美国 简体中文"></button><button role="button" aria-label="美国 English"></button>');
  assert.equal(readShopContext(document,'https://www.temu.com/mall.html?mall_id=1').ok,false);
});

test('unsupported shop structure stays visibly unsupported', () => {
  const { document } = parseHTML('<h1>店铺</h1><div class="js-goods-list"></div>');
  assert.deepEqual(readShopContext(document, 'https://www.temu.com/mall.html?mall_id=1'), { ok:false, reason:'不支持的店铺页面结构' });
});

test('rawData extraction handles braces in strings and rejects malformed or conflicting objects', async () => {
  const document = await fixture('detail-script.html');
  assert.equal(extractRawData(document).store.goods.note, 'brace } and escaped quote " stay text');
  const malformed = parseHTML('<script>window.rawData={"store":{"x":"}"}</script>').document;
  assert.throws(() => extractRawData(malformed), /rawData JSON 损坏/);
  const conflict = parseHTML('<script>window.rawData={"a":1};window.rawData={"a":2};</script>').document;
  assert.throws(() => extractRawData(conflict), /多份 rawData 冲突/);
  const decoys = parseHTML(`<script>
    const sample = 'window.rawData={"fake":1}';
    // window.rawData={"fake":2};
    /* rawData={"fake":3}; */
    window.rawData={"real":4};
  </script>`).document;
  assert.deepEqual(extractRawData(decoys), {real:4});
});

test('detail validates product, shop and complete SKU mappings through core validator', async () => {
  const document = await fixture('detail-script.html');
  const shopDocument = await fixture('shop-cards.html');
  const context = readShopContext(shopDocument,'https://www.temu.com/mall.html?mall_id=634418226107291');
  const expected = { goodsId:'601103599055065', shopId:context.shopId, market:context.market, language:context.language };
  const result = readDetail(document, expected, 'https://www.temu.com/popular-g-601103599055065.html');
  assert.equal(result.ok, true);
  assert.deepEqual(result.detail.skuCounts, {'17610631092697':583,'17610631092698':1098});
  assert.equal(result.detail.skuTotal, 1681);
  assert.equal(result.detail.goodsDisplayValue, 5500);
  assert.equal(readDetail(document, {...expected, goodsId:'9'}, 'https://www.temu.com/goods.html?goods_id=9').reason, '详情商品与任务不一致');
  assert.equal(readDetail(document, {...expected, shopId:'9'}, 'https://www.temu.com/popular-g-601103599055065.html').reason, '详情店铺与任务不一致');
  document.querySelector('script').textContent = document.querySelector('script').textContent.replace('"17610631092698":{"sold_quantity":1098}', '"17610631092698":{"sold_quantity":1099}');
  assert.equal(readDetail(document, expected, 'https://www.temu.com/popular-g-601103599055065.html').reason, '详情数据冲突');
});

test('product URL sanitizer only retains verified Temu product paths or goods_id', () => {
  assert.equal(sanitizeProductUrl('https://www.temu.com/a-g-123.html?x=1', '123'), 'https://www.temu.com/a-g-123.html');
  assert.equal(sanitizeProductUrl('https://www.temu.com/goods.html?goods_id=123&refer_page=feed', '123'), 'https://www.temu.com/goods.html?goods_id=123');
  assert.equal(sanitizeProductUrl('https://evil.test/a-g-123.html', '123'), null);
  assert.equal(sanitizeProductUrl('https://www.temu.com/a-g-124.html', '123'), null);
});

test('page problem only reports explicit blocking UI', () => {
  assert.equal(pageProblem(parseHTML('<main>登录可享优惠，商品正常展示</main>').document), null);
  assert.equal(pageProblem(parseHTML('<div role="dialog"><h2>请完成验证</h2></div>').document), '页面需要验证');
});
