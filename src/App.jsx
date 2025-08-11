import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";

// ===== Error Boundary (so we never hang on init) =====
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error){ return { hasError: true, error }; }
  componentDidCatch(error, info){ console.error("Clientwatch crash:", error, info); }
  render(){
    if(this.state.hasError){
      return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
          <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
          <pre className="whitespace-pre-wrap text-sm text-red-300 bg-neutral-900 p-3 rounded border border-red-700">{String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ===== CONFIG =====
const XP_PER_SUBRANK = 500;
const SUBRANKS = 5; // 5 -> 1 as you advance

// Overwatch-style tier names
const TIERS = [
  { key: "bronze", name: "Bronze", subtitle: "Division", color: "#cd7f32" },
  { key: "silver", name: "Silver", subtitle: "Division", color: "#c0c0c0" },
  { key: "gold", name: "Gold", subtitle: "Division", color: "#ffd700" },
  { key: "platinum", name: "Platinum", subtitle: "Division", color: "#00bfff" },
  { key: "diamond", name: "Diamond", subtitle: "Division", color: "#b9f2ff" },
  { key: "master", name: "Master", subtitle: "Division", color: "#800080" },
  { key: "grandmaster", name: "Grandmaster", subtitle: "Division", color: "#ff4500" },
  { key: "top500", name: "Top 500", subtitle: "Elite", color: "#ff6bd6" }
];

const DEFAULT_TASKS = [
  { id: "close", label: "Close a new client", xp: 50, group: "Sales" },
  { id: "project", label: "Complete a client project", xp: 30, group: "Delivery" },
  { id: "campaign", label: "Launch a new marketing campaign", xp: 40, group: "Marketing" },
  { id: "newsletter", label: "Send an email newsletter", xp: 10, group: "Marketing" },
  { id: "network", label: "Attend a networking event / BNI", xp: 20, group: "Networking" },
  { id: "content", label: "Post consistent social content for 1 week", xp: 15, group: "Marketing" },
  { id: "automation", label: "Implement a new system/automation", xp: 25, group: "Ops" }
];

// Daily challenge pool
const DAILY_POOL = [
  { id: "dc1", label: "Send 3 personalized outreach messages", xp: 35 },
  { id: "dc2", label: "Reply to all client emails before noon", xp: 25 },
  { id: "dc3", label: "Post one value-packed IG story", xp: 20 },
  { id: "dc4", label: "Write 150 words for a blog", xp: 20 },
  { id: "dc5", label: "Record a 60s Loom tip", xp: 25 },
  { id: "dc6", label: "Improve one portfolio page CTA", xp: 30 },
  { id: "dc7", label: "Add one case study bullet/metric", xp: 20 },
  { id: "dc8", label: "Optimize one GBP field/photo", xp: 25 },
  { id: "dc9", label: "Clean up one process in Notion", xp: 20 },
  { id: "dc10", label: "Follow up with 2 warm leads", xp: 35 },
  { id: "dc11", label: "Comment meaningfully on 3 local biz posts", xp: 20 },
  { id: "dc12", label: "Sketch a hero section variation", xp: 25 }
];

// ===== Helpers & Math =====
const tierTotalXP = () => XP_PER_SUBRANK * SUBRANKS; // per-tier span
const cumulativeXPAtTierStart = (i) => i * tierTotalXP();
const maxXPAllTiers = cumulativeXPAtTierStart(TIERS.length);

function xpToRank(xp) {
  let n = Math.max(0, Math.min(xp, maxXPAllTiers));
  let tierIndex = 0;
  while (tierIndex < TIERS.length && n >= cumulativeXPAtTierStart(tierIndex) + tierTotalXP()) tierIndex++;
  if (tierIndex >= TIERS.length) {
    return { tierIndex: TIERS.length - 1, subrank: 1, withinXP: XP_PER_SUBRANK * SUBRANKS, progress: 1, progressWithinSubrank: 1 };
  }
  const start = cumulativeXPAtTierStart(tierIndex);
  const withinTier = n - start;
  const subrankProgress = withinTier / XP_PER_SUBRANK; // 0..SUBRANKS
  const subrank = Math.max(1, SUBRANKS - Math.floor(subrankProgress)); // 5..1
  const progressWithinSubrank = (withinTier % XP_PER_SUBRANK) / XP_PER_SUBRANK; // 0..1
  const progress = withinTier / tierTotalXP(); // 0..1
  return { tierIndex, subrank, withinXP: withinTier, progress, progressWithinSubrank };
}

function formatNumber(n){ return (n ?? 0).toLocaleString(); }
function todayKey(){ const d = new Date(); return d.toISOString().slice(0,10); } // YYYY-MM-DD
function pickN(arr, n){ const copy = [...arr]; const out=[]; while(out.length<n && copy.length){ const i = Math.floor(Math.random()*copy.length); out.push(copy.splice(i,1)[0]); } return out; }

// ===== Persistence (localStorage) =====
const STORAGE_KEY = "clientwatch-local-v1";
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---- Firebase (shared doc, no auth) ----
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDn4HV6Y1NFlBY1xnQR2KceGAcIK26E52Y",
  authDomain: "clientwatch-a241c.firebaseapp.com",
  projectId: "clientwatch-a241c",
  storageBucket: "clientwatch-a241c.firebasestorage.app",
  messagingSenderId: "176782767425",
  appId: "1:176782767425:web:56c00f6779847af2fc9dc0",
  measurementId: "G-G02PQ8LQKT"
};
function usePersistentState(key, initial){
  const [state, setState] = useState(() => {
    try{
      const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : initial;
    }catch{ return initial; }
  });
  useEffect(() => {
    try{ if(typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(state)); }catch{}
  }, [key, state]);
  return [state, setState];
}

// ===== UI pieces =====
function Progress({ value, color }){
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="h-3 w-full rounded-full bg-neutral-800 overflow-hidden border border-neutral-700">
      <div className="h-full rounded-full" style={{ width: pct + "%", background: color }} />
    </div>
  );
}

function TierBadge({ tier, url, size = 48 }){
  if (url) return <img src={url} alt={`${tier.name} icon`} className="shrink-0" style={{ width: size, height: size }} />;
  // SVG placeholder (original; not Blizzard IP)
  const s = size; const stroke = "#fff";
  switch(tier.key){
    case "bronze": return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-label={`${tier.name} icon`}>
        <circle cx="24" cy="24" r="20" fill={tier.color} stroke={stroke} strokeWidth="2" />
        <polygon points="24,14 27,21 34,21 28,25 31,32 24,28 17,32 20,25 14,21 21,21" fill="#2a1a0f" opacity="0.6" />
      </svg>
    );
    case "silver": return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <polygon points="24,6 39,15 39,33 24,42 9,33 9,15" fill={tier.color} stroke={stroke} strokeWidth="2" />
      </svg>
    );
    case "gold": return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <path d="M8 18 L24 6 L40 18 V34 L24 42 L8 34 Z" fill={tier.color} stroke={stroke} strokeWidth="2" />
        <path d="M16 24 L32 24" stroke="#7a5b00" strokeWidth="2" opacity="0.6" />
      </svg>
    );
    case "platinum": return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <polygon points="24,6 38,24 24,42 10,24" fill={tier.color} stroke={stroke} strokeWidth="2" />
        <polygon points="24,12 33,24 24,36 15,24" fill="#0e2a33" opacity="0.5" />
      </svg>
    );
    case "diamond": return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <polygon points="12,18 24,6 36,18 24,42" fill={tier.color} stroke={stroke} strokeWidth="2" />
        <polyline points="12,18 24,30 36,18" fill="none" stroke="#0b2630" strokeWidth="2" opacity="0.6" />
      </svg>
    );
    case "master": return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <path d="M8 22 L16 16 L24 22 L32 16 L40 22 V36 H8 Z" fill={tier.color} stroke={stroke} strokeWidth="2" />
        <path d="M18 16 L24 10 L30 16" stroke={stroke} strokeWidth="2" fill="none" />
      </svg>
    );
    case "grandmaster": return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill={tier.color} stroke={stroke} strokeWidth="2" />
        <path d="M12 34 C16 28, 32 28, 36 34" stroke="#2a0d00" strokeWidth="3" fill="none" opacity="0.6" />
        <polygon points="24,12 26,17 32,17 27,20 29,25 24,22 19,25 21,20 16,17 22,17" fill="#2a0d00" opacity="0.6" />
      </svg>
    );
    case "top500": return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <path d="M12 42 L24 6 L36 42 Z" fill={tier.color} stroke={stroke} strokeWidth="2" />
        <text x="24" y="33" textAnchor="middle" fontSize="12" fill="#1a0d17" fontWeight="700">500</text>
      </svg>
    );
    default: return <div style={{ width: s, height: s, background: tier.color, borderRadius: 9999 }} />;
  }
}

function TaskEditor({ tasks, setTasks }){
  const [label, setLabel] = useState("");
  const [xp, setXPVal] = useState(10);
  const [group, setGroup] = useState("");
  const addTask = () => {
    if (!label.trim()) return;
    setTasks([...tasks, { id: String(Date.now()), label: label.trim(), xp: Math.max(1, Number(xp) || 1), group: group.trim() || undefined }]);
    setLabel(""); setXPVal(10); setGroup("");
  };
  const removeTask = (id) => setTasks(tasks.filter(t => t.id !== id));
  return (
    <div>
      <div className="grid md:grid-cols-4 gap-3 mt-3">
        <input className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700" placeholder="Task label (e.g., Publish a blog post)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700" placeholder="Group (optional)" value={group} onChange={(e) => setGroup(e.target.value)} />
        <input type="number" className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700" placeholder="XP" value={xp} onChange={(e) => setXPVal(parseInt(e.target.value || "0", 10))} />
        <button onClick={addTask} className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">Add Task</button>
      </div>
      <ul className="mt-4 grid md:grid-cols-2 gap-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-950/60 border border-neutral-800">
            <div>
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-neutral-400">{t.group || "No group"} • {t.xp} XP</div>
            </div>
            <button onClick={() => removeTask(t.id)} className="text-sm px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}


// ===== Main App =====
function TrackerInner(){
  // persisted states
  const [xp, setXP] = usePersistentState(`${STORAGE_KEY}:xp`, 0);
  const [tasks, setTasks] = usePersistentState(`${STORAGE_KEY}:tasks`, DEFAULT_TASKS);
    const [customXP, setCustomXP] = useState("");
  const [daily, setDaily] = usePersistentState(`${STORAGE_KEY}:daily`, { date: todayKey(), items: [] });
  const [top, setTop] = usePersistentState(`${STORAGE_KEY}:top`, { date: todayKey(), items: [] });
  const [todos, setTodos] = usePersistentState(`${STORAGE_KEY}:todos`, { items: [] });

  // Cloud sync (shared doc)
  const [cloudStatus, setCloudStatus] = useState("disconnected");
  const fb = React.useRef({ app: null, db: null, unsub: null, lastSaved: "", applying: false });
  const saveTimer = React.useRef(null);

  // ensure we have today's challenges
  useEffect(() => {
    const tk = todayKey();
    if (daily.date !== tk || !Array.isArray(daily.items) || daily.items.length === 0) {
      const picks = pickN(DAILY_POOL, 3).map((d) => ({ ...d, done: false }));
      setDaily({ date: tk, items: picks });
    }
  }, []); // run once on mount

  // init Firebase + subscribe to shared doc once
  useEffect(() => {
    try {
      setCloudStatus("connecting");
      const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
      const db = getFirestore(app);
      fb.current.app = app; fb.current.db = db;
      const ref = doc(db, "shared", "clientwatch");
      fb.current.unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        // prevent write feedback loop
        fb.current.applying = true;
        if (typeof data.xp === 'number' && data.xp !== xp) setXP(data.xp);
        if (Array.isArray(data.tasks)) setTasks(data.tasks);
        if (data.daily && data.daily.items) setDaily(data.daily);
        if (data.top && data.top.items) setTop(data.top);
        if (data.todos && data.todos.items) setTodos(data.todos);
        // remember last saved snapshot shape
        const simple = JSON.stringify({
          xp: data.xp ?? 0,
          tasks: data.tasks ?? [],
          daily: data.daily ?? { date: todayKey(), items: [] },
          top: data.top ?? { date: todayKey(), items: [] },
          todos: data.todos ?? { items: [] }
        });
        fb.current.lastSaved = simple;
        setCloudStatus("connected");
        // release applying flag shortly after state settles
        setTimeout(() => { fb.current.applying = false; }, 0);
      });
    } catch (e) {
      console.error(e);
      setCloudStatus("error: " + (e?.message || e));
    }
    return () => { if (fb.current.unsub) fb.current.unsub(); };
  }, []);

  // ensure we have today's Top Tasks container
  useEffect(() => {
    const tk = todayKey();
    if (top.date !== tk) setTop({ date: tk, items: [] });
  }, []);

  const rank = useMemo(() => xpToRank(xp), [xp]);
  const tier = TIERS[rank.tierIndex];
  const tierStartXP = cumulativeXPAtTierStart(rank.tierIndex);
  const tierEndXP = tierStartXP + tierTotalXP();
  const xpIntoSubrank = (rank.withinXP ?? 0) % XP_PER_SUBRANK;

  const addXP = (amount) => setXP((v) => Math.max(0, Math.min(v + amount, maxXPAllTiers)));
  const setXPExact = (val) => setXP(Math.max(0, Math.min(val, maxXPAllTiers)));
  const resetSeason = () => setXP(0);
  const handleCustomAdd = () => { const n = parseInt(customXP, 10); if(!isNaN(n)) addXP(n); setCustomXP(""); };

  const progressPercent = Math.round((rank.progress ?? 0) * 100);
  const subrankPercent = Math.round((rank.progressWithinSubrank ?? 0) * 100);

  // group tasks
  const groupedTasks = useMemo(() => {
    return tasks.reduce((acc, t) => { const g = t.group || "Other"; (acc[g] ||= []).push(t); return acc; }, {});
  }, [tasks]);

  // daily helpers
  const dailyCompleted = daily.items.filter((d) => d.done).length;
  const completeDaily = (id) => {
    setDaily((prev) => {
      const items = prev.items.map((d) => d.id === id ? { ...d, done: true } : d);
      const justCompleted = prev.items.find((d) => d.id === id && !d.done);
      if (justCompleted) addXP(justCompleted.xp);
      return { ...prev, items };
    });
  };
  const rerollDaily = (id) => {
    setDaily((prev) => {
      const poolLeft = DAILY_POOL.filter((p) => !prev.items.some((i) => i.id === p.id));
      const replacement = pickN(poolLeft.length ? poolLeft : DAILY_POOL, 1)[0];
      const items = prev.items.map((d) => d.id === id ? { ...replacement, done: false } : d);
      return { ...prev, items };
    });
  };
  const refreshToday = () => setDaily({ date: todayKey(), items: pickN(DAILY_POOL, 3).map((d) => ({ ...d, done: false })) });
  // Top Tasks (Today)
  const topCompleted = top.items.filter((t) => t.done).length;
  const addTopFromTask = (taskId) => {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    setTop(prev => {
      if (prev.items.length >= 5) return prev;
      if (prev.items.some(i => i.srcId === t.id && i.label === t.label)) return prev; // prevent dup
      const item = { id: uid(), srcId: t.id, label: t.label, xp: t.xp, done: false };
      return { ...prev, items: [...prev.items, item] };
    });
  };
  const addTopCustom = (label, xpVal) => {
    if (!label?.trim()) return;
    const n = Math.max(1, parseInt(xpVal, 10) || 1);
    setTop(prev => {
      if (prev.items.length >= 5) return prev;
      return { ...prev, items: [...prev.items, { id: uid(), label: label.trim(), xp: n, done: false }] };
    });
  };
  const toggleTop = (id) => {
    setTop(prev => {
      const before = prev.items.find(i => i.id === id);
      const items = prev.items.map(i => i.id === id ? { ...i, done: !i.done } : i);
      if (before && !before.done) addXP(before.xp);
      return { ...prev, items };
    });
  };
  const removeTop = (id) => setTop(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) }));
  const moveTop = (id, dir) => setTop(prev => {
    const idx = prev.items.findIndex(i => i.id === id);
    if (idx === -1) return prev;
    const ni = idx + (dir === 'up' ? -1 : 1);
    if (ni < 0 || ni >= prev.items.length) return prev;
    const arr = [...prev.items];
    const [it] = arr.splice(idx,1);
    arr.splice(ni,0,it);
    return { ...prev, items: arr };
  });
  const refreshTopToday = () => setTop({ date: todayKey(), items: [] });

  // ===== Simple Todo List (no XP) =====
  const addTodo = (label) => {
    if (!label?.trim()) return;
    setTodos(prev => ({ items: [...prev.items, { id: uid(), label: label.trim(), done: false }] }));
  };
  const toggleTodo = (id) => setTodos(prev => ({ items: prev.items.map(t => t.id === id ? { ...t, done: !t.done } : t) }));
  const removeTodo = (id) => setTodos(prev => ({ items: prev.items.filter(t => t.id !== id) }));
  const moveTodo = (id, dir) => setTodos(prev => {
    const idx = prev.items.findIndex(t => t.id === id);
    if (idx === -1) return prev;
    const ni = idx + (dir === 'up' ? -1 : 1);
    if (ni < 0 || ni >= prev.items.length) return prev;
    const arr = [...prev.items];
    const [it] = arr.splice(idx,1);
    arr.splice(ni,0,it);
    return { items: arr };
  });
  const clearCompletedTodos = () => setTodos(prev => ({ items: prev.items.filter(t => !t.done) }));

  // Debounced save to Firestore on changes
  useEffect(() => {
    if (!fb.current.db) return;
    if (fb.current.applying) return; // ignore state updates coming from the cloud
    const simple = JSON.stringify({ xp, tasks, daily, top, todos });
    if (fb.current.lastSaved === simple) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(doc(fb.current.db, "shared", "clientwatch"), {
          xp, tasks, daily, top, todos, updatedAt: serverTimestamp()
        }, { merge: true });
        fb.current.lastSaved = simple;
        setCloudStatus("connected");
      } catch (e) {
        console.error("cloud save failed", e);
        setCloudStatus("error: " + (e?.message || e));
      }
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [xp, tasks, daily, top, todos]);

  // confetti when all 3 dailies complete
  const showCelebrate = daily.items.length === 3 && dailyCompleted === 3;

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Clientwatch</h1>
          <p className="text-neutral-300 mt-1">Click tasks to gain XP and rank up through Bronze → Top 500.</p>
          <div className="text-sm text-neutral-400 mt-1">Cloud (shared): {cloudStatus}</div>
        </header>

        {/* CURRENT RANK + CONTROLS */}
        <section className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl p-5 bg-neutral-900 border border-neutral-800 shadow">
            <div className="flex items-center gap-3">
              <TierBadge tier={tier} size={48} />
              <div>
                <div className="text-sm uppercase text-neutral-400">Current Tier</div>
                <div className="text-xl font-semibold">{tier.name} <span className="text-neutral-400 font-normal">({tier.subtitle})</span></div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-end justify-between">
                <div className="text-neutral-300">Subrank</div>
                <div className="text-neutral-400 text-sm">{SUBRANKS}-1 (lower = higher)</div>
              </div>
              <div className="text-2xl font-bold">{rank.subrank}</div>

              <div className="mt-4 text-neutral-300">Progress in Subrank</div>
              <Progress value={subrankPercent} color={tier.color} />
              <div className="text-sm text-neutral-400 mt-1">{formatNumber(xpIntoSubrank)} / {formatNumber(XP_PER_SUBRANK)} XP</div>

              <div className="mt-6 text-neutral-300">Progress in Tier</div>
              <Progress value={progressPercent} color={tier.color} />
              <div className="text-sm text-neutral-400 mt-1">{formatNumber(xp - tierStartXP)} / {formatNumber(tierEndXP - tierStartXP)} XP</div>

              <div className="mt-6 text-neutral-300">Total XP</div>
              <div className="text-lg font-semibold">{formatNumber(xp)} / {formatNumber(maxXPAllTiers)} XP</div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                {[10, 25, 50, 100].map((n) => (
                  <button key={n} onClick={() => addXP(n)} className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm">+{n} XP</button>
                ))}
                <div className="flex items-center gap-2">
                  <input value={customXP} onChange={(e) => setCustomXP(e.target.value)} inputMode="numeric" className="w-24 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-sm" placeholder="Custom" />
                  <button onClick={handleCustomAdd} className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm">Add</button>
                </div>
                <button onClick={() => addXP(-100)} className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-sm">-100</button>
                <button onClick={resetSeason} className="ml-auto px-3 py-2 rounded-xl bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-sm">Season Reset</button>
              </div>
            </div>
          </div>

          {/* TIERS OVERVIEW */}
          <div className="rounded-2xl p-5 bg-neutral-900 border border-neutral-800 shadow">
            <div className="text-sm uppercase text-neutral-400 mb-3">Tiers Overview</div>
            <ol className="space-y-3">
              {TIERS.map((t, i) => {
                const start = cumulativeXPAtTierStart(i);
                const end = start + tierTotalXP();
                const active = i === rank.tierIndex;
                const reached = xp >= end;
                return (
                  <li key={t.key} className={`flex items-center gap-3 p-3 rounded-xl border ${active ? "border-neutral-700 bg-neutral-800" : "border-neutral-800 bg-neutral-900"}`}>
                    <TierBadge tier={t} size={24} />
                    <div className="flex-1">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-neutral-400">{formatNumber(start)} – {formatNumber(end)} XP</div>
                    </div>
                    <div className={`text-xs px-2 py-1 rounded-lg border ${reached ? "border-emerald-700 text-emerald-300" : active ? "border-sky-700 text-sky-300" : "border-neutral-700 text-neutral-300"}`}>
                      {reached ? "Cleared" : active ? "Current" : "Locked"}
                    </div>
                    <button onClick={() => setXPExact(start)} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">Jump</button>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* DAILY CHALLENGES */}
        <section className="mt-8 rounded-2xl p-5 bg-neutral-900 border border-neutral-800 shadow">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm uppercase text-neutral-400">Daily Challenges</div>
              <h2 className="text-xl font-semibold">Finish today's 3 to earn bonus XP</h2>
            </div>
            <div className="text-sm text-neutral-400">{dailyCompleted}/3 complete</div>
          </div>
          <ul className="mt-4 space-y-3">
            {daily.items.map((d) => (
              <li key={d.id} className="flex items-center justify-between p-3 rounded-xl bg-neutral-950/60 border border-neutral-800">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={!!d.done} onChange={() => completeDaily(d.id)} className="h-5 w-5 rounded" />
                  <div>
                    <div className={`font-medium ${d.done ? "line-through text-neutral-400" : ""}`}>{d.label}</div>
                    <div className="text-xs text-neutral-400">+{d.xp} XP</div>
                  </div>
                </div>
                <button onClick={() => rerollDaily(d.id)} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">Reroll</button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={refreshToday} className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm">Refresh Today</button>
            <div className="text-xs text-neutral-400">Auto-refreshes daily; use this if you opened the app before midnight.</div>
          </div>

          {/* Confetti + Toast */}
          {showCelebrate && (
            <div>
              <div className="fixed inset-0 pointer-events-none">
                <ConfettiOverlay />
              </div>
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-100 text-neutral-900 px-4 py-2 rounded-xl shadow border">
                Daily Complete! 🎉
              </div>
            </div>
          )}
        </section>

        {/* TODAY'S TOP TASKS */}
        <section className="mt-8 rounded-2xl p-5 bg-neutral-900 border border-neutral-800 shadow">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm uppercase text-neutral-400">Today's Top Tasks</div>
              <h2 className="text-xl font-semibold">Pick up to 5 high‑impact tasks</h2>
            </div>
            <div className="text-sm text-neutral-400">{topCompleted}/{Math.max(1, top.items.length || 0)} complete</div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <AddTopFromSaved tasks={tasks} onAdd={addTopFromTask} disabled={top.items.length>=5} />
            <AddTopCustom onAdd={addTopCustom} disabled={top.items.length>=5} />
            <button onClick={refreshTopToday} className="w-full px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm">Clear Today</button>
          </div>

          <ul className="mt-4 space-y-2">
            {top.items.map((t, idx) => (
              <li key={t.id} className="flex items-center gap-2 p-3 rounded-xl bg-neutral-950/60 border border-neutral-800">
                <input type="checkbox" className="h-5 w-5" checked={!!t.done} onChange={() => toggleTop(t.id)} />
                <div className={`flex-1 ${t.done ? 'line-through text-neutral-400' : ''}`}>
                  <div className="font-medium">{t.label}</div>
                  <div className="text-xs text-neutral-400">+{t.xp} XP</div>
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={idx===0} onClick={() => moveTop(t.id,'up')} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 disabled:opacity-40">↑</button>
                  <button disabled={idx===top.items.length-1} onClick={() => moveTop(t.id,'down')} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 disabled:opacity-40">↓</button>
                  <button onClick={() => removeTop(t.id)} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700">Remove</button>
                </div>
              </li>
            ))}
          </ul>
          {top.items.length >= 5 && (
            <div className="mt-2 text-xs text-neutral-400">Limit reached (5). Mark done or remove to add more.</div>
          )}
        </section>
        {/* TODO LIST */}
        <section className="mt-8 rounded-2xl p-5 bg-neutral-900 border border-neutral-800 shadow">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm uppercase text-neutral-400">Todo List</div>
              <h2 className="text-xl font-semibold">Capture and track general todos (no XP)</h2>
            </div>
            <div className="text-sm text-neutral-400">{todos.items.filter(t=>t.done).length}/{todos.items.length || 0} complete</div>
          </div>

          <div className="mt-4">
            <AddTodoInput onAdd={addTodo} />
          </div>

          <ul className="mt-4 space-y-2">
            {todos.items.map((t, idx) => (
              <li key={t.id} className="flex items-center gap-2 p-3 rounded-xl bg-neutral-950/60 border border-neutral-800">
                <input type="checkbox" className="h-5 w-5" checked={!!t.done} onChange={() => toggleTodo(t.id)} />
                <div className={`flex-1 ${t.done ? 'line-through text-neutral-400' : ''}`}>{t.label}</div>
                <div className="flex items-center gap-2">
                  <button disabled={idx===0} onClick={() => moveTodo(t.id,'up')} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 disabled:opacity-40">↑</button>
                  <button disabled={idx===todos.items.length-1} onClick={() => moveTodo(t.id,'down')} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 disabled:opacity-40">↓</button>
                  <button onClick={() => removeTodo(t.id)} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700">Remove</button>
                </div>
              </li>
            ))}
          </ul>
          {todos.items.some(t=>t.done) && (
            <div className="mt-3">
              <button onClick={clearCompletedTodos} className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm">Clear Completed</button>
            </div>
          )}
        </section>

        {/* TASKS (CLICK TO GAIN XP) */}
        <section className="mt-8 rounded-2xl p-5 bg-neutral-900 border border-neutral-800 shadow">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm uppercase text-neutral-400">Tasks</div>
              <h2 className="text-xl font-semibold">Click to Gain XP</h2>
            </div>
            <div className="text-sm text-neutral-400">{Object.keys(groupedTasks).length} groups</div>
          </div>

          <div className="mt-4 grid md:grid-cols-2 gap-4">
            {Object.entries(groupedTasks).map(([group, items]) => (
              <div key={group} className="rounded-xl p-4 bg-neutral-950/60 border border-neutral-800">
                <div className="font-medium text-neutral-200 mb-2">{group}</div>
                <ul className="space-y-2">
                  {items.map((task) => (
                    <li key={task.id}>
                      <button onClick={() => addXP(task.xp)} className="w-full text-left px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700" title={`+${task.xp} XP`}>
                        <div className="flex items-center justify-between">
                          <span>{task.label}</span>
                          <span className="text-sm text-neutral-300">+{task.xp} XP</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* EDITOR */}
        <section className="mt-8 rounded-2xl p-5 bg-neutral-900 border border-neutral-800 shadow">
          <div className="text-sm uppercase text-neutral-400">Customize</div>
          <h2 className="text-xl font-semibold">Add/Remove Tasks</h2>
          <TaskEditor tasks={tasks} setTasks={setTasks} />        </section>

        <footer className="mt-10 text-center text-neutral-500 text-sm">
          <p>Progress auto-saves locally in your browser.</p>
        </footer>
      </div>
    </div>
  );
}

function ConfettiOverlay(){
  // tiny canvas-less confetti
  const [pieces, setPieces] = useState(() => Array.from({ length: 80 }, () => ({
    left: Math.random()*100,
    top: -10 - Math.random()*20,
    rot: Math.random()*360,
    size: 6 + Math.random()*8,
    speed: 0.6 + Math.random()*1.2,
  })));
  useEffect(() => {
    let raf;
    const tick = () => {
      setPieces((prev) => prev.map((p) => {
        let top = p.top + p.speed;
        let rot = (p.rot + p.speed*5) % 360;
        if (top > 100) { // reset to top
          return { ...p, top: -10 - Math.random()*20, left: Math.random()*100, rot };
        }
        return { ...p, top, rot };
      }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <div key={i} style={{ position: 'absolute', left: p.left + '%', top: p.top + '%', transform: `rotate(${p.rot}deg)` }}>
          <div style={{ width: p.size, height: p.size, borderRadius: 2, background: ['#ffd700','#cd7f32','#b9f2ff','#ff6bd6','#00bfff'][i % 5] }} />
        </div>
      ))}
    </div>
  );
}

function AddTopFromSaved({ tasks, onAdd, disabled }){
  const [selectId, setSelectId] = useState("");
  return (
    <div className="flex items-stretch space-x-2 min-w-0">
      <select value={selectId} onChange={(e)=>setSelectId(e.target.value)} className="min-w-0 flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700">
        <option value="">Add from saved tasks…</option>
        {tasks.map(t => (
          <option key={t.id} value={t.id}>{t.label} (+{t.xp} XP)</option>
        ))}
      </select>
      <button disabled={!selectId || disabled} onClick={() => { onAdd(selectId); setSelectId(""); }} className="shrink-0 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-40">Add</button>
    </div>
  );
}

function AddTopCustom({ onAdd, disabled }){
  const [label, setLabel] = useState("");
  const [xp, setXP] = useState(25);
  return (
    <div className="flex items-stretch space-x-2 min-w-0">
      <input value={label} onChange={(e)=>setLabel(e.target.value)} placeholder="Custom task label" className="min-w-0 flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700" />
      <input type="number" value={xp} onChange={(e)=>setXP(parseInt(e.target.value||'0',10))} className="w-24 shrink-0 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700" />
      <button disabled={!label.trim() || disabled} onClick={() => { onAdd(label, xp); setLabel(""); setXP(25); }} className="shrink-0 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-40">Add</button>
    </div>
  );
}

function AddTodoInput({ onAdd }){
  const [label, setLabel] = useState("");
  const doAdd = () => { if (label.trim()) { onAdd(label); setLabel(""); } };
  return (
    <div className="flex items-stretch space-x-2">
      <input value={label} onChange={(e)=>setLabel(e.target.value)} placeholder="Add a todo…" className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700" />
      <button onClick={doAdd} className="shrink-0 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">Add</button>
    </div>
  );
}

export default function App(){
  return (
    <ErrorBoundary>
      <TrackerInner />
    </ErrorBoundary>
  );
}
