-- Follow-up threads: storylines like "Isla's eye doctor" made of steps (request, follow-up, response, outcome).
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_on date,
  created_by uuid references auth.users(id) default auth.uid(),
  created_via text not null default 'app' check (created_via in ('app', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists threads_matter_title_uq on public.threads (matter_id, lower(title));

create table if not exists public.event_threads (
  event_id uuid not null references public.events(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  primary key (event_id, thread_id)
);

alter table public.events
  add column if not exists actor text check (actor in ('a', 'b', 'other')),
  add column if not exists step text check (step in ('request', 'follow_up', 'response', 'no_response', 'action', 'outcome'));

create trigger touch_threads before update on public.threads for each row execute function public.tg_touch();
create trigger audit_threads after insert or update or delete on public.threads for each row execute function public.tg_audit();
create trigger audit_event_threads after insert or delete on public.event_threads for each row execute function public.tg_audit();

alter table public.threads enable row level security;
alter table public.event_threads enable row level security;
create policy threads_select on public.threads for select using (public.matter_role(matter_id) is not null);
create policy threads_insert on public.threads for insert with check (public.can_write(matter_id));
create policy threads_update on public.threads for update using (public.can_write(matter_id));
create policy threads_delete on public.threads for delete using (public.matter_role(matter_id) = 'owner');
create policy et_select on public.event_threads for select using (public.matter_role(public.event_matter(event_id)) is not null);
create policy et_insert on public.event_threads for insert with check (public.can_write(public.event_matter(event_id)));
create policy et_delete on public.event_threads for delete using (public.can_write(public.event_matter(event_id)));
