-- Strahorn Matters: initial schema
-- Hierarchy: Matter -> Issue -> Event -> Evidence
-- Rules: original evidence is immutable (no edits to file fields, no deletes),
--        every change is written to audit_log, access is enforced by RLS.

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

do $$ begin
  create type public.member_role as enum ('owner', 'contributor', 'reviewer');
exception when duplicate_object then null; end $$;

-- ───────────────────────── Tables ─────────────────────────

create table public.matters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.matter_members (
  matter_id uuid not null references public.matters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  display_name text,
  added_at timestamptz not null default now(),
  primary key (matter_id, user_id)
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  name text not null,
  relationship text,
  notes text,
  created_at timestamptz not null default now()
);
create unique index people_matter_name_uq on public.people (matter_id, lower(name));

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  title text not null,
  description text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_via text not null default 'app' check (created_via in ('app', 'ai')),
  created_at timestamptz not null default now()
);
create unique index issues_matter_title_uq on public.issues (matter_id, lower(title));

create table public.events (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  event_date date not null,
  event_time time,                       -- local time (America/Chicago); null if unknown
  title text not null,
  summary text not null default '',      -- short factual description
  details text,                          -- longer narrative / quotes
  tags text[] not null default '{}',
  confidence text not null default 'reported'
    check (confidence in ('confirmed', 'corroborated', 'reported', 'disputed', 'needs_review')),
  source_ref text,                       -- e.g. "iMazing export 10/27/2026, row 4123"
  source_key text,                       -- idempotency key so the same incident is never added twice
  created_by uuid references auth.users(id) default auth.uid(),
  created_via text not null default 'app' check (created_via in ('app', 'ai')),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' ||
      coalesce(details, '') || ' ' || coalesce(source_ref, ''))
  ) stored
);
create index events_matter_date_idx on public.events (matter_id, event_date desc, event_time desc);
create index events_search_idx on public.events using gin (search);
create index events_tags_idx on public.events using gin (tags);
create index events_title_trgm_idx on public.events using gin ((title || ' ' || summary) gin_trgm_ops);
create unique index events_source_key_uq on public.events (matter_id, source_key) where source_key is not null;

create table public.event_issues (
  event_id uuid not null references public.events(id) on delete cascade,
  issue_id uuid not null references public.issues(id) on delete cascade,
  primary key (event_id, issue_id)
);

create table public.event_people (
  event_id uuid not null references public.events(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  primary key (event_id, person_id)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete restrict,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  sha256 text not null,
  kind text not null default 'other'
    check (kind in ('photo', 'screenshot', 'document', 'text_export', 'audio', 'video', 'email', 'other')),
  description text,
  source_date date,
  uploaded_by uuid references auth.users(id) default auth.uid(),
  uploaded_via text not null default 'app' check (uploaded_via in ('app', 'ai')),
  uploaded_at timestamptz not null default now()
);
create index evidence_matter_idx on public.evidence (matter_id, uploaded_at desc);

create table public.event_evidence (
  event_id uuid not null references public.events(id) on delete cascade,
  evidence_id uuid not null references public.evidence(id) on delete restrict,
  excerpt text,      -- exact quote from the evidence that supports the event
  page_ref text,     -- page / row / timestamp within the evidence
  added_at timestamptz not null default now(),
  primary key (event_id, evidence_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  issue_id uuid references public.issues(id) on delete cascade,
  body text not null,
  author uuid references auth.users(id) default auth.uid(),
  author_kind text not null default 'user' check (author_kind in ('user', 'ai')),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  matter_id uuid,
  actor uuid,
  actor_kind text not null,          -- 'user' (logged into the app) or 'ai' (via connector)
  action text not null,              -- insert / update / delete
  entity text not null,
  entity_id text,
  detail jsonb,
  at timestamptz not null default now()
);
create index audit_matter_idx on public.audit_log (matter_id, at desc);

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.matter_role(m uuid)
returns public.member_role
language sql stable security definer set search_path = public
as $$
  select role from public.matter_members where matter_id = m and user_id = auth.uid()
$$;

create or replace function public.can_write(m uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.matter_role(m) in ('owner', 'contributor'), false)
$$;

create or replace function public.event_matter(e uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select matter_id from public.events where id = e
$$;

-- Creator of a matter becomes its owner
create or replace function public.tg_matter_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.matter_members (matter_id, user_id, role)
  values (new.id, coalesce(new.created_by, auth.uid()), 'owner')
  on conflict do nothing;
  return new;
end $$;
create trigger matter_owner after insert on public.matters
  for each row execute function public.tg_matter_owner();

-- updated_at / updated_by on events
create or replace function public.tg_touch_event()
returns trigger language plpgsql
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger touch_event before update on public.events
  for each row execute function public.tg_touch_event();

-- Evidence is immutable: only description / kind / source_date may change, never deleted
create or replace function public.tg_evidence_immutable()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Evidence records cannot be deleted';
  end if;
  if new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256
     or new.original_filename is distinct from old.original_filename
     or new.size_bytes is distinct from old.size_bytes
     or new.mime_type is distinct from old.mime_type
     or new.matter_id is distinct from old.matter_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.uploaded_at is distinct from old.uploaded_at
     or new.uploaded_via is distinct from old.uploaded_via then
    raise exception 'Original evidence fields are immutable';
  end if;
  return new;
end $$;
create trigger evidence_immutable before update or delete on public.evidence
  for each row execute function public.tg_evidence_immutable();

-- Notes are append-only
create or replace function public.tg_notes_append_only()
returns trigger language plpgsql
as $$
begin
  raise exception 'Notes are append-only';
end $$;
create trigger notes_append_only before update or delete on public.notes
  for each row execute function public.tg_notes_append_only();

-- Generic audit trigger
create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  rec jsonb;
  old_rec jsonb;
  v_actor uuid;
  v_kind text;
  v_matter uuid;
  v_detail jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end - 'search';
  old_rec := case when tg_op = 'UPDATE' then to_jsonb(old) - 'search' else null end;

  v_actor := auth.uid();
  if v_actor is not null then
    v_kind := 'user';
  else
    v_kind := 'ai';
    v_actor := coalesce(
      nullif(rec->>'updated_by', '')::uuid,
      nullif(rec->>'created_by', '')::uuid,
      nullif(rec->>'uploaded_by', '')::uuid,
      nullif(rec->>'author', '')::uuid,
      nullif(current_setting('app.actor', true), '')::uuid);
  end if;

  if rec ? 'matter_id' then
    v_matter := (rec->>'matter_id')::uuid;
  elsif rec ? 'event_id' then
    v_matter := public.event_matter((rec->>'event_id')::uuid);
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('from', old_rec->k, 'to', rec->k))
      into v_detail
      from jsonb_object_keys(rec) k
      where rec->k is distinct from old_rec->k
        and k not in ('updated_at', 'updated_by');
    if v_detail is null then return null; end if;
  else
    v_detail := rec;
  end if;

  insert into public.audit_log (matter_id, actor, actor_kind, action, entity, entity_id, detail)
  values (v_matter, v_actor, v_kind, lower(tg_op), tg_table_name,
          coalesce(rec->>'id', rec->>'event_id'), v_detail);
  return null;
end $$;

create trigger audit_events after insert or update or delete on public.events
  for each row execute function public.tg_audit();
create trigger audit_issues after insert or update or delete on public.issues
  for each row execute function public.tg_audit();
create trigger audit_evidence after insert or update on public.evidence
  for each row execute function public.tg_audit();
create trigger audit_event_evidence after insert or delete on public.event_evidence
  for each row execute function public.tg_audit();
create trigger audit_event_issues after insert or delete on public.event_issues
  for each row execute function public.tg_audit();
create trigger audit_notes after insert on public.notes
  for each row execute function public.tg_audit();
create trigger audit_members after insert or update or delete on public.matter_members
  for each row execute function public.tg_audit();
create trigger audit_people after insert or update or delete on public.people
  for each row execute function public.tg_audit();

-- Possible-duplicate finder used by the app and the AI connector
create or replace function public.similar_events(p_matter uuid, p_date date, p_text text, p_days int default 1)
returns table (id uuid, event_date date, title text, score real)
language sql stable
as $$
  select e.id, e.event_date, e.title, similarity(e.title || ' ' || e.summary, p_text) as score
  from public.events e
  where e.matter_id = p_matter
    and e.event_date between p_date - p_days and p_date + p_days
    and similarity(e.title || ' ' || e.summary, p_text) > 0.3
  order by score desc
  limit 5
$$;

-- ───────────────────────── Row Level Security ─────────────────────────

alter table public.matters enable row level security;
alter table public.matter_members enable row level security;
alter table public.people enable row level security;
alter table public.issues enable row level security;
alter table public.events enable row level security;
alter table public.event_issues enable row level security;
alter table public.event_people enable row level security;
alter table public.evidence enable row level security;
alter table public.event_evidence enable row level security;
alter table public.notes enable row level security;
alter table public.audit_log enable row level security;
alter table public.api_tokens enable row level security;

-- matters
create policy matters_select on public.matters for select using (public.matter_role(id) is not null);
create policy matters_insert on public.matters for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy matters_update on public.matters for update using (public.matter_role(id) = 'owner');

-- members
create policy members_select on public.matter_members for select using (public.matter_role(matter_id) is not null);
create policy members_owner_all on public.matter_members for all
  using (public.matter_role(matter_id) = 'owner') with check (public.matter_role(matter_id) = 'owner');

-- people / issues
create policy people_select on public.people for select using (public.matter_role(matter_id) is not null);
create policy people_insert on public.people for insert with check (public.can_write(matter_id));
create policy people_update on public.people for update using (public.can_write(matter_id));

create policy issues_select on public.issues for select using (public.matter_role(matter_id) is not null);
create policy issues_insert on public.issues for insert with check (public.can_write(matter_id));
create policy issues_update on public.issues for update using (public.can_write(matter_id));
create policy issues_delete on public.issues for delete using (public.matter_role(matter_id) = 'owner');

-- events
create policy events_select on public.events for select using (public.matter_role(matter_id) is not null);
create policy events_insert on public.events for insert with check (public.can_write(matter_id) and created_by = auth.uid());
create policy events_update on public.events for update using (public.can_write(matter_id));
create policy events_delete on public.events for delete using (public.matter_role(matter_id) = 'owner');

create policy ei_select on public.event_issues for select using (public.matter_role(public.event_matter(event_id)) is not null);
create policy ei_write on public.event_issues for insert with check (public.can_write(public.event_matter(event_id)));
create policy ei_delete on public.event_issues for delete using (public.can_write(public.event_matter(event_id)));

create policy ep_select on public.event_people for select using (public.matter_role(public.event_matter(event_id)) is not null);
create policy ep_write on public.event_people for insert with check (public.can_write(public.event_matter(event_id)));
create policy ep_delete on public.event_people for delete using (public.can_write(public.event_matter(event_id)));

-- evidence (no delete policy: deletes are impossible from the app)
create policy evidence_select on public.evidence for select using (public.matter_role(matter_id) is not null);
create policy evidence_insert on public.evidence for insert with check (public.can_write(matter_id) and uploaded_by = auth.uid());
create policy evidence_update on public.evidence for update using (public.can_write(matter_id));

create policy ee_select on public.event_evidence for select using (public.matter_role(public.event_matter(event_id)) is not null);
create policy ee_insert on public.event_evidence for insert with check (public.can_write(public.event_matter(event_id)));
create policy ee_delete on public.event_evidence for delete using (public.matter_role(public.event_matter(event_id)) = 'owner');

-- notes: any member (including reviewer/attorney) can add, nobody can edit
create policy notes_select on public.notes for select using (public.matter_role(matter_id) is not null);
create policy notes_insert on public.notes for insert with check (public.matter_role(matter_id) is not null and author = auth.uid());

-- audit log: owners can read; only triggers write
create policy audit_select on public.audit_log for select using (public.matter_role(matter_id) = 'owner');

-- api tokens: each user manages their own
create policy tokens_select on public.api_tokens for select using (user_id = auth.uid());
create policy tokens_insert on public.api_tokens for insert with check (user_id = auth.uid());
create policy tokens_update on public.api_tokens for update using (user_id = auth.uid());

-- ───────────────────────── Storage ─────────────────────────
-- Private bucket; path = <matter_id>/<random>/<filename>. Upload allowed, overwrite/delete never.

insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 52428800)
on conflict (id) do nothing;

create policy evidence_obj_select on storage.objects for select
  using (bucket_id = 'evidence' and public.matter_role(((storage.foldername(name))[1])::uuid) is not null);

create policy evidence_obj_insert on storage.objects for insert
  with check (bucket_id = 'evidence' and public.can_write(((storage.foldername(name))[1])::uuid));
-- intentionally no update/delete policies on storage.objects for this bucket
