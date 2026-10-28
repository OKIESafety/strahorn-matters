"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePicker } from "@/components/file-picker";
import { uploadOriginals } from "@/lib/upload-client";
import { addEvidenceAction } from "../actions";
import { createExpenseAction } from "./actions";

export const EXPENSE_CATEGORIES = ["medical", "dental", "counseling", "school", "activities", "childcare", "clothing", "travel", "other"];

export function ExpenseForm({ matterId, parents, today }: { matterId: string; parents: { a: string; b: string }; today: string }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("medical");
  const [description, setDescription] = useState("");
  const [child, setChild] = useState("");
  const [paidBy, setPaidBy] = useState("a");
  const [pct, setPct] = useState("50");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      let evidenceId: string | null = null;
      if (files.length) {
        const up = await uploadOriginals(matterId, files.slice(0, 1));
        const r = await addEvidenceAction(matterId, null, up, `Receipt: ${description}`, "document");
        if (!r.ok) throw new Error(r.error);
        evidenceId = r.id ?? null;
      }
      const res = await createExpenseAction(matterId, {
        expense_date: date,
        amount,
        category,
        description,
        child,
        paid_by: paidBy,
        other_share_pct: pct,
        evidence_id: evidenceId,
      });
      if (!res.ok) throw new Error(res.error);
      setMsg({ ok: "Expense saved." });
      setAmount("");
      setDescription("");
      setFiles([]);
      router.refresh();
    } catch (err) {
      setMsg({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card no-print">
      <h2>Add an expense</h2>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="notice error">{msg.error}</div>}
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={{ flex: 1.2 }} />
        <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$ amount" required style={{ flex: 1 }} />
      </div>
      <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it was for" required style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 8 }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ flex: 1 }}>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input type="text" value={child} onChange={(e) => setChild(e.target.value)} placeholder="Child (optional)" style={{ flex: 1 }} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} style={{ flex: 1 }}>
          <option value="a">Paid by {parents.a}</option>
          <option value="b">Paid by {parents.b}</option>
        </select>
        <label className="muted" style={{ fontSize: "0.85rem", flex: 1 }}>
          Other parent&apos;s share %
          <input type="text" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
        </label>
      </div>
      <FilePicker files={files} setFiles={(f) => setFiles(f.slice(-1))} label="Receipt (optional)" />
      <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save expense"}</button>
    </form>
  );
}
