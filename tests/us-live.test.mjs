import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSales} from '../src/core.mjs';
import {readTotal} from '../src/locales.mjs';
import {parseHTML} from 'linkedom';
const samples=JSON.parse(await readFile(new URL('./fixtures/us-live-labels.json',import.meta.url)));
for(const [language,labels] of Object.entries(samples))test(`US ${language} observed sales labels parse`,()=>{
 assert.ok(labels.length>10);
 for(const raw of labels)assert.equal(parseSales(raw,language).ok,true,raw);
});
test('US observed compact numbers preserve precision',()=>{
 for(const [language,raw,value,precision] of [['pt','5.2milvendidos',5200,'rounded'],['ru','7.6тыс+продано',7600,'lower_bound'],['ar','تمبيع6.4K‎+‎',6400,'lower_bound'],['zh-Hant','已售出2,456件',2456,'number'],['ko','5.4만판매됨',54000,'rounded']]){
 const r=parseSales(raw,language);assert.equal(r.value,value,raw);assert.equal(r.precision,precision,raw);
 }
 for(const raw of ['1.2.3milvendidos','5.2vendidos','5,2.1milvendidos'])assert.equal(parseSales(raw,'pt').ok,false);
});
test('US observed Russian and Arabic shop totals',()=>{
 for(const [language,label] of [['ru','28 товары'],['ar','28 منتج(ـات)']])assert.equal(readTotal(parseHTML(`<div><span>${label}</span></div>`).document,language),28);
});
