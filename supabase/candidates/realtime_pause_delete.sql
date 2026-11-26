-- Candidate containment for review and disposable rehearsal; NOT yet approved
-- for production. Supabase Realtime does not apply row-level authorization to
-- PostgreSQL DELETE changes. Client-side event filters are not a security fix.
--
-- Publication options apply to ALL published tables, not just orders. This
-- disables realtime DELETE notifications for every consumer of this
-- publication. Preserve the existing INSERT, UPDATE and TRUNCATE settings and
-- every table/column/row filter. Database deletes and authenticated REST reads
-- continue to work. Never silently enable another event type.
--
-- This file is deliberately outside the migrations directory to prevent
-- automatic deployment. For a rollout that also applies 0025, this containment
-- must be in place BEFORE 0025 can add orders back to the publication; rehearse
-- and explicitly plan the transaction and migration history. Do not deploy until all publication consumers and fallback
-- behaviour are reviewed. Restoring DELETE recreates the privacy risk.
do $$
declare
  p record;
  events text[] := array[]::text[];
begin
  select pubinsert, pubupdate, pubdelete, pubtruncate into p
    from pg_catalog.pg_publication where pubname = 'supabase_realtime';
  if not found then
    raise exception 'supabase_realtime publication is required';
  end if;
  if p.pubinsert then events := array_append(events, 'insert'); end if;
  if p.pubupdate then events := array_append(events, 'update'); end if;
  if p.pubtruncate then events := array_append(events, 'truncate'); end if;
  if p.pubdelete then
    execute format('alter publication supabase_realtime set (publish = %L)', array_to_string(events, ', '));
  end if;
end $$;
