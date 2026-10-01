import { dayKey, normalizeMinSales } from './core.mjs';

const PREFIX = 'qiliang-radar:v1:';
const LOCK = `${PREFIX}writer`;
const MARKER = '#qiliang-radar=';
export const RUNTIME_DEFAULTS = Object.freeze({ timeoutMs:30000, closeTimeoutMs:30000, taskIntervalMs:3000, pollMs:250, listWaitMs:30000, maxListRounds:100, maxScrollRounds:3 });
const clone = value => structuredClone(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const validMarker = value => value && validId(value.runId) && validId(value.taskId);
const contextFields = ['market','language','shopId','shopName'];
const sameContext = (a,b) => ['market','language','shopId'].every(key=>a?.[key]===b?.[key]);
const pickContext = value => Object.fromEntries(contextFields.map(key=>[key,String(value?.[key]??'')]));
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

export function taskKeys(runId,taskId) {
  if (!validMarker({runId,taskId})) throw new Error('任务标识无效');
  const suffix=`${runId}:${taskId}`;
  return {task:`${PREFIX}task:${suffix}`,result:`${PREFIX}result:${suffix}`,ack:`${PREFIX}ack:${suffix}`};
}
export function addTaskMarker(url,marker) {
  if (!validMarker(marker)) throw new Error('任务标识无效');
  const parsed=new URL(url);
  if (parsed.hash) throw new Error('existing-hash');
  if (parsed.protocol!=='https:' || parsed.hostname!=='www.temu.com') throw new Error('任务链接不属于支持的站点');
  parsed.hash=MARKER+encodeURIComponent(JSON.stringify({runId:marker.runId,taskId:marker.taskId}));
  return parsed.href;
}
export function parseTaskMarker(url) {
  try {
    const hash=new URL(url).hash;
    if (!hash.startsWith(MARKER)) return null;
    const value=JSON.parse(decodeURIComponent(hash.slice(MARKER.length)));
    return validMarker(value)?{runId:value.runId,taskId:value.taskId}:null;
  } catch {return null;}
}

/** The lock callback is the lifetime of the batch, including manual pauses. */
export function createRuntime(deps) {
  const {storage,gm,locks,readCards,clickMore,scrollList,onState=()=>{},now=()=>new Date(),setTimeout:schedule=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout,createId=()=>globalThis.crypto.randomUUID()}=deps;
  const config={...RUNTIME_DEFAULTS,...deps.config};
  for (const key of Object.keys(RUNTIME_DEFAULTS)) if (!Number.isFinite(config[key]) || config[key]<=0) throw new Error(`无效运行参数：${key}`);
  config.taskIntervalMs=Math.max(3000,config.taskIntervalMs);
  config.maxScrollRounds=Math.min(3,Math.floor(config.maxScrollRounds));
  let held=false,starting=false,ending=false,lifetime=null,writeChain=Promise.resolve(),active=null,recovery=null,shopContext=null;
  let run={status:'idle',phase:'list',reason:null,discoveredGoodsIds:[],pendingGoodsIds:[],completedGoodsIds:[],errors:[],currentTask:null};
  let items=[],seen=new Set(),saved=new Set(),belowThreshold=new Set(),blockedTask=null,navigation=new Map(),listDone=false,lastClosedAt=null,fatal=false;
  const waiters=new Set();
  const milliseconds=()=>now().getTime();
  const today=()=>dayKey(now());
  const live=()=>held&&!ending;
  const currentDay=()=>today()===run.day;
  const snapshot=()=>clone({...run,items,currentTask:active?.task??blockedTask??null,belowThresholdGoodsIds:[...belowThreshold],discoveredGoodsIds:[...seen],pendingGoodsIds:items.filter(item=>item.status==='pending').map(item=>item.identity.goodsId),completedGoodsIds:items.filter(item=>item.status==='completed').map(item=>item.identity.goodsId),savedListGoodsIds:[...saved]});
  const emit=()=>{try{onState(snapshot());}catch{/* UI callbacks cannot break lock cleanup. */}};
  const wake=()=>{for(const finish of [...waiters])finish();};
  const wait=(ms=config.pollMs)=>new Promise(resolve=>{
    let timer;const finish=()=>{if(timer!==undefined)cancel(timer);waiters.delete(finish);resolve();};
    waiters.add(finish);timer=schedule(finish,ms);
    if (ending) finish();
  });
  const change=(status,reason=null)=>{run.status=status;run.reason=reason;emit();wake();};
  const checkDay=()=>{if(currentDay())return true;change('paused','day-changed');if(active)active.invalid=true;return false;};
  const guardedWrite=fn=>{
    const job=writeChain.then(async()=>{
      if(!live()||!checkDay())return false;
      await fn();return true;
    });
    writeChain=job.catch(()=>{});return job;
  };
  const persist=()=>guardedWrite(()=>storage.saveRun({...snapshot(),updatedAt:now().toISOString()}));
  const failure=(goodsId,reason)=>{run.errors.push({goodsId:goodsId??null,reasonCode:reason});};
  const detach=async target=>{
    if(target?.listener!=null){const id=target.listener;target.listener=null;await gm.removeValueChangeListener(id);}
  };
  const storageFailed=error=>{fatal=true;if(active)active.invalid=true;failure(active?.task.goodsId,'storage-failed');change('paused',`storage-failed: ${error.message}`);};
  const pauseFor=async(reason,goodsId=active?.task.goodsId)=>{
    if(!live())return;
    if(active){active.failed=true;active.invalid=true;active.task.status='failed';}
    failure(goodsId,reason);change('paused',reason);
    if(goodsId&&currentDay()){
      const item=items.find(item=>item.identity.goodsId===goodsId);
      if(item)await guardedWrite(()=>storage.recordFailure(item.identity,run.day,reason));
    }
    await persist();
  };
  const waitRunnable=async()=>{
    while(live()){
      checkDay();if(run.status==='running')return true;
      await wait();
    }
    return false;
  };
  const makeIdentity=card=>({...pickContext(shopContext),goodsId:String(card.goodsId),title:String(card.title??''),productUrl:String(card.productUrl??'')});
  const readList=async()=>{
    if(!live()||!checkDay())return null;
    const result=await readCards(shopContext);
    if(!live()||!checkDay())return null;
    if(!result?.ok){await pauseFor(result?.reason??'list-unavailable',null);return null;}
    for(const id of result.seenGoodsIds??[])if(typeof id==='string'&&id)seen.add(id);
    for(const error of result.errors??[]){if(error.goodsId)seen.add(String(error.goodsId));if(!run.errors.some(e=>e.goodsId===error.goodsId&&e.reasonCode===error.reason))failure(error.goodsId,error.reason??'list-invalid');}
    for(const card of result.cards??[]){
      if(!live()||!checkDay())break;
      if(typeof card.goodsId!=='string'||!card.goodsId)continue;
      seen.add(card.goodsId);
      if(typeof card.navigationUrl==='string')navigation.set(card.goodsId,card.navigationUrl);
      const reading=card.list;
      if(!reading||!Number.isSafeInteger(reading.value)||reading.value<0||!['number','rounded','lower_bound'].includes(reading.precision)||!reading.metricVersion){failure(card.goodsId,'list-invalid');continue;}
      if(reading.value<run.minSales){belowThreshold.add(card.goodsId);continue;}
      belowThreshold.delete(card.goodsId);
      if(saved.has(card.goodsId))continue;
      if(dayKey(reading.capturedAt)!==run.day){failure(card.goodsId,'reading-day-mismatch');continue;}
      const identity=makeIdentity(card);
      if(!await guardedWrite(()=>storage.saveDailyReading(identity,{kind:'list',data:reading})))break;
      saved.add(card.goodsId);
      let item=items.find(item=>item.identity.goodsId===card.goodsId);
      if(item)item.identity=identity;
      else if(deps.enableDetail===true && reading.value>=10000){item={identity,status:'pending',attempts:0};items.push(item);}
    }
    run.reportedTotal=Number.isSafeInteger(result.reportedTotal)?result.reportedTotal:null;
    emit();await persist();return result;
  };
  const scan=async()=>{
    run.phase='list';run.listComplete=false;emit();
    let result=await readList(),rounds=0,scrolls=0;
    while(live()&&result&&rounds++<config.maxListRounds){
      if(!await waitRunnable())return;
      if(result.hasMore===false&&run.reportedTotal!==null&&seen.size>=run.reportedTotal){run.listComplete=true;break;}
      const before=seen.size;
      const clickedMore=Boolean(result.hasMore&&result.moreButton);
      if(result.hasMore&&result.moreButton){await clickMore(result.moreButton);}
      else if(scrollList&&scrolls<config.maxScrollRounds){await scrollList(shopContext);scrolls++;}
      else break;
      const deadline=milliseconds()+config.listWaitMs;
      let progressed=false;
      while(live()&&milliseconds()<deadline){
        if(!await waitRunnable())return;
        result=await readList();if(!result)return;
        if(seen.size>before){scrolls=0;progressed=true;break;}
        if(!clickedMore&&result.hasMore&&result.moreButton){progressed=true;break;}
        await wait(Math.min(config.pollMs,Math.max(1,deadline-milliseconds())));
      }
      if(!progressed){run.listReason='no-new-cards';break;}
    }
    if(result){listDone=true;run.phase='detail';await persist();emit();}
  };
  const validResult=(value,target)=>value&&value.runId===target.task.runId&&value.taskId===target.task.taskId&&value.goodsId===target.task.goodsId&&sameContext(value,target.task)&&value.day===run.day&&validId(value.workerInstanceId)&&(!target.task.workerInstanceId||value.workerInstanceId===target.task.workerInstanceId)&&typeof value.ok==='boolean';
  const validDetail=value=>value&&dayKey(value.capturedAt)===run.day&&Number.isSafeInteger(value.skuTotal)&&value.skuTotal>=0&&Array.isArray(value.skuIds)&&value.skuIds.length>0&&new Set(value.skuIds).size===value.skuIds.length&&value.skuIds.every(id=>typeof id==='string'&&id)&&typeof value.metricVersion==='string'&&typeof value.adapterVersion==='string';
  const consume=async(target,value)=>{
    if(!live()||active!==target||target.invalid||target.accepted||target.processing||!checkDay()||!validResult(value,target))return;
    target.processing=true;target.task.workerInstanceId=value.workerInstanceId;
    try{
      if(!value.ok){await pauseFor(value.reason??'detail-unavailable');return;}
      if(!validDetail(value.detail)){await pauseFor('detail-invalid');return;}
      const item=items.find(item=>item.identity.goodsId===target.task.goodsId);
      if(!item){await pauseFor('task-identity-missing');return;}
      if(!await guardedWrite(()=>storage.saveDailyReading(item.identity,{kind:'detail',data:value.detail})))return;
      if(!live()||active!==target||!checkDay()||target.invalid)return;
      // The adapter's saved daily record is authoritative, never the cached queue state.
      target.accepted=true;target.task.status='saved';target.acceptedAt=milliseconds();
      await guardedWrite(()=>gm.setValue(target.keys.ack,{runId:target.task.runId,taskId:target.task.taskId,workerInstanceId:value.workerInstanceId,goodsId:value.goodsId,day:run.day,saved:true}));
      await persist();emit();wake();
    }catch(error){storageFailed(error);}finally{target.processing=false;wake();}
  };
  const listen=async target=>{
    const reread=async()=>{if(!live()||active!==target)return;try{await consume(target,await gm.getValue(target.keys.result,null));}catch(error){storageFailed(error);}};
    target.listener=await gm.addValueChangeListener(target.keys.result,()=>{void reread();});
    if(!live()||active!==target){await detach(target);return;}
    await consume(target,await gm.getValue(target.keys.result,null));
  };
  const monitor=async target=>{
    while(live()&&active===target){
      if(!checkDay()){await wait();continue;}
      if(target.action)return target.action;
      if(target.orphan){await wait();continue;}
      if(!target.processing&&!target.failed){
        if(target.accepted&&target.handle?.closed===true)return 'completed';
        if(!target.accepted&&target.handle?.closed===true)await pauseFor('page-closed-before-result');
        else if(!target.accepted&&milliseconds()-target.startedAt>=config.timeoutMs)await pauseFor('detail-timeout');
        else if(target.accepted&&milliseconds()-target.acceptedAt>=config.closeTimeoutMs)await pauseFor('page-not-closed');
      }
      await wait();
    }
    return 'ended';
  };
  const finishTask=async(target,outcome)=>{
    target.invalid=true;await detach(target);
    const item=items.find(item=>item.identity.goodsId===target.task.goodsId);
    if(item&&outcome==='completed')item.status='completed';
    if(item&&outcome==='skipped')item.status='skipped';
    if(active===target)active=null;
    lastClosedAt=milliseconds();await persist();emit();
  };
  const dispatch=async item=>{
    if(!live()||!checkDay())return;
    const task={schemaVersion:1,runId:run.runId,taskId:`${createId()}-${milliseconds()}`,goodsId:item.identity.goodsId,...pickContext(run),day:run.day,createdAt:now().toISOString(),status:'pending',config:{timeoutMs:config.timeoutMs,maxScrollRounds:config.maxScrollRounds}};
    const target={task,keys:taskKeys(task.runId,task.taskId),handle:null,startedAt:milliseconds(),accepted:false,failed:false,invalid:false,processing:false,orphan:false};
    let url;
    try{url=addTaskMarker(navigation.get(item.identity.goodsId),task);}catch(error){await pauseFor(error.message,item.identity.goodsId);return;}
    item.attempts++;active=target;await persist();
    if(!await guardedWrite(()=>gm.setValue(target.keys.task,task)))return;
    await listen(target);
    if(!await waitRunnable())return;
    target.startedAt=milliseconds();
    try{
      target.handle=await gm.openInTab(url,{active:false,insert:true,setParent:true});
      if(!target.handle||typeof target.handle.closed!=='boolean'){target.orphan=true;await pauseFor('page-close-state-unavailable');}
    }catch{await pauseFor('page-open-failed');}
    const outcome=await monitor(target);
    if(live())await finishTask(target,outcome);
  };
  const restoreActive=async()=>{
    const task=recovery?.currentTask;
    if(!task)return;
    // Restoring has no trustworthy tab handle. A successful result alone is not closure evidence.
    const target={task:clone(task),keys:taskKeys(task.runId,task.taskId),handle:null,startedAt:milliseconds(),accepted:false,failed:task.status==='failed',invalid:task.status==='failed',processing:false,orphan:true};
    active=target;await listen(target);
    if(!live())return;
    change('paused','orphan-page-close-required');await persist();
    const outcome=await monitor(target);
    if(live())await finishTask(target,outcome);
  };
  const loop=async()=>{
    try{
      if(recovery)await restoreActive();
      if(deps.enableDetail!==true)items=[];
      while(live()){
        if(!await waitRunnable())break;
        if(!listDone){await scan();continue;}
        const item=items.find(item=>item.status==='pending');
        if(!item){change('completed');await persist();break;}
        if(!navigation.has(item.identity.goodsId)){change('paused','navigation-unavailable');continue;}
        if(lastClosedAt!==null&&milliseconds()-lastClosedAt<config.taskIntervalMs){await wait(config.taskIntervalMs-(milliseconds()-lastClosedAt));continue;}
        await dispatch(item);
      }
    }catch(error){
      storageFailed(error);
      while(live())await wait();
    }finally{
      ending=true;wake();if(active){active.invalid=true;await detach(active);}
      await writeChain;
      if(run.reason==='ended-by-user'&&currentDay())try{await storage.saveRun({...snapshot(),updatedAt:now().toISOString()});}catch(error){failure(null,`storage-failed: ${error.message}`);}
      held=false;starting=false;emit();
    }
  };
  const acquire=async()=>{
    if(!locks?.request){change('interrupted','locks-unavailable');return {ok:false,reason:'locks-unavailable'};}
    const entered=deferred();starting=true;ending=false;fatal=false;
    lifetime=Promise.resolve().then(()=>locks.request(LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
      if(!lock){starting=false;change('interrupted','lock-unavailable');entered.resolve({ok:false,reason:'lock-unavailable'});return;}
      held=true;starting=false;change('running');
      try{await persist();entered.resolve({ok:true});await loop();}
      catch(error){ending=true;if(active){active.invalid=true;await detach(active);}await writeChain;held=false;starting=false;change('interrupted',`storage-failed: ${error.message}`);entered.resolve({ok:false,reason:'storage-failed'});}
    })).catch(error=>{held=false;starting=false;change('interrupted',error.message);entered.resolve({ok:false,reason:error.message});});
    return entered.promise;
  };
  const prepare=(context,settings,old=null)=>{
    shopContext=context;ending=false;fatal=false;belowThreshold=new Set();blockedTask=null;navigation=new Map();lastClosedAt=null;active=null;listDone=false;
    if(old){
      recovery=clone(old);run=clone(old);items=clone(old.items??[]);seen=new Set();saved=new Set();
    }else{
      recovery=null;items=[];seen=new Set();saved=new Set();run={schemaVersion:1,runId:`${createId()}-${milliseconds()}`,...pickContext(context),day:today(),minSales:settings.minSales,status:'idle',phase:'list',reason:null,listComplete:false,errors:[]};
    }
  };
  const result=reason=>({ok:false,reason});
  const pageClosed=(options,target)=>{
    if(target.orphan)return options.confirmedOrphanClosed===true;
    return target.handle?.closed===true||(!target.handle&&options.confirmedOrphanClosed===true);
  };
  return {
    ownsLock:()=>held,
    canWrite:()=>held&&currentDay(),
    getState:snapshot,
    async startRun(context,settings={},options={}){
      if(starting||held)return result('already-running');
      const minimum=normalizeMinSales(settings.minSales);if(!minimum.ok)return result(minimum.reason);
      if(!context?.market||!context?.language||!context?.shopId)return result('shop-context-invalid');
      starting=true;
      try{
        const stored=await storage.getRun(),old=stored?.current??null;
        if(old&&old.day===today()&&sameContext(old,context)&&!['completed','ended','interrupted'].includes(old.status)){
          prepare(context,{minSales:minimum.value},old);starting=false;change('recoverable','resume-required');return result('resume-required');
        }
        const knownClosed=active?.task.runId===old?.currentTask?.runId&&active?.task.taskId===old?.currentTask?.taskId&&active?.handle?.closed===true;
        if(old?.currentTask&&!knownClosed&&options.confirmedOrphanClosed!==true){
          blockedTask=clone(old.currentTask);starting=false;change('interrupted','orphan-page-close-required');return result('orphan-page-close-required');
        }
        prepare(context,{minSales:minimum.value});return await acquire();
      }catch(error){starting=false;change('interrupted',error.message);return result(error.message);}
    },
    async pauseRun(){
      if(!live())return result('not-running');
      change('paused','manual-pause');if(!listDone){run.listComplete=false;run.listReason='manual-pause';}
      try{await persist();return {ok:true};}catch(error){storageFailed(error);return result('storage-failed');}
    },
    async resumeRun(options={}){
      if(starting)return result('already-running');
      if(run.day&&!currentDay())return result('day-changed');
      if(!held){if(run.status!=='recoverable'||!recovery)return result('no-recovery');return acquire();}
      if(ending)return result('ended');if(fatal)return result('storage-failed-restart-required');
      if(active&&(active.failed||active.orphan)){
        if(!pageClosed(options,active))return result(active.orphan?'orphan-page-close-required':'page-close-required');
        const item=items.find(item=>item.identity.goodsId===active.task.goodsId);
        if(!active.accepted&&item?.attempts>=2)return result('retry-exhausted');
        active.invalid=true;active.action=active.accepted?'completed':'retry';
      }
      if(run.reason==='navigation-unavailable')listDone=false;
      change('running');await persist();return {ok:true};
    },
    async skipCurrent(options={}){
      if(!live()||!active)return result('no-current-task');if(!currentDay())return result('day-changed');
      if(!pageClosed(options,active))return result(active.orphan?'orphan-page-close-required':'page-close-required');
      active.invalid=true;active.action=active.accepted?'completed':'skipped';change('running');await persist();return {ok:true};
    },
    async endRun(){
      if(!held){if(lifetime)await lifetime;return {ok:true};}
      ending=true;run.status='interrupted';run.reason='ended-by-user';if(active){active.invalid=true;await detach(active);}wake();
      await writeChain;
      if(lifetime)await lifetime;emit();return {ok:true};
    }
  };
}
