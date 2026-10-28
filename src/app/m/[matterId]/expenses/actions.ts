"use server";

import { revalidatePath } from "next/cache";
import { requireMatter } from "@/lib/access";
import { isValidDate } from "@/lib/core";

export type ExpenseInput = {
  expense_date: string;
  amount: string;
  category: string;
  description: string;
  child: string;
  paid_by: string;
  other_share_pct: string;
  evidence_id: string | null;
};

export async function createExpenseAction(matterId: string, input: ExpenseInput): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user, canWrite } = await requireMatter(matterId);
  if (!canWrite) return { ok: false, error: "Read-only access" };
  const amount = Number(String(input.amount).replace(/[$,\s]/g, ""));
  const pct = Number(input.other_share_pct);
  if (!isValidDate(input.expense_date)) return { ok: false, error: "Pick a date" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter the amount" };
  if (!input.description.trim()) return { ok: false, error: "Describe the expense" };
  if (input.paid_by !== "a" && input.paid_by !== "b") return { ok: false, error: "Who paid?" };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: "Share must be 0–100%" };
  const { error } = await supabase.from("expenses").insert({
    matter_id: matterId,
    expense_date: input.expense_date,
    amount: Math.round(amount * 100) / 100,
    category: input.category || "other",
    description: input.description.trim(),
    child: input.child.trim() || null,
    paid_by: input.paid_by,
    other_share_pct: pct,
    evidence_id: input.evidence_id,
    created_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/m/${matterId}/expenses`);
  return { ok: true };
}

export async function updateExpenseStatusAction(matterId: string, id: string, formData: FormData) {
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");
  const status = String(formData.get("status") ?? "");
  if (!["open", "requested", "paid", "disputed"].includes(status)) throw new Error("Invalid status");
  const reimbursedRaw = String(formData.get("reimbursed") ?? "").replace(/[$,\s]/g, "");
  const patch: Record<string, unknown> = { status };
  if (reimbursedRaw !== "") {
    const r = Number(reimbursedRaw);
    if (!Number.isFinite(r) || r < 0) throw new Error("Invalid amount");
    patch.reimbursed = Math.round(r * 100) / 100;
  }
  await supabase.from("expenses").update(patch).eq("id", id).eq("matter_id", matterId);
  revalidatePath(`/m/${matterId}/expenses`);
}
