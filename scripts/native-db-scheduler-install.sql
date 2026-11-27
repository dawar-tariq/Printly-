-- Install scheduler authentication and an invocation helper only. Does not
-- grant worker claims, start a cron job or enable delivery.
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;

do $$
begin
  if exists(select 1 from vault.decrypted_secrets where name='printly_native_scheduler_v2') then
    raise exception 'scheduler secret already exists; do not silently rotate it';
  end if;
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'printly_native_scheduler_v2', 'Private native notification scheduler');
end $$;

create table public.native_push_scheduler_runs (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  status_code integer,
  error boolean not null default false
);
alter table public.native_push_scheduler_runs enable row level security;
revoke all on public.native_push_scheduler_runs from public, anon, authenticated, service_role;

create function public.verify_native_push_scheduler_secret(p_secret text) returns boolean
language sql security definer set search_path=pg_catalog,pg_temp as $$
  select coalesce(p_secret ~ '^[a-f0-9]{64}$' and
    (select count(*)=1 and bool_and(extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_secret,'sha256'))
     from vault.decrypted_secrets where name='printly_native_scheduler_v2'), false)
$$;
revoke all on function public.verify_native_push_scheduler_secret(text) from public, anon, authenticated, service_role;
grant execute on function public.verify_native_push_scheduler_secret(text) to service_role;

-- Synchronous HTTPS avoids pg_net's publicly readable request queue: the
-- long-lived secret is only held in Vault and backend memory, never in a
-- scheduled SQL command, table, URL, response, or log. No redirects.
create function public.invoke_native_push_scheduler() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare token text; code integer; run_id bigint;
begin
  perform pg_advisory_xact_lock(2112026,9);
  select decrypted_secret into strict token from vault.decrypted_secrets where name='printly_native_scheduler_v2';
  insert into public.native_push_scheduler_runs default values returning id into run_id;
  begin
    perform extensions.http_reset_curlopt();
    perform extensions.http_set_curlopt('CURLOPT_SSL_VERIFYPEER','1');
    perform extensions.http_set_curlopt('CURLOPT_SSL_VERIFYHOST','2');
    perform extensions.http_set_curlopt('CURLOPT_FOLLOWLOCATION','0');
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','55000');
    select (extensions.http(('POST','https://printly0.vercel.app/api/cron/native-order-push',
      array[extensions.http_header('Authorization','Bearer '||token)],'application/json','{}')::extensions.http_request)).status into code;
    update public.native_push_scheduler_runs set status_code=code,completed_at=clock_timestamp() where id=run_id;
  exception when others then
    update public.native_push_scheduler_runs set error=true,completed_at=clock_timestamp() where id=run_id;
  end;
  perform extensions.http_reset_curlopt();
  delete from public.native_push_scheduler_runs where requested_at<clock_timestamp()-interval '2 days';
end $$;
revoke all on function public.invoke_native_push_scheduler() from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
