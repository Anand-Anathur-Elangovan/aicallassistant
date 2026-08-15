import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  createVapiAssistant,
  updateVapiAssistant,
  generateEmbedding,
  buildSystemPrompt,
  resolveVoice,
  resolveTranscriberLanguage,
  buildVapiTools,
  buildFirstMessage,
  MAX_CALL_DURATION_SECONDS,
} from "@/lib/config";
import { createClient } from "@supabase/supabase-js";
import { ensureDefaultStoreHours } from "@/lib/scheduling";

async function getUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data } = await userClient.auth.getUser();
  return data.user;
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const resource = searchParams.get("resource");
  const businessId = searchParams.get("business_id");

  if (resource === "businesses") {
    const { data } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return NextResponse.json(data || []);
  }

  if (!businessId) {
    return NextResponse.json({ error: "business_id required" }, { status: 400 });
  }

  const { data: biz } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("user_id", user.id)
    .single();
  if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tableMap: Record<string, string> = {
    products: "products",
    knowledge: "knowledge_base",
    calls: "call_logs",
    agents: "agents",
    offers: "offer_rules",
    appointments: "appointments",
    hours: "store_hours",
    closures: "store_closures",
    handoffs: "transfer_handoffs",
    leads: "leads",
  };

  if (resource === "reports") {
    const { data: calls } = await supabaseAdmin
      .from("call_logs")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    const { data: appointments } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .eq("business_id", businessId)
      .order("scheduled_at", { ascending: true });
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    const allCalls = calls || [];
    const allAppts = appointments || [];
    const allLeads = leads || [];
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const callsWeek = allCalls.filter((c) => new Date(c.created_at) >= weekAgo);
    const totalDuration = allCalls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
    const transferred = allCalls.filter((c) => c.transferred).length;
    const maxDurationHits = allCalls.filter(
      (c) => c.status === "max_duration" || (c.duration_seconds || 0) >= MAX_CALL_DURATION_SECONDS - 15
    ).length;
    const upcoming = allAppts.filter(
      (a) => a.status === "scheduled" && new Date(a.scheduled_at) >= now
    );
    const byDay: Record<string, number> = {};
    const byHour: Record<number, number> = {};
    const byIntent: Record<string, number> = {};
    for (const c of callsWeek) {
      const d = c.created_at.slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
      const hour = new Date(c.created_at).getHours();
      byHour[hour] = (byHour[hour] || 0) + 1;
    }
    for (const c of allCalls) {
      const intent = c.intent || "general";
      byIntent[intent] = (byIntent[intent] || 0) + 1;
    }
    const newLeads = allLeads.filter((l) => l.status === "new").length;

    return NextResponse.json({
      totals: {
        calls: allCalls.length,
        callsThisWeek: callsWeek.length,
        totalDurationMinutes: Math.round(totalDuration / 60),
        avgDurationSeconds: allCalls.length
          ? Math.round(totalDuration / allCalls.length)
          : 0,
        transferred,
        transferRate: allCalls.length
          ? Math.round((transferred / allCalls.length) * 100)
          : 0,
        upcomingAppointments: upcoming.length,
        appointmentsTotal: allAppts.length,
        leadsTotal: allLeads.length,
        newLeads,
        maxDurationHits,
      },
      callsByDay: Object.entries(byDay)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      callsByHour: Object.entries(byHour)
        .map(([hour, count]) => ({ hour: parseInt(hour), count }))
        .sort((a, b) => a.hour - b.hour),
      intentBreakdown: Object.entries(byIntent)
        .map(([intent, count]) => ({ intent, count }))
        .sort((a, b) => b.count - a.count),
      recentCalls: allCalls.slice(0, 10),
      upcomingAppointments: upcoming.slice(0, 10),
      recentLeads: allLeads.slice(0, 5),
    });
  }

  const table = tableMap[resource || ""];
  if (!table) return NextResponse.json({ error: "Invalid resource" }, { status: 400 });

  if (resource === "hours") {
    await ensureDefaultStoreHours(businessId);
  }

  let query = supabaseAdmin
    .from(table)
    .select("*")
    .eq("business_id", businessId);

  if (resource === "hours") {
    query = query.order("day_of_week", { ascending: true });
  } else if (resource === "appointments") {
    query = query.order("scheduled_at", { ascending: false });
  } else if (resource === "handoffs") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data } = await query;
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action, ...payload } = body;

  // ─── Business ───
  if (action === "create_business") {
    // Ensure profile exists (signup trigger may have been missing)
    await supabaseAdmin.from("profiles").upsert({
      id: user.id,
      email: user.email || "",
      full_name: (user.user_metadata?.full_name as string) || "",
    });

    const { data, error } = await supabaseAdmin
      .from("businesses")
      .insert({ ...payload, user_id: user.id })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "update_business") {
    const { id, ...updates } = payload;
    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await supabaseAdmin
      .from("businesses")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (biz.vapi_assistant_id) {
      const merged = { ...biz, ...updates };
      const { data: products } = await supabaseAdmin
        .from("products")
        .select("name, price, currency")
        .eq("business_id", id);
      const { data: offers } = await supabaseAdmin
        .from("offer_rules")
        .select("condition, discount_percent")
        .eq("business_id", id)
        .eq("is_active", true);

      const systemPrompt = buildSystemPrompt({
        ...merged,
        products: products || [],
        offer_rules: offers || [],
      });
      await updateVapiAssistant(biz.vapi_assistant_id, {
        model: {
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          temperature: 0.82,
          messages: [{ role: "system", content: systemPrompt }],
          tools: buildVapiTools(),
        },
        maxDurationSeconds: MAX_CALL_DURATION_SECONDS,
        voice: resolveVoice(
          (updates.voice_id as string) || merged.voice_id
        ),
        firstMessage: buildFirstMessage(merged.name),
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: resolveTranscriberLanguage(
            (updates.language as string) || merged.language
          ),
        },
      });
    }

    return NextResponse.json(data);
  }

  // ─── Create Vapi Assistant ───
  if (action === "create_assistant") {
    const { business_id } = payload;
    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("id", business_id)
      .eq("user_id", user.id)
      .single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: products } = await supabaseAdmin
      .from("products")
      .select("name, price, currency")
      .eq("business_id", business_id);
    const { data: offers } = await supabaseAdmin
      .from("offer_rules")
      .select("condition, discount_percent")
      .eq("business_id", business_id)
      .eq("is_active", true);

    const serverUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`;
    const assistant = await createVapiAssistant(
      { ...biz, products: products || [], offer_rules: offers || [] },
      serverUrl
    );

    if (assistant.id) {
      await supabaseAdmin
        .from("businesses")
        .update({ vapi_assistant_id: assistant.id })
        .eq("id", business_id);
    }

    return NextResponse.json(assistant);
  }

  // ─── Products ───
  if (action === "create_product") {
    const { business_id, name, description, price, min_price, currency, category } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let embedding = null;
    try {
      embedding = await generateEmbedding(`${name} ${description || ""} ${category || ""}`);
    } catch { /* embedding optional */ }

    const { data, error } = await supabaseAdmin
      .from("products")
      .insert({ business_id, name, description, price, min_price, currency, category, embedding })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "update_product") {
    const { id, business_id, ...updates } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (updates.name || updates.description) {
      try {
        updates.embedding = await generateEmbedding(`${updates.name || ""} ${updates.description || ""}`);
      } catch { /* optional */ }
    }

    const { data, error } = await supabaseAdmin.from("products").update(updates).eq("id", id).eq("business_id", business_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "delete_product") {
    const { id, business_id } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await supabaseAdmin.from("products").delete().eq("id", id).eq("business_id", business_id);
    return NextResponse.json({ ok: true });
  }

  // ─── Knowledge Base ───
  if (action === "add_knowledge") {
    const { business_id, title, content } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let embedding = null;
    try {
      embedding = await generateEmbedding(`${title} ${content}`);
    } catch { /* optional */ }

    const { data, error } = await supabaseAdmin
      .from("knowledge_base")
      .insert({ business_id, title, content, embedding })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "delete_knowledge") {
    const { id, business_id } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await supabaseAdmin.from("knowledge_base").delete().eq("id", id).eq("business_id", business_id);
    return NextResponse.json({ ok: true });
  }

  // ─── Agents ───
  if (action === "add_agent") {
    const { business_id, name, phone, department } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await supabaseAdmin.from("agents").insert({ business_id, name, phone, department }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "update_agent") {
    const { id, business_id, ...updates } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await supabaseAdmin.from("agents").update(updates).eq("id", id).eq("business_id", business_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "delete_agent") {
    const { id, business_id } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await supabaseAdmin.from("agents").delete().eq("id", id).eq("business_id", business_id);
    return NextResponse.json({ ok: true });
  }

  // ─── Offer Rules ───
  if (action === "add_offer_rule") {
    const { business_id, condition, discount_percent, description } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await supabaseAdmin
      .from("offer_rules")
      .insert({ business_id, condition, discount_percent, description })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "update_offer_rule") {
    const { id, business_id, ...updates } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await supabaseAdmin.from("offer_rules").update(updates).eq("id", id).eq("business_id", business_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "delete_offer_rule") {
    const { id, business_id } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await supabaseAdmin.from("offer_rules").delete().eq("id", id).eq("business_id", business_id);
    return NextResponse.json({ ok: true });
  }

  // ─── Store hours ───
  if (action === "save_store_hours") {
    const { business_id, hours } = payload as {
      business_id: string;
      hours: {
        day_of_week: number;
        is_closed: boolean;
        open_time: string;
        close_time: string;
        max_appointments: number;
        slot_minutes: number;
      }[];
    };
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    for (const h of hours || []) {
      await supabaseAdmin.from("store_hours").upsert(
        {
          business_id,
          day_of_week: h.day_of_week,
          is_closed: h.is_closed,
          open_time: h.open_time,
          close_time: h.close_time,
          max_appointments: h.max_appointments,
          slot_minutes: h.slot_minutes,
        },
        { onConflict: "business_id,day_of_week" }
      );
    }
    const { data } = await supabaseAdmin
      .from("store_hours")
      .select("*")
      .eq("business_id", business_id)
      .order("day_of_week");
    return NextResponse.json(data || []);
  }

  // ─── Closures ───
  if (action === "add_closure") {
    const { business_id, start_date, end_date, reason, is_emergency } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await supabaseAdmin
      .from("store_closures")
      .insert({ business_id, start_date, end_date, reason, is_emergency: !!is_emergency })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "delete_closure") {
    const { id, business_id } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await supabaseAdmin.from("store_closures").delete().eq("id", id).eq("business_id", business_id);
    return NextResponse.json({ ok: true });
  }

  // ─── Appointments ───
  if (action === "create_appointment") {
    const { business_id, customer_name, customer_phone, customer_email, showroom, scheduled_at, notes } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { bookAppointment } = await import("@/lib/scheduling");
    const result = await bookAppointment({
      businessId: business_id,
      customer_name,
      customer_phone,
      customer_email,
      showroom,
      scheduled_at,
      notes,
      source: "dashboard",
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result.appointment);
  }

  if (action === "update_appointment") {
    const { id, business_id, ...updates } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update(updates)
      .eq("id", id)
      .eq("business_id", business_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "delete_appointment") {
    const { id, business_id } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await supabaseAdmin.from("appointments").delete().eq("id", id).eq("business_id", business_id);
    return NextResponse.json({ ok: true });
  }

  if (action === "update_lead_status") {
    const { id, business_id, status } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await supabaseAdmin
      .from("leads")
      .update({ status })
      .eq("id", id)
      .eq("business_id", business_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  if (action === "delete_lead") {
    const { id, business_id } = payload;
    const { data: biz } = await supabaseAdmin.from("businesses").select("id").eq("id", business_id).eq("user_id", user.id).single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await supabaseAdmin.from("leads").delete().eq("id", id).eq("business_id", business_id);
    return NextResponse.json({ ok: true });
  }

  // ─── Danger zone: wipe business data ───
  if (action === "clear_business_data") {
    const { business_id, confirm } = payload;
    if (confirm !== "DELETE") {
      return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 });
    }
    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("id", business_id)
      .eq("user_id", user.id)
      .single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const tables = [
      "leads",
      "transfer_handoffs",
      "appointments",
      "store_closures",
      "store_hours",
      "call_logs",
      "offer_rules",
      "agents",
      "knowledge_base",
      "products",
    ];
    for (const table of tables) {
      await supabaseAdmin.from(table).delete().eq("business_id", business_id);
    }
    return NextResponse.json({ ok: true, cleared: tables });
  }

  if (action === "delete_business") {
    const { business_id, confirm } = payload;
    if (confirm !== "DELETE") {
      return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 });
    }
    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("id", business_id)
      .eq("user_id", user.id)
      .single();
    if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (biz.vapi_assistant_id && process.env.VAPI_API_KEY) {
      try {
        await fetch(`https://api.vapi.ai/assistant/${biz.vapi_assistant_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
        });
      } catch (e) {
        console.error("Vapi assistant delete failed:", e);
      }
    }

    const { error } = await supabaseAdmin
      .from("businesses")
      .delete()
      .eq("id", business_id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

