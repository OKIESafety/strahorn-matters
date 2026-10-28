"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addMemberAction, createTokenAction } from "./actions";

export function ChangePassword() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 12) return setMsg("Use at least 12 characters.");
        const { error } = await createClient().auth.updateUser({ password: pw });
        setMsg(error ? error.message : "Password updated.");
        if (!error) setPw("");
      }}
    >
      {msg && <div className="notice">{msg}</div>}
      <div className="field">
        <label htmlFor="pw">New password</label>
        <input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <button className="btn">Change password</button>
    </form>
  );
}

export function AddMember({ matterId }: { matterId: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("contributor");
  const [temp, setTemp] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await addMemberAction(matterId, { email, name, role, tempPassword: temp });
        setMsg(res);
        setBusy(false);
        if (res.ok) {
          setEmail("");
          setName("");
          setTemp("");
        }
      }}
    >
      {msg && <div className={`notice ${msg.ok ? "" : "error"}`}>{msg.message}</div>}
      <div className="field">
        <label htmlFor="m-name">Name</label>
        <input id="m-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="BreAnne" />
      </div>
      <div className="field">
        <label htmlFor="m-email">Email</label>
        <input id="m-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="m-role">Access</label>
        <select id="m-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="contributor">Contributor: add events, photos, notes</option>
          <option value="reviewer">Reviewer: read, search, comment (attorney)</option>
          <option value="owner">Owner: everything</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="m-temp">Temporary password (new accounts only)</label>
        <input id="m-temp" type="text" autoComplete="off" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="At least 12 characters" />
      </div>
      <button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add person"}</button>
    </form>
  );
}

export function CreateToken({ matterId }: { matterId: string }) {
  const [label, setLabel] = useState("Claude");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (url) {
    return (
      <div>
        <div className="notice warn">
          Copy this connector URL now. It won&apos;t be shown again. Treat it like a password:
          anyone with it can read and add to your matters.
        </div>
        <div className="mono card" style={{ wordBreak: "break-all" }}>{url}</div>
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy URL"}
        </button>{" "}
        <button type="button" className="btn" onClick={() => setUrl(null)}>Done</button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await createTokenAction(matterId, label);
        if (res.ok && res.url) setUrl(res.url);
        else setErr(res.message ?? "Failed");
      }}
    >
      {err && <div className="notice error">{err}</div>}
      <div className="field">
        <label htmlFor="t-label">Label</label>
        <input id="t-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Claude, ChatGPT…" />
      </div>
      <button className="btn primary">Create connector URL</button>
    </form>
  );
}
