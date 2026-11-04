import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { createIssueAction, setThreadStatusAction } from "../actions";
import { formatDate, todayLocal } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function IssuesPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const { supabase, canWrite } = await requireMatter(matterId);
  const base = `/m/${matterId}`;

  const { data } = await supabase
    .from("issues")
    .select("id, title, description, created_via, event_issues(count)")
    .eq("matter_id", matterId)
    .order("title");
  const issues = ((data ?? []) as any[]).map((i) => ({
    ...i,
    count: i.event_issues?.[0]?.count ?? 0,
  }));
  const create = createIssueAction.bind(null, matterId);
  const { data: tdata } = await supabase
    .from("threads")
    .select("id, title, description, status, resolved_on, event_threads(count)")
    .eq("matter_id", matterId)
    .order("created_at");
  const threads = (tdata ?? []) as any[];

  return (
    <>
      {threads.length > 0 && (
        <>
          <h1>Follow-up threads</h1>
          <p className="muted">Things you raised more than once. Each message is a step; the report counts the asks and replies.</p>
          {threads.map((t) => (
            <div key={t.id} className="card">
              <div className="row between">
                <a href={`${base}?thread=${t.id}`} className="event-title">{t.title}</a>
                <span className={`status ${t.status}`}>
                  {t.status === "resolved" ? `Resolved ${t.resolved_on ? formatDate(t.resolved_on) : ""}` : "Open"}
                </span>
              </div>
              {t.description && <div className="event-summary">{t.description}</div>}
              <div className="row between" style={{ marginTop: 6 }}>
                <small className="muted">{t.event_threads?.[0]?.count ?? 0} messages/steps</small>
                {canWrite && (
                  <form action={setThreadStatusAction.bind(null, matterId, t.id)} className="row" style={{ gap: 6 }}>
                    {t.status === "open" ? (
                      <>
                        <input type="hidden" name="status" value="resolved" />
                        <input type="date" name="resolved_on" defaultValue={todayLocal()} style={{ width: "auto", padding: "6px" }} />
                        <button className="btn small">Mark resolved</button>
                      </>
                    ) : (
                      <>
                        <input type="hidden" name="status" value="open" />
                        <button className="btn small">Reopen</button>
                      </>
                    )}
                  </form>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <h1 style={{ marginTop: threads.length ? 24 : 0 }}>Issues</h1>
      <p className="muted">Each issue groups the events that support one point, e.g. “Late exchanges”.</p>

      {issues.length === 0 && <div className="card muted">No issues yet.</div>}
      {issues.map((i) => (
        <Link key={i.id} href={`${base}?issue=${i.id}`} className="card event-item">
          <div className="row between">
            <span className="event-title">{i.title}</span>
            <span className="chip">{i.count} event{i.count === 1 ? "" : "s"}</span>
          </div>
          {i.description && <div className="event-summary">{i.description}</div>}
          <div className="row" style={{ marginTop: 6, gap: 12, fontSize: "0.85rem" }}>
            
          </div>
        </Link>
      ))}

      {canWrite && (
        <form action={create} className="card">
          <h2>New issue</h2>
          <div className="field">
            <label htmlFor="t">Name</label>
            <input id="t" name="title" type="text" required placeholder="Parenting availability" />
          </div>
          <div className="field">
            <label htmlFor="d">What it&apos;s about (optional)</label>
            <input id="d" name="description" type="text" />
          </div>
          <button className="btn primary">Create issue</button>
        </form>
      )}
    </>
  );
}
