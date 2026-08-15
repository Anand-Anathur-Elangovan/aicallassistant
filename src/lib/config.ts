import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "./supabase-admin";

export { supabaseAdmin };

// ─── Claude (server-only; never import this file from client components) ───
function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await getAnthropic().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: [text], model: "voyage-2" }),
  });
  const data = await response.json();
  return data.data[0].embedding;
}

// ─── Vapi ───
const VAPI_BASE = "https://api.vapi.ai";

async function vapiRequest(path: string, method: string, body?: unknown) {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function buildSystemPrompt(business: {
  name: string;
  description?: string;
  working_hours?: Record<string, string>;
  transfer_message?: string;
  language?: string;
  products?: { name: string; price: number; currency: string }[];
  offer_rules?: { condition: string; discount_percent: number }[];
}) {
  const hours = business.working_hours
    ? Object.entries(business.working_hours)
        .map(([day, time]) => `${day}: ${time}`)
        .join(", ")
    : "Not specified";

  const productList = business.products?.length
    ? business.products
        .map((p) => `- ${p.name}: ${p.price} ${p.currency}`)
        .join("\n")
    : "Use the checkProduct tool to look up products.";

  const offerList = business.offer_rules?.length
    ? business.offer_rules
        .map((o) => `- If ${o.condition}: offer ${o.discount_percent}% discount`)
        .join("\n")
    : "No automatic discounts configured.";

  return `You are a professional, warm, and helpful receptionist for ${business.name}.
${business.description || ""}

CORE RULES:
- Always be polite, professional, and conversational — sound like a real human receptionist
- Speak in the caller's language. Default: ${
    business.language === "multi" || business.language === "auto"
      ? "Auto-detect from the caller (English, Italian, Tamil, Hindi, etc.)"
      : business.language || "English"
  }
- NEVER make up product details or prices — always use the checkProduct or searchKnowledge tools first
- NEVER quote a price below the minimum price (min_price) for any product
- If the caller wants to negotiate, check available offers using the checkOffers tool
- If negotiation exceeds your authority (below min_price or no matching offer), say: "${business.transfer_message || "Let me connect you to a team member who can help."}" and use transferToAgent

PRODUCT REFERENCE:
${productList}

OFFER RULES:
${offerList}

BUSINESS HOURS: ${hours}

APPOINTMENTS / SHOWROOM VISITS:
- Product questions, pricing, and general info work ANY time — even outside business hours
- ONLY use checkAvailability / bookAppointment when the caller wants to VISIT the showroom in person
- If checkAvailability says the store is closed right now, explain why and offer the next open slots — do NOT book for a closed time
- Always collect customer name and phone before booking
- Confirm the booked date/time clearly with the caller

AFTER-HOURS & TRANSFERS:
- transferToAgent only works during staffed hours — if the tool says staff are unavailable, do NOT retry transfer
- When transfer is blocked after hours, use captureLead to record a callback (name, phone, reason)
- You can still answer questions, check products, and book future visits anytime

TRANSFER FALLBACK:
- If transferToAgent fails or cannot connect, give the human agent's phone number clearly
- Offer to repeat the number slowly; use captureLead if they want a callback instead

ESCALATION RULES:
- If the caller explicitly asks to speak to a person → try transferToAgent (or captureLead if after hours)
- If upset or angry → acknowledge, then transfer or captureLead
- If you cannot answer after checking knowledge → offer transfer or captureLead

LEADS / CALLBACKS (captureLead tool):
- Use when: caller wants a callback, transfer failed, after-hours transfer request, or they ask to leave a message
- Collect: name (required), phone, what they're interested in, and a short message
- Confirm the team will call back during business hours`;
}

export const MAX_CALL_DURATION_SECONDS = 480;

export function buildVapiTools() {
  return [
    {
      type: "function",
      function: {
        name: "checkProduct",
        description:
          "Look up product or service details including price, availability, and description",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Product name or search query" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "searchKnowledge",
        description:
          "Search the business knowledge base for answers to questions about policies, hours, FAQs, etc.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The question or topic to search for" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "checkOffers",
        description:
          "Check available discounts and offers based on the customer's situation",
        parameters: {
          type: "object",
          properties: {
            situation: {
              type: "string",
              description: "Description of why the customer wants a discount",
            },
          },
          required: ["situation"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "transferToAgent",
        description:
          "Transfer the call to a human agent during business hours. Use when customer requests a human or issue needs escalation.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Why the transfer is needed" },
            department: {
              type: "string",
              description: "Preferred department (sales, support, general)",
            },
            urgent: { type: "boolean", description: "Whether this is an emergency/urgent transfer" },
          },
          required: ["reason"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "captureLead",
        description:
          "Record a callback request or lead when the caller wants someone to call them back, leave a message, or transfer is unavailable.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Caller's full name" },
            phone: { type: "string", description: "Callback phone number" },
            email: { type: "string", description: "Email if provided" },
            interest: {
              type: "string",
              description: "What they are interested in (product, visit, support, etc.)",
            },
            message: { type: "string", description: "Brief message or reason for callback" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "checkAvailability",
        description:
          "Check available showroom visit appointment slots and any store closures. Use only for in-person visits.",
        parameters: {
          type: "object",
          properties: {
            from_date: { type: "string", description: "Start date YYYY-MM-DD (default today)" },
            showroom: { type: "string", description: "richmond, moorabbin, or general" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "bookAppointment",
        description:
          "Book a showroom visit after confirming availability. Requires customer name and preferred datetime.",
        parameters: {
          type: "object",
          properties: {
            customer_name: { type: "string" },
            customer_phone: { type: "string" },
            showroom: { type: "string" },
            scheduled_at: {
              type: "string",
              description: "YYYY-MM-DD HH:MM or ISO datetime",
            },
            notes: { type: "string" },
          },
          required: ["customer_name", "scheduled_at"],
        },
      },
    },
  ];
}

export const VOICE_OPTIONS = [
  { id: "Elliot", label: "Elliot (Male)", provider: "vapi" },
  { id: "Rohan", label: "Rohan (Male)", provider: "vapi" },
  { id: "Savannah", label: "Savannah (Female)", provider: "vapi" },
  { id: "Neha", label: "Neha (Female)", provider: "vapi" },
  { id: "rachel", label: "Rachel (Female)", provider: "11labs" },
  { id: "adam", label: "Adam (Male)", provider: "11labs" },
  { id: "bella", label: "Bella (Female)", provider: "11labs" },
  { id: "drew", label: "Drew (Male)", provider: "11labs" },
] as const;

export function resolveVoice(voiceId?: string) {
  const found = VOICE_OPTIONS.find((v) => v.id === voiceId);
  if (found) return { provider: found.provider, voiceId: found.id };
  return { provider: "vapi", voiceId: "Elliot" };
}

/** Map app language setting to Deepgram/Vapi transcriber language */
export function resolveTranscriberLanguage(lang?: string) {
  if (!lang || lang === "auto" || lang === "multi") return "multi";
  const map: Record<string, string> = {
    en: "en",
    it: "it",
    ta: "ta",
    hi: "hi",
    fr: "fr",
    es: "es",
    de: "de",
  };
  return map[lang] || "en";
}

export async function createVapiAssistant(
  business: Parameters<typeof buildSystemPrompt>[0] & {
    voice_id?: string;
    language?: string;
  },
  serverUrl: string
) {
  const systemPrompt = buildSystemPrompt(business);

  return vapiRequest("/assistant", "POST", {
    name: `Receptionist - ${business.name}`,
    model: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "system", content: systemPrompt }],
      tools: buildVapiTools(),
    },
    maxDurationSeconds: MAX_CALL_DURATION_SECONDS,
    voice: resolveVoice(business.voice_id),
    firstMessage: `Hello, thank you for calling ${business.name}. How can I help you today?`,
    serverUrl,
    serverUrlSecret: process.env.VAPI_SERVER_SECRET || undefined,
    endCallPhrases: [
      "goodbye",
      "bye",
      "have a nice day",
      "that's all",
      "thank you, bye",
    ],
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: resolveTranscriberLanguage(business.language),
    },
  });
}

export async function updateVapiAssistant(
  assistantId: string,
  updates: Record<string, unknown>
) {
  return vapiRequest(`/assistant/${assistantId}`, "PATCH", updates);
}

// ─── Knowledge Search ───
export async function searchKnowledge(businessId: string, query: string) {
  try {
    const embedding = await generateEmbedding(query);
    const { data } = await supabaseAdmin.rpc("search_knowledge", {
      query_embedding: embedding,
      match_business_id: businessId,
      match_count: 3,
    });
    return data || [];
  } catch {
    const { data } = await supabaseAdmin
      .from("knowledge_base")
      .select("*")
      .eq("business_id", businessId)
      .ilike("content", `%${query}%`)
      .limit(3);
    return data || [];
  }
}

export async function searchProducts(businessId: string, query: string) {
  try {
    const embedding = await generateEmbedding(query);
    const { data } = await supabaseAdmin.rpc("search_products", {
      query_embedding: embedding,
      match_business_id: businessId,
      match_count: 5,
    });
    return data || [];
  } catch {
    const { data } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("business_id", businessId)
      .ilike("name", `%${query}%`)
      .limit(5);
    return data || [];
  }
}

// ─── Notifications ───
export async function sendCallSummary(
  business: {
    notification_email?: string;
    notification_telegram?: string;
    name: string;
  },
  summary: {
    caller: string;
    duration: number;
    summary: string;
    transferred: boolean;
  }
) {
  const message = `📞 Call Summary - ${business.name}
From: ${summary.caller || "Unknown"}
Duration: ${Math.round(summary.duration / 60)}m ${summary.duration % 60}s
Transferred: ${summary.transferred ? "Yes" : "No"}

${summary.summary}`;

  if (business.notification_telegram) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: business.notification_telegram,
            text: message,
          }),
        }
      );
    }
  }

  if (business.notification_email) {
    console.log(`[EMAIL] Would send to ${business.notification_email}:`, message);
  }
}
