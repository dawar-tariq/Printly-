-- Let an owner replace duplicate-name evidence when an application needs changes.
-- This is server-only and reopens review without ever auto-approving a claim.
create or replace function public.resubmit_shop_name_proof(p_shop_id uuid, p_gstin text default null, p_photo_path text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shop public.shops%rowtype;
  v_onboarding public.shop_onboarding%rowtype;
  v_gstin text := upper(regexp_replace(coalesce(p_gstin, ''), '[[:space:]]+', '', 'g'));
  v_valid_gstin boolean;
begin
  select * into v_shop from public.shops where id=p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode='P0001'; end if;
  select * into v_onboarding from public.shop_onboarding where shop_id=p_shop_id for update;
  if not found or not v_onboarding.duplicate_name then raise exception 'PROOF_NOT_REQUIRED' using errcode='P0001'; end if;
  if v_shop.kyc_status='approved' then raise exception 'PROOF_ALREADY_APPROVED' using errcode='P0001'; end if;
  if p_photo_path is not null and (
    p_photo_path not like p_shop_id::text || '/%'
    or not exists (select 1 from storage.objects where bucket_id='shop-name-proofs' and name=p_photo_path)
  ) then raise exception 'INVALID_PROOF_PHOTO' using errcode='P0001'; end if;
  v_valid_gstin := v_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
  if not v_valid_gstin and p_photo_path is null then raise exception 'DUPLICATE_NAME_PROOF_REQUIRED' using errcode='P0001'; end if;
  update public.shop_onboarding set
    name_proof_type = case when p_photo_path is not null then 'photo' else 'gstin' end,
    name_proof_gstin = case when v_valid_gstin then v_gstin else null end,
    name_proof_photo_path = p_photo_path,
    name_proof_submitted_at = now(), submitted_at=now(), review_note='', reviewed_at=null, reviewed_by=null
    where shop_id=p_shop_id;
  update public.shops set gstin=case when v_valid_gstin then v_gstin else gstin end,
    kyc_status='pending', status='paused', updated_at=now() where id=p_shop_id;
  return jsonb_build_object('old_photo_path', v_onboarding.name_proof_photo_path);
end
$$;
revoke all on function public.resubmit_shop_name_proof(uuid,text,text) from public, anon, authenticated;
grant execute on function public.resubmit_shop_name_proof(uuid,text,text) to service_role;
