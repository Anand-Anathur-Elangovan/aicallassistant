"use client";

import {
  CallLike,
  CallFilters,
  filterCalls,
  displaySummary,
  fmtDuration,
  computeCallScore,
  scoreLabel,
} from "@/lib/call-utils";

const INTENT_STYLES: Record<string, string> = {
  sales: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300",
  support: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300",
  booking: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300",
  complaint: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  general: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

type CallsPanelProps = {
  calls: (CallLike & { id: string; call_score?: number | null })[];
  filters: CallFilters;
  onFiltersChange: (f: CallFilters) => void;
  onSelectCall: (call: CallLike & { id: string }) => void;
  selectedId?: string | null;
  limit?: number;
  compact?: boolean;
};

export function CallFiltersBar({
  filters,
  onChange,
}: {
  filters: CallFilters;
  onChange: (f: CallFilters) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-end p-3 bg-gray-50 dark:bg-gray-800/80 rounded-xl border dark:border-gray-700">
      <div className="flex-1 min-w-[160px]">
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Search</label>
        <input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Number, summary, intent…"
          className="w-full px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">From</label>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          className="px-2 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">To</label>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          className="px-2 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Intent</label>
        <select
          value={filters.intent}
          onChange={(e) => onChange({ ...filters, intent: e.target.value })}
          className="px-2 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100"
        >
          <option value="all">All</option>
          <option value="sales">Sales</option>
          <option value="support">Support</option>
          <option value="booking">Booking</option>
          <option value="complaint">Complaint</option>
          <option value="general">General</option>
        </select>
      </div>
      {(filters.search || filters.dateFrom || filters.dateTo || filters.intent !== "all") && (
        <button
          type="button"
          onClick={() => onChange({ search: "", dateFrom: "", dateTo: "", intent: "all" })}
          className="text-xs text-blue-600 hover:underline py-1.5"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export function CallsPanel({
  calls,
  filters,
  onFiltersChange,
  onSelectCall,
  selectedId,
  limit,
}: CallsPanelProps) {
  const filtered = filterCalls(calls, filters);
  const shown = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <CallFiltersBar filters={filters} onChange={onFiltersChange} />
      <div className="border rounded-xl overflow-hidden dark:border-gray-700 flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 max-h-[min(420px,50vh)]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
                <th className="p-3 font-medium">Caller</th>
                <th className="p-3 font-medium hidden sm:table-cell">When</th>
                <th className="p-3 font-medium">Intent</th>
                <th className="p-3 font-medium hidden md:table-cell">Score</th>
                <th className="p-3 font-medium hidden lg:table-cell">Summary</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const score = c.call_score ?? computeCallScore(c);
                const sm = scoreLabel(score);
                const active = selectedId === c.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => onSelectCall(c as CallLike & { id: string })}
                    className={`border-t dark:border-gray-700 cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/20 ${active ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
                  >
                    <td className="p-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{c.caller_number || "Unknown"}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{fmtDuration(c.duration_seconds)}</div>
                    </td>
                    <td className="p-3 text-gray-500 dark:text-gray-400 hidden sm:table-cell whitespace-nowrap">
                      {new Date(c.created_at || "").toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${INTENT_STYLES[c.intent || "general"]}`}>
                        {c.intent || "general"}
                      </span>
                    </td>
                    <td className="p-3 hidden md:table-cell">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sm.className}`}>{score}</span>
                    </td>
                    <td className="p-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell max-w-xs truncate">
                      {displaySummary(c.summary) || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && (
            <p className="p-8 text-center text-gray-400 text-sm">No calls match your filters.</p>
          )}
        </div>
        {limit && filtered.length > limit && (
          <p className="text-xs text-gray-400 p-2 border-t dark:border-gray-700 text-center">
            Showing {limit} of {filtered.length} — open Calls tab for full list
          </p>
        )}
      </div>
      <p className="text-xs text-gray-400">Click a row to open full details, audio, transcript, and linked lead.</p>
    </div>
  );
}
