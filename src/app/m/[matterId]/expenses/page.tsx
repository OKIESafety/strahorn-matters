import { requireMatter } from "@/lib/access";
import { loadParents } from "@/lib/time-data";
import { formatDate, todayLocal } from "@/lib/format";
import { signAll } from "@/lib/report-data";
import { ExpenseForm } from "./form";
import { updateExpenseStatusAction } from "./actions";
import { PrintButton } from "../report/print-button";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { matterId } = await params;
  const { status } = await searchParams;
  const { supabase, canWrite, matter } = await requireMatter(matterId);
  const parents = await loadParents(supabase, matterId);

  let q = supabase
    .from("expenses")
    .select("id, expense_date, amount, category, description, child, paid_by, other_share_pct, reimbursed, status, evidence(id, storage_path, original_filename)")
    .eq("matter_id", matterId)
    .order("expense_date", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const rows = (data ?? []) as any[];
  const receipts = rows.filter((r) => r.evidence).map((r) => r.evidence);
  await signAll(supabase, receipts);

  // Balance: each expense, the non-paying parent owes their share minus anything already reimbursed.
  let bOwesA = 0;
  let aOwesB = 0;
  for (const r of rows) {
    const share = (Number(r.amount) * Number(r.other_share_pct)) / 100 - Number(r.reimbursed);
    if (share <= 0 || r.status === "paid") continue;
    if (r.paid_by === "a") bOwesA += share;
    else aOwesB += share;
  }
  const net = bOwesA - aOwesB;

  return (
    <>
      <div className="row between">
        <h1>Expenses</h1>
        <div className="no-print"><PrintButton /></div>
      </div>
      <p className="print-only">{matter.title}: child-related expenses</p>

      <div className="stat-grid">
        <div className="card stat">
          <b>{money(bOwesA)}</b>
          <span>{parents.b} owes {parents.a}</span>
        </div>
        <div className="card stat">
          <b>{money(aOwesB)}</b>
          <span>{parents.a} owes {parents.b}</span>
        </div>
        <div className="card stat">
          <b>{money(Math.abs(net))}</b>
          <span>net {net >= 0 ? `owed to ${parents.a}` : `owed to ${parents.b}`}</span>
        </div>
      </div>

      {canWrite && <ExpenseForm matterId={matterId} parents={{ a: parents.a, b: parents.b }} today={todayLocal()} />}

      <form method="get" className="chips no-print" style={{ margin: "12px 0" }}>
        {["", "open", "requested", "paid", "disputed"].map((s) => (
          <button key={s} name="status" value={s} className={`chip ${status === s || (!status && !s) ? "issue" : ""}`} style={{ cursor: "pointer" }}>
            {s || "All"}
          </button>
        ))}
      </form>

      <table className="simple card">
        <thead>
          <tr>
            <th>Date</th>
            <th>Expense</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = (Number(r.amount) * Number(r.other_share_pct)) / 100;
            return (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.expense_date)}</td>
                <td>
                  {r.description}
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {r.category}
                    {r.child ? ` · ${r.child}` : ""} · paid by {r.paid_by === "a" ? parents.a : parents.b} · other share{" "}
                    {Number(r.other_share_pct)}% = {money(share)}
                    {Number(r.reimbursed) > 0 ? ` · reimbursed ${money(Number(r.reimbursed))}` : ""}
                  </div>
                  {r.evidence?.url && (
                    <a href={r.evidence.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem" }}>
                      Receipt
                    </a>
                  )}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(Number(r.amount))}</td>
                <td>
                  {canWrite ? (
                    <form action={updateExpenseStatusAction.bind(null, matterId, r.id)} className="no-print">
                      <select name="status" defaultValue={r.status} style={{ padding: "6px", fontSize: "0.85rem" }}>
                        <option value="open">open</option>
                        <option value="requested">requested</option>
                        <option value="paid">paid</option>
                        <option value="disputed">disputed</option>
                      </select>
                      <input name="reimbursed" type="text" inputMode="decimal" placeholder="$ repaid" style={{ padding: "6px", fontSize: "0.85rem", marginTop: 4 }} />
                      <button className="btn small" style={{ marginTop: 4 }}>Save</button>
                    </form>
                  ) : null}
                  <span className="print-only">{r.status}</span>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">No expenses yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
