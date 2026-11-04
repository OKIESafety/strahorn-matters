/** Follow-up thread metrics (pure; no I/O). Parent "a" is the owner (Jonathan), "b" the other parent. */

export type ThreadStep = {
  exhibit: string;
  date: string; // YYYY-MM-DD
  actor: "a" | "b" | "other" | null;
  step: string | null;
  title: string;
};

export type ThreadStat = {
  title: string;
  description: string | null;
  status: "open" | "resolved";
  resolved_on: string | null;
  first: string;
  last: string;
  asks: number; // a: request + follow_up
  replies: number; // b: response
  unanswered: number; // asks with no reply from b before the next ask
  days_open: number; // first ask (or first step) to resolution / today
  longest_wait: number; // longest gap from an ask to b's next reply (or to today if never answered)
  waiting_since: string | null; // open thread: date of the oldest ask still without a reply
  steps: ThreadStep[];
};

function day(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 86_400_000;
}

export function threadStat(
  meta: { title: string; description: string | null; status: "open" | "resolved"; resolved_on: string | null },
  steps: ThreadStep[],
  today: string
): ThreadStat {
  const s = [...steps].sort((x, y) => x.date.localeCompare(y.date) || Number(x.exhibit) - Number(y.exhibit));
  const isAsk = (x: ThreadStep) => x.actor === "a" && (x.step === "request" || x.step === "follow_up");
  const isReply = (x: ThreadStep) => x.actor === "b" && x.step === "response";
  const asks = s.filter(isAsk);
  const replies = s.filter(isReply);

  const end = meta.status === "resolved" && meta.resolved_on ? meta.resolved_on : today;
  let longest = 0;
  let unanswered = 0;
  let waitingSince: string | null = null;
  for (let i = 0; i < asks.length; i++) {
    const a = asks[i];
    const reply = replies.find((r) => r.date >= a.date);
    const nextAsk = asks[i + 1];
    const answeredBeforeNext = reply && (!nextAsk || reply.date <= nextAsk.date);
    if (!answeredBeforeNext) unanswered++;
    const until = reply ? reply.date : end;
    longest = Math.max(longest, Math.round(day(until) - day(a.date)));
    if (!reply && meta.status === "open" && !waitingSince) waitingSince = a.date;
  }
  const start = asks[0]?.date ?? s[0]?.date ?? today;
  return {
    ...meta,
    first: s[0]?.date ?? today,
    last: s[s.length - 1]?.date ?? today,
    asks: asks.length,
    replies: replies.length,
    unanswered,
    days_open: Math.max(0, Math.round(day(end) - day(start))),
    longest_wait: longest,
    waiting_since: waitingSince,
    steps: s,
  };
}

export const STEP_LABEL: Record<string, string> = {
  request: "asked",
  follow_up: "followed up",
  response: "responded",
  no_response: "no response",
  action: "took action",
  outcome: "outcome",
};
