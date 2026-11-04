-- Court-order terms (decree / custody plan) and richer attorney report packets.

create table if not exists public.order_provisions (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  category text not null,
  title text not null,
  summary text not null,
  quote text,
  citation text,
  key_fact boolean not null default false,
  sort int not null default 100,
  evidence_id uuid references public.evidence(id) on delete set null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_provisions_matter_idx on public.order_provisions (matter_id, sort);

create trigger touch_order_provisions before update on public.order_provisions for each row execute function public.tg_touch();
create trigger audit_order_provisions after insert or update or delete on public.order_provisions for each row execute function public.tg_audit();

alter table public.order_provisions enable row level security;
create policy op_select on public.order_provisions for select using (public.matter_role(matter_id) is not null);
create policy op_insert on public.order_provisions for insert with check (public.matter_role(matter_id) = 'owner');
create policy op_update on public.order_provisions for update using (public.matter_role(matter_id) = 'owner');
create policy op_delete on public.order_provisions for delete using (public.matter_role(matter_id) = 'owner');

-- Case caption / court details for report covers
alter table public.matters
  add column if not exists case_number text,
  add column if not exists court text,
  add column if not exists caption text,
  add column if not exists report_summary text;

-- Packet snapshot: summary, order terms and chart data frozen at creation
alter table public.exports
  add column if not exists summary text,
  add column if not exists orders jsonb,
  add column if not exists stats jsonb,
  add column if not exists manifest_version int not null default 1;
