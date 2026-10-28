import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { formatBytes, formatTimestamp, shortId } from "@/lib/format";
import { withSignedUrls } from "@/lib/evidence-load";
import { AddEvidence } from "@/components/add-evidence";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { matterId } = await params;
  const { kind } = await searchParams;
  const { supabase, canWrite } = await requireMatter(matterId);
  const base = `/m/${matterId}`;

  let q = supabase
    .from("evidence")
    .select("id, storage_path, original_filename, mime_type, kind, size_bytes, sha256, uploaded_at, uploaded_via, description, event_evidence(event_id)")
    .eq("matter_id", matterId)
    .order("uploaded_at", { ascending: false })
    .limit(300);
  if (kind) q = q.eq("kind", kind);
  const { data } = await q;
  const rows = (data ?? []) as any[];
  const signed = await withSignedUrls(supabase, rows);
  const urlById = new Map(signed.map((s) => [s.id, s.url]));

  return (
    <>
      <h1>Evidence</h1>
      <p className="muted">
        Every original file, exactly as uploaded. Files can&apos;t be changed or deleted.
      </p>

      {canWrite && (
        <AddEvidence
          matterId={matterId}
          eventId={null}
          showKind
          title="Upload files or a text export"
        />
      )}
      {canWrite && (
        <p className="muted no-print" style={{ fontSize: "0.88rem" }}>
          Tip: export from iMazing as <b>CSV</b>, upload it here, then ask Claude or ChatGPT to
          “process the latest text export in Strahorn Matters.”
        </p>
      )}

      <div className="chips no-print" style={{ margin: "12px 0" }}>
        {["", "text_export", "screenshot", "photo", "document"].map((k) => (
          <Link key={k} href={k ? `${base}/evidence?kind=${k}` : `${base}/evidence`} className={`chip ${kind === k || (!kind && !k) ? "issue" : ""}`}>
            {k ? k.replace("_", " ") : "All"}
          </Link>
        ))}
      </div>

      <table className="simple card">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={urlById.get(r.id) ?? "#"} target="_blank" rel="noreferrer">
                  {r.original_filename}
                </a>
                {r.description && <div style={{ fontSize: "0.88rem" }}>{r.description}</div>}
                <small className="muted">
                  {r.kind.replace("_", " ")} · {formatBytes(r.size_bytes)} · {formatTimestamp(r.uploaded_at)}
                  {r.uploaded_via === "ai" ? " · via AI" : ""}
                </small>
              </td>
              <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                <div className="mono" title={r.id}>ID {shortId(r.id)}</div>
                <small className="muted">
                  {(r.event_evidence ?? []).length} event{(r.event_evidence ?? []).length === 1 ? "" : "s"}
                </small>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="muted">Nothing uploaded yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
