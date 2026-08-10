import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  searchProducts,
  searchKnowledge,
  callClaude,
  sendCallSummary,
} from "@/lib/config";
import { getAvailableSlots, bookAppointment } from "@/lib/scheduling";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message } = body;

  // Verify webhook secret
  const secret = req.headers.get("x-vapi-secret");
  if (process.env.VAPI_SERVER_SECRET && secret !== process.env.VAPI_SERVER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messageType = message?.type || body.type;

  // ─── Assistant Request (dynamic config per phone number) ───
  if (messageType === "assistant-request") {
    const phoneNumber = body.phoneNumber?.number;
    if (!phoneNumber) {
      return NextResponse.json({ error: "No phone number" }, { status: 400 });
    }

    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("phone", phoneNumber)
      .single();

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    return NextResponse.json({ assistantId: business.vapi_assistant_id });
  }

  // ─── Function Calls ───
  if (messageType === "function-call" || messageType === "tool-calls") {
    const call = message?.call || body.call;
    const assistantId = call?.assistantId;

    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("vapi_assistant_id", assistantId)
      .single();

    if (!business) {
      return NextResponse.json({ result: "Business not found." });
    }

    const functionCall = message?.functionCall || body.functionCall;
    const toolCalls = message?.toolCalls || body.toolCalls;
    const fn = functionCall || toolCalls?.[0]?.function;

    if (!fn) {
      return NextResponse.json({ result: "No function specified." });
    }

    const fnName = fn.name;
    const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;

    // checkProduct
    if (fnName === "checkProduct") {
      const products = await searchProducts(business.id, args.query);
      if (!products.length) {
        return NextResponse.json({
          result: `No products found matching "${args.query}". Let me know if you'd like to ask about something else.`,
        });
      }
      const info = products
        .map(
          (p: { name: string; description: string; price: number; min_price: number; in_stock: boolean }) =>
            `${p.name}: ${p.description || "No description"}. Price: $${p.price}${p.min_price ? ` (negotiable down to $${p.min_price})` : " (fixed price)"}. ${p.in_stock ? "In stock" : "Out of stock"}`
        )
        .join("\n");
      return NextResponse.json({ result: info });
    }

    // searchKnowledge
    if (fnName === "searchKnowledge") {
      const results = await searchKnowledge(business.id, args.query);
      if (!results.length) {
        return NextResponse.json({
          result: "I don't have specific information about that. Would you like me to connect you with someone who can help?",
        });
      }
      const info = results
        .map((r: { title: string; content: string }) => `${r.title}: ${r.content}`)
        .join("\n\n");
      return NextResponse.json({ result: info });
    }

    // checkOffers
    if (fnName === "checkOffers") {
      const { data: rules } = await supabaseAdmin
        .from("offer_rules")
        .select("*")
        .eq("business_id", business.id)
        .eq("is_active", true);

      if (!rules?.length) {
        return NextResponse.json({
          result: "No special offers available right now. The listed prices are the best we can offer.",
        });
      }

      const matching = rules
        .map(
          (r: { condition: string; discount_percent: number; description: string }) =>
            `If ${r.condition}: ${r.discount_percent}% off${r.description ? ` — ${r.description}` : ""}`
        )
        .join("\n");
      return NextResponse.json({
        result: `Available offers:\n${matching}\n\nApply whichever matches the customer's situation. Never exceed these discount limits.`,
      });
    }

    // transferToAgent
    if (fnName === "transferToAgent") {
      const { data: agents } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("business_id", business.id)
        .eq("is_available", true)
        .order("created_at");

      let targetAgent = agents?.[0];
      if (args.department) {
        const deptAgent = agents?.find(
          (a: { department: string }) =>
            a.department?.toLowerCase() === args.department?.toLowerCase()
        );
        if (deptAgent) targetAgent = deptAgent;
      }

      if (!targetAgent) {
        return NextResponse.json({
          result:
            "I'm sorry, no team members are currently available. Can I take a message with your name and number? I'll make sure they call you back as soon as possible.",
        });
      }

      return NextResponse.json({
        result: `Transferring to ${targetAgent.name}. ${business.transfer_message || "Please hold."}`,
        forwardingPhoneNumber: targetAgent.phone,
      });
    }

    // checkAvailability
    if (fnName === "checkAvailability") {
      const fromDate =
        args.from_date || new Date().toISOString().slice(0, 10);
      const { available, closedNotes } = await getAvailableSlots(
        business.id,
        fromDate,
        14,
        args.showroom
      );
      const closedText = closedNotes.length
        ? `\nClosed / unavailable dates:\n${closedNotes
            .map(
              (c) =>
                `- ${c.date}: ${c.reason}${c.is_emergency ? " (emergency)" : ""}`
            )
            .join("\n")}`
        : "";
      const availText = available.length
        ? available
            .map(
              (d) =>
                `${d.day} ${d.date}: ${d.slots.slice(0, 5).join(", ")}`
            )
            .join("\n")
        : "No open slots in the next 2 weeks.";
      return NextResponse.json({
        result: `Available appointment slots:\n${availText}${closedText}\n\nOffer closed dates' reasons to the caller and suggest another available slot.`,
      });
    }

    // bookAppointment
    if (fnName === "bookAppointment") {
      const result = await bookAppointment({
        businessId: business.id,
        customer_name: args.customer_name,
        customer_phone: args.customer_phone,
        showroom: args.showroom || "general",
        scheduled_at: args.scheduled_at,
        notes: args.notes,
        source: "ai",
      });
      if (result.error) {
        return NextResponse.json({
          result: `${result.error} Please use checkAvailability and offer another time.`,
        });
      }
      return NextResponse.json({
        result: `Appointment booked for ${result.appointment.customer_name} on ${result.appointment.scheduled_at} at ${result.appointment.showroom}. Confirm this with the caller.`,
      });
    }

    return NextResponse.json({ result: "I'm not sure how to handle that. Let me connect you with someone who can help." });
  }

  // ─── End of Call Report ───
  if (messageType === "end-of-call-report") {
    const call = message?.call || body.call;
    const transcript = message?.transcript || body.transcript;
    const summary = message?.summary || body.summary;
    const assistantId = call?.assistantId;

    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("vapi_assistant_id", assistantId)
      .single();

    if (!business) {
      return NextResponse.json({ ok: true });
    }

    let callSummary = summary;
    if (!callSummary && transcript) {
      callSummary = await callClaude(
        "You summarize phone call transcripts concisely. Include: caller's main request, outcome, any action items, and whether the call was transferred.",
        `Summarize this call transcript:\n\n${transcript}`
      );
    }

    const startedAt = call?.startedAt ? new Date(call.startedAt) : null;
    const endedAt = call?.endedAt ? new Date(call.endedAt) : null;
    const duration =
      startedAt && endedAt
        ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
        : 0;

    await supabaseAdmin.from("call_logs").insert({
      business_id: business.id,
      vapi_call_id: call?.id,
      caller_number: call?.customer?.number || "Unknown",
      duration_seconds: duration,
      transcript: transcript || "",
      summary: callSummary || "",
      status: call?.endedReason || "completed",
      transferred: call?.forwardedPhoneNumber ? true : false,
      transferred_to: call?.forwardedPhoneNumber || null,
    });

    await sendCallSummary(business, {
      caller: call?.customer?.number || "Unknown",
      duration,
      summary: callSummary || "No summary available",
      transferred: !!call?.forwardedPhoneNumber,
    });

    return NextResponse.json({ ok: true });
  }

  // ─── Status Updates ───
  if (messageType === "status-update") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}


