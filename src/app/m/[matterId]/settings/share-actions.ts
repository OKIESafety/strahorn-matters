"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireMatter } from "@/lib/access";
import { sha256Hex } from "@/lib/core";
import { siteOrigin } from "@/lib/qr";

export async function createShareLinkAction(
  matterId: string,
  input: { label: string; days: number; issueId: string; from: string; to: string }
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { supabase, user, isOwner } = await requireMatter(matterId);
  if (!isOwner) return { ok: false, error: "Only the owner can share" };
  const days = [1, 7, 30, 90].includes(input.days) ? input.days : 7;
  const token = randomBytes(24).toString("base64url");
  const filters: Record<string, string> = {};
  if (input.issueId) filters.issue = input.issueId;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.from)) filters.from = input.from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.to)) filters.to = input.to;
  const { error } = await supabase.from("share_links").insert({
    matter_id: matterId,
    label: input.label.trim() || "Attorney",
    token_hash: sha256Hex(Buffer.from(token)),
    filters,
    expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    created_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/m/${matterId}/settings`);
  return { ok: true, url: `${await siteOrigin()}/s/${token}` };
}

export async function revokeShareLinkAction(matterId: string, id: string) {
  const { supabase, isOwner } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can revoke");
  await supabase.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("matter_id", matterId);
  revalidatePath(`/m/${matterId}/settings`);
}
