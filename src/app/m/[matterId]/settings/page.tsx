import { requireMatter } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatTimestamp } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/constants";
import { signOut } from "@/app/actions";
import { addPersonAction } from "../actions";
import { revokeTokenAction, updateMemberAction } from "./actions";
import { AddMember, ChangePassword, CreateToken } from "./client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function SettingsPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const { supabase, user, isOwner, canWrite } = await requireMatter(matterId);

  const [{ data: members }, { data: people }, { data: tokens }, { data: audit }] = await Promise.all([
    supabase.from("matter_members").select("user_id, role, display_name").eq("matter_id", matterId),
    supabase.from("people").select("id, name, relationship").eq("matter_id", matterId).order("name"),
    supabase.from("api_tokens").select("id, label, created_at, last_used_at, revoked_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    isOwner
      ? supabase.from("audit_log").select("id, actor, actor_kind, action, entity, at").eq("matter_id", matterId).order("at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Emails for the member list (owner only, via admin)
  const emails = new Map<string, string>();
  if (isOwner) {
    const admin = createAdminClient();
    for (const m of members ?? []) {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      if (data.user?.email) emails.set(m.user_id, data.user.email);
    }
  }
  const nameOf = (id: string) =>
    (members ?? []).find((m) => m.user_id === id)?.display_name || emails.get(id) || "Member";

  return (
    <>
      <h1>{isOwner ? "Settings" : "Account"}</h1>

      <div className="card">
        <h2>Your account</h2>
        <p className="muted">{user.email}</p>
        <ChangePassword />
        <form action={signOut} style={{ marginTop: 12 }}>
          <button className="btn small">Sign out</button>
        </form>
      </div>

      {isOwner && (
        <div className="card">
          <h2>Who has access</h2>
          <table className="simple">
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.user_id}>
                  <td>
                    <form action={updateMemberAction.bind(null, matterId, m.user_id)} className="stack">
                      <input name="display_name" type="text" defaultValue={m.display_name ?? ""} placeholder="Display name" />
                      <small className="muted">{emails.get(m.user_id)}</small>
                      <div className="row">
                        <select name="role" defaultValue={m.role} disabled={m.user_id === user.id} style={{ width: "auto" }}>
                          {Object.entries(ROLE_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        <button className="btn small">Save</button>
                        {m.user_id !== user.id && (
                          <button className="btn small danger" name="remove" value="1">Remove</button>
                        )}
                      </div>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 16 }}>Add someone</h3>
          <AddMember matterId={matterId} />
        </div>
      )}

      <div className="card">
        <h2>People in this matter</h2>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          The names you tag on events (not app logins).
        </p>
        <ul>
          {(people ?? []).map((p) => (
            <li key={p.id}>
              {p.name}
              {p.relationship ? <span className="muted"> · {p.relationship}</span> : null}
            </li>
          ))}
        </ul>
        {canWrite && (
          <form action={addPersonAction.bind(null, matterId)} className="row">
            <input name="name" type="text" placeholder="Name" required style={{ flex: 1, minWidth: 120 }} />
            <input name="relationship" type="text" placeholder="Relationship" style={{ flex: 1, minWidth: 120 }} />
            <button className="btn">Add</button>
          </form>
        )}
      </div>

      {canWrite && (
        <div className="card">
          <h2>AI connector</h2>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Lets Claude or ChatGPT search this matter and add events for you. Each URL acts as you.
            Revoke it any time.
          </p>
          {(tokens ?? []).length > 0 && (
            <table className="simple" style={{ marginBottom: 12 }}>
              <tbody>
                {(tokens ?? []).map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.label}
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        Created {formatTimestamp(t.created_at)}
                        {t.last_used_at ? ` · last used ${formatTimestamp(t.last_used_at)}` : " · never used"}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {t.revoked_at ? (
                        <span className="muted">Revoked</span>
                      ) : (
                        <form action={revokeTokenAction.bind(null, matterId, t.id)}>
                          <button className="btn small danger">Revoke</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <CreateToken matterId={matterId} />
        </div>
      )}

      {isOwner && (audit ?? []).length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Recent activity</summary>
          <table className="simple" style={{ marginTop: 8 }}>
            <tbody>
              {(audit as any[]).map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatTimestamp(a.at)}</td>
                  <td>
                    {nameOf(a.actor)}
                    {a.actor_kind === "ai" ? " via AI" : ""} · {a.action} {a.entity.replace("_", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
