import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { manifestHash, type ExportItem } from "@/lib/report-data";
import { sha256Hex } from "@/lib/core";
import { formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify exhibit packet", robots: { index: false } };

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ check?: string }>;
}) {
  const { id } = await params;
  const { check } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data: ex } = await db.from("exports").select("id, title, items, manifest_sha256, created_at").eq("id", id).maybeSingle();
  if (!ex) notFound();

  const items = ex.items as ExportItem[];
  const packetIntact = manifestHash(items) === ex.manifest_sha256;
  const files = items.flatMap((i) => i.evidence.map((v) => ({ ...v, exhibit: i.exhibit })));
  const ids = Array.from(new Set(files.map((f) => f.id)));
  const { data: ev } = ids.length
    ? await db.from("evidence").select("id, sha256, storage_path, uploaded_at, size_bytes").in("id", ids)
    : { data: [] as any[] };
  const byId = new Map((ev ?? []).map((e: any) => [e.id, e]));

  // Optional deep check: re-download each original and re-compute its fingerprint (bounded).
  const rehash = new Map<string, boolean | null>();
  if (check === "files") {
    let budget = 150 * 1024 * 1024;
    for (const fid of ids) {
      const rec: any = byId.get(fid);
      if (!rec || (rec.size_bytes ?? 0) > budget) {
        rehash.set(fid, null);
        continue;
      }
      const { data } = await db.storage.from("evidence").download(rec.storage_path);
      if (!data) {
        rehash.set(fid, false);
        continue;
      }
      const buf = Buffer.from(await data.arrayBuffer());
      budget -= buf.length;
      rehash.set(fid, sha256Hex(buf) === rec.sha256);
    }
  }

  const allMatch = files.every((f) => (byId.get(f.id) as any)?.sha256 === f.sha256);
  const ok = packetIntact && allMatch && (check !== "files" || Array.from(rehash.values()).every((v) => v !== false));

  return (
    <main className="container" style={{ paddingTop: 24 }}>
      <h1>Exhibit packet verification</h1>
      <div className={`notice ${ok ? "" : "error"}`} style={{ fontSize: "1rem" }}>
        {ok
          ? "Verified: this packet and its files match the records stored when it was created."
          : "Warning: something in this packet does not match the stored records."}
      </div>
      <dl className="kv card">
        <dt>Title</dt>
        <dd>{ex.title}</dd>
        <dt>Created</dt>
        <dd>{formatTimestamp(ex.created_at)}</dd>
        <dt>Exhibits</dt>
        <dd>{items.length}</dd>
        <dt>Packet fingerprint</dt>
        <dd className="mono" style={{ wordBreak: "break-all" }}>{ex.manifest_sha256}</dd>
        <dt>Contents unchanged</dt>
        <dd>{packetIntact ? "Yes" : "No"}</dd>
      </dl>

      <div className="card">
        <div className="row between">
          <h2>Files</h2>
          {check !== "files" && files.length > 0 && (
            <a className="btn small" href={`/verify/${ex.id}?check=files`}>Re-check every file</a>
          )}
        </div>
        <table className="simple">
          <tbody>
            {files.map((f) => {
              const rec: any = byId.get(f.id);
              const match = rec?.sha256 === f.sha256;
              const r = rehash.get(f.id);
              return (
                <tr key={`${f.exhibit}-${f.id}`}>
                  <td>
                    <div>
                      Exhibit {f.exhibit}: {f.filename}
                    </div>
                    <div className="mono muted" style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>{f.sha256}</div>
                    {rec?.uploaded_at && <small className="muted">Original stored {formatTimestamp(rec.uploaded_at)}</small>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {match ? "✓ Matches" : "✗ Mismatch"}
                    {r === true && <div>✓ Re-hashed</div>}
                    {r === false && <div>✗ File changed</div>}
                    {r === null && check === "files" && <div className="muted">Too large to re-check here</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Original files are stored write-once: they can&apos;t be edited or deleted after upload. Each file&apos;s SHA-256
        fingerprint was computed when it was uploaded.
      </p>
    </main>
  );
}
