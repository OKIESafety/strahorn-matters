import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceView } from "@/components/evidence-list";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Adds short-lived signed URLs (1 hour) to evidence rows. */
export async function withSignedUrls(db: SupabaseClient, rows: any[]): Promise<EvidenceView[]> {
  if (!rows.length) return [];
  const paths = rows.map((r) => r.storage_path as string);
  const { data } = await db.storage.from("evidence").createSignedUrls(paths, 3600);
  const urlByPath = new Map<string, string>();
  for (const s of data ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  return rows.map((r) => ({
    id: r.id,
    original_filename: r.original_filename,
    mime_type: r.mime_type,
    kind: r.kind,
    size_bytes: r.size_bytes,
    sha256: r.sha256,
    uploaded_at: r.uploaded_at,
    uploaded_via: r.uploaded_via,
    description: r.description,
    url: urlByPath.get(r.storage_path) ?? null,
    excerpt: r.excerpt ?? null,
    page_ref: r.page_ref ?? null,
  }));
}

export async function memberNames(db: SupabaseClient, matterId: string) {
  const { data } = await db
    .from("matter_members")
    .select("user_id, display_name")
    .eq("matter_id", matterId);
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.user_id, m.display_name || "Member");
  return map;
}
