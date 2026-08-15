import {
  buildAssistantPayload,
  buildFirstMessage,
  type BusinessForVapi,
} from "./config";

const VAPI_BASE = "https://api.vapi.ai";

export type VapiSyncFields = {
  voice_id: string;
  voice_speed: number;
  background_sound: string;
  background_sound_url: string | null;
  model_temperature: number;
  first_message: string | null;
  language: string;
};

export async function fetchVapiAssistant(assistantId: string) {
  const res = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
    headers: {
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vapi fetch failed: ${res.status} ${err}`);
  }
  return res.json();
}

const TRANSCRIBER_TO_APP_LANG: Record<string, string> = {
  multi: "auto",
  en: "en",
  it: "it",
  ta: "ta",
  hi: "hi",
  fr: "fr",
  es: "es",
  de: "de",
};

export function extractVapiSettings(assistant: Record<string, unknown>): VapiSyncFields {
  const voice = (assistant.voice || {}) as Record<string, unknown>;
  const model = (assistant.model || {}) as Record<string, unknown>;
  const transcriber = (assistant.transcriber || {}) as Record<string, unknown>;
  const bg = assistant.backgroundSound;

  let background_sound = "office";
  let background_sound_url: string | null = null;
  if (bg === "off") {
    background_sound = "off";
  } else if (typeof bg === "string" && bg !== "office") {
    background_sound = "custom";
    background_sound_url = bg;
  }

  const transcriberLang = String(transcriber.language || "multi");

  return {
    voice_id: String(voice.voiceId || "Elliot"),
    voice_speed: typeof voice.speed === "number" ? voice.speed : 1,
    background_sound,
    background_sound_url,
    model_temperature:
      typeof model.temperature === "number" ? model.temperature : 0.78,
    first_message: assistant.firstMessage
      ? String(assistant.firstMessage)
      : null,
    language: TRANSCRIBER_TO_APP_LANG[transcriberLang] || "auto",
  };
}

export function compareVapiWithApp(
  assistant: Record<string, unknown>,
  business: BusinessForVapi
) {
  const live = extractVapiSettings(assistant);
  const expectedFirst =
    business.first_message?.trim() || buildFirstMessage(business.name);

  return {
    live,
    drift: {
      voice_id: live.voice_id !== (business.voice_id || "Elliot"),
      voice_speed:
        Math.abs(live.voice_speed - (business.voice_speed ?? 1)) > 0.01,
      background_sound:
        live.background_sound !== (business.background_sound || "office"),
      model_temperature:
        Math.abs(
          live.model_temperature - (business.model_temperature ?? 0.78)
        ) > 0.01,
      first_message: live.first_message !== expectedFirst,
      firstMessageLive: live.first_message,
      firstMessageApp: expectedFirst,
    },
    hasDrift: false as boolean,
  };
}

export function compareVapiWithAppFull(
  assistant: Record<string, unknown>,
  business: BusinessForVapi
) {
  const result = compareVapiWithApp(assistant, business);
  result.hasDrift = Object.entries(result.drift).some(
    ([k, v]) => k !== "firstMessageLive" && k !== "firstMessageApp" && v === true
  );
  return result;
}

export async function syncToVapi(
  assistantId: string,
  business: BusinessForVapi,
  options?: { forceVapiProvider?: boolean }
) {
  const payload = buildAssistantPayload(business, undefined, options);
  const res = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || `Vapi sync failed: ${res.status}`);
  }
  return data;
}

export { buildAssistantPayload };
export type { BusinessForVapi };
