import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  createVapiAssistant,
  updateVapiAssistant,
  generateEmbedding,
  buildSystemPrompt,
} from "@/lib/config";
import { createClient } from "@supabase/supabase-js";

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
  };

  const table = tableMap[resource || ""];
  if (!table) return NextResponse.json({ error: "Invalid resource" }, { status: 400 });

  const { data } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

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
          messages: [{ role: "system", content: systemPrompt }],
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

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

