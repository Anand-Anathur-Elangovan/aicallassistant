import { supabaseAdmin } from "./supabase-admin";
import { ensureDefaultStoreHours, getClosuresForRange } from "./scheduling";

const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

export function getZonedParts(timezone = "Australia/Melbourne") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  const weekday = (parts.weekday || "Mon").slice(0, 3);
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: parseInt(parts.hour || "0") * 60 + parseInt(parts.minute || "0"),
    dayOfWeek: DAY_MAP[weekday] ?? 1,
    timeLabel: `${parts.hour}:${parts.minute}`,
  };
}

export type StaffAvailability = {
  available: boolean;
  reason?: string;
  type?: "open" | "closed" | "after_hours" | "closure";
  hoursLabel?: string;
};

export async function getStaffAvailability(
  businessId: string,
  timezone = "Australia/Melbourne"
): Promise<StaffAvailability> {
  await ensureDefaultStoreHours(businessId);
  const { dateStr, minutes, dayOfWeek, timeLabel } = getZonedParts(timezone);

  const closures = await getClosuresForRange(businessId, dateStr, dateStr);
  const closure = closures.find((c) => dateStr >= c.start_date && dateStr <= c.end_date);
  if (closure) {
    return {
      available: false,
      type: "closure",
      reason: closure.reason,
      hoursLabel: `Closed today: ${closure.reason}`,
    };
  }

  const { data: hour } = await supabaseAdmin
    .from("store_hours")
    .select("*")
    .eq("business_id", businessId)
    .eq("day_of_week", dayOfWeek)
    .single();

  if (!hour || hour.is_closed) {
    return {
      available: false,
      type: "closed",
      reason: "We are closed today.",
      hoursLabel: "Closed today",
    };
  }

  const openM = parseTimeToMinutes(String(hour.open_time));
  const closeM = parseTimeToMinutes(String(hour.close_time));
  const hoursLabel = `${String(hour.open_time).slice(0, 5)}–${String(hour.close_time).slice(0, 5)}`;

  if (minutes < openM || minutes >= closeM) {
    return {
      available: false,
      type: "after_hours",
      reason: `Our showroom hours today are ${hoursLabel}. It is currently ${timeLabel} local time.`,
      hoursLabel,
    };
  }

  return { available: true, type: "open", hoursLabel };
}
