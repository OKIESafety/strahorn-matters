-- Per-issue summaries written for the attorney report (frozen with the packet).
alter table public.exports add column if not exists issue_summaries jsonb;
