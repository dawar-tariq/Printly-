#!/usr/bin/env node
// Generate an operator-reviewable production candidate. This script never
// connects to a database and does not enable sending or deploy anything.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const sources = ['0026_native_order_push.sql', '0027_native_notification_management.sql', '0028_native_order_token_notifications.sql'];
const guard = `-- Candidate for reviewed production deployment, not an automatic migration.
-- Applies 0026/0027/0028 atomically with claim RPCs denied to service_role.
-- Database and storage backup, rollout order, worker and consumer checks are
-- still required. It does not configure Firebase or send notifications.
begin;
do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime' and pubinsert and pubupdate and not pubdelete)
    or not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders')
    or not exists (select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='broadcast_order_tracking_change' and not tgisinternal and tgenabled <> 'D') then
    raise exception 'Unexpected production Realtime baseline';
  end if;
  if to_regclass('public.native_push_devices') is not null or to_regclass('public.native_notification_campaigns') is not null
    or to_regclass('public.native_app_releases') is not null or to_regprocedure('public.claim_native_push_deliveries(integer)') is not null then
    raise exception 'Native notification schema already exists; reconcile instead of rerunning';
  end if;
end $$;
`;
const finish = `
-- Pause claims even if another server deployment or scheduler is invoked.
revoke execute on function public.claim_native_push_deliveries(integer), public.claim_native_push_deliveries_budgeted(integer), public.claim_native_push_deliveries_unbudgeted(integer) from service_role;
do $$ begin
  if has_function_privilege('service_role','public.claim_native_push_deliveries(integer)','EXECUTE')
    or has_function_privilege('service_role','public.claim_native_push_deliveries_budgeted(integer)','EXECUTE')
    or has_function_privilege('service_role','public.claim_native_push_deliveries_unbudgeted(integer)','EXECUTE') then
    raise exception 'Native claim access is not paused';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
`;
const body = sources.map((name) => {
  const contents = readFileSync(resolve('supabase/migrations', name), 'utf8');
  const hash = createHash('sha256').update(contents).digest('hex');
  return `\n-- BEGIN ${name}; SHA-256 ${hash}\n${contents}\n-- END ${name}\n`;
}).join('');
const output = process.argv[2];
if (!output) { console.error('Usage: node scripts/prepare-native-production-sql.mjs OUTPUT.sql'); process.exit(1); }
writeFileSync(output, guard + body + finish, { flag: 'wx', mode: 0o600 });
console.log('Wrote review candidate; no database was contacted.');
