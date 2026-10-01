import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {parseSales} from '../src/core.mjs';
import {readShopContext,readShopCards} from '../src/adapters.mjs';
const sample=JSON.parse(await readFile(new URL('./fixtures/es-live-labels.json',import.meta.url)));
test('Spanish actual single/plural and compact labels',()=>{
 for(const [raw,value,precision] of [['324ventas',324,'number'],['1venta',1,'number'],['3K+ventas',3000,'lower_bound'],['2.3K+ventas',2300,'lower_bound']]){
 const r=parseSales(raw,'es');assert.equal(r.value,value,raw);assert.equal(r.precision,precision);
 }
 for(const raw of ['3Kventas extra','1.2.3Kventas','324opiniones'])assert.equal(parseSales(raw,'es').ok,false);
});
test('Spanish observed shop labels and more button replay',()=>{
 const cards=sample.sales.map((s,i)=>`<div data-tooltip="goodContainer-${i}"><a href="/item-g-${i}.html"></a><span data-type="saleTips">${s}</span></div>`).join('');
 const {document}=parseHTML(`<button aria-label="Estados Unidos Español"></button><h1>Sample</h1><div id="mall-top-head-category-container"></div><div class="mainContent"><span>722 artículos</span><div class="js-goods-list">${cards}</div><button>Ver más artículos</button></div>`);
 const u='https://www.temu.com/mall.html?mall_id=1',ctx=readShopContext(document,u),r=readShopCards(document,ctx,u);
 assert.equal(ctx.reportedTotal,722);assert.equal(r.cards.length,60);assert.deepEqual(r.errors,[]);assert.equal(r.hasMore,true);
});
