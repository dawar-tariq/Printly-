-- Native notification management extends the existing 0026 outbox/device
-- system. It does not install a scheduler, enable FCM, or send a message.
-- Apply only after 0025/0026 and their staging alignment are reconciled.

alter table public.native_push_devices
  add column app_version_code integer check (app_version_code between 1 and 2100000000),
  add column app_version_name text check (app_version_name is null or length(app_version_name) between 1 and 40),
  add column push_protocol integer not null default 1 check (push_protocol in (1, 2));

-- Preserve the four-argument API for old installations. A v1 registration
-- also clears any previously recorded v2 capability for that binding; never
-- send managed payloads to a client which has since registered as v1. Both
-- wrappers run the existing consent/membership checks in the same transaction.
alter function public.register_native_push_device(uuid,uuid,uuid,text) rename to register_native_push_device_base;
revoke all on function public.register_native_push_device_base(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
create function public.register_native_push_device(p_user uuid, p_shop uuid, p_binding uuid, p_fid text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.register_native_push_device_base(p_user,p_shop,p_binding,p_fid);
  update public.native_push_devices set app_version_code=null,app_version_name=null,push_protocol=1
    where binding_id=p_binding and user_id=p_user and shop_id=p_shop;
end $$;
revoke all on function public.register_native_push_device(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.register_native_push_device(uuid,uuid,uuid,text) to service_role;

-- Updated installations atomically attach non-secret version metadata.
create function public.register_native_push_device_v2(p_user uuid, p_shop uuid, p_binding uuid, p_fid text, p_version_code integer, p_version_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_version_code is null or p_version_code not between 1 and 2100000000 or p_version_name is null
     or p_version_name !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$' then
    raise exception 'INVALID_NATIVE_PUSH_VERSION' using errcode = 'P0001';
  end if;
  perform public.register_native_push_device(p_user, p_shop, p_binding, p_fid);
  update public.native_push_devices set app_version_code = p_version_code, app_version_name = p_version_name, push_protocol = 2
    where binding_id = p_binding and user_id = p_user and shop_id = p_shop;
  if not found then raise exception 'NATIVE_PUSH_REGISTRATION_CHANGED' using errcode = 'P0001'; end if;
end $$;
revoke all on function public.register_native_push_device_v2(uuid,uuid,uuid,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.register_native_push_device_v2(uuid,uuid,uuid,text,integer,text) to service_role;

create table public.native_notification_campaigns (
  id uuid primary key,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 100),
  message text not null check (length(btrim(message)) between 1 and 500),
  notification_type text not null check (notification_type in ('general','important','feature','maintenance','promotion','update')),
  image_url text check (image_url is null or (length(image_url) <= 1000 and image_url ~ '^https://')),
  tap_action text not null check (tap_action in ('home','orders','announcement','maintenance','update')),
  audience_kind text not null check (audience_kind in ('all','shops','devices','version','inactive','update_eligible')),
  shop_ids uuid[] not null default '{}',
  device_ids uuid[] not null default '{}',
  target_version integer check (target_version is null or target_version between 1 and 2100000000),
  status text not null default 'draft' check (status in ('draft','scheduled','sending','completed','cancelled','archived')),
  scheduled_at timestamptz,
  schedule_request uuid unique,
  source_kind text check (source_kind is null or source_kind in ('subscription_announcement','maintenance','app_release')),
  source_id uuid,
  source_ends_at timestamptz,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (audience_kind in ('all','inactive') and cardinality(shop_ids)=0 and cardinality(device_ids)=0 and target_version is null) or
    (audience_kind='shops' and cardinality(shop_ids) between 1 and 100 and cardinality(device_ids)=0 and target_version is null) or
    (audience_kind='devices' and cardinality(device_ids) between 1 and 100 and cardinality(shop_ids)=0 and target_version is null) or
    (audience_kind in ('version','update_eligible') and target_version is not null and cardinality(shop_ids)=0 and cardinality(device_ids)=0)
  ),
  check ((status in ('scheduled','sending','completed') and scheduled_at is not null) or status in ('draft','cancelled','archived'))
);
create index native_notification_campaigns_due on public.native_notification_campaigns(scheduled_at, id) where status = 'scheduled';
create index native_notification_campaigns_created on public.native_notification_campaigns(created_at desc, id);

create table public.native_notification_templates (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 100),
  message text not null check (length(btrim(message)) between 1 and 500),
  notification_type text not null check (notification_type in ('general','important','feature','maintenance','promotion','update')),
  tap_action text not null check (tap_action in ('home','orders','announcement','maintenance','update')),
  image_url text check (image_url is null or (length(image_url) <= 1000 and image_url ~ '^https://')),
  archived boolean not null default false,
  revision integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.native_notification_audit (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles(id) on delete set null,
  action text not null,
  subject_id uuid not null,
  request_id uuid,
  details jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create unique index native_notification_audit_request on public.native_notification_audit(request_id) where request_id is not null;

alter table public.native_push_events drop constraint native_push_events_kind_check;
alter table public.native_push_events add constraint native_push_events_kind_check
  check (kind in ('order','payment','general','important','feature','maintenance','promotion','update'));
alter table public.native_push_events
  add column campaign_id uuid references public.native_notification_campaigns(id) on delete set null;
create unique index native_push_campaign_shop on public.native_push_events(campaign_id, shop_id) where campaign_id is not null;

-- Persistent operational outcomes contain no FID or customer/order content.
-- FCM acceptance and a phone-reported display are deliberately separate.
create table public.native_push_delivery_log (
  delivery_id uuid primary key,
  event_id uuid not null,
  binding_id uuid not null, -- random enrollment identifier, never the FID
  campaign_id uuid references public.native_notification_campaigns(id) on delete set null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  outcome text not null default 'pending' check (outcome in ('pending','sent','retry','gone','drop')),
  attempts integer not null default 0,
  displayed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index native_push_delivery_log_campaign on public.native_push_delivery_log(campaign_id, outcome);
create index native_push_delivery_log_created on public.native_push_delivery_log(created_at desc);

create function public.log_native_push_delivery_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.native_push_delivery_log(delivery_id,event_id,binding_id,campaign_id,shop_id,outcome,attempts)
    select new.id,e.id,new.binding_id,e.campaign_id,e.shop_id,
      case when new.state='sent' then 'sent' when new.state='discarded' then 'drop' else 'pending' end, new.attempts
    from public.native_push_events e where e.id=new.event_id on conflict (delivery_id) do nothing;
  return new;
end $$;
create trigger log_native_push_delivery_created after insert on public.native_push_deliveries
  for each row execute function public.log_native_push_delivery_created();

-- Cascades caused by opt-out, membership removal and 180-day cleanup must not
-- leave durable logs permanently pending. The finish wrapper overwrites this
-- with 'gone' for an explicitly unregistered FCM installation.
create function public.log_native_push_delivery_terminal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op='DELETE' and old.state='pending' then
    update public.native_push_delivery_log set outcome='drop',attempts=old.attempts,updated_at=clock_timestamp() where delivery_id=old.id and outcome in ('pending','retry');
  elsif tg_op='UPDATE' and new.state in ('sent','discarded') and old.state='pending' then
    -- The legacy 0026 worker may still finish a lease during a staged rollout.
    update public.native_push_delivery_log set outcome=case when new.state='sent' then 'sent' else 'drop' end,
      attempts=new.attempts,updated_at=clock_timestamp() where delivery_id=new.id;
  end if;
  return null;
exception when others then
  -- An operational log failure must never prevent opt-out or membership
  -- cleanup. Monitoring should investigate any resulting stale pending row.
  raise warning 'Could not update a native push delivery log';
  return null;
end $$;
create trigger log_native_push_delivery_terminal after delete or update of state on public.native_push_deliveries
  for each row execute function public.log_native_push_delivery_terminal();
insert into public.native_push_delivery_log(delivery_id,event_id,binding_id,campaign_id,shop_id,outcome,attempts,created_at)
  select d.id,e.id,d.binding_id,e.campaign_id,e.shop_id,
    case when d.state='sent' then 'sent' when d.state='discarded' then 'drop' else 'pending' end,d.attempts,e.created_at
  from public.native_push_deliveries d join public.native_push_events e on e.id=d.event_id on conflict (delivery_id) do nothing;

alter table public.native_notification_campaigns enable row level security;
alter table public.native_notification_templates enable row level security;
alter table public.native_notification_audit enable row level security;
alter table public.native_push_delivery_log enable row level security;
revoke all on public.native_notification_campaigns, public.native_notification_templates, public.native_notification_audit, public.native_push_delivery_log from public, anon, authenticated, service_role;
grant select on public.native_notification_campaigns, public.native_notification_templates, public.native_notification_audit, public.native_push_delivery_log to service_role;

-- The admin API verifies Supabase Auth on every request; every privileged RPC
-- independently checks the actor's current database role in the transaction.
create function public.require_native_notification_admin(p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.profiles p where p.id=p_actor and p.role='admin' for share;
  if not found then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
end $$;

create function public.save_native_notification_campaign(p_actor uuid,p_id uuid,p_revision integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.native_notification_campaigns%rowtype;
begin
  perform public.require_native_notification_admin(p_actor);
  if p_id is null or p_input is null or jsonb_typeof(p_input) <> 'object' then raise exception 'INVALID_CAMPAIGN' using errcode='P0001'; end if;
  if p_revision is null then
    insert into public.native_notification_campaigns(id,created_by,title,message,notification_type,image_url,tap_action,audience_kind,shop_ids,device_ids,target_version)
      values (p_id,p_actor,p_input->>'title',p_input->>'message',p_input->>'notification_type',nullif(p_input->>'image_url',''),p_input->>'tap_action',p_input->>'audience_kind',
        array(select jsonb_array_elements_text(coalesce(p_input->'shop_ids','[]'::jsonb))::uuid),
        array(select jsonb_array_elements_text(coalesce(p_input->'device_ids','[]'::jsonb))::uuid),nullif(p_input->>'target_version','')::integer)
      on conflict (id) do nothing returning * into v_row;
    if not found then
      select * into v_row from public.native_notification_campaigns where id=p_id and created_by=p_actor;
      if not found or v_row.status<>'draft' or v_row.title is distinct from p_input->>'title' or v_row.message is distinct from p_input->>'message'
        or v_row.notification_type is distinct from p_input->>'notification_type' or v_row.tap_action is distinct from p_input->>'tap_action'
        or v_row.image_url is distinct from nullif(p_input->>'image_url','') or v_row.audience_kind is distinct from p_input->>'audience_kind'
        or v_row.shop_ids is distinct from array(select jsonb_array_elements_text(coalesce(p_input->'shop_ids','[]'::jsonb))::uuid)
        or v_row.device_ids is distinct from array(select jsonb_array_elements_text(coalesce(p_input->'device_ids','[]'::jsonb))::uuid)
        or v_row.target_version is distinct from nullif(p_input->>'target_version','')::integer
        then raise exception 'CAMPAIGN_CHANGED' using errcode='P0001'; end if;
      return jsonb_build_object('id',v_row.id,'revision',v_row.revision,'status',v_row.status);
    end if;
    insert into public.native_notification_audit(actor,action,subject_id) values (p_actor,'campaign_created',p_id);
  else
    update public.native_notification_campaigns set title=p_input->>'title',message=p_input->>'message',notification_type=p_input->>'notification_type',
      image_url=nullif(p_input->>'image_url',''),tap_action=p_input->>'tap_action',audience_kind=p_input->>'audience_kind',
      shop_ids=array(select jsonb_array_elements_text(coalesce(p_input->'shop_ids','[]'::jsonb))::uuid),
      device_ids=array(select jsonb_array_elements_text(coalesce(p_input->'device_ids','[]'::jsonb))::uuid),
      target_version=nullif(p_input->>'target_version','')::integer,revision=revision+1,updated_at=clock_timestamp()
      where id=p_id and status='draft' and revision=p_revision returning * into v_row;
    if not found then raise exception 'CAMPAIGN_CHANGED' using errcode='P0001'; end if;
    insert into public.native_notification_audit(actor,action,subject_id) values (p_actor,'campaign_edited',p_id);
  end if;
  return jsonb_build_object('id',v_row.id,'revision',v_row.revision,'status',v_row.status);
end $$;

create function public.queue_native_notification_campaign(p_actor uuid,p_id uuid,p_revision integer,p_request uuid,p_scheduled_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.native_notification_campaigns%rowtype; a public.native_notification_audit%rowtype;
  v_due timestamptz := coalesce(p_scheduled_at,clock_timestamp());
begin
  perform public.require_native_notification_admin(p_actor);
  if p_id is null or p_revision is null or p_request is null then raise exception 'INVALID_SCHEDULE' using errcode='P0001'; end if;
  -- One shared budget bounds even several administrators or concurrent tabs.
  perform pg_advisory_xact_lock(2112026,2);
  select * into a from public.native_notification_audit where request_id=p_request;
  if found then
    if a.actor is distinct from p_actor or a.subject_id is distinct from p_id or a.action is distinct from 'campaign_queued'
      or a.details->'revision' is distinct from to_jsonb(p_revision)
      or (a.details->>'scheduled_at')::timestamptz is distinct from p_scheduled_at then
      raise exception 'NOTIFICATION_REQUEST_CONFLICT' using errcode='P0001'; end if;
    select * into v_row from public.native_notification_campaigns where id=p_id;
    if not found then raise exception 'CAMPAIGN_CHANGED' using errcode='P0001'; end if;
    return jsonb_build_object('id',v_row.id,'status',v_row.status,'revision',v_row.revision,'replayed',true);
  end if;
  -- Check a new schedule only after replay detection, so a lost response can
  -- be acknowledged even if its scheduled time has since passed.
  if p_scheduled_at is not null and (v_due<=clock_timestamp() or v_due>clock_timestamp()+interval '365 days') then
    raise exception 'INVALID_SCHEDULE' using errcode='P0001'; end if;
  select * into v_row from public.native_notification_campaigns where id=p_id for update;
  if not found or v_row.status<>'draft' or v_row.revision<>p_revision then raise exception 'CAMPAIGN_CHANGED' using errcode='P0001'; end if;
  if (select count(*) from public.native_notification_audit where action in ('campaign_queued','release_notification_queued','announcement_notification_queued','maintenance_notification_queued','campaign_retry')
      and created_at>clock_timestamp()-interval '1 hour') >= 10 then
    raise exception 'NOTIFICATION_RATE_LIMIT' using errcode='P0001'; end if;
  update public.native_notification_campaigns set status='scheduled',scheduled_at=v_due,schedule_request=p_request,revision=revision+1,updated_at=clock_timestamp()
    where id=p_id returning * into v_row;
  insert into public.native_notification_audit(actor,action,subject_id,request_id,details)
    values (p_actor,'campaign_queued',p_id,p_request,jsonb_build_object('revision',p_revision,'scheduled_at',p_scheduled_at));
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'revision',v_row.revision);
end $$;

-- Internal cancellation closes all pending leases and records them as dropped.
-- It cannot recall a network send already in flight or an accepted message.
create function public.discard_native_campaign_pending(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.native_push_deliveries d set state='discarded',completed_at=clock_timestamp(),
    lease_until=null,lease_token=null,leased_device_generation=null
  from public.native_push_events e where d.event_id=e.id and e.campaign_id=p_id and d.state='pending'
$$;
revoke all on function public.discard_native_campaign_pending(uuid) from public, anon, authenticated, service_role;

create function public.change_native_notification_campaign(p_actor uuid,p_id uuid,p_revision integer,p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.native_notification_campaigns%rowtype;
begin
  perform public.require_native_notification_admin(p_actor);
  if p_action not in ('cancel','archive') then raise exception 'INVALID_CAMPAIGN_ACTION' using errcode='P0001'; end if;
  -- Serialize cancellation with dispatch and device handover. An already
  -- claimed worker must re-read the campaign before sending its payload.
  if p_action='cancel' then perform pg_advisory_xact_lock(2112026,1); end if;
  select * into v_row from public.native_notification_campaigns where id=p_id and revision=p_revision for update;
  if not found or not ((p_action='cancel' and v_row.status in ('scheduled','sending')) or (p_action='archive' and v_row.status='draft')) then
    raise exception 'CAMPAIGN_CHANGED' using errcode='P0001'; end if;
  if p_action='cancel' then perform public.discard_native_campaign_pending(p_id); end if;
  update public.native_notification_campaigns set status=case when p_action='cancel' then 'cancelled' else 'archived' end,
    revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  insert into public.native_notification_audit(actor,action,subject_id) values (p_actor,'campaign_'||p_action,p_id);
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'revision',v_row.revision);
end $$;

create function public.save_native_notification_template(p_actor uuid,p_id uuid,p_revision integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.native_notification_templates%rowtype;
begin
  perform public.require_native_notification_admin(p_actor);
  if p_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'INVALID_TEMPLATE' using errcode='P0001'; end if;
  if p_revision is null then
    insert into public.native_notification_templates(id,created_by,name,title,message,notification_type,tap_action,image_url)
      values(p_id,p_actor,p_input->>'name',p_input->>'title',p_input->>'message',p_input->>'notification_type',p_input->>'tap_action',nullif(p_input->>'image_url',''))
      on conflict (id) do nothing returning * into v_row;
    if not found then
      select * into v_row from public.native_notification_templates where id=p_id and created_by=p_actor;
      if not found or v_row.name is distinct from p_input->>'name' or v_row.title is distinct from p_input->>'title'
        or v_row.message is distinct from p_input->>'message' or v_row.notification_type is distinct from p_input->>'notification_type'
        or v_row.tap_action is distinct from p_input->>'tap_action' or v_row.image_url is distinct from nullif(p_input->>'image_url','')
        then raise exception 'TEMPLATE_CHANGED' using errcode='P0001'; end if;
      return jsonb_build_object('id',v_row.id,'revision',v_row.revision); end if;
  else
    update public.native_notification_templates set name=p_input->>'name',title=p_input->>'title',message=p_input->>'message',
      notification_type=p_input->>'notification_type',tap_action=p_input->>'tap_action',image_url=nullif(p_input->>'image_url',''),
      revision=revision+1,updated_at=clock_timestamp() where id=p_id and revision=p_revision and not archived returning * into v_row;
    if not found then raise exception 'TEMPLATE_CHANGED' using errcode='P0001'; end if;
  end if;
  insert into public.native_notification_audit(actor,action,subject_id) values (p_actor,'template_saved',p_id);
  return jsonb_build_object('id',v_row.id,'revision',v_row.revision);
end $$;

-- GitHub release metadata. This table never holds the signing key or an APK.
-- Operators must independently verify hosted bytes, package and signer before
-- setting a release current; a recorded fingerprint is an attestation only.
create table public.native_app_releases (
  id uuid primary key,
  version_code integer not null unique check (version_code between 1 and 999999999),
  version_name text not null check (version_name ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$'),
  minimum_version_code integer not null check (minimum_version_code between 1 and version_code),
  package_name text not null default 'io.github.dawartariq.printly.owner' check (package_name='io.github.dawartariq.printly.owner'),
  apk_url text not null check (length(apk_url)<=1000 and apk_url ~ '^https://github[.]com/dawar-tariq/Printly-/releases/download/[A-Za-z0-9][A-Za-z0-9._+-]{0,79}/[A-Za-z0-9][A-Za-z0-9._+-]{0,119}[.]apk$'),
  apk_sha256 text not null check (apk_sha256 ~ '^[0-9a-f]{64}$'),
  certificate_sha256 text not null check (certificate_sha256 ~ '^[0-9a-f]{64}$'),
  notes text not null default '' check (length(notes)<=400),
  mandatory boolean not null default false,
  released_at timestamptz not null,
  published boolean not null default false,
  first_published_at timestamptz,
  is_current boolean not null default false check (not is_current or published),
  revision integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index native_app_releases_one_current on public.native_app_releases(is_current) where is_current;
alter table public.native_app_releases enable row level security;
revoke all on public.native_app_releases from public, anon, authenticated, service_role;
grant select on public.native_app_releases to service_role;

-- Recheck automatic source visibility both at dispatch and immediately before
-- the worker builds a payload. An announcement linked to a disabled, expired,
-- future or fully reserved promotion must not advertise that offer. Release
-- notices must still refer to the current published release. This is a
-- best-effort gate: a source change cannot recall an FCM request in flight.
create function public.native_notification_source_available(p_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select coalesce((select case
    when c.source_kind is null then true
    when c.source_kind='maintenance' then exists(
      select 1 from public.platform_settings s where s.key='maintenance' and s.value in ('true'::jsonb,'"true"'::jsonb))
    when c.source_kind='app_release' then exists(
      select 1 from public.native_app_releases r where r.id=c.source_id and r.is_current and r.published
        and r.released_at<=clock_timestamp() and r.version_code=c.target_version)
    when c.source_kind='subscription_announcement' then exists(
      select 1 from public.subscription_announcements a
      where a.id=c.source_id and a.enabled and (a.starts_at is null or a.starts_at<=clock_timestamp())
        and (a.ends_at is null or a.ends_at>clock_timestamp())
        and (a.promo_id is null or exists(
          select 1 from public.subscription_promos p where p.id=a.promo_id and p.enabled
            and (p.starts_at is null or p.starts_at<=clock_timestamp()) and (p.ends_at is null or p.ends_at>clock_timestamp())
            and (p.max_uses is null or (select count(*) from public.subscription_purchases u
              where u.promo_id=p.id and u.status in ('initiated','submitted','approved'))<p.max_uses))))
    else false end from public.native_notification_campaigns c where c.id=p_id),false)
$$;
revoke all on function public.native_notification_source_available(uuid) from public, anon, authenticated, service_role;

-- Snapshot only consenting v2 devices at dispatch time, under the same lock as
-- registration/opt-out. Each campaign creates at most one event per shop and
-- one delivery per binding. Old v1 clients cannot display admin content.
create function public.enqueue_due_native_notification_campaigns(p_limit integer default 5) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.native_notification_campaigns%rowtype; v_count integer := 0; v_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(2112026,1);
  -- Expired source notices and campaigns more than a day overdue are never
  -- delivered unexpectedly after a long outage or a later worker enablement.
  with cancelled as (
    update public.native_notification_campaigns set status='cancelled',revision=revision+1,updated_at=clock_timestamp()
      where status='scheduled' and ((source_ends_at is not null and source_ends_at<=clock_timestamp()) or scheduled_at<clock_timestamp()-interval '1 day')
      returning id
  ) insert into public.native_notification_audit(actor,action,subject_id)
    select null,'campaign_expired',id from cancelled;
  for c in select cand.* from public.native_notification_campaigns cand
    where cand.status='scheduled' and cand.scheduled_at<=clock_timestamp()
      and public.native_notification_source_available(cand.id)
    order by cand.scheduled_at,cand.id for update of cand skip locked limit greatest(1,least(coalesce(p_limit,5),5)) loop
    -- Calculate once per campaign. clock_timestamp() inside SELECT DISTINCT
    -- can differ for devices in the same shop and defeat deduplication.
    v_expires_at := least(clock_timestamp()+interval '1 day',coalesce(c.source_ends_at,'infinity'::timestamptz));
    with eligible as materialized (
      select d.binding_id,d.shop_id from public.native_push_devices d
      join public.shop_staff s on s.shop_id=d.shop_id and s.user_id=d.user_id
      where d.push_protocol=2 and (
        c.audience_kind='all' or (c.audience_kind='shops' and d.shop_id=any(c.shop_ids)) or
        (c.audience_kind='devices' and d.binding_id=any(c.device_ids)) or
        (c.audience_kind='version' and d.app_version_code=c.target_version) or
        (c.audience_kind='update_eligible' and d.app_version_code<c.target_version) or
        (c.audience_kind='inactive' and not exists (
          select 1 from public.native_push_devices recent where recent.shop_id=d.shop_id and recent.updated_at>clock_timestamp()-interval '30 days'))
      )
    ), events as (
      insert into public.native_push_events(shop_id,kind,campaign_id,expires_at)
        select shops.shop_id,c.notification_type,c.id,v_expires_at
          from (select distinct shop_id from eligible) shops
        returning id,shop_id
    )
    insert into public.native_push_deliveries(event_id,binding_id)
      select events.id,eligible.binding_id from events join eligible on eligible.shop_id=events.shop_id;
    update public.native_notification_campaigns set status=case when exists(select 1 from public.native_push_events e where e.campaign_id=c.id) then 'sending' else 'completed' end,
      updated_at=clock_timestamp() where id=c.id;
    v_count := v_count+1;
  end loop;
  return v_count;
end $$;

-- Limit aggregate claims across concurrent scheduler invocations; the existing
-- lease/attempt rules still apply. This bounds outbound calls to 120/minute.
create table public.native_push_worker_quota (
  singleton boolean primary key default true check (singleton),
  window_start timestamptz not null,
  claimed integer not null check (claimed between 0 and 120)
);
alter table public.native_push_worker_quota enable row level security;
revoke all on public.native_push_worker_quota from public, anon, authenticated, service_role;
-- Keep the legacy RPC name working, but put both old and new workers behind
-- the same database quota. The unbudgeted implementation is owner-only.
alter function public.claim_native_push_deliveries(integer) rename to claim_native_push_deliveries_unbudgeted;
revoke all on function public.claim_native_push_deliveries_unbudgeted(integer) from public, anon, authenticated, service_role;
create function public.claim_native_push_deliveries(p_limit integer default 20)
returns table (delivery_id uuid, lease_token uuid, event_id uuid, binding_id uuid, fid text, kind text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_remaining integer; v_claimed integer;
begin
  perform pg_advisory_xact_lock(2112026,4);
  insert into public.native_push_worker_quota(singleton,window_start,claimed) values (true,clock_timestamp(),0) on conflict do nothing;
  update public.native_push_worker_quota set window_start=clock_timestamp(),claimed=0
    where singleton and window_start<=clock_timestamp()-interval '1 minute';
  select 120-q.claimed into v_remaining from public.native_push_worker_quota q where singleton;
  if v_remaining<=0 then return; end if;
  return query select * from public.claim_native_push_deliveries_unbudgeted(least(greatest(1,coalesce(p_limit,20)),30,v_remaining));
  get diagnostics v_claimed=row_count;
  update public.native_push_worker_quota set claimed=claimed+v_claimed where singleton;
end $$;
revoke all on function public.claim_native_push_deliveries(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_native_push_deliveries(integer) to service_role;

create function public.claim_native_push_deliveries_budgeted(p_limit integer default 20)
returns table (delivery_id uuid, lease_token uuid, event_id uuid, binding_id uuid, fid text, kind text, expires_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select * from public.claim_native_push_deliveries(p_limit)
$$;

-- A leased message is read only by the service worker. Never return the FID in
-- this metadata RPC; it was already returned by the existing private claim RPC.
create function public.native_push_campaign_payload(p_delivery uuid,p_lease uuid) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('title',c.title,'message',c.message,'notification_type',c.notification_type,
    'tap_action',c.tap_action,'image_url',c.image_url)
  from public.native_push_deliveries d join public.native_push_events e on e.id=d.event_id
  join public.native_notification_campaigns c on c.id=e.campaign_id
  join public.native_push_devices dev on dev.binding_id=d.binding_id
  where d.id=p_delivery and d.lease_token=p_lease and d.state='pending' and d.lease_until>clock_timestamp()
    and e.expires_at>clock_timestamp() and c.status='sending' and public.native_notification_source_available(c.id)
    and dev.push_protocol=2 and dev.shop_id=e.shop_id
    and exists(select 1 from public.shop_staff s where s.shop_id=dev.shop_id and s.user_id=dev.user_id)
$$;

create function public.finish_native_push_delivery_logged(p_id uuid,p_lease uuid,p_outcome text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_attempts integer; v_result text;
begin
  select d.attempts into v_attempts from public.native_push_deliveries d where d.id=p_id and d.lease_token=p_lease;
  v_result := public.finish_native_push_delivery(p_id,p_lease,p_outcome);
  if v_result in ('sent','gone','retry','drop') then
    update public.native_push_delivery_log set outcome=v_result,attempts=coalesce(v_attempts,attempts),updated_at=clock_timestamp() where delivery_id=p_id;
  end if;
  return v_result;
end $$;

create function public.complete_native_notification_campaigns() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  update public.native_notification_campaigns c set status='completed',updated_at=clock_timestamp()
    where c.status='sending' and not exists (
      select 1 from public.native_push_events e join public.native_push_deliveries d on d.event_id=e.id
      where e.campaign_id=c.id and d.state='pending');
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create function public.record_native_push_display(p_user uuid,p_binding uuid,p_event uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_delivery uuid;
begin
  select d.id into v_delivery from public.native_push_deliveries d
    join public.native_push_devices dev on dev.binding_id=d.binding_id
    join public.native_push_events e on e.id=d.event_id
    join public.shop_staff s on s.shop_id=dev.shop_id and s.user_id=dev.user_id
    where d.event_id=p_event and d.binding_id=p_binding and dev.user_id=p_user and e.shop_id=dev.shop_id and e.expires_at>clock_timestamp();
  if not found then return false; end if;
  update public.native_push_delivery_log set displayed_at=coalesce(displayed_at,clock_timestamp()),updated_at=clock_timestamp() where delivery_id=v_delivery;
  return found;
end $$;

create function public.retry_native_notification_campaign(p_actor uuid,p_id uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; a public.native_notification_audit%rowtype;
begin
  perform public.require_native_notification_admin(p_actor);
  if p_id is null or p_request is null then raise exception 'INVALID_REQUEST' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(2112026,2);
  perform pg_advisory_xact_lock(2112026,1);
  select * into a from public.native_notification_audit where request_id=p_request;
  if found then
    if a.actor is distinct from p_actor or a.subject_id is distinct from p_id or a.action is distinct from 'campaign_retry' then
      raise exception 'NOTIFICATION_REQUEST_CONFLICT' using errcode='P0001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'retried',a.details->'retried');
  end if;
  perform 1 from public.native_notification_campaigns where id=p_id and status='completed' for update;
  if not found then raise exception 'CAMPAIGN_CHANGED' using errcode='P0001'; end if;
  if not public.native_notification_source_available(p_id) then raise exception 'NOTIFICATION_SOURCE_INACTIVE' using errcode='P0001'; end if;
  if (select count(*) from public.native_notification_audit where action in ('campaign_queued','release_notification_queued','announcement_notification_queued','maintenance_notification_queued','campaign_retry')
      and created_at>clock_timestamp()-interval '1 hour')>=10 then raise exception 'NOTIFICATION_RATE_LIMIT' using errcode='P0001'; end if;
  update public.native_push_events set expires_at=least(clock_timestamp()+interval '1 day',coalesce((
    select source_ends_at from public.native_notification_campaigns where id=p_id),'infinity'::timestamptz)) where campaign_id=p_id;
  with retried as (
    update public.native_push_deliveries d set state='pending',attempts=0,next_attempt_at=clock_timestamp(),completed_at=null,
      lease_until=null,lease_token=null,leased_device_generation=null
    from public.native_push_events e, public.native_push_devices dev
    where d.event_id=e.id and e.campaign_id=p_id and d.binding_id=dev.binding_id and d.state='discarded' and dev.push_protocol=2
      and exists(select 1 from public.shop_staff s where s.shop_id=dev.shop_id and s.user_id=dev.user_id)
    returning d.id
  ) update public.native_push_delivery_log l set outcome='pending',attempts=0,updated_at=clock_timestamp() from retried r where l.delivery_id=r.id;
  get diagnostics v_count=row_count;
  if v_count>0 then update public.native_notification_campaigns set status='sending',updated_at=clock_timestamp() where id=p_id; end if;
  insert into public.native_notification_audit(actor,action,subject_id,request_id,details)
    values (p_actor,'campaign_retry',p_id,p_request,jsonb_build_object('retried',v_count));
  return jsonb_build_object('ok',true,'retried',v_count);
end $$;

-- The service role can read administrative metadata but never FIDs through
-- this view. The API still requires a verified admin before accessing it.
create view public.native_notification_admin_devices with (security_barrier=true) as
  select d.binding_id,d.user_id,d.shop_id,s.name as shop_name,d.app_version_code,d.app_version_name,d.push_protocol,d.updated_at as last_seen_at
  from public.native_push_devices d join public.shops s on s.id=d.shop_id;
revoke all on public.native_notification_admin_devices from public, anon, authenticated, service_role;
grant select on public.native_notification_admin_devices to service_role;

revoke all on function public.log_native_push_delivery_created(), public.log_native_push_delivery_terminal(), public.require_native_notification_admin(uuid),
  public.save_native_notification_campaign(uuid,uuid,integer,jsonb), public.queue_native_notification_campaign(uuid,uuid,integer,uuid,timestamptz),
  public.change_native_notification_campaign(uuid,uuid,integer,text), public.save_native_notification_template(uuid,uuid,integer,jsonb),
  public.enqueue_due_native_notification_campaigns(integer), public.claim_native_push_deliveries_budgeted(integer), public.native_push_campaign_payload(uuid,uuid),
  public.finish_native_push_delivery_logged(uuid,uuid,text), public.complete_native_notification_campaigns(),
  public.record_native_push_display(uuid,uuid,uuid), public.retry_native_notification_campaign(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_native_notification_campaign(uuid,uuid,integer,jsonb),
  public.queue_native_notification_campaign(uuid,uuid,integer,uuid,timestamptz), public.change_native_notification_campaign(uuid,uuid,integer,text),
  public.save_native_notification_template(uuid,uuid,integer,jsonb), public.enqueue_due_native_notification_campaigns(integer),
  public.claim_native_push_deliveries_budgeted(integer), public.native_push_campaign_payload(uuid,uuid), public.finish_native_push_delivery_logged(uuid,uuid,text),
  public.complete_native_notification_campaigns(), public.record_native_push_display(uuid,uuid,uuid),
  public.retry_native_notification_campaign(uuid,uuid,uuid) to service_role;

create function public.save_native_app_release(p_actor uuid,p_id uuid,p_revision integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.native_app_releases%rowtype;
begin
  perform public.require_native_notification_admin(p_actor);
  if p_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'INVALID_RELEASE' using errcode='P0001'; end if;
  if p_revision is null then
    insert into public.native_app_releases(id,created_by,version_code,version_name,minimum_version_code,apk_url,apk_sha256,certificate_sha256,notes,mandatory,released_at)
      values(p_id,p_actor,(p_input->>'version_code')::integer,p_input->>'version_name',(p_input->>'minimum_version_code')::integer,
        p_input->>'apk_url',p_input->>'apk_sha256',p_input->>'certificate_sha256',p_input->>'notes',(p_input->>'mandatory')::boolean,(p_input->>'released_at')::timestamptz)
      on conflict (id) do nothing returning * into r;
    if not found then
      select * into r from public.native_app_releases where id=p_id and created_by=p_actor;
      if not found or r.version_code is distinct from (p_input->>'version_code')::integer or r.version_name is distinct from p_input->>'version_name'
        or r.minimum_version_code is distinct from (p_input->>'minimum_version_code')::integer or r.apk_url is distinct from p_input->>'apk_url'
        or r.apk_sha256 is distinct from p_input->>'apk_sha256' or r.certificate_sha256 is distinct from p_input->>'certificate_sha256'
        or r.notes is distinct from p_input->>'notes' or r.mandatory is distinct from (p_input->>'mandatory')::boolean
        or r.released_at is distinct from (p_input->>'released_at')::timestamptz
        then raise exception 'RELEASE_CHANGED' using errcode='P0001'; end if;
      return jsonb_build_object('id',r.id,'revision',r.revision); end if;
  else
    update public.native_app_releases set version_code=(p_input->>'version_code')::integer,version_name=p_input->>'version_name',
      minimum_version_code=(p_input->>'minimum_version_code')::integer,apk_url=p_input->>'apk_url',apk_sha256=p_input->>'apk_sha256',
      certificate_sha256=p_input->>'certificate_sha256',notes=p_input->>'notes',mandatory=(p_input->>'mandatory')::boolean,
      released_at=(p_input->>'released_at')::timestamptz,revision=revision+1,updated_at=clock_timestamp()
      where id=p_id and revision=p_revision and not published and first_published_at is null returning * into r;
    if not found then raise exception 'RELEASE_CHANGED' using errcode='P0001'; end if;
  end if;
  insert into public.native_notification_audit(actor,action,subject_id) values(p_actor,'release_saved',p_id);
  return jsonb_build_object('id',r.id,'revision',r.revision);
end $$;

-- A lost response must be recoverable without reapplying a release action or
-- pretending that a changed notify option was part of the original request.
-- A replay reports the recorded action, not the release's current state.
create function public.native_app_release_request_result(p_actor uuid,p_id uuid,p_revision integer,p_request uuid,p_action text,p_notify boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.native_notification_audit%rowtype;
begin
  perform public.require_native_notification_admin(p_actor);
  if p_id is null or p_revision is null or p_request is null or p_action is null or p_action not in ('publish','activate','unpublish')
    or p_notify is null or (p_notify and p_action<>'activate') then raise exception 'INVALID_RELEASE_ACTION' using errcode='P0001'; end if;
  select * into a from public.native_notification_audit where request_id=p_request;
  if not found then return null; end if;
  if a.actor is distinct from p_actor or a.subject_id is distinct from p_id or a.action is distinct from 'release_'||p_action
    or a.details->'revision' is distinct from to_jsonb(p_revision) or a.details->'notify' is distinct from to_jsonb(p_notify) then
    raise exception 'NOTIFICATION_REQUEST_CONFLICT' using errcode='P0001'; end if;
  return jsonb_build_object('ok',true,'replayed',true,'campaign_id',a.details->'campaign_id');
end $$;

create function public.change_native_app_release(p_actor uuid,p_id uuid,p_revision integer,p_request uuid,p_action text,p_notify boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.native_app_releases%rowtype; stale public.native_notification_campaigns%rowtype; v_campaign uuid; v_replay jsonb;
begin
  perform public.require_native_notification_admin(p_actor);
  if p_request is null or p_action not in ('publish','activate','unpublish') or p_notify is null or (p_notify and p_action<>'activate') then
    raise exception 'INVALID_RELEASE_ACTION' using errcode='P0001'; end if;
  -- Release, queue and retry actions share the request-id namespace. Take
  -- the common lock even when no notice is requested so concurrent reuse is
  -- rejected consistently before either action writes. Keep lock order 2,3,1.
  perform pg_advisory_xact_lock(2112026,2);
  perform pg_advisory_xact_lock(2112026,3);
  v_replay := public.native_app_release_request_result(p_actor,p_id,p_revision,p_request,p_action,p_notify);
  if v_replay is not null then return v_replay; end if;
  -- Serialize source changes with dispatch, cancellation and device handover.
  if p_action in ('activate','unpublish') then perform pg_advisory_xact_lock(2112026,1); end if;
  select * into r from public.native_app_releases where id=p_id for update;
  if not found or r.revision<>p_revision then raise exception 'RELEASE_CHANGED' using errcode='P0001'; end if;
  if p_action='publish' then
    if r.published or r.released_at>clock_timestamp() then raise exception 'RELEASE_CHANGED' using errcode='P0001'; end if;
    update public.native_app_releases set published=true,first_published_at=coalesce(first_published_at,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp() where id=p_id;
  elsif p_action='unpublish' then
    if not r.published then raise exception 'RELEASE_CHANGED' using errcode='P0001'; end if;
    update public.native_app_releases set published=false,is_current=false,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
  else
    if not r.published or r.is_current or r.released_at>clock_timestamp() then raise exception 'RELEASE_CHANGED' using errcode='P0001'; end if;
    if p_notify and (select count(*) from public.native_notification_audit where action in ('campaign_queued','release_notification_queued','announcement_notification_queued','maintenance_notification_queued','campaign_retry')
      and created_at>clock_timestamp()-interval '1 hour')>=10 then raise exception 'NOTIFICATION_RATE_LIMIT' using errcode='P0001'; end if;
    update public.native_app_releases set is_current=false,revision=revision+1,updated_at=clock_timestamp() where is_current;
    update public.native_app_releases set is_current=true,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
    if p_notify then
      v_campaign := gen_random_uuid();
      insert into public.native_notification_campaigns(id,created_by,title,message,notification_type,tap_action,audience_kind,target_version,status,scheduled_at,schedule_request,source_kind,source_id)
        values(v_campaign,p_actor,'Printly update available','A new version of Printly for Shops is available. Open the app to review it.',
          'update','update','update_eligible',r.version_code,'scheduled',clock_timestamp(),p_request,'app_release',p_id);
      insert into public.native_notification_audit(actor,action,subject_id) values(p_actor,'release_notification_queued',v_campaign);
    end if;
  end if;
  if p_action in ('activate','unpublish') then
    -- Rollback or unpublish must not leave obsolete update notices pending.
    -- A send already handed to the network is necessarily best-effort.
    for stale in select * from public.native_notification_campaigns c
      where c.source_kind='app_release' and c.status in ('scheduled','sending')
        and not public.native_notification_source_available(c.id) for update loop
      perform public.discard_native_campaign_pending(stale.id);
      update public.native_notification_campaigns set status='cancelled',revision=revision+1,updated_at=clock_timestamp() where id=stale.id;
      insert into public.native_notification_audit(actor,action,subject_id) values(p_actor,'release_notification_cancelled',stale.id);
    end loop;
  end if;
  insert into public.native_notification_audit(actor,action,subject_id,request_id,details)
    values(p_actor,'release_'||p_action,p_id,p_request,jsonb_build_object('revision',p_revision,'notify',p_notify,'campaign_id',v_campaign));
  return jsonb_build_object('ok',true,'campaign_id',v_campaign);
end $$;

-- Only the currently published release is returned. It contains no credentials
-- and can be exposed by the app's narrow, no-store update endpoint.
create function public.current_native_app_release() returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('available',true,'versionCode',version_code,'versionName',version_name,'minimumVersionCode',minimum_version_code,
    'packageName',package_name,'downloadUrl',apk_url,'sha256',apk_sha256,'notes',notes,'mandatory',mandatory,'releasedAt',released_at)
    from public.native_app_releases where is_current and published and released_at<=clock_timestamp()
$$;
revoke all on function public.save_native_app_release(uuid,uuid,integer,jsonb), public.change_native_app_release(uuid,uuid,integer,uuid,text,boolean),
  public.native_app_release_request_result(uuid,uuid,integer,uuid,text,boolean), public.current_native_app_release() from public, anon, authenticated, service_role;
grant execute on function public.save_native_app_release(uuid,uuid,integer,jsonb), public.change_native_app_release(uuid,uuid,integer,uuid,text,boolean),
  public.native_app_release_request_result(uuid,uuid,integer,uuid,text,boolean), public.current_native_app_release() to service_role;

create function public.admin_native_notification_overview(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.require_native_notification_admin(p_actor);
  select jsonb_build_object(
    'registered_devices',(select count(*) from public.native_push_devices),
    'active_devices',(select count(*) from public.native_push_devices where updated_at>=clock_timestamp()-interval '30 days'),
    'registered_shops',(select count(distinct shop_id) from public.native_push_devices),
    'shops',(select count(*) from public.shops),
    'v2_devices',(select count(*) from public.native_push_devices where push_protocol=2),
    'accepted',(select count(*) from public.native_push_delivery_log where outcome='sent'),
    'displayed',(select count(*) from public.native_push_delivery_log where displayed_at is not null),
    'failed',(select count(*) from public.native_push_delivery_log where outcome in ('drop','gone')),
    'pending',(select count(*) from public.native_push_delivery_log where outcome in ('pending','retry')),
    'versions',coalesce((select jsonb_agg(to_jsonb(v) order by v.version_code desc nulls last) from (
       select app_version_code as version_code,app_version_name as version_name,count(*) as devices
       from public.native_push_devices group by app_version_code,app_version_name) v),'[]'::jsonb),
    'recent_activity',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
       select actor,action,subject_id,created_at from public.native_notification_audit order by created_at desc,id desc limit 12) a),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.admin_native_notification_overview(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_native_notification_overview(uuid) to service_role;

-- A preview is an estimate only; membership/consent and the snapshot are
-- re-evaluated when the scheduled campaign actually becomes due.
create function public.preview_native_notification_audience(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_devices bigint; v_shops bigint; v_kind text := p_input->>'audience_kind';
  v_shops_selected uuid[] := array(select jsonb_array_elements_text(coalesce(p_input->'shop_ids','[]'::jsonb))::uuid);
  v_devices_selected uuid[] := array(select jsonb_array_elements_text(coalesce(p_input->'device_ids','[]'::jsonb))::uuid);
  v_version integer := nullif(p_input->>'target_version','')::integer;
begin
  perform public.require_native_notification_admin(p_actor);
  if v_kind not in ('all','shops','devices','version','inactive','update_eligible') then raise exception 'INVALID_AUDIENCE' using errcode='P0001'; end if;
  select count(*),count(distinct d.shop_id) into v_devices,v_shops from public.native_push_devices d
    join public.shop_staff s on s.shop_id=d.shop_id and s.user_id=d.user_id
    where d.push_protocol=2 and (
      v_kind='all' or (v_kind='shops' and d.shop_id=any(v_shops_selected)) or (v_kind='devices' and d.binding_id=any(v_devices_selected)) or
      (v_kind='version' and d.app_version_code=v_version) or (v_kind='update_eligible' and d.app_version_code<v_version) or
      (v_kind='inactive' and not exists(select 1 from public.native_push_devices recent where recent.shop_id=d.shop_id and recent.updated_at>clock_timestamp()-interval '30 days')));
  return jsonb_build_object('eligible_devices',v_devices,'eligible_shops',v_shops);
end $$;
revoke all on function public.preview_native_notification_audience(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.preview_native_notification_audience(uuid,jsonb) to service_role;

create view public.native_notification_campaign_summary with (security_barrier=true) as
  select c.*,
    count(l.delivery_id)::integer as recipient_count,
    count(l.delivery_id) filter (where l.outcome='sent')::integer as accepted_count,
    count(l.delivery_id) filter (where l.displayed_at is not null)::integer as displayed_count,
    count(l.delivery_id) filter (where l.outcome in ('drop','gone'))::integer as failed_count,
    count(l.delivery_id) filter (where l.outcome in ('pending','retry'))::integer as pending_count
  from public.native_notification_campaigns c left join public.native_push_delivery_log l on l.campaign_id=c.id group by c.id;
revoke all on public.native_notification_campaign_summary from public, anon, authenticated, service_role;
grant select on public.native_notification_campaign_summary to service_role;

-- An enabled subscription announcement schedules one notice. Promo-linked
-- notices are gated by current promo visibility when dispatched and sent.
-- Edits update a still-scheduled notice; disabling, deleting, expiring or
-- editing an already-sending announcement stops remaining pending work.
-- A network request already in flight or accepted by FCM cannot be recalled.
create function public.native_push_subscription_announcement() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.native_notification_campaigns%rowtype; active public.native_notification_campaigns%rowtype;
  next_id uuid; source uuid; actor uuid; due_at timestamptz; stop_all boolean; stop_sending boolean;
begin
  source := case when tg_op='DELETE' then old.id else new.id end;
  actor := case when tg_op='DELETE' then old.updated_by else new.updated_by end;
  stop_all := tg_op='DELETE';
  stop_sending := false;
  if tg_op<>'DELETE' then
    stop_all := not new.enabled or (new.ends_at is not null and new.ends_at<=clock_timestamp());
    if tg_op='UPDATE' then
      stop_sending := new.title is distinct from old.title or new.message is distinct from old.message
        or new.promo_id is distinct from old.promo_id or new.starts_at is distinct from old.starts_at
        or new.ends_at is distinct from old.ends_at;
    end if;
  end if;
  perform pg_advisory_xact_lock(2112026,2);
  if stop_all or stop_sending then
    perform pg_advisory_xact_lock(2112026,1);
    for active in select * from public.native_notification_campaigns
      where source_kind='subscription_announcement' and source_id=source
        and (status='sending' or (stop_all and status='scheduled')) for update loop
      perform public.discard_native_campaign_pending(active.id);
      update public.native_notification_campaigns set status='cancelled',revision=revision+1,updated_at=clock_timestamp() where id=active.id;
      insert into public.native_notification_audit(actor,action,subject_id) values(actor,'announcement_notification_cancelled',active.id);
    end loop;
  end if;
  if stop_all then return null; end if;
  due_at := greatest(coalesce(new.starts_at,clock_timestamp()),
    coalesce((select p.starts_at from public.subscription_promos p where p.id=new.promo_id),clock_timestamp()),clock_timestamp());
  select * into existing from public.native_notification_campaigns
    where source_kind='subscription_announcement' and source_id=source order by created_at desc,id desc limit 1 for update;
  if found and existing.status='scheduled' then
    update public.native_notification_campaigns set title=regexp_replace(btrim(new.title),'[[:cntrl:]]',' ','g'),
      message=regexp_replace(btrim(new.message),'[[:cntrl:]]',' ','g'),scheduled_at=due_at,
      source_ends_at=new.ends_at,revision=revision+1,updated_at=clock_timestamp() where id=existing.id;
    return null;
  end if;
  if existing.id is not null and (tg_op='INSERT' or old.enabled) then return null; end if;
  if (select count(*) from public.native_notification_audit where action in ('campaign_queued','release_notification_queued','announcement_notification_queued','maintenance_notification_queued','campaign_retry')
      and created_at>clock_timestamp()-interval '1 hour')>=10 then
    insert into public.native_notification_audit(actor,action,subject_id) values(actor,'announcement_notification_rate_limited',source);
    return null;
  end if;
  next_id := gen_random_uuid();
  insert into public.native_notification_campaigns(id,created_by,title,message,notification_type,tap_action,audience_kind,status,scheduled_at,source_kind,source_id,source_ends_at)
    values(next_id,actor,regexp_replace(btrim(new.title),'[[:cntrl:]]',' ','g'),regexp_replace(btrim(new.message),'[[:cntrl:]]',' ','g'),
      'general','announcement','all','scheduled',due_at,'subscription_announcement',source,new.ends_at);
  insert into public.native_notification_audit(actor,action,subject_id) values(actor,'announcement_notification_queued',next_id);
  return null;
exception when others then
  -- Announcements are authoritative: notification failure must not roll them
  -- back. The worker also checks source visibility before sending.
  raise warning 'Could not queue or cancel a subscription announcement notification';
  return null;
end $$;
create trigger native_push_subscription_announcement after insert or update or delete on public.subscription_announcements
  for each row execute function public.native_push_subscription_announcement();

-- The settings API records the authenticated actor for auditable maintenance
-- actions. Existing settings and their values remain unchanged.
alter table public.platform_settings add column updated_by uuid references public.profiles(id) on delete set null;

-- Maintenance on/off is already an explicit platform-wide admin action. A
-- single fixed-content alert is queued when enabled; turning it back off before
-- dispatch cancels it. The worker has its own secret and runs independently.
create function public.native_push_maintenance_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare next_id uuid; active public.native_notification_campaigns%rowtype;
begin
  if new.key<>'maintenance' or new.value not in ('true'::jsonb,'false'::jsonb,'"true"'::jsonb,'"false"'::jsonb) then return null; end if;
  if tg_op='UPDATE' and ((old.value in ('true'::jsonb,'"true"'::jsonb) and new.value in ('true'::jsonb,'"true"'::jsonb))
    or (old.value in ('false'::jsonb,'"false"'::jsonb) and new.value in ('false'::jsonb,'"false"'::jsonb))) then return null; end if;
  perform pg_advisory_xact_lock(2112026,2);
  if new.value in ('false'::jsonb,'"false"'::jsonb) then
    perform pg_advisory_xact_lock(2112026,1);
    for active in select * from public.native_notification_campaigns where source_kind='maintenance' and status in ('scheduled','sending') for update loop
      perform public.discard_native_campaign_pending(active.id);
      update public.native_notification_campaigns set status='cancelled',revision=revision+1,updated_at=clock_timestamp() where id=active.id;
      insert into public.native_notification_audit(actor,action,subject_id) values(new.updated_by,'maintenance_notification_cancelled',active.id);
    end loop;
    return null;
  end if;
  next_id := gen_random_uuid();
  if (select count(*) from public.native_notification_audit where action in ('campaign_queued','release_notification_queued','announcement_notification_queued','maintenance_notification_queued','campaign_retry')
      and created_at>clock_timestamp()-interval '1 hour')>=10 then
    insert into public.native_notification_audit(actor,action,subject_id) values(new.updated_by,'maintenance_notification_rate_limited',next_id);
    return null;
  end if;
  insert into public.native_notification_campaigns(id,created_by,title,message,notification_type,tap_action,audience_kind,status,scheduled_at,source_kind)
    values(next_id,new.updated_by,'Printly maintenance','Printly is temporarily undergoing maintenance. Please try again shortly.',
      'maintenance','maintenance','all','scheduled',clock_timestamp(),'maintenance');
  insert into public.native_notification_audit(actor,action,subject_id) values(new.updated_by,'maintenance_notification_queued',next_id);
  return null;
exception when others then
  raise warning 'Could not queue a maintenance notification';
  return null;
end $$;
create trigger native_push_maintenance_change after insert or update of value on public.platform_settings
  for each row execute function public.native_push_maintenance_change();
revoke all on function public.native_push_subscription_announcement(),public.native_push_maintenance_change() from public, anon, authenticated, service_role;
