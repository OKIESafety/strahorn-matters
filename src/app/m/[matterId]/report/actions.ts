"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMatter } from "@/lib/access";
import { readFilters } from "@/components/filters";
import { createPacket } from "@/lib/packet";

export async function createExportAction(matterId: string, formData: FormData) {
  const { supabase, user, matter } = await requireMatter(matterId);
  const raw: Record<string, string> = {};
  for (const k of ["q", "tag", "issue", "person", "from", "to", "confidence"]) {
    const v = formData.get(k);
    if (typeof v === "string" && v) raw[k] = v;
  }
  const summary = String(formData.get("summary") ?? "").trim();
  // Remember the latest summary so it's there next time
  await supabase.from("matters").update({ report_summary: summary || null }).eq("id", matterId);
  const id = await createPacket(supabase, {
    matterId,
    userId: user.id,
    title: String(formData.get("title") ?? "").trim() || `${matter.title} — Exhibits`,
    filters: readFilters(raw),
    summary: summary || null,
  });
  revalidatePath(`/m/${matterId}/report`);
  redirect(`/m/${matterId}/exports/${id}`);
}
