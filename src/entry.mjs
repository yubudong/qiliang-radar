import { dayKey } from './core.mjs';

const PREFIX='qiliang-radar:v1:';
const localTaskKeys=(runId,taskId)=>({task:`${PREFIX}task:${runId}:${taskId}`,result:`${PREFIX}result:${runId}:${taskId}`,ack:`${PREFIX}ack:${runId}:${taskId}`});
function localParseTaskMarker(urlString) {
  try {
    const hash=new URL(urlString).hash.slice(1); const params=new URLSearchParams(hash);
    const combined=params.get('qiliang-radar-task');
    if (combined) { const split=combined.indexOf(':'); if (split>0) return {runId:combined.slice(0,split),taskId:combined.slice(split+1)}; }
    const runId=params.get('qiliang-radar-run'), taskId=params.get('qiliang-radar-task-id');
    return runId && taskId ? {runId,taskId} : null;
  } catch { return null; }
}
const sameTask=(task,marker)=>task?.schemaVersion===1 && task?.status==='pending' && task.runId===marker.runId && task.taskId===marker.taskId && ['goodsId','market','language','shopId','day'].every((key)=>typeof task[key]==='string'&&task[key]);
const delay=(setTimer,milliseconds)=>new Promise((resolve)=>setTimer(resolve,milliseconds));

export async function runDetailWorker(deps) {
  const {
    document, location, gm, readDetail, pageProblem=()=>null, now=()=>new Date(),
    createId=()=>crypto.randomUUID(), close=()=>globalThis.close(),
    setTimeout:setTimer=globalThis.setTimeout, clearTimeout:clearTimer=globalThis.clearTimeout,
    scroll=()=>globalThis.scrollBy?.(0,Math.max(600,globalThis.innerHeight ?? 600)),
    parseTaskMarker=localParseTaskMarker, taskKeys=localTaskKeys,
  }=deps;
  const marker=parseTaskMarker(location.href);
  if (!marker) return {ok:false,controlled:false,reason:'无任务标记'};
  const keys=taskKeys(marker.runId,marker.taskId);
  const task=await gm.getValue(keys.task,null);
  if (!sameTask(task,marker)) return {ok:false,controlled:false,reason:'任务无效或已失效'};
  if (dayKey(now(),'Asia/Shanghai')!==task.day) return {ok:false,controlled:true,reason:'任务日期不匹配'};
  if (document.readyState==='loading') await new Promise((resolve)=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  const workerInstanceId=createId(); let closed=false, listenerId=null;
  const cleanup=()=>{ if (listenerId!=null) { gm.removeValueChangeListener(listenerId); listenerId=null; } };
  const stillOriginal=async()=>{
    const currentMarker=parseTaskMarker(location.href);
    if (!currentMarker || currentMarker.runId!==task.runId || currentMarker.taskId!==task.taskId) return false;
    const currentTask=await gm.getValue(keys.task,null);
    return currentTask?.runId===task.runId && currentTask?.taskId===task.taskId && currentTask?.goodsId===task.goodsId && currentTask?.day===task.day && dayKey(now(),'Asia/Shanghai')===task.day;
  };
  const acceptAck=async()=>{
    if (closed) return;
    const ack=await gm.getValue(keys.ack,null);
    if (!ack?.saved || ack.runId!==task.runId || ack.taskId!==task.taskId || ack.workerInstanceId!==workerInstanceId || ack.goodsId!==task.goodsId || ack.day!==task.day) return;
    if (!await stillOriginal()) return;
    const reread=readDetail(document,task,location.href);
    if (!reread?.ok || reread.goodsId!==task.goodsId) return;
    closed=true; cleanup();
    try { close(); } catch {}
  };
  listenerId=gm.addValueChangeListener(keys.ack,()=>acceptAck());
  await acceptAck();
  if (closed) return {ok:true,controlled:true,workerInstanceId,cleanup};
  const explicitProblem=pageProblem(document);
  let reading=explicitProblem ? {ok:false,reason:explicitProblem} : readDetail(document,task,location.href);
  const maxRounds=Math.max(0,Math.min(3,task.config?.maxScrollRounds ?? 3));
  const timeoutMs=Math.max(0,Math.min(30000,task.config?.timeoutMs ?? 30000));
  const started=now().getTime();
  for (let round=0; reading?.pending && round<maxRounds && now().getTime()-started<timeoutMs; round++) {
    scroll(); await delay(setTimer,Math.min(500,timeoutMs));
    if (!await stillOriginal()) { cleanup(); return {ok:false,controlled:true,reason:'页面已导航或任务失效'}; }
    const problem=pageProblem(document); reading=problem ? {ok:false,reason:problem} : readDetail(document,task,location.href);
  }
  if (!await stillOriginal()) { cleanup(); return {ok:false,controlled:true,reason:'页面已导航、任务失效或已经跨日'}; }
  if (reading?.ok && (reading.goodsId!==task.goodsId || dayKey(reading.detail?.capturedAt,'Asia/Shanghai')!==task.day)) reading={ok:false,reason:'详情身份或日期不匹配'};
  const result={runId:task.runId,taskId:task.taskId,workerInstanceId,goodsId:task.goodsId,market:task.market,language:task.language,shopId:task.shopId,day:task.day,ok:Boolean(reading?.ok)};
  if (reading?.ok) result.detail=reading.detail; else result.reason=reading?.pending?'详情未取到':(reading?.reason ?? '详情未取到');
  await gm.setValue(keys.result,result);
  return {ok:true,controlled:true,workerInstanceId,result,cleanup};
}

const waitForDom=(document)=>document.readyState==='loading' ? new Promise((resolve)=>document.addEventListener('DOMContentLoaded',resolve,{once:true})) : Promise.resolve();

export async function bootBrowser(globalObject=globalThis, gm={
  getValue:typeof GM_getValue==='function' ? GM_getValue : globalObject.GM_getValue,
  setValue:typeof GM_setValue==='function' ? GM_setValue : globalObject.GM_setValue,
  listValues:typeof GM_listValues==='function' ? GM_listValues : globalObject.GM_listValues,
}) {
  const document=globalObject.document, location=globalObject.location;
  if (!document || !location) return {ok:false,reason:'非浏览器环境'};
  const [{readDetail,pageProblem,readShopCards,readShopContext},{createStorage},{createRuntime,parseTaskMarker,taskKeys},{mountPanel}]=await Promise.all([
    import('./adapters.mjs'),import('./storage.mjs'),import('./runtime.mjs'),import('./panel.mjs'),
  ]);
  if (![gm.getValue,gm.setValue,gm.listValues].every((fn)=>typeof fn==='function')) return {ok:false,reason:'Tampermonkey 接口不完整'};
  await waitForDom(document);
  const context=readShopContext(document,location.href);
  if (!context.ok) return context;
  let runtime, panel;
  const storage=createStorage(gm,{canWrite:()=>runtime?.canWrite?.() ?? false});
  runtime=createRuntime({storage,gm,locks:globalObject.navigator?.locks,readCards:()=>readShopCards(document,context,location.href),clickMore:(button)=>button?.click(),scrollList:()=>context.root?.scrollIntoView({block:'end'}),onState:(state)=>panel?.updateState(state)});
  panel=mountPanel({document,context,storage,runtime,initialDay:dayKey(new Date(),'Asia/Shanghai'),contextStillMatches:()=>{const current=readShopContext(document,location.href); return current.ok&&['market','language','shopId'].every((key)=>current[key]===context[key]);}});
  return {ok:true,context,storage,runtime,panel};
}

if (typeof window!=='undefined' && typeof document!=='undefined') void bootBrowser(window);
