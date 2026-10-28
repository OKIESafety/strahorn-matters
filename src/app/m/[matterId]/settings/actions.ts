"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireMatter } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/core";

const ROLES = ["owner", "contributor", "reviewer"];

export async function addMemberAction(
  matterId: string,
  input: { email: string; name: string; role: string; tempPassword: string }
): Promise<{ ok: boolean; message: string }> {
  const { isOwner } = await requireMatter(matterId);
  if (!isOwner) return { ok: false, message: "Only the owner can add people." };
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "Enter a valid email." };
  if (!ROLES.includes(input.role)) return { ok: false, message: "Pick a role." };

  const admin = createAdminClient();

  // Find an existing account with this email
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { ok: false, message: error.message };
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 200) break;
  }

  let created = false;
  if (!userId) {
    if (input.tempPassword.length < 12) {
      return { ok: false, message: "New accounts need a temporary password of at least 12 characters." };
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: input.tempPassword,
      email_confirm: true,
    });
    if (error) return { ok: false, message: error.message };
    userId = data.user.id;
    created = true;
  }

  const { error } = await admin.from("matter_members").upsert(
    { matter_id: matterId, user_id: userId, role: input.role, display_name: input.name.trim() || null },
    { onConflict: "matter_id,user_id" }
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/m/${matterId}/settings`);
  return {
    ok: true,
    message: created
      ? `Account created. Give ${input.name || email} the temporary password in person; they should change it under Account after signing in.`
      : "Added to this matter.",
  };
}

export async function updateMemberAction(matterId: string, userId: string, formData: FormData) {
  const { isOwner, user } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can change members");
  const admin = createAdminClient();
  const role = String(formData.get("role") ?? "");
  const name = String(formData.get("display_name") ?? "").trim();
  if (formData.get("remove") === "1") {
    if (userId === user.id) throw new Error("You can't remove yourself");
    await admin.from("matter_members").delete().eq("matter_id", matterId).eq("user_id", userId);
  } else {
    await admin
      .from("matter_members")
      .update({
        ...(ROLES.includes(role) && userId !== user.id ? { role } : {}),
        display_name: name || null,
      })
      .eq("matter_id", matterId)
      .eq("user_id", userId);
  }
  revalidatePath(`/m/${matterId}/settings`);
}

export async function createTokenAction(
  matterId: string,
  label: string
): Promise<{ ok: boolean; url?: string; message?: string }> {
  const { supabase, user, canWrite } = await requireMatter(matterId);
  if (!canWrite) return { ok: false, message: "Read-only members can't connect an AI." };
  const token = randomBytes(32).toString("base64url");
  const { error } = await supabase.from("api_tokens").insert({
    user_id: user.id,
    label: label.trim() || "AI connector",
    token_hash: sha256Hex(Buffer.from(token)),
  });
  if (error) return { ok: false, message: error.message };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  revalidatePath(`/m/${matterId}/settings`);
  return { ok: true, url: `${proto}://${host}/api/c/${token}/mcp` };
}

export async function revokeTokenAction(matterId: string, tokenId: string) {
  const { supabase, user } = await requireMatter(matterId);
  await supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("user_id", user.id);
  revalidatePath(`/m/${matterId}/settings`);
}
