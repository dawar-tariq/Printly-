-- Transactional owner email outbox. This migration enqueues only future events;
-- it does not backfill prior applications or send emails by itself.
create table public.owner_email_outbox (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('welcome','application_received','under_review','changes_requested','verified','not_approved','account_suspended','account_reactivated','subscription_active','subscription_expiring','subscription_expired','subscription_payment_submitted','subscription_payment_rejected')),
  event_key text not null unique,
  expected_expiry timestamptz,
  expected_permanent boolean,
  purchase_id uuid references public.subscription_purchases(id),
  state text not null default 'pending' check (state in ('pending','claimed','sent','failed','unknown','skipped')),
  created_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz, claim_token uuid, finished_at timestamptz,
  error_code text check (length(error_code) <= 80)
);
create index owner_email_pending_idx on public.owner_email_outbox(created_at) where state='pending';
alter table public.owner_email_outbox enable row level security;
revoke all on public.owner_email_outbox from public, anon, authenticated, service_role;

create function public.owner_email_shop_events() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text;
begin
  if tg_op='INSERT' then
    insert into public.owner_email_outbox(shop_id,owner_id,kind,event_key) values
      (new.id,new.owner_id,'welcome','welcome:'||new.id::text),
      (new.id,new.owner_id,'application_received','application_received:'||new.id::text);
    return new;
  end if;
  if new.kyc_status is distinct from old.kyc_status then
    kind := case new.kyc_status::text when 'approved' then 'verified' when 'changes_requested' then 'changes_requested' when 'rejected' then 'not_approved' when 'pending' then 'under_review' else null end;
  elsif new.status is distinct from old.status then
    kind := case when new.status::text='suspended' then 'account_suspended' when new.status::text='active' then 'account_reactivated' else null end;
  end if;
  if kind is not null then
    insert into public.owner_email_outbox(shop_id,owner_id,kind,event_key) values(new.id,new.owner_id,kind,'shop:'||gen_random_uuid()::text);
  end if;
  return new;
end $$;
create trigger owner_email_shop_events after insert or update of kyc_status,status on public.shops for each row execute function public.owner_email_shop_events();

create function public.owner_email_subscription_events() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid;
begin
  if (tg_op='INSERT' and (new.is_permanent or new.expires_at>clock_timestamp())) or
     (tg_op='UPDATE' and (new.is_permanent or new.expires_at>clock_timestamp()) and
       (new.is_permanent is distinct from old.is_permanent or new.expires_at is distinct from old.expires_at)) then
    select owner_id into owner from public.shops where id=new.shop_id;
    if owner is not null then
      insert into public.owner_email_outbox(shop_id,owner_id,kind,event_key,expected_expiry,expected_permanent)
      values(new.shop_id,owner,'subscription_active','subscription:'||gen_random_uuid()::text,new.expires_at,new.is_permanent);
    end if;
  end if;
  return new;
end $$;
create trigger owner_email_subscription_events after insert or update of expires_at,is_permanent on public.shop_subscriptions for each row execute function public.owner_email_subscription_events();

create function public.owner_email_purchase_events() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid; kind text;
begin
  if new.status is not distinct from old.status then return new; end if;
  kind := case new.status when 'submitted' then 'subscription_payment_submitted' when 'rejected' then 'subscription_payment_rejected' else null end;
  if kind is not null then
    select owner_id into owner from public.shops where id=new.shop_id;
    if owner is not null then insert into public.owner_email_outbox(shop_id,owner_id,kind,event_key,purchase_id) values(new.shop_id,owner,kind,'purchase:'||gen_random_uuid()::text,new.id); end if;
  end if;
  return new;
end $$;
create trigger owner_email_purchase_events after update of status on public.subscription_purchases for each row execute function public.owner_email_purchase_events();

-- Idempotent reminders for current non-permanent subscriptions only. Limit the
-- expiry window to one day to avoid mailing a backlog on first activation.
create function public.queue_owner_subscription_reminders() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  insert into public.owner_email_outbox(shop_id,owner_id,kind,event_key,expected_expiry)
    select s.shop_id,sh.owner_id,case when s.expires_at>clock_timestamp() then 'subscription_expiring' else 'subscription_expired' end,
      case when s.expires_at>clock_timestamp() then 'expiring:' else 'expired:' end || s.shop_id::text || ':' || extract(epoch from s.expires_at)::text, s.expires_at
    from public.shop_subscriptions s join public.shops sh on sh.id=s.shop_id
    where not s.is_permanent and s.expires_at is not null and s.expires_at > clock_timestamp()-interval '1 day'
      and s.expires_at <= clock_timestamp()+interval '7 days'
    on conflict(event_key) do nothing;
  get diagnostics n=row_count; return n;
end $$;

-- A claim is single use. Expired claims become 'unknown', never automatically
-- retried: the provider may already have accepted the message before a crash.
create function public.claim_owner_email() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.owner_email_outbox%rowtype; addr text; owner_name text; valid boolean; token uuid;
begin
  update public.owner_email_outbox set state='unknown',finished_at=clock_timestamp(),error_code='lease_expired' where state='claimed' and claimed_at<clock_timestamp()-interval '5 minutes';
  loop
    select * into r from public.owner_email_outbox where state='pending' and next_attempt_at<=clock_timestamp() order by created_at,id limit 1 for update skip locked;
    if not found then return null; end if;
    select exists(select 1 from public.shops where id=r.shop_id and owner_id=r.owner_id) into valid;
    if valid and r.kind in ('verified','not_approved','changes_requested','under_review','account_suspended','account_reactivated') then
      select exists(select 1 from public.shops where id=r.shop_id and case r.kind
        when 'verified' then kyc_status::text='approved'
        when 'not_approved' then kyc_status::text='rejected'
        when 'changes_requested' then kyc_status::text='changes_requested'
        when 'under_review' then kyc_status::text='pending'
        when 'account_suspended' then status::text='suspended'
        when 'account_reactivated' then status::text='active' else false end) into valid;
    end if;
    if valid and r.kind='subscription_active' then
      select exists(select 1 from public.shop_subscriptions where shop_id=r.shop_id and is_permanent=r.expected_permanent
        and expires_at is not distinct from r.expected_expiry and (is_permanent or expires_at>clock_timestamp())) into valid;
    end if;
    if valid and r.kind in ('subscription_payment_submitted','subscription_payment_rejected') then
      select exists(select 1 from public.subscription_purchases where id=r.purchase_id and shop_id=r.shop_id and status=case r.kind when 'subscription_payment_submitted' then 'submitted' else 'rejected' end) into valid;
    end if;
    if valid and r.kind in ('subscription_expiring','subscription_expired') then
      select exists(select 1 from public.shop_subscriptions where shop_id=r.shop_id and not is_permanent and expires_at=r.expected_expiry
        and case when r.kind='subscription_expiring' then expires_at>clock_timestamp() and expires_at<=clock_timestamp()+interval '7 days'
          else expires_at<=clock_timestamp() end) into valid;
    end if;
    select u.email,p.full_name into addr,owner_name from auth.users u join public.profiles p on p.id=u.id where u.id=r.owner_id;
    if not valid or addr is null or length(trim(addr))=0 then
      update public.owner_email_outbox set state='skipped',finished_at=clock_timestamp(),error_code='stale_or_missing_recipient' where id=r.id;
    else
      token := gen_random_uuid();
      update public.owner_email_outbox set state='claimed',claimed_at=clock_timestamp(),claim_token=token,attempts=attempts+1 where id=r.id;
      return jsonb_build_object('id',r.id,'claim_token',token,'kind',r.kind,'email',addr,'owner_name',owner_name);
    end if;
  end loop;
end $$;

create function public.finish_owner_email(p_id uuid,p_claim uuid,p_outcome text,p_code text default null) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_outcome not in ('sent','failed','unknown','retry') or length(coalesce(p_code,''))>80 then raise exception 'INVALID_EMAIL_OUTCOME'; end if;
  update public.owner_email_outbox set
    state=case when p_outcome='retry' then case when attempts<5 then 'pending' else 'failed' end else p_outcome end,
    finished_at=case when p_outcome='retry' and attempts<5 then null else clock_timestamp() end,
    next_attempt_at=case when p_outcome='retry' then clock_timestamp()+interval '5 minutes' else next_attempt_at end,
    error_code=p_code
    where id=p_id and claim_token=p_claim and state='claimed';
  return found;
end $$;
revoke all on function public.owner_email_shop_events(),public.owner_email_subscription_events(),public.owner_email_purchase_events(),public.queue_owner_subscription_reminders(),public.claim_owner_email(),public.finish_owner_email(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.queue_owner_subscription_reminders(),public.claim_owner_email(),public.finish_owner_email(uuid,uuid,text,text) to service_role;
