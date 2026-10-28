"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePicker } from "@/components/file-picker";
import { uploadOriginals } from "@/lib/upload-client";
import { CONFIDENCE } from "@/lib/constants";
import { createEventAction } from "../actions";

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function NewEventForm({
  matterId,
  today,
  issues,
  people,
  tags,
}: {
  matterId: string;
  today: string;
  issues: string[];
  people: string[];
  tags: string[];
}) {
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [selIssues, setSelIssues] = useState<string[]>([]);
  const [newIssue, setNewIssue] = useState("");
  const [selPeople, setSelPeople] = useState<string[]>([]);
  const [newPerson, setNewPerson] = useState("");
  const [selTags, setSelTags] = useState<string[]>([]);
  const [selAttended, setSelAttended] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [confidence, setConfidence] = useState("reported");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setBusy(files.length ? `Uploading 0 of ${files.length}…` : "Saving…");
      const uploaded = await uploadOriginals(matterId, files, (d, t) =>
        setBusy(d < t ? `Uploading ${d} of ${t}…` : "Saving…")
      );
      const res = await createEventAction(matterId, {
        title,
        summary,
        details: "",
        date,
        time,
        issues: [...selIssues, newIssue.trim()].filter(Boolean),
        people: [...selPeople, ...newPerson.split(",").map((s) => s.trim())].filter(Boolean),
        tags: [...selTags, ...customTag.split(",").map((s) => s.trim())].filter(Boolean),
        attended_by: selAttended,
        confidence,
        files: uploaded,
      });
      if (!res.ok) throw new Error(res.error);
      router.push(`/m/${matterId}/e/${res.id}?saved=1`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="notice error">{error}</div>}

      <div className="field">
        <label htmlFor="summary">What happened?</label>
        <textarea
          id="summary"
          required
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Stick to facts: who, what, when. e.g. Pickup was supposed to be 9:00. Brandy arrived at 9:23."
        />
      </div>

      <div className="row">
        <div className="field grow">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field grow">
          <label htmlFor="time">Time (optional)</label>
          <input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <FilePicker files={files} setFiles={setFiles} />

      <div className="field">
        <span className="label">Who was involved?</span>
        <div className="chips">
          {people.map((p) => (
            <label key={p} className="chip">
              <input type="checkbox" checked={selPeople.includes(p)} onChange={() => setSelPeople(toggle(selPeople, p))} />
              {p}
            </label>
          ))}
        </div>
        <input
          type="text"
          style={{ marginTop: 8 }}
          placeholder={people.length ? "Someone else? (comma-separated)" : "Names, comma-separated"}
          value={newPerson}
          onChange={(e) => setNewPerson(e.target.value)}
        />
      </div>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>More: issue, tags, who attended, confidence</summary>
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <span className="label">Issue</span>
            <div className="chips">
              {issues.map((i) => (
                <label key={i} className="chip">
                  <input type="checkbox" checked={selIssues.includes(i)} onChange={() => setSelIssues(toggle(selIssues, i))} />
                  {i}
                </label>
              ))}
            </div>
            <input
              type="text"
              style={{ marginTop: 8 }}
              placeholder="New issue name (optional)"
              value={newIssue}
              onChange={(e) => setNewIssue(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="label">Tags</span>
            <div className="chips">
              {tags.map((t) => (
                <label key={t} className="chip">
                  <input type="checkbox" checked={selTags.includes(t)} onChange={() => setSelTags(toggle(selTags, t))} />
                  {t}
                </label>
              ))}
            </div>
            <input
              type="text"
              style={{ marginTop: 8 }}
              placeholder="Other tags, comma-separated"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
            />
          </div>

          {people.length > 0 && (
            <div className="field">
              <span className="label">Who attended? (appointments, school, activities)</span>
              <div className="chips">
                {people.map((p) => (
                  <label key={p} className="chip">
                    <input type="checkbox" checked={selAttended.includes(p)} onChange={() => setSelAttended(toggle(selAttended, p))} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="title">Short title (optional)</label>
            <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the first sentence" />
          </div>

          <div className="field">
            <label htmlFor="confidence">How solid is this?</label>
            <select id="confidence" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              {CONFIDENCE.filter((c) => c.value !== "needs_review").map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}: {c.hint}
                </option>
              ))}
            </select>
          </div>
        </div>
      </details>

      <button className="btn primary block" disabled={!!busy} style={{ marginTop: 8 }}>
        {busy ?? "Save event"}
      </button>
    </form>
  );
}
