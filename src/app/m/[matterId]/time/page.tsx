import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { loadParents, parentingTimeReport, formatInstant } from "@/lib/time-data";
import { isValidDate } from "@/lib/core";
import { formatDate, todayLocal } from "@/lib/format";
import { saveParentsAction } from "./actions";
import { PrintButton } from "../report/print-button";

const STATUS_LABEL: Record<string, string> = {
  on_time: "On time",
  late: "Late",
  early: "Early",
  unrecorded: "Not recorded",
  no_show: "Didn't happen",
};

function daysAgo(n: number) {
  const d = new Date(Date.parse(todayLocal() + "T12:00:00Z") - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default async function TimePage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { matterId } = await params;
  const sp = await searchParams;
  const { supabase, canWrite, isOwner, matter } = await requireMatter(matterId);
  const base = `/m/${matterId}/time`;
  const parents = await loadParents(supabase, matterId);

  if (!parents.set) {
    return (
      <>
        <h1>Parenting time</h1>
        <p className="muted">
          Track the court-ordered schedule against what actually happens: each parent&apos;s share of time, and every
          late or missed exchange.
        </p>
        {isOwner ? (
          <form action={saveParentsAction.bind(null, matterId)} className="card">
            <h2>First, the two parents</h2>
            <div className="field">
              <label htmlFor="pa">You</label>
              <input id="pa" name="parent_a" type="text" required placeholder="Jonathan" />
            </div>
            <div className="field">
              <label htmlFor="pb">Other parent</label>
              <input id="pb" name="parent_b" type="text" required placeholder="Brandy" />
            </div>
            <button className="btn primary">Save</button>
          </form>
        ) : (
          <div className="card muted">The owner hasn&apos;t set this up yet.</div>
        )}
      </>
    );
  }

  const today = todayLocal();
  const to = sp.to && isValidDate(sp.to) ? sp.to : today;
  let from = sp.from && isValidDate(sp.from) ? sp.from : daysAgo(90);
  if (!sp.from) {
    const { data: first } = await supabase
      .from("schedules")
      .select("effective_from")
      .eq("matter_id", matterId)
      .order("effective_from")
      .limit(1)
      .maybeSingle();
    if (first?.effective_from && first.effective_from > from) from = first.effective_from;
  }
  const { schedules, report: r, exchanges } = await parentingTimeReport(supabase, matterId, from, to);
  const name = (s: "a" | "b") => (s === "a" ? parents.a : parents.b);
  const liveCount = exchanges.filter((e) => !e.voided_at).length;

  return (
    <>
      <div className="row between no-print">
        <h1>Parenting time</h1>
        {canWrite && (
          <Link href={`${base}/checkin`} className="btn primary">
            Girls late?
          </Link>
        )}
      </div>

      {schedules.length === 0 ? (
        <div className="card">
          <p>
            Enter the court-ordered schedule once. After that, every check-in is compared against it automatically.
          </p>
          {canWrite && (
            <Link href={`${base}/schedule`} className="btn primary">
              Set up the schedule
            </Link>
          )}
        </div>
      ) : (
        <>
          <form method="get" action={base} className="card no-print row">
            <label className="muted grow" style={{ fontSize: "0.85rem" }}>
              From
              <input type="date" name="from" defaultValue={from} />
            </label>
            <label className="muted grow" style={{ fontSize: "0.85rem" }}>
              To
              <input type="date" name="to" defaultValue={to} />
            </label>
            <button className="btn">Update</button>
          </form>

          <section>
            <h2 className="print-only">{matter.title}: parenting time</h2>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              {formatDate(from)} – {formatDate(to)}
            </p>

            <div className="card">
              <h3>Share of time</h3>
              {(["a", "b"] as const).map((s) => (
                <div key={s} style={{ margin: "10px 0" }}>
                  <div className="row between" style={{ fontSize: "0.92rem" }}>
                    <strong>{name(s)}</strong>
                    <span>
                      Actual {r.actual_pct[s]}% · Ordered {r.scheduled_pct[s]}%
                    </span>
                  </div>
                  <div className="bar" aria-hidden>
                    <span className="bar-fill" style={{ width: `${r.actual_pct[s]}%` }} />
                    <span className="bar-mark" style={{ left: `${r.scheduled_pct[s]}%` }} />
                  </div>
                  <small className="muted">
                    {Math.round(r.actual_hours[s])} hours actual vs {Math.round(r.scheduled_hours[s])} ordered
                  </small>
                </div>
              ))}
              <small className="muted">Solid bar = actual time. Line = court-ordered share.</small>
            </div>

            <div className="stat-grid">
              <div className="card stat"><b>{r.counts.late}</b><span>late exchanges</span></div>
              <div className="card stat"><b>{r.late_minutes_total}</b><span>minutes late total</span></div>
              <div className="card stat"><b>{r.counts.no_show}</b><span>didn&apos;t happen</span></div>
              <div className="card stat"><b>{r.extra_exchanges.length}</b><span>extra / unscheduled</span></div>
            </div>
            <p className="muted" style={{ fontSize: "0.88rem" }}>
              Exchanges follow the court-ordered schedule unless you log that one was late or didn&apos;t happen.
            </p>

            <div className="card">
              <h3>Exchanges</h3>
              <table className="simple">
                <thead>
                  <tr>
                    <th>Scheduled</th>
                    <th>To</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {r.handoffs
                    .filter((h) => h.status !== "unrecorded")
                    .map((h, i) => (
                      <tr key={i}>
                        <td>{formatInstant(h.scheduled_at)}</td>
                        <td>{name(h.to)}</td>
                        <td>
                          <span className={`chip st-${h.status}`}>{STATUS_LABEL[h.status]}</span>
                          {h.status === "late" && <div>{h.minutes_off} min late</div>}
                          {h.status === "early" && <div>{Math.abs(h.minutes_off ?? 0)} min early</div>}
                          {h.actual_at && h.status !== "no_show" && (
                            <small className="muted">Actual {formatInstant(h.actual_at)}</small>
                          )}
                        </td>
                      </tr>
                    ))}
                  {r.extra_exchanges.map((x, i) => (
                    <tr key={`x${i}`}>
                      <td className="muted">Not scheduled</td>
                      <td>{name(x.to)}</td>
                      <td>
                        <span className="chip">Extra</span>
                        <div><small className="muted">{formatInstant(x.at)}</small></div>
                      </td>
                    </tr>
                  ))}
                  {liveCount === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">No late or missed exchanges logged.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="row no-print">
            <PrintButton />
            {canWrite && <Link href={`${base}/schedule`} className="btn">Edit schedule</Link>}
          </div>
        </>
      )}
    </>
  );
}
