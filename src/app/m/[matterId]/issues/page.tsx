import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { createIssueAction } from "../actions";

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

  return (
    <>
      <h1>Issues</h1>
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
