import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, Filter, Download, Upload, Trash2, Pencil, Save, X, Phone, Mail, Globe, CalendarDays, Tag } from "lucide-react";

// 🔗 Firebase for cloud sync (same project/doc as ClientWatch)
import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";

/**
 * ClientWatch – Leads Tracker (Local + Cloud)
 * ---------------------------------------------
 * - Local persistence via localStorage (same namespace as ClientWatch)
 * - Cloud sync via Firestore, doc: shared/clientwatch (field: leads)
 * - Dark mode, Tailwind, framer-motion
 *
 * ROUTE: mount at /leads (React Router)
 */

// ---- Types ----
const STATUSES = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"] as const;
type Status = typeof STATUSES[number];

type Lead = {
  id: string;
  name: string;
  business?: string;
  email?: string;
  phone?: string;
  website?: string;
  status: Status;
  priority: "High" | "Medium" | "Low";
  source?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
};

// ---- Utils ----
// Match ClientWatch local namespace
const STORAGE_KEY = "clientwatch-local-v1";

// small local persistent state hook (same behavior as in ClientWatch)
function usePersistentState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      if (typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

// Firebase config (same as your App.jsx)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDn4HV6Y1NFlBY1xnQR2KceGAcIK26E52Y",
  authDomain: "clientwatch-a241c.firebaseapp.com",
  projectId: "clientwatch-a241c",
  storageBucket: "clientwatch-a241c.firebasestorage.app",
  messagingSenderId: "176782767425",
  appId: "1:176782767425:web:56c00f6779847af2fc9dc0",
  measurementId: "G-G02PQ8LQKT",
};

// Remove undefineds so Firestore is happy
function sanitizeLead(l: any) {
    if (!l || typeof l !== "object") return l;
    const out: any = {};
    for (const [k, v] of Object.entries(l)) {
      if (v === undefined) continue;          // drop undefined
      if (Array.isArray(v)) out[k] = v.map(sanitizeLead);
      else if (v && typeof v === "object") out[k] = sanitizeLead(v);
      else out[k] = v;
    }
    return out;
  }
  function sanitizeLeads(arr: any[]) {
    return (Array.isArray(arr) ? arr : []).filter(Boolean).map(sanitizeLead);
  }
  

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const statusStyles: Record<Status, string> = {
  New: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
  Contacted: "bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30",
  Qualified: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  Proposal: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  Won: "bg-lime-500/15 text-lime-300 ring-1 ring-lime-500/30",
  Lost: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
};

const priorityStyles: Record<Lead["priority"], string> = {
  High: "text-rose-300",
  Medium: "text-amber-300",
  Low: "text-zinc-300",
};

function sortLeads(a: Lead, b: Lead) {
  const order: Status[] = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];
  const sdiff = order.indexOf(a.status) - order.indexOf(b.status);
  if (sdiff !== 0) return sdiff;
  const p = { High: 0, Medium: 1, Low: 2 } as const;
  const pdiff = p[a.priority] - p[b.priority];
  if (pdiff !== 0) return pdiff;
  return b.updatedAt - a.updatedAt; // newest first
}

// ---- Component ----
export default function LeadsTracker() {
  // Local persistence (same namespace as ClientWatch)
  const [leads, setLeads] = usePersistentState<Lead[]>(`${STORAGE_KEY}:leads`, []);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | Status>("All");
  const [priorityFilter, setPriorityFilter] = useState<"All" | Lead["priority"]>("All");
  const [showForm, setShowForm] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Quick-add form
  const [form, setForm] = useState({
    name: "",
    business: "",
    email: "",
    phone: "",
    website: "",
    status: "New" as Status,
    priority: "Medium" as Lead["priority"],
    source: "",
    notes: "",
  });

  // --- Cloud sync (Firestore) ---
  const ENABLE_CLOUD_SYNC = true;
  const fb = React.useRef<{ app: any; db: any; unsub: any; applying: boolean; lastSaved: string }>({
    app: null,
    db: null,
    unsub: null,
    applying: false,
    lastSaved: "",
  });
  const saveTimer = React.useRef<any>(null);

  // Subscribe to leads in Firestore once
  useEffect(() => {
    if (!ENABLE_CLOUD_SYNC) return;
    try {
      const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
      const db = getFirestore(app);
      fb.current.app = app;
      fb.current.db = db;

      const ref = doc(db, "shared", "clientwatch");
      fb.current.unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || ({} as any);
        if (!data.leads) return;

        // prevent feedback loop when applying remote state
        fb.current.applying = true;
        const next = Array.isArray(data.leads) ? (data.leads as Lead[]) : [];
        setLeads(next.sort(sortLeads));
        fb.current.lastSaved = JSON.stringify({ leads: next });
        setTimeout(() => {
          fb.current.applying = false;
        }, 0);
      });
    } catch (e) {
      console.error("Leads sync init failed", e);
    }
    return () => {
      if (fb.current.unsub) fb.current.unsub();
    };
  }, []);

// Debounced cloud save on local leads change
useEffect(() => {
    if (!ENABLE_CLOUD_SYNC) return;
    if (!fb.current.db) return;
    if (fb.current.applying) return;
  
    const safeLeads = sanitizeLeads(leads);
    const simple = JSON.stringify({ leads: safeLeads });
    if (fb.current.lastSaved === simple) return;
  
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(
          doc(fb.current.db, "shared", "clientwatch"),
          {
            leads: safeLeads,               // <-- sanitized!
            leadsUpdatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        fb.current.lastSaved = simple;
      } catch (e) {
        console.error("Leads save failed", e);
      }
    }, 600);
  
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [leads]);
  

  // Derived views
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...leads]
      .filter((l) => (statusFilter === "All" ? true : l.status === statusFilter))
      .filter((l) => (priorityFilter === "All" ? true : l.priority === priorityFilter))
      .filter((l) =>
        q
          ? [l.name, l.business, l.email, l.phone, l.website, l.source, l.notes]
              .filter(Boolean)
              .some((x) => String(x).toLowerCase().includes(q))
          : true
      )
      .sort(sortLeads);
  }, [leads, query, statusFilter, priorityFilter]);

  const grouped = useMemo(() => {
    const map: Record<Status, Lead[]> = { New: [], Contacted: [], Qualified: [], Proposal: [], Won: [], Lost: [] };
    for (const l of filtered) map[l.status].push(l);
    return map;
  }, [filtered]);

  // Actions
  function resetForm() {
    setForm({
      name: "",
      business: "",
      email: "",
      phone: "",
      website: "",
      status: "New",
      priority: "Medium",
      source: "",
      notes: "",
    });
  }

  function addLead(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.name.trim()) return;
    const now = Date.now();
    const newLead: Lead = {
      id: uid(),
      name: form.name.trim(),
      business: form.business.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      website: form.website.trim() || undefined,
      status: form.status,
      priority: form.priority,
      source: form.source.trim() || undefined,
      notes: form.notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    setLeads((prev) => [newLead, ...prev]);
    resetForm();
  }

  function removeLead(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function updateLead(id: string, patch: Partial<Lead>) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: Date.now() } : l)));
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(leads, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientwatch-leads.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data)) {
          const clean: Lead[] = data
            .map((d: any) => ({
              id: d.id || uid(),
              name: String(d.name || ""),
              business: d.business || undefined,
              email: d.email || undefined,
              phone: d.phone || undefined,
              website: d.website || undefined,
              status: STATUSES.includes(d.status) ? d.status : ("New" as Status),
              priority: ["High", "Medium", "Low"].includes(d.priority) ? d.priority : ("Medium" as const),
              source: d.source || undefined,
              notes: d.notes || undefined,
              createdAt: Number(d.createdAt) || Date.now(),
              updatedAt: Number(d.updatedAt) || Date.now(),
            }))
            .sort(sortLeads);
          setLeads(clean);
        }
      } catch (err) {
        console.error("Import failed", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Leads</h1>
            <p className="text-zinc-400">Add, track, and organize potential clients in ClientWatch. (Cloud sync on)</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 ring-1 ring-white/10 cursor-pointer">
              <Upload className="size-4" />
              <span className="text-sm">Import JSON</span>
              <input type="file" accept="application/json" className="hidden" onChange={onImportJSON} />
            </label>
            <button onClick={exportJSON} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 ring-1 ring-white/10">
              <Download className="size-4" />
              <span className="text-sm">Export</span>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mt-6 flex flex-col lg:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-2.5 size-4 text-zinc-400" />
            <input
              className="w-full rounded-xl bg-zinc-900 ring-1 ring-white/10 pl-9 pr-4 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="Search name, business, email, phone, notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 sm:flex gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-2.5 size-4 text-zinc-400" />
              <select
                className="appearance-none pr-8 w-full sm:w-48 rounded-xl bg-zinc-900 ring-1 ring-white/10 pl-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="All">All Statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Tag className="absolute left-3 top-2.5 size-4 text-zinc-400" />
              <select
                className="appearance-none pr-8 w-full sm:w-44 rounded-xl bg-zinc-900 ring-1 ring-white/10 pl-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as any)}
              >
                <option value="All">All Priorities</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>
        </div>

        {/* Quick Add */}
        <div className="mt-6">
          <button onClick={() => setShowForm((s) => !s)} className="mb-3 inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-white">
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />} {showForm ? "Hide quick add" : "Quick add"}
          </button>
          {showForm && (
            <form onSubmit={addLead} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 bg-zinc-950/60 rounded-2xl p-4 ring-1 ring-white/10">
              <Input label="Contact Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Input label="Business" value={form.business} onChange={(v) => setForm({ ...form, business: v })} />
              <Input label="Email" type="email" leftIcon={<Mail className="size-4" />} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              <Input label="Phone" leftIcon={<Phone className="size-4" />} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <Input label="Website" leftIcon={<Globe className="size-4" />} value={form.website} onChange={(v) => setForm({ ...form, website: v })} />
              <Select label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v as Status })} options={STATUSES.map((s) => ({ label: s, value: s }))} />
              <Select label="Priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v as Lead["priority"] })} options={["High", "Medium", "Low"].map((p) => ({ label: p, value: p }))} />
              <Input label="Source" placeholder="BNI, Referral, Google…" value={form.source} onChange={(v) => setForm({ ...form, source: v })} />
              <TextArea className="md:col-span-2" label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
              <div className="lg:col-span-4 flex items-center gap-3">
                <button type="submit" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 transition ring-1 ring-sky-500/30">
                  <Plus className="size-4" /> Add Lead
                </button>
                <button type="button" onClick={resetForm} className="text-sm text-zinc-300 hover:text-white">
                  Clear
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Groups by Status */}
        <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
          {STATUSES.map((status) => (
            <motion.div key={status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="rounded-2xl bg-zinc-900/50 ring-1 ring-white/10">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 text-xs rounded-full ${statusStyles[status]}`}>{status}</span>
                  <span className="text-sm text-zinc-400">
                    {grouped[status].length} lead{grouped[status].length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <ul className="divide-y divide-white/5">
                {grouped[status].map((l) => (
                  <li key={l.id} className="p-4 hover:bg-white/5 transition">
                    {editingId === l.id ? (
                      <EditRow
                        lead={l}
                        onCancel={() => setEditingId(null)}
                        onSave={(patch) => {
                          updateLead(l.id, patch);
                          setEditingId(null);
                        }}
                      />
                    ) : (
                      <DisplayRow
                        lead={l}
                        onEdit={() => setEditingId(l.id)}
                        onDelete={() => removeLead(l.id)}
                        onQuickChange={(patch) => updateLead(l.id, patch)}
                      />
                    )}
                  </li>
                ))}
                {grouped[status].length === 0 && <li className="p-4 text-sm text-zinc-400">No leads in this status.</li>}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Composed pieces ----
function DisplayRow({
  lead,
  onEdit,
  onDelete,
  onQuickChange,
}: {
  lead: Lead;
  onEdit: () => void;
  onDelete: () => void;
  onQuickChange: (patch: Partial<Lead>) => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium truncate max-w-[22ch]">{lead.name}</h3>
          {lead.business && <span className="text-sm text-zinc-400 truncate max-w-[28ch]">• {lead.business}</span>}
          <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ring-1 ${statusStyles[lead.status]}`}>{lead.status}</span>
          <span className={`ml-1 text-xs`}>
            <span className={priorityStyles[lead.priority]}>●</span> {lead.priority}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-400">
          {lead.email && (
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3" /> {lead.email}
            </span>
          )}
          {lead.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3" /> {lead.phone}
            </span>
          )}
          {lead.website && (
            <a className="inline-flex items-center gap-1 hover:text-white" href={lead.website} target="_blank" rel="noreferrer">
              <Globe className="size-3" /> {lead.website.replace(/^https?:\/\//, "")}
            </a>
          )}
          {lead.source && (
            <span className="inline-flex items-center gap-1">
              <Tag className="size-3" /> {lead.source}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3" /> Updated {timeAgo(lead.updatedAt)}
          </span>
        </div>
        {lead.notes && <p className="mt-2 text-sm text-zinc-300/90 whitespace-pre-wrap">{lead.notes}</p>}
      </div>
      <div className="flex items-center gap-2">
        <select value={lead.status} onChange={(e) => onQuickChange({ status: e.target.value as Status })} className="rounded-lg bg-zinc-900 ring-1 ring-white/10 px-2 py-1 text-xs">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={lead.priority} onChange={(e) => onQuickChange({ priority: e.target.value as Lead["priority"] })} className="rounded-lg bg-zinc-900 ring-1 ring-white/10 px-2 py-1 text-xs">
          {(["High", "Medium", "Low"] as const).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button onClick={onEdit} className="p-2 rounded-lg bg-zinc-900 ring-1 ring-white/10 hover:bg-white/10">
          <Pencil className="size-4" />
        </button>
        <button onClick={onDelete} className="p-2 rounded-lg bg-zinc-900 ring-1 ring-white/10 hover:bg-rose-500/20">
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

function EditRow({ lead, onCancel, onSave }: { lead: Lead; onCancel: () => void; onSave: (patch: Partial<Lead>) => void }) {
  const [draft, setDraft] = useState({ ...lead });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <Input label="Contact Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
      <Input label="Business" value={draft.business || ""} onChange={(v) => setDraft({ ...draft, business: v })} />
      <Input label="Email" type="email" value={draft.email || ""} onChange={(v) => setDraft({ ...draft, email: v })} />
      <Input label="Phone" value={draft.phone || ""} onChange={(v) => setDraft({ ...draft, phone: v })} />
      <Input label="Website" value={draft.website || ""} onChange={(v) => setDraft({ ...draft, website: v })} />
      <Select label="Status" value={draft.status} onChange={(v) => setDraft({ ...draft, status: v as Status })} options={STATUSES.map((s) => ({ label: s, value: s }))} />
      <Select label="Priority" value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v as any })} options={["High", "Medium", "Low"].map((p) => ({ label: p, value: p }))} />
      <Input label="Source" value={draft.source || ""} onChange={(v) => setDraft({ ...draft, source: v })} />
      <TextArea label="Notes" value={draft.notes || ""} onChange={(v) => setDraft({ ...draft, notes: v })} className="md:col-span-2" />
      <div className="flex items-center gap-2">
        <button onClick={() => onSave(draft)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 ring-1 ring-emerald-500/30">
          <Save className="size-4" /> Save
        </button>
        <button onClick={onCancel} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 ring-1 ring-white/10 hover:bg-white/10">
          <X className="size-4" /> Cancel
        </button>
      </div>
    </div>
  );
}

// ---- Primitives ----
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-zinc-400 mb-1">{children}</label>;
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  leftIcon,
  required,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  leftIcon?: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="relative">
        {leftIcon && <span className="absolute left-3 top-2.5 text-zinc-400">{leftIcon}</span>}
        <input
          required={required}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-xl bg-zinc-900 ring-1 ring-white/10 ${leftIcon ? "pl-9" : "pl-3"} pr-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500`}
        />
      </div>
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, className = "" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-xl bg-zinc-900 ring-1 ring-white/10 px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl bg-zinc-900 ring-1 ring-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---- Helpers ----
function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
