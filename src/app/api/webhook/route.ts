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

    // transferToAgent — Live Call Control transfer (same call bridged to human)
    if (fnName === "transferToAgent" || fnName === "transfer_call") {
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

      if (!targetAgent?.phone) {
        return NextResponse.json({
          result:
            "I'm sorry, no team members are currently available. Can I take a message with your name and number? I'll make sure they call you back as soon as possible.",
        });
      }

      const agentPhone = targetAgent.phone;
      const spokenNumber = agentPhone.replace(/^\+/, "plus ");
      const numberFallback = `I wasn't able to connect you automatically. You can call ${targetAgent.name} directly on ${agentPhone}. Would you like me to repeat that number slowly so you can note it down?`;

      const controlUrl =
        call?.monitor?.controlUrl ||
        message?.call?.monitor?.controlUrl ||
        body?.call?.monitor?.controlUrl;

      const holdMessage =
        business.transfer_message ||
        `Please hold while I connect you to ${targetAgent.name}.`;

      // Context note for warm handoff (spoken to operator on capable carriers)
      const handoffNote = [
        args.reason ? `Reason: ${args.reason}` : null,
        args.department ? `Department: ${args.department}` : null,
        `Caller requested transfer to ${targetAgent.name}.`,
      ]
        .filter(Boolean)
        .join(" ");

      if (controlUrl) {
        try {
          const transferRes = await fetch(`${controlUrl}/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "transfer",
              destination: {
                type: "number",
                number: agentPhone,
                transferPlan: {
                  mode: "warm-transfer-say-summary",
                  message: handoffNote,
                },
              },
              content: holdMessage,
            }),
          });

          if (!transferRes.ok) {
            const errText = await transferRes.text();
            console.error("Transfer control failed:", transferRes.status, errText);
            // Fallback: cold transfer without warm plan (free Vapi numbers / intl often need this)
            const coldRes = await fetch(`${controlUrl}/control`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "transfer",
                destination: {
                  type: "number",
                  number: agentPhone,
                },
                content: holdMessage,
              }),
            });
            if (!coldRes.ok) {
              const coldErr = await coldRes.text();
              console.error("Cold transfer failed:", coldRes.status, coldErr);
              return NextResponse.json({
                result: `${numberFallback} The number again is ${spokenNumber}. If they ask you to confirm, read it digit by digit and ask them to repeat it back.`,
              });
            }
          }

          return NextResponse.json({
            result: `Connecting you to ${targetAgent.name} at ${agentPhone} now. ${holdMessage}`,
          });
        } catch (err) {
          console.error("Transfer error:", err);
          return NextResponse.json({
            result: `${numberFallback} The number is ${spokenNumber}. Offer to repeat it slowly and confirm digit by digit if they ask.`,
          });
        }
      }

      // No control URL — give the direct number
      return NextResponse.json({
        result: `${numberFallback} The number is ${spokenNumber}. Offer to repeat it slowly and confirm digit by digit if they ask.`,
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
        "You summarize phone call transcripts in plain text only. No markdown, no # headers, no **bold**. Use short labeled lines like: Request: ... Outcome: ... Action items: ... Transferred: yes/no.",
        `Summarize this call transcript:\n\n${transcript}`
      );
    }
    // Strip markdown if model still returns it
    if (callSummary) {
      callSummary = callSummary
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
    }

    const startedAt = call?.startedAt ? new Date(call.startedAt) : null;
    const endedAt = call?.endedAt ? new Date(call.endedAt) : null;
    const duration =
      startedAt && endedAt
        ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
        : 0;

    const transferredTo =
      call?.forwardedPhoneNumber ||
      call?.destination?.number ||
      null;

    await supabaseAdmin.from("call_logs").insert({
      business_id: business.id,
      vapi_call_id: call?.id,
      caller_number: call?.customer?.number || "Unknown",
      duration_seconds: duration,
      transcript: transcript || "",
      summary: callSummary || "",
      status: call?.endedReason || "completed",
      transferred: !!transferredTo,
      transferred_to: transferredTo,
    });

    await sendCallSummary(business, {
      caller: call?.customer?.number || "Unknown",
      duration,
      summary: callSummary || "No summary available",
      transferred: !!transferredTo,
    });

    return NextResponse.json({ ok: true });
  }

  // ─── Status Updates ───
  if (messageType === "status-update") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}


