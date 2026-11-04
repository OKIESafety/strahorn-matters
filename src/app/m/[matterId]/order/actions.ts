"use server";

import { revalidatePath } from "next/cache";
import { requireMatter } from "@/lib/access";
import { ORDER_CATEGORIES } from "@/lib/orders";

function read(formData: FormData) {
  const category = String(formData.get("category") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  if (!title || !summary) throw new Error("Title and summary are required");
  return {
    category: ORDER_CATEGORIES.includes(category) ? category : "Other",
    title,
    summary,
    quote: String(formData.get("quote") ?? "").trim() || null,
    citation: String(formData.get("citation") ?? "").trim() || null,
    key_fact: formData.get("key_fact") === "on",
  };
}

export async function saveProvisionAction(matterId: string, id: string | null, formData: FormData) {
  const { supabase, user, isOwner } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can change court-order terms");
  const row = read(formData);
  if (id) {
    const { error } = await supabase.from("order_provisions").update(row).eq("id", id).eq("matter_id", matterId);
    if (error) throw new Error(error.message);
  } else {
    const { data: last } = await supabase
      .from("order_provisions")
      .select("sort")
      .eq("matter_id", matterId)
      .eq("category", row.category)
      .order("sort", { ascending: false })
      .limit(1)
      .maybeSingle();
    const base = (ORDER_CATEGORIES.indexOf(row.category) + 1) * 10;
    const { error } = await supabase
      .from("order_provisions")
      .insert({ ...row, matter_id: matterId, sort: (last?.sort ?? base) + 1, created_by: user.id });
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/m/${matterId}/order`);
}

export async function deleteProvisionAction(matterId: string, id: string) {
  const { supabase, isOwner } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can change court-order terms");
  await supabase.from("order_provisions").delete().eq("id", id).eq("matter_id", matterId);
  revalidatePath(`/m/${matterId}/order`);
}

export async function saveCaseAction(matterId: string, formData: FormData) {
  const { supabase, isOwner } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can change case details");
  const { error } = await supabase
    .from("matters")
    .update({
      case_number: String(formData.get("case_number") ?? "").trim() || null,
      court: String(formData.get("court") ?? "").trim() || null,
      caption: String(formData.get("caption") ?? "").trim() || null,
    })
    .eq("id", matterId);
  if (error) throw new Error(error.message);
  revalidatePath(`/m/${matterId}`, "layout");
}
