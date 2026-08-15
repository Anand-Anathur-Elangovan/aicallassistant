export const VOICE_OPTIONS = [
  { id: "Elliot", label: "Elliot (Male, American)", provider: "vapi" as const },
  { id: "Rohan", label: "Rohan (Male)", provider: "vapi" as const },
  { id: "Savannah", label: "Savannah (Female)", provider: "vapi" as const },
  { id: "Neha", label: "Neha (Female)", provider: "vapi" as const },
  { id: "rachel", label: "Rachel (Female) — needs ElevenLabs key", provider: "11labs" as const },
  { id: "adam", label: "Adam (Male) — needs ElevenLabs key", provider: "11labs" as const },
  { id: "bella", label: "Bella (Female) — needs ElevenLabs key", provider: "11labs" as const },
  { id: "drew", label: "Drew (Male) — needs ElevenLabs key", provider: "11labs" as const },
];

export const VAPI_VOICES = VOICE_OPTIONS.filter((v) => v.provider === "vapi");
export const ELEVENLABS_VOICES = VOICE_OPTIONS.filter((v) => v.provider === "11labs");
