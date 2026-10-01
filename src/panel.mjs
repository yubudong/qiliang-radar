import {trendMetrics} from './trends.mjs';
import { compareSnapshots, normalizeMinSales, previousDayKey, toCsv } from './core.mjs';

const text = (value) => value == null ? '' : String(value);
const element = (document, tag, value, className) => {
  const node = document.createElement(tag);
  if (value != null) node.textContent = text(value);
  if (className) node.className = className;
  return node;
};

export function buildResultRows(currentSnapshots, previousByGoodsId = new Map(), historyGoodsIds = new Set(), {belowThresholdGoodsIds=new Set()}={}) {
  return currentSnapshots.map((current) => {
    const previous = previousByGoodsId.get(current.goodsId) ?? null;
    const comparison = compareSnapshots(previous, current, historyGoodsIds.has(current.goodsId));
    const source = comparison.ok ? comparison.source : 'none';
    let previousDisplay = '', currentDisplay = '';
    if (source === 'sku') {
      previousDisplay = text(comparison.previousValue);
      currentDisplay = text(comparison.currentValue);
    } else if (source === 'list') {
      previousDisplay = comparison.previousValue == null ? (previous?.list?.rawText ?? '') : text(comparison.previousValue);
      currentDisplay = comparison.currentValue == null ? (current.list?.rawText ?? '') : text(comparison.currentValue);
    } else if (!previous) {
      currentDisplay = current.list?.rawText ?? (current.detail ? text(current.detail.skuTotal) : '');
    }
    const baseStatus = current.missingToday ? (belowThresholdGoodsIds.has(current.goodsId) ? '本次未达门槛' : '今日未采到') : comparison.ok ? comparison.status : comparison.reason;
    const failureReason = current.lastAttempt?.status === 'failed' ? current.lastAttempt.reasonCode : null;
    const status = failureReason ? `${baseStatus}；${failureReason}` : baseStatus;
    return {
      ...current, comparison, previousDisplay, currentDisplay,
      deltaDisplay: comparison.ok && comparison.delta != null ? `${comparison.label?.includes('约') ? '约 ' : ''}${comparison.delta > 0 ? '+' : ''}${comparison.delta}` : '',
      sourceDisplay:comparison.ok ? comparison.label : '', status,
    };
  }).sort((a, b) => {
    const aDelta = a.comparison.ok ? a.comparison.delta : null;
    const bDelta = b.comparison.ok ? b.comparison.delta : null;
    if (aDelta == null && bDelta == null) return 0;
    if (aDelta == null) return 1;
    if (bDelta == null) return -1;
    return bDelta - aDelta;
  });
}

export async function collectResultRows(storage, context, day, options={}) {
  const current = await storage.listSnapshots(context, day);
  const yesterday = previousDayKey(day);
  const all = await storage.listSnapshots(context);
  const previous = new Map();
  const history = new Set();
  const latestByGoods=new Map();
  for (const item of all) {
    if (item.day === yesterday) previous.set(item.goodsId, item);
    if (item.day < day) history.add(item.goodsId);
    if (item.day < day && (!latestByGoods.has(item.goodsId) || latestByGoods.get(item.goodsId).day < item.day)) latestByGoods.set(item.goodsId,item);
  }
  const currentIds=new Set(current.map((item)=>item.goodsId));
  for (const goodsId of history) if (!currentIds.has(goodsId)) current.push({...latestByGoods.get(goodsId),day,list:null,detail:null,lastAttempt:null,missingToday:true});
  const grouped=new Map();
  for(const item of all){if(!grouped.has(item.goodsId))grouped.set(item.goodsId,[]);grouped.get(item.goodsId).push(item);}
  return buildResultRows(current, previous, history, options).map(row=>({...row,trends:trendMetrics(grouped.get(row.goodsId)??[],day)}));
}

export function filterResultRows(rows, filter) {
  return rows.filter((row)=>filter==='全部' || (filter==='新星' ? row.trends?.rising===true : filter==='新收录' ? row.status==='新收录' : /复核|异常|变化|失败|缺|未采到|未达门槛/.test(row.status)));
}

const statusNames={idle:'未开始',running:'采集中',paused:'已暂停',completed:'已完成',interrupted:'已结束',recoverable:'可继续'};
const reasonNames={'orphan-page-close-required':'请先关闭旧详情页','day-changed':'日期已变化，请重新采集','manual-pause':'手动暂停','resume-required':'发现未完成批次，请确认后继续','detail-timeout':'详情读取超时','storage-failed':'本地存储失败','page-close-required':'请先关闭当前详情页'};
export const humanReason=(reason)=>reasonNames[reason] ?? (reason ? `异常：${reason}` : '');
export function formatProgress(state={}) {
  const saved=new Set(state.savedListGoodsIds??[]),below=new Set(state.belowThresholdGoodsIds??[]);
  const failed=new Set(),missing=new Set();let systemErrors=0;
  for(const e of state.errors??[]){
    if(!e.goodsId){systemErrors++;continue;}
    if(saved.has(e.goodsId)||below.has(e.goodsId))continue;
    (e.reasonCode==='未展示销量'?missing:failed).add(e.goodsId);
  }
  for(const id of failed)missing.delete(id);
  const status=state.status==='completed'&&state.listComplete===false?'本次结束（未采全）':statusNames[state.status]??'未开始';
  const total=state.reportedTotal==null?'未知':state.reportedTotal;
  const reason=state.reason?`；${humanReason(state.reason)}`:'';
  return `${status}｜已扫描 ${new Set(state.discoveredGoodsIds??[]).size} / ${total}｜保存成功 ${saved.size}｜低于门槛跳过 ${below.size}｜未展示销量 ${missing.size}｜失败商品 ${failed.size}${systemErrors?`｜运行异常 ${systemErrors}`:''}${reason}`;
}

export function createLatestRefresh(load, apply, onError = () => {}) {
  let generation=0;
  return async function refresh() {
    const current=++generation;
    try {
      const value=await load();
      if (current===generation) apply(value);
      return value;
    } catch (error) {
      if (current===generation) onError(error);
      return null;
    }
  };
}

function appendCell(row, node) { const cell = row.ownerDocument.createElement('td'); cell.append(node); row.append(cell); }

export function renderResultsTable(container, rows, document = container.ownerDocument) {
  container.replaceChildren();
  const table = element(document, 'table');
  const head = element(document, 'thead'); const headerRow = element(document, 'tr');
  for (const title of ['商品', '昨日参考', '今日参考', '参考增量', '近3日均增量', '连续增长天数', '增速变化', '首次发现', '状态']) headerRow.append(element(document, 'th', title));
  head.append(headerRow); table.append(head);
  const body = element(document, 'tbody');
  for (const item of rows) {
    const row = element(document, 'tr');
    const link = element(document, 'a', item.title || item.goodsId);
    if (typeof item.productUrl === 'string' && item.productUrl.startsWith('https://www.temu.com/')) { link.href=item.productUrl; link.target='_blank'; link.rel='noopener'; }
    appendCell(row, link);
    appendCell(row, element(document, 'span', item.previousDisplay));
    appendCell(row, element(document, 'span', item.currentDisplay));
    appendCell(row, element(document, 'span', item.deltaDisplay));
    for(const value of trendDisplays(item.trends)) appendCell(row,element(document,'span',value));
    const details = element(document, 'details');
    details.append(element(document, 'summary', item.status));
    const source = item.comparison.source === 'sku' ? 'SKU 汇总参考' : item.comparison.source === 'list' ? '列表参考' : '无可比来源';
    const detailText = [
      `来源：${item.sourceDisplay || source}`,
      item.list?.rawText ? `列表原文：${item.list.rawText}` : '',
      item.list?.capturedAt ? `列表采集：${item.list.capturedAt}` : '',
      item.detail?.capturedAt ? `详情采集：${item.detail.capturedAt}` : '',
      item.detail?.skuIds ? `SKU 数：${item.detail.skuIds.length}` : '',
      item.lastAttempt?.reasonCode ? `异常：${item.lastAttempt.reasonCode}` : '',
    ].filter(Boolean).join('；');
    details.append(element(document, 'div', detailText)); appendCell(row, details); body.append(row);
  }
  table.append(body); container.append(table); return table;
}

const metricText=v=>v==null?'数据不足':`约 ${Number(v.toFixed(1))}`;
function trendDisplays(t={}) {return [metricText(t.average),t.streak==null?'数据不足':`${t.streakIncomplete?'至少 ':''}${t.streak}`,metricText(t.acceleration),t.firstSeen??'数据不足'];}
export function rowsToCsv(rows, day, context) {
  return toCsv(rows.map((row) => ({
    日期:day, 站点:context.market, 店铺ID:context.shopId, 店铺名称:row.shopName,
    商品ID:`\u200c${row.goodsId}`, 商品名称:row.title, 商品链接:row.productUrl,
    昨日原文:row.comparison.source === 'list' ? (row.previousDisplay || '') : '',
    今日原文:row.list?.rawText ?? '', 昨日比较值:row.comparison.previousValue,
    今日比较值:row.comparison.currentValue, 来源:row.sourceDisplay || row.comparison.source,
    参考增量:row.comparison.delta, 近3日均增量:trendDisplays(row.trends)[0], 连续增长天数:trendDisplays(row.trends)[1], 增速变化:trendDisplays(row.trends)[2], 首次发现:trendDisplays(row.trends)[3], 新星:row.trends?.rising?'是':'', 状态:row.status,
    昨日采集时间:row.comparison.previousCapturedAt, 今日采集时间:row.comparison.currentCapturedAt,
  })));
}

export function mountPanel({ document, context, storage, runtime, initialDay, contextStillMatches = () => true }) {
  const host=element(document,'div'); host.id='qiliang-radar-host'; document.documentElement.append(host);
  const root=host.attachShadow({mode:'open'});
  const style=element(document,'style'); style.textContent=':host{all:initial} .panel{position:fixed;z-index:2147483647;right:16px;top:72px;width:min(1120px,calc(100vw - 32px));max-height:78vh;overflow:auto;background:#fff;color:#17212b;border:1px solid #ccd4dc;border-radius:10px;padding:12px;font:14px/1.45 system-ui;box-shadow:0 8px 30px #0002} header{display:flex;justify-content:space-between} .controls{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0} button,input,select{font:inherit} table{min-width:1000px;width:100%;border-collapse:collapse} th,td{border-top:1px solid #e5e7eb;padding:6px;text-align:left;vertical-align:top} th{white-space:nowrap} td:first-child{min-width:240px;max-width:320px;overflow-wrap:anywhere} .progress-summary{position:sticky;top:0;z-index:2;background:#eef6ff;border:1px solid #abc9ec;border-radius:6px;padding:12px;margin:10px 0;font-weight:600;line-height:1.8;white-space:normal} .status{color:#4b5563}'; root.append(style);
  const panel=element(document,'section',null,'panel'); const header=element(document,'header');
  const titleWrap=element(document,'div'); titleWrap.append(element(document,'strong','起量雷达'),element(document,'div','Temu竞品销量追踪助手'));
  const fold=element(document,'button','折叠'); header.append(titleWrap,fold); panel.append(header);
  const content=element(document,'div'); content.append(element(document,'div',`${context.shopName || context.shopId} · ${context.market} · ${initialDay}`)); const controls=element(document,'div',null,'controls');
  const threshold=element(document,'input'); threshold.type='number'; threshold.min='0'; threshold.value='20'; threshold.title='最低累计销量';
  const day=element(document,'input'); day.type='date'; day.value=initialDay;
  const filter=element(document,'select'); for (const value of ['全部','新星','新收录','需复核']) { const option=element(document,'option',value); option.value=value; filter.append(option); }
  const buttons={}; for (const name of ['开始','暂停','继续','结束本次','跳过当前','已关闭旧详情页，继续','导出 CSV']) { buttons[name]=element(document,'button',name); controls.append(buttons[name]); }
  buttons['已关闭旧详情页，继续'].hidden=true;
  controls.prepend(element(document,'label','最低累计销量'),threshold,day,filter); content.append(controls); content.append(element(document,'div','近3日均增量含今日；增速变化＝今日增量－此前3日均增量。缺采不补零；首次发现不等于上架日期。新星：首次发现7天内、连续增长至少2天、增速变化为正。','status'));
  const progress=element(document,'div','尚未开始：点击开始后显示本次采集统计','progress-summary'); const table=element(document,'div'); content.append(progress,table); panel.append(content); root.append(panel);
  let rows=[], runtimeState={belowThresholdGoodsIds:[]}, orphanMode=null;
  const showError=(error)=>{ progress.textContent=error?.message ?? String(error); };
  const refresh=createLatestRefresh(
    ()=>collectResultRows(storage,context,day.value,{belowThresholdGoodsIds:new Set(runtimeState.day===day.value ? (runtimeState.belowThresholdGoodsIds ?? []) : [])}),
    (value)=>{ rows=value; renderResultsTable(table,filterResultRows(rows,filter.value),document); },
    showError,
  );
  const guard=()=>{ if (!contextStillMatches()) throw new Error('当前店铺已变化，请刷新后重新开始'); };
  const action=(fn)=>async()=>{ try { guard(); const result=await fn(); if (result?.ok===false) throw new Error(humanReason(result.reason)); await refresh(); } catch(error){showError(error);} };
  storage.getSettings().then((settings)=>{threshold.value=String(settings.minSales);}).catch(showError);
  const minimum=()=>{const result=normalizeMinSales(threshold.value); if(!result.ok) throw new Error(result.reason); return result.value;};
  threshold.addEventListener('change',async()=>{ try { await storage.saveSettings({minSales:minimum()}); } catch(error){showError(error);} });
  const startAttempt=async(options)=>{ try { guard(); const result=await runtime.startRun(context,{minSales:minimum(),dayTimezone:'Asia/Shanghai'},options); if(result?.ok===false){ if(result.reason==='orphan-page-close-required'){orphanMode='start';buttons['已关闭旧详情页，继续'].hidden=false;buttons['继续'].hidden=true;} throw new Error(humanReason(result.reason)); } orphanMode=null; await refresh(); } catch(error){showError(error);} };
  buttons['开始'].addEventListener('click',()=>startAttempt());
  buttons['暂停'].addEventListener('click',action(()=>runtime.pauseRun()));
  buttons['继续'].addEventListener('click',action(()=>runtime.resumeRun()));
  buttons['结束本次'].addEventListener('click',action(()=>runtime.endRun()));
  buttons['跳过当前'].addEventListener('click',action(()=>runtime.skipCurrent()));
  buttons['已关闭旧详情页，继续'].addEventListener('click',()=>orphanMode==='start'?startAttempt({confirmedOrphanClosed:true}):action(()=>runtime.resumeRun({confirmedOrphanClosed:true}))());
  buttons['导出 CSV'].addEventListener('click',()=>{ try { const blob=new Blob([rowsToCsv(filterResultRows(rows,filter.value),day.value,context)],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const anchor=element(document,'a'); anchor.href=url; const shopFileName=String(context.shopName || context.shopId || '未知店铺').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').trim().replace(/[. ]+$/g,'').slice(0,100) || context.shopId || '未知店铺'; anchor.download=`起量雷达-${shopFileName}-${day.value}.csv`; anchor.click(); URL.revokeObjectURL(url); } catch(error){showError(error);} });
  day.addEventListener('change',refresh); filter.addEventListener('change',refresh); fold.addEventListener('click',()=>{content.hidden=!content.hidden; fold.textContent=content.hidden?'展开':'折叠';});
  refresh();
  return {host,refresh,updateState(state){ runtimeState=state??{}; const orphan=state?.reason==='orphan-page-close-required'; if(orphan && orphanMode==null) orphanMode='resume'; if(!orphan) orphanMode=null; buttons['已关闭旧详情页，继续'].hidden=!orphan; buttons['继续'].hidden=orphan; progress.textContent=formatProgress(state); void refresh(); }};
}
