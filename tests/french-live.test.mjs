import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {parseSales,compareSnapshots,toCsv} from '../src/core.mjs';
import {readShopContext,readShopCards} from '../src/adapters.mjs';
const sample=JSON.parse(await readFile(new URL('./fixtures/fr-recommendation-labels.json',import.meta.url)));
test('French real vente labels support singular, no space and US grouping',()=>{
 for(const [raw,value,precision] of [['412ventes',412,'number'],['1vente',1,'number'],['4,000+ventes',4000,'lower_bound'],['1 234 vendus',1234,'number']]){
 const r=parseSales(raw,'fr');assert.equal(r.value,value,raw);assert.equal(r.precision,precision);
 }
 for(const raw of ['1,23ventes','1,5ventes','412ventes hier','412avis'])assert.equal(parseSales(raw,'fr').ok,false,raw);
});
test('real French recommendation labels replay through adapter in synthetic shop markup',()=>{
 const cards=sample.sales.map((sale,i)=>`<article data-tooltip="goodContainer-${i}"><a href="/a-g-${i}.html">Item</a><span data-type="saleTips">${sale}</span></article>`).join('');
 const header='<h1>Example</h1><button aria-label="États-Unis Français"></button>';
 const {document}=parseHTML(`${header}<div id="mall-top-head-category-container"></div><section class="mainContent"><div>222 articles</div><div class="js-goods-list">${cards}</div><button aria-label="Voir plus">More</button></section>`);
 const url='https://www.temu.com/mall.html?mall_id=1',ctx=readShopContext(document,url),result=readShopCards(document,ctx,url);
 assert.equal(ctx.language,'fr');assert.equal(result.cards.length,40);assert.deepEqual(result.errors,[]);assert.equal(result.moreButton.textContent,'More');
 const csv=toCsv(result.cards.map(c=>({语言:ctx.language,销量:c.list.value,精度:c.list.precision,原文:c.list.rawText})));
 assert.ok(csv.includes('fr,4000,lower_bound'));assert.ok(csv.includes('fr,412,number'));
 const unavailable=parseHTML(`${header}<main>Ce magasin n'est pas disponible.<section class="js-goods-list">${cards}</section></main>`).document;
 assert.equal(readShopContext(unavailable,url).ok,false);
});
test('French lower-bound readings never become precise daily sales',()=>{
 const snap=(day,raw)=>({market:'US',language:'fr',shopId:'1',goodsId:'1',day,list:{...parseSales(raw,'fr'),metricVersion:'shop-sales-v1'}});
 assert.equal(compareSnapshots(snap('2026-10-01','4,000+ventes'),snap('2026-10-02','5,000+ventes')).delta,null);
 assert.equal(compareSnapshots(snap('2026-10-01','412ventes'),snap('2026-10-02','420ventes')).delta,8);
});
