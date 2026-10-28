import { formatDate, formatTime, shortId } from "@/lib/format";
import type { ExportItem } from "@/lib/report-data";

/** Renders exhibit items (shared by the packet, the attorney share page and the verify page). */
export function ExhibitBody({
  items,
  urls,
  pageBreaks = true,
}: {
  items: ExportItem[];
  urls: Map<string, string | null>;
  pageBreaks?: boolean;
}) {
  return (
    <>
      {items.map((e) => (
        <section key={e.exhibit} className={`card exhibit${pageBreaks ? " page-break" : ""}`}>
          <div className="row between">
            <strong>Exhibit {e.exhibit}</strong>
            <span className="muted">
              {formatDate(e.date)}
              {e.time ? `, ${formatTime(e.time)}` : ""}
            </span>
          </div>
          <h3 style={{ marginTop: 6 }}>{e.title}</h3>
          {e.summary && <p style={{ whiteSpace: "pre-wrap" }}>{e.summary}</p>}
          {e.details && <p style={{ whiteSpace: "pre-wrap" }}>{e.details}</p>}
          <dl className="kv">
            {e.people.length > 0 && (
              <>
                <dt>People</dt>
                <dd>{e.people.join(", ")}</dd>
              </>
            )}
            {e.attended_by.length > 0 && (
              <>
                <dt>Attended by</dt>
                <dd>{e.attended_by.join(", ")}</dd>
              </>
            )}
            {e.issues.length > 0 && (
              <>
                <dt>Issue</dt>
                <dd>{e.issues.join(", ")}</dd>
              </>
            )}
            {e.source_ref && (
              <>
                <dt>Source</dt>
                <dd>{e.source_ref}</dd>
              </>
            )}
          </dl>
          {e.evidence.map((v, j) => {
            const url = urls.get(v.id) ?? null;
            const isImage = (v.mime_type ?? "").startsWith("image/");
            return (
              <div key={v.id} className="exhibit-evidence">
                <div style={{ fontSize: "0.88rem" }}>
                  <b>
                    {e.exhibit}.{j + 1}
                  </b>{" "}
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">{v.filename}</a>
                  ) : (
                    v.filename
                  )}
                  {v.page_ref ? ` (${v.page_ref})` : ""}
                </div>
                {v.excerpt && <div className="quote">“{v.excerpt}”</div>}
                {isImage && url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={v.filename} className="exhibit-img" />
                )}
                <div className="mono muted" style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>
                  ID {shortId(v.id)} · SHA-256 {v.sha256}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
