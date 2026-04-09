"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Staff, ShiftPreference, ShiftAssignment, ShiftType, ShiftConfig,
  DailyRequirement, ShiftTargets, AttendancePattern, EmploymentType,
  ConfirmedData, Carryover,
  SHIFT_LABELS, SHIFT_SHORT, SHIFT_BG, SHIFT_TEXT, SHIFT_COLORS,
  ALL_SHIFTS, TOGGLEABLE_SHIFTS, ToggleableShift, TARGET_SHIFTS,
  ASSIGNABLE_SHIFTS, DEFAULT_CONFIG, DEFAULT_TARGETS, WORK_SHIFTS,
  ATTENDANCE_LABELS, EMPLOYMENT_LABELS, EMPLOYMENT_BADGE,
} from "@/lib/types";
import {
  loadStaff, saveStaff, loadPrefs, savePrefs,
  loadAssignments, saveAssignments, loadConfig, saveConfig,
  loadDailyReqs, saveDailyReqs,
  loadConfirmed, saveConfirmed, loadConfirmedMonths, saveConfirmedMonths,
} from "@/lib/storage";
import { generateShift } from "@/lib/scheduler";
import { getHolidayName, isRestDay } from "@/lib/holidays";
import { checkShift } from "@/lib/warnings";

type Tab = "staff"|"requirements"|"prefs"|"shift"|"report";
const DOW_NAMES=["日","月","火","水","木","金","土"];
const MAX_STAFF=100;

function fmtDate(y:number,m:number,d:number){return`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
function ym(y:number,m:number){return`${y}-${String(m).padStart(2,"0")}`;}
function prevYM(y:number,m:number):[number,number]{return m===1?[y-1,12]:[y,m-1];}

/* ━━━ Shared UI ━━━ */
const Pill = ({st,label,active=true}:{st:ShiftType;label?:string;active?:boolean}) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${active?SHIFT_COLORS[st]:"text-gray-400 border-gray-200 bg-gray-50"}`}>
    {label||SHIFT_LABELS[st]}
  </span>
);
const Badge = ({text,color}:{text:string;color:string}) => (
  <span className={`inline-block px-1.5 py-0 rounded text-[10px] font-medium ${color}`}>{text}</span>
);
function dayHeaderClass(y:number,m:number,d:number){
  const dowIdx=new Date(y,m-1,d).getDay();
  const dow=DOW_NAMES[dowIdx];
  const holiday=getHolidayName(fmtDate(y,m,d));
  const isSat=dowIdx===6;
  const isRest=dowIdx===0||holiday!==null;
  const cls=isRest?"bg-red-50 text-red-500":isSat?"bg-blue-50 text-blue-500":"bg-gray-50 text-gray-500";
  return{cls,dow,holiday,isSat};
}

/* ━━━━━━━━━━━━━━ Root ━━━━━━━━━━━━━━ */
export default function Home() {
  const [tab, setTab] = useState<Tab>("staff");
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [prefs, setPrefs] = useState<ShiftPreference[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [config, setConfig] = useState<ShiftConfig>(DEFAULT_CONFIG);
  const [dailyReqs, setDailyReqs] = useState<Record<string,DailyRequirement>>({});
  const [confirmedMonths, setConfirmedMonths] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()+1);

  useEffect(()=>{
    setStaffList(loadStaff()); setPrefs(loadPrefs());
    setAssignments(loadAssignments()); setConfig(loadConfig());
    setDailyReqs(loadDailyReqs()); setConfirmedMonths(loadConfirmedMonths());
    setMounted(true);
  },[]);

  useEffect(()=>{if(mounted)saveStaff(staffList);},[staffList,mounted]);
  useEffect(()=>{if(mounted)savePrefs(prefs);},[prefs,mounted]);
  useEffect(()=>{if(mounted)saveAssignments(assignments);},[assignments,mounted]);
  useEffect(()=>{if(mounted)saveConfig(config);},[config,mounted]);
  useEffect(()=>{if(mounted)saveDailyReqs(dailyReqs);},[dailyReqs,mounted]);

  const enabledWork = WORK_SHIFTS.filter(s=>config.enabledShifts[s as ToggleableShift]);
  const enabledTargets = TARGET_SHIFTS.filter(s=>config.enabledShifts[s as ToggleableShift]);
  const enabledAssign = useMemo(()=>{
    const r:ShiftType[]=[];
    for(const s of ASSIGNABLE_SHIFTS){
      if(s==="off"||s==="req_off"){r.push(s);continue;}
      if(s==="semi_night"||s==="deep_night"){if(config.enabledShifts.night)r.push(s);continue;}
      if(config.enabledShifts[s as ToggleableShift])r.push(s);
    }
    return r;
  },[config]);
  const enabledDisplay = useMemo(()=>[...ALL_SHIFTS.filter(s=>config.enabledShifts[s as ToggleableShift]),"req_off" as ShiftType],[config]);

  // Carryover: load previous month's confirmed data and compute deltas
  const currentYM = ym(year,month);
  const [py,pm] = prevYM(year,month);
  const prevConfirmed = useMemo(()=>mounted?loadConfirmed(ym(py,pm)):{},[py,pm,mounted]);
  const carryover = useMemo(():Carryover=>{
    if(Object.keys(prevConfirmed).length===0)return {};
    const co:Carryover={};
    for(const s of staffList){
      const pc=prevConfirmed[s.id];
      if(!pc)continue;
      const adj:Record<string,number>={};
      // Night: target - actual (semi_night count = night sets)
      const nightTarget=s.targets?.night||0;
      const nightActual=pc.semi_night||0;
      if(nightTarget-nightActual!==0) adj["night"]=nightTarget-nightActual;
      // Day shifts
      for(const st of TARGET_SHIFTS){
        if(st==="night")continue;
        const t=s.targets?.[st]||0;
        const a=pc[st]||0;
        if(t-a!==0) adj[st]=t-a;
      }
      if(Object.keys(adj).length>0) co[s.id]=adj;
    }
    return co;
  },[prevConfirmed,staffList]);

  const handleGenerate = useCallback(()=>{
    const co=Object.keys(carryover).length>0?carryover:undefined;
    const r = generateShift(year,month,staffList,prefs,config,dailyReqs,co);
    setAssignments(r); setTab("shift");
  },[year,month,staffList,prefs,config,dailyReqs,carryover]);

  const isConfirmed = confirmedMonths.includes(currentYM);

  const handleConfirm = useCallback(()=>{
    const mp=currentYM;
    const data:ConfirmedData={};
    for(const s of staffList){
      const counts:Record<string,number>={};
      for(const a of assignments){
        if(a.staffId===s.id&&a.date.startsWith(mp)){
          counts[a.shift]=(counts[a.shift]||0)+1;
        }
      }
      data[s.id]=counts;
    }
    saveConfirmed(mp,data);
    const newList=[...new Set([...confirmedMonths,mp])].sort();
    setConfirmedMonths(newList);
    saveConfirmedMonths(newList);
  },[assignments,staffList,currentYM,confirmedMonths]);

  if(!mounted) return <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-sky-50 to-white"><p className="text-gray-400 text-lg">読み込み中...</p></div>;

  const tabItems:[Tab,string,string][]=[
    ["staff","スタッフ管理","👤"],["requirements","必要人数設定","📋"],
    ["prefs","勤務希望入力","✋"],["shift","シフト表","📅"],["report","月間レポート","📊"],
  ];

  return (
    <div className="max-w-full mx-auto px-3 sm:px-6 py-5 bg-gradient-to-b from-slate-50 to-orange-50/20 min-h-screen">
      <header className="mb-5 bg-gradient-to-r from-white via-sky-50/60 to-indigo-50/40 rounded-2xl px-5 py-4 border border-sky-100 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-indigo-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md">S</div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">シフトメーカー</h1>
            <p className="text-xs text-gray-400">看護師シフト自動作成ツール — 登録スタッフ {staffList.length}名</p>
          </div>
        </div>
        <div className="mt-3 bg-white/70 rounded-xl px-4 py-3 border border-sky-100">
          <p className="text-xs font-bold text-sky-700 mb-1.5">📖 はじめての方へ — かんたん5ステップ</p>
          <div className="flex flex-wrap gap-x-1 gap-y-1 text-[11px] text-gray-600">
            <span className="bg-sky-50 border border-sky-200 rounded-full px-2.5 py-0.5 font-medium">❶ スタッフ登録</span>
            <span className="text-gray-300">→</span>
            <span className="bg-sky-50 border border-sky-200 rounded-full px-2.5 py-0.5 font-medium">❷ 必要人数を入力</span>
            <span className="text-gray-300">→</span>
            <span className="bg-sky-50 border border-sky-200 rounded-full px-2.5 py-0.5 font-medium">❸ 勤務希望を入力</span>
            <span className="text-gray-300">→</span>
            <span className="bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5 font-medium text-emerald-700">❹ シフト自動作成</span>
            <span className="text-gray-300">→</span>
            <span className="bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5 font-medium text-emerald-700">❺ 確認・手直し</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">※ まずは「👤スタッフ管理」タブで、スタッフのお名前を登録するところから始めましょう</p>
        </div>
      </header>

      <div className="bg-white/80 backdrop-blur rounded-xl border border-gray-200/80 p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <select value={year} onChange={e=>setYear(Number(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-sky-200 outline-none">
            {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={e=>setMonth(Number(e.target.value))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-sky-200 outline-none">
            {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{m}月</option>)}
          </select>
          <button onClick={handleGenerate}
            className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg hover:from-sky-600 hover:to-indigo-600 active:scale-[0.97] transition-all">
            シフトを自動作成
          </button>
          {isConfirmed&&<span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">✓ 確定済み</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-gray-500 font-medium text-xs">使用する勤務種類</span>
          {TOGGLEABLE_SHIFTS.map(key=>(
            <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none group">
              <button onClick={()=>setConfig({...config,enabledShifts:{...config.enabledShifts,[key]:!config.enabledShifts[key]}})}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${config.enabledShifts[key]?"bg-sky-500 border-sky-500 text-white shadow-sm":"border-gray-300 bg-white group-hover:border-sky-300"}`}>
                {config.enabledShifts[key]&&<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
              </button>
              <Pill st={key} active={config.enabledShifts[key]}/>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200/80 overflow-x-auto">
        {tabItems.map(([key,label,icon])=>(
          <button key={key} onClick={()=>setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all ${
              tab===key?"border-sky-500 text-sky-700 bg-sky-50/60 rounded-t-lg":"border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300 rounded-t-lg"
            }`}><span className="mr-1">{icon}</span>{label}</button>
        ))}
      </div>

      <div className="bg-white/90 backdrop-blur rounded-xl border border-gray-200/80 p-4 shadow-sm">
        {tab==="staff"&&<StaffPanel staffList={staffList} setStaffList={setStaffList} enabledTargets={enabledTargets}/>}
        {tab==="requirements"&&<ReqPanel year={year} month={month} dailyReqs={dailyReqs} setDailyReqs={setDailyReqs} enabledWork={enabledWork} nightEnabled={config.enabledShifts.night}/>}
        {tab==="prefs"&&<PrefsPanel staffList={staffList} prefs={prefs} setPrefs={setPrefs} year={year} month={month} enabledDisplay={enabledDisplay} nightEnabled={config.enabledShifts.night}/>}
        {tab==="shift"&&<ShiftPanel staffList={staffList} assignments={assignments} setAssignments={setAssignments} year={year} month={month} enabledAssign={enabledAssign} enabledDisplay={enabledDisplay} nightEnabled={config.enabledShifts.night} onConfirm={handleConfirm} isConfirmed={isConfirmed} carryover={carryover} prevYM={ym(py,pm)} prevConfirmed={prevConfirmed}/>}
        {tab==="report"&&<ReportPanel staffList={staffList} confirmedMonths={confirmedMonths} enabledDisplay={enabledDisplay}/>}
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Staff Panel ━━━━━━━━━━━━━━ */
function StaffPanel({staffList,setStaffList,enabledTargets}:{staffList:Staff[];setStaffList:(s:Staff[])=>void;enabledTargets:ShiftType[];}){
  const [newName,setNewName]=useState("");
  const [expanded,setExpanded]=useState<string|null>(null);
  const [showBulk,setShowBulk]=useState(false);
  const [bulkOff,setBulkOff]=useState(10);
  const [bulkTargets,setBulkTargets]=useState<ShiftTargets>({...DEFAULT_TARGETS});

  const addStaff=()=>{const name=newName.trim();if(!name)return;if(staffList.length>=MAX_STAFF){alert(`上限${MAX_STAFF}人`);return;}setStaffList([...staffList,{id:String(Date.now()),name,monthlyOffDays:10,targets:{...DEFAULT_TARGETS},attendance:"full",customDays:[true,true,true,true,true,true,true],employment:"fulltime"}]);setNewName("");};
  const update=(id:string,patch:Partial<Staff>)=>setStaffList(staffList.map(s=>s.id===id?{...s,...patch}:s));
  const applyBulk=()=>{setStaffList(staffList.map(s=>({...s,monthlyOffDays:bulkOff,targets:{...bulkTargets}})));setShowBulk(false);};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">👤 スタッフ一覧 <span className="text-sm font-normal text-gray-400">({staffList.length}/{MAX_STAFF})</span></h2>
        <button onClick={()=>setShowBulk(!showBulk)} className="bg-gray-50 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-50 hover:text-sky-700 border border-gray-200 transition-all">まとめて設定</button>
      </div>
      <p className="text-xs text-gray-400">シフトに入るスタッフを登録します。名前の横をクリックすると、休日数や夜勤回数などの詳細設定ができます。</p>
      {showBulk&&(
        <div className="bg-gradient-to-r from-sky-50 to-indigo-50/50 rounded-xl p-4 space-y-3 border border-sky-200">
          <h3 className="font-bold text-sky-800 text-sm">全スタッフにまとめて同じ設定を適用できます</h3>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center gap-1"><span className="text-gray-600">月の休み</span>
              <input type="number" min={0} max={28} value={bulkOff} onChange={e=>setBulkOff(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1 w-14 text-center focus:ring-2 focus:ring-sky-200 outline-none"/><span className="text-gray-400">日</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {enabledTargets.map(st=>(<div key={st} className="flex items-center gap-1"><Pill st={st}/><input type="number" min={0} max={30} value={bulkTargets[st]||0} onChange={e=>setBulkTargets({...bulkTargets,[st]:Number(e.target.value)})} className="border border-gray-200 rounded-lg px-1 py-1 w-12 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/><span className="text-gray-400 text-xs">回</span></div>))}
          </div>
          <button onClick={applyBulk} className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg active:scale-[0.97] transition-all">全員に適用</button>
        </div>
      )}
      <div className="space-y-1.5 max-h-[65vh] overflow-y-auto">
        {staffList.length===0&&(
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-gray-400 text-sm mb-1">まだスタッフが登録されていません</p>
            <p className="text-gray-400 text-xs">下の入力欄にお名前を入力して「追加」ボタンを押してください</p>
          </div>
        )}
        {staffList.map((s,idx)=>{const badge=EMPLOYMENT_BADGE[s.employment||"fulltime"];return(
          <div key={s.id} className="border border-gray-200 rounded-lg overflow-hidden hover:border-sky-200 transition-colors">
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gradient-to-r hover:from-white hover:to-sky-50/40 transition-all" onClick={()=>setExpanded(expanded===s.id?null:s.id)}>
              <span className="text-xs text-gray-400 w-6 text-right font-medium">{idx+1}</span>
              <input value={s.name} onChange={e=>{e.stopPropagation();update(s.id,{name:e.target.value});}} onClick={e=>e.stopPropagation()} className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-20 font-medium focus:ring-2 focus:ring-sky-200 outline-none"/>
              {badge&&<Badge text={badge} color={s.employment==="part"?"bg-lime-100 text-lime-700":"bg-orange-100 text-orange-700"}/>}
              <div className="flex items-center gap-1 text-xs text-gray-500"><span>休</span>
                <input type="number" min={0} max={28} value={s.monthlyOffDays} onChange={e=>{e.stopPropagation();update(s.id,{monthlyOffDays:Math.max(0,Math.min(28,Number(e.target.value)))});}} onClick={e=>e.stopPropagation()} className="border border-gray-200 rounded px-1 py-0.5 w-10 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/><span>日</span>
              </div>
              <svg className={`ml-auto w-4 h-4 text-gray-400 transition-transform ${expanded===s.id?"rotate-180":""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
              <button onClick={e=>{e.stopPropagation();setStaffList(staffList.filter(st=>st.id!==s.id));}} className="text-gray-300 hover:text-red-500 text-sm ml-1 transition">✕</button>
            </div>
            {expanded===s.id&&(
              <div className="px-4 py-3 bg-gradient-to-b from-gray-50 to-white border-t border-gray-100 space-y-4">
                <div><p className="text-xs text-gray-500 mb-2 font-medium">月間目標回数</p>
                  <div className="flex flex-wrap gap-2">{enabledTargets.map(st=>(<div key={st} className="flex items-center gap-1"><Pill st={st}/><input type="number" min={0} max={30} value={s.targets[st]||0} onChange={e=>update(s.id,{targets:{...s.targets,[st]:Number(e.target.value)}})} className="border border-gray-200 rounded px-1 py-0.5 w-12 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/><span className="text-gray-400 text-xs">回</span></div>))}</div>
                </div>
                <div><p className="text-xs text-gray-500 mb-2 font-medium">勤務条件</p>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2"><span className="text-gray-600 text-xs">雇用形態</span>
                      <select value={s.employment||"fulltime"} onChange={e=>update(s.id,{employment:e.target.value as EmploymentType})} className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:ring-2 focus:ring-sky-200 outline-none">
                        {(Object.keys(EMPLOYMENT_LABELS) as EmploymentType[]).map(k=><option key={k} value={k}>{EMPLOYMENT_LABELS[k]}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-2"><span className="text-gray-600 text-xs">出勤パターン</span>
                      <select value={s.attendance||"full"} onChange={e=>update(s.id,{attendance:e.target.value as AttendancePattern})} className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:ring-2 focus:ring-sky-200 outline-none">
                        {(Object.keys(ATTENDANCE_LABELS) as AttendancePattern[]).map(k=><option key={k} value={k}>{ATTENDANCE_LABELS[k]}</option>)}
                      </select>
                    </div>
                  </div>
                  {(s.attendance||"full")==="custom"&&(
                    <div className="flex items-center gap-2 mt-2 text-xs"><span className="text-gray-500">出勤可能曜日:</span>
                      {DOW_NAMES.map((dn,i)=>(<label key={i} className="flex items-center gap-0.5 cursor-pointer select-none">
                        <button onClick={()=>{const cd=[...(s.customDays||[true,true,true,true,true,true,true])];cd[i]=!cd[i];update(s.id,{customDays:cd});}} className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${(s.customDays||[])[i]?"bg-sky-500 border-sky-500 text-white":"border-gray-300 bg-white"}`}>
                          {(s.customDays||[])[i]&&<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                        </button>
                        <span className={`${i===0?"text-red-500":i===6?"text-blue-500":"text-gray-600"}`}>{dn}</span>
                      </label>))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );})}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addStaff()} placeholder="例: 山田 花子" className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-36 focus:ring-2 focus:ring-sky-200 outline-none"/>
        <button onClick={addStaff} className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg active:scale-[0.97] transition-all">追加</button>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Requirements Panel ━━━━━━━━━━━━━━ */
function ReqPanel({year,month,dailyReqs,setDailyReqs,enabledWork,nightEnabled}:{year:number;month:number;dailyReqs:Record<string,DailyRequirement>;setDailyReqs:(r:Record<string,DailyRequirement>)=>void;enabledWork:ShiftType[];nightEnabled:boolean;}){
  const numDays=new Date(year,month,0).getDate();
  const days=Array.from({length:numDays},(_,i)=>i+1);
  const ds=(d:number)=>fmtDate(year,month,d);
  const getReq=(d:number):DailyRequirement=>{const k=ds(d);if(dailyReqs[k])return dailyReqs[k];return isRestDay(year,month,d)?{day:3,night:2}:{day:5,night:2};};
  const setReq=(d:number,st:ShiftType,val:number)=>{const k=ds(d);setDailyReqs({...dailyReqs,[k]:{...getReq(d),[st]:val}});};
  const nonNightWork=enabledWork.filter(s=>s!=="night");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">📋 必要人数設定 <span className="text-sm font-normal text-gray-400">({year}年{month}月)</span></h2>
        <button onClick={()=>setDailyReqs({})} className="bg-gray-50 text-gray-500 border border-gray-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all">初期値に戻す</button>
      </div>
      <p className="text-xs text-gray-400">各日に必要な勤務者数を設定します。数字を直接書き換えてください。土日・祝日はあらかじめ少なめの値が入っています。</p>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="text-xs sm:text-sm border-collapse w-max">
          <thead><tr>
            <th className="sticky left-0 z-10 bg-gray-50 border-b border-r border-gray-200 px-2 py-2 min-w-[64px] text-gray-600 text-left">勤務</th>
            {days.map(d=>{const{cls,dow,holiday}=dayHeaderClass(year,month,d);return(
              <th key={d} className={`border-b border-gray-200 px-1 py-1 min-w-[36px] text-center ${cls}`}>
                <div className="font-bold">{d}</div><div className="font-normal text-[10px]">{dow}</div>
                {holiday&&<div className="text-[7px] text-red-400 truncate max-w-[34px] leading-tight" title={holiday}>{holiday.slice(0,3)}</div>}
              </th>);})}
          </tr></thead>
          <tbody>
            {nonNightWork.map(st=>(<tr key={st} className="hover:bg-gray-50/30">
              <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-2 py-1"><Pill st={st}/></td>
              {days.map(d=>(<td key={d} className="border-b border-gray-100 px-0 py-0">
                <input type="number" min={0} max={99} value={getReq(d)[st]||0} onChange={e=>setReq(d,st,Number(e.target.value))} className="w-full px-1 py-1.5 text-center text-sm bg-transparent hover:bg-gray-50 focus:bg-sky-50 outline-none transition"/>
              </td>))}
            </tr>))}
            {nightEnabled&&(<>
              <tr className="hover:bg-indigo-50/20"><td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-2 py-1"><Pill st="semi_night"/></td>
                {days.map(d=>(<td key={d} className="border-b border-gray-100 px-0 py-0"><input type="number" min={0} max={99} value={getReq(d).night||0} onChange={e=>setReq(d,"night",Number(e.target.value))} className="w-full px-1 py-1.5 text-center text-sm bg-transparent hover:bg-indigo-50 focus:bg-indigo-50 outline-none transition"/></td>))}
              </tr>
              <tr className="hover:bg-violet-50/20"><td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-2 py-1"><Pill st="deep_night"/></td>
                {days.map(d=>(<td key={d} className="border-b border-gray-100 px-0 py-0"><input type="number" min={0} max={99} value={getReq(d).night||0} onChange={e=>setReq(d,"night",Number(e.target.value))} className="w-full px-1 py-1.5 text-center text-sm bg-transparent hover:bg-violet-50 focus:bg-violet-50 outline-none transition"/></td>))}
              </tr>
            </>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Preferences Panel ━━━━━━━━━━━━━━ */
function PrefsPanel({staffList,prefs,setPrefs,year,month,enabledDisplay,nightEnabled}:{staffList:Staff[];prefs:ShiftPreference[];setPrefs:(p:ShiftPreference[])=>void;year:number;month:number;enabledDisplay:ShiftType[];nightEnabled:boolean;}){
  const numDays=new Date(year,month,0).getDate();
  const days=Array.from({length:numDays},(_,i)=>i+1);
  const mp=ym(year,month);
  const ds=(d:number)=>fmtDate(year,month,d);
  const [editing,setEditing]=useState<{staffId:string;day:number}|null>(null);
  const ddRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{const h=(e:MouseEvent)=>{if(ddRef.current&&!ddRef.current.contains(e.target as Node))setEditing(null);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);

  const getPref=(sid:string,d:number):ShiftType|null=>{const p=prefs.find(x=>x.staffId===sid&&x.date===ds(d));return p?.shift??null;};
  const prefCnt=(sid:string)=>prefs.filter(x=>x.staffId===sid&&x.date.startsWith(mp)).length;
  const selectPref=(sid:string,d:number,shift:ShiftType)=>{setPrefs([...prefs.filter(x=>!(x.staffId===sid&&x.date===ds(d))),{staffId:sid,date:ds(d),shift}]);setEditing(null);};
  const clearPref=(sid:string,d:number)=>{setPrefs(prefs.filter(x=>!(x.staffId===sid&&x.date===ds(d))));setEditing(null);};

  type SO={key:string;shift:ShiftType;label:string};
  const selectable=useMemo(()=>{const r:SO[]=[];for(const s of enabledDisplay.filter(s=>s!=="req_off")){if(s==="night"){if(nightEnabled){r.push({key:"sn",shift:"night",label:"準夜"});r.push({key:"dn",shift:"night",label:"深夜"});}}else{r.push({key:s,shift:s,label:SHIFT_LABELS[s]});}}return r;},[enabledDisplay,nightEnabled]);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-gray-800">✋ 勤務希望入力 <span className="text-sm font-normal text-gray-400">({year}年{month}月)</span></h2>
      <p className="text-xs text-gray-400">スタッフの希望勤務を入力します。表のマスをクリックすると勤務種類を選べます（1人あたり月5件まで）。</p>
      {staffList.length===0&&(
        <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-gray-400 text-sm">先に「👤スタッフ管理」タブでスタッフを登録してください</p>
        </div>
      )}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="text-[10px] sm:text-xs border-collapse w-max">
          <thead><tr>
            <th className="sticky left-0 z-20 bg-gray-50 border-b border-r border-gray-200 px-2 py-1.5 min-w-[40px] text-gray-600">名前</th>
            {days.map(d=>{const{cls,dow,holiday}=dayHeaderClass(year,month,d);return(<th key={d} className={`border-b border-gray-200 px-0.5 py-0.5 min-w-[28px] text-center ${cls}`}><div>{d}</div><div className="font-normal">{dow}</div>{holiday&&<div className="text-[6px] text-red-400">祝</div>}</th>);})}
            <th className="sticky right-0 z-20 bg-gray-50 border-b border-l border-gray-200 px-2 py-1.5 text-gray-600">計</th>
          </tr></thead>
          <tbody>
            {staffList.map(s=>(<tr key={s.id} className="hover:bg-gray-50/50">
              <td className="sticky left-0 z-20 bg-white border-b border-r border-gray-200 px-2 py-1 font-medium whitespace-nowrap">{s.name}</td>
              {days.map(d=>{const pref=getPref(s.id,d);const isEd=editing?.staffId===s.id&&editing?.day===d;return(
                <td key={d} className={`border-b border-gray-100 px-0.5 py-0.5 text-center cursor-pointer select-none relative transition ${pref?`${SHIFT_BG[pref]} ${SHIFT_TEXT[pref]} font-bold`:"hover:bg-sky-50/60"}`} onClick={()=>setEditing(isEd?null:{staffId:s.id,day:d})}>
                  {pref?SHIFT_SHORT[pref]:""}
                  {isEd&&(<div ref={ddRef} className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[56px]" onClick={e=>e.stopPropagation()}>
                    {selectable.map(opt=>(<button key={opt.key} onClick={()=>{if(prefCnt(s.id)>=5&&!getPref(s.id,d)){alert("月5件まで");return;}selectPref(s.id,d,opt.shift);}} className={`block w-full px-2 py-1.5 text-xs text-left hover:bg-sky-50 whitespace-nowrap transition ${pref===opt.shift?"font-bold bg-sky-50":""}`}><span className={`inline-block w-3 h-3 rounded mr-1 align-middle ${SHIFT_BG[opt.shift]}`}/>{opt.label}</button>))}
                    {pref&&(<button onClick={()=>clearPref(s.id,d)} className="block w-full px-2 py-1.5 text-xs text-left text-red-500 hover:bg-red-50 border-t border-gray-100 mt-0.5">取消</button>)}
                  </div>)}
                </td>);})}
              <td className="sticky right-0 z-20 bg-white border-b border-l border-gray-200 px-2 py-1 text-center font-medium text-gray-600">{prefCnt(s.id)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Shift Panel (with warnings + carryover + confirm) ━━━━━━━━━━━━━━ */
function ShiftPanel({staffList,assignments,setAssignments,year,month,enabledAssign,enabledDisplay,nightEnabled,onConfirm,isConfirmed,carryover,prevYM,prevConfirmed}:{
  staffList:Staff[];assignments:ShiftAssignment[];setAssignments:(a:ShiftAssignment[])=>void;
  year:number;month:number;enabledAssign:ShiftType[];enabledDisplay:ShiftType[];nightEnabled:boolean;
  onConfirm:()=>void;isConfirmed:boolean;carryover:Carryover;prevYM:string;prevConfirmed:ConfirmedData;
}){
  const numDays=new Date(year,month,0).getDate();
  const days=useMemo(()=>Array.from({length:numDays},(_,i)=>i+1),[numDays]);
  const mp=ym(year,month);
  const ds=(d:number)=>fmtDate(year,month,d);
  const [editing,setEditing]=useState<{staffId:string;day:number}|null>(null);
  const [showCarryover,setShowCarryover]=useState(false);
  const ddRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{const h=(e:MouseEvent)=>{if(ddRef.current&&!ddRef.current.contains(e.target as Node))setEditing(null);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);

  const aMap=useMemo(()=>{const m=new Map<string,ShiftAssignment>();for(const a of assignments){if(a.date.startsWith(mp))m.set(`${a.staffId}_${a.date}`,a);}return m;},[assignments,mp]);
  const getShift=(sid:string,d:number)=>aMap.get(`${sid}_${ds(d)}`)?.shift??null;
  const isManual=(sid:string,d:number)=>aMap.get(`${sid}_${ds(d)}`)?.manual===true;
  const selectShift=(sid:string,d:number,shift:ShiftType)=>{setAssignments(assignments.map(a=>a.staffId===sid&&a.date===ds(d)?{...a,shift,manual:true}:a));setEditing(null);};

  // Warnings
  const warnings=useMemo(()=>checkShift(staffList,assignments,year,month),[staffList,assignments,year,month]);

  // Night summary
  const nightSummary=useMemo(()=>days.map(d=>{const sn:string[]=[];const dn:string[]=[];for(const s of staffList){const sh=getShift(s.id,d);if(sh==="semi_night")sn.push(s.name);if(sh==="deep_night")dn.push(s.name);}return{semi:sn,deep:dn};}),[days,staffList,aMap]);

  // Stats
  const stats=useMemo(()=>staffList.map(s=>{const row:Record<string,number|string>={staffId:s.id,staffName:s.name};const sc:Record<string,number>={};for(const st of ASSIGNABLE_SHIFTS)sc[st]=0;for(const a of assignments){if(a.staffId===s.id&&a.date.startsWith(mp))sc[a.shift]=(sc[a.shift]||0)+1;}for(const st of enabledDisplay){row[st]=st==="night"?(sc.semi_night||0):(sc[st]||0);}row.off=sc.off||0;row._totalOff=(sc.off||0)+(sc.req_off||0)+(sc.annual||0);return row;}),[staffList,assignments,mp,enabledDisplay]);

  const dailyWorkers=useMemo(()=>days.map(d=>{let c=0;for(const s of staffList){const sh=getShift(s.id,d);if(sh&&WORK_SHIFTS.includes(sh))c++;}return c;}),[days,staffList,aMap]);

  const hasData=assignments.some(a=>a.date.startsWith(mp));
  if(!hasData) return (
    <div className="text-center py-12">
      <p className="text-gray-400 text-base mb-2">まだシフトが作成されていません</p>
      <p className="text-gray-400 text-xs">画面上部の「<span className="font-bold text-sky-600">シフトを自動作成</span>」ボタンを押すと、自動でシフトが組まれます</p>
    </div>
  );

  const statCols=enabledDisplay.filter(s=>s!=="off");
  const hasCarryover=Object.keys(carryover).length>0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-800">📅 シフト表 <span className="text-sm font-normal text-gray-400">({year}年{month}月)</span></h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">マスをクリックすると手直しできます</span>
          <button onClick={onConfirm} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${isConfirmed?"bg-emerald-100 text-emerald-700 border border-emerald-300":"bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md hover:shadow-lg active:scale-[0.97]"}`}>
            {isConfirmed?"✓ 確定済み":"このシフトで確定する"}
          </button>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length===0?(
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-sm text-emerald-700 font-medium">✓ チェック完了 — 特に気になる点はありません</div>
      ):(
        <div className="space-y-1 max-h-40 overflow-y-auto">
          <p className="text-xs text-gray-400 mb-1">以下の点を確認してみてください（必要に応じて手直しできます）</p>
          {warnings.map((w,i)=>(
            <div key={i} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${w.level==="error"?"bg-red-50 border border-red-200 text-red-700":"bg-amber-50 border border-amber-200 text-amber-700"}`}>
              {w.level==="error"?"⚠ 要確認: ":"💡 お知らせ: "} {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Carryover data */}
      {hasCarryover&&(
        <div className="border border-sky-200 rounded-lg overflow-hidden">
          <button onClick={()=>setShowCarryover(!showCarryover)} className="w-full flex items-center justify-between px-4 py-2 bg-sky-50/60 text-sky-700 text-sm font-medium hover:bg-sky-50 transition">
            <span>📋 前月からの引き継ぎ情報 ({prevYM}) — クリックで開閉</span>
            <svg className={`w-4 h-4 transition-transform ${showCarryover?"rotate-180":""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
          {showCarryover&&(
            <div className="px-4 py-3 bg-white text-xs overflow-x-auto">
              <table className="border-collapse w-full">
                <thead><tr className="bg-gray-50">
                  <th className="border-b border-gray-200 px-2 py-1 text-left">名前</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-center">前月夜勤</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-center">目標</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-center">調整</th>
                </tr></thead>
                <tbody>
                  {staffList.map(s=>{const pc=prevConfirmed[s.id];const adj=carryover[s.id];if(!pc&&!adj)return null;const nightAct=pc?.semi_night||0;const nightTgt=s.targets?.night||0;const nightAdj=adj?.night||0;return(
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="border-b border-gray-100 px-2 py-1 font-medium">{s.name}</td>
                      <td className="border-b border-gray-100 px-2 py-1 text-center">{nightAct}回</td>
                      <td className="border-b border-gray-100 px-2 py-1 text-center">{nightTgt}回</td>
                      <td className={`border-b border-gray-100 px-2 py-1 text-center font-bold ${nightAdj>0?"text-sky-600":nightAdj<0?"text-rose-600":"text-gray-400"}`}>{nightAdj>0?`+${nightAdj}`:nightAdj<0?String(nightAdj):"±0"}</td>
                    </tr>);})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-1.5">
        {enabledAssign.filter(s=>s!=="off"&&s!=="req_off").map(st=>(<Pill key={st} st={st}/>))}
        <Pill st="off"/><Pill st="req_off"/>
        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border border-dashed border-sky-400 text-sky-600">手動変更</span>
      </div>

      {/* Shift table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="text-[10px] sm:text-xs border-collapse w-max">
          <thead><tr>
            <th className="sticky left-0 z-20 bg-gray-50 border-b border-r border-gray-200 px-2 py-1.5 min-w-[40px] text-gray-600">名前</th>
            {days.map(d=>{const{cls,dow,holiday}=dayHeaderClass(year,month,d);return(
              <th key={d} className={`border-b border-gray-200 px-0.5 py-0.5 min-w-[28px] text-center ${cls}`}><div className="font-bold">{d}</div><div className="font-normal">{dow}</div>{holiday&&<div className="text-[6px] text-red-400">祝</div>}</th>);})}
          </tr></thead>
          <tbody>
            {staffList.map(s=>(<tr key={s.id} className="hover:bg-gray-50/30">
              <td className="sticky left-0 z-20 bg-white border-b border-r border-gray-200 px-2 py-1 font-medium whitespace-nowrap">{s.name}</td>
              {days.map(d=>{const shift=getShift(s.id,d);const manual=isManual(s.id,d);const isEd=editing?.staffId===s.id&&editing?.day===d;return(
                <td key={d} className={`border-b border-gray-100 px-0.5 py-0.5 text-center font-bold cursor-pointer relative select-none transition ${shift?`${SHIFT_BG[shift]} ${SHIFT_TEXT[shift]}`:""} ${manual?"border-b-2 border-b-sky-500 border-dashed":""}`}
                  onClick={()=>setEditing(isEd?null:{staffId:s.id,day:d})}>
                  {shift?SHIFT_SHORT[shift]:""}
                  {isEd&&(<div ref={ddRef} className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[56px]" onClick={e=>e.stopPropagation()}>
                    {enabledAssign.map(st=>(<button key={st} onClick={()=>selectShift(s.id,d,st)} className={`block w-full px-2 py-1.5 text-xs text-left hover:bg-sky-50 whitespace-nowrap transition ${shift===st?"font-bold bg-sky-50":""}`}><span className={`inline-block w-3 h-3 rounded mr-1 align-middle ${SHIFT_BG[st]}`}/>{SHIFT_LABELS[st]}</button>))}
                  </div>)}
                </td>);})}
            </tr>))}
            <tr className="font-bold">
              <td className="sticky left-0 z-20 bg-gray-100 border-t border-r border-gray-200 px-2 py-1.5 text-center text-gray-600 whitespace-nowrap">日勤帯</td>
              {dailyWorkers.map((c,i)=><td key={i} className="border-t border-gray-200 bg-gray-50 px-0.5 py-1.5 text-center text-gray-600">{c}</td>)}
            </tr>
            {nightEnabled&&(<>
              <tr><td className="sticky left-0 z-20 bg-indigo-50 border-b border-r border-gray-200 px-2 py-1 text-indigo-700 font-bold text-center whitespace-nowrap">準夜</td>
                {nightSummary.map((ns,i)=>(<td key={i} className="border-b border-gray-200 bg-indigo-50/50 px-0.5 py-0.5 text-center"><div className="flex flex-col items-center gap-0 leading-tight">{ns.semi.map((n,j)=><span key={j} className="text-indigo-700 text-[9px] whitespace-nowrap">{n.slice(0,2)}</span>)}</div></td>))}
              </tr>
              <tr><td className="sticky left-0 z-20 bg-violet-50 border-b border-r border-gray-200 px-2 py-1 text-violet-700 font-bold text-center whitespace-nowrap">深夜</td>
                {nightSummary.map((ns,i)=>(<td key={i} className="border-b border-gray-200 bg-violet-50/50 px-0.5 py-0.5 text-center"><div className="flex flex-col items-center gap-0 leading-tight">{ns.deep.map((n,j)=><span key={j} className="text-violet-700 text-[9px] whitespace-nowrap">{n.slice(0,2)}</span>)}</div></td>))}
              </tr>
            </>)}
          </tbody>
        </table>
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-base font-bold text-gray-800 mb-1">勤務回数のまとめ</h3>
        <p className="text-xs text-gray-400 mb-2">各スタッフの勤務回数を一覧で確認できます</p>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="text-xs sm:text-sm border-collapse w-full">
            <thead><tr className="bg-gradient-to-r from-gray-50 to-sky-50/30">
              <th className="border-b border-gray-200 px-3 py-2 text-left text-gray-600 sticky left-0 z-10 bg-gray-50">名前</th>
              {statCols.map(st=>(<th key={st} className="border-b border-gray-200 px-2 py-2 text-center"><Pill st={st}/></th>))}
              <th className="border-b border-gray-200 px-2 py-2 text-center"><Pill st="off"/></th>
              <th className="border-b border-gray-200 px-2 py-2 text-center text-gray-600 font-bold">休計</th>
            </tr></thead>
            <tbody>
              {stats.map(st=>(<tr key={st.staffId as string} className="hover:bg-sky-50/30 transition">
                <td className="border-b border-gray-100 px-3 py-1.5 font-medium sticky left-0 z-10 bg-white">{st.staffName as string}</td>
                {statCols.map(s=><td key={s} className="border-b border-gray-100 px-2 py-1.5 text-center">{(st[s] as number)||0}</td>)}
                <td className="border-b border-gray-100 px-2 py-1.5 text-center">{st.off as number}</td>
                <td className="border-b border-gray-100 px-2 py-1.5 text-center font-bold">{st._totalOff as number}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Monthly Report Panel ━━━━━━━━━━━━━━ */
function ReportPanel({staffList,confirmedMonths,enabledDisplay}:{staffList:Staff[];confirmedMonths:string[];enabledDisplay:ShiftType[];}){
  const [mode,setMode]=useState<"night"|"all">("night");
  const sorted=useMemo(()=>[...confirmedMonths].sort().slice(-12),[confirmedMonths]);

  // Load all confirmed data
  const allData=useMemo(()=>{
    const d:Record<string,ConfirmedData>={};
    for(const m of sorted)d[m]=loadConfirmed(m);
    return d;
  },[sorted]);

  if(sorted.length===0) return (
    <div className="text-center py-12">
      <p className="text-gray-400 text-base mb-2">📊 まだレポートに表示できるデータがありません</p>
      <p className="text-gray-400 text-xs">「📅シフト表」タブでシフトを確定すると、ここに月ごとの集計が表示されます</p>
    </div>
  );

  const nightCols=sorted;
  const allShiftTypes=enabledDisplay.filter(s=>s!=="off"&&s!=="req_off");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-800">📊 月間レポート <span className="text-sm font-normal text-gray-400">({sorted.length}ヶ月分)</span></h2>
        <div className="flex gap-1">
          <button onClick={()=>setMode("night")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${mode==="night"?"bg-indigo-100 text-indigo-700 border border-indigo-200":"bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"}`}>夜勤のみ</button>
          <button onClick={()=>setMode("all")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${mode==="all"?"bg-sky-100 text-sky-700 border border-sky-200":"bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"}`}>全勤務</button>
        </div>
      </div>

      {mode==="night"?(
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="text-xs sm:text-sm border-collapse w-full">
            <thead><tr className="bg-gradient-to-r from-gray-50 to-indigo-50/30">
              <th className="border-b border-gray-200 px-3 py-2 text-left text-gray-600 sticky left-0 z-10 bg-gray-50">名前</th>
              {nightCols.map(m=>(<th key={m} className="border-b border-gray-200 px-3 py-2 text-center text-gray-600">{m.replace(/^\d{4}-/,"").replace(/^0/,"")}月<br/><span className="text-[10px] text-gray-400">夜勤</span></th>))}
              <th className="border-b border-gray-200 px-3 py-2 text-center text-gray-700 font-bold">合計</th>
              <th className="border-b border-gray-200 px-3 py-2 text-center text-gray-700 font-bold">月平均</th>
            </tr></thead>
            <tbody>
              {staffList.map(s=>{
                const vals=nightCols.map(m=>allData[m]?.[s.id]?.semi_night||0);
                const total=vals.reduce((a,b)=>a+b,0);
                const avg=sorted.length>0?(total/sorted.length):0;
                const avgAll=staffList.length>0?staffList.reduce((a,st)=>{const v=nightCols.reduce((s2,m)=>s2+(allData[m]?.[st.id]?.semi_night||0),0);return a+v;},0)/staffList.length/sorted.length:0;
                const deviation=Math.abs(avg-avgAll);
                const highlight=deviation>=1.5;
                return(
                  <tr key={s.id} className={`transition ${highlight?"bg-amber-50/50":""}`}>
                    <td className="border-b border-gray-100 px-3 py-1.5 font-medium sticky left-0 z-10 bg-white">{s.name}</td>
                    {vals.map((v,i)=>(<td key={i} className={`border-b border-gray-100 px-3 py-1.5 text-center ${v===0?"text-gray-300":"text-indigo-700 font-medium"}`}>{v}</td>))}
                    <td className="border-b border-gray-100 px-3 py-1.5 text-center font-bold">{total}</td>
                    <td className={`border-b border-gray-100 px-3 py-1.5 text-center font-bold ${highlight?"text-amber-600":"text-gray-600"}`}>{avg.toFixed(1)}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
      ):(
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="text-xs border-collapse w-max">
            <thead><tr className="bg-gray-50">
              <th className="border-b border-gray-200 px-2 py-2 text-left text-gray-600 sticky left-0 z-10 bg-gray-50 min-w-[50px]">名前</th>
              {nightCols.map(m=>(
                <th key={m} colSpan={allShiftTypes.length} className="border-b border-l border-gray-200 px-1 py-1 text-center text-gray-600">{m.replace(/^\d{4}-/,"").replace(/^0/,"")}月</th>
              ))}
            </tr>
            <tr className="bg-gray-50">
              <th className="border-b border-gray-200 sticky left-0 z-10 bg-gray-50"></th>
              {nightCols.map(m=>allShiftTypes.map(st=>(
                <th key={`${m}-${st}`} className="border-b border-gray-200 px-1 py-1 text-center"><Pill st={st}/></th>
              )))}
            </tr></thead>
            <tbody>
              {staffList.map(s=>(<tr key={s.id} className="hover:bg-gray-50/30">
                <td className="border-b border-gray-100 px-2 py-1 font-medium sticky left-0 z-10 bg-white whitespace-nowrap">{s.name}</td>
                {nightCols.map(m=>allShiftTypes.map(st=>{
                  const val=st==="night"?(allData[m]?.[s.id]?.semi_night||0):(allData[m]?.[s.id]?.[st]||0);
                  return(<td key={`${m}-${st}`} className={`border-b border-gray-100 px-1 py-1 text-center ${val===0?"text-gray-300":"text-gray-700"}`}>{val}</td>);
                }))}
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
