import { dayKey, normalizeMinSales } from './core.mjs';
import { sanitizeProductUrl } from './adapters.mjs';

const PREFIX = 'qiliang-radar:v1:';
const SETTINGS = `${PREFIX}settings`; const RUN = `${PREFIX}run`; const SNAPSHOT = `${PREFIX}snapshot:`;
const clone = (value) => value == null ? value : structuredClone(value);
const identityParts = (value) => [value.market,value.language,value.shopId,value.goodsId];
const identityKey = (identity) => encodeURIComponent(JSON.stringify(identityParts(identity)));
const snapshotKey = (identity, day) => `${SNAPSHOT}${identityKey(identity)}:${day}`;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const cleanDeep = (value) => {
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'navigationUrl').map(([key,item]) => [key,cleanDeep(item)]));
};

export function createStorage({getValue,setValue,listValues}, {canWrite=()=>false,now=()=>new Date()}={}) {
  if (![getValue,setValue,listValues].every((fn) => typeof fn === 'function')) throw new Error('GM 存储接口不完整');
  const read = async (key, fallback=null) => clone(await getValue(key, fallback));
  const requireLock = () => { if (!canWrite()) throw new Error('没有写入锁，已停止保存'); };
  const writeVerified = async (key, value, protectedWrite=true) => {
    if (protectedWrite) requireLock();
    try { await setValue(key, clone(value)); } catch (error) { throw new Error(`本地存储写入失败：${error.message}`); }
    let reread; try { reread = await getValue(key, null); } catch (error) { throw new Error(`本地存储复读失败：${error.message}`); }
    if (!same(reread,value)) throw new Error('本地存储写后复读不一致');
  };
  const normalizedIdentity = (identity) => {
    const fields=['market','language','shopId','goodsId','shopName','title'];
    if (!identity || fields.some((key)=>typeof identity[key] !== 'string' || !identity[key])) throw new Error('商品身份无效：字段必须是非空字符串');
    const productUrl=sanitizeProductUrl(identity.productUrl,identity.goodsId);
    if (!productUrl) throw new Error('商品身份无效：商品链接无法校验');
    return {...Object.fromEntries(fields.map((key)=>[key,identity[key]])),productUrl};
  };
  const validReading = (reading) => {
    if (!reading || !['list','detail'].includes(reading.kind) || !reading.data || reading.status && reading.status!=='success' || !dayKey(reading.data.capturedAt)) return false;
    const data=reading.data;
    if (reading.kind==='list') return typeof data.rawText==='string' && Boolean(data.rawText.trim()) && Number.isSafeInteger(data.value) && data.value>=0 && ['number','rounded','lower_bound'].includes(data.precision) && data.metricVersion==='shop-sales-v1';
    if (!Number.isSafeInteger(data.skuTotal) || data.skuTotal<0 || !Array.isArray(data.skuIds) || !data.skuIds.length || typeof data.skuCounts!=='object' || !data.skuCounts || data.metricVersion!=='sku-sold-quantity-v1' || typeof data.adapterVersion!=='string' || !data.adapterVersion) return false;
    if (data.goodsDisplayValue!==null && (!Number.isSafeInteger(data.goodsDisplayValue) || data.goodsDisplayValue<0)) return false;
    const sorted=[...data.skuIds].sort();
    if (data.skuIds.some((id)=>typeof id!=='string' || !id) || new Set(data.skuIds).size!==data.skuIds.length || !data.skuIds.every((id,index)=>id===sorted[index])) return false;
    if (Object.keys(data.skuCounts).sort().join('\0')!==sorted.join('\0')) return false;
    let total=0; for(const id of sorted) { const count=data.skuCounts[id]; if(!Number.isSafeInteger(count)||count<0)return false; total+=count; }
    return Number.isSafeInteger(total) && total===data.skuTotal;
  };
  const queues=new Map();
  const serialize = async (key, operation) => {
    const prior=queues.get(key) ?? Promise.resolve();
    const current=prior.catch(()=>{}).then(operation); queues.set(key,current);
    try { return await current; } finally { if(queues.get(key)===current) queues.delete(key); }
  };

  return {
    async getSettings() {
      const stored=await read(SETTINGS,{}); const min=normalizeMinSales(stored?.minSales);
      const settings={schemaVersion:1,minSales:min.ok?min.value:20,dayTimezone:'Asia/Shanghai'};
      if (!min.ok || stored?.schemaVersion!==1 || stored?.dayTimezone!=='Asia/Shanghai') await writeVerified(SETTINGS,settings,false);
      return settings;
    },
    async saveSettings(value) { const min=normalizeMinSales(value?.minSales); if(!min.ok)throw new Error(min.reason); const settings={schemaVersion:1,minSales:min.value,dayTimezone:'Asia/Shanghai'}; await writeVerified(SETTINGS,settings,false); return settings; },
    async saveDailyReading(identity, reading) {
      requireLock();
      const id=normalizedIdentity(identity); if(!validReading(reading))throw new Error('每日读数无效');
      const day=dayKey(reading.data.capturedAt); const key=snapshotKey(id,day);
      return serialize(key,async()=>{ requireLock(); const previous=await read(key,null);
        const base=previous ?? {schemaVersion:1,...id,day,list:null,detail:null,lastAttempt:null};
        const old=base[reading.kind]; const isNewer=!old || Date.parse(reading.data.capturedAt)>Date.parse(old.capturedAt);
        const result={...base,...id,[reading.kind]:isNewer?clone(reading.data):old,lastAttempt:{attemptedAt:now().toISOString(),status:'success',reasonCode:null}};
        await writeVerified(key,result); return result; });
    },
    async recordFailure(identity, day, reason) {
      requireLock(); const id=normalizedIdentity(identity); if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!reason)throw new Error('失败记录无效'); const key=snapshotKey(id,day);
      return serialize(key,async()=>{ requireLock(); const previous=await read(key,null); if(!previous)return null;
        const result={...previous,lastAttempt:{attemptedAt:now().toISOString(),status:'failed',reasonCode:String(reason)}};
        await writeVerified(key,result); return result; });
    },
    async getSnapshot(identity, day) { const id=normalizedIdentity(identity); return read(snapshotKey(id,day),null); },
    async listSnapshots(context={}, day) {
      const keys=await listValues(); const values=[];
      for (const key of keys.filter((key)=>key.startsWith(SNAPSHOT) && (!day || key.endsWith(`:${day}`)))) {
        const value=await read(key,null); if (value && ['market','language','shopId','goodsId'].every((field)=>context[field]==null || value[field]===context[field])) values.push(value);
      }
      return values;
    },
    async getRun() { return read(RUN,{current:null,history:[]}); },
    async saveRun(run) {
      requireLock(); return serialize(RUN,async()=>{requireLock(); const existing=await read(RUN,{current:null,history:[]}); const clean=cleanDeep(run);
        const history=[...(existing.history??[])];
        if (clean?.status==='completed' && !history.some((item)=>item.runId===clean.runId)) history.push(clean);
        const result={current:clean,history}; await writeVerified(RUN,result); return result;});
    }
  };
}
