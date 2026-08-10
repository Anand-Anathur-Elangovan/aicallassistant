import { supabaseAdmin } from "./supabase-admin";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type StoreHour = {
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
  max_appointments: number;
  slot_minutes: number;
};

export type StoreClosure = {
  start_date: string;
  end_date: string;
  reason: string;
  is_emergency: boolean;
};

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function ensureDefaultStoreHours(businessId: string) {
  const { data: existing } = await supabaseAdmin
    .from("store_hours")
    .select("id")
    .eq("business_id", businessId)
    .limit(1);

  if (existing?.length) return;

  const rows = [0, 1, 2, 3, 4, 5, 6].map((day) => {
    if (day === 0) {
      return {
        business_id: businessId,
        day_of_week: day,
        is_closed: true,
        open_time: "09:00",
        close_time: "17:00",
        max_appointments: 0,
        slot_minutes: 60,
      };
    }
    if (day === 6) {
      return {
        business_id: businessId,
        day_of_week: day,
        is_closed: false,
        open_time: "10:00",
        close_time: "16:00",
        max_appointments: 4,
        slot_minutes: 60,
      };
    }
    return {
      business_id: businessId,
      day_of_week: day,
      is_closed: false,
      open_time: "09:00",
      close_time: "17:00",
      max_appointments: 6,
      slot_minutes: 60,
    };
  });

  await supabaseAdmin.from("store_hours").insert(rows);
}

export async function getClosuresForRange(
  businessId: string,
  from: string,
  to: string
): Promise<StoreClosure[]> {
  const { data } = await supabaseAdmin
    .from("store_closures")
    .select("start_date, end_date, reason, is_emergency")
    .eq("business_id", businessId)
    .lte("start_date", to)
    .gte("end_date", from);
  return data || [];
}

function isDateClosed(
  dateStr: string,
  closures: StoreClosure[]
): StoreClosure | null {
  return (
    closures.find((c) => dateStr >= c.start_date && dateStr <= c.end_date) ||
    null
  );
}

export async function getAvailableSlots(
  businessId: string,
  fromDate: string,
  daysAhead = 14,
  showroom?: string
) {
  await ensureDefaultStoreHours(businessId);

  const { data: hours } = await supabaseAdmin
    .from("store_hours")
    .select("*")
    .eq("business_id", businessId);

  const end = new Date(fromDate + "T12:00:00");
  end.setDate(end.getDate() + daysAhead);
  const toDate = formatDate(end);

  const closures = await getClosuresForRange(businessId, fromDate, toDate);

  const { data: booked } = await supabaseAdmin
    .from("appointments")
    .select("scheduled_at, duration_minutes, showroom, status")
    .eq("business_id", businessId)
    .eq("status", "scheduled")
    .gte("scheduled_at", fromDate)
    .lte("scheduled_at", toDate + "T23:59:59");

  const available: {
    date: string;
    day: string;
    slots: string[];
    note?: string;
  }[] = [];
  const closedNotes: { date: string; reason: string; is_emergency: boolean }[] =
    [];

  const start = new Date(fromDate + "T12:00:00");
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = formatDate(d);
    const dow = d.getDay();
    const hour = (hours || []).find((h: StoreHour) => h.day_of_week === dow);

    const closure = isDateClosed(dateStr, closures);
    if (closure) {
      closedNotes.push({
        date: dateStr,
        reason: closure.reason,
        is_emergency: closure.is_emergency,
      });
      continue;
    }

    if (!hour || hour.is_closed || hour.max_appointments <= 0) {
      continue;
    }

    const openM = parseTimeToMinutes(String(hour.open_time));
    const closeM = parseTimeToMinutes(String(hour.close_time));
    const slotMins = hour.slot_minutes || 60;
    const dayBookings = (booked || []).filter((a: { scheduled_at: string; showroom?: string }) => {
      const sameDay = a.scheduled_at.startsWith(dateStr);
      if (!sameDay) return false;
      if (showroom && a.showroom && a.showroom !== "general" && showroom !== "general") {
        return a.showroom === showroom;
      }
      return true;
    });

    if (dayBookings.length >= hour.max_appointments) {
      continue;
    }

    const slots: string[] = [];
    for (let m = openM; m + slotMins <= closeM; m += slotMins) {
      if (slots.length + dayBookings.length >= hour.max_appointments) break;
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const time = `${hh}:${mm}`;
      const iso = `${dateStr}T${time}:00`;
      const taken = dayBookings.some((a: { scheduled_at: string; duration_minutes: number }) => {
        const existing = new Date(a.scheduled_at).getTime();
        const candidate = new Date(iso).getTime();
        const dur = (a.duration_minutes || slotMins) * 60000;
        return Math.abs(existing - candidate) < dur;
      });
      if (!taken) slots.push(`${dateStr} ${time}`);
    }

    if (slots.length) {
      available.push({
        date: dateStr,
        day: DAY_NAMES[dow],
        slots: slots.slice(0, 8),
      });
    }
  }

  return { available, closedNotes, dayNames: DAY_NAMES };
}

export async function bookAppointment(params: {
  businessId: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  showroom?: string;
  scheduled_at: string;
  notes?: string;
  source?: string;
}) {
  const dateStr = params.scheduled_at.slice(0, 10);
  const closures = await getClosuresForRange(params.businessId, dateStr, dateStr);
  const closure = isDateClosed(dateStr, closures);
  if (closure) {
    return {
      error: `Store is closed on ${dateStr}: ${closure.reason}. Please choose another date.`,
    };
  }

  const dow = new Date(dateStr + "T12:00:00").getDay();
  const { data: hour } = await supabaseAdmin
    .from("store_hours")
    .select("*")
    .eq("business_id", params.businessId)
    .eq("day_of_week", dow)
    .single();

  if (!hour || hour.is_closed) {
    return { error: "That day is not a working day for the store." };
  }

  const { count } = await supabaseAdmin
    .from("appointments")
    .select("*", { count: "exact", head: true })
    .eq("business_id", params.businessId)
    .eq("status", "scheduled")
    .gte("scheduled_at", dateStr + "T00:00:00")
    .lte("scheduled_at", dateStr + "T23:59:59");

  if ((count || 0) >= hour.max_appointments) {
    return { error: "That day is fully booked. Please choose another date." };
  }

  let scheduledAt = params.scheduled_at;
  if (!scheduledAt.includes("T")) {
    scheduledAt = `${scheduledAt.replace(" ", "T")}:00`;
  }
  if (!scheduledAt.endsWith("Z") && scheduledAt.length <= 19) {
    // store as local wall time ISO without forcing UTC shift in display
    scheduledAt = scheduledAt.length === 16 ? scheduledAt + ":00" : scheduledAt;
  }

  const { data, error } = await supabaseAdmin
    .from("appointments")
    .insert({
      business_id: params.businessId,
      customer_name: params.customer_name,
      customer_phone: params.customer_phone || null,
      customer_email: params.customer_email || null,
      showroom: params.showroom || "general",
      scheduled_at: scheduledAt,
      duration_minutes: hour.slot_minutes || 60,
      notes: params.notes || null,
      source: params.source || "ai",
      status: "scheduled",
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { appointment: data };
}
