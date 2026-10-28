import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { EVENT_SELECT, shapeEvent, loadFilterOptions } from "@/lib/queries";
import { CONFIDENCE } from "@/lib/constants";
import { updateEventAction } from "../../../actions";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ matterId: string; eventId: string }>;
}) {
  const { matterId, eventId } = await params;
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) redirect(`/m/${matterId}/e/${eventId}`);

  const { data } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .eq("matter_id", matterId)
    .maybeSingle();
  if (!data) notFound();
  const e = shapeEvent(data);
  const opts = await loadFilterOptions(supabase, matterId);
  const action = updateEventAction.bind(null, matterId, eventId);
  const selIssues = new Set(e.issues.map((i) => i.title));
  const selPeople = new Set(e.people.map((p) => p.name));

  return (
    <form action={action}>
      <h1>Edit event</h1>
      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" type="text" defaultValue={e.title} required />
      </div>
      <div className="field">
        <label htmlFor="summary">What happened</label>
        <textarea id="summary" name="summary" defaultValue={e.summary} />
      </div>
      <div className="field">
        <label htmlFor="details">More detail (optional)</label>
        <textarea id="details" name="details" defaultValue={e.details ?? ""} />
      </div>
      <div className="row">
        <div className="field grow">
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={e.event_date} required />
        </div>
        <div className="field grow">
          <label htmlFor="time">Time</label>
          <input id="time" name="time" type="time" defaultValue={e.event_time?.slice(0, 5) ?? ""} />
        </div>
      </div>
      <div className="field">
        <span className="label">Issues</span>
        <div className="chips">
          {opts.issues.map((i) => (
            <label key={i.id} className="chip">
              <input type="checkbox" name="issue" value={i.title} defaultChecked={selIssues.has(i.title)} />
              {i.title}
            </label>
          ))}
        </div>
        <input name="new_issue" type="text" placeholder="New issue (optional)" style={{ marginTop: 8 }} />
      </div>
      <div className="field">
        <span className="label">People</span>
        <div className="chips">
          {opts.people.map((p) => (
            <label key={p.id} className="chip">
              <input type="checkbox" name="person" value={p.name} defaultChecked={selPeople.has(p.name)} />
              {p.name}
            </label>
          ))}
        </div>
        <input name="new_person" type="text" placeholder="Add a person (optional)" style={{ marginTop: 8 }} />
      </div>
      {opts.people.length > 0 && (
        <div className="field">
          <span className="label">Who attended</span>
          <div className="chips">
            {opts.people.map((p) => (
              <label key={p.id} className="chip">
                <input type="checkbox" name="attended" value={p.name} defaultChecked={e.attended_by.includes(p.name)} />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="tags">Tags (comma-separated)</label>
        <input id="tags" name="tags" type="text" defaultValue={e.tags.join(", ")} />
      </div>
      <div className="field">
        <label htmlFor="confidence">Confidence</label>
        <select id="confidence" name="confidence" defaultValue={e.confidence}>
          {CONFIDENCE.map((c) => (
            <option key={c.value} value={c.value}>{c.label}: {c.hint}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="source_ref">Source reference</label>
        <input id="source_ref" name="source_ref" type="text" defaultValue={e.source_ref ?? ""} placeholder="e.g. iMazing export 10/27/2026, row 4123" />
      </div>
      <div className="row">
        <button className="btn primary">Save changes</button>
        <Link className="btn" href={`/m/${matterId}/e/${eventId}`}>Cancel</Link>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
        Every change is recorded in the event&apos;s history.
      </p>
    </form>
  );
}
