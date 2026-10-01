import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {parseSales} from '../src/core.mjs';
import {readShopContext,readShopCards} from '../src/adapters.mjs';
// Synthetic contract samples, not captured Temu pages.
const cases=[
 ['en','United States English','1,234 items','See more items','1,234 sold','1.2K sold'],
 ['es','Estados Unidos Español','1.234 artículos','Ver más artículos','1.234 vendidos','1,2 mil vendidos'],
 ['fr','États-Unis Français','1 234 articles',"Voir plus d’articles",'1 234 vendus','1,2 k vendus'],
 ['pt','Estados Unidos Português','1.234 produtos','Ver mais produtos','1.234 vendidos','1,2 mil vendidos'],
 ['ru','США Русский','1 234 товаров','Посмотреть больше товаров','Продано 1 234','Продано 1,2 тыс.'],
 ['ar','الولايات المتحدة العربية','١٬٢٣٤ منتجات','عرض المزيد من المنتجات','تم بيع ١٬٢٣٤','تم بيع ١٫٢ ألف'],
 ['ko','미국 한국어','1,234개 상품','더 많은 상품 보기','1,234개 판매','1.2천개 판매'],
 ['zh-Hans','美国 简体中文','1,234 商品','查看更多商品','已售1,234件','已售0.12万件'],
 ['zh-Hant','美國 繁體中文','1,234 商品','查看更多商品','已售1,234件','已售0.12萬件'],
];
for(const [language,label,total,more,exact,rounded] of cases){
 test(`${language}: scoped shop, sales, duplicate label and load-more`,()=>{
 const {document}=parseHTML(`<h1>Example</h1><button aria-label="${label}"></button><div id="mall-top-head-category-container"></div><section class="mainContent"><div>${total}</div><div class="js-goods-list"><article data-tooltip="goodContainer-123"><a href="/a-g-123.html">Item</a><span data-type="saleTips">${exact}${exact}</span></article></div><button aria-label="${more}">More</button></section><button aria-label="${more}">Outside</button>`);
 const ctx=readShopContext(document,'https://www.temu.com/mall.html?mall_id=1');
 assert.equal(ctx.ok,true);assert.equal(ctx.language,language);assert.equal(ctx.reportedTotal,1234);
 const result=readShopCards(document,ctx,'https://www.temu.com/mall.html?mall_id=1');
 assert.equal(result.cards[0]?.list.value,1234);assert.equal(result.moreButton?.textContent,'More');
 assert.equal(parseSales(rounded,language).value,1200);
 assert.equal(parseSales(rounded,language).precision,'rounded');
 assert.equal(parseSales(exact+' yesterday',language).ok,false);
 });
}
test('number separators and periods cannot silently change magnitude',()=>{
 for(const [raw,lang] of [['1,23 sold','en'],['1.23 vendidos','es'],['1 23 vendus','fr'],['24 sold last month','en'],['24 avis','fr']])assert.equal(parseSales(raw,lang).ok,false,raw);
 assert.equal(parseSales('10K+ sold','en').precision,'lower_bound');
 assert.equal(parseSales('تم بيع ١٠ ألف+','ar').precision,'lower_bound');
});

test('captured English no-space labels preserve lower bounds',()=>{
 assert.equal(parseSales('2.3K+sold','en').value,2300);
 assert.equal(parseSales('2.3K+sold','en').precision,'lower_bound');
 assert.equal(parseSales('43sold','en').value,43);
});
