export type CallLike = {
  id?: string;
  caller_number?: string;
  duration_seconds?: number;
  summary?: string;
  transcript?: string;
  status?: string;
  transferred?: boolean;
  intent?: string;
  created_at?: string;
  vapi_call_id?: string | null;
  recording_url?: string | null;
  call_score?: number | null;
};

export type LeadLike = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  interest?: string;
  message?: string;
  source?: string;
  status?: string;
  caller_number?: string;
  vapi_call_id?: string | null;
  created_at?: string;
};

export function plainSummary(text?: string) {
  if (!text) return "";
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function displaySummary(text?: string) {
  if (!text) return "";
  const lower = text.toLowerCase();
  const bogus =
    lower.includes("i'm ready to summarize") ||
    lower.includes("please share the full transcript") ||
    lower.includes("i don't see a complete call transcript") ||
    lower.includes("you've only provided the opening greeting");
  if (bogus) return "";
  return plainSummary(text);
}

export function fmtDuration(seconds?: number) {
  const s = seconds || 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${r}s` : `${r}s`;
}

export function computeCallScore(call: CallLike): number {
  let score = 45;
  const dur = call.duration_seconds || 0;
  if (dur >= 30 && dur <= 420) score += 15;
  if (dur > 420) score -= 10;
  if (call.summary) score += 10;
  if (call.transcript && call.transcript.length > 80) score += 5;
  if (call.intent === "sales" || call.intent === "booking") score += 15;
  if (call.intent === "complaint") score -= 5;
  if (call.transferred) score += 10;
  if (call.status === "max_duration") score -= 20;
  return Math.min(100, Math.max(0, score));
}

export function scoreLabel(score: number) {
  if (score >= 80) return { text: "Excellent", className: "text-green-700 bg-green-100" };
  if (score >= 60) return { text: "Good", className: "text-blue-700 bg-blue-100" };
  if (score >= 40) return { text: "Fair", className: "text-amber-700 bg-amber-100" };
  return { text: "Low", className: "text-gray-700 bg-gray-100" };
}

export function findLeadForCall(leads: LeadLike[], call: CallLike): LeadLike | undefined {
  if (call.vapi_call_id) {
    const byCall = leads.find((l) => l.vapi_call_id === call.vapi_call_id);
    if (byCall) return byCall;
  }
  if (!call.caller_number || call.caller_number === "Unknown") return undefined;
  const callTime = new Date(call.created_at || 0).getTime();
  return leads.find((l) => {
    if (l.caller_number !== call.caller_number && l.phone !== call.caller_number) return false;
    const leadTime = new Date(l.created_at || 0).getTime();
    return Math.abs(leadTime - callTime) < 2 * 60 * 60 * 1000;
  });
}

export type CallFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  intent: string;
};

export function filterCalls(calls: CallLike[], filters: CallFilters): CallLike[] {
  const q = filters.search.trim().toLowerCase();
  const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
  const to = filters.dateTo ? new Date(filters.dateTo + "T23:59:59").getTime() : null;

  return calls.filter((c) => {
    if (filters.intent !== "all" && (c.intent || "general") !== filters.intent) return false;
    const t = new Date(c.created_at || 0).getTime();
    if (from && t < from) return false;
    if (to && t > to) return false;
    if (!q) return true;
    const hay = [
      c.caller_number,
      c.summary,
      c.transcript,
      c.intent,
      c.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function filterLeads(leads: LeadLike[], search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return leads;
  return leads.filter((l) =>
    [l.name, l.phone, l.email, l.interest, l.message, l.caller_number, l.status, l.source]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}

export function extractRecordingUrl(payload: {
  message?: Record<string, unknown>;
  artifact?: Record<string, unknown>;
  call?: Record<string, unknown>;
}) {
  const artifact = (payload.message?.artifact || payload.artifact) as Record<string, unknown> | undefined;
  if (!artifact) return null;
  const recording = artifact.recording as Record<string, unknown> | undefined;
  if (recording) {
    const mono = recording.mono as Record<string, unknown> | undefined;
    return (
      (mono?.url as string) ||
      (recording.monoUrl as string) ||
      (recording.stereoUrl as string) ||
      (recording.url as string) ||
      null
    );
  }
  return (artifact.recordingUrl as string) || (artifact.stereoRecordingUrl as string) || null;
}
