import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { loadParents, parentingTimeReport } from "@/lib/time-data";
import { todayLocal } from "@/lib/format";
import { BarChart, HBarList } from "@/components/bar-chart";
import { PrintButton } from "../report/print-button";

/* eslint-disable @typescript-eslint/no-explicit-any */
function monthKey(d: string) {
  return d.slice(0, 7);
}
function monthLabel(k: string) {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}
function lastMonths(n: number) {
  const t = todayLocal();
  let y = Number(t.slice(0, 4));
  let m = Number(t.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ tag?: string; months?: string }>;
}) {
  const { matterId } = await params;
  const sp = await searchParams;
  const months = [12, 24, 36].includes(Number(sp.months)) ? Number(sp.months) : 24;
  const { supabase, matter } = await requireMatter(matterId);
  const keys = lastMonths(months);
  const fromDate = `${keys[0]}-01`;

  const [{ data: events }, { data: issues }] = await Promise.all([
    supabase
      .from("events")
      .select("event_date, tags, event_issues(issue_id)")
      .eq("matter_id", matterId)
      .eq("exclude_from_reports", false)
      .gte("event_date", fromDate)
      .limit(10000),
    supabase.from("issues").select("id, title").eq("matter_id", matterId),
  ]);
  const evs = (events ?? []) as any[];

  const tagCounts = new Map<string, number>();
  for (const e of evs) for (const t of e.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const tag = sp.tag && tagCounts.has(sp.tag) ? sp.tag : "";

  const perMonth = new Map(keys.map((k) => [k, 0]));
  for (const e of evs) {
    if (tag && !(e.tags ?? []).includes(tag)) continue;
    const k = monthKey(e.event_date);
    if (perMonth.has(k)) perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
  }

  const issueTitle = new Map((issues ?? []).map((i: any) => [i.id, i.title]));
  const issueCounts = new Map<string, number>();
  for (const e of evs) for (const l of e.event_issues ?? []) {
    const t = issueTitle.get(l.issue_id);
    if (t) issueCounts.set(t, (issueCounts.get(t) ?? 0) + 1);
  }

  // Exchange lateness by month (from check-ins compared with the schedule)
  const parents = await loadParents(supabase, matterId);
  let lateByMonth: { label: string; value: number }[] = [];
  let lateTotals = { late: 0, minutes: 0, noShow: 0 };
  let share: { a: number; b: number } | null = null;
  const { data: sched } = await supabase.from("schedules").select("id").eq("matter_id", matterId).limit(1);
  if (parents.set && (sched ?? []).length) {
    const { report } = await parentingTimeReport(supabase, matterId, fromDate, todayLocal());
    const lm = new Map(keys.map((k) => [k, 0]));
    for (const h of report.handoffs) {
      if (h.status !== "late") continue;
      const k = new Date(h.scheduled_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7);
      if (lm.has(k)) lm.set(k, (lm.get(k) ?? 0) + 1);
    }
    lateByMonth = keys.map((k) => ({ label: monthLabel(k), value: lm.get(k) ?? 0 }));
    lateTotals = { late: report.counts.late, minutes: report.late_minutes_total, noShow: report.counts.no_show };
    share = report.actual_pct;
  }

  return (
    <>
      <div className="row between">
        <h1>Insights</h1>
        <div className="no-print"><PrintButton /></div>
      </div>
      <p className="print-only">{matter.title}</p>

      <form method="get" className="row no-print" style={{ marginBottom: 12 }}>
        <select name="tag" defaultValue={tag} style={{ flex: 2 }}>
          <option value="">All events</option>
          {topTags.map(([t, c]) => (
            <option key={t} value={t}>#{t} ({c})</option>
          ))}
        </select>
        <select name="months" defaultValue={String(months)} style={{ flex: 1 }}>
          <option value="12">12 months</option>
          <option value="24">24 months</option>
          <option value="36">36 months</option>
        </select>
        <button className="btn">Show</button>
      </form>

      <div className="card">
        <BarChart
          title={`${tag ? `#${tag}` : "Events"} per month`}
          data={keys.map((k) => ({ label: monthLabel(k), value: perMonth.get(k) ?? 0 }))}
        />
      </div>

      {share ? (
        <div className="card">
          <div className="stat-grid" style={{ marginBottom: 10 }}>
            <div className="stat"><b>{share.a}%</b><span>actual time with {parents.a}</span></div>
            <div className="stat"><b>{lateTotals.late}</b><span>late exchanges</span></div>
            <div className="stat"><b>{lateTotals.minutes}</b><span>minutes late</span></div>
            <div className="stat"><b>{lateTotals.noShow}</b><span>didn&apos;t happen</span></div>
          </div>
          <BarChart title="Late exchanges per month (from check-ins)" data={lateByMonth} />
        </div>
      ) : (
        <div className="card muted">
          Set up the schedule under <Link href={`/m/${matterId}/time`}>Time</Link> to see exchange lateness and each
          parent&apos;s share of time here.
        </div>
      )}

      {issueCounts.size > 0 && (
        <div className="card">
          <HBarList
            title="Events per issue"
            data={Array.from(issueCounts.entries()).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))}
          />
        </div>
      )}
      {topTags.length > 0 && (
        <div className="card">
          <HBarList title="Most common tags" data={topTags.map(([label, value]) => ({ label: `#${label}`, value }))} />
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.85rem" }}>Entries marked “leave out of reports” aren&apos;t counted here.</p>
    </>
  );
}
