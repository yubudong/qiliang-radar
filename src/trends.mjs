import {compareSnapshots,previousDayKey} from './core.mjs';
// Call with one product's history from the currently selected shop.
export function trendMetrics(history,day) {
 const records=history.filter(s=>s.day<=day&&s.list);
 const byDay=new Map(records.map(s=>[s.day,s]));
 const firstSeen=records.map(s=>s.day).sort()[0]??null;
 const delta=(d)=>{const c=compareSnapshots(byDay.get(previousDayKey(d)),byDay.get(d));return c.ok&&Number.isFinite(c.delta)&&c.delta>=0?c.delta:null;};
 const days=[day];for(let i=0;i<3;i++)days.push(previousDayKey(days.at(-1)));
 const values=days.map(delta);
 const avg=a=>a.every(v=>v!==null)?a.reduce((a,b)=>a+b,0)/a.length:null;
 const average=avg(values.slice(0,3)),prior=avg(values.slice(1,4));
 const acceleration=values[0]!==null&&prior!==null?values[0]-prior:null;
 let streak=0,cursor=day;
 while(byDay.has(cursor)) {const v=delta(cursor);if(v===null||v<=0)break;streak++;cursor=previousDayKey(cursor);}
 const streakIncomplete=delta(cursor)===null;
 if(streak===0&&streakIncomplete)streak=null;
 const age=firstSeen?(Date.parse(day)-Date.parse(firstSeen))/86400000:null;
 return {average,acceleration,streak,streakIncomplete,firstSeen,rising:age!==null&&age<7&&streak>=2&&acceleration>0};
}
