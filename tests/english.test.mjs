import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {parseSales} from '../src/core.mjs';
import {readShopContext,readShopCards,pageProblem} from '../src/adapters.mjs';
test('English integer, abbreviated and lower-bound sales retain precision',()=>{
 for(const [raw,value,precision] of [['24 sold',24,'number'],['1,234 sold',1234,'number'],['1.2K sold',1200,'rounded'],['10K+ sold',10000,'lower_bound'],['100+ sold',100,'lower_bound']]){const r=parseSales(raw);assert.equal(r.ok,true,raw);assert.equal(r.value,value);assert.equal(r.precision,precision);assert.equal(r.rawText,raw);}
 for(const raw of ['1,23 sold','1.5 sold','24 sold last month','24 reviews','sold out'])assert.equal(parseSales(raw).ok,false,raw);
});
// Synthetic English markup, not a captured live shop.
const html='<h1>Example</h1><div role="button" aria-label="United States English"></div><div id="mall-top-head-category-container"></div><section class="mainContent"><div>1,234 items</div><div class="js-goods-list"><article data-tooltip="goodContainer-123"><a href="/item-g-123.html">Item</a><span data-type="saleTips">1.2K sold1.2K sold</span></article></div><div role="button" aria-label="See more items">See more</div></section><section><div role="button" aria-label="See more items">Recommendations</div></section>';
test('English shop context, repeated sales and scoped load more',()=>{const {document}=parseHTML(html);const c=readShopContext(document,'https://www.temu.com/mall.html?mall_id=1');assert.equal(c.ok,true);assert.equal(c.language,'en');assert.equal(c.reportedTotal,1234);const r=readShopCards(document,c,'https://www.temu.com/mall.html?mall_id=1');assert.equal(r.cards[0].list.value,1200);assert.equal(r.hasMore,true);assert.equal(r.moreButton.textContent,'See more');});
test('English does not imply US',()=>{const {document}=parseHTML(html.replace('United States','United Kingdom'));assert.equal(readShopContext(document,'https://www.temu.com/mall.html?mall_id=1').ok,false);});
test('English verification stops collection',()=>{const {document}=parseHTML('<div role="dialog">Please verify you are human</div>');assert.equal(pageProblem(document),'页面需要验证');});
