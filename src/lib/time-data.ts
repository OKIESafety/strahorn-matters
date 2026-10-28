import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeParentingTime, type Exchange, type Override, type Schedule, zonedToUtc } from "./parenting-time";
import { TIME_ZONE } from "./constants";

export type Parents = { a: string; b: string };

export async function loadParents(db: SupabaseClient, matterId: string): Promise<Parents & { set: boolean }> {
  const { data } = await db.from("matters").select("parent_a, parent_b").eq("id", matterId).maybeSingle();
  return {
    a: data?.parent_a || "Parent A",
    b: data?.parent_b || "Parent B",
    set: !!(data?.parent_a && data?.parent_b),
  };
}

export async function loadTimeData(db: SupabaseClient, matterId: string) {
  const [{ data: schedules }, { data: overrides }, { data: exchanges }] = await Promise.all([
    db.from("schedules").select("*").eq("matter_id", matterId).order("effective_from"),
    db.from("schedule_overrides").select("*").eq("matter_id", matterId).order("starts_at"),
    db.from("exchanges").select("*").eq("matter_id", matterId).order("occurred_at"),
  ]);
  return {
    schedules: (schedules ?? []) as (Schedule & { id: string; name: string; notes: string | null })[],
    overrides: (overrides ?? []) as (Override & { id: string; reason: string | null })[],
    exchanges: (exchanges ?? []) as (Exchange & {
      id: string;
      note: string | null;
      recorded_live: boolean;
      lat: number | null;
      lng: number | null;
      accuracy_m: number | null;
      source_ref: string | null;
      void_reason: string | null;
      recorded_via: string;
      created_at: string;
    })[],
  };
}

/** Report for a local date range [fromDate, toDate] inclusive. */
export async function parentingTimeReport(db: SupabaseClient, matterId: string, fromDate: string, toDate: string) {
  const data = await loadTimeData(db, matterId);
  const from = zonedToUtc(fromDate, "00:00", TIME_ZONE);
  const [y, m, d] = toDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const to = Math.min(zonedToUtc(next, "00:00", TIME_ZONE), Date.now());
  const report = computeParentingTime({
    schedules: data.schedules,
    overrides: data.overrides,
    exchanges: data.exchanges,
    from,
    to: Math.max(to, from + 1),
    tz: TIME_ZONE,
  });
  return { ...data, report };
}

export function formatInstant(ms: number) {
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}
