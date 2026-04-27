"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Staff, ShiftPreference, ShiftAssignment, ShiftType, ShiftConfig,
  DailyRequirement, ShiftTargets, AttendancePattern, EmploymentType,
  ConfirmedData, Carryover, CustomShift, CUSTOM_SHIFT_PREFIX, isCustomShift,
  SHIFT_LABELS, SHIFT_SHORT, SHIFT_BG, SHIFT_TEXT, SHIFT_COLORS,
  ALL_SHIFTS, TOGGLEABLE_SHIFTS, ToggleableShift, TARGET_SHIFTS,
  ASSIGNABLE_SHIFTS, DEFAULT_CONFIG, DEFAULT_TARGETS, WORK_SHIFTS,
  ATTENDANCE_LABELS, EMPLOYMENT_LABELS, EMPLOYMENT_BADGE,
  getShiftLabel, getShiftShort, getShiftColors, getShiftBg, getShiftText,
  SkillLevel, SKILL_LEVEL_LABELS, SKILL_LEVEL_COLORS,
} from "@/lib/types";
import {
  loadStaff, saveStaff, loadPrefs, savePrefs,
  loadAssignments, saveAssignments, loadConfig, saveConfig,
  loadDailyReqs, saveDailyReqs,
  loadConfirmed, saveConfirmed, loadConfirmedMonths, saveConfirmedMonths,
  loadCustomShifts, saveCustomShifts,
} from "@/lib/storage";
import { generateShift, MAX_CONSECUTIVE } from "@/lib/scheduler";
import { getHolidayName } from "@/lib/holidays";
import { checkShift } from "@/lib/warnings";

type Tab = "staff"|"requirements"|"prefs"|"shift"|"report";
const DOW_NAMES=["日","月","火","水","木","金","土"];
const MAX_STAFF=100;

function fmtDate(y:number,m:number,d:number){return`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
function ym(y:number,m:number){return`${y}-${String(m).padStart(2,"0")}`;}
function prevYM(y:number,m:number):[number,number]{return m===1?[y-1,12]:[y,m-1];}

/* ━━━ Shared UI ━━━ */
const Pill = ({st,label,active=true,customs}:{st:string;label?:string;active?:boolean;customs?:CustomShift[]}) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${active?getShiftColors(st):"text-gray-400 border-gray-200 bg-gray-50"}`}>
    {label||getShiftLabel(st,customs)}
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
const PFX="sm6";
export default function Home() {
  const [tab, setTab] = useState<Tab>("staff");
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [prefs, setPrefs] = useState<ShiftPreference[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [config, setConfig] = useState<ShiftConfig>(DEFAULT_CONFIG);
  const [dailyReqs, setDailyReqs] = useState<Record<string,DailyRequirement>>({});
  const [confirmedMonths, setConfirmedMonths] = useState<string[]>([]);
  const [customShifts, setCustomShifts] = useState<CustomShift[]>([]);
  const [mounted, setMounted] = useState(false);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()+1);

  // 初心者モード（デフォルトON）+ ウィザードステップ (1-7)
  const [beginnerMode, setBeginnerMode] = useState(true);
  const [wizStep, setWizStep] = useState(1);

  useEffect(()=>{
    setStaffList(loadStaff()); setPrefs(loadPrefs());
    setAssignments(loadAssignments()); setConfig(loadConfig());
    setDailyReqs(loadDailyReqs()); setConfirmedMonths(loadConfirmedMonths());
    setCustomShifts(loadCustomShifts());
    const saved = localStorage.getItem(`${PFX}-beginner`);
    if(saved!==null) setBeginnerMode(JSON.parse(saved));
    else localStorage.setItem(`${PFX}-beginner`,"true"); // first visit: ON
    const savedStep = localStorage.getItem(`${PFX}-wizstep`);
    if(savedStep!==null) setWizStep(Number(savedStep));
    setMounted(true);
  },[]);

  useEffect(()=>{if(mounted)saveStaff(staffList);},[staffList,mounted]);
  useEffect(()=>{if(mounted)savePrefs(prefs);},[prefs,mounted]);
  useEffect(()=>{if(mounted)saveAssignments(assignments);},[assignments,mounted]);
  useEffect(()=>{if(mounted)saveConfig(config);},[config,mounted]);
  useEffect(()=>{if(mounted)saveDailyReqs(dailyReqs);},[dailyReqs,mounted]);
  useEffect(()=>{if(mounted)saveCustomShifts(customShifts);},[customShifts,mounted]);
  useEffect(()=>{if(mounted)localStorage.setItem(`${PFX}-beginner`,JSON.stringify(beginnerMode));},[beginnerMode,mounted]);
  useEffect(()=>{if(mounted)localStorage.setItem(`${PFX}-wizstep`,String(wizStep));},[wizStep,mounted]);

  // カスタム勤務含む有効勤務リスト
  const enabledCustomWork = useMemo(()=>customShifts.filter(cs=>cs.enabled&&cs.isWork),[customShifts]);
  const enabledWork = useMemo(()=>[
    ...WORK_SHIFTS.filter(s=>config.enabledShifts[s as ToggleableShift]),
    ...enabledCustomWork.map(cs=>cs.id as ShiftType),
  ],[config,enabledCustomWork]);
  const enabledTargets = useMemo(()=>[
    ...TARGET_SHIFTS.filter(s=>config.enabledShifts[s as ToggleableShift]),
    ...customShifts.filter(cs=>cs.enabled).map(cs=>cs.id as ShiftType),
  ],[config,customShifts]);
  const enabledAssign = useMemo(()=>{
    const r:ShiftType[]=[];
    for(const s of ASSIGNABLE_SHIFTS){
      if(s==="off"||s==="req_off"){r.push(s);continue;}
      if(s==="semi_night"||s==="deep_night"){if(config.enabledShifts.night)r.push(s);continue;}
      if(config.enabledShifts[s as ToggleableShift])r.push(s);
    }
    // カスタム勤務（有効なもの）
    for(const cs of customShifts){ if(cs.enabled) r.push(cs.id as ShiftType); }
    return r;
  },[config,customShifts]);
  const enabledDisplay = useMemo(()=>[
    ...ALL_SHIFTS.filter(s=>config.enabledShifts[s as ToggleableShift]),
    ...customShifts.filter(cs=>cs.enabled).map(cs=>cs.id as ShiftType),
    "req_off" as ShiftType,
  ],[config,customShifts]);

  const currentYM = ym(year,month);
  const [py,pm] = prevYM(year,month);
  const prevConfirmed = useMemo(()=>mounted?loadConfirmed(ym(py,pm)):{},[py,pm,mounted]);
  const carryover = useMemo(():Carryover=>{
    if(Object.keys(prevConfirmed).length===0)return {};
    const co:Carryover={};
    for(const s of staffList){
      const pc=prevConfirmed[s.id];if(!pc)continue;
      const adj:Record<string,number>={};
      const nightTarget=s.targets?.night||0;const nightActual=pc.semi_night||0;
      if(nightTarget-nightActual!==0) adj["night"]=nightTarget-nightActual;
      for(const st of TARGET_SHIFTS){if(st==="night")continue;const t=s.targets?.[st]||0;const a=pc[st]||0;if(t-a!==0)adj[st]=t-a;}
      if(Object.keys(adj).length>0) co[s.id]=adj;
    }
    return co;
  },[prevConfirmed,staffList]);

  const handleGenerate = useCallback(()=>{
    const co=Object.keys(carryover).length>0?carryover:undefined;
    const r = generateShift(year,month,staffList,prefs,config,dailyReqs,co,customShifts);
    setAssignments(r); setTab("shift");
    if(beginnerMode) setWizStep(7);
  },[year,month,staffList,prefs,config,dailyReqs,carryover,beginnerMode,customShifts]);

  const isConfirmed = confirmedMonths.includes(currentYM);

  const handleConfirm = useCallback(()=>{
    const cym=currentYM;const data:ConfirmedData={};
    for(const s of staffList){const counts:Record<string,number>={};for(const a of assignments){if(a.staffId===s.id&&a.date.startsWith(cym))counts[a.shift]=(counts[a.shift]||0)+1;}data[s.id]=counts;}
    saveConfirmed(cym,data);
    const newList=[...new Set([...confirmedMonths,cym])].sort();
    setConfirmedMonths(newList);saveConfirmedMonths(newList);
  },[assignments,staffList,currentYM,confirmedMonths]);

  // リセット
  const handleReset = useCallback(()=>{
    if(!confirm("すべてのデータを初期化します。\nスタッフ・シフト・設定がすべて消えます。\nよろしいですか？"))return;
    const keys:string[]=[];
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(PFX))keys.push(k);}
    keys.forEach(k=>localStorage.removeItem(k));
    setStaffList([]); setPrefs([]); setAssignments([]);
    setConfig(DEFAULT_CONFIG); setDailyReqs({}); setConfirmedMonths([]);
    setCustomShifts([]);
    setWizStep(1); setTab("staff"); setBeginnerMode(beginnerMode);
  },[beginnerMode]);

  // カスタム勤務削除時のクリーンアップ
  const handleDeleteCustomShift = useCallback((id:string)=>{
    setAssignments(prev=>prev.filter(a=>a.shift!==id));
    setPrefs(prev=>prev.filter(p=>p.shift!==id));
    setDailyReqs(prev=>{
      const next={...prev};
      for(const[date,req] of Object.entries(next)){
        if(req[id]!==undefined){const r={...req};delete r[id];next[date]=r;}
      }
      return next;
    });
  },[]);

  if(!mounted) return <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-sky-50 to-white"><p className="text-gray-400 text-lg">読み込み中...</p></div>;

  /* ── 状態判定 ── */
  const mp = ym(year,month);
  const hasStaff = staffList.length > 0;
  const hasAnyEnabled = TOGGLEABLE_SHIFTS.some(k=>config.enabledShifts[k]) || customShifts.some(cs=>cs.enabled);
  const hasPrefs = prefs.some(p=>p.date.startsWith(mp));
  const hasShiftData = assignments.some(a=>a.date.startsWith(mp));
  const canGenerate = hasStaff && hasAnyEnabled;

  /* ── 初心者モード: ウィザード進行ヘルパー ── */
  const BM = beginnerMode;
  const wizNext = (next:number,toTab?:Tab) => { setWizStep(next); if(toTab)setTab(toTab); };
  // ステップ名とその完了条件
  const WIZ_STEPS:{n:number;label:string;done:boolean}[] = [
    {n:1,label:"対象月を選ぶ",done:wizStep>1},
    {n:2,label:"勤務種類を選ぶ",done:wizStep>2},
    {n:3,label:"スタッフを登録",done:wizStep>3},
    {n:4,label:"必要人数を設定",done:wizStep>4},
    {n:5,label:"勤務希望を入力",done:wizStep>5},
    {n:6,label:"シフトを自動作成",done:wizStep>6},
    {n:7,label:"確認・手直し",done:false},
  ];

  // 初心者モード: タブロック判定
  // 到達済みかつ前提条件を満たしていればアクセス可能。未到達 or 前提崩れならロック
  const tabForStep:{[k:number]:Tab} = {3:"staff",4:"requirements",5:"prefs",6:"prefs",7:"shift"};
  const isTabLocked = (key:Tab):boolean => {
    if(!BM) return false;
    if(key==="staff") return wizStep<3 || !hasAnyEnabled;
    if(key==="requirements") return wizStep<4 || !hasStaff;
    if(key==="prefs") return wizStep<5 || !hasStaff;
    if(key==="shift") return wizStep<7 || !hasShiftData;
    if(key==="report") return wizStep<7 || !hasShiftData;
    return false;
  };
  const tabLockReason = (key:Tab):string => {
    if(!BM) return "";
    if(key==="staff"&&wizStep<3) return "先に対象月と勤務種類を選んでください";
    if(key==="staff"&&!hasAnyEnabled) return "使用する勤務種類を1つ以上選んでください";
    if(key==="requirements"&&wizStep<4) return "先にスタッフを登録してください";
    if(key==="requirements"&&!hasStaff) return "先にスタッフを登録してください";
    if(key==="prefs"&&wizStep<5) return "先に必要人数を設定してください";
    if(key==="prefs"&&!hasStaff) return "先にスタッフを登録してください";
    if(key==="shift"&&!hasShiftData) return "シフトを自動作成すると表示されます";
    if(key==="shift"&&wizStep<7) return "シフトを自動作成すると表示されます";
    if(key==="report"&&!hasShiftData) return "シフトを自動作成すると表示されます";
    if(key==="report"&&wizStep<7) return "シフトを自動作成すると表示されます";
    return "";
  };

  // ステップ強調用CSS
  const stepHighlight = (stepNum:number) => BM && wizStep===stepNum
    ? "ring-2 ring-rose-400 bg-rose-50/60 border-rose-300"
    : "";
  const stepDim = (stepNum:number) => BM && wizStep<stepNum
    ? "opacity-40 pointer-events-none"
    : "";

  // タブ定義 (wizStepEnd: そのタブがアクティブな最終ステップ)
  const tabDefs: {key:Tab;label:string;icon:string;wizStep?:number;wizStepEnd?:number}[] = [
    {key:"staff",label:"スタッフ登録",icon:"👤",wizStep:3},
    {key:"requirements",label:"必要人数設定",icon:"📋",wizStep:4},
    {key:"prefs",label:"勤務希望入力",icon:"✋",wizStep:5,wizStepEnd:6},
    {key:"shift",label:"シフト表",icon:"📅",wizStep:7},
    {key:"report",label:"月間レポート",icon:"📊"},
  ];

  const goTab = (key:Tab) => { if(!isTabLocked(key)) setTab(key); };

  /* ── 次へボタン共通 ── */
  function NextBtn({onClick,label,disabled:dis,sub}:{onClick:()=>void;label:string;disabled?:boolean;sub?:string}){
    return(
      <div className="relative z-10 mt-4 pt-4 border-t border-gray-200 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onClick} disabled={dis}
          className={`relative z-10 px-6 py-2.5 rounded-lg text-sm font-bold shadow-md transition-all active:scale-[0.97] ${
            dis?"bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"
              :"bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:shadow-lg hover:from-sky-600 hover:to-indigo-600 cursor-pointer"
          }`}>{label}</button>
        {sub&&<span className="text-xs text-gray-400">{sub}</span>}
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-3 sm:px-6 py-5 bg-gradient-to-b from-slate-50 to-orange-50/20 min-h-screen">
      {/* ── ヘッダー ── */}
      <header className="mb-4 bg-gradient-to-r from-white via-sky-50/60 to-indigo-50/40 rounded-2xl px-5 py-4 border border-sky-100 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-indigo-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md">S</div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800">シフトメーカー</h1>
              <p className="text-xs text-gray-400">看護師シフト自動作成ツール</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* 初心者モードトグル */}
            <div className="flex flex-col items-end gap-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-xs text-gray-500 hidden sm:inline">初心者モード</span>
                <button type="button" onClick={()=>{setBeginnerMode(!beginnerMode);if(!beginnerMode)setWizStep(1);}}
                  className={`relative w-10 h-5 rounded-full transition-colors ${beginnerMode?"bg-rose-400":"bg-gray-300"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${beginnerMode?"translate-x-5":"translate-x-0.5"}`}/>
                </button>
                <span className="text-xs text-gray-500 sm:hidden">{beginnerMode?"初心者":"通常"}</span>
              </label>
              <span className="text-[9px] text-gray-400 hidden sm:block">{beginnerMode?"ステップ順に案内します":"すべての機能に自由にアクセスできます"}</span>
            </div>
            {/* リセットボタン */}
            <button type="button" onClick={handleReset} className="text-xs text-gray-400 hover:text-rose-500 border border-gray-200 hover:border-rose-300 rounded-lg px-2.5 py-1.5 transition-all" title="すべてのデータを初期化">
              リセット
            </button>
          </div>
        </div>

        {/* 初心者モード: ステップ進捗バー（到達済みステップはクリック可能） */}
        {BM&&(
          <div className="mb-3 flex items-center gap-0.5 overflow-x-auto text-[10px]">
            {WIZ_STEPS.map(s=>{
              const reachable=s.n<=wizStep;
              const stepTab:{[k:number]:Tab|null}={1:null,2:null,3:"staff",4:"requirements",5:"prefs",6:"prefs",7:"shift"};
              const onClick=reachable?()=>{const t=stepTab[s.n];if(t)setTab(t);}:undefined;
              return(
              <div key={s.n} className="flex items-center gap-0.5">
                {s.n>1&&<span className="text-gray-300">›</span>}
                <span onClick={onClick} className={`whitespace-nowrap px-1.5 py-0.5 rounded-full font-medium ${
                  wizStep===s.n?"bg-rose-100 text-rose-700 font-bold":s.done?"text-emerald-600 cursor-pointer hover:underline":"text-gray-400"
                }`}>{s.done?"✓":s.n}. {s.label}</span>
              </div>);
            })}
          </div>
        )}

        {/* ① 対象月を選ぶ */}
        <div className={`flex flex-wrap items-center gap-3 mb-2 rounded-lg px-3 py-2 -mx-1 transition-all ${stepHighlight(1)} ${BM&&wizStep>1?"":"" }`}>
          <span className="text-gray-500 font-medium text-xs">{BM?"① ":""}対象月:</span>
          <select value={year} onChange={e=>setYear(Number(e.target.value))} className={`border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-sky-200 outline-none ${stepDim(0)}`} disabled={BM&&wizStep>6}>
            {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={e=>setMonth(Number(e.target.value))} className={`border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-sky-200 outline-none ${stepDim(0)}`} disabled={BM&&wizStep>6}>
            {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{m}月</option>)}
          </select>
          {isConfirmed&&<span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">✓ 確定済み</span>}
          {BM&&wizStep===1&&(
            <button type="button" onClick={()=>wizNext(2)} className="bg-rose-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow hover:bg-rose-600 active:scale-[0.97] transition-all cursor-pointer">
              {year}年{month}月で決定 → 次へ
            </button>
          )}
        </div>

        {/* ② 使用する勤務種類を選ぶ */}
        <div className={`rounded-lg px-3 py-2 -mx-1 transition-all ${stepHighlight(2)} ${stepDim(2)}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="text-gray-500 font-medium text-xs">{BM?"② ":""}使用する勤務種類:</span>
            {TOGGLEABLE_SHIFTS.map(key=>(
              <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none group">
                <button type="button" onClick={()=>setConfig({...config,enabledShifts:{...config.enabledShifts,[key]:!config.enabledShifts[key]}})}
                  disabled={BM&&wizStep<2}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${config.enabledShifts[key]?"bg-sky-500 border-sky-500 text-white shadow-sm":"border-gray-300 bg-white group-hover:border-sky-300"}`}>
                  {config.enabledShifts[key]&&<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                </button>
                <Pill st={key} active={config.enabledShifts[key]}/>
              </label>
            ))}
            {/* カスタム勤務トグル */}
            {customShifts.map(cs=>(
              <label key={cs.id} className="flex items-center gap-1.5 cursor-pointer select-none group">
                <button type="button" onClick={()=>{const next=customShifts.map(c=>c.id===cs.id?{...c,enabled:!c.enabled}:c);setCustomShifts(next);setConfig({...config,enabledShifts:{...config.enabledShifts,[cs.id]:!cs.enabled}});}}
                  disabled={BM&&wizStep<2}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${cs.enabled?"bg-teal-500 border-teal-500 text-white shadow-sm":"border-gray-300 bg-white group-hover:border-teal-300"}`}>
                  {cs.enabled&&<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                </button>
                <Pill st={cs.id} label={cs.name} active={cs.enabled} customs={customShifts}/>
              </label>
            ))}
          </div>
          {/* 夜勤ONの場合: 準夜・深夜の説明を追加 */}
          {config.enabledShifts.night&&(
            <p className="mt-1.5 text-[10px] text-indigo-500 bg-indigo-50 border border-indigo-100 rounded px-2 py-1 inline-block">
              夜勤は「準夜」と「深夜」に分かれます（準夜→深夜→休みの3日セット）。必要人数はステップ④で設定します。
            </p>
          )}
          {/* カスタム勤務 追加/管理 */}
          <CustomShiftManager customShifts={customShifts} setCustomShifts={setCustomShifts} config={config} setConfig={setConfig} disabled={BM&&wizStep<2} onDelete={handleDeleteCustomShift}/>
          {BM&&wizStep===2&&(
            <button type="button" onClick={()=>{if(hasAnyEnabled)wizNext(3,"staff");}} disabled={!hasAnyEnabled}
              className={`mt-2 text-xs font-bold px-4 py-1.5 rounded-lg shadow active:scale-[0.97] transition-all ${hasAnyEnabled?"bg-rose-500 text-white hover:bg-rose-600 cursor-pointer":"bg-gray-200 text-gray-400 cursor-not-allowed"}`}>
              決定 → 次へ
            </button>
          )}
        </div>
      </header>

      {/* ── タブ ── */}
      <div className="relative z-0 flex gap-0.5 mb-4 border-b border-gray-200/80 overflow-x-auto">
        {tabDefs.map(td=>{const locked=isTabLocked(td.key);const reason=tabLockReason(td.key);const isCurrentWiz=BM&&td.wizStep!==undefined&&wizStep>=td.wizStep&&wizStep<=(td.wizStepEnd??td.wizStep);return(
          <button key={td.key}
            onClick={()=>goTab(td.key)}
            disabled={locked}
            title={locked?reason:""}
            className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all rounded-t-lg ${
              locked
                ?"border-transparent text-gray-300 cursor-not-allowed bg-gray-50/50"
                :tab===td.key
                  ?isCurrentWiz
                    ?"border-rose-400 text-rose-700 bg-rose-50/60"
                    :"border-sky-500 text-sky-700 bg-sky-50/60"
                  :"border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}>
            <span className="mr-1">{td.icon}</span>
            {BM&&td.wizStep?`${td.wizStep}. `:""}{td.label}
            {locked&&<span className="ml-1 text-gray-300">🔒</span>}
            {isCurrentWiz&&tab===td.key&&<span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full animate-pulse"/>}
          </button>
        );})}
      </div>

      {/* ── タブコンテンツ ── */}
      <div className={`relative bg-white/90 rounded-xl border p-4 shadow-sm transition-all ${BM&&tab===tabForStep[wizStep]?"border-rose-300 ring-1 ring-rose-200":"border-gray-200/80"}`}>
        {tab==="staff"&&(
          <>
            <StaffPanel staffList={staffList} setStaffList={setStaffList} enabledTargets={enabledTargets} customShifts={customShifts}/>
            {/* 通常モード: 常に次へ表示 / 初心者モード: step3到達済みなら表示 */}
            {hasStaff&&(!BM||wizStep>=3)&&(
              <NextBtn onClick={()=>{if(BM){if(wizStep<4)wizNext(4,"requirements");else setTab("requirements");}else setTab("requirements");}}
                label="次へ → 必要人数設定" sub={`スタッフ${staffList.length}名を登録済み`}/>
            )}
          </>
        )}
        {tab==="requirements"&&(
          <>
            <ReqPanel year={year} month={month} dailyReqs={dailyReqs} setDailyReqs={setDailyReqs} enabledWork={enabledWork} nightEnabled={config.enabledShifts.night} customShifts={customShifts}/>
            {(!BM||wizStep>=4)&&(
              <NextBtn onClick={()=>{if(BM){if(wizStep<5)wizNext(5,"prefs");else setTab("prefs");}else setTab("prefs");}} label="次へ → 勤務希望入力"/>
            )}
          </>
        )}
        {tab==="prefs"&&(
          <>
            <PrefsPanel staffList={staffList} prefs={prefs} setPrefs={setPrefs} year={year} month={month} enabledDisplay={enabledDisplay} nightEnabled={config.enabledShifts.night} customShifts={customShifts}/>
            {/* 初心者モード step5+: 次へ or 生成 */}
            {BM&&wizStep>=5&&(
              <div className="relative z-10 mt-4 pt-4 border-t border-gray-200 space-y-3">
                {wizStep===5&&(
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={()=>wizNext(6)} className="relative z-10 bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-md hover:shadow-lg active:scale-[0.97] transition-all cursor-pointer">
                      次へ → シフト自動作成
                    </button>
                    <button type="button" onClick={()=>wizNext(6)} className="relative z-10 text-xs text-gray-400 hover:text-gray-600 underline cursor-pointer">希望を入力せず次へ進む</button>
                  </div>
                )}
                {wizStep>=6&&(
                  <div className={`rounded-xl p-4 ${stepHighlight(6)}`}>
                    {wizStep===6&&<p className="text-sm font-bold text-rose-700 mb-3">⑥ すべての設定が完了しました。シフトを自動作成しましょう！</p>}
                    <button type="button" onClick={handleGenerate}
                      className="relative z-10 px-8 py-3 rounded-xl text-base font-bold shadow-md bg-gradient-to-r from-rose-500 to-pink-500 text-white hover:shadow-xl hover:from-rose-600 hover:to-pink-600 active:scale-[0.97] transition-all cursor-pointer">
                      ⚡ シフトを自動作成{hasShiftData?" (再作成)":""}
                    </button>
                    {hasShiftData&&<p className="text-xs text-gray-400 mt-1">※ 再度作成すると現在のシフト表は上書きされます</p>}
                  </div>
                )}
              </div>
            )}
            {/* 通常モード: 従来通り */}
            {!BM&&(
              <div className="relative z-10 mt-4 pt-4 border-t border-gray-200 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={handleGenerate} disabled={!canGenerate}
                    className={`relative z-10 px-8 py-3 rounded-xl text-base font-bold shadow-md transition-all active:scale-[0.97] ${
                      canGenerate?"bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:shadow-lg hover:from-sky-600 hover:to-indigo-600 cursor-pointer":"bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"
                    }`}>
                    ⚡ シフトを自動作成
                  </button>
                  {!canGenerate&&!hasStaff&&<span className="text-xs text-gray-400">← スタッフを登録してください</span>}
                  {!canGenerate&&hasStaff&&!hasAnyEnabled&&<span className="text-xs text-gray-400">← 使用する勤務種類を1つ以上選んでください</span>}
                  {canGenerate&&hasShiftData&&<span className="text-xs text-gray-400">※ 再度作成すると現在のシフト表は上書きされます</span>}
                </div>
                {canGenerate&&!hasPrefs&&<p className="text-xs text-gray-400">※ 勤務希望を入れなくてもシフトは作成できます</p>}
              </div>
            )}
          </>
        )}
        {tab==="shift"&&<ShiftPanel staffList={staffList} assignments={assignments} setAssignments={setAssignments} year={year} month={month} enabledAssign={enabledAssign} enabledDisplay={enabledDisplay} nightEnabled={config.enabledShifts.night} onConfirm={handleConfirm} isConfirmed={isConfirmed} carryover={carryover} prevYM={ym(py,pm)} prevConfirmed={prevConfirmed} customShifts={customShifts}/>}
        {tab==="report"&&<ReportPanel staffList={staffList} confirmedMonths={confirmedMonths} enabledDisplay={enabledDisplay} customShifts={customShifts}/>}
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Staff Panel ━━━━━━━━━━━━━━ */
function StaffPanel({staffList,setStaffList,enabledTargets,customShifts}:{staffList:Staff[];setStaffList:(s:Staff[])=>void;enabledTargets:ShiftType[];customShifts:CustomShift[];}){
  const [newName,setNewName]=useState("");
  const [expanded,setExpanded]=useState<string|null>(null);
  const [showBulk,setShowBulk]=useState(false);
  const [bulkOff,setBulkOff]=useState(10);
  const [bulkTargets,setBulkTargets]=useState<ShiftTargets>({...DEFAULT_TARGETS});

  const [staffError,setStaffError]=useState("");
  const addStaff=()=>{const name=newName.trim();if(!name)return;if(staffList.length>=MAX_STAFF){setStaffError(`上限${MAX_STAFF}人です`);return;}setStaffError("");setStaffList([...staffList,{id:String(Date.now()),name,monthlyOffDays:10,targets:{...DEFAULT_TARGETS},attendance:"full",customDays:[true,true,true,true,true,true,true],employment:"fulltime",skillLevel:"mid" as SkillLevel,experienceYears:0,canLead:false}]);setNewName("");};
  const update=(id:string,patch:Partial<Staff>)=>setStaffList(staffList.map(s=>s.id===id?{...s,...patch}:s));
  const applyBulk=()=>{setStaffList(staffList.map(s=>({...s,monthlyOffDays:bulkOff,targets:{...bulkTargets}})));setShowBulk(false);};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">👤 スタッフ一覧 <span className="text-sm font-normal text-gray-400">({staffList.length}/{MAX_STAFF})</span></h2>
        <button type="button" onClick={()=>setShowBulk(!showBulk)} className="bg-gray-50 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-50 hover:text-sky-700 border border-gray-200 transition-all">まとめて設定</button>
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
            {enabledTargets.map(st=>(<div key={st} className="flex items-center gap-1"><Pill st={st} customs={customShifts}/><input type="number" min={0} max={30} value={bulkTargets[st]||0} onChange={e=>setBulkTargets({...bulkTargets,[st]:Number(e.target.value)})} className="border border-gray-200 rounded-lg px-1 py-1 w-12 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/><span className="text-gray-400 text-xs">回</span></div>))}
          </div>
          <button type="button" onClick={applyBulk} className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg active:scale-[0.97] transition-all">全員に適用</button>
        </div>
      )}
      <div className="space-y-1.5 max-h-[65vh] overflow-y-auto">
        {staffList.length===0&&(
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-gray-400 text-sm mb-1">まだスタッフが登録されていません</p>
            <p className="text-gray-400 text-xs">下の入力欄にお名前を入力して「追加」ボタンを押してください</p>
          </div>
        )}
        {staffList.map((s,idx)=>{const badge=EMPLOYMENT_BADGE[s.employment||"fulltime"];const sl=(s.skillLevel||"mid") as SkillLevel;return(
          <div key={s.id} className="border border-gray-200 rounded-lg overflow-hidden hover:border-sky-200 transition-colors">
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gradient-to-r hover:from-white hover:to-sky-50/40 transition-all" onClick={()=>setExpanded(expanded===s.id?null:s.id)}>
              <span className="text-xs text-gray-400 w-6 text-right font-medium">{idx+1}</span>
              <input value={s.name} onChange={e=>{e.stopPropagation();update(s.id,{name:e.target.value});}} onClick={e=>e.stopPropagation()} className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-20 font-medium focus:ring-2 focus:ring-sky-200 outline-none"/>
              <Badge text={SKILL_LEVEL_LABELS[sl]} color={SKILL_LEVEL_COLORS[sl]}/>
              {badge&&<Badge text={badge} color={s.employment==="part"?"bg-lime-100 text-lime-700":"bg-orange-100 text-orange-700"}/>}
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <span className="hidden sm:inline text-gray-400">月間休日数</span><span className="sm:hidden text-gray-400">休</span>
                <input type="number" min={0} max={28} value={s.monthlyOffDays} onChange={e=>{e.stopPropagation();update(s.id,{monthlyOffDays:Math.max(0,Math.min(28,Number(e.target.value)))});}} onClick={e=>e.stopPropagation()} className="border border-gray-200 rounded px-1 py-0.5 w-10 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/><span>日</span>
              </div>
              <svg className={`ml-auto w-4 h-4 text-gray-400 transition-transform ${expanded===s.id?"rotate-180":""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
              <button type="button" onClick={e=>{e.stopPropagation();setStaffList(staffList.filter(st=>st.id!==s.id));}} className="text-gray-300 hover:text-red-500 text-sm ml-1 transition">✕</button>
            </div>
            {expanded===s.id&&(
              <div className="px-4 py-3 bg-gradient-to-b from-gray-50 to-white border-t border-gray-100 space-y-4">
                <div><p className="text-xs text-gray-500 mb-2 font-medium">月間目標回数</p>
                  <div className="flex flex-wrap gap-2">{enabledTargets.map(st=>(<div key={st} className="flex items-center gap-1"><Pill st={st} customs={customShifts}/><input type="number" min={0} max={30} value={s.targets[st]||0} onChange={e=>update(s.id,{targets:{...s.targets,[st]:Number(e.target.value)}})} className="border border-gray-200 rounded px-1 py-0.5 w-12 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/><span className="text-gray-400 text-xs">回</span></div>))}</div>
                  {enabledTargets.includes("night")&&(
                    <p className="mt-1.5 text-[10px] text-indigo-500 leading-relaxed bg-indigo-50 border border-indigo-100 rounded px-2 py-1">
                      💡 夜勤目標回数はバランス調整の目安です。実際に夜勤を生成するには、次の「📋 必要人数設定」で準夜・深夜の人数（1以上）を設定してください。
                    </p>
                  )}
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
                    <div className="flex items-center gap-2"><span className="text-gray-600 text-xs">スキルレベル</span>
                      <select value={s.skillLevel||"mid"} onChange={e=>update(s.id,{skillLevel:e.target.value as SkillLevel})} className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:ring-2 focus:ring-sky-200 outline-none">
                        {(Object.keys(SKILL_LEVEL_LABELS) as SkillLevel[]).map(k=><option key={k} value={k}>{SKILL_LEVEL_LABELS[k]}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-2"><span className="text-gray-600 text-xs">経験年数</span>
                      <input type="number" min={0} max={50} value={s.experienceYears??0} onChange={e=>update(s.id,{experienceYears:Math.max(0,Math.min(50,Number(e.target.value)))})} className="border border-gray-200 rounded-lg px-2 py-1 w-14 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/>
                      <span className="text-gray-400 text-xs">年</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <button type="button" onClick={()=>update(s.id,{canLead:!s.canLead})} className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${s.canLead?"bg-purple-500 border-purple-500 text-white":"border-gray-300 bg-white"}`}>
                          {s.canLead&&<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                        </button>
                        <span className="text-gray-600 text-xs">リーダー可</span>
                      </label>
                    </div>
                  </div>
                  {/* P0-2: スキル制約の実装状況を明示 */}
                  <p className="mt-2 text-[10px] text-gray-400 bg-gray-50 border border-gray-100 rounded px-2 py-1 leading-relaxed">
                    ℹ スキルレベル・経験年数・リーダー可否は表示・管理用です。夜勤の「新人のみ禁止」チェックは警告として機能します。夜勤スキル構成のハード制約（特定組み合わせの強制など）は現時点で未実装です。
                  </p>
                  {(s.attendance||"full")==="custom"&&(
                    <div className="flex items-center gap-2 mt-2 text-xs"><span className="text-gray-500">出勤可能曜日:</span>
                      {DOW_NAMES.map((dn,i)=>(<label key={i} className="flex items-center gap-0.5 cursor-pointer select-none">
                        <button type="button" onClick={()=>{const cd=[...(s.customDays||[true,true,true,true,true,true,true])];cd[i]=!cd[i];update(s.id,{customDays:cd});}} className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${(s.customDays||[])[i]?"bg-sky-500 border-sky-500 text-white":"border-gray-300 bg-white"}`}>
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
      <div className="flex items-center gap-2 pt-2 flex-wrap">
        <input value={newName} onChange={e=>{setNewName(e.target.value);setStaffError("");}} onKeyDown={e=>e.key==="Enter"&&addStaff()} placeholder="例: 山田 花子" className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-36 focus:ring-2 focus:ring-sky-200 outline-none"/>
        <button type="button" onClick={addStaff} className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg active:scale-[0.97] transition-all">追加</button>
        {staffError&&<span className="text-xs text-red-500 font-medium">{staffError}</span>}
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Requirements Panel ━━━━━━━━━━━━━━ */
function ReqPanel({year,month,dailyReqs,setDailyReqs,enabledWork,nightEnabled,customShifts}:{year:number;month:number;dailyReqs:Record<string,DailyRequirement>;setDailyReqs:(r:Record<string,DailyRequirement>)=>void;enabledWork:ShiftType[];nightEnabled:boolean;customShifts:CustomShift[];}){
  const numDays=new Date(year,month,0).getDate();
  const days=Array.from({length:numDays},(_,i)=>i+1);
  const ds=(d:number)=>fmtDate(year,month,d);
  const getReq=(d:number):DailyRequirement=>{const k=ds(d);return dailyReqs[k]||{};};
  const setReq=(d:number,st:ShiftType,val:number)=>{const k=ds(d);setDailyReqs({...dailyReqs,[k]:{...getReq(d),[st]:val}});};
  const nonNightWork=enabledWork.filter(s=>s!=="night");

  // サンプル入力: 日勤5名・夜勤2セット/日を全日に適用
  const [sampleDay,setSampleDay]=useState(5);
  const [sampleNight,setSampleNight]=useState(2);
  const applySample=()=>{
    const next:Record<string,DailyRequirement>={};
    for(let d=1;d<=numDays;d++){
      const k=ds(d);
      next[k]={...getReq(d)};
      if(sampleDay>0)next[k].day=sampleDay;
      if(nightEnabled&&sampleNight>0)next[k].night=sampleNight;
    }
    setDailyReqs({...dailyReqs,...next});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-800">📋 必要人数設定 <span className="text-sm font-normal text-gray-400">({year}年{month}月)</span></h2>
        <button type="button" onClick={()=>setDailyReqs({})} className="bg-gray-50 text-gray-500 border border-gray-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all">初期値に戻す</button>
      </div>

      {/* ── 重要: 0のままだと勤務が生成されない旨の警告 ── */}
      <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 space-y-1.5">
        <p className="text-sm font-bold text-amber-800">⚠ 重要: 必要人数が 0 のままの勤務は自動配置されません</p>
        <p className="text-xs text-amber-700 leading-relaxed">
          ここで設定した人数をもとに、各日の勤務者が割り当てられます。<br/>
          <span className="font-semibold">たとえば夜勤を作成したい場合は、「準夜」の行に 1 以上の数字を入力してください。</span><br/>
          スタッフごとの「夜勤目標回数」だけでは夜勤は自動配置されません。<br/>
          準夜・深夜はセットで動き、両行は同じ値（夜勤セット数）で設定されます。
        </p>
      </div>

      {/* ── P1-5: サンプル入力 / 全日一括設定 ── */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
        <p className="text-xs font-bold text-sky-800 mb-2">🚀 全日に同じ人数を一括設定</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600 text-xs">日勤</span>
            <input type="number" min={0} max={99} value={sampleDay} onChange={e=>setSampleDay(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1 w-14 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/>
            <span className="text-gray-400 text-xs">名</span>
          </div>
          {nightEnabled&&(
            <div className="flex items-center gap-1.5">
              <span className="text-gray-600 text-xs">夜勤（セット数）</span>
              <input type="number" min={0} max={99} value={sampleNight} onChange={e=>setSampleNight(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1 w-14 text-center text-sm focus:ring-2 focus:ring-sky-200 outline-none"/>
              <span className="text-gray-400 text-xs">組</span>
            </div>
          )}
          <button type="button" onClick={applySample} className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow hover:shadow-md active:scale-[0.97] transition-all">
            全日に適用
          </button>
        </div>
        <p className="text-[10px] text-sky-600 mt-1.5">※ 既存の入力値を上書きします。個別に調整したい日は適用後に直接編集してください。</p>
      </div>

      <p className="text-xs text-gray-400">各セルを直接編集して日別の人数を調整できます。</p>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="text-xs sm:text-sm border-collapse w-max">
          <thead><tr>
            <th className="sticky left-0 z-10 bg-gray-50 border-b border-r border-gray-200 px-2 py-2 min-w-[72px] text-gray-600 text-left">勤務</th>
            {days.map(d=>{const{cls,dow,holiday}=dayHeaderClass(year,month,d);return(
              <th key={d} className={`border-b border-gray-200 px-1 py-1 min-w-[36px] text-center ${cls}`}>
                <div className="font-bold">{d}</div><div className="font-normal text-[10px]">{dow}</div>
                {holiday&&<div className="text-[7px] text-red-400 truncate max-w-[34px] leading-tight" title={holiday}>{holiday.slice(0,3)}</div>}
              </th>);})}
          </tr></thead>
          <tbody>
            {nonNightWork.map(st=>(<tr key={st} className="hover:bg-gray-50/30">
              <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-2 py-1"><Pill st={st} customs={customShifts}/></td>
              {days.map(d=>(<td key={d} className="border-b border-gray-100 px-0 py-0">
                <input type="number" min={0} max={99} value={getReq(d)[st]||0} onChange={e=>setReq(d,st,Number(e.target.value))} className="w-full px-1 py-1.5 text-center text-sm bg-transparent hover:bg-gray-50 focus:bg-sky-50 outline-none transition"/>
              </td>))}
            </tr>))}
            {nightEnabled&&(<>
              <tr className="hover:bg-indigo-50/20">
                <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-2 py-1 whitespace-nowrap">
                  <div className="flex items-center gap-1"><Pill st="semi_night"/><span className="text-[9px] text-gray-400">＊</span></div>
                </td>
                {days.map(d=>(<td key={d} className="border-b border-gray-100 px-0 py-0"><input type="number" min={0} max={99} value={getReq(d).night||0} onChange={e=>setReq(d,"night",Number(e.target.value))} className="w-full px-1 py-1.5 text-center text-sm bg-transparent hover:bg-indigo-50 focus:bg-indigo-50 outline-none transition"/></td>))}
              </tr>
              <tr className="hover:bg-violet-50/20">
                <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-2 py-1 whitespace-nowrap">
                  <div className="flex items-center gap-1"><Pill st="deep_night"/><span className="text-[9px] text-gray-400">＊</span></div>
                </td>
                {days.map(d=>(<td key={d} className="border-b border-gray-100 px-0 py-0"><input type="number" min={0} max={99} value={getReq(d).night||0} onChange={e=>setReq(d,"night",Number(e.target.value))} className="w-full px-1 py-1.5 text-center text-sm bg-transparent hover:bg-violet-50 focus:bg-violet-50 outline-none transition"/></td>))}
              </tr>
              <tr><td colSpan={days.length+1} className="px-2 py-1 bg-indigo-50/30 text-[10px] text-indigo-600 italic">
                ＊ 準夜・深夜は「1夜勤セット = 準夜1名 + 深夜1名」の組数で入力してください。両行は連動しています。
              </td></tr>
            </>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━ Preferences Panel ━━━━━━━━━━━━━━ */
function PrefsPanel({staffList,prefs,setPrefs,year,month,enabledDisplay,nightEnabled,customShifts}:{staffList:Staff[];prefs:ShiftPreference[];setPrefs:(p:ShiftPreference[])=>void;year:number;month:number;enabledDisplay:ShiftType[];nightEnabled:boolean;customShifts:CustomShift[];}){
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
  const selectable=useMemo(()=>{const r:SO[]=[];for(const s of enabledDisplay.filter(s=>s!=="req_off")){if(s==="night"){if(nightEnabled){r.push({key:"sn",shift:"night",label:"準夜"});r.push({key:"dn",shift:"night",label:"深夜"});}}else{r.push({key:s,shift:s,label:getShiftLabel(s,customShifts)});}}return r;},[enabledDisplay,nightEnabled,customShifts]);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-gray-800">✋ 勤務希望入力 <span className="text-sm font-normal text-gray-400">({year}年{month}月)</span></h2>
      <p className="text-xs text-gray-400">スタッフの希望勤務を入力します。表のマスをクリックすると勤務種類を選べます（1人あたり月10件まで）。</p>
      {staffList.length===0&&(
        <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-gray-400 text-sm">先に「👤スタッフ登録」タブでスタッフを登録してください</p>
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
                <td key={d} className={`border-b border-gray-100 px-0.5 py-0.5 text-center cursor-pointer select-none relative transition ${pref?`${getShiftBg(pref)} ${getShiftText(pref)} font-bold`:"hover:bg-sky-50/60"}`} onClick={()=>setEditing(isEd?null:{staffId:s.id,day:d})}>
                  {pref?getShiftShort(pref,customShifts):""}
                  {isEd&&(<div ref={ddRef} className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[56px]" onClick={e=>e.stopPropagation()}>
                    {selectable.map(opt=>{const atLimit=prefCnt(s.id)>=10&&!getPref(s.id,d);return(<button key={opt.key} onClick={()=>{if(atLimit)return;selectPref(s.id,d,opt.shift);}} className={`block w-full px-2 py-1.5 text-xs text-left whitespace-nowrap transition ${atLimit?"text-gray-300 cursor-not-allowed":pref===opt.shift?"font-bold bg-sky-50":"hover:bg-sky-50"}`} disabled={atLimit}><span className={`inline-block w-3 h-3 rounded mr-1 align-middle ${getShiftBg(opt.shift)}`}/>{opt.label}</button>);})}
                    {pref&&(<button type="button" onClick={()=>clearPref(s.id,d)} className="block w-full px-2 py-1.5 text-xs text-left text-red-500 hover:bg-red-50 border-t border-gray-100 mt-0.5">取消</button>)}
                    {prefCnt(s.id)>=10&&!pref&&<p className="px-2 py-1 text-[10px] text-orange-500 border-t border-gray-100 mt-0.5">月10件まで</p>}
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
function ShiftPanel({staffList,assignments,setAssignments,year,month,enabledAssign,enabledDisplay,nightEnabled,onConfirm,isConfirmed,carryover,prevYM,prevConfirmed,customShifts}:{
  staffList:Staff[];assignments:ShiftAssignment[];setAssignments:(a:ShiftAssignment[])=>void;
  year:number;month:number;enabledAssign:ShiftType[];enabledDisplay:ShiftType[];nightEnabled:boolean;
  onConfirm:()=>void;isConfirmed:boolean;carryover:Carryover;prevYM:string;prevConfirmed:ConfirmedData;customShifts:CustomShift[];
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
  // P1-5: Toast state for manual-edit violations
  const [editToast,setEditToast]=useState<{msg:string;level:"error"|"warn"}|null>(null);

  const selectShift=(sid:string,d:number,shift:ShiftType)=>{
    const newAssignments=assignments.map(a=>a.staffId===sid&&a.date===ds(d)?{...a,shift,manual:true}:a);
    setAssignments(newAssignments);
    setEditing(null);
    // 手動編集後: 対象スタッフの違反を即時チェックしてトースト表示
    const staffName=staffList.find(s=>s.id===sid)?.name||"";
    const newWarns=checkShift(staffList,newAssignments,year,month,customShifts)
      .filter(w=>w.message.includes(staffName));
    if(newWarns.length>0){
      const top=newWarns.find(w=>w.level==="error")||newWarns[0];
      setEditToast({msg:top.message,level:top.level});
      setTimeout(()=>setEditToast(null),5000);
    }
  };

  // Warnings
  const warnings=useMemo(()=>checkShift(staffList,assignments,year,month,customShifts),[staffList,assignments,year,month,customShifts]);

  // Night summary
  const nightSummary=useMemo(()=>days.map(d=>{const sn:string[]=[];const dn:string[]=[];for(const s of staffList){const sh=getShift(s.id,d);if(sh==="semi_night")sn.push(s.name);if(sh==="deep_night")dn.push(s.name);}return{semi:sn,deep:dn};}),[days,staffList,aMap]);

  // Stats
  const stats=useMemo(()=>staffList.map(s=>{const row:Record<string,number|string>={staffId:s.id,staffName:s.name};const sc:Record<string,number>={};for(const st of ASSIGNABLE_SHIFTS)sc[st]=0;for(const a of assignments){if(a.staffId===s.id&&a.date.startsWith(mp))sc[a.shift]=(sc[a.shift]||0)+1;}for(const st of enabledDisplay){row[st]=st==="night"?(sc.semi_night||0):(sc[st]||0);}row.off=sc.off||0;row._totalOff=(sc.off||0)+(sc.req_off||0)+(sc.annual||0);return row;}),[staffList,assignments,mp,enabledDisplay]);

  const customWorkIds=useMemo(()=>customShifts.filter(cs=>cs.isWork).map(cs=>cs.id),[customShifts]);
  const dailyWorkers=useMemo(()=>days.map(d=>{let c=0;for(const s of staffList){const sh=getShift(s.id,d);if(sh&&(WORK_SHIFTS.includes(sh)||customWorkIds.includes(sh)))c++;}return c;}),[days,staffList,aMap,customWorkIds]);

  const hasData=assignments.some(a=>a.date.startsWith(mp));
  if(!hasData) return (
    <div className="text-center py-12">
      <p className="text-gray-400 text-base mb-2">まだシフトが作成されていません</p>
      <p className="text-gray-400 text-xs">「✋勤務希望入力」タブを開き、下部の「<span className="font-bold text-sky-600">⚡ シフトを自動作成</span>」ボタンを押すと、自動でシフトが組まれます</p>
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
          <button type="button" onClick={onConfirm} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${isConfirmed?"bg-emerald-100 text-emerald-700 border border-emerald-300":"bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md hover:shadow-lg active:scale-[0.97]"}`}>
            {isConfirmed?"✓ 確定済み":"このシフトで確定する"}
          </button>
        </div>
      </div>

      {/* P1-5: 手動編集トースト */}
      {editToast&&(
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl px-4 py-3 shadow-lg border text-sm font-medium animate-pulse
          ${editToast.level==="error"?"bg-red-50 border-red-300 text-red-700":"bg-amber-50 border-amber-300 text-amber-700"}`}>
          {editToast.level==="error"?"⚠ 手動編集による要確認: ":"💡 手動編集の注意: "}{editToast.msg}
          <button type="button" onClick={()=>setEditToast(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* P0-1: 構造化チェック結果 */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {/* ヘッダー */}
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">🔍 自動チェック結果</span>
          {warnings.filter(w=>w.level==="error").length===0
            ?<span className="text-xs text-emerald-600 font-medium">要確認項目なし</span>
            :<span className="text-xs text-red-600 font-bold">要確認 {warnings.filter(w=>w.level==="error").length}件</span>
          }
        </div>

        {/* 発見された問題 */}
        {warnings.length>0&&(
          <div className="px-4 py-2 space-y-1 max-h-36 overflow-y-auto border-b border-gray-100">
            <p className="text-[10px] text-gray-400 mb-1">手直しが必要な可能性のある項目：</p>
            {warnings.map((w,i)=>(
              <div key={i} className={`rounded px-2 py-1 text-xs font-medium ${w.level==="error"?"bg-red-50 border border-red-200 text-red-700":"bg-amber-50 border border-amber-100 text-amber-700"}`}>
                {w.level==="error"?"⚠ ":"💡 "}{w.message}
              </div>
            ))}
          </div>
        )}

        {/* 確認済み / 未確認の明示 */}
        <div className="grid grid-cols-2 divide-x divide-gray-100">
          <div className="px-3 py-2">
            <p className="text-[10px] font-bold text-emerald-700 mb-1">✅ 確認済み項目</p>
            <ul className="text-[10px] text-gray-600 space-y-0.5">
              <li>• 最大連続勤務（上限 {MAX_CONSECUTIVE} 日）</li>
              <li>• 深夜明け翌日日勤禁止</li>
              <li>• 深夜→休み→勤務パターン</li>
              <li>• 準夜→深夜セット整合</li>
              <li>• 夜勤回数（目標との差異）</li>
              <li>• 夜勤の新人のみ構成</li>
            </ul>
          </div>
          <div className="px-3 py-2">
            <p className="text-[10px] font-bold text-gray-500 mb-1">⚪ 未確認（手動でご確認ください）</p>
            <ul className="text-[10px] text-gray-400 space-y-0.5">
              <li>• スキルバランスのハード制約</li>
              <li>• ペア制約・同日同勤務禁止</li>
              <li>• 曜日・特定日の固定割当</li>
              <li>• 詳細なインターバル規則</li>
              <li>• 連休確保</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Carryover data */}
      {hasCarryover&&(
        <div className="border border-sky-200 rounded-lg overflow-hidden">
          <button type="button" onClick={()=>setShowCarryover(!showCarryover)} className="w-full flex items-center justify-between px-4 py-2 bg-sky-50/60 text-sky-700 text-sm font-medium hover:bg-sky-50 transition">
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
        {enabledAssign.filter(s=>s!=="off"&&s!=="req_off").map(st=>(<Pill key={st} st={st} customs={customShifts}/>))}
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
                <td key={d} className={`border-b border-gray-100 px-0.5 py-0.5 text-center font-bold cursor-pointer relative select-none transition ${shift?`${getShiftBg(shift)} ${getShiftText(shift)}`:""} ${manual?"border-b-2 border-b-sky-500 border-dashed":""}`}
                  onClick={()=>setEditing(isEd?null:{staffId:s.id,day:d})}>
                  {shift?getShiftShort(shift,customShifts):""}
                  {isEd&&(<div ref={ddRef} className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[56px]" onClick={e=>e.stopPropagation()}>
                    {enabledAssign.map(st=>(<button key={st} onClick={()=>selectShift(s.id,d,st)} className={`block w-full px-2 py-1.5 text-xs text-left hover:bg-sky-50 whitespace-nowrap transition ${shift===st?"font-bold bg-sky-50":""}`}><span className={`inline-block w-3 h-3 rounded mr-1 align-middle ${getShiftBg(st)}`}/>{getShiftLabel(st,customShifts)}</button>))}
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

      {/* P2-6: 未対応制約の注意書き */}
      <details className="border border-gray-200 rounded-lg">
        <summary className="px-4 py-2 text-xs text-gray-500 cursor-pointer hover:bg-gray-50 font-medium select-none">
          ℹ このツールで現在対応していない制約（クリックで展開）
        </summary>
        <div className="px-4 py-3 bg-gray-50/60 text-[11px] text-gray-500 space-y-1 border-t border-gray-100">
          <p className="font-bold text-gray-600 mb-1.5">以下の制約は現在このツールでは未対応です。確定前に手動でご確認ください。</p>
          <p>• ペア制約（AさんとBさんを同じシフトにしない、など）</p>
          <p>• 特定日・特定スタッフの固定割当（Cさんを5日のリーダーに固定、など）</p>
          <p>• 曜日制限（特定スタッフを土曜日勤に入れない、など）</p>
          <p>• 連休確保（3連休以上のブロック確保）</p>
          <p>• 夜勤スキル構成のハード制約（リーダー必須の夜勤セットなど）</p>
          <p>• 月をまたぐインターバル（前月末深夜→翌月1日早番など）</p>
          <p className="mt-1.5 text-gray-400">これらは将来バージョンで対応予定です。現段階はプロトタイプとしてご利用ください。</p>
        </div>
      </details>

      {/* Stats */}
      <div>
        <h3 className="text-base font-bold text-gray-800 mb-1">勤務回数のまとめ</h3>
        <p className="text-xs text-gray-400 mb-2">各スタッフの勤務回数を一覧で確認できます</p>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="text-xs sm:text-sm border-collapse w-full">
            <thead><tr className="bg-gradient-to-r from-gray-50 to-sky-50/30">
              <th className="border-b border-gray-200 px-3 py-2 text-left text-gray-600 sticky left-0 z-10 bg-gray-50">名前</th>
              {statCols.map(st=>(<th key={st} className="border-b border-gray-200 px-2 py-2 text-center"><Pill st={st} customs={customShifts}/></th>))}
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
function ReportPanel({staffList,confirmedMonths,enabledDisplay,customShifts}:{staffList:Staff[];confirmedMonths:string[];enabledDisplay:ShiftType[];customShifts:CustomShift[];}){
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
          <button type="button" onClick={()=>setMode("night")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${mode==="night"?"bg-indigo-100 text-indigo-700 border border-indigo-200":"bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"}`}>夜勤のみ</button>
          <button type="button" onClick={()=>setMode("all")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${mode==="all"?"bg-sky-100 text-sky-700 border border-sky-200":"bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"}`}>全勤務</button>
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
                <th key={`${m}-${st}`} className="border-b border-gray-200 px-1 py-1 text-center"><Pill st={st} customs={customShifts}/></th>
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

/* ━━━━━━━━━━━━━━ Custom Shift Manager ━━━━━━━━━━━━━━ */
function CustomShiftManager({customShifts,setCustomShifts,config,setConfig,disabled,onDelete}:{
  customShifts:CustomShift[];setCustomShifts:(cs:CustomShift[])=>void;
  config:ShiftConfig;setConfig:(c:ShiftConfig)=>void;disabled:boolean;onDelete?:(id:string)=>void;
}){
  const [open,setOpen]=useState(false);
  const [editId,setEditId]=useState<string|null>(null);
  const [name,setName]=useState("");
  const [shortName,setShortName]=useState("");
  const [isWork,setIsWork]=useState(true);
  const [formError,setFormError]=useState("");

  const resetForm=()=>{setName("");setShortName("");setIsWork(true);setEditId(null);setFormError("");};

  const addOrUpdate=()=>{
    const n=name.trim();
    if(!n){setFormError("名前を入力してください");return;}
    if(n.length>10){setFormError("名前は10文字以内にしてください");return;}
    const sn=shortName.trim()||n.charAt(0);
    // 重複チェック（編集中の自分自身は除く）
    const dup=customShifts.find(cs=>cs.name===n&&cs.id!==editId);
    if(dup){setFormError(`「${n}」はすでに追加されています`);return;}
    setFormError("");
    if(editId){
      setCustomShifts(customShifts.map(cs=>cs.id===editId?{...cs,name:n,shortName:sn,isWork}:cs));
      resetForm();
    }else{
      const id=`${CUSTOM_SHIFT_PREFIX}${Date.now()}`;
      const cs:CustomShift={id,name:n,shortName:sn,enabled:true,isWork};
      setCustomShifts([...customShifts,cs]);
      setConfig({...config,enabledShifts:{...config.enabledShifts,[id]:true}});
      resetForm();
    }
  };
  const startEdit=(cs:CustomShift)=>{setEditId(cs.id);setName(cs.name);setShortName(cs.shortName);setIsWork(cs.isWork);};
  const remove=(id:string)=>{
    if(!confirm("この勤務種類を削除しますか？\n※ シフト表や勤務希望に含まれるデータも一緒に削除されます"))return;
    setCustomShifts(customShifts.filter(cs=>cs.id!==id));
    const en={...config.enabledShifts};delete en[id];
    setConfig({...config,enabledShifts:en});
    onDelete?.(id);
  };

  if(disabled) return null;

  return(
    <div className="mt-2">
      <button type="button" onClick={()=>{setOpen(!open);resetForm();}}
        className="text-xs text-teal-600 hover:text-teal-800 font-medium transition cursor-pointer">
        {open?"▾ 閉じる":"＋ 勤務種類を追加・管理"}
      </button>
      {open&&(
        <div className="mt-2 bg-teal-50/50 border border-teal-200 rounded-lg p-3 space-y-3">
          {/* 追加/編集フォーム */}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">名前（10文字以内）</label>
              <input value={name} onChange={e=>{setName(e.target.value.slice(0,10));setFormError("");}} placeholder="例: 夜勤補助" maxLength={10}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-36 focus:ring-2 focus:ring-teal-200 outline-none"/>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">略称（シフト表に表示）</label>
              <input value={shortName} onChange={e=>setShortName(e.target.value.slice(0,2))} placeholder="例: 補" maxLength={2}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-14 text-center focus:ring-2 focus:ring-teal-200 outline-none"/>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none" title="ONにすると日勤帯の勤務者としてカウントされます">
              <input type="checkbox" checked={isWork} onChange={e=>setIsWork(e.target.checked)} className="rounded"/>
              勤務扱い
            </label>
            <button type="button" onClick={addOrUpdate}
              className="bg-teal-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-teal-600 active:scale-[0.97] transition-all cursor-pointer shadow-sm">
              {editId?"更新":"追加"}
            </button>
            {editId&&<button type="button" onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">キャンセル</button>}
          </div>
          {formError&&<p className="text-xs text-red-500 font-medium -mt-1">{formError}</p>}
          {/* 一覧 */}
          {customShifts.length>0&&(
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500 font-medium">追加済みの勤務種類:</p>
              {customShifts.map(cs=>(
                <div key={cs.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-gray-100 min-w-0">
                  <span className={`shrink-0 inline-block w-6 h-6 rounded text-center text-sm font-bold leading-6 ${getShiftBg(cs.id)} ${getShiftText(cs.id)}`}>{cs.shortName}</span>
                  <span className="text-sm font-medium text-gray-700 flex-1 truncate">{cs.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{cs.isWork?"勤務":"非勤務"}</span>
                  <button type="button" onClick={()=>startEdit(cs)} className="shrink-0 text-xs text-sky-500 hover:text-sky-700 cursor-pointer">編集</button>
                  <button type="button" onClick={()=>remove(cs.id)} className="shrink-0 text-xs text-red-400 hover:text-red-600 cursor-pointer">削除</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
