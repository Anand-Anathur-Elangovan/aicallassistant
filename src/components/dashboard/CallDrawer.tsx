"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CallLike,
  LeadLike,
  displaySummary,
  fmtDuration,
  computeCallScore,
  scoreLabel,
  findLeadForCall,
} from "@/lib/call-utils";

const INTENT_STYLES: Record<string, string> = {
  sales: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300",
  support: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300",
  booking: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300",
  complaint: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  general: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const SCORE_STYLES: Record<string, string> = {
  excellent: "text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300",
  good: "text-blue-700 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300",
  fair: "text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300",
  low: "text-gray-700 bg-gray-100 dark:bg-gray-800 dark:text-gray-300",
};

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>{children}</span>;
}

type CallDrawerProps = {
  call: (CallLike & { id: string; recording_url?: string | null; call_score?: number | null }) | null;
  leads: LeadLike[];
  businessId: string | null;
  onClose: () => void;
};

export function CallDrawer({ call, leads, businessId, onClose }: CallDrawerProps) {
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!call) {
      setVisible(false);
      return;
    }
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [call?.id]);

  useEffect(() => {
    if (!call) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call, onClose]);

  useEffect(() => {
    let blobUrl: string | null = null;
    let cancelled = false;

    async function loadAudio() {
      if (!call?.vapi_call_id || !businessId) {
        setAudioSrc(null);
        return;
      }
      setAudioLoading(true);
      setAudioError(null);
      setAudioSrc(null);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setAudioError("Sign in required to play recordings.");
        setAudioLoading(false);
        return;
      }

      const url = new URL("/api/call-audio", window.location.origin);
      url.searchParams.set("vapi_call_id", call.vapi_call_id);
      url.searchParams.set("business_id", businessId);

      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          setAudioError("Recording not available for this call.");
          setAudioLoading(false);
          return;
        }
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        setAudioSrc(blobUrl);
      } catch {
        if (!cancelled) setAudioError("Could not load recording.");
      } finally {
        if (!cancelled) setAudioLoading(false);
      }
    }

    loadAudio();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [call?.id, call?.vapi_call_id, businessId]);

  if (!call) return null;

  const score = call.call_score ?? computeCallScore(call);
  const scoreMeta = scoreLabel(score);
  const scoreKey =
    score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "fair" : "low";
  const lead = findLeadForCall(leads, call);
  const summary = displaySummary(call.summary);

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-white dark:bg-gray-950 shadow-2xl z-50 flex flex-col border-l border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-out ${visible ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-label="Call details"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-white dark:bg-gray-950">
          <div>
            <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{call.caller_number || "Unknown"}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{new Date(call.created_at || "").toLocaleString()}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-xl leading-none text-gray-600 dark:text-gray-300"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
          <div className="flex flex-wrap gap-2">
            <Badge className={INTENT_STYLES[call.intent || "general"]}>{call.intent || "general"}</Badge>
            <Badge className={SCORE_STYLES[scoreKey]}>Score {score} · {scoreMeta.text}</Badge>
            <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">{fmtDuration(call.duration_seconds)}</Badge>
            {call.transferred && <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">Transferred</Badge>}
            {call.status === "max_duration" && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">8min cap</Badge>}
          </div>

          {(call.vapi_call_id || call.recording_url) && (
            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900/80">
              <p className="text-sm font-medium mb-2 text-gray-900 dark:text-gray-100">Call recording</p>
              {audioLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading audio…</p>}
              {audioError && <p className="text-sm text-amber-600 dark:text-amber-400">{audioError}</p>}
              {audioSrc && (
                <audio controls className="w-full invert-0 dark:invert-0" preload="metadata" src={audioSrc}>
                  Your browser does not support audio playback.
                </audio>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">New calls need recording enabled on the assistant (Push to Vapi).</p>
            </div>
          )}

          <section>
            <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Summary</h4>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700 dark:text-gray-200">
              {summary || "No summary generated for this call."}
            </p>
          </section>

          {lead && (
            <section className="p-4 border rounded-xl border-green-200 bg-green-50 dark:bg-green-950/40 dark:border-green-800">
              <h4 className="text-sm font-semibold text-green-800 dark:text-green-300 mb-2">Linked lead</h4>
              <p className="font-medium text-gray-900 dark:text-gray-100">{lead.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">{lead.phone || lead.caller_number}</p>
              {lead.interest && <p className="text-sm mt-1 text-gray-700 dark:text-gray-300">Interest: {lead.interest}</p>}
              {lead.message && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{lead.message}</p>}
              <Badge className="mt-2 bg-white/80 dark:bg-gray-800 dark:text-gray-200">{lead.status}</Badge>
            </section>
          )}

          {call.transcript && (
            <section>
              <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Transcript</h4>
              <pre className="text-xs p-3 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200 rounded-xl whitespace-pre-wrap max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700">
                {call.transcript}
              </pre>
            </section>
          )}

          <section className="text-xs text-gray-400 dark:text-gray-500 space-y-1 pb-4">
            {call.vapi_call_id && <p>Vapi call: {call.vapi_call_id}</p>}
            <p>Status: {call.status || "completed"}</p>
          </section>
        </div>
      </aside>
    </>
  );
}
