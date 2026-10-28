"use client";

import { useState } from "react";
import { createShareLinkAction } from "./share-actions";

export function CreateShareLink({ matterId, issues }: { matterId: string; issues: { id: string; title: string }[] }) {
  const [label, setLabel] = useState("Attorney");
  const [days, setDays] = useState(7);
  const [issueId, setIssueId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (url) {
    return (
      <div>
        <div className="notice warn">Copy this link now; it won&apos;t be shown again. Anyone with it can view (not change) what you selected until it expires.</div>
        <div className="mono card" style={{ wordBreak: "break-all" }}>{url}</div>
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>{" "}
        <button type="button" className="btn" onClick={() => setUrl(null)}>Done</button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        const r = await createShareLinkAction(matterId, { label, days, issueId, from, to });
        if (r.ok && r.url) setUrl(r.url);
        else setErr(r.error ?? "Failed");
      }}
    >
      {err && <div className="notice error">{err}</div>}
      <div className="row">
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Who it's for" style={{ flex: 2 }} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ flex: 1 }}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      <select value={issueId} onChange={(e) => setIssueId(e.target.value)} style={{ marginTop: 8 }}>
        <option value="">Everything in reports</option>
        {issues.map((i) => (
          <option key={i.id} value={i.id}>Only: {i.title}</option>
        ))}
      </select>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="grow muted" style={{ fontSize: "0.85rem" }}>
          From (optional)
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grow muted" style={{ fontSize: "0.85rem" }}>
          To (optional)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <button className="btn primary" style={{ marginTop: 8 }}>Create share link</button>
    </form>
  );
}
