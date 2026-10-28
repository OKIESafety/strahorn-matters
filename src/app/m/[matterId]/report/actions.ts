"use server";

import { redirect } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { readFilters } from "@/components/filters";
import { buildExportItems, loadReportData, manifestHash } from "@/lib/report-data";

export async function createExportAction(matterId: string, formData: FormData) {
  const { supabase, user, matter } = await requireMatter(matterId);
  const raw: Record<string, string> = {};
  for (const k of ["q", "tag", "issue", "person", "from", "to", "confidence"]) {
    const v = formData.get(k);
    if (typeof v === "string" && v) raw[k] = v;
  }
  const f = readFilters(raw);
  const { rows, evByEvent } = await loadReportData(supabase, matterId, f);
  if (!rows.length) throw new Error("No events match these filters");
  const items = buildExportItems(rows, evByEvent);
  const title = String(formData.get("title") ?? "").trim() || `${matter.title} — Exhibits`;

  const { data, error } = await supabase
    .from("exports")
    .insert({
      matter_id: matterId,
      title,
      filters: f,
      items,
      manifest_sha256: manifestHash(items),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/m/${matterId}/exports/${data.id}`);
}
