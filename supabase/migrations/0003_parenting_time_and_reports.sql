-- Parenting-time tracking, exchange check-ins, expenses, attorney share links,
-- verifiable exports, and report controls.

-- Matter-level parent labels ("a" = the owner's side, "b" = the other parent)
alter table public.matters
  add column if not exists parent_a text,
  add column if not exists parent_b text;

-- Report controls on events
alter table public.events
  add column if not exists exclude_from_reports boolean not null default false,
  add column if not exists attended_by text[] not null default '{}';

-- ───────── Schedule (decree) ─────────
-- A repeating cycle: on cycle day N at HH:MM the children go to parent a or b.
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  name text not null default 'Court-ordered schedule',
  cycle_start date not null,
  cycle_days int not null check (cycle_days between 1 and 56),
  transitions jsonb not null,
  effective_from date not null,
  effective_to date,
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists schedules_matter_idx on public.schedules (matter_id, effective_from);

-- One-off changes to the schedule (holidays, agreed swaps)
create table if not exists public.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  parent text not null check (parent in ('a', 'b')),
  reason text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists overrides_matter_idx on public.schedule_overrides (matter_id, starts_at);

-- ───────── Exchanges (check-ins) ─────────
-- Append-only. A mistaken entry is voided (with a reason), never edited or deleted.
create table if not exists public.exchanges (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  occurred_at timestamptz not null,
  kind text not null default 'handoff' check (kind in ('handoff', 'arrived', 'no_show', 'late_notice')),
  to_parent text check (to_parent in ('a', 'b')),
  recorded_live boolean not null default false,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  note text,
  source_ref text,
  source_key text,
  voided_at timestamptz,
  void_reason text,
  recorded_by uuid references auth.users(id) default auth.uid(),
  recorded_via text not null default 'app' check (recorded_via in ('app', 'ai')),
  created_at timestamptz not null default now()
);
create index if not exists exchanges_matter_idx on public.exchanges (matter_id, occurred_at);
create unique index if not exists exchanges_source_key_uq on public.exchanges (matter_id, source_key) where source_key is not null;

create or replace function public.tg_exchanges_append_only()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Exchange records cannot be deleted; void them instead';
  end if;
  if (to_jsonb(new) - 'voided_at' - 'void_reason') is distinct from (to_jsonb(old) - 'voided_at' - 'void_reason') then
    raise exception 'Exchange records cannot be edited; void and re-enter instead';
  end if;
  if old.voided_at is not null then
    raise exception 'This exchange is already voided';
  end if;
  return new;
end $$;
create trigger exchanges_append_only before update or delete on public.exchanges
  for each row execute function public.tg_exchanges_append_only();

-- ───────── Expenses ─────────
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  expense_date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  category text not null default 'other',
  description text not null,
  child text,
  paid_by text not null check (paid_by in ('a', 'b')),
  other_share_pct numeric(5, 2) not null default 50 check (other_share_pct between 0 and 100),
  reimbursed numeric(12, 2) not null default 0 check (reimbursed >= 0),
  status text not null default 'open' check (status in ('open', 'requested', 'paid', 'disputed')),
  evidence_id uuid references public.evidence(id) on delete restrict,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_matter_idx on public.expenses (matter_id, expense_date desc);

-- ───────── Attorney share links ─────────
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  filters jsonb not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ───────── Verifiable exports ─────────
create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  title text not null,
  filters jsonb not null default '{}',
  items jsonb not null,
  manifest_sha256 text not null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create or replace function public.tg_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception '% records cannot be changed', tg_table_name;
end $$;
create trigger exports_immutable before update or delete on public.exports
  for each row execute function public.tg_immutable();

-- updated_at helpers
create or replace function public.tg_touch()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger touch_schedules before update on public.schedules for each row execute function public.tg_touch();
create trigger touch_expenses before update on public.expenses for each row execute function public.tg_touch();

-- Audit
create trigger audit_schedules after insert or update or delete on public.schedules for each row execute function public.tg_audit();
create trigger audit_overrides after insert or update or delete on public.schedule_overrides for each row execute function public.tg_audit();
create trigger audit_exchanges after insert or update on public.exchanges for each row execute function public.tg_audit();
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function public.tg_audit();
create trigger audit_share_links after insert or update on public.share_links for each row execute function public.tg_audit();
create trigger audit_exports after insert on public.exports for each row execute function public.tg_audit();

revoke execute on function public.tg_exchanges_append_only() from public, anon, authenticated;
revoke execute on function public.tg_immutable() from public, anon, authenticated;
revoke execute on function public.tg_touch() from public, anon, authenticated;

-- RLS
alter table public.schedules enable row level security;
alter table public.schedule_overrides enable row level security;
alter table public.exchanges enable row level security;
alter table public.expenses enable row level security;
alter table public.share_links enable row level security;
alter table public.exports enable row level security;

create policy schedules_select on public.schedules for select using (public.matter_role(matter_id) is not null);
create policy schedules_insert on public.schedules for insert with check (public.can_write(matter_id));
create policy schedules_update on public.schedules for update using (public.can_write(matter_id));
create policy schedules_delete on public.schedules for delete using (public.matter_role(matter_id) = 'owner');

create policy overrides_select on public.schedule_overrides for select using (public.matter_role(matter_id) is not null);
create policy overrides_insert on public.schedule_overrides for insert with check (public.can_write(matter_id));
create policy overrides_delete on public.schedule_overrides for delete using (public.can_write(matter_id));

create policy exchanges_select on public.exchanges for select using (public.matter_role(matter_id) is not null);
create policy exchanges_insert on public.exchanges for insert with check (public.can_write(matter_id) and recorded_by = auth.uid());
create policy exchanges_update on public.exchanges for update using (public.can_write(matter_id));

create policy expenses_select on public.expenses for select using (public.matter_role(matter_id) is not null);
create policy expenses_insert on public.expenses for insert with check (public.can_write(matter_id));
create policy expenses_update on public.expenses for update using (public.can_write(matter_id));
create policy expenses_delete on public.expenses for delete using (public.matter_role(matter_id) = 'owner');

create policy share_select on public.share_links for select using (public.matter_role(matter_id) = 'owner');
create policy share_insert on public.share_links for insert with check (public.matter_role(matter_id) = 'owner');
create policy share_update on public.share_links for update using (public.matter_role(matter_id) = 'owner');

create policy exports_select on public.exports for select using (public.matter_role(matter_id) is not null);
create policy exports_insert on public.exports for insert with check (public.matter_role(matter_id) is not null);
