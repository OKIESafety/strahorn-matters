-- Fixes from Supabase security advisor: pin search_path, and don't expose helper
-- functions to anonymous callers. Trigger functions aren't callable at all.
alter function public.tg_evidence_immutable() set search_path = public;
alter function public.tg_notes_append_only() set search_path = public;
alter function public.tg_touch_event() set search_path = public;
alter function public.similar_events(uuid, date, text, int) set search_path = public;

revoke execute on function public.tg_audit() from public, anon, authenticated;
revoke execute on function public.tg_matter_owner() from public, anon, authenticated;
revoke execute on function public.matter_role(uuid) from public, anon;
revoke execute on function public.can_write(uuid) from public, anon;
revoke execute on function public.event_matter(uuid) from public, anon;
revoke execute on function public.similar_events(uuid, date, text, int) from public, anon;
grant execute on function public.matter_role(uuid) to authenticated, service_role;
grant execute on function public.can_write(uuid) to authenticated, service_role;
grant execute on function public.event_matter(uuid) to authenticated, service_role;
grant execute on function public.similar_events(uuid, date, text, int) to authenticated, service_role;
