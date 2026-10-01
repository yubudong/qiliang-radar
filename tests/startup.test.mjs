import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

test('bundled userscript mounts with GM APIs in userscript scope, outside page window', async()=>{
 const {document}=parseHTML(await readFile(new URL('./fixtures/shop-cards.html',import.meta.url),'utf8'));
 const page={document,location:{href:'https://www.temu.com/mall.html?mall_id=634418226107291'},navigator:{}};
 const values=new Map();
 const sandbox={window:page,document,URL,URLSearchParams,console,setTimeout,clearTimeout,crypto,
  GM_getValue:(k,d)=>values.has(k)?values.get(k):d,
  GM_setValue:(k,v)=>values.set(k,v),GM_listValues:()=>[...values.keys()]};
 vm.runInNewContext(await readFile(new URL('../dist/qiliang-radar.user.js',import.meta.url),'utf8'),sandbox);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(document.querySelector('#qiliang-radar-host')?.shadowRoot?.querySelector('strong')?.textContent.includes('起量雷达'));
});
