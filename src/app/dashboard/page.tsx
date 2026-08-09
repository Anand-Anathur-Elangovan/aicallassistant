
"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
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

const TABS = ["Overview", "Assistant", "Products", "Knowledge", "Calls", "Agents", "Offers", "Settings"] as const;
type Tab = (typeof TABS)[number];

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

export default function Dashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Overview");
  const [business, setBusiness] = useState<Business | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [offers, setOffers] = useState<OfferRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Business form
  const [bizForm, setBizForm] = useState({ name: "", description: "", phone: "", language: "en", voice_id: "rachel", notification_email: "", notification_telegram: "", transfer_message: "Please hold while I connect you to a team member." });
  // Product form
  const [prodForm, setProdForm] = useState({ name: "", description: "", price: "", min_price: "", currency: "USD", category: "" });
  // Knowledge form
  const [kbForm, setKbForm] = useState({ title: "", content: "" });
  // Agent form
  const [agentForm, setAgentForm] = useState({ name: "", phone: "", department: "" });
  // Offer form
  const [offerForm, setOfferForm] = useState({ condition: "", discount_percent: "", description: "" });

  const loadData = useCallback(async (bizId: string) => {
    const [p, k, c, a, o] = await Promise.all([
      api("GET", undefined, { resource: "products", business_id: bizId }),
      api("GET", undefined, { resource: "knowledge", business_id: bizId }),
      api("GET", undefined, { resource: "calls", business_id: bizId }),
      api("GET", undefined, { resource: "agents", business_id: bizId }),
      api("GET", undefined, { resource: "offers", business_id: bizId }),
    ]);
    setProducts(p || []);
    setKnowledge(k || []);
    setCalls(c || []);
    setAgents(a || []);
    setOffers(o || []);
  }, []);

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
          language: biz.language || "en", voice_id: biz.voice_id || "rachel",
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
      setBusiness(updated);
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
    if (created.id) { setProducts([created, ...products]); setProdForm({ name: "", description: "", price: "", min_price: "", currency: "USD", category: "" }); }
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

  async function logout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-lg">Loading...</div>;

  const totalCalls = calls.length;
  const totalDuration = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
  const transferredCalls = calls.filter(c => c.transferred).length;

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">AI Receptionist</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{business?.name || "No business"}</span>
          {business?.vapi_assistant_id && <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">Live</span>}
          <button onClick={logout} className="text-sm text-red-500 hover:underline">Logout</button>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <nav className="w-48 border-r p-4 space-y-1">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${tab === t ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-gray-50"}`}>
              {t}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto">

          {/* ─── Overview ─── */}
          {tab === "Overview" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Overview</h2>
              {!business ? (
                <div className="p-8 border rounded-xl text-center">
                  <h3 className="text-lg font-medium mb-2">Welcome! Set up your business first.</h3>
                  <p className="text-gray-500 mb-4">Go to the Assistant tab to configure your AI receptionist.</p>
                  <button onClick={() => setTab("Assistant")} className="px-6 py-2 bg-blue-600 text-white rounded-lg">Get Started</button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    {[
                      { label: "Total Calls", value: totalCalls },
                      { label: "Total Duration", value: `${Math.round(totalDuration / 60)}m` },
                      { label: "Transferred", value: transferredCalls },
                      { label: "Products", value: products.length },
                    ].map(s => (
                      <div key={s.label} className="p-4 border rounded-xl">
                        <div className="text-sm text-gray-500">{s.label}</div>
                        <div className="text-2xl font-bold mt-1">{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <h3 className="font-medium mb-3">Recent Calls</h3>
                  {calls.length === 0 ? <p className="text-gray-400">No calls yet. Your AI receptionist is ready and waiting!</p> : (
                    <div className="space-y-2">
                      {calls.slice(0, 5).map(c => (
                        <div key={c.id} className="p-3 border rounded-lg flex justify-between items-start">
                          <div>
                            <span className="font-medium">{c.caller_number || "Unknown"}</span>
                            <span className="text-gray-400 text-sm ml-2">{Math.round((c.duration_seconds || 0) / 60)}m {(c.duration_seconds || 0) % 60}s</span>
                            {c.transferred && <span className="ml-2 text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">Transferred</span>}
                            <p className="text-sm text-gray-500 mt-1">{c.summary || "No summary"}</p>
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

          {/* ─── Assistant Setup ─── */}
          {tab === "Assistant" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Assistant Setup</h2>
              <div className="max-w-lg space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Business Name *</label>
                  <input value={bizForm.name} onChange={e => setBizForm({ ...bizForm, name: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="Your Company Name" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={bizForm.description} onChange={e => setBizForm({ ...bizForm, description: e.target.value })} className="w-full px-4 py-2 border rounded-lg" rows={3} placeholder="What does your business do? This helps the AI answer questions accurately." />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Business Phone</label>
                  <input value={bizForm.phone} onChange={e => setBizForm({ ...bizForm, phone: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="+1234567890" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Language</label>
                    <select value={bizForm.language} onChange={e => setBizForm({ ...bizForm, language: e.target.value })} className="w-full px-4 py-2 border rounded-lg">
                      <option value="en">English</option>
                      <option value="ta">Tamil</option>
                      <option value="hi">Hindi</option>
                      <option value="fr">French</option>
                      <option value="es">Spanish</option>
                      <option value="ar">Arabic</option>
                      <option value="zh">Chinese</option>
                      <option value="de">German</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Voice</label>
                    <select value={bizForm.voice_id} onChange={e => setBizForm({ ...bizForm, voice_id: e.target.value })} className="w-full px-4 py-2 border rounded-lg">
                      <option value="rachel">Rachel (Female)</option>
                      <option value="drew">Drew (Male)</option>
                      <option value="clyde">Clyde (Male)</option>
                      <option value="domi">Domi (Female)</option>
                      <option value="bella">Bella (Female)</option>
                      <option value="adam">Adam (Male)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Transfer Message</label>
                  <input value={bizForm.transfer_message} onChange={e => setBizForm({ ...bizForm, transfer_message: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="What AI says before transferring" />
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={saveBusiness} disabled={saving || !bizForm.name} className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                    {saving ? "Saving..." : business ? "Update Business" : "Create Business"}
                  </button>
                  {business && !business.vapi_assistant_id && (
                    <button onClick={createAssistant} disabled={saving} className="px-6 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50">
                      {saving ? "Creating..." : "Activate AI Assistant"}
                    </button>
                  )}
                </div>
                {business?.vapi_assistant_id && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg mt-4">
                    <p className="text-green-800 font-medium">AI Assistant is Active</p>
                    <p className="text-green-600 text-sm mt-1">ID: {business.vapi_assistant_id}</p>
                    <p className="text-green-600 text-sm">Your assistant is ready to take calls. Configure a phone number in Vapi dashboard to start receiving calls.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Products ─── */}
          {tab === "Products" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Products & Services</h2>
              {!business ? <p className="text-gray-400">Set up your business first in the Assistant tab.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <h3 className="font-medium">Add Product</h3>
                    <input value={prodForm.name} onChange={e => setProdForm({ ...prodForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Product Name" />
                    <input value={prodForm.description} onChange={e => setProdForm({ ...prodForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Description" />
                    <div className="grid grid-cols-3 gap-3">
                      <input type="number" value={prodForm.price} onChange={e => setProdForm({ ...prodForm, price: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Price" />
                      <input type="number" value={prodForm.min_price} onChange={e => setProdForm({ ...prodForm, min_price: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Min Price (optional)" />
                      <select value={prodForm.currency} onChange={e => setProdForm({ ...prodForm, currency: e.target.value })} className="px-3 py-2 border rounded-lg">
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                        <option value="INR">INR</option>
                      </select>
                    </div>
                    <input value={prodForm.category} onChange={e => setProdForm({ ...prodForm, category: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Category (optional)" />
                    <button onClick={addProduct} disabled={saving || !prodForm.name || !prodForm.price} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                      {saving ? "Adding..." : "Add Product"}
                    </button>
                  </div>

                  {products.length === 0 ? <p className="text-gray-400">No products yet. Add your products and services above.</p> : (
                    <div className="space-y-2">
                      {products.map(p => (
                        <div key={p.id} className="p-3 border rounded-lg flex justify-between items-center">
                          <div>
                            <span className="font-medium">{p.name}</span>
                            <span className="text-gray-500 ml-2">${p.price} {p.currency}</span>
                            {p.min_price && <span className="text-gray-400 text-sm ml-2">(min: ${p.min_price})</span>}
                            {p.category && <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full ml-2">{p.category}</span>}
                            {p.description && <p className="text-sm text-gray-400 mt-1">{p.description}</p>}
                          </div>
                          <button onClick={() => deleteProduct(p.id)} className="text-red-500 text-sm hover:underline">Delete</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── Knowledge Base ─── */}
          {tab === "Knowledge" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Knowledge Base</h2>
              {!business ? <p className="text-gray-400">Set up your business first in the Assistant tab.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <h3 className="font-medium">Add Knowledge Entry</h3>
                    <input value={kbForm.title} onChange={e => setKbForm({ ...kbForm, title: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Title (e.g., Return Policy, Business Hours)" />
                    <textarea value={kbForm.content} onChange={e => setKbForm({ ...kbForm, content: e.target.value })} className="w-full px-3 py-2 border rounded-lg" rows={4} placeholder="Content — the information your AI should know" />
                    <button onClick={addKnowledge} disabled={saving || !kbForm.title || !kbForm.content} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                      {saving ? "Adding..." : "Add Entry"}
                    </button>
                  </div>

                  {knowledge.length === 0 ? <p className="text-gray-400">No knowledge entries yet. Add FAQs, policies, and other info your AI should know.</p> : (
                    <div className="space-y-2">
                      {knowledge.map(k => (
                        <div key={k.id} className="p-3 border rounded-lg flex justify-between items-start">
                          <div>
                            <span className="font-medium">{k.title}</span>
                            <p className="text-sm text-gray-500 mt-1">{k.content.length > 200 ? k.content.slice(0, 200) + "..." : k.content}</p>
                          </div>
                          <button onClick={() => deleteKnowledge(k.id)} className="text-red-500 text-sm hover:underline ml-4">Delete</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── Call History ─── */}
          {tab === "Calls" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Call History</h2>
              {calls.length === 0 ? <p className="text-gray-400">No calls yet. Calls will appear here once your AI starts taking them.</p> : (
                <div className="space-y-3">
                  {calls.map(c => (
                    <div key={c.id} className="p-4 border rounded-xl">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{c.caller_number || "Unknown Caller"}</span>
                          <span className="text-sm text-gray-400">{Math.floor((c.duration_seconds || 0) / 60)}m {(c.duration_seconds || 0) % 60}s</span>
                          {c.transferred && <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">Transferred</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{c.status}</span>
                        </div>
                        <span className="text-sm text-gray-400">{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      {c.summary && <p className="text-sm mb-2"><span className="font-medium">Summary:</span> {c.summary}</p>}
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

          {/* ─── Agents ─── */}
          {tab === "Agents" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Human Agents</h2>
              <p className="text-gray-500 text-sm mb-6">Add team members who can take calls when the AI needs to transfer.</p>
              {!business ? <p className="text-gray-400">Set up your business first in the Assistant tab.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <h3 className="font-medium">Add Agent</h3>
                    <input value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Agent Name" />
                    <input value={agentForm.phone} onChange={e => setAgentForm({ ...agentForm, phone: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Phone Number (+1234567890)" />
                    <input value={agentForm.department} onChange={e => setAgentForm({ ...agentForm, department: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Department (sales, support, general)" />
                    <button onClick={addAgent} disabled={saving || !agentForm.name || !agentForm.phone} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                      {saving ? "Adding..." : "Add Agent"}
                    </button>
                  </div>

                  {agents.length === 0 ? <p className="text-gray-400">No agents added yet. Add your team members so the AI can transfer calls to them.</p> : (
                    <div className="space-y-2">
                      {agents.map(a => (
                        <div key={a.id} className="p-3 border rounded-lg flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{a.name}</span>
                            <span className="text-gray-500">{a.phone}</span>
                            {a.department && <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full">{a.department}</span>}
                            <button onClick={() => toggleAgent(a)} className={`text-xs px-2 py-0.5 rounded-full ${a.is_available ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {a.is_available ? "Available" : "Unavailable"}
                            </button>
                          </div>
                          <button onClick={() => deleteAgent(a.id)} className="text-red-500 text-sm hover:underline">Delete</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── Offers ─── */}
          {tab === "Offers" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Offer & Negotiation Rules</h2>
              <p className="text-gray-500 text-sm mb-6">Define when the AI can offer discounts. It will never go below your product&apos;s minimum price.</p>
              {!business ? <p className="text-gray-400">Set up your business first in the Assistant tab.</p> : (
                <>
                  <div className="max-w-lg space-y-3 mb-8 p-4 border rounded-xl">
                    <h3 className="font-medium">Add Offer Rule</h3>
                    <input value={offerForm.condition} onChange={e => setOfferForm({ ...offerForm, condition: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Condition (e.g., customer orders 5+ units)" />
                    <input type="number" value={offerForm.discount_percent} onChange={e => setOfferForm({ ...offerForm, discount_percent: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Discount % (e.g., 10)" min="1" max="100" />
                    <input value={offerForm.description} onChange={e => setOfferForm({ ...offerForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Description (optional)" />
                    <button onClick={addOffer} disabled={saving || !offerForm.condition || !offerForm.discount_percent} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                      {saving ? "Adding..." : "Add Rule"}
                    </button>
                  </div>

                  {offers.length === 0 ? <p className="text-gray-400">No offer rules yet. Add rules to let the AI handle price negotiations.</p> : (
                    <div className="space-y-2">
                      {offers.map(o => (
                        <div key={o.id} className="p-3 border rounded-lg flex justify-between items-center">
                          <div>
                            <span className="font-medium">If {o.condition}</span>
                            <span className="text-blue-600 ml-2">{o.discount_percent}% off</span>
                            {o.description && <p className="text-sm text-gray-400 mt-1">{o.description}</p>}
                          </div>
                          <button onClick={() => deleteOffer(o.id)} className="text-red-500 text-sm hover:underline">Delete</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── Settings ─── */}
          {tab === "Settings" && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Settings</h2>
              {!business ? <p className="text-gray-400">Set up your business first in the Assistant tab.</p> : (
                <div className="max-w-lg space-y-4">
                  <h3 className="font-medium">Notification Settings</h3>
                  <div>
                    <label className="block text-sm font-medium mb-1">Email for Call Summaries</label>
                    <input value={bizForm.notification_email} onChange={e => setBizForm({ ...bizForm, notification_email: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="you@company.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Telegram Chat ID</label>
                    <input value={bizForm.notification_telegram} onChange={e => setBizForm({ ...bizForm, notification_telegram: e.target.value })} className="w-full px-4 py-2 border rounded-lg" placeholder="Your Telegram chat ID" />
                  </div>
                  <button onClick={saveBusiness} disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                    {saving ? "Saving..." : "Save Settings"}
                  </button>

                  <hr className="my-6" />

                  <h3 className="font-medium">Webhook URL</h3>
                  <p className="text-sm text-gray-500 mb-2">Set this as the Server URL in your Vapi assistant settings:</p>
                  <code className="block p-3 bg-gray-50 rounded-lg text-sm break-all">
                    {typeof window !== "undefined" ? `${window.location.origin}/api/webhook` : "/api/webhook"}
                  </code>

                  <hr className="my-6" />

                  <h3 className="font-medium text-red-600">Danger Zone</h3>
                  <p className="text-sm text-gray-500">Deleting your business will remove all data including products, knowledge base, call history, agents, and offer rules.</p>
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

