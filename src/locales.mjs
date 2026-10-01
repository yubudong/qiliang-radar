// Language contracts are conservative: unknown wording remains an explicit parse failure.
export const languages = {
 en:{name:'English',sold:/^(.+?)\s*sold$/i,total:/^([\d., ]+)\s*(?:items|products)\b/i,more:/^(?:See|View|Load) more(?: items| products)?$/i},
 es:{name:'Español',sold:/^(.+?)\s*(?:ventas?|vendidos?)$/i,total:/^([\d., ]+)\s*(?:artículos|productos)\b/i,more:/^(?:Ver|Mostrar|Cargar) más(?: artículos| productos)?$/i},
 fr:{name:'Français',sold:/^(.+?)\s*(?:ventes?|vendu(?:s|es|e)?)$/i,total:/^([\d., ]+)\s*(?:articles|produits)\b/i,more:/^(?:Voir|Afficher) plus(?: d['’](?:articles)| de produits)?$/i},
 pt:{name:'Português',sold:/^(.+?)\s*vendidos?$/i,total:/^([\d., ]+)\s*(?:artigos|produtos|itens)\b/i,more:/^(?:Ver|Mostrar|Carregar) mais(?: artigos| produtos| itens)?$/i},
 ru:{name:'Русский',sold:/^(?:Продано\s+(.+)|(.+?)\s*продано)$/i,total:/^([\d., ]+)\s*(?:товаров|товара|товары|товар|продуктов)(?:\s|$)/i,more:/^(?:Посмотреть|Показать|Загрузить) (?:больше|ещё|еще)(?: товаров)?$/i},
 ar:{name:'العربية',sold:/^(?:تم\s*بيع|تمّ\s*بيع)\s*(.+)$/,total:/^([\d., ]+)\s*(?:منتجات|منتج(?:\(ـات\))?|سلعة|سلع)(?:\s|$)/,more:/^(?:عرض|شاهد|مشاهدة) المزيد(?: من المنتجات| من السلع)?$/},
 ko:{name:'한국어',sold:/^(.+?)(?:개)?\s*(?:판매|판매됨|판매 완료)$/,total:/^([\d., ]+)\s*(?:개\s*)?상품/,more:/^(?:더 많은 상품 보기|상품 더 보기|더 보기)$/},
 'zh-Hans':{name:'简体中文',sold:/^(?:已售|售出)\s*(.+?)\s*(?:件|单)$/,total:/^([\d., ]+)\s*商品/,more:/^查看更多(?:商品)?$/},
 'zh-Hant':{name:'繁體中文',sold:/^(?:已售出|已售|售出)\s*(.+?)\s*(?:件|單)$/,total:/^([\d., ]+)\s*商品/,more:/^查看更多(?:商品)?$/},
};
export const normalizeText = value => String(value??'').normalize('NFKC').replace(/[\u200e\u200f\u061c]/g,'').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/٬/g,',').replace(/٫/g,'.').replace(/\s+/g,' ').trim();
export function parseCount(raw,language,{abbreviated=false}={}) {
 const commaDecimal=['es','pt','fr','ru'].includes(language);
 const decimal=commaDecimal?',':'.';
 const groups=['es','pt'].includes(language)?['.']:language==='fr'?[' ',',']:language==='ru'?[' ']:[','];
 let value=normalizeText(raw);
 // Decimal marks are accepted only with an explicit compact unit.
 if(abbreviated){
  const escaped=['es','pt','ru'].includes(language)?'[.,]':decimal==='.'?'\\.':',';
  if(!new RegExp(`^(?:0|[1-9]\\d*)(?:${escaped}\\d+)?$`).test(value))return null;
  return Number(value.replace(',','.'));
 }
 if(/^(?:0|[1-9]\d*)$/.test(value))return Number.isSafeInteger(Number(value))?Number(value):null;
 for(const separator of groups){
  const escaped=separator==='.'?'\\.':separator;
  if(new RegExp(`^[1-9]\\d{0,2}(?:${escaped}\\d{3})+$`).test(value)){
   const number=Number(value.split(separator).join(''));return Number.isSafeInteger(number)?number:null;
  }
 }
 return null;
}
export function parseLocalizedSales(rawText, language) {
 const fail={ok:false,reason:'无法识别销量文本'};
 const config=languages[language];if(!config)return fail;
 const match=normalizeText(rawText).match(config.sold);if(!match)return fail;
 let number=(match[1]??match[2]).trim(),lower=false;
 if(number.endsWith('+')){lower=true;number=number.slice(0,-1).trim();}
 const unitPatterns={en:/\s*(K|M)$/i,es:/\s*(mil|mill\.|K|M)$/i,pt:/\s*(mil|mi)$/i,fr:/\s*(k|M)$/i,ru:/\s*(тыс\.?|млн)$/i,ar:/\s*(ألف|آلاف|مليون|K|M)$/i,ko:/\s*(천|만)$/, 'zh-Hans':/(万)$/,'zh-Hant':/(萬)$/};
 const unit=number.match(unitPatterns[language]);let multiplier=1;
 if(unit){
  const key=unit[1].toLowerCase();multiplier=['m','mill.','mi','млн','مليون'].includes(key)?1e6:['万','萬','만'].includes(key)?1e4:1e3;
  number=number.slice(0,unit.index).trim();
 }
 const count=parseCount(number,language,{abbreviated:Boolean(unit)});if(count==null)return fail;
 const value=count*multiplier;if(!Number.isSafeInteger(value)||value<0)return fail;
 return {ok:true,value,precision:lower?'lower_bound':unit?'rounded':'number',rawText};
}
export function readLocale(document){
 const country=/^(?:美国|美國|United States(?: of America)?|US|USA|Estados Unidos|États-Unis|США|Соединенные Штаты|الولايات المتحدة(?: الأمريكية)?|미국)[ ,·]+/i;
 const controls=[...document.querySelectorAll('[role="button"][aria-label],button[aria-label]')].map(n=>normalizeText(n.getAttribute('aria-label'))).filter(label=>Object.values(languages).some(c=>label.endsWith(c.name)));
 if(controls.length!==1||!country.test(controls[0]))return null;
 const name=controls[0].replace(country,'');const language=Object.keys(languages).find(key=>languages[key].name===name);
 return language?{market:'US',language}:null;
}
export function readTotal(root,language){
 // Read individual nodes outside cards: concatenated root text joins "items" to product titles.
 const values=new Set();
 for(const node of root.querySelectorAll('div,span,p,h2')){
  if(node.closest('.js-goods-list')||node.querySelector('.js-goods-list')||node.children.length)continue;
  const match=normalizeText(node.textContent).match(languages[language]?.total);if(!match)continue;
  const value=parseCount(match[1].trim(),language);if(value!=null)values.add(value);
 }
 return values.size===1?[...values][0]:null;
}
