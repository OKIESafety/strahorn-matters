import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { loadFilterOptions } from "@/lib/queries";
import { loadReportData } from "@/lib/report-data";
import { formatDate, formatTime, formatTimestamp, shortId } from "@/lib/format";
import { Filters, readFilters } from "@/components/filters";
import { PrintButton } from "./print-button";
import { createExportAction } from "./actions";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { matterId } = await params;
  const f = readFilters(await searchParams);
  const { supabase, matter } = await requireMatter(matterId);

  const [{ rows, total, evByEvent }, opts, { data: exports }, { count: leftOut }] = await Promise.all([
    loadReportData(supabase, matterId, f),
    loadFilterOptions(supabase, matterId),
    supabase.from("exports").select("id, title, created_at, items").eq("matter_id", matterId).order("created_at", { ascending: false }).limit(10),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("matter_id", matterId).eq("exclude_from_reports", true),
  ]);

  const issueName = f.issue ? opts.issues.find((i) => i.id === f.issue)?.title : null;
  const personName = f.person ? opts.people.find((p) => p.id === f.person)?.name : null;
  const scope = [
    issueName && `Issue: ${issueName}`,
    f.tag && `Tag: ${f.tag}`,
    personName && `Person: ${personName}`,
    (f.from || f.to) && `Dates: ${f.from ? formatDate(f.from) : "start"} – ${f.to ? formatDate(f.to) : "present"}`,
    f.q && `Search: “${f.q}”`,
  ].filter(Boolean);
  const exportAction = createExportAction.bind(null, matterId);

  return (
    <>
      <div className="no-print">
        <h1>Report</h1>
        <p className="muted">
          Pick filters, then either print this summary or create a numbered exhibit packet with a verification code.
          {(leftOut ?? 0) > 0 && ` ${leftOut} event${leftOut === 1 ? " is" : "s are"} marked “leave out of reports” and not included.`}
        </p>
        <Filters f={f} opts={opts} action={`/m/${matterId}/report`} />

        <form action={exportAction} className="card">
          <h3>Exhibit packet</h3>
          {Object.entries(f).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <div className="field">
            <label htmlFor="ptitle">Title</label>
            <input id="ptitle" name="title" type="text" defaultValue={`${matter.title}${issueName ? ` — ${issueName}` : ""} — Exhibits`} />
          </div>
          <div className="row">
            <button className="btn primary" disabled={!rows.length}>Create exhibit packet ({rows.length})</button>
            <PrintButton />
          </div>
          <small className="muted">
            The packet is a frozen snapshot with a cover page, index, numbered exhibits, photos, and a QR code anyone can
            scan to confirm nothing was altered.
          </small>
        </form>

        {(exports ?? []).length > 0 && (
          <div className="card">
            <h3>Previous packets</h3>
            {(exports ?? []).map((x: any) => (
              <div key={x.id} className="row between" style={{ padding: "4px 0" }}>
                <Link href={`/m/${matterId}/exports/${x.id}`}>{x.title}</Link>
                <small className="muted">
                  {(x.items as any[]).length} exhibits · {formatTimestamp(x.created_at)}
                </small>
              </div>
            ))}
          </div>
        )}
      </div>

      <section style={{ marginTop: 20 }}>
        <h1>{matter.title}{issueName ? ` — ${issueName}` : ""}</h1>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          {total} event{total === 1 ? "" : "s"} · Generated {formatTimestamp(new Date().toISOString())}
          {scope.length ? ` · ${scope.join(" · ")}` : ""}
        </p>

        {rows.map((e, n) => (
          <div key={e.id} className="card">
            <strong>
              {n + 1}. {formatDate(e.event_date)}
              {e.event_time ? `, ${formatTime(e.event_time)}` : ""}
            </strong>
            <div className="event-title">{e.title}</div>
            {e.summary && <p style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{e.summary}</p>}
            {e.details && <p style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{e.details}</p>}
            <small className="muted">
              {[
                e.people.length ? `People: ${e.people.map((p) => p.name).join(", ")}` : null,
                e.attended_by.length ? `Attended by: ${e.attended_by.join(", ")}` : null,
                e.issues.length ? `Issues: ${e.issues.map((i) => i.title).join(", ")}` : null,
                e.source_ref ? `Source: ${e.source_ref}` : null,
                `Ref ${shortId(e.id)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            {(evByEvent.get(e.id) ?? []).map((l) => (
              <div key={l.id} style={{ marginTop: 6, fontSize: "0.88rem" }}>
                📎 {l.filename}
                {l.page_ref ? ` (${l.page_ref})` : ""}{" "}
                <span className="muted mono">sha256 {l.sha256.slice(0, 16)}…</span>
                {l.excerpt && <div className="quote">“{l.excerpt}”</div>}
              </div>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}
