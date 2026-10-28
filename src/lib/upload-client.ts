"use client";

import { createClient } from "@/lib/supabase/client";

export type UploadedFile = {
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
};

async function sha256Hex(file: File) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeFilename(name: string) {
  const cleaned = name.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(-120) || "file";
}

/** Uploads originals straight to private storage. Files are never overwritten. */
export async function uploadOriginals(
  matterId: string,
  files: File[],
  onProgress?: (done: number, total: number) => void
): Promise<UploadedFile[]> {
  const supabase = createClient();
  const out: UploadedFile[] = [];
  let done = 0;
  for (const file of files) {
    const sha256 = await sha256Hex(file);
    const storagePath = `${matterId}/${crypto.randomUUID()}/${safeFilename(file.name)}`;
    const { error } = await supabase.storage.from("evidence").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
    out.push({
      storagePath,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      sha256,
    });
    done++;
    onProgress?.(done, files.length);
  }
  return out;
}
