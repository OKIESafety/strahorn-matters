/**
 * Parenting-time engine (pure functions; no I/O).
 *
 * Model
 * - A schedule is a repeating cycle of `cycle_days` days starting on `cycle_start`.
 *   Each transition says: on cycle day N at local HH:MM the children go to parent "a" or "b".
 * - Overrides replace the schedule for a time range (holidays, agreed swaps).
 * - Actual time starts from the schedule. Each scheduled handoff is matched to a recorded
 *   exchange (same receiving parent, within ±12h). A matched exchange moves the handoff to the
 *   time it really happened; a recorded "no_show" cancels it; unmatched recorded exchanges are
 *   extra handoffs. Unmatched scheduled handoffs are assumed on time and marked "unrecorded".
 */

export type Side = "a" | "b";
export type Transition = { day: number; time: string; to: Side };
export type Schedule = {
  cycle_start: string; // YYYY-MM-DD
  cycle_days: number;
  transitions: Transition[];
  effective_from: string; // YYYY-MM-DD
  effective_to?: string | null;
};
export type Override = { starts_at: string; ends_at: string; parent: Side };
export type Exchange = {
  id?: string;
  occurred_at: string;
  kind: "handoff" | "arrived" | "no_show" | "late_notice";
  to_parent: Side | null;
  voided_at?: string | null;
};

export type HandoffStatus = "on_time" | "late" | "early" | "unrecorded" | "no_show";
export type HandoffRow = {
  scheduled_at: number;
  to: Side;
  status: HandoffStatus;
  actual_at: number | null;
  minutes_off: number | null; // positive = late
  exchange_id?: string;
};

export type ParentingTimeReport = {
  from: number;
  to: number;
  scheduled_hours: Record<Side, number>;
  actual_hours: Record<Side, number>;
  scheduled_pct: Record<Side, number>;
  actual_pct: Record<Side, number>;
  handoffs: HandoffRow[];
  extra_exchanges: { at: number; to: Side; exchange_id?: string }[];
  counts: { on_time: number; late: number; early: number; unrecorded: number; no_show: number };
  late_minutes_total: number;
};

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const ON_TIME_GRACE_MIN = 10;
const MATCH_WINDOW = 12 * HOUR;

/** Offset (ms) of `tz` from UTC at instant `ms`. */
function tzOffset(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Local wall-clock date+time in `tz` → UTC ms. */
export function zonedToUtc(date: string, time: string, tz: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - tzOffset(guess, tz);
  ms = guess - tzOffset(ms, tz); // second pass handles DST edges
  return ms;
}

function dayNumber(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
}
function dateFromDayNumber(n: number) {
  return new Date(n * DAY).toISOString().slice(0, 10);
}
function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

/** Local date (YYYY-MM-DD) in tz for an instant. */
export function localDate(ms: number, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms)
  );
}

/** All scheduled handoffs in [fromMs, toMs], plus enough look-back to know who had the children at fromMs. */
export function scheduledTransitions(schedules: Schedule[], fromMs: number, toMs: number, tz: string) {
  const out: { at: number; to: Side }[] = [];
  for (const s of schedules) {
    if (!s.cycle_days || !s.transitions?.length) continue;
    const startDay = Math.max(dayNumber(s.effective_from), dayNumber(localDate(fromMs, tz)) - s.cycle_days - 1);
    const endDay = Math.min(
      s.effective_to ? dayNumber(s.effective_to) : Number.POSITIVE_INFINITY,
      dayNumber(localDate(toMs, tz)) + 1
    );
    const anchor = dayNumber(s.cycle_start);
    for (let dn = startDay; dn <= endDay; dn++) {
      const idx = mod(dn - anchor, s.cycle_days);
      for (const t of s.transitions) {
        if (t.day !== idx) continue;
        const at = zonedToUtc(dateFromDayNumber(dn), t.time, tz);
        if (at <= toMs) out.push({ at, to: t.to });
      }
    }
  }
  out.sort((x, y) => x.at - y.at);
  // collapse consecutive handoffs to the same parent (no-ops)
  const collapsed: { at: number; to: Side }[] = [];
  for (const t of out) if (!collapsed.length || collapsed[collapsed.length - 1].to !== t.to) collapsed.push(t);
  return collapsed;
}

function parentAt(changes: { at: number; to: Side }[], t: number): Side | null {
  let p: Side | null = null;
  for (const c of changes) {
    if (c.at <= t) p = c.to;
    else break;
  }
  return p;
}

/** Hours per side over [from,to] for a step function defined by change points, with optional overrides on top. */
function hoursBySide(changes: { at: number; to: Side }[], overrides: Override[], from: number, to: number) {
  const ov = overrides
    .map((o) => ({ s: Date.parse(o.starts_at), e: Date.parse(o.ends_at), p: o.parent }))
    .filter((o) => o.e > from && o.s < to);
  const bounds = new Set<number>([from, to]);
  for (const c of changes) if (c.at > from && c.at < to) bounds.add(c.at);
  for (const o of ov) {
    if (o.s > from && o.s < to) bounds.add(o.s);
    if (o.e > from && o.e < to) bounds.add(o.e);
  }
  const pts = Array.from(bounds).sort((a, b) => a - b);
  const hours: Record<Side, number> = { a: 0, b: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const mid = (pts[i] + pts[i + 1]) / 2;
    let p: Side | null = null;
    for (const o of ov) if (o.s <= mid && mid < o.e) p = o.p; // later overrides win
    if (!p) p = parentAt(changes, mid);
    if (p) hours[p] += (pts[i + 1] - pts[i]) / HOUR;
  }
  return hours;
}

/** Folds overrides (agreed changes) into the scheduled change list. */
export function applyOverrides(base: { at: number; to: Side }[], overrides: Override[]) {
  if (!overrides.length) return base;
  const ov = overrides.map((o) => ({ s: Date.parse(o.starts_at), e: Date.parse(o.ends_at), p: o.parent }));
  const bounds = new Set<number>(base.map((c) => c.at));
  for (const o of ov) {
    bounds.add(o.s);
    bounds.add(o.e);
  }
  const pts = Array.from(bounds).sort((a, b) => a - b);
  const out: { at: number; to: Side }[] = [];
  for (const t of pts) {
    let p: Side | null = null;
    for (const o of ov) if (o.s <= t && t < o.e) p = o.p;
    if (!p) p = parentAt(base, t);
    if (p && (!out.length || out[out.length - 1].to !== p)) out.push({ at: t, to: p });
  }
  return out;
}

function pct(h: Record<Side, number>): Record<Side, number> {
  const total = h.a + h.b;
  if (!total) return { a: 0, b: 0 };
  const a = Math.round((h.a / total) * 1000) / 10;
  return { a, b: Math.round((100 - a) * 10) / 10 };
}

export function computeParentingTime(args: {
  schedules: Schedule[];
  overrides: Override[];
  exchanges: Exchange[];
  from: number;
  to: number;
  tz: string;
}): ParentingTimeReport {
  const { schedules, overrides, from, to, tz } = args;
  const sched = applyOverrides(scheduledTransitions(schedules, from, to, tz), overrides);
  const live = args.exchanges
    .filter((e) => !e.voided_at)
    .map((e) => ({ ...e, at: Date.parse(e.occurred_at) }))
    .sort((x, y) => x.at - y.at);

  const used = new Set<number>();
  const handoffs: HandoffRow[] = [];
  const actualChanges: { at: number; to: Side }[] = [];

  for (const s of sched) {
    // best matching handoff (same receiving parent) or no-show
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    live.forEach((e, i) => {
      if (used.has(i)) return;
      if (e.kind !== "handoff" && e.kind !== "no_show") return;
      if (e.kind === "handoff" && e.to_parent !== s.to) return;
      if (e.kind === "no_show" && e.to_parent && e.to_parent !== s.to) return;
      const d = Math.abs(e.at - s.at);
      if (d <= MATCH_WINDOW && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });

    const inRange = s.at >= from && s.at < to;
    if (best === -1) {
      actualChanges.push(s);
      if (inRange) handoffs.push({ scheduled_at: s.at, to: s.to, status: "unrecorded", actual_at: null, minutes_off: null });
      continue;
    }
    used.add(best);
    const e = live[best];
    if (e.kind === "no_show") {
      if (inRange)
        handoffs.push({ scheduled_at: s.at, to: s.to, status: "no_show", actual_at: e.at, minutes_off: null, exchange_id: e.id });
      continue; // handoff didn't happen
    }
    actualChanges.push({ at: e.at, to: s.to });
    const off = Math.round((e.at - s.at) / 60000);
    const status: HandoffStatus = off > ON_TIME_GRACE_MIN ? "late" : off < -ON_TIME_GRACE_MIN ? "early" : "on_time";
    if (inRange) handoffs.push({ scheduled_at: s.at, to: s.to, status, actual_at: e.at, minutes_off: off, exchange_id: e.id });
  }

  const extra: { at: number; to: Side; exchange_id?: string }[] = [];
  live.forEach((e, i) => {
    if (used.has(i) || e.kind !== "handoff" || !e.to_parent) return;
    actualChanges.push({ at: e.at, to: e.to_parent });
    if (e.at >= from && e.at < to) extra.push({ at: e.at, to: e.to_parent, exchange_id: e.id });
  });
  actualChanges.sort((x, y) => x.at - y.at);

  const scheduled_hours = hoursBySide(sched, [], from, to);
  const ah = hoursBySide(actualChanges, [], from, to);

  const counts = { on_time: 0, late: 0, early: 0, unrecorded: 0, no_show: 0 };
  let late_minutes_total = 0;
  for (const h of handoffs) {
    counts[h.status]++;
    if (h.status === "late") late_minutes_total += h.minutes_off ?? 0;
  }

  const round = (h: Record<Side, number>) => ({ a: Math.round(h.a * 10) / 10, b: Math.round(h.b * 10) / 10 });
  return {
    from,
    to,
    scheduled_hours: round(scheduled_hours),
    actual_hours: round(ah),
    scheduled_pct: pct(scheduled_hours),
    actual_pct: pct(ah),
    handoffs,
    extra_exchanges: extra,
    counts,
    late_minutes_total,
  };
}

/** Validates a transitions array from user/AI input. */
export function validateTransitions(cycleDays: number, raw: unknown): Transition[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("Add at least one handoff to the schedule");
  return raw.map((t: any) => {
    const day = Number(t?.day);
    const time = String(t?.time ?? "");
    const to = t?.to;
    if (!Number.isInteger(day) || day < 0 || day >= cycleDays) throw new Error(`Handoff day must be 0–${cycleDays - 1}`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Handoff time "${time}" must be HH:MM (24h)`);
    if (to !== "a" && to !== "b") throw new Error("Each handoff must go to parent a or b");
    return { day, time, to };
  });
}
