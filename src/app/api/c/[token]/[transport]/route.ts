import { createMcpHandler } from "mcp-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/core";
import { registerTools, SERVER_INSTRUCTIONS } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MCP endpoint for Claude / ChatGPT custom connectors.
 * URL: https://<app>/api/c/<secret-token>/mcp
 * The secret token (created in Settings → AI connector) identifies the user; only its hash is stored.
 */
async function handle(req: Request, ctx: { params: Promise<{ token: string; transport: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 30) return new Response("Not found", { status: 404 });

  const db = createAdminClient();
  const { data: row } = await db
    .from("api_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", sha256Hex(Buffer.from(token)))
    .maybeSingle();
  if (!row || row.revoked_at) return new Response("Not found", { status: 404 });

  // Best-effort usage stamp
  await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

  const handler = createMcpHandler(
    (server) => registerTools(server, { db, userId: row.user_id }),
    {
      serverInfo: { name: "strahorn-matters", version: "0.1.0" },
      instructions: SERVER_INSTRUCTIONS,
    } as never,
    { basePath: `/api/c/${token}`, maxDuration: 60 }
  );
  return handler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
