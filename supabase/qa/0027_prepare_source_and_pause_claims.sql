-- ONLY for the explicitly verified isolated QA Supabase project
-- rahfmpsdbwbktlobntkm. This is a temporary, service-only source transport,
-- not a scheduler or a notification sender. The permanent app data is kept.
do $qa_preflight$
begin
  if to_regclass('public.native_push_devices') is null
     or to_regprocedure('public.register_native_push_device(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.claim_native_push_deliveries(integer)') is null
     or to_regclass('public.native_notification_campaigns') is not null
     or to_regprocedure('public.register_native_push_device_v2(uuid,uuid,uuid,text,integer,text)') is not null then
    raise exception 'The expected pre-0027 QA schema is not present';
  end if;
  if exists (select 1 from public.native_push_deliveries where state='pending' and lease_until > clock_timestamp()) then
    raise exception 'An existing native delivery is leased; stop before changing worker access';
  end if;
end $qa_preflight$;

-- Block the existing v1 worker at the database even if an old deployment is
-- invoked. Registration and opt-out stay available; this does not clear data.
revoke execute on function public.claim_native_push_deliveries(integer) from service_role;

create table public.native_qa_migration_source_f4f04e902c (
  singleton boolean primary key default true check (singleton),
  source text not null,
  staged_at timestamptz not null default clock_timestamp()
);
alter table public.native_qa_migration_source_f4f04e902c enable row level security;
revoke all on public.native_qa_migration_source_f4f04e902c from public, anon, authenticated, service_role;

-- This helper stores only the exact reviewed, non-secret migration bytes. It
-- cannot execute SQL or touch any notification data. All normal clients lack
-- EXECUTE; the server uses its already configured staging service credential.
create function public.stage_native_qa_0027_f4f04e902c(p_sql text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $stage$
begin
  if p_sql is null or octet_length(p_sql) <> 63569
     or encode(sha256(convert_to(p_sql, 'UTF8')), 'hex') <> 'f4f04e902c160e37208aefcb59c91ccb242f23cc0efffabc69f8af3cc71372c3' then
    raise exception 'Migration source does not match the reviewed 0027';
  end if;
  insert into public.native_qa_migration_source_f4f04e902c(singleton,source)
    values (true,p_sql)
    on conflict (singleton) do update set source=excluded.source,staged_at=clock_timestamp();
  return true;
end $stage$;
revoke all on function public.stage_native_qa_0027_f4f04e902c(text) from public, anon, authenticated, service_role;
grant execute on function public.stage_native_qa_0027_f4f04e902c(text) to service_role;
notify pgrst, 'reload schema';
