import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExportItems, loadReportData, manifestHash } from "./report-data";
import type { EventFilters } from "./queries";
import { loadOrders } from "./orders";
import { loadParents, parentingTimeReport } from "./time-data";
import { todayLocal } from "./format";

export type PacketStats = {
  totals: { events: number; files: number };
  range: { from: string; to: string } | null;
  per_month: { label: string; value: number }[];
  per_issue: { label: string; value: number }[];
  parenting: null | {
    from: string;
    to: string;
    parents: { a: string; b: string };
    scheduled_pct: { a: number; b: number };
    actual_pct: { a: number; b: number };
    scheduled_hours: { a: number; b: number };
    actual_hours: { a: number; b: number };
    late: number;
    late_minutes: number;
    no_show: number;
    late_by_month: { label: string; value: number }[];
  };
};

const monthLabel = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};

function monthKeys(from: string, to: string) {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export async function createPacket(
  db: SupabaseClient,
  args: { matterId: string; userId: string; title: string; filters: EventFilters; summary: string | null }
) {
  const { matterId, userId, filters } = args;
  const { rows, evByEvent } = await loadReportData(db, matterId, filters);
  if (!rows.length) throw new Error("No events match these filters");
  const items = buildExportItems(rows, evByEvent);

  // Court-order terms snapshot
  const orders = (await loadOrders(db, matterId)).map((p) => ({
    category: p.category,
    title: p.title,
    summary: p.summary,
    quote: p.quote,
    citation: p.citation,
    key_fact: p.key_fact,
  }));

  // Charts
  const dates = items.map((i) => i.date).sort();
  const from = filters.from ?? dates[0];
  const to = filters.to ?? dates[dates.length - 1];
  const keys = monthKeys(from, to);
  const pm = new Map(keys.map((k) => [k, 0]));
  for (const i of items) {
    const k = i.date.slice(0, 7);
    if (pm.has(k)) pm.set(k, (pm.get(k) ?? 0) + 1);
  }
  const pi = new Map<string, number>();
  for (const i of items) for (const t of i.issues) pi.set(t, (pi.get(t) ?? 0) + 1);

  let parenting: PacketStats["parenting"] = null;
  const parents = await loadParents(db, matterId);
  const { data: sched } = await db.from("schedules").select("effective_from").eq("matter_id", matterId).order("effective_from").limit(1);
  if (parents.set && sched?.length) {
    const pFrom = from > sched[0].effective_from ? from : sched[0].effective_from;
    const today = todayLocal();
    const pTo = to < today ? to : today;
    if (pFrom <= pTo) {
      const { report } = await parentingTimeReport(db, matterId, pFrom, pTo);
      const lk = monthKeys(pFrom, pTo);
      const lm = new Map(lk.map((k) => [k, 0]));
      for (const h of report.handoffs) {
        if (h.status !== "late") continue;
        const k = new Date(h.scheduled_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7);
        if (lm.has(k)) lm.set(k, (lm.get(k) ?? 0) + 1);
      }
      parenting = {
        from: pFrom,
        to: pTo,
        parents: { a: parents.a, b: parents.b },
        scheduled_pct: report.scheduled_pct,
        actual_pct: report.actual_pct,
        scheduled_hours: report.scheduled_hours,
        actual_hours: report.actual_hours,
        late: report.counts.late,
        late_minutes: report.late_minutes_total,
        no_show: report.counts.no_show,
        late_by_month: lk.map((k) => ({ label: monthLabel(k), value: lm.get(k) ?? 0 })),
      };
    }
  }

  const stats: PacketStats = {
    totals: { events: items.length, files: items.reduce((n, i) => n + i.evidence.length, 0) },
    range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    per_month: keys.map((k) => ({ label: monthLabel(k), value: pm.get(k) ?? 0 })),
    per_issue: Array.from(pi.entries()).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
    parenting,
  };

  const summary = args.summary?.trim() || null;
  const { data, error } = await db
    .from("exports")
    .insert({
      matter_id: matterId,
      title: args.title,
      filters,
      items,
      summary,
      orders,
      stats,
      manifest_version: 2,
      manifest_sha256: manifestHash(items, { summary, orders, stats }),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
