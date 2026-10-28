"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePicker } from "./file-picker";
import { uploadOriginals } from "@/lib/upload-client";
import { EVIDENCE_KINDS } from "@/lib/constants";
import { addEvidenceAction } from "@/app/m/[matterId]/actions";

export function AddEvidence({
  matterId,
  eventId,
  showKind = false,
  title = "Add evidence",
}: {
  matterId: string;
  eventId: string | null;
  showKind?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setMsg(null);
    try {
      setBusy(`Uploading 0 of ${files.length}…`);
      const uploaded = await uploadOriginals(matterId, files, (d, t) =>
        setBusy(d < t ? `Uploading ${d} of ${t}…` : "Verifying…")
      );
      const res = await addEvidenceAction(matterId, eventId, uploaded, description, kind);
      if (!res.ok) throw new Error(res.error);
      setFiles([]);
      setDescription("");
      setMsg({ ok: `Saved ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}.` });
      router.refresh();
    } catch (err) {
      setMsg({ error: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="card no-print">
      <h3>{title}</h3>
      {msg?.error && <div className="notice error">{msg.error}</div>}
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      <FilePicker files={files} setFiles={setFiles} label="Files" />
      <div className="field">
        <label htmlFor="ev-desc">Description (optional)</label>
        <input id="ev-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. iMazing export, Oct 1 – Oct 27, 2026" />
      </div>
      {showKind && (
        <div className="field">
          <label htmlFor="ev-kind">Type</label>
          <select id="ev-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Detect automatically</option>
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>{k.replace("_", " ")}</option>
            ))}
          </select>
        </div>
      )}
      <button className="btn primary" disabled={!files.length || !!busy}>
        {busy ?? "Upload"}
      </button>
    </form>
  );
}
