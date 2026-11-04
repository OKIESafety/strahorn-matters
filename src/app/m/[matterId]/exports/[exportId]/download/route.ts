import { zipSync, strToU8 } from "fflate";
import { createClient } from "@/lib/supabase/server";
import { buildAppendix, type ExportItem } from "@/lib/report-data";
import { safeFilename } from "@/lib/core";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
/** ZIP of every original file in a report, named by its Appendix number, plus an index with fingerprints. */
export async function GET(_req: Request, ctx: { params: Promise<{ matterId: string; exportId: string }> }) {
  const { matterId, exportId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  // RLS limits this to members of the matter
  const { data: ex } = await supabase
    .from("exports")
    .select("id, title, items, manifest_sha256, created_at")
    .eq("id", exportId)
    .eq("matter_id", matterId)
    .maybeSingle();
  if (!ex) return new Response("Not found", { status: 404 });

  const items = ex.items as ExportItem[];
  const appendix = buildAppendix(items);
  const { data: ev } = await supabase
    .from("evidence")
    .select("id, storage_path, size_bytes")
    .in("id", appendix.map((a) => a.id));
  const byId = new Map(((ev ?? []) as any[]).map((e) => [e.id, e]));

  const files: Record<string, Uint8Array> = {};
  const lines = [
    `${ex.title}`,
    `Report created ${new Date(ex.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" })}`,
    `Report fingerprint (SHA-256): ${ex.manifest_sha256}`,
    "",
    "Appendix item | File | Supports events | SHA-256",
  ];
  let budget = 200 * 1024 * 1024;
  for (const a of appendix) {
    const rec = byId.get(a.id);
    const name = `${a.ref} ${safeFilename(a.filename)}`;
    if (!rec || (rec.size_bytes ?? 0) > budget) {
      lines.push(`${a.ref} | ${a.filename} | ${a.supports.join(", ")} | ${a.sha256} | NOT INCLUDED (too large; open in app)`);
      continue;
    }
    const { data } = await supabase.storage.from("evidence").download(rec.storage_path);
    if (!data) {
      lines.push(`${a.ref} | ${a.filename} | ${a.supports.join(", ")} | ${a.sha256} | NOT INCLUDED (unavailable)`);
      continue;
    }
    const buf = new Uint8Array(await data.arrayBuffer());
    budget -= buf.length;
    files[name] = buf;
    lines.push(`${a.ref} | ${a.filename} | ${a.supports.join(", ")} | ${a.sha256}`);
  }
  lines.push("", "Event index", "Event | Date | Issue | Description");
  for (const i of items) lines.push(`${i.exhibit} | ${i.date} | ${i.group ?? i.issues[0] ?? ""} | ${i.title}`);
  files["00 Index.txt"] = strToU8(lines.join("\r\n"));

  const zip = zipSync(files, { level: 6 });
  const fname = `${safeFilename(ex.title).replace(/\s+/g, "_").slice(0, 80) || "report"}_files.zip`;
  return new Response(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
