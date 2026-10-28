import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { EVENT_SELECT, shapeEvent } from "@/lib/queries";
import { formatDate, formatTime, formatTimestamp } from "@/lib/format";
import { CONFIDENCE } from "@/lib/constants";
import { withSignedUrls, memberNames } from "@/lib/evidence-load";
import { ConfidenceChip } from "@/components/event-card";
import { EvidenceList } from "@/components/evidence-list";
import { AddEvidence } from "@/components/add-evidence";
import { addNoteAction, markReviewedAction, deleteEventAction, setExcludeAction } from "../../actions";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string; eventId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { matterId, eventId } = await params;
  const { saved } = await searchParams;
  const { supabase, canWrite, isOwner } = await requireMatter(matterId);
  const base = `/m/${matterId}`;

  const { data: raw } = await supabase
    .from("events")
    .select(`${EVENT_SELECT}, created_at, created_by, updated_at`)
    .eq("id", eventId)
    .eq("matter_id", matterId)
    .maybeSingle();
  if (!raw) notFound();
  const r = raw as any;
  const e = shapeEvent(r);

  const [{ data: links }, { data: notes }, { data: history }, names] = await Promise.all([
    supabase
      .from("event_evidence")
      .select("excerpt, page_ref, evidence(id, storage_path, original_filename, mime_type, kind, size_bytes, sha256, uploaded_at, uploaded_via, description)")
      .eq("event_id", eventId),
    supabase.from("notes").select("id, body, author, author_kind, created_at").eq("event_id", eventId).order("created_at"),
    isOwner
      ? supabase
          .from("audit_log")
          .select("id, actor, actor_kind, action, entity, at, detail")
          .eq("matter_id", matterId)
          .eq("entity_id", eventId)
          .order("at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] as any[] }),
    memberNames(supabase, matterId),
  ]);

  const evidence = await withSignedUrls(
    supabase,
    ((links ?? []) as any[])
      .filter((l) => l.evidence)
      .map((l) => ({ ...l.evidence, excerpt: l.excerpt, page_ref: l.page_ref }))
  );

  const note = addNoteAction.bind(null, matterId, { eventId });
  const del = deleteEventAction.bind(null, matterId, eventId);
  const review = markReviewedAction.bind(null, matterId, eventId);
  const toggleExclude = setExcludeAction.bind(null, matterId, eventId, !e.exclude_from_reports);

  return (
    <>
      {saved && <div className="notice">Saved.</div>}
      {e.exclude_from_reports && (
        <div className="notice warn">Left out of reports, exhibit packets and share links. It stays in your private record.</div>
      )}
      <div className="card">
        <div className="row between">
          <span className="event-date">
            {formatDate(e.event_date)}
            {e.event_time ? ` · ${formatTime(e.event_time)}` : ""}
          </span>
          <ConfidenceChip value={e.confidence} />
        </div>
        <h1 style={{ marginTop: 6 }}>{e.title}</h1>
        {e.summary && <p style={{ whiteSpace: "pre-wrap" }}>{e.summary}</p>}
        {e.details && <p style={{ whiteSpace: "pre-wrap" }} className="muted">{e.details}</p>}

        <div className="chips" style={{ margin: "8px 0" }}>
          {e.issues.map((i) => (
            <Link key={i.id} href={`${base}?issue=${i.id}`} className="chip issue">{i.title}</Link>
          ))}
          {e.tags.map((t) => (
            <Link key={t} href={`${base}?tag=${encodeURIComponent(t)}`} className="chip">#{t}</Link>
          ))}
        </div>

        <dl className="kv">
          {e.people.length > 0 && (
            <>
              <dt>People</dt>
              <dd>{e.people.map((p) => p.name).join(", ")}</dd>
            </>
          )}
          {e.attended_by.length > 0 && (
            <>
              <dt>Attended by</dt>
              <dd>{e.attended_by.join(", ")}</dd>
            </>
          )}
          {e.source_ref && (
            <>
              <dt>Source</dt>
              <dd>{e.source_ref}</dd>
            </>
          )}
          <dt>Added</dt>
          <dd>
            {formatTimestamp(r.created_at)} by {names.get(r.created_by) ?? "member"}
          </dd>
        </dl>

        {canWrite && (
          <div className="row no-print" style={{ marginTop: 12 }}>
            <Link className="btn small" href={`${base}/e/${eventId}/edit`}>Edit</Link>
            {e.confidence === "needs_review" && (
              <form action={review} className="row" style={{ gap: 6 }}>
                <select name="confidence" defaultValue="confirmed" style={{ width: "auto", padding: "6px 8px" }}>
                  {CONFIDENCE.filter((c) => c.value !== "needs_review").map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <button className="btn small primary">Mark reviewed</button>
              </form>
            )}
            <form action={toggleExclude}>
              <button className="btn small">
                {e.exclude_from_reports ? "Include in reports" : "Leave out of reports"}
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Evidence</h2>
        <EvidenceList items={evidence} />
      </div>

      {canWrite && <AddEvidence matterId={matterId} eventId={eventId} title="Add more evidence" />}

      <div className="card">
        <h2>Notes</h2>
        {(notes ?? []).length === 0 && <p className="muted">No notes yet.</p>}
        {(notes ?? []).map((n: any) => (
          <div key={n.id} style={{ marginBottom: 10 }}>
            <small className="muted">
              {names.get(n.author) ?? "Member"}
              {" · "}{formatTimestamp(n.created_at)}
            </small>
            <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
          </div>
        ))}
        <form action={note} className="no-print" style={{ marginTop: 10 }}>
          <textarea name="body" placeholder="Add a note (notes can't be edited later)" style={{ minHeight: 70 }} />
          <button className="btn small" style={{ marginTop: 6 }}>Add note</button>
        </form>
      </div>

      {isOwner && (history ?? []).length > 0 && (
        <details className="card no-print">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>History</summary>
          <table className="simple" style={{ marginTop: 8 }}>
            <tbody>
              {(history as any[]).map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatTimestamp(h.at)}</td>
                  <td>
                    {names.get(h.actor) ?? "Someone"}
                    {" · "}{h.action} {h.entity.replace("_", " ")}
                    {h.action === "update" && h.detail && (
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        changed {Object.keys(h.detail).join(", ")}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {isOwner && (
        <details className="no-print" style={{ marginTop: 24 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: "0.85rem" }}>Delete event…</summary>
          <form action={del} style={{ marginTop: 8 }}>
            <small className="muted" style={{ display: "block", marginBottom: 6 }}>
              Evidence files are always kept. The deletion is recorded in the matter&apos;s audit log.
            </small>
            <button className="btn small danger">Yes, delete this event</button>
          </form>
        </details>
      )}
    </>
  );
}
