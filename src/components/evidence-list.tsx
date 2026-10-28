import { formatBytes, formatTimestamp, shortId } from "@/lib/format";

export type EvidenceView = {
  id: string;
  original_filename: string;
  mime_type: string | null;
  kind: string;
  size_bytes: number | null;
  sha256: string;
  uploaded_at: string;
  uploaded_via: string;
  description: string | null;
  url: string | null;
  excerpt?: string | null;
  page_ref?: string | null;
};

export function EvidenceList({ items }: { items: EvidenceView[] }) {
  if (!items.length) return <p className="muted">No evidence attached.</p>;
  return (
    <div className="stack">
      <div className="evidence-grid">
        {items.map((ev) => (
          <a key={ev.id} className="evidence-tile" href={ev.url ?? "#"} target="_blank" rel="noreferrer">
            {ev.url && ev.mime_type?.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ev.url} alt={ev.original_filename} loading="lazy" />
            ) : (
              <div className="doc">{(ev.original_filename.split(".").pop() ?? "file").toUpperCase()}</div>
            )}
            <div className="meta">
              <div>{ev.original_filename}</div>
              <div className="muted">
                {ev.kind.replace("_", " ")} · {formatBytes(ev.size_bytes)}
              </div>
            </div>
          </a>
        ))}
      </div>
      {items.some((e) => e.excerpt || e.page_ref || e.description) && (
        <div>
          {items
            .filter((e) => e.excerpt || e.page_ref || e.description)
            .map((e) => (
              <div key={e.id} style={{ marginBottom: 8 }}>
                <small className="muted">
                  {e.original_filename}
                  {e.page_ref ? ` · ${e.page_ref}` : ""}
                </small>
                {e.description && <div style={{ fontSize: "0.92rem" }}>{e.description}</div>}
                {e.excerpt && <div className="quote">“{e.excerpt}”</div>}
              </div>
            ))}
        </div>
      )}
      <details>
        <summary className="muted" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
          Integrity details
        </summary>
        <table className="simple" style={{ marginTop: 6 }}>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>
                  <div>{e.original_filename}</div>
                  <small className="muted">
                    ID {shortId(e.id)} · uploaded {formatTimestamp(e.uploaded_at)}
                    {e.uploaded_via === "ai" ? " via AI" : ""}
                  </small>
                </td>
                <td className="mono" style={{ wordBreak: "break-all" }}>SHA-256 {e.sha256}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
