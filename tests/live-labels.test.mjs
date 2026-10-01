import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {readShopContext,readShopCards} from '../src/adapters.mjs';
const samples=JSON.parse(await readFile(new URL('./fixtures/live-language-labels.json',import.meta.url)));
// Sales strings are captured from public DOM on 2026-10-01; surrounding markup is synthetic.
for(const [key,sample] of Object.entries(samples))test(`captured ${key} sales labels replay without parse errors`,()=>{
 const cards=sample.sales.map((sales,i)=>`<article data-tooltip="goodContainer-${i}"><a href="/a-g-${i}.html">Item</a><span data-type="saleTips">${sales}</span></article>`).join('');
 const {document}=parseHTML(`<h1>Example</h1><button aria-label="${sample.locale}"></button><div id="mall-top-head-category-container"></div><section class="mainContent"><div>${sample.toolbar}</div><div class="js-goods-list">${cards}</div><button aria-label="${sample.more}">More</button></section>`);
 const ctx=readShopContext(document,'https://www.temu.com/mall.html?mall_id=1');assert.equal(ctx.ok,true);
 assert.equal(ctx.reportedTotal,key==='en'?null:3063); // 3K+ is not an exact shop total.
 const result=readShopCards(document,ctx,'https://www.temu.com/mall.html?mall_id=1');
 assert.deepEqual(result.errors,[]);assert.equal(result.cards.length,sample.sales.length);assert.equal(result.hasMore,true);
});
