import {
  ShiftAssignment, ShiftType, Staff, ShiftPreference, ShiftConfig,
  DailyRequirement, DEFAULT_CONFIG, WORK_SHIFTS, Carryover,
  CustomShift, isCustomShift,
} from "./types";
import { isRestDay } from "./holidays";

function daysIn(y:number,m:number){return new Date(y,m,0).getDate();}
function fmt(y:number,m:number,d:number){return`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}

function defaultReq(_y:number,_m:number,_d:number):DailyRequirement{
  return {};
}

/** Check if staff can work on a given day based on attendance pattern */
function canWorkDay(staff:Staff, y:number, m:number, d:number):boolean{
  const att=staff.attendance||"full";
  if(att==="full")return true;
  if(att==="weekday_only") return !isRestDay(y,m,d);
  const cd=staff.customDays||[true,true,true,true,true,true,true];
  return cd[new Date(y,m-1,d).getDay()]===true;
}

type Counts=Record<string,number>;
function newCounts(customShifts?:CustomShift[]):Counts{
  const c:Counts={day:0,semi_night:0,deep_night:0,off:0,early:0,late:0,
    long_day:0,standby:0,training:0,annual:0,am:0,pm:0,req_off:0};
  if(customShifts) for(const cs of customShifts) c[cs.id]=0;
  return c;
}
/** Total working days including night and custom work shifts */
function totalWork(c:Counts, customWorkIds?:string[]){
  let t=WORK_SHIFTS.reduce((s,k)=>s+(c[k]||0),0)+(c.semi_night||0)+(c.deep_night||0);
  if(customWorkIds) for(const id of customWorkIds) t+=(c[id]||0);
  return t;
}

function shuffle<T>(a:T[]):T[]{const r=[...a];for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;}

function sortByTarget(indices:number[],counts:Counts[],countKey:string,targets:number[],customWorkIds?:string[]):number[]{
  return shuffle(indices).sort((a,b)=>{
    const dA=targets[a]-(counts[a][countKey]||0);
    const dB=targets[b]-(counts[b][countKey]||0);
    if(dA!==dB)return dB-dA;
    return totalWork(counts[a],customWorkIds)-totalWork(counts[b],customWorkIds);
  });
}

export function generateShift(
  year:number, month:number, staffList:Staff[],
  prefs:ShiftPreference[], config:ShiftConfig=DEFAULT_CONFIG,
  dailyReqsMap:Record<string,DailyRequirement>={},
  carryover?:Carryover,
  customShifts?:CustomShift[],
):ShiftAssignment[]{
  const numDays=daysIn(year,month);
  const n=staffList.length;
  if(n===0)return[];

  const targetOffs=staffList.map(s=>s.monthlyOffDays||10);
  const en=config.enabledShifts;

  // Enabled custom work shift IDs
  const enabledCustom=(customShifts||[]).filter(cs=>cs.enabled&&en[cs.id]);
  const customWorkIds=enabledCustom.filter(cs=>cs.isWork).map(cs=>cs.id);

  // Targets: for "night" key, compare against semi_night count
  const shiftTargets:Record<string,number[]>={};
  for(const k of Object.keys(newCounts(customShifts))) shiftTargets[k]=staffList.map(s=>(s.targets?.[k as ShiftType])||0);
  // Night targets: stored under "night" key in staff, used to sort by semi_night deficit
  shiftTargets["night"]=staffList.map(s=>(s.targets?.night)||0);

  // Apply carryover adjustments from previous month
  if(carryover){
    for(let si=0;si<n;si++){
      const adj=carryover[staffList[si].id];
      if(!adj)continue;
      for(const[st,delta] of Object.entries(adj)){
        if(shiftTargets[st]){
          shiftTargets[st][si]=Math.max(0,shiftTargets[st][si]+(delta as number));
        }
      }
    }
  }

  const prefMap=new Map<string,ShiftType>();
  for(const p of prefs) prefMap.set(`${p.staffId}_${p.date}`, p.shift);

  const matrix:(ShiftType|null)[][]=Array.from({length:n},()=>Array(numDays+1).fill(null));
  const counts:Counts[]=Array.from({length:n},()=>newCounts(customShifts));

  // Daily caps for day-shift workers
  const avgOff=targetOffs.reduce((a,b)=>a+b,0)/n;
  const avgNightSets=staffList.reduce((a,s)=>a+(s.targets?.night||0),0)/n;
  const avgNightDays=avgNightSets*2; // semi+deep per set
  const avgDayWork=numDays-avgOff-avgNightDays;
  let restDays=0;for(let d=1;d<=numDays;d++)if(isRestDay(year,month,d))restDays++;
  const wdDays=numDays-restDays;
  const restCap=Math.max(3,Math.round(n*0.25));
  const totalDayWPD=n*Math.max(avgDayWork,0);
  const wdCap=wdDays>0?Math.round(Math.max((totalDayWPD-restDays*restCap)/wdDays,restCap)):restCap;

  // Step 0: Mark non-working days for attendance-restricted staff
  for(let si=0;si<n;si++){
    for(let d=1;d<=numDays;d++){
      if(!canWorkDay(staffList[si],year,month,d)&&matrix[si][d]===null){
        matrix[si][d]="off"; counts[si].off++;
      }
    }
  }

  // Step 1: Apply preferences
  for(let si=0;si<n;si++){
    const sid=staffList[si].id;
    for(let d=1;d<=numDays;d++){
      const key=`${sid}_${fmt(year,month,d)}`;
      const pref=prefMap.get(key);
      if(!pref||matrix[si][d]!==null)continue;

      if(pref==="off"){
        matrix[si][d]="req_off"; counts[si].req_off++;
      } else if(pref==="night"||pref==="semi_night"||pref==="deep_night"){
        // Night preference: place night set starting on d
        if(d<numDays&&matrix[si][d+1]===null){
          matrix[si][d]="semi_night"; counts[si].semi_night++;
          matrix[si][d+1]="deep_night"; counts[si].deep_night++;
          if(d+2<=numDays&&matrix[si][d+2]===null){
            matrix[si][d+2]="off"; counts[si].off++;
          }
        }
      } else {
        matrix[si][d]=pref; counts[si][pref]=(counts[si][pref]||0)+1;
      }
    }
  }

  // Step 2: Day by day
  for(let d=1;d<=numDays;d++){
    const dateStr=fmt(year,month,d);
    const dayReq:DailyRequirement=dailyReqsMap[dateStr]||defaultReq(year,month,d);

    const avail=():number[]=>{const a:number[]=[];for(let si=0;si<n;si++)if(matrix[si][d]===null)a.push(si);return a;};

    // Night assignment (only if not last day, need D+1 for deep_night)
    if(en.night&&d<numDays){
      const alreadySN=():number=>{let c=0;for(let si=0;si<n;si++)if(matrix[si][d]==="semi_night")c++;return c;};
      const nightNeed=Math.max(0,(dayReq.night||0)-alreadySN());
      if(nightNeed>0){
        const canNight=(si:number):boolean=>{
          if(matrix[si][d]!==null)return false;
          if(matrix[si][d+1]!==null)return false;
          // Exclude staff whose night target is 0
          if(shiftTargets["night"][si]<=0)return false;
          // Enforce night interval: no new night set if deep_night within last 2 days
          for(let back=1;back<=2&&d-back>=1;back++){
            if(matrix[si][d-back]==="deep_night")return false;
          }
          return true;
        };
        const cands=Array.from({length:n},(_,i)=>i).filter(canNight);
        const sorted=sortByTarget(cands,counts,"semi_night",shiftTargets["night"],customWorkIds);
        let assigned=0;
        for(const si of sorted){
          if(assigned>=nightNeed)break;
          matrix[si][d]="semi_night"; counts[si].semi_night++;
          matrix[si][d+1]="deep_night"; counts[si].deep_night++;
          if(d+2<=numDays&&matrix[si][d+2]===null){
            matrix[si][d+2]="off"; counts[si].off++;
          }
          assigned++;
        }
      }
    }

    // Other work shifts (not day, not night) — includes custom work shifts
    const otherShifts:string[]=["long_day","early","late","standby","training","am","pm",...customWorkIds];
    for(const st of otherShifts){
      if(!en[st])continue;
      const already=():number=>{let c=0;for(let si=0;si<n;si++)if(matrix[si][d]===st)c++;return c;};
      const need=Math.max(0,(dayReq[st]||0)-already());
      if(need<=0)continue;
      const tgt=shiftTargets[st]||staffList.map(()=>0);
      const sorted=sortByTarget(avail(),counts,st,tgt,customWorkIds);
      let assigned=0;
      for(const si of sorted){
        if(assigned>=need)break;
        matrix[si][d]=st as ShiftType; counts[si][st]=(counts[si][st]||0)+1; assigned++;
      }
    }

    // Day shifts: fill to meet requirement, then fill up to daily cap
    const isRest=isRestDay(year,month,d);
    const reqSum=Object.entries(dayReq).reduce((a,[k,v])=>k!=="night"?a+(v||0):a,0);
    const dailyCap=isRest?Math.max(reqSum,restCap):Math.max(reqSum,wdCap);
    let dayWorkers=0;
    for(let si=0;si<n;si++){
      const s=matrix[si][d];
      if(s&&(WORK_SHIFTS.includes(s)||customWorkIds.includes(s)))dayWorkers++;
    }
    const alreadyDay=():number=>{let c=0;for(let si=0;si<n;si++)if(matrix[si][d]==="day")c++;return c;};
    const dayNeed=Math.max((dayReq.day||0)-alreadyDay(),0);
    const remaining=sortByTarget(avail(),counts,"day",shiftTargets.day,customWorkIds);
    let dayFilled=0;
    for(const si of remaining){
      const tw=numDays-targetOffs[si];
      if(dayFilled<dayNeed||(dayWorkers<dailyCap&&totalWork(counts[si],customWorkIds)<tw)){
        matrix[si][d]="day"; counts[si].day++; dayWorkers++; dayFilled++;
      }else{
        matrix[si][d]="off"; counts[si].off++;
      }
    }
  }

  const assignments:ShiftAssignment[]=[];
  for(let si=0;si<n;si++)for(let d=1;d<=numDays;d++){
    assignments.push({staffId:staffList[si].id,date:fmt(year,month,d),shift:matrix[si][d]||"off"});
  }
  return assignments;
}
