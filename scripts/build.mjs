import { build } from 'esbuild';

const metadata=`// ==UserScript==
// @name         起量雷达
// @namespace    local.qiliang-radar
// @version      0.1.6
// @description  Temu竞品销量参考增量追踪
// @match        https://www.temu.com/*
// @run-at       document-start
// @sandbox      DOM
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// ==/UserScript==`;

await build({
  entryPoints:['src/entry.mjs'], outfile:'dist/qiliang-radar.user.js', bundle:true,
  format:'iife', platform:'browser', target:['chrome120'], charset:'utf8',
  legalComments:'none', banner:{js:metadata}, sourcemap:false,
});
