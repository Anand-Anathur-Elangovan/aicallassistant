"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { SiteHeader } from "@/components/SiteHeader";
import { useRouter } from "next/navigation";

type Business = {
  id: string;
  name: string;
  description: string;
  phone: string;
  working_hours: Record<string, string>;
  language: string;
  voice_id: string;
  vapi_assistant_id: string | null;
  notification_email: string;
  notification_telegram: string;
  transfer_message: string;
};
type Product = { id: string; name: string; description: string; price: number; min_price: number; currency: string; category: string; in_stock: boolean };
type KnowledgeItem = { id: string; title: string; content: string; created_at: string };
type CallLog = { id: string; caller_number: string; duration_seconds: number; summary: string; transcript: string; status: string; transferred: boolean; created_at: string };
type Agent = { id: string; name: string; phone: string; department: string; is_available: boolean };
type OfferRule = { id: string; condition: string; discount_percent: number; description: string; is_active: boolean };
type Appointment = {
  id: string; customer_name: string; customer_phone: string; customer_email: string;
  showroom: string; scheduled_at: string; duration_minutes: number; status: string; notes: string; source: string;
};
type StoreHour = {
  id?: string; day_of_week: number; is_closed: boolean; open_time: string; close_time: string;
  max_appointments: number; slot_minutes: number;
};
type Closure = { id: string; start_date: string; end_date: string; reason: string; is_emergency: boolean };
type Handoff = {
  id: string; caller_number: string; agent_name: string; agent_phone: string;
  department: string; reason: string; context_summary: string; status: string; created_at: string;
};
type Report = {
  totals: {
    calls: number; callsThisWeek: number; totalDurationMinutes: number; avgDurationSeconds: number;
    transferred: number; transferRate: number; upcomingAppointments: number; appointmentsTotal: number;
  };
  callsByDay: { date: string; count: number }[];
  recentCalls: CallLog[];
  upcomingAppointments: Appointment[];
};

const TABS = ["Overview", "Reports", "Assistant", "Products", "Knowledge", "Appointments", "Hours", "Calls", "Transfers", "Agents", "Offers", "Settings"] as const;
type Tab = (typeof TABS)[number];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VOICES = [
  { id: "Elliot", label: "Elliot (Male)" },
  { id: "Rohan", label: "Rohan (Male)" },
  { id: "Savannah", label: "Savannah (Female)" },
  { id: "Neha", label: "Neha (Female)" },
  { id: "rachel", label: "Rachel (Female)" },
  { id: "adam", label: "Adam (Male)" },
  { id: "bella", label: "Bella (Female)" },
  { id: "drew", label: "Drew (Male)" },
];

async function api(method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const url = new URL("/api/manage", window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function fmtTime(t: string) {
  return (t || "09:00").toString().slice(0, 5);
}

function plainSummary(text?: string) {
  if (!text) return "";
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export default function Dashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Overview");
  const [business, setBusiness] = useState<Business | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [offers, setOffers] = useState<OfferRule[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [hours, setHours] = useState<StoreHour[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dark, setDark] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const [bizForm, setBizForm] = useState({ name: "", description: "", phone: "", language: "en", voice_id: "Elliot", notification_email: "", notification_telegram: "", transfer_message: "Please hold while I connect you to a team member." });
  const [prodForm, setProdForm] = useState({ name: "", description: "", price: "", min_price: "", currency: "AUD", category: "" });
  const [kbForm, setKbForm] = useState({ title: "", content: "" });
  const [agentForm, setAgentForm] = useState({ name: "", phone: "", department: "" });
  const [offerForm, setOfferForm] = useState({ condition: "", discount_percent: "", description: "" });
  const [apptForm, setApptForm] = useState({ customer_name: "", customer_phone: "", showroom: "richmond", scheduled_at: "", notes: "" });
  const [closureForm, setClosureForm] = useState({ start_date: "", end_date: "", reason: "", is_emergency: false });

  const loadData = useCallback(async (bizId: string) => {
    const [p, k, c, a, o, ap, h, cl, r, hf] = await Promise.all([
      api("GET", undefined, { resource: "products", business_id: bizId }),
      api("GET", undefined, { resource: "knowledge", business_id: bizId }),
      api("GET", undefined, { resource: "calls", business_id: bizId }),
      api("GET", undefined, { resource: "agents", business_id: bizId }),
      api("GET", undefined, { resource: "offers", business_id: bizId }),
      api("GET", undefined, { resource: "appointments", business_id: bizId }),
      api("GET", undefined, { resource: "hours", business_id: bizId }),
      api("GET", undefined, { resource: "closures", business_id: bizId }),
      api("GET", undefined, { resource: "reports", business_id: bizId }),
      api("GET", undefined, { resource: "handoffs", business_id: bizId }),
    ]);
    setProducts(Array.isArray(p) ? p : []);
    setKnowledge(Array.isArray(k) ? k : []);
    setCalls(Array.isArray(c) ? c : []);
    setAgents(Array.isArray(a) ? a : []);
    setOffers(Array.isArray(o) ? o : []);
    setAppointments(Array.isArray(ap) ? ap : []);
    setHours(Array.isArray(h) ? h : []);
    setClosures(Array.isArray(cl) ? cl : []);
    setHandoffs(Array.isArray(hf) ? hf : []);
    if (r?.totals) setReport(r);
  }, []);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleDark() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  }

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/"); return; }
      const businesses = await api("GET", undefined, { resource: "businesses" });
      if (businesses?.length) {
        const biz = businesses[0];
        setBusiness(biz);
        setBizForm({
          name: biz.name || "", description: biz.description || "", phone: biz.phone || "",
          language: biz.language || "en", voice_id: biz.voice_id || "Elliot",
          notification_email: biz.notification_email || "", notification_telegram: biz.notification_telegram || "",
          transfer_message: biz.transfer_message || "Please hold while I connect you to a team member.",
        });
        await loadData(biz.id);
      }
      setLoading(false);
    })();
  }, [router, loadData]);

  async function saveBusiness() {
    setSaving(true);
    if (business) {
      const updated = await api("POST", { action: "update_business", id: business.id, ...bizForm });
      if (updated?.id) setBusiness(updated);
      else alert(updated?.error || "Failed to update");
    } else {
      const created = await api("POST", { action: "create_business", ...bizForm });
      setBusiness(created);
      if (created.id) await loadData(created.id);
    }
    setSaving(false);
  }

  async function createAssistant() {
    if (!business) return;
    setSaving(true);
    const result = await api("POST", { action: "create_assistant", business_id: business.id });
    if (result.id) setBusiness({ ...business, vapi_assistant_id: result.id });
    else alert(result.error || "Failed to create assistant. Check your Vapi API key.");
    setSaving(false);
  }

  async function addProduct() {
    if (!business) return;
    setSaving(true);
    const created = await api("POST", { action: "create_product", business_id: business.id, ...prodForm, price: parseFloat(prodForm.price), min_price: prodForm.min_price ? parseFloat(prodForm.min_price) : null });
    if (created.id) { setProducts([created, ...products]); setProdForm({ name: "", description: "", price: "", min_price: "", currency: "AUD", category: "" }); }
    setSaving(false);
  }

  async function deleteProduct(id: string) {
    if (!business) return;
    await api("POST", { action: "delete_product", id, business_id: business.id });
    setProducts(products.filter(p => p.id !== id));
  }

  async function addKnowledge() {
    if (!business) return;
    setSaving(true);
    const created = await api("POST", { action: "add_knowledge", business_id: business.id, ...kbForm });
    if (created.id) { setKnowledge([created, ...knowledge]); setKbForm({ title: "", content: "" }); }
    setSaving(false);
  }

  async function deleteKnowledge(id: string) {
    if (!business) return;
    await api("POST", { action: "delete_knowledge", id, business_id: business.id });
    setKnowledge(knowledge.filter(k => k.id !== id));
  }

  async function addAgent() {
    if (!business) return;
    setSaving(true);
    const created = await api("POST", { action: "add_agent", business_id: business.id, ...agentForm });
    if (created.id) { setAgents([created, ...agents]); setAgentForm({ name: "", phone: "", department: "" }); }
    setSaving(false);
  }

  async function deleteAgent(id: string) {
    if (!business) return;
    await api("POST", { action: "delete_agent", id, business_id: business.id });
    setAgents(agents.filter(a => a.id !== id));
  }

  async function toggleAgent(agent: Agent) {
    if (!business) return;
    await api("POST", { action: "update_agent", id: agent.id, business_id: business.id, is_available: !agent.is_available });
    setAgents(agents.map(a => a.id === agent.id ? { ...a, is_available: !a.is_available } : a));
  }

  async function addOffer() {
    if (!business) return;
    setSaving(true);
    const created = await api("POST", { action: "add_offer_rule", business_id: business.id, ...offerForm, discount_percent: parseInt(offerForm.discount_percent) });
    if (created.id) { setOffers([created, ...offers]); setOfferForm({ condition: "", discount_percent: "", description: "" }); }
    setSaving(false);
  }

  async function deleteOffer(id: string) {
    if (!business) return;
    await api("POST", { action: "delete_offer_rule", id, business_id: business.id });
    setOffers(offers.filter(o => o.id !== id));
  }

  async function saveHours() {
    if (!business) return;
    setSaving(true);
    const saved = await api("POST", {
      action: "save_store_hours",
      business_id: business.id,
      hours: hours.map(h => ({
        day_of_week: h.day_of_week,
        is_closed: h.is_closed,
        open_time: fmtTime(h.open_time),
        close_time: fmtTime(h.close_time),
        max_appointments: Number(h.max_appointments),
        slot_minutes: Number(h.slot_minutes),
      })),
    });
    if (Array.isArray(saved)) setHours(saved);
    else alert(saved?.error || "Failed to save hours");
    setSaving(false);
  }

  async function addClosure() {
    if (!business) return;
    setSaving(true);
    const created = await api("POST", { action: "add_closure", business_id: business.id, ...closureForm });
    if (created.id) {
      setClosures([created, ...closures]);
      setClosureForm({ start_date: "", end_date: "", reason: "", is_emergency: false });
    } else alert(created.error || "Failed");
    setSaving(false);
  }

  async function deleteClosure(id: string) {
    if (!business) return;
    await api("POST", { action: "delete_closure", id, business_id: business.id });
    setClosures(closures.filter(c => c.id !== id));
  }

  async function addAppointment() {
    if (!business) return;
    setSaving(true);
    const created = await api("POST", {
      action: "create_appointment",
      business_id: business.id,
      ...apptForm,
      scheduled_at: apptForm.scheduled_at.replace("T", " "),
    });
    if (created.id) {
      setAppointments([created, ...appointments]);
      setApptForm({ customer_name: "", customer_phone: "", showroom: "richmond", scheduled_at: "", notes: "" });
      const r = await api("GET", undefined, { resource: "reports", business_id: business.id });
      if (r?.totals) setReport(r);
    } else alert(created.error || "Failed to book");
    setSaving(false);
  }

  async function setApptStatus(id: string, status: string) {
    if (!business) return;
    const updated = await api("POST", { action: "update_appointment", id, business_id: business.id, status });
    if (updated.id) setAppointments(appointments.map(a => a.id === id ? { ...a, status } : a));
  }

  async function clearAllData() {
    if (!business || deleteConfirm !== "DELETE") {
      alert('Type DELETE in the box to confirm.');
      return;
    }
    if (!confirm("Clear all products, calls, appointments, knowledge, agents, offers, hours, and handoffs? Business profile stays.")) return;
    setSaving(true);
    const res = await api("POST", { action: "clear_business_data", business_id: business.id, confirm: "DELETE" });
    setSaving(false);
    if (res.ok) {
      setDeleteConfirm("");
      await loadData(business.id);
      alert("All business data cleared.");
    } else alert(res.error || "Failed to clear data");
  }

  async function deleteBusiness() {
    if (!business || deleteConfirm !== "DELETE") {
      alert('Type DELETE in the box to confirm.');
      return;
    }
    if (!confirm("Permanently delete this business and ALL related data? This cannot be undone.")) return;
    setSaving(true);
    const res = await api("POST", { action: "delete_business", business_id: business.id, confirm: "DELETE" });
    setSaving(false);
    if (res.ok) {
      setBusiness(null);
      setProducts([]); setKnowledge([]); setCalls([]); setAgents([]); setOffers([]);
      setAppointments([]); setHours([]); setClosures([]); setHandoffs([]); setReport(null);
      setDeleteConfirm("");
      alert("Business deleted.");
      setTab("Assistant");
    } else alert(res.error || "Failed to delete");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-lg">Loading...</div>;

  const totals = report?.totals;
  const maxDay = Math.max(1, ...(report?.callsByDay?.map(d => d.count) || [1]));

  return (
    <div className="flex-1 flex flex-col">
      <SiteHeader
        darkToggle
        dark={dark}
        onToggleDark={toggleDark}
        rightSlot={
          <>
            <span className="text-sm text-gray-500 hidden md:inline">{business?.name || "No business"}</span>
            {business?.vapi_assistant_id && <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">Live</span>}
            <button onClick={logout} className="text-sm text-red-500 hover:underline">Logout</button>
          </>
        }
      />

      <div className="flex-1 flex">
        <nav className="w-48 border-r p-4 space-y-1 overflow-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${tab === t ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-gray-50"}`}>
              {t}
            </button>
          ))}
        </nav>

        <main className="flex-1 p-6 overflow-auto">
          {tab === "Overview" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Overview</h2>
              {!business ? (
                <div className="p-8 border rounded-xl text-center">
                  <h3 className="text-lg font-medium mb-2">Welcome! Set up your business first.</h3>
                  <button onClick={() => setTab("Assistant")} className="px-6 py-2 bg-blue-600 text-white rounded-lg">Get Started</button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                      { label: "Total Calls", value: totals?.calls ?? calls.length },
                      { label: "This Week", value: totals?.callsThisWeek ?? 0 },
                      { label: "Transferred", value: totals?.transferred ?? 0 },
                      { label: "Upcoming Visits", value: totals?.upcomingAppointments ?? 0 },
                    ].map(s => (
                      <div key={s.label} className="p-4 border rounded-xl">
                        <div className="text-sm text-gray-500">{s.label}</div>
                        <div className="text-2xl font-bold mt-1">{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 mb-6">
                    <button onClick={() => setTab("Reports")} className="px-4 py-2 border rounded-lg text-sm">Full Reports</button>
                    <button onClick={() => setTab("Appointments")} className="px-4 py-2 border rounded-lg text-sm">Appointments</button>
                    <button onClick={() => setTab("Hours")} className="px-4 py-2 border rounded-lg text-sm">Hours & Closures</button>
                  </div>
                  <h3 className="font-medium mb-3">Recent Calls</h3>
                  {calls.length === 0 ? <p className="text-gray-400">No calls logged yet. After webhook is live, summaries appear here.</p> : (
                    <div className="space-y-2">
                      {calls.slice(0, 5).map(c => (
                        <div key={c.id} className="p-3 border rounded-lg flex justify-between items-start">
                          <div>
                            <span className="font-medium">{c.caller_number || "Unknown"}</span>
                            <span className="text-gray-400 text-sm ml-2">{Math.round((c.duration_seconds || 0) / 60)}m</span>
                            {c.transferred && <span className="ml-2 text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">Transferred</span>}
                            <p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap">{plainSummary(c.summary) || "No summary"}</p>
                          </div>
                          <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "Reports" && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Call & Appointment Reports</h2>
              <p className="text-gray-500 text-sm mb-6">Usage and outcomes for your AI receptionist.</p>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                      { label: "All Calls", value: totals?.calls ?? 0 },
                      { label: "Talk Time", value: `${totals?.totalDurationMinutes ?? 0}m` },
                      { label: "Avg Call", value: `${totals?.avgDurationSeconds ?? 0}s` },
                      { label: "Transfer Rate", value: `${totals?.transferRate ?? 0}%` },
                      { label: "Calls (7d)", value: totals?.callsThisWeek ?? 0 },
                      { label: "All Appointments", value: totals?.appointmentsTotal ?? 0 },
                      { label: "Upcoming Visits", value: totals?.upcomingAppointments ?? 0 },
                      { label: "Products", value: products.length },
                    ].map(s => (
                      <div key={s.label} className="p-4 border rounded-xl">
                        <div className="text-sm text-gray-500">{s.label}</div>
                        <div className="text-xl font-bold mt-1">{s.value}</div>
                      </div>
                    ))}
                  </div>

                  <h3 className="font-medium mb-3">Calls last 7 days</h3>
                  {(!report?.callsByDay?.length) ? <p className="text-gray-400 mb-8">No calls in the last week yet.</p> : (
                    <div className="flex items-end gap-2 h-40 mb-8 border rounded-xl p-4">
                      {report.callsByDay.map(d => (
                        <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full">
                          <div className="w-full bg-blue-500 rounded-t" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 8 : 0 }} />
                          <span className="text-[10px] text-gray-400 mt-1">{d.date.slice(5)}</span>
                          <span className="text-xs font-medium">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-medium mb-3">Recent call summaries</h3>
                      <div className="space-y-2">
                        {(report?.recentCalls || calls).slice(0, 8).map(c => (
                          <div key={c.id} className="p-3 border rounded-lg text-sm">
                            <div className="flex justify-between"><span className="font-medium">{c.caller_number}</span><span className="text-gray-400">{new Date(c.created_at).toLocaleString()}</span></div>
                            <p className="text-gray-500 mt-1 whitespace-pre-wrap">{plainSummary(c.summary) || "No summary"}</p>
                          </div>
                        ))}
                        {!calls.length && <p className="text-gray-400">No call reports yet.</p>}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-medium mb-3">Upcoming appointments</h3>
                      <div className="space-y-2">
                        {(report?.upcomingAppointments || []).map(a => (
                          <div key={a.id} className="p-3 border rounded-lg text-sm">
                            <div className="font-medium">{a.customer_name}</div>
                            <div className="text-gray-500">{new Date(a.scheduled_at).toLocaleString()} · {a.showroom}</div>
                          </div>
                        ))}
                        {!report?.upcomingAppointments?.length && <p className="text-gray-400">No upcoming visits.</p>}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "Assistant" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Assistant Setup</h2>
              <div className="max-w-lg space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Business Name *</label>
                  <input value={bizForm.name} onChange={e => setBizForm({ ...bizForm, name: e.target.value })} className="w-full px-4 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={bizForm.description} onChange={e => setBizForm({ ...bizForm, description: e.target.value })} className="w-full px-4 py-2 border rounded-lg" rows={3} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Business Phone</label>
                  <input value={bizForm.phone} onChange={e => setBizForm({ ...bizForm, phone: e.target.value })} className="w-full px-4 py-2 border rounded-lg" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Language</label>
                    <select value={bizForm.language} onChange={e => setBizForm({ ...bizForm, language: e.target.value })} className="w-full px-4 py-2 border rounded-lg">
                      <option value="auto">Auto-detect</option>
                      <option value="en">English</option>
                      <option value="it">Italian</option>
                      <option value="ta">Tamil</option>
                      <option value="hi">Hindi</option>
                      <option value="fr">French</option>
                      <option value="es">Spanish</option>
                      <option value="de">German</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Auto-detect uses multilingual speech recognition.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Voice / Gender</label>
                    <select value={bizForm.voice_id} onChange={e => setBizForm({ ...bizForm, voice_id: e.target.value })} className="w-full px-4 py-2 border rounded-lg">
                      {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Save to push voice change to the live Vapi agent.</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Transfer Message</label>
                  <input value={bizForm.transfer_message} onChange={e => setBizForm({ ...bizForm, transfer_message: e.target.value })} className="w-full px-4 py-2 border rounded-lg" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={saveBusiness} disabled={saving || !bizForm.name} className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                    {saving ? "Saving..." : business ? "Update Business & Voice" : "Create Business"}
                  </button>
                  {business && !business.vapi_assistant_id && (
                    <button onClick={createAssistant} disabled={saving} className="px-6 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50">Activate AI Assistant</button>
                  )}
                </div>
                {business?.vapi_assistant_id && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-green-800 font-medium">AI Assistant is Active</p>
                    <p className="text-green-600 text-sm mt-1">ID: {business.vapi_assistant_id}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "Products" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Products & Services</h2>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <input value={prodForm.name} onChange={e => setProdForm({ ...prodForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Product Name" />
                    <input value={prodForm.description} onChange={e => setProdForm({ ...prodForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Description" />
                    <div className="grid grid-cols-3 gap-3">
                      <input type="number" value={prodForm.price} onChange={e => setProdForm({ ...prodForm, price: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Price" />
                      <input type="number" value={prodForm.min_price} onChange={e => setProdForm({ ...prodForm, min_price: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Min" />
                      <select value={prodForm.currency} onChange={e => setProdForm({ ...prodForm, currency: e.target.value })} className="px-3 py-2 border rounded-lg"><option value="AUD">AUD</option><option value="USD">USD</option></select>
                    </div>
                    <button onClick={addProduct} disabled={saving || !prodForm.name || !prodForm.price} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">Add Product</button>
                  </div>
                  <div className="space-y-2">
                    {products.map(p => (
                      <div key={p.id} className="p-3 border rounded-lg flex justify-between">
                        <div><span className="font-medium">{p.name}</span><span className="text-gray-500 ml-2">${p.price} {p.currency}</span></div>
                        <button onClick={() => deleteProduct(p.id)} className="text-red-500 text-sm">Delete</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "Knowledge" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Knowledge Base</h2>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <input value={kbForm.title} onChange={e => setKbForm({ ...kbForm, title: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Title" />
                    <textarea value={kbForm.content} onChange={e => setKbForm({ ...kbForm, content: e.target.value })} className="w-full px-3 py-2 border rounded-lg" rows={4} />
                    <button onClick={addKnowledge} disabled={saving || !kbForm.title || !kbForm.content} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">Add Entry</button>
                  </div>
                  <div className="space-y-2">
                    {knowledge.map(k => (
                      <div key={k.id} className="p-3 border rounded-lg flex justify-between">
                        <div><span className="font-medium">{k.title}</span><p className="text-sm text-gray-500 mt-1">{k.content.slice(0, 180)}</p></div>
                        <button onClick={() => deleteKnowledge(k.id)} className="text-red-500 text-sm">Delete</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "Appointments" && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Appointments</h2>
              <p className="text-gray-500 text-sm mb-6">Showroom visits booked by staff or by the AI on calls.</p>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <h3 className="font-medium">Book visit</h3>
                    <input value={apptForm.customer_name} onChange={e => setApptForm({ ...apptForm, customer_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Customer name" />
                    <input value={apptForm.customer_phone} onChange={e => setApptForm({ ...apptForm, customer_phone: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Phone" />
                    <select value={apptForm.showroom} onChange={e => setApptForm({ ...apptForm, showroom: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                      <option value="richmond">Richmond</option>
                      <option value="moorabbin">Moorabbin</option>
                      <option value="general">General</option>
                    </select>
                    <input type="datetime-local" value={apptForm.scheduled_at} onChange={e => setApptForm({ ...apptForm, scheduled_at: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
                    <input value={apptForm.notes} onChange={e => setApptForm({ ...apptForm, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Notes" />
                    <button onClick={addAppointment} disabled={saving || !apptForm.customer_name || !apptForm.scheduled_at} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">Book Appointment</button>
                  </div>
                  <div className="space-y-2">
                    {appointments.map(a => (
                      <div key={a.id} className="p-3 border rounded-lg flex justify-between items-start gap-3">
                        <div>
                          <span className="font-medium">{a.customer_name}</span>
                          <span className="text-xs ml-2 px-2 py-0.5 bg-gray-100 rounded-full">{a.status}</span>
                          <span className="text-xs ml-2 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">{a.source}</span>
                          <p className="text-sm text-gray-500 mt-1">{new Date(a.scheduled_at).toLocaleString()} · {a.showroom} · {a.customer_phone || "no phone"}</p>
                          {a.notes && <p className="text-sm text-gray-400">{a.notes}</p>}
                        </div>
                        <div className="flex gap-2 text-sm">
                          {a.status === "scheduled" && (
                            <>
                              <button onClick={() => setApptStatus(a.id, "completed")} className="text-green-600">Done</button>
                              <button onClick={() => setApptStatus(a.id, "cancelled")} className="text-red-500">Cancel</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {!appointments.length && <p className="text-gray-400">No appointments yet.</p>}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "Hours" && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Store Hours & Closures</h2>
              <p className="text-gray-500 text-sm mb-6">Set weekly hours and daily appointment capacity. Add leave/emergency closures so the AI can explain and offer other dates.</p>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <>
                  <div className="space-y-3 mb-6">
                    {hours.map((h, idx) => (
                      <div key={h.day_of_week} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-center p-3 border rounded-lg">
                        <div className="font-medium text-sm">{DAY_NAMES[h.day_of_week]}</div>
                        <label className="text-sm flex items-center gap-2">
                          <input type="checkbox" checked={h.is_closed} onChange={e => {
                            const next = [...hours];
                            next[idx] = { ...h, is_closed: e.target.checked };
                            setHours(next);
                          }} /> Closed
                        </label>
                        <input type="time" disabled={h.is_closed} value={fmtTime(h.open_time)} onChange={e => {
                          const next = [...hours]; next[idx] = { ...h, open_time: e.target.value }; setHours(next);
                        }} className="px-2 py-1 border rounded" />
                        <input type="time" disabled={h.is_closed} value={fmtTime(h.close_time)} onChange={e => {
                          const next = [...hours]; next[idx] = { ...h, close_time: e.target.value }; setHours(next);
                        }} className="px-2 py-1 border rounded" />
                        <input type="number" disabled={h.is_closed} min={0} max={50} value={h.max_appointments} onChange={e => {
                          const next = [...hours]; next[idx] = { ...h, max_appointments: parseInt(e.target.value || "0") }; setHours(next);
                        }} className="px-2 py-1 border rounded" title="Max appointments / day" placeholder="Max/day" />
                        <select disabled={h.is_closed} value={h.slot_minutes} onChange={e => {
                          const next = [...hours]; next[idx] = { ...h, slot_minutes: parseInt(e.target.value) }; setHours(next);
                        }} className="px-2 py-1 border rounded">
                          {[30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} min slots</option>)}
                        </select>
                      </div>
                    ))}
                    <button onClick={saveHours} disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{saving ? "Saving..." : "Save Hours"}</button>
                  </div>

                  <h3 className="font-medium mb-3 mt-8">Leave / Emergency Closures</h3>
                  <div className="max-w-lg space-y-3 mb-6 p-4 border rounded-xl">
                    <input type="date" value={closureForm.start_date} onChange={e => setClosureForm({ ...closureForm, start_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
                    <input type="date" value={closureForm.end_date} onChange={e => setClosureForm({ ...closureForm, end_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
                    <input value={closureForm.reason} onChange={e => setClosureForm({ ...closureForm, reason: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Reason (shown by AI to callers)" />
                    <label className="text-sm flex items-center gap-2">
                      <input type="checkbox" checked={closureForm.is_emergency} onChange={e => setClosureForm({ ...closureForm, is_emergency: e.target.checked })} /> Emergency closing
                    </label>
                    <button onClick={addClosure} disabled={saving || !closureForm.start_date || !closureForm.end_date || !closureForm.reason} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">Add Closure</button>
                  </div>
                  <div className="space-y-2">
                    {closures.map(c => (
                      <div key={c.id} className="p-3 border rounded-lg flex justify-between">
                        <div>
                          <span className="font-medium">{c.start_date} → {c.end_date}</span>
                          {c.is_emergency && <span className="ml-2 text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">Emergency</span>}
                          <p className="text-sm text-gray-500">{c.reason}</p>
                        </div>
                        <button onClick={() => deleteClosure(c.id)} className="text-red-500 text-sm">Delete</button>
                      </div>
                    ))}
                    {!closures.length && <p className="text-gray-400">No closures scheduled.</p>}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "Calls" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Call History</h2>
              {calls.length === 0 ? <p className="text-gray-400">No calls yet.</p> : (
                <div className="space-y-3">
                  {calls.map(c => (
                    <div key={c.id} className="p-4 border rounded-xl">
                      <div className="flex justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{c.caller_number || "Unknown"}</span>
                          <span className="text-sm text-gray-400">{Math.floor((c.duration_seconds || 0) / 60)}m {(c.duration_seconds || 0) % 60}s</span>
                          {c.transferred && <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">Transferred</span>}
                        </div>
                        <span className="text-sm text-gray-400">{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      {c.summary && <p className="text-sm mb-2 whitespace-pre-wrap"><span className="font-medium">Summary:</span> {plainSummary(c.summary)}</p>}
                      {c.transcript && (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-blue-600">View Transcript</summary>
                          <pre className="mt-2 p-3 bg-gray-50 rounded-lg whitespace-pre-wrap text-xs">{c.transcript}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "Transfers" && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Transfer Handoffs</h2>
              <p className="text-gray-500 text-sm mb-6">
                When a caller asks for a human, each attempt is logged with caller ID, time, destination, and reason — so staff have context even if the bridge fails.
              </p>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <div className="space-y-3">
                  {handoffs.map(h => (
                    <div key={h.id} className="p-4 border rounded-xl">
                      <div className="flex flex-wrap justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{h.caller_number || "Unknown caller"}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            h.status === "connected" ? "bg-green-100 text-green-700" :
                            h.status === "number_given" ? "bg-amber-100 text-amber-800" :
                            h.status === "failed" ? "bg-red-100 text-red-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>{h.status}</span>
                        </div>
                        <span className="text-sm text-gray-400">{new Date(h.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        → {h.agent_name} ({h.agent_phone})
                        {h.department ? ` · ${h.department}` : ""}
                      </p>
                      {(h.reason || h.context_summary) && (
                        <p className="text-sm text-gray-500 mt-1">{h.context_summary || h.reason}</p>
                      )}
                    </div>
                  ))}
                  {!handoffs.length && (
                    <p className="text-gray-400">No transfer attempts yet. Ask the AI to connect to a human on a test call.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "Agents" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Human Agents</h2>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <input value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Name" />
                    <input value={agentForm.phone} onChange={e => setAgentForm({ ...agentForm, phone: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="+61..." />
                    <input value={agentForm.department} onChange={e => setAgentForm({ ...agentForm, department: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Department" />
                    <button onClick={addAgent} disabled={saving || !agentForm.name || !agentForm.phone} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">Add Agent</button>
                  </div>
                  <div className="space-y-2">
                    {agents.map(a => (
                      <div key={a.id} className="p-3 border rounded-lg flex justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{a.name}</span>
                          <span className="text-gray-500">{a.phone}</span>
                          <button onClick={() => toggleAgent(a)} className={`text-xs px-2 py-0.5 rounded-full ${a.is_available ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{a.is_available ? "Available" : "Unavailable"}</button>
                        </div>
                        <button onClick={() => deleteAgent(a.id)} className="text-red-500 text-sm">Delete</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "Offers" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Offer Rules</h2>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <input value={offerForm.condition} onChange={e => setOfferForm({ ...offerForm, condition: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Condition" />
                    <input type="number" value={offerForm.discount_percent} onChange={e => setOfferForm({ ...offerForm, discount_percent: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Discount %" />
                    <button onClick={addOffer} disabled={saving || !offerForm.condition || !offerForm.discount_percent} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">Add Rule</button>
                  </div>
                  <div className="space-y-2">
                    {offers.map(o => (
                      <div key={o.id} className="p-3 border rounded-lg flex justify-between">
                        <div><span className="font-medium">If {o.condition}</span><span className="text-blue-600 ml-2">{o.discount_percent}% off</span></div>
                        <button onClick={() => deleteOffer(o.id)} className="text-red-500 text-sm">Delete</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "Settings" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Settings</h2>
              {!business ? <p className="text-gray-400">Set up business first.</p> : (
                <div className="max-w-lg space-y-4">
                  <input value={bizForm.notification_email} onChange={e => setBizForm({ ...bizForm, notification_email: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="Notification email" />
                  <input value={bizForm.notification_telegram} onChange={e => setBizForm({ ...bizForm, notification_telegram: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="Telegram chat ID" />
                  <button onClick={saveBusiness} disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg">Save Settings</button>
                  <hr />
                  <h3 className="font-medium">Webhook URL</h3>
                  <code className="block p-3 bg-gray-50 rounded-lg text-sm break-all">https://aicallassistant.vercel.app/api/webhook</code>
                  <p className="text-sm text-gray-500">Voice/gender: change under <strong>Assistant</strong> tab, then click Update Business & Voice.</p>

                  <hr className="my-6" />
                  <h3 className="font-medium text-red-600">Danger Zone</h3>
                  <p className="text-sm text-gray-500">
                    Type <strong>DELETE</strong> below to enable destructive actions.
                  </p>
                  <input
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg border-red-200"
                    placeholder='Type DELETE to confirm'
                  />
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={clearAllData}
                      disabled={saving || deleteConfirm !== "DELETE"}
                      className="px-4 py-2 border border-red-300 text-red-600 rounded-lg disabled:opacity-40 text-left"
                    >
                      Clear all data (keep business profile)
                    </button>
                    <p className="text-xs text-gray-400">Removes products, knowledge, calls, appointments, agents, offers, hours, closures, handoffs.</p>
                    <button
                      onClick={deleteBusiness}
                      disabled={saving || deleteConfirm !== "DELETE"}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-40"
                    >
                      Delete entire business
                    </button>
                    <p className="text-xs text-gray-400">Deletes business + all data and removes the Vapi assistant if linked.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
