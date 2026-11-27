-- Installs a one-use scheduler authenticator. Does NOT start a job, grant
-- worker claims or enable delivery. The separately reviewed activation must
-- only run after the matching server deployment is ready.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Supabase pg_net may grant public access to its request queue. Never put a
-- long-lived credential in that queue. Each invocation uses a random token,
-- valid for 60 seconds and consumed atomically on first use. An observer of
-- pg_net can race that invocation (a denial-of-service risk), but cannot use
-- the same token to invoke the worker again or mint another token.
create table public.native_push_scheduler_tickets (
  digest bytea primary key,
  expires_at timestamptz not null
);
alter table public.native_push_scheduler_tickets enable row level security;
revoke all on public.native_push_scheduler_tickets from public, anon, authenticated, service_role;
create table public.native_push_scheduler_runs (
  request_id bigint primary key,
  requested_at timestamptz not null default clock_timestamp()
);
alter table public.native_push_scheduler_runs enable row level security;
revoke all on public.native_push_scheduler_runs from public, anon, authenticated, service_role;

create function public.verify_native_push_scheduler_secret(p_secret text) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare consumed integer;
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then return false; end if;
  delete from public.native_push_scheduler_tickets
    where digest=extensions.digest(p_secret,'sha256') and expires_at>clock_timestamp();
  get diagnostics consumed=row_count;
  return consumed=1;
end $$;
revoke all on function public.verify_native_push_scheduler_secret(text) from public, anon, authenticated, service_role;
grant execute on function public.verify_native_push_scheduler_secret(text) to service_role;

create function public.invoke_native_push_scheduler() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare ticket text; request_id bigint;
begin
  -- Serialize issuance even if the scheduler happens to overlap.
  perform pg_advisory_xact_lock(2112026,9);
  delete from public.native_push_scheduler_tickets where expires_at<=clock_timestamp();
  ticket := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.native_push_scheduler_tickets(digest,expires_at) values (extensions.digest(ticket,'sha256'),clock_timestamp()+interval '60 seconds');
  select net.http_post(url:='https://printly0.vercel.app/api/cron/native-order-push',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||ticket),
    body:='{}'::jsonb,timeout_milliseconds:=55000) into request_id;
  insert into public.native_push_scheduler_runs(request_id) values (request_id);
  delete from public.native_push_scheduler_runs where requested_at<clock_timestamp()-interval '2 days';
end $$;
revoke all on function public.invoke_native_push_scheduler() from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
