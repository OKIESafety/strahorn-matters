"use client";

import { useEffect, useMemo, useRef } from "react";

export function FilePicker({
  files,
  setFiles,
  label = "Photos, screenshots or files",
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files]
  );
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  return (
    <div className="field">
      <span className="label">{label}</span>
      <button type="button" className="btn block" onClick={() => inputRef.current?.click()}>
        📷 Add photos / files
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/*,application/pdf,text/csv,text/plain,.csv,.txt,.xlsx,.docx,.eml,audio/*,video/*"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          setFiles([...files, ...picked]);
          e.target.value = "";
        }}
      />
      {files.length > 0 && (
        <div className="preview-grid">
          {files.map((f, i) => (
            <div className="p" key={i}>
              {previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[i]!} alt={f.name} />
              ) : (
                <div className="name">{f.name}</div>
              )}
              <button
                type="button"
                className="x"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
