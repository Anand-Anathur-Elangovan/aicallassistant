import { callClaude } from "./config";

const VALID = new Set(["sales", "support", "booking", "complaint", "general"]);

export function classifyIntentFromText(summary: string, transcript: string): string {
  const text = `${summary}\n${transcript}`.toLowerCase();
  if (/\b(book|booking|appointment|visit|showroom|schedule|reserv)\w*/.test(text)) return "booking";
  if (/\b(complaint|complain|unhappy|angry|upset|refund|terrible|awful)\w*/.test(text)) return "complaint";
  if (/\b(transfer|human|speak to|talk to|manager|agent|representative)\w*/.test(text)) return "support";
  if (/\b(price|product|buy|purchase|cost|quote|fireplace|model|catalog)\w*/.test(text)) return "sales";
  return "general";
}

export async function classifyCallIntent(
  summary: string,
  transcript: string
): Promise<string> {
  const quick = classifyIntentFromText(summary, transcript);
  if (quick !== "general") return quick;

  if (!summary && !transcript) return "general";

  try {
    const raw = await callClaude(
      "Classify the phone call into exactly ONE category. Reply with only one lowercase word: sales, support, booking, complaint, or general. No other text.",
      `Summary:\n${summary || "none"}\n\nTranscript excerpt:\n${(transcript || "").slice(0, 2500)}`
    );
    const intent = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
    return VALID.has(intent) ? intent : "general";
  } catch {
    return quick;
  }
}
