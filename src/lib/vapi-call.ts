type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" ? (value as LooseRecord) : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function isBogusSummary(text?: string | null): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  const markers = [
    "i'm ready to summarize",
    "i would be happy to help, but i don't see",
    "i'd be happy to help, but i don't see",
    "please share the phone call transcript",
    "please share the full transcript",
    "could you please share the full transcript",
    "you've only provided the opening greeting",
    "you only provided the opening greeting",
    "i don't see a complete call transcript",
    "i don't see a complete transcript",
    "once you provide the complete conversation",
    "once you share the complete transcript",
  ];
  return markers.some((m) => lower.includes(m));
}

export function buildTranscriptFromMessages(messages: unknown): string {
  if (!Array.isArray(messages) || !messages.length) return "";
  return messages
    .map((entry) => {
      const row = asRecord(entry);
      if (!row) return "";
      const role = String(row.role || "speaker");
      const text = pickString(row.message, row.content, row.text);
      if (!text) return "";
      const label =
        role === "user" ? "Caller" : role === "assistant" || role === "bot" ? "AI" : role;
      return `${label}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function extractCallerNumber(...sources: unknown[]): string {
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) continue;

    const customer = asRecord(record.customer);
    const phoneNumber = asRecord(record.phoneNumber);
    const from = asRecord(record.from);

    const number = pickString(
      customer?.number,
      customer?.phoneNumber,
      record.phoneNumber,
      phoneNumber?.number,
      from?.number,
      record.callerId,
      record.caller,
      record.from
    );
    if (number) return number;
  }
  return "Unknown";
}

export function extractDurationSeconds(...sources: unknown[]): number {
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) continue;

    const direct = [
      record.durationSeconds,
      record.duration_seconds,
      record.duration,
    ];
    for (const value of direct) {
      if (typeof value === "number" && value > 0) {
        return value > 1000 ? Math.round(value / 1000) : Math.round(value);
      }
    }

    const startedAt = pickString(record.startedAt, record.startTime, record.createdAt);
    const endedAt = pickString(record.endedAt, record.endTime, record.updatedAt);
    if (startedAt && endedAt) {
      const seconds = Math.round(
        (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000
      );
      if (seconds > 0) return seconds;
    }
  }
  return 0;
}

export function extractTranscript(payload: {
  message?: LooseRecord;
  body?: LooseRecord;
  call?: LooseRecord;
}): string {
  const message = payload.message || {};
  const body = payload.body || {};
  const call = payload.call || asRecord(message.call) || asRecord(body.call) || {};
  const artifact = asRecord(message.artifact) || asRecord(body.artifact) || asRecord(call.artifact);

  return (
    pickString(
      message.transcript,
      body.transcript,
      artifact?.transcript,
      call.transcript
    ) ||
    buildTranscriptFromMessages(artifact?.messages) ||
    buildTranscriptFromMessages(message.messages) ||
    buildTranscriptFromMessages(body.messages) ||
    ""
  );
}

export function extractSummary(payload: {
  message?: LooseRecord;
  body?: LooseRecord;
  call?: LooseRecord;
}): string | null {
  const message = payload.message || {};
  const body = payload.body || {};
  const call = payload.call || asRecord(message.call) || asRecord(body.call) || {};
  const analysis = asRecord(message.analysis) || asRecord(body.analysis) || asRecord(call.analysis);

  const summary = pickString(
    analysis?.summary,
    message.summary,
    body.summary,
    call.summary
  );
  return summary && !isBogusSummary(summary) ? summary : null;
}

export function parseEndOfCallReport(body: LooseRecord) {
  const message = asRecord(body.message) || body;
  const call = asRecord(message.call) || asRecord(body.call) || {};

  const transcript = extractTranscript({ message, body, call });
  const summary = extractSummary({ message, body, call });
  const callerNumber = extractCallerNumber(call, message, body);
  const durationSeconds = extractDurationSeconds(message, call, body);

  return {
    call,
    message,
    transcript,
    summary,
    callerNumber,
    durationSeconds,
    assistantId: pickString(call.assistantId, message.assistantId),
  };
}

export async function fetchVapiCall(vapiCallId: string): Promise<LooseRecord | null> {
  if (!process.env.VAPI_API_KEY || !vapiCallId) return null;
  const res = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function normalizeVapiCallRecord(vapiCall: LooseRecord) {
  const artifact = asRecord(vapiCall.artifact);
  const analysis = asRecord(vapiCall.analysis);

  const transcript =
    pickString(vapiCall.transcript, artifact?.transcript) ||
    buildTranscriptFromMessages(artifact?.messages) ||
    buildTranscriptFromMessages(vapiCall.messages) ||
    "";

  let summary = pickString(analysis?.summary, vapiCall.summary);
  if (summary && isBogusSummary(summary)) summary = null;

  return {
    caller_number: extractCallerNumber(vapiCall),
    duration_seconds: extractDurationSeconds(vapiCall, artifact, analysis),
    transcript,
    summary,
    recording_url:
      pickString(
        asRecord(asRecord(artifact?.recording)?.mono)?.url,
        asRecord(artifact?.recording)?.monoUrl,
        asRecord(artifact?.recording)?.stereoUrl,
        artifact?.recordingUrl,
        vapiCall.recordingUrl
      ) || null,
  };
}

export async function backfillCallLogs(
  calls: Array<{
    id: string;
    created_at?: string;
    vapi_call_id?: string | null;
    caller_number?: string | null;
    duration_seconds?: number | null;
    transcript?: string | null;
    summary?: string | null;
    recording_url?: string | null;
    intent?: string | null;
    transferred?: boolean | null;
    status?: string | null;
    call_score?: number | null;
  }>,
  limit = 25
) {
  if (!process.env.VAPI_API_KEY) return calls;

  const { computeCallScore } = await import("./call-utils");

  const needsBackfill = calls.filter(
    (call) =>
      call.vapi_call_id &&
      ((!call.duration_seconds || call.duration_seconds <= 0) ||
        !call.caller_number ||
        call.caller_number === "Unknown" ||
        isBogusSummary(call.summary) ||
        (!call.transcript || call.transcript.length < 40))
  );

  for (const call of needsBackfill.slice(0, limit)) {
    const vapiCall = await fetchVapiCall(call.vapi_call_id!);
    if (!vapiCall) continue;

    const meta = normalizeVapiCallRecord(vapiCall);
    const updates: Record<string, unknown> = {};

    if (meta.caller_number !== "Unknown" && (!call.caller_number || call.caller_number === "Unknown")) {
      updates.caller_number = meta.caller_number;
    }
    if (meta.duration_seconds > 0 && (!call.duration_seconds || call.duration_seconds <= 0)) {
      updates.duration_seconds = meta.duration_seconds;
    }
    if (meta.transcript && meta.transcript.length > (call.transcript?.length || 0)) {
      updates.transcript = meta.transcript;
    }
    if (meta.summary && isBogusSummary(call.summary)) {
      updates.summary = meta.summary;
    }
    if (meta.recording_url && !call.recording_url) {
      updates.recording_url = meta.recording_url;
    }

    if (!Object.keys(updates).length) continue;

    const merged = { ...call, ...updates };
    updates.call_score = computeCallScore(merged as import("./call-utils").CallLike);

    const { supabaseAdmin } = await import("./config");
    await supabaseAdmin.from("call_logs").update(updates).eq("id", call.id);
    Object.assign(call, updates);
  }

  return calls;
}
