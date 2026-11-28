-- Preserve all existing rates and historical order totals. `sheet` keeps its
-- original per-document-page meaning; shops explicitly opt in to this new
-- physical-sheet unit on a double-sided print/photocopy rate.
alter table public.rate_card drop constraint if exists rate_card_unit_check;
alter table public.rate_card add constraint rate_card_unit_check
  check (unit in ('page', 'job', 'sheet', 'duplex_sheet'));
alter table public.rate_card add constraint rate_card_duplex_sheet_dimensions_check
  check (unit <> 'duplex_sheet' or (
    service in ('print', 'photocopy') and sides is not distinct from 'duplex'::public.sides_mode
  ));

-- Old deployments treat an unknown unit as pages × copies. Prevent them from
-- committing a wrong quote once any physical-sheet rate exists in the rate
-- snapshot. The original transaction still locks and compares that snapshot to
-- the current card, so omitting a newly added rate also fails closed.
alter function public.commit_draft_checkout(uuid, bigint, jsonb, integer, jsonb, jsonb, jsonb)
  rename to commit_draft_checkout_v1;
revoke all on function public.commit_draft_checkout_v1(uuid, bigint, jsonb, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function public.commit_draft_checkout(
  p_order_id uuid, p_version bigint, p_rates jsonb, p_gst_bps integer,
  p_shop jsonb, p_lines jsonb, p_checkout jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_rates) = 'array' then
    if exists (select 1 from jsonb_array_elements(p_rates) as r(value) where r.value->>'unit' = 'duplex_sheet')
      and (p_checkout->>'pricing_engine') is distinct from 'duplex-v1' then
      raise exception 'PRICING_CHANGED' using errcode = 'P0001';
    end if;
  end if;
  return public.commit_draft_checkout_v1(p_order_id, p_version, p_rates, p_gst_bps, p_shop, p_lines, p_checkout);
end $$;
revoke all on function public.commit_draft_checkout(uuid, bigint, jsonb, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_draft_checkout(uuid, bigint, jsonb, integer, jsonb, jsonb, jsonb)
  to service_role;
notify pgrst, 'reload schema';
