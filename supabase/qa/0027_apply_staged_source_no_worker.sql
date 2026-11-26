-- ONLY for the independently verified isolated QA project
-- rahfmpsdbwbktlobntkm, after 0027_prepare_source_and_pause_claims.sql.
-- The reviewed source, and both claim revocations, execute in one transaction.
do $apply_qa_0027$
declare migration_source text;
begin
  if has_function_privilege('service_role', 'public.claim_native_push_deliveries(integer)', 'EXECUTE') then
    raise exception 'The existing QA worker claim must be paused first';
  end if;
  select source into migration_source from public.native_qa_migration_source_f4f04e902c where singleton;
  if migration_source is null or octet_length(migration_source) <> 63569
     or encode(sha256(convert_to(migration_source, 'UTF8')), 'hex') <> 'f4f04e902c160e37208aefcb59c91ccb242f23cc0efffabc69f8af3cc71372c3' then
    raise exception 'The reviewed 0027 source is not staged or does not match';
  end if;
  execute migration_source;
  -- The canonical 0027 grants both wrappers; immediately remove those grants
  -- before commit, so neither the old nor the new QA worker can claim work.
  execute 'revoke execute on function public.claim_native_push_deliveries(integer), public.claim_native_push_deliveries_budgeted(integer) from public, anon, authenticated, service_role';
end $apply_qa_0027$;
notify pgrst, 'reload schema';
